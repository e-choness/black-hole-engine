import { isVideoRequest } from '../src/features/pwa/cache-rules.js';
import { SITE } from './site-metadata.js';

// Installable app and offline support through vite-plugin-pwa (generateSW). The service worker
// precaches the app shell (HTML, JS, CSS, fonts, the manifest and its icons) and never caches
// video. src/features/pwa/register.js registers it.

// Rendered from public/icons/black-hole.svg by scripts/render-pwa-icons.js. Maskable icons keep
// the artwork inside the central circle of 80 % diameter that every launcher mask leaves visible.
export const MANIFEST_ICONS = Object.freeze([
    { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]);

// The Workbox modules that workbox-build bundles into sw.js and workbox-[hash].js for the options
// below. They never pass through Vite's module graph, so the legal notice lists them explicitly
// (config/legal-notice.js).
export const SERVICE_WORKER_PACKAGES = Object.freeze([
    'workbox-core',
    'workbox-precaching',
    'workbox-routing',
    'workbox-strategies',
]);

// Linked from index.html; iOS prefers it to the manifest icons and rounds its corners itself.
export const APPLE_TOUCH_ICON = Object.freeze({
    src: 'icons/apple-touch-icon.png',
    sizes: '180x180',
    type: 'image/png',
});

export const pwaOptions = {
    // A new version waits for the user's consent (see pwa-controller.js) instead of reloading
    // the page under a running simulation or recording.
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['icons/black-hole.svg', APPLE_TOUCH_ICON.src],
    manifest: {
        id: './',
        name: SITE.name,
        short_name: SITE.shortName,
        description: SITE.description,
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: SITE.backgroundColor,
        theme_color: SITE.themeColor,
        categories: ['education'],
        icons: MANIFEST_ICONS.map((icon) => ({ ...icon })),
        // Desktop Chrome shows wide screenshots in its install dialog.
        screenshots: [
            {
                src: SITE.previewImage.path,
                sizes: `${SITE.previewImage.width}x${SITE.previewImage.height}`,
                type: SITE.previewImage.type,
                form_factor: 'wide',
                label: SITE.previewImage.alt,
            },
        ],
    },
    workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        globIgnores: ['**/node_modules/**/*', 'docs/**'],
        // Navigations are answered from the precache only for the page itself: every query
        // parameter (?quality=, ?e2e=) is ignored when matching, and index.html also answers the
        // directory URL. A navigation fallback would serve the app for any other page in scope,
        // such as docs/LEGAL.md.
        navigateFallback: null,
        ignoreURLParametersMatching: [/./],
        directoryIndex: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [{ urlPattern: isVideoRequest, handler: 'NetworkOnly' }],
    },
};
