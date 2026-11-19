import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
    normalizePeak,
    renderChirp,
    renderNoise,
    renderRingdown,
} from '../../src/features/sonification/synthesis.js';
import {
    chirpFrequency,
    chirpVoiceParameters,
    ringdownVoiceParameters,
} from '../../src/features/sonification/mapping.js';
import {
    createPinkNoise,
    mulberry32,
} from '../../src/features/sonification/sonification.worklet.js';
import { assertClose } from './support/assert-close.js';

const RATE = 48000;
const SGR_A = { massSolar: 4.297e6, spin: 0.9 };

// Mean frequency from upward zero crossings between `from` and `to` seconds.
function zeroCrossingFrequency(samples, from, to) {
    const crossings = [];
    const end = Math.min(samples.length, Math.round(to * RATE));
    for (let i = Math.max(1, Math.round(from * RATE)); i < end; i += 1) {
        const a = samples[i - 1];
        const b = samples[i];
        if (a < 0 && b >= 0) crossings.push(i - 1 + a / (a - b));
    }
    return ((crossings.length - 1) * RATE) / (crossings.at(-1) - crossings[0]);
}

function rms(samples, from, to) {
    let sum = 0;
    const start = Math.round(from * RATE);
    const end = Math.round(to * RATE);
    for (let i = start; i < end; i += 1) sum += samples[i] ** 2;
    return Math.sqrt(sum / (end - start));
}

function peak(samples) {
    return samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
}

