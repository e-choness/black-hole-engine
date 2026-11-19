import { create } from 'zustand';
import type { InspectorTab } from '../params/registry';

// Below this width the inspector would cover most of the view, so it starts closed.
const INSPECTOR_OPEN_QUERY = '(min-width: 1100px)';

interface UiState {
    uiHidden: boolean;
    inspectorOpen: boolean;
    inspectorTab: InspectorTab;
    setUiHidden: (hidden: boolean) => void;
    setInspectorOpen: (open: boolean) => void;
    setInspectorTab: (tab: InspectorTab) => void;
}

export const useUi = create<UiState>()((set) => ({
    uiHidden: false,
    inspectorOpen: window.matchMedia(INSPECTOR_OPEN_QUERY).matches,
    inspectorTab: 'blackhole',
    setUiHidden: (uiHidden) => set({ uiHidden }),
    setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
    setInspectorTab: (inspectorTab) => set({ inspectorTab }),
}));
