import { useEffect, useRef } from 'react';
import { frames } from './engine';

// Per-frame readouts are sampled at 10 Hz and written straight into the DOM by the subscribers,
// so the render loop never causes React re-renders.
export interface FrameSample {
    now: number;
    dt: number;
    fps: number;
    renderMs: number;
    rendering: boolean;
}

type Sink = (sample: FrameSample) => void;

const SAMPLE_INTERVAL_MS = 100;
const sinks = new Set<Sink>();
let running = false;
let lastTime = 0;
let lastFrames = 0;
let fps = 0;
let idleSince = 0;

function loop(now: number): void {
    if (sinks.size === 0) {
        running = false;
        return;
    }
    requestAnimationFrame(loop);
    const elapsed = now - lastTime;
    if (elapsed < SAMPLE_INTERVAL_MS) return;
    const rendered = frames.frames - lastFrames;
    const instant = (rendered * 1000) / elapsed;
    fps = fps === 0 ? instant : fps + 0.35 * (instant - fps);
    if (rendered > 0) idleSince = 0;
    else if (idleSince === 0) idleSince = now;
    const sample: FrameSample = {
        now,
        dt: elapsed / 1000,
        fps,
        renderMs: frames.renderMs,
        rendering: idleSince === 0 || now - idleSince < 500,
    };
    lastTime = now;
    lastFrames = frames.frames;
    sinks.forEach((sink) => sink(sample));
}

export function subscribeFrames(sink: Sink): () => void {
    sinks.add(sink);
    if (!running) {
        running = true;
        lastTime = performance.now();
        lastFrames = frames.frames;
        requestAnimationFrame(loop);
    }
    return () => sinks.delete(sink);
}

// Subscribes `sink` for the lifetime of the component; the latest closure is always used.
export function useFrameSampler(sink: Sink): void {
    const ref = useRef(sink);
    useEffect(() => {
        ref.current = sink;
    });
    useEffect(() => subscribeFrames((sample) => ref.current(sample)), []);
}
