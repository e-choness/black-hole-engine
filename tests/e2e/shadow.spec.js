import { expect, test } from '@playwright/test';
import { SHADER_MASS as M } from '../../src/app/core/physics/kerr.js';
import { bardeenShadowExtent, schwarzschildShadowAngle } from '../support/kerr-reference.js';
import { trackPageProblems } from './support.js';

// Camera azimuths, about the spin axis, at which every configuration is rendered. The shadow is
// the same in all of them while the sky behind it changes.
const AZIMUTHS = 4;

// Renders the free camera, a static observer looking at the hole, against a saturated sky. One
// sample per pixel without TAA or bloom makes every pixel a single ray, bright when it escapes.
// Escaping rays can still be dark where the sky texture is black, so a pixel counts as captured
// only when it is dark at every azimuth.
async function renderShadow(page, { solver, spin, distance }) {
    await page.goto('./?quality=medium&e2e=1');
    await page.waitForFunction(() => window.__BH__ !== undefined);
    await page.evaluate(() => window.__BH__.ready);
    await page.addStyleTag({
        content:
            'body * { visibility: hidden !important; } #bh-canvas { visibility: visible !important; }',
    });

    const seek = (time) =>
        page.evaluate((time) => {
            const frame = window.__BH__.frameCount;
            window.blackHolePresentation.seek(time);
            return frame;
        }, time);
    await page.evaluate(
        ({ solver, spin, distance, azimuths }) => {
            // Preset-owned settings are not timeline paths, so they are set directly.
            const params = window.__BH__.params;
            params.sample_count = 1;
            params.taa_enabled = false;
            const settings = {
                kerr_mode: solver,
                'black_hole.spin_enabled': spin !== 0,
                'black_hole.spin': spin,
                'observer.motion': false,
                'observer.distance': distance,
                accretion_disk: false,
                'planet.enabled': false,
                'jet.enabled': false,
                'bloom.enabled': false,
                'look.galaxy_gain': 1e5,
                'look.star_gain': 1e5,
                // Yaw about the vertical axis first, so camera.rotation.y turns the camera about
                // the spin axis at constant inclination.
                'camera.rotation.order': 'YXZ',
            };
            const events = Object.entries(settings).map(([path, value]) => ({
                t: 0,
                action: 'set',
                path,
                value,
            }));
            events.push({ t: 0.001, action: 'updateShader' });
            for (let k = 1; k < azimuths; k++) {
                const value = (2 * Math.PI * k) / azimuths;
                events.push({ t: 0.1 * k, action: 'set', path: 'camera.rotation.y', value });
            }
            window.blackHolePresentation.setTimeline({
                name: 'shadow',
                duration: 1,
                loop: false,
                tracks: [],
                events,
            });
        },
        { solver, spin, distance, azimuths: AZIMUTHS },
    );

    const images = [];
    let position;
    let camera;
    for (let k = 0; k < AZIMUTHS; k++) {
        const frame = await seek(0.1 * k + 0.05);
        await page.waitForFunction((n) => window.__BH__.frameCount > n, frame, {
            timeout: 300_000,
        });
        if (k === 0) {
            // Nothing moves in this scene, so rendering stops once the new shader is drawn.
            for (let last = -1; ;) {
                const count = await page.evaluate(() => window.__BH__.frameCount);
                if (count === last) break;
                last = count;
                await page.waitForTimeout(1500);
            }
            ({ position, camera } = await page.evaluate(() => {
                const api = window.blackHolePresentation;
                const p = api.getPathValue('observerState.position');
                const camera = api.getPathValue('observerState.orientation').elements;
                return { position: [p.x, p.y, p.z], camera };
            }));
        }
        images.push((await page.locator('#bh-canvas').screenshot()).toString('base64'));
    }
    return { images, position, camera };
}

