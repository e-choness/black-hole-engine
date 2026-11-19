// Sky cube-map tiers (scripts/build-sky.js): six sRGB JPEG faces per size in galactic
// coordinates. The quality preset picks the tier; mipmaps are built in linear light by the GPU
// from the sRGB8_ALPHA8 upload, and anisotropic filtering handles the sheared footprints of the
// lensed sky near the photon ring.

import * as THREE from 'three';

const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
const DEFAULT_TIER = 1024;

// Face size per quality preset; a face of N texels resolves 2/N rad at its centre.
export const SKY_TIERS = {
    mobile: 512,
    optimal: 1024,
    medium: 1024,
    high: 2048,
    ultra: 2048,
    cinematic: 2048,
};

const loader = new THREE.CubeTextureLoader();
const pending = new Map();
let anisotropy = 1;
let requestedTier = null;

export function skyTierForQuality(quality) {
    return SKY_TIERS[quality] || null;
}

export function setSkyAnisotropy(value) {
    anisotropy = Math.max(1, value);
}

export function loadSkyTier(size) {
    if (!pending.has(size)) {
        const urls = FACES.map((face) => `textures/sky/${size}/${face}.jpg`);
        const request = new Promise((resolve, reject) => {
            loader.load(
                urls,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    texture.generateMipmaps = true;
                    texture.minFilter = THREE.LinearMipmapLinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.anisotropy = anisotropy;
                    texture.userData.skyTier = size;
                    texture.needsUpdate = true;
                    resolve(texture);
                },
                undefined,
                reject,
            );
        });
        pending.set(size, request);
    }
    return pending.get(size);
}

export function initialSkyTier(quality) {
    return skyTierForQuality(quality) || DEFAULT_TIER;
}

// Keeps `uniform.value` on the tier of the current quality preset (custom quality keeps the tier
// it has). A new tier replaces the old one once its faces have loaded, and the old texture is
// released.
export function syncSkyTier(uniform, quality, onSwap) {
    const size = skyTierForQuality(quality);
    if (!size || size === requestedTier) return;
    requestedTier = size;
    if (uniform.value && uniform.value.userData.skyTier === size) return;
    loadSkyTier(size).then(
        (texture) => {
            if (requestedTier !== size) return;
            const previous = uniform.value;
            texture.anisotropy = anisotropy;
            uniform.value = texture;
            if (previous && previous !== texture) {
                pending.delete(previous.userData.skyTier);
                previous.dispose();
            }
            if (onSwap) onSwap();
        },
        (error) => {
            if (requestedTier === size) requestedTier = null;
            console.warn('Sky tier ' + size + ' failed to load:', error);
        },
    );
}
