import { useSyncExternalStore } from 'react';
import { subscribeEngine } from './engine';

// Re-reads an engine value whenever the engine reports a change. `read` must return a primitive
// (or a stable reference) so unchanged values do not re-render.
export function useEngineValue<T>(read: () => T): T {
    return useSyncExternalStore(subscribeEngine, read, read);
}
