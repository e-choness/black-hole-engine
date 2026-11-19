import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
    audibility,
    cameraFrequencyShift,
    chirpFrequency,
    chirpMassForSweep,
    chirpPhase,
    chirpTimeToCoalescence,
    chirpVoiceParameters,
    clockTickRates,
    describeSonification,
    diskNoiseCutoff,
    diskVoiceParameters,
    gravitationalWaveCaption,
    hotSpotShift,
    jetDopplerFactors,
    jetLoudness,
    jetPulseRate,
    jetVoiceParameters,
    masterGain,
    normalizeSonificationState,
    octaveShift,
    ringdownFrequency,
    ringdownMode,
    ringdownVoiceParameters,
    sonificationCaptions,
    sonificationParameters,
    transpose,
} from '../../src/features/sonification/mapping.js';
import { createObserverClock } from '../../src/features/clocks/observer-clock.js';
import {
    boyerLindquistFunctions,
    circularOrbitUt,
    horizonRadii,
    iscoRadius,
    keplerAngularVelocity,
    photonOrbitRadius,
} from '../../src/features/units/kerr.js';
import { createMassScale } from '../../src/features/units/mass-scaling.js';
import { NBSP } from '../../src/features/units/format.js';
import { assertClose, assertRoundsTo } from './support/assert-close.js';

const SGR_A = { massSolar: 4.297e6, spin: 0.9 };

test('octave transposition keeps audible sources and moves the rest next to 440 Hz', () => {
    const sgr = createMassScale(SGR_A);
    assertRoundsTo(sgr.iscoOrbitalFrequency, '1.695e-3');
    assert.equal(octaveShift(sgr.iscoOrbitalFrequency), 18);
    assertRoundsTo(transpose(sgr.iscoOrbitalFrequency, 18), '444');

    const stellar = createMassScale({ massSolar: 10, spin: 0 });
    assertRoundsTo(stellar.iscoOrbitalFrequency, '219.9');
    assert.equal(octaveShift(stellar.iscoOrbitalFrequency), 0);

    assert.equal(octaveShift(100), 0);
    assert.equal(octaveShift(1000), 0);
    assert.equal(octaveShift(99), 2);
    assert.equal(octaveShift(1500), -2);
    for (const invalid of [0, -1, NaN, Infinity]) assert.equal(octaveShift(invalid), 0);
    assert.equal(transpose(3, -1), 1.5);
});

test('ringdown fits match the published coefficients and Schwarzschild QNM values', () => {
    const expected = {
        220: [0.3683, 2.119, 0.8273, 10.693],
        221: [0.3413, 0.644, 0.8246, 3.56],
        330: [0.5913, 3.243, 1.2551, 16.281],
    };
    for (const [mode, [omega0, q0, omega98, q98]] of Object.entries(expected)) {
        assertRoundsTo(ringdownMode(0, mode).omega, omega0.toFixed(4));
        assertRoundsTo(ringdownMode(0, mode).quality, String(q0));
        assertRoundsTo(ringdownMode(0.98, mode).omega, omega98.toFixed(4));
        assertRoundsTo(ringdownMode(-0.98, mode).quality, String(q98));
    }
    // Leaver's Schwarzschild modes M omega = 0.373672 - 0.088962i, 0.346711 - 0.273915i and
    // 0.599443 - 0.092703i, with Q = Re / (2 |Im|).
    const leaver = {
        220: [0.373672, 0.088962],
        221: [0.346711, 0.273915],
        330: [0.599443, 0.092703],
    };
    for (const [mode, [re, im]] of Object.entries(leaver)) {
        assertClose(ringdownMode(0, mode).omega, re, { rel: 0.016 });
        assertClose(ringdownMode(0, mode).quality, re / (2 * im), { rel: 0.017 });
    }
    assert.deepEqual(ringdownMode(1), ringdownMode(0.99));
    assert.throws(() => ringdownMode(0.5, '440'), RangeError);
});

