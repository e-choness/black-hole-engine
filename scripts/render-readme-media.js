import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { resolveSiteUrl, SITE } from '../config/site-metadata.js';

// Renders the README banner and gallery from a production build with headless Chromium and
// software WebGL 2, and rewrites the gallery block of README.md so its captions and live links
// match the images:
//   docker compose run --rm e2e node scripts/render-readme-media.js [--draft] [name ...]
// Names limit the run to those images; the README block is rewritten only by a full run.
// --draft renders at half size with fewer accumulated frames into .cache/readme-draft/.
// --readme only rewrites the README block, for example after a caption changed.
// Every scene is a view link (src/features/share), so the live demo opens the same view; the
// frozen e2e clock makes every run draw the same frame.

const PORT = 4175;
const README = new URL('../README.md', import.meta.url);
const MEDIA_DIR = '.github/readme';
const GALLERY_START = '<!-- gallery:start (scripts/render-readme-media.js) -->';
const GALLERY_END = '<!-- gallery:end -->';

// GitHub Pages address of the repository, unless BH_SITE_URL names another deployment.
function liveUrl() {
    const configured = resolveSiteUrl(process.env.BH_SITE_URL);
    if (configured) return configured;
    const [, owner, repo] = new URL(SITE.repository).pathname.split('/');
    return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

const BANNER = {
    name: 'banner',
    width: 1800,
    height: 640,
    quality: 'high',
    frames: 16,
    view: 'v=3&ca=12,-5,0&cp=-0.2,0.015&od=13&ne=0',
    alt: 'Black Hole Engine: a ray-traced black hole whose accretion disk is bent over and under its shadow by gravitational lensing',
    title: 'Black Hole Engine',
    tagline: 'Real-time general-relativistic ray tracing in the browser',
    tags: ['WebGPU', 'WebGL 2', 'three.js TSL', 'Kerr geodesics'],
};

const GALLERY = [
    {
        name: 'thin-disk',
        caption: 'Novikov–Thorne thin disk with turbulent arcs, a/M = 0.9',
        view: 'v=3&ca=0,-4,0&od=11',
    },
    {
        name: 'galaxy',
        caption: 'Inside the disk of the lensed procedural galaxy',
        view: 'v=3&ca=0,-6,0&od=16&kv=disk&kd=0.62&ki=88&kp=25&ko=75&ka=5',
    },
    {
        name: 'torus',
        caption: 'Thick ADAF torus with relativistic jets',
        view: 'v=3&ca=0,-14,0&od=14&dm=torus&je=1&jm=phys',
    },
    {
        name: 'scientific',
        caption: 'False-colour luminance with the Scientific tone mapper',
        view: 'v=3&ca=0,-28,0&od=13&lt=sci',
    },
    {
        name: 'face-on',
        caption: 'The thin disk from high above',
        view: 'v=3&ca=0,-62,0&od=15',
    },
    {
        name: 'kerr-shadow',
        caption: 'Shadow of a near-extremal Kerr hole on a coordinate grid',
        view: 'v=3&ca=0,-1,0&od=10&bs=0.998&de=0&ne=0&km=grid',
    },
].map((scene) => ({
    width: 960,
    height: 540,
    quality: 'high',
    frames: 16,
    alt: scene.caption,
    ...scene,
}));

// Copies the canvas in an animation frame queued after the render loop's, while the drawing buffer
// of that frame is still intact, and draws the banner's title over it. A converged view without
// moving parts stops drawing and its canvas is cleared once presented, so the capture asks for one
// more accumulated frame.
function captureCanvas({ width, height, jpegQuality, text }) {
    globalThis.__BH__.params.accumulation.max_frames += 1;
    return new Promise((resolve, reject) => {
        globalThis.requestAnimationFrame(async () => {
            try {
                const source = globalThis.document.getElementById('bh-canvas');
                const target = globalThis.document.createElement('canvas');
                target.width = width;
                target.height = height;
                const context = target.getContext('2d');
                context.imageSmoothingQuality = 'high';
                context.drawImage(source, 0, 0, width, height);
                if (text) {
                    const unit = height / 640;
                    const fonts = {
                        title: `600 ${Math.round(88 * unit)}px "Space Grotesk Variable"`,
                        tagline: `400 ${Math.round(30 * unit)}px "Inter Variable"`,
                        tag: `500 ${Math.round(19 * unit)}px "JetBrains Mono Variable"`,
                    };
                    await Promise.all(
                        Object.values(fonts).map((font) => globalThis.document.fonts.load(font)),
                    );
                    // A dark scrim on the left keeps the text legible over the sky.
                    const scrim = context.createLinearGradient(0, 0, width * 0.62, 0);
                    scrim.addColorStop(0, 'rgba(5, 6, 10, 0.82)');
                    scrim.addColorStop(0.55, 'rgba(5, 6, 10, 0.45)');
                    scrim.addColorStop(1, 'rgba(5, 6, 10, 0)');
                    context.fillStyle = scrim;
                    context.fillRect(0, 0, width, height);

                    const left = Math.round(96 * unit);
                    context.textBaseline = 'alphabetic';
                    context.shadowColor = 'rgba(0, 0, 0, 0.6)';
                    context.shadowBlur = 24 * unit;
                    context.fillStyle = '#ffffff';
                    context.font = fonts.title;
                    context.letterSpacing = `${-1.5 * unit}px`;
                    const words = text.title.split(' ');
                    const split = Math.ceil(words.length / 2);
                    const lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
                    context.fillText(lines[0], left, 268 * unit);
                    context.fillText(lines[1], left, 360 * unit);

                    context.font = fonts.tagline;
                    context.letterSpacing = '0px';
                    context.fillStyle = 'rgba(236, 239, 247, 0.86)';
                    context.fillText(text.tagline, left, 428 * unit);

                    context.shadowBlur = 0;
                    context.font = fonts.tag;
                    context.letterSpacing = `${1 * unit}px`;
                    let x = left;
                    const top = 470 * unit;
                    const padX = 14 * unit;
                    const tagHeight = 38 * unit;
                    for (const tag of text.tags) {
                        const label = tag.toUpperCase();
                        const tagWidth = context.measureText(label).width + 2 * padX;
                        context.beginPath();
                        context.roundRect(x, top, tagWidth, tagHeight, tagHeight / 2);
                        context.fillStyle = 'rgba(255, 180, 77, 0.12)';
                        context.fill();
                        context.lineWidth = Math.max(1, 1.5 * unit);
                        context.strokeStyle = 'rgba(255, 180, 77, 0.55)';
                        context.stroke();
                        context.fillStyle = '#ffd59a';
                        context.fillText(label, x + padX, top + tagHeight * 0.66);
                        x += tagWidth + 12 * unit;
                    }
                }
                resolve(target.toDataURL('image/jpeg', jpegQuality));
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function render(browser, scene, { draft, outDir }) {
    const scale = draft ? 0.5 : 1;
    const width = Math.round(scene.width * scale);
    const height = Math.round(scene.height * scale);
    const frames = draft ? Math.min(6, scene.frames) : scene.frames;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') problems.push(message.text());
    });
    const started = Date.now();
    try {
        await page.goto(
            `http://127.0.0.1:${PORT}/?quality=${scene.quality}&e2e=1&backend=webgl#${scene.view}`,
        );
        await page.waitForFunction(() => globalThis.__BH__ !== undefined);
        await page.evaluate(() => globalThis.__BH__.ready);
        await page.evaluate((count) => {
            globalThis.__BH__.params.accumulation.max_frames = count;
        }, frames);
        await page.waitForFunction(
            (count) => globalThis.__BH__.accumulatedFrames >= count,
            frames,
            {
                timeout: 1_800_000,
                polling: 500,
            },
        );
        const text = scene.title
            ? { title: scene.title, tagline: scene.tagline, tags: scene.tags }
            : null;
        const dataUrl = await page.evaluate(captureCanvas, {
            width,
            height,
            jpegQuality: scene === BANNER ? 0.9 : 0.86,
            text,
        });
        if (problems.length > 0)
            throw new Error(`the page reported errors: ${problems.join('; ')}`);
        const jpeg = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        const output = new URL(`../${outDir}/${scene.name}.jpg`, import.meta.url);
        await writeFile(output, jpeg);
        const seconds = Math.round((Date.now() - started) / 1000);
        console.log(
            `${fileURLToPath(output)}: ${width}x${height}, ${Math.round(jpeg.length / 1024)} KiB, ${seconds} s`,
        );
    } finally {
        await page.close();
    }
}

function escapeHtml(text) {
    return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function galleryMarkdown(base) {
    const cell = (scene) => {
        const href = escapeHtml(`${base}#${scene.view}`);
        const alt = escapeHtml(scene.alt);
        return [
            `    <td width="50%" valign="top">`,
            `      <a href="${href}"><img src="${MEDIA_DIR}/${scene.name}.jpg" alt="${alt}" width="100%"></a>`,
            `      <br><sub>${escapeHtml(scene.caption)} · <a href="${href}">open live</a></sub>`,
            `    </td>`,
        ].join('\n');
    };
    const rows = [];
    for (let index = 0; index < GALLERY.length; index += 2) {
        const cells = GALLERY.slice(index, index + 2).map(cell);
        rows.push(['  <tr>', ...cells, '  </tr>'].join('\n'));
    }
    return ['<table>', ...rows, '</table>'].join('\n');
}

async function updateReadme() {
    const readme = await readFile(README, 'utf8');
    const start = readme.indexOf(GALLERY_START);
    const end = readme.indexOf(GALLERY_END);
    if (start < 0 || end < start) throw new Error('README.md has no gallery block');
    const block = `${GALLERY_START}\n\n${galleryMarkdown(liveUrl())}\n\n`;
    const next = readme.slice(0, start) + block + readme.slice(end);
    if (next !== readme) await writeFile(README, next);
    console.log(`${fileURLToPath(README)}: gallery ${next === readme ? 'unchanged' : 'updated'}`);
}

const args = process.argv.slice(2);
const draft = args.includes('--draft');
const names = args.filter((arg) => !arg.startsWith('--'));
const scenes = [BANNER, ...GALLERY];
const unknown = names.filter((name) => !scenes.some((scene) => scene.name === name));
if (unknown.length > 0) throw new Error(`unknown image: ${unknown.join(', ')}`);
if (args.includes('--readme')) {
    await updateReadme();
    process.exit(0);
}
const selected = names.length > 0 ? scenes.filter((scene) => names.includes(scene.name)) : scenes;
const outDir = draft ? '.cache/readme-draft' : MEDIA_DIR;
await mkdir(new URL(`../${outDir}/`, import.meta.url), { recursive: true });

await build({ logLevel: 'warn' });
const server = await preview({
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: PORT, strictPort: true },
});
const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
    for (const scene of selected) await render(browser, scene, { draft, outDir });
    if (!draft && names.length === 0) await updateReadme();
} finally {
    await browser.close();
    await server.close();
}
