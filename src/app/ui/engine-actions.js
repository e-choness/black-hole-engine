// Engine operations shared by every control surface: scenario and quality presets, the solver
// switch, observer motion and distance, and the change notifications that keep controls in sync
// when presets, timeline playback or scenarios mutate shader.parameters behind their back.

import {
    shader,
    scene,
    cameraControls,
    cameraPan,
    observer,
    applyRenderScaleFromSettings,
    resetTemporalAAHistory,
    setRefreshAllControllersGlobal,
    updateUniforms,
} from '../core/runtime/runtime-state.js';
import { clampObserverDistance } from '../core/observer.js';
import {
    DEFAULT_VIEW_INCLINATION,
    setViewInclination,
    updateCamera,
} from '../scene/camera-runtime.js';
import { applyQualityPresetValues, QUALITY_PRESETS, KERR_MODE_LABELS } from './quality-presets.js';
import { BH_PRESETS } from './presets.js';
import { registerBlackHoleUiBinding } from '../core/runtime/runtime-registry.js';

export const CUSTOM_PRESET = 'Custom';

const listeners = new Set();
const presetListeners = new Set();
let noticeHandler = null;
let activePreset = 'Default';
let basePreset = 'Default';
let blackHoleCustomState = null;
let qualityCustomState = null;
let pausedTimeScale = null;

