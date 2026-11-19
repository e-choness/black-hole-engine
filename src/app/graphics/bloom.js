// Energy-conserving bloom after Jimenez (2014), "Next Generation Post Processing in Call of Duty:
// Advanced Warfare": a 13-tap downsample chain of the HDR frame and a 3x3 tent upsample chain.
// Each upsample step mixes a level with the upsampled coarser levels by `radius`, so level i has
// weight (1 - r) r^i (the coarsest r^(n-1)), the weights sum to one and the bloom texture keeps the
// frame's energy. The output pass forms (1 - k) scene + k bloom without any threshold.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createPassMaterial, createRenderTarget, renderPass } from './post-processing.js';

const MAX_LEVELS = 8;

// The first level weights its five boxes by 1 / (1 + luma) (Karis average), which keeps single
// bright pixels from flickering in the glare.
const DOWNSAMPLE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 texel;
uniform bool karis;
in vec2 vUv;
out vec4 fragColor;

float karis_weight(vec3 c) {
    return 1.0 / (1.0 + dot(c, vec3(0.2126729, 0.7151522, 0.072175)));
}

void main() {
    vec3 a = texture(tSource, vUv + texel * vec2(-2.0, 2.0)).rgb;
    vec3 b = texture(tSource, vUv + texel * vec2(0.0, 2.0)).rgb;
    vec3 c = texture(tSource, vUv + texel * vec2(2.0, 2.0)).rgb;
    vec3 d = texture(tSource, vUv + texel * vec2(-2.0, 0.0)).rgb;
    vec3 e = texture(tSource, vUv).rgb;
    vec3 f = texture(tSource, vUv + texel * vec2(2.0, 0.0)).rgb;
    vec3 g = texture(tSource, vUv + texel * vec2(-2.0, -2.0)).rgb;
    vec3 h = texture(tSource, vUv + texel * vec2(0.0, -2.0)).rgb;
    vec3 i = texture(tSource, vUv + texel * vec2(2.0, -2.0)).rgb;
    vec3 j = texture(tSource, vUv + texel * vec2(-1.0, 1.0)).rgb;
    vec3 k = texture(tSource, vUv + texel * vec2(1.0, 1.0)).rgb;
    vec3 l = texture(tSource, vUv + texel * vec2(-1.0, -1.0)).rgb;
    vec3 m = texture(tSource, vUv + texel * vec2(1.0, -1.0)).rgb;

    // Centre box (weight 0.5) and the four overlapping corner boxes (0.125 each).
    vec3 box0 = (j + k + l + m) * 0.25;
    vec3 box1 = (a + b + d + e) * 0.25;
    vec3 box2 = (b + c + e + f) * 0.25;
    vec3 box3 = (d + e + g + h) * 0.25;
    vec3 box4 = (e + f + h + i) * 0.25;
    float w0 = 0.5;
    vec4 w = vec4(0.125);
    if (karis) {
        w0 *= karis_weight(box0);
        w *= vec4(karis_weight(box1), karis_weight(box2), karis_weight(box3), karis_weight(box4));
    }
    vec3 sum = box0 * w0 + box1 * w.x + box2 * w.y + box3 * w.z + box4 * w.w;
    fragColor = vec4(sum / (w0 + w.x + w.y + w.z + w.w), 1.0);
}
`;

const UPSAMPLE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tCoarse;
uniform sampler2D tFine;
uniform vec2 coarseTexel;
uniform float radius;
in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 d = coarseTexel.xyxy * vec4(1.0, 1.0, -1.0, 0.0);
    vec3 s = texture(tCoarse, vUv - d.xy).rgb;
    s += texture(tCoarse, vUv - d.wy).rgb * 2.0;
    s += texture(tCoarse, vUv - d.zy).rgb;
    s += texture(tCoarse, vUv + d.zw).rgb * 2.0;
    s += texture(tCoarse, vUv).rgb * 4.0;
    s += texture(tCoarse, vUv + d.xw).rgb * 2.0;
    s += texture(tCoarse, vUv + d.zy).rgb;
    s += texture(tCoarse, vUv + d.wy).rgb * 2.0;
    s += texture(tCoarse, vUv + d.xy).rgb;
    fragColor = vec4(mix(texture(tFine, vUv).rgb, s * (1.0 / 16.0), radius), 1.0);
}
`;

// Levels from half resolution down to a few texels, so the widest level spans a similar
// fraction of the frame at every render scale.
export function bloomLevelCount(width, height) {
    const levels = Math.floor(Math.log2(Math.max(1, Math.min(width, height)))) - 2;
    return Math.max(1, Math.min(MAX_LEVELS, levels));
}

export function setupBloom(renderer) {
    const downMat = createPassMaterial(
        {
            tSource: { value: null },
            texel: { value: new THREE.Vector2() },
            karis: { value: false },
        },
        DOWNSAMPLE_FRAGMENT_SHADER,
    );
    const upMat = createPassMaterial(
        {
            tCoarse: { value: null },
            tFine: { value: null },
            coarseTexel: { value: new THREE.Vector2() },
            radius: { value: 0.7 },
        },
        UPSAMPLE_FRAGMENT_SHADER,
    );
    const quad = new FullScreenQuad();
    let down = [];
    let up = [];

    function disposeTargets() {
        for (const target of down.concat(up)) target.dispose();
        down = [];
        up = [];
    }

    function resize(width, height) {
        disposeTargets();
        const levels = bloomLevelCount(width, height);
        for (let i = 0; i < levels; i++) {
            const w = Math.max(1, width >> (i + 1));
            const h = Math.max(1, height >> (i + 1));
            down.push(createRenderTarget(renderer, w, h));
            if (i < levels - 1) up.push(createRenderTarget(renderer, w, h));
        }
    }

    resize(1, 1);

    return {
        resize,
        get levels() {
            return down.length;
        },
        // Returns the half-resolution bloom level for the output pass.
        render(rdr, sourceTexture, radius) {
            let source = sourceTexture;
            for (let i = 0; i < down.length; i++) {
                const image = source.image;
                downMat.uniforms.tSource.value = source;
                downMat.uniforms.texel.value.set(1 / image.width, 1 / image.height);
                downMat.uniforms.karis.value = i === 0;
                renderPass(rdr, quad, downMat, down[i]);
                source = down[i].texture;
            }
            upMat.uniforms.radius.value = Math.min(Math.max(radius, 0), 1);
            let coarse = down[down.length - 1];
            for (let i = down.length - 2; i >= 0; i--) {
                upMat.uniforms.tCoarse.value = coarse.texture;
                upMat.uniforms.tFine.value = down[i].texture;
                upMat.uniforms.coarseTexel.value.set(1 / coarse.width, 1 / coarse.height);
                renderPass(rdr, quad, upMat, up[i]);
                coarse = up[i];
            }
            return coarse;
        },
        dispose() {
            disposeTargets();
            quad.dispose();
            downMat.dispose();
            upMat.dispose();
        },
    };
}
