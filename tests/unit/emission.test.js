import { describe, expect, it } from 'vitest';
import {
    ANCHOR_LUMINANCE,
    exposureLog2,
    pageThorneUniforms,
    referenceLog2Luminance,
} from '../../src/app/core/physics/emission.js';
import { pageThorneBracket } from '../../src/app/core/physics/thin-disk.js';

describe('emission uniforms', () => {
    it('let the shader evaluate the Page-Thorne bracket from per-spin coefficients', () => {
        for (const a of [0, 0.3, 0.9, 0.998]) {
            const pt = pageThorneUniforms(a);
            for (const x of [pt.x0 * 1.001, pt.x0 * 1.3, 4, 9]) {
                const logs = pt.roots.map((xi) => Math.log((x - xi) / (pt.x0 - xi)));
                const shader =
                    x -
                    pt.x0 -
                    1.5 * a * Math.log(x / pt.x0) -
                    pt.coeffs.reduce((s, c, i) => s + c * logs[i], 0);
                expect(shader, `a = ${a}, x = ${x}`).toBeCloseTo(pageThorneBracket(x, a), 10);
            }
        }
    });

    it('express bolometric radiance in luminance through the 6504 K efficacy', () => {
        expect(referenceLog2Luminance(6504, 1, 'bolometric')).toBeCloseTo(
            referenceLog2Luminance(6504, 1, 'visible'),
            3,
        );
        expect(
            referenceLog2Luminance(2e4, 1, 'bolometric') -
                referenceLog2Luminance(1e4, 1, 'bolometric'),
        ).toBeCloseTo(4, 10);
    });

    it('lower the visible luminance of a hardened photosphere by f_col^4 at fixed colour', () => {
        const hard = referenceLog2Luminance(5000, 1.7, 'visible');
        const plain = referenceLog2Luminance(8500, 1, 'visible');
        expect(plain - hard).toBeCloseTo(4 * Math.log2(1.7), 3);
    });

    it('anchor the reference emitter or apply a photometric EV100', () => {
        const log2Reference = 31.7;
        const anchored = exposureLog2(
            { exposure_mode: 'anchored', exposure_ev: 1.5, ev100: 0 },
            log2Reference,
        );
        expect(anchored + log2Reference).toBeCloseTo(Math.log2(ANCHOR_LUMINANCE) + 1.5, 12);
        const manual = exposureLog2({ exposure_mode: 'manual', exposure_ev: 0, ev100: 30 }, 0);
        expect(2 ** manual).toBeCloseTo(1 / (1.2 * 2 ** 30), 20);
    });
});
