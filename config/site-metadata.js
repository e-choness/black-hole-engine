// Name, description, colours and link-preview image of the site. The web app manifest
// (config/pwa.js) and the asset scripts in scripts/ read them from here; index.html repeats them
// in its <meta> tags, and tests/unit/pwa-config.test.js keeps both in step.

export const SITE = Object.freeze({
    name: 'Black Hole Simulation',
    shortName: 'Black Hole',
    description:
        'A browser-based black hole visualization with Schwarzschild lensing based on the exact Binet equation, approximate spin effects, accretion-flow models, presentation presets, and recording tools.',
    // Canvas colour of the interface design, used for the browser chrome and the splash screen
    // of the installed app.
    themeColor: '#05060a',
    backgroundColor: '#05060a',
    previewImage: Object.freeze({
        path: 'og-image.jpg',
        type: 'image/jpeg',
        width: 1200,
        height: 630,
        alt: 'A ray-traced black hole whose glowing accretion disk is bent around it by gravitational lensing',
    }),
});

// Link previews need absolute og:image and og:url values, but the build uses relative URLs
// (base './') so it works from any directory. BH_SITE_URL names the address the site is deployed
// at, e.g. https://example.github.io/black-hole/. Returns it normalized with a trailing slash, or
// null when unset.
export function resolveSiteUrl(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const text = String(value).trim();
    let url;
    try {
        url = new URL(text);
    } catch {
        throw new Error(`BH_SITE_URL must be an absolute URL, got "${text}"`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error(`BH_SITE_URL must be an http(s) URL without credentials, got "${text}"`);
    }
    if (url.search || url.hash) {
        throw new Error(`BH_SITE_URL must not have a query or fragment, got "${text}"`);
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
}

const URL_PROPERTIES = new Set([
    'og:image',
    'og:image:url',
    'og:image:secure_url',
    'twitter:image',
]);
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*"([^"]*)"/g;

function escapeAttribute(value) {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function unescapeAttribute(value) {
    return value.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

function metaAttributes(tag) {
    return Object.fromEntries([...tag.matchAll(ATTRIBUTE)].map(([, name, value]) => [name, value]));
}

function withContent(tag, value) {
    return tag.replace(/(\s)content="[^"]*"/, (match, space) => {
        return `${space}content="${escapeAttribute(value)}"`;
    });
}

// Makes the image URLs of the link-preview tags absolute and sets og:url to the site URL. A
// leading "/" means the public directory, as everywhere in Vite's index.html, so it resolves
// against the site URL rather than the origin.
export function absolutizePreviewTags(html, siteUrl) {
    let hasOgUrl = false;
    const rewritten = html.replace(/<meta\b[^>]*>/g, (tag) => {
        const attributes = metaAttributes(tag);
        const key = attributes.property ?? attributes.name;
        if (attributes.content === undefined) return tag;
        if (key === 'og:url') {
            hasOgUrl = true;
            return withContent(tag, siteUrl);
        }
        if (!URL_PROPERTIES.has(key)) return tag;
        const target = unescapeAttribute(attributes.content).replace(/^\/(?!\/)/, '');
        return withContent(tag, new URL(target, siteUrl).href);
    });
    if (hasOgUrl) return rewritten;
    const ogUrl = `<meta property="og:url" content="${escapeAttribute(siteUrl)}" />`;
    const ogType = /^([ \t]*)<meta\b[^>]*\sproperty="og:type"[^>]*>/m.exec(rewritten);
    if (ogType) {
        const end = ogType.index + ogType[0].length;
        return `${rewritten.slice(0, end)}\n${ogType[1]}${ogUrl}${rewritten.slice(end)}`;
    }
    return rewritten.replace('</head>', () => `${ogUrl}\n</head>`);
}

// Runs before Vite's own HTML processing, which then leaves the absolute URLs alone.
export function sitePreviewPlugin(siteUrl = resolveSiteUrl(process.env.BH_SITE_URL)) {
    return {
        name: 'black-hole:site-preview',
        apply: 'build',
        transformIndexHtml: {
            order: 'pre',
            handler: (html) => (siteUrl ? absolutizePreviewTags(html, siteUrl) : html),
        },
    };
}
