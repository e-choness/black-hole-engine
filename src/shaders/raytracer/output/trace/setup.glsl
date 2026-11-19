// Role: Core ray-marching function. Integrates a photon path through the curved
//       spacetime, compositing accretion disk, jet, planet, and background
//       contributions along the geodesic with Beer-Lambert transmittance.
//       Takes an initial ray direction and returns the accumulated HDR colour.

vec4 trace_ray(vec3 ray) {
    vec3 pos = cam_pos;

    // initial conditions
    float u = 1.0 / length(pos), old_u;
    float u0 = u;
    vec3 normal_vec = normalize(pos);

    float ray_intensity = 1.0;
    float doppler_boost = clamp(look_doppler_boost, 0.0, 2.5);
    float gamma = 1.0;

    // The camera is either referenced to the static observer (static, orbiting and free
    // cameras; cam_vel is its velocity relative to that observer) or rides the rain frame of
    // the dive (free fall from rest at infinity), the only frame that also exists inside the
    // horizon. ray_doppler_factor is nu_static/nu_camera in the first case and
    // nu_infinity/nu_camera in the second, where grav_blueshift_factor is 1.
    //
    // The Binet start is du/dphi = -u * radial_rate / d_t, where d_t is the tangential part of
    // the look direction in the frame the photon constants are evaluated in:
    //   static frame: radial_rate = sqrt(1 - r_s/r) d_r, the lapse converting the orthonormal
    //                 radial component into Schwarzschild r;
    //   rain frame:   radial_rate = d_r + beta with beta = sqrt(r_s/r), from E = eps (1 + beta d_r)
    //                 and b = r d_t / (1 + beta d_r) (Painleve-Gullstrand form of the metric).
    float ray_doppler_factor = 1.0;
    float radial_rate;
    float rain_beta = sqrt(u);
    float photon_energy = 1.0; // E / eps, the photon energy at infinity per camera frequency
    bool rain_frame = cam_rain > 0.5 || u > 1.0;
    if (rain_frame) {
        float d_r = dot(ray, normal_vec);
        photon_energy = 1.0 + rain_beta * d_r;
        ray_doppler_factor = photon_energy;
        radial_rate = d_r + rain_beta;
    } else {
        vec3 ray_cam = ray;
        {{#aberration}}
        vec3 aberration_vel = cam_vel * max(look_aberration_strength, 0.0);
        float aberration_speed = length(aberration_vel);
        if (aberration_speed > 0.999) {
            aberration_vel *= 0.999 / aberration_speed;
        }
        ray = lorentz_velocity_transformation(ray, aberration_vel);
        {{/aberration}}
        // nu_static/nu_camera = gamma (1 - d_cam . v) uses the direction seen by the camera,
        // not the aberrated static-frame direction.
        gamma = 1.0/sqrt(max(1.0-dot(cam_vel,cam_vel), 0.0001));
        ray_doppler_factor = gamma*(1.0 - dot(ray_cam, cam_vel));
        radial_rate = dot(ray, normal_vec) * sqrt(max(1.0 - u, 0.0));
    }
    {{#beaming}}
    {{#physical_beaming}}
    // Observer beaming is already accounted for via transfer_factor
    // in each emission source. The temperature shift of blackbody sources
    // captures the full Doppler effect. No additional ray_intensity scaling.
    {{/physical_beaming}}
    {{^physical_beaming}}
    float beaming_factor = clamp(ray_doppler_factor, 0.84, 1.16);
    ray_intensity /= pow(beaming_factor, 0.65 + 0.75*doppler_boost);
    {{/physical_beaming}}
    {{/beaming}}
    {{^doppler_shift}}
    ray_doppler_factor = 1.0;
    {{/doppler_shift}}

    float step = 0.01;
    vec4 color = vec4(0.0,0.0,0.0,1.0);
    float vol_transmittance = 1.0; // volumetric ray transmittance (Beer-Lambert)

    // Tangential component of ray (perpendicular to radial direction).
    // For near-radial rays the cross product is tiny → degenerate tangent_vec.
    // Guard with a fallback perpendicular direction.
    vec3 ray_perp = cross(cross(normal_vec, ray), normal_vec);
    float ray_perp_len = length(ray_perp);
    vec3 tangent_vec;
    if (ray_perp_len > 1e-6) {
        tangent_vec = ray_perp / ray_perp_len;
    } else {
        // Purely radial ray — pick an arbitrary perpendicular direction
        tangent_vec = abs(normal_vec.y) < 0.9
            ? normalize(cross(normal_vec, vec3(0.0, 1.0, 0.0)))
            : normalize(cross(normal_vec, vec3(1.0, 0.0, 0.0)));
        ray_perp_len = 1e-6;
    }
    vec3 spin_axis = vec3(0.0, 0.0, 1.0);
    float spin_alignment = clamp(dot(safe_normalize(cross(pos, ray)), spin_axis), -1.0, 1.0);
    float frame_drag_phase = 0.0;

    // du/dφ: rate of inverse-radius change per orbit angle.
    // For near-radial rays (small tangential component), du is large but finite.
    float dot_tang = dot(ray, tangent_vec);
    float du = (abs(dot_tang) > 1e-6)
        ? -radial_rate / dot_tang * u
        : -sign(radial_rate) * u * 200.0; // nearly radial — large du
    // Clamp: ±200 keeps near-radial rays integrable while covering all
    // physically relevant escape trajectories from inside the horizon.
    // (Critical du for escape ≈ sqrt(2|u²-u³|) which is ~124 at u=20.)
    du = clamp(du, -200.0, 200.0);
    float du0 = du;

    float phi = 0.0;

    float t = time;
    float turb_t = loopable_turbulence_time(time + turbulence_time_offset);
    float dt = 1.0;
    bool shadow_capture = false;
    // Schwarzschild t is singular at the horizon, so cameras inside the photon sphere do not
    // retard emitters by the light travel time.
    bool light_travel_offset = u0 < 2.0/3.0;

    {{^light_travel_time}}
    float planet_ang0 = t * PLANET_ORBITAL_ANG_VEL;
    vec3 planet_pos0 = vec3(cos(planet_ang0), sin(planet_ang0), 0)*PLANET_DISTANCE;
    {{/light_travel_time}}

    vec3 old_pos = pos;

    // ── Kerr state variables ──
    // Experimental true Kerr geodesics exist in the codebase but are not
    // exposed publicly. User-facing spin modes still trace photons with the
    // Schwarzschild Binet solver plus perturbative frame dragging.
    float kerr_a_phys = kerr_spin_a();
    {{#kerr_full_geodesic}}
    bool use_kerr = (abs(kerr_a_phys) > 0.001 && interior_mode < 0.5);
    {{/kerr_full_geodesic}}
    {{^kerr_full_geodesic}}
    bool use_kerr = false;
    {{/kerr_full_geodesic}}
    float kerr_r = 0.0, kerr_cth = 0.0, kerr_phi = 0.0;
    float kerr_pr = 0.0, kerr_pcth = 0.0;
    float kerr_xi = 0.0, kerr_eta = 0.0;
    float kerr_r_horizon = 1.0;

    if (use_kerr) {
        kerr_init(pos, ray, kerr_a_phys,
            kerr_xi, kerr_eta,
            kerr_r, kerr_cth, kerr_phi,
            kerr_pr, kerr_pcth);
        kerr_r_horizon = kerr_horizon_radius(kerr_a_phys);
    }

    // Inside the photon sphere the escape test is analytic. The Binet invariant
    // (du/dφ)² + u² − u³ = 1/b² must exceed its barrier value 4/27 (b < b_c) and the backward
    // ray must start outward (du < 0). The analytic outcome replaces the numerical one, which
    // leaks across the barrier, but captured rays are still integrated so that emitters in
    // front of the horizon are sampled. Inside the horizon a photon with non-positive energy
    // at infinity, 1 + β d_r <= 0, never came from our universe and stays dark.
    bool forced_capture = false;
    if (u > 2.0/3.0) {
        forced_capture = !(du < 0.0 && du*du + u*u*(1.0 - u) > 4.0/27.0);
        if (u >= 1.0 && photon_energy <= 0.0) shadow_capture = true;
    }

    // Asymptotic azimuth of the orbit plane at which the backward ray reaches infinity.
    bool escaped = false;
    float phi_inf = 0.0;

    for (int j=0; j < NSTEPS; j++) {
        if (shadow_capture) break;  // pre-classified capture → skip loop

        if (use_kerr) {
        // ── True Kerr geodesic integration ─────────────────────────────
        step = MAX_REVOLUTIONS * 2.0*M_PI / float(NSTEPS);

        // Convert angular budget to Mino-time step: dσ ≈ dφ / |dφ/dσ|.
        // At large r the azimuthal rate dφ/dσ scales with r, so without
        // this each Mino step would cover huge angles.  Near the horizon
        // dφ/dσ → ∞ (BL coordinate singularity) but the actual radial
        // traversal in Mino time is finite, so cap the scaling to prevent
        // the step from collapsing to zero before the photon can capture.
        float dphi_dsigma = abs(kerr_phi_dot(kerr_r, kerr_cth, kerr_a_phys, kerr_xi));
        float mino_scale = clamp(dphi_dsigma, 1.0, 40.0);
        step /= mino_scale;

        // Adaptive refinement near photon sphere for shadow accuracy
        float ps_dist = kerr_r - 1.5;
        step *= 1.0 - 0.5 * exp(-12.0*ps_dist*ps_dist);

        // Limit radial change per step to 30% of current r
        float dr_per_step = abs(kerr_pr) * step;
        if (dr_per_step > kerr_r * 0.3 && abs(kerr_pr) > 0.001) {
            step = kerr_r * 0.3 / abs(kerr_pr);
        }
        step = max(step, 1e-6);

        old_u = u;
        old_pos = pos;

        integrate_kerr_step(kerr_r, kerr_cth, kerr_phi,
            kerr_pr, kerr_pcth,
            step, kerr_a_phys, kerr_xi, kerr_eta);

        // Capture: photon reached the event horizon
        if (kerr_r <= kerr_r_horizon + 0.02 || kerr_r < 0.01) {
            shadow_capture = true;
            break;
        }

        // Reconstruct 3D Cartesian position from Boyer-Lindquist (r, θ, φ)
        // MUST happen before escape check so `pos` is valid for background ray
        float sth_k = sqrt(max(1.0 - kerr_cth*kerr_cth, 0.0));
        float rho_perp = sqrt(kerr_r*kerr_r + kerr_a_phys*kerr_a_phys) * sth_k;
        pos = vec3(rho_perp * cos(kerr_phi),
                   rho_perp * sin(kerr_phi),
                   kerr_r * kerr_cth);
        u = 1.0 / max(kerr_r, 0.001);

        // Escape: photon past observer and heading outward
        if (kerr_r > length(cam_pos) * 1.1 && kerr_pr > 0.0) {
            break;
        }

        } else {
        // ── Public Schwarzschild Binet integration (all exposed modes;
        //    also reused inside the horizon) ────────────────────────────
        step = MAX_REVOLUTIONS * 2.0*M_PI / float(NSTEPS);

        // adaptive step size based on rate of change
        float max_rel_u_change = max(1.0-log(max(u, 0.0001)), 0.05)*10.0 / float(NSTEPS);
        if (interior_mode > 0.5) {
            max_rel_u_change *= 3.0 + 2.0 * max(u - 1.0, 0.0);
            if (abs(du) > abs(max_rel_u_change*u) / step) {
                step = max_rel_u_change*u/abs(du);
            }
        } else {
            if ((du > 0.0 || (du0 < 0.0 && u0/u < 5.0)) && abs(du) > abs(max_rel_u_change*u) / step) {
                step = max_rel_u_change*u/abs(du);
            }
        }

        float u_photon_sphere = 0.667;
        float photon_sphere_proximity = exp(-12.0 * (u - u_photon_sphere) * (u - u_photon_sphere));
        step *= 1.0 - 0.7 * photon_sphere_proximity;

        if (interior_mode > 0.5) {
            float horizon_proximity = exp(-8.0 * (u - 1.0) * (u - 1.0));
            step *= 1.0 - 0.6 * horizon_proximity;
            step = max(step, 0.5 * M_PI / float(NSTEPS));
        }

        old_u = u;

        {{#light_travel_time}}
        {{#gravitational_time_dilation}}
        if (light_travel_offset) {
            dt = sqrt(max(du*du + u*u*(1.0-u), 0.0001))/max(abs(u*u*(1.0-u)), 0.0001)*step;
        }
        {{/gravitational_time_dilation}}
        {{/light_travel_time}}

        integrate_geodesic_step(u, du, step, spin_alignment);

        if (u < 0.0) {
            // u(φ) is close to linear near infinity, so interpolate its zero.
            phi_inf = phi + step * old_u / max(old_u - u, 1e-6);
            escaped = true;
            break;
        }
        if (interior_mode < 0.5) {
            if (u >= 1.0) {
                shadow_capture = true;
                break;
            }
        } else {
            if (u >= 20.0) {
                shadow_capture = true;
                break;
            }
        }

        phi += step;

        old_pos = pos;
        vec3 planar_pos = (cos(phi)*normal_vec + sin(phi)*tangent_vec)/u;

        float drag_u = clamp(u, 0.0, 1.15);
        float frame_drag_step = photon_spin_lensing_scale *
            bh_rotation_enabled * bh_spin * bh_spin_strength *
            spin_alignment * step * 0.85 * drag_u*drag_u*drag_u;
        frame_drag_phase += frame_drag_step;

        pos = rotate_about_z(planar_pos, frame_drag_phase);
        } // end if (use_kerr) / else

        ray = pos-old_pos;
        float solid_isec_t = 2.0;
        float ray_l = length(ray);

        {{#light_travel_time}}
        {{#gravitational_time_dilation}}
        float ltt_mix = light_travel_offset ? smooth_step(1.0/u, 8.0) : 1.0;
        dt = ltt_mix*ray_l + (1.0-ltt_mix)*dt;
        {{/gravitational_time_dilation}}
        {{^gravitational_time_dilation}}
        dt = ray_l;
        {{/gravitational_time_dilation}}
        {{/light_travel_time}}

        {{#planetEnabled}}
        if (
            (
                old_pos.z * pos.z < 0.0 ||
                min(abs(old_pos.z), abs(pos.z)) < PLANET_RADIUS
            ) &&
            max(u, old_u) > 1.0/(PLANET_DISTANCE+PLANET_RADIUS) &&
            min(u, old_u) < 1.0/(PLANET_DISTANCE-PLANET_RADIUS)
        ) {

            {{#light_travel_time}}
            float planet_ang0 = t * PLANET_ORBITAL_ANG_VEL;
            vec3 planet_pos0 = vec3(cos(planet_ang0), sin(planet_ang0), 0)*PLANET_DISTANCE;
            {{/light_travel_time}}

            vec4 planet_isec = planet_intersection(old_pos, ray, t, dt,
                    planet_pos0, ray_doppler_factor);
            if (planet_isec.w > 0.0) {
                solid_isec_t = planet_isec.w;
                planet_isec.w = 1.0;
                color += planet_isec;
            }
        }
        {{/planetEnabled}}
