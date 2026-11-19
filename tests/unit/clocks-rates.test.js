import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
    addVelocities,
    clockEndRadius,
    clockRates,
    doranTimeShift,
    freefallProperTime,
    kerrSchildSpherical,
    kerrSchildTimeShift,
} from '../../src/features/clocks/kerr-time.js';
import { horizonRadii, iscoRadius } from '../../src/features/units/kerr.js';
import { createMassScale } from '../../src/features/units/mass-scaling.js';
import { assertClose, assertRoundsTo } from './support/assert-close.js';

const EQUATOR = Math.PI / 2;

function rate(mode, r, spin = 0, extra = {}) {
    return clockRates({ mode, r, spin, ...extra });
}

// Reference values from an independent evaluation of the same formulas, rounded as printed.
test('Schwarzschild static, circular and rain clocks at radii given in r_s', () => {
    const cases = [
        [11, '0.9535', '0.9293', '0.9091'],
        [3, '0.8165', '0.7071', '0.6667'],
        [1.5, '0.5774', null, '0.3333'],
        [1.1, '0.3015', null, '0.0909'],
    ];
    for (const [rs, staticRate, circularRate, rainRate] of cases) {
        const r = 2 * rs;
        assertRoundsTo(rate('static', r).dTauDt, staticRate, `static at ${rs} r_s`);
        assertRoundsTo(rate('freefall', r).dTauDt, rainRate, `rain at ${rs} r_s`);
        const circular = rate('circular', r);
        if (circularRate) {
            assert.equal(circular.mode, 'circular');
            assertRoundsTo(circular.dTauDt, circularRate, `circular at ${rs} r_s`);
        } else {
            assert.equal(circular.mode, 'zamo');
            assert.deepEqual(circular.notices, ['no-circular-orbit']);
        }
    }
});

test('Kerr ZAMO, circular and static clocks on the equator for a = 0.9', () => {
    const cases = [
        [iscoRadius(0.9), '0.4749', '0.3709', '0.3718'],
        [4, '0.7154', '0.6195', '0.7071'],
        [10, '0.8946', '0.8459', '0.8944'],
    ];
    for (const [r, zamo, circular, stationary] of cases) {
        assertRoundsTo(rate('zamo', r, 0.9).dTauDt, zamo, `ZAMO at ${r}`);
        assertRoundsTo(rate('circular', r, 0.9).dTauDt, circular, `circular at ${r}`);
        assertRoundsTo(rate('static', r, 0.9).dTauDt, stationary, `static at ${r}`);
    }
});

test('prograde circular clocks for a = 0.94', () => {
    for (const [r, expected] of [
        [22, '0.9306'],
        [6, '0.7448'],
        [3, '0.5094'],
        [2.5, '0.4241'],
    ]) {
        assertRoundsTo(rate('circular', r, 0.94).dTauDt, expected, `r = ${r}`);
    }
    assertRoundsTo(iscoRadius(0.94), '2.024');
});

test('speeds relative to the ZAMO', () => {
    assertRoundsTo(rate('circular', iscoRadius(0.9), 0.9).speed, '0.6245');
    assertClose(rate('circular', 6).speed, 0.5, { rel: 1e-12 });
    assertClose(rate('freefall', 7).speed, Math.sqrt(2 / 7), { rel: 1e-12 });
    assertClose(rate('freefall', 3, 0.9).speed, Math.sqrt(1 - rate('zamo', 3, 0.9).lapse ** 2));
    assert.equal(rate('zamo', 3, 0.9).speed, 0);
    assertClose(rate('static', 5).lorentzFactor, 1);
});

test('redshift decomposition multiplies gravitational and kinematic parts', () => {
    for (const [mode, r, spin, extra] of [
        ['circular', 7, 0.9, {}],
        ['static', 5, 0.5, {}],
        ['moving', 3, 0.7, { speed: 0.6 }],
        ['freefall', 2.5, 0.3, {}],
    ]) {
        const result = rate(mode, r, spin, extra);
        assertClose(result.dTauDt, result.lapse / result.lorentzFactor, { rel: 1e-12 });
    }
    const moving = rate('moving', 10, 0, { speed: 0.6 });
    assertClose(moving.dTauDt, Math.sqrt(1 - 2 / 10) * 0.8, { rel: 1e-12 });
    assertClose(moving.lorentzFactor, 1.25, { rel: 1e-12 });
});