function params() {
    return shader.parameters;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

// Listeners run synchronously; they are cheap (controls re-read their values lazily).
export function notifyEngineChanged() {
    listeners.forEach((listener) => listener());
}

export function subscribeEngineChanges(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Fired after a named scenario ('scenario') or quality preset ('quality') has been applied, before
// the change notification, so listeners can take the new values as their reference.
export function subscribePresetApplied(listener) {
    presetListeners.add(listener);
    return () => presetListeners.delete(listener);
}

function presetApplied(kind) {
    presetListeners.forEach((listener) => listener(kind));
}

export function setEngineNoticeHandler(handler) {
    noticeHandler = handler;
}

function engineNotice(text, options) {
    if (noticeHandler) noticeHandler(text, options || {});
}

export function getBlackHolePresetName() {
    return activePreset;
}

// The named scenario the current values started from, also while they are customised.
export function getBaseBlackHolePresetName() {
    return basePreset;
}

function captureQualityPresetState() {
    const p = params();
    return {
        n_steps: p.n_steps,
        sample_count: p.sample_count,
        max_revolutions: p.max_revolutions,
        rk4_integration: p.rk4_integration,
        resolution_scale: p.resolution_scale,
        taa_enabled: p.taa_enabled,
        taa: clone(p.taa),
    };
}

function restoreQualityPresetState(state) {
    if (!state) return;
    const p = params();
    p.n_steps = state.n_steps;
    p.sample_count = state.sample_count;
    p.max_revolutions = state.max_revolutions;
    p.rk4_integration = state.rk4_integration;
    p.resolution_scale = state.resolution_scale;
    p.taa_enabled = state.taa_enabled;
    Object.assign(p.taa, state.taa);
}

// Everything a black-hole preset sets, so "Custom" can come back after a preset was tried.
function captureBlackHolePresetState() {
    const p = params();
    return {
        black_hole: clone(p.black_hole),
        accretion_disk: p.accretion_disk,
        accretion_mode: p.accretion_mode,
        disk_temperature: p.disk_temperature,
        disk: clone(p.disk),
        torus: clone(p.torus),
        slim: clone(p.slim),
        jet: clone(p.jet),
        grmhd: clone(p.grmhd),
        beaming: p.beaming,
        physical_beaming: p.physical_beaming,
        doppler_shift: p.doppler_shift,
        look: {
            disk_gain: p.look.disk_gain,
            glow: p.look.glow,
            galaxy_gain: p.look.galaxy_gain,
            tone_mapper: p.look.tone_mapper,
            white_balance_enabled: p.look.white_balance_enabled,
            white_balance_k: p.look.white_balance_k,
        },
        bloom: clone(p.bloom),
    };
}

function restoreBlackHolePresetState(state) {
    if (!state) return;
    const p = params();
    Object.assign(p.black_hole, state.black_hole);
    p.accretion_disk = state.accretion_disk;
    p.accretion_mode = state.accretion_mode;
    p.disk_temperature = state.disk_temperature;
    Object.assign(p.disk, state.disk);
    Object.assign(p.torus, state.torus);
    Object.assign(p.slim, state.slim);
    Object.assign(p.jet, state.jet);
    Object.assign(p.grmhd, state.grmhd);
    p.beaming = state.beaming;
    p.physical_beaming = state.physical_beaming;
    p.doppler_shift = state.doppler_shift;
    Object.assign(p.look, state.look);
    Object.assign(p.bloom, state.bloom);
}

export function markBlackHolePresetCustom() {
    blackHoleCustomState = captureBlackHolePresetState();
    activePreset = CUSTOM_PRESET;
}

export function markQualityPresetCustom() {
    qualityCustomState = captureQualityPresetState();
    params().quality = 'custom';
}

// Mobile quality hides the planet: it is not rendered there (Shader.planetEnabled()).
export function planetAvailable() {
    const preset = QUALITY_PRESETS[params().quality];
    return !(preset && preset.hide_planet_controls);
}

function applyQualityPresetInternal(value, selectSolver) {
    const p = params();
    if (value === 'custom') {
        restoreQualityPresetState(qualityCustomState);
    } else if (!applyQualityPresetValues(p, value, { selectSolver: !!selectSolver })) {
        return;
    }
    applyRenderScaleFromSettings();
    resetTemporalAAHistory();
    scene.updateShader();
    if (value !== 'custom') presetApplied('quality');
    notifyEngineChanged();
}

// Picking a preset also picks its preferred solver; re-applying it after a solver change keeps
// the solver and only refreshes the step budget that depends on it.
export function applyQualityPreset(value) {
    applyQualityPresetInternal(value, true);
    if (value === 'custom') qualityCustomState = captureQualityPresetState();
}

export function applyKerrMode(mode) {
    params().kerr_mode = mode;
    applyQualityPresetInternal(params().quality, false);
    const label = Object.keys(KERR_MODE_LABELS).find((key) => KERR_MODE_LABELS[key] === mode);
    engineNotice('Solver: ' + (label || mode), { kind: 'solver' });
}

export function applyBlackHolePreset(name) {
    const p = params();
    if (name === CUSTOM_PRESET) {
        restoreBlackHolePresetState(blackHoleCustomState);
        activePreset = CUSTOM_PRESET;
        updateCamera();
        scene.updateShader();
        notifyEngineChanged();
        return;
    }
    const preset = BH_PRESETS[name];
    if (!preset) return;

    p.black_hole.spin_enabled = preset.spin_enabled;
    p.black_hole.spin = preset.spin;
    p.black_hole.spin_strength = preset.spin_strength;
    p.accretion_disk = preset.accretion_disk;
    p.accretion_mode = preset.accretion_mode;
    p.disk_temperature = preset.disk_temperature;
    if (preset.disk) Object.assign(p.disk, preset.disk);
    Object.assign(p.torus, preset.torus);
    Object.assign(p.slim, preset.slim);
    Object.assign(p.jet, preset.jet);
    p.jet.spectral_index =
        preset.jet.spectral_index !== undefined ? preset.jet.spectral_index : 0.7;
    if (preset.grmhd) Object.assign(p.grmhd, preset.grmhd);
    else p.grmhd.enabled = false;
    p.beaming = preset.beaming;
    p.physical_beaming = preset.physical_beaming;
    p.doppler_shift = preset.doppler_shift;
    p.look.disk_gain = preset.disk_gain;
    p.look.glow = preset.glow;
    p.look.galaxy_gain = preset.galaxy_gain;
    p.look.tone_mapper = preset.tone_mapper;
    p.look.white_balance_enabled = preset.white_balance_k !== undefined;
    if (preset.white_balance_k !== undefined) p.look.white_balance_k = preset.white_balance_k;
    if (preset.bloom) Object.assign(p.bloom, preset.bloom);
    setViewInclination(
        preset.view_inclination !== undefined ? preset.view_inclination : DEFAULT_VIEW_INCLINATION,
    );

    activePreset = name;
    basePreset = name;
    updateCamera();
    scene.updateShader();
    presetApplied('scenario');
    notifyEngineChanged();
}

// Side effects of a parameter write, by the kind the parameter registry assigns to it.
export function commitParamChange(kind) {
    if (kind === 'compile') scene.updateShader();
    else if (kind === 'uniform') updateUniforms();
    else if (kind === 'resolution') applyRenderScaleFromSettings();
    if (kind === 'resolution' || kind === 'taa') resetTemporalAAHistory();
    shader.needsUpdate = true;
    notifyEngineChanged();
}

// The turbulence pattern restarts from its first frame when the accretion geometry changes.
export function resetTurbulenceClock() {
    observer.turbulenceTimeOffset = -observer.time;
}

export function resetObserverCamera() {
    if (cameraControls) {
        cameraControls.reset();
        cameraControls.target.set(0, 0, 0);
    }
    if (cameraPan) cameraPan.set(0, 0);
    updateCamera();
    shader.needsUpdate = true;
    notifyEngineChanged();
}

export function setObserverDistance(distance) {
    const p = params();
    p.observer.distance = clampObserverDistance(distance, p.observer.motion);
    updateCamera();
    shader.needsUpdate = true;
    notifyEngineChanged();
}

// A circular orbit needs r >= 3 r_s, so switching it on may move the observer out.
export function setObserverMotion(enabled) {
    const p = params();
    p.observer.motion = !!enabled;
    p.observer.distance = clampObserverDistance(p.observer.distance, p.observer.motion);
    updateCamera();
    scene.updateShader();
    notifyEngineChanged();
}

export function resetSimulationClock() {
    observer.time = 0.0;
    shader.needsUpdate = true;
    notifyEngineChanged();
}

// Pausing keeps the chosen time scale so that playing resumes at the same speed.
export function isSimulationPaused() {
    return params().time_scale === 0;
}

export function setSimulationPaused(paused) {
    const p = params();
    if (paused && p.time_scale !== 0) {
        pausedTimeScale = p.time_scale;
        p.time_scale = 0;
    } else if (!paused && p.time_scale === 0) {
        p.time_scale = pausedTimeScale || 1;
        pausedTimeScale = null;
    }
    shader.needsUpdate = true;
    notifyEngineChanged();
}

// The speed the simulation runs at when playing, also while it is paused.
export function getPlaybackSpeed() {
    const p = params();
    return p.time_scale === 0 ? pausedTimeScale || 1 : p.time_scale;
}

export function setPlaybackSpeed(speed) {
    const p = params();
    if (p.time_scale === 0) pausedTimeScale = speed;
    else p.time_scale = speed;
    shader.needsUpdate = true;
    notifyEngineChanged();
}

export function stepSimulation(seconds) {
    observer.time = Math.max(0, observer.time + seconds);
    shader.needsUpdate = true;
    notifyEngineChanged();
}

// The wheel moves the observer instead of the camera target, in steps of 15 %.
export function installWheelZoom(canvas) {
    canvas.addEventListener(
        'wheel',
        (event) => {
            event.preventDefault();
            setObserverDistance(params().observer.distance * (event.deltaY > 0 ? 1.15 : 0.87));
        },
        { passive: false },
    );
}

export function initEngineActions() {
    setRefreshAllControllersGlobal(notifyEngineChanged);
    registerBlackHoleUiBinding('refreshControllers', notifyEngineChanged);
    applyQualityPreset(params().quality);
    blackHoleCustomState = captureBlackHolePresetState();
    qualityCustomState = captureQualityPresetState();
}
