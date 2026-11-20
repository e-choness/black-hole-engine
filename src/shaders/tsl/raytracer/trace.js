// The ray march: integrates a backward photon through the curved spacetime and composites the
// accretion flow, jets, planet and sky along it with Beer-Lambert transmittance. The variant
// flags F select at build time which parts the shader contains.

import {
    Break,
    Continue,
    Fn,
    If,
    Loop,
    abs,
    atan,
    bool,
    clamp,
    cos,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    exp2,
    float,
    fwidth,
    int,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    pow,
    select,
    sign,
    sin,
    sqrt,
    vec3,
    vec4,
} from 'three/tsl';
import {
    lorentz_velocity_transformation,
    rotate_about_z,
    safe_normalize,
    smooth_step,
    sq,
} from './math.js';
import { ACCRETION_WIDTH, DISK_GRMHD_STRESS } from './emission.js';
import { TORUS_EMISSIVITY_SCALE } from './accretion.js';
import { planetConstants } from './planet.js';

// The galaxy cube holds display values in linear light, scaled like the other look layers by
// H Y_ref; this factor sets the galaxy's brightness relative to the disk at the default gain.
const SKY_BRIGHTNESS = 1.5;
// Screen-space change of the escape direction (rad per pixel) beyond which neighbouring rays are
// taken to be discontinuous, e.g. on opposite sides of a caustic.
const SKY_MAX_GRADIENT = 1.0;
// Full Kerr: step length, as a fraction of r, inside volumetric emitters.
const KERR_VOLUME_STEP = 0.06;

