import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
    boyerLindquistFunctions,
    circularOrbitAngularMomentum,
    circularOrbitEnergy,
    circularOrbitUt,
    epicyclicFrequencies,
    ergosphereRadius,
    horizonRadii,
    iscoRadius,
    kerrRadii,
    keplerAngularVelocity,
    marginallyBoundRadius,
    novikovThorneFlux,
    novikovThorneFluxPeak,
    photonOrbitRadius,
    radiativeEfficiency,
} from '../../src/features/units/kerr.js';
import { gravitationalTime } from '../../src/features/units/mass-scaling.js';
import { assertClose, assertRoundsTo } from './support/assert-close.js';

// Reference values from an independent evaluation of the BPT72 closed forms, rounded as printed.
// Columns: a, r+, r-, ISCO pro/retro, photon orbit pro/retro, marginally bound (pro), E_isco, eta.
const KERR_TABLE = [
    ['0', '2', '0', '6', '6', '3', '3', '4', '0.94281', '0.0572'],
    [
        '0.5',
        '1.8660',
        '0.1340',
        '4.2330',
        '7.5546',
        '2.3473',
        '3.5321',
        '2.9142',
        '0.91788',
        '0.0821',
    ],
    ['0.6', '1.8', '0.2', '3.8291', '7.8507', '2.1889', '3.6298', '2.6649', '0.90879', '0.0912'],
    [
        '0.7',
        '1.7141',
        '0.2859',
        '3.3931',
        '8.1430',
        '2.0133',
        '3.7253',
        '2.3954',
        '0.89640',
        '0.1036',
    ],
    [
        '0.9',
        '1.4359',
        '0.5641',
        '2.3209',
        '8.7174',
        '1.5579',
        '3.9103',
        '1.7325',
        '0.84425',
        '0.1558',
    ],
    [
        '0.99',
        '1.1411',
        '0.8589',
        '1.4545',
        '8.9719',
        '1.1676',
        '3.9911',
        '1.2100',
        '0.73597',
        '0.2640',
    ],
    [
        '0.998',
        '1.0632',
        '0.9368',
        '1.2370',
        '8.9944',
        '1.0739',
        '3.9982',
        '1.0914',
        '0.67901',
        '0.3210',
    ],
];

test('characteristic Kerr radii and efficiencies match the reference table', () => {
    for (const [spin, rPlus, rMinus, iscoP, iscoR, phP, phR, mb, eIsco, eta] of KERR_TABLE) {
        const a = Number(spin);
        const radii = kerrRadii(a);
        const label = `a = ${spin}`;
        assertRoundsTo(radii.horizonOuter, rPlus, `${label} r+`);
        assertRoundsTo(radii.horizonInner, rMinus, `${label} r-`);
        assertRoundsTo(radii.iscoPrograde, iscoP, `${label} prograde ISCO`);
        assertRoundsTo(radii.iscoRetrograde, iscoR, `${label} retrograde ISCO`);
        assertRoundsTo(radii.photonOrbitPrograde, phP, `${label} prograde photon orbit`);
        assertRoundsTo(radii.photonOrbitRetrograde, phR, `${label} retrograde photon orbit`);
        assertRoundsTo(radii.marginallyBoundPrograde, mb, `${label} marginally bound`);
        assertRoundsTo(circularOrbitEnergy(iscoRadius(a), a), eIsco, `${label} E_isco`);
        assertRoundsTo(radiativeEfficiency(a), eta, `${label} efficiency`);
    }
});

test('retrograde spins use the counter-rotating orbit branch', () => {
    assertClose(iscoRadius(-0.9), kerrRadii(0.9).iscoRetrograde);
    assertClose(photonOrbitRadius(-0.9), kerrRadii(0.9).photonOrbitRetrograde);
    assertClose(iscoRadius(-1), 9, { rel: 1e-12 });
    assertClose(photonOrbitRadius(-1), 4, { rel: 1e-12 });
    assertClose(marginallyBoundRadius(-1), 3 + 2 * Math.sqrt(2), { rel: 1e-12 });
    assert.deepEqual(kerrRadii(-0.7), kerrRadii(0.7));
});

test('extremal spin reaches the horizon for every prograde orbit', () => {
    assertClose(horizonRadii(1).outer, 1);
    assertClose(iscoRadius(1), 1, { rel: 1e-12 });
    assertClose(photonOrbitRadius(1), 1, { rel: 1e-12 });
    assertClose(marginallyBoundRadius(1), 1, { rel: 1e-12 });
});

test('ergosphere is 2M at the equator and touches the horizon at the poles', () => {
    for (const a of [0, 0.5, 0.9, 0.998]) {
        assertClose(ergosphereRadius(a), 2);
        assertClose(ergosphereRadius(a, 0), horizonRadii(a).outer);
        assertClose(ergosphereRadius(a, Math.PI), horizonRadii(a).outer);
        assert.ok(ergosphereRadius(a, Math.PI / 4) > horizonRadii(a).outer || a === 0);
    }
});

