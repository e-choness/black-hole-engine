// Temporal anti-aliasing on the HDR frame. The trace jitters every pixel by a Halton(2, 3)
// sub-pixel offset; the resolve blends the new frame into an exponential history after
// rectifying the history against the 3x3 neighbourhood of the new frame (Karis 2014; Salvi 2016).
// Without motion vectors the camera motion only lowers the history weight, and the clipping
// removes most of the ghosting it leaves. While the view is static the same history instead
// becomes an equal-weight running mean of jittered frames, which converges to the box-filtered
// pixel integral (progressive accumulation).

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
    createPassMaterial,
    createRenderTarget,
    renderPass,
} from '../../graphics/post-processing.js';

const JITTER_PHASES = 16;

function halton(index, base) {
    var f = 1.0;
    var r = 0.0;
    var i = index;
    while (i > 0) {
        f /= base;
        r += f * (i % base);
        i = Math.floor(i / base);
    }
    return r;
}

// Statistics and blending run in YCoCg on c / (1 + Y), the tonemapped weighting that keeps single
// HDR fireflies from dominating the neighbourhood moments and the resolve. The history is clipped
// towards the neighbourhood mean mu into the box mu +- gamma sigma.
const RESOLVE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform vec2 texel;
uniform float historyWeight;
uniform float clipGamma;
uniform bool accumulate;
in vec2 vUv;
out vec4 fragColor;

vec3 compress(vec3 rgb) {
    vec3 c = vec3(
        dot(rgb, vec3(0.25, 0.5, 0.25)),
        dot(rgb, vec3(0.5, 0.0, -0.5)),
        dot(rgb, vec3(-0.25, 0.5, -0.25))
    );
    return c / (1.0 + c.x);
}

vec3 expand(vec3 c) {
    c /= max(1.0 - c.x, 1e-4);
    return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

vec3 clip_towards_mean(vec3 mu, vec3 extent, vec3 history) {
    vec3 v = history - mu;
    vec3 units = abs(v) / max(extent, vec3(1e-6));
    float m = max(units.x, max(units.y, units.z));
    return m > 1.0 ? mu + v / m : history;
}

void main() {
    if (accumulate) {
        fragColor = vec4(mix(texture(tCurrent, vUv).rgb, texture(tHistory, vUv).rgb, historyWeight), 1.0);
        return;
    }
    vec3 m1 = vec3(0.0);
    vec3 m2 = vec3(0.0);
    vec3 current = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec3 s = compress(texture(tCurrent, vUv + vec2(float(x), float(y)) * texel).rgb);
            if (x == 0 && y == 0) current = s;
            m1 += s;
            m2 += s * s;
        }
    }
    vec3 mu = m1 / 9.0;
    vec3 sigma = sqrt(max(m2 / 9.0 - mu * mu, vec3(0.0)));
    vec3 history = clip_towards_mean(mu, clipGamma * sigma, compress(texture(tHistory, vUv).rgb));
    fragColor = vec4(max(expand(mix(current, history, historyWeight)), vec3(0.0)), 1.0);
}
`;

function clampSetting(value, fallback, min, max) {
    var v = value !== undefined ? value : fallback;
    return Math.max(min, Math.min(max, v));
}

export function setupTemporalAA(renderer) {
    var resolveMat = createPassMaterial(
        {
            tCurrent: { value: null },
            tHistory: { value: null },
            texel: { value: new THREE.Vector2() },
            historyWeight: { value: 0.0 },
            clipGamma: { value: 1.25 },
            accumulate: { value: false },
        },
        RESOLVE_FRAGMENT_SHADER,
    );

    var pass = {
        quad: new FullScreenQuad(),
        historyRT: createRenderTarget(renderer, 1, 1),
        outputRT: createRenderTarget(renderer, 1, 1),
        historyValid: false,
        frameIndex: 0,
        accumulatedFrames: 0,
        jitter: new THREE.Vector2(0, 0),

        reset: function () {
            this.historyValid = false;
            this.frameIndex = 0;
            this.accumulatedFrames = 0;
        },

        resize: function (w, h) {
            this.historyRT.dispose();
            this.outputRT.dispose();
            this.historyRT = createRenderTarget(renderer, w, h);
            this.outputRT = createRenderTarget(renderer, w, h);
            this.reset();
        },

        // The TAA cycles through JITTER_PHASES offsets; a still walks on along the unbounded
        // sequence, so n accumulated frames sample n distinct, evenly spread sub-pixel positions.
        nextJitter: function (still) {
            var idx = still ? this.accumulatedFrames + 1 : (this.frameIndex % JITTER_PHASES) + 1;
            this.jitter.set(halton(idx, 2) - 0.5, halton(idx, 3) - 0.5);
            this.frameIndex++;
            return this.jitter;
        },

        // Returns the resolved HDR texture.
        render: function (rdr, currentTarget, cameraDelta, taaSettings) {
            var settings = taaSettings || {};
            var baseWeight = clampSetting(settings.history_weight, 0.9, 0.0, 0.98);
            var motionRejection = clampSetting(settings.motion_rejection, 8.0, 0.0, 20.0);
            var maxCameraDelta = clampSetting(settings.max_camera_delta, 0.08, 0.005, 0.5);
            var useHistory = this.historyValid && cameraDelta < maxCameraDelta;
            var attenuation = Math.max(0.0, 1.0 - cameraDelta * motionRejection);

            var u = resolveMat.uniforms;
            u.tCurrent.value = currentTarget.texture;
            u.tHistory.value = this.historyRT.texture;
            u.texel.value.set(1 / currentTarget.width, 1 / currentTarget.height);
            u.historyWeight.value = useHistory ? baseWeight * attenuation : 0.0;
            u.clipGamma.value = clampSetting(settings.clip_gamma, 1.25, 0.25, 4.0);
            u.accumulate.value = false;
            this.accumulatedFrames = 0;
            return this.resolve(rdr);
        },

        // Adds the frame to the running mean of a static view, in linear HDR. A valid TAA history
        // seeds the mean with the weight of the 1 / (1 - w) frames it holds, so the image does not
        // fall back to a single aliased frame when the camera stops.
        accumulate: function (rdr, currentTarget, taaSettings) {
            var settings = taaSettings || {};
            var n = this.accumulatedFrames;
            if (n === 0 && this.historyValid) {
                n = Math.round(1.0 / (1.0 - clampSetting(settings.history_weight, 0.9, 0.0, 0.98)));
            }
            var u = resolveMat.uniforms;
            u.tCurrent.value = currentTarget.texture;
            u.tHistory.value = this.historyRT.texture;
            u.historyWeight.value = n / (n + 1);
            u.accumulate.value = true;
            this.accumulatedFrames = n + 1;
            return this.resolve(rdr);
        },

        resolve: function (rdr) {
            renderPass(rdr, this.quad, resolveMat, this.outputRT);
            var tmp = this.historyRT;
            this.historyRT = this.outputRT;
            this.outputRT = tmp;
            this.historyValid = true;
            return this.historyRT.texture;
        },
    };

    return pass;
}
