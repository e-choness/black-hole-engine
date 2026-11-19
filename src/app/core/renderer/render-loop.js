import * as THREE from 'three';
import {
    renderer,
    camera,
    scene,
    stats,
    shader,
    observer,
    bloomPass,
    taaPass,
    outputPass,
    hdrTarget,
    shaderUniforms,
    lastTaaCameraMat,
    rendererContextLost,
    updateUniforms,
    resetTemporalAAHistory,
} from '../runtime/runtime-state.js';
import { diveState, hoverState } from '../scenarios/scenario-state.js';
import {
    updatePresentation,
    getPresentationState,
    updatePresentationOverlay,
} from '../../presentation/runtime/presentation-controller.js';
import { updateDive, advanceTimelineDrivenDiveObserverTime } from '../scenarios/dive.js';
import { updateHover, advanceTimelineDrivenHoverObserverTime } from '../scenarios/hover.js';
import { updateCamera, frobeniusDistance } from '../../scene/camera-runtime.js';
import { advanceQualityBenchmark } from './renderer-quality.js';
import { updateAnimationTimelineCaptureFrame } from '../scenarios/animation-capture.js';
import { resizePasses, resizeRendererAndPasses, updateAxesGizmo } from './renderer.js';
import { whiteBalance } from '../physics/emission.js';
import { registerBlackHoleRuntimeApi } from '../runtime/runtime-registry.js';
import { isE2eMode, notifyFrameRendered } from '../runtime/test-hooks.js';

var lastCameraMat = new THREE.Matrix4().identity();
var resetRendererFrameClock = function () {};
var rendererOfflineSteppingActive = false;

// Uniforms that change from frame to frame without changing the converged image: the sub-pixel
// jitter always, and the simulation clock when nothing in the scene moves with it.
var STILL_IGNORED = { taa_jitter: true };
var STILL_IGNORED_TIMELESS = { taa_jitter: true, time: true };
var stillSignature = [];
var nextStillSignature = [];

function pushUniformValue(out, value) {
    if (typeof value === 'number') {
        out.push(value);
    } else if (typeof value === 'boolean') {
        out.push(value ? 1 : 0);
    } else if (value && value.isTexture) {
        out.push(value.id, value.version);
    } else if (value && typeof value.toArray === 'function') {
        Array.prototype.push.apply(out, value.toArray());
    } else if (Array.isArray(value)) {
        value.forEach(function (item) {
            pushUniformValue(out, item);
        });
    }
}

// True when every ray-tracer uniform that shapes the image (camera included) equals its value in
// the previous frame, so the new frame differs from the last one only by its jitter.
function viewUnchanged(uniforms, ignored) {
    var next = nextStillSignature;
    next.length = 0;
    for (var name in uniforms) {
        if (!ignored[name]) pushUniformValue(next, uniforms[name].value);
    }
    var previous = stillSignature;
    var same =
        next.length === previous.length &&
        next.every(function (value, i) {
            return Object.is(value, previous[i]);
        });
    nextStillSignature = previous;
    stillSignature = next;
    return same;
}

// A static view keeps rendering until its running mean holds the configured number of frames.
function stillRefining() {
    var accumulation = shader.parameters.accumulation;
    return !!(
        taaPass &&
        accumulation.enabled &&
        taaPass.accumulatedFrames < accumulation.max_frames
    );
}

var getFrameDuration = (function () {
    var MAX_FRAME_DT = 0.1;
    var nowFn =
        typeof performance !== 'undefined' && performance.now
            ? function () {
                  return performance.now();
              }
            : function () {
                  return new Date().getTime();
              };
    var lastTimestamp = nowFn();

    function resetClock() {
        lastTimestamp = nowFn();
    }
    resetRendererFrameClock = resetClock;

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) resetClock();
    });
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) resetClock();
    });

    return function () {
        if (isE2eMode) return 0.0;
        var now = nowFn();
        var diff = (now - lastTimestamp) / 1000.0;
        lastTimestamp = now;
        return Math.min(diff, MAX_FRAME_DT);
    };
})();

function stepRendererSimulation(dt, skipBenchmark) {
    var presentationRuntimeState = getPresentationState();
    if (presentationRuntimeState && presentationRuntimeState.playing) {
        updatePresentation(dt);
    }
    var presentationDrivesObserverTime = !!(
        presentationRuntimeState &&
        presentationRuntimeState.playing &&
        presentationRuntimeState.drives_observer_time
    );
    if (diveState.active && !diveState.reachedSingularity) {
        if (!diveState.paused && !diveState.timelineDriven) {
            updateDive(dt);
        } else if (
            diveState.timelineDriven &&
            presentationRuntimeState &&
            presentationRuntimeState.playing &&
            !presentationDrivesObserverTime
        ) {
            advanceTimelineDrivenDiveObserverTime(dt);
        }
        if (!diveState.paused || diveState.timelineDriven) {
            updateCamera();
        }
    } else if (hoverState.active) {
        if (!hoverState.paused && !hoverState.timelineDriven) {
            updateHover(dt);
        } else if (
            hoverState.timelineDriven &&
            presentationRuntimeState &&
            presentationRuntimeState.playing &&
            !presentationDrivesObserverTime
        ) {
            advanceTimelineDrivenHoverObserverTime(dt);
        }
        if (!hoverState.paused || hoverState.timelineDriven) {
            updateCamera();
        }
    } else {
        observer.move(dt);
        if (shader.parameters.observer.motion) updateCamera();
    }
    if (!skipBenchmark) {
        advanceQualityBenchmark(dt);
    }
}

