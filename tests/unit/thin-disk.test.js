import { describe, expect, it } from 'vitest';
import {
    circularAngularMomentum,
    circularEnergy,
    circularRedshift,
    circularUt,
    efficiency,
    isco,
    keplerOmega,
    pageThorneFlux,
    pageThornePeak,
    peakEffectiveTemperature,
    plungingRedshift,
    plungingVelocity,
} from '../../src/app/core/physics/thin-disk.js';

describe('Page-Thorne flux', () => {
    it('peaks at the published radii', () => {
        for (const [a, ratio] of [
            [0, 1.592],
            [0.5, 1.5628],
            [0.9, 1.4829],
            [0.998, 1.2783],
        ]) {
            expect(pageThornePeak(a).r / isco(a), `a = ${a}`).toBeCloseTo(ratio, 3);
        }
    });

    it('keeps the published flux at twice the ISCO radius', () => {
        for (const [a, ratio] of [
            [0, 0.8542],
            [0.9, 0.7469],
            [0.998, 0.4741],
        ]) {
            const peak = pageThornePeak(a).flux;
            expect(pageThorneFlux(2 * isco(a), a) / peak, `a = ${a}`).toBeCloseTo(ratio, 3);
        }
    });

    it('vanishes at the ISCO and approaches the Newtonian 3 M Mdot / (8 pi r^3)', () => {
        expect(pageThorneFlux(isco(0.7), 0.7)).toBe(0);
        expect(pageThorneFlux(isco(0.7) * (1 + 1e-6), 0.7)).toBeLessThan(1e-9);
        expect(pageThorneFlux(1e6, 0.5) * 1e18).toBeCloseTo(1, 2);
    });

    it('gives the efficiency eta = 1 - E_isco', () => {
        expect(efficiency(0)).toBeCloseTo(1 - Math.sqrt(8 / 9), 10);
        expect(efficiency(0.998)).toBeCloseTo(0.3208, 3);
    });

    it('reproduces the physical peak temperatures', () => {
        for (const [mass, mdot, a, t] of [
            [21.2, 0.01, 0.998, 5.17e6],
            [4.297e6, 0.1, 0.9, 2.68e5],
            [2.6e8, 1, 0.9, 1.71e5],
            [6.5e9, 0.1, 0.9, 4.3e4],
            [4.07e10, 1, 0.9, 4.83e4],
        ]) {
            expect(peakEffectiveTemperature(mass, mdot, a) / t, `M = ${mass}`).toBeCloseTo(1, 2);
        }
    });
});

describe('disk kinematics and redshift', () => {
    it('gives the face-on ISCO redshift 1 / u^t', () => {
        expect(circularRedshift(isco(0), 0, 0)).toBeCloseTo(Math.SQRT1_2, 10);
        expect(circularRedshift(isco(0.9), 0.9, 0)).toBeCloseTo(0.3709, 4);
    });

    it('normalises circular orbits and links them to E and L', () => {
        const a = 0.7;
        const r = 5;
        const ut = circularUt(r, a);
        const omega = keplerOmega(r, a);
        const gtt = -(1 - 2 / r);
        const gtphi = (-2 * a) / r;
        const gphiphi = r * r + a * a + (2 * a * a) / r;
        expect(ut * ut * (gtt + 2 * gtphi * omega + gphiphi * omega * omega)).toBeCloseTo(-1, 12);
        expect(-(gtt + gtphi * omega) * ut).toBeCloseTo(circularEnergy(r, a), 12);
        expect((gtphi + gphiphi * omega) * ut).toBeCloseTo(circularAngularMomentum(r, a), 12);
    });

    it('applies g = 1 / (u^t (E - Omega Lz)) to edge-on photons', () => {
        const r = 10;
        const v = circularRedshift(r, 0, 0);
        expect(circularRedshift(r, 0, 3) / v).toBeCloseTo(1 / (1 - keplerOmega(r, 0) * 3), 12);
    });

    it('starts the plunging flow from the ISCO orbit and keeps it timelike', () => {
        for (const a of [0, 0.5, 0.9]) {
            const rIn = isco(a);
            const edge = plungingVelocity(rIn * (1 - 1e-10), a);
            expect(edge.ut).toBeCloseTo(circularUt(rIn, a), 5);
            expect(edge.uphi).toBeCloseTo(keplerOmega(rIn, a) * circularUt(rIn, a), 5);
            expect(Math.abs(edge.ur)).toBeLessThan(1e-3);

            const r = 0.8 * rIn;
            const u = plungingVelocity(r, a);
            const delta = r * r - 2 * r + a * a;
            const norm =
                -(1 - 2 / r) * u.ut * u.ut -
                ((4 * a) / r) * u.ut * u.uphi +
                (r * r + a * a + (2 * a * a) / r) * u.uphi * u.uphi +
                ((r * r) / delta) * u.ur * u.ur;
            expect(norm, `a = ${a}`).toBeCloseTo(-1, 9);
            expect(u.ur).toBeLessThan(0);
        }
    });

    it('redshifts outgoing light from the infalling gas more than ingoing light', () => {
        const a = 0.5;
        const r = 0.9 * isco(a);
        const pr = 0.4;
        const outgoing = plungingRedshift(r, a, { Lz: 0, pr });
        const ingoing = plungingRedshift(r, a, { Lz: 0, pr: -pr });
        expect(outgoing).toBeLessThan(ingoing);
        expect(outgoing).toBeGreaterThan(0);
    });
});
