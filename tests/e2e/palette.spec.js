import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

const param = (page, path) =>
    page.evaluate(
        (key) => key.split('.').reduce((value, part) => value[part], window.__BH__.params),
        path,
    );

test('the command palette adjusts and reveals parameters and runs actions', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const palette = page.getByRole('dialog', { name: 'Command palette' });

    await page.keyboard.press('Control+K');
    await expect(palette).toBeVisible();
    await page.keyboard.type('spin a/m');
    const spinOption = palette.getByRole('option', { name: /^Spin a\/M/ });
    await expect(spinOption).toHaveAttribute('aria-selected', 'true');
    await expect(palette.getByRole('combobox')).toHaveAttribute(
        'aria-activedescendant',
        (await spinOption.getAttribute('id')) ?? '',
    );
    await page.keyboard.press('Tab');
    const slider = palette.getByRole('slider', { name: 'Spin a/M' });
    await expect(slider).toBeFocused();
    const spin = await param(page, 'black_hole.spin');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => param(page, 'black_hole.spin')).toBeLessThan(spin);
    await page.keyboard.press('Escape');
    await expect(palette.getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    await page.keyboard.press('Control+K');
    await page.keyboard.type('time scale');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    const inspector = page.getByRole('complementary', { name: 'Parameters' });
    await expect(inspector.getByRole('slider', { name: 'Time scale' })).toBeFocused();

    await page.keyboard.press('Control+K');
    await page.keyboard.type('keyboard shortcuts');
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await page.getByRole('button', { name: /^Search parameters, scenarios and actions/ }).click();
    await page.keyboard.type('dive mode');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Observer readouts' })).toContainText(
        'Observer · free fall',
    );
    expect(problems).toEqual([]);
});

test('keyboard shortcuts drive playback, modes, the interface and the help sheet', async ({
    page,
}) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const hud = page.getByRole('region', { name: 'Observer readouts' });

    await page.keyboard.press('Space');
    await expect.poll(() => param(page, 'time_scale')).toBe(0);
    await page.keyboard.press('Space');
    await expect.poll(() => param(page, 'time_scale')).toBe(1);

    await page.keyboard.press('2');
    await expect(hud).toContainText('Observer · hovering');
    await page.keyboard.press('1');
    await expect(hud).toContainText('Observer · at rest');

    const body = page.locator('body');
    await page.keyboard.press('t');
    await expect(body).toHaveClass(/has-timeline-panel/);
    await page.keyboard.press('t');
    await expect(body).not.toHaveClass(/has-timeline-panel/);

    await page.keyboard.press('h');
    await expect(page.locator('.shell')).toHaveAttribute('data-ui-hidden', 'true');
    await page.keyboard.press('h');
    await expect(page.locator('.shell')).toHaveAttribute('data-ui-hidden', 'false');

    await page.keyboard.press('Shift+Slash');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Legal notices and licenses' })).toHaveAttribute(
        'href',
        'docs/LEGAL.md',
    );
    await expect(sheet.getByRole('link', { name: 'Source code' })).toHaveAttribute(
        'href',
        'https://github.com/e-choness/black-hole-engine',
    );
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(problems).toEqual([]);
});

// Phones have no room for the timeline editor, so neither its shortcut, the palette nor
// the shortcut sheet offers it.
test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the timeline editor is not offered', async ({ page }) => {
        const problems = trackPageProblems(page);
        await openSimulation(page);
        await page.keyboard.press('t');

        await page
            .getByRole('button', { name: 'Search parameters, scenarios and actions' })
            .click();
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await page.keyboard.type('presentation keyframes');
        await expect(palette).toContainText('Nothing matches “presentation keyframes”');
        await expect(page.locator('body')).not.toHaveClass(/has-timeline-panel/);

        await page.keyboard.press('Escape');
        await expect(palette).toBeHidden();
        await page.keyboard.press('Shift+Slash');
        const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
        await expect(sheet).toContainText('Command palette');
        await expect(sheet).not.toContainText('Timeline editor');
        expect(problems).toEqual([]);
    });
});
