// Closed-form Kerr references used by the tests: special radii, circular orbits and the
// shadow of a static observer (Schwarzschild) or a distant one (Bardeen 1973).

import {
    SHADER_MASS,
    keplerAngularVelocity,
    ksRadius,
    stationaryVelocity,
} from '../../src/app/core/physics/kerr.js';

const sq = (x) => x * x;

// Boundary of the ergoregion, where the static observer becomes null: g_tt = 0.
export function ergosurfaceRadius(a, cosTheta, M = SHADER_MASS) {
    return M + Math.sqrt(Math.max(M * M - a * a * cosTheta * cosTheta, 0));
}

// Circular equatorial photon orbit: r = 2M [1 + cos(2/3 arccos(-+chi))].
export function photonOrbitRadius(a, prograde = true, M = SHADER_MASS) {
    const chi = Math.min(Math.abs(a) / M, 1);
    const sign = prograde ? -1 : 1;
    return 2 * M * (1 + Math.cos((2 / 3) * Math.acos(sign * chi)));
}

// Marginally bound circular orbit: r = 2M -+ a + 2 sqrt(M (M -+ a)).
export function marginallyBoundRadius(a, prograde = true, M = SHADER_MASS) {
    const s = prograde ? Math.abs(a) : -Math.abs(a);
    return 2 * M - s + 2 * Math.sqrt(M * (M - s));
}

// 4-velocity on the circular orbit at the Keplerian angular velocity through pos, prograde for
// sense = 1 and retrograde for sense = -1.
export function circularOrbitVelocity(pos, a, sense = 1, M = SHADER_MASS) {
    const r = ksRadius(pos[0], pos[1], pos[2], a);
    return stationaryVelocity(pos, keplerAngularVelocity(r, a, sense, M), a, M);
}

// Angular radius of the Schwarzschild shadow seen by a static observer at r (in r_s), measured
// from the direction of the hole: sin(psi) = (3 sqrt(3) / 2)(r_s / r) sqrt(1 - r_s / r), with
// the obtuse branch inside the photon sphere (Synge 1966).
export function schwarzschildShadowAngle(r) {
    const s = Math.min(((3 * Math.sqrt(3)) / 2 / r) * Math.sqrt(Math.max(1 - 1 / r, 0)), 1);
    const psi = Math.asin(s);
    return r >= 1.5 ? psi : Math.PI - psi;
}

// Bardeen (1973) critical curve for a distant observer at inclination theta (radians), in
// units of M: returns the horizontal extent and the half-height of the shadow.
export function bardeenShadowExtent(a, theta, samples = 4000, M = 1) {
    const chi = a / M;
    if (Math.abs(chi) < 1e-9) {
        const radius = 3 * Math.sqrt(3) * M;
        return { alphaMin: -radius, alphaMax: radius, betaMax: radius };
    }
    const r1 = photonOrbitRadius(chi, true, 1);
    const r2 = photonOrbitRadius(chi, false, 1);
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    function curve(r) {
        const xi = -(r * r * r - 3 * r * r + chi * chi * r + chi * chi) / (chi * (r - 1));
        const eta = (r * r * r * (4 * chi * chi - r * sq(r - 3))) / (chi * chi * sq(r - 1));
        return { alpha: -xi / s, beta2: eta + chi * chi * c * c - (xi * xi * c * c) / (s * s) };
    }
    let alphaMin = Infinity;
    let alphaMax = -Infinity;
    let betaMax = 0;
    function include(point) {
        alphaMin = Math.min(alphaMin, point.alpha);
        alphaMax = Math.max(alphaMax, point.alpha);
        betaMax = Math.max(betaMax, Math.sqrt(Math.max(point.beta2, 0)));
    }
    // The horizontal extremes sit where beta^2 = 0, so sign changes are refined by bisection.
    let prevR = r1;
    let prev = curve(r1);
    if (prev.beta2 >= -1e-9) include(prev);
    for (let i = 1; i <= samples; i++) {
        const r = r1 + ((r2 - r1) * i) / samples;
        const point = curve(r);
        if (point.beta2 >= -1e-9) include(point);
        if (point.beta2 < 0 !== prev.beta2 < 0) {
            let lo = prevR;
            let hi = r;
            for (let k = 0; k < 60; k++) {
                const mid = 0.5 * (lo + hi);
                if (curve(mid).beta2 < 0 === prev.beta2 < 0) lo = mid;
                else hi = mid;
            }
            include({ alpha: curve(0.5 * (lo + hi)).alpha, beta2: 0 });
        }
        prevR = r;
        prev = point;
    }
    return { alphaMin: alphaMin * M, alphaMax: alphaMax * M, betaMax: betaMax * M };
}
