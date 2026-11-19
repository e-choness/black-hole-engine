// Kerr black-hole geometry in geometric units: G = c = M = 1, so radii are in GM/c^2 and times in
// GM/c^3. The spin a = Jc/(GM^2) is dimensionless with |a| <= 1.
//
// Orbit functions take a signed spin, following Bardeen, Press & Teukolsky (1972, ApJ 178, 347,
// doi:10.1086/151796; "BPT72" below): a > 0 for an orbit that co-rotates with the hole (prograde)
// and a < 0 for a counter-rotating one. Horizons and the ergosurface depend only on |a|.

export function assertSpin(a) {
    if (typeof a !== 'number' || !Number.isFinite(a) || Math.abs(a) > 1) {
        throw new RangeError(`spin must be a finite number in [-1, 1], got ${a}`);
    }
    return a;
}

function orbitSign(a) {
    return a < 0 ? -1 : 1;
}

// r_± = M ± sqrt(M^2 - a^2).
export function horizonRadii(a) {
    assertSpin(a);
    const s = Math.sqrt(Math.max(0, 1 - a * a));
    return { outer: 1 + s, inner: 1 - s };
}

// Static limit g_tt = 0: r_E(theta) = M + sqrt(M^2 - a^2 cos^2 theta). It equals 2M at the equator
// for every spin and touches the outer horizon on the axis.
export function ergosphereRadius(a, theta = Math.PI / 2) {
    assertSpin(a);
    const c = Math.cos(theta);
    return 1 + Math.sqrt(Math.max(0, 1 - a * a * c * c));
}

// Innermost stable circular orbit (BPT72).
export function iscoRadius(a) {
    assertSpin(a);
    const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
    const z2 = Math.sqrt(3 * a * a + z1 * z1);
    return 3 + z2 - orbitSign(a) * Math.sqrt(Math.max(0, (3 - z1) * (3 + z1 + 2 * z2)));
}

// Equatorial circular photon orbit (BPT72).
export function photonOrbitRadius(a) {
    assertSpin(a);
    return 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
}

// Marginally bound circular orbit, E = 1 (BPT72).
export function marginallyBoundRadius(a) {
    assertSpin(a);
    return 2 - a + 2 * Math.sqrt(1 - a);
}

// r^{3/2} - 3 r^{1/2} + 2a is positive exactly where timelike circular orbits exist (r > r_ph).
function circularDenominator(r, a) {
    return r ** 1.5 - 3 * Math.sqrt(r) + 2 * a;
}

// Specific energy E = -u_t, specific angular momentum L = u_phi and u^t = dt/dtau of an equatorial
// circular geodesic (BPT72). NaN where no timelike circular orbit exists.
export function circularOrbitEnergy(r, a) {
    const d = circularDenominator(r, a);
    return d > 0 ? (r ** 1.5 - 2 * Math.sqrt(r) + a) / (r ** 0.75 * Math.sqrt(d)) : NaN;
}

export function circularOrbitAngularMomentum(r, a) {
    const d = circularDenominator(r, a);
    return d > 0 ? (r * r - 2 * a * Math.sqrt(r) + a * a) / (r ** 0.75 * Math.sqrt(d)) : NaN;
}

export function circularOrbitUt(r, a) {
    const d = circularDenominator(r, a);
    return d > 0 ? (r ** 1.5 + a) / (r ** 0.75 * Math.sqrt(d)) : NaN;
}

// Coordinate angular velocity of a circular orbit, Omega = dphi/dt = 1/(r^{3/2} + a).
export function keplerAngularVelocity(r, a) {
    return 1 / (r ** 1.5 + a);
}

// Novikov-Thorne efficiency eta = 1 - E_isco.
export function radiativeEfficiency(a) {
    return 1 - circularOrbitEnergy(iscoRadius(a), a);
}

// Orbital and epicyclic frequencies in units of 1/(GM/c^3) for the relativistic precession model
// (Stella & Vietri 1998, arXiv:astro-ph/9709085): the nodal (Lense-Thirring) frequency is
// nu_phi - nu_theta and the periastron precession frequency is nu_phi - nu_r.
export function epicyclicFrequencies(r, a) {
    const orbital = 1 / (2 * Math.PI * (r ** 1.5 + a));
    const radial2 = 1 - 6 / r + (8 * a) / r ** 1.5 - (3 * a * a) / (r * r);
    const vertical2 = 1 - (4 * a) / r ** 1.5 + (3 * a * a) / (r * r);
    const radial = orbital * Math.sqrt(Math.max(0, radial2));
    const vertical = orbital * Math.sqrt(Math.max(0, vertical2));
    return {
        orbital,
        radial,
        vertical,
        nodal: orbital - vertical,
        periastron: orbital - radial,
    };
}

