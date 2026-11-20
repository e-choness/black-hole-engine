// Role: Shader configuration. Holds the parameters of the simulation and the look, and derives
//       from them the variant flags (quality, modes, enabled features) that decide which parts
//       the ray tracer's shader contains. Also defines the degToRad helper.

import { diveState, hoverState } from './scenarios/scenario-state.js';
import { GALAXY_DEFAULTS } from '../../features/galaxy/model.js';

export function degToRad(a) {
    return (Math.PI * a) / 180.0;
}

export function Shader() {
    this.parameters = {
        n_steps: 100,
        sample_count: 1,
        resolution_scale: 1.0,
        taa_enabled: false,
        taa: {
            history_weight: 0.9,
            clip_gamma: 1.25,
            motion_rejection: 8.0,
            max_camera_delta: 0.08,
        },
        accumulation: {
            enabled: true,
            max_frames: 256,
        },
        max_revolutions: 2.0,
        rk4_integration: false,
        quality: 'high',
        kerr_mode: 'kerr_inspired_disk_velocity',
        kerr_rtol: 1e-4,
        accretion_disk: true,
        accretion_mode: 'thin_disk',
        disk_temperature: 5000.0,
        disk: {
            temperature_mode: 'artist',
            mass_msun: 1e8,
            eddington_ratio: 0.1,
            color_correction: 1.0,
            limb_darkening: 'chandrasekhar',
            opacity: 1.0,
        },
        radiance_model: 'bolometric',
        torus: {
            r0: 4.0,
            h_ratio: 0.45,
            radial_falloff: 2.5,
            opacity: 0.015,
            outer_radius: 3.5,
        },
        slim: {
            h_ratio: 0.15,
            opacity: 0.6,
            puff_factor: 2.5,
        },
        jet: {
            enabled: false,
            mode: 'simple',
            half_angle: 5.0,
            lorentz_factor: 3.0,
            brightness: 1.2,
            length: 30.0,
            spectral_index: 0.7,
            magnetization: 10.0,
            knot_spacing: 6.0,
            corona_brightness: 1.5,
            base_width: 0.4,
            corona_extent: 0.5,
        },
        grmhd: {
            enabled: true,
            r_high: 40.0,
            magnetic_beta: 10.0,
            mad_flux: 0.0,
            density_scale: 1.0,
            turbulence_amp: 1.0,
            electron_kappa: 5.0,
            magnetic_field_str: 1.0,
        },
        black_hole: {
            spin_enabled: true,
            spin: 0.9,
            spin_strength: 1.0,
        },
        look: {
            tone_mapper: 'agx',
            white_balance_enabled: false,
            white_balance_k: 6500,
            exposure_mode: 'anchored',
            exposure_ev: 0.0,
            ev100: 30.0,
            disk_gain: 1.0,
            glow: 0.0,
            doppler_boost: 1.0,
            aberration_strength: 1.0,
            galaxy_gain: 0.4,
        },
        sky: {
            mode: 'galaxy',
            galaxy: { ...GALAXY_DEFAULTS },
        },
        bloom: {
            enabled: true,
            strength: 0.04,
            radius: 0.7,
        },
        planet: {
            enabled: true,
            distance: 14.0,
            radius: 0.4,
        },
        lorentz_contraction: true,
        gravitational_time_dilation: true,
        aberration: true,
        beaming: true,
        physical_beaming: true,
        doppler_shift: true,
        light_travel_time: true,
        time_scale: 1.0,
        turbulence_loop_enabled: false,
        turbulence_loop_seconds: 20.0,
        observer: {
            motion: false,
            distance: 11.0,
            orbital_inclination: -10,
        },
        dive: {
            speed: 1.0,
            autoOrient: true,
        },
        hover: {
            speed: 0.3,
        },
        planetEnabled: function () {
            return this.planet.enabled && this.quality !== 'mobile';
        },
        observerMotion: function () {
            return this.observer.motion;
        },
    };

    var that = this;
    this.needsUpdate = false;

    this.hasMovingParts = function () {
        return (
            that.parameters.accretion_disk ||
            that.parameters.jet.enabled ||
            that.parameters.planet.enabled ||
            that.parameters.observer.motion ||
            (that.parameters.sky.mode === 'galaxy' &&
                that.parameters.sky.galaxy.rotation_speed > 0) ||
            (diveState.active && !diveState.paused) ||
            (hoverState.active && !hoverState.paused)
        );
    };

    // Fills in the flags derived from the parameters that select the shader variant (solver
    // family, flow model, jet mode) and returns the parameters with them.
    this.variant = function () {
        // Older scenes name the exact solver by its former internal mode.
        if (that.parameters.kerr_mode === 'realtime_full_kerr_core') {
            that.parameters.kerr_mode = 'full_kerr';
        }

        var kerrInspiredMode = that.parameters.kerr_mode === 'kerr_inspired_disk_velocity';

        that.parameters.kerr_fast_mode = that.parameters.kerr_mode === 'fast';
        that.parameters.kerr_inspired_mode = kerrInspiredMode;
        that.parameters.full_kerr = that.parameters.kerr_mode === 'full_kerr';

        var accMode = that.parameters.accretion_mode;
        var diskOn = that.parameters.accretion_disk;
        that.parameters.accretion_thin_disk = diskOn && accMode === 'thin_disk';
        that.parameters.accretion_thick_torus = diskOn && accMode === 'thick_torus';
        that.parameters.accretion_slim_disk = diskOn && accMode === 'slim_disk';
        that.parameters.jet_enabled = that.parameters.jet.enabled;
        that.parameters.jet_simple =
            that.parameters.jet.enabled && that.parameters.jet.mode === 'simple';
        that.parameters.jet_physical =
            that.parameters.jet.enabled && that.parameters.jet.mode === 'physical';
        that.parameters.grmhd_enabled = !!that.parameters.grmhd.enabled;
        that.parameters.kerr_volume_steps =
            that.parameters.full_kerr &&
            (that.parameters.accretion_thick_torus ||
                that.parameters.accretion_slim_disk ||
                that.parameters.jet_enabled);
        that.parameters.planet_enabled = that.parameters.planetEnabled();
        return that.parameters;
    };
}
