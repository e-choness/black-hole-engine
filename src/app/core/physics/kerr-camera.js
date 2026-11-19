// Camera frame of the Full Kerr solver: the 4-velocity of the physical camera, the orthonormal
// tetrad the rays are launched from, and the camera's components in that tetrad, which rescale
// every traced frequency to the physical camera.

import {
    boostVelocity,
    cameraTetrad,
    cksPosition,
    dot4,
    keplerAngularVelocity,
    metric,
    observerComponents,
    rainVelocity,
    speedRelativeToZamo,
    staticVelocity,
    zamoVelocity,
} from './kerr.js';

// Boosts uRef toward uObs with their relative speed scaled by strength, so the aberration strength
// control blends from the reference frame (0) to the physical camera (1).
function scaledObserver(g, uRef, uObs, strength) {
    if (strength >= 1) return uObs;
    const gamma = -dot4(g, uObs, uRef);
    if (strength <= 0 || !(gamma > 1 + 1e-12)) return uRef;
    const beta = Math.sqrt(1 - 1 / (gamma * gamma));
    const scaled = Math.min(strength * beta, 0.999);
    const gammaScaled = 1 / Math.sqrt(1 - scaled * scaled);
    return uRef.map((c, i) => gammaScaled * (c + (scaled * (uObs[i] / gamma - c)) / beta));
}

// position and velocity are the scene-space observer state, whose radius is read as the
// Boyer-Lindquist r; right, up and forward are the camera axes; a is the spin in r_s units.
// rain selects the dive's Doran free-fall frame, orbiting the circular orbit of the observer
// motion, and aberration is the aberration strength (0 traces the reference frame).
export function kerrCameraFrame(options) {
    const { position, velocity, right, up, forward, a, rain, orbiting, aberration } = options;
    const r = Math.max(Math.hypot(position[0], position[1], position[2]), 1e-6);
    const pos = cksPosition(
        r,
        position.map((c) => c / r),
        a,
    );
    const g = metric(pos, a);

    // Static observers exist outside the ergosurface and the zero-angular-momentum observer
    // everywhere outside the horizon; inside it only the free-falling frame remains.
    const zamo = zamoVelocity(pos, a);
    const reference = staticVelocity(pos, a) || zamo;
    let camera = reference;
    if (rain || !reference) {
        camera = rainVelocity(pos, a);
    } else if (orbiting && zamo && Math.hypot(velocity[0], velocity[1], velocity[2]) > 0) {
        // Circular orbit: the ZAMO boosted along the direction of motion with the equatorial
        // Keplerian speed v = varpi (Omega_K - omega) / alpha at this radius.
        const sense = position[0] * velocity[1] - position[1] * velocity[0] < 0 ? -1 : 1;
        const omega = keplerAngularVelocity(r, a, sense);
        const speed = Math.abs(speedRelativeToZamo(cksPosition(r, [1, 0, 0], a), omega, a));
        camera = boostVelocity(g, zamo, velocity, Math.min(speed, 0.999));
    }

    const traced = reference ? scaledObserver(g, reference, camera, aberration) : camera;
    const tetrad = cameraTetrad(g, traced, right, up, forward);
    return { pos, tetrad, doppler: observerComponents(g, tetrad, camera) };
}
