// Observed radiance of every emitter. One frequency ratio g = nu_obs / nu_emit (with the photon
// energy normalised to the camera) sets both colour and brightness through the absolute
// blackbody LUT (CIE 1931 2-degree -> linear sRGB, log10 of the luminance in cd/m^2), so the
// disk, volumes, planet and sky share one rule. Also holds the Novikov-Thorne / Page-Thorne flux
// and the disk kinematics of both solvers.

import {
    Fn,
    If,
    abs,
    asin,
    atan,
    clamp,
    cos,
    dot,
    exp2,
    float,
    fract,
    int,
    ivec2,
    length,
    log,
    log2,
    max,
    min,
    mix,
    pow,
    select,
    smoothstep,
    sqrt,
    textureLoad,
    vec2,
    vec3,
} from 'three/tsl';
import { DEG_TO_RAD, sq } from './math.js';
import { KERR_M } from './geodesics.js';
import { sampleCubeGradient } from '../nodes/cube-gradient.js';

const LUT_SIZE = 512;
const BB_LOG_T_MIN = 6.2146080984; // ln(500 K)
const BB_LOG_T_SPAN = 7.6009024595; // ln(1e6 K / 500 K)
const BB_T_MAX = 1.0e6;
const PL_ALPHA_MIN = -1.0;
const PL_ALPHA_SPAN = 4.0;
const LOG2_10 = 3.3219280949;
const LN_10 = 2.302585093;

// Zero-torque disks are dark at the ISCO; these extra torques (Agol & Krolik 2000 form, a
// constant added to the Page-Thorne bracket in units of x0) give the GRMHD and slim looks emission
// at and inside the ISCO. Look values, not fitted to simulations.
export const DISK_GRMHD_STRESS = 0.008;
export const DISK_SLIM_STRESS = 0.02;

export const ACCRETION_WIDTH = 12.0;