test('fallbacks and notices', () => {
    const ergo = rate('static', 1.9, 0.9);
    assert.equal(ergo.mode, 'zamo');
    assert.deepEqual(ergo.notices, ['inside-ergosphere']);
    const polar = clockRates({ mode: 'static', r: 1.9, theta: 0, spin: 0.9 });
    assert.equal(polar.mode, 'static');

    assert.deepEqual(rate('circular', 5, 0.9).notices, []);
    assert.deepEqual(rate('circular', 2, 0.9).notices, ['unstable-orbit']);
    assert.deepEqual(rate('circular', 5, 0.9, { retrograde: true }).notices, ['unstable-orbit']);
    assert.equal(rate('circular', 3.5, 0.9, { retrograde: true }).mode, 'zamo');
    assert.deepEqual(clockRates({ mode: 'circular', r: 8, theta: 1, spin: 0.5 }).notices, [
        'off-equatorial-orbit',
    ]);
    assert.deepEqual(clockRates({ mode: 'circular', r: 8, theta: 1 }).notices, []);
    const fast = rate('moving', 5, 0, { speed: 1.2 });
    assert.deepEqual(fast.notices, ['speed-clamped']);
    assert.ok(fast.dTauDt > 0);
});

test('inside the horizon only the infaller exists and t has no rate', () => {
    const inside = rate('static', 1.5);
    assert.equal(inside.regime, 'interior');
    assert.equal(inside.mode, 'freefall');
    assert.equal(inside.dTauDt, null);
    assert.equal(inside.lapse, null);
    assert.deepEqual(inside.notices, ['inside-horizon']);
    assert.ok(inside.dtKSDtau > 1);
    assert.deepEqual(rate('freefall', 1.5).notices, []);

    assert.equal(rate('freefall', 0).regime, 'end');
    assert.equal(rate('freefall', 0).endReason, 'singularity');
    const kerrEnd = rate('freefall', 0.5, 0.9);
    assert.equal(kerrEnd.regime, 'end');
    assert.equal(kerrEnd.endReason, 'inner-horizon');
    assert.equal(kerrEnd.dtKSDtau, null);
    assertClose(clockEndRadius(0.9), horizonRadii(0.9).inner);
    assert.equal(clockEndRadius(0), 0);
});

test('free-fall Kerr-Schild rate matches the CKS form of the Doran observer', () => {
    for (const [r, a, theta] of [
        [10, 0, EQUATOR],
        [1.2, 0, EQUATOR],
        [3, 0.9, EQUATOR],
        [1, 0.9, 0.7],
        [0.3, 0.5, 1.2],
    ]) {
        const f = (2 * r) / (r * r + a * a * Math.cos(theta) ** 2);
        const ur = -Math.sqrt(2 * r) / (Math.sqrt(r * r + a * a) + Math.sqrt(2 * r));
        const expected = 1 + f * (1 + ur);
        assertClose(clockRates({ mode: 'freefall', r, theta, spin: a }).dtKSDtau, expected, {
            rel: 1e-12,
        });
    }
    const beta = Math.sqrt(2 / 5);
    assertClose(rate('freefall', 5).dtKSDtau, (1 + beta + beta * beta) / (1 + beta), {
        rel: 1e-12,
    });
});

test('invalid rate inputs are rejected', () => {
    assert.throws(() => rate('hover', 5), RangeError);
    assert.throws(() => rate('static', -1), RangeError);
    assert.throws(() => clockRates({ mode: 'static' }), RangeError);
    assert.throws(() => rate('moving', 5, 0, { speed: -0.1 }), RangeError);
    assert.throws(() => rate('static', 5, 1.5), RangeError);
});

test('Doran proper time from the outer to the inner horizon', () => {
    for (const [a, expected] of [
        [0, '1.3333'],
        [0.5, '1.0170'],
        [0.9, '0.4506'],
        [0.99, '0.1415'],
    ]) {
        const { outer, inner } = horizonRadii(a);
        assertRoundsTo(freefallProperTime(outer, inner, a), expected, `a = ${a}`);
    }
    for (const r of [0.5, 2, 22, 400]) {
        assertClose(freefallProperTime(r, 0), ((2 / 3) * r ** 1.5) / Math.sqrt(2), { rel: 1e-12 });
    }
    assert.equal(freefallProperTime(2, 3), 0);
});

test('Doran proper time inside each preset hole in physical units', () => {
    for (const [massSolar, spin, expected, unit] of [
        [21.2, 0.998, '6.61', 1e-6],
        [12.4, 0.98, '12.2', 1e-6],
        [4.297e6, 0.9, '9.54', 1],
        [2.6e8, 0.9, '577', 1],
        [6.5e9, 0.9, '4.01', 3600],
        [4.07e10, 0.9, '25.1', 3600],
    ]) {
        const scale = createMassScale({ massSolar, spin });
        const { outer, inner } = horizonRadii(spin);
        const seconds = scale.toSeconds(freefallProperTime(outer, inner, spin));
        assertRoundsTo(seconds / unit, expected, `M = ${massSolar}`);
    }
    const rain = createMassScale({ massSolar: 21.2 }).toSeconds(freefallProperTime(2, 0));
    assertRoundsTo(rain / 1e-6, '139');
});

