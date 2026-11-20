// Photon geodesics: the Schwarzschild Binet solver (u = 1/r, exact for a = 0, with perturbative
// spin heuristics in the fast and Kerr-inspired modes) and null geodesics of the Kerr metric in
// Cartesian Kerr-Schild coordinates with an adaptive Dormand-Prince 5(4) scheme.

import {
    Fn,
    If,
    Loop,
    abs,
    clamp,
    dot,
    float,
    length,
    max,
    min,
    pow,
    sqrt,
    vec3,
    vec4,
} from 'three/tsl';
import { sq } from './math.js';

export const KERR_M = 0.5; // r_s = 1 => M = r_s / 2

// Dormand & Prince (1980) 5(4) tableau: row s holds a_s1..a_s(s-1) for stages 2..7; the last row
// equals the fifth-order weights, so stage 7 is the derivative at the new point (FSAL).
const DP_A = [
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
// Fifth- minus fourth-order weights, the local error estimate.
const DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];

const KERR_ATOL = 1e-6;

// Sum of c_i v_i over the non-zero coefficients.
function weightedSum(coefficients, values) {
    let sum = null;
    coefficients.forEach((c, i) => {
        if (c === 0) return;
        const term = values[i].mul(c);
        sum = sum ? sum.add(term) : term;
    });
    return sum;
}

