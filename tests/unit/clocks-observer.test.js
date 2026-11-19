import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createObserverClock } from '../../src/features/clocks/observer-clock.js';
import { formatClockReading } from '../../src/features/clocks/clock-format.js';
import { freefallProperTime } from '../../src/features/clocks/kerr-time.js';
import { horizonRadii } from '../../src/features/units/kerr.js';
import { createMassScale } from '../../src/features/units/mass-scaling.js';
import { formatClock, MISSING } from '../../src/features/units/format.js';
import { assertClose } from './support/assert-close.js';

// Boyer-Lindquist time of the Schwarzschild rain observer (M = 1) up to a constant, from
// t = T_PG - 2[2u + ln((u - 1)/(u + 1))] with T_PG = tau and u = sqrt(r/2).
function rainTime(r) {
    const u = Math.sqrt(r / 2);
    return -(4 / 3) * u ** 3 - 4 * u - 2 * Math.log((u - 1) / (u + 1));
}

function rainProperTime(r) {
    return ((2 / 3) * r ** 1.5) / Math.sqrt(2);
}

test('a static clock at 11 r_s runs slow by sqrt(1 - r_s/r)', () => {
    const clock = createObserverClock({ unit: 'rs' });
    let reading;
    for (let i = 0; i < 10; i += 1) reading = clock.advance({ mode: 'static', r: 11 }, 0.1);
    assertClose(reading.tau, 1, { rel: 1e-12 });
    assertClose(reading.t, 1 / Math.sqrt(1 - 1 / 11), { rel: 1e-12 });
    assertClose(reading.dTauDt, Math.sqrt(1 - 1 / 11), { rel: 1e-12 });
    assert.equal(reading.regime, 'exterior');
    assert.equal(reading.unit, 'rs');
    assert.equal(reading.r, 11);
    assert.equal(reading.properTimeRemaining, null);
    assert.deepEqual(reading.events, []);
    assert.ok(Object.isFrozen(reading) && Object.isFrozen(reading.redshift));
    assert.equal(clock.read(), reading);
});

test('free fall follows the rain worldline whatever the frame steps are', () => {
    const radii = [22, 21.3, 18, 17.99, 12, 7.5, 7.5, 4, 3.1, 2.5];
    for (const unit of ['M', 'rs']) {
        const scale = unit === 'rs' ? 2 : 1;
        const clock = createObserverClock({ unit });
        let reading;
        for (const r of radii) reading = clock.advance({ mode: 'freefall', r: r / scale }, 123);
        assertClose(reading.tau * scale, rainProperTime(22) - rainProperTime(2.5), { rel: 1e-10 });
        assertClose(reading.t * scale, rainTime(2.5) - rainTime(22), { rel: 1e-10 });
        assertClose(reading.dTauDt, 1 - 2 / 2.5, { rel: 1e-12 });
        assertClose(reading.speed, Math.sqrt(2 / 2.5), { rel: 1e-12 });
        assertClose(reading.properTimeRemaining * scale, rainProperTime(2.5), { rel: 1e-12 });
        assertClose(reading.properTimeToHorizon * scale, rainProperTime(2.5) - rainProperTime(2), {
            rel: 1e-10,
        });
    }
});

test('crossing the Schwarzschild horizon leaves t undefined while tau and tKS keep running', () => {
    const clock = createObserverClock();
    clock.advance({ mode: 'freefall', r: 6 });
    const outside = clock.advance({ mode: 'freefall', r: 2.01 });
    const crossing = clock.advance({ mode: 'freefall', r: 1.5 });
    assert.deepEqual(crossing.events, ['crossed-horizon']);
    assert.equal(crossing.regime, 'interior');
    assert.equal(crossing.t, null);
    assert.equal(crossing.dTauDt, null);
    assert.equal(crossing.redshift, null);
    assert.ok(crossing.tKS > outside.tKS && Number.isFinite(crossing.tKS));
    assertClose(crossing.tau, rainProperTime(6) - rainProperTime(1.5), { rel: 1e-10 });

    const end = clock.advance({ mode: 'freefall', r: 0 });
    assert.deepEqual(end.events, ['reached-singularity']);
    assert.equal(end.regime, 'end');
    assert.equal(end.endReason, 'singularity');
    assertClose(end.tau, rainProperTime(6), { rel: 1e-10 });
    assert.equal(end.properTimeRemaining, 0);
    const after = clock.advance({ mode: 'freefall', r: 0 }, 5);
    assert.equal(after.tau, end.tau);
    assert.deepEqual(after.events, []);
});

test('the distant time diverges logarithmically towards the horizon', () => {
    const clock = createObserverClock();
    clock.advance({ mode: 'freefall', r: 10 });
    const near = clock.advance({ mode: 'freefall', r: 2 + 1e-6 });
    const nearer = clock.advance({ mode: 'freefall', r: 2 + 1e-9 });
    assertClose(nearer.t - near.t, rainTime(2 + 1e-9) - rainTime(2 + 1e-6), { rel: 1e-6 });
    assert.ok(nearer.t - near.t > 13);
});

