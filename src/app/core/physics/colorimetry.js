// Blackbody colorimetry: Planck's law integrated against the CIE 1931 2-degree observer, whose
// colour matching functions are the multi-lobe Gaussian fit of Wyman, Sloan & Shirley (2013),
// JCGT 2(2):1-11, and converted to linear sRGB (IEC 61966-2-1, D65).

const PLANCK_H = 6.62607015e-34;
const LIGHT_C = 2.99792458e8;
const BOLTZMANN_K = 1.380649e-23;

export const STEFAN_BOLTZMANN = 5.670374419e-8;
export const LUMINOUS_EFFICACY_MAX = 683;

export const LAMBDA_MIN_NM = 360;
export const LAMBDA_MAX_NM = 830;

export const XYZ_TO_LINEAR_SRGB = [
    [3.2404542, -1.5371385, -0.4985314],
    [-0.969266, 1.8760108, 0.041556],
    [0.0556434, -0.2040259, 1.0572252],
];

// Y row of the inverse matrix: the luminance of a linear sRGB triple.
export const SRGB_LUMINANCE = [0.2126729, 0.7151522, 0.072175];

// The blackbody LUT spans 500 K to 1e6 K on a logarithmic grid; above it the visible band is in
// the Rayleigh-Jeans limit, where the chromaticity is fixed and Y grows linearly with T.
export const LUT_T_MIN = 500;
export const LUT_T_MAX = 1e6;
export const LUT_SIZE = 512;

// Spectral indices covered by the power-law row of the emission LUT.
export const LUT_ALPHA_MIN = -1;
export const LUT_ALPHA_MAX = 3;

// Bolometric radiances are expressed as luminance through the efficacy of a 6504 K blackbody,
// so the bolometric and visible radiance models agree for a D65-white emitter.
export const BOLOMETRIC_REFERENCE_T = 6504;

function lobe(x, mu, sigmaLow, sigmaHigh) {
    const t = (x - mu) / (x < mu ? sigmaLow : sigmaHigh);
    return Math.exp(-0.5 * t * t);
}

export function cieXBar(nm) {
    return (
        1.056 * lobe(nm, 599.8, 37.9, 31.0) +
        0.362 * lobe(nm, 442.0, 16.0, 26.7) -
        0.065 * lobe(nm, 501.1, 20.4, 26.2)
    );
}

export function cieYBar(nm) {
    return 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
}

export function cieZBar(nm) {
    return 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
}

// Spectral radiance B_lambda in W m^-2 sr^-1 m^-1; c2 = hc/k unless given (CIE illuminant A
// is defined with c2 = 1.435e-2 m K).
export function planckRadiance(nm, temperature, c2 = (PLANCK_H * LIGHT_C) / BOLTZMANN_K) {
    const lambda = nm * 1e-9;
    const c1 = 2 * PLANCK_H * LIGHT_C * LIGHT_C;
    return c1 / lambda ** 5 / Math.expm1(c2 / (lambda * temperature));
}

// Tristimulus integrals of a spectrum S(lambda) (per metre of wavelength) by the rectangle
// rule on [360, 830] nm.
export function spectrumXYZ(spectrum, stepNm = 0.1) {
    const n = Math.round((LAMBDA_MAX_NM - LAMBDA_MIN_NM) / stepNm);
    const dLambda = stepNm * 1e-9;
    let X = 0;
    let Y = 0;
    let Z = 0;
    for (let i = 0; i <= n; i++) {
        const nm = LAMBDA_MIN_NM + i * stepNm;
        const s = spectrum(nm) * dLambda;
        X += s * cieXBar(nm);
        Y += s * cieYBar(nm);
        Z += s * cieZBar(nm);
    }
    return [X, Y, Z];
}

export function blackbodyXYZ(temperature, stepNm = 0.1) {
    return spectrumXYZ((nm) => planckRadiance(nm, temperature), stepNm);
}

export function chromaticity([X, Y, Z]) {
    const s = X + Y + Z;
    return [X / s, Y / s];
}

export function xyzToLinearSrgb([X, Y, Z]) {
    return XYZ_TO_LINEAR_SRGB.map((row) => row[0] * X + row[1] * Y + row[2] * Z);
}

// Linear sRGB with unit luminance. Colours outside the gamut (blackbodies below about 1900 K)
// are desaturated towards the achromatic axis until no channel is negative, which keeps Y.
export function unitLuminanceSrgb(xyz) {
    const rgb = xyzToLinearSrgb(xyz).map((c) => c / xyz[1]);
    const low = Math.min(rgb[0], rgb[1], rgb[2]);
    if (low >= 0) return rgb;
    const s = -low / (1 - low);
    return rgb.map((c) => Math.max(c + s * (1 - c), 0));
}

export function luminance(rgb) {
    return SRGB_LUMINANCE[0] * rgb[0] + SRGB_LUMINANCE[1] * rgb[1] + SRGB_LUMINANCE[2] * rgb[2];
}

// Bradford cone-response matrix (Lam 1985), as tabulated by Lindbloom.
const BRADFORD = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
];

function applyMatrix(m, v) {
    return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

function multiplyMatrices(a, b) {
    return a.map((row) =>
        [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]),
    );
}

