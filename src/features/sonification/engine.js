// Web Audio engine for the sonification voices. It is silent and creates no AudioContext until
// enable() runs inside a user gesture: autoplay policies block audio before user activation, and a
// shared link must never start sound. Parameters come from mapping.js at most 30 times per second
// and reach the graph only as AudioParam automation with setTargetAtTime, so nothing clicks and no
// JavaScript runs per sample on the main thread.
//
// Graph: each voice (disk, jet, gravitational waves, clock ticks) feeds a voice gain (level, mute,
// solo) and an analyser for its meter, then the master gain (volume^2), a 30 Hz high-pass that
// keeps sub-bass out of small speakers, and a DynamicsCompressor set up as a limiter.

import {
    chirpVoiceParameters,
    describeSonification,
    gravitationalWaveCaption,
    masterGain,
    normalizeSonificationState,
    ringdownVoiceParameters,
    sonificationCaptions,
    sonificationParameters,
} from './mapping.js';
import { renderChirp, renderNoise, renderRingdown } from './synthesis.js';
import { OUTPUTS, PROCESSOR_NAME } from './sonification.worklet.js';
import WORKLET_URL from './sonification.worklet.js?url&no-inline';

export const VOICES = Object.freeze(['disk', 'jet', 'gw', 'clock']);
export const GRAVITATIONAL_WAVE_KINDS = Object.freeze(['ringdown', 'chirp']);
export const ENGINE_STATUSES = Object.freeze([
    'off',
    'starting',
    'running',
    'suspended',
    'unsupported',
    'error',
]);

const DEFAULT_VOICE_LEVELS = Object.freeze({ disk: 1, jet: 1, gw: 1, clock: 0.8 });

// Linear gains of the sources inside their voices, balanced with the meters so that the voices
// peak within about 10 dB of each other; the limiter only catches what is left.
const SOURCE_GAINS = Object.freeze({
    diskNoise: 0.5,
    diskTone: 0.12,
    jet: 0.8,
    gw: 0.7,
    tick: 0.6,
});

const UPDATE_INTERVAL = 1000 / 30;
const SMOOTHING = 0.05;
const MASTER_FADE = 0.1;
const STOP_FADE = 0.03;
const SUSPEND_DELAY = 250;
const CAPTION_INTERVAL = 4000;
const CAPTION_HISTORY = 5;
const PARTIAL_SLOTS = 3;

const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

function normalizeVoice(current, settings = {}) {
    return Object.freeze({
        level: settings.level === undefined ? current.level : clamp01(settings.level),
        muted: settings.muted === undefined ? current.muted : Boolean(settings.muted),
        solo: settings.solo === undefined ? current.solo : Boolean(settings.solo),
    });
}

