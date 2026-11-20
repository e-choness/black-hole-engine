import { registerSW } from 'virtual:pwa-register';
import { createPwaController } from './pwa-controller.js';

// Entry point loaded by index.html. Only production builds have a service worker (the dev server
// serves none), so only they register it. The UI imports `pwa` to show the offline and update
// notices; see pwa-controller.js.
export const pwa = createPwaController({ registerSW });

if (import.meta.env.PROD) pwa.start();
