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
import { resetHover } from './hover.js';
import { SHADER_MASS, horizonRadius, innerHorizonRadius, rainRadialRate } from '../physics/kerr.js';

// Spin of the traced spacetime in r_s units: Kerr for the Full Kerr solver, Schwarzschild for the
// Binet modes.
function diveSpin() {
    var hole = shader.parameters.black_hole;
    return shader.parameters.kerr_mode === 'full_kerr' && hole.spin_enabled
        ? hole.spin * SHADER_MASS
        : 0.0;
}

// -dr/dtau of the rain observer, sqrt(r_s/r) without spin and sqrt(2 M r (r^2 + a^2)) / rho^2 for
// Kerr, where it falls at constant theta.
function fallRate(r) {
    var cosTheta = diveState.direction ? diveState.direction.z : 0.0;
    return -rainRadialRate(Math.max(r, 0.01), cosTheta, diveSpin());
}

// The dive stops at r = 0.08 r_s without spin and just above the Kerr inner (Cauchy) horizon,
// beyond which the Kerr-Schild interior is no longer a faithful model.
function diveFloor() {
    var a = diveSpin();
    return a !== 0.0 ? Math.max(0.08, 1.05 * innerHorizonRadius(a)) : 0.08;
}

export function advanceTimelineDrivenDiveObserverTime(dt) {
    if (!isFinite(dt) || dt <= 0 || !diveState.active || diveState.reachedSingularity) {
        return;
    }
    var r = Math.max(diveState.currentR, diveFloor());
    observer.time += dt * diveEffectiveSpeed(r) * shader.parameters.time_scale;
}