export function createTrace(F, U, lib) {
    const { geo, em, acc, grmhd, jet, planet } = lib;
    const NSTEPS = F.n_steps;
    const ACCRETION_MIN_R = U.accretion_inner_r;
    const spinStrength = () =>
        U.photon_spin_lensing_scale
            .mul(U.bh_rotation_enabled)
            .mul(U.bh_spin)
            .mul(U.bh_spin_strength);

    return Fn(
        ([ray_in]) => {
            const ray = vec3(ray_in).toVar();
            const pos = vec3(U.cam_pos).toVar();
            const u = float(1.0).div(length(pos)).toVar();
            const old_u = float(0.0).toVar();
            const gamma = float(1.0).toVar();
            const ray_doppler_factor = float(1.0).toVar();
            const step = float(0.01).toVar();
            const color = vec3(0.0).toVar();
            const vol_transmittance = float(1.0).toVar();
            const t = float(U.time).toVar();
            const turb_t = acc
                .loopable_turbulence_time(U.time.add(U.turbulence_time_offset))
                .toConst();
            const dt = float(1.0).toVar();
            const shadow_capture = bool(false).toVar();
            const escaped = bool(false).toVar();

            const P = F.planet_enabled ? planetConstants(U) : null;
            let planet_pos0 = null;
            if (P && !F.light_travel_time) {
                const planet_ang0 = t.mul(P.orbital_ang_vel);
                planet_pos0 = vec3(cos(planet_ang0), sin(planet_ang0), 0.0)
                    .mul(P.distance)
                    .toConst();
            }

            // Solver state of the configured family.
            const K = {};
            const B = {};
            let light_travel_offset;

            if (F.full_kerr) {
                // The CPU supplies the orthonormal tetrad (u, e1, e2, e3) of the traced observer
                // with e1, e2 and e3 along cam_x, cam_y and cam_z. For the look direction d the
                // backward photon covector is p = -u + d^i e_i, so the traced observer measures unit
                // frequency and the camera nu_cam = c0 + c.d, where c are the camera's 4-velocity
                // components in the tetrad.
                K.a = geo.kerr_spin_a().toConst();
                const look = vec3(
                    dot(ray, U.cam_x),
                    dot(ray, U.cam_y),
                    dot(ray, U.cam_z),
                ).toConst();
                const p_cov = U.cam_u_cov
                    .negate()
                    .add(U.cam_e1_cov.mul(look.x))
                    .add(U.cam_e2_cov.mul(look.y))
                    .add(U.cam_e3_cov.mul(look.z))
                    .toConst();
                K.pt = p_cov.w.toConst();
                K.p = p_cov.xyz.toVar();
                K.x = vec4(U.cam_pos_ks, 0.0).toVar();
                K.pphi = K.x.x.mul(K.p.y).sub(K.x.y.mul(K.p.x)).toConst();
                K.nu = max(U.cam_doppler.w.add(dot(U.cam_doppler.xyz, look)), 1e-6).toConst();
                // nu_infinity / nu_camera, the frequency ratio of light arriving from the sky.
                ray_doppler_factor.assign(K.pt.div(K.nu));

                const rhs = geo.kerr_rhs(K.x, K.p, K.pt, K.a);
                K.dx = vec4(rhs.dx).toVar();
                K.dp = vec3(rhs.dp).toVar();
                K.x_old = vec4(K.x).toVar();
                K.p_old = vec3(K.p).toVar();
                K.dx_old = vec4(K.dx).toVar();
                K.r = geo.ks_radius(K.x.xyz, K.a).toVar();
                K.rdot = dot(geo.ks_radius_gradient(K.x.xyz, K.r, K.a), K.dx.xyz).toVar();
                K.rplus = geo.kerr_horizon_radius(K.a).toConst();
                K.r_escape = max(500.0, K.r.mul(4.0)).toConst();
                K.h = K.r
                    .mul(0.02)
                    .div(max(length(K.dx.xyz), 1e-6))
                    .toVar();
                K.h_used = float(0.0).toVar();
                if (F.kerr_volume_steps) {
                    K.volume_extent = F.jet_enabled
                        ? max(40.0, U.jet_length.mul(1.2)).toConst()
                        : float(40.0);
                }
                pos.assign(geo.ks_to_bl_position(K.x.xyz, K.r, K.a));
                u.assign(float(1.0).div(K.r));
                // Kerr-Schild time is regular at the future horizon, so every camera retards
                // emitters.
                light_travel_offset = bool(true);

                // Inside the horizon a backward ray leaves through the future horizon only if the
                // photon can cross it inward, p.(d_t + Omega_H d_phi) >= 0 with
                // Omega_H = a / (r_+^2 + a^2); otherwise it came from the white-hole region.
                If(
                    K.r
                        .lessThan(K.rplus)
                        .and(
                            K.pt
                                .add(K.a.div(K.rplus.mul(K.rplus).add(K.a.mul(K.a))).mul(K.pphi))
                                .lessThanEqual(0.0),
                        ),
                    () => {
                        shadow_capture.assign(true);
                    },
                );
            } else {
                B.u0 = u.toConst();
                B.normal_vec = normalize(pos).toConst();

                // The camera is referenced to the static observer (static, orbiting and free
                // cameras; cam_vel is its velocity relative to that observer) or rides the rain
                // frame of the dive, the only frame that also exists inside the horizon.
                // ray_doppler_factor is nu_static / nu_camera in the first case and
                // nu_infinity / nu_camera in the second. The Binet start is
                // du/dphi = -u radial_rate / d_t with
                //   static frame: radial_rate = sqrt(1 - r_s/r) d_r,
                //   rain frame:   radial_rate = d_r + beta, beta = sqrt(r_s/r) (Painleve-Gullstrand).
                const radial_rate = float(0.0).toVar();
                const rain_beta = sqrt(u).toConst();
                const photon_energy = float(1.0).toVar(); // E / eps per camera frequency
                const rain_frame = U.cam_rain.greaterThan(0.5).or(u.greaterThan(1.0)).toConst();
                If(rain_frame, () => {
                    const d_r = dot(ray, B.normal_vec).toConst();
                    photon_energy.assign(rain_beta.mul(d_r).add(1.0));
                    ray_doppler_factor.assign(photon_energy);
                    radial_rate.assign(d_r.add(rain_beta));
                }).Else(() => {
                    const ray_cam = ray.toConst();
                    if (F.aberration) {
                        const aberration_vel = U.cam_vel
                            .mul(max(U.look_aberration_strength, 0.0))
                            .toVar();
                        const aberration_speed = length(aberration_vel).toConst();
                        If(aberration_speed.greaterThan(0.999), () => {
                            aberration_vel.mulAssign(float(0.999).div(aberration_speed));
                        });
                        ray.assign(lorentz_velocity_transformation(ray, aberration_vel));
                    }
                    // nu_static / nu_camera = gamma (1 - d_cam . v) uses the direction seen by the
                    // camera, not the aberrated static-frame direction.
                    gamma.assign(
                        float(1.0).div(
                            sqrt(max(float(1.0).sub(dot(U.cam_vel, U.cam_vel)), 0.0001)),
                        ),
                    );
                    ray_doppler_factor.assign(gamma.mul(float(1.0).sub(dot(ray_cam, U.cam_vel))));
                    radial_rate.assign(
                        dot(ray, B.normal_vec).mul(sqrt(max(float(1.0).sub(u), 0.0))),
                    );
                });

                // Conserved photon energy E and angular momenta Lz and L per unit camera frequency:
                // E = nu_frame sqrt(1 - r_s/r) in the static frame and E = 1 + beta d_r in the rain
                // frame; L = nu_frame (d x r) in both.
                const photon_nu_frame = select(rain_frame, float(1.0), ray_doppler_factor);
                B.photon_E = select(
                    rain_frame,
                    photon_energy,
                    ray_doppler_factor.mul(sqrt(max(float(1.0).sub(u), 0.0))),
                ).toConst();
                const photon_L_vec = cross(ray, pos).mul(photon_nu_frame).toConst();
                B.photon_Lz = photon_L_vec.z.toConst();
                B.photon_L = length(photon_L_vec).toConst();

                // Tangential direction; near-radial rays get an arbitrary perpendicular.
                const ray_perp = cross(cross(B.normal_vec, ray), B.normal_vec).toConst();
                const ray_perp_len = length(ray_perp).toConst();
                B.tangent_vec = vec3(0.0).toVar();
                If(ray_perp_len.greaterThan(1e-6), () => {
                    B.tangent_vec.assign(ray_perp.div(ray_perp_len));
                }).Else(() => {
                    B.tangent_vec.assign(
                        select(
                            abs(B.normal_vec.y).lessThan(0.9),
                            normalize(cross(B.normal_vec, vec3(0.0, 1.0, 0.0))),
                            normalize(cross(B.normal_vec, vec3(1.0, 0.0, 0.0))),
                        ),
                    );
                });
                B.spin_alignment = clamp(
                    dot(safe_normalize(cross(pos, ray)), vec3(0.0, 0.0, 1.0)),
                    -1.0,
                    1.0,
                ).toConst();
                B.frame_drag_phase = float(0.0).toVar();

                // du/dphi; near-radial rays get a large but finite rate. +-200 covers every escaping
                // trajectory from inside the horizon (critical du ~ sqrt(2 |u^2 - u^3|), ~124 at u = 20).
                const dot_tang = dot(ray, B.tangent_vec).toConst();
                B.du = float(0.0).toVar();
                If(abs(dot_tang).greaterThan(1e-6), () => {
                    B.du.assign(radial_rate.negate().div(dot_tang).mul(u));
                }).Else(() => {
                    B.du.assign(sign(radial_rate).negate().mul(u).mul(200.0));
                });
                B.du.assign(clamp(B.du, -200.0, 200.0));
                B.du0 = B.du.toConst();
                B.phi = float(0.0).toVar();

                // Schwarzschild t is singular at the horizon, so cameras inside the photon sphere do
                // not retard emitters.
                light_travel_offset = B.u0.lessThan(2.0 / 3.0).toConst();

                // Inside the photon sphere the escape test is analytic: the Binet invariant
                // (du/dphi)^2 + u^2 - u^3 = 1/b^2 must exceed its barrier 4/27 and the backward ray
                // must start outward. Captured rays are still integrated so that emitters in front of
                // the horizon are sampled. Inside the horizon a photon with non-positive energy at
                // infinity never came from our universe.
                B.forced_capture = bool(false).toVar();
                If(u.greaterThan(2.0 / 3.0), () => {
                    B.forced_capture.assign(
                        B.du
                            .lessThan(0.0)
                            .and(
                                B.du
                                    .mul(B.du)
                                    .add(u.mul(u).mul(float(1.0).sub(u)))
                                    .greaterThan(4.0 / 27.0),
                            )
                            .not(),
                    );
                    If(u.greaterThanEqual(1.0).and(photon_energy.lessThanEqual(0.0)), () => {
                        shadow_capture.assign(true);
                    });
                });
                // Asymptotic azimuth of the orbit plane at which the backward ray reaches infinity.
                B.phi_inf = float(0.0).toVar();
            }

            const old_pos = vec3(pos).toVar();

            Loop(NSTEPS, () => {
                If(shadow_capture, () => {
                    Break();
                });

                if (F.full_kerr) {
                    // DP5 error control plus caps: about 0.2 rad of azimuth per step, at most a
                    // tripling of r, half the remaining gap to the horizon while falling in, and short
                    // steps through the volumetric emitters. Rejected trials cost an iteration.
                    const kerr_speed = max(length(K.dx.xyz), 1e-12).toConst();
                    const h = min(
                        K.h,
                        K.r
                            .mul(K.r)
                            .mul(0.2)
                            .div(max(length(cross(K.x.xyz, K.dx.xyz)), 1e-12)),
                    ).toVar();
                    h.assign(min(h, K.r.mul(2.0).div(kerr_speed)));
                    If(K.rdot.lessThan(0.0).and(K.r.greaterThan(K.rplus)), () => {
                        h.assign(min(h, K.r.sub(K.rplus).mul(0.5).div(K.rdot.negate())));
                    });
                    if (F.kerr_volume_steps) {
                        If(K.r.lessThan(K.volume_extent), () => {
                            h.assign(min(h, K.r.mul(KERR_VOLUME_STEP).div(kerr_speed)));
                        });
                    }
                    const trial = geo.kerr_dp45_step(K.x, K.p, K.dx, K.dp, h, K.pt, K.a);
                    // h_next = 0.9 h err^(-1/5), limited to a factor of 0.2..5 per step.
                    const h_scale = select(
                        trial.err.lessThanEqual(1e30),
                        pow(max(trial.err, 1e-12), -0.2).mul(0.9),
                        float(0.2),
                    ).toConst();
                    If(trial.err.lessThanEqual(1.0).not(), () => {
                        K.h.assign(h.mul(clamp(h_scale, 0.2, 0.9)));
                        Continue();
                    });
                    K.h.assign(h.mul(min(h_scale, 5.0)));
                    K.h_used.assign(h);
                    K.x_old.assign(K.x);
                    K.p_old.assign(K.p);
                    K.dx_old.assign(K.dx);
                    K.x.assign(trial.x_new);
                    K.p.assign(trial.p_new);
                    K.dx.assign(trial.dx_new);
                    K.dp.assign(trial.dp_new);
                    dt.assign(K.x_old.w.sub(K.x.w));

                    old_u.assign(u);
                    old_pos.assign(pos);
                    K.r.assign(geo.ks_radius(K.x.xyz, K.a));
                    K.rdot.assign(dot(geo.ks_radius_gradient(K.x.xyz, K.r, K.a), K.dx.xyz));
                    u.assign(float(1.0).div(K.r));
                    pos.assign(geo.ks_to_bl_position(K.x.xyz, K.r, K.a));

                    // Backward rays falling onto the hole pile up against the past horizon, so
                    // capture just outside r_+; escape far out, where the remaining deflection is
                    // about r_s / r.
                    If(K.rdot.lessThan(0.0).and(K.r.lessThan(K.rplus.mul(1.01))), () => {
                        shadow_capture.assign(true);
                        Break();
                    });
                    If(K.rdot.greaterThan(0.0).and(K.r.greaterThan(K.r_escape)), () => {
                        escaped.assign(true);
                        Break();
                    });
                } else {
                    step.assign((F.max_revolutions * 2.0 * Math.PI) / NSTEPS);

                    // Adaptive step from the rate of change.
                    const max_rel_u_change = max(float(1.0).sub(log(max(u, 0.0001))), 0.05)
                        .mul(10.0 / NSTEPS)
                        .toVar();
                    If(U.interior_mode.greaterThan(0.5), () => {
                        max_rel_u_change.mulAssign(max(u.sub(1.0), 0.0).mul(2.0).add(3.0));
                        If(abs(B.du).greaterThan(abs(max_rel_u_change.mul(u)).div(step)), () => {
                            step.assign(max_rel_u_change.mul(u).div(abs(B.du)));
                        });
                    }).Else(() => {
                        If(
                            B.du
                                .greaterThan(0.0)
                                .or(B.du0.lessThan(0.0).and(B.u0.div(u).lessThan(5.0)))
                                .and(abs(B.du).greaterThan(abs(max_rel_u_change.mul(u)).div(step))),
                            () => {
                                step.assign(max_rel_u_change.mul(u).div(abs(B.du)));
                            },
                        );
                    });

                    const photon_sphere_proximity = exp(sq(u.sub(0.667)).mul(-12.0));
                    step.mulAssign(float(1.0).sub(photon_sphere_proximity.mul(0.7)));

                    If(U.interior_mode.greaterThan(0.5), () => {
                        const horizon_proximity = exp(sq(u.sub(1.0)).mul(-8.0));
                        step.mulAssign(float(1.0).sub(horizon_proximity.mul(0.6)));
                        step.assign(max(step, (0.5 * Math.PI) / NSTEPS));
                    });

                    old_u.assign(u);

                    if (F.light_travel_time && F.gravitational_time_dilation) {
                        If(light_travel_offset, () => {
                            const uu = u.mul(u).mul(float(1.0).sub(u));
                            dt.assign(
                                sqrt(max(B.du.mul(B.du).add(uu), 0.0001))
                                    .div(max(abs(uu), 0.0001))
                                    .mul(step),
                            );
                        });
                    }

                    geo.integrate_geodesic_step(u, B.du, step, B.spin_alignment);

                    If(u.lessThan(0.0), () => {
                        // u(phi) is close to linear near infinity, so interpolate its zero.
                        B.phi_inf.assign(B.phi.add(step.mul(old_u).div(max(old_u.sub(u), 1e-6))));
                        escaped.assign(true);
                        Break();
                    });
                    If(U.interior_mode.lessThan(0.5), () => {
                        If(u.greaterThanEqual(1.0), () => {
                            shadow_capture.assign(true);
                            Break();
                        });
                    }).Else(() => {
                        If(u.greaterThanEqual(20.0), () => {
                            shadow_capture.assign(true);
                            Break();
                        });
                    });

                    B.phi.addAssign(step);
                    old_pos.assign(pos);
                    const planar_pos = cos(B.phi)
                        .mul(B.normal_vec)
                        .add(sin(B.phi).mul(B.tangent_vec))
                        .div(u);
                    const drag_u = clamp(u, 0.0, 1.15).toConst();
                    B.frame_drag_phase.addAssign(
                        spinStrength()
                            .mul(B.spin_alignment)
                            .mul(step)
                            .mul(0.85)
                            .mul(drag_u)
                            .mul(drag_u)
                            .mul(drag_u),
                    );
                    pos.assign(rotate_about_z(planar_pos, B.frame_drag_phase));
                }

                ray.assign(pos.sub(old_pos));
                const solid_isec_t = float(2.0).toVar();
                const ray_l = length(ray).toConst();

                if (!F.full_kerr && F.light_travel_time) {
                    if (F.gravitational_time_dilation) {
                        const ltt_mix = select(
                            light_travel_offset,
                            smooth_step(float(1.0).div(u), 8.0),
                            float(1.0),
                        ).toConst();
                        dt.assign(ltt_mix.mul(ray_l).add(float(1.0).sub(ltt_mix).mul(dt)));
                    } else {
                        dt.assign(ray_l);
                    }
                }

                // Frequency ratio of the zero-angular-momentum frame (Full Kerr) or the static
                // frame at the point q, per camera frequency.
                const frameRatio = (q) =>
                    F.full_kerr
                        ? geo
                              .kerr_orbit_frequency(
                                  q,
                                  geo.kerr_zamo_omega(
                                      length(q),
                                      q.z.mul(q.z).div(max(dot(q, q), 1e-8)),
                                      K.a,
                                  ),
                                  K.pt,
                                  K.pphi,
                                  K.a,
                              )
                              .div(K.nu)
                        : B.photon_E.div(em.static_redshift(length(q)));

                // Stationary flow rotating at omega about the spin axis: g = nu_cam / nu_em.
                const flowShift = (q, omegaOf) =>
                    F.full_kerr
                        ? K.nu.div(
                              max(
                                  geo.kerr_orbit_frequency(
                                      q,
                                      omegaOf((r) =>
                                          geo.kerr_kepler_omega(r, K.a, acc.disk_rotation_sign()),
                                      ),
                                      K.pt,
                                      K.pphi,
                                      K.a,
                                  ),
                                  1e-6,
                              ),
                          )
                        : em.binet_flow_shift(
                              q,
                              omegaOf((r) =>
                                  acc.disk_rotation_sign().mul(em.binet_kepler_omega(r)),
                              ),
                              B.photon_E,
                              B.photon_Lz,
                          );

                if (F.planet_enabled) {
                    If(
                        old_pos.z
                            .mul(pos.z)
                            .lessThan(0.0)
                            .or(min(abs(old_pos.z), abs(pos.z)).lessThan(P.radius))
                            .and(
                                max(u, old_u).greaterThan(float(1.0).div(P.distance.add(P.radius))),
                            )
                            .and(min(u, old_u).lessThan(float(1.0).div(P.distance.sub(P.radius)))),
                        () => {
                            let pos0 = planet_pos0;
                            if (F.light_travel_time) {
                                const planet_ang0 = t.mul(P.orbital_ang_vel);
                                pos0 = vec3(cos(planet_ang0), sin(planet_ang0), 0.0)
                                    .mul(P.distance)
                                    .toConst();
                            }
                            // Frequency ratio of the frame on the planet's orbit in which
                            // planet_intersection applies the planet's own motion.
                            const planet_frame_doppler = F.full_kerr
                                ? geo
                                      .kerr_orbit_frequency(
                                          vec3(P.distance, 0.0, 0.0),
                                          geo.kerr_zamo_omega(P.distance, float(0.0), K.a),
                                          K.pt,
                                          K.pphi,
                                          K.a,
                                      )
                                      .div(K.nu)
                                : B.photon_E.div(em.static_redshift(P.distance));
                            const planet_isec = planet
                                .planet_intersection(
                                    old_pos,
                                    ray,
                                    t,
                                    dt,
                                    pos0,
                                    planet_frame_doppler,
                                )
                                .toConst();
                            If(planet_isec.w.greaterThan(0.0), () => {
                                solid_isec_t.assign(planet_isec.w);
                                color.addAssign(vol_transmittance.mul(planet_isec.rgb));
                            });
                        },
                    );
                }

                if (F.accretion_thin_disk) {
                    // Disk crossings with sub-steps: near the photon sphere a single step can skip
                    // over the z = 0 plane, so the segment is split to capture the higher-order rings.
                    const disk_sub_steps = int(1).toVar();
                    If(abs(u.sub(0.667)).lessThan(0.15).and(step.greaterThan(0.12)), () => {
                        disk_sub_steps.assign(4);
                    });
                    const sub_old = vec3(old_pos).toVar();
                    const sub_step_vec = pos.sub(old_pos).div(float(disk_sub_steps)).toConst();
                    Loop(4, ({ i: ds }) => {
                        If(ds.greaterThanEqual(disk_sub_steps), () => {
                            Break();
                        });
                        const sub_new = old_pos.add(sub_step_vec.mul(float(ds.add(1)))).toConst();
                        If(
                            sub_old.z
                                .mul(sub_new.z)
                                .lessThan(0.0)
                                .and(vol_transmittance.greaterThan(1e-4)),
                            () => {
                                const sub_ray = sub_new.sub(sub_old).toConst();
                                If(abs(sub_ray.z).lessThan(1e-6), () => {
                                    sub_old.assign(sub_new);
                                    Continue();
                                });
                                const acc_isec_t = sub_old.z.negate().div(sub_ray.z).toVar();
                                let kerr_isec = null;
                                if (F.full_kerr) {
                                    // The DP5 end points carry dx/dl, so the cubic Hermite interpolant of
                                    // the step puts the crossing on the curved path; on the equator
                                    // r = sqrt(x^2 + y^2 - a^2).
                                    acc_isec_t.assign(
                                        geo.kerr_hermite_root(
                                            K.x_old.z,
                                            K.x.z,
                                            K.h_used.mul(K.dx_old.z),
                                            K.h_used.mul(K.dx.z),
                                        ),
                                    );
                                    kerr_isec = geo
                                        .kerr_hermite(
                                            K.x_old.xyz,
                                            K.x.xyz,
                                            K.dx_old.xyz.mul(K.h_used),
                                            K.dx.xyz.mul(K.h_used),
                                            acc_isec_t,
                                        )
                                        .toConst();
                                }
                                If(acc_isec_t.lessThan(solid_isec_t), () => {
                                    let r;
                                    let isec;
                                    if (F.full_kerr) {
                                        r = sqrt(
                                            max(
                                                dot(kerr_isec.xy, kerr_isec.xy).sub(K.a.mul(K.a)),
                                                1e-8,
                                            ),
                                        ).toConst();
                                        isec = vec3(
                                            kerr_isec.xy.mul(
                                                r.div(sqrt(r.mul(r).add(K.a.mul(K.a)))),
                                            ),
                                            0.0,
                                        ).toConst();
                                    } else {
                                        isec = sub_old.add(sub_ray.mul(acc_isec_t)).toConst();
                                        r = length(isec).toConst();
                                    }
                                    // GRMHD look: magnetic stress at the ISCO lets the plunging gas emit
                                    // (Noble+ 2010, Penna+ 2010).
                                    const disk_r_min = F.grmhd_enabled
                                        ? max(ACCRETION_MIN_R.mul(0.7), 1.05)
                                        : ACCRETION_MIN_R;
                                    const disk_stress = F.grmhd_enabled
                                        ? U.grmhd_mad_flux.mul(0.5).add(1.0).mul(DISK_GRMHD_STRESS)
                                        : float(0.0);
                                    If(
                                        r
                                            .greaterThan(disk_r_min)
                                            .and(r.lessThan(ACCRETION_MIN_R.add(ACCRETION_WIDTH))),
                                        () => {
                                            const angle = acc.equatorial_azimuth(isec.xy).toConst();
                                            const t_eff = em
                                                .disk_temperature_at(r, disk_stress)
                                                .toVar();
                                            let emissivity;
                                            if (F.grmhd_enabled) {
                                                // Mild beta-dependent electron temperature, MRI turbulence and
                                                // attenuated synchrotron / non-thermal modulations on top of
                                                // the Page-Thorne photosphere.
                                                const disk_h_g = r.mul(0.05).toConst();
                                                const beta_g = grmhd
                                                    .grmhd_plasma_beta(r, float(0.0), disk_h_g)
                                                    .toConst();
                                                const Te_corr = grmhd
                                                    .grmhd_electron_temp_ratio(beta_g)
                                                    .mul(0.03)
                                                    .add(0.97);
                                                t_eff.assign(
                                                    grmhd
                                                        .grmhd_electron_temperature(
                                                            t_eff,
                                                            r,
                                                            float(0.0),
                                                            disk_h_g,
                                                            turb_t,
                                                            angle,
                                                        )
                                                        .mul(Te_corr),
                                                );
                                                const rho_g = grmhd
                                                    .grmhd_density(r, float(1.0))
                                                    .toConst();
                                                const B_g = grmhd.grmhd_B_field(
                                                    rho_g,
                                                    t_eff,
                                                    beta_g,
                                                );
                                                emissivity = grmhd
                                                    .grmhd_mri_turbulence(r, angle, turb_t)
                                                    .mul(acc.accretion_outer_fade(r))
                                                    .mul(
                                                        grmhd
                                                            .grmhd_nonthermal_boost(
                                                                U.grmhd_electron_kappa,
                                                            )
                                                            .sub(1.0)
                                                            .mul(0.1)
                                                            .add(1.0),
                                                    )
                                                    .mul(
                                                        grmhd
                                                            .grmhd_synchrotron_correction(
                                                                B_g,
                                                                rho_g,
                                                            )
                                                            .sub(1.0)
                                                            .mul(0.1)
                                                            .add(1.0),
                                                    )
                                                    .toConst();
                                            } else {
                                                emissivity = acc
                                                    .accretion_emissivity(r, angle, turb_t)
                                                    .toConst();
                                            }

                                            // Covariant g of the circular (r >= r_isco) or plunging emitter and
                                            // the fluid-frame emission angle for the limb darkening.
                                            const disk_shift = (
                                                F.full_kerr
                                                    ? em.kerr_disk_shift(
                                                          kerr_isec,
                                                          isec,
                                                          r,
                                                          K.a,
                                                          acc.disk_rotation_sign(),
                                                          K.pt,
                                                          K.pphi,
                                                          mix(K.p_old, K.p, acc_isec_t),
                                                          K.nu,
                                                      )
                                                    : em.binet_disk_shift(
                                                          r,
                                                          acc.disk_rotation_sign(),
                                                          B.photon_E,
                                                          B.photon_Lz,
                                                          B.photon_L,
                                                          select(
                                                              B.du.greaterThan(0.0),
                                                              float(1.0),
                                                              float(-1.0),
                                                          ),
                                                      )
                                            ).toConst();

                                            const inner_glow = exp(
                                                r.sub(ACCRETION_MIN_R).mul(-8.0),
                                            );
                                            const disk_weight = emissivity
                                                .mul(em.disk_limb_darkening(disk_shift.y))
                                                .mul(U.look_disk_gain)
                                                .mul(
                                                    U.look_glow
                                                        .mul(inner_glow.mul(0.78).add(0.22))
                                                        .add(1.0),
                                                );
                                            color.addAssign(
                                                vol_transmittance
                                                    .mul(disk_weight)
                                                    .mul(
                                                        em.thermal_radiance(
                                                            t_eff,
                                                            U.disk_color_correction,
                                                            disk_shift.x,
                                                        ),
                                                    ),
                                            );

                                            // An optically thick disk ends the ray; a translucent one, or its
                                            // tapered outer edge, lets the images behind it through.
                                            vol_transmittance.mulAssign(
                                                float(1.0).sub(
                                                    U.disk_opacity.mul(acc.accretion_outer_fade(r)),
                                                ),
                                            );
                                            If(vol_transmittance.lessThan(1e-4), () => {
                                                solid_isec_t.assign(acc_isec_t);
                                            });
                                        },
                                    );
                                });
                            },
                        );
                        sub_old.assign(sub_new);
                    });
                }

                if (F.accretion_thick_torus) {
                    // ADAF/RIAF volumetric emission, optically thin: dI/ds = j - alpha I.
                    let torus_j;
                    if (F.grmhd_enabled) {
                        // Twice the base height modulation: +-30% warps and buoyant features from
                        // MRI and the Parker instability (Liska+ 2022: H/R variation ~15-30%).
                        const cr = max(length(pos.xy), 1e-4);
                        const hmod_raw = grmhd.grmhd_height_modulation(
                            cr,
                            acc.equatorial_azimuth(pos.xy),
                            turb_t,
                        );
                        const hmod = hmod_raw.sub(1.0).mul(2.0).add(1.0);
                        torus_j = acc
                            .torus_local_emissivity(vec3(pos.xy, pos.z.div(max(hmod, 0.2))))
                            .toConst();
                    } else {
                        torus_j = acc.torus_local_emissivity(pos).toConst();
                    }
                    If(torus_j.greaterThan(0.001).and(vol_transmittance.greaterThan(0.005)), () => {
                        const path_len = length(pos.sub(old_pos)).toConst();
                        const r3d = max(length(pos), 1.001).toConst();
                        const cyl_r_t = max(length(pos.xy), 1e-4).toConst();
                        const angle_t = acc.equatorial_azimuth(pos.xy).toConst();
                        let temperature_t;
                        let j_eff;
                        let alpha_abs;
                        if (F.grmhd_enabled) {
                            // Two-temperature torus: beta-dependent temperature, 3-D turbulence with a
                            // square root that keeps the optically thin flow from turning into
                            // nebula-like filaments, and attenuated GRMHD corrections.
                            const h_torus_g = max(cyl_r_t.mul(U.torus_h_ratio), 0.01).toConst();
                            const gas_temp_torus = acc.torus_temperature(r3d).toConst();
                            temperature_t = grmhd
                                .grmhd_electron_temperature(
                                    gas_temp_torus,
                                    cyl_r_t,
                                    pos.z,
                                    h_torus_g,
                                    turb_t,
                                    angle_t,
                                )
                                .toConst();
                            const turbulence_t = sqrt(
                                max(grmhd.grmhd_3d_density_turbulence(pos, turb_t), 0.01),
                            ).toConst();
                            const beta_torus = grmhd.grmhd_plasma_beta(cyl_r_t, pos.z, h_torus_g);
                            const rho_torus = grmhd.grmhd_density(cyl_r_t, float(1.0)).toConst();
                            const B_torus = grmhd.grmhd_B_field(
                                rho_torus,
                                gas_temp_torus,
                                beta_torus,
                            );
                            const nt_mod_t = grmhd
                                .grmhd_nonthermal_boost(U.grmhd_electron_kappa)
                                .sub(1.0)
                                .mul(0.15)
                                .add(1.0);
                            const sync_mod_t = grmhd
                                .grmhd_synchrotron_correction(B_torus, rho_torus)
                                .sub(1.0)
                                .mul(0.15)
                                .add(1.0);
                            j_eff = torus_j
                                .mul(TORUS_EMISSIVITY_SCALE)
                                .mul(turbulence_t)
                                .mul(nt_mod_t)
                                .mul(sync_mod_t)
                                .toConst();
                            // Denser clumps are more opaque.
                            alpha_abs = U.torus_opacity
                                .mul(torus_j)
                                .mul(pow(turbulence_t, 0.5))
                                .mul(U.grmhd_density_scale.mul(0.5).add(0.5))
                                .toConst();
                        } else {
                            temperature_t = acc.torus_temperature(r3d).toConst();
                            const turbulence_t = acc.accretion_turbulence(cyl_r_t, angle_t, turb_t);
                            j_eff = torus_j.mul(TORUS_EMISSIVITY_SCALE).mul(turbulence_t).toConst();
                            alpha_abs = U.torus_opacity.mul(torus_j).toConst();
                        }
                        // Sub-Keplerian rotation (ADAF: ~50% of Keplerian) as a stationary flow; the
                        // fluid-frame path is dl / g for both the emission and the optical depth.
                        const g_t = flowShift(pos, (omega) => omega(cyl_r_t).mul(0.5)).toConst();
                        const fluid_len_t = path_len.div(max(g_t, 0.05)).toConst();
                        color.addAssign(
                            vol_transmittance
                                .mul(j_eff)
                                .mul(fluid_len_t)
                                .mul(U.look_disk_gain)
                                .mul(em.thermal_radiance(temperature_t, float(1.0), g_t)),
                        );
                        vol_transmittance.mulAssign(exp(alpha_abs.negate().mul(fluid_len_t)));
                    });
                }

                if (F.accretion_slim_disk) {
                    // Slim disk: optically thick, surface-like.
                    let slim_j;
                    if (F.grmhd_enabled) {
                        const cr = max(length(pos.xy), 1e-4);
                        const hmod = grmhd.grmhd_height_modulation(
                            cr,
                            acc.equatorial_azimuth(pos.xy),
                            turb_t,
                        );
                        slim_j = acc
                            .slim_disk_local_emissivity(vec3(pos.xy, pos.z.div(max(hmod, 0.2))))
                            .toConst();
                    } else {
                        slim_j = acc.slim_disk_local_emissivity(pos).toConst();
                    }
                    If(slim_j.greaterThan(0.001).and(vol_transmittance.greaterThan(0.005)), () => {
                        const path_len_s = length(pos.sub(old_pos)).toConst();
                        const cyl_r_s = max(length(pos.xy), 1e-4).toConst();
                        const angle_s = acc.equatorial_azimuth(pos.xy).toConst();
                        let temperature_s;
                        let look_s;
                        let alpha_abs_s;
                        if (F.grmhd_enabled) {
                            // Base super-Eddington morphology with a mild two-temperature correction
                            // (30% R_high), ISCO stress and synchrotron / non-thermal corrections.
                            const gas_temp_slim = acc.slim_disk_temperature(cyl_r_s).toConst();
                            const h_slim_g = acc.slim_disk_height(cyl_r_s).toConst();
                            const beta_slim = grmhd
                                .grmhd_plasma_beta(cyl_r_s, pos.z, h_slim_g)
                                .toConst();
                            const Te_corr_slim = grmhd
                                .grmhd_electron_temp_ratio(beta_slim)
                                .mul(0.3)
                                .add(0.7);
                            temperature_s = grmhd
                                .grmhd_electron_temperature(
                                    gas_temp_slim,
                                    cyl_r_s,
                                    pos.z,
                                    h_slim_g,
                                    turb_t,
                                    angle_s,
                                )
                                .mul(Te_corr_slim)
                                .toConst();
                            const turbulence_s = grmhd
                                .grmhd_3d_density_turbulence(pos, turb_t)
                                .toConst();
                            const isco_stress_s = grmhd.grmhd_isco_stress_factor(cyl_r_s);
                            const rho_slim_g = grmhd.grmhd_density(cyl_r_s, float(1.0)).toConst();
                            const B_slim_g = grmhd.grmhd_B_field(
                                rho_slim_g,
                                gas_temp_slim,
                                beta_slim,
                            );
                            // Normalised so the defaults stay near 1.
                            const grmhd_param_slim = sqrt(
                                grmhd
                                    .grmhd_nonthermal_boost(U.grmhd_electron_kappa)
                                    .mul(grmhd.grmhd_synchrotron_correction(B_slim_g, rho_slim_g))
                                    .div(2.5),
                            );
                            look_s = sqrt(turbulence_s)
                                .mul(isco_stress_s)
                                .mul(grmhd_param_slim)
                                .toConst();
                            alpha_abs_s = U.slim_opacity
                                .mul(slim_j)
                                .mul(sqrt(turbulence_s))
                                .toConst();
                        } else {
                            temperature_s = acc.slim_disk_temperature(cyl_r_s).toConst();
                            look_s = acc.accretion_turbulence(cyl_r_s, angle_s, turb_t).toConst();
                            alpha_abs_s = U.slim_opacity.mul(slim_j).toConst();
                        }
                        // Keplerian rotation as a stationary flow (Full Kerr falls back to the local
                        // zero-angular-momentum frame inside the ISCO).
                        const g_s = flowShift(pos, (omega) => omega(cyl_r_s)).toConst();
                        // Thermal source S = B(T) times the look modulation: the step adds
                        // (1 - e^-tau) S with tau over the fluid-frame path dl / g.
                        const step_T_s = exp(
                            alpha_abs_s.negate().mul(path_len_s).div(max(g_s, 0.05)),
                        ).toConst();
                        color.addAssign(
                            vol_transmittance
                                .mul(float(1.0).sub(step_T_s))
                                .mul(look_s)
                                .mul(U.look_disk_gain)
                                .mul(
                                    em.thermal_radiance(
                                        temperature_s,
                                        U.disk_color_correction,
                                        g_s,
                                    ),
                                ),
                        );
                        vol_transmittance.mulAssign(step_T_s);
                    });
                }

                if (F.jet_enabled) {
                    const path_len_j = length(pos.sub(old_pos)).toConst();
                    for (const side of [1.0, -1.0]) {
                        const sign_z = float(side);
                        // Physical mode: the optically thick disk near the equator hides the receding
                        // counter-jet when viewed near edge-on.
                        let occultation = float(1.0);
                        if (F.jet_physical && side < 0) {
                            occultation = float(1.0).toVar();
                            const abs_z_pos = abs(pos.z).toConst();
                            const cyl_r_occ = length(pos.xy).toConst();
                            const disk_H = cyl_r_occ.mul(0.2).toConst();
                            If(
                                abs_z_pos
                                    .lessThan(disk_H)
                                    .and(cyl_r_occ.greaterThan(1.5))
                                    .and(cyl_r_occ.lessThan(15.0)),
                                () => {
                                    occultation.assign(
                                        exp(float(1.0).sub(abs_z_pos.div(disk_H)).mul(-8.0)),
                                    );
                                },
                            );
                        }
                        const j_jet = jet.jet_emissivity(pos, sign_z).toConst();
                        If(
                            j_jet.greaterThan(0.001).and(vol_transmittance.greaterThan(0.005)),
                            () => {
                                // Bulk velocity relative to the local static (Binet) or
                                // zero-angular-momentum (Full Kerr) frame; the photon direction in that
                                // frame is approximated by the step chord. With the backward chord d,
                                // nu_em = nu_frame Gamma (1 + d.v) and g = 1 / nu_em.
                                const v_jet = jet.jet_velocity(pos, sign_z).toConst();
                                const gamma_jet = float(1.0).div(
                                    sqrt(max(float(1.0).sub(dot(v_jet, v_jet)), 0.0001)),
                                );
                                const nu_frame_j = frameRatio(pos);
                                const g_jet = float(1.0)
                                    .div(
                                        max(
                                            nu_frame_j
                                                .mul(gamma_jet)
                                                .mul(
                                                    dot(ray.div(max(ray_l, 1e-6)), v_jet).add(1.0),
                                                ),
                                            0.02,
                                        ),
                                    )
                                    .toConst();
                                let alpha_jet;
                                let tau_jet;
                                let jet_emit;
                                if (F.jet_physical) {
                                    const z_abs = abs(pos.z.mul(sign_z)).toConst();
                                    const sigma = jet.magnetization(z_abs).toConst();
                                    alpha_jet = jet.jet_spectral_index(z_abs, sigma).toConst();
                                    // Absorption is higher in the denser sheath; the emission efficiency
                                    // falls with the magnetization.
                                    tau_jet = j_jet
                                        .mul(0.012)
                                        .div(sigma.mul(0.5).add(1.0))
                                        .mul(path_len_j);
                                    jet_emit = U.jet_brightness
                                        .mul(0.5)
                                        .mul(j_jet)
                                        .div(sigma.mul(0.3).add(1.0))
                                        .mul(occultation);
                                } else {
                                    alpha_jet = U.jet_spectral_index;
                                    tau_jet = j_jet.mul(0.005).mul(path_len_j);
                                    jet_emit = U.jet_brightness.mul(0.35).mul(j_jet);
                                }
                                // Optically thin synchrotron at a fixed observed frequency:
                                // I_obs = g^(3 + alpha) I_em over the fluid-frame path dl / g, so a steady
                                // jet brightens as g^(2 + alpha) (Lind & Blandford 1985).
                                const beam_j = pow(em.brightness_shift(g_jet), alpha_jet.add(2.0));
                                color.addAssign(
                                    vol_transmittance
                                        .mul(jet_emit)
                                        .mul(path_len_j)
                                        .mul(beam_j)
                                        .mul(U.look_disk_gain)
                                        .mul(em.power_law_color(alpha_jet))
                                        .mul(exp2(U.log2_look_scale)),
                                );
                                vol_transmittance.mulAssign(exp(tau_jet.negate()));
                            },
                        );
                    }
                }

                if (F.light_travel_time) {
                    If(light_travel_offset, () => {
                        t.subAssign(dt);
                    });
                }

                if (F.full_kerr) {
                    If(solid_isec_t.lessThanEqual(1.0), () => {
                        shadow_capture.assign(true); // the planet is opaque
                        Break();
                    });
                } else {
                    // Beyond both the exterior and the interior capture thresholds.
                    If(solid_isec_t.lessThanEqual(1.0), () => {
                        u.assign(100.0);
                    });
                    if (F.kerr_fast_mode) {
                        If(U.interior_mode.lessThan(0.5), () => {
                            const capture_u = clamp(
                                spinStrength().mul(B.spin_alignment).mul(0.12).add(1.0),
                                0.82,
                                1.18,
                            );
                            If(u.greaterThan(capture_u), () => {
                                shadow_capture.assign(true);
                                Break();
                            });
                        }).ElseIf(u.greaterThanEqual(20.0), () => {
                            shadow_capture.assign(true);
                            Break();
                        });
                    }
                    if (F.kerr_inspired_mode) {
                        // Same Binet photon solver, same interior capture.
                        If(U.interior_mode.greaterThan(0.5).and(u.greaterThanEqual(20.0)), () => {
                            shadow_capture.assign(true);
                            Break();
                        });
                    }
                }
            });

            const sky_visible = bool(false).toVar();
            const bg_doppler = float(1.0).toVar();
            if (F.full_kerr) {
                // Out of iterations: rays that are already far out and receding go to the sky.
                If(shadow_capture.not().and(escaped.not()), () => {
                    escaped.assign(K.r.greaterThan(10.0).and(K.rdot.greaterThan(0.0)));
                });
                If(escaped.and(shadow_capture.not()), () => {
                    // CKS coordinates are asymptotically Cartesian, so dx/dl points at the sky.
                    ray.assign(normalize(K.dx.xyz));
                    bg_doppler.assign(ray_doppler_factor);
                    sky_visible.assign(true);
                });
            } else {
                If(shadow_capture.not().and(B.forced_capture.not()).and(u.lessThan(1.0)), () => {
                    If(escaped.not().and(B.du.lessThan(0.0)), () => {
                        // Out of steps while receding: near infinity the orbit is the straight line
                        // u = sin(phi_inf - phi) / b, so phi_inf - phi = atan(u, -du).
                        B.phi_inf.assign(B.phi.add(atan(u, B.du.negate())));
                        escaped.assign(true);
                    });
                    If(escaped, () => {
                        // At infinity the photon moves radially, along r_hat(phi_inf).
                        const sky_dir = cos(B.phi_inf)
                            .mul(B.normal_vec)
                            .add(sin(B.phi_inf).mul(B.tangent_vec));
                        ray.assign(rotate_about_z(sky_dir, B.frame_drag_phase));
                    }).Else(() => {
                        ray.assign(normalize(pos.sub(old_pos)));
                    });
                    // nu_infinity / nu_camera: the static-frame blueshift 1/sqrt(1 - r_s/r) times the
                    // camera's Doppler factor, or the full rain-frame ratio during a dive.
                    bg_doppler.assign(ray_doppler_factor.mul(U.grav_blueshift_factor));
                    sky_visible.assign(true);
                });
            }

            // The sky is filtered with the screen-space gradients of the escape direction, so lensed
            // minification picks coarser mip levels and anisotropic taps. The jittered rays of a
            // pixel share its footprint. Where the 2x2 quad straddles a capture/escape boundary, or
            // the direction jumps between neighbours, the lookup falls back to level 0.
            const sky_dir = ray.toConst();
            const sky_dx = dFdx(sky_dir).toConst();
            const sky_dy = dFdy(sky_dir).toConst();
            const sky_jump = max(dot(sky_dx, sky_dx), dot(sky_dy, sky_dy));
            const sky_footprint = float(1.0 / Math.sqrt(F.sample_count)).toVar();
            If(
                fwidth(select(sky_visible, float(1.0), float(0.0)))
                    .greaterThan(0.0)
                    .or(sky_jump.lessThanEqual(SKY_MAX_GRADIENT * SKY_MAX_GRADIENT).not()),
                () => {
                    sky_footprint.assign(0.0);
                },
            );
            If(sky_visible, () => {
                // Light from static sources at infinity arrives with g = 1 / bg_doppler, and the sky
                // shifts like any other blackbody emitter (no clamp, no D^3).
                const sky_g = float(1.0).div(max(bg_doppler, 1e-4));
                const sky_texel = em.sky_radiance(
                    sky_dir,
                    sky_dx.mul(sky_footprint),
                    sky_dy.mul(sky_footprint),
                );
                const sky = em.shifted_sky_radiance(sky_texel, sky_g);
                color.addAssign(
                    vol_transmittance
                        .mul(sky)
                        .mul(U.look_galaxy_gain.mul(SKY_BRIGHTNESS))
                        .mul(exp2(U.log2_look_scale)),
                );
            });

            return vec4(color, 1.0);
        },
        { ray_in: 'vec3', return: 'vec4' },
    );
}
