        {{#jet_enabled}}
        {
            float path_len_j = length(pos - old_pos);
            for (int jet_side = 0; jet_side < 2; jet_side++) {
                float sign_z = (jet_side == 0) ? 1.0 : -1.0;

                {{#jet_physical}}
                // --- Counter-jet disk occultation ---
                // The accretion disk (optically thick near equator) blocks
                // the receding counter-jet when viewed near edge-on.
                // Model as extra absorption for the counter-jet passing
                // through the disk plane.
                float occultation = 1.0;
                if (sign_z < 0.0) {
                    // Counter-jet: check if line of sight passes through
                    // a dense region near the equatorial plane
                    float abs_z_pos = abs(pos.z);
                    float cyl_r_occ = length(pos.xy);
                    // Disk is optically thick for r > ISCO, |z| < H(r)
                    // H/R ~ 0.1-0.3 for thin/slim disks
                    float disk_H = 0.2 * cyl_r_occ;
                    if (abs_z_pos < disk_H && cyl_r_occ > 1.5 && cyl_r_occ < 15.0) {
                        // Strong absorption in disk midplane
                        float tau_disk = 8.0 * (1.0 - abs_z_pos / disk_H);
                        occultation = exp(-tau_disk);
                    }
                }
                {{/jet_physical}}

                {{#grmhd_enabled}}
                {{#jet_physical}}
                float j_jet = grmhd_jet_emissivity(pos, sign_z);
                {{/jet_physical}}
                {{#jet_simple}}
                float j_jet = jet_emissivity(pos, sign_z);
                {{/jet_simple}}
                {{/grmhd_enabled}}
                {{^grmhd_enabled}}
                float j_jet = jet_emissivity(pos, sign_z);
                {{/grmhd_enabled}}
                if (j_jet > 0.001 && vol_transmittance > 0.005) {
                    // Bulk velocity relative to the local static (Binet) or zero-angular-momentum
                    // (Full Kerr) frame, whose frequency per camera frequency is exact; the photon
                    // direction in that frame is approximated by the step chord. With the backward
                    // chord d, nu_em = nu_frame Gamma (1 + d.v) and g = 1 / nu_em.
                    vec3 v_jet = jet_velocity(pos, sign_z);
                    float gamma_jet = 1.0 / sqrt(max(1.0 - dot(v_jet, v_jet), 0.0001));
                    {{#full_kerr}}
                    float nu_frame_j = kerr_orbit_frequency(pos, kerr_zamo_omega(length(pos),
                        pos.z*pos.z / max(dot(pos, pos), 1e-8), kerr_a),
                        kerr_pt, kerr_pphi, kerr_a) / kerr_nu;
                    {{/full_kerr}}
                    {{^full_kerr}}
                    float nu_frame_j = photon_E / static_redshift(length(pos));
                    {{/full_kerr}}
                    float g_jet = 1.0 / max(nu_frame_j * gamma_jet *
                        (1.0 + dot(ray / max(ray_l, 1e-6), v_jet)), 0.02);

                    {{#jet_simple}}
                    float alpha_jet = jet_spectral_index;
                    float tau_jet = 0.005 * j_jet * path_len_j;
                    float jet_emit = jet_brightness * 0.35 * j_jet;
                    {{/jet_simple}}
                    {{#jet_physical}}
                    float z_abs = abs(pos.z * sign_z);
                    float sigma = magnetization(z_abs);
                    {{#grmhd_enabled}}
                    float alpha_jet = grmhd_jet_spectral_index(z_abs, sigma);
                    {{/grmhd_enabled}}
                    {{^grmhd_enabled}}
                    float alpha_jet = physical_jet_spectral_index(z_abs, sigma);
                    {{/grmhd_enabled}}
                    // Absorption is higher in the denser sheath; the emission efficiency falls
                    // with the magnetization.
                    float tau_jet = 0.012 * j_jet / (1.0 + 0.5 * sigma) * path_len_j;
                    float jet_emit = jet_brightness * 0.5 * j_jet / (1.0 + 0.3 * sigma) * occultation;
                    {{/jet_physical}}

                    // Optically thin synchrotron at a fixed observed frequency: I_obs = g^(3+alpha)
                    // I_em over the fluid-frame path dl / g, so a steady jet brightens as
                    // g^(2+alpha) (Lind & Blandford 1985); the power-law colour does not shift.
                    float beam_j = pow(brightness_shift(g_jet), 2.0 + alpha_jet);
                    color.rgb += vol_transmittance * jet_emit * path_len_j * beam_j * look_disk_gain *
                        power_law_color(alpha_jet) * exp2(log2_look_scale);
                    vol_transmittance *= exp(-tau_jet);
                }
            }
        }
        {{/jet_enabled}}
