import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import { securityHeaders, serializeContentSecurityPolicy } from './config/security-headers.js';

// The link bar in index.html points at docs/LEGAL.md, so every build ships it next to the page.
function legalNotice() {
    return {
        name: 'black-hole:legal-notice',
        apply: 'build',
        async generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'docs/LEGAL.md',
                source: await readFile(new URL('./docs/LEGAL.md', import.meta.url), 'utf8'),
            });
        },
    };
}

// Static hosts without custom headers (GitHub Pages) still get the CSP through a <meta> tag that
// is placed right after <meta charset> so it governs every later resource.
function contentSecurityPolicyMeta() {
    const charset = '<meta charset="utf-8" />';
    return {
        name: 'black-hole:csp-meta',
        apply: 'build',
        transformIndexHtml: {
            order: 'post',
            handler(html) {
                if (!html.includes(charset)) {
                    throw new Error(`index.html must contain ${charset} for CSP injection`);
                }
                const meta = `<meta http-equiv="Content-Security-Policy" content="${serializeContentSecurityPolicy({ meta: true })}" />`;
                return html.replace(charset, `${charset}\n        ${meta}`);
            },
        },
    };
}

export default defineConfig({
    base: './',
    plugins: [contentSecurityPolicyMeta(), legalNotice()],
    build: {
        target: 'es2022',
        sourcemap: true,
        modulePreload: { polyfill: false },
    },
    server: {
        port: 5173,
        strictPort: true,
        watch: {
            ignored: ['**/.cache/**', '**/dist/**', '**/coverage/**'],
            // Docker Desktop bind mounts do not forward file-system events from the host.
            usePolling: process.env.BH_WATCH_POLLING === '1',
            interval: 300,
        },
    },
    preview: {
        port: 4173,
        strictPort: true,
        headers: securityHeaders,
    },
    test: {
        include: ['tests/unit/**/*.test.js'],
        environment: 'node',
    },
});
