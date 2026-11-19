import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { openSimulation, trackPageProblems } from './support.js';

const MIN_FRAMES = 12;
const FPS = 24;

const FORMATS = [
    { container: 'mp4', codec: 'avc', extension: '.mp4', mimeType: 'video/mp4' },
    { container: 'webm', codec: 'vp9', extension: '.webm', mimeType: 'video/webm' },
];

// Reads the downloaded file back with Mediabunny's demuxer, which needs no decoder, so the
// check also works for H.264 in Chromium builds without proprietary codecs.
async function inspectVideo(bytes) {
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    try {
        const track = await input.getPrimaryVideoTrack();
        const stats = await track.computePacketStats();
        return {
            mimeType: await input.getMimeType(),
            codec: await track.getCodec(),
            width: await track.getDisplayWidth(),
            height: await track.getDisplayHeight(),
            frames: stats.packetCount,
            duration: await input.computeDuration(),
        };
    } finally {
        input.dispose();
    }
}

function canvasSize() {
    const canvas = document.getElementById('bh-canvas');
    return [canvas.width, canvas.height];
}

test('offline recording writes playable MP4 (H.264) and WebM (VP9) files', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const viewportSize = await page.evaluate(canvasSize);

    const loaded = await page.evaluate(async () => {
        await window.blackHolePresentation.ensurePresetsLoaded();
        return window.blackHolePresentation.loadPreset('Orbit Showcase');
    });
    expect(loaded).toBe(true);

    for (const format of FORMATS) {
        const started = await page.evaluate(
            ({ container, fps }) =>
                window.blackHolePresentation.startRecording({
                    recordingMode: 'offline',
                    videoContainer: container,
                    recordingResolution: '320x180',
                    qualityPreset: 'current',
                    fps,
                    bitrateMbps: 2,
                    autoStopOnPresentationEnd: false,
                }),
            { container: format.container, fps: FPS },
        );
        expect(started, `${format.container} recording should start`).toBe(true);

        const state = await page.evaluate(() => window.blackHolePresentation.state());
        expect(state.recording_video_container).toBe(format.container);
        expect(state.recording_offline_codec).toBe(format.codec);
        expect(await page.evaluate(canvasSize)).toEqual([320, 180]);

        await page.waitForFunction(
            (frames) =>
                window.blackHolePresentation.state().recording_offline_frames_done >= frames,
            MIN_FRAMES,
        );
        const downloadEvent = page.waitForEvent('download');
        await page.evaluate(() => window.blackHolePresentation.stopRecording());
        const download = await downloadEvent;
        expect(download.suggestedFilename().endsWith(format.extension)).toBe(true);

        const video = await inspectVideo(await readFile(await download.path()));
        expect(video.mimeType.startsWith(format.mimeType)).toBe(true);
        expect(video.codec).toBe(format.codec);
        expect([video.width, video.height]).toEqual([320, 180]);
        expect(video.frames).toBeGreaterThanOrEqual(MIN_FRAMES);
        expect(video.duration).toBeCloseTo(video.frames / FPS, 2);

        await page.waitForFunction(() => !window.blackHolePresentation.state().recording);
        expect(await page.evaluate(canvasSize), 'the viewport size is restored').toEqual(
            viewportSize,
        );
    }

    expect(problems).toEqual([]);
});

test('realtime recording captures the canvas with MediaRecorder', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);

    const started = await page.evaluate(
        (fps) =>
            window.blackHolePresentation.startRecording({
                recordingMode: 'realtime',
                videoContainer: 'webm',
                recordingResolution: '320x180',
                qualityPreset: 'current',
                fps,
                bitrateMbps: 2,
            }),
        FPS,
    );
    expect(started).toBe(true);
    const state = await page.evaluate(() => window.blackHolePresentation.state());
    expect(state.recording_mode).toBe('realtime');

    const startFrame = await page.evaluate(() => window.__BH__.frameCount);
    await page.waitForFunction(
        (frame) => window.__BH__.frameCount >= frame,
        startFrame + MIN_FRAMES,
    );
    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(() => window.blackHolePresentation.stopRecording());
    const download = await downloadEvent;
    expect(download.suggestedFilename().endsWith('.webm')).toBe(true);

    const video = await inspectVideo(await readFile(await download.path()));
    expect(video.codec).toBe('vp9');
    expect([video.width, video.height]).toEqual([320, 180]);
    expect(video.frames).toBeGreaterThan(0);

    await page.waitForFunction(() => !window.blackHolePresentation.state().recording);
    expect(problems).toEqual([]);
});

