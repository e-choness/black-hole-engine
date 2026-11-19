        {{#accretion_thin_disk}}
        // Disk crossing detection with sub-step refinement.
        // Near the photon sphere (r ≈ 1.5 r_s) photon paths wind tightly
        // and a single step can skip over the z=0 plane.  When the step
        // subtends a large angle and we are close to the photon sphere,
        // subdivide the segment and test each sub-segment for a crossing
        // to reliably capture secondary and tertiary Einstein rings.
        int disk_sub_steps = 1;
        if (abs(u - 0.667) < 0.15 && step > 0.12) {
            disk_sub_steps = 4;  // 4 sub-checks near photon sphere
        }
        {
            vec3 sub_old = old_pos;
            vec3 sub_step_vec = (pos - old_pos) / float(disk_sub_steps);
            for (int ds = 0; ds < 4; ds++) {
                if (ds >= disk_sub_steps) break;
                vec3 sub_new = old_pos + sub_step_vec * float(ds + 1);
                if (sub_old.z * sub_new.z < 0.0 && vol_transmittance > 1e-4) {
            vec3 sub_ray = sub_new - sub_old;
            float sub_ray_z = sub_ray.z;
            if (abs(sub_ray_z) < 1e-6) {
                sub_old = sub_new;
                continue;
            }
            float acc_isec_t = -sub_old.z / sub_ray_z;
            {{#full_kerr}}
            // The DP5 end points carry dx/dl, so the cubic Hermite interpolant of the step puts
            // the crossing on the curved path; on the equator r = sqrt(x^2 + y^2 - a^2).
            acc_isec_t = kerr_hermite_root(kerr_x_old.z, kerr_x.z,
                kerr_h_used*kerr_dx_old.z, kerr_h_used*kerr_dx.z);
            vec3 kerr_isec = kerr_hermite(kerr_x_old.xyz, kerr_x.xyz,
                kerr_h_used*kerr_dx_old.xyz, kerr_h_used*kerr_dx.xyz, acc_isec_t);
            {{/full_kerr}}
            if (acc_isec_t < solid_isec_t) {
                {{#full_kerr}}
                float r = sqrt(max(dot(kerr_isec.xy, kerr_isec.xy) - kerr_a*kerr_a, 1e-8));
                vec3 isec = vec3(kerr_isec.xy * (r / sqrt(r*r + kerr_a*kerr_a)), 0.0);
                {{/full_kerr}}
                {{^full_kerr}}
                vec3 isec = sub_old + sub_ray*acc_isec_t;

                float r = length(isec);
                {{/full_kerr}}
                {{#grmhd_enabled}}
                // GRMHD look: magnetic stress at the ISCO lets the plunging gas emit
                // (Noble+ 2010, Penna+ 2010: the plunging region adds ~10-30%).
                float disk_r_min = max(ACCRETION_MIN_R * 0.7, 1.05);
                float disk_stress = DISK_GRMHD_STRESS * (1.0 + 0.5*grmhd_mad_flux);
                {{/grmhd_enabled}}
                {{^grmhd_enabled}}
                float disk_r_min = ACCRETION_MIN_R;
                float disk_stress = 0.0;
                {{/grmhd_enabled}}
                if (r > disk_r_min && r < ACCRETION_MIN_R + ACCRETION_WIDTH) {
                    float angle = equatorial_azimuth(isec.xy);
                    float t_eff = disk_temperature_at(r, disk_stress);

                    {{#grmhd_enabled}}
                    // GRMHD look on top of the Page-Thorne photosphere: a mild beta-dependent
                    // electron temperature (3% R_high weight for a radiatively efficient disk),
                    // MRI turbulence and attenuated synchrotron/non-thermal modulations.
                    float disk_h_g = r * 0.05;
                    float beta_g = grmhd_plasma_beta(r, 0.0, disk_h_g);
                    float Te_corr = 0.97 + grmhd_electron_temp_ratio(beta_g) * 0.03;
                    t_eff = grmhd_electron_temperature(t_eff, r, 0.0, disk_h_g, turb_t, angle) * Te_corr;

                    float emissivity = grmhd_mri_turbulence(r, angle, turb_t) *
                        accretion_outer_fade(r);
                    float rho_g = grmhd_density(r, 1.0);
                    float B_g = grmhd_B_field(rho_g, t_eff, beta_g);
                    emissivity *= 1.0 + 0.1 * (grmhd_nonthermal_boost(grmhd_electron_kappa) - 1.0);
                    emissivity *= 1.0 + 0.1 * (grmhd_synchrotron_correction(B_g, rho_g) - 1.0);
                    {{/grmhd_enabled}}
                    {{^grmhd_enabled}}
                    float emissivity = accretion_emissivity(r, angle, turb_t);
                    {{/grmhd_enabled}}

                    // Covariant g of the circular (r >= r_isco) or plunging emitter and the
                    // fluid-frame emission angle for the limb darkening.
                    {{#full_kerr}}
                    vec2 disk_shift = kerr_disk_shift(kerr_isec, isec, r, kerr_a,
                        disk_rotation_sign(), kerr_pt, kerr_pphi,
                        mix(kerr_p_old, kerr_p, acc_isec_t), kerr_nu);
                    {{/full_kerr}}
                    {{^full_kerr}}
                    vec2 disk_shift = binet_disk_shift(r, disk_rotation_sign(),
                        photon_E, photon_Lz, photon_L, du > 0.0 ? 1.0 : -1.0);
                    {{/full_kerr}}

                    float inner_glow = exp(-8.0 * (r - ACCRETION_MIN_R));
                    float disk_weight = emissivity * disk_limb_darkening(disk_shift.y) *
                        look_disk_gain * (1.0 + look_glow * (0.22 + 0.78*inner_glow));
                    color.rgb += vol_transmittance * disk_weight *
                        thermal_radiance(t_eff, disk_color_correction, disk_shift.x);

                    // An optically thick disk ends the ray; a translucent one, or its tapered
                    // outer edge, lets the images behind it through.
                    vol_transmittance *= 1.0 - disk_opacity * accretion_outer_fade(r);
                    if (vol_transmittance < 1e-4) solid_isec_t = acc_isec_t;
                }
            }
                }
                sub_old = sub_new;
            }
        }
        {{/accretion_thin_disk}}
