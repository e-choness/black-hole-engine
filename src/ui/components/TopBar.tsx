import { useEffect, useRef, useState } from 'react';
import { DropdownMenu, Popover, ToggleGroup } from 'radix-ui';
import {
    Check,
    ChevronDown,
    Gauge,
    Link2,
    Maximize,
    Minimize,
    Orbit,
    SlidersHorizontal,
} from 'lucide-react';
import {
    activeBlackHolePreset,
    applyBlackHolePreset,
    applyKerrMode,
    applyQualityPreset,
    params,
    qualityPresetLabels,
    type KerrMode,
} from '../engine/engine';
import { useEngineValue } from '../engine/hooks';
import { useFrameSampler } from '../engine/telemetry';
import { portalContainer } from '../lib/portal';
import { formatSpin, SCENARIOS, scenarioLabel, SOLVER_LABELS } from '../lib/scenarios';
import { copyViewLink } from '../state/share';
import { useUi } from '../state/ui-store';

function ScenarioPicker() {
    const active = useEngineValue(activeBlackHolePreset);
    const spin = useEngineValue(() => params().black_hole.spin);
    const spinEnabled = useEngineValue(() => params().black_hole.spin_enabled);
    const solver = useEngineValue(() => params().kerr_mode);
    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger className="scenario-btn">
                <span className="sr-only">Scenario: </span>
                <span className="chip">{scenarioLabel(active)}</span>
                <span className="scenario-btn-detail">
                    {formatSpin(spin, spinEnabled)} · {SOLVER_LABELS[solver]}
                </span>
                <ChevronDown size={14} aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal container={portalContainer()}>
                <DropdownMenu.Content
                    className="popover scenario-list bh-ui"
                    sideOffset={8}
                    align="start"
                >
                    <DropdownMenu.Label className="caps-label menu-label">
                        Scenarios
                    </DropdownMenu.Label>
                    <DropdownMenu.RadioGroup value={active} onValueChange={applyBlackHolePreset}>
                        {SCENARIOS.map((scenario) => (
                            <DropdownMenu.RadioItem
                                key={scenario.name}
                                value={scenario.name}
                                className="menu-item scenario-item"
                            >
                                <span>
                                    {scenario.name}
                                    {scenario.quasar ? ' · Quasar' : ''}
                                </span>
                                <span className="num">
                                    {scenario.massText} · {scenario.spinText}
                                </span>
                                <small>{scenario.summary}</small>
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

const QUALITY_ORDER = ['mobile', 'optimal', 'medium', 'high', 'ultra', 'cinematic'];

export function qualityLabel(value: string): string {
    return (
        Object.keys(qualityPresetLabels).find((key) => qualityPresetLabels[key] === value) ?? value
    );
}

export function qualityName(value: string): string {
    return value === 'custom' ? 'Custom' : qualityLabel(value).replace(/\s*\(.*\)$/, '');
}

function QualityChip() {
    const quality = useEngineValue(() => params().quality);
    const solver = useEngineValue(() => params().kerr_mode);
    const statsRef = useRef<HTMLSpanElement>(null);
    const costRef = useRef<HTMLSpanElement>(null);
    const chipRef = useRef<HTMLButtonElement>(null);
    useFrameSampler((sample) => {
        if (!statsRef.current || !costRef.current || !chipRef.current) return;
        statsRef.current.textContent = sample.rendering ? `${Math.round(sample.fps)} fps` : 'still';
        costRef.current.textContent = sample.rendering
            ? ` · ${sample.renderMs.toFixed(1)} ms`
            : ' · idle';
        chipRef.current.dataset.load = sample.rendering && sample.fps < 30 ? 'busy' : 'ok';
    });
    return (
        <Popover.Root>
            <Popover.Trigger className="quality-chip" ref={chipRef}>
                <Gauge size={15} aria-hidden="true" />
                <span className="quality-chip-name">
                    <span className="sr-only">Quality: </span>
                    {qualityName(quality)}
                </span>
                <span className="num" aria-hidden="true">
                    <span ref={statsRef}>–</span>
                    <span ref={costRef} className="quality-chip-cost" />
                </span>
            </Popover.Trigger>
            <Popover.Portal container={portalContainer()}>
                <Popover.Content className="popover quality-panel bh-ui" sideOffset={8} align="end">
                    <h2 className="caps-label">Render quality</h2>
                    <ToggleGroup.Root
                        type="single"
                        orientation="vertical"
                        value={quality}
                        onValueChange={(value) => value && applyQualityPreset(value)}
                        aria-label="Render quality"
                        className="flex flex-col"
                    >
                        {QUALITY_ORDER.map((value) => (
                            <ToggleGroup.Item key={value} value={value} className="menu-item">
                                <Check
                                    size={14}
                                    aria-hidden="true"
                                    style={{ visibility: quality === value ? 'visible' : 'hidden' }}
                                />
                                {qualityLabel(value)}
                            </ToggleGroup.Item>
                        ))}
                    </ToggleGroup.Root>
                    <h2 className="caps-label mt-3">Geodesic solver</h2>
                    <ToggleGroup.Root
                        type="single"
                        value={solver}
                        onValueChange={(value) => value && applyKerrMode(value as KerrMode)}
                        aria-label="Geodesic solver"
                        className="segmented"
                    >
                        {(Object.keys(SOLVER_LABELS) as KerrMode[]).map((mode) => (
                            <ToggleGroup.Item key={mode} value={mode} className="segmented-item">
                                {SOLVER_LABELS[mode]}
                            </ToggleGroup.Item>
                        ))}
                    </ToggleGroup.Root>
                    <p>
                        Frame time is the CPU time spent issuing a frame; GPU time is not measured.
                    </p>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

export function toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function FullscreenButton() {
    const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);
    useEffect(() => {
        const sync = () => setFullscreen(document.fullscreenElement !== null);
        document.addEventListener('fullscreenchange', sync);
        return () => document.removeEventListener('fullscreenchange', sync);
    }, []);
    return (
        <button
            type="button"
            className="icon-btn"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-keyshortcuts="F"
            onClick={toggleFullscreen}
        >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
    );
}

function InspectorToggle() {
    const open = useUi((state) => state.inspectorOpen);
    const setOpen = useUi((state) => state.setInspectorOpen);
    return (
        <button
            type="button"
            className="icon-btn"
            aria-label="Parameters"
            aria-expanded={open}
            aria-controls={open ? 'inspector' : undefined}
            title="Parameters"
            onClick={() => setOpen(!open)}
        >
            <SlidersHorizontal size={18} aria-hidden="true" />
        </button>
    );
}

export function TopBar() {
    return (
        <header className="topbar">
            <div className="topbar-group glass">
                <div className="brand">
                    <Orbit size={22} aria-hidden="true" />
                    <h1>Black Hole Simulation</h1>
                </div>
                <span className="topbar-divider" aria-hidden="true" />
                <ScenarioPicker />
            </div>
            <span className="topbar-spacer" />
            <div className="topbar-group glass">
                <QualityChip />
                <span className="topbar-divider" aria-hidden="true" />
                <InspectorToggle />
                <button
                    type="button"
                    className="icon-btn topbar-copy-link"
                    aria-label="Copy view link"
                    title="Copy view link"
                    onClick={copyViewLink}
                >
                    <Link2 size={18} aria-hidden="true" />
                </button>
                <FullscreenButton />
            </div>
        </header>
    );
}
