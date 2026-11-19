import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { APPLE_TOUCH_ICON, MANIFEST_ICONS, pwaOptions } from '../../config/pwa.js';
import {
    SITE,
    absolutizePreviewTags,
    resolveSiteUrl,
    sitePreviewPlugin,
} from '../../config/site-metadata.js';
import {
    TEXTURE_CACHE_NAME,
    isTextureRequest,
    isVideoRequest,
} from '../../src/features/pwa/cache-rules.js';

const ROOT = new URL('../../', import.meta.url);
const readPublic = (path) => readFileSync(new URL(`public/${path}`, ROOT));
const INDEX_HTML = readFileSync(new URL('index.html', ROOT), 'utf8');

function attributesOf(tag) {
    return Object.fromEntries([...tag.matchAll(/([^\s=/>]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}

function tagsOf(html, name) {
    return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => attributesOf(m[0]));
}

function metaContent(html, key) {
    const found = tagsOf(html, 'meta').filter((meta) => (meta.property ?? meta.name) === key);
    assert.ok(found.length <= 1, `one ${key} tag at most`);
    return found[0]?.content;
}

function pngHeader(bytes) {
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
    assert.equal(bytes.subarray(12, 16).toString('latin1'), 'IHDR');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] };
}

// Frame size from the first start-of-frame segment.
function jpegSize(bytes) {
    assert.equal(bytes.readUInt16BE(0), 0xffd8, 'JPEG start of image');
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb]);
    let offset = 2;
    while (offset < bytes.length) {
        assert.equal(bytes[offset], 0xff, 'JPEG marker');
        const marker = bytes[offset + 1];
        if (startOfFrame.has(marker)) {
            return {
                height: bytes.readUInt16BE(offset + 5),
                width: bytes.readUInt16BE(offset + 7),
            };
        }
        offset += 2 + bytes.readUInt16BE(offset + 2);
    }
    throw new Error('no start-of-frame segment');
}

const urlCases = [
    // [url, request destination, same origin, video?, texture?]
    ['https://a.test/app/textures/sky/1024/px.jpg', 'image', true, false, true],
    ['https://a.test/app/textures/beach-ball.png', 'image', true, false, true],
    ['https://a.test/textures/galaxy-8k.webp', 'image', true, false, true],
    ['https://cdn.test/textures/sky/512/nz.jpg', 'image', false, false, false],
    ['https://a.test/app/textures/clip.mp4', 'video', true, true, false],
    ['https://a.test/app/intro.WEBM', '', true, true, false],
    ['https://a.test/app/stream', 'video', true, true, false],
    ['https://a.test/app/textures/poster.png', 'video', true, true, true],
    ['https://a.test/app/assets/index-abc.js', 'script', true, false, false],
    ['https://a.test/app/og-image.jpg', 'image', true, false, false],
];

function routeContext([href, destination, sameOrigin]) {
    return { url: new URL(href), request: { destination }, sameOrigin };
}

test('the manifest describes the installed app with the shared site metadata', () => {
    const { manifest } = pwaOptions;
    assert.equal(pwaOptions.registerType, 'prompt');
    assert.equal(pwaOptions.injectRegister, false, 'src/features/pwa/register.js registers');
    assert.equal(manifest.name, SITE.name);
    assert.equal(manifest.short_name, SITE.shortName);
    assert.equal(manifest.description, SITE.description);
    assert.equal(manifest.theme_color, SITE.themeColor);
    assert.equal(manifest.background_color, SITE.backgroundColor);
    assert.deepEqual([manifest.id, manifest.start_url, manifest.scope], ['./', './', './']);
    assert.equal(manifest.display, 'standalone');
    assert.deepEqual(manifest.icons, MANIFEST_ICONS);
    for (const purpose of ['any', 'maskable']) {
        assert.ok(
            manifest.icons.some((icon) => icon.purpose === purpose && icon.sizes === '512x512'),
        );
    }
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'any' && icon.sizes === '192x192'));
});

test('every icon exists at its declared size; maskable and Apple icons are opaque', () => {
    for (const icon of [...MANIFEST_ICONS, APPLE_TOUCH_ICON]) {
        const { width, height, colorType } = pngHeader(readPublic(icon.src));
        assert.equal(`${width}x${height}`, icon.sizes, icon.src);
        assert.equal(icon.type, 'image/png');
        // Colour type 2 is RGB without alpha; 6 is RGBA, for the rounded corners of 'any' icons.
        assert.equal(colorType, icon.purpose === 'any' ? 6 : 2, icon.src);
    }
    for (const asset of pwaOptions.includeAssets) assert.ok(readPublic(asset).length > 0, asset);
});

