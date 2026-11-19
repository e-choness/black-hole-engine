// Shared pieces of the full-screen post-processing passes (bloom, temporal AA).

import * as THREE from 'three';

const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
out vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

export const COPY_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
in vec2 vUv;
out vec4 fragColor;

void main() {
    fragColor = texture(tDiffuse, vUv);
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

// Intermediate targets are half float whenever the GPU can render to them, which keeps the
// bloom blur chain and the TAA history free of 8-bit quantisation. WebGLRenderer requests both
// colour-buffer extensions at start-up, so has() reports what the context supports.
export function createRenderTarget(renderer, width, height) {
    const halfFloat =
        renderer.extensions.has('EXT_color_buffer_float') ||
        renderer.extensions.has('EXT_color_buffer_half_float');
    return new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
        type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: false,
    });
}

// Draws `material` into `target`, or into the canvas when `target` is null.
export function renderPass(renderer, quad, material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
}
