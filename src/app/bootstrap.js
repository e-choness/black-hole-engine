// Role: Application entry point - checks for WebGL 2, loads all textures in parallel, then
//       calls init() with the build-time bundled GLSL template once everything is ready.

import * as THREE from 'three';
import { RAYTRACER_FRAGMENT_TEMPLATE } from '../shaders/raytracer/index.js';
import { init } from './core/renderer/renderer.js';
import { animate } from './core/renderer/render-loop.js';
import { isWebGL2Available, showWebGL2Unavailable } from './core/renderer/webgl-support.js';

var textures = {};

function checkReady() {
    for (var key in textures) {
        if (textures[key] === null) return;
    }
    document.getElementById('loader').hidden = true;
    document.querySelectorAll('.initially-hidden').forEach(function (element) {
        element.classList.remove('initially-hidden');
    });
    init(RAYTRACER_FRAGMENT_TEMPLATE, textures);
    animate();
}

var texLoader = new THREE.TextureLoader();

// Textures keep the default NoColorSpace: the ray tracer samples the stored values and writes
// display values itself, so three.js must not decode or encode colours along the way.
function loadTexture(symbol, filename, interpolation) {
    textures[symbol] = null;
    texLoader.load(filename, function (tex) {
        tex.magFilter = interpolation;
        tex.minFilter = interpolation;
        textures[symbol] = tex;
        checkReady();
    });
}

if (isWebGL2Available()) {
    loadTexture('galaxy', 'textures/milkyway.jpg', THREE.NearestFilter);
    loadTexture('moon', 'textures/beach-ball.png', THREE.LinearFilter);
    loadTexture('stars', 'textures/stars.png', THREE.LinearFilter);
} else {
    showWebGL2Unavailable();
}
