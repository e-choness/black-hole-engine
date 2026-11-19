        {{#accretion_thick_torus}}
        {
            // ADAF/RIAF volumetric emission: optically thin radiative transfer
            // dI/ds = j - alpha*I  (emission minus absorption)
            {{#grmhd_enabled}}
            // GRMHD: evaluate torus with stronger height modulation (2×) for
            // visible azimuthal warps and buoyant features from MRI + Parker
            // instability.  The torus is geometrically thick, so larger warps
            // are physically expected (Liska+ 2022: H/R variation ~15-30%).
            float _cr_t = max(length(pos.xy), 1e-4);
            float _a_t = equatorial_azimuth(pos.xy);
            float _hmod_raw_t = grmhd_height_modulation(_cr_t, _a_t, turb_t);
            // Amplify: base function gives ±15%, double it for ±30% warps
            float _hmod_t = 1.0 + 2.0 * (_hmod_raw_t - 1.0);
            vec3 _warp_t = vec3(pos.xy, pos.z / max(_hmod_t, 0.2));
            float torus_j = torus_local_emissivity(_warp_t);
            {{/grmhd_enabled}}
            {{^grmhd_enabled}}
            float torus_j = torus_local_emissivity(pos);
            {{/grmhd_enabled}}
            if (torus_j > 0.001 && vol_transmittance > 0.005) {
                float path_len = length(pos - old_pos);
                float r3d = max(length(pos), 1.001);
                float cyl_r_t = max(length(pos.xy), 1e-4);
                float angle_t = equatorial_azimuth(pos.xy);

                {{#grmhd_enabled}}
                // GRMHD two-temperature torus model (EHT-calibrated)
                // Temperature: β-dependent variation for color shifts.
                float h_torus_g = max(cyl_r_t * torus_h_ratio, 0.01);
                float gas_temp_torus = torus_temperature(r3d);
                float temperature_t = grmhd_electron_temperature(gas_temp_torus, cyl_r_t, pos.z, h_torus_g, turb_t, angle_t);

                // 3D volumetric turbulence with sqrt() to moderate extremes.
                // The raw 3D FBM has high dynamic range (~100×) which produces
                // dramatic filaments in the slim disk (where Beer-Lambert
                // absorption renders surface features).  For the optically thin
                // ADAF torus, sqrt compresses this to ~10×, keeping visible 3D
                // structure without the tornado/nebula artefact.
                float raw_turb_t = grmhd_3d_density_turbulence(pos, turb_t);
                float turbulence_t = sqrt(max(raw_turb_t, 0.01));

                // Magnetic field, synchrotron, and non-thermal corrections
                float beta_torus = grmhd_plasma_beta(cyl_r_t, pos.z, h_torus_g);
                float rho_torus = grmhd_density(cyl_r_t, 1.0);
                float B_torus = grmhd_B_field(rho_torus, gas_temp_torus, beta_torus);
                float nonthermal_t = grmhd_nonthermal_boost(grmhd_electron_kappa);
                float sync_corr_t = grmhd_synchrotron_correction(B_torus, rho_torus);

                // Attenuated GRMHD corrections: parameters responsive but
                // torus brightness stays close to the non-GRMHD appearance.
                float nt_mod_t = 1.0 + 0.15 * (nonthermal_t - 1.0);
                float sync_mod_t = 1.0 + 0.15 * (sync_corr_t - 1.0);

                // Emissivity: base torus × 3D turbulence × subtle corrections
                float j_eff = TORUS_EMISSIVITY_SCALE * torus_j * turbulence_t
                            * nt_mod_t * sync_mod_t;

                // Absorption: turbulence-modulated (denser clumps are more opaque)
                float alpha_abs = torus_opacity * torus_j * pow(turbulence_t, 0.5)
                                * (0.5 + 0.5 * grmhd_density_scale);
                {{/grmhd_enabled}}
                {{^grmhd_enabled}}
                float temperature_t = torus_temperature(r3d);
                float turbulence_t = accretion_turbulence(cyl_r_t, angle_t, turb_t);

                // Emission coefficient: optically thin ADAF has low emissivity
                float j_eff = TORUS_EMISSIVITY_SCALE * torus_j * turbulence_t;
                // Absorption: user-configurable opacity (default low for optically thin)
                float alpha_abs = torus_opacity * torus_j;
                {{/grmhd_enabled}}
                // Sub-Keplerian rotation (ADAF: ~50% of Keplerian) as a stationary flow; the
                // fluid-frame path is dl / g for both the emission and the optical depth.
                {{#full_kerr}}
                float g_t = kerr_nu / max(kerr_orbit_frequency(pos,
                    0.5*kerr_kepler_omega(cyl_r_t, kerr_a, disk_rotation_sign()),
                    kerr_pt, kerr_pphi, kerr_a), 1e-6);
                {{/full_kerr}}
                {{^full_kerr}}
                float g_t = binet_flow_shift(pos,
                    0.5*disk_rotation_sign()*binet_kepler_omega(cyl_r_t), photon_E, photon_Lz);
                {{/full_kerr}}
                float fluid_len_t = path_len / max(g_t, 0.05);

                // Front-to-back compositing with Beer-Lambert absorption
                color.rgb += vol_transmittance * j_eff * fluid_len_t * look_disk_gain *
                    thermal_radiance(temperature_t, 1.0, g_t);
                vol_transmittance *= exp(-alpha_abs * fluid_len_t);
            }
        }
        {{/accretion_thick_torus}}
