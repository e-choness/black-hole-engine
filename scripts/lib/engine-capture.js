import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

// Renders views of a production build with headless Chromium and software WebGL 2, for the scripts
// that make images of the simulation (render-readme-media.js, render-itch-media.js). Every scene is
// a view link (src/features/share), so the live demo opens the same view, and the frozen e2e clock
// makes every run draw the same frame.

// Copies the canvas in an animation frame queued after the render loop's, while the drawing buffer
// of that frame is still intact. A converged view without moving parts stops drawing and its canvas
// is cleared once presented, so the capture asks for one more accumulated frame.
function grabFrame() {
    globalThis.__BH__.params.accumulation.max_frames += 1;
    return new Promise((resolve, reject) => {
        globalThis.requestAnimationFrame(() => {
            try {
                const canvas = globalThis.document.getElementById('bh-canvas');
                resolve(canvas.toDataURL('image/png'));
            } catch (error) {
                reject(error);
            }
        });
    });
}

// Builds the site, serves it on `port` and starts the browser. render() opens one view at
// width x height CSS pixels, waits for `frames` accumulated frames and passes the frame as a PNG
// data URL to `compose`, a function evaluated in the page with { ...args, frame, width, height }
// that returns the finished image as a data URL. It resolves to that image's bytes.
export async function openCaptureSession({ port }) {
    await build({ logLevel: 'warn' });
    const server = await preview({
        logLevel: 'warn',
        preview: { host: '127.0.0.1', port, strictPort: true },
    });
    let browser;
    try {
        browser = await chromium.launch({
            args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        });
    } catch (error) {
        await server.close();
        throw error;
    }

    async function render({ view, quality, width, height, frames, compose, args = {} }) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        const problems = [];
        page.on('pageerror', (error) => problems.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') problems.push(message.text());
        });
        try {
            await page.goto(
                `http://127.0.0.1:${port}/?quality=${quality}&e2e=1&backend=webgl#${view}`,
            );
            await page.waitForFunction(() => globalThis.__BH__ !== undefined);
            await page.evaluate(() => globalThis.__BH__.ready);
            await page.waitForFunction(() => globalThis.__BH__.planetSurface !== 'loading');
            await page.evaluate((count) => {
                globalThis.__BH__.params.accumulation.max_frames = count;
            }, frames);
            await page.waitForFunction(
                (count) => globalThis.__BH__.accumulatedFrames >= count,
                frames,
                { timeout: 3_600_000, polling: 500 },
            );
            const frame = await page.evaluate(grabFrame);
            const dataUrl = await page.evaluate(compose, { ...args, frame, width, height });
            if (problems.length > 0) {
                throw new Error(`the page reported errors: ${problems.join('; ')}`);
            }
            return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        } finally {
            await page.close();
        }
    }

    async function close() {
        await browser.close();
        await server.close();
    }

    return { render, close };
}
