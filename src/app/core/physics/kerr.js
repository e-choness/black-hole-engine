// Kerr spacetime helpers in double precision for the camera side of the ray tracer.
//
// Coordinates are Cartesian Kerr-Schild (CKS) with the spin along +z, signature (-,+,+,+),
// G = c = 1. The renderer measures lengths in Schwarzschild radii, so M = 0.5 by default;
// pass M = 1 to work in units of M. Four-vectors are arrays [t, x, y, z]. The metric is
// g = eta + f l l with
//   r^2 = (w + sqrt(w^2 + 4 a^2 z^2)) / 2,  w = x^2 + y^2 + z^2 - a^2,
//   f = 2 M r^3 / (r^4 + a^2 z^2),  l = (1, (r x + a y)/(r^2 + a^2), (r y - a x)/(r^2 + a^2), z/r)
// (Kerr 1963; Kerr & Schild 1965; Visser 2007, arXiv:0706.0622).

export const SHADER_MASS = 0.5;

function sq(x) {
    return x * x;
}

export function horizonRadius(a, M = SHADER_MASS) {
    return M + Math.sqrt(Math.max(M * M - a * a, 0));
}

export function innerHorizonRadius(a, M = SHADER_MASS) {
    return M - Math.sqrt(Math.max(M * M - a * a, 0));
}

// Innermost stable circular orbit in the equatorial plane (Bardeen, Press & Teukolsky 1972).
// "prograde" means co-rotating with the hole.
export function iscoRadius(a, prograde = true, M = SHADER_MASS) {
    const chi = Math.min(Math.abs(a) / M, 1);
    const z1 = 1 + Math.cbrt(1 - chi * chi) * (Math.cbrt(1 + chi) + Math.cbrt(1 - chi));
    const z2 = Math.sqrt(3 * chi * chi + z1 * z1);
    const sign = prograde ? -1 : 1;
    return M * (3 + z2 + sign * Math.sqrt(Math.max((3 - z1) * (3 + z1 + 2 * z2), 0)));
}

// Kerr-Schild radius. For w < 0 the root is rewritten to avoid cancellation.
export function ksRadius(x, y, z, a) {
    const a2 = a * a;
    const z2 = z * z;
    const w = x * x + y * y + z2 - a2;
    const q = Math.sqrt(w * w + 4 * a2 * z2);
    let r2;
    if (w >= 0) {
        r2 = 0.5 * (w + q);
    } else {
        const denom = q - w;
        r2 = denom > 0 ? (2 * a2 * z2) / denom : 0;
    }
    return Math.sqrt(Math.max(r2, 0));
}

export function ksGeometry(pos, a, M = SHADER_MASS) {
    const [x, y, z] = pos;
    const r = ksRadius(x, y, z, a);
    const ra2 = r * r + a * a;
    const D = Math.max(r * r * r * r + a * a * z * z, 1e-300);
    const f = (2 * M * r * r * r) / D;
    const l = [(r * x + a * y) / ra2, (r * y - a * x) / ra2, z / Math.max(r, 1e-300)];
    const sin2 = (x * x + y * y) / ra2;
    return { r, f, l, D, ra2, sin2 };
}

export function metric(pos, a, M = SHADER_MASS) {
    const { f, l } = ksGeometry(pos, a, M);
    const lc = [1, l[0], l[1], l[2]];
    const g = [];
    for (let mu = 0; mu < 4; mu++) {
        g.push([]);
        for (let nu = 0; nu < 4; nu++) {
            const eta = mu === nu ? (mu === 0 ? -1 : 1) : 0;
            g[mu].push(eta + f * lc[mu] * lc[nu]);
        }
    }
    return g;
}

export function dot4(g, u, v) {
    let s = 0;
    for (let mu = 0; mu < 4; mu++) {
        for (let nu = 0; nu < 4; nu++) s += g[mu][nu] * u[mu] * v[nu];
    }
    return s;
}

export function lower(g, v) {
    return g.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2] + row[3] * v[3]);
}

