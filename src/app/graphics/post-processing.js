// Shared pieces of the full-screen post-processing passes (temporal AA, bloom).

import * as THREE from 'three';
import { createNodeQuad, createNodeRenderTarget } from './node-passes.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
out vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

export function createPassMaterial(uniforms, fragmentShader) {
    return new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: uniforms,
        vertexShader: FULLSCREEN_VERTEX_SHADER,
        fragmentShader: fragmentShader,
        depthWrite: false,
        depthTest: false,
    });
}

// HDR targets are RGBA16F whenever the GPU can render to them (EXT_color_buffer_float, or the
// half-float variant on some mobile GPUs); linear filtering of RGBA16F is core in WebGL2.
// WebGLRenderer requests both colour-buffer extensions at start-up, so has() reports what the
// context supports. Without them the targets fall back to RGBA8 and clip at 1.
export function createRenderTarget(renderer, width, height) {
    if (renderer.isWebGPURenderer) return createNodeRenderTarget(width, height);
    const halfFloat =
        renderer.extensions.has('EXT_color_buffer_float') ||
        renderer.extensions.has('EXT_color_buffer_half_float');
    return new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
        type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: false,
    });
}

// Full-screen quad for the renderer's materials: three's QuadMesh for node materials, which
// follows the WebGPU texture orientation, and the addons' FullScreenQuad for GLSL.
export function createPassQuad(renderer, material) {
    return renderer.isWebGPURenderer ? createNodeQuad(material) : new FullScreenQuad(material);
}

// Draws `material` into `target`, or into the canvas when `target` is null.
export function renderPass(renderer, quad, material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
}
