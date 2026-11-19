// Pure mappings from simulation state to sound parameters. Physical frequencies are moved into the
// audible band by octave transposition f_audio = 2^n f_phys, which keeps every frequency ratio, as
// in NASA's Chandra sonifications. One n is chosen per black hole from its ISCO orbital frequency,
// so the disk tone and the gravitational waves keep their intervals.

import {
    boyerLindquistFunctions,
    circularOrbitUt,
    keplerAngularVelocity,
    photonOrbitRadius,
} from '../units/kerr.js';
import { createMassScale, geometricUnitFactor, gravitationalTime } from '../units/mass-scaling.js';
import { formatFrequency, formatNumber, formatSigned, TIMES } from '../units/format.js';

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export const AUDIBLE_BAND = Object.freeze({ low: 100, high: 1000, target: 440 });

// Octave shift n: 0 when f already lies in [low, high], otherwise the n that brings f closest to
// the target pitch on a log axis. Sgr A*'s ISCO frequency 1.695 mHz gets n = 18 (444 Hz).
export function octaveShift(frequency, band = AUDIBLE_BAND) {
    if (!(frequency > 0) || !Number.isFinite(frequency)) return 0;
    if (frequency >= band.low && frequency <= band.high) return 0;
    return Math.round(Math.log2(band.target / frequency));
}

export function transpose(frequency, octaves) {
    return frequency * 2 ** octaves;
}

// Kerr quasi-normal-mode fits of Berti, Cardoso & Will (2006, arXiv:gr-qc/0512160), valid for
// 0 <= j <= 0.99: M omega = f1 + f2 (1 - j)^f3 and Q = q1 + q2 (1 - j)^q3.
const RINGDOWN_FITS = Object.freeze({
    220: [1.5251, -1.1568, 0.1292, 0.7, 1.4187, -0.499],
    221: [1.3673, -1.026, 0.1628, 0.1, 0.5436, -0.4731],
    330: [1.8956, -1.3043, 0.1818, 0.9, 2.343, -0.481],
});

export const RINGDOWN_MODES = Object.freeze(Object.keys(RINGDOWN_FITS));

// Relative starting amplitudes of the modes in the synthesized ringdown. Illustrative: the real
// excitation depends on the merger (mass ratio, spins).
export const RINGDOWN_AMPLITUDES = Object.freeze({ 220: 1, 221: 0.6, 330: 0.25 });

export function ringdownMode(spin, mode = '220') {
    const fit = RINGDOWN_FITS[mode];
    if (!fit) throw new RangeError(`unknown ringdown mode "${mode}"`);
    const x = 1 - clamp(Math.abs(spin), 0, 0.99);
    return { omega: fit[0] + fit[1] * x ** fit[2], quality: fit[3] + fit[4] * x ** fit[5] };
}

// Frequency f = M omega / (2 pi GM/c^3) in Hz and e-folding time tau = Q / (pi f) in seconds.
export function ringdownFrequency(massSolar, spin, mode = '220') {
    const { omega, quality } = ringdownMode(spin, mode);
    const frequency = omega / (2 * Math.PI * gravitationalTime(massSolar));
    return { frequency, damping: quality / (Math.PI * frequency), quality };
}

// Leading-order inspiral (Cutler & Flanagan 1994, arXiv:gr-qc/9402014) with tau the time left before
// coalescence and t_c = G M_c / c^3 for the chirp mass M_c:
//   f_GW = (1/pi) (5 / (256 tau))^(3/8) t_c^(-5/8),  GW phase = phi_c - 2 (tau / (5 t_c))^(5/8).
export function chirpFrequency(tau, chirpMassSolar) {
    const tc = gravitationalTime(chirpMassSolar);
    return (1 / Math.PI) * (5 / (256 * tau)) ** 0.375 * tc ** -0.625;
}

export function chirpTimeToCoalescence(frequency, chirpMassSolar) {
    const tc = gravitationalTime(chirpMassSolar);
    return (5 / 256) * (Math.PI * frequency) ** (-8 / 3) * tc ** (-5 / 3);
}

export function chirpPhase(tau, chirpMassSolar) {
    return -2 * (tau / (5 * gravitationalTime(chirpMassSolar))) ** 0.625;
}

// Chirp mass whose inspiral takes `duration` seconds to sweep from startFrequency to endFrequency,
// from tau(f) above.
export function chirpMassForSweep(startFrequency, endFrequency, duration) {
    const sweep = startFrequency ** (-8 / 3) - endFrequency ** (-8 / 3);
    const tc = ((duration * 256 * Math.PI ** (8 / 3)) / (5 * sweep)) ** -0.6;
    return tc / gravitationalTime(1);
}

