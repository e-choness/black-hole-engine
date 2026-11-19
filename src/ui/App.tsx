import { Tooltip } from 'radix-ui';
import { ModeRail } from './components/ModeRail';
import { Notices } from './components/Notices';
import { TopBar } from './components/TopBar';
import { useUi } from './state/ui-store';

export function App() {
    const uiHidden = useUi((state) => state.uiHidden);
    return (
        <Tooltip.Provider delayDuration={400}>
            <div className="shell" data-ui-hidden={uiHidden}>
                <TopBar />
                <ModeRail />
                <div className="shell-stage" />
            </div>
            <Notices />
        </Tooltip.Provider>
    );
}
