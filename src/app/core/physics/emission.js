// Uniform values of the emission model: the disk temperature scale, the spin-dependent
// Page-Thorne coefficients, limb darkening, and the exposure that brings absolute luminance into
// the display range. Units: temperatures in K, luminance in cd/m^2, exposure as log2 factors.

import lut from './emission-lut.json';
import { STEFAN_BOLTZMANN, sampleBlackbodyLut, whiteBalanceMatrix } from './colorimetry.js';
import {
    circularAngularMomentum,
    circularEnergy,
    isco,
    pageThornePeak,
    pageThorneRoots,
    peakEffectiveTemperature,
} from './thin-disk.js';

export const EMISSION_LUT = lut;

// Prograde spin limit of the disk model (Thorne 1974).
export const DISK_SPIN_MAX = 0.998;

// Limb-darkening laws L(mu) = c0 + c1 mu, normalised to 2 int_0^1 L mu dmu = 1: Chandrasekhar's
// electron-scattering atmosphere (as in kerrbb, Li et al. 2005), Eddington, and isotropic.
export const LIMB_DARKENING_LAWS = {
    chandrasekhar: [0.4214, 0.4214 * 2.06],
    eddington: [0.5, 0.75],
    none: [1, 0],
};

// Display-referred luminance the reference emitter maps to at 0 EV in the anchored mode.
export const ANCHOR_LUMINANCE = 0.5;

// Range of the camera white balance in K.
export const WHITE_BALANCE_MIN = 1500;
export const WHITE_BALANCE_MAX = 40000;

const LOG2_10 = Math.log2(10);

// Single-entry cache for the per-frame uniform updates, which rarely change their inputs.
function memoizeLast(fn) {
    let lastKey;
    let lastValue;
    return (...args) => {
        const key = args.join(',');
        if (key !== lastKey) {
            lastKey = key;
            lastValue = fn(...args);
        }
        return lastValue;
    };
}

const cachedPeakTemperature = memoizeLast(peakEffectiveTemperature);
const cachedWhiteBalance = memoizeLast(whiteBalanceMatrix);

export function diskSpin(params) {
    const bh = params.black_hole;
    return bh.spin_enabled ? Math.min(Math.abs(bh.spin), DISK_SPIN_MAX) : 0;
}

// Page-Thorne bracket terms that depend on the spin only, so the shader evaluates the flux
// with a few logarithms per hit.
export const pageThorneUniforms = memoizeLast(function (a) {
    const roots = pageThorneRoots(a);
    const coeffs = roots.map((xi, i) => {
        const [xj, xk] = roots.filter((_, k) => k !== i);
        return Math.abs(xi) < 1e-6 ? 0 : (3 * (xi - a) ** 2) / (xi * (xi - xj) * (xi - xk));
    });
    const rIn = isco(a);
    return {
        x0: Math.sqrt(rIn),
        roots,
        coeffs,
        fluxMax: pageThornePeak(a).flux,
        iscoEnergy: circularEnergy(rIn, a),
        iscoAngularMomentum: circularAngularMomentum(rIn, a),
    };
});

// Effective temperature at the flux maximum: the artist value, or the Novikov-Thorne value of a
// hole of disk.mass_msun accreting at disk.eddington_ratio.
export function diskPeakTemperature(params) {
    const disk = params.disk;
    if (disk.temperature_mode === 'physical') {
        return cachedPeakTemperature(
            Math.max(disk.mass_msun, 1),
            Math.max(disk.eddington_ratio, 1e-6),
            diskSpin(params),
        );
    }
    return params.disk_temperature;
}

export function bolometricLog2Coefficient() {
    return Math.log2((lut.bolometricEfficacy * STEFAN_BOLTZMANN) / Math.PI);
}

// log2 of the luminance of a photosphere seen face-on without shift: f_col^-4 Y(f_col T) for the
// visible model, the efficacy-weighted sigma T^4 / pi for the bolometric one.
export function referenceLog2Luminance(temperature, colorCorrection, model) {
    if (model === 'visible') {
        const { log10Y } = sampleBlackbodyLut(lut, colorCorrection * temperature);
        return log10Y * LOG2_10 - 4 * Math.log2(colorCorrection);
    }
    return bolometricLog2Coefficient() + 4 * Math.log2(temperature);
}

// Pre-exposure H as log2. Anchored: the reference emitter lands at ANCHOR_LUMINANCE * 2^ev, so
// changing the temperature or the radiance model keeps the image level. Manual: the photometric
// H = 1 / (1.2 * 2^EV100) of a camera (Lagarde & de Rousiers 2014).
export function exposureLog2(look, log2Reference) {
    if (look.exposure_mode === 'manual') return -Math.log2(1.2) - look.ev100;
    return Math.log2(ANCHOR_LUMINANCE) + look.exposure_ev - log2Reference;
}

// Linear-sRGB white-balance matrix of the camera (row-major), or null when it is off.
export function whiteBalance(look) {
    if (!look.white_balance_enabled) return null;
    const t = Math.min(Math.max(look.white_balance_k, WHITE_BALANCE_MIN), WHITE_BALANCE_MAX);
    return cachedWhiteBalance(t);
}
