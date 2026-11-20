import { expect, test } from 'vitest';
import {
    SHADER_MASS as M,
    horizonRadius,
    ksGeometry,
    ksRadius,
} from '../../src/app/core/physics/kerr.js';
import { bardeenShadowExtent } from '../support/kerr-reference.js';

// Float64 mirror of the Full Kerr integrator in src/shaders/tsl/raytracer/geodesics.js and the
// trace loop in trace.js, so the equations, the tableau and the termination rules can be checked
// against closed forms. Positions are (x, y, z, t), r_s = 1.

function rhs(x, p, pt, a) {
    const r = ksRadius(x[0], x[1], x[2], a);
    const r2 = r * r;
    const a2 = a * a;
    const ra2 = r2 + a2;
    const D = r2 * r2 + a2 * x[2] * x[2];
    const f = (2 * M * r2 * r) / D;
    const l = [(r * x[0] + a * x[1]) / ra2, (r * x[1] - a * x[0]) / ra2, x[2] / r];
    const lp = -pt + l[0] * p[0] + l[1] * p[1] + l[2] * p[2];
    const gradR = [(r2 * r * x[0]) / D, (r2 * r * x[1]) / D, (r * ra2 * x[2]) / D];
    const A = [(r * p[0] - a * p[1]) / ra2, (a * p[0] + r * p[1]) / ra2, p[2] / r];
    const B =
        (p[0] * (x[0] - 2 * r * l[0]) + p[1] * (x[1] - 2 * r * l[1])) / ra2 - (p[2] * x[2]) / r2;
    const C = 0.5 * lp * (3 / r - (4 * r2 * r) / D) + B;
    const dx = [0, 1, 2].map((i) => p[i] - f * lp * l[i]);
    dx.push(-pt + f * lp);
    const dp = [0, 1, 2].map((i) => f * lp * (C * gradR[i] + A[i]));
    dp[2] -= (f * lp * lp * a2 * x[2]) / D;
    return { dx, dp };
}

function hamiltonian(x, p, pt, a) {
    const { f, l } = ksGeometry(x, a, M);
    const lp = -pt + l[0] * p[0] + l[1] * p[1] + l[2] * p[2];
    return 0.5 * (-pt * pt + p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - f * lp * lp);
}

const DP_A = [
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];

const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const axpy = (v, k, h, w) => v.map((c, i) => c + h * w.reduce((s, wj, j) => s + wj * k[j][i], 0));

function dp45Step(s, h, pt, a, rtol, atol) {
    const kx = [s.dx];
    const kp = [s.dp];
    let x = s.x;
    let p = s.p;
    for (const row of DP_A) {
        x = axpy(s.x, kx, h, row);
        p = axpy(s.p, kp, h, row);
        const d = rhs(x, p, pt, a);
        kx.push(d.dx);
        kp.push(d.dp);
    }
    const ex = axpy([0, 0, 0], kx, h, DP_E);
    const ep = axpy([0, 0, 0], kp, h, DP_E);
    const scaleX = atol + rtol * Math.max(norm(s.x), norm(x));
    const scaleP = atol + rtol * Math.max(norm(s.p), Math.abs(pt));
    const err = Math.max(norm(ex) / scaleX, norm(ep) / scaleP);
    return { err, next: { x, p, dx: kx[6], dp: kp[6] } };
}

