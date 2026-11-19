import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Command } from 'cmdk';
import { Dialog } from 'radix-ui';
import { ArrowLeft, CornerDownLeft, Search, Sparkles } from 'lucide-react';
import {
    applyBlackHolePreset,
    applyQualityPreset,
    enterMode,
    qualityPresetLabels,
    resetCamera,
    resetSimulationClock,
    timelinePanel,
} from '../engine/engine';
import { stepPlayback, togglePlayback } from '../engine/playback';
import { focusControl } from '../lib/focus';
import { toggleFullscreen } from '../lib/fullscreen';
import { MOD_KEY } from '../lib/keys';
import { portalContainer } from '../lib/portal';
import { SCENARIOS } from '../lib/scenarios';
import { readParam, resetParam, searchParams, setParam, tabLabel } from '../params/params';
import { PARAMS_BY_ID, type ParamDef } from '../params/registry';
import { copyViewLink } from '../state/share';
import { toggleInterface } from '../state/shortcuts';
import { focusParam, revealParam, useUi } from '../state/ui-store';
import { resetAll } from './inspector/Inspector';
import { formatParamValue, ParamRow } from './inspector/ParamRow';

const MAX_PARAM_RESULTS = 12;

interface Action {
    id: string;
    label: string;
    keys?: string[];
    keywords?: string;
    run: () => void;
}

function param(id: string): ParamDef {
    const def = PARAMS_BY_ID.get(id);
    if (!def) throw new Error(`Unknown parameter ${id}`);
    return def;
}

function spinTo(value: number): void {
    setParam(param('black_hole.spin_enabled'), true);
    setParam(param('black_hole.spin'), value);
}

function actions(): Action[] {
    const ui = useUi.getState();
    return [
        { id: 'play', label: 'Play or pause', keys: ['Space'], run: togglePlayback },
        { id: 'step', label: 'Step forward', run: () => stepPlayback(1) },
        { id: 'camera', label: 'Reset camera', keywords: 'view orbit', run: resetCamera },
        {
            id: 'clock',
            label: 'Reset simulation clock',
            keywords: 'time',
            run: resetSimulationClock,
        },
        {
            id: 'link',
            label: 'Copy view link',
            keywords: 'share url',
            run: () => void copyViewLink(),
        },
        {
            id: 'inspector',
            label: ui.inspectorOpen ? 'Hide parameters' : 'Show parameters',
            keywords: 'inspector panel',
            run: () => ui.setInspectorOpen(!ui.inspectorOpen),
        },
        {
            id: 'timeline',
            label: 'Timeline editor',
            keys: ['T'],
            keywords: 'presentation keyframes',
            run: () => timelinePanel()?.toggle(),
        },
        {
            id: 'hide',
            label: 'Hide the interface',
            keys: ['H'],
            run: toggleInterface,
        },
        { id: 'fullscreen', label: 'Fullscreen', keys: ['F'], run: toggleFullscreen },
        {
            id: 'shortcuts',
            label: 'Keyboard shortcuts and help',
            keys: ['?'],
            keywords: 'legal source about',
            run: () => ui.setShortcutsOpen(true),
        },
        {
            id: 'thorne',
            label: 'Set spin to the Thorne limit (0.998)',
            keywords: 'kerr maximal',
            run: () => spinTo(0.998),
        },
        {
            id: 'spin-reset',
            label: 'Reset spin to the scenario value',
            run: () => resetParam(param('black_hole.spin')),
        },
        {
            id: 'full-kerr',
            label: 'Switch to the Full Kerr solver',
            keywords: 'geodesic exact',
            run: () => setParam(param('kerr_mode'), 'full_kerr'),
        },
        { id: 'reset-all', label: 'Reset all parameters', run: resetAll },
        { id: 'orbit', label: 'Orbit mode', keys: ['1'], run: () => enterMode('orbit') },
        { id: 'hover', label: 'Hover mode', keys: ['2'], run: () => enterMode('hover') },
        {
            id: 'dive',
            label: 'Dive mode',
            keys: ['3'],
            keywords: 'fall',
            run: () => enterMode('dive'),
        },
    ];
}

