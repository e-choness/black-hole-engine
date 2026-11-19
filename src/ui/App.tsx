import { useEffect } from 'react';
import { Tooltip } from 'radix-ui';
import { Footer } from './components/Footer';
import { Inspector } from './components/inspector/Inspector';
import { ModeRail } from './components/ModeRail';
import { Notices } from './components/Notices';
import { TopBar } from './components/TopBar';
import { startViewStateSync } from './state/share';
import { useUi } from './state/ui-store';

export function App() {
    const uiHidden = useUi((state) => state.uiHidden);
    const inspectorOpen = useUi((state) => state.inspectorOpen);
    useEffect(startViewStateSync, []);
    return (
        <Tooltip.Provider delayDuration={400}>
            <div className="shell" data-ui-hidden={uiHidden} data-inspector-open={inspectorOpen}>
                <TopBar />
                <ModeRail />
                <div className="shell-stage" />
                <Inspector />
                <Footer />
            </div>
            <Notices />
        </Tooltip.Provider>
    );
}