function trace(x0, p0, pt, a, { rtol = 1e-4, atol = 1e-6, maxIter = 4000 } = {}) {
    const rPlus = horizonRadius(a);
    let s = { x: [...x0, 0], p: p0, ...rhs([...x0, 0], p0, pt, a) };
    const radius = (st) => ksRadius(st.x[0], st.x[1], st.x[2], a);
    const radialRate = (st, r) => {
        const D = r ** 4 + a * a * st.x[2] ** 2;
        return (
            (r ** 3 * (st.x[0] * st.dx[0] + st.x[1] * st.dx[1]) +
                r * (r * r + a * a) * st.x[2] * st.dx[2]) /
            D
        );
    };
    let r = radius(s);
    let rdot = radialRate(s, r);
    const rEscape = Math.max(500, 4 * r);
    let h = (0.02 * r) / norm(s.dx);
    let accepted = 0;
    for (let i = 0; i < maxIter; i++) {
        const speed = norm(s.dx);
        const L = [
            s.x[1] * s.dx[2] - s.x[2] * s.dx[1],
            s.x[2] * s.dx[0] - s.x[0] * s.dx[2],
            s.x[0] * s.dx[1] - s.x[1] * s.dx[0],
        ];
        let step = Math.min(h, (0.2 * r * r) / Math.max(norm(L), 1e-12), (2 * r) / speed);
        if (rdot < 0 && r > rPlus) step = Math.min(step, (0.5 * (r - rPlus)) / -rdot);
        const { err, next } = dp45Step(s, step, pt, a, rtol, atol);
        const scale = 0.9 * Math.pow(Math.max(err, 1e-12), -0.2);
        if (!(err <= 1)) {
            h = step * Math.min(Math.max(scale, 0.2), 0.9);
            continue;
        }
        h = step * Math.min(scale, 5);
        s = next;
        accepted++;
        r = radius(s);
        rdot = radialRate(s, r);
        if (rdot < 0 && r < 1.01 * rPlus) return { outcome: 'captured', s, accepted };
        if (rdot > 0 && r > rEscape) return { outcome: 'escaped', s, accepted };
    }
    return { outcome: 'unfinished', s, accepted };
}

// Backward ray launched from far down the -y axis towards +y with p_t = 1 and the spatial
// momentum scaled onto the null cone, offset by b along x (or along z when vertical).
function launch(b, a, { distance = 1000, vertical = false } = {}) {
    const x = vertical ? [0, -distance, b] : [b, -distance, 0];
    const { f, l } = ksGeometry(x, a, M);
    // H = 0 for p = s e_y: s^2 (1 - f l_y^2) + 2 f l_y s - (1 + f) = 0.
    const qa = 1 - f * l[1] * l[1];
    const qb = 2 * f * l[1];
    const s = (-qb + Math.sqrt(qb * qb + 4 * qa * (1 + f))) / (2 * qa);
    return { x, p: [0, s, 0], pt: 1 };
}

test('the Hamiltonian right-hand side is the gradient of H', () => {
    const cases = [
        [[2.1, -1.3, 0.7], [0.3, 0.8, -0.2], 1.0, 0.45],
        [[0.4, 0.9, -1.6], [-0.6, 0.1, 0.9], 0.8, 0.3],
        [[-5.0, 3.0, 0.01], [0.9, -0.2, 0.05], 1.1, -0.49],
        [[1.2, 0.3, 0.2], [0.2, 0.5, 0.4], 0.7, 0.499],
    ];
    const eps = 1e-6;
    for (const [x, p, pt, a] of cases) {
        const { dx, dp } = rhs([...x, 0], p, pt, a);
        for (let i = 0; i < 3; i++) {
            const pPlus = p.map((c, j) => (j === i ? c + eps : c));
            const pMinus = p.map((c, j) => (j === i ? c - eps : c));
            const dHdp = (hamiltonian(x, pPlus, pt, a) - hamiltonian(x, pMinus, pt, a)) / (2 * eps);
            expect(dx[i]).toBeCloseTo(dHdp, 6);
            const xPlus = x.map((c, j) => (j === i ? c + eps : c));
            const xMinus = x.map((c, j) => (j === i ? c - eps : c));
            const dHdx = (hamiltonian(xPlus, p, pt, a) - hamiltonian(xMinus, p, pt, a)) / (2 * eps);
            expect(dp[i]).toBeCloseTo(-dHdx, 6);
        }
        const dHdpt = (hamiltonian(x, p, pt + eps, a) - hamiltonian(x, p, pt - eps, a)) / (2 * eps);
        expect(dx[3]).toBeCloseTo(dHdpt, 6);
    }
});

