import { useId, useMemo, useState } from 'react';
import { Tabs } from 'radix-ui';
import { Crosshair, Link2, RotateCcw, Search, Timer, X } from 'lucide-react';
import { toast } from 'sonner';
import { params, resetCamera, resetSimulationClock } from '../../engine/engine';
import { useEngineValue } from '../../engine/hooks';
import {
    createMassScale,
    formatDuration,
    formatLength,
    formatNumber,
    formatPower,
    formatTemperature,
} from '../../lib/units';
import {
    PARAMS,
    PARAMS_BY_ID,
    TABS,
    type InspectorTab,
    type ParamDef,
} from '../../params/registry';
import {
    isModified,
    paramVisible,
    resetParams,
    searchParams,
    sectionsOf,
    tabLabel,
} from '../../params/params';
import { copyViewLink } from '../../state/share';
import { useUi } from '../../state/ui-store';
import { ParamRow } from './ParamRow';

function Section({ name, defs, title }: { name: string; defs: ParamDef[]; title?: string }) {
    const headingId = useId();
    const shown = useEngineValue(() => defs.some(paramVisible));
    const modified = useEngineValue(() => defs.some((def) => paramVisible(def) && isModified(def)));
    if (!shown) return null;
    return (
        <section className="param-section" aria-labelledby={headingId}>
            <header className="param-section-head">
                <h3 id={headingId} className="caps-label">
                    {title ?? name}
                </h3>
                {modified ? (
                    <button
                        type="button"
                        className="text-btn"
                        aria-label={`Reset ${title ?? name}`}
                        onClick={() => resetParams(defs.filter(paramVisible))}
                    >
                        Reset
                    </button>
                ) : null}
            </header>
            {defs.map((def) => (
                <ParamRow key={def.id} def={def} />
            ))}
        </section>
    );
}

