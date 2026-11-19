// AudioWorklet processor for the noise-like voices: pink disk hiss with a turbulent flicker, white
// jet hiss gated by knot pulses, and the tick trains of the two clocks, one per output. The file is
// loaded on its own by audioWorklet.addModule(), so it must not import anything; synthesis.js
// reuses its generators for the fallback noise. All randomness comes from one seeded generator,
// so the output is a pure function of the seed and the parameters.

export const PROCESSOR_NAME = 'black-hole-sonification';
export const OUTPUTS = Object.freeze(['disk', 'jet', 'tauTicks', 'tTicks']);
export const TICK_FREQUENCIES = Object.freeze({ tau: 1760, t: 880 });

// mulberry32 (Tommy Ettinger): a 32-bit state generator, uniform in [0, 1).
export function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Paul Kellet's refined pink-noise filter (music-dsp archive): a sum of one-pole low-passes of
// white noise giving -3 dB per octave above about 10 Hz at 44.1 kHz. Scaled to an RMS near 0.2.
export function createPinkNoise(random) {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    return () => {
        const white = random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        return pink * 0.11;
    };
}

// Slow random fluctuation with the variance of its input (1/3): white noise through a one-pole
// low-pass at `cutoff` Hz, rescaled because the filter multiplies the variance by k / (2 - k).
export function createFlicker(random, sampleRate, cutoff = 3) {
    const k = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    const norm = Math.sqrt((2 - k) / k);
    let y = 0;
    return () => {
        y += k * (random() * 2 - 1 - y);
        return y * norm;
    };
}

// Knot pulse `since` seconds after its start: 5 ms linear attack, then an exponential decay with
// time constant min(0.12 s, 0.3 / rate) so fast pulses stay separate.
export function pulseShape(since, rate) {
    const attack = 0.005;
    if (since < attack) return since / attack;
    return Math.exp(-(since - attack) / Math.min(0.12, 0.3 / rate));
}

export const TICK_LENGTH = 0.04;

// Clock tick `since` seconds after its start: a sine burst with 1 ms attack and 6 ms decay.
export function tickShape(since, frequency) {
    if (since >= TICK_LENGTH) return 0;
    const attack = since < 0.001 ? since / 0.001 : 1;
    return attack * Math.exp(-since / 0.006) * Math.sin(2 * Math.PI * frequency * since);
}

// Time since the last trigger of a train firing `rate` times per second, after a step dt.
export function advanceTrain(since, rate, dt) {
    const next = since + dt;
    if (!(rate > 0)) return next;
    const period = 1 / rate;
    return next >= period ? next % period : next;
}

const PARAMETERS = [
    ['turbulence', 1 / 3, 0, 1],
    ['pulseRate', 0, 0, 12],
    ['pulseDepth', 0.75, 0, 1],
    ['tauTickRate', 0, 0, 8],
    ['tTickRate', 0, 0, 30],
];

export const PARAMETER_NAMES = Object.freeze(PARAMETERS.map(([name]) => name));

const Processor = globalThis.AudioWorkletProcessor ?? class {};

export class SonificationProcessor extends Processor {
    static get parameterDescriptors() {
        return PARAMETERS.map(([name, defaultValue, minValue, maxValue]) => ({
            name,
            defaultValue,
            minValue,
            maxValue,
            automationRate: 'k-rate',
        }));
    }

    // processorOptions: { seed } and, outside an AudioWorkletGlobalScope, { sampleRate }.
    constructor(options = {}) {
        super();
        const { seed = 1, sampleRate = globalThis.sampleRate ?? 48000 } =
            options.processorOptions ?? {};
        const random = mulberry32(seed);
        this.dt = 1 / sampleRate;
        this.white = () => random() * 2 - 1;
        this.pink = createPinkNoise(random);
        this.flicker = createFlicker(random, sampleRate);
        this.pulseSince = 0;
        this.tauSince = 0;
        this.tSince = 0;
    }

    process(inputs, outputs, parameters) {
        const value = (name) => parameters[name]?.[0] ?? 0;
        const turbulence = value('turbulence');
        const pulseRate = value('pulseRate');
        const pulseDepth = value('pulseDepth');
        const tauRate = value('tauTickRate');
        const tRate = value('tTickRate');
        const [disk, jet, tauTicks, tTicks] = OUTPUTS.map((_, index) => outputs[index]?.[0]);
        const length = (disk ?? jet ?? tauTicks ?? tTicks)?.length ?? 0;
        const { dt } = this;

        for (let i = 0; i < length; i += 1) {
            const pink = this.pink();
            const flicker = Math.max(0, 1 + 0.9 * turbulence * this.flicker());
            const white = this.white();
            const pulse =
                pulseRate > 0
                    ? 1 - pulseDepth + pulseDepth * pulseShape(this.pulseSince, pulseRate)
                    : 1;
            if (disk) disk[i] = pink * flicker;
            if (jet) jet[i] = 0.5 * white * pulse;
            if (tauTicks)
                tauTicks[i] = tauRate > 0 ? tickShape(this.tauSince, TICK_FREQUENCIES.tau) : 0;
            if (tTicks) tTicks[i] = tRate > 0 ? tickShape(this.tSince, TICK_FREQUENCIES.t) : 0;
            this.pulseSince = advanceTrain(this.pulseSince, pulseRate, dt);
            this.tauSince = advanceTrain(this.tauSince, tauRate, dt);
            this.tSince = advanceTrain(this.tSince, tRate, dt);
        }
        return true;
    }
}

if (typeof globalThis.registerProcessor === 'function') {
    globalThis.registerProcessor(PROCESSOR_NAME, SonificationProcessor);
}
