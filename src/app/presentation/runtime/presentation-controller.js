// Role: Presentation timeline and recording controller.
//       Provides presets, keyframe evaluation, scripted events, annotations,
//       and realtime/offline capture hooks for slideshow-ready sequences.

import {
    camera,
    shader,
    scene,
    renderer,
    cameraControls,
} from '../../core/runtime/runtime-state.js';
import { diveState, hoverState } from '../../core/scenarios/scenario-state.js';
import { initializeCamera } from '../../scene/camera-runtime.js';
import { startDive, resetDive } from '../../core/scenarios/dive.js';
import { startHover, resetHover } from '../../core/scenarios/hover.js';
import {
    PRESENTATION_PRESETS,
    PRESENTATION_PRESET_ORDER,
    presentationPresetLoadState,
    registerPresentationPreset,
    ensurePresentationPresetsLoaded,
} from '../presets/presentation-presets.js';
import {
    presentationAnnotationState,
    presentationParamHudState,
    configurePresentationOverlay,
    syncPresentationTimelineUiConfig,
    normalizePresentationAnnotationsConfig,
    normalizePresentationParamHudConfig,
    applyPresentationTimelineUiConfig,
    setPresentationAnnotation,
    clearPresentationAnnotation,
    setPresentationAnnotationsEnabled,
    setPresentationAnnotationsIncludedInRecording,
    getPresentationAnnotationsState,
    setPresentationParamHudEnabled,
    setPresentationParamHudIncludedInRecording,
    getPresentationParamHudState,
    setParamHudLayout,
    isParamInHud,
    addParamToHud,
    removeParamFromHud,
    toggleParamInHud,
    clearParamHud,
    ensurePresentationAnnotationCanvas,
    updatePresentationOverlay,
} from './presentation-overlay.js';
import { samplePresentationTrack } from './track-sampling.js';
import {
    presentationPathNeedsCompile,
    refreshPresentationUiBindings,
    setPresentationInteractionLock,
    setPresentationPathValue,
    getPresentationPathValue,
} from './path-bindings.js';
import {
    choosePresentationMimeType,
    normalizePresentationRecordingQualityPreset,
    normalizePresentationRecordingMode,
    normalizePresentationRecordingResolutionPreset,
    resolvePresentationRecordingResolution,
    getPresentationRendererRuntimeApi,
    isRendererContextLost,
    getOfflinePresentationRecordingSupportState,
    isOfflinePresentationRecordingSupported,
    stopPresentationCaptureStreamTracks,
    downloadPresentationCaptureDataUrl,
    downloadPresentationRecordingBlob,
    createRecordingFileSink,
} from './presentation-recording-support.js';
import {
    DEFAULT_PRESENTATION_VIDEO_CONTAINER,
    PRESENTATION_VIDEO_CODECS,
    PRESENTATION_VIDEO_CONTAINERS,
    normalizePresentationVideoCodec,
    normalizePresentationVideoContainer,
} from './presentation-video-formats.js';
import {
    capturePresentationQualitySnapshot,
    restorePresentationQualitySnapshot,
    applyPresentationRecordingQualityPreset,
} from './presentation-recording-quality.js';
export {
    PRESENTATION_PRESETS,
    PRESENTATION_PRESET_ORDER,
    registerPresentationPreset,
    ensurePresentationPresetsLoaded,
    setPresentationAnnotationsEnabled,
    setPresentationAnnotationsIncludedInRecording,
    getPresentationAnnotationsState,
    setPresentationParamHudEnabled,
    setPresentationParamHudIncludedInRecording,
    getPresentationParamHudState,
    setParamHudLayout,
    isParamInHud,
    addParamToHud,
    removeParamFromHud,
    toggleParamInHud,
    clearParamHud,
    updatePresentationOverlay,
    getPresentationPathValue,
};

// ─── Presentation Timeline + Capture ─────────────────────────────────────────
// Timeline system for scripted camera/parameter animations suitable for slides
// and demos. Supports keyframed parameter tracks, timed events (dive/hover),
// and canvas recording: offline through WebCodecs and Mediabunny, realtime through
// MediaRecorder.
var presentationState = {
    active: false,
    paused: true,
    loop: false,
    time: 0.0,
    duration: 0.0,
    timeline: null,
    eventCursor: 0,
    compileRequested: false,
};

var presentationCaptureState = {
    active: false,
    starting: false,
    recorder: null,
    stream: null,
    chunks: [],
    mode: 'realtime',
    preferredMode: 'offline',
    videoContainer: DEFAULT_PRESENTATION_VIDEO_CONTAINER,
    fps: 60,
    bitrateMbps: 20.0,
    filenamePrefix: 'black-hole-presentation',
    autoStopOnPresentationEnd: true,
    mimeType: '',
    qualityPreset: 'current',
    resolutionPreset: 'current',
    outputWidth: 0,
    outputHeight: 0,
    backgroundThrottleDetected: false,
    restoreQualitySnapshot: null,
    includeAnnotationsInRecording: false,
    captureCanvas: null,
    captureCtx: null,
    compositeCanvas: null,
    compositeCtx: null,
    compositeRaf: 0,
    offlineJob: null,
    offlineUnavailableReason: '',
    rendererResizedForRecording: false,
    // Recordings without a timeline end when until() returns true; expectedFrames, when known,
    // drives their progress and time estimate.
    until: null,
    expectedFrames: 0,
    startedAtMs: 0,
    paused: false,
    pausedAtMs: 0,
    pausedTotalMs: 0,
    cancelled: false,
    // Outcome of the last recording, { id, status: 'saved' | 'failed' | 'cancelled', message }.
    result: null,
    resultCount: 0,
};

var presentationUiRefreshAccumulator = 0.0;

// Open-ended recordings stop after this much video even if their end condition never comes.
var OPEN_ENDED_RECORDING_MAX_SECONDS = 600;

function reportRecordingResult(status, message) {
    presentationCaptureState.resultCount += 1;
    presentationCaptureState.result = {
        id: presentationCaptureState.resultCount,
        status: status,
        message: message || '',
    };
}

// Wall-clock milliseconds since `startMs` that the recording was not paused.
function recordingElapsedMs(startMs) {
    if (!startMs) return 0;
    var now = presentationCaptureState.paused ? presentationCaptureState.pausedAtMs : Date.now();
    return Math.max(0, now - startMs - presentationCaptureState.pausedTotalMs);
}

function clonePresentationData(value) {
    return JSON.parse(JSON.stringify(value));
}

function presentationClamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function syncPresentationTimelineUiConfigToState() {
    if (!presentationState.timeline) return;

    var annotations = getPresentationAnnotationsState();
    var paramHud = getPresentationParamHudState();

    presentationState.timeline.loop = !!presentationState.loop;
    presentationState.timeline.annotations = {
        enabled: !!annotations.enabled,
        includeInRecording: !!annotations.includeInRecording,
    };
    presentationState.timeline.paramHud = {
        enabled: !!paramHud.enabled,
        includeInRecording: !!paramHud.includeInRecording,
        anchorX: paramHud.anchorX,
        anchorY: paramHud.anchorY,
        fontSize: paramHud.fontSize,
        items: clonePresentationData(paramHud.items),
    };
}

configurePresentationOverlay({
    onUiConfigChange: syncPresentationTimelineUiConfigToState,
    getPathValue: getPresentationPathValue,
});

