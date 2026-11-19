// Proper time tau of the camera and coordinate time t of a distant observer, advanced once per
// frame from the camera's position, speed and mode (see clockRates in kerr-time.js).
//
// Outside the horizon t is the Boyer-Lindquist time, i.e. the reading of a clock at rest far away.
// It diverges as an infaller approaches the horizon and does not exist inside, where the reading
// reports t = null. tKS is the ingoing Kerr-Schild time t_KS = t + int 2r/Delta dr, which stays
// finite through the horizon and is the time coordinate of the renderer's Kerr-Schild metric.
//
// In 'freefall' mode the clocks follow the Doran worldline through the camera's radius: tau, tKS
// and t advance by the infaller's elapsed times between the previous and the current radius, so
// they stay consistent with the position whatever step the caller uses, and the logarithmic
// divergence of t at the horizon is evaluated in closed form rather than integrated. Radial moves
// outwards are treated as teleports and leave the clocks unchanged. In the other modes the
// observer is stationary between frames and the clocks advance by dTau and dTau / (dtau/dt).

import { geometricUnitFactor } from '../units/mass-scaling.js';
import { ergosphereRadius, horizonRadii } from '../units/kerr.js';
import {
    clockEndRadius,
    clockRates,
    clockSpin,
    doranTimeShift,
    freefallProperTime,
    kerrSchildSpherical,
    kerrSchildTimeShift,
} from './kerr-time.js';

function vectorLength(vector) {
    return Math.hypot(vector[0], vector[1], vector[2]);
}

function resolveSpeed(input) {
    if (Array.isArray(input.velocity)) return vectorLength(input.velocity);
    return input.speed ?? 0;
}