test('ringdown frequencies and damping times in physical units', () => {
    const gw150914 = ringdownFrequency(62, 0.67);
    assertRoundsTo(gw150914.frequency, '272.4');
    assertRoundsTo(gw150914.damping, '3.7e-3');
    assertRoundsTo(gw150914.quality, '3.167');
    const stellar = ringdownFrequency(10, 0.7);
    assertRoundsTo(stellar.frequency, '1729');
    assertRoundsTo(stellar.damping, '6.05e-4');
    const sgr = ringdownFrequency(SGR_A.massSolar, 0.9);
    assertRoundsTo(sgr.frequency, '5.008e-3');
    assertRoundsTo(sgr.damping, '329');
    assertRoundsTo(sgr.quality, '5.176');
    const m87 = ringdownFrequency(6.5e9, 0.9);
    assertRoundsTo(m87.frequency, '3.311e-6');
    assertRoundsTo(m87.damping / 86400, '5.76');
    assertClose(m87.damping, m87.quality / (Math.PI * m87.frequency));
});

test('leading-order chirp: frequency, inverse, phase and sweep mass', () => {
    const chirpMass = 28.6;
    const expected = { 10: '7.832', 1: '18.57', 0.1: '44.04', 0.01: '104.4' };
    for (const [tau, frequency] of Object.entries(expected)) {
        const f = chirpFrequency(Number(tau), chirpMass);
        assertRoundsTo(f, frequency);
        assertClose(chirpTimeToCoalescence(f, chirpMass), Number(tau), { rel: 1e-12 });
    }
    // The phase advances at 2 pi f: dPhi/dt = -dPhi/dtau.
    const h = 1e-6;
    const tau = 0.5;
    const rate = (chirpPhase(tau - h, chirpMass) - chirpPhase(tau + h, chirpMass)) / (2 * h);
    assertClose(rate, 2 * Math.PI * chirpFrequency(tau, chirpMass), { rel: 1e-7 });

    const start = chirpFrequency(10, chirpMass);
    const end = chirpFrequency(0.01, chirpMass);
    assertClose(chirpMassForSweep(start, end, 9.99), chirpMass, { rel: 1e-10 });
});

test('hot-spot Doppler factor: Schwarzschild closed forms', () => {
    const r = 6;
    for (const phase of [0, 1, 2, 4]) {
        assertClose(hotSpotShift({ r, inclination: 0, phase }), Math.SQRT1_2, { rel: 1e-12 });
    }
    // Edge-on at the ISCO: v = 1/2 in the static frame, alpha = sqrt(2/3).
    const edge = Math.PI / 2;
    assertClose(hotSpotShift({ r, inclination: edge, phase: edge }), Math.SQRT2, { rel: 1e-12 });
    assertClose(hotSpotShift({ r, inclination: edge, phase: -edge }), Math.SQRT2 / 3, {
        rel: 1e-12,
    });
    assert.ok(Number.isNaN(hotSpotShift({ r: 2.5, spin: 0 })));
});

test('hot-spot Doppler factor agrees with 1 / (u^t (1 - Omega b)) in Kerr', () => {
    // Impact parameter of the photon leaving at cos psi in the ZAMO frame,
    // b = varpi cos psi / (alpha + omega varpi cos psi), but never below the critical impact
    // parameter of the photon orbit against the orbital motion (3 sqrt(r_c) + a = r_c^1.5 - a).
    let clipped = 0;
    for (const spin of [0.9, -0.5, 0.998, 0]) {
        const r = iscoRadius(spin) * 1.2;
        const bl = boyerLindquistFunctions(r, Math.PI / 2, spin);
        const rc = photonOrbitRadius(-spin);
        assertClose(rc ** 1.5 - spin, 3 * Math.sqrt(rc) + spin, { rel: 1e-12 });
        const critical = spin - rc ** 1.5;
        for (const inclination of [0.3, 1.2, Math.PI / 2, 2.5]) {
            for (const phase of [0, 0.7, Math.PI / 2, 3, 4.5, -Math.PI / 2]) {
                const c = Math.sin(inclination) * Math.sin(phase);
                // Inside the ergoregion photons sent far enough backwards have E <= 0 and stay.
                const energy = bl.lapse + bl.frameDragging * bl.cylindricalRadius * c;
                const free = energy > 0 ? (bl.cylindricalRadius * c) / energy : -Infinity;
                const b = r < rc ? Math.max(free, critical) : free;
                if (b !== free) clipped += 1;
                const expected =
                    1 / (circularOrbitUt(r, spin) * (1 - keplerAngularVelocity(r, spin) * b));
                assertClose(hotSpotShift({ r, spin, inclination, phase }), expected, { rel: 1e-9 });
            }
        }
    }
    assert.ok(clipped > 0);

    // At the photon orbit radius itself the tangential backward photon is the critical one.
    const spin = 0.6;
    const rc = photonOrbitRadius(-spin);
    const below = hotSpotShift({ r: rc * (1 - 1e-9), spin, phase: -Math.PI / 2 });
    const above = hotSpotShift({ r: rc * (1 + 1e-9), spin, phase: -Math.PI / 2 });
    assertClose(below, above, { rel: 1e-7 });

    // a = 0.9 at the ISCO: from 1.602 on the approaching side down to 0.146 (not 0.086).
    const r = iscoRadius(0.9);
    assertRoundsTo(hotSpotShift({ r, spin: 0.9, phase: Math.PI / 2 }), '1.602');
    assertRoundsTo(hotSpotShift({ r, spin: 0.9, phase: -Math.PI / 2 }), '0.146');
});

