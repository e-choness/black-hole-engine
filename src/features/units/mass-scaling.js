// Physical (SI) scale of a black hole of mass M (in solar masses) and spin a. Everything else in
// the simulation is in geometric units, so lengths convert with r_g = GM/c^2 and times with
// t_g = GM/c^3.
//
// The spin is signed relative to the accretion disk and observer orbits, as in the renderer's spin
// control: a > 0 means the disk co-rotates with the hole, a < 0 that it counter-rotates. Horizons
// and the ergosphere use |a|; disk and orbit quantities use the signed value.

import {
    JULIAN_YEAR,
    PROTON_MASS,
    SOLAR_MASS,
    SOLAR_MASS_PARAMETER,
    SPEED_OF_LIGHT,
    STEFAN_BOLTZMANN,
    THOMSON_CROSS_SECTION,
} from './constants.js';
import {
    assertSpin,
    epicyclicFrequencies,
    iscoRadius,
    kerrRadii,
    novikovThorneFlux,
    novikovThorneFluxPeak,
    radiativeEfficiency,
} from './kerr.js';

const C2 = SPEED_OF_LIGHT * SPEED_OF_LIGHT;
const C3 = C2 * SPEED_OF_LIGHT;

// Geometric length units as multiples of GM/c^2: 'M' is the gravitational radius of the Kerr
// formulas and 'rs' the Schwarzschild radius 2GM/c^2 that the current renderer uses. The matching
// time units are GM/c^3 and r_s/c.
export const GEOMETRIC_UNITS = Object.freeze({ M: 1, rs: 2 });

export function geometricUnitFactor(unit = 'M') {
    if (!Object.hasOwn(GEOMETRIC_UNITS, unit)) {
        throw new RangeError(`unknown geometric unit "${unit}", expected "M" or "rs"`);
    }
    return GEOMETRIC_UNITS[unit];
}

export function convertGeometric(value, fromUnit, toUnit) {
    return (value * geometricUnitFactor(fromUnit)) / geometricUnitFactor(toUnit);
}

export function assertMass(massSolar) {
    if (typeof massSolar !== 'number' || !Number.isFinite(massSolar) || massSolar <= 0) {
        throw new RangeError(`mass must be a positive number of solar masses, got ${massSolar}`);
    }
    return massSolar;
}

export function massInKilograms(massSolar) {
    return assertMass(massSolar) * SOLAR_MASS;
}

export function gravitationalRadius(massSolar) {
    return (SOLAR_MASS_PARAMETER * assertMass(massSolar)) / C2;
}

export function schwarzschildRadius(massSolar) {
    return 2 * gravitationalRadius(massSolar);
}

export function gravitationalTime(massSolar) {
    return (SOLAR_MASS_PARAMETER * assertMass(massSolar)) / C3;
}

// L_Edd = 4 pi G M m_p c / sigma_T: radiation pressure on electrons (Thomson scattering) balances
// gravity on protons in ionised hydrogen.
export function eddingtonLuminosity(massSolar) {
    const gm = SOLAR_MASS_PARAMETER * assertMass(massSolar);
    return (4 * Math.PI * gm * PROTON_MASS * SPEED_OF_LIGHT) / THOMSON_CROSS_SECTION;
}

// Mdot_Edd = L_Edd / (eta c^2) in kg/s, with the Novikov-Thorne efficiency eta(a) of a disk that
// ends at the ISCO unless an explicit efficiency is given.
export function eddingtonAccretionRate(massSolar, spin = 0, { efficiency } = {}) {
    const eta = efficiency ?? radiativeEfficiency(assertSpin(spin));
    return eddingtonLuminosity(massSolar) / (eta * C2);
}

export function kilogramsPerSecondToSolarMassesPerYear(rate) {
    return (rate * JULIAN_YEAR) / SOLAR_MASS;
}

// 3 Mdot c^6 / (8 pi G^2 M^2) in W m^-2, the scale of the dimensionless novikovThorneFlux().
function diskFluxScale(massSolar, accretionRate) {
    const gm = SOLAR_MASS_PARAMETER * massSolar;
    return (3 * accretionRate * C3 * C3) / (8 * Math.PI * gm * gm);
}

function diskAccretionRate(massSolar, spin, eddingtonRatio) {
    if (typeof eddingtonRatio !== 'number' || !(eddingtonRatio >= 0)) {
        throw new RangeError(
            `Eddington ratio must be a non-negative number, got ${eddingtonRatio}`,
        );
    }
    return eddingtonRatio * eddingtonAccretionRate(massSolar, spin);
}

// Peak effective temperature T = (F / sigma_SB)^(1/4) of a Novikov-Thorne disk accreting at
// Mdot = mdot L_Edd / (eta c^2), so T scales as (mdot / (eta M))^(1/4). colorCorrection is the
// spectral hardening factor f_col (about 1.7 for stellar-mass disks, Shimura & Takahara 1995,
// doi:10.1086/175740); 1 gives the effective temperature. radiusM is the peak radius in M and
// flux the peak flux in W m^-2.
export function diskPeakTemperature(massSolar, spin, eddingtonRatio, { colorCorrection = 1 } = {}) {
    const rate = diskAccretionRate(massSolar, spin, eddingtonRatio);
    const peak = novikovThorneFluxPeak(spin);
    const flux = diskFluxScale(massSolar, rate) * peak.flux;
    return {
        temperature: colorCorrection * (flux / STEFAN_BOLTZMANN) ** 0.25,
        radiusM: peak.radius,
        flux,
    };
}

