import { useEffect, useRef } from 'react';
import {
    createMassScale,
    createObserverClock,
    type ClockMode,
    type ClockReading,
    type MassScale,
} from '../lib/units';
import { currentMode, engineObserver, params } from './engine';
import { subscribeFrames } from './telemetry';

// The observer's proper time tau and the distant time t, advanced at the frame sample rate. The
// distant clock follows the engine's observer time, which also drives the disk, and tau follows
// from dtau/dt of the camera's worldline; in a dive the clocks follow the radius instead.
export interface ClockSample {
    reading: ClockReading;
    scale: MassScale;
}

type ClockSink = (sample: ClockSample) => void;

const clock = createObserverClock({ unit: 'rs' });
const sinks = new Set<ClockSink>();
let stopFrames: (() => void) | null = null;
let lastTime: number | null = null;
let reading: ClockReading | null = null;
let scale: MassScale | null = null;
let scaleKey = '';

function signedSpin(): number {
    const hole = params().black_hole;
    return hole.spin_enabled ? hole.spin : 0;
}

function clockMode(): ClockMode {
    const mode = currentMode();
    if (mode === 'dive') return 'freefall';
    if (mode === 'hover') return 'static';
    return params().observer.motion ? 'circular' : 'static';
}

function massScale(spin: number): MassScale {
    const massSolar = params().disk.mass_msun;
    const key = `${massSolar}:${spin}`;
    if (!scale || key !== scaleKey) {
        scale = createMassScale({ massSolar, spin: Math.max(-0.998, Math.min(0.998, spin)) });
        scaleKey = key;
    }
    return scale;
}

function advance(): void {
    const observer = engineObserver();
    const { x, y, z } = observer.position;
    const time = observer.time;
    const spin = signedSpin();
    clock.setSpin(spin);
    const rate = reading?.dTauDt ?? 1;
    if (lastTime === null) {
        clock.reset({ tau: time, t: time });
    } else if (time < lastTime) {
        const tau = time === 0 ? 0 : (reading?.tau ?? 0) + (time - lastTime) * rate;
        clock.reset({ tau: Math.max(0, tau), t: time });
    }
    const elapsed = lastTime === null ? 0 : Math.max(0, time - lastTime);
    lastTime = time;
    reading = clock.advance({ mode: clockMode(), position: [x, y, z] }, elapsed * rate);
    const sample = { reading, scale: massScale(spin) };
    sinks.forEach((sink) => sink(sample));
}

export function subscribeClock(sink: ClockSink): () => void {
    sinks.add(sink);
    stopFrames ??= subscribeFrames(advance);
    return () => {
        sinks.delete(sink);
        if (sinks.size === 0 && stopFrames) {
            stopFrames();
            stopFrames = null;
        }
    };
}

// Subscribes `sink` for the lifetime of the component; the latest closure is always used.
export function useClockSampler(sink: ClockSink): void {
    const ref = useRef(sink);
    useEffect(() => {
        ref.current = sink;
    });
    useEffect(() => subscribeClock((sample) => ref.current(sample)), []);
}
