// Shared pieces of the full-screen passes (temporal AA, bloom, output): HDR targets, node
// materials drawn on a screen quad, and the tent filter.

import * as THREE from 'three';
import { MeshBasicNodeMaterial, QuadMesh, RenderTarget } from 'three/webgpu';
import { vec3, vec4 } from 'three/tsl';

// Placeholder for texture nodes until the pass binds its input.
export const EMPTY_TEXTURE = new THREE.Texture();

// Rec.709 luminance weights.
export const LUMA = vec3(0.2126729, 0.7151522, 0.072175);

// HDR targets are RGBA16F: every WebGPU adapter renders to it, and three's WebGL 2 backend enables
// the colour-buffer float extensions it needs for the same targets.
export function createRenderTarget(width, height) {
    return new RenderTarget(Math.max(1, width), Math.max(1, height), {
        type: THREE.HalfFloatType,
        depthBuffer: false,
    });
}

// Node material that writes `node` to every pixel of the quad.
export function passMaterial(node) {
    const material = new MeshBasicNodeMaterial();
    material.fragmentNode = node;
    material.depthTest = false;
    material.depthWrite = false;
    return material;
}

// three's QuadMesh follows the texture orientation of either backend.
export function createPassQuad(material = null) {
    return new QuadMesh(material);
}

// Draws `material` into `target`, or into the canvas when `target` is null.
export function renderPass(renderer, quad, material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
}

// 3x3 tent filter of the texture node `map` with texel size `texel` around `p`.
export function tent(map, p, texel) {
    const d = vec4(texel.x, texel.y, texel.x.negate(), 0.0);
    return map
        .sample(p.sub(d.xy))
        .rgb.add(map.sample(p.sub(d.wy)).rgb.mul(2.0))
        .add(map.sample(p.sub(d.zy)).rgb)
        .add(map.sample(p.add(d.zw)).rgb.mul(2.0))
        .add(map.sample(p).rgb.mul(4.0))
        .add(map.sample(p.add(d.xw)).rgb.mul(2.0))
        .add(map.sample(p.add(d.zy)).rgb)
        .add(map.sample(p.add(d.wy)).rgb.mul(2.0))
        .add(map.sample(p.add(d.xy)).rgb)
        .mul(1.0 / 16.0);
}
