// Request matchers of the service worker (config/pwa.js).
// workbox-build copies each matcher into sw.js with Function.prototype.toString(), so a matcher
// must not refer to anything outside its own body. They receive Workbox's route context
// { url, request, sameOrigin }.

// Video is streamed with range requests and can be large, so it always goes to the network.
// Recorded clips are blob: URLs, which never reach the service worker.
export function isVideoRequest({ request, url }) {
    return (
        request?.destination === 'video' || /\.(?:mp4|m4v|mov|webm|ogv|mkv)$/i.test(url.pathname)
    );
}
