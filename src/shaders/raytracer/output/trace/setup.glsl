// Role: Core ray-marching function. Integrates a photon path through the curved
//       spacetime, compositing accretion disk, jet, planet, and background
//       contributions along the geodesic with Beer-Lambert transmittance.
//       Takes an initial ray direction and returns the accumulated HDR colour.

vec4 trace_ray(vec3 ray) {
    vec3 pos = cam_pos;
    float u = 1.0 / length(pos), old_u;

    float gamma = 1.0;
    float ray_doppler_factor = 1.0;
    float step = 0.01;
    vec4 color = vec4(0.0,0.0,0.0,1.0);
    float vol_transmittance = 1.0; // volumetric ray transmittance (Beer-Lambert)

    float t = time;
    float turb_t = loopable_turbulence_time(time + turbulence_time_offset);
    float dt = 1.0;
    bool shadow_capture = false;
    bool escaped = false;

    {{^light_travel_time}}
    float planet_ang0 = t * PLANET_ORBITAL_ANG_VEL;
    vec3 planet_pos0 = vec3(cos(planet_ang0), sin(planet_ang0), 0)*PLANET_DISTANCE;
    {{/light_travel_time}}

    {{#full_kerr}}
    // The CPU supplies the orthonormal tetrad (u, e1, e2, e3) of the traced observer with e1, e2
    // and e3 along cam_x, cam_y and cam_z. For the look direction d the backward photon covector
    // is p = -u + d^i e_i, so the traced observer measures unit frequency and the camera
    // nu_cam = c0 + c.d, where c are the camera's 4-velocity components in the tetrad.
    float kerr_a = kerr_spin_a();
    vec3 look = vec3(dot(ray, cam_x), dot(ray, cam_y), dot(ray, cam_z));
    vec4 p_cov = -cam_u_cov + look.x*cam_e1_cov + look.y*cam_e2_cov + look.z*cam_e3_cov;
    float kerr_pt = p_cov.w;
    vec3 kerr_p = p_cov.xyz;
    vec4 kerr_x = vec4(cam_pos_ks, 0.0);
    float kerr_pphi = kerr_x.x*kerr_p.y - kerr_x.y*kerr_p.x;
    float kerr_nu = max(cam_doppler.w + dot(cam_doppler.xyz, look), 1e-6);
    // nu_infinity / nu_camera, the frequency ratio of light arriving from the sky.
    ray_doppler_factor = kerr_pt / kerr_nu;

    vec4 kerr_dx;
    vec3 kerr_dp;
    kerr_rhs(kerr_x, kerr_p, kerr_pt, kerr_a, kerr_dx, kerr_dp);
    vec4 kerr_x_old = kerr_x;
    vec3 kerr_p_old = kerr_p;
    vec4 kerr_dx_old = kerr_dx;
    float kerr_r = ks_radius(kerr_x.xyz, kerr_a);
    float kerr_rdot = dot(ks_radius_gradient(kerr_x.xyz, kerr_r, kerr_a), kerr_dx.xyz);
    float kerr_rplus = kerr_horizon_radius(kerr_a);
    float kerr_r_escape = max(500.0, 4.0*kerr_r);
    float kerr_h = 0.02*kerr_r / max(length(kerr_dx.xyz), 1e-6);
    float kerr_h_used = 0.0;
    {{#kerr_volume_steps}}
    float kerr_volume_extent = {{#jet_enabled}}max(40.0, 1.2*jet_length){{/jet_enabled}}{{^jet_enabled}}40.0{{/jet_enabled}};
    {{/kerr_volume_steps}}
    pos = ks_to_bl_position(kerr_x.xyz, kerr_r, kerr_a);
    u = 1.0 / kerr_r;
    // Kerr-Schild time is regular at the future horizon, so every camera retards emitters.
    bool light_travel_offset = true;

    // Inside the horizon a backward ray leaves through the future horizon only if the photon can
    // cross it inward, p.(d_t + Omega_H d_phi) >= 0 with Omega_H = a / (r_+^2 + a^2); otherwise it
    // came from the white-hole region and the pixel stays dark.
    if (kerr_r < kerr_rplus &&
            kerr_pt + kerr_a / (kerr_rplus*kerr_rplus + kerr_a*kerr_a)*kerr_pphi <= 0.0) {
        shadow_capture = true;
    }
    {{/full_kerr}}
    {{^full_kerr}}
    float u0 = u;
    vec3 normal_vec = normalize(pos);

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

    // Conserved photon energy E and angular momenta Lz and L (code units) per unit camera
    // frequency, for the covariant redshift of the emitters. The frame the look direction d is
    // given in measures nu_frame: E = nu_frame sqrt(1 - r_s/r) in the static frame and
    // E = 1 + beta d_r in the rain frame. The photon travels along -d, so L = nu_frame (d x r) in
    // both, since a radial boost leaves the tangential momentum unchanged.
    float photon_nu_frame = rain_frame ? 1.0 : ray_doppler_factor;
    float photon_E = rain_frame ? photon_energy : ray_doppler_factor * sqrt(max(1.0 - u, 0.0));
    vec3 photon_L_vec = photon_nu_frame * cross(ray, pos);
    float photon_Lz = photon_L_vec.z;
    float photon_L = length(photon_L_vec);

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

    // Schwarzschild t is singular at the horizon, so cameras inside the photon sphere do not
    // retard emitters by the light travel time.
    bool light_travel_offset = u0 < 2.0/3.0;

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
    float phi_inf = 0.0;
    {{/full_kerr}}

    vec3 old_pos = pos;

    for (int j=0; j < NSTEPS; j++) {
        if (shadow_capture) break;  // pre-classified capture → skip loop

        {{#full_kerr}}
        // DP5 error control plus caps: about 0.2 rad of azimuth per step, at most a tripling of
        // r, half the remaining gap to the horizon while falling in, and short steps through the
        // volumetric emitters. Rejected trials cost an iteration without moving the ray.
        float kerr_speed = max(length(kerr_dx.xyz), 1e-12);
        float h = min(kerr_h,
            0.2*kerr_r*kerr_r / max(length(cross(kerr_x.xyz, kerr_dx.xyz)), 1e-12));
        h = min(h, 2.0*kerr_r / kerr_speed);
        if (kerr_rdot < 0.0 && kerr_r > kerr_rplus) {
            h = min(h, 0.5*(kerr_r - kerr_rplus) / -kerr_rdot);
        }
        {{#kerr_volume_steps}}
        if (kerr_r < kerr_volume_extent) h = min(h, KERR_VOLUME_STEP*kerr_r / kerr_speed);
        {{/kerr_volume_steps}}

        vec4 x_new, dx_new;
        vec3 p_new, dp_new;
        float err = kerr_dp45_step(kerr_x, kerr_p, kerr_dx, kerr_dp, h, kerr_pt, kerr_a,
            x_new, p_new, dx_new, dp_new);
        // Standard controller h_next = 0.9 h err^(-1/5), limited to a factor of 0.2..5 per step.
        float h_scale = err <= 1e30 ? 0.9*pow(max(err, 1e-12), -0.2) : 0.2;
        if (!(err <= 1.0)) {
            kerr_h = h*clamp(h_scale, 0.2, 0.9);
            continue;
        }
        kerr_h = h*min(h_scale, 5.0);
        kerr_h_used = h;
        kerr_x_old = kerr_x;
        kerr_p_old = kerr_p;
        kerr_dx_old = kerr_dx;
        kerr_x = x_new;
        kerr_p = p_new;
        kerr_dx = dx_new;
        kerr_dp = dp_new;
        dt = kerr_x_old.w - kerr_x.w;

        old_u = u;
        old_pos = pos;
        kerr_r = ks_radius(kerr_x.xyz, kerr_a);
        kerr_rdot = dot(ks_radius_gradient(kerr_x.xyz, kerr_r, kerr_a), kerr_dx.xyz);
        u = 1.0 / kerr_r;
        pos = ks_to_bl_position(kerr_x.xyz, kerr_r, kerr_a);

        // Backward rays falling onto the hole pile up against the past horizon, so capture just
        // outside r_+; escape far out, where the remaining deflection is about r_s / r.
        if (kerr_rdot < 0.0 && kerr_r < 1.01*kerr_rplus) {
            shadow_capture = true;
            break;
        }
        if (kerr_rdot > 0.0 && kerr_r > kerr_r_escape) {
            escaped = true;
            break;
        }
        {{/full_kerr}}
        {{^full_kerr}}
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
        {{/full_kerr}}

        ray = pos-old_pos;
        float solid_isec_t = 2.0;
        float ray_l = length(ray);

        {{^full_kerr}}
        {{#light_travel_time}}
        {{#gravitational_time_dilation}}
        float ltt_mix = light_travel_offset ? smooth_step(1.0/u, 8.0) : 1.0;
        dt = ltt_mix*ray_l + (1.0-ltt_mix)*dt;
        {{/gravitational_time_dilation}}
        {{^gravitational_time_dilation}}
        dt = ray_l;
        {{/gravitational_time_dilation}}
        {{/light_travel_time}}
        {{/full_kerr}}

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

            {{#full_kerr}}
            // Frequency ratio of the zero-angular-momentum frame on the planet's orbit, in which
            // planet_intersection applies the planet's own motion.
            float planet_frame_doppler = kerr_orbit_frequency(vec3(PLANET_DISTANCE, 0.0, 0.0),
                kerr_zamo_omega(PLANET_DISTANCE, 0.0, kerr_a), kerr_pt, kerr_pphi, kerr_a) / kerr_nu;
            {{/full_kerr}}
            {{^full_kerr}}
            float planet_frame_doppler = photon_E / static_redshift(PLANET_DISTANCE);
            {{/full_kerr}}
            vec4 planet_isec = planet_intersection(old_pos, ray, t, dt,
                    planet_pos0, planet_frame_doppler);
            if (planet_isec.w > 0.0) {
                solid_isec_t = planet_isec.w;
                planet_isec.w = 1.0;
                color.rgb += vol_transmittance * planet_isec.rgb;
            }
        }
        {{/planetEnabled}}
