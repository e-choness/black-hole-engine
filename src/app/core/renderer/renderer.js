import * as THREE from 'three';
import { RAYTRACER_VERTEX_SHADER } from '../../../shaders/raytracer/index.js';
import { Shader } from '../shader.js';
import { clampObserverDistance, clampPlanetOrbitDistance } from '../observer.js';
import { initializeCamera, updateCamera } from '../../scene/camera-runtime.js';
import { ObserverControls } from '../../scene/observer-controls.js';
import { setupBloom } from '../../graphics/bloom.js';
import { setupOutputPass } from '../../graphics/output-pass.js';
import { createRenderTarget } from '../../graphics/post-processing.js';
import { setupTemporalAA } from './temporal-aa.js';
import { buildTimelinePanel } from '../../presentation/editor/timeline-panel.js';
import {
    initEngineActions,
    installWheelZoom,
    notifyEngineChanged,
} from '../../ui/engine-actions.js';
import { applyQualityPresetValues } from '../../ui/quality-presets.js';
import {
    beginQualityBenchmarkIfNeeded,
    initialQualityPreset,
    clampResolutionScale,
} from './renderer-quality.js';
import { diveState, hoverState } from '../scenarios/scenario-state.js';
import { SHADER_MASS, iscoRadius } from '../physics/kerr.js';
import {
    EMISSION_LUT,
    LIMB_DARKENING_LAWS,
    bolometricLog2Coefficient,
    diskPeakTemperature,
    diskSpin,
    exposureLog2,
    pageThorneUniforms,
    referenceLog2Luminance,
} from '../physics/emission.js';
import { kerrCameraFrame } from '../physics/kerr-camera.js';
import { initSky } from '../sky.js';
import {
    DISK_TEMPERATURE_MIN,
    DISK_TEMPERATURE_MAX,
    viewportHost,
    camera,
    scene,
    renderer,
    shader,
    observer,
    cameraPan,
    bloomPass,
    taaPass,
    hdrTarget,
    shaderUniforms,
    baseDevicePixelRatio,
    lastTaaCameraMat,
    updateUniforms,
    setViewportHost,
    setCamera,
    setScene,
    setRenderer,
    setCameraControls,
    setShader,
    setBloomPass,
    setTaaPass,
    setOutputPass,
    setHdrTarget,
    setShaderUniforms,
    setRendererContextLost,
    setUpdateUniforms,
    setApplyRenderScaleFromSettings,
    setResetTemporalAAHistory,
} from '../runtime/runtime-state.js';

