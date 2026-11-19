// Role: Application entry point - checks for WebGL 2, loads the textures in parallel (the sky
//       cube-map tier of the starting quality preset and the planet map), then calls init()
//       with the build-time bundled GLSL template once everything is ready, and mounts the UI.

import * as THREE from 'three';
import { RAYTRACER_FRAGMENT_TEMPLATE } from '../shaders/raytracer/index.js';
import { init } from './core/renderer/renderer.js';
import { animate } from './core/renderer/render-loop.js';
import { initialQualityPreset } from './core/renderer/renderer-quality.js';
import { isWebGL2Available, showWebGL2Unavailable } from './core/renderer/webgl-support.js';
import { initialSkyTier, loadSkyTier } from './core/sky.js';
import { mountUi } from '../ui/main.tsx';

function start(textures) {
    document.getElementById('loader').hidden = true;
    init(RAYTRACER_FRAGMENT_TEMPLATE, textures);
    mountUi();
    animate();
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
    Promise.all([loadSkyTier(initialSkyTier(initialQualityPreset())), loadPlanetTexture()]).then(
        function ([sky, moon]) {
            start({ sky: sky, moon: moon });
        },
        function (error) {
            console.error('Texture loading failed:', error);
        },
    );
} else {
    showWebGL2Unavailable();
}