// Boyer-Lindquist metric functions (BPT72): rho^2 = r^2 + a^2 cos^2 theta, Delta = r^2 - 2r + a^2,
// A = (r^2 + a^2)^2 - a^2 Delta sin^2 theta, the lapse alpha = sqrt(rho^2 Delta / A) of the
// zero-angular-momentum observer (ZAMO), the frame-dragging rate omega = 2ar/A and the cylindrical
// radius varpi = sqrt(A) sin(theta) / rho. The lapse is NaN at and inside the outer horizon, where
// no observer can stay at fixed r.
export function boyerLindquistFunctions(r, theta, a) {
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const rho2 = r * r + a * a * cos * cos;
    const delta = r * r - 2 * r + a * a;
    const sum = r * r + a * a;
    const A = sum * sum - a * a * delta * sin * sin;
    const outside = r > horizonRadii(a).outer;
    return {
        rho2,
        delta,
        A,
        lapse: outside ? Math.sqrt((rho2 * delta) / A) : NaN,
        frameDragging: (2 * a * r) / A,
        cylindricalRadius: (Math.sqrt(A) * Math.abs(sin)) / Math.sqrt(rho2),
    };
}

// The closed-form disk flux has coincident roots at |a| = 1, so disk quantities use the largest
// spin it resolves cleanly; accretion spins holes up only to the Thorne limit a = 0.998 anyway.
const MAX_DISK_SPIN = 0.9999;

function clampDiskSpin(a) {
    assertSpin(a);
    return Math.max(-MAX_DISK_SPIN, Math.min(MAX_DISK_SPIN, a));
}

// Comoving flux from one face of a Novikov-Thorne thin disk with zero torque at the ISCO, in units
// of 3 Mdot c^6 / (8 pi G^2 M^2), in the closed form of Page & Thorne (1974, ApJ 191, 499,
// doi:10.1086/152990): x = sqrt(r), x0 = sqrt(r_isco) and x1, x2, x3 are the roots of
// x^3 - 3x + 2a = 0. Zero at and inside the ISCO; tends to the Newtonian 1/x^6 at large r.
export function novikovThorneFlux(r, a) {
    const spin = clampDiskSpin(a);
    const rIn = iscoRadius(spin);
    if (!(r > rIn)) return 0;
    const x = Math.sqrt(r);
    const x0 = Math.sqrt(rIn);
    const third = Math.acos(spin) / 3;
    const roots = [
        2 * Math.cos(third - Math.PI / 3),
        2 * Math.cos(third + Math.PI / 3),
        -2 * Math.cos(third),
    ];
    let bracket = x - x0 - 1.5 * spin * Math.log(x / x0);
    for (let i = 0; i < 3; i += 1) {
        const xi = roots[i];
        // The x2 term vanishes as a -> 0 (x2 -> 2a/3) and is numerically 0/0 there.
        if (Math.abs(xi) < 1e-6) continue;
        const xj = roots[(i + 1) % 3];
        const xk = roots[(i + 2) % 3];
        const weight = (3 * (xi - spin) ** 2) / (xi * (xi - xj) * (xi - xk));
        bracket -= weight * Math.log((x - xi) / (x0 - xi));
    }
    return bracket / (x ** 4 * (x ** 3 - 3 * x + 2 * spin));
}

// Radius (in M) and value of the flux maximum. The profile rises from zero at the ISCO, peaks
// within a factor of two of it and then falls off, so a golden-section search in ln r over
// [r_isco, 100 r_isco] converges to machine precision.
export function novikovThorneFluxPeak(a) {
    const spin = clampDiskSpin(a);
    const rIn = iscoRadius(spin);
    let lo = Math.log(rIn);
    let hi = Math.log(rIn * 100);
    const ratio = (Math.sqrt(5) - 1) / 2;
    const flux = (u) => novikovThorneFlux(Math.exp(u), spin);
    let c = hi - ratio * (hi - lo);
    let d = lo + ratio * (hi - lo);
    let fc = flux(c);
    let fd = flux(d);
    for (let i = 0; i < 100 && hi - lo > 1e-12; i += 1) {
        if (fc > fd) {
            hi = d;
            d = c;
            fd = fc;
            c = hi - ratio * (hi - lo);
            fc = flux(c);
        } else {
            lo = c;
            c = d;
            fc = fd;
            d = lo + ratio * (hi - lo);
            fd = flux(d);
        }
    }
    const radius = Math.exp((lo + hi) / 2);
    return { radius, flux: novikovThorneFlux(radius, spin) };
}

// Characteristic radii (in M) of a hole with spin a, with prograde and retrograde orbit branches.
export function kerrRadii(a) {
    assertSpin(a);
    const s = Math.abs(a);
    const horizons = horizonRadii(s);
    return {
        horizonOuter: horizons.outer,
        horizonInner: horizons.inner,
        ergosphereEquatorial: ergosphereRadius(s),
        ergospherePolar: ergosphereRadius(s, 0),
        iscoPrograde: iscoRadius(s),
        iscoRetrograde: iscoRadius(-s),
        photonOrbitPrograde: photonOrbitRadius(s),
        photonOrbitRetrograde: photonOrbitRadius(-s),
        marginallyBoundPrograde: marginallyBoundRadius(s),
        marginallyBoundRetrograde: marginallyBoundRadius(-s),
    };
}
