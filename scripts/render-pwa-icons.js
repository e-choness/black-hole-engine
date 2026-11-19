import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { APPLE_TOUCH_ICON, MANIFEST_ICONS } from '../config/pwa.js';
import { SITE } from '../config/site-metadata.js';

// Renders the PNG icons of config/pwa.js from public/icons/black-hole.svg with headless Chromium:
//   docker compose run --rm e2e node scripts/render-pwa-icons.js
// The artwork is about 1.82:1, so it is centred on a square plate in the theme colour:
//   any       plate with rounded, transparent corners;
//   maskable  full-bleed plate, artwork inside the central circle of 80 % diameter that launcher
//             masks keep: at 66 % width its half-diagonal is 0.377 of the size, below 0.4;
//   apple     full-bleed plate; iOS rounds the corners itself.

const PUBLIC_DIR = new URL('../public/', import.meta.url);

const LAYOUTS = {
    any: { artWidth: 0.82, cornerRadius: 0.22 },
    maskable: { artWidth: 0.66, cornerRadius: 0 },
    apple: { artWidth: 0.76, cornerRadius: 0 },
};

function iconPage(svg, size, { artWidth, cornerRadius }) {
    const source = `data:image/svg+xml;base64,${svg.toString('base64')}`;
    return `<!doctype html>
<html>
    <head>
        <style>
            html, body { margin: 0; background: transparent; }
            .plate {
                width: ${size}px;
                height: ${size}px;
                display: grid;
                place-items: center;
                border-radius: ${cornerRadius * size}px;
                background: ${SITE.backgroundColor};
            }
            img { display: block; width: ${artWidth * size}px; height: auto; }
        </style>
    </head>
    <body><div class="plate"><img src="${source}" alt="" /></div></body>
</html>`;
}

const svg = await readFile(new URL('icons/black-hole.svg', PUBLIC_DIR));
const targets = [
    ...MANIFEST_ICONS.map((icon) => ({ ...icon, layout: LAYOUTS[icon.purpose] })),
    { ...APPLE_TOUCH_ICON, layout: LAYOUTS.apple },
];

const browser = await chromium.launch();
try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const target of targets) {
        const size = Number(target.sizes.split('x')[0]);
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(iconPage(svg, size, target.layout));
        await page.locator('img').evaluate((image) => image.decode());
        const path = fileURLToPath(new URL(target.src, PUBLIC_DIR));
        await page.screenshot({ path, omitBackground: true });
        console.log(`${target.src} (${target.sizes})`);
    }
} finally {
    await browser.close();
}
