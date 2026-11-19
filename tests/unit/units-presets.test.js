import { test } from 'vitest';
import assert from 'node:assert/strict';
import data from '../../src/features/units/presets.json';
import { PARSEC } from '../../src/features/units/constants.js';
import {
    createMassScaleFromPreset,
    getMassPreset,
    getPresetReferences,
    listMassPresets,
    MASS_PRESETS,
    presetDistanceMeters,
    referenceUrl,
    validateMassPresetData,
} from '../../src/features/units/presets.js';
import * as units from '../../src/features/units/index.js';
import { assertClose, assertRoundsTo } from './support/assert-close.js';

test('preset data validates', () => {
    assert.deepEqual(validateMassPresetData(data), []);
});

test('all literature presets are present with their published masses', () => {
    const expected = {
        'M87*': 6.5e9,
        'Sgr A*': 4.297e6,
        'Cygnus X-1': 21.2,
        'GRS 1915+105': 12.4,
        '3C 273': 2.6e8,
        'TON 618': 4.07e10,
        'stellar-10': 10,
    };
    for (const [name, mass] of Object.entries(expected)) {
        const preset = getMassPreset(name);
        assert.ok(preset, `missing preset ${name}`);
        assert.equal(preset.massSolar, mass);
    }
    assert.equal(listMassPresets().length, 7);
    assert.equal(listMassPresets(), MASS_PRESETS);
});

test('lookup ignores case, spacing and punctuation and matches aliases', () => {
    assert.equal(getMassPreset('m87').id, 'm87-star');
    assert.equal(getMassPreset('M87*').id, 'm87-star');
    assert.equal(getMassPreset('Cyg X-1').id, 'cygnus-x-1');
    assert.equal(getMassPreset('grs1915+105').id, 'grs-1915-105');
    assert.equal(getMassPreset('Sagittarius A*').id, 'sgr-a-star');
    assert.equal(getMassPreset('ton618').id, 'ton-618');
    assert.equal(getMassPreset('Gargantua'), null);
    assert.equal(getMassPreset(''), null);
    assert.equal(getMassPreset(undefined), null);
});

test('spins follow the literature status of each object', () => {
    assert.equal(getMassPreset('Cygnus X-1').spin, 0.998);
    assert.equal(getMassPreset('Cygnus X-1').spinStatus, 'lower-limit');
    assert.equal(getMassPreset('GRS 1915+105').spinLowerLimit, 0.98);
    for (const name of ['M87*', 'Sgr A*', '3C 273', 'TON 618']) {
        assert.equal(getMassPreset(name).spinStatus, 'assumed', name);
    }
    for (const preset of MASS_PRESETS) {
        assert.equal(preset.eddingtonRatioStatus, 'illustrative', preset.id);
    }
});

test('every cited quantity resolves to a reference with a link', () => {
    for (const preset of MASS_PRESETS) {
        for (const quantity of Object.keys(preset.references)) {
            for (const reference of getPresetReferences(preset, quantity)) {
                assert.equal(typeof reference.citation, 'string');
                assert.match(referenceUrl(reference), /^https:\/\//);
            }
        }
    }
    const [eht] = getPresetReferences(getMassPreset('M87*'), 'mass');
    assert.equal(eht.key, 'EHT19-VI');
    assert.equal(referenceUrl(eht), 'https://doi.org/10.3847/2041-8213/ab1141');
    const [rei] = getPresetReferences(getMassPreset('GRS 1915+105'), 'mass');
    assert.equal(referenceUrl(rei), 'https://arxiv.org/abs/1409.2453');
    assert.deepEqual(getPresetReferences(getMassPreset('stellar-10'), 'mass'), []);
});

test('validation reports broken data', () => {
    const broken = structuredClone(data);
    broken.presets[0].spin = 1.5;
    broken.presets[1].references.mass = ['NOPE'];
    broken.presets[2].aliases = ['M87'];
    broken.presets[3].distance = { value: 1, unit: 'ly' };
    delete broken.references.Ge19.doi;
    const problems = validateMassPresetData(broken);
    assert.ok(problems.some((p) => p.includes('spin must be')));
    assert.ok(problems.some((p) => p.includes('unknown reference NOPE')));
    assert.ok(problems.some((p) => p.includes('collides')));
    assert.ok(problems.some((p) => p.includes('distance needs')));
    assert.ok(problems.some((p) => p.includes('reference Ge19')));
    assert.ok(validateMassPresetData({}).length > 0);
});

test('presets are immutable', () => {
    assert.throws(() => {
        MASS_PRESETS[0].massSolar = 1;
    }, TypeError);
    assert.throws(() => {
        MASS_PRESETS.push({});
    }, TypeError);
});

test('mass scale from a preset, with the spin overridden by the simulation', () => {
    const scale = createMassScaleFromPreset('M87*');
    assert.equal(scale.massSolar, 6.5e9);
    assert.equal(scale.spin, 0.9);
    const userSpin = createMassScaleFromPreset(getMassPreset('m87'), { spin: 0.94 });
    assertRoundsTo(userSpin.radiiIn('rs').horizonOuter, '0.67');
    assert.throws(() => createMassScaleFromPreset('nowhere'), RangeError);
});

test('preset distances convert to metres for angular scales', () => {
    assertClose(presetDistanceMeters(getMassPreset('M87*')), 16.8e6 * PARSEC, { rel: 1e-12 });
    assertClose(presetDistanceMeters(getMassPreset('Sgr A*')), 8.277e3 * PARSEC, { rel: 1e-12 });
    assert.equal(presetDistanceMeters(getMassPreset('TON 618')), null);
    const m87 = getMassPreset('M87*');
    const muas = Math.PI / 648000 / 1e6;
    const scale = createMassScaleFromPreset(m87);
    assertRoundsTo(scale.angularScale(presetDistanceMeters(m87)) / muas, '3.819');
});

test('the barrel re-exports every units module', () => {
    for (const name of [
        'SPEED_OF_LIGHT',
        'iscoRadius',
        'createMassScale',
        'formatLength',
        'getMassPreset',
        'MASS_PRESET_REFERENCES',
    ]) {
        assert.ok(name in units, name);
    }
});
