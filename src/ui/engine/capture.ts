// Screenshots and video recordings: a typed bridge to the presentation controller's capture API.

import * as runtimeState from '../../app/core/runtime/runtime-state.js';
import * as presentation from '../../app/presentation/runtime/presentation-controller.js';
import { QUALITY_PRESETS } from '../../app/ui/quality-presets.js';
import { diveFrameCount } from '../../app/core/scenarios/dive.js';
import { diveState } from '../../app/core/scenarios/scenario-state.js';
import {
    type CaptureQuality,
    type FrameRate,
    type VideoCodec,
    resolutionSize,
    scaledFrameSeconds,
    videoBitrateMbps,
    videoBytes,
} from '../lib/capture';
import { slugify } from '../lib/scenarios';
import {
    isSimulationPaused,
    params,
    playbackSpeed,
    resetSimulationClock,
    restartScenario,
    setSimulationPaused,
} from './engine';

// Open-ended renders end after ten minutes of video, as the controller does.
const MAX_VIDEO_SECONDS = 600;

export interface ScreenshotPlan {
    resolution: string;
    quality: CaptureQuality;
}

// `source` is 'live', 'dive' or the value of a timeline source.
export interface VideoPlan {
    codec: VideoCodec;
    resolution: string;
    fps: FrameRate;
    source: string;
    quality: CaptureQuality;
}

export interface TimelineSource {
    value: string;
    name: string;
    seconds: number;
    preset: string | null;
}

export interface CaptureResult {
    id: number;
    status: 'saved' | 'failed' | 'cancelled';
    message: string;
}

export interface CaptureStatus {
    active: boolean;
    paused: boolean;
    live: boolean;
    framesDone: number;
    framesTotal: number;
    progress: number;
    etaSeconds: number;
    elapsedSeconds: number;
    finalizing: boolean;
    finalizingProgress: number;
}

export interface VideoEstimate {
    videoSeconds: number | null;
    frames: number | null;
    renderSeconds: number | null;
    bytes: number | null;
}

interface PresentationState {
    loaded: boolean;
    name: string;
    duration: number;
    recording: boolean;
    recording_paused: boolean;
    recording_elapsed_s: number;
    recording_mode: 'offline' | 'realtime';
    recording_offline_phase: string;
    recording_offline_frames_done: number;
    recording_offline_frames_total: number;
    recording_offline_progress: number;
    recording_offline_eta_s: number;
    recording_offline_finalizing_progress: number;
    recording_offline_unavailable_reason: string;
}

interface QualityModeValues {
    n_steps: number;
    sample_count: number;
}

const controller = presentation as unknown as {
    getPresentationState(): PresentationState;
    listPresentationPresets(): string[];
    loadPresentationPreset(name: string): boolean;
    seekPresentation(seconds: number): void;
    capturePresentationScreenshot(options: object): boolean;
    startPresentationRecording(options: object): Promise<boolean>;
    stopPresentationRecording(): boolean;
    pausePresentationRecording(): boolean;
    resumePresentationRecording(): boolean;
    cancelPresentationRecording(): boolean;
    isPresentationRecording(): boolean;
    getPresentationRecordingResult(): CaptureResult | null;
    PRESENTATION_PRESETS: Record<string, { duration?: number }>;
};

function state(): PresentationState {
    return controller.getPresentationState();
}

function failure(fallback: string): string {
    return state().recording_offline_unavailable_reason || fallback;
}

export function captureActive(): boolean {
    return controller.isPresentationRecording();
}

export function lastCaptureResult(): CaptureResult | null {
    return controller.getPresentationRecordingResult();
}

export function readCaptureStatus(): CaptureStatus {
    const s = state();
    return {
        active: s.recording,
        paused: s.recording_paused,
        live: s.recording_mode === 'realtime',
        framesDone: s.recording_offline_frames_done,
        framesTotal: s.recording_offline_frames_total,
        progress: s.recording_offline_progress,
        etaSeconds: s.recording_offline_eta_s,
        elapsedSeconds: s.recording_elapsed_s,
        finalizing: s.recording_offline_phase.startsWith('finalizing'),
        finalizingProgress: s.recording_offline_finalizing_progress,
    };
}

// The loaded timeline first, then the bundled presets that are not loaded.
export function timelineSources(): TimelineSource[] {
    const s = state();
    const sources: TimelineSource[] = [];
    if (s.loaded) {
        sources.push({
            value: 'timeline',
            name: s.name || 'Current timeline',
            seconds: s.duration,
            preset: null,
        });
    }
    for (const name of controller.listPresentationPresets()) {
        if (s.loaded && name === s.name) continue;
        const seconds = Number(controller.PRESENTATION_PRESETS[name]?.duration) || 0;
        sources.push({ value: `preset:${name}`, name, seconds, preset: name });
    }
    return sources;
}

// The canvas size, rounded down to even numbers as video encoders require.
export function windowSize(): { width: number; height: number } {
    const canvas = (runtimeState.renderer as { domElement?: HTMLCanvasElement } | null)?.domElement;
    const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
    return { width: even(canvas?.width ?? 1280), height: even(canvas?.height ?? 720) };
}

// Ray-marching cost of a pixel, integration steps times samples, for a quality preset under the
// current solver, mirroring applyQualityPresetValues.
function qualityCost(quality: CaptureQuality): number {
    const p = params() as unknown as QualityModeValues & { kerr_mode: string };
    if (quality === 'current') return p.n_steps * p.sample_count;
    const preset = (
        QUALITY_PRESETS as unknown as Record<string, Record<string, QualityModeValues>>
    )[quality];
    const fullKerr = p.kerr_mode === 'full_kerr' || p.kerr_mode === 'realtime_full_kerr_core';
    const mode = fullKerr
        ? preset.full_kerr
        : p.kerr_mode === 'kerr_inspired_disk_velocity'
          ? preset.kerr
          : preset.standard;
    return mode.n_steps * mode.sample_count;
}

