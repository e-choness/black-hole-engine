import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
    createPassMaterial,
    createRenderTarget,
    renderPass,
} from '../../graphics/post-processing.js';

export function halton(index, base) {
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

const BLEND_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform float historyWeight;
uniform float historyValid;
uniform float clipBox;
in vec2 vUv;
out vec4 fragColor;

void main() {
    vec3 current = texture(tCurrent, vUv).rgb;
    vec3 history = texture(tHistory, vUv).rgb;
    history = clamp(history, current - vec3(clipBox), current + vec3(clipBox));
    float lumaCurrent = dot(current, vec3(0.299, 0.587, 0.114));
    float lumaHistory = dot(history, vec3(0.299, 0.587, 0.114));
    float reactive = clamp(1.0 - abs(lumaCurrent - lumaHistory) * 5.0, 0.0, 1.0);
    float w = historyWeight * historyValid * reactive;
    fragColor = vec4(mix(current, history, w), 1.0);
}
`;

export function setupTemporalAA(renderer) {
    function createTarget(w, h) {
        return createRenderTarget(renderer, w, h);
    }

    var blendMat = createPassMaterial(
        {
            tCurrent: { value: null },
            tHistory: { value: null },
            historyWeight: { value: 0.0 },
            historyValid: { value: 0.0 },
            clipBox: { value: 0.08 },
        },
        BLEND_FRAGMENT_SHADER,
    );

    var pass = {
        quad: new FullScreenQuad(),
        blendMat: blendMat,
        historyRT: createTarget(1, 1),
        outputRT: createTarget(1, 1),
        historyValid: false,
        frameIndex: 0,
        jitter: new THREE.Vector2(0, 0),

        reset: function () {
            this.historyValid = false;
            this.frameIndex = 0;
        },

        resize: function (w, h) {
            this.historyRT.dispose();
            this.outputRT.dispose();
            this.historyRT = createTarget(w, h);
            this.outputRT = createTarget(w, h);
            this.reset();
        },

        nextJitter: function () {
            var idx = (this.frameIndex % 8) + 1;
            this.jitter.set(halton(idx, 2) - 0.5, halton(idx, 3) - 0.5);
            this.frameIndex++;
            return this.jitter;
        },

        render: function (rdr, currentTarget, cameraDelta, taaSettings) {
            var settings = taaSettings || {};
            var baseHistoryWeight = Math.max(
                0.0,
                Math.min(
                    0.98,
                    settings.history_weight !== undefined ? settings.history_weight : 0.88,
                ),
            );
            var baseClip = Math.max(
                0.01,
                Math.min(0.5, settings.clip_box !== undefined ? settings.clip_box : 0.06),
            );
            var motionRejection = Math.max(
                0.0,
                Math.min(
                    20.0,
                    settings.motion_rejection !== undefined ? settings.motion_rejection : 8.0,
                ),
            );
            var maxCameraDelta = Math.max(
                0.005,
                Math.min(
                    0.5,
                    settings.max_camera_delta !== undefined ? settings.max_camera_delta : 0.08,
                ),
            );
            var motionClipScale = Math.max(
                0.0,
                Math.min(
                    2.0,
                    settings.motion_clip_scale !== undefined ? settings.motion_clip_scale : 0.6,
                ),
            );

            var useHistory = this.historyValid && cameraDelta < maxCameraDelta;
            var motionAttenuation = Math.max(0.0, 1.0 - cameraDelta * motionRejection);
            var historyWeight = useHistory ? baseHistoryWeight * motionAttenuation : 0.0;
            var clip = baseClip + Math.min(cameraDelta * motionClipScale, 0.5);

            this.blendMat.uniforms.tCurrent.value = currentTarget.texture;
            this.blendMat.uniforms.tHistory.value = this.historyRT.texture;
            this.blendMat.uniforms.historyWeight.value = historyWeight;
            this.blendMat.uniforms.historyValid.value = useHistory ? 1.0 : 0.0;
            this.blendMat.uniforms.clipBox.value = clip;
            renderPass(rdr, this.quad, this.blendMat, this.outputRT);

            var tmp = this.historyRT;
            this.historyRT = this.outputRT;
            this.outputRT = tmp;
            this.historyValid = true;
            return this.historyRT.texture;
        },
    };

    return pass;
}
