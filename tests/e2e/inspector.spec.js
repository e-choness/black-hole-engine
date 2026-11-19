import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

test('inspector edits reach the engine and survive a reload through the view link', async ({
    page,
}) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const inspector = page.getByRole('complementary', { name: 'Parameters' });
    const toggle = page.getByRole('button', { name: 'Parameters', exact: true });

    // The test viewport is narrow, where the inspector starts closed.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await inspector.getByRole('tab', { name: 'Disk' }).click();
    await inspector.getByRole('button', { name: /^Peak temperature \d/ }).click();
    const input = inspector.getByRole('textbox', { name: 'Peak temperature' });
    await input.fill('12 000');
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__BH__.params.disk_temperature)).toBe(12000);
    await expect(
        inspector.getByRole('button', { name: /^Reset Peak temperature to/ }),
    ).toBeVisible();

    await inspector.getByRole('tab', { name: 'Jets' }).click();
    await inspector.getByRole('switch', { name: 'Relativistic jets' }).click();
    await expect.poll(() => page.evaluate(() => window.__BH__.params.jet.enabled)).toBe(true);

    await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('dt');
    await page.reload();
    await page.waitForFunction(() => window.__BH__ !== undefined);
    await page.evaluate(() => window.__BH__.ready);
    await expect.poll(() => page.evaluate(() => window.__BH__.params.disk_temperature)).toBe(12000);
    expect(await page.evaluate(() => window.__BH__.params.jet.enabled)).toBe(true);

    await toggle.click();
    await inspector.getByRole('textbox', { name: /Filter parameters/ }).fill('lorentz factor');
    await expect(inspector.getByRole('slider', { name: 'Lorentz factor Γ' })).toBeVisible();
    expect(problems).toEqual([]);
});
