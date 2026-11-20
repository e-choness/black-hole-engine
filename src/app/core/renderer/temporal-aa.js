// Temporal anti-aliasing on the HDR frame. The trace jitters every pixel by a Halton(2, 3)
// sub-pixel offset; the resolve blends the new frame into an exponential history after
// rectifying the history against the 3x3 neighbourhood of the new frame (Karis 2014; Salvi 2016).
// Without motion vectors the camera motion only lowers the history weight, and the clipping
// removes most of the ghosting it leaves. While the view is static the same history instead
// becomes an equal-weight running mean of jittered frames, which converges to the box-filtered
// pixel integral (progressive accumulation).

import * as THREE from 'three';
import {
    Fn,
    If,
    Loop,
    abs,
    dot,
    float,
    int,
    max,
    mix,
    select,
    sqrt,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EMPTY_TEXTURE,
    createPassQuad,
    createRenderTarget,
    passMaterial,
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
function createResolveMaterial() {
    const u = {
        tCurrent: texture(EMPTY_TEXTURE),
        tHistory: texture(EMPTY_TEXTURE),
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

function clampSetting(value, fallback, min, max) {
    var v = value !== undefined ? value : fallback;
    return Math.max(min, Math.min(max, v));
}

export function setupTemporalAA() {
    var resolveMat = createResolveMaterial();

    var pass = {
        quad: createPassQuad(),
        historyRT: createRenderTarget(1, 1),
        outputRT: createRenderTarget(1, 1),
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
            this.historyRT = createRenderTarget(w, h);
            this.outputRT = createRenderTarget(w, h);
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
            u.accumulate.value = 0;
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
            u.accumulate.value = 1;
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
