// Clock rates of observers around a Kerr black hole, in geometric units G = c = M = 1, with the
// Boyer-Lindquist (BL) radius r and polar angle theta measured from the spin axis.
//
// Outside the horizon every observer ticks at dtau/dt = alpha / gamma against the distant time t:
// alpha is the lapse of the local zero-angular-momentum observer (ZAMO) and gamma the observer's
// Lorentz factor relative to that ZAMO (Bardeen, Press & Teukolsky 1972, doi:10.1086/151796). In
// Schwarzschild the ZAMO is the static observer.
//
// The free-fall observer is the Doran infaller, dropped from rest at infinity with zero angular
// momentum (E = 1, L = Q = 0, so theta stays constant; Doran 2000, arXiv:gr-qc/9910099). For a = 0 it
// is the Painleve-Gullstrand "rain" observer. Inside the horizon only this observer is modelled.

import {
    assertSpin,
    boyerLindquistFunctions,
    circularOrbitUt,
    ergosphereRadius,
    horizonRadii,
    iscoRadius,
    photonOrbitRadius,
} from '../units/kerr.js';

export const CLOCK_MODES = Object.freeze(['static', 'zamo', 'circular', 'freefall', 'moving']);

// The BL-to-Kerr-Schild time shift below has coincident horizon roots at |a| = 1.
export const MAX_CLOCK_SPIN = 0.9999;

export function clockSpin(a) {
    assertSpin(a);
    return Math.max(-MAX_CLOCK_SPIN, Math.min(MAX_CLOCK_SPIN, a));
}

// Radius where the free-fall clock stops: the inner (Cauchy) horizon r_- for a != 0, beyond which
// the Kerr interior is unstable to perturbations, and the singularity r = 0 for a = 0.
export function clockEndRadius(a) {
    return horizonRadii(clockSpin(a)).inner;
}

const GAUSS_NODES = [
    0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664,
];
const GAUSS_WEIGHTS = [
    0.5688888888888889, 0.47862867049936647, 0.47862867049936647, 0.23692688505618908,
    0.23692688505618908,
];

// Composite five-point Gauss-Legendre quadrature over [lo, hi] with panels of width <= 1/8.
function integrate(f, lo, hi) {
    const panels = Math.min(256, Math.max(1, Math.ceil(Math.abs(hi - lo) * 8)));
    const h = (hi - lo) / panels;
    let sum = 0;
    for (let p = 0; p < panels; p += 1) {
        const mid = lo + (p + 0.5) * h;
        for (let i = 0; i < 5; i += 1) {
            sum += GAUSS_WEIGHTS[i] * f(mid + 0.5 * h * GAUSS_NODES[i]);
        }
    }
    return 0.5 * h * sum;
}

// Proper time of the Doran infaller between radii rFrom >= rTo. From rho^2 dr/dtau =
// -sqrt(2r(r^2 + a^2)); with u = sqrt(r) the integrand 2(u^4 + a^2 cos^2 theta) / sqrt(2(u^4 + a^2))
// is smooth down to r = 0. For a = 0 it integrates to (2/3) r^{3/2} / sqrt(2).
export function freefallProperTime(rFrom, rTo, a = 0, theta = Math.PI / 2) {
    if (!(rFrom > rTo)) return 0;
    const spin = clockSpin(a);
    const a2 = spin * spin;
    const c2 = a2 * Math.cos(theta) ** 2;
    const integrand = (u) => {
        const u4 = u * u * u * u;
        return (2 * (u4 + c2)) / Math.sqrt(2 * (u4 + a2));
    };
    return integrate(integrand, Math.sqrt(Math.max(0, rTo)), Math.sqrt(rFrom));
}

