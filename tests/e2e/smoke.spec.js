import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

const SCREENSHOT_DIR = path.resolve('.cache/screenshots');
// Enough frames for the temporal anti-aliasing history of the mobile preset to converge.
const SETTLE_FRAMES = 24;

// Averages the WebGL canvas inside a requestAnimationFrame callback that runs after the render
// loop, while the drawing buffer of the current frame is still intact.
function sampleCanvasLuminance() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            const source = document.getElementById('bh-canvas');
            const probe = document.createElement('canvas');
            probe.width = 64;
            probe.height = 36;
            const ctx = probe.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(source, 0, 0, probe.width, probe.height);
            const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
            let sum = 0;
            let max = 0;
            for (let i = 0; i < data.length; i += 4) {
                const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
                sum += luminance;
                max = Math.max(max, luminance);
            }
            resolve({ mean: sum / (data.length / 4), max });
        });
    });
}

test('renders the black hole without console or page errors', async ({ page }, testInfo) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    await page.waitForFunction((frames) => window.__BH__.frameCount >= frames, SETTLE_FRAMES);

    const quality = await page.evaluate(() => window.__BH__.params.quality);
    expect(quality).toBe('mobile');

    const luminance = await page.evaluate(sampleCanvasLuminance);
    expect(luminance.max, 'the accretion disk should produce bright pixels').toBeGreaterThan(96);
    expect(luminance.mean, 'the frame should not be blown out').toBeLessThan(200);

    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const pagePath = path.join(SCREENSHOT_DIR, 'smoke-page.png');
    await page.screenshot({ path: pagePath });
    await testInfo.attach('page', { path: pagePath, contentType: 'image/png' });

    await page.addStyleTag({
        content:
            'body * { visibility: hidden !important; } #bh-canvas { visibility: visible !important; }',
    });
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const renderPath = path.join(SCREENSHOT_DIR, 'smoke-render.png');
    await page.locator('#bh-canvas').screenshot({ path: renderPath });
    await testInfo.attach('render', { path: renderPath, contentType: 'image/png' });

    expect(problems).toEqual([]);
});

// A GPU driver reset takes the WebGL context away; the renderer must draw the scene again once the
// browser restores it, with every shader, texture and render target recreated.
test('draws again after the WebGL context is lost and restored', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    await page.waitForFunction((frames) => window.__BH__.frameCount >= frames, SETTLE_FRAMES);

    await page.evaluate(() => {
        const gl = document.getElementById('bh-canvas').getContext('webgl2');
        window.__loseContext = gl.getExtension('WEBGL_lose_context');
        window.__loseContext.loseContext();
    });
    await page.waitForFunction(() =>
        document.getElementById('bh-canvas').getContext('webgl2').isContextLost(),
    );
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));

    await page.evaluate(() => window.__loseContext.restoreContext());
    await page.waitForFunction(
        () => !document.getElementById('bh-canvas').getContext('webgl2').isContextLost(),
    );
    const restoredAt = await page.evaluate(() => window.__BH__.frameCount);
    await page.waitForFunction(
        ([start, frames]) => window.__BH__.frameCount >= start + frames,
        [restoredAt, SETTLE_FRAMES],
    );

    const luminance = await page.evaluate(sampleCanvasLuminance);
    expect(luminance.max, 'the accretion disk should be drawn again').toBeGreaterThan(96);
    expect(luminance.mean, 'the frame should not be blown out').toBeLessThan(200);
    expect(problems).toEqual([]);
});