// Smallest radius rho = |p| of an escaping pixel within each sector [centre - half, centre +
// half] of the polar angle about the image centre, where the camera axis points at the hole.
// p = (x, y) are the normalised image coordinates of the ray (x, y, 1) in main.glsl with
// FOV_MULT = 1. A pixel escapes exactly when the ray through its centre lies outside the
// shadow, and many pixel centres sit just outside the edge, so the minimum approaches the edge
// from outside within a small fraction of a pixel.
async function escapeRadii({ images, sectors }) {
    let bright = null;
    let w = 0;
    let h = 0;
    for (const base64 of images) {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        w = image.width;
        h = image.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        bright = bright || new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
            if (data[4 * i] + data[4 * i + 1] + data[4 * i + 2] >= 3 * 128) bright[i] = 1;
        }
    }
    const radii = sectors.map(() => Infinity);
    for (let j = 0; j < h; j++) {
        const y = (1 - (2 * (j + 0.5)) / h) * (h / w);
        for (let i = 0; i < w; i++) {
            if (!bright[j * w + i]) continue;
            const x = -1 + (2 * (i + 0.5)) / w;
            const angle = Math.atan2(y, x);
            const rho = Math.hypot(x, y);
            sectors.forEach(([centre, half], s) => {
                const offset = Math.abs(
                    Math.atan2(Math.sin(angle - centre), Math.cos(angle - centre)),
                );
                if (offset <= half && rho < radii[s]) radii[s] = rho;
            });
        }
    }
    return radii;
}

// The page's content security policy blocks data URLs, so the PNGs are decoded on a blank page.
async function measure(page, shot, sectors) {
    const blank = await page.context().newPage();
    try {
        return await blank.evaluate(escapeRadii, { images: shot.images, sectors });
    } finally {
        await blank.close();
    }
}

for (const solver of ['kerr_inspired_disk_velocity', 'full_kerr']) {
    test(`a = 0 shadow matches the static-observer angular radius (${solver})`, async ({
        page,
    }) => {
        test.slow();
        const problems = trackPageProblems(page);
        const sectors = Array.from({ length: 16 }, (_, k) => [(k * Math.PI) / 8, Math.PI / 16]);
        for (const distance of [5, 11]) {
            const shot = await renderShadow(page, { solver, spin: 0, distance });
            const expected = schwarzschildShadowAngle(Math.hypot(...shot.position));
            const radii = await measure(page, shot, sectors);
            radii.forEach((rho, k) => {
                const ratio = Math.atan(rho) / expected;
                expect(
                    Math.abs(ratio - 1),
                    `sector ${k * 22.5} deg at r = ${distance}`,
                ).toBeLessThan(0.01);
            });
        }
        expect(problems).toEqual([]);
    });
}

test('Full Kerr shadow reproduces the Bardeen asymmetry', async ({ page }) => {
    test.slow();
    const problems = trackPageProblems(page);
    const chi = 0.9;
    const shot = await renderShadow(page, { solver: 'full_kerr', spin: chi, distance: 30 });
    const r = Math.hypot(...shot.position);
    const [rightRho, leftRho] = await measure(page, shot, [
        [0, Math.PI / 36],
        [Math.PI, Math.PI / 36],
    ]);

    // Horizontal edge angles as impact parameters in M, b = r sin(psi) / sqrt(1 - r_s / r) for a
    // static observer; frame dragging at the camera shifts both edges by g_t_phi / g_tt, about
    // 0.03 M at r = 30 r_s.
    const impact = (rho) => (r * Math.sin(Math.atan(rho))) / Math.sqrt(1 - 1 / r) / M;
    const { alphaMin, alphaMax } = bardeenShadowExtent(chi, Math.acos(shot.position[2] / r));
    const width = alphaMax - alphaMin;

    // The limb that frame dragging moves towards the camera carries the prograde photon orbit,
    // so the flattened edge, |alpha_min| from the centre, lies on that side.
    const right3 = shot.camera.slice(0, 3);
    const forward3 = shot.camera.slice(6, 9);
    const recedingRight = right3[0] * forward3[1] - right3[1] * forward3[0] > 0;
    const near = impact(recedingRight ? leftRho : rightRho);
    const far = impact(recedingRight ? rightRho : leftRho);
    expect(
        Math.abs(near + alphaMin) / width,
        `flattened edge at ${near.toFixed(3)} M`,
    ).toBeLessThan(0.03);
    expect(Math.abs(far - alphaMax) / width, `far edge at ${far.toFixed(3)} M`).toBeLessThan(0.03);
    expect(problems).toEqual([]);
});