test('the null condition and p_phi are conserved along a strongly bent ray', () => {
    const a = 0.45;
    const bc = 6.8322 * M;
    const { x, p, pt } = launch(bc * 1.002, a);
    const pPhi = (s) => s.x[0] * s.p[1] - s.x[1] * s.p[0];
    const start = { x: [...x, 0], p };
    const result = trace(x, p, pt, a, { rtol: 1e-9, atol: 1e-12 });
    expect(result.outcome).toBe('escaped');
    expect(Math.abs(hamiltonian(result.s.x, result.s.p, pt, a))).toBeLessThan(1e-7);
    expect(Math.abs(pPhi(result.s) / pPhi(start) - 1)).toBeLessThan(1e-7);
});

test('a = 0 rays are captured exactly inside b_c = 3 sqrt(3) M', () => {
    const bc = 3 * Math.sqrt(3) * M;
    for (const rtol of [1e-3, 1e-4]) {
        expect(trace(...Object.values(launch(bc * 0.995, 0)), 0, { rtol }).outcome).toBe(
            'captured',
        );
        expect(trace(...Object.values(launch(bc * 1.005, 0)), 0, { rtol }).outcome).toBe('escaped');
    }
});

test('equatorial Kerr capture matches the Bardeen critical curve', () => {
    for (const chi of [0.5, 0.9, 0.998]) {
        const a = chi * M;
        const { alphaMin, alphaMax } = bardeenShadowExtent(chi, Math.PI / 2);
        // p_phi / p_t of the backward ray equals Bardeen's alpha for an equatorial observer.
        for (const [alpha, outcome] of [
            [alphaMax * 0.995, 'captured'],
            [alphaMax * 1.005, 'escaped'],
            [alphaMin * 0.99, 'captured'],
            [alphaMin * 1.01, 'escaped'],
        ]) {
            // Rescale the offset so that p_phi / p_t is exactly alpha at the finite distance.
            const first = launch(alpha * M, a);
            const pPhi = first.x[0] * first.p[1] - first.x[1] * first.p[0];
            const ray = launch((alpha * M * alpha * M) / pPhi, a);
            const b = (ray.x[0] * ray.p[1] - ray.x[1] * ray.p[0]) / ray.pt;
            expect(Math.abs(b / (alpha * M) - 1)).toBeLessThan(1e-5);
            const result = trace(ray.x, ray.p, ray.pt, a);
            expect(result.outcome, `chi=${chi} alpha=${alpha.toFixed(4)}`).toBe(outcome);
        }
    }
});

test('polar rays see the vertical shadow half-height of the Bardeen curve', () => {
    const chi = 0.9;
    const a = chi * M;
    const { betaMax } = bardeenShadowExtent(chi, Math.PI / 2);
    // For the equatorial observer the critical curve peaks at the r = 3M photon orbit, where
    // eta = 27 M^2 and xi = -2a, i.e. at alpha = 2a, beta = 3 sqrt(3) M.
    expect(betaMax).toBeCloseTo(3 * Math.sqrt(3), 3);
    for (const [scale, outcome] of [
        [0.99, 'captured'],
        [1.01, 'escaped'],
    ]) {
        const ray = launch(betaMax * scale * M, a, { vertical: true });
        ray.x[0] = 2 * a;
        const result = trace(ray.x, ray.p, ray.pt, a);
        expect(result.outcome, `scale=${scale}`).toBe(outcome);
    }
});

test('typical rays finish well inside the preset iteration budgets', () => {
    const a = 0.45;
    let worst = 0;
    for (let b = 0.5; b < 12; b += 0.37) {
        const ray = launch(b, a, { distance: 11 });
        const result = trace(ray.x, ray.p, ray.pt, a, { rtol: 1e-4 });
        expect(result.outcome).not.toBe('unfinished');
        worst = Math.max(worst, result.accepted);
    }
    expect(worst).toBeLessThan(160);
});
