import { useState } from 'react';
import { ToggleGroup } from 'radix-ui';
import { ArrowDownToLine, ChartGantt, Crosshair, Info, Orbit, Video } from 'lucide-react';
import { currentMode, enterMode, timelinePanel, type ObserverMode } from '../engine/engine';
import { useEngineValue } from '../engine/hooks';
import { useFrameSampler } from '../engine/telemetry';
import { useUi } from '../state/ui-store';

const MODES: { value: ObserverMode; label: string; icon: typeof Orbit; key: string }[] = [
    { value: 'orbit', label: 'Orbit', icon: Orbit, key: '1' },
    { value: 'hover', label: 'Hover', icon: Crosshair, key: '2' },
    { value: 'dive', label: 'Dive', icon: ArrowDownToLine, key: '3' },
];

export function toggleTimeline(): void {
    timelinePanel()?.toggle();
}

// The editor opens and closes itself too (its close button, Esc), so its state is polled.
export function useTimelineOpen(): boolean {
    const [open, setOpen] = useState(false);
    useFrameSampler(() => {
        const next = timelinePanel()?.isOpen() ?? false;
        if (next !== open) setOpen(next);
    });
    return open;
}

export function ModeRail() {
    const mode = useEngineValue(currentMode);
    const timelineOpen = useTimelineOpen();
    const setCaptureOpen = useUi((state) => state.setCaptureOpen);
    const setPhysicsOpen = useUi((state) => state.setPhysicsOpen);
    return (
        <nav className="rail glass" aria-label="Modes">
            <ToggleGroup.Root
                type="single"
                orientation="vertical"
                value={mode}
                onValueChange={(value) => value && enterMode(value as ObserverMode)}
                aria-label="Observer mode"
                className="rail-group"
            >
                {MODES.map(({ value, label, icon: Icon, key }) => (
                    <ToggleGroup.Item
                        key={value}
                        value={value}
                        className="rail-btn"
                        aria-keyshortcuts={key}
                    >
                        <Icon size={20} aria-hidden="true" />
                        {label}
                    </ToggleGroup.Item>
                ))}
            </ToggleGroup.Root>
            <span className="rail-sep" aria-hidden="true" />
            <button
                type="button"
                className="rail-btn"
                id="tl-open-btn"
                aria-pressed={timelineOpen}
                aria-keyshortcuts="T"
                onClick={toggleTimeline}
            >
                <ChartGantt size={20} aria-hidden="true" />
                Timeline
            </button>
            <button
                type="button"
                className="rail-btn"
                aria-haspopup="dialog"
                onClick={() => setCaptureOpen(true)}
            >
                <Video size={20} aria-hidden="true" />
                Capture
            </button>
            <span className="rail-sep" aria-hidden="true" />
            <button
                type="button"
                className="rail-btn"
                aria-haspopup="dialog"
                onClick={() => setPhysicsOpen(true)}
            >
                <Info size={20} aria-hidden="true" />
                Physics
            </button>
        </nav>
    );
}

// Phones have no rail, so the parameter sheet carries the mode switch.
export function ModeSwitch() {
    const mode = useEngineValue(currentMode);
    return (
        <div className="mode-switch">
            <span id="mode-switch-label" className="caps-label">
                Mode
            </span>
            <ToggleGroup.Root
                type="single"
                value={mode}
                onValueChange={(value) => value && enterMode(value as ObserverMode)}
                aria-labelledby="mode-switch-label"
                className="segmented"
            >
                {MODES.map(({ value, label, key }) => (
                    <ToggleGroup.Item
                        key={value}
                        value={value}
                        className="segmented-item"
                        aria-keyshortcuts={key}
                    >
                        {label}
                    </ToggleGroup.Item>
                ))}
            </ToggleGroup.Root>
        </div>
    );
}
