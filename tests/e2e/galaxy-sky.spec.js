import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

// Luminance-weighted mean direction of the galaxy cube, as longitude and latitude in degrees of
// the hole frame. The field stars are spread evenly and cancel, so it points at the galaxy.
function skyCentroid() {
    const { width, height, rgb } = window.__BH__.probeSky(256, 128);
    let x = 0;
    let y = 0;
    let z = 0;
    let total = 0;
    for (let row = 0; row < height; row++) {
        const lat = ((row + 0.5) / height - 0.5) * Math.PI;
        for (let col = 0; col < width; col++) {
            const lon = ((col + 0.5) / width) * 2 * Math.PI - Math.PI;
            const i = (row * width + col) * 3;
            const weight =
                (0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]) * Math.cos(lat);
            x += weight * Math.cos(lat) * Math.cos(lon);
            y += weight * Math.cos(lat) * Math.sin(lon);
            z += weight * Math.sin(lat);
            total += weight;
        }
    }
    const deg = 180 / Math.PI;
    return {
        lon: Math.atan2(y, x) * deg,
        lat: Math.atan2(z, Math.hypot(x, y)) * deg,
        total,
        pixels: Array.from(rgb),
    };
}

function difference(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum;
}

async function nextFrames(page, count) {
    const frame = await page.evaluate(() => window.__BH__.frameCount);
    await page.waitForFunction((n) => window.__BH__.frameCount >= n, frame + count, {
        timeout: 300_000,
    });
}

test('the galaxy sky is placed, turns with the clock and follows its parameters', async ({
    page,
}) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);

    const status = await page.evaluate(() => window.__BH__.sky);
    expect(status).toMatchObject({ face: 384, stars: 60000, clouds: 800, background: 3000 });
    expect(status.revision).toBeGreaterThan(0);

    const start = await page.evaluate(skyCentroid);
    const view = await page.evaluate(() => window.__BH__.params.sky.galaxy);
    expect(Math.abs(start.lon - view.longitude)).toBeLessThan(6);
    expect(Math.abs(start.lat - view.latitude)).toBeLessThan(6);

    // The frozen e2e clock is moved by a timeline event, as a seek would.
    await page.evaluate(() => {
        window.blackHolePresentation.setTimeline({
            name: 'galaxy',
            duration: 1,
            loop: false,
            tracks: [],
            events: [{ t: 0, action: 'set', path: 'observerState.time', value: 20 }],
        });
        window.blackHolePresentation.seek(0.5);
    });
    await page.waitForFunction((n) => window.__BH__.sky.revision > n, status.revision, {
        timeout: 300_000,
    });
    const turned = await page.evaluate(skyCentroid);
    expect(difference(turned.pixels, start.pixels)).toBeGreaterThan(0.02 * start.total);
    // Turning about its own axis keeps the galaxy where it is.
    expect(Math.abs(turned.lon - view.longitude)).toBeLessThan(6);

    const beforeSeed = await page.evaluate(() => window.__BH__.sky.revision);
    await page.evaluate(() => {
        window.__BH__.params.sky.galaxy.seed = 7;
    });
    await nextFrames(page, 2);
    expect(await page.evaluate(() => window.__BH__.sky.revision)).toBeGreaterThan(beforeSeed);

    // The grid sky is drawn by the ray tracer and leaves the cube alone.
    const beforeGrid = await page.evaluate(() => window.__BH__.sky.revision);
    await page.evaluate(() => {
        window.__BH__.params.sky.mode = 'grid';
    });
    await nextFrames(page, 2);
    expect(await page.evaluate(() => window.__BH__.sky.revision)).toBe(beforeGrid);
    expect(problems).toEqual([]);
});
