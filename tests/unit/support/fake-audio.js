// Minimal stand-ins for the Web Audio API that record what the sonification engine does with them.

export class FakeAudioParam {
    constructor(value = 0) {
        this.value = value;
        this.events = [];
    }

    get target() {
        const last = this.events.findLast((event) => event.type === 'target');
        return last ? last.value : this.value;
    }

    setTargetAtTime(value, time, timeConstant) {
        this.events.push({ type: 'target', value, time, timeConstant });
        return this;
    }

    cancelScheduledValues(time) {
        this.events.push({ type: 'cancel', time });
        return this;
    }
}

class FakeNode {
    constructor(context, kind) {
        this.context = context;
        this.kind = kind;
        this.connections = [];
        context.nodes.push(this);
    }

    connect(destination, output = 0, input = 0) {
        this.connections.push({ destination, output, input });
        return destination;
    }

    disconnect() {
        this.connections = [];
        this.disconnected = true;
    }
}

class FakeScheduledNode extends FakeNode {
    start(when = 0) {
        this.startedAt = when;
    }

    stop(when = 0) {
        this.stoppedAt = when;
    }
}

class FakeAnalyser extends FakeNode {
    constructor(context) {
        super(context, 'analyser');
        this.fftSize = 2048;
        this.signal = 0;
    }

    getFloatTimeDomainData(array) {
        array.fill(this.signal);
    }
}

class FakeAudioBuffer {
    constructor(channels, length, sampleRate) {
        this.numberOfChannels = channels;
        this.length = length;
        this.sampleRate = sampleRate;
        this.channels = Array.from({ length: channels }, () => new Float32Array(length));
    }

    copyToChannel(source, channel) {
        this.channels[channel].set(source);
    }

    getChannelData(channel) {
        return this.channels[channel];
    }
}

// behavior.resume: 'resolve' (the context starts), 'pending' (autoplay blocked: the promise never
// settles) or 'reject'; behavior.addModule: 'resolve' or 'reject'; behavior.create: 'ok' or 'throw'.
export function createFakeAudio({ sampleRate = 48000 } = {}) {
    const behavior = { resume: 'resolve', addModule: 'resolve', create: 'ok' };
    const contexts = [];

    class FakeAudioContext {
        constructor(options) {
            if (behavior.create === 'throw') throw new Error('no audio output device');
            this.options = options;
            this.state = 'suspended';
            this.sampleRate = sampleRate;
            this.currentTime = 0;
            this.nodes = [];
            this.calls = [];
            this.listeners = new Map();
            this.destination = new FakeNode(this, 'destination');
            this.audioWorklet = {
                modules: [],
                addModule: (url) => {
                    this.audioWorklet.modules.push(url);
                    return behavior.addModule === 'resolve'
                        ? Promise.resolve()
                        : Promise.reject(new Error('module blocked'));
                },
            };
            contexts.push(this);
        }

        // Browsers fire statechange asynchronously.
        setState(state) {
            if (this.state === state) return;
            this.state = state;
            queueMicrotask(() => {
                for (const listener of this.listeners.get('statechange') ?? []) listener();
            });
        }

        resume() {
            this.calls.push('resume');
            if (behavior.resume === 'pending') return new Promise(() => {});
            if (behavior.resume === 'reject') return Promise.reject(new Error('not allowed'));
            this.setState('running');
            return Promise.resolve();
        }

        suspend() {
            this.calls.push('suspend');
            this.setState('suspended');
            return Promise.resolve();
        }

        close() {
            this.calls.push('close');
            this.setState('closed');
            return Promise.resolve();
        }

        addEventListener(type, listener) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(listener);
        }

        removeEventListener(type, listener) {
            this.listeners.get(type)?.delete(listener);
        }

        createGain() {
            const node = new FakeNode(this, 'gain');
            node.gain = new FakeAudioParam(1);
            return node;
        }

        createBiquadFilter() {
            const node = new FakeNode(this, 'biquad');
            node.type = 'lowpass';
            node.frequency = new FakeAudioParam(350);
            node.Q = new FakeAudioParam(1);
            return node;
        }

        createOscillator() {
            const node = new FakeScheduledNode(this, 'oscillator');
            node.type = 'sine';
            node.frequency = new FakeAudioParam(440);
            return node;
        }

        createDynamicsCompressor() {
            const node = new FakeNode(this, 'compressor');
            for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) {
                node[name] = new FakeAudioParam(0);
            }
            return node;
        }

        createAnalyser() {
            return new FakeAnalyser(this);
        }

        createBuffer(channels, length, rate) {
            return new FakeAudioBuffer(channels, length, rate);
        }

        createBufferSource() {
            const node = new FakeScheduledNode(this, 'buffer-source');
            node.buffer = null;
            node.loop = false;
            return node;
        }
    }

    class FakeAudioWorkletNode extends FakeNode {
        constructor(context, name, options) {
            super(context, 'worklet');
            this.name = name;
            this.options = options;
            this.parameters = new Map(
                ['turbulence', 'pulseRate', 'pulseDepth', 'tauTickRate', 'tTickRate'].map(
                    (param) => [param, new FakeAudioParam(0)],
                ),
            );
        }
    }

    return {
        AudioContext: FakeAudioContext,
        AudioWorkletNode: FakeAudioWorkletNode,
        behavior,
        contexts,
    };
}

export function createFakeDocument() {
    const listeners = new Map();
    return {
        visibilityState: 'visible',
        listeners,
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        setVisibility(state) {
            this.visibilityState = state;
            for (const listener of listeners.get('visibilitychange') ?? []) listener();
        },
    };
}

// Nodes of one kind, in creation order.
export function nodesOfKind(context, kind) {
    return context.nodes.filter((node) => node.kind === kind);
}

// Follows connections from `node` and returns the kinds along the first path to the destination.
export function pathToDestination(node) {
    const kinds = [node.kind];
    let current = node;
    while (current.kind !== 'destination' && current.connections.length > 0) {
        current = current.connections[0].destination;
        kinds.push(current.kind);
    }
    return kinds;
}