function normalizePresentationTimeline(timeline) {
    if (!timeline) return null;

    var raw = clonePresentationData(timeline);
    var out = {
        name: raw.name || 'Custom',
        loop: !!raw.loop,
        duration: 0.0,
        tracks: [],
        events: [],
        annotationTracks: [],
        annotations: normalizePresentationAnnotationsConfig(raw.annotations),
        paramHud: normalizePresentationParamHudConfig(raw.paramHud),
    };

    if (Array.isArray(raw.annotationTracks)) {
        for (var ai = 0; ai < raw.annotationTracks.length; ai++) {
            var at = raw.annotationTracks[ai];
            if (at && typeof at === 'object')
                out.annotationTracks.push({ label: at.label || 'Annotation ' + (ai + 1) });
        }
    }

    var maxTime = 0.0;
    // Paths that are UI/performance meta-settings and must never be driven by
    // a timeline (they would silently override the user's chosen setting on play).
    // These are the parameters owned by the quality preset system and the still accumulation.
    var TIMELINE_EXCLUDED_PATHS = {
        quality: true,
        n_steps: true,
        sample_count: true,
        max_revolutions: true,
        rk4_integration: true,
        resolution_scale: true,
        taa_enabled: true,
        'taa.history_weight': true,
        'taa.clip_gamma': true,
        'taa.motion_rejection': true,
        'taa.max_camera_delta': true,
        'accumulation.enabled': true,
        'accumulation.max_frames': true,
    };
    function normalizeExcludedTimelinePath(path) {
        if (typeof path !== 'string') return '';
        var clean = path.trim();
        if (clean.indexOf('params.') === 0) clean = clean.substring('params.'.length);
        if (clean.indexOf('shader.parameters.') === 0) {
            clean = clean.substring('shader.parameters.'.length);
        }
        return clean;
    }

    var tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
    for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i];
        if (!track || typeof track.path !== 'string') continue;
        if (TIMELINE_EXCLUDED_PATHS[normalizeExcludedTimelinePath(track.path)]) continue;

        var keys = Array.isArray(track.keys) ? track.keys : [];
        var normalizedKeys = [];
        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            if (!key) continue;
            var t = parseFloat(key.t);
            if (!isFinite(t)) continue;
            t = Math.max(0.0, t);
            if (t > maxTime) maxTime = t;
            normalizedKeys.push({
                t: t,
                v: key.v,
                ease: key.ease || 'linear',
            });
        }
        if (!normalizedKeys.length) continue;
        normalizedKeys.sort(function (a, b) {
            return a.t - b.t;
        });
        out.tracks.push({
            path: track.path,
            compile: !!track.compile,
            keys: normalizedKeys,
        });
    }

    var events = Array.isArray(raw.events) ? raw.events : [];
    for (var j = 0; j < events.length; j++) {
        var ev = events[j];
        if (!ev || typeof ev.action !== 'string') continue;
        if (
            ev.action === 'set' &&
            typeof ev.path === 'string' &&
            TIMELINE_EXCLUDED_PATHS[normalizeExcludedTimelinePath(ev.path)]
        ) {
            continue;
        }
        var et = parseFloat(ev.t);
        if (!isFinite(et)) continue;
        et = Math.max(0.0, et);
        if (et > maxTime) maxTime = et;
        var normEv = {
            t: et,
            action: ev.action,
            path: ev.path,
            value: ev.value,
            compile: !!ev.compile,
            note: ev.note,
        };
        if (typeof ev.channel === 'number') normEv.channel = ev.channel;
        if (ev._pairOf !== undefined) normEv._pairOf = ev._pairOf;
        var extraKeys = Object.keys(ev);
        for (var ek = 0; ek < extraKeys.length; ek++) {
            var extraKey = extraKeys[ek];
            if (
                extraKey === 't' ||
                extraKey === 'action' ||
                extraKey === 'path' ||
                extraKey === 'value' ||
                extraKey === 'compile' ||
                extraKey === 'note' ||
                extraKey === 'channel' ||
                extraKey === '_pairOf'
            ) {
                continue;
            }
            if (ev[extraKey] !== undefined) {
                normEv[extraKey] = clonePresentationData(ev[extraKey]);
            }
        }
        out.events.push(normEv);
    }
    out.events.sort(function (a, b) {
        return a.t - b.t;
    });

    var duration = parseFloat(raw.duration);
    if (!isFinite(duration) || duration <= 0.0) {
        duration = maxTime;
    }
    out.duration = Math.max(duration, maxTime, 0.001);
    return out;
}

export function presentationTimelineHasTrack(path) {
    if (!presentationState.timeline || typeof path !== 'string') return false;
    var clean = path.trim();
    if (!clean) return false;

    var tracks = presentationState.timeline.tracks;
    for (var i = 0; i < tracks.length; i++) {
        if (!tracks[i] || typeof tracks[i].path !== 'string') continue;
        if (tracks[i].path.trim() === clean) return true;
    }
    return false;
}

function flushPresentationShaderCompile() {
    if (!presentationState.compileRequested) return;
    if (scene && typeof scene.updateShader === 'function') {
        scene.updateShader();
    }
    presentationState.compileRequested = false;
}

function applyPresentationTracks(timeSeconds) {
    if (!presentationState.timeline) return;

    var compileNeeded = false;
    var anyChanged = false;
    var tracks = presentationState.timeline.tracks;
    for (var i = 0; i < tracks.length; i++) {
        var track = tracks[i];
        var sampledValue = samplePresentationTrack(track, timeSeconds);
        var changed = setPresentationPathValue(track.path, sampledValue);
        if (changed) {
            anyChanged = true;
            if (track.compile || presentationPathNeedsCompile(track.path)) {
                compileNeeded = true;
            }
        }
    }

    if (compileNeeded && scene && typeof scene.updateShader === 'function') {
        scene.updateShader();
    }

    if (anyChanged) shader.needsUpdate = true;
}

function executePresentationEvent(event) {
    if (!event || !event.action) return;

    switch (event.action) {
        case 'set':
            if (typeof event.path === 'string') {
                var changed = setPresentationPathValue(event.path, event.value);
                if (changed && (event.compile || presentationPathNeedsCompile(event.path))) {
                    presentationState.compileRequested = true;
                }
                if (changed) refreshPresentationUiBindings();
            }
            break;
        case 'startDive':
            startDive({
                restart: true,
                anchorPosition: event.position,
                anchorVelocity: event.velocity,
                prevMotionState: event.prevMotionState,
                prevDistance: event.prevDistance,
                observerTime: event.observerTime,
            });
            break;
        case 'resetDive':
            resetDive();
            break;
        case 'pauseDive':
            if (diveState.active) {
                diveState.paused = true;
                diveState.timelineDriven = false;
            }
            break;
        case 'startHover':
            startHover({
                restart: true,
                anchorPosition: event.position,
                anchorVelocity: event.velocity,
                prevMotionState: event.prevMotionState,
                prevDistance: event.prevDistance,
                observerTime: event.observerTime,
            });
            break;
        case 'resetHover':
            resetHover();
            break;
        case 'pauseHover':
            if (hoverState.active) {
                hoverState.paused = true;
                hoverState.timelineDriven = false;
            }
            break;
        case 'updateShader':
            presentationState.compileRequested = true;
            break;
        case 'annotation':
            setPresentationAnnotation(event.note, event.channel || 0);
            break;
        case 'clearAnnotation':
            clearPresentationAnnotation(
                typeof event.channel === 'number' ? event.channel : undefined,
            );
            break;
    }
}

function processPresentationEvents(fromTime, toTime) {
    if (!presentationState.timeline) return;
    var events = presentationState.timeline.events;
    while (
        presentationState.eventCursor < events.length &&
        events[presentationState.eventCursor].t <= toTime + 1e-6
    ) {
        var eventTime = events[presentationState.eventCursor].t;
        if (eventTime > fromTime + 1e-6) {
            executePresentationEvent(events[presentationState.eventCursor]);
        }
        presentationState.eventCursor++;
    }
    flushPresentationShaderCompile();
}

export function setPresentationTimeline(timeline) {
    var normalized = normalizePresentationTimeline(timeline);
    if (!normalized) return false;

    presentationState.timeline = normalized;
    presentationState.loop = normalized.loop;
    presentationState.duration = normalized.duration;
    presentationState.time = 0.0;
    presentationState.eventCursor = 0;
    presentationState.compileRequested = false;
    presentationState.active = false;
    presentationState.paused = true;
    presentationUiRefreshAccumulator = 0.0;
    setPresentationInteractionLock(false);

    if (diveState.active || diveState.reachedSingularity) resetDive();
    if (hoverState.active) resetHover();
    clearPresentationAnnotation();
    applyPresentationTimelineUiConfig(normalized);

    applyPresentationTracks(0.0);
    shader.needsUpdate = true;

    // Notify bottom timeline panel (if open) to resync
    try {
        window.dispatchEvent(new CustomEvent('presentation:timeline-panel-sync'));
    } catch (e) {}

    return true;
}

export function listPresentationPresets() {
    return PRESENTATION_PRESET_ORDER.slice();
}

export function getPresentationTimeline() {
    if (!presentationState.timeline) return null;
    syncPresentationTimelineUiConfig();
    return clonePresentationData(presentationState.timeline);
}

export function loadPresentationPreset(name) {
    if (!PRESENTATION_PRESETS[name]) {
        ensurePresentationPresetsLoaded();
        return false;
    }
    var preset = clonePresentationData(PRESENTATION_PRESETS[name]);
    if (!preset.name) preset.name = name;
    return setPresentationTimeline(preset);
}

