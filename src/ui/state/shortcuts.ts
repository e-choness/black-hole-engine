import { toast } from 'sonner';
import { enterMode, presentationBusy, timelinePanel, type ObserverMode } from '../engine/engine';
import { togglePlayback } from '../engine/playback';
import { toggleFullscreen } from '../lib/fullscreen';
import { saveScreenshot, toggleRecording } from './capture-actions';
import { useUi } from './ui-store';

export interface Shortcut {
    keys: string[];
    label: string;
}

// The single source for the shortcut sheet; the handler below implements the same keys.
export const SHORTCUT_GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
    {
        title: 'General',
        shortcuts: [
            { keys: ['Ctrl', 'K'], label: 'Command palette' },
            { keys: ['?'], label: 'Keyboard shortcuts' },
            { keys: ['H'], label: 'Hide or show the interface' },
            { keys: ['F'], label: 'Fullscreen' },
            { keys: ['P'], label: 'Save a screenshot' },
            { keys: ['R'], label: 'Record a video, or stop a live recording' },
        ],
    },
    {
        title: 'Simulation',
        shortcuts: [
            { keys: ['Space'], label: 'Play or pause' },
            { keys: ['1'], label: 'Orbit' },
            { keys: ['2'], label: 'Hover' },
            { keys: ['3'], label: 'Dive' },
            { keys: ['T'], label: 'Timeline editor' },
        ],
    },
    {
        title: 'Timeline editor, while open',
        shortcuts: [
            { keys: ['Space'], label: 'Play or pause the presentation' },
            { keys: ['K'], label: 'Add a keyframe' },
            { keys: ['Ctrl', 'Z'], label: 'Undo' },
            { keys: ['Ctrl', 'Y'], label: 'Redo' },
        ],
    },
];

const MODE_KEYS: Record<string, ObserverMode> = { '1': 'orbit', '2': 'hover', '3': 'dive' };

function isEditable(target: Element | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
    );
}

// Space activates focused buttons, switches and sliders, so it only plays or pauses when the
// focus is on the page itself or the canvas.
function isInteractive(target: Element | null): boolean {
    if (!(target instanceof HTMLElement) || target === document.body) return false;
    if (target instanceof HTMLCanvasElement) return false;
    return target.closest('button, a, [role], [tabindex]') !== null;
}

function insideOverlay(target: Element | null): boolean {
    return (
        target instanceof HTMLElement && target.closest('[role="dialog"], [role="menu"]') !== null
    );
}

export function toggleInterface(): void {
    const { uiHidden, setUiHidden } = useUi.getState();
    setUiHidden(!uiHidden);
    if (!uiHidden) toast('Interface hidden · press H to show it', { id: 'ui-hidden' });
    else toast.dismiss('ui-hidden');
}

function handleKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    const target = event.target instanceof Element ? event.target : null;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const ui = useUi.getState();

    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'k') {
        event.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditable(target) || insideOverlay(target)) return;

    const timelineOpen = timelinePanel()?.isOpen() ?? false;
    let handled = true;
    if (key === '?') {
        ui.setShortcutsOpen(true);
    } else if (key === ' ') {
        if (timelineOpen || isInteractive(target)) return;
        togglePlayback();
    } else if (key in MODE_KEYS) {
        if (presentationBusy()) return;
        enterMode(MODE_KEYS[key]);
    } else if (key === 'h') {
        toggleInterface();
    } else if (key === 'f') {
        toggleFullscreen();
    } else if (key === 't') {
        timelinePanel()?.toggle();
    } else if (key === 'p') {
        saveScreenshot();
    } else if (key === 'r') {
        toggleRecording();
    } else {
        handled = false;
    }
    if (handled) event.preventDefault();
}

export function installShortcuts(): () => void {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
}
