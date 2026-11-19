import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
    advanceTrain,
    createFlicker,
    createPinkNoise,
    mulberry32,
    OUTPUTS,
    PARAMETER_NAMES,
    PROCESSOR_NAME,
    pulseShape,
    SonificationProcessor,
    TICK_FREQUENCIES,
    TICK_LENGTH,
    tickShape,
} from '../../src/features/sonification/sonification.worklet.js';
import { assertClose } from './support/assert-close.js';

const RATE = 48000;
const BLOCK = 128;

// Runs the processor for `blocks` render quanta and returns the four outputs concatenated.
function render(processor, values, blocks) {
    const parameters = Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name, new Float32Array([value])]),
    );
    const channels = OUTPUTS.map(() => new Float32Array(blocks * BLOCK));
    for (let b = 0; b < blocks; b += 1) {
        const outputs = OUTPUTS.map(() => [new Float32Array(BLOCK)]);
        assert.equal(processor.process([], outputs, parameters), true);
        outputs.forEach(([channel], index) => channels[index].set(channel, b * BLOCK));
    }
    return Object.fromEntries(OUTPUTS.map((name, index) => [name, channels[index]]));
}

// Start indices of bursts separated by at least 10 ms of silence.
function bursts(samples) {
    const starts = [];
    let last = -Infinity;
    samples.forEach((sample, i) => {
        if (Math.abs(sample) > 1e-9) {
            if (i - last > 0.01 * RATE) starts.push(i);
            last = i;
        }
    });
    return starts;
}

afterEach(() => {
    delete globalThis.registerProcessor;
    delete globalThis.AudioWorkletProcessor;
    vi.resetModules();
});

test('mulberry32 is deterministic and uniform in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 20000 }, () => a());
    assert.deepEqual(
        values.slice(0, 5),
        Array.from({ length: 5 }, () => b()),
    );
    assert.ok(values.every((value) => value >= 0 && value < 1));
    assertClose(values.reduce((sum, value) => sum + value, 0) / values.length, 0.5, { abs: 0.01 });
    assert.notEqual(mulberry32(43)(), mulberry32(42)());
});

test('pink noise and flicker generators', () => {
    const pink = createPinkNoise(mulberry32(1));
    const samples = Array.from({ length: RATE }, () => pink());
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    assert.ok(rms > 0.1 && rms < 0.3, `pink RMS ${rms}`);
    assert.ok(samples.every((value) => Math.abs(value) < 1));

    const flicker = createFlicker(mulberry32(2), RATE);
    const slow = Array.from({ length: 20 * RATE }, () => flicker());
    const variance = slow.reduce((sum, value) => sum + value * value, 0) / slow.length;
    assertClose(variance, 1 / 3, { rel: 0.35 });
    let largest = 0;
    for (let i = 1; i < slow.length; i += 1) {
        largest = Math.max(largest, Math.abs(slow[i] - slow[i - 1]));
    }
    assert.ok(largest < 0.1, 'the flicker changes slowly');
});

test('pulse and tick shapes', () => {
    assert.equal(pulseShape(0, 2), 0);
    assertClose(pulseShape(0.0025, 2), 0.5);
    assert.equal(pulseShape(0.005, 2), 1);
    assertClose(pulseShape(0.125, 2), Math.exp(-1));
    assertClose(pulseShape(0.005 + 0.03, 10), Math.exp(-1));

    assert.equal(tickShape(0, 1000), 0);
    assert.equal(tickShape(TICK_LENGTH, 1000), 0);
    assertClose(tickShape(0.00025, 1000), 0.25 * Math.exp(-0.00025 / 0.006));
    assert.ok(Math.abs(tickShape(0.039, 880)) < 0.002);

    assertClose(advanceTrain(0.2, 4, 0.06), 0.01, { rel: 1e-9 });
    assert.equal(advanceTrain(5, 0, 0.5), 5.5);
    assertClose(advanceTrain(0.1, 2, 0.05), 0.15);
});

test('parameter descriptors are k-rate with sensible ranges', () => {
    const descriptors = SonificationProcessor.parameterDescriptors;
    assert.deepEqual(
        descriptors.map((d) => d.name),
        PARAMETER_NAMES,
    );
    for (const descriptor of descriptors) {
        assert.equal(descriptor.automationRate, 'k-rate');
        assert.ok(descriptor.minValue <= descriptor.defaultValue);
        assert.ok(descriptor.defaultValue <= descriptor.maxValue);
    }
    assert.deepEqual(OUTPUTS, ['disk', 'jet', 'tauTicks', 'tTicks']);
});

