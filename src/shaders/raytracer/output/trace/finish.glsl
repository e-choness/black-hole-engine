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

    bool sky_visible = false;
    float bg_doppler = 1.0;
    {{#full_kerr}}
    // Out of iterations: rays that are already far out and receding go to the sky.
    if (!shadow_capture && !escaped) escaped = kerr_r > 10.0 && kerr_rdot > 0.0;
    if (escaped && !shadow_capture) {
        // CKS coordinates are asymptotically Cartesian, so dx/dl points at the sky position.
        ray = normalize(kerr_dx.xyz);
        // ray_doppler_factor already is the full ratio nu_infinity / nu_camera.
        bg_doppler = ray_doppler_factor;
        sky_visible = true;
    }
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
        bg_doppler = ray_doppler_factor * grav_blueshift_factor;
        sky_visible = true;
    }
    {{/full_kerr}}

    // The sky is filtered with the screen-space gradients of the escape direction, taken here in
    // uniform control flow, so lensed minification picks coarser mip levels and anisotropic taps.
    // The SAMPLE_COUNT jittered rays of a pixel share its footprint. Where the 2x2 quad straddles a
    // capture/escape boundary, or the direction jumps between neighbours, the gradients mean
    // nothing and the lookup falls back to level 0 (LOD guard).
    vec3 sky_dir = ray;
    vec3 sky_dx = dFdx(sky_dir);
    vec3 sky_dy = dFdy(sky_dir);
    float sky_jump = max(dot(sky_dx, sky_dx), dot(sky_dy, sky_dy));
    float sky_footprint = inversesqrt(float(SAMPLE_COUNT));
    if (fwidth(sky_visible ? 1.0 : 0.0) > 0.0 || !(sky_jump <= SKY_MAX_GRADIENT * SKY_MAX_GRADIENT)) {
        sky_footprint = 0.0;
    }
    if (sky_visible) {
        // Light from static sources at infinity arrives with g = nu_obs / nu_emit = 1 / bg_doppler,
        // and the sky shifts like any other blackbody emitter (no clamp, no D^3).
        float sky_g = 1.0 / max(bg_doppler, 1e-4);
        vec3 sky_texel = sky_radiance(sky_dir, sky_dx * sky_footprint, sky_dy * sky_footprint);
        vec3 sky = shifted_sky_radiance(sky_texel, sky_g);
        color.rgb += vol_transmittance * sky * (SKY_BRIGHTNESS * look_galaxy_gain) *
            exp2(log2_look_scale);
    }

    return color;
}