// Boyer-Lindquist quantities at a CKS point: Delta, rho^2, the 𝒜 function, the lapse alpha of
// the zero-angular-momentum observer, its angular velocity omega and the cylindrical radius
// varpi of the axial Killing vector.
export function blQuantities(pos, a, M = SHADER_MASS) {
    const { r, sin2, ra2 } = ksGeometry(pos, a, M);
    const cos2 = 1 - sin2;
    const delta = r * r - 2 * M * r + a * a;
    const rho2 = r * r + a * a * cos2;
    const bigA = ra2 * ra2 - a * a * delta * sin2;
    const alpha = Math.sqrt(Math.max((rho2 * delta) / bigA, 0));
    const omega = (2 * M * a * r) / bigA;
    const varpi = Math.sqrt(Math.max((bigA * sin2) / rho2, 0));
    return { r, delta, rho2, bigA, alpha, omega, varpi, sin2 };
}

// Stationary observer u = u^t (d_t + Omega d_phi) with d_phi = -y d_x + x d_y, using
// g(xi, xi) = -1 + Omega^2 (x^2 + y^2) + f (1 - Omega a sin^2 theta)^2. Returns null where this
// worldline is not timelike.
export function stationaryVelocity(pos, omega, a, M = SHADER_MASS) {
    const [x, y] = pos;
    const { f, sin2 } = ksGeometry(pos, a, M);
    const norm = 1 - omega * omega * (x * x + y * y) - f * sq(1 - omega * a * sin2);
    if (!(norm > 0)) return null;
    const ut = 1 / Math.sqrt(norm);
    return [ut, -omega * y * ut, omega * x * ut, 0];
}

// Static observer: only exists outside the ergosurface (f < 1).
export function staticVelocity(pos, a, M = SHADER_MASS) {
    return stationaryVelocity(pos, 0, a, M);
}

export function zamoVelocity(pos, a, M = SHADER_MASS) {
    return stationaryVelocity(pos, blQuantities(pos, a, M).omega, a, M);
}

// Keplerian angular velocity of a circular equatorial geodesic. sense = +1 orbits
// counter-clockwise about +z, -1 clockwise; a is signed, so sense = sign(a) is prograde.
export function keplerAngularVelocity(r, a, sense = 1, M = SHADER_MASS) {
    const sqrtM = Math.sqrt(M);
    return (sense * sqrtM) / (Math.pow(r, 1.5) + sense * a * sqrtM);
}

// Speed of a stationary observer relative to the local ZAMO: v = varpi (Omega - omega) / alpha.
export function speedRelativeToZamo(pos, omega, a, M = SHADER_MASS) {
    const q = blQuantities(pos, a, M);
    return (q.varpi * (omega - q.omega)) / q.alpha;
}

// Doran (2000) rain observer: falls from rest at infinity with L_z = 0 and Q = 0. Regular at
// every r > 0, so it carries the dive camera through the horizon. In CKS form
//   U_r = -sqrt(2Mr) / (sqrt(r^2 + a^2) + sqrt(2Mr)),  u_mu = (-1, U_r grad r),
//   u^t = 1 + f (1 + U_r),  u^i = U_r d_i r - f (1 + U_r) l_i.
export function rainVelocity(pos, a, M = SHADER_MASS) {
    const [x, y, z] = pos;
    const { r, f, l, D, ra2 } = ksGeometry(pos, a, M);
    const s = Math.sqrt(2 * M * r);
    const Ur = -s / (Math.sqrt(ra2) + s);
    const k = (r * r * r) / D;
    const gradR = [x * k, y * k, (z * r * ra2) / D];
    const c = f * (1 + Ur);
    return [1 + c, Ur * gradR[0] - c * l[0], Ur * gradR[1] - c * l[1], Ur * gradR[2] - c * l[2]];
}

// Radial rate dr/dtau of the rain observer: -sqrt(2 M r (r^2 + a^2)) / rho^2.
export function rainRadialRate(r, cosTheta, a, M = SHADER_MASS) {
    const rho2 = r * r + a * a * cosTheta * cosTheta;
    return -Math.sqrt(2 * M * r * (r * r + a * a)) / rho2;
}