test('the processor output is a pure function of the seed and the parameters', () => {
    const options = { processorOptions: { seed: 7, sampleRate: RATE } };
    const values = { turbulence: 0, pulseRate: 0, pulseDepth: 0.75, tauTickRate: 0, tTickRate: 0 };
    const out = render(new SonificationProcessor(options), values, 40);
    assert.deepEqual(out, render(new SonificationProcessor(options), values, 40));
    assert.notDeepEqual(
        out.disk,
        render(
            new SonificationProcessor({ processorOptions: { seed: 8, sampleRate: RATE } }),
            values,
            40,
        ).disk,
    );

    // Without turbulence and pulses the outputs are the plain generators, drawn in the order
    // pink, flicker, white for every sample.
    const random = mulberry32(7);
    const pink = createPinkNoise(random);
    const flicker = createFlicker(random, RATE);
    for (let i = 0; i < out.disk.length; i += 1) {
        assert.equal(out.disk[i], Math.fround(pink()));
        flicker();
        assert.equal(out.jet[i], Math.fround(0.5 * (random() * 2 - 1)));
    }
    assert.ok(out.tauTicks.every((sample) => sample === 0));
    assert.ok(out.tTicks.every((sample) => sample === 0));
});

test('turbulence makes the disk hiss flicker', () => {
    const options = { processorOptions: { seed: 5, sampleRate: RATE } };
    const calm = render(new SonificationProcessor(options), { turbulence: 0 }, 750).disk;
    const rough = render(new SonificationProcessor(options), { turbulence: 1 }, 750).disk;
    const envelope = (samples) => {
        const blocks = [];
        for (let i = 0; i < samples.length; i += 2400) {
            let sum = 0;
            for (let j = i; j < i + 2400; j += 1) sum += samples[j] ** 2;
            blocks.push(Math.sqrt(sum / 2400));
        }
        const mean = blocks.reduce((a, b) => a + b, 0) / blocks.length;
        return Math.sqrt(blocks.reduce((a, b) => a + (b - mean) ** 2, 0) / blocks.length) / mean;
    };
    assert.ok(envelope(rough) > 2 * envelope(calm));
    assert.ok(rough.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 4));
});

test('knot pulses gate the jet hiss at the pulse rate', () => {
    const processor = new SonificationProcessor({
        processorOptions: { seed: 9, sampleRate: RATE },
    });
    const { jet } = render(processor, { pulseRate: 2, pulseDepth: 1 }, 800);
    const energy = (from, to) => {
        let sum = 0;
        for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i += 1) sum += jet[i] ** 2;
        return sum;
    };
    for (const start of [0, 0.5, 1, 1.5]) {
        assert.ok(energy(start + 0.005, start + 0.05) > 20 * energy(start + 0.4, start + 0.45));
    }
});

test('clock ticks fire at their rates and pitches', () => {
    const processor = new SonificationProcessor({
        processorOptions: { seed: 1, sampleRate: RATE },
    });
    const out = render(processor, { tauTickRate: 1, tTickRate: 4 }, 700);
    assert.deepEqual(
        bursts(out.tauTicks).map((i) => Math.round((i / RATE) * 100) / 100),
        [0, 1],
    );
    assert.deepEqual(
        bursts(out.tTicks).map((i) => Math.round((i / RATE) * 100) / 100),
        [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75],
    );
    const crossings = (samples, from, to) => {
        let count = 0;
        for (let i = from + 1; i < to; i += 1)
            if (samples[i - 1] < 0 && samples[i] >= 0) count += 1;
        return count;
    };
    const window = Math.round(0.01 * RATE);
    assertClose(crossings(out.tauTicks, 0, window), TICK_FREQUENCIES.tau * 0.01, { abs: 1 });
    assertClose(crossings(out.tTicks, 0, window), TICK_FREQUENCIES.t * 0.01, { abs: 1 });
});

test('missing outputs are skipped', () => {
    const processor = new SonificationProcessor({ processorOptions: { sampleRate: RATE } });
    const disk = new Float32Array(BLOCK);
    assert.equal(processor.process([], [[disk]], {}), true);
    assert.ok(disk.some((sample) => sample !== 0));
    assert.equal(processor.process([], [], {}), true);
});

test('loading the module in an AudioWorkletGlobalScope registers the processor', async () => {
    vi.resetModules();
    class Base {}
    globalThis.AudioWorkletProcessor = Base;
    globalThis.registerProcessor = vi.fn();
    globalThis.sampleRate = RATE;
    try {
        const module = await import('../../src/features/sonification/sonification.worklet.js');
        assert.equal(globalThis.registerProcessor.mock.calls.length, 1);
        const [name, processor] = globalThis.registerProcessor.mock.calls[0];
        assert.equal(name, PROCESSOR_NAME);
        assert.equal(processor, module.SonificationProcessor);
        assert.ok(new processor() instanceof Base);
        assert.equal(new processor().dt, 1 / RATE);
    } finally {
        delete globalThis.sampleRate;
    }
});