export function seekPresentation(timeSeconds) {
    if (!presentationState.timeline) return false;

    var t = parseFloat(timeSeconds);
    if (!isFinite(t)) return false;
    t = Math.max(0.0, Math.min(presentationState.duration, t));

    presentationState.time = t;
    presentationState.eventCursor = 0;

    clearPresentationAnnotation();
    if (diveState.active || diveState.reachedSingularity) resetDive();
    if (hoverState.active) resetHover();

    applyPresentationTracks(0.0);
    processPresentationEvents(-1.0, t);
    applyPresentationTracks(t);

    shader.needsUpdate = true;
    refreshPresentationUiBindings();
    return true;
}

export function playPresentation(fromStart) {
    if (!presentationState.timeline) return false;

    var shouldRestart = !!fromStart || presentationState.time >= presentationState.duration - 1e-6;
    if (shouldRestart) {
        if (typeof initializeCamera === 'function' && camera) {
            initializeCamera(camera);
            if (typeof cameraControls !== 'undefined' && cameraControls && cameraControls.target) {
                cameraControls.target.set(0, 0, 0);
            }
        }
        if (diveState.active || diveState.reachedSingularity) resetDive();
        if (hoverState.active) resetHover();
        seekPresentation(0.0);
        presentationState.eventCursor = 0;
        processPresentationEvents(-1.0, 0.0); // fire t=0 events once
        applyPresentationTracks(0.0);
    } else if (presentationState.time <= 1e-6) {
        presentationState.eventCursor = 0;
        processPresentationEvents(-1.0, 0.0);
        applyPresentationTracks(0.0);
    }

    presentationState.active = true;
    presentationState.paused = false;
    setPresentationInteractionLock(true);
    shader.needsUpdate = true;
    return true;
}

export function pausePresentation() {
    if (!presentationState.timeline) return false;
    presentationState.active = false;
    presentationState.paused = true;
    setPresentationInteractionLock(false);
    return true;
}

export function stopPresentation() {
    if (!presentationState.timeline) return false;
    presentationState.active = false;
    presentationState.paused = true;
    setPresentationInteractionLock(false);
    if (diveState.active || diveState.reachedSingularity) resetDive();
    if (hoverState.active) resetHover();
    seekPresentation(0.0);
    clearPresentationAnnotation();
    refreshPresentationUiBindings();
    return true;
}

export function setPresentationLoop(enabled) {
    presentationState.loop = !!enabled;
    syncPresentationTimelineUiConfig();
    return presentationState.loop;
}

export function getPresentationBackgroundThrottleState() {
    var visible = true;
    var focused = true;

    if (typeof document !== 'undefined') {
        if (typeof document.visibilityState === 'string') {
            visible = document.visibilityState === 'visible';
        } else if (typeof document.hidden === 'boolean') {
            visible = !document.hidden;
        }

        if (typeof document.hasFocus === 'function') {
            try {
                focused = !!document.hasFocus();
            } catch (err) {
                focused = true;
            }
        }
    }

    var throttleRisk = !visible;
    var reason = '';
    if (throttleRisk) {
        reason = 'Tab/window is hidden or minimized; browser may throttle or pause rendering.';
    }

    return {
        visible: visible,
        focused: focused,
        throttleRisk: throttleRisk,
        reason: reason,
    };
}

export function getPresentationState() {
    var offlineJob = presentationCaptureState.offlineJob;
    var backgroundState = getPresentationBackgroundThrottleState();
    if (presentationCaptureState.active && backgroundState.throttleRisk) {
        presentationCaptureState.backgroundThrottleDetected = true;
    }
    var backgroundThrottleDetected =
        !!backgroundState.throttleRisk || !!presentationCaptureState.backgroundThrottleDetected;
    var backgroundThrottleReason = backgroundState.reason || '';
    if (!backgroundThrottleReason && presentationCaptureState.backgroundThrottleDetected) {
        backgroundThrottleReason = 'Background throttling was detected during this recording.';
    }
    var offlineFramesDone = offlineJob ? offlineJob.frameCount || 0 : 0;
    var offlineFramesTotal = offlineJob ? offlineJob.totalFrames || 0 : 0;
    var offlineFramesExpected = offlineFramesTotal || presentationCaptureState.expectedFrames || 0;
    var offlineElapsedSeconds = offlineJob
        ? recordingElapsedMs(offlineJob.wallStartMs) / 1000.0
        : 0;
    var offlineSinceLastFrameSeconds = 0;
    if (offlineJob && offlineJob.lastFrameWallMs) {
        offlineSinceLastFrameSeconds = Math.max(
            0.0,
            (Date.now() - offlineJob.lastFrameWallMs) / 1000.0,
        );
    }
    var offlineRenderFps =
        offlineElapsedSeconds > 0.0 ? offlineFramesDone / offlineElapsedSeconds : 0.0;
    // An expected frame count is only an estimate, so its progress stops short of done.
    var offlineProgress =
        offlineFramesExpected > 0
            ? presentationClamp(
                  offlineFramesDone / offlineFramesExpected,
                  0.0,
                  offlineFramesTotal > 0 ? 1.0 : 0.99,
              )
            : 0.0;
    var offlineEtaSeconds = -1;
    if (offlineFramesExpected > 0 && offlineRenderFps > 1e-6) {
        offlineEtaSeconds = Math.max(
            0.0,
            (offlineFramesExpected - offlineFramesDone) / offlineRenderFps,
        );
    }
    var offlinePhase = offlineJob && offlineJob.phase ? offlineJob.phase : 'idle';
    var offlineFinalizingProgress = -1;
    var offlineEncodeBacklog = offlineJob
        ? Math.max(0, offlineJob.frameCount - offlineJob.packetsEncoded)
        : 0;
    if (offlineJob && offlinePhase === 'finalizing-encode') {
        var startBacklog = Math.max(1, offlineJob.finalizingStartBacklog || offlineEncodeBacklog);
        offlineFinalizingProgress =
            0.1 + 0.7 * (1.0 - presentationClamp(offlineEncodeBacklog / startBacklog, 0.0, 1.0));
    } else if (offlineJob && offlinePhase === 'finalizing-mux') {
        offlineFinalizingProgress = 0.9;
    } else if (offlineJob && offlinePhase === 'finalizing-download') {
        offlineFinalizingProgress = 0.97;
    } else if (offlineJob && offlinePhase === 'done') {
        offlineFinalizingProgress = 1.0;
    }

    return {
        loaded: !!presentationState.timeline,
        name: presentationState.timeline ? presentationState.timeline.name : '',
        presets_loaded: !!presentationPresetLoadState.loaded,
        presets_loading: !!presentationPresetLoadState.loading,
        playing: presentationState.active && !presentationState.paused,
        drives_observer_time: presentationTimelineHasTrack('observerState.time'),
        loop: !!presentationState.loop,
        time: presentationState.time,
        duration: presentationState.duration,
        recording: !!presentationCaptureState.active,
        recording_paused: !!presentationCaptureState.paused,
        recording_elapsed_s: recordingElapsedMs(presentationCaptureState.startedAtMs) / 1000.0,
        recording_result: presentationCaptureState.result,
        recording_mode: presentationCaptureState.mode || 'realtime',
        recording_mode_preferred: presentationCaptureState.preferredMode || 'offline',
        recording_video_container: presentationCaptureState.videoContainer,
        recording_offline_supported: isOfflinePresentationRecordingSupported(),
        recording_offline_unavailable_reason:
            presentationCaptureState.offlineUnavailableReason || '',
        recording_background_visible: !!backgroundState.visible,
        recording_background_focused: !!backgroundState.focused,
        recording_background_throttle_risk: !!backgroundState.throttleRisk,
        recording_background_throttle_detected: backgroundThrottleDetected,
        recording_background_throttle_reason: backgroundThrottleReason,
        recording_offline_phase: offlinePhase,
        recording_offline_frames_done: offlineFramesDone,
        recording_offline_frames_total: offlineFramesExpected,
        recording_offline_progress: offlineProgress,
        recording_offline_finalizing_progress: offlineFinalizingProgress,
        recording_offline_elapsed_s: offlineElapsedSeconds,
        recording_offline_since_last_frame_s: offlineSinceLastFrameSeconds,
        recording_offline_render_fps: offlineRenderFps,
        recording_offline_eta_s: offlineEtaSeconds,
        recording_offline_encode_queue: offlineEncodeBacklog,
        recording_offline_codec: offlineJob ? offlineJob.codec : '',
        recording_offline_timeline_done_s:
            offlineFramesDone / Math.max(presentationCaptureState.fps || 60, 1),
        recording_offline_timeline_total_s:
            offlineFramesTotal > 0
                ? offlineFramesTotal / Math.max(presentationCaptureState.fps || 60, 1)
                : 0,
        recording_quality_preset: presentationCaptureState.qualityPreset || 'current',
        recording_resolution_preset: presentationCaptureState.resolutionPreset || 'current',
        recording_output_width: presentationCaptureState.outputWidth || 0,
        recording_output_height: presentationCaptureState.outputHeight || 0,
        annotations_enabled: !!presentationAnnotationState.enabled,
        annotations_in_recording: !!presentationAnnotationState.includeInRecording,
        param_hud_enabled: !!presentationParamHudState.enabled,
        param_hud_in_recording: !!presentationParamHudState.includeInRecording,
        param_hud_count: presentationParamHudState.items.length,
    };
}

