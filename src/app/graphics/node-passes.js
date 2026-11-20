// Node-material (TSL) versions of the full-screen passes for three's WebGPURenderer, which runs
// them on WebGPU or on its WebGL 2 backend. bloom.js, temporal-aa.js and output-pass.js use them
// in place of their GLSL materials when the canvas has a WebGPURenderer.

import * as THREE from 'three';
import { MeshBasicNodeMaterial, QuadMesh, RenderTarget } from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    abs,
    acesFilmicToneMapping,
    agxToneMapping,
    clamp,
    dot,
    float,
    int,
    log2,
    max,
    mix,
    neutralToneMapping,
    screenCoordinate,
    select,
    sRGBTransferOETF,
    sqrt,
    texture,
    uint,
    uniform,
    uv,
    uvec3,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

const EMPTY = new THREE.Texture();
const LUMA = vec3(0.2126729, 0.7151522, 0.072175);

// Every WebGPU adapter renders to RGBA16F, and three's WebGL 2 backend enables the colour-buffer
// float extensions it needs for the same targets.
export function createNodeRenderTarget(width, height) {
    return new RenderTarget(Math.max(1, width), Math.max(1, height), {
        type: THREE.HalfFloatType,
        depthBuffer: false,
    });
}

function passMaterial(node) {
    const material = new MeshBasicNodeMaterial();
    material.fragmentNode = node;
    material.depthTest = false;
    material.depthWrite = false;
    return material;
}

// Draws `material` into `target`, or into the canvas when `target` is null.
export function drawNodePass(renderer, quad, material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
}

