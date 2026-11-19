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
    setUiHidden: (hidden: boolean) => void;
    setInspectorOpen: (open: boolean) => void;
    setInspectorTab: (tab: InspectorTab) => void;
    setInspectorFilter: (query: string) => void;
    setPaletteOpen: (open: boolean) => void;
    setShortcutsOpen: (open: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
    uiHidden: false,
    inspectorOpen: window.matchMedia(INSPECTOR_OPEN_QUERY).matches,
    inspectorTab: 'blackhole',
    inspectorFilter: '',
    paletteOpen: false,
    shortcutsOpen: false,
    setUiHidden: (uiHidden) => set({ uiHidden }),
    setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
    setInspectorTab: (inspectorTab) => set({ inspectorTab }),
    setInspectorFilter: (inspectorFilter) => set({ inspectorFilter }),
    // Only one of the two overlays is open at a time.
    setPaletteOpen: (paletteOpen) =>
        set(paletteOpen ? { paletteOpen, shortcutsOpen: false } : { paletteOpen }),
    setShortcutsOpen: (shortcutsOpen) =>
        set(shortcutsOpen ? { shortcutsOpen, paletteOpen: false } : { shortcutsOpen }),
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
