import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { SITE } from '../config/site-metadata.js';

// Renders the link-preview image (public/og-image.jpg) from a production build with headless
// Chromium and software WebGL:
//   docker compose run --rm e2e node scripts/render-og-image.js
// The 'high' preset and the frozen e2e clock give the same frame on every run.

const PORT = 4174;
const JPEG_QUALITY = 0.88;
const { path, width, height } = SITE.previewImage;
const OUTPUT = new URL(`../public/${path}`, import.meta.url);

// Copies the WebGL canvas in an animation frame queued after the render loop's, while the drawing
// buffer of that frame is still intact.
function captureCanvas({ width, height, quality }) {
    return new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => {
            const source = globalThis.document.getElementById('bh-canvas');
            const target = globalThis.document.createElement('canvas');
            target.width = width;
            target.height = height;
            const context = target.getContext('2d');
            context.imageSmoothingQuality = 'high';
            context.drawImage(source, 0, 0, width, height);
            resolve(target.toDataURL('image/jpeg', quality));
        });
    });
}

await build({ logLevel: 'warn' });
const server = await preview({
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: PORT, strictPort: true },
});
const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') problems.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${PORT}/?quality=high&e2e=1`);
    await page.waitForFunction(() => globalThis.__BH__ !== undefined);
    await page.evaluate(() => globalThis.__BH__.ready);
    const frame = await page.evaluate(() => globalThis.__BH__.frameCount);
    await page.waitForFunction((target) => globalThis.__BH__.frameCount >= target, frame + 2, {
        timeout: 600_000,
    });
    const dataUrl = await page.evaluate(captureCanvas, { width, height, quality: JPEG_QUALITY });
    if (problems.length > 0) throw new Error(`the page reported errors: ${problems.join('; ')}`);
    const jpeg = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    await writeFile(OUTPUT, jpeg);
    console.log(
        `${fileURLToPath(OUTPUT)}: ${width}x${height}, ${Math.round(jpeg.length / 1024)} KiB`,
    );
} finally {
    await browser.close();
    await server.close();
}