// 3x3 tent filter of `map` with texel size `texel` around `p`.
function tent(map, p, texel) {
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

// --- Bloom (bloom.js describes the method) ---------------------------------------------------

// The downsample and upsample materials with their uniforms.
export function createNodeBloomMaterials() {
    const down = {
        tSource: texture(EMPTY),
        texel: uniform(new THREE.Vector2()),
        karis: uniform(0),
    };
    const karisWeight = (c) => float(1.0).div(dot(c, LUMA).add(1.0));
    const downNode = Fn(() => {
        const p = uv();
        const at = (x, y) => down.tSource.sample(p.add(down.texel.mul(vec2(x, y)))).rgb;
        const a = at(-2, 2);
        const b = at(0, 2);
        const c = at(2, 2);
        const d = at(-2, 0);
        const e = down.tSource.sample(p).rgb.toConst();
        const f = at(2, 0);
        const g = at(-2, -2);
        const h = at(0, -2);
        const i = at(2, -2);
        const j = at(-1, 1);
        const k = at(1, 1);
        const l = at(-1, -1);
        const m = at(1, -1);
        // Centre box (weight 0.5) and the four overlapping corner boxes (0.125 each).
        const boxes = [
            j.add(k).add(l).add(m),
            a.add(b).add(d).add(e),
            b.add(c).add(e).add(f),
            d.add(e).add(g).add(h),
            e.add(f).add(h).add(i),
        ].map((box) => box.mul(0.25).toConst());
        const weights = [0.5, 0.125, 0.125, 0.125, 0.125].map((w, n) =>
            select(down.karis.greaterThan(0.5), karisWeight(boxes[n]).mul(w), float(w)).toConst(),
        );
        let sum = boxes[0].mul(weights[0]);
        let total = weights[0];
        for (let n = 1; n < 5; n++) {
            sum = sum.add(boxes[n].mul(weights[n]));
            total = total.add(weights[n]);
        }
        return vec4(sum.div(total), 1.0);
    })();

    const up = {
        tCoarse: texture(EMPTY),
        tFine: texture(EMPTY),
        coarseTexel: uniform(new THREE.Vector2()),
        radius: uniform(0.7),
    };
    const upNode = Fn(() =>
        vec4(
            mix(up.tFine.sample(uv()).rgb, tent(up.tCoarse, uv(), up.coarseTexel), up.radius),
            1.0,
        ),
    )();

    return {
        downMat: Object.assign(passMaterial(downNode), { uniforms: down }),
        upMat: Object.assign(passMaterial(upNode), { uniforms: up }),
    };
}

// --- Temporal AA resolve (temporal-aa.js describes the method) ---------------------------

export function createNodeResolveMaterial() {
    const u = {
        tCurrent: texture(EMPTY),
        tHistory: texture(EMPTY),
        texel: uniform(new THREE.Vector2()),
        historyWeight: uniform(0.0),
        clipGamma: uniform(1.25),
        accumulate: uniform(0),
    };
    const compress = (rgb) => {
        const c = vec3(
            dot(rgb, vec3(0.25, 0.5, 0.25)),
            dot(rgb, vec3(0.5, 0.0, -0.5)),
            dot(rgb, vec3(-0.25, 0.5, -0.25)),
        ).toConst();
        return c.div(c.x.add(1.0));
    };
    const expand = (compressed) => {
        const c = compressed.div(max(float(1.0).sub(compressed.x), 1e-4)).toConst();
        return vec3(c.x.add(c.y).sub(c.z), c.x.add(c.z), c.x.sub(c.y).sub(c.z));
    };
    // Running mean of a static view.
    const accumulateNode = (p) =>
        mix(u.tCurrent.sample(p).rgb, u.tHistory.sample(p).rgb, u.historyWeight);
    // TAA blend of the rectified history into the new frame.
    const resolveNode = (p) => {
        const m1 = vec3(0.0).toVar();
        const m2 = vec3(0.0).toVar();
        const current = vec3(0.0).toVar();
        Loop({ start: int(-1), end: int(1), condition: '<=' }, ({ i: y }) => {
            Loop({ start: int(-1), end: int(1), condition: '<=' }, ({ i: x }) => {
                const offset = vec2(float(x), float(y)).mul(u.texel);
                const s = compress(u.tCurrent.sample(p.add(offset)).rgb).toConst();
                If(x.equal(0).and(y.equal(0)), () => {
                    current.assign(s);
                });
                m1.addAssign(s);
                m2.addAssign(s.mul(s));
            });
        });
        const mu = m1.div(9.0).toConst();
        const sigma = sqrt(max(m2.div(9.0).sub(mu.mul(mu)), vec3(0.0)));
        // History clipped towards the neighbourhood mean into the box mu +- gamma sigma.
        const history = compress(u.tHistory.sample(p).rgb).toConst();
        const v = history.sub(mu).toConst();
        const units = abs(v)
            .div(max(sigma.mul(u.clipGamma), vec3(1e-6)))
            .toConst();
        const m = max(units.x, max(units.y, units.z)).toConst();
        const clipped = select(m.greaterThan(1.0), mu.add(v.div(m)), history);
        return max(expand(mix(current, clipped, u.historyWeight)), vec3(0.0));
    };
    const node = Fn(() => {
        const p = uv();
        const result = vec3(0.0).toVar();
        If(u.accumulate.greaterThan(0.5), () => {
            result.assign(accumulateNode(p));
        }).Else(() => {
            result.assign(resolveNode(p));
        });
        return vec4(result, 1.0);
    })();
    return Object.assign(passMaterial(node), { uniforms: u });
}

// --- Output (output-pass.js describes the method) -----------------------------------------

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

export function createNodeOutputMaterial({
    toneMappers,
    infernoCoefficients,
    scientificLog2Max,
    scientificStops,
}) {
    const u = {
        tScene: texture(EMPTY),
        tBloom: texture(EMPTY),
        bloomTexel: uniform(new THREE.Vector2(1, 1)),
        bloomStrength: uniform(0),
        whiteBalance: uniform(new THREE.Matrix3()),
        toneMapper: uniform(toneMappers.agx),
        scientificLog2Max: uniform(scientificLog2Max),
        scientificStops: uniform(scientificStops),
        frameIndex: uniform(0, 'uint'),
    };
    const inferno = (t) => {
        const last = infernoCoefficients.length - 1;
        let v = vec3(...infernoCoefficients[last]);
        for (let n = last - 1; n >= 0; n--) v = v.mul(t).add(vec3(...infernoCoefficients[n]));
        return v;
    };
    // Triangular-PDF noise of +-1 LSB per channel, re-seeded every frame.
    const tpdfDither = () => {
        const seed = uvec3(
            uint(screenCoordinate.x),
            uint(screenCoordinate.y),
            u.frameIndex,
        ).toConst();
        const salt = uvec3(uint(0x9e3779b9), uint(0x7f4a7c15), uint(0x85ebca6b));
        const a = vec3(pcg3d(seed)).mul(1.0 / 4294967296.0);
        const b = vec3(pcg3d(seed.bitXor(salt))).mul(1.0 / 4294967296.0);
        return a
            .add(b)
            .sub(1.0)
            .mul(1.0 / 255.0);
    };
    const node = Fn(() => {
        const p = uv();
        const color = u.tScene.sample(p).rgb.toVar();
        If(u.bloomStrength.greaterThan(0.0), () => {
            color.assign(mix(color, tent(u.tBloom, p, u.bloomTexel), u.bloomStrength));
        });
        color.assign(max(u.whiteBalance.mul(color), vec3(0.0)));
        const display = vec3(0.0).toVar();
        If(u.toneMapper.equal(toneMappers.scientific), () => {
            // False colour: log2 luminance over a fixed window of stops, through Inferno.
            const y = dot(color, LUMA);
            const t = log2(max(y, 1e-12)).sub(u.scientificLog2Max).div(u.scientificStops).add(1.0);
            display.assign(clamp(inferno(clamp(t, 0.0, 1.0)), 0.0, 1.0));
        }).Else(() => {
            const mapped = vec3(0.0).toVar();
            If(u.toneMapper.equal(toneMappers.agx), () => {
                mapped.assign(agxToneMapping(color, float(1.0)));
            })
                .ElseIf(u.toneMapper.equal(toneMappers.neutral), () => {
                    mapped.assign(neutralToneMapping(color, float(1.0)));
                })
                .Else(() => {
                    mapped.assign(acesFilmicToneMapping(color, float(1.0)));
                });
            display.assign(sRGBTransferOETF(clamp(mapped, 0.0, 1.0)));
        });
        return vec4(display.add(tpdfDither()), 1.0);
    })();
    return Object.assign(passMaterial(node), { uniforms: u });
}

export function createNodeQuad(material) {
    return new QuadMesh(material);
}
