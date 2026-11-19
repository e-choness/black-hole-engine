import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
    ASTRONOMICAL_UNIT,
    DAY,
    HOUR,
    PARSEC,
    SOLAR_MASS,
    SPEED_OF_LIGHT,
    STANDARD_GRAVITY,
} from '../../src/features/units/constants.js';
import {
    convertGeometric,
    createMassScale,
    diskEffectiveTemperature,
    diskPeakTemperature,
    eddingtonAccretionRate,
    eddingtonLuminosity,
    geometricUnitFactor,
    gravitationalRadius,
    kilogramsPerSecondToSolarMassesPerYear,
    massInKilograms,
    orbitalFrequency,
    schwarzschildRadius,
    staticObserverAcceleration,
    tidalAcceleration,
    tidalRadius,
} from '../../src/features/units/mass-scaling.js';
import { iscoRadius } from '../../src/features/units/kerr.js';
import { assertClose, assertRoundsTo } from './support/assert-close.js';

const KM = 1e3;
const AU = ASTRONOMICAL_UNIT;

// Reference values from an independent evaluation of the same formulas, rounded as printed.
// Lengths are given with their unit scale, times in seconds.
const OBJECTS = [
    {
        name: 'Cygnus X-1',
        massSolar: 21.2,
        spin: 0.998,
        rg: ['31.3', KM],
        rs: ['62.61', KM],
        tg: '104e-6',
        rPlus: ['33.28', KM],
        isco: ['38.72', KM],
        fIsco: '642.1',
        pIsco: '1.56e-3',
        lEdd: '2.665e32',
        mdotEdd: '1.466e-7',
        tPeak: ['5.17e6', '9.19e6', '1.21e7', '1.63e7'],
        tidalAtRs: '4.68e6',
        tidal100g: ['2256', KM],
        hover: '5.17e12',
    },
    {
        name: 'GRS 1915+105',
        massSolar: 12.4,
        spin: 0.98,
        rg: ['18.31', KM],
        rs: ['36.62', KM],
        tg: '61.1e-6',
        rPlus: ['21.95', KM],
        isco: ['29.55', KM],
        fIsco: '859.9',
        pIsco: '1.16e-3',
        lEdd: '1.559e32',
        mdotEdd: '1.177e-7',
        tPeak: ['4.70e6', '8.35e6', '1.10e7', '1.48e7'],
        tidalAtRs: '1.37e7',
        tidal100g: ['1886', KM],
        hover: '8.85e12',
    },
    {
        name: 'Sgr A*',
        massSolar: 4.297e6,
        spin: 0.9,
        rg: ['6.345e6', KM],
        rs: ['1.269e7', KM],
        tg: '21.2',
        rPlus: ['9.111e6', KM],
        isco: ['1.473e7', KM],
        fIsco: '1.695e-3',
        pIsco: '5.90e2',
        lEdd: '5.402e37',
        mdotEdd: '0.06124',
        tPeak: ['1.51e5', '2.68e5', '3.53e5', '4.76e5'],
        tidalAtRs: '1.14e-4',
        tidal100g: ['1.325e5', KM],
        hover: '2.55e7',
    },
    {
        name: '3C 273',
        massSolar: 2.6e8,
        spin: 0.9,
        rg: ['2.566', AU],
        rs: ['5.133', AU],
        tg: '1.28e3',
        rPlus: ['3.685', AU],
        isco: ['5.956', AU],
        fIsco: '2.802e-5',
        pIsco: ['9.91', HOUR],
        lEdd: '3.268e39',
        mdotEdd: '3.706',
        tPeak: ['5.40e4', '9.61e4', '1.26e5', '1.71e5'],
        tidalAtRs: '3.11e-8',
        tidal100g: ['5.202e5', KM],
        hover: '4.22e5',
    },
    {
        name: 'M87*',
        massSolar: 6.5e9,
        spin: 0.9,
        rg: ['64.16', AU],
        rs: ['128.3', AU],
        tg: ['8.89', HOUR],
        rPlus: ['92.13', AU],
        isco: ['148.9', AU],
        fIsco: '1.121e-6',
        pIsco: ['10.3', DAY],
        lEdd: '8.171e40',
        mdotEdd: '92.64',
        tPeak: ['2.42e4', '4.30e4', '5.65e4', '7.64e4'],
        tidalAtRs: '4.97e-11',
        tidal100g: ['1.521e6', KM],
        hover: '1.69e4',
    },
    {
        name: 'TON 618',
        massSolar: 4.07e10,
        spin: 0.9,
        rg: ['401.7', AU],
        rs: ['803.5', AU],
        tg: ['2.32', DAY],
        rPlus: ['576.8', AU],
        isco: ['932.4', AU],
        fIsco: '1.79e-7',
        pIsco: ['64.7', DAY],
        lEdd: '5.116e41',
        mdotEdd: '580.1',
        tPeak: ['1.53e4', '2.72e4', '3.57e4', '4.83e4'],
        tidalAtRs: '1.27e-12',
        tidal100g: ['2.803e6', KM],
        hover: '2.69e3',
    },
];

