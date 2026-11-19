// Role: Legacy widgets the React interface has not replaced yet: the animations panel (dive,
//       hover and the timeline editor) and the observer orbit widget. Parameters are edited in
//       the React inspector (src/ui). Must be called after init() has created the scene.

import { shader, scene, setDistanceController } from '../core/runtime/runtime-state.js';
import {
    OBSERVER_ORBIT_MIN,
    OBSERVER_DISTANCE_MIN,
    OBSERVER_DISTANCE_MAX,
    clampObserverDistance,
} from '../core/observer.js';
import { updateCamera } from '../scene/camera-runtime.js';
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
import { engineNotice, resetObserverCamera, subscribeEngineChanges } from './engine-actions.js';
import { setupAnimationsPanel } from './panels/animations-panel.js';
import { setupObserverOrbitWidget } from './widgets/observer-orbit-widget.js';

export function setupGUI() {
    var p = shader.parameters;

    function showObserverControlHint(prefix) {
        var lead = prefix ? prefix + ' ' : '';
        engineNotice(lead + 'Left drag: orbit, Right drag: pan, Left+Right drag: roll.');
    }

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
        updateShader: function () {
            scene.updateShader();
        },
        resetObserverCamera: resetObserverCamera,
        showObserverControlHint: showObserverControlHint,
        registerBlackHoleUiBinding: registerBlackHoleUiBinding,
        setDistanceController: setDistanceController,
    });
    subscribeEngineChanges(observerOrbitWidget.syncControls);
}
