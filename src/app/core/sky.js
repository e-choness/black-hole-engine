// The sky behind the hole: the procedural galaxy cube map (src/app/sky/galaxy-sky.js), or the
// coordinate grid the ray tracer draws itself (sky_mode 1). The ray tracer samples sky_cube
// along each escaping ray; sky_revision changes whenever the cube is re-rendered so the frame
// accumulator restarts.

import { GalaxySky } from '../sky/galaxy-sky.js';
import { applySkyView } from '../../features/galaxy/model.js';

let galaxy = null;

export function initSky(renderer, uniforms, anisotropy) {
    galaxy = new GalaxySky(renderer, { anisotropy });
    uniforms.sky_cube.value = galaxy.texture;
    return galaxy;
}

// A renderer that replaces a lost one draws the cube again from scratch.
export function setSkyRenderer(renderer) {
    if (galaxy) galaxy.setRenderer(renderer);
}

export function updateSky(uniforms, params, time) {
    if (!galaxy) return;
    const sky = params.sky;
    uniforms.sky_mode.value = sky.mode === 'grid' ? 1 : 0;
    if (sky.mode !== 'grid') {
        galaxy.update({ params: sky.galaxy, quality: params.quality, time });
        uniforms.sky_cube.value = galaxy.texture;
    }
    uniforms.sky_revision.value = galaxy.revision;
}

// True while the galaxy turns with the simulation clock.
export function skyAnimates(params) {
    return params.sky.mode === 'galaxy' && params.sky.galaxy.rotation_speed > 0;
}

// Moves the hole to one of the named places in the galaxy (model.js SKY_VIEWS).
export function setSkyView(params, view) {
    return applySkyView(params.sky.galaxy, view);
}

export function skyStatus() {
    return galaxy ? galaxy.status() : null;
}

export function probeSky(width, height) {
    return galaxy ? galaxy.probe(width, height) : null;
}
