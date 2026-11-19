import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
    boostVelocity,
    cameraTetrad,
    clockRate,
    cksPosition,
    dot4,
    horizonRadius,
    innerHorizonRadius,
    iscoRadius,
    keplerAngularVelocity,
    ksRadius,
    metric,
    observerComponents,
    rainRadialRate,
    rainVelocity,
    speedRelativeToZamo,
    staticAcceleration,
    staticVelocity,
    zamoVelocity,
    blQuantities,
} from '../../src/app/core/physics/kerr.js';
import {
    bardeenShadowExtent,
    circularOrbitVelocity,
    ergosurfaceRadius,
    marginallyBoundRadius,
    photonOrbitRadius,
    schwarzschildShadowAngle,
} from '../support/kerr-reference.js';

function close(actual, expected, tolerance, label) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${label}: expected ${expected}, got ${actual}`,
    );
}

// Characteristic radii in units of M (Bardeen, Press & Teukolsky 1972; Teo 2003).
const RADII = [
    { a: 0.0, rp: 2.0, rm: 0.0, iscoPro: 6.0, iscoRetro: 6.0, phPro: 3.0, phRetro: 3.0, mb: 4.0 },
    {
        a: 0.5,
        rp: 1.866,
        rm: 0.134,
        iscoPro: 4.233,
        iscoRetro: 7.5546,
        phPro: 2.3473,
        phRetro: 3.5321,
        mb: 2.9142,
    },
    {
        a: 0.6,
        rp: 1.8,
        rm: 0.2,
        iscoPro: 3.8291,
        iscoRetro: 7.8507,
        phPro: 2.1889,
        phRetro: 3.6298,
        mb: 2.6649,
    },
    {
        a: 0.7,
        rp: 1.7141,
        rm: 0.2859,
        iscoPro: 3.3931,
        iscoRetro: 8.143,
        phPro: 2.0133,
        phRetro: 3.7253,
        mb: 2.3954,
    },
    {
        a: 0.9,
        rp: 1.4359,
        rm: 0.5641,
        iscoPro: 2.3209,
        iscoRetro: 8.7174,
        phPro: 1.5579,
        phRetro: 3.9103,
        mb: 1.7325,
    },
    {
        a: 0.99,
        rp: 1.1411,
        rm: 0.8589,
        iscoPro: 1.4545,
        iscoRetro: 8.9719,
        phPro: 1.1676,
        phRetro: 3.9911,
        mb: 1.21,
    },
    {
        a: 0.998,
        rp: 1.0632,
        rm: 0.9368,
        iscoPro: 1.237,
        iscoRetro: 8.9944,
        phPro: 1.0739,
        phRetro: 3.9982,
        mb: 1.0914,
    },
];

test('horizons, ISCO, photon orbits and marginally bound orbits match the closed forms', () => {
    for (const row of RADII) {
        close(horizonRadius(row.a, 1), row.rp, 1e-4, `r+ a=${row.a}`);
        close(innerHorizonRadius(row.a, 1), row.rm, 1e-4, `r- a=${row.a}`);
        close(iscoRadius(row.a, true, 1), row.iscoPro, 1e-4, `ISCO pro a=${row.a}`);
        close(iscoRadius(row.a, false, 1), row.iscoRetro, 1e-4, `ISCO retro a=${row.a}`);
        close(photonOrbitRadius(row.a, true, 1), row.phPro, 1e-4, `r_ph pro a=${row.a}`);
        close(photonOrbitRadius(row.a, false, 1), row.phRetro, 1e-4, `r_ph retro a=${row.a}`);
        close(marginallyBoundRadius(row.a, true, 1), row.mb, 1e-4, `r_mb a=${row.a}`);
    }
});

test('radii scale with the mass used by the shader (r_s = 1)', () => {
    close(horizonRadius(0), 1.0, 1e-12, 'Schwarzschild horizon');
    close(iscoRadius(0), 3.0, 1e-12, 'Schwarzschild ISCO');
    close(photonOrbitRadius(0), 1.5, 1e-12, 'photon sphere');
    close(horizonRadius(0.45), 0.5 * 1.4359, 1e-4, 'a = 0.9 M horizon');
    close(ergosurfaceRadius(0.45, 0), 1.0, 1e-12, 'equatorial ergosurface');
    close(ergosurfaceRadius(0.45, 1), horizonRadius(0.45), 1e-12, 'polar ergosurface');
});

test('the Kerr-Schild radius inverts the spheroidal embedding', () => {
    const a = 0.45;
    for (const [r, theta, phi] of [
        [3.0, 0.3, 1.0],
        [0.8, 1.5707963, -2.0],
        [0.2, 1.2, 0.4],
        [12.0, 2.8, 3.0],
    ]) {
        const dir = [
            Math.sin(theta) * Math.cos(phi),
            Math.sin(theta) * Math.sin(phi),
            Math.cos(theta),
        ];
        const [x, y, z] = cksPosition(r, dir, a);
        close(ksRadius(x, y, z, a), r, 1e-12, `r at theta=${theta}`);
    }
});

function assertUnitTimelike(pos, u, a, M, label) {
    close(dot4(metric(pos, a, M), u, u), -1, 1e-12, `${label} normalisation`);
}

test('observer 4-velocities are normalised and reduce to Schwarzschild for a = 0', () => {
    const a = 0.45;
    const pos = cksPosition(2.0, [0.6, 0.0, 0.8], a);
    assertUnitTimelike(pos, staticVelocity(pos, a), a, 0.5, 'static');
    assertUnitTimelike(pos, zamoVelocity(pos, a), a, 0.5, 'ZAMO');
    assertUnitTimelike(pos, rainVelocity(pos, a), a, 0.5, 'rain');
    const inside = cksPosition(0.4, [0.6, 0.0, 0.8], a);
    assertUnitTimelike(inside, rainVelocity(inside, a), a, 0.5, 'rain inside the horizon');
    const eq = [3.0, 0.0, 0.0];
    assertUnitTimelike(eq, circularOrbitVelocity(eq, 0.0, 1), 0.0, 0.5, 'circular');

    const r = 4.0;
    close(staticVelocity([r, 0, 0], 0)[0], 1 / Math.sqrt(1 - 1 / r), 1e-12, 'static u^t');
    const rain = rainVelocity([r, 0, 0], 0);
    close(rain[1], -Math.sqrt(1 / r), 1e-12, 'rain u^r = -sqrt(r_s / r)');
    close(rainRadialRate(r, 0, 0), -Math.sqrt(1 / r), 1e-12, 'rain dr/dtau');
    assert.equal(staticVelocity(cksPosition(0.9, [1, 0, 0], a), a), null);
});

test('clock rates at a = 0.9 match the published values', () => {
    const M = 1;
    const a = 0.9;
    const isco = iscoRadius(a, true, M);
    for (const [r, zamo, circ, stat] of [
        [isco, 0.4749, 0.3709, 0.3718],
        [4.0, 0.7154, 0.6195, 0.7071],
    ]) {
        const pos = [Math.sqrt(r * r + a * a), 0, 0];
        close(blQuantities(pos, a, M).alpha, zamo, 1e-4, `ZAMO lapse r=${r}`);
        close(clockRate(zamoVelocity(pos, a, M)), zamo, 1e-4, `ZAMO clock r=${r}`);
        close(clockRate(circularOrbitVelocity(pos, a, 1, M)), circ, 1e-4, `circular clock r=${r}`);
        close(clockRate(staticVelocity(pos, a, M)), stat, 1e-4, `static clock r=${r}`);
    }
    const posIsco = [Math.sqrt(isco * isco + a * a), 0, 0];
    const omega = keplerAngularVelocity(isco, a, 1, M);
    close(speedRelativeToZamo(posIsco, omega, a, M), 0.6245, 1e-4, 'ISCO speed vs ZAMO');
});

test('prograde circular clocks at a = 0.94 match the HUD reference values', () => {
    const M = 1;
    const a = 0.94;
    for (const [r, expected] of [
        [22, 0.9306],
        [6, 0.7448],
        [3, 0.5094],
    ]) {
        const u = circularOrbitVelocity([Math.sqrt(r * r + a * a), 0, 0], a, 1, M);
        close(clockRate(u), expected, 1e-4, `dtau/dt at ${r} M`);
    }
});

test('the rain observer moves radially at sqrt(1 - alpha^2) relative to the ZAMO', () => {
    const M = 1;
    const a = 0.9;
    const pos = cksPosition(3.0, [Math.sin(1.0), 0, Math.cos(1.0)], a);
    const g = metric(pos, a, M);
    const zamo = zamoVelocity(pos, a, M);
    const rain = rainVelocity(pos, a, M);
    const gamma = -dot4(g, rain, zamo);
    const alpha = blQuantities(pos, a, M).alpha;
    close(Math.sqrt(1 - 1 / (gamma * gamma)), Math.sqrt(1 - alpha * alpha), 1e-12, 'speed');
});

test('static hover: gravitational blueshift and proper acceleration', () => {
    for (const [r, g, accel] of [
        [1.5, 1.732, 0.385],
        [1.2, 2.449, 0.851],
        [1.1, 3.317, 1.371],
        [1.01, 10.05, 4.926],
    ]) {
        const pos = [r, 0, 0];
        close(1 / clockRate(staticVelocity(pos, 0)), g, 1e-3, `blueshift r=${r}`);
        close(staticAcceleration(pos, 0), accel, 1e-3, `acceleration r=${r}`);
    }
});

test('camera tetrads are orthonormal and encode aberration and Doppler shift', () => {
    const a = 0.45;
    const pos = cksPosition(1.3, [0.8, 0.0, 0.6], a);
    const g = metric(pos, a);
    const base = zamoVelocity(pos, a);
    const moving = boostVelocity(g, base, [0, 1, 0], 0.6);
    assertUnitTimelike(pos, moving, a, 0.5, 'boosted');
    close(-dot4(g, moving, base), 1.25, 1e-12, 'boost gamma');

    const tetrad = cameraTetrad(g, moving, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    const legs = [tetrad.e1, tetrad.e2, tetrad.e3];
    for (let i = 0; i < 3; i++) {
        close(dot4(g, legs[i], moving), 0, 1e-12, `e${i + 1}.u`);
        for (let j = 0; j < 3; j++) {
            close(dot4(g, legs[i], legs[j]), i === j ? 1 : 0, 1e-12, `e${i + 1}.e${j + 1}`);
        }
    }

    const c = observerComponents(g, tetrad, base);
    close(c[0], 1.25, 1e-12, 'reference gamma');
    // Light seen dead ahead by the moving camera is blueshifted by sqrt((1 + v)/(1 - v)) = 2
    // relative to the ZAMO it moves through.
    close(1 / (c[0] + c[3]), 2.0, 1e-9, 'forward Doppler factor');
});

test('Schwarzschild shadow size for a static observer', () => {
    close(schwarzschildShadowAngle(1.5), Math.PI / 2, 1e-12, 'photon sphere');
    close((schwarzschildShadowAngle(11) * 180) / Math.PI, 13.02, 0.01, 'r = 11');
    close((schwarzschildShadowAngle(3) * 180) / Math.PI, 45.0, 0.01, 'r = 3');
    close((schwarzschildShadowAngle(1.2) * 180) / Math.PI, 180 - 62.114, 0.01, 'r = 1.2');
});

test('Bardeen critical curve extents', () => {
    const deg = Math.PI / 180;
    for (const [a, incl, min, max, height] of [
        [0.5, 90, -4.0962, 6.1382, 10.3923],
        [0.9, 90, -2.8444, 6.8322, 10.3923],
        [0.9, 60, -3.0959, 6.5894, 10.2709],
        [0.9, 17, -4.3031, 5.5036, 9.89],
    ]) {
        const ext = bardeenShadowExtent(a, incl * deg);
        close(ext.alphaMin, min, 2e-3, `alpha min a=${a} i=${incl}`);
        close(ext.alphaMax, max, 2e-3, `alpha max a=${a} i=${incl}`);
        close(2 * ext.betaMax, height, 4e-3, `height a=${a} i=${incl}`);
    }
});
