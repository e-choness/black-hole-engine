import { describe, expect, it } from 'vitest';
import {
    ANCHOR_LUMINANCE,
    exposureLog2,
    pageThorneUniforms,
    referenceLog2Luminance,
} from '../../src/app/core/physics/emission.js';
import { pageThorneBracket } from '../../src/app/core/physics/thin-disk.js';
import { infernoColor, scientificLuminanceRange } from '../../src/app/graphics/output-pass.js';

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

describe('scientific false colour', () => {
    it('spans 12 stops of luminance ending 3 stops above the anchored reference emitter', () => {
        const log2Reference = 22.4;
        for (const ev of [0, 2.5]) {
            const range = scientificLuminanceRange(
                exposureLog2(
                    { exposure_mode: 'anchored', exposure_ev: ev, ev100: 0 },
                    log2Reference,
                ),
            );
            expect(range.log2Max).toBeCloseTo(log2Reference + 3 - ev, 12);
            expect(range.log2Max - range.log2Min).toBe(12);
        }
    });

    it('labels the manual exposure window in absolute luminance', () => {
        const range = scientificLuminanceRange(
            exposureLog2({ exposure_mode: 'manual', exposure_ev: 0, ev100: 10 }, 0),
        );
        expect(2 ** range.log2Max).toBeCloseTo(ANCHOR_LUMINANCE * 8 * 1.2 * 2 ** 10, 6);
    });

    it('rises monotonically in luminance from black to the Inferno yellow', () => {
        const decode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        let previous = -1;
        for (let i = 0; i <= 512; i++) {
            const [r, g, b] = infernoColor(i / 512).map(decode);
            const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
            expect(y, `t = ${i / 512}`).toBeGreaterThan(previous);
            previous = y;
        }
        expect(Math.max(...infernoColor(0))).toBeLessThan(0.01);
        const top = infernoColor(1);
        [0.988, 0.998, 0.645].forEach((v, i) => expect(top[i]).toBeCloseTo(v, 1));
    });
});
