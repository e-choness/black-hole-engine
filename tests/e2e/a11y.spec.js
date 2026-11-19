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
    expect(problems).toEqual([]);
});