test('switching modes keeps both clocks continuous', () => {
    const clock = createObserverClock({ unit: 'rs' });
    clock.advance({ mode: 'circular', r: 11 }, 0);
    const orbiting = clock.advance({ mode: 'circular', r: 11 }, 50);
    assertClose(orbiting.t, 50 / Math.sqrt(1 - 1.5 / 11), { rel: 1e-12 });
    const diving = clock.advance({ mode: 'freefall', r: 11 }, 1);
    assert.equal(diving.t, orbiting.t);
    assert.equal(diving.tau, orbiting.tau);
    const fallen = clock.advance({ mode: 'freefall', r: 5 }, 1);
    assertClose(fallen.t - orbiting.t, (rainTime(10) - rainTime(22)) / 2, { rel: 1e-10 });
    const hovering = clock.advance({ mode: 'static', r: 5 }, 2);
    assertClose(hovering.t - fallen.t, 2 / Math.sqrt(1 - 1 / 5), { rel: 1e-12 });
    assertClose(hovering.tau - fallen.tau, 2, { rel: 1e-12 });
});

test('outward jumps during free fall are teleports that do not advance the clocks', () => {
    const clock = createObserverClock();
    clock.advance({ mode: 'freefall', r: 8 });
    const before = clock.advance({ mode: 'freefall', r: 5 });
    const jumped = clock.advance({ mode: 'freefall', r: 9 }, 10);
    assert.equal(jumped.tau, before.tau);
    assert.equal(jumped.t, before.t);
    assert.equal(jumped.tKS, before.tKS);
});

test('a Kerr dive reports the ergosphere, both horizons and the remaining proper time', () => {
    const a = 0.9;
    const { inner } = horizonRadii(a);
    const clock = createObserverClock({ spin: a });
    const start = clock.advance({ mode: 'freefall', r: 3 });
    assertClose(start.properTimeRemaining, freefallProperTime(3, inner, a), { rel: 1e-12 });
    const ergo = clock.advance({ mode: 'freefall', r: 1.9 });
    assert.deepEqual(ergo.events, ['entered-ergosphere']);
    const inside = clock.advance({ mode: 'freefall', r: 1 });
    assert.deepEqual(inside.events, ['crossed-horizon']);
    assert.equal(inside.t, null);
    assertClose(inside.properTimeRemaining, freefallProperTime(1, inner, a), { rel: 1e-12 });
    const end = clock.advance({ mode: 'freefall', r: 0.5 });
    assert.deepEqual(end.events, ['reached-inner-horizon']);
    assert.equal(end.endReason, 'inner-horizon');
    assertClose(end.tau, freefallProperTime(3, inner, a), { rel: 1e-10 });
    assertClose(
        end.tau - inside.tau,
        freefallProperTime(1, inner, a),
        { rel: 1e-10 },
        'the last step stops at the inner horizon',
    );
});

test('static mode inside the ergosphere falls back to the ZAMO', () => {
    const clock = createObserverClock({ spin: 0.9 });
    clock.advance({ mode: 'static', r: 3 }, 1);
    const reading = clock.advance({ mode: 'static', r: 1.8 }, 1);
    assert.equal(reading.mode, 'zamo');
    assert.equal(reading.requestedMode, 'static');
    assert.deepEqual(reading.notices, ['inside-ergosphere']);
    assert.deepEqual(reading.events, ['entered-ergosphere']);
    const out = clock.advance({ mode: 'static', r: 3 }, 1);
    assert.deepEqual(out.events, ['left-ergosphere']);
});

test('requesting a stationary mode inside the horizon is treated as free fall', () => {
    const clock = createObserverClock();
    clock.advance({ mode: 'static', r: 3 }, 1);
    const reading = clock.advance({ mode: 'static', r: 1.5 }, 1);
    assert.equal(reading.mode, 'freefall');
    assert.deepEqual(reading.notices, ['inside-horizon']);
    assert.deepEqual(reading.events, ['crossed-horizon']);
    assert.equal(reading.t, null);
});

test('returning outside without a reset re-anchors t to its last exterior value', () => {
    const clock = createObserverClock();
    clock.advance({ mode: 'freefall', r: 6 });
    const last = clock.advance({ mode: 'freefall', r: 2.5 });
    clock.advance({ mode: 'freefall', r: 1 });
    const back = clock.advance({ mode: 'static', r: 6 }, 1);
    assert.deepEqual(back.events, ['left-horizon']);
    assert.equal(back.t, last.t);
});

