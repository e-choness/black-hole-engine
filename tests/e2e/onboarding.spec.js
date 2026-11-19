import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

test('first-run hints follow the mode until hidden, which is remembered', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    await expect(
        page.getByText('Drag to orbit · Right-drag to pan · Scroll to zoom'),
    ).toBeVisible();

    await page.keyboard.press('3');
    await expect(
        page.getByText('You fall freely from rest, through the horizon · Drag to look around'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Hide hints' }).click();
    await expect(page.getByRole('button', { name: 'Hide hints' })).toBeHidden();

    await openSimulation(page);
    await expect(page.getByRole('group', { name: 'Time controls' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide hints' })).toBeHidden();
    expect(problems).toEqual([]);
});

// The contents list stands beside the notes on wide screens only.
test.describe('physics notes', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('open from the rail and jump to a section', async ({ page }) => {
        const problems = trackPageProblems(page);
        await openSimulation(page);

        await page
            .getByRole('navigation', { name: 'Modes' })
            .getByRole('button', { name: 'Physics' })
            .click();
        const dialog = page.getByRole('dialog', { name: 'Physics' });
        const notes = dialog.getByRole('article', { name: 'Physics notes' });
        await expect(notes.getByRole('heading', { name: 'Solvers', exact: true })).toBeVisible();
        await expect(
            notes.locator('pre').filter({ hasText: 'd^2u/dphi^2 = -u + (3/2) u^2' }),
        ).toBeVisible();

        const validation = notes.getByRole('heading', { name: 'Validation', exact: true });
        await dialog
            .getByRole('navigation', { name: 'Contents' })
            .getByRole('button', { name: 'Validation' })
            .click();
        await expect(validation).toBeFocused();
        await expect(validation).toBeInViewport();

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        expect(problems).toEqual([]);
    });
});
