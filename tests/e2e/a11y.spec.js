import { expect, test } from '@playwright/test';
import { blockingViolations, openSimulation, trackPageProblems } from './support.js';

test('the interface has no serious or critical accessibility violations', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    expect(await blockingViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Parameters', exact: true }).click();
    for (const tab of ['Black hole', 'Disk', 'Render']) {
        await page.getByRole('tab', { name: tab }).click();
        expect(await blockingViolations(page), tab).toEqual([]);
    }

    await page.getByRole('radio', { name: 'Dive' }).click();
    await expect(page.getByRole('slider', { name: 'Dive progress' })).toBeVisible();
    expect(await blockingViolations(page), 'dive').toEqual([]);

    await page.keyboard.press('Control+K');
    await page.keyboard.type('spin');
    expect(await blockingViolations(page), 'palette').toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+Slash');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    expect(await blockingViolations(page), 'shortcuts').toEqual([]);
    await page.keyboard.press('Escape');

    await page.keyboard.press('r');
    await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible();
    expect(await blockingViolations(page), 'capture video').toEqual([]);
    await page.getByRole('tab', { name: 'Screenshot' }).click();
    expect(await blockingViolations(page), 'capture screenshot').toEqual([]);
    expect(problems).toEqual([]);
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the interface has no serious or critical accessibility violations', async ({ page }) => {
        const problems = trackPageProblems(page);
        await openSimulation(page);
        expect(await blockingViolations(page)).toEqual([]);
        await expect(page.getByRole('group', { name: 'View actions' })).toBeVisible();

        // The parameter sheet carries the mode switch, as phones have no rail.
        await page.getByRole('button', { name: 'Parameters', exact: true }).click();
        const sheet = page.getByRole('complementary', { name: 'Parameters' });
        await sheet.getByRole('radio', { name: 'Dive' }).click();
        await expect(page.getByRole('slider', { name: 'Dive progress' })).toBeVisible();
        expect(await blockingViolations(page), 'parameter sheet').toEqual([]);
        await sheet.getByRole('button', { name: 'Hide parameters' }).click();
        await expect(sheet).toBeHidden();

        await page
            .getByRole('button', { name: 'Search parameters, scenarios and actions' })
            .click();
        await page.keyboard.type('spin');
        expect(await blockingViolations(page), 'palette').toEqual([]);
        expect(problems).toEqual([]);
    });
});
