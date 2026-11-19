'use strict';

import { observer, shader, scene } from '../runtime/runtime-state.js';
import { diveState, hoverState, animationTimelineCaptureState } from './scenario-state.js';
import { updateCamera } from '../../scene/camera-runtime.js';
import { refreshRendererUiBindings } from '../runtime/ui-bindings.js';
import {
    readAnimationCaptureAnchorPosition,
    readAnimationCaptureAnchorVelocity,
    finalizeAnimationTimelineCapture,
} from './animation-capture.js';
import { resetDive } from './dive.js';
import {
    SHADER_MASS,
    cksPosition,
    clockRate,
    staticAcceleration,
    staticVelocity,
} from '../physics/kerr.js';

// Spin of the traced spacetime in r_s units: Kerr for the Full Kerr solver, Schwarzschild for the
// Binet modes.
function hoverSpin() {
    var hole = shader.parameters.black_hole;
    return shader.parameters.kerr_mode === 'full_kerr' && hole.spin_enabled
        ? hole.spin * SHADER_MASS
        : 0.0;
}

function hoverPoint(r) {
    var d = hoverState.direction || { x: 1, y: 0, z: 0 };
    return cksPosition(r, [d.x, d.y, d.z], hoverSpin());
}

// dtau/dt of the hovering (static) observer, sqrt(1 - f), which is sqrt(1 - r_s/r) without spin.
// Static observers exist down to hoverState.minR for every spin; the floor only guards below.
function hoverClockRate(r) {
    return Math.max(clockRate(staticVelocity(hoverPoint(r), hoverSpin())), 1e-3);
}

export function advanceTimelineDrivenHoverObserverTime(dt) {
    if (!isFinite(dt) || dt <= 0 || !hoverState.active) return;
    var r = Math.max(hoverState.currentR, hoverState.minR, 1.0001);
    var timeDilation = hoverClockRate(r);
    observer.time += (dt * shader.parameters.time_scale) / timeDilation;
}

export function startHover(options) {
    options = options || {};
    var restartRequested = !!options.restart;

    if (!restartRequested && hoverState.active && !hoverState.paused) {
        hoverState.paused = true;
        hoverState.timelineDriven = false;
        return;
    }
    if (!restartRequested && hoverState.paused) {
        hoverState.paused = false;
        hoverState.timelineDriven = false;
        return;
    }
    if (restartRequested && hoverState.active) {
        resetHover();
    }

    if (diveState.active || diveState.reachedSingularity) {
        resetDive();
    }

    var anchorPosition =
        readAnimationCaptureAnchorPosition(options.anchorPosition) || observer.position.clone();
    if (anchorPosition.lengthSq() < 1e-10) {
        anchorPosition.set(Math.max(shader.parameters.observer.distance, 1.0), 0, 0);
    }
    var anchorVelocity =
        readAnimationCaptureAnchorVelocity(options.anchorVelocity) || observer.velocity.clone();
    var anchorRadius = anchorPosition.length();

    observer.position.copy(anchorPosition);
    observer.velocity.copy(anchorVelocity);
    shader.parameters.observer.distance = anchorRadius;
    if (typeof options.observerTime === 'number' && isFinite(options.observerTime)) {
        observer.time = options.observerTime;
    }

    hoverState.prevMotionState =
        options.prevMotionState !== undefined
            ? !!options.prevMotionState
            : shader.parameters.observer.motion;
    hoverState.prevDistance =
        typeof options.prevDistance === 'number' && isFinite(options.prevDistance)
            ? options.prevDistance
            : anchorRadius;
    hoverState.startPosition = anchorPosition.clone();
    hoverState.startVelocity = anchorVelocity.clone();

    shader.parameters.observer.motion = false;

    hoverState.direction = observer.position.clone().normalize();
    hoverState.currentR = observer.position.length();
    hoverState.active = true;
    hoverState.paused = false;
    hoverState.timelineDriven = false;

    observer.velocity.set(0, 0, 0);

    scene.updateShader();
    updateCamera();
    refreshRendererUiBindings();
}

export function resetHover() {
    if (animationTimelineCaptureState.active && animationTimelineCaptureState.mode === 'hover') {
        finalizeAnimationTimelineCapture('hover');
    }
    hoverState.active = false;
    hoverState.paused = false;
    hoverState.timelineDriven = false;

    shader.parameters.observer.motion = hoverState.prevMotionState;
    shader.parameters.observer.distance = hoverState.prevDistance;
    hoverState.currentR = hoverState.prevDistance;

    observer.position.copy(hoverState.startPosition);
    observer.velocity.copy(hoverState.startVelocity);

    scene.updateShader();
    updateCamera();
    shader.needsUpdate = true;
    refreshRendererUiBindings();
}

export function seekHover(targetR, options) {
    options = options || {};
    if (!hoverState.active) return;
    targetR = Math.max(hoverState.minR, Math.min(hoverState.prevDistance, targetR));

    hoverState.currentR = targetR;
    hoverState.paused = true;
    hoverState.timelineDriven = !!options.timelineDriven;

    observer.position.copy(hoverState.direction.clone().multiplyScalar(targetR));
    observer.velocity.set(0, 0, 0);
    shader.parameters.observer.distance = targetR;

    shader.needsUpdate = true;
    updateCamera();
}

export function updateHover(dt) {
    if (!hoverState.active || hoverState.paused) return;

    var r = hoverState.currentR;
    if (r <= hoverState.minR) {
        hoverState.paused = true;
        return;
    }

    var approachRate =
        hoverState.speed * Math.max(r - hoverState.minR, 0.001) * shader.parameters.time_scale;
    var newR = Math.max(r - approachRate * dt, hoverState.minR);

    hoverState.currentR = newR;

    observer.position.copy(hoverState.direction.clone().multiplyScalar(newR));
    observer.velocity.set(0, 0, 0);

    shader.parameters.observer.distance = newR;

    var timeDilation = hoverClockRate(newR);
    observer.time += (dt * shader.parameters.time_scale) / timeDilation;

    shader.needsUpdate = true;
}

// State of the hover for the interface: radius in r_s, the gravitational blueshift of incoming
// light, the proper acceleration needed to hover in c^2/r_s, a phase for the status line and the
// progress from the start radius startR towards r = 0, which stops at minR.
export function hoverReadout() {
    var r = hoverState.currentR;
    var phase;
    if (!hoverState.active) phase = 'ready';
    else if (hoverState.paused && r <= hoverState.minR + 0.01) phase = 'minimum';
    else if (hoverState.paused) phase = 'paused';
    else if (r > 3.0) phase = 'descending';
    else if (r > 1.5) phase = 'strong';
    else phase = 'extreme';
    return {
        r: r,
        blueshift: 1.0 / hoverClockRate(r),
        acceleration: staticAcceleration(hoverPoint(r), hoverSpin()),
        phase: phase,
        speed: hoverState.speed,
        progress: Math.max(0, Math.min(1, 1.0 - r / Math.max(hoverState.prevDistance, 1))),
        startR: Math.max(hoverState.prevDistance, 1),
        minR: hoverState.minR,
    };
}
