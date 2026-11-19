// Role: lil-gui configuration — builds every control panel and folder, wires up
//       all parameter bindings and manages conditional visibility for jet / torus /
//       planet controls. Presets, quality and observer operations live in
//       engine-actions.js. Must be called after init() has created the scene.

import GUI from 'lil-gui';
import {
    DISK_TEMPERATURE_MIN,
    DISK_TEMPERATURE_MAX,
    shader,
    scene,
    observer,
    updateUniforms,
    applyRenderScaleFromSettings,
    resetTemporalAAHistory,
    setDistanceController,
} from '../core/runtime/runtime-state.js';
import {
    OBSERVER_ORBIT_MIN,
    OBSERVER_DISTANCE_MIN,
    OBSERVER_DISTANCE_MAX,
    PLANET_ORBIT_MIN,
    clampObserverDistance,
} from '../core/observer.js';
import { updateCamera } from '../scene/camera-runtime.js';
import { QUALITY_PRESET_LABELS, KERR_MODE_LABELS } from './quality-presets.js';
import { diveState, hoverState } from '../core/scenarios/scenario-state.js';
import { startDive, resetDive, seekDive } from '../core/scenarios/dive.js';
import { startHover, resetHover, seekHover } from '../core/scenarios/hover.js';
import {
    toggleAnimationTimelineCapture,
    setAnimationTimelineCaptureCameraSmoothingEnabled,
    updateAnimationTimelineCaptureUi,
} from '../core/scenarios/animation-capture.js';
import { buildTimelinePanel } from '../presentation/editor/timeline-panel.js';
import { registerBlackHoleUiBinding } from '../core/runtime/runtime-registry.js';
import {
    applyBlackHolePreset,
    applyKerrMode,
    applyQualityPreset,
    engineNotice,
    getBlackHolePresetName,
    markBlackHolePresetCustom,
    markQualityPresetCustom,
    notifyEngineChanged,
    planetAvailable,
    resetObserverCamera,
    subscribeEngineChanges,
} from './engine-actions.js';
import { setupAnimationsPanel } from './panels/animations-panel.js';
import { setupObserverOrbitWidget } from './widgets/observer-orbit-widget.js';
import { setupControlsPanel } from './panels/controls-panel.js';
import { setupRenderingFolder } from './panels/rendering-folder.js';
import { setupAccretionLookFolders } from './panels/accretion-look-folders.js';
import { setupSimulationFolders } from './panels/simulation-folders.js';

