import { toast } from 'sonner';
import {
    type ScreenshotPlan,
    captureActive,
    readCaptureStatus,
    startVideo,
    stopCapture,
    takeScreenshot,
} from '../engine/capture';
import { type VideoSettings, useCaptureSettings } from './capture-settings';
import { openCapture, useUi } from './ui-store';

// The render blocks the page for a moment, so it starts once the notice has painted.
export function saveScreenshot(
    plan: ScreenshotPlan = useCaptureSettings.getState().screenshot,
): void {
    if (captureActive()) {
        toast.error('Screenshots are available once the recording ends.', { id: 'screenshot' });
        return;
    }
    const id = toast.loading('Rendering the screenshot…', { id: 'screenshot' });
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            const error = takeScreenshot(plan);
            if (error) toast.error(error, { id });
            else toast.success('Screenshot saved', { id });
        }),
    );
}

// Opens the video settings, or ends a live recording. Offline renders end from their panel only,
// so that a key press cannot discard a long render.
export function toggleRecording(): void {
    if (!captureActive()) openCapture('video');
    else if (readCaptureStatus().live) stopCapture();
    else toast('A render is running; pause or cancel it from its panel.', { id: 'capture' });
}

export function restoreInterface(): void {
    const session = useCaptureSettings.getState();
    if (session.hidInterface) useUi.getState().setUiHidden(false);
    session.setSession({ label: '', hidInterface: false });
}

export async function beginVideo(
    settings: VideoSettings,
    label: string,
    file?: FileSystemWritableFileStream,
): Promise<void> {
    const hide = settings.hideInterface && !useUi.getState().uiHidden;
    useCaptureSettings.getState().setSession({ label, hidInterface: hide });
    if (hide) useUi.getState().setUiHidden(true);
    const error = await startVideo(settings, file);
    if (error) {
        restoreInterface();
        toast.error(error, { id: 'capture' });
    }
}
