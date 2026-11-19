import { describe, expect, test } from 'vitest';
import {
    formatApproxDuration,
    formatBytes,
    formatClock,
    resolutionSize,
    scaledFrameSeconds,
    videoBitrateMbps,
    videoBytes,
} from '../../src/ui/lib/capture';

describe('capture planning', () => {
    test('the bitrate follows pixels, frame rate and codec efficiency within 4 to 80 Mbit/s', () => {
        expect(videoBitrateMbps(1920, 1080, 60, 'avc')).toBe(19);
        expect(videoBitrateMbps(1920, 1080, 60, 'vp9')).toBe(12);
        expect(videoBitrateMbps(1920, 1080, 60, 'av1')).toBe(9);
        expect(videoBitrateMbps(3840, 2160, 60, 'avc')).toBe(75);
        expect(videoBitrateMbps(7680, 4320, 60, 'avc')).toBe(80);
        expect(videoBitrateMbps(640, 360, 24, 'vp9')).toBe(4);
    });

    test('a fixed resolution is parsed and "current" keeps the window size', () => {
        const window = { width: 1280, height: 720 };
        expect(resolutionSize('2560x1440', window)).toEqual({ width: 2560, height: 1440 });
        expect(resolutionSize('current', window)).toBe(window);
    });

    test('render time scales with pixels and ray-marching cost', () => {
        const seconds = scaledFrameSeconds(
            0.02,
            { pixels: 1e6, cost: 100 },
            { pixels: 4e6, cost: 1200 },
        );
        expect(seconds).toBeCloseTo(0.96, 12);
        expect(scaledFrameSeconds(0.02, { pixels: 0, cost: 100 }, { pixels: 4e6, cost: 1 })).toBe(
            0.02,
        );
    });

    test('sizes and durations read naturally', () => {
        expect(videoBytes(20, 8)).toBe(20e6);
        expect(formatBytes(420e6)).toBe('420 MB');
        expect(formatBytes(1.24e9)).toBe('1.2 GB');
        expect(formatBytes(1000)).toBe('1 MB');
        expect(formatClock(0)).toBe('0:00');
        expect(formatClock(186)).toBe('3:06');
        expect(formatClock(3725)).toBe('1:02:05');
        expect(formatApproxDuration(30)).toBe('under a minute');
        expect(formatApproxDuration(540)).toBe('about 9 min');
        expect(formatApproxDuration(7200)).toBe('about 2.0 h');
        expect(formatApproxDuration(40000)).toBe('about 11 h');
    });
});
