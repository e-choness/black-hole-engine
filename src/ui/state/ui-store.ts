import { create } from 'zustand';
import { focusControl } from '../lib/focus';
import type { InspectorTab } from '../params/registry';

// Below this width the inspector would cover most of the view, so it starts closed.
const INSPECTOR_OPEN_QUERY = '(min-width: 1100px)';

interface UiState {
    uiHidden: boolean;
    inspectorOpen: boolean;
    inspectorTab: InspectorTab;
    inspectorFilter: string;
    paletteOpen: boolean;
    shortcutsOpen: boolean;
    captureOpen: boolean;
    captureTab: CaptureTab;
    physicsOpen: boolean;
    setUiHidden: (hidden: boolean) => void;
    setInspectorOpen: (open: boolean) => void;
    setInspectorTab: (tab: InspectorTab) => void;
    setInspectorFilter: (query: string) => void;
    setPaletteOpen: (open: boolean) => void;
    setShortcutsOpen: (open: boolean) => void;
    setCaptureOpen: (open: boolean) => void;
    setCaptureTab: (tab: CaptureTab) => void;
    setPhysicsOpen: (open: boolean) => void;
}

export type CaptureTab = 'screenshot' | 'video';

// Only one overlay is open at a time.
const OVERLAYS_CLOSED = {
    paletteOpen: false,
    shortcutsOpen: false,
    captureOpen: false,
    physicsOpen: false,
};

export const useUi = create<UiState>()((set) => ({
    uiHidden: false,
    inspectorOpen: window.matchMedia(INSPECTOR_OPEN_QUERY).matches,
    inspectorTab: 'blackhole',
    inspectorFilter: '',
    paletteOpen: false,
    shortcutsOpen: false,
    captureOpen: false,
    captureTab: 'video',
    physicsOpen: false,
    setUiHidden: (uiHidden) => set({ uiHidden }),
    setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
    setInspectorTab: (inspectorTab) => set({ inspectorTab }),
    setInspectorFilter: (inspectorFilter) => set({ inspectorFilter }),
    setPaletteOpen: (paletteOpen) =>
        set(paletteOpen ? { ...OVERLAYS_CLOSED, paletteOpen } : { paletteOpen }),
    setShortcutsOpen: (shortcutsOpen) =>
        set(shortcutsOpen ? { ...OVERLAYS_CLOSED, shortcutsOpen } : { shortcutsOpen }),
    setCaptureOpen: (captureOpen) =>
        set(captureOpen ? { ...OVERLAYS_CLOSED, captureOpen } : { captureOpen }),
    setCaptureTab: (captureTab) => set({ captureTab }),
    setPhysicsOpen: (physicsOpen) =>
        set(physicsOpen ? { ...OVERLAYS_CLOSED, physicsOpen } : { physicsOpen }),
}));

// Opens the inspector on the tab of a parameter; focusParam() then moves the focus to its control
// once the row has rendered.
export function revealParam(tab: InspectorTab): void {
    useUi.setState({ inspectorOpen: true, inspectorTab: tab, inspectorFilter: '' });
}

export function focusParam(id: string): void {
    requestAnimationFrame(() => {
        const row = document.getElementById(`param-${id}`);
        if (!row) return;
        row.scrollIntoView({ block: 'center' });
        focusControl(row);
    });
}

export function openCapture(tab: CaptureTab): void {
    useUi.setState({ ...OVERLAYS_CLOSED, captureOpen: true, captureTab: tab });
}