// Doppler factor g = nu_observed / nu_emitted of a hot spot on a circular equatorial orbit at r (in
// M) seen from far away at inclination i, at orbital phase `phase` (pi/2 = approaching side). In
// the local zero-angular-momentum frame (ZAMO) the spot moves at speed v with Lorentz factor gamma,
// and a photon leaving at angle psi to the motion reaches infinity with
//   g = (alpha + omega varpi cos psi) / (gamma (1 - v cos psi)).
// Light bending is neglected by taking cos psi = sin i sin(phase), so the face-on value 1/u^t and
// the edge-on maximum (a tangential photon) are exact. Inside the photon orbit r_c of photons
// moving against the orbit, backward photons escape only with an impact parameter above the
// critical b_c = a - r_c^(3/2), i.e. cos psi >= b_c alpha / (varpi (1 - b_c omega)); cos psi is
// clipped there, so the edge-on minimum is the lowest shift that can reach infinity. The clip
// also excludes the negative-energy photons of the ergoregion, which lie beyond it.
// Signed spin: a < 0 for a hole rotating against the orbit.
export function hotSpotShift({ r, spin = 0, inclination = Math.PI / 2, phase = 0 }) {
    const ut = circularOrbitUt(r, spin);
    if (!Number.isFinite(ut)) return NaN;
    const bl = boyerLindquistFunctions(r, Math.PI / 2, spin);
    const gamma = bl.lapse * ut;
    const v = Math.sqrt(Math.max(0, 1 - 1 / (gamma * gamma)));
    const rc = photonOrbitRadius(-spin);
    const bc = spin - rc ** 1.5;
    const cosMin =
        r < rc ? (bc * bl.lapse) / (bl.cylindricalRadius * (1 - bc * bl.frameDragging)) : -1;
    const cosPsi = Math.max(cosMin, Math.sin(inclination) * Math.sin(phase));
    const numerator = bl.lapse + bl.frameDragging * bl.cylindricalRadius * cosPsi;
    return numerator / (gamma * (1 - v * cosPsi));
}

// Ratio between the frequency the camera receives and the one a distant listener receives, for
// light that falls in from far away with zero angular momentum, radially in the local ZAMO frame.
// An observer crossing that light with Lorentz factor gamma receives gamma / alpha = dt/dtau, so
// static, ZAMO, circular and (tangentially) moving cameras get their clock rate. The Doran infaller
// moves along the light at v = sqrt(2r(r^2 + a^2) / A) and receives 1 / (1 + v): 1/2 on both
// horizons and smooth through them, where dt/dtau diverges. `reading` is an ObserverClock reading.
export function cameraFrequencyShift(reading, spin = 0) {
    if (!reading) return 1;
    if (reading.mode !== 'freefall') return reading.dtDtau ?? 1;
    const r = reading.r * geometricUnitFactor(reading.unit);
    if (!(r > 0)) return 0;
    const { A } = boyerLindquistFunctions(r, reading.theta, spin);
    return 1 / (1 + Math.sqrt((2 * r * (r * r + spin * spin)) / A));
}

// Low-pass cutoff of the disk hiss. A design mapping, not physics: 600 Hz at 5000 K rising five
// octaves per four decades of temperature, so X-ray binary disks (10^7 K) hiss brightly.
export function diskNoiseCutoff(temperature) {
    if (!(temperature > 0)) return 150;
    return clamp(600 * (temperature / 5000) ** 0.376, 150, 12000);
}

// Doppler factors of the approaching jet and the counter-jet for bulk Lorentz factor Gamma and
// viewing angle theta between the jet axis and the line of sight.
export function jetDopplerFactors(lorentzFactor, viewingAngle) {
    const gamma = Math.max(1, lorentzFactor);
    const beta = Math.sqrt(1 - 1 / (gamma * gamma));
    const cos = Math.abs(Math.cos(viewingAngle));
    return {
        beta,
        approaching: 1 / (gamma * (1 - beta * cos)),
        receding: 1 / (gamma * (1 + beta * cos)),
    };
}

// Loudness 0..1 from the Doppler-boosted flux of a continuous jet, F proportional to
// delta^(2 + alpha) for spectral index alpha (Blandford & Koenigl 1979, doi:10.1086/157262),
// compressed as F / (1 + F) so a jet pointing at the camera cannot get arbitrarily loud.
export function jetLoudness(deltas, spectralIndex = 0.7) {
    const flux = deltas.approaching ** (2 + spectralIndex) + deltas.receding ** (2 + spectralIndex);
    return flux / (1 + flux);
}