test('invalid spins are rejected', () => {
    for (const bad of [1.01, -1.5, Number.NaN, Infinity, '0.5', undefined]) {
        assert.throws(() => iscoRadius(bad), RangeError);
        assert.throws(() => horizonRadii(bad), RangeError);
    }
});

test('ISCO is the minimum of the circular-orbit energy and the radial epicyclic frequency vanishes there', () => {
    for (const a of [-0.9, 0, 0.5, 0.9, 0.99]) {
        const r = iscoRadius(a);
        const e = circularOrbitEnergy(r, a);
        assert.ok(circularOrbitEnergy(r * 1.01, a) > e);
        assert.ok(circularOrbitEnergy(r * 0.99, a) > e);
        assertClose(epicyclicFrequencies(r, a).radial, 0, { abs: 1e-6 });
    }
});

test('circular orbits exist only outside the photon orbit and are bound outside r_mb', () => {
    for (const a of [-0.5, 0, 0.9]) {
        const rph = photonOrbitRadius(a);
        assert.ok(Number.isNaN(circularOrbitEnergy(rph * 0.999, a)));
        assert.ok(Number.isNaN(circularOrbitUt(rph * 0.999, a)));
        assert.ok(Number.isNaN(circularOrbitAngularMomentum(rph * 0.999, a)));
        assertClose(circularOrbitEnergy(marginallyBoundRadius(a), a), 1, { rel: 1e-9 });
    }
});

test('Schwarzschild circular orbits reduce to the textbook values', () => {
    assertClose(circularOrbitUt(6, 0), Math.sqrt(2), { rel: 1e-12 });
    assertClose(circularOrbitAngularMomentum(6, 0), Math.sqrt(12), { rel: 1e-12 });
    assertClose(keplerAngularVelocity(6, 0), 6 ** -1.5);
});

test('disk redshift factor 1/u^t at the ISCO matches the reference values', () => {
    assertRoundsTo(1 / circularOrbitUt(iscoRadius(0), 0), '0.7071');
    assertRoundsTo(1 / circularOrbitUt(iscoRadius(0.9), 0.9), '0.3709');
    assertRoundsTo(1 / circularOrbitUt(iscoRadius(0.99), 0.99), '0.1644');
});

test('epicyclic frequencies reproduce the relativistic precession model example', () => {
    const t10 = gravitationalTime(10);
    const f = epicyclicFrequencies(1.5 * iscoRadius(0.9), 0.9);
    assertRoundsTo(f.orbital / t10, '436.9');
    assertRoundsTo(f.radial / t10, '187.7');
    assertRoundsTo(f.vertical / t10, '351.2');
    assertRoundsTo(f.nodal / t10, '85.67');
    assertRoundsTo(f.periastron / t10, '249.3');
    assertRoundsTo(epicyclicFrequencies(6, 0).orbital / t10, '219.9');
});

test('Boyer-Lindquist lapse and frame dragging', () => {
    const schwarzschild = boyerLindquistFunctions(6, Math.PI / 2, 0);
    assertClose(schwarzschild.lapse, Math.sqrt(1 - 2 / 6), { rel: 1e-12 });
    assert.equal(schwarzschild.frameDragging, 0);
    assertClose(schwarzschild.cylindricalRadius, 6, { rel: 1e-12 });

    assertRoundsTo(boyerLindquistFunctions(iscoRadius(0.9), Math.PI / 2, 0.9).lapse, '0.4749');
    assertRoundsTo(boyerLindquistFunctions(4, Math.PI / 2, 0.9).lapse, '0.7154');
    assert.ok(Number.isNaN(boyerLindquistFunctions(1.2, Math.PI / 2, 0.9).lapse));
    const far = boyerLindquistFunctions(1000, Math.PI / 2, 0.9);
    assertClose(far.frameDragging, (2 * 0.9) / 1000 ** 3, { rel: 1e-3 });
});

test('Novikov-Thorne flux vanishes at the ISCO, peaks nearby and tends to the Newtonian r^-3', () => {
    for (const a of [-0.9, 0, 0.5, 0.9, 0.998, 1]) {
        const rIn = iscoRadius(Math.max(-0.9999, Math.min(0.9999, a)));
        assert.equal(novikovThorneFlux(rIn, a), 0);
        assert.equal(novikovThorneFlux(rIn * 0.9, a), 0);
        assert.ok(novikovThorneFlux(rIn * 1.001, a) > 0);
        const peak = novikovThorneFluxPeak(a);
        assert.ok(peak.radius > rIn && peak.radius < 2 * rIn, `a = ${a} peak at ${peak.radius}`);
        assert.ok(peak.flux >= novikovThorneFlux(peak.radius * 1.01, a));
        assert.ok(peak.flux >= novikovThorneFlux(peak.radius * 0.99, a));
        const r = 1e8;
        assertClose(novikovThorneFlux(r, a) * r ** 3, 1, { rel: 1e-2 });
    }
});
