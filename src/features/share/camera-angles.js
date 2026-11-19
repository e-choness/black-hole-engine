// Camera orientation as azimuth, elevation and roll in degrees, for compact links. The renderer's
// camera sits on the unit sphere around the origin (OrbitControls with its target at the origin
// and world +Y up) and looks at it, so the orientation alone fixes the pose. The angles are the
// intrinsic rotation q = R_y(azimuth) R_x(-elevation) R_z(roll), the three.js Euler angles
// (x = -elevation, y = azimuth, z = roll) in 'YXZ' order:
//   position = (sin az cos el, sin el, cos az cos el), and the camera looks along -position;
//   roll turns the camera about its viewing axis, counterclockwise as seen from behind it.
// initializeCamera() (pitch 3 degrees, yaw 0) is azimuth 0, elevation -3, roll 0.
// Quaternions are [x, y, z, w] arrays; objects with x, y, z, w are accepted as input.

const DEG = Math.PI / 180;

function multiply([ax, ay, az, aw], [bx, by, bz, bw]) {
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}

// v' = q v q* for a unit quaternion q.
function rotate(q, [vx, vy, vz]) {
    const [x, y, z] = multiply(multiply(q, [vx, vy, vz, 0]), [-q[0], -q[1], -q[2], q[3]]);
    return [x, y, z];
}

function axisRotation(axis, degrees) {
    const half = (degrees * DEG) / 2;
    const q = [0, 0, 0, Math.cos(half)];
    q[axis] = Math.sin(half);
    return q;
}

export function quaternionFromCameraAngles([azimuth, elevation, roll]) {
    return multiply(
        multiply(axisRotation(1, azimuth), axisRotation(0, -elevation)),
        axisRotation(2, roll),
    );
}

// Everything the app needs to restore the camera: set camera.position, camera.up and
// camera.quaternion from these arrays, then call the controls' update().
export function cameraPoseFromAngles(angles) {
    const quaternion = quaternionFromCameraAngles(angles);
    return {
        quaternion,
        position: rotate(quaternion, [0, 0, 1]),
        up: rotate(quaternion, [0, 1, 0]),
    };
}

// Inverse of quaternionFromCameraAngles(), with the rotation-matrix extraction three.js uses for
// 'YXZ' Euler angles. Looking straight up or down, azimuth and roll describe the same turn, so
// roll is reported as 0 there.
export function cameraAnglesFromQuaternion(quaternion) {
    const raw = Array.isArray(quaternion)
        ? quaternion
        : [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
    const norm = Math.hypot(...raw);
    if (!(norm > 0) || !Number.isFinite(norm)) {
        throw new RangeError('camera quaternion must be finite and non-zero');
    }
    const [x, y, z, w] = raw.map((component) => component / norm);
    const m11 = 1 - 2 * (y * y + z * z);
    const m13 = 2 * (x * z + y * w);
    const m21 = 2 * (x * y + z * w);
    const m22 = 1 - 2 * (x * x + z * z);
    const m23 = 2 * (y * z - x * w);
    const m31 = 2 * (x * z - y * w);
    const m33 = 1 - 2 * (x * x + y * y);
    // m23 = sin(el) and hypot(m21, m22) = cos(el); atan2 keeps full precision near the poles,
    // where asin(m23) loses half the digits.
    const elevation = Math.atan2(m23, Math.hypot(m21, m22)) / DEG;
    if (Math.abs(m23) < 0.9999999) {
        return [Math.atan2(m13, m33) / DEG, elevation, Math.atan2(m21, m22) / DEG];
    }
    return [Math.atan2(-m31, m11) / DEG, elevation, 0];
}
