// Typed façade over the imperative engine (src/app). React code reads and writes the engine only
// through this module and params.ts, so the JavaScript modules stay free of UI concerns.

import * as runtimeState from '../../app/core/runtime/runtime-state.js';
import * as actions from '../../app/ui/engine-actions.js';
import { BH_PRESETS } from '../../app/ui/presets.js';
import {
    KERR_MODE_LABELS,
    QUALITY_PRESET_LABELS,
    QUALITY_PRESETS,
} from '../../app/ui/quality-presets.js';
import { diveState, hoverState } from '../../app/core/scenarios/scenario-state.js';
import { resetDive, startDive } from '../../app/core/scenarios/dive.js';
import { resetHover, startHover } from '../../app/core/scenarios/hover.js';
import { getTimelinePanelBinding } from '../../app/core/runtime/ui-bindings.js';
import { frameStats } from '../../app/core/runtime/frame-stats.js';
import {
    getPresentationPathValue,
    setPresentationPathValue,
} from '../../app/presentation/runtime/path-bindings.js';
import { getPresentationState } from '../../app/presentation/runtime/presentation-controller.js';
import { seekDive } from '../../app/core/scenarios/dive.js';
import { seekHover } from '../../app/core/scenarios/hover.js';
import { updateCamera } from '../../app/scene/camera-runtime.js';
import { OBSERVER_DISTANCE_MIN, OBSERVER_ORBIT_MIN } from '../../app/core/observer.js';

export type KerrMode = 'fast' | 'kerr_inspired_disk_velocity' | 'full_kerr';

export interface EngineParams {
    quality: string;
    kerr_mode: KerrMode;
    time_scale: number;
    accretion_disk: boolean;
    accretion_mode: 'thin_disk' | 'thick_torus' | 'slim_disk';
    disk: { mass_msun: number; eddington_ratio: number; temperature_mode: string };
    black_hole: { spin_enabled: boolean; spin: number; spin_strength: number };
    jet: { enabled: boolean; mode: string };
    observer: { motion: boolean; distance: number; orbital_inclination: number };
    planet: { enabled: boolean };
    [key: string]: unknown;
}

export interface BlackHolePreset {
    spin_enabled: boolean;
    spin: number;
    accretion_disk: boolean;
    accretion_mode: EngineParams['accretion_mode'];
    disk: { temperature_mode: string; mass_msun: number };
    jet: { enabled: boolean };
}

export interface ScenarioState {
    active: boolean;
    paused: boolean;
    speed: number;
    currentR: number;
    prevDistance: number;
    reachedSingularity?: boolean;
    timelineDriven: boolean;
    cinematic?: boolean;
    minR?: number;
}

interface TimelinePanelBinding {
    open(): void;
    close(): void;
    toggle(): void;
    isOpen(): boolean;
}

interface EngineObserver {
    time: number;
    position: { x: number; y: number; z: number; length(): number };
    velocity: { x: number; y: number; z: number; length(): number };
    orientation: { elements: ArrayLike<number> };
}

interface Vector3Like {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): unknown;
}

export interface EngineCamera {
    position: Vector3Like;
    up: Vector3Like;
    quaternion: { x: number; y: number; z: number; w: number };
}

interface CameraControls {
    target: Vector3Like;
    update(): void;
    addEventListener(type: 'change', listener: () => void): void;
}

interface RuntimeState {
    shader: { parameters: EngineParams } | null;
    renderer: { domElement: HTMLCanvasElement } | null;
    observer: EngineObserver;
    camera: EngineCamera | null;
    cameraControls: CameraControls | null;
}

// runtime-state.js assigns its bindings during init(), which JavaScript inference cannot follow.
const runtime = runtimeState as unknown as RuntimeState;

export const blackHolePresets = BH_PRESETS as unknown as Record<string, BlackHolePreset>;
export const qualityPresetLabels = QUALITY_PRESET_LABELS as Record<string, string>;
export const qualityPresets = QUALITY_PRESETS as Record<string, { hide_planet_controls?: boolean }>;
export const kerrModeLabels = KERR_MODE_LABELS as Record<string, KerrMode>;
export const dive = diveState as unknown as ScenarioState;
export const hover = hoverState as unknown as ScenarioState;
export const frames = frameStats as { frames: number; renderMs: number };
export const CUSTOM_PRESET: string = actions.CUSTOM_PRESET;

