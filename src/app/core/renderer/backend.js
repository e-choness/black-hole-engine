// GPU API of the canvas. The renderer is three's WebGPURenderer: WebGPU on desktop-class devices,
// and its WebGL 2 backend on phones and tablets, in browsers without WebGPU and in Firefox, where
// three's WGSL keeps derivative uniformity checks that the sky filter's screen-space gradients
// would fail. ?backend=webgl or ?backend=webgpu overrides the choice, and so does a build with
// VITE_BACKEND set to either.

const query = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export function isMobileDevice(nav = navigator) {
    if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
        return nav.userAgentData.mobile;
    }
    const ua = nav.userAgent || '';
    // iPadOS reports a desktop Safari user agent; only its touch support gives it away.
    if (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) return true;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function preferredBackend(nav = navigator) {
    const requested = query.get('backend') ?? import.meta.env?.VITE_BACKEND;
    if (requested === 'webgl' || requested === 'webgpu') return requested;
    if (!('gpu' in nav) || isMobileDevice(nav)) return 'webgl';
    if (/Firefox\//.test(nav.userAgent || '')) return 'webgl';
    return 'webgpu';
}