export function startDive(options) {
    options = options || {};
    var restartRequested = !!options.restart;

    if (!restartRequested && diveState.active && !diveState.paused) {
        diveState.paused = true;
        diveState.timelineDriven = false;
        return;
    }
    if (!restartRequested && diveState.paused) {
        diveState.paused = false;
        diveState.timelineDriven = false;
        return;
    }
    if (restartRequested && (diveState.active || diveState.reachedSingularity)) {
        resetDive();
    }

    if (hoverState.active) {
        resetHover();
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

    diveState.prevMotionState =
        options.prevMotionState !== undefined
            ? !!options.prevMotionState
            : shader.parameters.observer.motion;
    diveState.prevDistance =
        typeof options.prevDistance === 'number' && isFinite(options.prevDistance)
            ? options.prevDistance
            : anchorRadius;
    diveState.startPosition = anchorPosition.clone();
    diveState.startVelocity = anchorVelocity.clone();
    diveState.startRenderSettings = {
        n_steps: shader.parameters.n_steps,
        max_revolutions: shader.parameters.max_revolutions,
        rk4_integration: shader.parameters.rk4_integration,
    };

    shader.parameters.observer.motion = false;

    diveState.direction = observer.position.clone().normalize();
    diveState.currentR = observer.position.length();
    diveState.active = true;
    diveState.paused = false;
    diveState.timelineDriven = false;
    diveState.reachedSingularity = false;

    if (shader.parameters.n_steps < 400) {
        shader.parameters.n_steps = 400;
    }
    if (shader.parameters.max_revolutions < 3.0) {
        shader.parameters.max_revolutions = 3.0;
    }
    shader.parameters.rk4_integration = true;

    scene.updateShader();
    updateCamera();
    refreshRendererUiBindings();
}

export function resetDive() {
    if (animationTimelineCaptureState.active && animationTimelineCaptureState.mode === 'dive') {
        finalizeAnimationTimelineCapture('dive');
    }
    diveState.active = false;
    diveState.paused = false;
    diveState.timelineDriven = false;
    diveState.reachedSingularity = false;

    shader.parameters.observer.motion = diveState.prevMotionState;
    shader.parameters.observer.distance = diveState.prevDistance;
    diveState.currentR = diveState.prevDistance;

    observer.position.copy(diveState.startPosition);
    observer.velocity.copy(diveState.startVelocity);

    if (diveState.startRenderSettings) {
        shader.parameters.n_steps = diveState.startRenderSettings.n_steps;
        shader.parameters.max_revolutions = diveState.startRenderSettings.max_revolutions;
        shader.parameters.rk4_integration = diveState.startRenderSettings.rk4_integration;
        diveState.startRenderSettings = null;
    }

    scene.updateShader();
    updateCamera();
    shader.needsUpdate = true;
    refreshRendererUiBindings();
}

function cinematicFactor(r) {
    var farBoost = (2.0 * Math.max(r - 3.0, 0.0)) / 7.0;
    var photonSlow = 3.0 * Math.exp(-Math.pow((r - 1.5) / 0.3, 2));
    var horizonSlow = 5.0 * Math.exp(-Math.pow((r - 1.0) / 0.22, 2));
    return (1.0 + farBoost) / (1.0 + photonSlow + horizonSlow);
}

export function seekDive(targetR, options) {
    options = options || {};
    if (!diveState.active && !diveState.reachedSingularity) return;
    var floor = diveFloor();
    targetR = Math.max(floor, Math.min(diveState.prevDistance, targetR));

    if (diveState.reachedSingularity && targetR > floor + 0.04) {
        diveState.reachedSingularity = false;
        diveState.active = true;
    }

    diveState.currentR = targetR;
    if (targetR <= floor + 0.01) {
        diveState.reachedSingularity = true;
    }
    diveState.paused = true;
    diveState.timelineDriven = !!options.timelineDriven;

    observer.position.copy(diveState.direction.clone().multiplyScalar(targetR));
    observer.velocity.copy(diveState.direction.clone().multiplyScalar(-fallRate(targetR)));
    shader.parameters.observer.distance = targetR;

    shader.needsUpdate = true;
    updateCamera();
}

// Playback speed of the dive at radius r, slowed near the photon sphere and the horizon in
// cinematic mode.
function diveEffectiveSpeed(r) {
    return diveState.cinematic ? diveState.speed * cinematicFactor(r) : diveState.speed;
}

// Radius after a step of dt seconds from r: midpoint integration of dr/dtau = -fallRate(r), with
// dtau scaled by the playback speed and the time scale.
function diveRadiusStep(r, dt, floor, timeScale) {
    var fallDt = dt * diveEffectiveSpeed(r) * timeScale;
    var k1 = -fallRate(r) * fallDt;
    var rMid = Math.max(r + k1 * 0.5, 0.01);
    var k2 = -fallRate(rMid) * fallDt;
    return Math.max(r + k2, floor);
}

// Frames a dive from startR lasts at `fps` steps per second, counted the way updateDive steps it:
// the frame that reaches the floor is followed by the one that ends the dive. Infinity when it
// would not end within maxFrames.
export function diveFrameCount(startR, fps, maxFrames, timeScale) {
    var floor = diveFloor();
    var dt = 1.0 / fps;
    var r = startR;
    var frames = 0;
    while (r > floor) {
        if (frames >= maxFrames) return Infinity;
        r = diveRadiusStep(r, dt, floor, timeScale);
        frames += 1;
    }
    return frames + 1;
}

export function updateDive(dt) {
    if (!diveState.active || diveState.paused || diveState.reachedSingularity) return;

    var r = diveState.currentR;
    var floor = diveFloor();
    if (r <= floor) {
        diveState.reachedSingularity = true;
        return;
    }

    var effectiveSpeed = diveEffectiveSpeed(r);
    var newR = diveRadiusStep(r, dt, floor, shader.parameters.time_scale);

    diveState.currentR = newR;
    observer.position.copy(diveState.direction.clone().multiplyScalar(newR));

    // dr/dtau of the rain observer; without spin it equals the speed relative to the static
    // observer outside the horizon and keeps growing inside, where no static observer exists.
    observer.velocity.copy(diveState.direction.clone().multiplyScalar(-fallRate(newR)));

    shader.parameters.observer.distance = newR;
    observer.time += dt * effectiveSpeed * shader.parameters.time_scale;

    shader.needsUpdate = true;
}

// State of the dive for the interface: radius in r_s, fall rate in c, the horizon radius, the
// playback speed after the cinematic slow-down near the horizon, a phase for the status line and
// the progress from the start radius startR towards r = 0.
export function diveReadout() {
    var r = diveState.currentR;
    var spinning = diveSpin() !== 0.0;
    var rHorizon = horizonRadius(diveSpin());
    var phase;
    if (diveState.reachedSingularity) phase = spinning ? 'inner-horizon' : 'singularity';
    else if (!diveState.active) phase = 'ready';
    else if (diveState.paused) phase = 'paused';
    else if (r > 1.5 * rHorizon) phase = 'approaching';
    else if (r > rHorizon) phase = 'near-horizon';
    else if (spinning || r > 0.3) phase = 'inside';
    else phase = 'near-singularity';
    return {
        r: r,
        rate: fallRate(r),
        spinning: spinning,
        rHorizon: rHorizon,
        phase: phase,
        speed: diveEffectiveSpeed(r),
        progress: Math.max(0, Math.min(1, 1.0 - r / Math.max(diveState.prevDistance, 1))),
        startR: Math.max(diveState.prevDistance, 1),
    };
}