function scaled([text, unit]) {
    return { text, unit };
}

function checkScaled(actual, reference, label) {
    const { text, unit } = Array.isArray(reference)
        ? scaled(reference)
        : { text: reference, unit: 1 };
    assertRoundsTo(actual / unit, text, `${label}: ${actual / unit} vs ${text}`);
}

test('mass scale reproduces the reference lengths, times, frequencies and Eddington values', () => {
    for (const ref of OBJECTS) {
        const scale = createMassScale({ massSolar: ref.massSolar, spin: ref.spin });
        const at = (field) => `${ref.name} ${field}`;
        checkScaled(scale.gravitationalRadius, ref.rg, at('r_g'));
        checkScaled(scale.schwarzschildRadius, ref.rs, at('r_s'));
        checkScaled(scale.gravitationalTime, ref.tg, at('GM/c^3'));
        checkScaled(scale.radii.horizonOuter, ref.rPlus, at('r+'));
        checkScaled(scale.diskInnerRadius, ref.isco, at('r_isco'));
        checkScaled(scale.iscoOrbitalFrequency, ref.fIsco, at('f_isco'));
        checkScaled(scale.iscoOrbitalPeriod, ref.pIsco, at('P_isco'));
        checkScaled(scale.eddingtonLuminosity, ref.lEdd, at('L_Edd'));
        checkScaled(scale.eddingtonAccretionRateSolarPerYear, ref.mdotEdd, at('Mdot_Edd'));
    }
});

test('peak disk temperatures follow the Page-Thorne profile for each Eddington ratio', () => {
    const ratios = [0.01, 0.1, 0.3, 1];
    for (const ref of OBJECTS) {
        const scale = createMassScale({ massSolar: ref.massSolar, spin: ref.spin });
        ratios.forEach((ratio, i) => {
            const { temperature } = scale.diskPeakTemperature(ratio);
            checkScaled(temperature, ref.tPeak[i], `${ref.name} T_peak at mdot = ${ratio}`);
        });
    }
});

test('peak temperature scales as (mdot / M)^(1/4) and with the colour correction', () => {
    const base = diskPeakTemperature(10, 0, 0.1).temperature;
    assertClose(diskPeakTemperature(10, 0, 1.6).temperature, 2 * base, { rel: 1e-9 });
    assertClose(diskPeakTemperature(160, 0, 0.1).temperature, base / 2, { rel: 1e-9 });
    assertClose(diskPeakTemperature(10, 0, 0.1, { colorCorrection: 1.7 }).temperature, 1.7 * base, {
        rel: 1e-12,
    });
    assert.equal(diskPeakTemperature(10, 0, 0).temperature, 0);
    assert.throws(() => diskPeakTemperature(10, 0, -1), RangeError);
});

test('effective temperature profile peaks at the reported radius and vanishes inside the ISCO', () => {
    const peak = diskPeakTemperature(10, 0.5, 0.1);
    const atPeak = diskEffectiveTemperature(10, 0.5, 0.1, peak.radiusM);
    assertClose(atPeak, peak.temperature, { rel: 1e-9 });
    assert.ok(diskEffectiveTemperature(10, 0.5, 0.1, peak.radiusM * 1.2) < atPeak);
    assert.ok(diskEffectiveTemperature(10, 0.5, 0.1, peak.radiusM * 0.95) < atPeak);
    assert.equal(diskEffectiveTemperature(10, 0.5, 0.1, 3), 0);
});

test('tidal stretch, survivable radius and hover acceleration match the reference values', () => {
    for (const ref of OBJECTS) {
        const rs = schwarzschildRadius(ref.massSolar);
        const stretch = tidalAcceleration(ref.massSolar, rs, 2);
        checkScaled(stretch.radial / STANDARD_GRAVITY, ref.tidalAtRs, `${ref.name} tidal at r_s`);
        assertClose(stretch.transverse, stretch.radial / 2);
        const r100 = tidalRadius(ref.massSolar, 100 * STANDARD_GRAVITY, 2);
        checkScaled(r100, ref.tidal100g, `${ref.name} 100 g radius`);
        assertClose(tidalAcceleration(ref.massSolar, r100, 2).radial, 100 * STANDARD_GRAVITY, {
            rel: 1e-12,
        });
        const hover = staticObserverAcceleration(ref.massSolar, 2 * 1.0002);
        checkScaled(hover / STANDARD_GRAVITY, ref.hover, `${ref.name} hover at 1.0002 r_s`);
    }
});

test('hover acceleration in units of c^2/r_s matches the reference values', () => {
    const cases = [
        [1.5, '0.385'],
        [1.2, '0.851'],
        [1.1, '1.371'],
        [1.01, '4.926'],
        [1.001, '15.788'],
        [1.0002, '35.345'],
    ];
    const rs = schwarzschildRadius(1);
    for (const [r, expected] of cases) {
        const a = staticObserverAcceleration(1, 2 * r) * (rs / SPEED_OF_LIGHT ** 2);
        assertRoundsTo(a, expected, `hover at ${r} r_s`);
    }
    assert.ok(Number.isNaN(staticObserverAcceleration(1, 2)));
    assert.ok(Number.isNaN(staticObserverAcceleration(1, 1.5)));
});

