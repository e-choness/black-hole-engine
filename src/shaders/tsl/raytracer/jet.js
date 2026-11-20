// Relativistic jets. Simple: a smooth parabolic jet with a spine/limb synchrotron profile.
// Physical: a GRMHD-inspired model (Moscibrodzka+ 2016; Davelaar+ 2019; Blandford & Znajek 1977;
// Asada & Nakamura 2012; Tchekhovskoy+ 2011; Fromm+ 2022) with a magnetised funnel, spine and
// sheath, reconfinement knots, the jet-corona connection and spectral ageing.

import {
    Fn,
    If,
    clamp,
    exp,
    float,
    length,
    max,
    min,
    mix,
    pow,
    sin,
    smoothstep,
    sqrt,
    tan,
    vec3,
} from 'three/tsl';
import { DEG_TO_RAD, M_PI } from './math.js';

export function createJet(F, U, acc, grmhd) {
    const K_COLLIMATE = 0.58; // Asada & Nakamura parabolic index

    // --- Simple jet --------------------------------------------------------------------------

    const simple_jet_emissivity = Fn(
        ([p, sign_z]) => {
            const z = p.z.mul(sign_z).toConst();
            If(z.lessThan(1.2), () => {
                return float(0.0);
            });
            const cyl_r = length(p.xy).toConst();
            const r_at_length = U.jet_length.mul(tan(U.jet_half_angle.mul(DEG_TO_RAD)));
            const r0 = r_at_length.div(pow(U.jet_length, K_COLLIMATE));
            const jet_r = r0.mul(pow(z, K_COLLIMATE)).toConst();
            If(cyl_r.greaterThan(jet_r.mul(1.2)), () => {
                return float(0.0);
            });
            const r_norm = cyl_r.div(max(jet_r, 0.001)).toConst();
            const spine = exp(r_norm.mul(r_norm).mul(-4.0));
            const limb = exp(r_norm.sub(0.8).mul(r_norm.sub(0.8)).mul(-12.0)).mul(0.35);
            const z_onset = smoothstep(1.2, 3.0, z);
            const z_decay = pow(z, -1.2);
            const z_cutoff = float(1.0).sub(smoothstep(U.jet_length.mul(0.75), U.jet_length, z));
            return spine.add(limb).mul(z_onset).mul(z_decay).mul(z_cutoff);
        },
        { p: 'vec3', sign_z: 'float', return: 'float' },
    );

    const simple_jet_velocity = Fn(
        ([p, sign_z]) => {
            const beta_max = sqrt(float(1.0).sub(float(1.0).div(U.jet_lorentz.mul(U.jet_lorentz))));
            const beta = beta_max.mul(smoothstep(1.2, 5.0, p.z.abs())).toConst();
            const cyl_r = length(p.xy);
            const v_z = vec3(0.0, 0.0, sign_z).mul(beta);
            const v_phi = vec3(p.y.negate(), p.x, 0.0).div(max(cyl_r, 0.01)).mul(beta.mul(0.03));
            return v_z.add(v_phi);
        },
        { p: 'vec3', sign_z: 'float', return: 'vec3' },
    );

    // --- Physical jet ------------------------------------------------------------------------

    // Funnel wall along field lines threading the ergosphere: parabolic r ~ z^k, with the base
    // index set by jet_base_width easing into k = 0.58 at large z.
    const jet_boundary_radius = Fn(
        ([z]) => {
            const k_base = mix(0.62, 0.85, clamp(U.jet_base_width, 0.0, 1.0));
            const k_eff = mix(k_base, K_COLLIMATE, smoothstep(3.0, 8.0, z));
            const r_at_length = U.jet_length.mul(tan(U.jet_half_angle.mul(DEG_TO_RAD)));
            const r0_param = r_at_length.div(pow(U.jet_length, K_COLLIMATE));
            return r0_param.mul(pow(max(z, 0.01), k_eff));
        },
        { z: 'float', return: 'float' },
    );

    // Fast, magnetically dominated spine (narrower at higher sigma) inside a slower, denser sheath
    // peaked near the boundary layer, with a sharp outer boundary.
    const jet_transverse_profile = Fn(
        ([cyl_r, jet_r, sigma]) => {
            const r_norm = cyl_r.div(max(jet_r, 0.001)).toConst();
            const spine_width = mix(3.0, 6.0, clamp(sigma.div(30.0), 0.0, 1.0));
            const spine = exp(spine_width.negate().mul(r_norm).mul(r_norm));
            const sheath = exp(r_norm.sub(0.82).mul(r_norm.sub(0.82)).mul(-15.0)).mul(0.6);
            const boundary = float(1.0).sub(smoothstep(0.95, 1.05, r_norm));
            return spine.add(sheath).mul(boundary);
        },
        { cyl_r: 'float', jet_r: 'float', sigma: 'float', return: 'float' },
    );

    // Standing reconfinement shocks: periodic knots, strongest at intermediate distances.
    const reconfinement_knots = (z) => {
        const spacing = max(U.jet_knot_spacing, 2.0);
        const s = sin(z.mul(M_PI).div(spacing)).toConst();
        const knot_envelope = smoothstep(4.0, 8.0, z).mul(
            float(1.0).sub(smoothstep(U.jet_length.mul(0.6), U.jet_length.mul(0.85), z)),
        );
        return s.mul(s).mul(knot_envelope).mul(0.35).add(1.0);
    };

    // Jet launching zone where the funnel meets the hot corona above the disk.
    const corona_base_emission = Fn(
        ([p, z, cyl_r]) => {
            const r3d = length(p).toConst();
            const base_z = smoothstep(1.0, 1.8, z).mul(float(1.0).sub(smoothstep(2.5, 5.0, z)));
            const corona_width = mix(2.0, 0.8, clamp(U.jet_corona_extent, 0.0, 1.0));
            const base_r = exp(corona_width.negate().mul(cyl_r).mul(cyl_r));
            const mag_energy = float(1.0).div(r3d.mul(r3d).mul(r3d).add(0.1));
            return U.jet_corona_brightness.mul(base_z).mul(base_r).mul(mag_energy).mul(3.0);
        },
        { p: 'vec3', z: 'float', cyl_r: 'float', return: 'float' },
    );

    // Magnetization sigma = B^2 / (4 pi rho c^2), falling about as 1/z with a residual floor.
    const magnetization = (z) => U.jet_magnetization.div(z.mul(0.15).add(1.0)).add(0.5);

    // Physical jet emissivity j ~ rho^2 B^2 x geometry.
    const physical_jet_emissivity = Fn(
        ([p, sign_z]) => {
            const z = p.z.mul(sign_z).toConst();
            If(z.lessThan(0.8), () => {
                return float(0.0);
            });
            const cyl_r = length(p.xy).toConst();
            const r3d = length(p).toConst();
            const jet_r = jet_boundary_radius(z).toConst();
            If(cyl_r.greaterThan(jet_r.mul(1.15)), () => {
                If(z.lessThan(5.0).and(r3d.lessThan(5.0)), () => {
                    return corona_base_emission(p, z, cyl_r);
                });
                return float(0.0);
            });
            const sigma = magnetization(z).toConst();
            const profile = jet_transverse_profile(cyl_r, jet_r, sigma);
            const z_onset = smoothstep(0.8, 2.5, z);
            const z_decay = pow(max(z, 1.0), -2.2);
            const z_cutoff = float(1.0).sub(smoothstep(U.jet_length.mul(0.7), U.jet_length, z));
            const j = profile.mul(z_onset).mul(z_decay).mul(z_cutoff).mul(reconfinement_knots(z));
            return j.add(corona_base_emission(p, z, cyl_r));
        },
        { p: 'vec3', sign_z: 'float', return: 'float' },
    );

    // Spine at the bulk Lorentz factor, sheath at ~0.4c, accelerating as magnetic energy turns
    // kinetic, with a helical component stronger in the sheath.
    const physical_jet_velocity = Fn(
        ([p, sign_z]) => {
            const z = p.z.abs().toConst();
            const cyl_r = length(p.xy).toConst();
            const r_norm = cyl_r.div(max(jet_boundary_radius(z), 0.001)).toConst();
            const beta_max = sqrt(float(1.0).sub(float(1.0).div(U.jet_lorentz.mul(U.jet_lorentz))));
            const accel = float(1.0)
                .sub(float(1.0).div(z.mul(z).mul(0.5).div(z.add(4.0)).add(1.0)))
                .toConst();
            const spine_frac = exp(r_norm.mul(r_norm).mul(-3.0)).toConst();
            const beta = mix(accel.mul(0.4), beta_max.mul(accel), spine_frac).toConst();
            const phi_fraction = mix(0.15, 0.03, spine_frac)
                .mul(min(z.div(5.0), 1.0))
                .toConst();
            const v_z = vec3(0.0, 0.0, sign_z).mul(
                beta.mul(sqrt(float(1.0).sub(phi_fraction.mul(phi_fraction)))),
            );
            const v_phi = vec3(p.y.negate(), p.x, 0.0)
                .div(max(cyl_r, 0.01))
                .mul(beta.mul(phi_fraction));
            return v_z.add(v_phi);
        },
        { p: 'vec3', sign_z: 'float', return: 'vec3' },
    );

    // Radiative ageing steepens the optically thin spectrum by 0.5 above the cooling break
    // (Kardashev 1962); reconnection at sigma > 1 hardens it slightly near the base.
    const jet_aged_spectral_index = (cooled, sigma) =>
        U.jet_spectral_index
            .add(cooled.mul(0.5))
            .sub(clamp(sigma.sub(1.0), 0.0, 5.0).mul(0.2 / 5.0));

    const physical_jet_spectral_index = (z, sigma) =>
        jet_aged_spectral_index(smoothstep(2.0, 15.0, z), sigma);

    // --- GRMHD jet enhancements -----------------------------------------------------------

    // Blandford-Znajek power P ~ Phi^2 Omega_H^2, Omega_H = a / (2 r_+), higher with MAD flux.
    const grmhd_bz_power_factor = () => {
        const a = clamp(U.bh_spin.mul(U.bh_rotation_enabled), -0.99, 0.99).toConst();
        const r_plus = sqrt(max(float(1.0).sub(a.mul(a)), 0.0))
            .mul(0.5)
            .add(0.5);
        const omega_H = a.div(r_plus.mul(2.0)).toConst();
        return mix(0.3, 1.0, U.grmhd_mad_flux).mul(omega_H).mul(omega_H).mul(40.0).add(0.1);
    };

    // Current-driven kink instability: m = 1 helical distortions beyond a growth length
    // (Bromberg & Tchekhovskoy 2016).
    const grmhd_kink_instability = (z, jet_r) => {
        const growth_length = max(jet_r.mul(4.0), 5.0).toConst();
        const kink_amp = smoothstep(growth_length, growth_length.mul(2.0), z);
        const phase = z.mul(0.8).div(max(jet_r, 0.5));
        return kink_amp.mul(sin(phase)).mul(U.grmhd_mad_flux).mul(0.25).add(1.0);
    };

    // Cooled fraction in [0, 0.7]: electrons cool faster in the high-B (low-sigma) base.
    const grmhd_cooling_fraction = (z, sigma) => {
        const cool_rate = float(0.5).div(max(sigma, 0.1)).add(1.0);
        return float(1.0).sub(max(exp(cool_rate.mul(-0.05).mul(max(z.sub(3.0), 0.0))), 0.3));
    };

    const grmhd_jet_emissivity = Fn(
        ([p, sign_z]) => {
            const z = p.z.mul(sign_z).toConst();
            If(z.lessThan(0.8), () => {
                return float(0.0);
            });
            const cyl_r = length(p.xy).toConst();
            const r3d = length(p).toConst();
            const jet_r = jet_boundary_radius(z).toConst();
            const bz = grmhd_bz_power_factor().toConst();
            If(cyl_r.greaterThan(jet_r.mul(1.15)), () => {
                If(z.lessThan(5.0).and(r3d.lessThan(5.0)), () => {
                    return corona_base_emission(p, z, cyl_r).mul(bz);
                });
                return float(0.0);
            });
            const sigma = magnetization(z).toConst();
            const profile = jet_transverse_profile(cyl_r, jet_r, sigma);
            const z_onset = smoothstep(0.8, 2.5, z);
            const z_decay = pow(max(z, 1.0), -2.2);
            const z_cutoff = float(1.0).sub(smoothstep(U.jet_length.mul(0.7), U.jet_length, z));
            const kink = grmhd_kink_instability(z, jet_r);
            const nonthermal = grmhd.grmhd_nonthermal_boost(U.grmhd_electron_kappa);
            const angle_j = acc.equatorial_azimuth(p.xy);
            const jet_turb = grmhd.grmhd_mri_turbulence(
                r3d,
                angle_j,
                acc.loopable_turbulence_time(U.time),
            );
            const j = profile
                .mul(z_onset)
                .mul(z_decay)
                .mul(z_cutoff)
                .mul(reconfinement_knots(z))
                .mul(kink)
                .mul(nonthermal)
                .mul(jet_turb)
                .mul(bz);
            return j.add(corona_base_emission(p, z, cyl_r).mul(bz));
        },
        { p: 'vec3', sign_z: 'float', return: 'float' },
    );

    const grmhd_jet_spectral_index = (z, sigma) =>
        jet_aged_spectral_index(grmhd_cooling_fraction(z, sigma).div(0.7), sigma);

    const physical = F.jet_physical;
    return {
        // Emissivity of the configured jet; the GRMHD variant replaces the physical one.
        jet_emissivity: (p, sign_z) => {
            if (!physical) return simple_jet_emissivity(p, sign_z);
            return F.grmhd_enabled
                ? grmhd_jet_emissivity(p, sign_z)
                : physical_jet_emissivity(p, sign_z);
        },
        jet_velocity: physical ? physical_jet_velocity : simple_jet_velocity,
        magnetization,
        jet_spectral_index: (z, sigma) =>
            F.grmhd_enabled
                ? grmhd_jet_spectral_index(z, sigma)
                : physical_jet_spectral_index(z, sigma),
    };
}