test('camera frequency shift: clock rate when crossing the light, 1/(1 + v) when falling', () => {
    assert.equal(cameraFrequencyShift(null), 1);

    const hovering = createObserverClock({ unit: 'rs' }).advance({ mode: 'static', r: 11 }, 0.1);
    assertClose(cameraFrequencyShift(hovering), 1 / Math.sqrt(1 - 1 / 11));

    const kerr = createObserverClock({ spin: 0.9 });
    const falling = kerr.advance({ mode: 'freefall', r: 5, theta: 1 });
    assertClose(cameraFrequencyShift(falling, 0.9), 1 / (1 + falling.speed), { rel: 1e-12 });

    const rain = (r) => ({ mode: 'freefall', r, theta: Math.PI / 2, unit: 'M' });
    assertClose(cameraFrequencyShift(rain(100)), 1 / (1 + Math.sqrt(2 / 100)));
    assertClose(cameraFrequencyShift({ ...rain(50), unit: 'rs' }), 1 / (1 + Math.sqrt(2 / 100)));
    assert.equal(cameraFrequencyShift(rain(0)), 0);

    const { outer, inner } = horizonRadii(0.9);
    for (const theta of [0.2, 1, Math.PI / 2]) {
        const at = (r) => cameraFrequencyShift({ ...rain(r), theta }, 0.9);
        assertClose(at(outer), 0.5, { rel: 1e-12 });
        assertClose(at(inner), 0.5, { rel: 1e-12 });
        assert.ok(at((outer + inner) / 2) < 0.5);
        assertClose(at(outer * (1 + 1e-9)), at(outer * (1 - 1e-9)), { abs: 1e-8 });
    }
});

test('disk hiss cutoff rises five octaves per four decades of temperature', () => {
    assertClose(diskNoiseCutoff(5000), 600);
    assertClose(diskNoiseCutoff(1e7) / diskNoiseCutoff(1e3), 31.9, { rel: 0.003 });
    assert.equal(diskNoiseCutoff(1e9), 12000);
    assert.equal(diskNoiseCutoff(1), 150);
    for (const invalid of [0, -5, NaN]) assert.equal(diskNoiseCutoff(invalid), 150);
});