// Kerr-Schild time minus Doran time changes by S(rFrom) - S(rTo) = int s dr along the infaller, with
// s(r) = 1 / (1 + sqrt((r^2 + a^2) / (2r))), because Doran time is the infaller's proper time and
// t_KS = t_Doran - S(r). s is bounded and smooth through both horizons; with u = sqrt(r) the
// integrand is 2u^2 / (u + sqrt((u^4 + a^2) / 2)).
export function doranTimeShift(rFrom, rTo, a = 0) {
    if (!(rFrom > rTo)) return 0;
    const a2 = clockSpin(a) ** 2;
    const integrand = (u) => (2 * u * u) / (u + Math.sqrt((u * u * u * u + a2) / 2));
    return integrate(integrand, Math.sqrt(Math.max(0, rTo)), Math.sqrt(rFrom));
}

// K(rFrom) - K(rTo) for the BL-to-Kerr-Schild time shift t_KS = t_BL + K(r), where
// K(r) = int 2r/Delta dr = (2 / (r+ - r-)) [r+ ln|r - r+| - r- ln|r - r-|]. Both radii must lie
// outside the outer horizon, where t_BL is defined.
export function kerrSchildTimeShift(rFrom, rTo, a = 0) {
    const { outer, inner } = horizonRadii(clockSpin(a));
    const width = outer - inner;
    let shift = ((2 * outer) / width) * Math.log((rFrom - outer) / (rTo - outer));
    if (inner > 0) shift -= ((2 * inner) / width) * Math.log((rFrom - inner) / (rTo - inner));
    return shift;
}

const Z_AXIS = Object.freeze([0, 0, 1]);

// BL radius and polar angle of a Cartesian Kerr-Schild position (all in units of M), with the
// spin along the unit vector `axis`. r solves (x^2 + y^2) / (r^2 + a^2) + z^2 / r^2 = 1, i.e.
// r^2 = (w + sqrt(w^2 + 4 a^2 z^2)) / 2 with w = |x|^2 - a^2 (Visser 2007, arXiv:0706.0622); the
// rationalised form avoids cancellation when w < 0. For a = 0 this is the Euclidean distance.
export function kerrSchildSpherical(position, a = 0, axis = Z_AXIS) {
    const [x, y, z] = position;
    const r2Cartesian = x * x + y * y + z * z;
    const along = x * axis[0] + y * axis[1] + z * axis[2];
    const a2 = a * a;
    const w = r2Cartesian - a2;
    const root = Math.sqrt(w * w + 4 * a2 * along * along);
    const r2 = w >= 0 ? (w + root) / 2 : (2 * a2 * along * along) / (root - w);
    const r = Math.sqrt(r2);
    const cosTheta = r > 0 ? Math.max(-1, Math.min(1, along / r)) : 0;
    return { r, theta: Math.acos(cosTheta) };
}

// Relativistic velocity addition (fractions of c, one orthonormal triad of the ZAMO): velocity
// relative to the ZAMO of an observer moving with `boost` in the frame of a base observer that moves
// with `base` relative to the ZAMO,
//   base (+) boost = [b + v / gamma_b + gamma_b / (1 + gamma_b) (b . v) b] / (1 + b . v).
// Feed the result to 'moving' mode as `velocity` to clock a camera boosted on top of a base
// observer (static, circular or the infaller, whose own ZAMO-frame velocity the caller knows).
export function addVelocities(base, boost) {
    const dot = base[0] * boost[0] + base[1] * boost[1] + base[2] * boost[2];
    const gamma = 1 / Math.sqrt(1 - Math.min(1, base[0] ** 2 + base[1] ** 2 + base[2] ** 2));
    const k = (gamma / (1 + gamma)) * dot;
    return base.map((b, i) => (b + boost[i] / gamma + k * b) / (1 + dot));
}

// Doran infaller: |dr/dtau| = sqrt(2r(r^2 + a^2)) / rho^2 and dt_KS/dtau = 1 + s(r) |dr/dtau|.
function freefallKerrSchildRate(r, theta, a) {
    const rho2 = r * r + a * a * Math.cos(theta) ** 2;
    const radialSpeed = Math.sqrt(2 * r * (r * r + a * a)) / rho2;
    const s = 1 / (1 + Math.sqrt((r * r + a * a) / (2 * r)));
    return 1 + s * radialSpeed;
}

const SPEED_LIMIT = 1 - 1e-12;

