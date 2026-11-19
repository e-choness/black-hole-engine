// Role: Application entry point - loads all textures in parallel, then calls init() with the
//       build-time bundled GLSL template once everything is ready.

import { $, THREE } from './vendor.js';
import { RAYTRACER_FRAGMENT_TEMPLATE } from '../shaders/raytracer/index.js';
import { init } from './core/renderer/renderer.js';
import { animate } from './core/renderer/render-loop.js';

var textures = {};

function checkReady() {
    for (var key in textures) {
        if (textures[key] === null) return;
    }
    $('#loader').hide();
    $('.initially-hidden').removeClass('initially-hidden');
    init(RAYTRACER_FRAGMENT_TEMPLATE, textures);
    animate();
}

var texLoader = new THREE.TextureLoader();

function loadTexture(symbol, filename, interpolation) {
    textures[symbol] = null;
    texLoader.load(filename, function (tex) {
        tex.magFilter = interpolation;
        tex.minFilter = interpolation;
        textures[symbol] = tex;
        checkReady();
    });
}

loadTexture('galaxy', 'textures/milkyway.jpg', THREE.NearestFilter);
loadTexture('spectra', 'textures/spectra.png', THREE.LinearFilter);
loadTexture('moon', 'textures/beach-ball.png', THREE.LinearFilter);
loadTexture('stars', 'textures/stars.png', THREE.LinearFilter);
