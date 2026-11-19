// HTTP security headers shared by the Vite preview server, the build-time CSP <meta> tag and the
// production nginx image (scripts/render-nginx-headers.js), so every environment enforces the
// same policy.

const contentSecurityPolicy = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    // lil-gui injects its stylesheet as a <style> element and the UI sets inline style
    // attributes.
    'style-src': ["'self'", "'unsafe-inline'"],
    // lil-gui's stylesheet embeds its icon font as a data: URL.
    'font-src': ["'self'", 'data:'],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:'],
    'connect-src': ["'self'"],
    // Mediabunny starts its optional helper workers (alpha splitting, media-stream capture)
    // from blob: URLs.
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
};

// Browsers ignore these directives (with a console error) when the policy is delivered via <meta>.
const HEADER_ONLY_DIRECTIVES = new Set(['frame-ancestors', 'report-uri', 'sandbox']);

export function serializeContentSecurityPolicy({ meta = false } = {}) {
    return Object.entries(contentSecurityPolicy)
        .filter(([directive]) => !(meta && HEADER_ONLY_DIRECTIVES.has(directive)))
        .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
        .join('; ');
}

export const securityHeaders = {
    'Content-Security-Policy': serializeContentSecurityPolicy(),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
};