test('jet Doppler factors, loudness and knot pulse rate', () => {
    const headOn = jetDopplerFactors(3, 0);
    assertClose(headOn.approaching, 3 + Math.sqrt(8), { rel: 1e-12 });
    assertClose(headOn.receding, 3 - Math.sqrt(8), { rel: 1e-12 });
    const side = jetDopplerFactors(3, Math.PI / 2);
    assertClose(side.approaching, 1 / 3, { rel: 1e-12 });
    assertClose(side.receding, 1 / 3, { rel: 1e-12 });
    assert.deepEqual(jetDopplerFactors(0.5, 1), jetDopplerFactors(1, 1));
    assertClose(jetLoudness(side), 2 / 3 ** 2.7 / (1 + 2 / 3 ** 2.7), { rel: 1e-12 });

    let previous = Infinity;
    for (let angle = 0; angle <= Math.PI / 2; angle += 0.1) {
        const loudness = jetLoudness(jetDopplerFactors(3, angle));
        assert.ok(loudness < previous && loudness > 0 && loudness < 1);
        previous = loudness;
    }

    const beta = Math.sqrt(8) / 3;
    const knots = { lorentzFactor: 3, knotSpacing: 6 };
    assertClose(jetPulseRate({ ...knots, viewingAngle: Math.PI / 2 }), beta / 6, { rel: 1e-12 });
    assertClose(jetPulseRate({ ...knots, viewingAngle: 0 }), beta / (6 * (1 - beta)), {
        rel: 1e-12,
    });
    assertClose(jetPulseRate({ ...knots, viewingAngle: Math.PI }), beta / (6 * (1 - beta)), {
        rel: 1e-12,
    });
    assert.equal(jetPulseRate({ ...knots, viewingAngle: 0, knotSpacing: 0.01 }), 12);
    assert.equal(jetPulseRate({ ...knots, viewingAngle: 1.5, timeScale: 0.01 }), 0.05);
    assert.equal(jetPulseRate({ ...knots, viewingAngle: 1, timeScale: 0 }), 0);
    assert.equal(jetPulseRate({ ...knots, viewingAngle: 1, knotSpacing: 0 }), 0);
});

test('master gain, clock tick rates and audibility', () => {
    assert.equal(masterGain(0.5), 0.25);
    assert.equal(masterGain(-1), 0);
    assert.equal(masterGain(2), 1);
    assert.equal(masterGain(NaN), 0);

    assert.deepEqual(clockTickRates({ dtDtau: 1.5 }), { tau: 1, t: 1.5, tGain: 1, ratio: 1.5 });
    const fast = clockTickRates({ dtDtau: 100 });
    assert.equal(fast.t, 30);
    assertClose(fast.tGain, Math.sqrt(4 / 30));
    assert.equal(fast.ratio, 100);
    assert.deepEqual(clockTickRates({ dtDtau: null }), { tau: 1, t: 0, tGain: 0, ratio: null });
    assert.deepEqual(clockTickRates({ timeScale: 0 }), { tau: 0, t: 0, tGain: 0, ratio: 1 });
    assert.equal(clockTickRates({ timeScale: 100 }).tau, 8);
    assert.equal(clockTickRates({ timeScale: 0.01 }).tau, 0.25);
    assert.equal(clockTickRates({ timeScale: 2, tickInterval: 4 }).tau, 0.5);

    assert.equal(audibility(1000), 1);
    assertClose(audibility(30), Math.log2(1.5));
    assertClose(audibility(12000), Math.log2(4 / 3));
    for (const silent of [20, 16000, 5, 20000, NaN]) assert.equal(audibility(silent), 0);
});

test('state normalization fills defaults and repairs invalid values', () => {
    const defaults = normalizeSonificationState();
    assert.equal(defaults.massSolar, 6.5e9);
    assert.equal(defaults.spin, 0.9);
    assert.equal(defaults.unit, 'rs');
    assert.equal(defaults.observerShift, 1);
    assert.equal(defaults.octaves, null);
    assert.equal(defaults.disk.enabled, true);
    assert.equal(defaults.jet.enabled, false);
    assert.equal(defaults.clock.dtDtau, 1);

    const repaired = normalizeSonificationState({
        massSolar: -5,
        spin: 2,
        unit: 'km',
        timeScale: -1,
        observerShift: 1000,
        octaves: 2.5,
        disk: { enabled: false, temperature: NaN, tone: 'chord', qpoRadius: -1, turbulence: 9 },
        jet: { enabled: 1, lorentzFactor: 0.5, brightness: 7, knotSpacing: -2 },
        clock: { dtDtau: null, tickInterval: 'often' },
    });
    assert.equal(repaired.massSolar, 6.5e9);
    assert.equal(repaired.spin, 0.998);
    assert.equal(repaired.unit, 'rs');
    assert.equal(repaired.timeScale, 0);
    assert.equal(repaired.observerShift, 32);
    assert.equal(repaired.octaves, null);
    assert.deepEqual(repaired.disk, {
        enabled: false,
        temperature: 5000,
        turbulence: 3,
        level: 1,
        tone: 'isco',
        qpoRadius: null,
    });
    assert.equal(repaired.jet.enabled, true);
    assert.equal(repaired.jet.lorentzFactor, 1);
    assert.equal(repaired.jet.brightness, 3);
    assert.equal(repaired.jet.knotSpacing, 0);
    assert.deepEqual(repaired.clock, { dtDtau: null, tickInterval: 1 });
    assert.deepEqual(normalizeSonificationState(repaired), repaired);
});

