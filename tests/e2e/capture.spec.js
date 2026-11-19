import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { blockingViolations, openSimulation, trackPageProblems } from './support.js';

async function videoTrack(bytes) {
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    try {
        const track = await input.getPrimaryVideoTrack();
        const stats = await track.computePacketStats();
        return {
            codec: await track.getCodec(),
            width: await track.getDisplayWidth(),
            height: await track.getDisplayHeight(),
            frames: stats.packetCount,
        };
    } finally {
        input.dispose();
    }
}

// Width and height from the IHDR chunk that follows the 8-byte PNG signature.
function pngSize(bytes) {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function canvasSize() {
    const canvas = document.getElementById('bh-canvas');
    return [canvas.width, canvas.height];
}

const presentationState = (page) => page.evaluate(() => window.blackHolePresentation.state());

async function choose(page, dialog, label, option) {
    await dialog.getByRole('combobox', { name: label }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
}

// Without the File System Access API an offline render is downloaded when it ends.
function removeSavePicker() {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
}

// Records the positioned writes of a streamed render in memory, as a picked file would.
function installFakeSavePicker() {
    const file = { options: null, size: 0, closed: false, aborted: false };
    window.__fakeSavedFile = file;
    window.showSaveFilePicker = async (options) => {
        file.options = options;
        return {
            createWritable: async () => ({
                async write({ data, position }) {
                    file.size = Math.max(file.size, position + data.byteLength);
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

test('screenshots are saved from the dialog, with P and at a fixed size', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const windowCanvas = await page.evaluate(canvasSize);

    await page.getByRole('button', { name: 'Screenshot', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Capture' });
    await expect(dialog.getByRole('tab', { name: 'Screenshot' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(dialog.getByRole('combobox', { name: /^Resolution/ })).toContainText(
        'Match window',
    );
    await choose(page, dialog, /^Render quality/, 'Current preset');
    const fromDialog = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Save screenshot' }).click();
    const first = await fromDialog;
    expect(first.suggestedFilename()).toMatch(/^black-hole-\d{8}-\d{6}\.png$/);
    expect(pngSize(await readFile(await first.path()))).toEqual(windowCanvas);
    await expect(page.getByText('Screenshot saved')).toBeVisible();

    const fromKey = page.waitForEvent('download');
    await page.keyboard.press('p');
    expect(pngSize(await readFile(await (await fromKey).path()))).toEqual(windowCanvas);

    // A fixed size is rendered at that size, after a temporal anti-aliasing warm-up that software
    // WebGL only gets through quickly at a small size.
    const fixed = page.waitForEvent('download');
    const saved = await page.evaluate(() =>
        window.blackHolePresentation.captureScreenshot({
            qualityPreset: 'current',
            recordingResolution: '320x180',
            filenamePrefix: 'black-hole',
        }),
    );
    expect(saved).toBe(true);
    expect(pngSize(await readFile(await (await fixed).path()))).toEqual([320, 180]);
    expect(await page.evaluate(canvasSize), 'the canvas size is restored').toEqual(windowCanvas);
    expect(problems).toEqual([]);
});

test('R opens the video settings; a live recording pauses, resumes and saves', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const windowCanvas = await page.evaluate(canvasSize);

    await page.keyboard.press('r');
    const dialog = page.getByRole('dialog', { name: 'Capture' });
    await expect(dialog.getByRole('tab', { name: 'Video' })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await dialog.getByRole('radio', { name: 'WebM · VP9' }).click();
    await choose(page, dialog, /^Resolution/, 'Match window');
    await dialog.getByRole('radio', { name: '24' }).click();
    await expect(dialog.getByRole('combobox', { name: /^Source/ })).toContainText('Live view');
    await expect(
        dialog.getByRole('checkbox', { name: 'Hide the interface while capturing' }),
    ).toBeChecked();
    await expect(dialog).toContainText('per minute');
    await dialog.getByRole('button', { name: 'Start recording' }).click();

    const progress = page.getByRole('region', { name: 'Capture progress' });
    await expect(progress).toContainText('Recording');
    await expect(progress).toContainText('Live view · WebM · VP9');
    await expect(page.locator('.shell')).toHaveAttribute('data-ui-hidden', 'true');
    const state = await presentationState(page);
    expect(state.recording_mode).toBe('realtime');
    expect(state.recording_video_container).toBe('webm');

    const frames = await page.evaluate(() => window.__BH__.frameCount);
    await page.waitForFunction((count) => window.__BH__.frameCount >= count, frames + 12);
    expect(await blockingViolations(page), 'progress panel').toEqual([]);
    await progress.getByRole('button', { name: 'Pause' }).click();
    await expect(progress).toContainText('Recording paused');
    await progress.getByRole('button', { name: 'Resume' }).click();
    await expect(progress.getByRole('button', { name: 'Pause' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.keyboard.press('r');
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/^black-hole-live-\d{8}-\d{6}\.webm$/);
    const video = await videoTrack(await readFile(await saved.path()));
    expect(video.codec).toBe('vp9');
    expect([video.width, video.height]).toEqual(windowCanvas);
    expect(video.frames).toBeGreaterThan(0);

    await expect(progress).toBeHidden();
    await expect(page.getByText('Video saved')).toBeVisible();
    await expect(page.locator('.shell')).toHaveAttribute('data-ui-hidden', 'false');
    expect(problems).toEqual([]);
});

test('a timeline render streams into the picked file and can be cancelled', async ({ page }) => {
    const problems = trackPageProblems(page);
    await page.addInitScript(installFakeSavePicker);
    await openSimulation(page);
    let downloads = 0;
    page.on('download', () => (downloads += 1));

    await page.keyboard.press('r');
    const dialog = page.getByRole('dialog', { name: 'Capture' });
    await dialog.getByRole('radio', { name: 'WebM · VP9' }).click();
    await choose(page, dialog, /^Resolution/, 'Match window');
    await dialog.getByRole('radio', { name: '24' }).click();
    await choose(page, dialog, /^Source/, 'Timeline · Orbit Showcase (0:42)');
    await choose(page, dialog, /^Render quality/, 'Current preset');
    await dialog.getByRole('checkbox', { name: 'Hide the interface while capturing' }).click();
    await expect(dialog).toContainText(/Estimated 1,008 frames · .+ on this device · ≈ \d+ MB/);
    await dialog.getByRole('button', { name: 'Start render' }).click();

    const progress = page.getByRole('region', { name: 'Capture progress' });
    await expect(progress).toContainText('Rendering');
    await expect(progress).toContainText('Orbit Showcase · WebM · VP9');
    await expect(progress.getByRole('progressbar', { name: 'Render progress' })).toBeVisible();
    await expect(page.locator('.shell')).toHaveAttribute('data-ui-hidden', 'false');
    await page.waitForFunction(
        () => window.blackHolePresentation.state().recording_offline_frames_done >= 6,
    );
    await expect(progress).toContainText(/\d+ \/ 1,008 frames/);
    const picked = await page.evaluate(() => window.__fakeSavedFile.options);
    expect(picked.suggestedName).toBe('black-hole-orbit-showcase.webm');

    await progress.getByRole('button', { name: 'Cancel' }).click();
    await expect(progress).toBeHidden();
    await expect(page.getByText('Capture cancelled; nothing was saved')).toBeVisible();
    const file = await page.evaluate(() => window.__fakeSavedFile);
    expect(file.aborted).toBe(true);
    expect(file.closed).toBe(false);
    expect(downloads).toBe(0);
    expect(problems).toEqual([]);
});

// A small window keeps the frames of a whole dive cheap to render in software WebGL.
test.describe('dive render', () => {
    test.use({ viewport: { width: 640, height: 360 } });

    test('ends on its own when the observer reaches the singularity', async ({ page }) => {
        const problems = trackPageProblems(page);
        await page.addInitScript(removeSavePicker);
        await openSimulation(page);
        await page.evaluate(() => {
            window.__BH__.params.time_scale = 8;
        });

        await page.keyboard.press('r');
        const dialog = page.getByRole('dialog', { name: 'Capture' });
        await dialog.getByRole('radio', { name: 'WebM · VP9' }).click();
        await choose(page, dialog, /^Resolution/, 'Match window');
        await dialog.getByRole('radio', { name: '24' }).click();
        await choose(page, dialog, /^Source/, 'Dive scenario · from the start');
        await choose(page, dialog, /^Render quality/, 'Current preset');
        const estimate = await dialog.getByText(/^Estimated/).textContent();
        const expected = Number(/Estimated ([\d,]+) frames/.exec(estimate)[1].replace(',', ''));
        expect(expected).toBeGreaterThan(24);

        const download = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Start render' }).click();
        const progress = page.getByRole('region', { name: 'Capture progress' });
        await expect(progress).toContainText(`/ ${expected.toLocaleString('en-US')} frames`);
        expect((await presentationState(page)).recording_offline_frames_total).toBe(expected);

        const saved = await download;
        expect(saved.suggestedFilename()).toMatch(/^black-hole-dive-\d{8}-\d{6}\.webm$/);
        const video = await videoTrack(await readFile(await saved.path()));
        expect(video.codec).toBe('vp9');
        expect(video.frames).toBe(expected);
        await expect(page.getByText('Video saved')).toBeVisible();
        expect(problems).toEqual([]);
    });
});
