import { create } from 'zustand';

export type InspectorTab = 'blackhole' | 'disk' | 'jets' | 'observer' | 'look' | 'render';

interface UiState {
    uiHidden: boolean;
    inspectorTab: InspectorTab;
    setUiHidden: (hidden: boolean) => void;
    setInspectorTab: (tab: InspectorTab) => void;
}

export const useUi = create<UiState>()((set) => ({
    uiHidden: false,
    inspectorTab: 'blackhole',
    setUiHidden: (uiHidden) => set({ uiHidden }),
    setInspectorTab: (inspectorTab) => set({ inspectorTab }),
}));
