        {{#light_travel_time}}
        if (light_travel_offset) t -= dt;
        {{/light_travel_time}}

        {{#full_kerr}}
        if (solid_isec_t <= 1.0) {
            shadow_capture = true; // the planet is opaque
            break;
        }
        {{/full_kerr}}
        {{^full_kerr}}
        if (solid_isec_t <= 1.0) u = 100.0; // break (exceeds both exterior and interior thresholds)

        {{#kerr_fast_mode}}
        if (interior_mode < 0.5) {
            float capture_u = 1.0 + photon_spin_lensing_scale *
                bh_rotation_enabled * bh_spin * bh_spin_strength *
                spin_alignment * 0.12;
            capture_u = clamp(capture_u, 0.82, 1.18);
            if (u > capture_u) {
                shadow_capture = true;
                break;
            }
        } else if (u >= 20.0) {
            shadow_capture = true;
            break;
        }
        {{/kerr_fast_mode}}
        {{#kerr_inspired_mode}}
        // Kerr-inspired mode: same Binet photon solver, same interior capture
        if (interior_mode > 0.5 && u >= 20.0) {
            shadow_capture = true;
            break;
        }
        {{/kerr_inspired_mode}}
        {{/full_kerr}}
    }

    {{#full_kerr}}
    // Out of iterations: rays that are already far out and receding go to the sky.
    if (!shadow_capture && !escaped) escaped = kerr_r > 10.0 && kerr_rdot > 0.0;
    if (escaped && !shadow_capture) {
        // CKS coordinates are asymptotically Cartesian, so dx/dl points at the sky position.
        ray = normalize(kerr_dx.xyz);
        // ray_doppler_factor already is the full ratio nu_infinity / nu_camera.
        float bg_doppler = ray_doppler_factor;
    {{/full_kerr}}
    {{^full_kerr}}
    // Background sky for rays that reached the far field.
    if (!shadow_capture && !forced_capture && u < 1.0) {

        if (!escaped && du < 0.0) {
            // Out of steps while receding: near infinity the orbit is the straight line
            // u = sin(phi_inf - phi) / b, so phi_inf - phi = atan(u, -du).
            phi_inf = phi + atan(u, -du);
            escaped = true;
        }
        if (escaped) {
            // At infinity the photon moves radially, along r_hat(phi_inf) of the orbit plane.
            vec3 sky_dir = cos(phi_inf)*normal_vec + sin(phi_inf)*tangent_vec;
            ray = rotate_about_z(sky_dir, frame_drag_phase);
        } else {
            ray = normalize(pos - old_pos);
        }

        // bg_doppler = nu_infinity/nu_camera: the static-frame blueshift
        // 1/sqrt(1 - r_s/r) through grav_blueshift_factor times the camera's Doppler
        // factor, or the full rain-frame ratio 1 + beta d_r during a dive.
        float bg_doppler = ray_doppler_factor * grav_blueshift_factor;
    {{/full_kerr}}

        // Light from static sources at infinity arrives with g = nu_obs / nu_emit = 1 / bg_doppler;
        // stars and galaxy follow the blackbody rule of every other emitter (no clamp, no D^3).
        float sky_g = 1.0 / max(bg_doppler, 1e-4);
        vec2 tex_coord = sphere_map(ray * BG_COORDS);
        vec3 sky = shifted_sky_radiance(texture(galaxy_texture, tex_coord).rgb, sky_g) *
            GALAXY_BRIGHTNESS * look_galaxy_gain;

        vec4 star_color = texture(star_texture, tex_coord);
        if (star_color.r > 0.0) {
            float star_t = STAR_MIN_TEMPERATURE +
                (STAR_MAX_TEMPERATURE - STAR_MIN_TEMPERATURE) * star_color.g;
            sky += blackbody(color_shift(sky_g) * star_t).rgb * star_color.r * STAR_BRIGHTNESS *
                look_star_gain * thermal_brightness_ratio(star_t, sky_g);
        }
        color.rgb += vol_transmittance * sky * exp2(log2_look_scale);
    }

    return color;
}
