// 3-D value noise and its fractal sum, shared by the turbulent arcs of the thin disk and the nebula
// of the galaxy sky. The ray tracer reads the noise from a volume texture; the sky, drawn only when
// its cube is redrawn, hashes the lattice in the shader.

import * as THREE from 'three';
import { Fn, dot, float, floor, fract, mix, mod, vec3 } from 'three/tsl';

// Hash without sine (D. Hoskins, "Hash without Sine", 2014), exact enough in float32 for the
// lattice coordinates of the noise below.
export const hash13 = Fn(
    ([p]) => {
        const p3 = fract(p.mul(0.1031)).toVar();
        p3.addAssign(dot(p3, p3.zyx.add(31.32)));
        return fract(p3.x.add(p3.y).mul(p3.z));
    },
    { p: 'vec3', return: 'float' },
);

export const value_noise3 = Fn(
    ([p]) => {
        const i = floor(p).toConst();
        const f = fract(p).toConst();
        const u = f.mul(f).mul(f.mul(-2.0).add(3.0)).toConst();
        const corner = (x, y, z) => hash13(i.add(vec3(x, y, z)));
        return mix(
            mix(
                mix(corner(0, 0, 0), corner(1, 0, 0), u.x),
                mix(corner(0, 1, 0), corner(1, 1, 0), u.x),
                u.y,
            ),
            mix(
                mix(corner(0, 0, 1), corner(1, 0, 1), u.x),
                mix(corner(0, 1, 1), corner(1, 1, 1), u.x),
                u.y,
            ),
            u.z,
        );
    },
    { p: 'vec3', return: 'float' },
);

// Edge, in lattice cells, of the noise volume, after which the noise repeats.
export const NOISE_VOLUME_SIZE = 64;

// Uniform random values on the lattice points of one period, from xorshift32 with a fixed seed so
// every device draws the same noise.
export function createNoiseVolume() {
    const n = NOISE_VOLUME_SIZE;
    const data = new Uint8Array(n * n * n);
    let state = 0x2545f491;
    for (let i = 0; i < data.length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        data[i] = (state >>> 0) >>> 24;
    }
    const volume = new THREE.Data3DTexture(data, n, n, n);
    volume.format = THREE.RedFormat;
    volume.type = THREE.UnsignedByteType;
    volume.minFilter = THREE.LinearFilter;
    volume.magFilter = THREE.LinearFilter;
    volume.wrapS = volume.wrapT = volume.wrapR = THREE.RepeatWrapping;
    volume.generateMipmaps = false;
    volume.unpackAlignment = 1;
    volume.needsUpdate = true;
    return volume;
}

// value_noise3 on the lattice values of the noise volume (a texture3D node of
// createNoiseVolume()): the trilinear filter sampled at the cell corner plus the smoothstep
// weights is the same interpolant, from one fetch instead of eight hashes.
export function createVolumeNoise3(volume) {
    return Fn(
        ([p]) => {
            const i = mod(floor(p), NOISE_VOLUME_SIZE);
            const f = fract(p).toConst();
            const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
            return volume.sample(i.add(u).add(0.5).div(NOISE_VOLUME_SIZE)).level(0).r;
        },
        { p: 'vec3', return: 'float' },
    );
}

// Shader function of four octaves of a value noise (value_noise3 unless given) at the given
// lacunarity and persistence, normalised to [0, 1].
export function createFbm3(lacunarity, persistence, noise = value_noise3) {
    const norm = 0.5 * (1 + persistence + persistence ** 2 + persistence ** 3);
    return Fn(
        ([q]) => {
            const p = vec3(q).toVar();
            const sum = float(0.0).toVar();
            let amp = 0.5;
            for (let octave = 0; octave < 4; octave++) {
                sum.addAssign(noise(p).mul(amp));
                p.assign(p.mul(lacunarity).add(vec3(17.13, -11.7, 5.31)));
                amp *= persistence;
            }
            return sum.div(norm);
        },
        { q: 'vec3', return: 'float' },
    );
}