function diveStartRadius(): number {
    return diveState.active || diveState.reachedSingularity
        ? diveState.prevDistance
        : params().observer.distance;
}

function timelineSource(plan: VideoPlan): TimelineSource | undefined {
    return timelineSources().find((entry) => entry.value === plan.source);
}

// Frames of a dive or timeline render, or null when the length is unknown. A paused clock resumes
// when a dive render starts, so the dive is timed at the resumed speed.
function sourceFrames(plan: VideoPlan): number | null {
    if (plan.source === 'dive') {
        const max = plan.fps * MAX_VIDEO_SECONDS;
        const frames = diveFrameCount(diveStartRadius(), plan.fps, max, playbackSpeed());
        return Number.isFinite(frames) ? frames : null;
    }
    const seconds = timelineSource(plan)?.seconds ?? 0;
    return seconds > 0 ? Math.ceil(seconds * plan.fps) : null;
}

// Downloads append the date and time to this name.
export function videoFilePrefix(plan: VideoPlan): string {
    if (plan.source === 'live' || plan.source === 'dive') return `black-hole-${plan.source}`;
    return `black-hole-${slugify(timelineSource(plan)?.name ?? 'timeline')}`;
}

function planBitrate(plan: VideoPlan): number {
    const size = resolutionSize(plan.resolution, windowSize());
    return videoBitrateMbps(size.width, size.height, plan.fps, plan.codec);
}

// `frameSeconds` is the measured time of one frame at the current resolution and quality. A live
// recording has no fixed length, so its size is given per minute.
export function estimateVideo(plan: VideoPlan, frameSeconds: number): VideoEstimate {
    const bitrate = planBitrate(plan);
    if (plan.source === 'live') {
        return {
            videoSeconds: null,
            frames: null,
            renderSeconds: null,
            bytes: videoBytes(bitrate, 60),
        };
    }
    const frames = sourceFrames(plan);
    if (frames === null) {
        return { videoSeconds: null, frames: null, renderSeconds: null, bytes: null };
    }
    const videoSeconds = frames / plan.fps;
    const window = windowSize();
    const size = resolutionSize(plan.resolution, window);
    const perFrame = scaledFrameSeconds(
        frameSeconds,
        { pixels: window.width * window.height, cost: qualityCost('current') },
        { pixels: size.width * size.height, cost: qualityCost(plan.quality) },
    );
    return {
        videoSeconds,
        frames,
        renderSeconds: frames * perFrame,
        bytes: videoBytes(bitrate, videoSeconds),
    };
}

// Returns null once the PNG download has started, or the reason it failed.
export function takeScreenshot(plan: ScreenshotPlan): string | null {
    const ok = controller.capturePresentationScreenshot({
        qualityPreset: plan.quality,
        recordingResolution: plan.resolution,
        includeAnnotationsInScreenshot: false,
        filenamePrefix: 'black-hole',
    });
    return ok ? null : failure('The screenshot could not be saved.');
}

// Returns null once the recording runs, or the reason it did not start. `file`, when given,
// receives an offline render as it is encoded; the recording owns it from then on.
export async function startVideo(
    plan: VideoPlan,
    file?: FileSystemWritableFileStream,
): Promise<string | null> {
    const options: Record<string, unknown> = {
        videoCodec: plan.codec,
        fps: plan.fps,
        bitrateMbps: planBitrate(plan),
        recordingResolution: plan.resolution,
        qualityPreset: plan.quality,
        filenamePrefix: videoFilePrefix(plan),
        writableFileStream: file,
    };
    if (plan.source === 'live') {
        Object.assign(options, {
            recordingMode: 'realtime',
            qualityPreset: 'current',
            autoStopOnPresentationEnd: false,
            includeAnnotationsInRecording: false,
        });
    } else if (plan.source === 'dive') {
        if (isSimulationPaused()) setSimulationPaused(false);
        restartScenario('dive');
        const frames = diveFrameCount(
            diveState.currentR,
            plan.fps,
            plan.fps * MAX_VIDEO_SECONDS,
            params().time_scale,
        );
        Object.assign(options, {
            recordingMode: 'offline',
            autoStopOnPresentationEnd: false,
            includeAnnotationsInRecording: false,
            until: () => diveState.reachedSingularity,
            expectedFrames: Number.isFinite(frames) ? frames : 0,
        });
    } else {
        const source = timelineSource(plan);
        if (!source) return 'Choose a timeline to render.';
        if (source.preset && !controller.loadPresentationPreset(source.preset)) {
            return 'The timeline could not be loaded.';
        }
        // Renders start at the beginning of the timeline with the simulation clock at zero, so the
        // same timeline always gives the same video.
        controller.seekPresentation(0);
        resetSimulationClock();
        Object.assign(options, {
            recordingMode: 'offline',
            autoStopOnPresentationEnd: true,
        });
    }
    const started = await controller.startPresentationRecording(options);
    return started ? null : failure('The recording could not start.');
}

export const pauseCapture = (): boolean => controller.pausePresentationRecording();
export const resumeCapture = (): boolean => controller.resumePresentationRecording();
export const stopCapture = (): boolean => controller.stopPresentationRecording();
export const cancelCapture = (): boolean => controller.cancelPresentationRecording();