test('reset sets the clocks and starts a new worldline', () => {
    const clock = createObserverClock({ unit: 'rs' });
    clock.advance({ mode: 'freefall', r: 3 });
    clock.advance({ mode: 'freefall', r: 0.5 });
    clock.reset({ tau: 10, t: 20 });
    assert.equal(clock.read(), null);
    const reading = clock.advance({ mode: 'static', r: 11 }, 0);
    assert.deepEqual(reading.events, []);
    assert.equal(reading.tau, 10);
    assert.equal(reading.t, 20);
    assert.equal(reading.tKS, 20);
});

test('positions in Kerr-Schild coordinates with any spin axis', () => {
    const clock = createObserverClock({ unit: 'rs', spin: 0.9 });
    const equatorial = clock.advance({ mode: 'static', position: [11, 0, 0] }, 0);
    assertClose(equatorial.r, Math.sqrt(22 * 22 - 0.81) / 2, { rel: 1e-12 });
    assertClose(equatorial.theta, Math.PI / 2);
    const polar = clock.advance({ mode: 'static', position: [0, 11, 0], axis: [0, 1, 0] }, 0);
    assertClose(polar.r, 11);
    assertClose(polar.theta, 0, { abs: 1e-7 });
});

test('moving mode takes a speed or a velocity vector relative to the ZAMO', () => {
    const clock = createObserverClock();
    const bySpeed = clock.advance({ mode: 'moving', r: 10, speed: 0.6 }, 0);
    const byVector = clock.advance({ mode: 'moving', r: 10, velocity: [0.36, 0.48, 0] }, 0);
    assertClose(byVector.dTauDt, bySpeed.dTauDt, { rel: 1e-12 });
    assertClose(bySpeed.lorentzFactor, 1.25, { rel: 1e-12 });
    assertClose(bySpeed.kinematicFactor, 0.8, { rel: 1e-12 });
    assertClose(bySpeed.redshift.kinematic, 0.25, { rel: 1e-12 });
});

test('spin changes take effect on the next frame', () => {
    const clock = createObserverClock();
    assert.equal(clock.spin, 0);
    clock.setSpin(0.9);
    assert.equal(clock.spin, 0.9);
    assert.equal(clock.advance({ mode: 'static', r: 1.9 }, 0).mode, 'zamo');
    clock.setSpin(1);
    assert.equal(clock.spin, 0.9999);
    assert.throws(() => clock.setSpin(2), RangeError);
});

test('invalid clock inputs are rejected', () => {
    const clock = createObserverClock();
    assert.throws(() => clock.advance({ mode: 'static', r: 5 }, -1), RangeError);
    assert.throws(() => clock.advance({ mode: 'static', r: 5 }, Number.NaN), RangeError);
    assert.throws(() => clock.advance({ mode: 'static' }, 1), RangeError);
    assert.throws(() => createObserverClock({ unit: 'km' }), RangeError);
});

test('HUD strings for an M87* orbit at 11 r_s', () => {
    const scale = createMassScale({ massSolar: 6.5e9 });
    const clock = createObserverClock({ unit: 'rs' });
    const tauSeconds = 1.5 * 86400 + 0.5;
    const reading = clock.advance({ mode: 'circular', r: 11 }, scale.fromSeconds(tauSeconds, 'rs'));
    const text = formatClockReading(reading, scale);
    assert.equal(text.tau, '1\u{a0}d\u{a0}12:00:00');
    assert.equal(text.t, formatClock(tauSeconds / Math.sqrt(1 - 1.5 / 11)));
    assert.equal(text.dTauDt, '0.929');
    assert.equal(text.speed, '0.224\u{a0}c');
    assert.equal(text.lorentzFactor, '1.026');
    assert.equal(text.gravitationalRedshift, '+0.049');
    assert.equal(text.properTimeRemaining, null);
    assert.equal(text.speech.tau, '1 day 12 hours');
    assert.equal(text.speech.dTauDt, '0.929');
    assert.equal(text.speech.gravitationalRedshift, 'plus 0.049');
    const short = formatClockReading(reading, scale, { showSeconds: false });
    assert.equal(short.tau, '1\u{a0}d\u{a0}12:00');
});

test('HUD strings inside the horizon', () => {
    const scale = createMassScale({ massSolar: 4.297e6 });
    const clock = createObserverClock({ unit: 'rs' });
    clock.advance({ mode: 'freefall', r: 3 });
    const reading = clock.advance({ mode: 'freefall', r: 0.5 });
    const text = formatClockReading(reading, scale);
    assert.equal(text.t, MISSING);
    assert.equal(text.dTauDt, MISSING);
    assert.equal(text.gravitationalRedshift, MISSING);
    assert.equal(text.speech.t, 'undefined inside the horizon');
    assert.equal(text.speech.dTauDt, 'undefined inside the horizon');
    assert.match(text.properTimeRemaining, /^\d+(\.\d+)?\u{a0}s$/u);
    assert.match(text.speech.properTimeRemaining, / seconds$/);
});