export function createGeodesics(F, U) {
    const kerr_spin_a = () => U.bh_rotation_enabled.mul(U.bh_spin).mul(KERR_M);

    const kerr_horizon_radius = Fn(
        ([a]) => sqrt(max(float(KERR_M * KERR_M).sub(a.mul(a)), 0.0)).add(KERR_M),
        { a: 'float', return: 'float' },
    );

    const spinStrength = () =>
        U.photon_spin_lensing_scale
            .mul(U.bh_rotation_enabled)
            .mul(U.bh_spin)
            .mul(U.bh_spin_strength);

    const geodesic_accel = Fn(
        ([u, spin_alignment]) => {
            const schwarzschild_accel = u.negate().add(u.mul(u).mul(1.5));
            const u_drag = min(u, 1.2);
            const frame_drag_term = spinStrength()
                .mul(spin_alignment)
                .mul(0.8)
                .mul(u_drag)
                .mul(u_drag)
                .mul(u_drag);
            return schwarzschild_accel.add(frame_drag_term);
        },
        { u: 'float', spin_alignment: 'float', return: 'float' },
    );

    // Advances the vars u and du by one step of the orbit angle.
    function integrate_geodesic_step(u, du, step, spin_alignment) {
        if (F.rk4_integration) {
            const half = step.mul(0.5);
            const k1_u = du.toConst();
            const k1_du = geodesic_accel(u, spin_alignment).toConst();
            const k2_u = du.add(half.mul(k1_du)).toConst();
            const k2_du = geodesic_accel(u.add(half.mul(k1_u)), spin_alignment).toConst();
            const k3_u = du.add(half.mul(k2_du)).toConst();
            const k3_du = geodesic_accel(u.add(half.mul(k2_u)), spin_alignment).toConst();
            const k4_u = du.add(step.mul(k3_du)).toConst();
            const k4_du = geodesic_accel(u.add(step.mul(k3_u)), spin_alignment).toConst();
            const du_inc = step
                .div(6.0)
                .mul(k1_du.add(k2_du.mul(2)).add(k3_du.mul(2)).add(k4_du))
                .toConst();
            u.addAssign(step.div(6.0).mul(k1_u.add(k2_u.mul(2)).add(k3_u.mul(2)).add(k4_u)));
            du.addAssign(du_inc);
        } else {
            du.addAssign(geodesic_accel(u, spin_alignment).mul(0.5).mul(step));
            u.addAssign(du.mul(step));
            du.addAssign(geodesic_accel(u, spin_alignment).mul(0.5).mul(step));
        }
    }

    // --- Full Kerr in Cartesian Kerr-Schild (CKS) coordinates ---------------------------------
    // g_mn = eta_mn + f l_m l_n, f = 2 M r^3 / (r^4 + a^2 z^2),
    // l_m = (1, (r x + a y) / (r^2 + a^2), (r y - a x) / (r^2 + a^2), z / r), where the
    // Kerr-Schild radius solves r^4 - (x^2 + y^2 + z^2 - a^2) r^2 - a^2 z^2 = 0 (Visser 2007,
    // arXiv:0706.0622, sec. 4). Vectors are (x, y, z, t). Hamilton's equations for
    // H = 1/2 g^mn p_m p_n with g^mn = eta^mn - f l^m l^n and (l.p) = -p_t + l.p_vec:
    //   dx/dl = p - f (l.p) l,  dt/dl = -p_t + f (l.p),
    //   dp/dl = 1/2 (l.p)^2 grad f + f (l.p) (grad l).p.
    // The energy p_t and the axial momentum p_phi = x p_y - y p_x are conserved.

    const ks_radius = Fn(
        ([x, a]) => {
            const a2 = a.mul(a);
            const w = dot(x, x).sub(a2).toConst();
            const q = sqrt(w.mul(w).add(a2.mul(4).mul(x.z).mul(x.z))).toConst();
            // For w < 0 the root (w + q) / 2 cancels; 2 a^2 z^2 / (q - w) is the same value.
            const r2 = float(0).toVar();
            If(w.greaterThanEqual(0.0), () => {
                r2.assign(w.add(q).mul(0.5));
            }).Else(() => {
                r2.assign(
                    a2
                        .mul(2)
                        .mul(x.z)
                        .mul(x.z)
                        .div(max(q.sub(w), 1e-30)),
                );
            });
            return sqrt(r2);
        },
        { x: 'vec3', a: 'float', return: 'float' },
    );

    // grad r = (r^3 x, r^3 y, r (r^2 + a^2) z) / (r^4 + a^2 z^2), by implicit differentiation.
    const ks_radius_gradient = Fn(
        ([x, r, a]) => {
            const r2 = r.mul(r);
            return vec3(
                r2.mul(r).mul(x.x),
                r2.mul(r).mul(x.y),
                r.mul(r2.add(a.mul(a))).mul(x.z),
            ).div(r2.mul(r2).add(a.mul(a).mul(x.z).mul(x.z)));
        },
        { x: 'vec3', r: 'float', a: 'float', return: 'vec3' },
    );

    // Boyer-Lindquist-like point (length r, height z = r cos(theta)) in which the emitters
    // measure radii and heights, as they do for the Binet solver.
    const ks_to_bl_position = Fn(
        ([x, r, a]) => vec3(x.xy.mul(r.div(sqrt(r.mul(r).add(a.mul(a))))), x.z),
        { x: 'vec3', r: 'float', a: 'float', return: 'vec3' },
    );

    // Derivatives (dx, dp) at (x, p) for the energy p_t, pinned as consts.
    function kerr_rhs(x, p, p_t, a) {
        const r = ks_radius(x.xyz, a).toConst();
        const r2 = r.mul(r).toConst();
        const a2 = a.mul(a).toConst();
        const ra2 = r2.add(a2).toConst();
        const D = r2.mul(r2).add(a2.mul(x.z).mul(x.z)).toConst();
        const f = r2
            .mul(r)
            .mul(2 * KERR_M)
            .div(D)
            .toConst();
        const l = vec3(
            r.mul(x.x).add(a.mul(x.y)).div(ra2),
            r.mul(x.y).sub(a.mul(x.x)).div(ra2),
            x.z.div(r),
        ).toConst();
        const lp = p_t.negate().add(dot(l, p)).toConst();
        const grad_r = vec3(r2.mul(r).mul(x.x), r2.mul(r).mul(x.y), r.mul(ra2).mul(x.z)).div(D);
        // (d_j l).p = A_j + B d_j r and grad f = f [(3/r - 4 r^3/D) grad r - (2 a^2 z / D) e_z].
        const A = vec3(
            r.mul(p.x).sub(a.mul(p.y)).div(ra2),
            a.mul(p.x).add(r.mul(p.y)).div(ra2),
            p.z.div(r),
        );
        const B = p.x
            .mul(x.x.sub(r.mul(2).mul(l.x)))
            .add(p.y.mul(x.y.sub(r.mul(2).mul(l.y))))
            .div(ra2)
            .sub(p.z.mul(x.z).div(r2));
        const C = lp
            .mul(0.5)
            .mul(float(3).div(r).sub(r2.mul(r).mul(4).div(D)))
            .add(B);
        const dx = vec4(p.sub(l.mul(f.mul(lp))), p_t.negate().add(f.mul(lp))).toConst();
        const dp = f
            .mul(lp)
            .mul(
                C.mul(grad_r)
                    .add(A)
                    .sub(vec3(0.0, 0.0, lp.mul(a2).mul(x.z).div(D))),
            )
            .toConst();
        return { dx, dp };
    }

    // Trial step of size h from (x, p) with derivative (dx, dp): the fifth-order end point, its
    // derivative and the error relative to the mixed tolerance (acceptable when at most 1).
    function kerr_dp45_step(x, p, dx, dp, h, p_t, a) {
        const kx = [dx];
        const kp = [dp];
        let x_new = x;
        let p_new = p;
        DP_A.forEach((row) => {
            x_new = x.add(weightedSum(row, kx).mul(h)).toConst();
            p_new = p.add(weightedSum(row, kp).mul(h)).toConst();
            const k = kerr_rhs(x_new, p_new, p_t, a);
            kx.push(k.dx);
            kp.push(k.dp);
        });
        const ex = weightedSum(
            DP_E,
            kx.map((k) => k.xyz),
        );
        const ep = weightedSum(DP_E, kp);
        const scale_x = max(length(x.xyz), length(x_new.xyz)).mul(F.kerr_rtol).add(KERR_ATOL);
        const scale_p = max(length(p), abs(p_t)).mul(F.kerr_rtol).add(KERR_ATOL);
        const err = h.mul(max(length(ex).div(scale_x), length(ep).div(scale_p))).toConst();
        return { x_new, p_new, dx_new: kx[6], dp_new: kp[6], err };
    }

    // Frame-dragging angular velocity of the zero-angular-momentum observer, 2 M a r / A with
    // A = (r^2 + a^2)^2 - a^2 Delta sin^2(theta) (Bardeen, Press & Teukolsky 1972).
    const kerr_zamo_omega = Fn(
        ([r, cos2, a]) => {
            const ra2 = r.mul(r).add(a.mul(a));
            const delta = r
                .mul(r)
                .sub(r.mul(2 * KERR_M))
                .add(a.mul(a));
            return a
                .mul(r)
                .mul(2 * KERR_M)
                .div(max(ra2.mul(ra2).sub(a.mul(a).mul(delta).mul(float(1).sub(cos2))), 1e-8));
        },
        { r: 'float', cos2: 'float', a: 'float', return: 'float' },
    );

    // Keplerian angular velocity of circular equatorial orbits; sense = +1 is counter-clockwise
    // about +z (Bardeen, Press & Teukolsky 1972, eq. 2.16).
    const kerr_kepler_omega = Fn(
        ([r, a, sense]) => {
            const sqrt_m = Math.sqrt(KERR_M);
            return sense.mul(sqrt_m).div(pow(max(r, 1e-3), 1.5).add(sense.mul(a).mul(sqrt_m)));
        },
        { r: 'float', a: 'float', sense: 'float', return: 'float' },
    );

    // Frequency, relative to the traced observer, that gas on the stationary orbit
    // d_t + omega d_phi through the Boyer-Lindquist-like point q measures for the ray (p_t, p_phi):
    //   p.u = u^t (p_t + omega p_phi),
    //   (u^t)^-2 = 1 - omega^2 (r^2 + a^2) sin^2 - f (1 - omega a sin^2)^2,
    // with f = 2 M r / (r^2 + a^2 cos^2). Where that orbit is not timelike (inside the photon
    // orbit or the ergosphere) the zero-angular-momentum observer stands in.
    const kerr_orbit_frequency = Fn(
        ([q, omega_in, p_t, p_phi, a]) => {
            const omega = omega_in.toVar();
            const r = max(length(q), 1e-4).toConst();
            const cos2 = q.z.mul(q.z).div(r.mul(r)).toConst();
            const sin2 = max(float(1).sub(cos2), 0.0).toConst();
            const f = r
                .mul(2 * KERR_M)
                .div(r.mul(r).add(a.mul(a).mul(cos2)))
                .toConst();
            const ra2_sin2 = r.mul(r).add(a.mul(a)).mul(sin2).toConst();
            const normOf = () =>
                float(1)
                    .sub(omega.mul(omega).mul(ra2_sin2))
                    .sub(f.mul(sq(float(1).sub(omega.mul(a).mul(sin2)))));
            const norm = normOf().toVar();
            If(norm.lessThan(1e-4), () => {
                omega.assign(kerr_zamo_omega(r, cos2, a));
                norm.assign(normOf());
            });
            return p_t.add(omega.mul(p_phi)).div(sqrt(max(norm, 1e-8)));
        },
        { q: 'vec3', omega_in: 'float', p_t: 'float', p_phi: 'float', a: 'float', return: 'float' },
    );

    // Cubic Hermite interpolant of a step from its end points x0, x1 and end derivatives m0, m1
    // (already multiplied by the step size), at the fraction s of the step.
    const kerr_hermite = Fn(
        ([x0, x1, m0, m1, s]) => {
            const s2 = s.mul(s);
            const s3 = s2.mul(s);
            return x0
                .mul(s3.mul(2).sub(s2.mul(3)).add(1))
                .add(m0.mul(s3.sub(s2.mul(2)).add(s)))
                .add(x1.mul(s2.mul(3).sub(s3.mul(2))))
                .add(m1.mul(s3.sub(s2)));
        },
        { x0: 'vec3', x1: 'vec3', m0: 'vec3', m1: 'vec3', s: 'float', return: 'vec3' },
    );

    // Fraction of the step where the Hermite interpolant of z vanishes, given that z changes
    // sign: Newton iterations started from the chord's root.
    const kerr_hermite_root = Fn(
        ([z0, z1, m0, m1]) => {
            const s = clamp(z0.div(z0.sub(z1)), 0.0, 1.0).toVar();
            Loop(3, () => {
                const s2 = s.mul(s).toConst();
                const s3 = s2.mul(s).toConst();
                const z = s3
                    .mul(2)
                    .sub(s2.mul(3))
                    .add(1)
                    .mul(z0)
                    .add(s3.sub(s2.mul(2)).add(s).mul(m0))
                    .add(s2.mul(3).sub(s3.mul(2)).mul(z1))
                    .add(s3.sub(s2).mul(m1));
                const dz = s2
                    .mul(6)
                    .sub(s.mul(6))
                    .mul(z0.sub(z1))
                    .add(s2.mul(3).sub(s.mul(4)).add(1).mul(m0))
                    .add(s2.mul(3).sub(s.mul(2)).mul(m1))
                    .toConst();
                If(abs(dz).greaterThan(1e-12), () => {
                    s.assign(clamp(s.sub(z.div(dz)), 0.0, 1.0));
                });
            });
            return s;
        },
        { z0: 'float', z1: 'float', m0: 'float', m1: 'float', return: 'float' },
    );

    return {
        kerr_spin_a,
        kerr_horizon_radius,
        integrate_geodesic_step,
        ks_radius,
        ks_radius_gradient,
        ks_to_bl_position,
        kerr_rhs,
        kerr_dp45_step,
        kerr_zamo_omega,
        kerr_kepler_omega,
        kerr_orbit_frequency,
        kerr_hermite,
        kerr_hermite_root,
    };
}
