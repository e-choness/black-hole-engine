import {
    currentMode,
    dive,
    hover,
    isSimulationPaused,
    notifyEngine,
    readDive,
    readHover,
    restartScenario,
    seekDiveRadius,
    seekHoverRadius,
    setSimulationPaused,
    stepSimulation,
    toggleScenario,
    type ObserverMode,
} from './engine';

// One step moves the distant clock by r_s/c in orbit mode, and a dive or hover by 2 % of the way
// from its start radius.
const STEP_TIME = 1;
const STEP_PROGRESS = 0.02;

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 6];

export function isPlaying(mode: ObserverMode = currentMode()): boolean {
    if (isSimulationPaused()) return false;
    if (mode === 'dive') return dive.active && !dive.paused;
    if (mode === 'hover') return hover.active && !hover.paused;
    return true;
}

// Play starts the simulation clock and, in a dive or hover, the scenario; a scenario that has
// reached its end starts over.
export function togglePlayback(): void {
    const mode = currentMode();
    if (mode === 'orbit') {
        setSimulationPaused(!isSimulationPaused());
        return;
    }
    const state = mode === 'dive' ? dive : hover;
    if (isPlaying(mode)) {
        toggleScenario(mode);
    } else {
        const ended = mode === 'dive' ? dive.reachedSingularity : readHover().phase === 'minimum';
        if (ended) restartScenario(mode);
        else if (!state.active || state.paused) toggleScenario(mode);
        if (isSimulationPaused()) setSimulationPaused(false);
    }
    notifyEngine();
}

export function scenarioProgress(mode: 'dive' | 'hover'): number {
    return (mode === 'dive' ? readDive() : readHover()).progress;
}

// Moves a dive or hover to a fraction of the way from its start radius to r = 0 and pauses it.
export function seekScenario(mode: 'dive' | 'hover', progress: number): void {
    const readout = mode === 'dive' ? readDive() : readHover();
    const radius = readout.startR * (1 - Math.max(0, Math.min(1, progress)));
    if (mode === 'dive') seekDiveRadius(radius);
    else seekHoverRadius(Math.max(readHover().minR, radius));
    notifyEngine();
}

export function stepPlayback(direction: 1 | -1): void {
    const mode = currentMode();
    if (mode === 'orbit') stepSimulation(direction * STEP_TIME);
    else seekScenario(mode, scenarioProgress(mode) + direction * STEP_PROGRESS);
}
