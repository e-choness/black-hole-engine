export type VideoCodec = 'avc' | 'vp9' | 'av1';
export type CaptureQuality = 'cinematic' | 'ultra' | 'current';
export type FrameRate = 24 | 30 | 60;

export const VIDEO_FORMATS: { codec: VideoCodec; label: string; extension: string }[] = [
    { codec: 'avc', label: 'MP4 · H.264', extension: '.mp4' },
    { codec: 'vp9', label: 'WebM · VP9', extension: '.webm' },
    { codec: 'av1', label: 'WebM · AV1', extension: '.webm' },
];

export const RESOLUTIONS: { value: string; label: string }[] = [
    { value: '1920x1080', label: '1920 × 1080 · Full HD' },
    { value: '2560x1440', label: '2560 × 1440 · QHD' },
    { value: '3840x2160', label: '3840 × 2160 · 4K UHD' },
    { value: 'current', label: 'Match window' },
];

export const FRAME_RATES: FrameRate[] = [24, 30, 60];

export const QUALITIES: { value: CaptureQuality; label: string }[] = [
    { value: 'cinematic', label: 'Cinematic · offline, 12 samples' },
    { value: 'ultra', label: 'Ultra · offline, 6 samples' },
    { value: 'current', label: 'Current preset' },
];

// Bits per pixel and frame that keep a detailed, fast-moving render free of visible blocking.
// VP9 and AV1 reach the same quality with fewer bits than H.264.
const BITS_PER_PIXEL: Record<VideoCodec, number> = { avc: 0.15, vp9: 0.1, av1: 0.075 };

export function videoBitrateMbps(
    width: number,
    height: number,
    fps: number,
    codec: VideoCodec,
): number {
    const mbps = (width * height * fps * BITS_PER_PIXEL[codec]) / 1e6;
    return Math.min(80, Math.max(4, Math.round(mbps)));
}

export function resolutionSize(
    value: string,
    window: { width: number; height: number },
): { width: number; height: number } {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match) return window;
    return { width: Number(match[1]), height: Number(match[2]) };
}

export function videoBytes(bitrateMbps: number, seconds: number): number {
    return (bitrateMbps * 1e6 * seconds) / 8;
}

export function formatBytes(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// m:ss below an hour, h:mm:ss above.
export function formatClock(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatApproxDuration(seconds: number): string {
    if (seconds < 60) return 'under a minute';
    if (seconds < 3600) return `about ${Math.round(seconds / 60)} min`;
    const hours = seconds / 3600;
    return `about ${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

// Frame time scaled from the measured one to another resolution and ray-marching cost, where the
// cost of a pixel is its integration steps times its samples.
export function scaledFrameSeconds(
    measuredSeconds: number,
    measured: { pixels: number; cost: number },
    target: { pixels: number; cost: number },
): number {
    if (measured.pixels <= 0 || measured.cost <= 0) return measuredSeconds;
    return measuredSeconds * (target.pixels / measured.pixels) * (target.cost / measured.cost);
}