export function engineReady(): boolean {
    return runtime.shader !== null && runtime.renderer !== null;
}

export function params(): EngineParams {
    return runtime.shader!.parameters;
}

export function engineObserver(): EngineObserver {
    return runtime.observer;
}

export function canvas(): HTMLCanvasElement | null {
    return runtime.renderer ? runtime.renderer.domElement : null;
}

export function engineCamera(): EngineCamera {
    return runtime.camera!;
}

export function cameraControls(): CameraControls | null {
    return runtime.cameraControls;
}

// Orientation-only camera pose (the camera sits on the unit sphere and looks at the origin).
export function setCameraPose(position: number[], up: number[]): void {
    const camera = engineCamera();
    camera.position.set(position[0], position[1], position[2]);
    camera.up.set(up[0], up[1], up[2]);
    const controls = cameraControls();
    if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
    }
    updateCamera();
}

export function observerDistanceMin(): number {
    return params().observer.motion ? OBSERVER_ORBIT_MIN : OBSERVER_DISTANCE_MIN;
}

export const getPathValue = getPresentationPathValue as (path: string) => unknown;
export const setPathValue = setPresentationPathValue as (path: string, value: unknown) => boolean;
export const seekDiveRadius = seekDive as (radius: number) => void;
export const seekHoverRadius = seekHover as (radius: number) => void;

export function presentationBusy(): boolean {
    const state = getPresentationState() as { playing: boolean; recording: boolean };
    return state.playing || state.recording;
}

export type ApplyKind = 'compile' | 'uniform' | 'redraw' | 'taa' | 'resolution';
export type PresetKind = 'scenario' | 'quality';
export const commitParamChange = actions.commitParamChange as (kind: ApplyKind) => void;
export const resetTurbulenceClock = actions.resetTurbulenceClock as () => void;
export const subscribePresetApplied = actions.subscribePresetApplied as (
    listener: (kind: PresetKind) => void,
) => () => void;
export const baseBlackHolePreset = actions.getBaseBlackHolePresetName as () => string;

export const subscribeEngine = actions.subscribeEngineChanges as (
    listener: () => void,
) => () => void;
export const notifyEngine = actions.notifyEngineChanged as () => void;
export const setNoticeHandler = actions.setEngineNoticeHandler as (
    handler: (text: string, options: { kind?: string }) => void,
) => void;
export const applyBlackHolePreset = actions.applyBlackHolePreset as (name: string) => void;
export const activeBlackHolePreset = actions.getBlackHolePresetName as () => string;
export const applyQualityPreset = actions.applyQualityPreset as (name: string) => void;
export const applyKerrMode = actions.applyKerrMode as (mode: KerrMode) => void;
export const markScenarioCustom = actions.markBlackHolePresetCustom as () => void;
export const markQualityCustom = actions.markQualityPresetCustom as () => void;
export const planetAvailable = actions.planetAvailable as () => boolean;
export const resetCamera = actions.resetObserverCamera as () => void;
export const setObserverDistance = actions.setObserverDistance as (distance: number) => void;
export const setObserverMotion = actions.setObserverMotion as (enabled: boolean) => void;
export const resetSimulationClock = actions.resetSimulationClock as () => void;
export const isSimulationPaused = actions.isSimulationPaused as () => boolean;
export const setSimulationPaused = actions.setSimulationPaused as (paused: boolean) => void;
export const stepSimulation = actions.stepSimulation as (seconds: number) => void;

export type ObserverMode = 'orbit' | 'hover' | 'dive';

// Hover and dive are exclusive scenarios; orbit is free flight with or without a circular orbit.
export function enterMode(mode: ObserverMode): void {
    if (mode !== 'dive' && (dive.active || dive.reachedSingularity)) resetDive();
    if (mode !== 'hover' && hover.active) resetHover();
    if (mode === 'dive' && !dive.active) startDive();
    if (mode === 'hover' && !hover.active) startHover();
    notifyEngine();
}

export function currentMode(): ObserverMode {
    if (dive.active || dive.reachedSingularity) return 'dive';
    if (hover.active) return 'hover';
    return 'orbit';
}

export function timelinePanel(): TimelinePanelBinding | null {
    return getTimelinePanelBinding() as TimelinePanelBinding | null;
}
