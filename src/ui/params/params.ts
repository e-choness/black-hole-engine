// Reads and writes registry parameters. Every UI write goes through setParam(), which clamps and
// snaps the value, writes it, marks the scenario or quality preset as customised and applies the
// change (uniform upload or shader rebuild). The reference value of the per-row reset is the value
// at start-up, retaken for a group whenever its scenario or quality preset is applied.

import {
    commitParamChange,
    getPathValue,
    markQualityCustom,
    markScenarioCustom,
    params,
    setPathValue,
    subscribePresetApplied,
    type PresetKind,
} from '../engine/engine';
import { PARAMS, TABS, type ParamDef, type ParamValue, type SliderDef } from './registry';

const reference = new Map<string, ParamValue>();

export function readParam(def: ParamDef): ParamValue {
    return def.get ? def.get() : (getPathValue(def.path) as ParamValue);
}

function captureReference(kind?: PresetKind): void {
    for (const def of PARAMS) {
        if (kind === undefined || def.track === kind) reference.set(def.id, readParam(def));
    }
}

export function initParams(): void {
    captureReference();
    subscribePresetApplied(captureReference);
}

export function referenceValue(def: ParamDef): ParamValue | undefined {
    return reference.get(def.id);
}

export function paramVisible(def: ParamDef): boolean {
    if (def.available && !def.available()) return false;
    return def.visible ? def.visible(params()) : true;
}

export function sliderFloor(def: SliderDef): number {
    return def.floor ? Math.max(def.min, def.floor(params())) : def.min;
}

function stepDecimals(step: number): number {
    const text = String(step);
    if (text.includes('e-')) return Number(text.split('e-')[1]);
    return text.includes('.') ? text.split('.')[1].length : 0;
}

export function clampSlider(def: SliderDef, value: number): number {
    const low = sliderFloor(def);
    let next = Math.min(def.max, Math.max(low, value));
    if (def.scale === 'log') {
        next = Number(next.toPrecision(4));
    } else if (def.step > 0) {
        const steps = Math.round((next - def.min) / def.step);
        next = Number((def.min + steps * def.step).toFixed(stepDecimals(def.step)));
    }
    return Math.min(def.max, Math.max(low, next));
}

function normalize(def: ParamDef, value: ParamValue): ParamValue | undefined {
    if (def.control === 'slider') {
        const numeric = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(numeric) ? clampSlider(def, numeric) : undefined;
    }
    if (def.control === 'toggle') return Boolean(value);
    return def.options.some((option) => option.value === value) ? String(value) : undefined;
}

export function setParam(def: ParamDef, value: ParamValue): void {
    const next = normalize(def, value);
    if (next === undefined) return;
    if (def.set) {
        def.set(next);
        return;
    }
    def.before?.();
    if (!setPathValue(def.path, next)) return;
    if (def.track === 'scenario') markScenarioCustom();
    else if (def.track === 'quality') markQualityCustom();
    commitParamChange(def.apply);
}

function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
    if (typeof a === 'number' && typeof b === 'number') {
        return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    }
    return a === b;
}

export function isModified(def: ParamDef): boolean {
    return !sameValue(readParam(def), reference.get(def.id));
}

export function resetParam(def: ParamDef): void {
    const value = reference.get(def.id);
    if (value !== undefined) setParam(def, value);
}

// Registry order puts switches before the rows they reveal, so resetting in order also restores
// the visibility the reference values imply.
export function resetParams(defs: ParamDef[]): number {
    let count = 0;
    for (const def of defs) {
        if (isModified(def)) {
            resetParam(def);
            count += 1;
        }
    }
    return count;
}

export function sectionsOf(defs: ParamDef[]): { name: string; defs: ParamDef[] }[] {
    const sections: { name: string; defs: ParamDef[] }[] = [];
    for (const def of defs) {
        const last = sections[sections.length - 1];
        if (last && last.name === def.section) last.defs.push(def);
        else sections.push({ name: def.section, defs: [def] });
    }
    return sections;
}

export function tabLabel(def: ParamDef): string {
    return TABS.find((tab) => tab.id === def.tab)?.label ?? def.tab;
}

export function searchParams(query: string): ParamDef[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return PARAMS.filter((def) => {
        const haystack = [def.label, def.section, tabLabel(def), def.path, def.help]
            .join(' ')
            .toLowerCase();
        return terms.every((term) => haystack.includes(term)) && paramVisible(def);
    });
}