export function createEmission(F, U, geo) {
    const lutTexel = (i, row) => textureLoad(U.emission_lut, ivec2(i, row));

    const lutRow = (row) =>
        Fn(
            ([u]) => {
                const uc = clamp(u, 0.0, LUT_SIZE - 1.0).toConst();
                const i = min(int(uc), int(LUT_SIZE - 2)).toConst();
                return mix(lutTexel(i, row), lutTexel(i.add(1), row), uc.sub(float(i)));
            },
            { u: 'float', return: 'vec4' },
        );
    const lutRow0 = lutRow(0);
    const lutRow1 = lutRow(1);

    // rgb: unit-luminance linear sRGB; a: log10 of the luminance in cd/m^2. Above 1e6 K the
    // visible band is Rayleigh-Jeans: the chromaticity is fixed and Y(T) = A T - B + O(1/T)
    // continues along its tangent at 1e6 K. Below 500 K the log-log slope of the first entries
    // continues.
    const blackbody = Fn(
        ([temperature]) => {
            const u = log(max(temperature, 1.0))
                .sub(BB_LOG_T_MIN)
                .div(BB_LOG_T_SPAN)
                .mul(LUT_SIZE - 1.0)
                .toConst();
            const s = lutRow0(u).toVar();
            If(u.greaterThan(LUT_SIZE - 1.0), () => {
                const below = lutTexel(LUT_SIZE - 2, 0).a;
                const slope = s.a.sub(below).mul(((LUT_SIZE - 1.0) * LN_10) / BB_LOG_T_SPAN);
                s.a.addAssign(
                    log(slope.mul(temperature.div(BB_T_MAX).sub(1.0)).add(1.0)).div(LN_10),
                );
            }).ElseIf(u.lessThan(0.0), () => {
                s.a.addAssign(u.mul(lutTexel(1, 0).a.sub(lutTexel(0, 0).a)));
            });
            return s;
        },
        { temperature: 'float', return: 'vec4' },
    );

    // Unit-luminance colour of an optically thin synchrotron spectrum F_nu ~ nu^-alpha; a Doppler
    // shift leaves it unchanged and only scales the brightness by g^(3 + alpha).
    const power_law_color = (alpha) =>
        lutRow1(
            alpha
                .sub(PL_ALPHA_MIN)
                .div(PL_ALPHA_SPAN)
                .mul(LUT_SIZE - 1.0),
        ).rgb;

    // Frequency ratio used for the colour (doppler_shift) and for the brightness (beaming). The
    // cinematic option softens the bolometric g^4 to g^(1.05 + 1.1 boost) over a limited range.
    const color_shift = (g) => (F.doppler_shift ? g : float(1.0));
    const brightness_shift = (g) => {
        if (!F.beaming) return float(1.0);
        if (F.physical_beaming) return g;
        return pow(
            clamp(g, 0.676, 1.613),
            clamp(U.look_doppler_boost, 0.0, 2.5).mul(1.1).add(1.05).div(4.0),
        );
    };
    // Whether both shifts are the same function of g, so the visible model needs one lookup.
    const sameShift =
        (F.doppler_shift && F.beaming && F.physical_beaming) || (!F.doppler_shift && !F.beaming);

    // Pre-exposed radiance of a blackbody photosphere of effective temperature t_eff and colour
    // correction f_col: I = f_col^-4 B(g f_col T) in the visible model, sigma (g T)^4 / pi in the
    // bolometric one; the colour always comes from the chromaticity at g f_col T.
    const thermal_radiance = Fn(
        ([t_eff, f_col, g]) => {
            const gc = color_shift(g);
            const gb = brightness_shift(g);
            const seen = blackbody(f_col.mul(gc).mul(t_eff)).toConst();
            const log2_y = float(0.0).toVar();
            If(U.radiance_visible.greaterThan(0.5), () => {
                let log10_y = seen.a;
                if (!sameShift) {
                    log10_y = seen.a.toVar();
                    If(gb.notEqual(gc), () => {
                        log10_y.assign(blackbody(f_col.mul(gb).mul(t_eff)).a);
                    });
                }
                log2_y.assign(log10_y.mul(LOG2_10).sub(log2(f_col).mul(4.0)));
            }).Else(() => {
                log2_y.assign(U.bolometric_log2_coeff.add(log2(max(gb.mul(t_eff), 1e-3)).mul(4.0)));
            });
            return seen.rgb.mul(exp2(min(log2_y.add(U.log2_exposure), 40.0)));
        },
        { t_eff: 'float', f_col: 'float', g: 'float', return: 'vec3' },
    );

    // Brightness ratio of a source whose rest-frame spectrum is a blackbody at temperature t,
    // observed with frequency ratio g: Y(g t) / Y(t) or g^4.
    const thermal_brightness_ratio = Fn(
        ([t, g]) => {
            const gb = brightness_shift(g);
            If(U.radiance_visible.greaterThan(0.5), () => {
                return exp2(blackbody(gb.mul(t)).a.sub(blackbody(t).a).mul(LOG2_10));
            });
            return sq(sq(gb));
        },
        { t: 'float', g: 'float', return: 'float' },
    );

    // Sky texels approximate the colour of integrated starlight by a blackbody of the correlated
    // colour temperature (McCamy 1992); their colour and brightness then shift like any blackbody.
    const shifted_sky_radiance = Fn(
        ([rgb, g]) => {
            If(abs(g.sub(1.0)).lessThan(1e-4), () => {
                return rgb;
            });
            const x = dot(rgb, vec3(0.4124564, 0.3575761, 0.1804375)).toConst();
            const y = dot(rgb, vec3(0.2126729, 0.7151522, 0.072175)).toConst();
            const z = dot(rgb, vec3(0.0193339, 0.119192, 0.9503041));
            If(y.lessThan(1e-7), () => {
                return rgb;
            });
            const s = x.add(y).add(z).toConst();
            const n = x
                .div(s)
                .sub(0.332)
                .div(float(0.1858).sub(y.div(s)))
                .toConst();
            const t = clamp(
                n.mul(449.0).add(3525.0).mul(n).add(6823.3).mul(n).add(5520.33),
                1700.0,
                25000.0,
            ).toConst();
            const rest = blackbody(t).rgb;
            const seen = blackbody(color_shift(g).mul(t)).rgb;
            return rgb.mul(seen.div(max(rest, vec3(1e-3)))).mul(thermal_brightness_ratio(t, g));
        },
        { rgb: 'vec3', g: 'float', return: 'vec3' },
    );

    // Latitude-longitude grid about the spin axis, every 15 degrees with the equator and the +x
    // meridian highlighted, on a dim base so every escaping ray is visible. Line widths grow with
    // the pixel footprint on the sky and fade to their mean coverage once the footprint spans a
    // grid cell, so lensed regions converge instead of aliasing.
    const grid_sky = Fn(
        ([dir, dx, dy]) => {
            const SPACING = 15.0 * DEG_TO_RAD;
            const HALF_WIDTH = 0.2 * DEG_TO_RAD;
            const footprint = max(length(dx), length(dy)).toConst();
            const lat = asin(clamp(dir.z, -1.0, 1.0)).toConst();
            const lon = atan(dir.y, dir.x).toConst();
            const w = footprint.add(HALF_WIDTH).toConst();
            const coslat = max(cos(lat), 1e-3).toConst();
            const d_lat = abs(fract(lat.div(SPACING).add(0.5)).sub(0.5)).mul(SPACING);
            const d_lon = abs(fract(lon.div(SPACING).add(0.5)).sub(0.5))
                .mul(SPACING)
                .mul(coslat);
            const mean = Math.min(Math.max((4.0 * HALF_WIDTH) / SPACING, 0.0), 1.0);
            const lines = mix(
                max(
                    float(1.0).sub(smoothstep(HALF_WIDTH, w, d_lat)),
                    float(1.0).sub(smoothstep(HALF_WIDTH, w, d_lon)),
                ),
                float(mean),
                smoothstep(0.25 * SPACING, SPACING, footprint),
            );
            const equator = abs(lat).lessThan(w);
            const meridian = abs(lon).lessThan(w.div(coslat));
            const line_color = select(
                equator,
                vec3(1.0, 0.55, 0.18),
                select(meridian, vec3(0.35, 0.75, 1.0), vec3(0.85)),
            );
            return mix(vec3(0.02, 0.025, 0.04), line_color, lines);
        },
        { dir: 'vec3', dx: 'vec3', dy: 'vec3', return: 'vec3' },
    );

    // Radiance of the sky along a hole-frame direction, filtered over the pixel footprint.
    const sky_radiance = Fn(
        ([dir, dx, dy]) => {
            If(U.sky_mode.greaterThan(0.5), () => {
                return grid_sky(dir, dx, dy);
            });
            return sampleCubeGradient(U.sky_cube, dir, dx, dy).rgb;
        },
        { dir: 'vec3', dx: 'vec3', dy: 'vec3', return: 'vec3' },
    );

    const static_redshift = Fn(
        ([r]) => sqrt(max(float(1.0).sub(float(1.0).div(max(r, 1.0001))), 1e-4)),
        {
            r: 'float',
            return: 'float',
        },
    );

    // --- Novikov-Thorne / Page-Thorne disk (Page & Thorne 1974), x = sqrt(r/M) -------------

    const page_thorne_bracket = (x) => {
        const ratio = x.sub(U.disk_pt_roots).div(U.disk_pt_x0.sub(U.disk_pt_roots));
        return x
            .sub(U.disk_pt_x0)
            .sub(U.disk_spin_a.mul(1.5).mul(log(x.div(U.disk_pt_x0))))
            .sub(dot(U.disk_pt_coeffs, log(max(ratio, vec3(1e-30)))));
    };

    // Comoving flux relative to the zero-torque maximum. A stress term K = stress x0 adds the flux
    // of a torque at the ISCO, which then continues inward as (r / r_isco)^1.5.
    const disk_relative_flux = Fn(
        ([r, stress]) => {
            const x = sqrt(max(r, 1e-4).div(KERR_M)).toConst();
            const xc = max(x, U.disk_pt_x0).toConst();
            const d = xc.mul(xc).mul(xc).sub(xc.mul(3.0)).add(U.disk_spin_a.mul(2.0));
            const flux = page_thorne_bracket(xc)
                .add(stress.mul(U.disk_pt_x0))
                .div(sq(sq(xc)).mul(max(d, 1e-6)))
                .toVar();
            If(x.lessThan(U.disk_pt_x0), () => {
                const q = x.div(U.disk_pt_x0);
                flux.mulAssign(q.mul(q).mul(q));
            });
            return max(flux, 0.0).div(U.disk_flux_max);
        },
        { r: 'float', stress: 'float', return: 'float' },
    );

    const disk_temperature_at = Fn(
        ([r, stress]) => {
            If(U.disk_uniform_temperature.greaterThan(0.5), () => {
                return U.disk_temperature_peak;
            });
            return U.disk_temperature_peak.mul(pow(disk_relative_flux(r, stress), 0.25));
        },
        { r: 'float', stress: 'float', return: 'float' },
    );

    const disk_limb_darkening = (mu) => U.disk_limb.x.add(U.disk_limb.y.mul(clamp(mu, 0.0, 1.0)));

    // Boyer-Lindquist (u^t, u^r, u^phi) of gas plunging from the ISCO with its E and L
    // (Cunningham 1975), at the equator, in units of M with a >= 0.
    const plunging_velocity = Fn(
        ([rm, a]) => {
            const E = U.disk_isco_el.x;
            const L = U.disk_isco_el.y;
            const r2a2 = rm.mul(rm).add(a.mul(a)).toConst();
            const delta = max(rm.mul(rm).sub(rm.mul(2.0)).add(a.mul(a)), 1e-6).toConst();
            const P = E.mul(r2a2).sub(a.mul(L)).toConst();
            const radial = P.mul(P).sub(delta.mul(rm.mul(rm).add(sq(L.sub(a.mul(E))))));
            const rr = rm.mul(rm).toConst();
            return vec3(
                r2a2
                    .mul(P)
                    .div(delta)
                    .sub(a.mul(a.mul(E).sub(L)))
                    .div(rr),
                sqrt(max(radial, 0.0)).negate().div(rr),
                a.mul(P).div(delta).sub(a.mul(E).sub(L)).div(rr),
            );
        },
        { rm: 'float', a: 'float', return: 'vec3' },
    );

    // Binet solver: the photon has energy E, angular momentum Lz about the spin axis and total
    // angular momentum L (code units, per camera frequency). A circular Kerr orbit gives
    // nu_em = u^t (E - Omega Lz); the plunging flow adds -p_r u^r, with the Schwarzschild p_r of
    // the Binet orbit whose sign follows the backward trace (du > 0: the photon was outgoing). The
    // fluid-frame emission angle is mu = |p_z| / nu_em with |p_z| = sqrt(L^2 - Lz^2) / r. Returns
    // (g, mu); sense < 0 mirrors a clockwise disk.
    const binet_disk_shift = Fn(
        ([r, sense, E, Lz, L, du_sign]) => {
            const a = U.disk_spin_a;
            const rm = r.div(KERR_M).toConst();
            const lz = sense.mul(Lz).div(KERR_M).toConst();
            const l = L.div(KERR_M).toConst();
            const nu = float(0.0).toVar();
            If(r.greaterThanEqual(U.accretion_inner_r), () => {
                const s = sqrt(rm).toConst();
                const ut = rm
                    .mul(s)
                    .add(a)
                    .div(
                        pow(rm, 0.75).mul(
                            sqrt(max(rm.mul(s).sub(s.mul(3.0)).add(a.mul(2.0)), 1e-6)),
                        ),
                    );
                nu.assign(ut.mul(E.sub(lz.div(rm.mul(s).add(a)))));
            }).Else(() => {
                const u = plunging_velocity(rm, a).toConst();
                const f = max(float(1.0).sub(float(2.0).div(rm)), 1e-4).toConst();
                const pr = du_sign
                    .mul(sqrt(max(E.mul(E).sub(f.mul(l).mul(l).div(rm.mul(rm))), 0.0)))
                    .div(f);
                nu.assign(E.mul(u.x).sub(pr.mul(u.y)).sub(lz.mul(u.z)));
            });
            nu.assign(max(nu, 1e-4));
            return vec2(
                float(1.0).div(nu),
                sqrt(max(l.mul(l).sub(lz.mul(lz)), 0.0)).div(rm.mul(nu)),
            );
        },
        {
            r: 'float',
            sense: 'float',
            E: 'float',
            Lz: 'float',
            L: 'float',
            du_sign: 'float',
            return: 'vec2',
        },
    );

    // Binet solver: frequency ratio of a flow rotating rigidly at angular velocity omega (code
    // units) about the spin axis at pos, in the Schwarzschild geometry of the solver.
    const binet_flow_shift = Fn(
        ([pos, omega, E, Lz]) => {
            const r = max(length(pos), 1.0001);
            const ut = float(1.0).div(
                sqrt(
                    max(
                        float(1.0)
                            .sub(float(1.0).div(r))
                            .sub(sq(omega).mul(dot(pos.xy, pos.xy))),
                        1e-4,
                    ),
                ),
            );
            return float(1.0).div(max(ut.mul(E.sub(omega.mul(Lz))), 1e-4));
        },
        { pos: 'vec3', omega: 'float', E: 'float', Lz: 'float', return: 'float' },
    );

    // Keplerian angular velocity of a prograde equatorial Kerr orbit, in code units.
    const binet_kepler_omega = (r) =>
        float(1.0).div(pow(r.div(KERR_M), 1.5).add(U.disk_spin_a).mul(KERR_M));

    // Full Kerr: nu_em = p.u for the backward covector (p_t, p) at the Cartesian Kerr-Schild
    // crossing q (z = 0, x^2 + y^2 = r^2 + a^2) with r >= r_isco circular and plunging inside. The
    // plunging 4-velocity goes BL -> KS (u^t += 2Mr/Delta u^r, u^phi += a/Delta u^r) -> Cartesian
    // (u^x = l_x u^r - y u^phi, u^y = l_y u^r + x u^phi). A clockwise disk (sense < 0, a < 0) is
    // evaluated in the mirror image y -> -y. Returns (g, mu) with mu = |p_z| / nu_em.
    const kerr_disk_shift = Fn(
        ([q, isec, r, a, sense, p_t, p_phi, p, nu_cam]) => {
            const nu = float(0.0).toVar();
            If(r.greaterThanEqual(U.accretion_inner_r), () => {
                nu.assign(
                    geo.kerr_orbit_frequency(
                        isec,
                        geo.kerr_kepler_omega(r, a, sense),
                        p_t,
                        p_phi,
                        a,
                    ),
                );
            }).Else(() => {
                const am = abs(a).toConst();
                const xy = vec2(q.x, sense.mul(q.y)).toConst();
                const pxy = vec2(p.x, sense.mul(p.y)).toConst();
                const rm = r.div(KERR_M).toConst();
                const amm = am.div(KERR_M).toConst();
                const u = plunging_velocity(rm, amm).toConst();
                const delta = max(rm.mul(rm).sub(rm.mul(2.0)).add(amm.mul(amm)), 1e-6).toConst();
                const ut = u.x.add(rm.mul(2.0).div(delta).mul(u.y));
                const uphi = u.z.add(amm.div(delta).mul(u.y)).div(KERR_M).toConst();
                const l = vec2(r.mul(xy.x).add(am.mul(xy.y)), r.mul(xy.y).sub(am.mul(xy.x)))
                    .div(r.mul(r).add(am.mul(am)))
                    .toConst();
                nu.assign(
                    p_t
                        .mul(ut)
                        .add(pxy.x.mul(l.x.mul(u.y).sub(xy.y.mul(uphi))))
                        .add(pxy.y.mul(l.y.mul(u.y).add(xy.x.mul(uphi)))),
                );
            });
            nu.assign(max(nu, 1e-6));
            return vec2(nu_cam.div(nu), abs(p.z).div(nu));
        },
        {
            q: 'vec3',
            isec: 'vec3',
            r: 'float',
            a: 'float',
            sense: 'float',
            p_t: 'float',
            p_phi: 'float',
            p: 'vec3',
            nu_cam: 'float',
            return: 'vec2',
        },
    );

    return {
        blackbody,
        power_law_color,
        color_shift,
        brightness_shift,
        thermal_radiance,
        thermal_brightness_ratio,
        shifted_sky_radiance,
        sky_radiance,
        static_redshift,
        disk_relative_flux,
        disk_temperature_at,
        disk_limb_darkening,
        binet_disk_shift,
        binet_flow_shift,
        binet_kepler_omega,
        kerr_disk_shift,
    };
}
