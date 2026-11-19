import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { legalNoticePlugin } from './config/legal-notice.js';
import { SERVICE_WORKER_PACKAGES, pwaOptions } from './config/pwa.js';
import { securityHeaders, serializeContentSecurityPolicy } from './config/security-headers.js';
import { sitePreviewPlugin } from './config/site-metadata.js';

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
    plugins: [
        react(),
        tailwindcss(),
        contentSecurityPolicyMeta(),
        // Tailwind CSS generates the theme variables and utilities of the stylesheet outside the
        // module graph, and workbox-build bundles the service worker after it.
        legalNoticePlugin({ extraPackages: ['tailwindcss', ...SERVICE_WORKER_PACKAGES] }),
        sitePreviewPlugin(),
        VitePWA(pwaOptions),
    ],
    build: {
        target: 'es2022',
        sourcemap: true,
        modulePreload: { polyfill: false },
        // three.js is about 770 kB minified because WebGLRenderer pulls in the shader library of
        // every built-in material. It gets a chunk of its own, which also stays cached across app
        // releases, and the size warning is raised to just above it. React, and React Three Fiber
        // with its runtime dependencies, get one each for the same caching reason.
        chunkSizeWarningLimit: 800,
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
                        {
                            name: 'react',
                            test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                        },
                        {
                            name: 'react-three-fiber',
                            test: /[\\/]node_modules[\\/](@react-three[\\/]fiber|its-fine|react-use-measure|suspend-react|zustand|use-sync-external-store)[\\/]/,
                        },
                    ],
                },
            },
        },
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
        include: ['tests/unit/**/*.test.{js,ts}'],
        environment: 'node',
    },
});