export function invertMatrix(m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m;
    const adjugate = [
        [e * i - f * h, c * h - b * i, b * f - c * e],
        [f * g - d * i, a * i - c * g, c * d - a * f],
        [d * h - e * g, b * g - a * h, a * e - b * d],
    ];
    const det = a * adjugate[0][0] + b * adjugate[1][0] + c * adjugate[2][0];
    return adjugate.map((row) => row.map((v) => v / det));
}

// White balance as a row-major linear-sRGB matrix: Bradford adaptation (Lindbloom) from the white
// of a blackbody at `temperature` to the D65 white of sRGB, so that blackbody renders neutral.
// M = RGB<-XYZ . B^-1 diag(B w_D65 / B w_bb) B . XYZ<-RGB.
export function whiteBalanceMatrix(temperature) {
    const toXyz = invertMatrix(XYZ_TO_LINEAR_SRGB);
    const [x, y] = chromaticity(blackbodyXYZ(temperature, 1));
    const coneD65 = applyMatrix(BRADFORD, applyMatrix(toXyz, [1, 1, 1]));
    const coneSource = applyMatrix(BRADFORD, [x / y, 1, (1 - x - y) / y]);
    const scaled = BRADFORD.map((row, k) => row.map((v) => (v * coneD65[k]) / coneSource[k]));
    const adapt = multiplyMatrices(invertMatrix(BRADFORD), scaled);
    return multiplyMatrices(XYZ_TO_LINEAR_SRGB, multiplyMatrices(adapt, toXyz));
}

export function lutTemperature(index) {
    return LUT_T_MIN * (LUT_T_MAX / LUT_T_MIN) ** (index / (LUT_SIZE - 1));
}

// Luminous efficacy (lm/W) of a blackbody: photometric luminance over total radiance sigma T^4/pi.
export function blackbodyEfficacy(temperature) {
    const Yv = LUMINOUS_EFFICACY_MAX * blackbodyXYZ(temperature)[1];
    return Yv / ((STEFAN_BOLTZMANN * temperature ** 4) / Math.PI);
}

// Emission LUT, two rows of LUT_SIZE RGBA entries: the blackbody row holds the unit-luminance
// linear sRGB chromaticity and log10 of the luminance in cd/m^2 on the log-T grid; the power-law
// row holds the unit-luminance colour of F_nu ~ nu^-alpha on a linear alpha grid.
export function buildEmissionLut() {
    const blackbody = new Array(LUT_SIZE * 4);
    const powerLaw = new Array(LUT_SIZE * 4);
    for (let i = 0; i < LUT_SIZE; i++) {
        const xyz = blackbodyXYZ(lutTemperature(i));
        const rgb = unitLuminanceSrgb(xyz);
        blackbody.splice(
            4 * i,
            4,
            rgb[0],
            rgb[1],
            rgb[2],
            Math.log10(LUMINOUS_EFFICACY_MAX * xyz[1]),
        );
        const alpha = LUT_ALPHA_MIN + ((LUT_ALPHA_MAX - LUT_ALPHA_MIN) * i) / (LUT_SIZE - 1);
        powerLaw.splice(4 * i, 4, ...powerLawSrgb(alpha), 0);
    }
    return {
        size: LUT_SIZE,
        tMin: LUT_T_MIN,
        tMax: LUT_T_MAX,
        alphaMin: LUT_ALPHA_MIN,
        alphaMax: LUT_ALPHA_MAX,
        bolometricEfficacy: blackbodyEfficacy(BOLOMETRIC_REFERENCE_T),
        blackbody,
        powerLaw,
    };
}

// Unit-luminance colour of an optically thin synchrotron power law F_nu ~ nu^-alpha, that is
// F_lambda ~ lambda^(alpha - 2). Its hue does not change under a Doppler shift.
export function powerLawSrgb(alpha) {
    return unitLuminanceSrgb(spectrumXYZ((nm) => nm ** (alpha - 2), 1));
}

// Linear interpolation in log T over a LUT object, mirroring the shader lookup. Above tMax the
// visible band is Rayleigh-Jeans, Y(T) = A T - B + O(1/T), so Y continues along its tangent at
// tMax, whose log-log slope 1 + B / (A tMax) comes from the last two entries.
export function sampleBlackbodyLut(lut, temperature) {
    const span = Math.log(lut.tMax / lut.tMin);
    const u = (Math.log(Math.max(temperature, lut.tMin) / lut.tMin) / span) * (lut.size - 1);
    const i = Math.min(Math.floor(u), lut.size - 2);
    const f = Math.min(u - i, 1);
    const row = (k) => lut.blackbody.slice(4 * k, 4 * k + 4);
    const a = row(i);
    const b = row(i + 1);
    const out = a.map((v, k) => v + (b[k] - v) * f);
    if (temperature > lut.tMax) {
        const n = lut.size - 1;
        const slope = ((out[3] - lut.blackbody[4 * n - 1]) * n) / Math.log10(lut.tMax / lut.tMin);
        out[3] += Math.log10(1 + slope * (temperature / lut.tMax - 1));
    }
    return { rgb: out.slice(0, 3), log10Y: out[3] };
}
