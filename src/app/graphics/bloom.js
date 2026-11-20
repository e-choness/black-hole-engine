// Energy-conserving bloom after Jimenez (2014), "Next Generation Post Processing in Call of Duty:
// Advanced Warfare": a 13-tap downsample chain of the HDR frame and a 3x3 tent upsample chain.
// Each upsample step mixes a level with the upsampled coarser levels by `radius`, so level i has
// weight (1 - r) r^i (the coarsest r^(n-1)), the weights sum to one and the bloom texture keeps the
// frame's energy. The output pass forms (1 - k) scene + k bloom without any threshold.

import * as THREE from 'three';
import { Fn, dot, float, mix, select, texture, uniform, uv, vec2, vec4 } from 'three/tsl';
import {
    EMPTY_TEXTURE,
    LUMA,
    createPassQuad,
    createRenderTarget,
    passMaterial,
    renderPass,
    tent,
} from './post-processing.js';

const MAX_LEVELS = 8;

// Levels from half resolution down to a few texels, so the widest level spans a similar
// fraction of the frame at every render scale.
export function bloomLevelCount(width, height) {
    const levels = Math.floor(Math.log2(Math.max(1, Math.min(width, height)))) - 2;
    return Math.max(1, Math.min(MAX_LEVELS, levels));
}

// The first level weights its five boxes by 1 / (1 + luma) (Karis average), which keeps single
// bright pixels from flickering in the glare.
function createDownsampleMaterial() {
    const u = {
        tSource: texture(EMPTY_TEXTURE),
        texel: uniform(new THREE.Vector2()),
        karis: uniform(0),
    };
    const karisWeight = (c) => float(1.0).div(dot(c, LUMA).add(1.0));
    const node = Fn(() => {
        const p = uv();
        const at = (x, y) => u.tSource.sample(p.add(u.texel.mul(vec2(x, y)))).rgb;
        const a = at(-2, 2);
        const b = at(0, 2);
        const c = at(2, 2);
        const d = at(-2, 0);
        const e = u.tSource.sample(p).rgb.toConst();
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
            select(u.karis.greaterThan(0.5), karisWeight(boxes[n]).mul(w), float(w)).toConst(),
        );
        let sum = boxes[0].mul(weights[0]);
        let total = weights[0];
        for (let n = 1; n < 5; n++) {
            sum = sum.add(boxes[n].mul(weights[n]));
            total = total.add(weights[n]);
        }
        return vec4(sum.div(total), 1.0);
    })();
    return Object.assign(passMaterial(node), { uniforms: u });
}

function createUpsampleMaterial() {
    const u = {
        tCoarse: texture(EMPTY_TEXTURE),
        tFine: texture(EMPTY_TEXTURE),
        coarseTexel: uniform(new THREE.Vector2()),
        radius: uniform(0.7),
    };
    const node = Fn(() =>
        vec4(mix(u.tFine.sample(uv()).rgb, tent(u.tCoarse, uv(), u.coarseTexel), u.radius), 1.0),
    )();
    return Object.assign(passMaterial(node), { uniforms: u });
}

export function setupBloom() {
    const downMat = createDownsampleMaterial();
    const upMat = createUpsampleMaterial();
    const quad = createPassQuad();
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
            down.push(createRenderTarget(w, h));
            if (i < levels - 1) up.push(createRenderTarget(w, h));
        }
    }

    resize(1, 1);

    return {
        resize,
        get levels() {
            return down.length;
        },
        // Returns the half-resolution bloom level for the output pass.
        render(renderer, sourceTexture, radius) {
            let source = sourceTexture;
            for (let i = 0; i < down.length; i++) {
                const image = source.image;
                downMat.uniforms.tSource.value = source;
                downMat.uniforms.texel.value.set(1 / image.width, 1 / image.height);
                downMat.uniforms.karis.value = i === 0 ? 1 : 0;
                renderPass(renderer, quad, downMat, down[i]);
                source = down[i].texture;
            }
            upMat.uniforms.radius.value = Math.min(Math.max(radius, 0), 1);
            let coarse = down[down.length - 1];
            for (let i = down.length - 2; i >= 0; i--) {
                upMat.uniforms.tCoarse.value = coarse.texture;
                upMat.uniforms.tFine.value = down[i].texture;
                upMat.uniforms.coarseTexel.value.set(1 / coarse.width, 1 / coarse.height);
                renderPass(renderer, quad, upMat, up[i]);
                coarse = up[i];
            }
            return coarse;
        },
        dispose() {
            disposeTargets();
            downMat.dispose();
            upMat.dispose();
        },
    };
}
