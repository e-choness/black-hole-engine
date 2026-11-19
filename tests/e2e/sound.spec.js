import { expect, test } from '@playwright/test';
import { blockingViolations, openSimulation, trackPageProblems } from './support.js';

test('sound starts off, turns on from the rail and remembers its levels', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const rail = page.getByRole('navigation', { name: 'Modes' });
    await rail.getByRole('button', { name: 'Sound off' }).click();
    const panel = page.getByRole('dialog', { name: 'Sound' });
    const toggle = panel.getByRole('switch', { name: 'Sound' });
    await expect(toggle).not.toBeChecked();
    await expect(panel.getByRole('button', { name: 'Play ringdown' })).toBeDisabled();
    expect(await blockingViolations(page)).toEqual([]);

    await toggle.click();
    await expect(panel.getByRole('status')).toHaveText('On');
    await expect(rail.getByRole('button', { name: 'Sound on' })).toBeVisible();

    const volume = panel.getByRole('slider', { name: 'Volume' });
    await volume.focus();
    await page.keyboard.press('End');
    await expect(volume).toHaveAttribute('aria-valuetext', '100 %');
    const muteClocks = panel.getByRole('button', { name: 'Mute Clocks' });
    await muteClocks.click();
    await expect(muteClocks).toHaveAttribute('aria-pressed', 'true');

    await panel.getByRole('button', { name: 'Play ringdown' }).click();
    await expect(panel.getByRole('log', { name: 'Sound captions' })).toContainText(
        'Gravitational-wave ringdown at',
    );

    await toggle.click();
    await expect(panel.getByRole('status')).toHaveText(/^Off/);

    // Sound is off on every visit; only the levels are remembered.
    await openSimulation(page);
    await rail.getByRole('button', { name: 'Sound off' }).click();
    await expect(panel.getByRole('slider', { name: 'Volume' })).toHaveAttribute(
        'aria-valuetext',
        '100 %',
    );
    await expect(muteClocks).toHaveAttribute('aria-pressed', 'true');
    expect(problems).toEqual([]);
});
