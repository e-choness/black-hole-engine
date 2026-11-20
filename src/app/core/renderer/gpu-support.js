// The renderer draws with WebGPU or, where that is missing, with WebGL 2 (three.js dropped WebGL 1),
// so the page checks for either before mounting the app and explains the problem in place of the
// loading message.

export function isGpuRenderingAvailable(nav = navigator) {
    if ('gpu' in nav) return true;
    try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return false;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch {
        return false;
    }
}

export function showGpuRenderingUnavailable() {
    const loader = document.getElementById('loader');
    if (!loader) return;

    const detail = document.createElement('div');
    detail.className = 'disclaimer';
    const link = document.createElement('a');
    link.href = 'https://get.webgl.org/webgl2/';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Check WebGL 2 support';
    detail.append(
        'This simulation needs WebGPU or WebGL 2. Use a current version of Chrome, Edge, Firefox ' +
            'or Safari and make sure hardware acceleration is enabled. ',
        link,
    );

    loader.replaceChildren('Neither WebGPU nor WebGL 2 is available in this browser.', detail);
    loader.setAttribute('role', 'alert');
}