function drawRendererFrame(forceRender) {
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    updatePresentationOverlay();

    if (
        forceRender ||
        shader.needsUpdate ||
        shader.hasMovingParts() ||
        stillRefining() ||
        frobeniusDistance(camera.matrixWorldInverse, lastCameraMat) > 1e-10
    ) {
        shader.needsUpdate = false;
        render();
        lastCameraMat = camera.matrixWorldInverse.clone();
    }
    stats.update();
}

export function setRendererOfflineSteppingActive(active) {
    rendererOfflineSteppingActive = !!active;
    if (!rendererOfflineSteppingActive) {
        resetRendererFrameClock();
    }
}

export function stepRendererForOfflineRecording(dt) {
    var frameDt = parseFloat(dt);
    if (!isFinite(frameDt) || frameDt <= 0) frameDt = 1.0 / 60.0;
    stepRendererSimulation(frameDt, true);
    drawRendererFrame(true);
}

export function animate() {
    requestAnimationFrame(animate);

    if (rendererOfflineSteppingActive) {
        stats.update();
        return;
    }

    var dt = getFrameDuration();
    stepRendererSimulation(dt, false);
    updateAnimationTimelineCaptureFrame();
    drawRendererFrame(false);
}

function render() {
    updateUniforms();

    // A static view accumulates jittered frames into a still; once it holds max_frames frames the
    // trace is skipped and the finished mean is shown. Otherwise TAA, when enabled, resolves the
    // jittered frame.
    var taaEnabled = !!shader.parameters.taa_enabled && !!taaPass;
    var accumulation = shader.parameters.accumulation;
    var unchanged = viewUnchanged(
        shaderUniforms,
        shader.hasMovingParts() ? STILL_IGNORED : STILL_IGNORED_TIMELESS,
    );
    var still = !!taaPass && accumulation.enabled && unchanged;
    var converged = still && taaPass.accumulatedFrames >= accumulation.max_frames;

    // Trace into the HDR target, resolve it temporally, then glare and tone map it.
    if (!converged) {
        var jitter = still || taaEnabled ? taaPass.nextJitter(still) : null;
        shaderUniforms.taa_jitter.value.set(jitter ? jitter.x : 0, jitter ? jitter.y : 0);
        renderer.setRenderTarget(hdrTarget);
        renderer.render(scene, camera);
    }
    var resolved = hdrTarget.texture;
    if (converged) {
        resolved = taaPass.historyRT.texture;
    } else if (still) {
        resolved = taaPass.accumulate(renderer, hdrTarget, shader.parameters.taa);
    } else if (taaEnabled) {
        resolved = taaPass.render(
            renderer,
            hdrTarget,
            frobeniusDistance(camera.matrixWorldInverse, lastTaaCameraMat),
            shader.parameters.taa,
        );
    } else if (taaPass && taaPass.historyValid) {
        taaPass.reset();
    }
    lastTaaCameraMat.copy(camera.matrixWorldInverse);

    var bloomSettings = shader.parameters.bloom;
    var bloom = null;
    if (bloomSettings.enabled && bloomSettings.strength > 0 && bloomPass) {
        var level = bloomPass.render(renderer, resolved, bloomSettings.radius);
        bloom = {
            texture: level.texture,
            width: level.width,
            height: level.height,
            strength: bloomSettings.strength,
        };
    }
    outputPass.render(renderer, resolved, bloom, {
        toneMapper: shader.parameters.look.tone_mapper,
        whiteBalance: whiteBalance(shader.parameters.look),
    });
    updateAxesGizmo();
    notifyFrameRendered();
}

export var blackHoleRendererRuntime = {
    setOfflineSteppingActive: setRendererOfflineSteppingActive,
    stepOfflineFrame: stepRendererForOfflineRecording,
    resetFrameClock: function () {
        resetRendererFrameClock();
    },
    isContextLost: function () {
        return rendererContextLost;
    },
    resizeForOfflineRecording: function (w, h) {
        if (!renderer) return false;
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        renderer.domElement.style.objectFit = 'contain';
        resizePasses(renderer.domElement.width, renderer.domElement.height);
        if (camera) {
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        var taaWarmupFrames = shader.parameters.taa_enabled ? 64 : 0;
        for (var i = 0; i < taaWarmupFrames; i++) {
            drawRendererFrame(true);
        }
        return true;
    },
    restoreWindowSizeAfterRecording: function () {
        renderer.domElement.style.objectFit = '';
        resizeRendererAndPasses();
        resetTemporalAAHistory();
        if (camera) {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        }
    },
};

window.blackHoleRendererRuntime = blackHoleRendererRuntime;
registerBlackHoleRuntimeApi('renderer', blackHoleRendererRuntime);
