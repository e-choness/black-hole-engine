import { formatMass, formatNumber, MINUS } from './units';
import { getMassPreset } from '../../features/units/presets.js';
import {
    blackHolePresets,
    CUSTOM_PRESET,
    type BlackHolePreset,
    type KerrMode,
} from '../engine/engine';

export interface Scenario {
    name: string;
    id: string;
    preset: BlackHolePreset;
    summary: string;
    massText: string;
    spinText: string;
    quasar: boolean;
}

const DISK_LABELS: Record<string, string> = {
    thin_disk: 'Thin disk',
    thick_torus: 'Thick torus',
    slim_disk: 'Slim disk',
};

export const SOLVER_LABELS: Record<KerrMode, string> = {
    fast: 'Binet · fast',
    kerr_inspired_disk_velocity: 'Kerr-inspired',
    full_kerr: 'Full Kerr',
};

export function slugify(name: string): string {
    return name
        .normalize('NFKD')
        .toLowerCase()
        .replace(/\*/g, '-star')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function formatSpin(spin: number, enabled = true): string {
    if (!enabled) return 'a = 0';
    const text = formatNumber(Math.abs(spin), { decimals: spin === 0 ? 0 : 2 });
    return `a = ${spin < 0 ? MINUS : ''}${text}`;
}

// Scenario ids match the literature presets of src/features/units where one exists, so a shared
// link can name its sources.
export const SCENARIOS: Scenario[] = Object.entries(blackHolePresets).map(([name, preset]) => {
    const literature = getMassPreset(name) as { id: string; category: string } | null;
    const disk = preset.accretion_disk ? DISK_LABELS[preset.accretion_mode] : 'No disk';
    const parts = [disk, preset.jet.enabled ? 'jets' : null, preset.disk.temperature_mode];
    return {
        name,
        id: literature ? literature.id : slugify(name),
        preset,
        summary: parts.filter(Boolean).join(' · '),
        massText: formatMass(preset.disk.mass_msun, { digits: 2 }),
        spinText: formatSpin(preset.spin, preset.spin_enabled),
        quasar: literature?.category === 'quasar',
    };
});

export function scenarioByName(name: string): Scenario | undefined {
    return SCENARIOS.find((scenario) => scenario.name === name);
}

export function scenarioById(id: string): Scenario | undefined {
    return SCENARIOS.find((scenario) => scenario.id === id);
}

export function scenarioLabel(name: string): string {
    return name === CUSTOM_PRESET ? 'Custom' : name;
}
