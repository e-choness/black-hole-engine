// Final pass: mixes the bloom into the pre-exposed linear Rec.709 radiance, white-balances it,
// tone maps it with the three.js reference operators (or the false-colour mode), applies the
// exact sRGB OETF and adds TPDF dither just before the 8-bit canvas quantises it.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ANCHOR_LUMINANCE } from '../core/physics/emission.js';

export const TONE_MAPPERS = { agx: 0, neutral: 1, aces: 2, scientific: 3 };

// The scientific mode spans this many stops of luminance, ending this many stops above the
// display-referred anchor level of the disk photosphere.
export const SCIENTIFIC_RANGE_STOPS = 12;
export const SCIENTIFIC_HEADROOM_STOPS = 3;
const SCIENTIFIC_LOG2_MAX = Math.log2(ANCHOR_LUMINANCE) + SCIENTIFIC_HEADROOM_STOPS;

// Polynomial fit of matplotlib's Inferno map in powers of t, lowest first, giving sRGB-encoded
// values. Inferno is perceptually uniform and stays ordered in lightness under colour-vision
// deficiencies. The shader and the on-screen colour bar both evaluate it from here.
export const INFERNO_COEFFICIENTS = [
    [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
    [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914],
    [-41.70399613139459, 17.43639888205313, 44.35414519872813],
    [77.16275788913913, -33.40235894210092, -81.80730925738993],
    [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172],
];

export function infernoColor(t) {
    const x = Math.min(Math.max(t, 0), 1);
    return [0, 1, 2].map((channel) => {
        let v = 0;
        for (let i = INFERNO_COEFFICIENTS.length - 1; i >= 0; i--) {
            v = v * x + INFERNO_COEFFICIENTS[i][channel];
        }
        return Math.min(Math.max(v, 0), 1);
    });
}

// log2 of the luminance (cd/m^2) at the dark and bright ends of the scientific window: the trace
// stores luminance times the pre-exposure H.
export function scientificLuminanceRange(log2Exposure) {
    const log2Max = SCIENTIFIC_LOG2_MAX - log2Exposure;
    return { log2Min: log2Max - SCIENTIFIC_RANGE_STOPS, log2Max };
}

const INFERNO_GLSL = INFERNO_COEFFICIENTS.map(
    (c, i) => `    const vec3 c${i} = vec3(${c.join(', ')});`,
).join('\n');

const VERTEX_SHADER = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 bloomTexel;
uniform float bloomStrength;
uniform mat3 whiteBalance;
uniform int toneMapper;
uniform float scientificLog2Max;
uniform float scientificStops;
uniform int frameIndex;
in vec2 vUv;
out vec4 fragColor;

#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>

// 3x3 tent filter over the half-resolution bloom level.
vec3 bloom_tent(vec2 uv) {
    vec4 d = bloomTexel.xyxy * vec4(1.0, 1.0, -1.0, 0.0);
    vec3 s = texture(tBloom, uv - d.xy).rgb;
    s += texture(tBloom, uv - d.wy).rgb * 2.0;
    s += texture(tBloom, uv - d.zy).rgb;
    s += texture(tBloom, uv + d.zw).rgb * 2.0;
    s += texture(tBloom, uv).rgb * 4.0;
    s += texture(tBloom, uv + d.xw).rgb * 2.0;
    s += texture(tBloom, uv + d.zy).rgb;
    s += texture(tBloom, uv + d.wy).rgb * 2.0;
    s += texture(tBloom, uv + d.xy).rgb;
    return s * (1.0 / 16.0);
}

vec3 inferno(float t) {
${INFERNO_GLSL}
    return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}

// False colour: log2 luminance over a fixed window of stops, through Inferno.
vec3 scientific_false_colour(vec3 color) {
    float y = dot(color, vec3(0.2126729, 0.7151522, 0.072175));
    float t = (log2(max(y, 1e-12)) - scientificLog2Max) / scientificStops + 1.0;
    return clamp(inferno(clamp(t, 0.0, 1.0)), 0.0, 1.0);
}

// PCG-style 3-D integer hash (Jarzynski & Olano 2020, JCGT 9(3)).
uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}

// Triangular-PDF noise of +-1 LSB per channel, re-seeded every frame.
vec3 tpdf_dither() {
    uvec3 seed = uvec3(uvec2(gl_FragCoord.xy), uint(frameIndex));
    vec3 a = vec3(pcg3d(seed)) * (1.0 / 4294967296.0);
    vec3 b = vec3(pcg3d(seed ^ uvec3(0x9e3779b9u, 0x7f4a7c15u, 0x85ebca6bu))) * (1.0 / 4294967296.0);
    return (a + b - 1.0) * (1.0 / 255.0);
}

void main() {
    vec3 color = texture(tScene, vUv).rgb;
    if (bloomStrength > 0.0) color = mix(color, bloom_tent(vUv), bloomStrength);
    color = max(whiteBalance * color, vec3(0.0));

    vec3 display;
    if (toneMapper == 3) {
        display = scientific_false_colour(color);
    } else {
        if (toneMapper == 0) color = AgXToneMapping(color);
        else if (toneMapper == 1) color = NeutralToneMapping(color);
        else color = ACESFilmicToneMapping(color);
        display = sRGBTransferOETF(vec4(clamp(color, 0.0, 1.0), 1.0)).rgb;
    }
    fragColor = vec4(display + tpdf_dither(), 1.0);
}
`;

export function setupOutputPass() {
    const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
            tScene: { value: null },
            tBloom: { value: null },
            bloomTexel: { value: new THREE.Vector2(1, 1) },
            bloomStrength: { value: 0 },
            whiteBalance: { value: new THREE.Matrix3() },
            toneMapper: { value: TONE_MAPPERS.agx },
            toneMappingExposure: { value: 1 },
            scientificLog2Max: { value: SCIENTIFIC_LOG2_MAX },
            scientificStops: { value: SCIENTIFIC_RANGE_STOPS },
            frameIndex: { value: 0 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        depthTest: false,
        depthWrite: false,
    });
    const quad = new FullScreenQuad(material);
    let frameIndex = 0;

    return {
        material,
        // bloom: { texture, width, height, strength } or null; settings: { toneMapper,
        // whiteBalance } with a row-major 3x3 matrix or null.
        render(renderer, sceneTexture, bloom, settings) {
            const u = material.uniforms;
            u.tScene.value = sceneTexture;
            u.tBloom.value = bloom ? bloom.texture : null;
            u.bloomStrength.value = bloom ? bloom.strength : 0;
            if (bloom) u.bloomTexel.value.set(1 / bloom.width, 1 / bloom.height);
            const wb = settings.whiteBalance;
            if (wb) u.whiteBalance.value.set(...wb[0], ...wb[1], ...wb[2]);
            else u.whiteBalance.value.identity();
            u.toneMapper.value = TONE_MAPPERS[settings.toneMapper] ?? TONE_MAPPERS.agx;
            u.frameIndex.value = frameIndex;
            frameIndex = (frameIndex + 1) % 65536;
            renderer.setRenderTarget(null);
            quad.render(renderer);
        },
        dispose() {
            quad.dispose();
            material.dispose();
        },
    };
}