export function updatePresentation(dt) {
    if (!presentationState.timeline || !presentationState.active || presentationState.paused)
        return;

    var previousTime = presentationState.time;
    var nextTime = previousTime + dt;
    var duration = Math.max(presentationState.duration, 0.001);

    if (nextTime < duration) {
        processPresentationEvents(previousTime, nextTime);
        presentationState.time = nextTime;
        applyPresentationTracks(nextTime);
        if (presentationParamHudState.enabled && presentationParamHudState.items.length > 0) {
            updatePresentationOverlay();
        }
        presentationUiRefreshAccumulator += dt;
        if (presentationUiRefreshAccumulator >= 0.2) {
            presentationUiRefreshAccumulator = 0.0;
            refreshPresentationUiBindings();
        }
        return;
    }

    // Final frame of the segment
    processPresentationEvents(previousTime, duration);
    applyPresentationTracks(duration);
    if (presentationParamHudState.enabled && presentationParamHudState.items.length > 0) {
        updatePresentationOverlay();
    }

    if (presentationState.loop) {
        nextTime = nextTime % duration;
        presentationState.time = nextTime;
        presentationState.eventCursor = 0;
        processPresentationEvents(-1.0, nextTime);
        applyPresentationTracks(nextTime);
        refreshPresentationUiBindings();
        return;
    }

    presentationState.time = duration;
    presentationState.active = false;
    presentationState.paused = true;
    setPresentationInteractionLock(false);
    refreshPresentationUiBindings();

    if (presentationCaptureState.active && presentationCaptureState.autoStopOnPresentationEnd) {
        stopPresentationRecording();
    }
}

function setPresentationRendererOfflineStepping(enabled) {
    var runtimeApi = getPresentationRendererRuntimeApi();
    if (!runtimeApi) return false;
    runtimeApi.setOfflineSteppingActive(!!enabled);
    return true;
}

function stepPresentationRendererOfflineFrame(dt) {
    var runtimeApi = getPresentationRendererRuntimeApi();
    if (!runtimeApi) return false;
    runtimeApi.stepOfflineFrame(dt);
    return true;
}

function syncPresentationCompositeSize(canvas) {
    if (!canvas || !renderer || !renderer.domElement) return;
    canvas.width = Math.max(1, renderer.domElement.width || 1);
    canvas.height = Math.max(1, renderer.domElement.height || 1);
}

function ensurePresentationCaptureCanvas(width, height) {
    if (!presentationCaptureState.captureCanvas || !presentationCaptureState.captureCtx) {
        presentationCaptureState.captureCanvas = document.createElement('canvas');
        presentationCaptureState.captureCtx =
            presentationCaptureState.captureCanvas.getContext('2d');
    }

    if (!presentationCaptureState.captureCtx) return false;
    presentationCaptureState.captureCanvas.width = Math.max(1, Math.floor(width || 1));
    presentationCaptureState.captureCanvas.height = Math.max(1, Math.floor(height || 1));
    presentationCaptureState.outputWidth = presentationCaptureState.captureCanvas.width;
    presentationCaptureState.outputHeight = presentationCaptureState.captureCanvas.height;
    return true;
}

function syncPresentationCaptureCanvasForCurrentResolution() {
    if (!presentationCaptureState.captureCanvas || !renderer || !renderer.domElement) return;
    if (presentationCaptureState.resolutionPreset !== 'current') return;
    if (presentationCaptureState.active && presentationCaptureState.mode === 'offline') return;

    var width = Math.max(1, renderer.domElement.width || 1);
    var height = Math.max(1, renderer.domElement.height || 1);
    if (
        presentationCaptureState.captureCanvas.width !== width ||
        presentationCaptureState.captureCanvas.height !== height
    ) {
        presentationCaptureState.captureCanvas.width = width;
        presentationCaptureState.captureCanvas.height = height;
    }
    presentationCaptureState.outputWidth = presentationCaptureState.captureCanvas.width;
    presentationCaptureState.outputHeight = presentationCaptureState.captureCanvas.height;
}

function drawPresentationCaptureFrame() {
    if (!presentationCaptureState.captureCanvas || !presentationCaptureState.captureCtx)
        return false;
    if (!renderer || !renderer.domElement) return false;

    syncPresentationCaptureCanvasForCurrentResolution();

    var source = renderer.domElement;
    var includeOverlayInRecording =
        presentationCaptureState.includeAnnotationsInRecording ||
        (presentationParamHudState.includeInRecording &&
            presentationParamHudState.items.length > 0);
    if (includeOverlayInRecording) {
        if (
            !drawPresentationCompositeFrame(
                presentationCaptureState.compositeCanvas,
                presentationCaptureState.compositeCtx,
            )
        ) {
            return false;
        }
        source = presentationCaptureState.compositeCanvas;
    }

    var targetCanvas = presentationCaptureState.captureCanvas;
    var ctx = presentationCaptureState.captureCtx;
    var w = targetCanvas.width;
    var h = targetCanvas.height;
    ctx.clearRect(0, 0, w, h);

    var sourceWidth = Math.max(
        1,
        source.width || source.videoWidth || source.naturalWidth || source.clientWidth || w,
    );
    var sourceHeight = Math.max(
        1,
        source.height || source.videoHeight || source.naturalHeight || source.clientHeight || h,
    );

    var sourceAspect = sourceWidth / sourceHeight;
    var targetAspect = w / h;
    var epsilon = 1e-6;

    if (Math.abs(sourceAspect - targetAspect) <= epsilon) {
        ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, w, h);
        return true;
    }

    // Keep source aspect ratio when recording to a different output aspect.
    // This prevents visible flattening/stretching when, for example, recording
    // 16:10 viewport content to a 16:9 file.
    var drawWidth;
    var drawHeight;
    var drawX = 0;
    var drawY = 0;

    if (sourceAspect > targetAspect) {
        drawWidth = w;
        drawHeight = Math.max(1, Math.round(w / sourceAspect));
        drawY = Math.round((h - drawHeight) * 0.5);
    } else {
        drawHeight = h;
        drawWidth = Math.max(1, Math.round(h * sourceAspect));
        drawX = Math.round((w - drawWidth) * 0.5);
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
    return true;
}