test('disk voice: transposed ISCO tone, Doppler sweep and hiss', () => {
    const scale = createMassScale(SGR_A);
    const r = scale.diskInnerRadiusM;
    const faceOn = diskVoiceParameters({ ...SGR_A, inclination: 0, observerShift: 1.25 });
    const redshift = 1 / circularOrbitUt(r, 0.9);
    assert.equal(faceOn.octaves, 18);
    assert.equal(faceOn.radiusM, r);
    assertClose(faceOn.spotShift, redshift, { rel: 1e-12 });
    assert.equal(faceOn.spotTrend, 'steady');
    assert.equal(faceOn.spotLevel, 1);
    assert.equal(faceOn.partials.length, 1);
    assertClose(
        faceOn.partials[0].frequency,
        scale.iscoOrbitalFrequency * 2 ** 18 * redshift * 1.25,
        {
            rel: 1e-12,
        },
    );
    assert.equal(faceOn.partials[0].gain, 1);
    assertClose(faceOn.noise.cutoff, 600 * 1.25);
    assertClose(faceOn.noise.turbulence, 1 / 3);

    // Edge-on, in units of M so that simTime = phase / Omega.
    const omega = keplerAngularVelocity(r, 0.9);
    const at = (phase) => diskVoiceParameters({ ...SGR_A, unit: 'M', simTime: phase / omega });
    const approaching = at(Math.PI / 2);
    const receding = at(-Math.PI / 2);
    assert.equal(approaching.spotLevel, 1);
    assert.equal(receding.spotLevel, 0.25);
    assertClose(approaching.spotShift, hotSpotShift({ r, spin: 0.9, phase: Math.PI / 2 }));
    assert.ok(approaching.partials[0].frequency > 4 * receding.partials[0].frequency);
    assert.equal(at(1.5).spotTrend, 'rising');
    assert.equal(at(1.7).spotTrend, 'falling');
    assert.equal(at(-1.7).spotTrend, 'falling');
    assert.equal(at(-1.4).spotTrend, 'rising');
    assertClose(
        diskVoiceParameters({ ...SGR_A, simTime: Math.PI / 2 / omega / 2 }).spotShift,
        approaching.spotShift,
        { rel: 1e-12 },
    );

    const silent = diskVoiceParameters({ ...SGR_A, disk: { enabled: false } });
    assert.equal(silent.partials[0].gain, 0);
    assert.equal(silent.noise.level, 0);
    assert.equal(diskVoiceParameters({ ...SGR_A, octaves: 17 }).octaves, 17);
});

test('disk voice: relativistic-precession QPO triplet', () => {
    const qpo = diskVoiceParameters({
        massSolar: 10,
        spin: 0.9,
        inclination: 0,
        disk: { tone: 'qpo' },
    });
    assert.equal(qpo.octaves, 0);
    assertClose(qpo.radiusM, 1.5 * iscoRadius(0.9), { rel: 1e-12 });
    const physical = Object.fromEntries(qpo.partials.map((p) => [p.name, p.physicalFrequency]));
    assertRoundsTo(physical.orbital, '436.9');
    assertRoundsTo(physical.periastron, '249.3');
    assertRoundsTo(physical.nodal, '85.7');
    for (const partial of qpo.partials) {
        assertClose(partial.frequency, partial.physicalFrequency * qpo.shift, { rel: 1e-12 });
    }
    assert.deepEqual(
        qpo.partials.map((p) => p.gain),
        [1, 0.6, 0.45],
    );

    const custom = diskVoiceParameters({
        massSolar: 10,
        spin: 0.9,
        disk: { tone: 'qpo', qpoRadius: 4 },
    });
    assert.equal(custom.radiusM, 8);
    const inside = diskVoiceParameters({
        massSolar: 10,
        spin: 0.9,
        disk: { tone: 'qpo', qpoRadius: 0.5 },
    });
    assert.equal(inside.radiusM, iscoRadius(0.9));
});