// Effective temperature at radius r (in M); zero inside the ISCO.
export function diskEffectiveTemperature(massSolar, spin, eddingtonRatio, r) {
    const rate = diskAccretionRate(massSolar, spin, eddingtonRatio);
    const flux = diskFluxScale(massSolar, rate) * novikovThorneFlux(r, spin);
    return (flux / STEFAN_BOLTZMANN) ** 0.25;
}

// Tidal acceleration across a body of the given length (m) at distance r (m): radial stretching
// 2GM l / r^3 and transverse compression GM l / r^3. Exact in the frame of a radial free-faller in
// Schwarzschild, where the relevant Riemann components are invariant under radial boosts (Misner,
// Thorne & Wheeler, Gravitation, 1973); approximate near a spinning hole.
export function tidalAcceleration(massSolar, radiusMeters, length = 2) {
    const k = (SOLAR_MASS_PARAMETER * assertMass(massSolar)) / radiusMeters ** 3;
    return { radial: 2 * k * length, transverse: k * length };
}

// Distance (m) at which the radial tidal stretch across `length` metres equals `acceleration`.
export function tidalRadius(massSolar, acceleration, length = 2) {
    return Math.cbrt((2 * SOLAR_MASS_PARAMETER * assertMass(massSolar) * length) / acceleration);
}

// Proper acceleration needed to hover at Schwarzschild radius r (in M):
// a = GM / (r^2 sqrt(1 - 2M/r)), which diverges at the horizon. NaN at and inside it.
export function staticObserverAcceleration(massSolar, r) {
    if (!(r > 2)) return NaN;
    const rg = gravitationalRadius(massSolar);
    return (SOLAR_MASS_PARAMETER * massSolar) / ((r * rg) ** 2 * Math.sqrt(1 - 2 / r));
}

// Frequency (Hz) of a circular equatorial orbit at r (in M) as seen from infinity,
// f = 1 / (2 pi t_g (r^{3/2} + a)).
export function orbitalFrequency(massSolar, r, spin = 0) {
    assertSpin(spin);
    return 1 / (2 * Math.PI * gravitationalTime(massSolar) * (r ** 1.5 + spin));
}

// Small-angle size (radians) of a length seen from a distance, both in metres.
export function angularSize(lengthMeters, distanceMeters) {
    return lengthMeters / distanceMeters;
}

function mapValues(object, fn) {
    return Object.freeze(
        Object.fromEntries(Object.entries(object).map(([key, value]) => [key, fn(value)])),
    );
}

// Bundles the scale of one black hole. Geometric inputs are in the unit named by `unit` ('M' by
// default, or 'rs'); physical outputs are SI (m, s, Hz, W, kg/s, K, m/s^2, rad). Fields ending
// in M are in units of GM/c^2.
export function createMassScale({ massSolar, spin = 0 } = {}) {
    assertMass(massSolar);
    assertSpin(spin);
    const rg = gravitationalRadius(massSolar);
    const tg = gravitationalTime(massSolar);
    const radiiM = Object.freeze(kerrRadii(spin));
    const diskInnerRadiusM = iscoRadius(spin);
    const efficiency = radiativeEfficiency(spin);
    const luminosity = eddingtonLuminosity(massSolar);
    const accretionRate = luminosity / (efficiency * C2);
    const iscoFrequency = orbitalFrequency(massSolar, diskInnerRadiusM, spin);

    const toM = (value, unit) => value * geometricUnitFactor(unit);

    return Object.freeze({
        massSolar,
        massKg: massSolar * SOLAR_MASS,
        spin,
        gravitationalRadius: rg,
        schwarzschildRadius: 2 * rg,
        gravitationalTime: tg,
        lightCrossingTime: 2 * tg,
        radiiM,
        radii: mapValues(radiiM, (value) => value * rg),
        radiiIn: (unit = 'M') => mapValues(radiiM, (value) => convertGeometric(value, 'M', unit)),
        diskInnerRadiusM,
        diskInnerRadius: diskInnerRadiusM * rg,
        radiativeEfficiency: efficiency,
        eddingtonLuminosity: luminosity,
        eddingtonAccretionRate: accretionRate,
        eddingtonAccretionRateSolarPerYear: kilogramsPerSecondToSolarMassesPerYear(accretionRate),
        iscoOrbitalFrequency: iscoFrequency,
        iscoOrbitalPeriod: 1 / iscoFrequency,

        toMeters: (value, unit = 'M') => toM(value, unit) * rg,
        toSeconds: (value, unit = 'M') => toM(value, unit) * tg,
        fromMeters: (meters, unit = 'M') => meters / rg / geometricUnitFactor(unit),
        fromSeconds: (seconds, unit = 'M') => seconds / tg / geometricUnitFactor(unit),
        angularScale: (distanceMeters) => angularSize(rg, distanceMeters),

        orbitalFrequency: (r, unit = 'M') => orbitalFrequency(massSolar, toM(r, unit), spin),
        epicyclicFrequencies: (r, unit = 'M') =>
            mapValues(epicyclicFrequencies(toM(r, unit), spin), (value) => value / tg),
        diskPeakTemperature: (eddingtonRatio, options) =>
            diskPeakTemperature(massSolar, spin, eddingtonRatio, options),
        diskEffectiveTemperature: (r, eddingtonRatio, unit = 'M') =>
            diskEffectiveTemperature(massSolar, spin, eddingtonRatio, toM(r, unit)),
        tidalAcceleration: (r, unit = 'M', length = 2) =>
            tidalAcceleration(massSolar, toM(r, unit) * rg, length),
        staticObserverAcceleration: (r, unit = 'M') =>
            staticObserverAcceleration(massSolar, toM(r, unit)),
    });
}
