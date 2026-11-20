// Semi-analytic models inspired by GRMHD simulation results: EHT Collaboration et al. (2019,
// Paper V); Moscibrodzka, Falcke & Shiokawa (2016); Narayan, Sadowski et al. (2012); Fishbone &
// Moncrief (1976); Mahadevan, Narayan & Yi (1996); Howes (2010); Pandya et al. (2016);
// Tchekhovskoy, Narayan & McKinney (2011).

import {
    Fn,
    If,
    abs,
    cos,
    exp,
    float,
    length,
    log,
    max,
    mix,
    pow,
    sin,
    smoothstep,
    sqrt,
    vec2,
} from 'three/tsl';
import { fbm } from './math.js';

export function createGrmhd(F, U, acc) {
    const ACCRETION_MIN_R = U.accretion_inner_r;
    const rotation = () => acc.disk_rotation_sign();

    // Plasma beta P_gas / P_mag: >> 1 in the turbulent midplane, ~1 in the corona, << 1 in the
    // jet funnel, lower everywhere in the MAD state.
    const grmhd_plasma_beta = Fn(
        ([cyl_r, z, disk_h]) => {
            const z_norm = abs(z).div(max(disk_h, 0.01)).toConst();
            const beta = U.grmhd_magnetic_beta
                .mul(exp(z_norm.mul(z_norm).mul(-1.5)))
                .mul(mix(1.0, 0.08, U.grmhd_mad_flux))
                .mul(pow(max(cyl_r.div(4.0), 0.5), 0.5));
            return max(beta, 0.005);
        },
        { cyl_r: 'float', z: 'float', disk_h: 'float', return: 'float' },
    );

    // EHT R_high prescription R(beta) = R_high beta^2 / (1 + beta^2) + 1 / (1 + beta^2) for
    // R = T_i / T_e, returned as the renderer weight 1 / (1 + R).
    const grmhd_electron_temp_ratio = Fn(
        ([beta]) => {
            const b2 = beta.mul(beta).toConst();
            const R = U.grmhd_r_high
                .mul(b2)
                .div(b2.add(1.0))
                .add(float(1.0).div(b2.add(1.0)));
            return float(1.0).div(R.add(1.0));
        },
        { beta: 'float', return: 'float' },
    );

    // The disk model temperature is the nominal electron temperature; beta modulates it by about
    // +-25% (hotter at low beta) with a slow orbiting variation of 10%.
    const grmhd_electron_temperature = Fn(
        ([gas_temp, cyl_r, z, disk_h, t, angle]) => {
            const beta = grmhd_plasma_beta(cyl_r, z, disk_h);
            const temp_mod = float(0.5).div(beta.mul(0.15).add(1.0)).add(0.75);
            const orbit_phase = angle
                .sub(
                    rotation()
                        .mul(0.3)
                        .mul(t)
                        .div(pow(max(cyl_r, 1.0), 1.5)),
                )
                .toConst();
            const orbit_unit = vec2(cos(orbit_phase), sin(orbit_phase)).toConst();
            const t_noise = fbm(
                vec2(
                    cyl_r.mul(2.0).add(orbit_unit.x.mul(2.5)),
                    orbit_unit.y.mul(2.5).add(t.mul(0.15)),
                ),
            );
            const t_var = t_noise
                .sub(0.5)
                .mul(0.1)
                .mul(exp(max(cyl_r.sub(ACCRETION_MIN_R), 0.0).mul(-0.4)))
                .add(1.0);
            return gas_temp.mul(temp_mod).mul(t_var);
        },
        {
            gas_temp: 'float',
            cyl_r: 'float',
            z: 'float',
            disk_h: 'float',
            t: 'float',
            angle: 'float',
            return: 'float',
        },
    );

    // Dimensionless field B ~ sqrt(2 rho T_norm / beta), T_norm = T / T_disk, of order 0.1-3.
    const grmhd_B_field = (density, temperature, beta) =>
        U.grmhd_magnetic_field_str.mul(
            sqrt(
                density
                    .mul(2.0)
                    .mul(max(temperature, 1.0).div(max(U.disk_temperature_peak, 1.0)))
                    .div(max(beta, 0.01)),
            ),
        );

    // Synchrotron modulation in [0.3, 3] from field strength and density (Mahadevan+ 1996).
    const grmhd_synchrotron_correction = (B_norm, density_norm) => {
        const efficiency = B_norm.mul(density_norm.mul(0.8).add(0.2)).toConst();
        return efficiency.mul(2.7).div(efficiency.add(1.0)).add(0.3);
    };

    // Power-law density profile rho ~ r^-1.2.
    const grmhd_density = (r, base_density) =>
        base_density.mul(pow(float(4.0).div(max(r, 1.0)), 1.2)).mul(U.grmhd_density_scale);

    // MRI turbulence on a turbulence pattern `base` with a mean of about 0.85: log-normal
    // fluctuations (sigma_ln ~ 0.5-1) of the plasma pattern, or the gas density of the arcs, which
    // already carries its own contrast, with the dominant m = 1 spiral of the arrested flux tube in
    // the MAD state.
    const mri_fluctuation = (base, r, angle, t, arcs) => {
        const orbital_freq = float(1.0).div(pow(max(r, 1.5), 1.5));
        const spiral_phase = angle.sub(rotation().mul(orbital_freq).mul(t)).toConst();
        const mad_spiral = float(0.0).toVar();
        If(U.grmhd_mad_flux.greaterThan(0.1), () => {
            const lr = log(max(r, 1.0)).toConst();
            const sp1 = sin(spiral_phase.add(lr.mul(2.5)));
            const sp2 = sin(spiral_phase.mul(2.0).add(lr.mul(4.0)).add(1.3));
            mad_spiral.assign(
                U.grmhd_mad_flux.mul(max(sp1, 0.0).mul(0.3).add(max(sp2, 0.0).mul(0.15))),
            );
        });
        if (arcs) return base.div(0.85).mul(mad_spiral.add(1.0));
        const sigma_ln = U.grmhd_turbulence_amp.mul(0.6).add(0.4);
        const log_fluct = exp(sigma_ln.mul(base.sub(0.85)).mul(2.0)).clamp(0.2, 5.0);
        return log_fluct.mul(mad_spiral.add(1.0));
    };

    // On the plasma pattern, for the jets.
    const grmhd_mri_turbulence = Fn(
        ([r, angle, t]) => mri_fluctuation(acc.accretion_turbulence(r, angle, t), r, angle, t),
        { r: 'float', angle: 'float', t: 'float', return: 'float' },
    );

    // On the disk's own pattern, evaluated once by the trace.
    const grmhd_disk_turbulence = Fn(
        ([base, r, angle, t]) => mri_fluctuation(base, r, angle, t, F.disk_arcs),
        { base: 'float', r: 'float', angle: 'float', t: 'float', return: 'float' },
    );

    // Non-thermal kappa-distribution boost; kappa -> infinity is thermal.
    const grmhd_nonthermal_boost = (kappa) => float(2.0).div(max(kappa, 2.5).sub(2.0)).add(1.0);

    // Magnetic stress at the ISCO: emission persists into the plunging region (Noble+ 2010,
    // Penna+ 2010).
    const grmhd_isco_stress_factor = Fn(
        ([r]) => {
            If(r.greaterThanEqual(ACCRETION_MIN_R), () => {
                return float(1.0);
            });
            const f = r.div(max(ACCRETION_MIN_R, 1.0));
            return pow(f, 1.5).mul(U.grmhd_mad_flux.mul(0.5).add(1.0));
        },
        { r: 'float', return: 'float' },
    );

    // Filamentary 3-D density structure: multi-scale FBM in co-rotating coordinates with
    // log-normal fluctuations and the m = 1, 2 MRI spirals (Hawley & Balbus 2002; Beckwith+ 2008).
    const grmhd_3d_density_turbulence = Fn(
        ([p, t]) => {
            const cyl_r = length(p.xy).toConst();
            const angle = acc.equatorial_azimuth(p.xy);
            const orbit_phase = angle
                .sub(
                    rotation()
                        .mul(0.45)
                        .mul(t)
                        .div(pow(max(cyl_r, 1.001), 1.5)),
                )
                .toConst();
            const orbit_unit = vec2(cos(orbit_phase), sin(orbit_phase)).toConst();
            const z_sc = p.z.mul(1.5).toConst();
            const lr = log(max(cyl_r, 1.0)).toConst();

            const sp1 = sin(orbit_phase.add(lr.mul(3.0)));
            const sp2 = sin(orbit_phase.mul(2.0).add(lr.mul(5.5)).add(1.7));
            const spirals = smoothstep(-0.3, 1.0, sp1)
                .mul(0.45)
                .add(smoothstep(-0.3, 1.0, sp2).mul(0.35))
                .toVar();
            If(U.grmhd_mad_flux.greaterThan(0.1), () => {
                const sp_mad = sin(orbit_phase.add(lr.mul(2.5)));
                spirals.addAssign(U.grmhd_mad_flux.mul(0.7).mul(smoothstep(-0.1, 1.0, sp_mad)));
            });

            const n1 = fbm(
                vec2(
                    cyl_r.mul(2.0).add(orbit_unit.x.mul(4.0)),
                    orbit_unit.y.mul(4.0).add(z_sc.mul(1.5)).add(t.mul(0.05)),
                ),
            ).toConst();
            const n2 = fbm(
                vec2(
                    cyl_r.mul(8.0).add(orbit_unit.x.mul(12.0)).add(n1.mul(2.0)),
                    orbit_unit.y.mul(12.0).add(z_sc.mul(5.0)).sub(t.mul(0.15)),
                ),
            ).toConst();
            const isco_factor = exp(max(cyl_r.sub(ACCRETION_MIN_R), 0.0).mul(-0.8));
            const n3 = fbm(
                vec2(
                    cyl_r.mul(20.0).add(orbit_unit.x.mul(35.0)).sub(n2.mul(4.0)),
                    orbit_unit.y.mul(35.0).add(z_sc.mul(12.0)).add(t.mul(0.55)),
                ),
            );
            const sigma_ln = U.grmhd_turbulence_amp.mul(1.5).add(0.8);
            const combined = n1
                .mul(0.35)
                .add(n2.mul(0.35))
                .add(isco_factor.mul(0.4).add(0.15).mul(n3));
            const log_density = exp(sigma_ln.mul(combined.sub(0.5)).mul(4.5));
            return log_density.mul(spirals.mul(1.2).add(0.65));
        },
        { p: 'vec3', t: 'float', return: 'float' },
    );

    // Azimuthal scale-height variation of about +-15% from MRI and the Parker instability
    // (Zhu & Stone 2018; Liska+ 2022).
    const grmhd_height_modulation = Fn(
        ([cyl_r, angle, t]) => {
            const orbit_phase = angle
                .sub(
                    rotation()
                        .mul(0.45)
                        .mul(t)
                        .div(pow(max(cyl_r, 1.001), 1.5)),
                )
                .toConst();
            const orbit_unit = vec2(cos(orbit_phase), sin(orbit_phase)).toConst();
            const warp = fbm(
                vec2(
                    cyl_r.mul(0.9).add(orbit_unit.x.mul(2.0)),
                    orbit_unit.y.mul(2.0).add(t.mul(0.05)),
                ),
            );
            return warp.sub(0.5).mul(0.5).mul(U.grmhd_turbulence_amp).add(1.0);
        },
        { cyl_r: 'float', angle: 'float', t: 'float', return: 'float' },
    );

    return {
        grmhd_plasma_beta,
        grmhd_electron_temp_ratio,
        grmhd_electron_temperature,
        grmhd_B_field,
        grmhd_synchrotron_correction,
        grmhd_density,
        grmhd_mri_turbulence,
        grmhd_disk_turbulence,
        grmhd_nonthermal_boost,
        grmhd_isco_stress_factor,
        grmhd_3d_density_turbulence,
        grmhd_height_modulation,
    };
}