test('jet voice follows beaming and is silent while the jet is off', () => {
    const off = jetVoiceParameters({});
    assert.equal(off.level, 0);
    assert.equal(off.pulseRate, 0);
    const jet = { enabled: true, viewingAngle: 0.3 };
    const on = jetVoiceParameters({ jet, timeScale: 2, observerShift: 2 });
    const deltas = jetDopplerFactors(3, 0.3);
    assertClose(on.level, jetLoudness(deltas), { rel: 1e-12 });
    assertClose(on.doppler, deltas.approaching);
    assertClose(on.cutoff, 2500 * Math.sqrt(deltas.approaching * 2), { rel: 1e-12 });
    assertClose(
        on.pulseRate,
        jetPulseRate({ lorentzFactor: 3, viewingAngle: 0.3, knotSpacing: 6, timeScale: 2 }),
    );
    assert.equal(on.pulseDepth, 0.75);
    assert.equal(jetVoiceParameters({ jet: { ...jet, brightness: 0 } }).level, 0);
});

test('ringdown voice: transposed modes with one common decay stretch', () => {
    const sgr = ringdownVoiceParameters(SGR_A);
    assert.equal(sgr.octaves, 18);
    const [fundamental, overtone, higher] = sgr.modes;
    assert.deepEqual(
        sgr.modes.map((mode) => mode.mode),
        ['220', '221', '330'],
    );
    assertRoundsTo(fundamental.frequency, '1312.8');
    assertClose(sgr.stretch, 0.4 / (fundamental.physicalDamping / 2 ** 18), { rel: 1e-12 });
    assertRoundsTo(sgr.stretch, '318.7');
    assertClose(fundamental.damping, 0.4, { rel: 1e-12 });
    assertClose(
        higher.frequency / fundamental.frequency,
        higher.physicalFrequency / fundamental.physicalFrequency,
        {
            rel: 1e-12,
        },
    );
    assertClose(
        overtone.damping / fundamental.damping,
        overtone.physicalDamping / fundamental.physicalDamping,
        {
            rel: 1e-12,
        },
    );
    assert.deepEqual(
        sgr.modes.map((mode) => mode.amplitude),
        [1, 0.6, 0.25],
    );

    const redshifted = ringdownVoiceParameters({ ...SGR_A, observerShift: 0.5 });
    assertClose(redshifted.modes[0].frequency, fundamental.frequency / 2, { rel: 1e-12 });
    assertClose(redshifted.stretch, sgr.stretch / 2, { rel: 1e-12 });
    assertClose(redshifted.modes[0].damping, 0.4, { rel: 1e-12 });

    const unstretched = ringdownVoiceParameters(SGR_A, { decay: 1e-6 });
    assert.equal(unstretched.stretch, 1);
    assertClose(unstretched.modes[0].damping, fundamental.physicalDamping / 2 ** 18, {
        rel: 1e-12,
    });
});

test('chirp voice sweeps three octaves into the ringdown frequency', () => {
    const chirp = chirpVoiceParameters(SGR_A, { duration: 1.5 });
    const merge = chirp.ringdown.modes[0].frequency;
    assert.equal(chirp.mergeFrequency, merge);
    assertClose(chirp.startFrequency, merge / 8, { rel: 1e-12 });
    assertClose(chirp.startTau - chirp.mergeTau, 1.5, { rel: 1e-12 });
    assertClose(chirpFrequency(chirp.startTau, chirp.chirpMass), chirp.startFrequency, {
        rel: 1e-9,
    });
    assertClose(chirpFrequency(chirp.mergeTau, chirp.chirpMass), merge, { rel: 1e-9 });
    assertClose(chirp.physicalChirpMass, SGR_A.massSolar * 0.25 ** 0.6, { rel: 1e-12 });
    assertClose(chirp.ringdown.modes[0].damping, 0.25, { rel: 1e-12 });

    // The stretch compares with the physical inspiral, transposed by 2^18, over the same band.
    const transposedMass = chirp.physicalChirpMass / 2 ** 18;
    const physicalSweep =
        chirpTimeToCoalescence(chirp.startFrequency, transposedMass) -
        chirpTimeToCoalescence(merge, transposedMass);
    assertClose(chirp.stretch, 1.5 / physicalSweep, { rel: 1e-9 });
    assert.ok(chirp.stretch > 1);
});