function normalizeSpacelike(g, v) {
    const n = Math.sqrt(Math.max(dot4(g, v, v), 1e-300));
    return v.map((c) => c / n);
}

function projectOut(g, v, u) {
    const c = dot4(g, v, u);
    return v.map((vi, i) => vi + c * u[i]);
}

// Boosts the observer u along the spatial coordinate direction dir3 (projected into the rest
// space of u) with speed beta: u' = gamma (u + beta e).
export function boostVelocity(g, u, dir3, beta) {
    const e = normalizeSpacelike(g, projectOut(g, [0, dir3[0], dir3[1], dir3[2]], u));
    const gamma = 1 / Math.sqrt(Math.max(1 - beta * beta, 1e-12));
    return u.map((ui, i) => gamma * (ui + beta * e[i]));
}

// Orthonormal tetrad of the observer u, built by Gram-Schmidt from the camera's right, up and
// forward vectors so that e3 looks forward. Returns contravariant and lowered vectors.
export function cameraTetrad(g, u, right, up, forward) {
    const R = [0, right[0], right[1], right[2]];
    const U = [0, up[0], up[1], up[2]];
    const F = [0, forward[0], forward[1], forward[2]];
    const e3 = normalizeSpacelike(g, projectOut(g, F, u));
    let e2 = projectOut(g, U, u);
    const c23 = dot4(g, e2, e3);
    e2 = normalizeSpacelike(
        g,
        e2.map((v, i) => v - c23 * e3[i]),
    );
    let e1 = projectOut(g, R, u);
    const c13 = dot4(g, e1, e3);
    const c12 = dot4(g, e1, e2);
    e1 = normalizeSpacelike(
        g,
        e1.map((v, i) => v - c13 * e3[i] - c12 * e2[i]),
    );
    return {
        u,
        e1,
        e2,
        e3,
        uLower: lower(g, u),
        e1Lower: lower(g, e1),
        e2Lower: lower(g, e2),
        e3Lower: lower(g, e3),
    };
}

// Components (c0, c1, c2, c3) of the 4-velocity uRef in the tetrad. A photon that the tetrad
// observer sees with unit frequency along look direction d has frequency c0 + c.d for uRef.
export function observerComponents(g, tetrad, uRef) {
    return [
        -dot4(g, uRef, tetrad.u),
        dot4(g, uRef, tetrad.e1),
        dot4(g, uRef, tetrad.e2),
        dot4(g, uRef, tetrad.e3),
    ];
}

// Proper time per unit coordinate time for any observer with contravariant u.
export function clockRate(u) {
    return u ? 1 / u[0] : 0;
}

// Proper acceleration of the static observer, |grad ln sqrt(1 - f)|, in units of 1/length.
export function staticAcceleration(pos, a, M = SHADER_MASS) {
    const [x, y, z] = pos;
    const { r, f, l, D, ra2 } = ksGeometry(pos, a, M);
    if (!(f < 1)) return Infinity;
    const k = (r * r * r) / D;
    const gradR = [x * k, y * k, (z * r * ra2) / D];
    const radial = 3 / r - (4 * r * r * r) / D;
    const df = [
        f * radial * gradR[0],
        f * radial * gradR[1],
        f * (radial * gradR[2] - (2 * a * a * z) / D),
    ];
    const ldf = l[0] * df[0] + l[1] * df[1] + l[2] * df[2];
    const norm2 = df[0] * df[0] + df[1] * df[1] + df[2] * df[2] - f * ldf * ldf;
    return Math.sqrt(Math.max(norm2, 0)) / (2 * (1 - f));
}

// CKS point at Kerr-Schild radius r in the direction (theta, phi) of the unit vector dir.
export function cksPosition(r, dir, a) {
    const rho = Math.sqrt(r * r + a * a);
    return [rho * dir[0], rho * dir[1], r * dir[2]];
}