// Physical scale of the hole from src/features/units, for the mass and spin in the inspector.
function DerivedCard() {
    const mass = useEngineValue(() => params().disk.mass_msun);
    const spin = useEngineValue(() =>
        params().black_hole.spin_enabled ? params().black_hole.spin : 0,
    );
    const physical = useEngineValue(() => params().disk.temperature_mode === 'physical');
    const eddington = useEngineValue(() => params().disk.eddington_ratio);
    const colorCorrection = useEngineValue(
        () => (params().disk as { color_correction?: number }).color_correction ?? 1,
    );
    const rows = useMemo(() => {
        const scale = createMassScale({
            massSolar: mass,
            spin: Math.max(-0.998, Math.min(0.998, spin)),
        });
        const radius = (valueM: number) => formatNumber(valueM / 2, { decimals: 2 });
        const list: [string, string, string?][] = [
            ['Event horizon r₊', radius(scale.radiiM.horizonOuter), 'r_s'],
            ['ISCO (prograde)', radius(scale.radiiM.iscoPrograde), 'r_s'],
            ['Photon orbit (prograde)', radius(scale.radiiM.photonOrbitPrograde), 'r_s'],
            ['Schwarzschild radius', formatLength(scale.schwarzschildRadius)],
            ['Light crossing r_s/c', formatDuration(scale.lightCrossingTime)],
            ['Eddington luminosity', formatPower(scale.eddingtonLuminosity)],
        ];
        if (physical) {
            const peak = scale.diskPeakTemperature(eddington, { colorCorrection });
            list.push(['Disk peak temperature', formatTemperature(peak.temperature)]);
        }
        return list;
    }, [mass, spin, physical, eddington, colorCorrection]);
    return (
        <section className="derived-card" aria-labelledby="derived-heading">
            <h3 id="derived-heading" className="caps-label">
                Derived quantities
            </h3>
            <dl>
                {rows.map(([label, value, unit]) => (
                    <div key={label} className="derived-row">
                        <dt>{label}</dt>
                        <dd className="num">
                            {value}
                            {unit ? <span className="derived-unit"> {unit}</span> : null}
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

function ObserverActions() {
    return (
        <div className="inspector-actions">
            <button type="button" className="btn btn--secondary" onClick={resetCamera}>
                <Crosshair size={15} aria-hidden="true" />
                Reset camera
            </button>
            <button type="button" className="btn btn--secondary" onClick={resetSimulationClock}>
                <Timer size={15} aria-hidden="true" />
                Reset clock
            </button>
        </div>
    );
}

function TabSections({ tab }: { tab: InspectorTab }) {
    const sections = useMemo(() => sectionsOf(PARAMS.filter((def) => def.tab === tab)), [tab]);
    return (
        <>
            {sections.map((section) => (
                <Section key={section.name} name={section.name} defs={section.defs} />
            ))}
            {tab === 'blackhole' ? <DerivedCard /> : null}
            {tab === 'observer' ? <ObserverActions /> : null}
        </>
    );
}

function FilterResults({ query }: { query: string }) {
    const ids = useEngineValue(() =>
        searchParams(query)
            .map((def) => def.id)
            .join('\n'),
    );
    const defs = ids ? ids.split('\n').map((id) => PARAMS_BY_ID.get(id)!) : [];
    if (!defs.length) {
        return (
            <p className="inspector-empty" role="status">
                No parameter matches “{query}”.
            </p>
        );
    }
    const groups = sectionsOf(defs);
    return (
        <>
            <p className="sr-only" role="status">
                {defs.length} matching parameters
            </p>
            {groups.map((group) => (
                <Section
                    key={`${group.defs[0].tab}-${group.name}`}
                    name={group.name}
                    title={`${tabLabel(group.defs[0])} · ${group.name}`}
                    defs={group.defs}
                />
            ))}
        </>
    );
}

function resetAll(): void {
    const count = resetParams(PARAMS);
    toast(count ? `Reset ${count} parameter${count === 1 ? '' : 's'}` : 'Nothing to reset', {
        id: 'reset-all',
    });
}

export function Inspector() {
    const open = useUi((state) => state.inspectorOpen);
    const tab = useUi((state) => state.inspectorTab);
    const setTab = useUi((state) => state.setInspectorTab);
    const [query, setQuery] = useState('');
    const filtering = query.trim().length > 0;
    if (!open) return null;
    return (
        <aside id="inspector" className="inspector glass" aria-label="Parameters">
            <Tabs.Root
                className="inspector-tabs-root"
                value={tab}
                onValueChange={(value) => setTab(value as InspectorTab)}
            >
                <Tabs.List className="inspector-tabs" aria-label="Parameter groups">
                    {TABS.map((item) => (
                        <Tabs.Trigger key={item.id} value={item.id} className="inspector-tab">
                            {item.label}
                        </Tabs.Trigger>
                    ))}
                </Tabs.List>
                <div className="inspector-filter">
                    <Search size={15} aria-hidden="true" />
                    <input
                        type="text"
                        value={query}
                        placeholder="Filter parameters"
                        aria-label="Filter parameters in all tabs"
                        spellCheck={false}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape' && query) {
                                event.stopPropagation();
                                setQuery('');
                            }
                        }}
                    />
                    {query ? (
                        <button
                            type="button"
                            className="icon-btn filter-clear"
                            aria-label="Clear filter"
                            onClick={() => setQuery('')}
                        >
                            <X size={14} aria-hidden="true" />
                        </button>
                    ) : null}
                </div>
                {TABS.map((item) => (
                    <Tabs.Content key={item.id} value={item.id} className="inspector-body">
                        {filtering ? (
                            <FilterResults query={query} />
                        ) : (
                            <TabSections tab={item.id} />
                        )}
                    </Tabs.Content>
                ))}
            </Tabs.Root>
            <footer className="inspector-footer">
                <button type="button" className="btn btn--ghost" onClick={resetAll}>
                    <RotateCcw size={15} aria-hidden="true" />
                    Reset all
                </button>
                <button type="button" className="btn btn--secondary" onClick={copyViewLink}>
                    <Link2 size={15} aria-hidden="true" />
                    Copy view link
                </button>
            </footer>
        </aside>
    );
}
