import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import {
    cameraAnglesFromQuaternion,
    cameraPoseFromAngles,
    quaternionFromCameraAngles,
} from '../../src/features/share/camera-angles.js';
import { assertClose } from './support/assert-close.js';

const DEG = Math.PI / 180;

// q and -q are the same rotation.
function assertSameRotation(a, b, message) {
    const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
    assertClose(Math.abs(dot), 1, { abs: 1e-12 }, message);
}

function assertVector(actual, expected, tolerance = 1e-12) {
    expected.forEach((value, index) => assertClose(actual[index], value, { abs: tolerance }));
}

// Difference of two angles in degrees, folded into [-180, 180).
const angleGap = (a, b) => ((((a - b + 180) % 360) + 360) % 360) - 180;

// The camera quaternion OrbitControls produces: Object3D.lookAt() of the origin with camera.up.
function lookAtQuaternion(position, up) {
    const matrix = new Matrix4().lookAt(
        new Vector3(...position),
        new Vector3(),
        new Vector3(...up),
    );
    return new Quaternion().setFromRotationMatrix(matrix).toArray();
}

function random(seed) {
    let state = seed >>> 0 || 1;
    return () => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 4294967296;
    };
}

test('the default angles reproduce initializeCamera()', () => {
    // initializeCamera(): matrixWorldInverse = R_x(-pitch) R_y(-yaw), position = its third row.
    const m = new Matrix4()
        .makeRotationX(-3 * DEG)
        .multiply(new Matrix4().makeRotationY(0)).elements;
    const pose = cameraPoseFromAngles([0, -3, 0]);
    assertVector(pose.position, [m[2], m[6], m[10]]);
    assertVector(pose.up, [0, Math.cos(3 * DEG), Math.sin(3 * DEG)]);
    assertSameRotation(pose.quaternion, lookAtQuaternion(pose.position, [0, 1, 0]));
    assertVector(cameraAnglesFromQuaternion(pose.quaternion), [0, -3, 0]);
});

test('angles match three.js YXZ Euler angles and the lookAt pose of OrbitControls', () => {
    const next = random(7);
    for (let i = 0; i < 200; i += 1) {
        const azimuth = -180 + 360 * next();
        const elevation = -89 + 178 * next();
        const roll = -180 + 360 * next();
        const quaternion = quaternionFromCameraAngles([azimuth, elevation, roll]);
        const euler = new Euler(-elevation * DEG, azimuth * DEG, roll * DEG, 'YXZ');
        assertSameRotation(quaternion, new Quaternion().setFromEuler(euler).toArray());

        const { position, up } = cameraPoseFromAngles([azimuth, elevation, roll]);
        const cosEl = Math.cos(elevation * DEG);
        assertVector(position, [
            Math.sin(azimuth * DEG) * cosEl,
            Math.sin(elevation * DEG),
            Math.cos(azimuth * DEG) * cosEl,
        ]);
        assertClose(Math.hypot(...up), 1, { abs: 1e-12 });
        assertClose(up[0] * position[0] + up[1] * position[1] + up[2] * position[2], 0, {
            abs: 1e-12,
        });
        assertSameRotation(quaternion, lookAtQuaternion(position, up));

        const [backAzimuth, backElevation, backRoll] = cameraAnglesFromQuaternion(quaternion);
        assertClose(angleGap(backAzimuth, azimuth), 0, { abs: 1e-9 });
        assertClose(backElevation, elevation, { abs: 1e-9 });
        assertClose(angleGap(backRoll, roll), 0, { abs: 1e-9 });
        const reference = new Euler().setFromQuaternion(new Quaternion(...quaternion), 'YXZ');
        assertClose(angleGap(backAzimuth, reference.y / DEG), 0, { abs: 1e-9 });
        assertClose(backElevation, -reference.x / DEG, { abs: 1e-9 });
        assertClose(angleGap(backRoll, reference.z / DEG), 0, { abs: 1e-9 });
    }
});

test('any camera quaternion maps to angles that rebuild it', () => {
    const next = random(11);
    for (let i = 0; i < 200; i += 1) {
        const raw = [next(), next(), next(), next()].map((value) => 2 * value - 1);
        const norm = Math.hypot(...raw);
        const unit = raw.map((value) => value / norm);
        const [x, y, z, w] = raw;
        const angles = cameraAnglesFromQuaternion({ x, y, z, w });
        assertSameRotation(quaternionFromCameraAngles(angles), unit);
        assertVector(cameraAnglesFromQuaternion(raw.map((value) => 3 * value)), angles, 1e-9);
        assert.ok(Math.abs(angles[0]) <= 180 && Math.abs(angles[2]) <= 180);
        assert.ok(Math.abs(angles[1]) <= 90);
    }
});

test('looking straight up or down puts the whole turn into azimuth', () => {
    const up = quaternionFromCameraAngles([30, 90, 20]);
    const upAngles = cameraAnglesFromQuaternion(up);
    assertVector(upAngles, [50, 90, 0], 1e-6);
    assertSameRotation(quaternionFromCameraAngles(upAngles), up);
    const down = quaternionFromCameraAngles([30, -90, 20]);
    const downAngles = cameraAnglesFromQuaternion(down);
    assertVector(downAngles, [10, -90, 0], 1e-6);
    assertSameRotation(quaternionFromCameraAngles(downAngles), down);
});

test('degenerate quaternions are rejected', () => {
    for (const quaternion of [
        [0, 0, 0, 0],
        [Number.NaN, 0, 0, 1],
        { x: Infinity, y: 0, z: 0, w: 1 },
    ]) {
        assert.throws(() => cameraAnglesFromQuaternion(quaternion), RangeError);
    }
});
