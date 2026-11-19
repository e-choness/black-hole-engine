import { useSyncExternalStore } from 'react';
import { diskPeakTemperature } from '../../app/core/physics/emission.js';
import {
    cameraFrequencyShift,
    createSonificationEngine,
} from '../../features/sonification/index.js';
import type { ClockReading } from '../lib/units';
import { subscribeClock, type ClockSample } from './clock';
import { engineObserver, params, type EngineParams } from './engine';
import { isPlaying } from './playback';

// Typed view of the sonification engine (src/features/sonification) and the simulation state it
// follows. The engine makes no sound and creates no audio context until enable() runs inside a
// user gesture, so sound is off on every visit; only the levels are remembered.

export const VOICES = ['disk', 'jet', 'gw', 'clock'] as const;
export type Voice = (typeof VOICES)[number];
export type SoundStatus = 'off' | 'starting' | 'running' | 'suspended' | 'unsupported' | 'error';
export type GravitationalWaveKind = 'ringdown' | 'chirp';

export interface VoiceSettings {
    level: number;
    muted: boolean;
    solo: boolean;
}

export interface SoundState {
    status: SoundStatus;
    reason: string | null;
    enabled: boolean;
    volume: number;
    voices: Readonly<Record<Voice, VoiceSettings>>;
    error: string | null;
}

export interface SoundCaption {
    key: string;
    text: string;
    time: number;
}

type SoundEvent = { type: 'state'; state: SoundState } | { type: 'caption'; caption: SoundCaption };

interface SonificationEngine {
    readonly state: SoundState;
    enable(): Promise<SoundState>;
    disable(): SoundState;
    setVolume(volume: number): number;
    setVoice(name: Voice, settings: Partial<VoiceSettings>): VoiceSettings;
    update(input: object): void;
    triggerGravitationalWave(options: { kind: GravitationalWaveKind }): object | null;
    getCaptions(): SoundCaption[];
    subscribe(listener: (event: SoundEvent) => void): () => void;
}

interface SavedSound {
    volume?: number;
    voices?: Partial<Record<Voice, Partial<VoiceSettings>>>;
}

const STORAGE_KEY = 'black-hole.sound';

// The engine clamps whatever it is given, so a damaged entry only falls back to the defaults.
function readSaved(): SavedSound {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        return saved && typeof saved === 'object' ? (saved as SavedSound) : {};
    } catch {
        return {};
    }
}

const saved = readSaved();
const engine = (createSonificationEngine as unknown as (options: SavedSound) => SonificationEngine)(
    { volume: saved.volume, voices: saved.voices },
);
const cameraShift = cameraFrequencyShift as unknown as (
    reading: ClockReading,
    spin: number,
) => number;
const peakTemperature = diskPeakTemperature as unknown as (p: EngineParams) => number;

interface SimulationParams extends EngineParams {
    grmhd: { enabled: boolean; turbulence_amp: number };
    jet: EngineParams['jet'] & {
        lorentz_factor: number;
        knot_spacing: number;
        brightness: number;
        spectral_index: number;
    };
}

let state = engine.state;
let stopFollowing: (() => void) | null = null;
const listeners = new Set<() => void>();

function follow({ reading }: ClockSample): void {
    const p = params() as SimulationParams;
    const spin = p.black_hole.spin_enabled ? p.black_hole.spin : 0;
    const observer = engineObserver();
    const { x, y, z } = observer.position;
    const r = Math.hypot(x, y, z);
    // The camera's inclination to the spin axis, which is also the jets' viewing angle.
    const inclination = r > 0 ? Math.acos(Math.min(1, Math.abs(z) / r)) : Math.PI / 2;
    engine.update({
        massSolar: p.disk.mass_msun,
        spin,
        unit: 'rs',
        simTime: observer.time,
        timeScale: isPlaying() ? p.time_scale : 0,
        observerShift: cameraShift(reading, spin),
        inclination,
        disk: {
            enabled: p.accretion_disk,
            temperature: peakTemperature(p),
            turbulence: p.grmhd.enabled ? p.grmhd.turbulence_amp : 1,
        },
        jet: {
            enabled: p.jet.enabled,
            lorentzFactor: p.jet.lorentz_factor,
            viewingAngle: inclination,
            knotSpacing: p.jet.knot_spacing,
            brightness: p.jet.brightness,
            spectralIndex: p.jet.spectral_index,
        },
        clock: { dtDtau: reading.dtDtau, tickInterval: 1 },
    });
}

function save(): void {
    const { volume, voices } = engine.state;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume, voices }));
    } catch {
        // The levels apply for this visit only.
    }
}

engine.subscribe((event) => {
    if (event.type !== 'state') return;
    state = event.state;
    listeners.forEach((listener) => listener());
});

// Must run synchronously inside the click or key handler that asks for sound.
export function setSoundEnabled(enabled: boolean): void {
    if (enabled) {
        void engine.enable();
        stopFollowing ??= subscribeClock(follow);
    } else {
        engine.disable();
        stopFollowing?.();
        stopFollowing = null;
    }
}

export function setSoundVolume(volume: number): void {
    engine.setVolume(volume);
    save();
}

export function setVoice(name: Voice, settings: Partial<VoiceSettings>): void {
    engine.setVoice(name, settings);
    save();
}

export function playGravitationalWave(kind: GravitationalWaveKind): void {
    engine.triggerGravitationalWave({ kind });
}

export function subscribeCaptions(listener: (caption: SoundCaption) => void): () => void {
    return engine.subscribe((event) => {
        if (event.type === 'caption') listener(event.caption);
    });
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function soundEnabled(): boolean {
    return state.enabled;
}

export function useSound(): SoundState {
    return useSyncExternalStore(subscribe, () => state);
}
