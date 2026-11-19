import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
    createSonificationEngine,
    ENGINE_STATUSES,
    GRAVITATIONAL_WAVE_KINDS,
    VOICES,
} from '../../src/features/sonification/engine.js';
import {
    ringdownVoiceParameters,
    sonificationParameters,
} from '../../src/features/sonification/mapping.js';
import { PROCESSOR_NAME } from '../../src/features/sonification/sonification.worklet.js';
import * as barrel from '../../src/features/sonification/index.js';
import { iscoRadius, keplerAngularVelocity } from '../../src/features/units/kerr.js';
import { NBSP } from '../../src/features/units/format.js';
import { assertClose } from './support/assert-close.js';
import {
    createFakeAudio,
    createFakeDocument,
    nodesOfKind,
    pathToDestination,
} from './support/fake-audio.js';

const SGR_A = { massSolar: 4.297e6, spin: 0.9 };

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

async function flush() {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function setup(options = {}) {
    const audio = createFakeAudio();
    const documentRef = createFakeDocument();
    const navigatorRef = { audioSession: { type: 'auto' } };
    let clock = 1000;
    const engine = createSonificationEngine({
        AudioContextClass: audio.AudioContext,
        AudioWorkletNodeClass: audio.AudioWorkletNode,
        workletUrl: '/assets/sonification.worklet.js',
        documentRef,
        navigatorRef,
        now: () => clock,
        ...options,
    });
    const events = [];
    engine.subscribe((event) => events.push(event));
    return {
        audio,
        documentRef,
        navigatorRef,
        engine,
        events,
        advance(ms) {
            clock += ms;
        },
        get context() {
            return audio.contexts[0];
        },
    };
}

// The graph in creation order: master gain first, then one gain per voice feeding its meter.
function graphOf(context) {
    const gains = nodesOfKind(context, 'gain');
    const analysers = nodesOfKind(context, 'analyser');
    const voices = gains.filter(
        (gain) => gain.connections[0]?.destination.kind === 'analyser' && gain !== gains[0],
    );
    return {
        master: gains[0],
        masterMeter: analysers[0],
        voices: Object.fromEntries(VOICES.map((name, i) => [name, voices[i]])),
        meters: Object.fromEntries(VOICES.map((name, i) => [name, analysers[i + 1]])),
    };
}

test('nothing touches Web Audio before a gesture', () => {
    const { audio, engine } = setup();
    engine.update(SGR_A);
    engine.setVolume(0.8);
    engine.setVoice('jet', { muted: true });
    assert.equal(engine.getLegend().length, 4);
    assert.equal(engine.getParameters().disk.octaves, 18);
    assert.deepEqual(engine.getCaptions(), []);
    assert.equal(engine.getMeters(), null);
    assert.equal(engine.triggerGravitationalWave(), null);
    assert.equal(engine.disable().status, 'off');
    assert.equal(audio.contexts.length, 0);
    const state = engine.state;
    assert.equal(state.status, 'off');
    assert.equal(state.enabled, false);
    assert.equal(state.volume, 0.8);
    assert.equal(state.voices.jet.muted, true);
    assert.equal(state.worklet, null);
    assert.equal(state.sampleRate, null);
    assert.ok(Object.isFrozen(state) && Object.isFrozen(state.voices));
    assert.ok(ENGINE_STATUSES.includes(state.status));
});

test('enable() creates and resumes the context synchronously, then fades in', async () => {
    const env = setup();
    const { engine, events, navigatorRef } = env;
    const started = engine.enable();
    const { context } = env;
    assert.deepEqual(context.calls, ['resume']);
    assert.deepEqual(context.options, { latencyHint: 'interactive' });
    assert.equal(navigatorRef.audioSession.type, 'playback');
    assert.equal(engine.state.status, 'starting');
    assert.equal(engine.enable(), started);

    const state = await started;
    assert.equal(state.status, 'running');
    assert.equal(state.enabled, true);
    assert.equal(state.worklet, true);
    assert.equal(state.sampleRate, 48000);
    assert.deepEqual(
        events.filter((e) => e.type === 'state').map((e) => e.state.status),
        ['starting', 'running'],
    );
    assert.deepEqual(context.audioWorklet.modules, ['/assets/sonification.worklet.js']);

    const [worklet] = nodesOfKind(context, 'worklet');
    assert.equal(worklet.name, PROCESSOR_NAME);
    assert.equal(worklet.options.numberOfInputs, 0);
    assert.equal(worklet.options.numberOfOutputs, 4);
    assert.deepEqual(worklet.options.outputChannelCount, [1, 1, 1, 1]);
    assert.deepEqual(worklet.options.processorOptions, { seed: 1 });
    assert.deepEqual(
        worklet.connections.map((c) => [c.output, c.destination.kind]),
        [
            [0, 'biquad'],
            [1, 'biquad'],
            [2, 'gain'],
            [3, 'gain'],
        ],
    );

    const graph = graphOf(context);
    assert.equal(graph.master.gain.value, 0);
    assert.equal(graph.master.gain.target, 0.25);
    assert.equal(graph.master.gain.events.at(-1).timeConstant, 0.1);
    assert.deepEqual(pathToDestination(graph.master), [
        'gain',
        'biquad',
        'compressor',
        'analyser',
        'destination',
    ]);
    const [highpass] = nodesOfKind(context, 'biquad');
    assert.equal(highpass.type, 'highpass');
    assert.equal(highpass.frequency.value, 30);
    const [limiter] = nodesOfKind(context, 'compressor');
    assert.equal(limiter.threshold.value, -6);
    assert.equal(limiter.ratio.value, 20);
    assert.equal(limiter.knee.value, 0);

    for (const oscillator of nodesOfKind(context, 'oscillator')) {
        assert.equal(oscillator.startedAt, 0);
        assert.deepEqual(pathToDestination(oscillator), [
            'oscillator',
            'gain',
            'gain',
            'analyser',
            'gain',
            'biquad',
            'compressor',
            'analyser',
            'destination',
        ]);
    }

    assert.equal((await engine.enable()).status, 'running');
    assert.equal(context.calls.filter((call) => call === 'resume').length, 1);
});

test('update() maps the simulation state at most 30 times per second', async () => {
    const env = setup();
    const { engine } = env;
    await engine.enable();
    const [oscillator] = nodesOfKind(env.context, 'oscillator');
    const [worklet] = nodesOfKind(env.context, 'worklet');
    const state = { ...SGR_A, inclination: 0, jet: { enabled: true, viewingAngle: 0.4 } };

    env.advance(100);
    engine.update(state);
    const expected = sonificationParameters(state);
    assert.equal(oscillator.frequency.target, expected.disk.partials[0].frequency);
    assert.equal(worklet.parameters.get('pulseRate').target, expected.jet.pulseRate);
    assert.equal(worklet.parameters.get('tauTickRate').target, expected.clock.tau);
    assert.equal(worklet.parameters.get('turbulence').target, expected.disk.noise.turbulence);
    const applied = oscillator.frequency.events.length;

    for (let i = 0; i < 5; i += 1) {
        env.advance(2);
        engine.update({ ...state, observerShift: 1 + i / 4 });
    }
    assert.equal(oscillator.frequency.events.length, applied);
    vi.advanceTimersByTime(35);
    const latest = sonificationParameters({ ...state, observerShift: 2 });
    assert.equal(oscillator.frequency.target, latest.disk.partials[0].frequency);
    assert.equal(oscillator.frequency.events.length, applied + 2);
    assert.equal(oscillator.frequency.events.at(-1).timeConstant, 0.05);

    env.advance(100);
    engine.update({ ...state, disk: { tone: 'qpo' } });
    const gains = nodesOfKind(env.context, 'oscillator').map(
        (osc) => osc.connections[0].destination,
    );
    assert.ok(gains.every((gain) => gain.gain.target > 0));
    env.advance(100);
    engine.update(state);
    assert.equal(gains[1].gain.target, 0);
});

test('volume, mute and solo drive the master and voice gains', async () => {
    const env = setup({ voices: { clock: { level: 0.5 } } });
    const { engine } = env;
    await engine.enable();
    const graph = graphOf(env.context);
    const targets = () => VOICES.map((name) => graph.voices[name].gain.target);
    assert.deepEqual(targets(), [1, 1, 1, 0.25]);

    assert.equal(engine.setVolume(0.8), 0.8);
    assertClose(graph.master.gain.target, 0.64);
    assert.equal(engine.setVolume(3), 1);
    assert.equal(graph.master.gain.target, 1);

    engine.setVoice('jet', { muted: true });
    assert.deepEqual(targets(), [1, 0, 1, 0.25]);
    engine.setVoice('disk', { solo: true });
    assert.deepEqual(targets(), [1, 0, 0, 0]);
    const disk = engine.setVoice('disk', { solo: false, level: 0.5 });
    assert.deepEqual(disk, { level: 0.5, muted: false, solo: false });
    assert.deepEqual(targets(), [0.25, 0, 1, 0.25]);
    assert.equal(engine.state.voices.jet.muted, true);
    assert.throws(() => engine.setVoice('choir', {}), RangeError);
});

test('disable() fades out before suspending; enable() resumes the same context', async () => {
    const env = setup();
    const { engine } = env;
    await engine.enable();
    const { context } = env;
    const graph = graphOf(context);

    assert.equal(engine.disable().status, 'off');
    assert.equal(graph.master.gain.target, 0);
    assert.ok(!context.calls.includes('suspend'));
    vi.advanceTimersByTime(250);
    assert.equal(context.calls.at(-1), 'suspend');

    const resumed = await engine.enable();
    assert.equal(resumed.status, 'running');
    assert.equal(env.audio.contexts.length, 1);
    assert.equal(graph.master.gain.target, 0.25);

    engine.disable();
    const again = engine.enable();
    vi.advanceTimersByTime(1000);
    await again;
    assert.equal(context.calls.filter((call) => call === 'suspend').length, 1);
    assert.equal(engine.state.status, 'running');
});

test('a hidden tab suspends the context and a visible one resumes it', async () => {
    const env = setup();
    const { engine, documentRef } = env;
    documentRef.setVisibility('hidden');
    assert.equal(env.audio.contexts.length, 0);
    documentRef.setVisibility('visible');

    await engine.enable();
    documentRef.setVisibility('hidden');
    assert.equal(engine.state.status, 'suspended');
    assert.equal(engine.state.reason, 'hidden');
    assert.equal(env.context.calls.at(-1), 'suspend');
    documentRef.setVisibility('visible');
    await flush();
    assert.equal(engine.state.status, 'running');
    assert.equal(engine.state.reason, null);

    engine.disable();
    documentRef.setVisibility('hidden');
    documentRef.setVisibility('visible');
    await flush();
    assert.equal(engine.state.status, 'off');
});

test('blocked autoplay waits for a gesture instead of playing', async () => {
    const env = setup();
    const { engine, audio } = env;
    audio.behavior.resume = 'pending';
    const started = engine.enable();
    await vi.advanceTimersByTimeAsync(1500);
    const state = await started;
    assert.equal(state.status, 'suspended');
    assert.equal(state.reason, 'needs-gesture');
    const graph = graphOf(env.context);
    assert.equal(graph.master.gain.target, 0);

    // A later gesture anywhere lets the pending resume() through.
    env.context.setState('running');
    await flush();
    assert.equal(engine.state.status, 'running');
    assert.equal(graph.master.gain.target, 0.25);

    const blocked = setup();
    blocked.audio.behavior.resume = 'reject';
    assert.equal((await blocked.engine.enable()).reason, 'needs-gesture');
    blocked.audio.behavior.resume = 'resolve';
    assert.equal((await blocked.engine.enable()).status, 'running');
});

test('without the AudioWorklet the noise comes from looped buffers', async () => {
    const blocked = setup();
    blocked.audio.behavior.addModule = 'reject';
    const missing = setup({ AudioWorkletNodeClass: null });
    for (const env of [blocked, missing]) {
        const state = await env.engine.enable();
        assert.equal(state.status, 'running');
        assert.equal(state.worklet, false);
        assert.equal(nodesOfKind(env.context, 'worklet').length, 0);
        const sources = nodesOfKind(env.context, 'buffer-source');
        assert.equal(sources.length, 2);
        for (const source of sources) {
            assert.equal(source.loop, true);
            assert.equal(source.startedAt, 0);
            assert.equal(source.buffer.length, 4 * 48000);
            assert.equal(source.connections[0].destination.type, 'lowpass');
        }
    }
});

test('unsupported browsers and failing devices report their state', async () => {
    const unsupported = createSonificationEngine({
        AudioContextClass: null,
        documentRef: createFakeDocument(),
    });
    assert.equal(unsupported.state.status, 'unsupported');
    assert.equal((await unsupported.enable()).status, 'unsupported');
    assert.equal(unsupported.disable().status, 'unsupported');

    const env = setup();
    env.audio.behavior.create = 'throw';
    const state = await env.engine.enable();
    assert.equal(state.status, 'error');
    assert.equal(state.error, 'no audio output device');
    assert.equal(state.enabled, false);
    env.audio.behavior.create = 'ok';
    assert.equal((await env.engine.enable()).status, 'running');
    assert.equal(env.engine.state.error, null);
});

test('gravitational-wave events play once, replace each other and are captioned', async () => {
    const env = setup();
    const { engine, events } = env;
    await engine.enable();
    engine.update(SGR_A);

    const ringdown = engine.triggerGravitationalWave();
    const expected = ringdownVoiceParameters(SGR_A);
    assert.equal(ringdown.kind, 'ringdown');
    assert.equal(ringdown.frequency, expected.modes[0].frequency);
    assert.equal(ringdown.stretch, expected.stretch);
    assert.ok(Object.isFrozen(ringdown));
    const [first] = nodesOfKind(env.context, 'buffer-source');
    assert.equal(first.startedAt, 0);
    assert.equal(first.buffer.length / 48000, ringdown.duration);
    const shotGain = first.connections[0].destination;
    assert.equal(shotGain.connections[0].destination, graphOf(env.context).voices.gw);
    assert.deepEqual(events.at(-1), {
        type: 'caption',
        caption: { key: 'gw', text: `Gravitational-wave ringdown at 1.31${NBSP}kHz`, time: 1000 },
    });

    const chirp = engine.triggerGravitationalWave({ kind: 'chirp', duration: 1 });
    assert.equal(chirp.kind, 'chirp');
    assert.equal(chirp.mergeFrequency, ringdown.frequency);
    assertClose(chirp.startFrequency, ringdown.frequency / 8);
    assert.ok(chirp.duration > 1);
    assert.equal(shotGain.gain.target, 0);
    assert.ok(first.stoppedAt > 0);
    assert.equal(events.at(-1).caption.key, 'gw');
    assert.equal(engine.getCaptions().length, 2);

    first.onended();
    assert.ok(first.disconnected && shotGain.disconnected);
    assert.throws(() => engine.triggerGravitationalWave({ kind: 'merger' }), RangeError);
    assert.deepEqual(GRAVITATIONAL_WAVE_KINDS, ['ringdown', 'chirp']);
});

test('meters report the RMS level of each voice and of the output', async () => {
    const env = setup();
    await env.engine.enable();
    const graph = graphOf(env.context);
    graph.masterMeter.signal = 0.1;
    graph.meters.disk.signal = 1;
    const meters = env.engine.getMeters();
    assertClose(meters.master.rms, 0.1, { rel: 1e-6 });
    assertClose(meters.master.level, 2 / 3, { rel: 1e-6 });
    assert.deepEqual(meters.disk, { rms: 1, level: 1 });
    assert.deepEqual(meters.jet, { rms: 0, level: 0 });
    assert.deepEqual(Object.keys(meters), ['master', ...VOICES]);
});

test('captions follow the parameters and are rate-limited per key', async () => {
    const env = setup();
    const { engine } = env;
    await engine.enable();
    const omega = keplerAngularVelocity(iscoRadius(0.9), 0.9);
    const at = (phase) => ({ ...SGR_A, unit: 'M', simTime: phase / omega });
    const captions = () =>
        env.events.filter((e) => e.type === 'caption').map((e) => e.caption.text);

    for (const phase of [1.5, 1.7, 4.6, 4.8]) {
        env.advance(100);
        engine.update(at(phase));
    }
    assert.deepEqual(captions(), ['Hot-spot tone falling: receding side']);
    env.advance(5000);
    engine.update(at(1.5));
    env.advance(100);
    engine.update(at(1.7));
    assert.deepEqual(captions(), [
        'Hot-spot tone falling: receding side',
        'Hot-spot tone falling: receding side',
    ]);
    assert.deepEqual(
        engine.getCaptions().map((caption) => caption.time),
        [1200, 6500],
    );
});

test('reading the legend between updates does not swallow captions', async () => {
    const env = setup();
    const { engine } = env;
    await engine.enable();
    const omega = keplerAngularVelocity(iscoRadius(0.9), 0.9);
    const at = (phase) => ({ ...SGR_A, unit: 'M', simTime: phase / omega });
    env.advance(100);
    engine.update(at(1.5));
    env.advance(5);
    engine.update(at(1.7));
    assert.equal(engine.getLegend()[0].voice, 'disk');
    vi.advanceTimersByTime(40);
    assert.deepEqual(
        engine.getCaptions().map((caption) => caption.text),
        ['Hot-spot tone falling: receding side'],
    );
});

test('interruptions are reported and recovered', async () => {
    const env = setup();
    await env.engine.enable();
    env.context.setState('interrupted');
    await flush();
    assert.equal(env.engine.state.status, 'suspended');
    assert.equal(env.engine.state.reason, 'interrupted');
    env.context.setState('running');
    await flush();
    assert.equal(env.engine.state.status, 'running');
});

test('dispose() closes the context and stops listening', async () => {
    const env = setup();
    const { engine, documentRef } = env;
    await engine.enable();
    const { context } = env;
    const count = env.events.length;
    engine.dispose();
    assert.equal(context.calls.at(-1), 'close');
    assert.equal(documentRef.listeners.get('visibilitychange').size, 0);
    assert.equal(context.listeners.get('statechange').size, 0);
    assert.equal(engine.state.status, 'off');
    assert.equal(env.events.length, count + 1);

    assert.equal((await engine.enable()).status, 'off');
    assert.equal(env.audio.contexts.length, 1);
    engine.update(SGR_A);
    assert.equal(engine.triggerGravitationalWave(), null);
    assert.equal(engine.getMeters(), null);
    engine.dispose();
    assert.equal(env.events.length, count + 1);
});

test('the barrel re-exports the sonification modules', () => {
    for (const name of [
        'createSonificationEngine',
        'sonificationParameters',
        'describeSonification',
        'renderChirp',
        'renderRingdown',
        'cameraFrequencyShift',
    ]) {
        assert.equal(typeof barrel[name], 'function', name);
    }
});