// Rate per second of wall time at which knots spaced knotSpacing apart and moving at beta c pass a
// point of the approaching jet as the camera sees it: arrival times are compressed by
// 1 - beta cos theta. timeScale is simulation time per wall second, in the unit of knotSpacing.
// Clamped to 0.05-12 Hz so the pulses stay distinct beats.
export function jetPulseRate({ lorentzFactor, viewingAngle, knotSpacing, timeScale = 1 }) {
    if (!(timeScale > 0) || !(knotSpacing > 0)) return 0;
    const { beta } = jetDopplerFactors(lorentzFactor, viewingAngle);
    const cos = Math.abs(Math.cos(viewingAngle));
    return clamp(((beta / knotSpacing) * timeScale) / (1 - beta * cos), 0.05, 12);
}

// Perceptual volume control: gain = v^2 (about -12 dB at half travel).
export function masterGain(volume) {
    const v = clamp(Number.isFinite(volume) ? volume : 0, 0, 1);
    return v * v;
}

// One tick of "your clock" per tickInterval of proper time and one tick of the distant clock per
// tickInterval of coordinate time t, i.e. dt/dtau times faster. The distant ticks stop where t is
// undefined (dtDtau null). Tick energy falls as 1/sqrt(rate) above 4 Hz to keep loudness even.
export function clockTickRates({ timeScale = 1, tickInterval = 1, dtDtau = 1 }) {
    const ratio = dtDtau === null || !(dtDtau > 0) ? null : dtDtau;
    if (!(timeScale > 0) || !(tickInterval > 0)) return { tau: 0, t: 0, tGain: 0, ratio };
    const tau = clamp(timeScale / tickInterval, 0.25, 8);
    const t = ratio === null ? 0 : clamp(tau * ratio, 0, 30);
    return { tau, t, tGain: t > 0 ? Math.min(1, Math.sqrt(4 / t)) : 0, ratio };
}

// 1 inside [40 Hz, 8 kHz], fading to 0 at 20 Hz and 16 kHz on a log axis.
export function audibility(frequency) {
    if (!(frequency > 20) || !(frequency < 16000)) return 0;
    if (frequency < 40) return Math.log2(frequency / 20);
    if (frequency > 8000) return Math.log2(16000 / frequency);
    return 1;
}

// Defaults follow the renderer: spin 0.9, disk at 5000 K, jet off with Gamma 3 and knots every
// 6 r_s, lengths and times in r_s and r_s/c.
const DEFAULT_STATE = Object.freeze({
    massSolar: 6.5e9,
    spin: 0.9,
    disk: Object.freeze({ temperature: 5000, turbulence: 1 }),
    jet: Object.freeze({
        lorentzFactor: 3,
        viewingAngle: Math.PI / 2,
        knotSpacing: 6,
        brightness: 1.2,
        spectralIndex: 0.7,
    }),
});

