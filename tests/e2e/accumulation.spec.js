import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

// The e2e switch freezes the simulation clock, so the default scene is a static view: its running
// mean grows by one frame per frame up to max_frames, and any change to the view restarts it.
test('a static view accumulates into a still and restarts when the view changes', async ({
    page,
}) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);

    const maxFrames = await page.evaluate(() => {
        window.__BH__.params.accumulation.max_frames = 32;
        return window.__BH__.params.accumulation.max_frames;
    });
    await page.waitForFunction((n) => window.__BH__.accumulatedFrames >= n, maxFrames, {
        timeout: 300_000,
    });

    // Converged frames keep being presented from the finished mean without growing it.
    const convergedAt = await page.evaluate(() => window.__BH__.frameCount);
    await page.waitForFunction((n) => window.__BH__.frameCount >= n + 3, convergedAt, {
        timeout: 300_000,
    });
    expect(await page.evaluate(() => window.__BH__.accumulatedFrames)).toBe(maxFrames);

    const changedAt = await page.evaluate(() => {
        window.__BH__.params.look.disk_gain *= 0.5;
        return window.__BH__.frameCount;
    });
    await page.waitForFunction((n) => window.__BH__.frameCount >= n + 2, changedAt, {
        timeout: 300_000,
    });
    expect(await page.evaluate(() => window.__BH__.accumulatedFrames)).toBeLessThan(maxFrames);
    expect(problems).toEqual([]);
});
