import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeEngine } from './engine';
import { subscribeFrames } from './telemetry';

// Re-reads an engine value whenever the engine reports a change. `read` must return a primitive
// (or a stable reference) so unchanged values do not re-render.
export function useEngineValue<T>(read: () => T): T {
    return useSyncExternalStore(subscribeEngine, read, read);
}

// Like useEngineValue, but also re-reads at the frame sample rate, for state the engine changes
// without a notification, such as the progress of a dive or its pause at the singularity.
export function useSampledValue<T>(read: () => T): T {
    const [value, setValue] = useState(read);
    const ref = useRef(read);
    useEffect(() => {
        ref.current = read;
    });
    useEffect(() => {
        const update = () => setValue(() => ref.current());
        const stopFrames = subscribeFrames(update);
        const stopEngine = subscribeEngine(update);
        update();
        return () => {
            stopFrames();
            stopEngine();
        };
    }, []);
    return value;
}
