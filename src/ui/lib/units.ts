// Typed signatures for the src/features/units and src/features/clocks helpers used by the UI.
// JavaScript inference reads their option defaults as the only allowed options.

import * as format from '../../features/units/format.js';
import * as massScaling from '../../features/units/mass-scaling.js';
import * as clockFormat from '../../features/clocks/clock-format.js';
import * as observerClock from '../../features/clocks/observer-clock.js';

export interface NumberOptions {
    digits?: number;
    decimals?: number;
    trimZeros?: boolean;
    unit?: string;
}

type Formatter = (value: number, options?: NumberOptions) => string;

export const formatNumber = format.formatNumber as unknown as Formatter;
export const formatMass = format.formatMass as unknown as Formatter;
export const formatLength = format.formatLength as unknown as Formatter;
export const formatDuration = format.formatDuration as unknown as Formatter;
export const formatPower = format.formatPower as unknown as Formatter;
export const formatTemperature = format.formatTemperature as unknown as Formatter;
export const formatSigned = format.formatSigned as unknown as Formatter;
export const formatSpeed = format.formatSpeed as unknown as Formatter;
export const formatClock = format.formatClock as unknown as (
    seconds: number,
    options?: { showSeconds?: boolean },
) => string;
export const toSpeech = format.toSpeech as (text: string) => string;
export const MINUS: string = format.MINUS;
export const MISSING: string = format.MISSING;

export interface MassScale {
    massSolar: number;
    spin: number;
    schwarzschildRadius: number;
    lightCrossingTime: number;
    eddingtonLuminosity: number;
    radiativeEfficiency: number;
    radiiM: {
        horizonOuter: number;
        horizonInner: number;
        iscoPrograde: number;
        iscoRetrograde: number;
        photonOrbitPrograde: number;
        photonOrbitRetrograde: number;
        ergosphereEquatorial: number;
    };
    diskPeakTemperature: (
        eddingtonRatio: number,
        options?: { colorCorrection?: number },
    ) => { temperature: number; radiusM: number; flux: number };
    toMeters: (value: number, unit?: 'M' | 'rs') => number;
    toSeconds: (value: number, unit?: 'M' | 'rs') => number;
}

export const createMassScale = massScaling.createMassScale as unknown as (options: {
    massSolar: number;
    spin?: number;
}) => MassScale;

export type ClockMode = 'static' | 'zamo' | 'circular' | 'freefall' | 'moving';

export interface ClockReading {
    unit: 'M' | 'rs';
    mode: ClockMode;
    regime: string;
    r: number;
    tau: number;
    t: number | null;
    tKS: number;
    dTauDt: number | null;
    dtDtau: number | null;
    speed: number | null;
    lorentzFactor: number | null;
    redshift: { gravitational: number; kinematic: number; total: number } | null;
    properTimeRemaining: number | null;
    properTimeToHorizon: number | null;
    events: readonly string[];
}

export interface ClockInput {
    position?: [number, number, number];
    r?: number;
    theta?: number;
    speed?: number;
    velocity?: [number, number, number];
    mode: ClockMode;
}

export interface ObserverClock {
    advance: (input: ClockInput, dTau: number) => ClockReading;
    reset: (start?: { tau?: number; t?: number; tKS?: number }) => void;
    setSpin: (spin: number) => void;
}

export const createObserverClock = observerClock.createObserverClock as unknown as (options: {
    spin?: number;
    unit?: 'M' | 'rs';
}) => ObserverClock;

export interface ClockText {
    tau: string;
    t: string;
    dTauDt: string;
    speed: string;
    lorentzFactor: string;
    gravitationalRedshift: string;
    properTimeRemaining: string | null;
    properTimeToHorizon: string | null;
    speech: {
        tau: string;
        t: string;
        dTauDt: string;
        speed: string;
        gravitationalRedshift: string;
    };
}

export const formatClockReading = clockFormat.formatClockReading as unknown as (
    reading: ClockReading,
    scale: MassScale,
    options?: { showSeconds?: boolean },
) => ClockText;
