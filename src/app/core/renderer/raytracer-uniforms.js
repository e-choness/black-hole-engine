import * as THREE from 'three';
import { EMISSION_LUT, bolometricLog2Coefficient } from '../physics/emission.js';
import { createNoiseVolume } from '../../../shaders/tsl/nodes/noise.js';

// Two RGBA32F rows read texel by texel: blackbody colour and luminance on a log-T grid, and the
// colour of synchrotron power laws.
function createEmissionLutTexture() {
    var size = EMISSION_LUT.size;
    var data = new Float32Array(size * 8);
    data.set(EMISSION_LUT.blackbody, 0);
    data.set(EMISSION_LUT.powerLaw, size * 4);
    var texture = new THREE.DataTexture(data, size, 2, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
}

// Initial values of the ray tracer's uniforms, by name, from which createRaytracerUniforms()
// builds the uniform nodes that renderer.js updates.
export function raytracerUniformValues() {
    return {
        time: 0,
        turbulence_time_offset: 0.0,
        turbulence_loop_enabled: 0.0,
        turbulence_loop_seconds: 20.0,
        resolution: new THREE.Vector2(),
        cam_pos: new THREE.Vector3(),
        cam_x: new THREE.Vector3(),
        cam_y: new THREE.Vector3(),
        cam_z: new THREE.Vector3(),
        cam_vel: new THREE.Vector3(),
        cam_pan: new THREE.Vector2(),
        taa_jitter: new THREE.Vector2(),
        interior_mode: 0.0,
        cam_rain: 0.0,
        cam_pos_ks: new THREE.Vector3(),
        cam_u_cov: new THREE.Vector4(0, 0, 0, -1),
        cam_e1_cov: new THREE.Vector4(1, 0, 0, 0),
        cam_e2_cov: new THREE.Vector4(0, 1, 0, 0),
        cam_e3_cov: new THREE.Vector4(0, 0, 1, 0),
        cam_doppler: new THREE.Vector4(0, 0, 0, 1),
        planet_distance: 0.0,
        planet_radius: 0.0,
        emission_lut: createEmissionLutTexture(),
        noise_volume: createNoiseVolume(),
        log2_exposure: 0.0,
        log2_look_scale: 0.0,
        radiance_visible: 0.0,
        bolometric_log2_coeff: bolometricLog2Coefficient(),
        disk_temperature_peak: 5000.0,
        disk_uniform_temperature: 0.0,
        disk_color_correction: 1.0,
        disk_limb: new THREE.Vector2(1, 0),
        disk_opacity: 1.0,
        disk_arc_sharpness: 4.0,
        disk_arc_norm: 1.0,
        disk_spin_a: 0.0,
        disk_pt_x0: Math.sqrt(6),
        disk_pt_roots: new THREE.Vector3(),
        disk_pt_coeffs: new THREE.Vector3(),
        disk_flux_max: 1.0,
        disk_isco_el: new THREE.Vector2(),
        jet_spectral_index: 0.7,
        accretion_inner_r: 3.0,
        bh_spin: 0.9,
        bh_spin_strength: 1.0,
        bh_rotation_enabled: 1.0,
        photon_spin_lensing_scale: 1.0,
        look_disk_gain: 1.0,
        look_glow: 0.0,
        look_doppler_boost: 1.0,
        look_aberration_strength: 1.0,
        look_galaxy_gain: 1.0,
        torus_r0: 4.0,
        torus_h_ratio: 0.45,
        torus_radial_falloff: 2.5,
        torus_opacity: 0.015,
        torus_outer_radius: 3.5,
        slim_h_ratio: 0.15,
        slim_opacity: 0.6,
        slim_puff_factor: 2.5,
        jet_half_angle: 5.0,
        jet_lorentz: 3.0,
        jet_brightness: 1.2,
        jet_length: 30.0,
        jet_magnetization: 10.0,
        jet_knot_spacing: 6.0,
        jet_corona_brightness: 1.5,
        jet_base_width: 0.4,
        jet_corona_extent: 0.5,
        grmhd_r_high: 40.0,
        grmhd_magnetic_beta: 10.0,
        grmhd_mad_flux: 0.0,
        grmhd_density_scale: 1.0,
        grmhd_turbulence_amp: 1.0,
        grmhd_electron_kappa: 5.0,
        grmhd_magnetic_field_str: 1.0,
        grav_blueshift_factor: 1.0,
        sky_cube: null,
        sky_mode: 0.0,
        sky_revision: 0,
    };
}
