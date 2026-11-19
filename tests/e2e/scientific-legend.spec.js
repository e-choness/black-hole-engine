import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

const upperLuminance = async (legend) => {
    const label = await legend.getAttribute('aria-label');
    return Number(/to ([0-9.e-]+) cd/.exec(label)[1]);
};

// The colour bar follows the tone mapper and the exposure: one stop more exposure maps the
// bright end of the window to half the luminance.
test('the Scientific tone mapper shows a luminance colour bar that follows the exposure', async ({
    page,
}) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const legend = page.locator('#scientific-legend');
    await expect(legend).toBeHidden();

    await page.evaluate(() => {
        window.__BH__.params.look.tone_mapper = 'scientific';
    });
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('cd/m²');
    expect(await legend.locator('.scientific-legend-ticks span').count()).toBeGreaterThanOrEqual(3);

    const before = await upperLuminance(legend);
    await page.evaluate(() => {
        window.__BH__.params.look.exposure_ev += 1;
    });
    await expect.poll(async () => (await upperLuminance(legend)) / before).toBeCloseTo(0.5, 1);

    await page.evaluate(() => {
        window.__BH__.params.look.tone_mapper = 'agx';
    });
    await expect(legend).toBeHidden();
    expect(problems).toEqual([]);
});
