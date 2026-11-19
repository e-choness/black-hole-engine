// HUD strings for a clock reading in physical units, e.g. "41 d 06:12:08", "dτ/dt 0.929",
// "z +0.049". Every field also has a spoken form for aria-label / aria-live regions.

import {
    clockToSpeech,
    formatClock,
    formatDuration,
    formatNumber,
    formatSigned,
    formatSpeed,
    MISSING,
    toSpeech,
} from '../units/format.js';

const UNDEFINED_INSIDE = 'undefined inside the horizon';

// massScale comes from createMassScale(); reading from ObserverClock.advance().
export function formatClockReading(reading, massScale, { showSeconds = true } = {}) {
    const seconds = (value) => massScale.toSeconds(value, reading.unit);
    const clock = (value) =>
        value === null ? MISSING : formatClock(seconds(value), { showSeconds });
    const duration = (value) => (value === null ? null : formatDuration(seconds(value)));
    const number = (value, options) => (value === null ? MISSING : formatNumber(value, options));
    const signed = (value) => (value === null ? MISSING : formatSigned(value, { digits: 2 }));

    const text = {
        tau: clock(reading.tau),
        t: clock(reading.t),
        tKS: clock(reading.tKS),
        dTauDt: number(reading.dTauDt, { decimals: 3 }),
        speed: reading.speed === null ? MISSING : formatSpeed(reading.speed),
        lorentzFactor: number(reading.lorentzFactor, { digits: 4 }),
        gravitationalRedshift: signed(reading.redshift?.gravitational ?? null),
        totalRedshift: signed(reading.redshift?.total ?? null),
        properTimeRemaining: duration(reading.properTimeRemaining),
        properTimeToHorizon: duration(reading.properTimeToHorizon),
    };

    const speech = {
        tau: clockToSpeech(seconds(reading.tau)),
        t: reading.t === null ? UNDEFINED_INSIDE : clockToSpeech(seconds(reading.t)),
        tKS: clockToSpeech(seconds(reading.tKS)),
        dTauDt: reading.dTauDt === null ? UNDEFINED_INSIDE : toSpeech(text.dTauDt),
        speed: toSpeech(text.speed),
        gravitationalRedshift:
            reading.redshift === null ? UNDEFINED_INSIDE : toSpeech(text.gravitationalRedshift),
        properTimeRemaining:
            text.properTimeRemaining === null ? null : toSpeech(text.properTimeRemaining),
    };

    return Object.freeze({ ...text, speech: Object.freeze(speech) });
}
