import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { APPLE_TOUCH_ICON, MANIFEST_ICONS } from '../config/pwa.js';
import { SITE } from '../config/site-metadata.js';

// Renders the PNG icons of config/pwa.js from public/icons/black-hole.svg with headless Chromium:
//   docker compose run --rm e2e node scripts/render-pwa-icons.js
// The SVG is a square plate with rounded corners; its artwork stays inside the central circle of
// 80 % diameter, with only the plain theme colour around it, so every icon shows it at full size:
//   any       as drawn, with transparent corners;
//   maskable  on a full-bleed plate in the theme colour, which fills the corners for the mask;
//   apple     the same; iOS rounds the corners itself.

const PUBLIC_DIR = new URL('../public/', import.meta.url);

const FULL_BLEED = { any: false, maskable: true, apple: true };

function iconPage(svg, size, fullBleed) {
    const source = `data:image/svg+xml;base64,${svg.toString('base64')}`;
    return `<!doctype html>
<html>
    <head>
        <style>
            html, body { margin: 0; background: transparent; }
            .plate {
                width: ${size}px;
                height: ${size}px;
                background: ${fullBleed ? SITE.backgroundColor : 'transparent'};
            }
            img { display: block; width: ${size}px; height: ${size}px; }
        </style>
    </head>
    <body><div class="plate"><img src="${source}" alt="" /></div></body>
</html>`;
}

const svg = await readFile(new URL('icons/black-hole.svg', PUBLIC_DIR));
const targets = [
    ...MANIFEST_ICONS.map((icon) => ({ ...icon, fullBleed: FULL_BLEED[icon.purpose] })),
    { ...APPLE_TOUCH_ICON, fullBleed: FULL_BLEED.apple },
];

const browser = await chromium.launch();
try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const target of targets) {
        const size = Number(target.sizes.split('x')[0]);
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(iconPage(svg, size, target.fullBleed));
        await page.locator('img').evaluate((image) => image.decode());
        const path = fileURLToPath(new URL(target.src, PUBLIC_DIR));
        await page.screenshot({ path, omitBackground: true });
        console.log(`${target.src} (${target.sizes})`);
    }
} finally {
    await browser.close();
}