test('parameter bundle and legend describe every voice in text', () => {
    const params = sonificationParameters({ ...SGR_A, inclination: 0 });
    assert.deepEqual(Object.keys(params), ['disk', 'jet', 'clock', 'ringdown']);
    const legend = describeSonification(params);
    assert.deepEqual(
        legend.map((entry) => entry.voice),
        ['disk', 'jet', 'gw', 'clock'],
    );
    for (const entry of legend) {
        assert.ok(entry.title.length > 0 && entry.description.length > 40);
    }
    const values = Object.fromEntries(
        legend.flatMap((entry) => entry.values.map(([k, v]) => [`${entry.voice}:${k}`, v])),
    );
    assert.equal(values['disk:Orbital frequency'], `1.70${NBSP}mHz`);
    assert.equal(values['disk:Transposition'], '+18 octaves');
    assert.equal(values['gw:Ringdown frequency'], `5.01${NBSP}mHz`);
    assert.equal(values['gw:Heard at'], `1.31${NBSP}kHz`);
    assert.equal(values['gw:Ringing slowed'], '×320');
    assert.equal(values['clock:Your clock'], `1.00${NBSP}Hz`);

    const stellar = describeSonification(sonificationParameters({ massSolar: 10, spin: 0 }));
    assert.equal(stellar[0].values[1][1], 'none');
    const lower = describeSonification(sonificationParameters({ massSolar: 1, spin: 0 }));
    assert.equal(lower[0].values[1][1], `${'\u{2212}'}2 octaves`);
});

test('captions describe changes and stay quiet without them', () => {
    const r = iscoRadius(0.9);
    const omega = keplerAngularVelocity(r, 0.9);
    const at = (phase, extra = {}) =>
        sonificationParameters({ ...SGR_A, unit: 'M', simTime: phase / omega, ...extra });
    assert.deepEqual(sonificationCaptions(null, at(1)), []);
    assert.deepEqual(sonificationCaptions(at(1), at(1.2)), []);
    assert.deepEqual(sonificationCaptions(at(1.5), at(1.7)), [
        { key: 'spot', text: 'Hot-spot tone falling: receding side' },
    ]);
    assert.deepEqual(sonificationCaptions(at(4.6), at(4.8)), [
        { key: 'spot', text: 'Hot-spot tone rising: approaching side' },
    ]);
    assert.deepEqual(
        sonificationCaptions(
            at(1.5, { disk: { enabled: false } }),
            at(1.7, { disk: { enabled: false } }),
        ),
        [],
    );

    const clock = (dtDtau) => at(1, { clock: { dtDtau } });
    assert.deepEqual(sonificationCaptions(clock(1.5), clock(2.5)), [
        { key: 'clock', text: 'Distant clock ticking twice as fast as yours' },
    ]);
    assert.deepEqual(sonificationCaptions(clock(1.5), clock(12)), [
        { key: 'clock', text: 'Distant clock ticking ten times as fast as yours' },
    ]);
    assert.deepEqual(sonificationCaptions(clock(12), clock(1.5)), []);
    assert.deepEqual(sonificationCaptions(clock(30), clock(null)), [
        { key: 'clock', text: 'Distant clock stopped: its time is undefined inside the horizon' },
    ]);
    assert.deepEqual(sonificationCaptions(clock(null), clock(3)), [
        { key: 'clock', text: 'Distant clock ticking again' },
    ]);

    const jet = (enabled) => at(1, { jet: { enabled } });
    assert.deepEqual(sonificationCaptions(jet(false), jet(true)), [
        { key: 'jet', text: 'Jet hiss on' },
    ]);
    assert.deepEqual(sonificationCaptions(jet(true), jet(false)), [
        { key: 'jet', text: 'Jet hiss off' },
    ]);

    assert.equal(
        gravitationalWaveCaption({ kind: 'ringdown', frequency: 1312.8 }),
        `Gravitational-wave ringdown at 1.31${NBSP}kHz`,
    );
    assert.equal(
        gravitationalWaveCaption({ kind: 'chirp', mergeFrequency: 880 }),
        `Gravitational-wave chirp rising to 880${NBSP}Hz, then ringdown`,
    );
});
