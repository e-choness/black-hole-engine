import { expect, test } from '@playwright/test';
import { trackPageProblems } from './support.js';

test('explains in the page when WebGL 2 is unavailable', async ({ page }) => {
    const problems = trackPageProblems(page);
    await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            return type === 'webgl2' ? null : getContext.call(this, type, ...args);
        };
    });

    await page.goto('./?quality=mobile&e2e=1');

    const loader = page.locator('#loader');
    await expect(loader).toHaveAttribute('role', 'alert');
    await expect(loader).toContainText('WebGL 2 is not available');
    await expect(loader.getByRole('link')).toHaveAttribute('href', 'https://get.webgl.org/webgl2/');
    await expect(page.locator('#bh-canvas')).toHaveCount(0);
    expect(problems).toEqual([]);
});
