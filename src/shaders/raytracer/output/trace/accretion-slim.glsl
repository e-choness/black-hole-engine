        {{#accretion_slim_disk}}
        {
            // Slim disk volumetric emission: optically thick radiative transfer
            // Super-Eddington flow: high absorption → surface-like rendering
            {{#grmhd_enabled}}
            // GRMHD: height modulation from MRI + radiation-driven warps
            float _cr_s = max(length(pos.xy), 1e-4);
            float _a_s = equatorial_azimuth(pos.xy);
            float _hmod_s = grmhd_height_modulation(_cr_s, _a_s, turb_t);
            vec3 _warp_s = vec3(pos.xy, pos.z / max(_hmod_s, 0.2));
            float slim_j = slim_disk_local_emissivity(_warp_s);
            {{/grmhd_enabled}}
            {{^grmhd_enabled}}
            float slim_j = slim_disk_local_emissivity(pos);
            {{/grmhd_enabled}}
            if (slim_j > 0.001 && vol_transmittance > 0.005) {
                float path_len_s = length(pos - old_pos);
                float cyl_r_s = max(length(pos.xy), 1e-4);
                float r3d_s = max(length(pos), 1.001);
                float angle_s = equatorial_azimuth(pos.xy);

                {{#grmhd_enabled}}
                    // GRMHD-inspired slim disk: preserve the base super-Eddington
                    // morphology while adding responsive semi-analytic corrections.
                // GRMHD adds: mild two-temperature correction (30% R_high) + ISCO magnetic
                // stress + synchrotron/non-thermal corrections responsive to all parameters.
                float gas_temp_slim = slim_disk_temperature(cyl_r_s);
                float h_slim_g = slim_disk_height(cyl_r_s);
                float beta_slim = grmhd_plasma_beta(cyl_r_s, pos.z, h_slim_g);
                float Te_ratio_slim = grmhd_electron_temp_ratio(beta_slim);
                // Manual lerp: avoid 'mix' variable shadow from line 264
                float Te_corr_slim = 1.0 * 0.7 + Te_ratio_slim * 0.3;  // 30% correction (partially thermalized)
                float temperature_s = grmhd_electron_temperature(gas_temp_slim, cyl_r_s, pos.z, h_slim_g, turb_t, angle_s) * Te_corr_slim;

                // 3D volumetric FBM turbulence: filamentary density structure
                float turbulence_s = grmhd_3d_density_turbulence(pos, turb_t);
                
                // ISCO stress: adds ~10-30% extra luminosity from plunging region
                float isco_stress_s = grmhd_isco_stress_factor(cyl_r_s);

                // Synchrotron and non-thermal corrections (radiation-dominated
                // → gentler response than ADAF, normalized so defaults ≈ 1.0)
                float rho_slim_g = grmhd_density(cyl_r_s, 1.0);
                float B_slim_g = grmhd_B_field(rho_slim_g, gas_temp_slim, beta_slim);
                float nonthermal_slm = grmhd_nonthermal_boost(grmhd_electron_kappa);
                float sync_slm = grmhd_synchrotron_correction(B_slim_g, rho_slim_g);
                // sqrt + /2.5 normalization keeps defaults ~1.0, avoids breaking
                // the existing slim disk appearance while making all params responsive
                float grmhd_param_slim = sqrt(nonthermal_slm * sync_slm / 2.5);

                // Look modulation of the source function and density-modulated absorption
                // (clumps are more opaque).
                float look_s = sqrt(turbulence_s) * isco_stress_s * grmhd_param_slim;
                float alpha_abs_s = slim_opacity * slim_j * sqrt(turbulence_s);
                {{/grmhd_enabled}}
                {{^grmhd_enabled}}
                float temperature_s = slim_disk_temperature(cyl_r_s);
                float turbulence_s = accretion_turbulence(cyl_r_s, angle_s, turb_t);

                // Look modulation of the source function; user-configurable absorption, higher is
                // more opaque and surface-like.
                float look_s = turbulence_s;
                float alpha_abs_s = slim_opacity * slim_j;
                {{/grmhd_enabled}}
                // Keplerian rotation as a stationary flow (the circular-orbit frequency falls back
                // to the local zero-angular-momentum frame inside the ISCO in Full Kerr).
                {{#full_kerr}}
                float g_s = kerr_nu / max(kerr_orbit_frequency(pos,
                    kerr_kepler_omega(cyl_r_s, kerr_a, disk_rotation_sign()),
                    kerr_pt, kerr_pphi, kerr_a), 1e-6);
                {{/full_kerr}}
                {{^full_kerr}}
                float g_s = binet_flow_shift(pos, disk_rotation_sign()*binet_kepler_omega(cyl_r_s),
                    photon_E, photon_Lz);
                {{/full_kerr}}

                // Thermal source function S = B(T) times the look modulation: the step adds
                // (1 - e^-tau) S with tau over the fluid-frame path dl / g.
                float step_T_s = exp(-alpha_abs_s * path_len_s / max(g_s, 0.05));
                color.rgb += vol_transmittance * (1.0 - step_T_s) * look_s * look_disk_gain *
                    thermal_radiance(temperature_s, disk_color_correction, g_s);
                vol_transmittance *= step_T_s;
            }
        }
        {{/accretion_slim_disk}}
