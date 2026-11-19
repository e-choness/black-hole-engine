// WebGL 2 is required by the renderer (three.js dropped WebGL 1), so the page checks for it
// before loading any assets and explains the problem in place of the loading message.

export function isWebGL2Available() {
    try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return false;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch {
        return false;
    }
}

export function showWebGL2Unavailable() {
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
        'This simulation needs WebGL 2. Use a current version of Chrome, Edge, Firefox or ' +
            'Safari and make sure hardware acceleration is enabled. ',
        link,
    );

    loader.replaceChildren('WebGL 2 is not available in this browser.', detail);
    loader.setAttribute('role', 'alert');
}