// Stands in for the File System Access API. The "file" is assembled in memory from the
// positioned writes that Mediabunny's StreamTarget sends.
function installFakeSavePicker() {
    const file = {
        options: null,
        bytes: new Uint8Array(0),
        size: 0,
        closed: false,
        aborted: false,
    };
    window.__fakeSavedFile = file;
    window.showSaveFilePicker = async (options) => {
        file.options = options;
        return {
            createWritable: async () => ({
                async write({ data, position }) {
                    const end = position + data.byteLength;
                    if (end > file.bytes.length) {
                        const grown = new Uint8Array(Math.max(end, file.bytes.length * 2));
                        grown.set(file.bytes);
                        file.bytes = grown;
                    }
                    file.bytes.set(data, position);
                    file.size = Math.max(file.size, end);
                },
                async close() {
                    file.closed = true;
                },
                async abort() {
                    file.aborted = true;
                },
            }),
        };
    };
}

// The timeline editor is only offered on wide layouts.
test.describe('timeline editor', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('renders its timeline through the capture dialog into the picked file', async ({
        page,
    }) => {
        const problems = trackPageProblems(page);
        await page.addInitScript(installFakeSavePicker);
        await openSimulation(page);
        await page.evaluate(async () => {
            await window.blackHolePresentation.ensurePresetsLoaded();
            window.blackHolePresentation.loadPreset('Orbit Showcase');
        });

        await page.locator('#tl-open-btn').click();
        const editor = page.locator('#tl-panel');
        const timeline = editor.getByRole('combobox', { name: 'Timeline' });
        await expect(timeline, 'the editor opens on the loaded timeline').toHaveValue(
            'Orbit Showcase',
        );

        // A new timeline of half a second keeps the render short in software WebGL.
        await timeline.selectOption('');
        const duration = editor.getByRole('spinbutton', { name: 'Duration in seconds' });
        await duration.fill('0.5');
        await duration.press('Enter');
        await expect
            .poll(() => page.evaluate(() => window.blackHolePresentation.state().duration))
            .toBe(0.5);

        await editor.getByRole('button', { name: 'Overlays' }).click();
        const overlays = editor.getByRole('dialog', { name: 'Overlays' });
        await expect(overlays.getByRole('checkbox', { name: 'Show annotations' })).toBeChecked();
        await page.keyboard.press('Escape');
        await expect(overlays).toBeHidden();

        await editor.getByRole('button', { name: 'Render video' }).click();
        const dialog = page.getByRole('dialog', { name: 'Capture' });
        await expect(dialog.getByRole('combobox', { name: /^Source/ })).toContainText(
            'Timeline · Untitled',
        );
        await dialog.getByRole('radio', { name: 'WebM · VP9' }).click();
        await dialog.getByRole('combobox', { name: /^Resolution/ }).click();
        await page.getByRole('option', { name: 'Match window', exact: true }).click();
        await dialog.getByRole('radio', { name: '24' }).click();
        await dialog.getByRole('combobox', { name: /^Render quality/ }).click();
        await page.getByRole('option', { name: 'Current preset', exact: true }).click();
        await expect(dialog).toContainText('Estimated 12 frames');
        await dialog.getByRole('button', { name: 'Start render' }).click();

        await expect(page.getByText('Video saved')).toBeVisible();
        const saved = await page.evaluate(() => {
            const file = window.__fakeSavedFile;
            return {
                options: file.options,
                closed: file.closed,
                aborted: file.aborted,
                bytes: Array.from(file.bytes.subarray(0, file.size)),
            };
        });
        expect(saved.options.suggestedName).toBe('black-hole-untitled.webm');
        expect(saved.options.types[0].accept).toEqual({ 'video/webm': ['.webm'] });
        expect(saved.closed).toBe(true);
        expect(saved.aborted).toBe(false);

        const video = await inspectVideo(new Uint8Array(saved.bytes));
        expect(video.codec).toBe('vp9');
        expect(video.frames).toBe(12);
        expect(problems).toEqual([]);
    });
});
