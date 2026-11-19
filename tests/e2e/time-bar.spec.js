import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

const timeScale = (page) => page.evaluate(() => window.__BH__.params.time_scale);
const mode = (page, name) =>
    page.getByRole('radio', { name }).or(page.getByRole('button', { name, exact: true }));

test('the time bar pauses, steps and sets the speed; the clocks follow', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const bar = page.getByRole('group', { name: 'Time controls' });
    const hud = page.getByRole('region', { name: 'Observer readouts' });

    await bar.getByRole('button', { name: /^Pause simulation/ }).click();
    await expect.poll(() => timeScale(page)).toBe(0);

    // The e2e clock is frozen, so only a step moves the distant clock, by one r_s/c.
    const distant = bar.locator('.clock-value').first();
    await expect(distant).not.toHaveText('–');
    const start = await distant.textContent();
    await bar.getByRole('button', { name: /^Step forward/ }).click();
    await expect(distant).not.toHaveText(start);

    await bar.getByRole('button', { name: /^Simulation speed × 1 / }).click();
    await page.getByRole('menuitemradio', { name: /^× 2 / }).click();
    await expect.poll(() => timeScale(page)).toBe(0);
    await bar.getByRole('button', { name: /^Play simulation/ }).click();
    await expect.poll(() => timeScale(page)).toBe(2);
    await expect(bar.getByRole('button', { name: /^Simulation speed × 2 / })).toBeVisible();

    await expect(hud.getByText('Observer · at rest')).toBeVisible();
    await expect(hud.locator('dd').first()).toHaveText(/r_s$/);

    await mode(page, 'Dive').click();
    await expect(hud.getByText('Observer · free fall')).toBeVisible();
    const progress = bar.getByRole('slider', { name: 'Dive progress' });
    await progress.focus();
    await page.keyboard.press('End');
    await expect(hud.getByRole('status')).toHaveText(/(Singularity|Inner horizon) reached/);
    await expect(bar.getByText('inside horizon')).toBeVisible();

    await mode(page, 'Orbit').click();
    await expect(hud.getByText('Observer · at rest')).toBeVisible();
    expect(problems).toEqual([]);
});
