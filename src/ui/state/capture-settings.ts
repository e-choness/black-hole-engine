import { create } from 'zustand';
import {
    type CaptureQuality,
    type FrameRate,
    type VideoCodec,
    FRAME_RATES,
    QUALITIES,
    RESOLUTIONS,
    VIDEO_FORMATS,
} from '../lib/capture';
import type { ScreenshotPlan, VideoPlan } from '../engine/capture';

const STORAGE_KEY = 'black-hole.capture';

export interface VideoSettings extends VideoPlan {
    hideInterface: boolean;
}

interface CaptureSettingsState {
    screenshot: ScreenshotPlan;
    video: VideoSettings;
    // What the running capture records, for the progress panel, and whether it hid the interface.
    label: string;
    hidInterface: boolean;
    setScreenshot: (patch: Partial<ScreenshotPlan>) => void;
    setVideo: (patch: Partial<VideoSettings>) => void;
    setSession: (session: { label: string; hidInterface: boolean }) => void;
}

const DEFAULT_SCREENSHOT: ScreenshotPlan = { resolution: 'current', quality: 'cinematic' };
const DEFAULT_VIDEO: VideoSettings = {
    codec: 'avc',
    resolution: '1920x1080',
    fps: 60,
    source: 'live',
    quality: 'cinematic',
    hideInterface: true,
};

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

// Saved settings from older versions may hold values that no longer exist; those fall back.
function load(): { screenshot: ScreenshotPlan; video: VideoSettings } {
    let saved: { screenshot?: Partial<ScreenshotPlan>; video?: Partial<VideoSettings> } = {};
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
    } catch {
        // Defaults are used when storage is unavailable or holds something else.
    }
    const resolutions = RESOLUTIONS.map((entry) => entry.value);
    const qualities = QUALITIES.map((entry) => entry.value);
    const shot = saved.screenshot ?? {};
    const video = saved.video ?? {};
    return {
        screenshot: {
            resolution: pick(shot.resolution, resolutions, DEFAULT_SCREENSHOT.resolution),
            quality: pick<CaptureQuality>(shot.quality, qualities, DEFAULT_SCREENSHOT.quality),
        },
        video: {
            codec: pick<VideoCodec>(
                video.codec,
                VIDEO_FORMATS.map((entry) => entry.codec),
                DEFAULT_VIDEO.codec,
            ),
            resolution: pick(video.resolution, resolutions, DEFAULT_VIDEO.resolution),
            fps: pick<FrameRate>(video.fps, FRAME_RATES, DEFAULT_VIDEO.fps),
            source: typeof video.source === 'string' ? video.source : DEFAULT_VIDEO.source,
            quality: pick<CaptureQuality>(video.quality, qualities, DEFAULT_VIDEO.quality),
            hideInterface:
                typeof video.hideInterface === 'boolean'
                    ? video.hideInterface
                    : DEFAULT_VIDEO.hideInterface,
        },
    };
}

function save(screenshot: ScreenshotPlan, video: VideoSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ screenshot, video }));
    } catch {
        // The settings then last for this visit only.
    }
}

export const useCaptureSettings = create<CaptureSettingsState>()((set, get) => ({
    ...load(),
    label: '',
    hidInterface: false,
    setScreenshot: (patch) => {
        const screenshot = { ...get().screenshot, ...patch };
        set({ screenshot });
        save(screenshot, get().video);
    },
    setVideo: (patch) => {
        const video = { ...get().video, ...patch };
        set({ video });
        save(get().screenshot, video);
    },
    setSession: (session) => set(session),
}));
