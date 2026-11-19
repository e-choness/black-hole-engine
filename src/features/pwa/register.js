import { registerSW } from 'virtual:pwa-register';
import { TEXTURE_CACHE_NAME, isTextureRequest } from './cache-rules.js';
import { createPwaController } from './pwa-controller.js';

// Entry point loaded by index.html. Only production builds have a service worker (the dev server
// serves none), so only they register it. The UI imports `pwa` to show the offline and update
// notices; see pwa-controller.js.
export const pwa = createPwaController({
    registerSW,
    warmCache: {
        cacheName: TEXTURE_CACHE_NAME,
        match: (url) =>
            isTextureRequest({ url, sameOrigin: url.origin === window.location.origin }),
    },
});

if (import.meta.env.PROD) pwa.start();