test('orbital and quasi-periodic frequencies in hertz', () => {
    assertRoundsTo(orbitalFrequency(10, 6, 0), '219.9');
    assertRoundsTo(orbitalFrequency(12.4, iscoRadius(0.98), 0.98), '859.9');
    const scale = createMassScale({ massSolar: 10, spin: 0.9 });
    const f = scale.epicyclicFrequencies(1.5 * iscoRadius(0.9));
    assertRoundsTo(f.orbital, '436.9');
    assertRoundsTo(f.nodal, '85.67');
    assertClose(scale.orbitalFrequency(1.5 * iscoRadius(0.9)), f.orbital, { rel: 1e-12 });
    assertClose(scale.orbitalFrequency(0.75 * iscoRadius(0.9), 'rs'), f.orbital, { rel: 1e-12 });
});

test('angular scale on the sky matches the EHT values', () => {
    const muas = Math.PI / 648000 / 1e6;
    const m87 = createMassScale({ massSolar: 6.5e9 });
    const sgr = createMassScale({ massSolar: 4.297e6 });
    const m87Scale = m87.angularScale(16.8e6 * PARSEC) / muas;
    const sgrScale = sgr.angularScale(8.277e3 * PARSEC) / muas;
    assertRoundsTo(m87Scale, '3.819');
    assertRoundsTo(sgrScale, '5.124');
    assertRoundsTo(2 * Math.sqrt(27) * m87Scale, '39.69');
    assertRoundsTo(2 * Math.sqrt(27) * sgrScale, '53.25');
});

test('geometric unit conversions round-trip in both M and r_s', () => {
    const scale = createMassScale({ massSolar: 6.5e9, spin: 0.94 });
    assertClose(scale.toMeters(1), scale.gravitationalRadius);
    assertClose(scale.toMeters(1, 'rs'), scale.schwarzschildRadius);
    assertClose(scale.toSeconds(1, 'rs'), scale.lightCrossingTime);
    assertClose(scale.fromMeters(scale.toMeters(11, 'rs'), 'rs'), 11, { rel: 1e-14 });
    assertClose(scale.fromSeconds(scale.toSeconds(3.5)), 3.5, { rel: 1e-14 });
    assertClose(convertGeometric(1, 'rs', 'M'), 2);
    assertClose(convertGeometric(6, 'M', 'rs'), 3);
    assert.equal(geometricUnitFactor(), 1);
    assert.throws(() => geometricUnitFactor('km'), RangeError);
    assert.throws(() => scale.toMeters(1, 'au'), RangeError);

    const radiiRs = scale.radiiIn('rs');
    assertRoundsTo(radiiRs.horizonOuter, '0.67');
    assertRoundsTo(radiiRs.iscoPrograde, '1.01');
    assertRoundsTo(radiiRs.photonOrbitPrograde, '0.71');
    assertClose(scale.radiiIn().iscoPrograde, scale.radiiM.iscoPrograde);
    assert.ok(Object.isFrozen(scale) && Object.isFrozen(scale.radii) && Object.isFrozen(radiiRs));
});

test('Eddington helpers and mass conversion', () => {
    assertRoundsTo(eddingtonLuminosity(1), '1.257e31');
    assertClose(massInKilograms(2), 2 * SOLAR_MASS);
    assertRoundsTo(SOLAR_MASS, '1.98841e30');
    assertClose(gravitationalRadius(1) * 2, schwarzschildRadius(1));
    const schwarzschildRate = eddingtonAccretionRate(10);
    const fixedRate = eddingtonAccretionRate(10, 0.9, { efficiency: 0.1 });
    assertClose(fixedRate, eddingtonLuminosity(10) / (0.1 * SPEED_OF_LIGHT ** 2), { rel: 1e-12 });
    assert.ok(schwarzschildRate > eddingtonAccretionRate(10, 0.9));
    assertClose(kilogramsPerSecondToSolarMassesPerYear(SOLAR_MASS / (365.25 * DAY)), 1, {
        rel: 1e-12,
    });
});

test('a retrograde disk has a larger ISCO, lower efficiency and cooler peak', () => {
    const pro = createMassScale({ massSolar: 10, spin: 0.9 });
    const retro = createMassScale({ massSolar: 10, spin: -0.9 });
    assert.ok(retro.diskInnerRadiusM > pro.diskInnerRadiusM);
    assert.ok(retro.radiativeEfficiency < pro.radiativeEfficiency);
    assert.ok(
        retro.diskPeakTemperature(0.1).temperature < pro.diskPeakTemperature(0.1).temperature,
    );
    assert.deepEqual(retro.radiiM, pro.radiiM);
});

test('invalid masses and spins are rejected', () => {
    for (const bad of [0, -1, Number.NaN, Infinity, '10', undefined]) {
        assert.throws(() => createMassScale({ massSolar: bad }), RangeError);
    }
    assert.throws(() => createMassScale({ massSolar: 10, spin: 1.2 }), RangeError);
    assert.throws(() => createMassScale(), RangeError);
});
