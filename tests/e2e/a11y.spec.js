import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

const BLOCKING = new Set(['serious', 'critical']);

async function blockingViolations(page) {
    const results = await new AxeBuilder({ page }).include('#ui-root').analyze();
    return results.violations
        .filter((violation) => BLOCKING.has(violation.impact))
        .map((violation) => `${violation.id}: ${violation.nodes.map((n) => n.target).join(' | ')}`);
}

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
    expect(problems).toEqual([]);
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the interface has no serious or critical accessibility violations', async ({ page }) => {
        const problems = trackPageProblems(page);
        await openSimulation(page);
        expect(await blockingViolations(page)).toEqual([]);

        await page
            .getByRole('button', { name: 'Search parameters, scenarios and actions' })
            .click();
        await page.keyboard.type('spin');
        expect(await blockingViolations(page), 'palette').toEqual([]);
        expect(problems).toEqual([]);
    });
});
