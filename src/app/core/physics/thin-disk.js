// Relativistic thin disk in units G = c = M = 1 with prograde spin a in [0, 1): Novikov-Thorne
// flux in the closed form of Page & Thorne (1974), circular-orbit kinematics (Bardeen, Press &
// Teukolsky 1972) and the plunging flow inside the ISCO (Cunningham 1975).

import { iscoRadius } from './kerr.js';
import { STEFAN_BOLTZMANN } from './colorimetry.js';

const LIGHT_C = 2.99792458e8;
const GM_SUN = 1.3271244e20;
const PROTON_MASS = 1.67262192369e-27;
const THOMSON_CROSS_SECTION = 6.6524587321e-29;

export function isco(a) {
    return iscoRadius(a, true, 1);
}

// Roots of x^3 - 3x + 2a = 0, the x = sqrt(r) of the denominators in the Page-Thorne bracket.
export function pageThorneRoots(a) {
    const third = Math.acos(a) / 3;
    return [
        2 * Math.cos(third - Math.PI / 3),
        2 * Math.cos(third + Math.PI / 3),
        -2 * Math.cos(third),
    ];
}

export function pageThorneBracket(x, a) {
    const x0 = Math.sqrt(isco(a));
    const [x1, x2, x3] = pageThorneRoots(a);
    let b = x - x0 - 1.5 * a * Math.log(x / x0);
    const terms = [
        [x1, x2, x3],
        [x2, x3, x1],
        [x3, x1, x2],
    ];
    for (const [xi, xj, xk] of terms) {
        // The x2 term vanishes as a -> 0, where x2 -> 2a/3 and its coefficient goes to zero.
        if (Math.abs(xi) < 1e-6) continue;
        const c = (3 * (xi - a) ** 2) / (xi * (xi - xj) * (xi - xk));
        b -= c * Math.log((x - xi) / (x0 - xi));
    }
    return b;
}

// Dimensionless comoving flux F(r) / (3 Mdot / (8 pi M^2)) from one face; zero inside the ISCO.
export function pageThorneFlux(r, a) {
    if (r <= isco(a)) return 0;
    const x = Math.sqrt(r);
    return pageThorneBracket(x, a) / (x ** 4 * (x ** 3 - 3 * x + 2 * a));
}

// Radius and value of the flux maximum, by golden-section search on [r_isco, 4 r_isco].
export function pageThornePeak(a) {
    const rIn = isco(a);
    let lo = rIn * (1 + 1e-9);
    let hi = 4 * rIn;
    const phi = (Math.sqrt(5) - 1) / 2;
    let c = hi - phi * (hi - lo);
    let d = lo + phi * (hi - lo);
    for (let i = 0; i < 200 && hi - lo > 1e-12 * rIn; i++) {
        if (pageThorneFlux(c, a) > pageThorneFlux(d, a)) hi = d;
        else lo = c;
        c = hi - phi * (hi - lo);
        d = lo + phi * (hi - lo);
    }
    const r = 0.5 * (lo + hi);
    return { r, flux: pageThorneFlux(r, a) };
}

function circularDenominator(r, a) {
    return r ** 0.75 * Math.sqrt(r ** 1.5 - 3 * Math.sqrt(r) + 2 * a);
}

export function circularEnergy(r, a) {
    return (r ** 1.5 - 2 * Math.sqrt(r) + a) / circularDenominator(r, a);
}

export function circularAngularMomentum(r, a) {
    return (r * r - 2 * a * Math.sqrt(r) + a * a) / circularDenominator(r, a);
}

export function circularUt(r, a) {
    return (r ** 1.5 + a) / circularDenominator(r, a);
}

export function keplerOmega(r, a) {
    return 1 / (r ** 1.5 + a);
}

// Radiative efficiency eta = 1 - E(r_isco).
export function efficiency(a) {
    return 1 - circularEnergy(isco(a), a);
}

// g = nu_obs / nu_emit for a circular equatorial emitter and a photon with conserved energy E and
// angular momentum Lz, both measured in units of the observed frequency: g = 1 / (u^t (E - Omega Lz)).
export function circularRedshift(r, a, Lz, E = 1) {
    return 1 / (circularUt(r, a) * (E - keplerOmega(r, a) * Lz));
}

// Boyer-Lindquist 4-velocity of gas that plunges from the ISCO with E and L of the ISCO orbit.
export function plungingVelocity(r, a) {
    const rIn = isco(a);
    const E = circularEnergy(rIn, a);
    const L = circularAngularMomentum(rIn, a);
    const delta = r * r - 2 * r + a * a;
    const P = E * (r * r + a * a) - a * L;
    const radial = P * P - delta * (r * r + (L - a * E) ** 2);
    return {
        ut: (((r * r + a * a) * P) / delta - a * (a * E - L)) / (r * r),
        ur: -Math.sqrt(Math.max(radial, 0)) / (r * r),
        uphi: ((a * P) / delta - (a * E - L)) / (r * r),
    };
}

// g = 1 / (-p.u) with p_t = -E, p_r and p_phi = Lz of the photon at the equator, in units of the
// observed frequency.
export function plungingRedshift(r, a, { E = 1, Lz, pr }) {
    const u = plungingVelocity(r, a);
    return 1 / (E * u.ut - pr * u.ur - Lz * u.uphi);
}

export function eddingtonLuminance(massSolar) {
    return (4 * Math.PI * GM_SUN * massSolar * PROTON_MASS * LIGHT_C) / THOMSON_CROSS_SECTION;
}

// Peak effective temperature (K) of a Novikov-Thorne disk around a hole of massSolar solar masses
// accreting at eddingtonRatio = L / L_Edd with Mdot = L / (eta c^2).
export function peakEffectiveTemperature(massSolar, eddingtonRatio, a) {
    const gm = GM_SUN * massSolar;
    const mdot = (eddingtonRatio * eddingtonLuminance(massSolar)) / (efficiency(a) * LIGHT_C ** 2);
    const scale = (3 * mdot * LIGHT_C ** 6) / (8 * Math.PI * gm * gm);
    return ((scale * pageThornePeak(a).flux) / STEFAN_BOLTZMANN) ** 0.25;
}
