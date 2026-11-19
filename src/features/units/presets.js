// Literature mass presets (presets.json) with lookup helpers. Each preset carries its sources per
// quantity, so the UI can show a reference next to every readout.

import data from './presets.json';
import { PARSEC } from './constants.js';
import { createMassScale } from './mass-scaling.js';

const SPIN_STATUSES = new Set(['measured', 'lower-limit', 'assumed', 'illustrative']);
const ACCRETION_STATES = new Set(['thin-disk', 'riaf']);
const CATEGORIES = new Set(['stellar', 'supermassive', 'quasar']);
const DISTANCE_UNITS = Object.freeze({ pc: PARSEC, kpc: 1e3 * PARSEC, Mpc: 1e6 * PARSEC });

function isPositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function lookupKey(text) {
    return String(text)
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

// Returns a list of problems (empty when valid) so tests can show every issue at once.
export function validateMassPresetData(source) {
    const problems = [];
    if (source?.version !== 1) problems.push('version must be 1');
    const references = source?.references ?? {};
    const presets = Array.isArray(source?.presets) ? source.presets : [];
    if (presets.length === 0) problems.push('presets must be a non-empty array');
    const seen = new Map();

    for (const [index, preset] of presets.entries()) {
        const where = `presets[${index}] (${preset?.id ?? 'no id'})`;
        if (typeof preset?.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(preset.id)) {
            problems.push(`${where}: id must be kebab-case`);
        }
        if (typeof preset?.name !== 'string' || preset.name.length === 0) {
            problems.push(`${where}: name is required`);
        }
        if (!CATEGORIES.has(preset?.category)) problems.push(`${where}: unknown category`);
        if (!isPositiveNumber(preset?.massSolar)) problems.push(`${where}: massSolar must be > 0`);
        if (typeof preset?.spin !== 'number' || !(Math.abs(preset.spin) <= 1)) {
            problems.push(`${where}: spin must be in [-1, 1]`);
        }
        if (!SPIN_STATUSES.has(preset?.spinStatus)) problems.push(`${where}: unknown spinStatus`);
        if (typeof preset?.eddingtonRatio !== 'number' || !(preset.eddingtonRatio >= 0)) {
            problems.push(`${where}: eddingtonRatio must be >= 0`);
        }
        if (!ACCRETION_STATES.has(preset?.accretionState)) {
            problems.push(`${where}: unknown accretionState`);
        }
        if (preset?.distance !== undefined) {
            const { value, unit } = preset.distance;
            if (!isPositiveNumber(value) || !Object.hasOwn(DISTANCE_UNITS, unit)) {
                problems.push(
                    `${where}: distance needs a positive value and a unit of pc, kpc or Mpc`,
                );
            }
        }
        const cited = [
            ...Object.values(preset?.references ?? {}).flat(),
            ...(preset?.alternativeMasses ?? []).flatMap((entry) => entry.references ?? []),
        ];
        for (const key of cited) {
            if (!Object.hasOwn(references, key))
                problems.push(`${where}: unknown reference ${key}`);
        }
        for (const label of [preset?.id, preset?.name, ...(preset?.aliases ?? [])]) {
            if (label === undefined) continue;
            const key = lookupKey(label);
            if (seen.has(key) && seen.get(key) !== index) {
                problems.push(`${where}: "${label}" collides with presets[${seen.get(key)}]`);
            }
            seen.set(key, index);
        }
    }

    for (const [key, reference] of Object.entries(references)) {
        if (typeof reference?.citation !== 'string') {
            problems.push(`reference ${key}: citation is required`);
        }
        if (!reference?.doi && !reference?.arxiv && !reference?.url) {
            problems.push(`reference ${key}: needs a doi, arxiv id or url`);
        }
    }
    return problems;
}

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

const problems = validateMassPresetData(data);
if (problems.length > 0) {
    throw new Error(`invalid mass preset data:\n${problems.join('\n')}`);
}

export const MASS_PRESETS = deepFreeze(structuredClone(data.presets));
export const MASS_PRESET_REFERENCES = deepFreeze(structuredClone(data.references));

const presetsByKey = new Map();
for (const preset of MASS_PRESETS) {
    for (const label of [preset.id, preset.name, ...(preset.aliases ?? [])]) {
        presetsByKey.set(lookupKey(label), preset);
    }
}

export function listMassPresets() {
    return MASS_PRESETS;
}

// Finds a preset by id, name or alias, ignoring case, spaces and punctuation, so "M87*",
// "m87" and "m87-star" all match. Returns null when nothing matches.
export function getMassPreset(idOrName) {
    if (idOrName === undefined || idOrName === null) return null;
    return presetsByKey.get(lookupKey(idOrName)) ?? null;
}

// Resolves the reference keys of a preset quantity ("mass", "spin", ...) to citation objects.
export function getPresetReferences(preset, quantity) {
    const keys = preset?.references?.[quantity] ?? [];
    return keys.map((key) => ({ key, ...MASS_PRESET_REFERENCES[key] }));
}

export function referenceUrl(reference) {
    if (reference.doi) return `https://doi.org/${reference.doi}`;
    if (reference.arxiv) return `https://arxiv.org/abs/${reference.arxiv}`;
    return reference.url ?? null;
}

export function presetDistanceMeters(preset) {
    if (!preset?.distance) return null;
    return preset.distance.value * DISTANCE_UNITS[preset.distance.unit];
}

// Mass scale for a preset; overrides such as { spin } let the UI keep the user's spin setting.
export function createMassScaleFromPreset(idOrPreset, overrides = {}) {
    const preset = typeof idOrPreset === 'string' ? getMassPreset(idOrPreset) : idOrPreset;
    if (!preset) throw new RangeError(`unknown mass preset "${idOrPreset}"`);
    return createMassScale({
        massSolar: overrides.massSolar ?? preset.massSolar,
        spin: overrides.spin ?? preset.spin,
    });
}
