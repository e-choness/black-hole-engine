import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

const PLANET_MAP = /\/assets\/jupiter-[\w-]+\.webp$/;

test('the mobile preset, which draws no planet, never downloads its map', async ({ page }) => {
    const problems = trackPageProblems(page);
    const requests = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await openSimulation(page);
    await page.waitForFunction(() => window.__BH__.frameCount >= 4);

    expect(await page.evaluate(() => window.__BH__.planetSurface)).toBe('idle');
    expect(requests.filter((path) => PLANET_MAP.test(path))).toEqual([]);
    expect(problems).toEqual([]);
});

test('the planet fetches its map of Jupiter when it is first drawn', async ({ page }) => {
    const problems = trackPageProblems(page);
    const mapResponse = page.waitForResponse(
        (response) => PLANET_MAP.test(new URL(response.url()).pathname),
        { timeout: 300_000 },
    );
    await page.goto('./?quality=medium&e2e=1');
    await page.waitForFunction(() => window.__BH__ !== undefined);
    await page.evaluate(() => window.__BH__.ready);

    const response = await mapResponse;
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/webp');
    await page.waitForFunction(() => window.__BH__.planetSurface === 'ready', null, {
        timeout: 60_000,
    });
    // The next frame samples the map.
    const drawn = await page.evaluate(() => window.__BH__.frameCount);
    await page.waitForFunction((count) => window.__BH__.frameCount > count, drawn, {
        timeout: 300_000,
    });
    expect(problems).toEqual([]);
});
