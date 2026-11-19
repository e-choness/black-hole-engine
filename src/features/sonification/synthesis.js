// Deterministic sample buffers: gravitational-wave ringdowns and chirps rendered on demand, and
// loopable noise for browsers where the AudioWorklet does not load. Inputs come from
// ringdownVoiceParameters() and chirpVoiceParameters() in mapping.js.

import { chirpFrequency, chirpPhase } from './mapping.js';
import { createPinkNoise, mulberry32 } from './sonification.worklet.js';

// ln(1000): an exponential decay reaches -60 dB after this many e-folding times.
const DECAY_TO_SILENCE = Math.log(1000);

// Raised-cosine fade from 0 to 1 over `length` seconds.
function fadeIn(t, length) {
    return t >= length ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * t) / length);
}

export function normalizePeak(samples, peak) {
    let max = 0;
    for (const sample of samples) max = Math.max(max, Math.abs(sample));
    if (max > 0) {
        const scale = peak / max;
        for (let i = 0; i < samples.length; i += 1) samples[i] *= scale;
    }
    return samples;
}

function ringdownSample(modes, t) {
    let sum = 0;
    for (const mode of modes) {
        const phase = 2 * Math.PI * mode.frequency * t + (mode.phase ?? 0);
        sum += mode.amplitude * Math.exp(-t / mode.damping) * Math.cos(phase);
    }
    return sum;
}

function ringLength(modes) {
    return DECAY_TO_SILENCE * Math.max(...modes.map((mode) => mode.damping));
}

// Damped sinusoids h(t) = sum A_k exp(-t / tau_k) cos(2 pi f_k t + phi_k), from the merger until
// the longest mode is 60 dB down, with a short attack instead of an instantaneous (clicking) start.
export function renderRingdown({ sampleRate, modes, attack = 0.008, peak = 0.6 }) {
    const samples = new Float32Array(Math.ceil(ringLength(modes) * sampleRate));
    for (let i = 0; i < samples.length; i += 1) {
        const t = i / sampleRate;
        samples[i] = fadeIn(t, attack) * ringdownSample(modes, t);
    }
    return normalizePeak(samples, peak);
}

// Inspiral from tau = startTau down to mergeTau with amplitude proportional to f^(2/3) (Cutler &
// Flanagan 1994), then the ringdown modes. The first mode is the 220 mode at the chirp's final
// frequency and continues its phase, so the waveform has no jump; the overtones start from zero.
export function renderChirp({
    sampleRate,
    chirpMass,
    startTau,
    mergeTau,
    modes,
    attack = 0.05,
    peak = 0.6,
}) {
    const inspiral = Math.round((startTau - mergeTau) * sampleRate);
    const ring = modes.map((mode, index) => ({ ...mode, phase: index === 0 ? 0 : -Math.PI / 2 }));
    const samples = new Float32Array(inspiral + Math.ceil(ringLength(ring) * sampleRate));
    const mergeFrequency = chirpFrequency(mergeTau, chirpMass);
    const mergePhase = chirpPhase(mergeTau, chirpMass);
    for (let i = 0; i < samples.length; i += 1) {
        const t = i / sampleRate;
        if (i < inspiral) {
            const tau = startTau - t;
            const amplitude = (chirpFrequency(tau, chirpMass) / mergeFrequency) ** (2 / 3);
            const phase = chirpPhase(tau, chirpMass) - mergePhase;
            samples[i] = fadeIn(t, attack) * amplitude * Math.cos(phase);
        } else {
            samples[i] = ringdownSample(ring, (i - inspiral) / sampleRate);
        }
    }
    return normalizePeak(samples, peak);
}

// Seamlessly loopable noise: `crossfade` seconds of extra noise are blended into the start with
// equal-power weights (the two parts are uncorrelated), so the loop point does not thump.
export function renderNoise({
    kind = 'pink',
    seconds = 4,
    sampleRate,
    seed = 1,
    crossfade = 0.05,
}) {
    const random = mulberry32(seed);
    const next = kind === 'pink' ? createPinkNoise(random) : () => 0.5 * (random() * 2 - 1);
    const length = Math.round(seconds * sampleRate);
    const fade = Math.min(length, Math.round(crossfade * sampleRate));
    const raw = new Float32Array(length + fade);
    for (let i = 0; i < raw.length; i += 1) raw[i] = next();
    const samples = raw.slice(0, length);
    for (let i = 0; i < fade; i += 1) {
        const x = (0.5 * Math.PI * i) / fade;
        samples[i] = raw[i] * Math.sin(x) + raw[length + i] * Math.cos(x);
    }
    return samples;
}
