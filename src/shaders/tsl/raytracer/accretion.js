// Accretion flows: the shared turbulence pattern, the turbulent arcs of the thin disk, the
// ADAF/RIAF thick torus, the slim disk and the colour temperature of the disk light that reaches
// the planet.

import {
    Fn,
    If,
    abs,
    atan,
    clamp,
    cos,
    exp,
    floor,
    float,
    length,
    log,
    max,
    mix,
    mod,
    pow,
    round,
    select,
    sin,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';
import { fbm } from './math.js';
import { createFbm3, createVolumeNoise3 } from '../nodes/noise.js';
import { ACCRETION_WIDTH, DISK_SLIM_STRESS } from './emission.js';

// Turbulent arcs, after dgreenheck/webgpu-black-hole: 3-D value noise sampled on (r, cos phi, sin
// phi) with the azimuth on a small circle, so a noise cell spans a short radial interval and a long
// stretch of azimuth. Gas density is min(1, ARC_GAIN n)^s for the noise n and the sharpness s.
const ARC_LACUNARITY = 2.5;
const ARC_PERSISTENCE = 0.7;
// Noise cells per r_s across the disk, and the radius of the azimuth circle in noise space.
const ARC_RADIAL_FREQUENCY = 1.6;
const ARC_RING = 1.5;
const ARC_GAIN = 1.5;
// Value noise on uniform lattice values has a mean of 0.5.
const ARC_NOISE_MEAN = 0.5;
// Differential rotation winds the arcs up within a few turns, so the pattern restarts every cycle:
// each cycle starts a new copy, taken from another part of the noise, that fades in over the cycle
// while the copy of the previous cycle, one cycle further wound, fades out.
const ARC_CYCLE = 12.0;
// Shift in noise space between the copies of consecutive cycles, and the number of copies before
// they repeat when the turbulence loop is off.
const ARC_COPY_SHIFT = [7.31, 3.17, -5.43];
const ARC_COPIES = 64.0;

// Mean of min(1, ARC_GAIN n)^s over the disk and the copies for s = 1..10, sampled; the blend of
// two copies changes it by less than 0.3 %. diskArcNormalisation() turns it into the factor that
// gives the density a mean of 1 at any sharpness.
const ARC_MEAN_POWER = [
    0.7498, 0.5826, 0.467, 0.3844, 0.3238, 0.2782, 0.2433, 0.216, 0.1942, 0.1767,
];

export function diskArcNormalisation(sharpness) {
    const s = Math.min(Math.max(sharpness, 1), 10);
    const i = Math.min(Math.floor(s), 9);
    const lo = Math.log(ARC_MEAN_POWER[i - 1]);
    const hi = Math.log(ARC_MEAN_POWER[i]);
    return 1 / Math.exp(lo + (hi - lo) * (s - i));
}

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

    const arc_fbm = createFbm3(ARC_LACUNARITY, ARC_PERSISTENCE, createVolumeNoise3(U.noise_volume));
    const arc_noise = (radius, phase, copy) =>
        arc_fbm(
            vec3(
                radius.mul(ARC_RADIAL_FREQUENCY),
                cos(phase).mul(ARC_RING),
                sin(phase).mul(ARC_RING),
            ).add(vec3(...ARC_COPY_SHIFT).mul(copy)),
        );

    // Gas density of the turbulent arcs, with a mean of 1, times the 0.85 mean of the plasma
    // pattern, for which the GRMHD fluctuations and the exposure are set. Both copies turn at the
    // rate of the plasma pattern.
    const arc_turbulence = Fn(
        ([radius, angle, t]) => {
            // A whole number of cycles per loop period, each with its own copy, keeps looped
            // videos seamless; t is already wrapped to the period. A loop of one cycle blends its
            // copy with itself, so far out, where the copies are little wound apart, the arcs gain
            // some contrast halfway through.
            const looped = U.turbulence_loop_enabled.greaterThan(0.5);
            const loop_cycles = max(round(U.turbulence_loop_seconds.div(ARC_CYCLE)), 1.0);
            const cycle = select(
                looped,
                U.turbulence_loop_seconds.div(loop_cycles),
                float(ARC_CYCLE),
            ).toConst();
            const copies = select(looped, loop_cycles, float(ARC_COPIES)).toConst();
            const index = floor(t.div(cycle)).toConst();
            const tc = t.sub(index.mul(cycle)).toConst();
            const omega = disk_rotation_sign()
                .mul(0.45)
                .div(pow(max(radius, 1.001), 1.5))
                .toConst();
            const newer = arc_noise(radius, angle.sub(omega.mul(tc)), mod(index, copies)).sub(
                ARC_NOISE_MEAN,
            );
            const older = arc_noise(
                radius,
                angle.sub(omega.mul(tc.add(cycle))),
                mod(index.add(copies).sub(1.0), copies),
            ).sub(ARC_NOISE_MEAN);
            // The copies are independent, so these weights keep the variance of the blend and
            // the arcs keep their contrast through the hand-over.
            const w = tc.div(cycle).toConst();
            const v = float(1.0).sub(w).toConst();
            const n = newer
                .mul(w)
                .add(older.mul(v))
                .div(sqrt(w.mul(w).add(v.mul(v))))
                .add(ARC_NOISE_MEAN);
            return pow(clamp(n.mul(ARC_GAIN), 0.0, 1.0), U.disk_arc_sharpness)
                .mul(U.disk_arc_norm)
                .mul(0.85);
        },
        { radius: 'float', angle: 'float', t: 'float', return: 'float' },
    );

    // Turbulence pattern of the thin disk: the plasma pattern or the arcs. The torus and the slim
    // disk keep the plasma pattern, which is cheap enough to evaluate at every step through them.
    const disk_turbulence = F.disk_arcs ? arc_turbulence : accretion_turbulence;

    // Fraction of the light behind the thin disk that a patch of it blocks, per unit disk
    // opacity: with the arcs, 1 - exp(-tau) for an optical depth that follows the density,
    // scaled so a patch of mean density blocks the full opacity.
    const disk_coverage = (turbulence) =>
        F.disk_arcs
            ? float(1.0)
                  .sub(exp(turbulence.div(-0.85)))
                  .div(1.0 - Math.exp(-1.0))
                  .min(1.0)
            : float(1.0);

    // Outer edge of the thin disk: surface density, and with it the emission and the optical
    // depth, tapers to zero over the last fifth of ACCRETION_WIDTH. The inner edge needs no taper:
    // the Page-Thorne flux itself vanishes at the ISCO.
    const accretion_outer_fade = (radius) =>
        float(1.0).sub(smoothstep(0.78, 1.0, radius.sub(ACCRETION_MIN_R).div(ACCRETION_WIDTH)));

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
        disk_turbulence,
        disk_coverage,
        accretion_outer_fade,
        torus_local_emissivity,
        torus_temperature,
        slim_disk_height,
        slim_disk_local_emissivity,
        slim_disk_temperature,
        planet_irradiation_temperature,
    };
}