test('the link-preview image matches its metadata and stays below 300 KB', () => {
    const { path, width, height, type, alt } = SITE.previewImage;
    const bytes = readPublic(path);
    assert.equal(type, 'image/jpeg');
    assert.deepEqual(jpegSize(bytes), { width, height });
    assert.ok(width / height > 1.9 && width / height < 1.91, 'the 1.91:1 large-card ratio');
    // WhatsApp shows no preview for larger images.
    assert.ok(bytes.length < 300 * 1024, `${bytes.length} bytes`);
    assert.deepEqual(pwaOptions.manifest.screenshots, [
        { src: path, sizes: `${width}x${height}`, type, form_factor: 'wide', label: alt },
    ]);
});

test('index.html repeats the site metadata in its head', () => {
    const { previewImage } = SITE;
    assert.equal(metaContent(INDEX_HTML, 'theme-color'), SITE.themeColor);
    assert.equal(/<title>([^<]*)<\/title>/.exec(INDEX_HTML)[1], SITE.name);
    assert.equal(metaContent(INDEX_HTML, 'og:title'), SITE.name);
    assert.equal(metaContent(INDEX_HTML, 'description'), SITE.description);
    assert.equal(metaContent(INDEX_HTML, 'og:description'), SITE.description);
    assert.equal(metaContent(INDEX_HTML, 'og:type'), 'website');
    assert.equal(metaContent(INDEX_HTML, 'og:image'), `/${previewImage.path}`);
    assert.equal(metaContent(INDEX_HTML, 'og:image:type'), previewImage.type);
    assert.equal(metaContent(INDEX_HTML, 'og:image:width'), String(previewImage.width));
    assert.equal(metaContent(INDEX_HTML, 'og:image:height'), String(previewImage.height));
    assert.equal(metaContent(INDEX_HTML, 'og:image:alt'), previewImage.alt);
    assert.equal(metaContent(INDEX_HTML, 'twitter:card'), 'summary_large_image');
    assert.equal(
        metaContent(INDEX_HTML, 'og:url'),
        undefined,
        'set at build time from BH_SITE_URL',
    );

    const links = tagsOf(INDEX_HTML, 'link');
    const appleIcon = links.find((link) => link.rel === 'apple-touch-icon');
    assert.equal(appleIcon?.href, `/${APPLE_TOUCH_ICON.src}`);
    assert.ok(links.some((link) => link.rel === 'icon' && link.href === '/icons/black-hole.svg'));
    const scripts = tagsOf(INDEX_HTML, 'script').map((script) => script.src);
    assert.ok(scripts.includes('/src/features/pwa/register.js'));
});

test('the precache holds the app shell but no textures, preview image, video or maps', () => {
    const { globPatterns, globIgnores } = pwaOptions.workbox;
    const precached = (file) =>
        globPatterns.some((pattern) => matchesGlob(file, pattern)) &&
        !globIgnores.some((pattern) => matchesGlob(file, pattern));
    for (const file of ['index.html', 'assets/index-a1.js', 'assets/three-b2.js', 'assets/x.css']) {
        assert.ok(precached(file), file);
    }
    for (const file of [
        'textures/sky/2048/px.jpg',
        'textures/beach-ball.png',
        'og-image.jpg',
        'assets/index-a1.js.map',
        'clip.mp4',
        'assets/intro-c3.webm',
        'docs/physics.html',
        'docs/LEGAL.md',
    ]) {
        assert.ok(!precached(file), file);
    }
});

test('navigations use the precache only for the page itself, whatever its query', () => {
    const { workbox } = pwaOptions;
    assert.equal(workbox.navigateFallback, null);
    assert.equal(workbox.directoryIndex, 'index.html');
    for (const name of ['quality', 'e2e', 'utm_source']) {
        assert.ok(workbox.ignoreURLParametersMatching.some((pattern) => pattern.test(name)));
    }
    assert.equal(workbox.cleanupOutdatedCaches, true);
});

