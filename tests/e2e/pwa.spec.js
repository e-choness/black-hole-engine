import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

const PWA_EVENTS = ['bh:pwa-offline-ready', 'bh:pwa-update-ready', 'bh:pwa-error'];
// The sky is generated on the GPU, so the planet map is the only texture the app loads.
const TEXTURES = ['beach-ball.png'];

// Records the controller's DOM events from the first script on, so none can be missed.
function recordPwaEvents(page) {
    return page.addInitScript((types) => {
        window.__pwaEvents = [];
        for (const type of types) {
            window.addEventListener(type, () => window.__pwaEvents.push(type));
        }
    }, PWA_EVENTS);
}

// Path names (without query) of every entry, by cache name.
function readCaches() {
    return caches.keys().then(async (names) => {
        const contents = {};
        for (const name of names) {
            const requests = await (await caches.open(name)).keys();
            contents[name] = requests.map((request) => new URL(request.url).pathname);
        }
        return contents;
    });
}

// Fetches and decodes an image in the page. `outside` counts the pixels outside the central
// circle of 80 % diameter that differ from the plain background: launchers may cut that ring
// away from maskable icons.
function inspectImage({ url, background }) {
    return fetch(url).then(async (response) => {
        const bitmap = await createImageBitmap(await response.blob());
        const { width, height } = bitmap;
        const context = new OffscreenCanvas(width, height).getContext('2d');
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, width, height);
        let outside = 0;
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const radius = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
                if (radius <= 0.4 * Math.min(width, height)) continue;
                const i = 4 * (y * width + x);
                const distance = background.reduce(
                    (sum, value, c) => sum + Math.abs(data[i + c] - value),
                    0,
                );
                if (data[i + 3] !== 255 || distance > 6) outside += 1;
            }
        }
        const type = response.headers.get('content-type');
        return { status: response.status, type, width, height, outside };
    });
}

const BACKGROUND = [5, 6, 10];

test('serves the manifest, its icons and the link-preview image', async ({ page }) => {
    const problems = trackPageProblems(page);
    await page.goto('./?quality=mobile&e2e=1');

    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#05060a');
    const manifestUrl = await page.locator('link[rel="manifest"]').evaluate((link) => link.href);
    const manifest = await page.evaluate((url) => fetch(url).then((r) => r.json()), manifestUrl);
    expect(manifest).toMatchObject({
        name: 'Black Hole Simulation',
        short_name: 'Black Hole',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#05060a',
        background_color: '#05060a',
    });

    const inspect = (url) => page.evaluate(inspectImage, { url, background: BACKGROUND });
    for (const icon of manifest.icons) {
        const image = await inspect(new URL(icon.src, manifestUrl).href);
        expect(image.status, icon.src).toBe(200);
        expect(image.type, icon.src).toBe('image/png');
        expect(`${image.width}x${image.height}`, icon.src).toBe(icon.sizes);
        if (icon.purpose === 'maskable') {
            expect(image.outside, `${icon.src}: artwork outside the safe zone`).toBe(0);
        }
    }

    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').evaluate((l) => l.href);
    expect(await inspect(appleIcon)).toMatchObject({ status: 200, width: 180, height: 180 });

    const previewUrl = await page
        .locator('meta[property="og:image"]')
        .evaluate((meta) => new URL(meta.content, document.baseURI).href);
    expect(await inspect(previewUrl)).toMatchObject({
        status: 200,
        type: 'image/jpeg',
        width: 1200,
        height: 630,
    });
    expect(problems).toEqual([]);
});

test('precaches the app shell, caches textures and starts offline', async ({ page, context }) => {
    const problems = trackPageProblems(page);
    await recordPwaEvents(page);
    await openSimulation(page);
    await page.waitForFunction(() => window.__pwaEvents.includes('bh:pwa-offline-ready'));
    expect(await page.evaluate(() => window.__pwaEvents)).toEqual(['bh:pwa-offline-ready']);

    const contents = await page.evaluate(readCaches);
    const precacheName = Object.keys(contents).find((name) => name.includes('precache'));
    const precache = contents[precacheName];
    for (const path of ['/index.html', '/manifest.webmanifest', '/icons/maskable-512.png']) {
        expect(precache, path).toContain(path);
    }
    expect(precache.some((path) => /^\/assets\/three-.*\.js$/.test(path))).toBe(true);
    expect(precache.filter((path) => /textures|og-image|\.map$|\.(mp4|webm)$/.test(path))).toEqual(
        [],
    );
    expect(contents['bh-textures'].sort()).toEqual(
        TEXTURES.map((file) => `/textures/${file}`).sort(),
    );

    // The next visit is served by the worker, also when offline.
    const response = await page.reload();
    expect(response.fromServiceWorker()).toBe(true);
    await page.evaluate(() => window.__BH__.ready);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    expect(problems).toEqual([]);

    await context.setOffline(true);
    const offlineResponse = await page.reload();
    expect(offlineResponse.fromServiceWorker()).toBe(true);
    await page.waitForFunction(() => window.__BH__ !== undefined);
    await page.evaluate(() => window.__BH__.ready);
    await page.waitForFunction(() => window.__BH__.frameCount >= 2);
    const missing = await page.evaluate(() =>
        fetch('./textures/not-cached.png').then(
            (r) => `HTTP ${r.status}`,
            () => 'failed',
        ),
    );
    expect(missing, 'requests the caches cannot answer really go offline').toBe('failed');
    await context.setOffline(false);
});

test('never caches video', async ({ page }) => {
    await recordPwaEvents(page);
    await openSimulation(page);
    await page.waitForFunction(() => window.__pwaEvents.includes('bh:pwa-offline-ready'));
    await page.reload();
    await page.evaluate(() => window.__BH__.ready);

    await page.evaluate(async () => {
        await fetch('./clip.mp4');
        await fetch('./textures/clip.webm');
        const video = document.createElement('video');
        const settled = new Promise((resolve) => {
            video.addEventListener('error', resolve, { once: true });
            video.addEventListener('loadeddata', resolve, { once: true });
        });
        video.src = './intro.webm';
        await settled;
    });
    const contents = await page.evaluate(readCaches);
    const cached = Object.values(contents).flat();
    expect(cached.filter((path) => /\.(mp4|webm)$/.test(path))).toEqual([]);
    expect(cached.length).toBeGreaterThan(0);
});
