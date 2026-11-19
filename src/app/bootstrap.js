// Role: Application entry point - checks for WebGL 2, loads the planet map, then mounts the React
//       app, whose React Three Fiber canvas creates the renderer and starts the engine
//       (src/ui/viewport/Viewport.tsx). The sky is generated on the GPU (src/app/core/sky.js), so
//       there is no sky image to wait for.

import * as THREE from 'three';
import { isWebGL2Available, showWebGL2Unavailable } from './core/renderer/webgl-support.js';
import { mountApp } from '../ui/main.tsx';

function start(textures) {
    document.getElementById('loader').hidden = true;
    mountApp(textures);
}

// Colour images are sRGB-encoded; three.js uploads them as sRGB8_ALPHA8, so the GPU decodes them to
// linear values before filtering.
function loadPlanetTexture() {
    return new THREE.TextureLoader().loadAsync('textures/beach-ball.png').then(function (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        return tex;
    });
}

if (isWebGL2Available()) {
    loadPlanetTexture().then(
        function (moon) {
            start({ moon: moon });
        },
        function (error) {
            console.error('Texture loading failed:', error);
        },
    );
} else {
    showWebGL2Unavailable();
}