// Creates a clock pair. `unit` is the geometric unit of every radius, position and time the clock
// takes or returns: 'M' (GM/c^2 and GM/c^3) or 'rs' (r_s and r_s/c, as in the current renderer).
// `spin` is signed relative to the camera's orbit for 'circular' mode and only its magnitude
// matters elsewhere.
//
// advance() returns a frozen reading: the clockRates() fields plus tau, t (null inside the
// horizon), tKS, r, theta, dtDtau, kinematicFactor (1/gamma), redshift { gravitational,
// kinematic, total } with 1 + total = (1 + gravitational)(1 + kinematic), the infaller's
// properTimeRemaining (to r_- or r = 0) and properTimeToHorizon, and the events of this frame:
// entered-ergosphere, left-ergosphere, crossed-horizon, reached-inner-horizon,
// reached-singularity, and left-horizon (a teleport out, after which t resumes from its last
// exterior value).
export function createObserverClock({ spin = 0, unit = 'M' } = {}) {
    const factor = geometricUnitFactor(unit);
    let a = clockSpin(spin);
    let tau = 0;
    let t = 0;
    let tKS = 0;
    let lastExteriorT = 0;
    let previous = null;
    let reading = null;

    function resolvePosition(input) {
        if (input.position) {
            const scaled = input.position.map((value) => value * factor);
            return kerrSchildSpherical(scaled, a, input.axis);
        }
        if (typeof input.r !== 'number') {
            throw new RangeError('advance() needs either r (and theta) or position');
        }
        return { r: input.r * factor, theta: input.theta ?? Math.PI / 2 };
    }

    function insideErgosphere(r, theta) {
        return a !== 0 && r > horizonRadii(a).outer && r <= ergosphereRadius(a, theta);
    }

    function detectEvents(rates, r, theta) {
        if (!previous) return [];
        const events = [];
        if (previous.regime === 'exterior' && rates.regime !== 'exterior') {
            events.push('crossed-horizon');
        }
        if (previous.regime !== 'end' && rates.regime === 'end') {
            events.push(
                rates.endReason === 'singularity' ? 'reached-singularity' : 'reached-inner-horizon',
            );
        }
        if (previous.regime !== 'exterior' && rates.regime === 'exterior') {
            events.push('left-horizon');
        }
        const wasInside = insideErgosphere(previous.r, previous.theta);
        const isInside = insideErgosphere(r, theta);
        if (!wasInside && isInside) events.push('entered-ergosphere');
        if (wasInside && !isInside && rates.regime === 'exterior') events.push('left-ergosphere');
        return events;
    }

    function advanceFreefall(rates, r, theta) {
        if (!previous || previous.regime === 'end') return;
        const rEnd = clockEndRadius(a);
        const rFrom = previous.r;
        const rTo = Math.max(r, rEnd);
        if (!(rTo < rFrom)) return;
        const midTheta = (previous.theta + theta) / 2;
        const dTau = freefallProperTime(rFrom, rTo, a, midTheta);
        const dKS = dTau + doranTimeShift(rFrom, rTo, a);
        tau += dTau;
        tKS += dKS;
        if (rates.regime === 'exterior' && previous.regime === 'exterior') {
            t += dKS + kerrSchildTimeShift(rFrom, rTo, a);
        }
    }

    function buildReading(rates, r, theta, events) {
        const exterior = rates.regime === 'exterior';
        const falling = rates.mode === 'freefall';
        const rEnd = clockEndRadius(a);
        const outer = horizonRadii(a).outer;
        const time = (value) => (value === null ? null : value / factor);
        return Object.freeze({
            unit,
            mode: rates.mode,
            requestedMode: rates.requestedMode,
            regime: rates.regime,
            endReason: rates.endReason,
            r: r / factor,
            theta,
            tau: time(tau),
            t: exterior ? time(t) : null,
            tKS: time(tKS),
            dTauDt: rates.dTauDt,
            dtDtau: exterior ? 1 / rates.dTauDt : null,
            dtKSDtau: falling ? rates.dtKSDtau : exterior ? 1 / rates.dTauDt : null,
            lapse: rates.lapse,
            kinematicFactor: exterior ? 1 / rates.lorentzFactor : null,
            lorentzFactor: rates.lorentzFactor,
            speed: rates.speed,
            redshift: exterior
                ? Object.freeze({
                      gravitational: 1 / rates.lapse - 1,
                      kinematic: rates.lorentzFactor - 1,
                      total: 1 / rates.dTauDt - 1,
                  })
                : null,
            properTimeRemaining: falling
                ? time(freefallProperTime(Math.max(r, rEnd), rEnd, a, theta))
                : null,
            properTimeToHorizon:
                falling && exterior ? time(freefallProperTime(r, outer, a, theta)) : null,
            notices: Object.freeze([...rates.notices]),
            events: Object.freeze(events),
        });
    }

    return Object.freeze({
        unit,

        get spin() {
            return a;
        },

        setSpin(value) {
            a = clockSpin(value);
        },

        // Sets the clocks (in the clock's time unit) and forgets the previous position, so the next
        // advance() starts a new worldline without events.
        reset({ tau: tau0 = 0, t: t0 = 0, tKS: tKS0 = t0 } = {}) {
            tau = tau0 * factor;
            t = t0 * factor;
            tKS = tKS0 * factor;
            lastExteriorT = t;
            previous = null;
            reading = null;
        },

        // input: { mode, r, theta } or { mode, position: [x, y, z], axis }, plus { speed } or
        // { velocity: [vx, vy, vz] } (fractions of c relative to the ZAMO) for 'moving' and
        // { retrograde } for 'circular'. dTau is the camera's proper-time step in the clock's time
        // unit; 'freefall' mode derives its step from the change of radius instead.
        advance(input = {}, dTau = 0) {
            if (typeof dTau !== 'number' || !(dTau >= 0) || !Number.isFinite(dTau)) {
                throw new RangeError(`dTau must be a finite number >= 0, got ${dTau}`);
            }
            const { r, theta } = resolvePosition(input);
            const rates = clockRates({
                mode: input.mode ?? 'static',
                r,
                theta,
                spin: a,
                speed: resolveSpeed(input),
                retrograde: Boolean(input.retrograde),
            });
            const events = detectEvents(rates, r, theta);

            if (rates.mode === 'freefall') {
                advanceFreefall(rates, r, theta);
            } else {
                const step = dTau * factor;
                tau += step;
                t += step / rates.dTauDt;
                tKS += step / rates.dTauDt;
            }
            if (rates.regime === 'exterior') {
                if (previous && previous.regime !== 'exterior') t = lastExteriorT;
                lastExteriorT = t;
            }

            previous = { r, theta, regime: rates.regime };
            reading = buildReading(rates, r, theta, events);
            return reading;
        },

        read() {
            return reading;
        },
    });
}
