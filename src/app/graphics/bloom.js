// Role: Bloom post-processing pass - threshold -> multi-level mip-chain Gaussian
//       blur -> weighted composite. Approximates lens glow / optical spill from
//       bright emission. Called once during init() to build the pass; the returned
//       bloomPass object exposes render() and resize() for use in the render loop.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
    COPY_FRAGMENT_SHADER,
    createPassMaterial,
    createRenderTarget,
    renderPass,
} from './post-processing.js';

const THRESHOLD_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float threshold;
uniform float softKnee;
in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 c = texture(tDiffuse, vUv);
    float br = max(c.r, max(c.g, c.b));
    float knee = threshold * softKnee;
    float soft = br - threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 0.00001);
    float contrib = max(soft, br - threshold) / max(br, 0.00001);
    fragColor = vec4(c.rgb * contrib, 1.0);
}
`;

const BLUR_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 direction;
in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 sum = vec4(0.0);
    sum += texture(tDiffuse, vUv - 4.0 * direction) * 0.01621622;
    sum += texture(tDiffuse, vUv - 3.0 * direction) * 0.05405405;
    sum += texture(tDiffuse, vUv - 2.0 * direction) * 0.12162162;
    sum += texture(tDiffuse, vUv - 1.0 * direction) * 0.19459459;
    sum += texture(tDiffuse, vUv) * 0.22702703;
    sum += texture(tDiffuse, vUv + 1.0 * direction) * 0.19459459;
    sum += texture(tDiffuse, vUv + 2.0 * direction) * 0.12162162;
    sum += texture(tDiffuse, vUv + 3.0 * direction) * 0.05405405;
    sum += texture(tDiffuse, vUv + 4.0 * direction) * 0.01621622;
    fragColor = sum;
}
`;

// The composite is clamped to the display range: it feeds the TAA history, which must keep
// seeing the same values an 8-bit target would hold, and the canvas clamps anyway.
const COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform sampler2D tBloom3;
uniform sampler2D tBloom4;
uniform float bloomStrength;
uniform float bloomRadius;
in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 orig = texture(tDiffuse, vUv);
    float r = bloomRadius;
    float p = 1.2 + 0.8 * r;
    float w0 = 1.0;
    float w1 = 1.0 / pow(2.0, p);
    float w2 = 1.0 / pow(3.0, p);
    float w3 = 1.0 / pow(4.0, p);
    float w4 = 1.0 / pow(5.0, p);
    float wsum = w0 + w1 + w2 + w3 + w4;
    vec4 bloom = (texture(tBloom0, vUv) * w0
        + texture(tBloom1, vUv) * w1
        + texture(tBloom2, vUv) * w2
        + texture(tBloom3, vUv) * w3
        + texture(tBloom4, vUv) * w4) / wsum;
    fragColor = vec4(clamp(orig.rgb + bloom.rgb * bloomStrength, 0.0, 1.0), 1.0);
}
`;

export function setupBloom(renderer) {
    var BLOOM_LEVELS = 5;

    var thresholdMat = createPassMaterial(
        {
            tDiffuse: { value: null },
            threshold: { value: 0.65 },
            softKnee: { value: 0.5 },
        },
        THRESHOLD_FRAGMENT_SHADER,
    );

    var blurMat = createPassMaterial(
        {
            tDiffuse: { value: null },
            direction: { value: new THREE.Vector2() },
        },
        BLUR_FRAGMENT_SHADER,
    );

    var copyMat = createPassMaterial({ tDiffuse: { value: null } }, COPY_FRAGMENT_SHADER);

    var compositeMat = createPassMaterial(
        {
            tDiffuse: { value: null },
            tBloom0: { value: null },
            tBloom1: { value: null },
            tBloom2: { value: null },
            tBloom3: { value: null },
            tBloom4: { value: null },
            bloomStrength: { value: 0.35 },
            bloomRadius: { value: 0.85 },
        },
        COMPOSITE_FRAGMENT_SHADER,
    );

    function createTargets(w, h) {
        var mainRT = createRenderTarget(renderer, w, h);
        var mips = [];
        var temps = [];
        for (var i = 0; i < BLOOM_LEVELS; i++) {
            var mw = Math.max(1, Math.floor(w / Math.pow(2, i + 1)));
            var mh = Math.max(1, Math.floor(h / Math.pow(2, i + 1)));
            mips.push(createRenderTarget(renderer, mw, mh));
            temps.push(createRenderTarget(renderer, mw, mh));
        }
        return { mainRT: mainRT, mips: mips, temps: temps };
    }

    var targets = createTargets(1, 1);

    var bloomPass = {
        BLOOM_LEVELS: BLOOM_LEVELS,
        quad: new FullScreenQuad(),
        thresholdMat: thresholdMat,
        blurMat: blurMat,
        copyMat: copyMat,
        compositeMat: compositeMat,
        mainRT: targets.mainRT,
        bloomMips: targets.mips,
        bloomTemp: targets.temps,

        resize: function (w, h) {
            this.mainRT.dispose();
            for (var i = 0; i < BLOOM_LEVELS; i++) {
                this.bloomMips[i].dispose();
                this.bloomTemp[i].dispose();
            }
            var t = createTargets(w, h);
            this.mainRT = t.mainRT;
            this.bloomMips = t.mips;
            this.bloomTemp = t.temps;
        },

        render: function (rdr, mainScene, mainCamera, params, outputTarget) {
            var bp = this;

            rdr.setRenderTarget(bp.mainRT);
            rdr.render(mainScene, mainCamera);

            bp.thresholdMat.uniforms.tDiffuse.value = bp.mainRT.texture;
            bp.thresholdMat.uniforms.threshold.value = params.threshold;
            renderPass(rdr, bp.quad, bp.thresholdMat, bp.bloomMips[0]);

            for (var i = 0; i < bp.BLOOM_LEVELS; i++) {
                var mip = bp.bloomMips[i];
                var tmp = bp.bloomTemp[i];
                var mw = mip.width;
                var mh = mip.height;

                if (i > 0) {
                    bp.copyMat.uniforms.tDiffuse.value = bp.bloomMips[i - 1].texture;
                    renderPass(rdr, bp.quad, bp.copyMat, mip);
                }

                bp.blurMat.uniforms.tDiffuse.value = mip.texture;
                bp.blurMat.uniforms.direction.value.set(1.0 / mw, 0);
                renderPass(rdr, bp.quad, bp.blurMat, tmp);

                bp.blurMat.uniforms.tDiffuse.value = tmp.texture;
                bp.blurMat.uniforms.direction.value.set(0, 1.0 / mh);
                renderPass(rdr, bp.quad, bp.blurMat, mip);
            }

            bp.compositeMat.uniforms.tDiffuse.value = bp.mainRT.texture;
            for (var j = 0; j < bp.BLOOM_LEVELS; j++) {
                bp.compositeMat.uniforms['tBloom' + j].value = bp.bloomMips[j].texture;
            }
            bp.compositeMat.uniforms.bloomStrength.value = params.strength;
            bp.compositeMat.uniforms.bloomRadius.value = params.radius;
            renderPass(rdr, bp.quad, bp.compositeMat, outputTarget || null);
        },
    };

    return bloomPass;
}
