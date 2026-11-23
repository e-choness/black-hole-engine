import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SITE } from '../config/site-metadata.js';
import { openCaptureSession } from './lib/engine-capture.js';

// Renders the art of the itch.io page from a production build (see lib/engine-capture.js):
//   docker compose run --rm e2e node scripts/render-itch-media.js [--draft] [name ...]
// Names limit the run to those images. --draft renders at half size with fewer accumulated frames
// into .cache/itch-draft/.
// The banner replaces the title at the top of the page's column, 960 px wide, and fades out into
// the column at its sides and bottom. The background is meant to sit unscaled and centred at the
// top of the page behind that column; it fades into the page colour (SITE.backgroundColor) at its
// edges, so screens wider than it show no seam.

const PORT = 4176;
const MEDIA_DIR = '.github/itch';
const PAGE_COLOR = SITE.backgroundColor;

const SCENES = [
    {
        name: 'background',
        type: 'image/jpeg',
        width: 2560,
        height: 1440,
        quality: 'high',
        frames: 16,
        view: 'v=4&ca=0,-2,-12&od=8.5&ne=0&lw=0.4',
    },
    {
        name: 'banner',
        type: 'image/png',
        width: 960,
        height: 280,
        quality: 'high',
        frames: 16,
        view: 'v=4&ca=0,-4,-7&cp=-0.38,0.03&od=20&ne=0',
        title: 'Black Hole Engine',
        tagline: 'A ray-traced black hole in your browser, in real time',
        tags: 'WebGPU · WebGL 2 · Kerr geodesics',
    },
];

// Evaluated in the page: draws the frame, fades its edges and, for the banner, writes the title.
async function compose({ frame, width, height, type, pageColor, text }) {
    const image = new globalThis.Image();
    image.src = frame;
    await image.decode();
    const target = globalThis.document.createElement('canvas');
    target.width = width;
    target.height = height;
    const context = target.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);

    // Gradients of the page colour that fade an opaque image into it; an image with alpha fades
    // into transparency instead, as destination-out removes as much as each gradient is opaque.
    const [red, green, blue] = [1, 3, 5].map((i) => parseInt(pageColor.slice(i, i + 2), 16));
    const fade = (x0, y0, x1, y1, stops) => {
        const gradient = context.createLinearGradient(x0, y0, x1, y1);
        for (const [offset, alpha] of stops) {
            gradient.addColorStop(offset, `rgba(${red}, ${green}, ${blue}, ${alpha})`);
        }
        return gradient;
    };
    const edges = text ? { side: 0.06, bottom: 0.22 } : { side: 0.1, bottom: 0.45 };
    const gradients = [
        fade(0, 0, width, 0, [
            [0, 1],
            [edges.side, 0],
            [1 - edges.side, 0],
            [1, 1],
        ]),
        fade(0, 0, 0, height, [
            [0, 0],
            [1 - edges.bottom, 0],
            [1, 1],
        ]),
    ];
    if (type === 'image/png') context.globalCompositeOperation = 'destination-out';
    for (const gradient of gradients) {
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
    }
    context.globalCompositeOperation = 'source-over';

    if (text) {
        const unit = height / 280;
        const fonts = {
            title: `600 ${Math.round(54 * unit)}px "Space Grotesk Variable"`,
            tagline: `400 ${Math.round(19 * unit)}px "Inter Variable"`,
            tags: `500 ${Math.round(13 * unit)}px "JetBrains Mono Variable"`,
        };
        await Promise.all(Object.values(fonts).map((font) => globalThis.document.fonts.load(font)));
        // A dark scrim on the left keeps the text legible over the disk and the sky.
        const scrim = context.createLinearGradient(0, 0, width * 0.6, 0);
        scrim.addColorStop(0, 'rgba(5, 6, 10, 0.78)');
        scrim.addColorStop(0.6, 'rgba(5, 6, 10, 0.4)');
        scrim.addColorStop(1, 'rgba(5, 6, 10, 0)');
        context.fillStyle = scrim;
        context.fillRect(0, 0, width, height);

        const left = Math.round(56 * unit);
        context.textBaseline = 'alphabetic';
        context.shadowColor = 'rgba(0, 0, 0, 0.65)';
        context.shadowBlur = 18 * unit;
        context.fillStyle = '#ffffff';
        context.font = fonts.title;
        context.letterSpacing = `${-1 * unit}px`;
        context.fillText(text.title, left, 128 * unit);

        context.font = fonts.tagline;
        context.letterSpacing = '0px';
        context.fillStyle = 'rgba(233, 236, 242, 0.88)';
        context.fillText(text.tagline, left, 164 * unit);

        context.shadowBlur = 8 * unit;
        context.font = fonts.tags;
        context.letterSpacing = `${1.2 * unit}px`;
        context.fillStyle = '#ffb44d';
        context.fillText(text.tags.toUpperCase(), left, 200 * unit);
    }
    return target.toDataURL(type, 0.9);
}

async function render(session, scene, { draft, outDir }) {
    const scale = draft ? 0.5 : 1;
    const width = Math.round(scene.width * scale);
    const height = Math.round(scene.height * scale);
    const started = Date.now();
    const text = scene.title
        ? { title: scene.title, tagline: scene.tagline, tags: scene.tags }
        : null;
    const bytes = await session.render({
        view: scene.view,
        quality: scene.quality,
        width,
        height,
        frames: draft ? Math.min(6, scene.frames) : scene.frames,
        compose,
        args: { type: scene.type, pageColor: PAGE_COLOR, text },
    });
    const extension = scene.type === 'image/png' ? 'png' : 'jpg';
    const output = new URL(`../${outDir}/${scene.name}.${extension}`, import.meta.url);
    await writeFile(output, bytes);
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
        `${fileURLToPath(output)}: ${width}x${height}, ${Math.round(bytes.length / 1024)} KiB, ${seconds} s`,
    );
}

const args = process.argv.slice(2);
const draft = args.includes('--draft');
const names = args.filter((arg) => !arg.startsWith('--'));
const unknown = names.filter((name) => !SCENES.some((scene) => scene.name === name));
if (unknown.length > 0) throw new Error(`unknown image: ${unknown.join(', ')}`);
const selected = names.length > 0 ? SCENES.filter((scene) => names.includes(scene.name)) : SCENES;
const outDir = draft ? '.cache/itch-draft' : MEDIA_DIR;
await mkdir(new URL(`../${outDir}/`, import.meta.url), { recursive: true });

const session = await openCaptureSession({ port: PORT });
try {
    for (const scene of selected) await render(session, scene, { draft, outDir });
} finally {
    await session.close();
}