test('video is never cached and comes first; textures use a revalidated runtime cache', () => {
    const [video, textures, ...rest] = pwaOptions.workbox.runtimeCaching;
    assert.deepEqual(rest, []);
    assert.equal(video.urlPattern, isVideoRequest);
    assert.equal(video.handler, 'NetworkOnly');
    assert.equal(video.options, undefined);
    assert.equal(textures.urlPattern, isTextureRequest);
    assert.equal(textures.handler, 'StaleWhileRevalidate');
    assert.equal(textures.options.cacheName, TEXTURE_CACHE_NAME);
    assert.deepEqual(textures.options.cacheableResponse, { statuses: [200] });
    assert.ok(textures.options.expiration.maxEntries >= 8);
    assert.ok(textures.options.expiration.maxAgeSeconds > 0);

    for (const testCase of urlCases) {
        const [href, , , isVideo, isTexture] = testCase;
        assert.equal(isVideoRequest(routeContext(testCase)), isVideo, `video: ${href}`);
        assert.equal(isTextureRequest(routeContext(testCase)), isTexture, `texture: ${href}`);
    }
});

test('the matchers still work when copied into sw.js as source text', () => {
    // workbox-build serializes runtimeCaching matchers with Function.prototype.toString().
    for (const { urlPattern } of pwaOptions.workbox.runtimeCaching) {
        const copy = new Function(`return (${urlPattern.toString()});`)();
        for (const testCase of urlCases) {
            assert.equal(copy(routeContext(testCase)), urlPattern(routeContext(testCase)));
        }
    }
});

test('BH_SITE_URL is validated and normalized', () => {
    for (const unset of [undefined, null, '', '  ']) assert.equal(resolveSiteUrl(unset), null);
    assert.equal(resolveSiteUrl('https://example.org'), 'https://example.org/');
    assert.equal(
        resolveSiteUrl(' https://example.github.io/black-hole '),
        'https://example.github.io/black-hole/',
    );
    assert.equal(resolveSiteUrl('http://localhost:8080/app/'), 'http://localhost:8080/app/');
    for (const bad of [
        'example.org',
        '/black-hole/',
        'ftp://example.org/',
        'https://user:secret@example.org/',
        'https://example.org/?ref=x',
        'https://example.org/#top',
    ]) {
        assert.throws(() => resolveSiteUrl(bad), /BH_SITE_URL/, bad);
    }
});

test('a site URL makes the preview tags absolute and adds og:url', () => {
    const site = 'https://example.org/black-hole/';
    const html = absolutizePreviewTags(INDEX_HTML, site);
    assert.equal(metaContent(html, 'og:image'), `${site}${SITE.previewImage.path}`);
    assert.equal(metaContent(html, 'og:url'), site);
    assert.match(
        html,
        /\n {8}<meta property="og:type" content="website" \/>\n {8}<meta property="og:url"/,
    );
    assert.equal(metaContent(html, 'og:image:width'), '1200', 'other tags are untouched');
    assert.equal(
        html.replace(/\n {8}<meta property="og:url"[^>]*>/, ''),
        INDEX_HTML.replace(
            `content="/${SITE.previewImage.path}"`,
            `content="${site}${SITE.previewImage.path}"`,
        ),
    );

    const other = [
        '<head>',
        '<meta property="og:url" content="https://old.example/" />',
        '<meta name="twitter:image" content="./card.png?v=1&amp;s=2" />',
        '<meta property="og:image" data-content="x" content="//cdn.example/og.jpg" />',
        '<meta property="og:image:secure_url" content="https://cdn.example/og.jpg" />',
        '</head>',
    ].join('\n');
    const rewritten = absolutizePreviewTags(other, 'https://example.org/a$1/');
    assert.equal(metaContent(rewritten, 'og:url'), 'https://example.org/a$1/');
    assert.equal(
        metaContent(rewritten, 'twitter:image'),
        'https://example.org/a$1/card.png?v=1&amp;s=2',
    );
    assert.equal(metaContent(rewritten, 'og:image'), 'https://cdn.example/og.jpg');
    assert.match(rewritten, /data-content="x"/);
    assert.equal(metaContent(rewritten, 'og:image:secure_url'), 'https://cdn.example/og.jpg');
    assert.equal(rewritten.match(/og:url/g).length, 1);

    const bare = absolutizePreviewTags('<head>\n</head>', site);
    assert.equal(bare, `<head>\n<meta property="og:url" content="${site}" />\n</head>`);
});

test('the preview plugin runs before Vite and only with a site URL', () => {
    const plugin = sitePreviewPlugin('https://example.org/');
    assert.equal(plugin.apply, 'build');
    assert.equal(plugin.transformIndexHtml.order, 'pre');
    assert.match(
        plugin.transformIndexHtml.handler(INDEX_HTML),
        /content="https:\/\/example\.org\/og-image\.jpg"/,
    );
    assert.equal(sitePreviewPlugin(null).transformIndexHtml.handler(INDEX_HTML), INDEX_HTML);
});