// Clock rate of an observer at radius r (in M) and polar angle theta for a requested mode:
//   static    hovering at fixed r, theta, phi; needs r outside the ergosurface, else the ZAMO is used
//   zamo      zero angular momentum, co-rotating with the frame dragging
//   circular  equatorial circular geodesic at r, prograde unless `retrograde`; below the photon
//             orbit no circular orbit exists and the ZAMO is used
//   freefall  the Doran infaller
//   moving    any worldline, given its speed relative to the local ZAMO
// Inside the horizon every mode falls back to the infaller. The result holds the mode actually
// used, the regime ('exterior', 'interior', or 'end' at r <= r_- with endReason 'singularity' or
// 'inner-horizon'), dTauDt = lapse / lorentzFactor, the speed relative to the ZAMO, the
// infaller's dtKSDtau and notices explaining fallbacks: inside-horizon, inside-ergosphere,
// no-circular-orbit, unstable-orbit, off-equatorial-orbit, speed-clamped. Quantities tied to the
// distant time t are null inside the horizon.
export function clockRates({
    mode = 'static',
    r,
    theta = Math.PI / 2,
    spin = 0,
    speed = 0,
    retrograde = false,
} = {}) {
    if (!CLOCK_MODES.includes(mode)) throw new RangeError(`unknown clock mode "${mode}"`);
    if (typeof r !== 'number' || !(r >= 0)) {
        throw new RangeError(`r must be a number >= 0, got ${r}`);
    }
    const a = clockSpin(spin);
    const horizons = horizonRadii(a);
    const notices = [];
    const base = {
        requestedMode: mode,
        notices,
        dtKSDtau: r > horizons.inner ? freefallKerrSchildRate(r, theta, a) : null,
    };

    if (r <= horizons.outer) {
        if (mode !== 'freefall') notices.push('inside-horizon');
        return {
            ...base,
            mode: 'freefall',
            regime: r <= horizons.inner ? 'end' : 'interior',
            endReason:
                r <= horizons.inner ? (horizons.inner > 0 ? 'inner-horizon' : 'singularity') : null,
            dTauDt: null,
            lapse: null,
            lorentzFactor: null,
            speed: null,
        };
    }

    let used = mode;
    let lapse = boyerLindquistFunctions(r, theta, a).lapse;
    let dTauDt;
    if (used === 'static') {
        if (r > ergosphereRadius(a, theta)) {
            dTauDt = Math.sqrt(1 - (2 * r) / (r * r + a * a * Math.cos(theta) ** 2));
        } else {
            used = 'zamo';
            notices.push('inside-ergosphere');
        }
    } else if (used === 'circular') {
        const signed = retrograde ? -a : a;
        if (r > photonOrbitRadius(signed)) {
            lapse = boyerLindquistFunctions(r, Math.PI / 2, a).lapse;
            dTauDt = 1 / circularOrbitUt(r, signed);
            if (r < iscoRadius(signed)) notices.push('unstable-orbit');
            if (a !== 0 && Math.abs(Math.cos(theta)) > 1e-6) notices.push('off-equatorial-orbit');
        } else {
            used = 'zamo';
            notices.push('no-circular-orbit');
        }
    } else if (used === 'moving') {
        if (typeof speed !== 'number' || !(speed >= 0)) {
            throw new RangeError(`speed must be a number >= 0, got ${speed}`);
        }
        let v = speed;
        if (v > SPEED_LIMIT) {
            v = SPEED_LIMIT;
            notices.push('speed-clamped');
        }
        dTauDt = lapse * Math.sqrt(1 - v * v);
    } else if (used === 'freefall') {
        dTauDt = lapse * lapse;
    }
    if (used === 'zamo') dTauDt = lapse;

    const lorentzFactor = Math.max(1, lapse / dTauDt);
    return {
        ...base,
        mode: used,
        regime: 'exterior',
        endReason: null,
        dTauDt,
        lapse,
        lorentzFactor,
        speed: Math.sqrt(Math.max(0, 1 - 1 / (lorentzFactor * lorentzFactor))),
    };
}