function drawPresentationCompositeFrame(canvas, ctx) {
    if (!canvas || !ctx || !renderer || !renderer.domElement) return false;

    if (
        canvas.width !== renderer.domElement.width ||
        canvas.height !== renderer.domElement.height
    ) {
        syncPresentationCompositeSize(canvas);
    }

    if (typeof updatePresentationOverlay === 'function') {
        updatePresentationOverlay();
    }

    var w = canvas.width;
    var h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(renderer.domElement, 0, 0, w, h);
    var showOverlayCanvas =
        presentationAnnotationState.enabled ||
        (presentationParamHudState.enabled && presentationParamHudState.items.length > 0);
    if (showOverlayCanvas && presentationAnnotationState.canvas) {
        var annCanvas = presentationAnnotationState.canvas;
        var annCtx = presentationAnnotationState.ctx;
        // When the annotation canvas is a different resolution from the composite
        // (e.g. recording at 2560×1440 while the window is a different aspect ratio)
        // temporarily resize it to the composite dimensions so that text is laid out
        // at the correct positions and scale, then restore it to the window size.
        if (annCtx && (annCanvas.width !== w || annCanvas.height !== h)) {
            var savedStyleW = annCanvas.style.width;
            var savedStyleH = annCanvas.style.height;
            var savedW = annCanvas.width;
            var savedH = annCanvas.height;
            annCanvas.style.width = w + 'px';
            annCanvas.style.height = h + 'px';
            annCanvas.width = w;
            annCanvas.height = h;
            annCtx.setTransform(1, 0, 0, 1, 0, 0);
            if (typeof updatePresentationOverlay === 'function') {
                updatePresentationOverlay();
            }
            ctx.drawImage(annCanvas, 0, 0, w, h);
            // Restore annotation canvas to window dimensions for the DOM overlay.
            annCanvas.style.width = savedStyleW;
            annCanvas.style.height = savedStyleH;
            annCanvas.width = savedW;
            annCanvas.height = savedH;
            var dpr = Math.max((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1);
            annCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (typeof updatePresentationOverlay === 'function') {
                updatePresentationOverlay();
            }
        } else {
            ctx.drawImage(annCanvas, 0, 0, w, h);
        }
    }
    return true;
}

function stopPresentationCompositeCapture() {
    if (presentationCaptureState.compositeRaf) {
        cancelAnimationFrame(presentationCaptureState.compositeRaf);
    }
    presentationCaptureState.compositeRaf = 0;
    presentationCaptureState.compositeCanvas = null;
    presentationCaptureState.compositeCtx = null;
}

function clearPresentationCaptureBuffers() {
    stopPresentationCompositeCapture();
    presentationCaptureState.includeAnnotationsInRecording = false;
    presentationCaptureState.captureCanvas = null;
    presentationCaptureState.captureCtx = null;
    presentationCaptureState.outputWidth = 0;
    presentationCaptureState.outputHeight = 0;
}

function restorePresentationRendererSize() {
    if (!presentationCaptureState.rendererResizedForRecording) return;
    var restoreApi = getPresentationRendererRuntimeApi();
    if (restoreApi && typeof restoreApi.restoreWindowSizeAfterRecording === 'function') {
        restoreApi.restoreWindowSizeAfterRecording();
    }
    presentationCaptureState.rendererResizedForRecording = false;
}

function cleanupPresentationRecordingState() {
    stopPresentationCaptureStreamTracks(presentationCaptureState.stream);

    setPresentationRendererOfflineStepping(false);
    restorePresentationRendererSize();

    presentationCaptureState.active = false;
    presentationCaptureState.recorder = null;
    presentationCaptureState.stream = null;
    presentationCaptureState.chunks = [];
    clearPresentationCaptureBuffers();
    presentationCaptureState.backgroundThrottleDetected = false;
    presentationCaptureState.offlineJob = null;
    presentationCaptureState.until = null;
    presentationCaptureState.expectedFrames = 0;
    presentationCaptureState.startedAtMs = 0;
    presentationCaptureState.paused = false;
    presentationCaptureState.pausedAtMs = 0;
    presentationCaptureState.pausedTotalMs = 0;
    presentationCaptureState.cancelled = false;

    restorePresentationQualitySnapshot(presentationCaptureState.restoreQualitySnapshot);
    presentationCaptureState.restoreQualitySnapshot = null;
}

// A hardware encoder that dies without reporting an error never completes the flush inside
// Output.finalize(), so finalization fails once encoded packets stop arriving for this long.
var OFFLINE_FINALIZE_STALL_MS = 30000;

function armOfflineFinalizeWatchdog(offlineJob) {
    clearTimeout(offlineJob.finalizeWatchdog);
    offlineJob.finalizeWatchdog = setTimeout(function () {
        offlineJob.finalizeWatchdog = 0;
        if (offlineJob.onFinalizeStalled) offlineJob.onFinalizeStalled();
    }, OFFLINE_FINALIZE_STALL_MS);
}

// Called by the encoder for every frame. During finalization each packet re-arms the stall
// watchdog and the last one moves the job on to muxing.
function noteOfflinePacketEncoded(offlineJob) {
    offlineJob.packetsEncoded += 1;
    if (offlineJob.phase !== 'finalizing-encode') return;
    if (offlineJob.packetsEncoded < offlineJob.frameCount) {
        armOfflineFinalizeWatchdog(offlineJob);
        return;
    }
    clearTimeout(offlineJob.finalizeWatchdog);
    offlineJob.finalizeWatchdog = 0;
    offlineJob.phase = 'finalizing-mux';
    refreshPresentationUiBindings();
}

function finalizeOfflinePresentationRecording() {
    var offlineJob = presentationCaptureState.offlineJob;
    if (!offlineJob || offlineJob.finalizing) return;
    offlineJob.finalizing = true;

    function finishCleanup() {
        if (!offlineJob.failed) {
            offlineJob.phase = 'done';
            reportRecordingResult('saved');
        } else if (presentationCaptureState.cancelled) {
            reportRecordingResult('cancelled');
        } else {
            reportRecordingResult(
                'failed',
                offlineJob.failureMessage || 'The video could not be finished.',
            );
        }
        cleanupPresentationRecordingState();
        refreshPresentationUiBindings();
    }

    function discardOutput() {
        offlineJob.failed = true;
        offlineJob.phase = 'failed';
        offlineJob.onFinalizeStalled = null;
        clearTimeout(offlineJob.finalizeWatchdog);
        offlineJob.finalizeWatchdog = 0;
        if (offlineJob.fileSink) offlineJob.fileSink.discard();
        // cancel() waits for a pending finalize(), so cleanup does not wait for it.
        offlineJob.output.cancel().catch(function (cancelErr) {
            console.warn('Offline recording cancel failed:', cancelErr);
        });
        refreshPresentationUiBindings();
        finishCleanup();
    }

    if (offlineJob.failed) {
        discardOutput();
        return;
    }

    var backlog = Math.max(0, offlineJob.frameCount - offlineJob.packetsEncoded);
    offlineJob.finalizingStartBacklog = backlog;
    offlineJob.phase = backlog > 0 ? 'finalizing-encode' : 'finalizing-mux';
    refreshPresentationUiBindings();

    var settled = false;
    function settle(error) {
        if (settled) return;
        settled = true;
        offlineJob.onFinalizeStalled = null;
        clearTimeout(offlineJob.finalizeWatchdog);
        offlineJob.finalizeWatchdog = 0;
        if (error) {
            console.warn('Offline recording finalize failed:', error);
            offlineJob.failureMessage = error.message || '';
            discardOutput();
            return;
        }
        if (!offlineJob.fileSink) {
            offlineJob.phase = 'finalizing-download';
            refreshPresentationUiBindings();
            try {
                var buffer = offlineJob.target.buffer;
                if (buffer) {
                    downloadPresentationRecordingBlob(
                        new Blob([buffer], { type: offlineJob.mimeType }),
                        offlineJob.mimeType,
                        presentationCaptureState.filenamePrefix,
                    );
                }
            } catch (downloadErr) {
                console.warn('Offline recording download failed:', downloadErr);
                offlineJob.failureMessage = 'The video could not be downloaded.';
                offlineJob.failed = true;
                offlineJob.phase = 'failed';
            }
        }
        finishCleanup();
    }

    if (backlog > 0) {
        offlineJob.onFinalizeStalled = function () {
            settle(new Error('The video encoder stopped responding.'));
        };
        armOfflineFinalizeWatchdog(offlineJob);
    }
    if (offlineJob.fileSink) offlineJob.fileSink.finish();
    offlineJob.output.finalize().then(function () {
        settle(null);
    }, settle);
}

function runOfflinePresentationRecordingLoop() {
    var offlineJob = presentationCaptureState.offlineJob;
    if (!presentationCaptureState.active || !offlineJob) return;

    var fps = Math.max(presentationCaptureState.fps, 1);
    var frameDt = 1.0 / fps;

    function isCurrentJob() {
        return (
            presentationCaptureState.active && presentationCaptureState.offlineJob === offlineJob
        );
    }

    function abort(message, err) {
        if (err === undefined) console.warn(message);
        else console.warn(message, err);
        offlineJob.failureMessage = message.replace(/^Offline recording aborted: /, '');
        offlineJob.failed = true;
        finalizeOfflinePresentationRecording();
    }

    function reachedEnd() {
        if (offlineJob.totalFrames > 0) return offlineJob.frameCount >= offlineJob.totalFrames;
        if (presentationCaptureState.until) {
            return (
                !!presentationCaptureState.until() ||
                offlineJob.frameCount >= OPEN_ENDED_RECORDING_MAX_SECONDS * fps
            );
        }
        if (!presentationCaptureState.autoStopOnPresentationEnd) return false;
        var state = getPresentationState();
        return !!state.loaded && !state.playing;
    }

    function encodeNextFrame() {
        if (!isCurrentJob()) return;

        if (offlineJob.stopRequested || offlineJob.failed) {
            finalizeOfflinePresentationRecording();
            return;
        }
        if (isRendererContextLost()) {
            abort('Offline recording aborted: WebGL context lost (GPU driver reset / TDR).');
            return;
        }
        if (!stepPresentationRendererOfflineFrame(frameDt)) {
            abort('Offline recording aborted: renderer stepping API unavailable.');
            return;
        }
        if (!drawPresentationCaptureFrame()) {
            abort('Offline recording aborted: failed to draw capture frame.');
            return;
        }

        // add() copies the canvas synchronously; its promise settles once the encoder and the
        // writer can take another frame.
        var added;
        try {
            added = offlineJob.source.add(offlineJob.frameCount / fps, frameDt);
        } catch (addErr) {
            abort('Offline recording aborted: failed to encode frame.', addErr);
            return;
        }
        offlineJob.frameCount += 1;
        offlineJob.lastFrameWallMs = Date.now();

        added.then(
            function () {
                if (!isCurrentJob()) return;
                if (reachedEnd()) {
                    offlineJob.stopRequested = true;
                    finalizeOfflinePresentationRecording();
                    return;
                }
                // A paused job parks here until resumePresentationRecording() or a stop wakes it.
                if (
                    presentationCaptureState.paused &&
                    !offlineJob.stopRequested &&
                    !offlineJob.failed
                ) {
                    offlineJob.resume = function () {
                        setTimeout(encodeNextFrame, 0);
                    };
                    return;
                }
                // Yield between frames so the page stays responsive and the GPU is not driven
                // in long synchronous bursts, which can trigger a driver reset on long renders.
                setTimeout(encodeNextFrame, 0);
            },
            function (encodeErr) {
                if (!isCurrentJob()) return;
                abort('Offline recording aborted: failed to encode frame.', encodeErr);
            },
        );
    }

    encodeNextFrame();
}

export function capturePresentationScreenshot(options) {
    if (!renderer || !renderer.domElement) return false;
    if (presentationCaptureState.active || presentationCaptureState.starting) {
        presentationCaptureState.offlineUnavailableReason =
            'Offline screenshot capture is unavailable while recording is active.';
        refreshPresentationUiBindings();
        return false;
    }

    options = options || {};
    var qualityPreset = normalizePresentationRecordingQualityPreset(
        options.qualityPreset === undefined ? 'cinematic' : options.qualityPreset,
    );

    var resolutionPreset = normalizePresentationRecordingResolutionPreset(
        options.recordingResolution === undefined
            ? presentationCaptureState.resolutionPreset
            : options.recordingResolution,
    );
    var resolvedResolution = resolvePresentationRecordingResolution(resolutionPreset);
    var includeAnnotations =
        options.includeAnnotationsInScreenshot === undefined
            ? !!presentationAnnotationState.includeInRecording
            : !!options.includeAnnotationsInScreenshot;
    var filenamePrefix = options.filenamePrefix || 'black-hole-screenshot';
    var previousCaptureQualityPreset = presentationCaptureState.qualityPreset;
    var previousCaptureResolutionPreset = presentationCaptureState.resolutionPreset;

    var previousQualitySnapshot = capturePresentationQualitySnapshot();

    function fail(reason) {
        presentationCaptureState.offlineUnavailableReason =
            reason || 'Offline screenshot capture failed.';
        refreshPresentationUiBindings();
        return false;
    }

    if (!previousQualitySnapshot) {
        return fail('Offline screenshot capture failed: renderer quality state is unavailable.');
    }

    if (qualityPreset !== 'current' && !applyPresentationRecordingQualityPreset(qualityPreset)) {
        return fail('Offline screenshot capture failed: unable to apply Offline quality preset.');
    }

    presentationCaptureState.qualityPreset = qualityPreset;
    presentationCaptureState.resolutionPreset = resolvedResolution.preset;
    presentationCaptureState.includeAnnotationsInRecording = includeAnnotations;
    presentationCaptureState.offlineUnavailableReason = '';

    try {
        if (includeAnnotations) {
            ensurePresentationAnnotationCanvas();
            updatePresentationOverlay();
            var overlayCompositeCanvas = document.createElement('canvas');
            var overlayCompositeCtx = overlayCompositeCanvas.getContext('2d');
            if (!overlayCompositeCtx) {
                return fail(
                    'Offline screenshot capture failed: annotation compositing is unavailable.',
                );
            }
            syncPresentationCompositeSize(overlayCompositeCanvas);
            presentationCaptureState.compositeCanvas = overlayCompositeCanvas;
            presentationCaptureState.compositeCtx = overlayCompositeCtx;
        } else {
            stopPresentationCompositeCapture();
        }

        if (!ensurePresentationCaptureCanvas(resolvedResolution.width, resolvedResolution.height)) {
            return fail('Offline screenshot capture failed: capture canvas is unavailable.');
        }

        // A fixed resolution is rendered at that size rather than scaled from the window.
        if (resolvedResolution.preset !== 'current') {
            var screenshotRuntimeApi = getPresentationRendererRuntimeApi();
            if (
                screenshotRuntimeApi &&
                typeof screenshotRuntimeApi.resizeForOfflineRecording === 'function'
            ) {
                screenshotRuntimeApi.resizeForOfflineRecording(
                    resolvedResolution.width,
                    resolvedResolution.height,
                );
                presentationCaptureState.rendererResizedForRecording = true;
            }
        }

        // Render a fresh frame at the chosen quality before copying it to PNG.
        if (!stepPresentationRendererOfflineFrame(1.0 / 60.0)) {
            return fail('Offline screenshot capture failed: renderer frame API is unavailable.');
        }

        if (!drawPresentationCaptureFrame()) {
            return fail('Offline screenshot capture failed: could not read rendered pixels.');
        }

        var captureCanvas = presentationCaptureState.captureCanvas;
        if (!captureCanvas) {
            return fail('Offline screenshot capture failed: capture canvas is unavailable.');
        }

        var mimeType = 'image/png';
        var downloadStarted = false;

        if (typeof captureCanvas.toBlob === 'function') {
            captureCanvas.toBlob(function (blob) {
                if (blob && blob.size > 0) {
                    downloadPresentationRecordingBlob(blob, mimeType, filenamePrefix);
                    return;
                }
                try {
                    var fallbackUrl = captureCanvas.toDataURL(mimeType);
                    downloadPresentationCaptureDataUrl(fallbackUrl, mimeType, filenamePrefix);
                } catch (fallbackErr) {
                    console.warn('Offline screenshot fallback download failed:', fallbackErr);
                }
            }, mimeType);
            downloadStarted = true;
        } else if (typeof captureCanvas.toDataURL === 'function') {
            var dataUrl = captureCanvas.toDataURL(mimeType);
            downloadStarted = downloadPresentationCaptureDataUrl(dataUrl, mimeType, filenamePrefix);
        }

        if (!downloadStarted) {
            return fail('Offline screenshot capture failed: PNG export is unsupported.');
        }

        presentationCaptureState.offlineUnavailableReason = '';
        refreshPresentationUiBindings();
        return true;
    } catch (err) {
        console.warn('Offline screenshot capture failed:', err);
        return fail('Offline screenshot capture failed.');
    } finally {
        restorePresentationRendererSize();
        clearPresentationCaptureBuffers();
        presentationCaptureState.qualityPreset = previousCaptureQualityPreset;
        presentationCaptureState.resolutionPreset = previousCaptureResolutionPreset;
        restorePresentationQualitySnapshot(previousQualitySnapshot);
    }
}

function wakeOfflineJob(job) {
    if (!job || !job.resume) return;
    var resume = job.resume;
    job.resume = null;
    resume();
}

export function stopPresentationRecording() {
    if (!presentationCaptureState.active) return false;

    if (presentationCaptureState.mode === 'offline' && presentationCaptureState.offlineJob) {
        presentationCaptureState.offlineJob.stopRequested = true;
        wakeOfflineJob(presentationCaptureState.offlineJob);
        return true;
    }

    if (!presentationCaptureState.recorder) {
        cleanupPresentationRecordingState();
        return true;
    }

    if (presentationCaptureState.recorder.state !== 'inactive') {
        presentationCaptureState.recorder.stop();
    } else {
        cleanupPresentationRecordingState();
    }
    return true;
}

export function isPresentationRecording() {
    return !!presentationCaptureState.active;
}

export function getPresentationRecordingResult() {
    return presentationCaptureState.result;
}

// Pauses rendering or recording; the paused time counts neither towards the elapsed time nor the
// time estimate.
export function pausePresentationRecording() {
    if (!presentationCaptureState.active || presentationCaptureState.paused) return false;
    presentationCaptureState.paused = true;
    presentationCaptureState.pausedAtMs = Date.now();
    var recorder = presentationCaptureState.recorder;
    if (recorder && recorder.state === 'recording') recorder.pause();
    refreshPresentationUiBindings();
    return true;
}

export function resumePresentationRecording() {
    if (!presentationCaptureState.active || !presentationCaptureState.paused) return false;
    var pausedMs = Date.now() - presentationCaptureState.pausedAtMs;
    presentationCaptureState.pausedTotalMs += pausedMs;
    presentationCaptureState.paused = false;
    var job = presentationCaptureState.offlineJob;
    if (job) {
        if (job.lastFrameWallMs) job.lastFrameWallMs += pausedMs;
        wakeOfflineJob(job);
    }
    var recorder = presentationCaptureState.recorder;
    if (recorder && recorder.state === 'paused') recorder.resume();
    refreshPresentationUiBindings();
    return true;
}

// Stops the recording and throws away what it captured.
export function cancelPresentationRecording() {
    if (!presentationCaptureState.active) return false;
    presentationCaptureState.cancelled = true;
    var job = presentationCaptureState.offlineJob;
    if (job) {
        job.failed = true;
        wakeOfflineJob(job);
        return true;
    }
    presentationCaptureState.chunks = [];
    return stopPresentationRecording();
}

// Resolves to true once recording has started. options.writableFileStream, when given, is
// owned by the recording from then on: an offline recording closes it with the finished video
// or aborts it when it fails. It is aborted straight away when the recording does not start or
// runs in realtime, because a realtime recording is downloaded instead.
export async function startPresentationRecording(options) {
    options = options || {};
    var started = false;
    if (!presentationCaptureState.active && !presentationCaptureState.starting) {
        presentationCaptureState.starting = true;
        try {
            started = await beginPresentationRecording(options);
        } catch (err) {
            console.warn('Presentation recording failed to start:', err);
        } finally {
            presentationCaptureState.starting = false;
        }
    }
    var writesToFile = started && presentationCaptureState.mode === 'offline';
    if (options.writableFileStream && !writesToFile) {
        options.writableFileStream.abort().catch(function () {});
    }
    return started;
}

async function beginPresentationRecording(options) {
    if (!renderer || !renderer.domElement) return false;

    var fps = parseFloat(options.fps);
    if (!isFinite(fps) || fps <= 0) fps = presentationCaptureState.fps;
    fps = Math.max(10, Math.min(120, fps));

    var bitrate = parseFloat(options.bitrateMbps);
    if (!isFinite(bitrate) || bitrate <= 0) bitrate = presentationCaptureState.bitrateMbps;
    bitrate = Math.max(2.0, Math.min(80.0, bitrate));

    var includeAnnotationsInRecording =
        options.includeAnnotationsInRecording === undefined
            ? presentationAnnotationState.includeInRecording
            : !!options.includeAnnotationsInRecording;
    var includeOverlayInRecording =
        includeAnnotationsInRecording ||
        (presentationParamHudState.includeInRecording &&
            presentationParamHudState.items.length > 0);

    var requestedMode = normalizePresentationRecordingMode(
        options.recordingMode === undefined
            ? presentationCaptureState.preferredMode
            : options.recordingMode,
    );
    presentationCaptureState.preferredMode = requestedMode;
    var videoContainer = normalizePresentationVideoContainer(
        options.videoContainer === undefined
            ? presentationCaptureState.videoContainer
            : options.videoContainer,
    );
    var videoCodec = normalizePresentationVideoCodec(options.videoCodec);
    if (videoCodec) videoContainer = PRESENTATION_VIDEO_CODECS[videoCodec].container;
    presentationCaptureState.videoContainer = videoContainer;
    var until = typeof options.until === 'function' ? options.until : null;

    var recordingMode = requestedMode;
    presentationCaptureState.offlineUnavailableReason = '';

    if (recordingMode === 'offline') {
        var offlineSupportState = getOfflinePresentationRecordingSupportState();
        if (!offlineSupportState.supported) {
            presentationCaptureState.offlineUnavailableReason = offlineSupportState.reason;
            console.warn('Offline recording unavailable:', offlineSupportState.reason);
            refreshPresentationUiBindings();
            return false;
        }
        if (!presentationState.timeline && !until) {
            presentationCaptureState.offlineUnavailableReason =
                'Offline recording requires a loaded presentation timeline.';
            console.warn(
                'Offline recording unavailable:',
                presentationCaptureState.offlineUnavailableReason,
            );
            refreshPresentationUiBindings();
            return false;
        }
    } else if (typeof MediaRecorder === 'undefined') {
        presentationCaptureState.offlineUnavailableReason =
            'Realtime capture requires the MediaRecorder API.';
        refreshPresentationUiBindings();
        return false;
    }

    var qualityPreset = normalizePresentationRecordingQualityPreset(
        options.qualityPreset === undefined
            ? presentationCaptureState.qualityPreset
            : options.qualityPreset,
    );
    var resolutionPreset = normalizePresentationRecordingResolutionPreset(
        options.recordingResolution === undefined
            ? presentationCaptureState.resolutionPreset
            : options.recordingResolution,
    );
    var previousQualitySnapshot = null;
    var qualityOverridden = false;
    if (qualityPreset !== 'current') {
        previousQualitySnapshot = capturePresentationQualitySnapshot();
        qualityOverridden =
            !!previousQualitySnapshot && applyPresentationRecordingQualityPreset(qualityPreset);
        if (!qualityOverridden) {
            previousQualitySnapshot = null;
            qualityPreset = 'current';
        }
    }

    function rollbackRecordingQualityOverride() {
        if (qualityOverridden && previousQualitySnapshot) {
            restorePresentationQualitySnapshot(previousQualitySnapshot);
        }
    }

    var filenamePrefix = options.filenamePrefix || presentationCaptureState.filenamePrefix;
    var autoStop =
        options.autoStopOnPresentationEnd === undefined
            ? presentationCaptureState.autoStopOnPresentationEnd
            : !!options.autoStopOnPresentationEnd;

    var stream = null;
    var compositeTick = null;
    var recorder = null;
    var mimeType;
    var offlineJob = null;
    if (includeOverlayInRecording) {
        ensurePresentationAnnotationCanvas();
        updatePresentationOverlay();

        var overlayCompositeCanvas = document.createElement('canvas');
        var overlayCompositeCtx = overlayCompositeCanvas.getContext('2d');
        if (!overlayCompositeCtx) {
            rollbackRecordingQualityOverride();
            return false;
        }
        syncPresentationCompositeSize(overlayCompositeCanvas);
        presentationCaptureState.compositeCanvas = overlayCompositeCanvas;
        presentationCaptureState.compositeCtx = overlayCompositeCtx;
    } else {
        stopPresentationCompositeCapture();
    }

    var resolvedResolution = resolvePresentationRecordingResolution(resolutionPreset);
    if (!ensurePresentationCaptureCanvas(resolvedResolution.width, resolvedResolution.height)) {
        rollbackRecordingQualityOverride();
        return false;
    }
    presentationCaptureState.resolutionPreset = resolvedResolution.preset;
    if (!drawPresentationCaptureFrame()) {
        rollbackRecordingQualityOverride();
        return false;
    }

    if (recordingMode === 'offline') {
        var width = Math.max(1, presentationCaptureState.captureCanvas.width || 1);
        var height = Math.max(1, presentationCaptureState.captureCanvas.height || 1);
        var bitsPerSecond = Math.round(bitrate * 1000000.0);
        var containerSpec = PRESENTATION_VIDEO_CONTAINERS[videoContainer];

        var encoderModule = null;
        var codec = null;
        try {
            encoderModule = await import('./offline-video-encoder.js');
            codec = await encoderModule.selectOfflineVideoCodec(videoContainer, {
                codecs: videoCodec ? [videoCodec] : undefined,
                width: width,
                height: height,
                bitrate: bitsPerSecond,
                frameRate: fps,
            });
        } catch (probeErr) {
            console.warn('Offline recording codec probe failed:', probeErr);
        }
        if (!codec) {
            presentationCaptureState.offlineUnavailableReason =
                'This browser cannot encode ' +
                (videoCodec ? PRESENTATION_VIDEO_CODECS[videoCodec].label : containerSpec.label) +
                ' video at ' +
                width +
                '\xd7' +
                height +
                '. Choose another format or resolution.';
            rollbackRecordingQualityOverride();
            refreshPresentationUiBindings();
            return false;
        }

        // The viewport is resized only after the codec check so that a refused recording
        // leaves it untouched.
        if (resolvedResolution.preset !== 'current') {
            var offlineRuntimeApi = getPresentationRendererRuntimeApi();
            if (
                offlineRuntimeApi &&
                typeof offlineRuntimeApi.resizeForOfflineRecording === 'function'
            ) {
                offlineRuntimeApi.resizeForOfflineRecording(width, height);
                presentationCaptureState.rendererResizedForRecording = true;
            }
        }

        var fileSink = options.writableFileStream
            ? createRecordingFileSink(options.writableFileStream)
            : null;
        var job = {
            stopRequested: false,
            finalizing: false,
            failed: false,
            phase: 'preparing',
            output: null,
            source: null,
            target: null,
            fileSink: fileSink,
            mimeType: containerSpec.mimeType,
            codec: codec,
            packetsEncoded: 0,
            frameCount: 0,
            totalFrames: 0,
            totalTimelineSeconds: 0,
            wallStartMs: 0,
            lastFrameWallMs: 0,
            finalizingStartBacklog: 0,
            finalizeWatchdog: 0,
            onFinalizeStalled: null,
        };
        try {
            var video = await encoderModule.createOfflineVideoOutput({
                container: videoContainer,
                codec: codec,
                canvas: presentationCaptureState.captureCanvas,
                bitrate: bitsPerSecond,
                frameRate: fps,
                writable: fileSink ? fileSink.writable : null,
                onEncodedPacket: function () {
                    noteOfflinePacketEncoded(job);
                },
            });
            job.output = video.output;
            job.source = video.source;
            job.target = video.target;
            job.mimeType = video.mimeType;
        } catch (setupErr) {
            console.warn('Offline recording setup failed:', setupErr);
            restorePresentationRendererSize();
            presentationCaptureState.offlineUnavailableReason =
                'Failed to initialize the offline video encoder.';
            rollbackRecordingQualityOverride();
            refreshPresentationUiBindings();
            return false;
        }
        offlineJob = job;
        mimeType = job.mimeType;
    } else {
        if (
            !presentationCaptureState.captureCanvas ||
            typeof presentationCaptureState.captureCanvas.captureStream !== 'function'
        ) {
            rollbackRecordingQualityOverride();
            return false;
        }
        stream = presentationCaptureState.captureCanvas.captureStream(fps);
        compositeTick = function () {
            if (!presentationCaptureState.active) return;
            if (!drawPresentationCaptureFrame()) return;
            presentationCaptureState.compositeRaf = requestAnimationFrame(compositeTick);
        };

        mimeType = choosePresentationMimeType(videoContainer, videoCodec);
        var recorderConfig = {};
        if (mimeType) recorderConfig.mimeType = mimeType;
        recorderConfig.videoBitsPerSecond = Math.round(bitrate * 1000000.0);

        try {
            recorder = new MediaRecorder(stream, recorderConfig);
        } catch (err) {
            try {
                recorder = new MediaRecorder(stream);
                mimeType = recorder.mimeType || '';
            } catch (err2) {
                stopPresentationCaptureStreamTracks(stream);
                rollbackRecordingQualityOverride();
                return false;
            }
        }
        mimeType = mimeType || recorder.mimeType || 'video/webm';
    }

    presentationCaptureState.active = true;
    presentationCaptureState.recorder = recorder;
    presentationCaptureState.stream = stream;
    presentationCaptureState.chunks = [];
    presentationCaptureState.mode = recordingMode;
    presentationCaptureState.fps = fps;
    presentationCaptureState.bitrateMbps = bitrate;
    presentationCaptureState.filenamePrefix = filenamePrefix;
    presentationCaptureState.autoStopOnPresentationEnd = autoStop;
    presentationCaptureState.mimeType = mimeType;
    presentationCaptureState.qualityPreset = qualityPreset;
    presentationCaptureState.resolutionPreset = resolvedResolution.preset;
    presentationCaptureState.outputWidth = presentationCaptureState.captureCanvas
        ? presentationCaptureState.captureCanvas.width
        : resolvedResolution.width;
    presentationCaptureState.outputHeight = presentationCaptureState.captureCanvas
        ? presentationCaptureState.captureCanvas.height
        : resolvedResolution.height;
    presentationCaptureState.restoreQualitySnapshot = qualityOverridden
        ? previousQualitySnapshot
        : null;
    presentationCaptureState.includeAnnotationsInRecording = includeAnnotationsInRecording;
    presentationCaptureState.backgroundThrottleDetected = false;
    presentationCaptureState.offlineJob = offlineJob;
    presentationCaptureState.until = until;
    presentationCaptureState.expectedFrames = until
        ? Math.max(0, Math.round(parseFloat(options.expectedFrames) || 0))
        : 0;
    presentationCaptureState.startedAtMs = Date.now();
    presentationCaptureState.paused = false;
    presentationCaptureState.pausedTotalMs = 0;
    presentationCaptureState.cancelled = false;

    if (recordingMode === 'offline') {
        setPresentationRendererOfflineStepping(true);
        if (!until) {
            var playState = getPresentationState();
            if (playState.loaded && !playState.playing) {
                playPresentation(false);
            }
        }
        if (offlineJob) {
            var startTimelineTime = presentationState.time;
            var totalDuration = Math.max(presentationState.duration, 0.0);
            var totalTimelineSeconds;
            if (presentationCaptureState.autoStopOnPresentationEnd && !until) {
                if (presentationState.loop) {
                    totalTimelineSeconds = totalDuration;
                } else {
                    totalTimelineSeconds = Math.max(0.0, totalDuration - startTimelineTime);
                }
                if (totalTimelineSeconds <= 1e-6) totalTimelineSeconds = 1.0 / Math.max(fps, 1);
                offlineJob.totalTimelineSeconds = totalTimelineSeconds;
                offlineJob.totalFrames = Math.max(1, Math.ceil(totalTimelineSeconds * fps));
            } else {
                offlineJob.totalTimelineSeconds = 0.0;
                offlineJob.totalFrames = 0;
            }
            offlineJob.wallStartMs = Date.now();
            offlineJob.lastFrameWallMs = offlineJob.wallStartMs;
            offlineJob.phase = 'rendering';
        }
        runOfflinePresentationRecordingLoop();
        shader.needsUpdate = true;
        refreshPresentationUiBindings();
        return true;
    }

    if (compositeTick) {
        presentationCaptureState.compositeRaf = requestAnimationFrame(compositeTick);
    }

    recorder.ondataavailable = function (event) {
        if (event && event.data && event.data.size > 0) {
            presentationCaptureState.chunks.push(event.data);
        }
    };

    recorder.onstop = function () {
        var finalMime = presentationCaptureState.mimeType || 'video/webm';
        if (presentationCaptureState.cancelled) {
            reportRecordingResult('cancelled');
        } else if (presentationCaptureState.chunks.length > 0) {
            var blob = new Blob(presentationCaptureState.chunks, { type: finalMime });
            downloadPresentationRecordingBlob(
                blob,
                finalMime,
                presentationCaptureState.filenamePrefix,
            );
            reportRecordingResult('saved');
        } else {
            reportRecordingResult('failed', 'No video data was recorded.');
        }
        cleanupPresentationRecordingState();
        refreshPresentationUiBindings();
    };

    recorder.onerror = function (err) {
        console.warn('Presentation recorder error:', err);
    };

    try {
        recorder.start(250);
    } catch (startErr) {
        console.warn('Presentation recorder failed to start:', startErr);
        cleanupPresentationRecordingState();
        return false;
    }

    shader.needsUpdate = true;
    refreshPresentationUiBindings();
    return true;
}

ensurePresentationPresetsLoaded();

if (typeof window !== 'undefined') {
    window.blackHolePresentation = {
        listPresets: listPresentationPresets,
        ensurePresetsLoaded: ensurePresentationPresetsLoaded,
        loadPreset: loadPresentationPreset,
        getTimeline: getPresentationTimeline,
        setTimeline: setPresentationTimeline,
        play: playPresentation,
        pause: pausePresentation,
        stop: stopPresentation,
        seek: seekPresentation,
        setLoop: setPresentationLoop,
        state: getPresentationState,
        hasTrack: presentationTimelineHasTrack,
        setAnnotationsEnabled: setPresentationAnnotationsEnabled,
        setAnnotationsIncludedInRecording: setPresentationAnnotationsIncludedInRecording,
        annotationState: getPresentationAnnotationsState,
        showAnnotation: setPresentationAnnotation,
        clearAnnotation: clearPresentationAnnotation,
        getPathValue: getPresentationPathValue,
        setParamHudEnabled: setPresentationParamHudEnabled,
        setParamHudIncludedInRecording: setPresentationParamHudIncludedInRecording,
        paramHudState: getPresentationParamHudState,
        setParamHudLayout: setParamHudLayout,
        addParamToHud: addParamToHud,
        removeParamFromHud: removeParamFromHud,
        toggleParamInHud: toggleParamInHud,
        isParamInHud: isParamInHud,
        clearParamHud: clearParamHud,
        startRecording: startPresentationRecording,
        stopRecording: stopPresentationRecording,
        pauseRecording: pausePresentationRecording,
        resumeRecording: resumePresentationRecording,
        cancelRecording: cancelPresentationRecording,
        captureScreenshot: capturePresentationScreenshot,
    };
}
