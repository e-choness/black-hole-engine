// Final pass: mixes the bloom into the pre-exposed linear Rec.709 radiance, white-balances it,
// tone maps it with the three.js reference operators (or the false-colour mode), applies the
// exact sRGB OETF and adds TPDF dither just before the 8-bit canvas quantises it.

import * as THREE from 'three';
import {
    Fn,
    If,
    acesFilmicToneMapping,
    agxToneMapping,
    clamp,
    dot,
    float,
    log2,
    max,
    mix,
    neutralToneMapping,
    screenCoordinate,
    sRGBTransferOETF,
    texture,
    uint,
    uniform,
    uv,
    uvec3,
    vec3,
    vec4,
} from 'three/tsl';
import { EMPTY_TEXTURE, LUMA, createPassQuad, passMaterial, tent } from './post-processing.js';
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

// PCG-style 3-D integer hash (Jarzynski & Olano 2020, JCGT 9(3)).
function pcg3d(seed) {
    const v = seed.mul(uint(1664525)).add(uint(1013904223)).toVar();
    v.x.addAssign(v.y.mul(v.z));
    v.y.addAssign(v.z.mul(v.x));
    v.z.addAssign(v.x.mul(v.y));
    v.assign(v.bitXor(v.shiftRight(uvec3(16))));
    v.x.addAssign(v.y.mul(v.z));
    v.y.addAssign(v.z.mul(v.x));
    v.z.addAssign(v.x.mul(v.y));
    return v;
}

// Triangular-PDF noise of +-1 LSB per channel, re-seeded every frame.
function tpdfDither(frameIndex) {
    const seed = uvec3(uint(screenCoordinate.x), uint(screenCoordinate.y), frameIndex).toConst();
    const salt = uvec3(uint(0x9e3779b9), uint(0x7f4a7c15), uint(0x85ebca6b));
    const a = vec3(pcg3d(seed)).mul(1.0 / 4294967296.0);
    const b = vec3(pcg3d(seed.bitXor(salt))).mul(1.0 / 4294967296.0);
    return a
        .add(b)
        .sub(1.0)
        .mul(1.0 / 255.0);
}

function inferno(t) {
    const last = INFERNO_COEFFICIENTS.length - 1;
    let v = vec3(...INFERNO_COEFFICIENTS[last]);
    for (let n = last - 1; n >= 0; n--) v = v.mul(t).add(vec3(...INFERNO_COEFFICIENTS[n]));
    return v;
}

function createOutputMaterial() {
    const u = {
        tScene: texture(EMPTY_TEXTURE),
        tBloom: texture(EMPTY_TEXTURE),
        bloomTexel: uniform(new THREE.Vector2(1, 1)),
        bloomStrength: uniform(0),
        whiteBalance: uniform(new THREE.Matrix3()),
        toneMapper: uniform(TONE_MAPPERS.agx),
        frameIndex: uniform(0, 'uint'),
    };
    const node = Fn(() => {
        const p = uv();
        const color = u.tScene.sample(p).rgb.toVar();
        If(u.bloomStrength.greaterThan(0.0), () => {
            color.assign(mix(color, tent(u.tBloom, p, u.bloomTexel), u.bloomStrength));
        });
        color.assign(max(u.whiteBalance.mul(color), vec3(0.0)));
        const display = vec3(0.0).toVar();
        If(u.toneMapper.equal(TONE_MAPPERS.scientific), () => {
            // False colour: log2 luminance over a fixed window of stops, through Inferno.
            const y = dot(color, LUMA);
            const t = log2(max(y, 1e-12))
                .sub(SCIENTIFIC_LOG2_MAX)
                .div(SCIENTIFIC_RANGE_STOPS)
                .add(1.0);
            display.assign(clamp(inferno(clamp(t, 0.0, 1.0)), 0.0, 1.0));
        }).Else(() => {
            const mapped = vec3(0.0).toVar();
            If(u.toneMapper.equal(TONE_MAPPERS.agx), () => {
                mapped.assign(agxToneMapping(color, float(1.0)));
            })
                .ElseIf(u.toneMapper.equal(TONE_MAPPERS.neutral), () => {
                    mapped.assign(neutralToneMapping(color, float(1.0)));
                })
                .Else(() => {
                    mapped.assign(acesFilmicToneMapping(color, float(1.0)));
                });
            display.assign(sRGBTransferOETF(clamp(mapped, 0.0, 1.0)));
        });
        return vec4(display.add(tpdfDither(u.frameIndex)), 1.0);
    })();
    return Object.assign(passMaterial(node), { uniforms: u });
}

export function setupOutputPass() {
    const material = createOutputMaterial();
    const quad = createPassQuad(material);
    let frameIndex = 0;

    return {
        material,
        // bloom: { texture, width, height, strength } or null; settings: { toneMapper,
        // whiteBalance } with a row-major 3x3 matrix or null.
        render(renderer, sceneTexture, bloom, settings) {
            const u = material.uniforms;
            u.tScene.value = sceneTexture;
            if (bloom) u.tBloom.value = bloom.texture;
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
            material.dispose();
        },
    };
}