export function setupGUI() {
    var p = shader.parameters;

    function updateShader() {
        scene.updateShader();
    }

    function updateUniformsLive() {
        updateUniforms();
        shader.needsUpdate = true;
    }

    function showObserverControlHint(prefix) {
        var lead = prefix ? prefix + ' ' : '';
        engineNotice(lead + 'Left drag: orbit, Right drag: pan, Left+Right drag: roll.');
    }

    var gui = new GUI({ autoPlace: false, closeFolders: true });

    setupControlsPanel(gui);

    var syncObserverWidgetControls = null;
    var updateDependentVisibility = function () {};

    // lil-gui does not notice when code changes a bound property, so every controller is
    // redrawn after programmatic updates such as presets and timeline playback.
    function refreshAllControllers() {
        document.querySelectorAll('.planet-controls').forEach(function (element) {
            element.style.display = planetAvailable() ? '' : 'none';
        });
        updateDependentVisibility();
        gui.controllersRecursive().forEach(function (controller) {
            controller.updateDisplay();
        });
        if (syncObserverWidgetControls) syncObserverWidgetControls();
    }
    subscribeEngineChanges(refreshAllControllers);

    function setGuiRowClass(controller, classNames) {
        controller.domElement.classList.add(...classNames.split(/\s+/));
    }

    function addHelpText(controller, text) {
        if (text) controller.domElement.title = text;
    }

    function addControl(folder, obj, key, cfg) {
        cfg = cfg || {};
        var c = cfg.options ? folder.add(obj, key, cfg.options) : folder.add(obj, key);
        if (cfg.min !== undefined) c.min(cfg.min);
        if (cfg.max !== undefined) c.max(cfg.max);
        if (cfg.step !== undefined) c.step(cfg.step);
        if (cfg.name) c.name(cfg.name);
        var handler = cfg.onChange;
        c.onChange(function () {
            if (cfg.trackBlackHolePreset) markBlackHolePresetCustom();
            if (cfg.trackQualityPreset) markQualityPresetCustom();
            if (handler) handler.apply(this, arguments);
            notifyEngineChanged();
        });
        if (cfg.help) addHelpText(c, cfg.help);
        if (cfg.className) setGuiRowClass(c, cfg.className);
        return c;
    }

    function setControlVisible(controller, isVisible) {
        if (controller) controller.show(isVisible);
    }

    function setControlsVisible(controllers, isVisible) {
        controllers.forEach(function (ctrl) {
            setControlVisible(ctrl, isVisible);
        });
    }

    var presetObj = {
        get preset() {
            return getBlackHolePresetName();
        },
        set preset(name) {},
    };
    var renderingFolder = setupRenderingFolder({
        gui: gui,
        parameters: p,
        presetObj: presetObj,
        addControl: addControl,
        qualityPresetLabels: QUALITY_PRESET_LABELS,
        kerrModeLabels: KERR_MODE_LABELS,
        applyBlackHolePreset: applyBlackHolePreset,
        applyQualityPreset: applyQualityPreset,
        applyKerrMode: applyKerrMode,
        updateShader: updateShader,
        onResolutionScaleChange: function () {
            applyRenderScaleFromSettings();
            resetTemporalAAHistory();
        },
        onTaaEnabledChange: function () {
            resetTemporalAAHistory();
            shader.needsUpdate = true;
        },
        onTaaSettingChange: function () {
            resetTemporalAAHistory();
            shader.needsUpdate = true;
        },
    });
    var taaEnabledCtrl = renderingFolder.taaEnabledCtrl;
    var taaHistoryWeightCtrl = renderingFolder.taaHistoryWeightCtrl;
    var taaClipGammaCtrl = renderingFolder.taaClipGammaCtrl;
    var taaMotionRejectCtrl = renderingFolder.taaMotionRejectCtrl;
    var taaMaxDeltaCtrl = renderingFolder.taaMaxDeltaCtrl;

    var accretionLookFolders = setupAccretionLookFolders({
        gui: gui,
        parameters: p,
        observer: observer,
        addControl: addControl,
        setControlVisible: setControlVisible,
        setControlsVisible: setControlsVisible,
        getUpdateDependentVisibility: function () {
            return updateDependentVisibility;
        },
        updateShader: updateShader,
        updateUniformsLive: updateUniformsLive,
        markShaderDirty: function () {
            shader.needsUpdate = true;
        },
        diskTemperatureMin: DISK_TEMPERATURE_MIN,
        diskTemperatureMax: DISK_TEMPERATURE_MAX,
    });
    var accretionModeCtrl = accretionLookFolders.accretionModeCtrl;
    var syncDiskEmissionRows = accretionLookFolders.syncDiskEmissionRows;
    var torusRows = accretionLookFolders.torusRows;
    var slimRows = accretionLookFolders.slimRows;
    var grmhdEnabledCtrl = accretionLookFolders.grmhdEnabledCtrl;
    var grmhdRows = accretionLookFolders.grmhdRows;
    var jetCommonCtrls = accretionLookFolders.jetCommonCtrls;
    var jetPhysicalCtrls = accretionLookFolders.jetPhysicalCtrls;
    var spinCtrl = accretionLookFolders.spinCtrl;
    var spinStrengthCtrl = accretionLookFolders.spinStrengthCtrl;
    var lookDiskGainCtrl = accretionLookFolders.lookDiskGainCtrl;
    var lookGlowCtrl = accretionLookFolders.lookGlowCtrl;
    var lookDopplerBoostCtrl = accretionLookFolders.lookDopplerBoostCtrl;
    var lookAberrationStrengthCtrl = accretionLookFolders.lookAberrationStrengthCtrl;
    var bloomStrengthCtrl = accretionLookFolders.bloomStrengthCtrl;
    var bloomRadiusCtrl = accretionLookFolders.bloomRadiusCtrl;

    var simulationFolders = setupSimulationFolders({
        gui: gui,
        parameters: p,
        observer: observer,
        addControl: addControl,
        updateUniforms: updateUniforms,
        updateShader: updateShader,
        markShaderDirty: function () {
            shader.needsUpdate = true;
        },
        planetOrbitMin: PLANET_ORBIT_MIN,
        getUpdateDependentVisibility: function () {
            return updateDependentVisibility;
        },
    });
    var planetDistanceCtrl = simulationFolders.planetDistanceCtrl;
    var planetRadiusCtrl = simulationFolders.planetRadiusCtrl;
    var physicalBeamingCtrl = simulationFolders.physicalBeamingCtrl;
    var lorentzContractionCtrl = simulationFolders.lorentzContractionCtrl;

    updateDependentVisibility = function () {
        var diskEnabled = !!p.accretion_disk;
        var thinDiskEnabled = diskEnabled && p.accretion_mode === 'thin_disk';
        var thickTorusEnabled = diskEnabled && p.accretion_mode === 'thick_torus';
        var slimDiskEnabled = diskEnabled && p.accretion_mode === 'slim_disk';

        setControlVisible(accretionModeCtrl, diskEnabled);
        syncDiskEmissionRows();
        setControlsVisible(torusRows, thickTorusEnabled);
        setControlsVisible(slimRows, slimDiskEnabled);

        // GRMHD controls: toggle visible when disk is enabled, parameters visible when GRMHD mode is on
        var grmhdEnabled = diskEnabled && !!p.grmhd.enabled;
        setControlVisible(grmhdEnabledCtrl, diskEnabled);
        setControlsVisible(grmhdRows, grmhdEnabled);

        var jetEnabled = !!p.jet.enabled;
        setControlsVisible(jetCommonCtrls, jetEnabled);
        setControlsVisible(jetPhysicalCtrls, jetEnabled && p.jet.mode === 'physical');

        var spinEnabled = !!p.black_hole.spin_enabled;
        setControlVisible(spinCtrl, spinEnabled);
        // The heuristic spin strength only scales the Binet modes' frame-dragging terms.
        setControlVisible(spinStrengthCtrl, spinEnabled && p.kerr_mode !== 'full_kerr');

        var bloomEnabled = !!p.bloom.enabled;
        setControlsVisible([bloomStrengthCtrl, bloomRadiusCtrl], bloomEnabled);

        var beamingEnabled = !!p.beaming;
        var physicalBeamingEnabled = beamingEnabled && !!p.physical_beaming;
        setControlVisible(physicalBeamingCtrl, beamingEnabled);
        setControlVisible(lookDopplerBoostCtrl, beamingEnabled && !physicalBeamingEnabled);

        setControlVisible(lookAberrationStrengthCtrl, !!p.aberration);
        setControlVisible(lookGlowCtrl, thinDiskEnabled);
        setControlVisible(lookDiskGainCtrl, diskEnabled || jetEnabled);

        var planetEnabled = !!p.planet.enabled;
        setControlsVisible([planetDistanceCtrl, planetRadiusCtrl], planetEnabled);
        setControlVisible(lorentzContractionCtrl, planetEnabled);

        var taaEnabled = !!p.taa_enabled;
        setControlVisible(taaEnabledCtrl, true);
        setControlsVisible(
            [taaHistoryWeightCtrl, taaClipGammaCtrl, taaMotionRejectCtrl, taaMaxDeltaCtrl],
            taaEnabled,
        );
    };
    updateDependentVisibility();

    // Side panels extracted into focused helpers to keep the main GUI wiring readable.
    setupAnimationsPanel({
        initialObserverDistance: p.observer.distance,
        diveState: diveState,
        hoverState: hoverState,
        startDive: startDive,
        resetDive: resetDive,
        seekDive: seekDive,
        startHover: startHover,
        resetHover: resetHover,
        seekHover: seekHover,
        toggleAnimationTimelineCapture: toggleAnimationTimelineCapture,
        setAnimationTimelineCaptureCameraSmoothingEnabled:
            setAnimationTimelineCaptureCameraSmoothingEnabled,
        updateAnimationTimelineCaptureUi: updateAnimationTimelineCaptureUi,
        buildTimelinePanel: buildTimelinePanel,
    });

    var observerOrbitWidget = setupObserverOrbitWidget({
        parameters: p,
        observerOrbitMin: OBSERVER_ORBIT_MIN,
        observerDistanceMin: OBSERVER_DISTANCE_MIN,
        observerDistanceMax: OBSERVER_DISTANCE_MAX,
        clampObserverDistance: clampObserverDistance,
        updateCamera: updateCamera,
        markShaderDirty: function () {
            shader.needsUpdate = true;
        },
        updateShader: updateShader,
        resetObserverCamera: resetObserverCamera,
        showObserverControlHint: showObserverControlHint,
        registerBlackHoleUiBinding: registerBlackHoleUiBinding,
        setDistanceController: setDistanceController,
    });
    syncObserverWidgetControls = observerOrbitWidget.syncControls;
}
