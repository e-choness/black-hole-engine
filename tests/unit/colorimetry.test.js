import { describe, expect, it } from 'vitest';
import {
    BOLOMETRIC_REFERENCE_T,
    LUT_SIZE,
    blackbodyEfficacy,
    blackbodyXYZ,
    buildEmissionLut,
    chromaticity,
    invertMatrix,
    luminance,
    planckRadiance,
    powerLawSrgb,
    sampleBlackbodyLut,
    spectrumXYZ,
    whiteBalanceMatrix,
    xyzToLinearSrgb,
} from '../../src/app/core/physics/colorimetry.js';
import committedLut from '../../src/app/core/physics/emission-lut.json';

const Y = (t) => blackbodyXYZ(t)[1];

describe('blackbody colorimetry (CIE 1931 2-degree, Wyman-Sloan-Shirley fit)', () => {
    it('reproduces the blackbody chromaticity table', () => {
        const table = [
            [5000, 0.3449, 0.3519],
            [6504, 0.3134, 0.3237],
            [10000, 0.2807, 0.2883],
            [1e9, 0.2401, 0.234],
        ];
        for (const [t, x, y] of table) {
            const [cx, cy] = chromaticity(blackbodyXYZ(t));
            expect(Math.abs(cx - x), `x at ${t} K`).toBeLessThan(6e-5);
            expect(Math.abs(cy - y), `y at ${t} K`).toBeLessThan(6e-5);
        }
    });

    it('stays within the fit error of CIE illuminant A (2856 K, c2 = 1.435e-2 m K)', () => {
        // The multi-lobe x-bar falls off too fast beyond 650 nm (half the tabulated value at
        // 700 nm), which shifts warm sources by dx = -1.75e-3, dy = +0.87e-3 at 2856 K.
        const [x, y] = chromaticity(spectrumXYZ((nm) => planckRadiance(nm, 2856, 1.435e-2)));
        expect(Math.abs(x - 0.44757)).toBeLessThan(2e-3);
        expect(Math.abs(y - 0.40745)).toBeLessThan(1e-3);
    });

    it('scales the band luminance of a shifted blackbody as Y(gT) / Y(T), not g^3', () => {
        expect(Y(10000) / Y(5000)).toBeCloseTo(14.433, 2);
        expect(Y(1e6) / Y(5000) / 6977.3).toBeCloseTo(1, 3);
        expect(Y(0.5 * 4500) / Y(4500) / 3.583e-3).toBeCloseTo(1, 2);
        expect(Y(2 * 5000) / Y(5000)).toBeCloseTo(14.43, 1);
        expect(Y(3 * 10000) / Y(10000)).toBeCloseTo(9.16, 1);
    });

    it('gives the luminous efficacy of a D65-white blackbody', () => {
        const efficacy = blackbodyEfficacy(BOLOMETRIC_REFERENCE_T);
        expect(efficacy).toBeGreaterThan(90);
        expect(efficacy).toBeLessThan(97);
    });
});

describe('emission LUT', () => {
    it('is the committed output of the generator', () => {
        const lut = buildEmissionLut();
        expect(committedLut.size).toBe(LUT_SIZE);
        expect(committedLut.bolometricEfficacy).toBeCloseTo(lut.bolometricEfficacy, 4);
        for (const row of ['blackbody', 'powerLaw']) {
            expect(committedLut[row]).toHaveLength(4 * LUT_SIZE);
            committedLut[row].forEach((v, i) => {
                expect(Math.abs(v - lut[row][i]), `${row}[${i}]`).toBeLessThan(
                    1e-6 * Math.max(1, Math.abs(v)),
                );
            });
        }
    });

    it('holds unit-luminance, in-gamut colours', () => {
        for (const row of ['blackbody', 'powerLaw']) {
            for (let i = 0; i < LUT_SIZE; i++) {
                const rgb = committedLut[row].slice(4 * i, 4 * i + 3);
                expect(Math.min(...rgb)).toBeGreaterThanOrEqual(0);
                expect(luminance(rgb)).toBeCloseTo(1, 5);
            }
        }
    });

    it('interpolates the absolute luminance in log T', () => {
        for (const t of [1234, 4500, 5772, 33333, 4.2e5]) {
            const { log10Y } = sampleBlackbodyLut(committedLut, t);
            expect(log10Y).toBeCloseTo(Math.log10(683 * Y(t)), 3);
        }
    });

    it('continues with the Rayleigh-Jeans law above 1e6 K', () => {
        const { log10Y } = sampleBlackbodyLut(committedLut, 1e9);
        expect(Math.abs(log10Y - Math.log10(683 * Y(1e9)))).toBeLessThan(2e-4);
        const edge = sampleBlackbodyLut(committedLut, 1e6).log10Y;
        expect(sampleBlackbodyLut(committedLut, 1.000001e6).log10Y).toBeCloseTo(edge, 6);
    });

    it('colours synchrotron power laws redder as the spectrum steepens', () => {
        const flat = powerLawSrgb(0);
        const steep = powerLawSrgb(2);
        expect(luminance(flat)).toBeCloseTo(1, 6);
        expect(steep[0] / steep[2]).toBeGreaterThan(flat[0] / flat[2]);
    });
});

describe('camera white balance', () => {
    const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

    it('renders the chosen blackbody neutral (Bradford adaptation to D65)', () => {
        for (const t of [2000, 4500, 6500, 12000]) {
            const rgb = apply(whiteBalanceMatrix(t), xyzToLinearSrgb(blackbodyXYZ(t, 1)));
            expect(rgb[0] / rgb[1], `R/G at ${t} K`).toBeCloseTo(1, 9);
            expect(rgb[2] / rgb[1], `B/G at ${t} K`).toBeCloseTo(1, 9);
        }
    });

    it('stays within the locus offset of identity at the 6504 K CCT of D65', () => {
        // D65 lies Duv = +0.0032 off the Planckian locus, which moves entries by up to 3.1%.
        whiteBalanceMatrix(6504).forEach((row, i) =>
            row.forEach((v, j) => expect(Math.abs(v - (i === j ? 1 : 0))).toBeLessThan(0.035)),
        );
    });

    it('inverts 3x3 matrices', () => {
        const m = [
            [2, -1, 0.5],
            [0.3, 4, -2],
            [1, 0, 3],
        ];
        const inv = invertMatrix(m);
        m.forEach((row, i) =>
            [0, 1, 2].forEach((j) => {
                const v = row[0] * inv[0][j] + row[1] * inv[1][j] + row[2] * inv[2][j];
                expect(v).toBeCloseTo(i === j ? 1 : 0, 12);
            }),
        );
    });
});