// The environment can be injected (tests pass fakes): AudioContextClass, AudioWorkletNodeClass,
// workletUrl, documentRef, navigatorRef, now() in milliseconds, timers ({ setTimeout,
// clearTimeout }) and startTimeout, the milliseconds to wait for resume(). The initial volume
// (0..1), voices ({ disk: { level, muted, solo }, ... }) and the noise seed can be set too.
export function createSonificationEngine({
    AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
    AudioWorkletNodeClass = globalThis.AudioWorkletNode,
    workletUrl = WORKLET_URL,
    documentRef = globalThis.document,
    navigatorRef = globalThis.navigator,
    now = () => globalThis.performance.now(),
    timers = globalThis,
    startTimeout = 1500,
    volume = 0.5,
    voices = {},
    seed = 1,
} = {}) {
    const listeners = new Set();
    const voiceSettings = {};
    for (const name of VOICES) {
        voiceSettings[name] = normalizeVoice(
            { level: DEFAULT_VOICE_LEVELS[name], muted: false, solo: false },
            voices[name],
        );
    }
    let status = AudioContextClass ? 'off' : 'unsupported';
    let reason = null;
    let error = null;
    let enabled = false;
    let disposed = false;
    let masterVolume = clamp01(volume);
    let context = null;
    let graph = null;
    let worklet = null;
    let startPromise = null;
    let suspendTimer = null;
    let trailingTimer = null;
    let lastApplied = -Infinity;
    let simulation = normalizeSonificationState();
    let parameters = null;
    let parametersStale = true;
    // Parameters at the last update that reached the graph; captions describe changes from them.
    let appliedParameters = null;
    let gwShot = null;
    const captionTimes = new Map();
    const captions = [];

    function getState() {
        return Object.freeze({
            status,
            reason,
            enabled,
            volume: masterVolume,
            voices: Object.freeze({ ...voiceSettings }),
            worklet,
            error,
            sampleRate: context?.sampleRate ?? null,
        });
    }

    function emit(event) {
        for (const listener of [...listeners]) listener(event);
    }

    function setStatus(next, nextReason = null) {
        if (status === next && reason === nextReason) return;
        status = next;
        reason = nextReason;
        emit({ type: 'state', state: getState() });
    }

    function currentParameters() {
        if (parametersStale || !parameters) {
            parameters = sonificationParameters(simulation);
            parametersStale = false;
        }
        return parameters;
    }

    function setTarget(param, value, timeConstant = SMOOTHING) {
        param.cancelScheduledValues(context.currentTime);
        param.setTargetAtTime(value, context.currentTime, timeConstant);
    }

    function voiceGain(name) {
        const settings = voiceSettings[name];
        const soloed = VOICES.some((voice) => voiceSettings[voice].solo);
        if (settings.muted || (soloed && !settings.solo)) return 0;
        return settings.level * settings.level;
    }

    function applyVoiceGains() {
        if (!graph) return;
        for (const name of VOICES) setTarget(graph.voices[name].gain.gain, voiceGain(name));
    }

    function applyMaster() {
        if (!graph) return;
        const target = enabled && status !== 'error' ? masterGain(masterVolume) : 0;
        setTarget(graph.master.gain, target, MASTER_FADE);
    }

    function applyParameters() {
        if (!graph) return;
        const p = currentParameters();
        const { disk, jet, clock } = graph;
        for (let i = 0; i < PARTIAL_SLOTS; i += 1) {
            const partial = p.disk.partials[i];
            if (partial) setTarget(disk.partials[i].oscillator.frequency, partial.frequency);
            setTarget(disk.partials[i].gain.gain, (partial?.gain ?? 0) * SOURCE_GAINS.diskTone);
        }
        setTarget(disk.filter.frequency, p.disk.noise.cutoff);
        setTarget(disk.noiseGain.gain, p.disk.noise.level * SOURCE_GAINS.diskNoise);
        setTarget(jet.filter.frequency, p.jet.cutoff);
        setTarget(jet.gain.gain, p.jet.level * SOURCE_GAINS.jet);
        setTarget(clock.tGain.gain, p.clock.tGain * SOURCE_GAINS.tick);
        if (graph.worklet) {
            const param = (name) => graph.worklet.parameters.get(name);
            setTarget(param('turbulence'), p.disk.noise.turbulence);
            setTarget(param('pulseRate'), p.jet.pulseRate);
            setTarget(param('pulseDepth'), p.jet.pulseDepth);
            setTarget(param('tauTickRate'), p.clock.tau);
            setTarget(param('tTickRate'), p.clock.t);
        }
    }

    function pushCaption(caption, time, force = false) {
        if (!force && time - (captionTimes.get(caption.key) ?? -Infinity) < CAPTION_INTERVAL) {
            return;
        }
        captionTimes.set(caption.key, time);
        const entry = Object.freeze({ ...caption, time });
        captions.push(entry);
        if (captions.length > CAPTION_HISTORY) captions.shift();
        emit({ type: 'caption', caption: entry });
    }

    function applyUpdate() {
        trailingTimer = null;
        if (status !== 'running') return;
        const time = now();
        lastApplied = time;
        const previous = appliedParameters;
        appliedParameters = currentParameters();
        applyParameters();
        for (const caption of sonificationCaptions(previous, appliedParameters)) {
            pushCaption(caption, time);
        }
    }

    function buildGraph() {
        const ctx = context;
        const gain = (value) => {
            const node = ctx.createGain();
            node.gain.value = value;
            return node;
        };
        const filter = (type, frequency, q) => {
            const node = ctx.createBiquadFilter();
            node.type = type;
            node.frequency.value = frequency;
            node.Q.value = q;
            return node;
        };
        const analyser = () => {
            const node = ctx.createAnalyser();
            node.fftSize = 1024;
            return node;
        };

        const master = gain(0);
        const highpass = filter('highpass', 30, Math.SQRT1_2);
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.2;
        const masterMeter = analyser();
        master.connect(highpass);
        highpass.connect(limiter);
        limiter.connect(masterMeter);
        masterMeter.connect(ctx.destination);

        const voiceNodes = {};
        for (const name of VOICES) {
            const voice = { gain: gain(0), meter: analyser() };
            voice.gain.connect(voice.meter);
            voice.meter.connect(master);
            voiceNodes[name] = voice;
        }

        const diskFilter = filter('lowpass', 600, 0.5);
        const noiseGain = gain(0);
        diskFilter.connect(noiseGain);
        noiseGain.connect(voiceNodes.disk.gain);
        const partials = [];
        for (let i = 0; i < PARTIAL_SLOTS; i += 1) {
            const oscillator = ctx.createOscillator();
            oscillator.type = 'sine';
            oscillator.frequency.value = 440;
            const partialGain = gain(0);
            oscillator.connect(partialGain);
            partialGain.connect(voiceNodes.disk.gain);
            oscillator.start();
            partials.push({ oscillator, gain: partialGain });
        }

        const jetFilter = filter('lowpass', 2500, 0.5);
        const jetGain = gain(0);
        jetFilter.connect(jetGain);
        jetGain.connect(voiceNodes.jet.gain);

        const tauGain = gain(SOURCE_GAINS.tick);
        const tGain = gain(0);
        tauGain.connect(voiceNodes.clock.gain);
        tGain.connect(voiceNodes.clock.gain);

        graph = {
            master,
            masterMeter,
            voices: voiceNodes,
            disk: { filter: diskFilter, noiseGain, partials },
            jet: { filter: jetFilter, gain: jetGain },
            clock: { tauGain, tGain },
            worklet: null,
            fallback: [],
        };
    }

    function startFallbackNoise() {
        const rate = context.sampleRate;
        const sources = [
            [renderNoise({ kind: 'pink', sampleRate: rate, seed }), graph.disk.filter],
            [renderNoise({ kind: 'white', sampleRate: rate, seed: seed + 1 }), graph.jet.filter],
        ];
        for (const [samples, destination] of sources) {
            const buffer = context.createBuffer(1, samples.length, rate);
            buffer.copyToChannel(samples, 0);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(destination);
            source.start();
            graph.fallback.push(source);
        }
    }

    async function loadWorklet() {
        const ctx = context;
        try {
            if (!AudioWorkletNodeClass || !ctx.audioWorklet || !workletUrl) {
                throw new Error('AudioWorklet is not available');
            }
            await ctx.audioWorklet.addModule(workletUrl);
            if (disposed || ctx !== context) return;
            const node = new AudioWorkletNodeClass(ctx, PROCESSOR_NAME, {
                numberOfInputs: 0,
                numberOfOutputs: OUTPUTS.length,
                outputChannelCount: OUTPUTS.map(() => 1),
                processorOptions: { seed },
            });
            node.connect(graph.disk.filter, 0);
            node.connect(graph.jet.filter, 1);
            node.connect(graph.clock.tauGain, 2);
            node.connect(graph.clock.tGain, 3);
            graph.worklet = node;
            worklet = true;
        } catch {
            if (disposed || ctx !== context) return;
            startFallbackNoise();
            worklet = false;
        }
    }

    // Resolves true once resume() settles, false if it is rejected or still pending after
    // startTimeout (a browser that wants a gesture keeps the promise pending).
    function waitForResume(resumed) {
        return new Promise((resolve) => {
            const timer = timers.setTimeout(() => resolve(false), startTimeout);
            Promise.resolve(resumed).then(
                () => {
                    timers.clearTimeout(timer);
                    resolve(true);
                },
                () => {
                    timers.clearTimeout(timer);
                    resolve(false);
                },
            );
        });
    }

    function becomeRunning() {
        setStatus('running');
        applyVoiceGains();
        applyMaster();
        applyUpdate();
    }

    function settle() {
        if (disposed || !enabled) return getState();
        if (context.state === 'running') becomeRunning();
        else setStatus('suspended', 'needs-gesture');
        return getState();
    }

    function onVisibilityChange() {
        if (!context || !enabled || disposed) return;
        if (documentRef.visibilityState === 'hidden') {
            context.suspend().catch(() => {});
            setStatus('suspended', 'hidden');
        } else {
            waitForResume(context.resume()).then(settle);
        }
    }

    // A context that starts late (a pending resume() granted by a later gesture) or comes back
    // from an interruption (iOS reports 'interrupted') is picked up here.
    function onContextStateChange() {
        if (!context || !enabled || disposed || status === 'starting') return;
        if (context.state === 'running') {
            if (status !== 'running') becomeRunning();
        } else if (context.state === 'interrupted' || status === 'running') {
            setStatus('suspended', 'interrupted');
        }
    }

    function setAudioSessionType() {
        try {
            const session = navigatorRef?.audioSession;
            if (session && session.type !== 'playback') session.type = 'playback';
        } catch {}
    }

    function cancelSuspend() {
        if (suspendTimer !== null) timers.clearTimeout(suspendTimer);
        suspendTimer = null;
    }

    // Must be called synchronously from a user-gesture handler (click, keydown, touchend):
    // the AudioContext is created and resume() is called before the first await.
    function enable() {
        if (disposed || status === 'unsupported') return Promise.resolve(getState());
        enabled = true;
        error = null;
        cancelSuspend();
        setAudioSessionType();
        if (startPromise) return startPromise;
        if (status === 'running') return Promise.resolve(getState());
        let resumed;
        let ready;
        if (!context) {
            try {
                context = new AudioContextClass({ latencyHint: 'interactive' });
                resumed = context.resume();
                buildGraph();
            } catch (cause) {
                context = null;
                graph = null;
                enabled = false;
                error = String(cause?.message ?? cause);
                setStatus('error');
                return Promise.resolve(getState());
            }
            context.addEventListener?.('statechange', onContextStateChange);
            documentRef?.addEventListener?.('visibilitychange', onVisibilityChange);
            ready = Promise.all([waitForResume(resumed), loadWorklet()]);
        } else {
            ready = waitForResume(context.resume());
        }
        setStatus('starting');
        startPromise = ready.then(() => {
            startPromise = null;
            return settle();
        });
        return startPromise;
    }

    function disable() {
        if (disposed) return getState();
        enabled = false;
        if (status !== 'unsupported') setStatus('off');
        if (context) {
            applyMaster();
            cancelSuspend();
            suspendTimer = timers.setTimeout(() => {
                suspendTimer = null;
                if (!enabled && context) context.suspend().catch(() => {});
            }, SUSPEND_DELAY);
        }
        return getState();
    }

    function setVolume(value) {
        masterVolume = clamp01(value);
        applyMaster();
        emit({ type: 'state', state: getState() });
        return masterVolume;
    }

    function setVoice(name, settings) {
        if (!VOICES.includes(name)) throw new RangeError(`unknown voice "${name}"`);
        voiceSettings[name] = normalizeVoice(voiceSettings[name], settings);
        applyVoiceGains();
        emit({ type: 'state', state: getState() });
        return voiceSettings[name];
    }

    // Takes the simulation state described in normalizeSonificationState(); call it every frame.
    function update(input) {
        simulation = normalizeSonificationState(input);
        parametersStale = true;
        if (status !== 'running') return;
        const wait = lastApplied + UPDATE_INTERVAL - now();
        if (wait <= 0) {
            if (trailingTimer !== null) timers.clearTimeout(trailingTimer);
            applyUpdate();
        } else if (trailingTimer === null) {
            trailingTimer = timers.setTimeout(applyUpdate, wait);
        }
    }

    // Plays a gravitational-wave event from the current state and returns what it plays, or null
    // while sound is not running. A new event fades out the previous one.
    function triggerGravitationalWave({ kind = 'ringdown', ...options } = {}) {
        if (!GRAVITATIONAL_WAVE_KINDS.includes(kind)) {
            throw new RangeError(`unknown gravitational-wave kind "${kind}"`);
        }
        if (status !== 'running' || !graph) return null;
        const rate = context.sampleRate;
        let samples;
        let info;
        if (kind === 'chirp') {
            const p = chirpVoiceParameters(simulation, options);
            samples = renderChirp({ sampleRate: rate, ...p, modes: p.ringdown.modes });
            info = {
                kind,
                startFrequency: p.startFrequency,
                mergeFrequency: p.mergeFrequency,
                stretch: p.stretch,
            };
        } else {
            const p = ringdownVoiceParameters(simulation, options);
            samples = renderRingdown({ sampleRate: rate, modes: p.modes });
            info = {
                kind,
                frequency: p.modes[0].frequency,
                physicalFrequency: p.modes[0].physicalFrequency,
                stretch: p.stretch,
            };
        }
        const buffer = context.createBuffer(1, samples.length, rate);
        buffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        const shotGain = context.createGain();
        shotGain.gain.value = SOURCE_GAINS.gw;
        source.connect(shotGain);
        shotGain.connect(graph.voices.gw.gain);
        if (gwShot) {
            setTarget(gwShot.gain.gain, 0, STOP_FADE);
            gwShot.source.stop(context.currentTime + 6 * STOP_FADE);
        }
        const shot = { source, gain: shotGain };
        source.onended = () => {
            source.disconnect();
            shotGain.disconnect();
            if (gwShot === shot) gwShot = null;
        };
        source.start();
        gwShot = shot;
        const result = Object.freeze({ ...info, duration: samples.length / rate });
        pushCaption({ key: 'gw', text: gravitationalWaveCaption(result) }, now(), true);
        return result;
    }

    const meterBuffers = new Map();

    function meterLevel(analyser) {
        let buffer = meterBuffers.get(analyser.fftSize);
        if (!buffer) {
            buffer = new Float32Array(analyser.fftSize);
            meterBuffers.set(analyser.fftSize, buffer);
        }
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const sample of buffer) sum += sample * sample;
        const rms = Math.sqrt(sum / buffer.length);
        const level = rms > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(rms) + 60) / 60)) : 0;
        return Object.freeze({ rms, level });
    }

    // RMS of the last ~20 ms per voice and after the limiter, with `level` on a -60..0 dBFS scale.
    // Null before the first enable().
    function getMeters() {
        if (!graph) return null;
        const meters = { master: meterLevel(graph.masterMeter) };
        for (const name of VOICES) meters[name] = meterLevel(graph.voices[name].meter);
        return Object.freeze(meters);
    }

    function dispose() {
        if (disposed) return;
        enabled = false;
        cancelSuspend();
        if (trailingTimer !== null) timers.clearTimeout(trailingTimer);
        documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
        if (context) {
            context.removeEventListener?.('statechange', onContextStateChange);
            context.close().catch(() => {});
        }
        if (status !== 'unsupported') setStatus('off');
        disposed = true;
        context = null;
        graph = null;
        gwShot = null;
        listeners.clear();
    }

    return Object.freeze({
        get state() {
            return getState();
        },
        enable,
        disable,
        setVolume,
        setVoice,
        update,
        triggerGravitationalWave,
        getParameters: () => currentParameters(),
        getLegend: () => describeSonification(currentParameters()),
        getCaptions: () => [...captions],
        getMeters,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        dispose,
    });
}