// In-place radix-2 FFT of real input; returns the power spectrum of the first half.
function powerSpectrum(input) {
    const n = input.length;
    const re = Float64Array.from(input);
    const im = new Float64Array(n);
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let size = 2; size <= n; size <<= 1) {
        const angle = (-2 * Math.PI) / size;
        for (let start = 0; start < n; start += size) {
            for (let k = 0; k < size / 2; k += 1) {
                const cos = Math.cos(angle * k);
                const sin = Math.sin(angle * k);
                const a = start + k;
                const b = a + size / 2;
                const tr = re[b] * cos - im[b] * sin;
                const ti = re[b] * sin + im[b] * cos;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
    return Array.from({ length: n / 2 }, (_, k) => re[k] ** 2 + im[k] ** 2);
}

test('peak normalization', () => {
    assert.deepEqual(Array.from(normalizePeak(new Float32Array([0.5, -2, 1]), 0.6)), [
        Math.fround(0.15),
        Math.fround(-0.6),
        Math.fround(0.3),
    ]);
    assert.deepEqual(Array.from(normalizePeak(new Float32Array(3), 0.6)), [0, 0, 0]);
});

test('a ringdown rings at its frequency, decays at its damping time and starts softly', () => {
    const samples = renderRingdown({
        sampleRate: RATE,
        modes: [{ frequency: 440, damping: 0.1, amplitude: 1 }],
    });
    assert.equal(samples.length, Math.ceil(Math.log(1000) * 0.1 * RATE));
    assertClose(peak(samples), 0.6, { rel: 1e-6 });
    assert.equal(samples[0], 0);
    assert.ok(Math.abs(samples[1]) < 1e-3);
    assert.ok(Math.abs(samples.at(-1)) < 1e-3);
    assertClose(zeroCrossingFrequency(samples, 0.01, 0.2), 440, { rel: 1e-4 });
    assertClose(rms(samples, 0.15, 0.2) / rms(samples, 0.05, 0.1), Math.exp(-1), { rel: 0.01 });
});

test('the synthesized ringdown of a black hole is deterministic and lasts until -60 dB', () => {
    const { modes } = ringdownVoiceParameters(SGR_A);
    const first = renderRingdown({ sampleRate: RATE, modes });
    const second = renderRingdown({ sampleRate: RATE, modes });
    assert.deepEqual(first, second);
    const longest = Math.max(...modes.map((mode) => mode.damping));
    assert.equal(first.length, Math.ceil(Math.log(1000) * longest * RATE));
    assert.ok(first.every(Number.isFinite));
    // The 221 overtone dies out after a few of its damping times, leaving the 220 and 330 modes.
    assertClose(zeroCrossingFrequency(first, 1, 1.2), modes[0].frequency, { rel: 0.02 });
});

test('a chirp follows the inspiral law, then rings down without a jump', () => {
    const p = chirpVoiceParameters(SGR_A, { duration: 1 });
    const samples = renderChirp({ sampleRate: RATE, ...p, modes: p.ringdown.modes });
    const junction = Math.round((p.startTau - p.mergeTau) * RATE);
    const ringing = Math.ceil(Math.log(1000) * p.ringdown.modes[0].damping * RATE);
    assert.equal(samples.length, junction + ringing);
    assertClose(peak(samples), 0.6, { rel: 1e-6 });
    assert.equal(Math.abs(samples[0]), 0);
    assert.ok(Math.abs(samples.at(-1)) < 1e-3);
    assert.ok(samples.every(Number.isFinite));

    for (const t of [0.2, 0.5, 0.8]) {
        const expected = chirpFrequency(p.startTau - t, p.chirpMass);
        assertClose(zeroCrossingFrequency(samples, t - 0.01, t + 0.01), expected, { rel: 0.01 });
    }
    assert.ok(rms(samples, 0.85, 0.95) > 1.5 * rms(samples, 0.1, 0.2));

    const steps = [];
    for (let i = junction - 100; i < junction; i += 1)
        steps.push(Math.abs(samples[i] - samples[i - 1]));
    const largest = Math.max(...steps);
    assert.ok(Math.abs(samples[junction] - samples[junction - 1]) < 1.5 * largest);
    assertClose(
        zeroCrossingFrequency(samples, junction / RATE, junction / RATE + 0.02),
        p.mergeFrequency,
        {
            rel: 0.01,
        },
    );
    assert.deepEqual(samples, renderChirp({ sampleRate: RATE, ...p, modes: p.ringdown.modes }));
});

test('fallback noise loops seamlessly and has the right colour', () => {
    const seconds = 2;
    const fade = Math.round(0.05 * RATE);
    const pink = renderNoise({ kind: 'pink', seconds, sampleRate: RATE, seed: 3 });
    const length = seconds * RATE;
    assert.equal(pink.length, length);

    // Reproduce the raw stream: the loop point continues it, and the crossfade blends the
    // overhang into the start with equal-power weights.
    const next = createPinkNoise(mulberry32(3));
    const raw = Array.from({ length: length + fade }, () => next());
    assert.equal(pink[0], Math.fround(raw[length]));
    assert.equal(pink[length - 1], Math.fround(raw[length - 1]));
    assert.equal(pink[fade], Math.fround(raw[fade]));
    const x = Math.PI / 4;
    assertClose(
        pink[fade / 2],
        raw[fade / 2] * Math.sin(x) + raw[length + fade / 2] * Math.cos(x),
        {
            rel: 1e-6,
        },
    );

    // Pink: the power spectral density falls by 3 dB per octave.
    const size = 2048;
    const spectrum = new Array(size / 2).fill(0);
    for (let start = 0; start + size <= length; start += size) {
        const segment = Array.from(
            pink.subarray(start, start + size),
            (value, i) => value * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)),
        );
        powerSpectrum(segment).forEach((power, k) => (spectrum[k] += power));
    }
    const band = (centre) => {
        const lo = Math.round((centre / Math.SQRT2 / RATE) * size);
        const hi = Math.round(((centre * Math.SQRT2) / RATE) * size);
        return spectrum.slice(lo, hi).reduce((a, b) => a + b, 0) / (hi - lo);
    };
    const centres = [250, 500, 1000, 2000, 4000];
    const levels = centres.map((centre) => 10 * Math.log10(band(centre)));
    const slope = (levels.at(-1) - levels[0]) / Math.log2(centres.at(-1) / centres[0]);
    assertClose(slope, -3, { abs: 0.5 });

    const white = renderNoise({ kind: 'white', seconds, sampleRate: RATE, seed: 4 });
    assert.ok(peak(white) <= 0.5 * Math.SQRT2);
    assertClose(rms(white, 0.1, 1.9), 0.5 / Math.sqrt(3), { rel: 0.02 });
    assert.deepEqual(white, renderNoise({ kind: 'white', seconds, sampleRate: RATE, seed: 4 }));
    assert.notDeepEqual(white, renderNoise({ kind: 'white', seconds, sampleRate: RATE, seed: 5 }));
});