// Parameters whose label matches come first, in registry order within each rank.
function rankedParams(query: string): ParamDef[] {
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);
    const rank = (def: ParamDef) => {
        const label = def.label.toLowerCase();
        if (label.startsWith(lower)) return 0;
        return terms.every((term) => label.includes(term)) ? 1 : 2;
    };
    return searchParams(query)
        .map((def, index) => ({ def, index, rank: rank(def) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .slice(0, MAX_PARAM_RESULTS)
        .map((entry) => entry.def);
}

function matches(text: string, query: string): boolean {
    const haystack = text.toLowerCase();
    return query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((term) => haystack.includes(term));
}

function Keys({ keys }: { keys: string[] }) {
    return (
        <span className="palette-keys" aria-hidden="true">
            {keys.map((key) => (
                <kbd key={key} className="kbd">
                    {key}
                </kbd>
            ))}
        </span>
    );
}

function Item({
    value,
    onSelect,
    children,
}: {
    value: string;
    onSelect: () => void;
    children: ReactNode;
}) {
    return (
        <Command.Item value={value} onSelect={onSelect} className="palette-item">
            {children}
        </Command.Item>
    );
}

function contextLabel(def: ParamDef): string {
    const tab = tabLabel(def);
    return def.section.toLowerCase() === tab.toLowerCase() ? tab : `${tab} · ${def.section}`;
}

function AdjustPanel({ def, onBack }: { def: ParamDef; onBack: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    // The dialog moves the focus to itself when the search field unmounts, so the control is
    // focused on the next frame.
    useEffect(() => {
        const frame = requestAnimationFrame(() => focusControl(ref.current));
        return () => cancelAnimationFrame(frame);
    }, []);
    return (
        <div className="palette-adjust" ref={ref}>
            <div className="palette-adjust-head">
                <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label="Back to the results"
                    onClick={onBack}
                >
                    <ArrowLeft size={16} aria-hidden="true" />
                </button>
                <span className="caps-label">{contextLabel(def)}</span>
            </div>
            <ParamRow def={def} anchored={false} />
            <p className="palette-help">{def.help}</p>
            <div className="palette-footer" aria-hidden="true">
                <span>
                    <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> adjust
                </span>
                <span>
                    <kbd className="kbd">Esc</kbd> back
                </span>
            </div>
        </div>
    );
}

// cmdk 1.1.1 looks up the selected option in the DOM before React has rendered the new selection,
// so after the results change its aria-activedescendant names a stale or removed option. This keeps
// the input and the list pointing at the option that is actually selected.
function useActiveOptionSync(ref: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const root = ref.current;
        if (!root) return;
        const sync = () => {
            const id = root.querySelector('[cmdk-item][aria-selected="true"]')?.id;
            root.querySelectorAll('[cmdk-input], [cmdk-list]').forEach((node) => {
                if (!id) node.removeAttribute('aria-activedescendant');
                else if (node.getAttribute('aria-activedescendant') !== id) {
                    node.setAttribute('aria-activedescendant', id);
                }
            });
        };
        const observer = new MutationObserver(sync);
        observer.observe(root, {
            subtree: true,
            childList: true,
            attributeFilter: ['aria-selected', 'aria-activedescendant'],
        });
        sync();
        return () => observer.disconnect();
    }, [ref]);
}

// Rendered only while the palette is open, so every opening starts with an empty search.
function PaletteContent({ onClose }: { onClose: () => void }) {
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState('');
    const [adjusting, setAdjusting] = useState<ParamDef | null>(null);
    const revealed = useRef<string | null>(null);
    const content = useRef<HTMLDivElement>(null);
    useActiveOptionSync(content);

    const run = (action: () => void) => {
        onClose();
        action();
    };
    const reveal = (def: ParamDef) => {
        revealed.current = def.id;
        run(() => revealParam(def.tab));
    };
    const query = search.trim();
    const params = query ? rankedParams(query) : [];
    const shownActions = actions().filter(
        (action) => !query || matches(`${action.label} ${action.keywords ?? ''}`, query),
    );
    const scenarios = SCENARIOS.filter(
        (scenario) =>
            !query || matches(`${scenario.name} ${scenario.summary} scenario preset`, query),
    );
    const qualities = Object.entries(qualityPresetLabels).filter(
        ([label, value]) => value !== 'custom' && (!query || matches(`${label} quality`, query)),
    );

    return (
        <Dialog.Content
            ref={content}
            className="palette glass bh-ui"
            aria-describedby={undefined}
            onEscapeKeyDown={(event) => {
                if (adjusting) {
                    event.preventDefault();
                    setAdjusting(null);
                }
            }}
            onCloseAutoFocus={(event) => {
                if (!revealed.current) return;
                event.preventDefault();
                focusParam(revealed.current);
            }}
        >
            <Dialog.Title className="sr-only">Command palette</Dialog.Title>
            {adjusting ? (
                <AdjustPanel def={adjusting} onBack={() => setAdjusting(null)} />
            ) : (
                <Command
                    label="Commands"
                    shouldFilter={false}
                    loop
                    value={selected}
                    onValueChange={setSelected}
                    onKeyDown={(event) => {
                        if (event.key !== 'Tab' || !selected.startsWith('param:')) return;
                        const def = PARAMS_BY_ID.get(selected.slice('param:'.length));
                        if (!def) return;
                        event.preventDefault();
                        setAdjusting(def);
                    }}
                >
                    <div className="palette-search">
                        <Search size={16} aria-hidden="true" />
                        <Command.Input
                            autoFocus
                            value={search}
                            onValueChange={setSearch}
                            placeholder="Search parameters, scenarios and actions"
                        />
                        <kbd className="kbd" aria-hidden="true">
                            Esc
                        </kbd>
                    </div>
                    <Command.List className="palette-list">
                        <Command.Empty className="palette-empty">
                            Nothing matches “{query}”
                        </Command.Empty>
                        {params.length > 0 && (
                            <Command.Group heading="Parameters" className="palette-group">
                                {params.map((def) => (
                                    <Item
                                        key={def.id}
                                        value={`param:${def.id}`}
                                        onSelect={() => reveal(def)}
                                    >
                                        <span className="palette-label">
                                            {def.label}
                                            <span className="palette-context">
                                                {' '}
                                                — {tabLabel(def)}
                                            </span>
                                        </span>
                                        <span className="num palette-value">
                                            {formatParamValue(def, readParam(def))}
                                        </span>
                                        <CornerDownLeft
                                            size={14}
                                            className="palette-enter"
                                            aria-hidden="true"
                                        />
                                    </Item>
                                ))}
                            </Command.Group>
                        )}
                        {shownActions.length > 0 && (
                            <Command.Group heading="Actions" className="palette-group">
                                {shownActions.map((action) => (
                                    <Item
                                        key={action.id}
                                        value={`action:${action.id}`}
                                        onSelect={() => run(action.run)}
                                    >
                                        <span className="palette-label">{action.label}</span>
                                        {action.keys && <Keys keys={action.keys} />}
                                    </Item>
                                ))}
                            </Command.Group>
                        )}
                        {scenarios.length > 0 && (
                            <Command.Group heading="Scenarios" className="palette-group">
                                {scenarios.map((scenario) => (
                                    <Item
                                        key={scenario.id}
                                        value={`scenario:${scenario.id}`}
                                        onSelect={() =>
                                            run(() => applyBlackHolePreset(scenario.name))
                                        }
                                    >
                                        <Sparkles
                                            size={15}
                                            className="palette-icon"
                                            aria-hidden="true"
                                        />
                                        <span className="palette-label">
                                            {scenario.name}
                                            <span className="palette-context">
                                                {' '}
                                                — {scenario.summary}
                                            </span>
                                        </span>
                                    </Item>
                                ))}
                            </Command.Group>
                        )}
                        {qualities.length > 0 && (
                            <Command.Group heading="Render quality" className="palette-group">
                                {qualities.map(([label, value]) => (
                                    <Item
                                        key={value}
                                        value={`quality:${value}`}
                                        onSelect={() => run(() => applyQualityPreset(value))}
                                    >
                                        <span className="palette-label">Quality: {label}</span>
                                    </Item>
                                ))}
                            </Command.Group>
                        )}
                    </Command.List>
                    <div className="palette-footer" aria-hidden="true">
                        <span>
                            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> navigate
                        </span>
                        <span>
                            <kbd className="kbd">↵</kbd> open
                        </span>
                        <span>
                            <kbd className="kbd">Tab</kbd> adjust value inline
                        </span>
                        <span>
                            <kbd className="kbd">{MOD_KEY}</kbd> <kbd className="kbd">K</kbd> close
                        </span>
                    </div>
                </Command>
            )}
        </Dialog.Content>
    );
}

export function CommandPalette() {
    const open = useUi((state) => state.paletteOpen);
    const setOpen = useUi((state) => state.setPaletteOpen);
    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal container={portalContainer()}>
                <Dialog.Overlay className="dialog-overlay" />
                <PaletteContent onClose={() => setOpen(false)} />
            </Dialog.Portal>
        </Dialog.Root>
    );
}