test('Schwarzschild time shifts reduce to closed forms', () => {
    const doranClosed = (r) => {
        const u = Math.sqrt(r / 2);
        return 4 * (u - Math.log(1 + u));
    };
    for (const [from, to] of [
        [22, 2.5],
        [2, 0.5],
        [3, 1e-6],
    ]) {
        assertClose(doranTimeShift(from, to), doranClosed(from) - doranClosed(to), { rel: 1e-12 });
    }
    assertClose(kerrSchildTimeShift(10, 3), 2 * Math.log(8 / 1), { rel: 1e-12 });
    assert.equal(doranTimeShift(1, 2), 0);
});

test('free-fall time pieces add up to the Boyer-Lindquist time of the infaller', () => {
    for (const a of [0, 0.6, 0.9]) {
        const rFrom = 12;
        const rTo = horizonRadii(a).outer + 0.4;
        // dt_BL/dr = u^t / |u^r| = A / (Delta sqrt(2r(r^2 + a^2))) on the equator, by Simpson's rule.
        const integrand = (r) => {
            const delta = r * r - 2 * r + a * a;
            const A = (r * r + a * a) ** 2 - a * a * delta;
            return A / (delta * Math.sqrt(2 * r * (r * r + a * a)));
        };
        const n = 20000;
        const h = (rFrom - rTo) / n;
        let sum = integrand(rTo) + integrand(rFrom);
        for (let i = 1; i < n; i += 1) sum += (i % 2 ? 4 : 2) * integrand(rTo + i * h);
        const expected = (sum * h) / 3;
        const pieces =
            freefallProperTime(rFrom, rTo, a) +
            doranTimeShift(rFrom, rTo, a) +
            kerrSchildTimeShift(rFrom, rTo, a);
        assertClose(pieces, expected, { rel: 1e-9 }, `a = ${a}: ${pieces} vs ${expected}`);
    }
});

test('Kerr-Schild positions map to Boyer-Lindquist radius and angle', () => {
    assertClose(kerrSchildSpherical([3, 4, 0]).r, 5);
    const axis = kerrSchildSpherical([0, 0, 3], 0.9);
    assertClose(axis.r, 3);
    assertClose(axis.theta, 0, { abs: 1e-7 });
    const equator = kerrSchildSpherical([2, 0, 0], 0.9);
    assertClose(equator.r, Math.sqrt(4 - 0.81), { rel: 1e-12 });
    assertClose(equator.theta, EQUATOR);
    assert.equal(kerrSchildSpherical([0.9, 0, 0], 0.9).r, 0);
    const yUp = kerrSchildSpherical([0, 3, 0], 0.9, [0, 1, 0]);
    assertClose(yUp.r, 3);
    assertClose(yUp.theta, 0, { abs: 1e-7 });

    for (const [r, theta, phi, a] of [
        [1.2, 0.4, 1, 0.9],
        [0.3, 2.5, -2, 0.7],
        [6, 1.1, 0.2, 0.99],
    ]) {
        const position = [
            Math.sin(theta) * (r * Math.cos(phi) - a * Math.sin(phi)),
            Math.sin(theta) * (r * Math.sin(phi) + a * Math.cos(phi)),
            r * Math.cos(theta),
        ];
        const back = kerrSchildSpherical(position, a);
        assertClose(back.r, r, { rel: 1e-12 });
        assertClose(back.theta, theta, { rel: 1e-12 });
    }
});

test('relativistic velocity addition', () => {
    const speed = (v) => Math.hypot(...v);
    assertClose(addVelocities([0.5, 0, 0], [0.5, 0, 0])[0], 0.8, { rel: 1e-12 });
    assertClose(speed(addVelocities([0.5, 0, 0], [-0.5, 0, 0])), 0, { abs: 1e-15 });
    assert.deepEqual(addVelocities([0, 0, 0], [0.1, 0.2, 0.3]), [0.1, 0.2, 0.3]);
    assert.deepEqual(addVelocities([0.1, 0.2, 0.3], [0, 0, 0]), [0.1, 0.2, 0.3]);
    // gamma of the sum is gamma_b gamma_v (1 + b.v) for any pair of velocities.
    for (const [base, boost] of [
        [
            [0.6, 0, 0],
            [0, 0.8, 0],
        ],
        [
            [0.3, -0.4, 0.2],
            [-0.5, 0.1, 0.6],
        ],
        [
            [0, 0.9, 0],
            [0.2, 0.5, -0.1],
        ],
    ]) {
        const gamma = (v) => 1 / Math.sqrt(1 - speed(v) ** 2);
        const dot = base.reduce((sum, b, i) => sum + b * boost[i], 0);
        assertClose(gamma(addVelocities(base, boost)), gamma(base) * gamma(boost) * (1 + dot), {
            rel: 1e-12,
        });
    }
    const clock = clockRates({
        mode: 'moving',
        r: 10,
        speed: speed(addVelocities([0.6, 0, 0], [0, 0.8, 0])),
    });
    assertClose(clock.lorentzFactor, 1.25 * (5 / 3), { rel: 1e-12 });
});
