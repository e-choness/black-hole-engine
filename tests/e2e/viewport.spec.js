import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

// React Three Fiber sizes the canvas to the window and carries the render scale as its pixel ratio;
// three.js floors the drawing buffer to whole pixels, and the passes must follow it.
function sized(width, height, scale) {
    const buffer = [Math.floor(width * scale), Math.floor(height * scale)];
    return { canvas: buffer, passes: buffer };
}

async function framesAfter(page, count) {
    const start = await page.evaluate(() => window.__BH__.frameCount);
    await page.waitForFunction((n) => window.__BH__.frameCount >= n, start + count, {
        timeout: 300_000,
    });
}

test('the canvas and its passes follow the window size and the render scale', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const viewport = () => page.evaluate(() => window.__BH__.viewport);
    const scale = await page.evaluate(() => window.__BH__.params.resolution_scale);

    await expect.poll(viewport).toEqual(sized(800, 450, scale));
    expect(await page.locator('#bh-canvas').boundingBox()).toEqual({
        x: 0,
        y: 0,
        width: 800,
        height: 450,
    });

    await page.setViewportSize({ width: 640, height: 480 });
    await expect.poll(viewport).toEqual(sized(640, 480, scale));
    await framesAfter(page, 2);

    const inspector = page.getByRole('complementary', { name: 'Parameters' });
    await page.getByRole('button', { name: 'Parameters', exact: true }).click();
    await inspector.getByRole('tab', { name: 'Render' }).click();
    await inspector.getByRole('button', { name: /^Resolution scale \d/ }).click();
    const input = inspector.getByRole('textbox', { name: 'Resolution scale' });
    await input.fill('0.5');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__BH__.params.resolution_scale)).toBe(0.5);
    await expect.poll(viewport).toEqual(sized(640, 480, 0.5));
    await framesAfter(page, 2);
    expect(await page.locator('#bh-canvas').boundingBox()).toEqual({
        x: 0,
        y: 0,
        width: 640,
        height: 480,
    });
    expect(problems).toEqual([]);
});
