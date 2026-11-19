import { useEffect } from 'react';
import { Tooltip } from 'radix-ui';
import { CommandPalette } from './components/CommandPalette';
import { Footer } from './components/Footer';
import { Inspector } from './components/inspector/Inspector';
import { ModeRail } from './components/ModeRail';
import { Notices } from './components/Notices';
import { ShortcutSheet } from './components/ShortcutSheet';
import { TopBar } from './components/TopBar';
import { startViewStateSync } from './state/share';
import { installShortcuts } from './state/shortcuts';
import { useUi } from './state/ui-store';

export function App() {
    const uiHidden = useUi((state) => state.uiHidden);
    const inspectorOpen = useUi((state) => state.inspectorOpen);
    useEffect(startViewStateSync, []);
    useEffect(installShortcuts, []);
    return (
        <Tooltip.Provider delayDuration={400}>
            <div className="shell" data-ui-hidden={uiHidden} data-inspector-open={inspectorOpen}>
                <TopBar />
                <ModeRail />
                <div className="shell-stage" />
                <Inspector />
                <Footer />
            </div>
            <CommandPalette />
            <ShortcutSheet />
            <Notices />
        </Tooltip.Provider>
    );
}