function numberOr(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// Fills defaults and replaces invalid values, so a partial or stale state never throws.
// observerShift is cameraFrequencyShift(); clock.dtDtau comes from the same clock reading.
export function normalizeSonificationState(input = {}) {
    const d = DEFAULT_STATE;
    const disk = input.disk ?? {};
    const jet = input.jet ?? {};
    const clock = input.clock ?? {};
    const mass = numberOr(input.massSolar, d.massSolar);
    return {
        massSolar: mass > 0 ? mass : d.massSolar,
        spin: clamp(numberOr(input.spin, d.spin), -0.998, 0.998),
        unit: input.unit === 'M' ? 'M' : 'rs',
        simTime: numberOr(input.simTime, 0),
        timeScale: Math.max(0, numberOr(input.timeScale, 1)),
        observerShift: clamp(numberOr(input.observerShift, 1), 1 / 32, 32),
        inclination: numberOr(input.inclination, Math.PI / 2),
        octaves: Number.isInteger(input.octaves) ? input.octaves : null,
        disk: {
            enabled: Boolean(disk.enabled ?? true),
            temperature: Math.max(0, numberOr(disk.temperature, d.disk.temperature)),
            turbulence: clamp(numberOr(disk.turbulence, d.disk.turbulence), 0, 3),
            level: clamp(numberOr(disk.level, 1), 0, 1),
            tone: disk.tone === 'qpo' ? 'qpo' : 'isco',
            qpoRadius: numberOr(disk.qpoRadius, 0) > 0 ? disk.qpoRadius : null,
        },
        jet: {
            enabled: Boolean(jet.enabled),
            lorentzFactor: Math.max(1, numberOr(jet.lorentzFactor, d.jet.lorentzFactor)),
            viewingAngle: numberOr(jet.viewingAngle, d.jet.viewingAngle),
            knotSpacing: Math.max(0, numberOr(jet.knotSpacing, d.jet.knotSpacing)),
            brightness: clamp(numberOr(jet.brightness, d.jet.brightness), 0, 3),
            spectralIndex: clamp(numberOr(jet.spectralIndex, d.jet.spectralIndex), 0, 2),
        },
        clock: {
            dtDtau: clock.dtDtau === null ? null : Math.max(0, numberOr(clock.dtDtau, 1)),
            tickInterval: Math.max(0, numberOr(clock.tickInterval, 1)),
        },
    };
}

function octavesOf(state) {
    if (state.octaves !== null) return state.octaves;
    const scale = createMassScale({ massSolar: state.massSolar, spin: state.spin });
    return octaveShift(scale.iscoOrbitalFrequency);
}

const PARTIAL_WEIGHTS = Object.freeze({ orbital: 1, periastron: 0.6, nodal: 0.45 });
const SPOT_LEVEL_FLOOR = 0.25;

// Disk voice: hiss (pink noise, low-passed by temperature, flickering with turbulence) plus the
// hot-spot tone at the ISCO orbital frequency, or the relativistic-precession QPO triplet at
// qpoRadius (default 1.5 r_isco). The tone follows the spot's Doppler factor around the orbit times
// the camera's own frequency shift. Its level follows (g / g_max)^1.5, a softened form of the g^3
// to g^4 of Doppler beaming, floored at -12 dB so the tone never vanishes. spotTrend says whether
// g is rising or falling at this phase: g grows with cos psi, so it is the sign of sin i cos(phase).
export function diskVoiceParameters(input) {
    const state = normalizeSonificationState(input);
    const factor = geometricUnitFactor(state.unit);
    const scale = createMassScale({ massSolar: state.massSolar, spin: state.spin });
    const octaves = octavesOf(state);
    const qpo = state.disk.tone === 'qpo';
    const qpoRadius =
        state.disk.qpoRadius === null
            ? 1.5 * scale.diskInnerRadiusM
            : state.disk.qpoRadius * factor;
    const r = qpo ? Math.max(qpoRadius, scale.diskInnerRadiusM) : scale.diskInnerRadiusM;
    const physical = scale.epicyclicFrequencies(r, 'M');
    const names = qpo ? ['orbital', 'periastron', 'nodal'] : ['orbital'];

    const orbit = { r, spin: state.spin, inclination: state.inclination };
    const phase = keplerAngularVelocity(r, state.spin) * state.simTime * factor;
    const spot = hotSpotShift({ ...orbit, phase });
    const toward = Math.sin(state.inclination) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    const spotMax = hotSpotShift({ ...orbit, phase: toward });
    const spotMin = hotSpotShift({ ...orbit, phase: -toward });
    const slope = Math.sin(state.inclination) * Math.cos(phase);
    const modulated = (spotMax - spotMin) / spotMax > 0.02;
    const spotTrend = !modulated || slope === 0 ? 'steady' : slope > 0 ? 'rising' : 'falling';
    const spotLevel = clamp((spot / spotMax) ** 1.5, SPOT_LEVEL_FLOOR, 1);
    const shift = clamp(spot * state.observerShift, 1 / 32, 32);
    const on = state.disk.enabled ? 1 : 0;

    return {
        octaves,
        radiusM: r,
        spotShift: spot,
        spotLevel,
        spotTrend,
        shift,
        partials: names.map((name) => {
            const frequency = transpose(physical[name], octaves) * shift;
            return {
                name,
                physicalFrequency: physical[name],
                frequency: clamp(frequency, 20, 16000),
                gain: on * PARTIAL_WEIGHTS[name] * audibility(frequency) * spotLevel,
            };
        }),
        noise: {
            cutoff: clamp(
                diskNoiseCutoff(state.disk.temperature) * clamp(state.observerShift, 1 / 8, 8),
                150,
                12000,
            ),
            turbulence: state.disk.turbulence / 3,
            level: on * state.disk.level,
        },
    };
}

// Jet voice: broadband hiss whose loudness follows Doppler boosting and whose brightness follows
// the Doppler factor, gated by pulses as knots pass.
export function jetVoiceParameters(input) {
    const state = normalizeSonificationState(input);
    const { jet } = state;
    const deltas = jetDopplerFactors(jet.lorentzFactor, jet.viewingAngle);
    const on = jet.enabled ? 1 : 0;
    return {
        doppler: deltas.approaching,
        counterDoppler: deltas.receding,
        level: on * clamp(jetLoudness(deltas, jet.spectralIndex) * (jet.brightness / 1.2), 0, 1),
        cutoff: clamp(2500 * Math.sqrt(deltas.approaching * state.observerShift), 800, 14000),
        pulseRate: on * jetPulseRate({ ...jet, timeScale: state.timeScale }),
        pulseDepth: 0.75,
    };
}

export function clockVoiceParameters(input) {
    const state = normalizeSonificationState(input);
    return clockTickRates({
        timeScale: state.timeScale,
        tickInterval: state.clock.tickInterval,
        dtDtau: state.clock.dtDtau,
    });
}

// Ringdown of this black hole: the 220, 221 and 330 modes transposed by the disk's octaves and
// shifted by the camera's frequency shift (times divided by it). Transposition keeps Q, so a
// ringdown lasts only a few cycles; the e-folding times are stretched by one common factor until
// the 220 mode decays over `decay` seconds, which keeps the ratios between the modes.
export function ringdownVoiceParameters(input, { decay = 0.4 } = {}) {
    const state = normalizeSonificationState(input);
    const octaves = octavesOf(state);
    const scaleUp = 2 ** octaves * state.observerShift;
    const modes = RINGDOWN_MODES.map((mode) => {
        const physical = ringdownFrequency(state.massSolar, state.spin, mode);
        return {
            mode,
            physicalFrequency: physical.frequency,
            physicalDamping: physical.damping,
            quality: physical.quality,
            frequency: physical.frequency * scaleUp,
            damping: physical.damping / scaleUp,
            amplitude: RINGDOWN_AMPLITUDES[mode],
        };
    });
    const stretch = Math.max(1, decay / modes[0].damping);
    for (const mode of modes) mode.damping *= stretch;
    return { octaves, stretch, modes };
}

// Inspiral of an equal-mass binary of total mass M that merges into this black hole, followed by
// its ringdown. Transposed by the same octaves the inspiral would sweep the audible band in
// milliseconds, so time is stretched: the sweep from `octavesBelow` octaves under the 220 ringdown
// frequency up to it takes `duration` seconds with the f ~ tau^(-3/8) law, i.e. the inspiral of a
// lighter effective chirp mass. The leading-order law is used up to the ringdown frequency, beyond
// its range of validity, so that frequency and phase run continuously into the ringdown.
export function chirpVoiceParameters(input, { duration = 2, octavesBelow = 3, decay = 0.25 } = {}) {
    const state = normalizeSonificationState(input);
    const ringdown = ringdownVoiceParameters(state, { decay });
    const scaleUp = 2 ** ringdown.octaves * state.observerShift;
    const mergeFrequency = ringdown.modes[0].frequency;
    const startFrequency = mergeFrequency / 2 ** octavesBelow;
    const chirpMass = chirpMassForSweep(startFrequency, mergeFrequency, duration);
    const physicalChirpMass = state.massSolar * 0.25 ** 0.6;
    const mergeTau = chirpTimeToCoalescence(mergeFrequency, chirpMass);
    return {
        octaves: ringdown.octaves,
        physicalChirpMass,
        chirpMass,
        stretch: (chirpMass / (physicalChirpMass / scaleUp)) ** (-5 / 3),
        startFrequency,
        mergeFrequency,
        duration,
        startTau: mergeTau + duration,
        mergeTau,
        ringdown,
    };
}

export function sonificationParameters(input) {
    const state = normalizeSonificationState(input);
    return {
        disk: diskVoiceParameters(state),
        jet: jetVoiceParameters(state),
        clock: clockVoiceParameters(state),
        ringdown: ringdownVoiceParameters(state),
    };
}

function octaveText(n) {
    return n === 0
        ? 'none'
        : `${formatSigned(n, { decimals: 0 })} octave${Math.abs(n) === 1 ? '' : 's'}`;
}

// Legend in the style of Chandra's sonification pages: what each voice means and the values mapped
// right now, so everything heard is also available as text.
export function describeSonification(params) {
    const orbital = params.disk.partials[0];
    const fundamental = params.ringdown.modes[0];
    return [
        {
            voice: 'disk',
            title: 'Accretion disk',
            description:
                'Hiss: turbulent gas, brighter for a hotter disk. Tone: the orbital frequency at the ' +
                'innermost stable orbit (or the three precession frequencies), moved by whole ' +
                'octaves into the audible range. Its pitch and loudness follow an orbiting hot ' +
                'spot: higher and louder on the approaching side.',
            values: [
                ['Orbital frequency', formatFrequency(orbital.physicalFrequency)],
                ['Transposition', octaveText(params.disk.octaves)],
                ['Heard at', formatFrequency(orbital.frequency)],
                ['Hot-spot Doppler factor', formatNumber(params.disk.spotShift)],
            ],
        },
        {
            voice: 'jet',
            title: 'Relativistic jet',
            description:
                'Hiss: synchrotron emission, louder and brighter the more the jet is beamed ' +
                'towards you. Pulses: knots travelling along the jet, arriving faster when it ' +
                'points at you.',
            values: [
                ['Doppler factor', formatNumber(params.jet.doppler)],
                ['Knot pulses', formatFrequency(params.jet.pulseRate)],
            ],
        },
        {
            voice: 'gw',
            title: 'Gravitational waves',
            description:
                'On demand. Ringdown: the black hole rings at its quasi-normal frequencies, ' +
                'transposed like the disk tone and slowed down so the ringing can be heard. ' +
                'Chirp: two black holes spiral together, rising in pitch until they merge into ' +
                'this one and ring down; time is stretched so the sweep can be heard.',
            values: [
                ['Ringdown frequency', formatFrequency(fundamental.physicalFrequency)],
                ['Heard at', formatFrequency(fundamental.frequency)],
                [
                    'Ringing slowed',
                    `${TIMES}${formatNumber(params.ringdown.stretch, { digits: 2 })}`,
                ],
            ],
        },
        {
            voice: 'clock',
            title: 'Clocks',
            description:
                'High ticks: your own clock. Low ticks: the distant clock, as on the clock ' +
                'readout. The faster the low ticks, the slower your time runs. They stop inside ' +
                'the horizon, where distant time is undefined.',
            values: [
                ['Your clock', formatFrequency(params.clock.tau)],
                ['Distant clock', formatFrequency(params.clock.t)],
            ],
        },
    ];
}

const CLOCK_RATIO_STEPS = Object.freeze([
    [2, 'twice'],
    [10, 'ten times'],
]);

// Captions for an aria-live region, describing what changed between two parameter sets. Each has
// a key so the caller can rate-limit repeats.
export function sonificationCaptions(previous, current) {
    if (!previous || !current) return [];
    const captions = [];
    const trend = current.disk.spotTrend;
    const before = previous.disk.spotTrend;
    if (current.disk.noise.level > 0 && trend !== before && ![trend, before].includes('steady')) {
        captions.push({
            key: 'spot',
            text:
                trend === 'rising'
                    ? 'Hot-spot tone rising: approaching side'
                    : 'Hot-spot tone falling: receding side',
        });
    }
    const ratio = current.clock.ratio;
    const previousRatio = previous.clock.ratio;
    if (current.clock.tau > 0 && previous.clock.tau > 0) {
        if (previousRatio !== null && ratio === null) {
            captions.push({
                key: 'clock',
                text: 'Distant clock stopped: its time is undefined inside the horizon',
            });
        } else if (previousRatio === null && ratio !== null) {
            captions.push({ key: 'clock', text: 'Distant clock ticking again' });
        } else if (ratio !== null) {
            const crossed = CLOCK_RATIO_STEPS.filter(
                ([step]) => previousRatio < step && ratio >= step,
            ).at(-1);
            if (crossed) {
                captions.push({
                    key: 'clock',
                    text: `Distant clock ticking ${crossed[1]} as fast as yours`,
                });
            }
        }
    }
    if (previous.jet.level === 0 && current.jet.level > 0) {
        captions.push({ key: 'jet', text: 'Jet hiss on' });
    } else if (previous.jet.level > 0 && current.jet.level === 0) {
        captions.push({ key: 'jet', text: 'Jet hiss off' });
    }
    return captions;
}

export function gravitationalWaveCaption(info) {
    return info.kind === 'chirp'
        ? `Gravitational-wave chirp rising to ${formatFrequency(info.mergeFrequency)}, then ringdown`
        : `Gravitational-wave ringdown at ${formatFrequency(info.frequency)}`;
}
