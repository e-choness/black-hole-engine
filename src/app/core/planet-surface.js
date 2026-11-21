// The map the ray tracer samples as planet_map on the test planet's Jupiter surface:
// src/assets/textures/jupiter.webp, the Cassini global map of Jupiter (Photojournal PIA07782,
// 3601 x 1801, east to the right) with its duplicated 360-degree column dropped, the blank rows
// north of 88.4 N and south of 81.9 S filled with the nearest observed latitude fading to its mean
// colour, resampled to 3600 x 1800 and encoded as WebP at quality 88. It is fetched the first time
// the planet is drawn with it, so the mobile preset, which draws no planet, never downloads it.
// Until it arrives the planet shows the map's mean colour; the new texture changes the uniform's
// value, which restarts the accumulation of a still.

import * as THREE from 'three';

const JUPITER_MAP_URL = new URL('../../assets/textures/jupiter.webp', import.meta.url).href;
const JUPITER_MEAN_SRGB = [160, 157, 151];

let anisotropy = 1;
let status = 'idle';
let map = null;

export function createPlanetMapPlaceholder() {
    const texture = new THREE.DataTexture(new Uint8Array([...JUPITER_MEAN_SRGB, 255]), 1, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

export function initPlanetSurface(maxAnisotropy) {
    anisotropy = maxAnisotropy;
}

export function updatePlanetSurface(uniforms, params) {
    if (map) {
        uniforms.planet_map.value = map;
        return;
    }
    if (status !== 'idle' || !params.planetTextured()) return;
    status = 'loading';
    new THREE.TextureLoader().loadAsync(JUPITER_MAP_URL).then(
        (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.anisotropy = anisotropy;
            map = texture;
            status = 'ready';
        },
        () => {
            status = 'failed';
        },
    );
}

// 'idle' until the planet is first drawn with the map, then 'loading', 'ready' or 'failed'.
export function planetSurfaceStatus() {
    return status;
}