// Two RGBA32F rows sampled with texelFetch: blackbody colour and luminance on a log-T grid, and
// the colour of synchrotron power laws.
function createEmissionLutTexture() {
    var size = EMISSION_LUT.size;
    var data = new Float32Array(size * 8);
    data.set(EMISSION_LUT.blackbody, 0);
    data.set(EMISSION_LUT.powerLaw, size * 4);
    var texture = new THREE.DataTexture(data, size, 2, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    return texture;
}

function resetTemporalAAHistoryImpl() {
    if (taaPass) taaPass.reset();
    if (shaderUniforms && shaderUniforms.taa_jitter) {
        shaderUniforms.taa_jitter.value.set(0, 0);
    }
    lastTaaCameraMat.identity();
}

// The scene target, the TAA history and the bloom chain all run at the drawing-buffer size.
export function resizePasses(w, h) {
    if (hdrTarget) hdrTarget.setSize(w, h);
    if (bloomPass) bloomPass.resize(w, h);
    if (taaPass) taaPass.resize(w, h);
}

// Resizing the canvas clears it, so the passes follow the new drawing buffer and the next frame is
// drawn.
export function onCanvasResize() {
    if (!renderer || !shader) return;
    resizePasses(renderer.domElement.width, renderer.domElement.height);
    resetTemporalAAHistoryImpl();
    if (updateUniforms) updateUniforms();
    shader.needsUpdate = true;
}

// The render scale reaches the drawing buffer as the pixel ratio of the React Three Fiber canvas,
// which resizes it and calls onCanvasResize again when the ratio changes.
function applyRenderScaleFromSettingsImpl() {
    if (!renderer || !shader) return;
    var scale = clampResolutionScale(shader.parameters.resolution_scale);
    shader.parameters.resolution_scale = scale;
    viewportHost.setDpr(baseDevicePixelRatio * scale);
    onCanvasResize();
}

setApplyRenderScaleFromSettings(applyRenderScaleFromSettingsImpl);
setResetTemporalAAHistory(resetTemporalAAHistoryImpl);

export function init(glslSource, textures, viewport) {
    setShader(new Shader(glslSource));

    applyQualityPresetValues(shader.parameters, initialQualityPreset(), { selectSolver: true });

    setViewportHost(viewport);
    setScene(new THREE.Scene());

    var geometry = new THREE.PlaneGeometry(2, 2);
    var uniforms = {
        time: { value: 0 },
        turbulence_time_offset: { value: 0.0 },
        turbulence_loop_enabled: { value: 0.0 },
        turbulence_loop_seconds: { value: 20.0 },
        resolution: { value: new THREE.Vector2() },
        cam_pos: { value: new THREE.Vector3() },
        cam_x: { value: new THREE.Vector3() },
        cam_y: { value: new THREE.Vector3() },
        cam_z: { value: new THREE.Vector3() },
        cam_vel: { value: new THREE.Vector3() },
        cam_pan: { value: new THREE.Vector2() },
        taa_jitter: { value: new THREE.Vector2() },
        interior_mode: { value: 0.0 },
        cam_rain: { value: 0.0 },
        cam_pos_ks: { value: new THREE.Vector3() },
        cam_u_cov: { value: new THREE.Vector4(0, 0, 0, -1) },
        cam_e1_cov: { value: new THREE.Vector4(1, 0, 0, 0) },
        cam_e2_cov: { value: new THREE.Vector4(0, 1, 0, 0) },
        cam_e3_cov: { value: new THREE.Vector4(0, 0, 1, 0) },
        cam_doppler: { value: new THREE.Vector4(0, 0, 0, 1) },
        planet_distance: { value: 0.0 },
        planet_radius: { value: 0.0 },
        emission_lut: { value: createEmissionLutTexture() },
        log2_exposure: { value: 0.0 },
        log2_look_scale: { value: 0.0 },
        radiance_visible: { value: 0.0 },
        bolometric_log2_coeff: { value: bolometricLog2Coefficient() },
        disk_temperature_peak: { value: 5000.0 },
        disk_uniform_temperature: { value: 0.0 },
        disk_color_correction: { value: 1.0 },
        disk_limb: { value: new THREE.Vector2(1, 0) },
        disk_opacity: { value: 1.0 },
        disk_spin_a: { value: 0.0 },
        disk_pt_x0: { value: Math.sqrt(6) },
        disk_pt_roots: { value: new THREE.Vector3() },
        disk_pt_coeffs: { value: new THREE.Vector3() },
        disk_flux_max: { value: 1.0 },
        disk_isco_el: { value: new THREE.Vector2() },
        jet_spectral_index: { value: 0.7 },
        accretion_inner_r: { value: 3.0 },
        bh_spin: { value: 0.9 },
        bh_spin_strength: { value: 1.0 },
        bh_rotation_enabled: { value: 1.0 },
        photon_spin_lensing_scale: { value: 1.0 },
        look_disk_gain: { value: 1.0 },
        look_glow: { value: 0.0 },
        look_doppler_boost: { value: 1.0 },
        look_aberration_strength: { value: 1.0 },
        look_galaxy_gain: { value: 1.0 },
        torus_r0: { value: 4.0 },
        torus_h_ratio: { value: 0.45 },
        torus_radial_falloff: { value: 2.5 },
        torus_opacity: { value: 0.015 },
        torus_outer_radius: { value: 3.5 },
        slim_h_ratio: { value: 0.15 },
        slim_opacity: { value: 0.6 },
        slim_puff_factor: { value: 2.5 },
        jet_half_angle: { value: 5.0 },
        jet_lorentz: { value: 3.0 },
        jet_brightness: { value: 1.2 },
        jet_length: { value: 30.0 },
        jet_magnetization: { value: 10.0 },
        jet_knot_spacing: { value: 6.0 },
        jet_corona_brightness: { value: 1.5 },
        jet_base_width: { value: 0.4 },
        jet_corona_extent: { value: 0.5 },
        grmhd_r_high: { value: 40.0 },
        grmhd_magnetic_beta: { value: 10.0 },
        grmhd_mad_flux: { value: 0.0 },
        grmhd_density_scale: { value: 1.0 },
        grmhd_turbulence_amp: { value: 1.0 },
        grmhd_electron_kappa: { value: 5.0 },
        grmhd_magnetic_field_str: { value: 1.0 },
        grav_blueshift_factor: { value: 1.0 },
        sky_cube: { value: null },
        sky_mode: { value: 0.0 },
        sky_revision: { value: 0 },
        planet_texture: { value: textures.moon },
    };
    setShaderUniforms(uniforms);

    // Disk temperature scale, Page-Thorne coefficients of the spin and the exposure that puts the
    // reference emitter (the disk photosphere at its peak temperature) at a fixed display level.
    function updateEmissionUniforms(diskA) {
        var p = shader.parameters;
        var pt = pageThorneUniforms(diskA);
        uniforms.disk_spin_a.value = diskA;
        uniforms.disk_pt_x0.value = pt.x0;
        uniforms.disk_pt_roots.value.fromArray(pt.roots);
        uniforms.disk_pt_coeffs.value.fromArray(pt.coeffs);
        uniforms.disk_flux_max.value = pt.fluxMax;
        uniforms.disk_isco_el.value.set(pt.iscoEnergy, pt.iscoAngularMomentum);

        var peakTemperature = diskPeakTemperature(p);
        var colorCorrection = Math.max(p.disk.color_correction, 1.0);
        var log2Reference = referenceLog2Luminance(
            peakTemperature,
            colorCorrection,
            p.radiance_model,
        );
        var log2Exposure = exposureLog2(p.look, log2Reference);
        uniforms.log2_exposure.value = log2Exposure;
        uniforms.log2_look_scale.value = log2Exposure + log2Reference;
        uniforms.radiance_visible.value = p.radiance_model === 'visible' ? 1.0 : 0.0;
        uniforms.disk_temperature_peak.value = peakTemperature;
        uniforms.disk_uniform_temperature.value = p.disk.temperature_mode === 'uniform' ? 1.0 : 0.0;
        uniforms.disk_color_correction.value = colorCorrection;
        var limb = LIMB_DARKENING_LAWS[p.disk.limb_darkening] || LIMB_DARKENING_LAWS.chandrasekhar;
        uniforms.disk_limb.value.set(limb[0], limb[1]);
        uniforms.disk_opacity.value = Math.min(Math.max(p.disk.opacity, 0.0), 1.0);
    }

    function updateUniformsImpl() {
        shader.parameters.disk_temperature = Math.max(
            DISK_TEMPERATURE_MIN,
            Math.min(DISK_TEMPERATURE_MAX, shader.parameters.disk_temperature),
        );
        shader.parameters.planet.distance = clampPlanetOrbitDistance(
            shader.parameters.planet.distance,
        );
        uniforms.planet_distance.value = shader.parameters.planet.distance;
        uniforms.planet_radius.value = shader.parameters.planet.radius;
        shader.parameters.observer.distance = clampObserverDistance(
            shader.parameters.observer.distance,
            shader.parameters.observer.motion,
        );

        var spin = shader.parameters.black_hole.spin;
        var spinEnabled = shader.parameters.black_hole.spin_enabled;
        var diskA = diskSpin(shader.parameters);
        uniforms.accretion_inner_r.value = iscoRadius(diskA * SHADER_MASS);
        updateEmissionUniforms(diskA);

        uniforms.bh_spin.value = shader.parameters.black_hole.spin;
        uniforms.bh_spin_strength.value = shader.parameters.black_hole.spin_strength;
        uniforms.bh_rotation_enabled.value = spinEnabled ? 1.0 : 0.0;
        uniforms.look_disk_gain.value = shader.parameters.look.disk_gain;
        uniforms.look_glow.value = shader.parameters.look.glow;
        uniforms.look_doppler_boost.value = shader.parameters.look.doppler_boost;
        uniforms.look_aberration_strength.value = shader.parameters.look.aberration_strength;
        uniforms.look_galaxy_gain.value = shader.parameters.look.galaxy_gain;

        uniforms.torus_r0.value = shader.parameters.torus.r0;
        uniforms.torus_h_ratio.value = shader.parameters.torus.h_ratio;
        uniforms.torus_radial_falloff.value = shader.parameters.torus.radial_falloff;
        uniforms.torus_opacity.value = shader.parameters.torus.opacity;
        uniforms.torus_outer_radius.value = shader.parameters.torus.outer_radius;

        uniforms.slim_h_ratio.value = shader.parameters.slim.h_ratio;
        uniforms.slim_opacity.value = shader.parameters.slim.opacity;
        uniforms.slim_puff_factor.value = shader.parameters.slim.puff_factor;

        uniforms.jet_half_angle.value = shader.parameters.jet.half_angle;
        uniforms.jet_lorentz.value = shader.parameters.jet.lorentz_factor;
        uniforms.jet_brightness.value = shader.parameters.jet.brightness;
        uniforms.jet_length.value = shader.parameters.jet.length;
        uniforms.jet_spectral_index.value = shader.parameters.jet.spectral_index;
        uniforms.jet_magnetization.value = shader.parameters.jet.magnetization;
        uniforms.jet_knot_spacing.value = shader.parameters.jet.knot_spacing;
        uniforms.jet_corona_brightness.value = shader.parameters.jet.corona_brightness;
        uniforms.jet_base_width.value = shader.parameters.jet.base_width;
        uniforms.jet_corona_extent.value = shader.parameters.jet.corona_extent;

        uniforms.grmhd_r_high.value = shader.parameters.grmhd.r_high;
        uniforms.grmhd_magnetic_beta.value = shader.parameters.grmhd.magnetic_beta;
        uniforms.grmhd_mad_flux.value = shader.parameters.grmhd.mad_flux;
        uniforms.grmhd_density_scale.value = shader.parameters.grmhd.density_scale;
        uniforms.grmhd_turbulence_amp.value = shader.parameters.grmhd.turbulence_amp;
        uniforms.grmhd_electron_kappa.value = shader.parameters.grmhd.electron_kappa;
        uniforms.grmhd_magnetic_field_str.value = shader.parameters.grmhd.magnetic_field_str;
        uniforms.turbulence_loop_enabled.value = shader.parameters.turbulence_loop_enabled
            ? 1.0
            : 0.0;
        uniforms.turbulence_loop_seconds.value = Math.max(
            1e-4,
            parseFloat(shader.parameters.turbulence_loop_seconds) || 20.0,
        );

        uniforms.resolution.value.x = renderer.domElement.width;
        uniforms.resolution.value.y = renderer.domElement.height;

        uniforms.time.value = observer.time;
        uniforms.turbulence_time_offset.value = observer.turbulenceTimeOffset || 0.0;

        var e = observer.orientation.elements;
        uniforms.cam_x.value.set(e[0], e[1], e[2]);
        uniforms.cam_y.value.set(e[3], e[4], e[5]);
        uniforms.cam_z.value.set(e[6], e[7], e[8]);

        function setVec(target, value) {
            uniforms[target].value.set(value.x, value.y, value.z);
        }

        setVec('cam_pos', observer.position);
        setVec('cam_vel', observer.velocity);
        uniforms.cam_pan.value.set(cameraPan.x, cameraPan.y);

        var obsR = observer.position.length();
        // The Binet solver is Schwarzschild, so its horizon is r = r_s for every spin.
        uniforms.interior_mode.value = obsR < 1.0 ? 1.0 : 0.0;

        // The dive camera falls from rest at infinity and is traced in that rain frame on
        // both sides of the horizon; every other camera is referenced to the static observer.
        var rainFrame = diveState.active || diveState.reachedSingularity;
        uniforms.cam_rain.value = rainFrame ? 1.0 : 0.0;

        // The dive and hover classify escape analytically for Schwarzschild, which the heuristic
        // spin lensing would contradict, so both scenarios trace pure Schwarzschild lensing.
        var observerSpeedSq = observer.velocity.lengthSq();
        var photonSpinLensingScale = 1.0;
        if (rainFrame || hoverState.active) {
            photonSpinLensingScale = 0.0;
        } else if (observerSpeedSq < 1e-8) {
            var fade = (obsR - 1.5) / 0.2;
            fade = Math.max(0.0, Math.min(1.0, fade));
            photonSpinLensingScale = fade * fade * (3.0 - 2.0 * fade);
        }
        uniforms.photon_spin_lensing_scale.value = photonSpinLensingScale;

        uniforms.grav_blueshift_factor.value = rainFrame
            ? 1.0
            : Math.sqrt(Math.max(1.0 - 1.0 / Math.max(obsR, 1.0), 1e-6));

        if (shader.parameters.kerr_mode === 'full_kerr') {
            var frame = kerrCameraFrame({
                position: [observer.position.x, observer.position.y, observer.position.z],
                velocity: [observer.velocity.x, observer.velocity.y, observer.velocity.z],
                right: [e[0], e[1], e[2]],
                up: [e[3], e[4], e[5]],
                forward: [e[6], e[7], e[8]],
                a: spinEnabled ? spin * SHADER_MASS : 0.0,
                rain: rainFrame,
                orbiting: !!shader.parameters.observer.motion,
                aberration: shader.parameters.aberration
                    ? Math.max(shader.parameters.look.aberration_strength, 0.0)
                    : 0.0,
            });
            var tetrad = frame.tetrad;
            uniforms.cam_pos_ks.value.set(frame.pos[0], frame.pos[1], frame.pos[2]);
            [
                ['cam_u_cov', tetrad.uLower],
                ['cam_e1_cov', tetrad.e1Lower],
                ['cam_e2_cov', tetrad.e2Lower],
                ['cam_e3_cov', tetrad.e3Lower],
                ['cam_doppler', frame.doppler],
            ].forEach(function (entry) {
                var v = entry[1];
                uniforms[entry[0]].value.set(v[1], v[2], v[3], v[0]);
            });
        }
    }

    setUpdateUniforms(updateUniformsImpl);

    var material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: uniforms,
        vertexShader: RAYTRACER_VERTEX_SHADER,
    });

    scene.updateShader = function () {
        material.fragmentShader = shader.compile();
        material.needsUpdate = true;
        shader.needsUpdate = true;
        resetTemporalAAHistoryImpl();
    };

    scene.updateShader();
    // The vertex shader emits clip-space positions, so the quad covers the screen for every
    // camera orientation; frustum culling against its world-space bounds would drop it
    // whenever the dive or hover camera looks away from the hole.
    var fullscreenQuad = new THREE.Mesh(geometry, material);
    fullscreenQuad.frustumCulled = false;
    scene.add(fullscreenQuad);

    var nextRenderer = viewport.gl;
    nextRenderer.domElement.id = 'bh-canvas';
    nextRenderer.domElement.style.touchAction = 'none';
    setRenderer(nextRenderer);
    initSky(renderer, uniforms, Math.min(16, renderer.capabilities.getMaxAnisotropy()));

    renderer.domElement.addEventListener(
        'webglcontextlost',
        function (e) {
            e.preventDefault();
            setRendererContextLost(true);
            console.warn('WebGL context lost - GPU driver may have reset (TDR).');
        },
        false,
    );
    renderer.domElement.addEventListener(
        'webglcontextrestored',
        function () {
            setRendererContextLost(false);
            console.info('WebGL context restored.');
            if (shader) shader.needsUpdate = true;
            resetTemporalAAHistoryImpl();
        },
        false,
    );

    setHdrTarget(createRenderTarget(renderer, 1, 1));
    setBloomPass(setupBloom(renderer));
    setTaaPass(setupTemporalAA(renderer));
    setOutputPass(setupOutputPass());

    var size = viewport.size();
    var nextCamera = new THREE.PerspectiveCamera(45, size.width / size.height, 1, 80000);
    setCamera(nextCamera);
    viewport.setCamera(nextCamera);
    initializeCamera(camera);

    var controls = new ObserverControls(camera, renderer.domElement);
    controls.panCallback = function (deltaX, deltaY, width, height) {
        var panSpeed = 0.75;
        var maxPan = 0.45;
        cameraPan.x -= ((2.0 * deltaX) / width) * panSpeed;
        cameraPan.y += ((2.0 * deltaY) / height) * panSpeed;
        cameraPan.x = Math.max(-maxPan, Math.min(maxPan, cameraPan.x));
        cameraPan.y = Math.max(-maxPan, Math.min(maxPan, cameraPan.y));
        shader.needsUpdate = true;
    };
    controls.zoomCallback = function (dollyDeltaY) {
        var zoomBase = 1.08;
        var zoomFactor = dollyDeltaY > 0 ? 1.0 / zoomBase : zoomBase;
        var newDist = shader.parameters.observer.distance * zoomFactor;
        newDist = clampObserverDistance(newDist, shader.parameters.observer.motion);
        shader.parameters.observer.distance = newDist;
        updateCamera();
        shader.needsUpdate = true;
        notifyEngineChanged();
    };
    controls.addEventListener('change', updateCamera);
    setCameraControls(controls);
    updateCamera();

    applyRenderScaleFromSettingsImpl();

    initEngineActions();
    installWheelZoom(renderer.domElement);
    buildTimelinePanel();
    beginQualityBenchmarkIfNeeded();
}
