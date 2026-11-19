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
    var taaEnabled = !!shader.parameters.taa_enabled && !!taaPass;
    if (shaderUniforms && shaderUniforms.taa_jitter) {
        if (taaEnabled) {
            var jitter = taaPass.nextJitter();
            shaderUniforms.taa_jitter.value.set(jitter.x, jitter.y);
        } else {
            shaderUniforms.taa_jitter.value.set(0, 0);
        }
    }

    updateUniforms();

    // Trace into the HDR target, resolve it temporally, then glare and tone map it.
    renderer.setRenderTarget(hdrTarget);
    renderer.render(scene, camera);
    var resolved = hdrTarget.texture;
    if (taaEnabled) {
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
