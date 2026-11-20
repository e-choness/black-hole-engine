// Accretion flows: the shared turbulence pattern, the ADAF/RIAF thick torus, the slim disk and
// the colour temperature of the disk light that reaches the planet.

import {
    Fn,
    If,
    abs,
    atan,
    cos,
    exp,
    float,
    length,
    log,
    max,
    mix,
    mod,
    pow,
    select,
    sin,
    smoothstep,
    vec2,
} from 'three/tsl';
import { fbm } from './math.js';
import { ACCRETION_WIDTH, DISK_SLIM_STRESS } from './emission.js';

// Emission optical depth of the torus per unit fluid-frame length and unit local emissivity, so
// a step adds tau S with the thermal source S = B(g T). A look scale: it puts the M87* and Sgr A*
// presets near the anchored exposure of a photosphere at the peak temperature.
export const TORUS_EMISSIVITY_SCALE = 0.012;

export function createAccretion(F, U, em) {
    const ACCRETION_MIN_R = U.accretion_inner_r;

    // Wraps the turbulence clock so the highest FBM octaves keep their sub-cell resolution: a long
    // prime period (10007 s) when the loop is off, the user period for seamless video loops.
    const loopable_turbulence_time = Fn(
        ([t]) => {
            const period = select(
                U.turbulence_loop_enabled.lessThan(0.5),
                float(10007.0),
                max(U.turbulence_loop_seconds, 1e-4),
            ).toConst();
            const wrapped = mod(t, period).toVar();
            If(wrapped.lessThan(0.0), () => {
                wrapped.addAssign(period);
            });
            return wrapped;
        },
        { t: 'float', return: 'float' },
    );

    // Prograde by default; an explicitly negative a/M flips the co-rotating flow.
    const disk_rotation_sign = () =>
        select(
            U.bh_rotation_enabled.greaterThan(0.5).and(U.bh_spin.lessThan(0.0)),
            float(-1.0),
            float(1.0),
        );

    const equatorial_azimuth = (xy) => atan(xy.y, xy.x);

    const accretion_turbulence = Fn(
        ([radius, angle, t]) => {
            const orbit_phase = angle
                .sub(
                    disk_rotation_sign()
                        .mul(0.45)
                        .mul(t)
                        .div(pow(max(radius, 1.001), 1.5)),
                )
                .toConst();
            const orbit_unit = vec2(cos(orbit_phase), sin(orbit_phase)).toConst();
            // Periodic angular coordinates avoid a seam at the angle wrap.
            const large_scale = fbm(
                vec2(
                    radius.mul(2.5).add(orbit_unit.x.mul(4.5)),
                    orbit_unit.y.mul(4.5).add(t.mul(0.08)),
                ),
            ).toConst();
            const small_scale = fbm(
                vec2(
                    radius.mul(12.0).add(orbit_unit.x.mul(15.0)).add(large_scale.mul(2.5)),
                    orbit_unit.y.mul(15.0).sub(t.mul(0.18)),
                ),
            ).toConst();
            // High-frequency layer, moving faster and concentrated near the ISCO.
            const micro_scale = fbm(
                vec2(
                    radius.mul(25.0).add(orbit_unit.x.mul(35.0)).sub(small_scale.mul(4.0)),
                    orbit_unit.y.mul(35.0).add(t.mul(0.55)),
                ),
            );
            // The small-scale noise distorts the spiral so it reads as chaotic, not as stripes.
            const swirl_phase = orbit_phase
                .mul(12.0)
                .add(log(max(radius, 1.001)).mul(8.0))
                .add(small_scale.mul(4.0));
            const isco_factor = exp(max(radius.sub(ACCRETION_MIN_R), 0.0).mul(-0.8));
            const filaments = sin(swirl_phase).mul(0.4).add(0.6);
            const base_plasma = mix(large_scale, small_scale, 0.5);
            const plasma = mix(base_plasma, micro_scale, isco_factor.mul(0.5).add(0.3));
            return max(plasma.mul(1.25).add(0.4).mul(filaments.mul(0.2).add(0.8)), 0.02);
        },
        { radius: 'float', angle: 'float', t: 'float', return: 'float' },
    );

    // Outer edge of the thin disk: surface density, and with it the emission and the optical
    // depth, tapers to zero over the last fifth of ACCRETION_WIDTH. The inner edge needs no taper:
    // the Page-Thorne flux itself vanishes at the ISCO.
    const accretion_outer_fade = (radius) =>
        float(1.0).sub(smoothstep(0.78, 1.0, radius.sub(ACCRETION_MIN_R).div(ACCRETION_WIDTH)));

    const accretion_emissivity = (radius, angle, t) =>
        accretion_turbulence(radius, angle, t).mul(accretion_outer_fade(radius));

    // --- ADAF/RIAF thick torus: geometrically thick, optically thin (M87*, Sgr A*) ---------

    const torus_local_emissivity = Fn(
        ([p]) => {
            const cyl_r = length(p.xy).toConst();
            const r0 = max(U.torus_r0, 1.5).toConst();
            const h = max(cyl_r.mul(U.torus_h_ratio), 0.01);
            const z_norm = abs(p.z).div(h).toConst();
            If(z_norm.greaterThan(3.0).or(cyl_r.lessThan(0.9)), () => {
                return float(0.0);
            });
            // Gaussian vertical profile (hydrostatic equilibrium).
            const vert = exp(z_norm.mul(z_norm).mul(-0.5));
            // Bremsstrahlung j ~ n^2 T^(1/2) as a power law about the reference radius r0, rising
            // less steeply inside it.
            const falloff = max(U.torus_radial_falloff, 0.5).toConst();
            const radial = select(
                cyl_r.lessThan(r0),
                pow(r0.div(max(cyl_r, 1.0)), falloff.mul(0.6)),
                pow(r0.div(cyl_r), falloff),
            ).toConst();
            const torus_profile = exp(pow(cyl_r.sub(r0).div(max(r0.mul(0.6), 1.0)), 2.0).mul(-1.2));
            const shaped = mix(radial, radial.mul(torus_profile), 0.5);
            // Smooth cutoff at the horizon and at the configurable outer radius.
            const inner = smoothstep(0.9, 1.5, cyl_r);
            const outer_r = max(
                r0.mul(U.torus_outer_radius),
                ACCRETION_MIN_R.add(ACCRETION_WIDTH),
            ).toConst();
            const outer = float(1.0).sub(smoothstep(outer_r.mul(0.7), outer_r, cyl_r));
            return vert.mul(shaped).mul(inner).mul(outer);
        },
        { p: 'vec3', return: 'float' },
    );

    // ADAF electron temperature T_e ~ r^(-1/2) (Narayan & Yi 1995, Esin et al. 1997).
    const torus_temperature = (r) =>
        U.disk_temperature_peak.mul(pow(max(U.torus_r0, 1.5).div(max(r, 1.0)), 0.5));

    // --- Slim disk: super-Eddington, radiation-pressure supported, extends inside the ISCO ---

    const slim_disk_height = Fn(
        ([cyl_r]) => {
            const base_h = max(U.slim_h_ratio, 0.05);
            const puff = max(U.slim_puff_factor, 0.0);
            const isco_proximity = exp(max(cyl_r.sub(ACCRETION_MIN_R), 0.0).mul(-1.5));
            return max(cyl_r.mul(base_h).mul(puff.mul(isco_proximity).add(1.0)), 0.01);
        },
        { cyl_r: 'float', return: 'float' },
    );

    const slim_disk_local_emissivity = Fn(
        ([p]) => {
            const cyl_r = length(p.xy).toConst();
            const z_norm = abs(p.z).div(slim_disk_height(cyl_r)).toConst();
            If(z_norm.greaterThan(3.0).or(cyl_r.lessThan(0.9)), () => {
                return float(0.0);
            });
            const vert = exp(z_norm.mul(z_norm).mul(-0.5));
            // Advection carries a finite flux into the plunging region.
            const radial = em.disk_relative_flux(cyl_r, float(DISK_SLIM_STRESS));
            const inner = smoothstep(0.9, 1.3, cyl_r);
            const outer_r = ACCRETION_MIN_R.add(ACCRETION_WIDTH).toConst();
            const outer = float(1.0).sub(smoothstep(outer_r.mul(0.8), outer_r, cyl_r));
            return vert.mul(radial).mul(inner).mul(outer);
        },
        { p: 'vec3', return: 'float' },
    );

    // Page-Thorne photosphere with an ISCO torque outside the ISCO; inside it the advected flow
    // heats up as r^-1/2 (Abramowicz+ 1988, Sadowski+ 2009) as a look.
    const slim_disk_temperature = Fn(
        ([cyl_r]) => {
            If(cyl_r.greaterThanEqual(ACCRETION_MIN_R), () => {
                return em.disk_temperature_at(cyl_r, float(DISK_SLIM_STRESS));
            });
            const t_isco = em.disk_temperature_at(ACCRETION_MIN_R, float(DISK_SLIM_STRESS));
            return t_isco.mul(pow(ACCRETION_MIN_R.div(max(cyl_r, 1.0)), 0.5));
        },
        { cyl_r: 'float', return: 'float' },
    );

    // Colour temperature of the disk light that reaches the planet: the flux-weighted temperature
    // of a few annuli, redshifted from the emission radius to the planet's distant orbit.
    const planet_irradiation_temperature = Fn(
        () => {
            if (F.accretion_thin_disk) {
                const radii = [1.8, 2.8, 4.2].map((k) => ACCRETION_MIN_R.mul(k).toConst());
                const weights = radii.map((r) => em.disk_relative_flux(r, float(0.0)).toConst());
                const temps = radii.map((r) =>
                    em.disk_temperature_at(r, float(0.0)).mul(em.static_redshift(r)),
                );
                const wsum = max(weights[0].add(weights[1]).add(weights[2]), 1e-4);
                return U.disk_color_correction.mul(
                    weights[0]
                        .mul(temps[0])
                        .add(weights[1].mul(temps[1]))
                        .add(weights[2].mul(temps[2]))
                        .div(wsum),
                );
            }
            if (F.accretion_thick_torus) {
                const r_t = max(U.torus_r0.mul(1.25), ACCRETION_MIN_R.add(0.5)).toConst();
                return torus_temperature(r_t).mul(em.static_redshift(r_t));
            }
            if (F.accretion_slim_disk) {
                const r_s = ACCRETION_MIN_R.mul(1.6).toConst();
                return U.disk_color_correction
                    .mul(slim_disk_temperature(r_s))
                    .mul(em.static_redshift(r_s));
            }
            return U.disk_temperature_peak;
        },
        { return: 'float' },
    );

    return {
        loopable_turbulence_time,
        disk_rotation_sign,
        equatorial_azimuth,
        accretion_turbulence,
        accretion_outer_fade,
        accretion_emissivity,
        torus_local_emissivity,
        torus_temperature,
        slim_disk_height,
        slim_disk_local_emissivity,
        slim_disk_temperature,
        planet_irradiation_temperature,
    };
}
