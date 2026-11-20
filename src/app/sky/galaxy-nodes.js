// Node-material (TSL) version of galaxy-shaders.js for three's WebGPURenderer. WebGPU has no point
// sprites, so every particle is an instanced quad that the vertex stage spreads in clip space to the
// sprite size in face pixels. As in the GLSL, each instance draws its parameters from an integer hash
// of its instance index.

import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    cubeTexture,
    dot,
    float,
    floor,
    fract,
    instanceIndex,
    length,
    max,
    min,
    mix,
    modelWorldMatrix,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    sqrt,
    uint,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import * as THREE from 'three';
import {
    BACKGROUND_FLUX_CAP,
    BULGE_RADIUS,
    GALAXY_RADIUS,
    NEAR_DISTANCE,
    ROTATION_SOFTENING,
} from '../../features/galaxy/model.js';

// galaxy-shaders.js documents these constants.
const TAU = 6.283185307179586;
const MIN_POINT = 2.0;
const MAX_POINT = 4.0;
const SOFT_ANGLE = 0.012;
const BULGE_FLATTENING = 0.6;
const STAR_ANGLE = 0.004;

// lowbias32 (C. Wellons 2018); identical to hashU32() in model.js.
function hashU32(x) {
    const h = x.toVar();
    h.assign(h.bitXor(h.shiftRight(uint(16))));
    h.assign(h.mul(uint(0x7feb352d)));
    h.assign(h.bitXor(h.shiftRight(uint(15))));
    h.assign(h.mul(uint(0x846ca68b)));
    h.assign(h.bitXor(h.shiftRight(uint(16))));
    return h;
}

function hashUnit(index, stream, salt) {
    const h = hashU32(index.mul(uint(16)).add(uint(stream)).add(salt));
    return float(h.shiftRight(uint(8))).mul(1.0 / 16777216.0);
}

function relativeSpeed(u, r) {
    return u.u_corotation
        .mul(ROTATION_SOFTENING)
        .add(1.0)
        .div(abs(r).mul(ROTATION_SOFTENING).add(1.0));
}

function youngEnvelope(u, age) {
    const fade = float(1.0).sub(age);
    return smoothstep(0.0, 0.06, age).mul(fade).mul(fade).mul(u.u_envelope_norm);
}

// (angle, age) of an arm particle at the current pattern phase.
function armMotion(u, theta0, r, phaseOffset) {
    const kappa = relativeSpeed(u, r).toConst();
    const age = fract(u.u_phase_cycles.add(phaseOffset)).toConst();
    const wave = vec2(
        theta0.sub(u.u_phase_angle).add(age.mul(u.u_lifetime_angle).mul(float(1.0).sub(kappa))),
        age,
    );
    const winding = vec2(theta0.sub(kappa.mul(u.u_phase)), 0.0);
    return select(u.u_density_wave.greaterThan(0.5), wave, winding).toConst();
}

// (sprite size in pixels, brightness factor) for an angular diameter in radians.
function sprite(u, angle) {
    const size = angle.mul(0.5).mul(u.u_face).toConst();
    const point = clamp(size, MIN_POINT, MAX_POINT).toConst();
    const light = size.mul(size).div(
        angle
            .mul(angle)
            .div(SOFT_ANGLE * SOFT_ANGLE)
            .add(1.0),
    );
    return vec2(point, light.div(point.mul(point))).toConst();
}

// Clip position of the quad corner for a sprite of `pointSize` face pixels centred on `world`.
function spriteClip(u, world, pointSize) {
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toConst();
    const offset = positionGeometry.xy.mul(pointSize.mul(2.0).div(u.u_face)).mul(clip.w);
    return vec4(clip.xy.add(offset), clip.zw);
}

// webgpu-galaxy's soft round star.
function pointFragment(color) {
    return Fn(() => {
        const d = length(uv().mul(2.0).sub(1.0)).toConst();
        const shape = float(1.0)
            .sub(smoothstep(0.0, 1.0, d))
            .mul(float(1.0).sub(smoothstep(0.3, 1.0, d)));
        return vec4(color.mul(max(shape, 0.0)), 1.0);
    })();
}

function additiveMaterial(vertexNode, fragmentNode) {
    const material = new MeshBasicNodeMaterial();
    material.vertexNode = vertexNode;
    material.fragmentNode = fragmentNode;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.depthTest = false;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    return material;
}

function starMaterial(u) {
    const color = varyingProperty('vec3', 'v_star_color');
    const vertex = Fn(() => {
        const id = instanceIndex;
        const p = vec3(0.0).toVar();
        const tint = vec3(0.0).toVar();
        const flux = float(u.u_star_flux).toVar();
        If(id.lessThan(u.u_arm_stars), () => {
            const salt = u.u_arm_salt;
            const radius = sqrt(hashUnit(id, 1, salt))
                .mul(GALAXY_RADIUS)
                .toConst();
            const nr = radius.div(GALAXY_RADIUS).toConst();
            const arm = floor(hashUnit(id, 2, salt).mul(u.u_arm_count));
            const angleOffset = hashUnit(id, 3, salt).sub(0.5).mul(u.u_randomness).toConst();
            const radiusOffset = hashUnit(id, 4, salt).sub(0.5).mul(u.u_arm_width).toConst();
            const theta0 = arm
                .mul(TAU)
                .div(u.u_arm_count)
                .add(nr.mul(u.u_tightness).mul(TAU))
                .add(angleOffset);
            const r = radius.add(radiusOffset).toConst();
            const y = hashUnit(id, 5, salt).sub(0.5).mul(u.u_thickness).mul(float(1.2).sub(nr));
            const sparsity = min(
                abs(radiusOffset)
                    .div(u.u_arm_width.mul(0.5).add(0.01))
                    .add(abs(angleOffset).div(u.u_randomness.mul(0.5).add(0.01)))
                    .mul(0.5),
                1.0,
            );
            const motion = armMotion(u, theta0, r, hashUnit(id, 6, salt));
            p.assign(vec3(cos(motion.x).mul(r), y, sin(motion.x).mul(r)));
            tint.assign(
                mix(u.u_young_color, u.u_old_color, max(sparsity, smoothstep(0.2, 1.0, motion.y))),
            );
            If(u.u_density_wave.greaterThan(0.5), () => {
                flux.mulAssign(youngEnvelope(u, motion.y));
            });
        }).Else(() => {
            // Flattened Plummer bulge truncated at four scale radii.
            const salt = u.u_bulge_salt;
            const j = id.sub(u.u_arm_stars).toConst();
            const m = hashUnit(j, 1, salt).mul(0.94).add(0.02);
            const radius = min(
                float(BULGE_RADIUS).div(sqrt(pow(m, -2.0 / 3.0).sub(1.0))),
                4.0 * BULGE_RADIUS,
            ).toConst();
            const cz = hashUnit(j, 2, salt).mul(2.0).sub(1.0).toConst();
            const r = radius.mul(sqrt(max(float(1.0).sub(cz.mul(cz)), 0.0))).toConst();
            const theta = hashUnit(j, 3, salt)
                .mul(TAU)
                .sub(relativeSpeed(u, r).mul(u.u_phase))
                .toConst();
            p.assign(
                vec3(cos(theta).mul(r), radius.mul(cz).mul(BULGE_FLATTENING), sin(theta).mul(r)),
            );
            tint.assign(u.u_bulge_color);
        });
        const world = modelWorldMatrix.mul(vec4(p, 1.0)).xyz.toConst();
        const dist = length(world).toConst();
        const s = sprite(u, u.u_star_size.div(max(dist, NEAR_DISTANCE)));
        // Stars inside the near distance would be single sprites across the view, so they fade out.
        color.assign(
            tint
                .mul(flux)
                .mul(s.y)
                .mul(smoothstep(0.0, NEAR_DISTANCE, dist)),
        );
        return spriteClip(u, world, s.x);
    })();
    return additiveMaterial(vertex, pointFragment(color));
}

function cloudMaterial(u) {
    const color = varyingProperty('vec3', 'v_cloud_color');
    const offset = varyingProperty('vec2', 'v_cloud_offset');
    const vertex = Fn(() => {
        const id = instanceIndex;
        const salt = u.u_cloud_salt;
        const radius = pow(hashUnit(id, 1, salt), 0.7)
            .mul(GALAXY_RADIUS)
            .toConst();
        const nr = radius.div(GALAXY_RADIUS).toConst();
        const arm = floor(hashUnit(id, 2, salt).mul(u.u_arm_count));
        const theta0 = arm
            .mul(TAU)
            .div(u.u_arm_count)
            .add(nr.mul(u.u_tightness).mul(TAU))
            .add(hashUnit(id, 3, salt).sub(0.5).mul(u.u_randomness));
        const r = radius.add(hashUnit(id, 4, salt).sub(0.5).mul(u.u_arm_width)).toConst();
        const y = hashUnit(id, 5, salt).sub(0.5).mul(u.u_thickness).mul(float(1.15).sub(nr));
        const motion = armMotion(u, theta0, r, hashUnit(id, 6, salt));
        const envelope = select(
            u.u_density_wave.greaterThan(0.5),
            youngEnvelope(u, motion.y),
            float(1.0),
        ).toConst();
        const nebula = hashUnit(id, 8, salt).lessThan(u.u_nebulae);
        const size = hashUnit(id, 7, salt)
            .mul(0.5)
            .add(0.7)
            .mul(float(1.0).sub(nr.mul(0.5)))
            .mul(u.u_cloud_size)
            .mul(select(nebula, float(0.45), float(1.0)))
            .toConst();
        const rotation = hashUnit(id, 9, salt).mul(TAU).toConst();

        // Billboard facing the cube origin, so a cloud is oriented alike in every face.
        const centre = modelWorldMatrix
            .mul(vec4(cos(motion.x).mul(r), y, sin(motion.x).mul(r), 1.0))
            .xyz.toConst();
        const dist = length(centre).toConst();
        const n = centre.div(max(dist, 1e-6)).toConst();
        const helper = select(abs(n.z).lessThan(0.99), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0));
        const bu = normalize(cross(helper, n)).toConst();
        const bv = cross(n, bu).toConst();
        const q = positionGeometry.xy.toConst();
        const c = cos(rotation).toConst();
        const s = sin(rotation).toConst();
        const qr = vec2(c.mul(q.x).sub(s.mul(q.y)), s.mul(q.x).add(c.mul(q.y))).toConst();
        const corner = centre.add(bu.mul(qr.x).add(bv.mul(qr.y)).mul(size));
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(corner, 1.0));

        // Clouds within a few of their own sizes would sweep across the view, so they fade out, and
        // invisible ones are moved outside the clip volume instead of being filled.
        const nearFade = smoothstep(1.5, 4.0, dist.div(size)).toConst();
        const tint = select(
            nebula,
            u.u_nebula_color.mul(3.0),
            u.u_cloud_tint.mul(float(1.0).sub(nr.mul(0.3))),
        );
        color.assign(tint.mul(u.u_cloud_flux).mul(envelope).mul(nearFade));
        offset.assign(vec2(hashUnit(id, 10, salt), hashUnit(id, 11, salt)));
        return select(nearFade.mul(envelope).lessThanEqual(0.0), vec4(2.0, 2.0, 2.0, 1.0), clip);
    })();
    // Soft wisp: a radial falloff cut by tileable fractal noise at an offset that differs per cloud.
    const fragment = Fn(() => {
        const q = uv().mul(2.0).sub(1.0).toConst();
        const r2 = dot(q, q).toConst();
        const falloff = float(1.0).sub(r2).mul(float(1.0).sub(r2));
        const wisps = smoothstep(0.27, 0.9, u.u_cloud_noise.sample(q.mul(0.225).add(offset)).r);
        const shape = select(r2.lessThan(1.0), falloff.mul(wisps).mul(2.0), float(0.0));
        return vec4(color.mul(shape), 1.0);
    })();
    return additiveMaterial(vertex, fragment);
}

function backgroundMaterial(u) {
    const color = varyingProperty('vec3', 'v_sky_color');
    const vertex = Fn(() => {
        const id = instanceIndex;
        const salt = u.u_sky_salt;
        const z = hashUnit(id, 1, salt).mul(2.0).sub(1.0).toConst();
        const phi = hashUnit(id, 2, salt).mul(TAU).toConst();
        const s = sqrt(max(float(1.0).sub(z.mul(z)), 0.0)).toConst();
        const dir = vec3(s.mul(cos(phi)), s.mul(sin(phi)), z);
        const flux = min(
            u.u_sky_count_scale.mul(pow(max(hashUnit(id, 3, salt), 1e-7), -2.0 / 3.0)),
            BACKGROUND_FLUX_CAP,
        );
        // The palette spans log T from 2600 K to 25 000 K; x^1.8 favours the cooler, commoner stars.
        const tint = u.u_palette.sample(vec2(pow(hashUnit(id, 4, salt), 1.8), 0.5)).level(0).rgb;
        const sp = sprite(u, float(STAR_ANGLE));
        color.assign(tint.mul(flux).mul(u.u_sky_flux).mul(sp.y));
        return spriteClip(u, dir.mul(1000.0), sp.x);
    })();
    return additiveMaterial(vertex, pointFragment(color));
}

// Materials of the three particle layers; `u` holds GalaxySky's uniform nodes.
export function createGalaxyNodeMaterials(u) {
    return {
        background: backgroundMaterial(u),
        clouds: cloudMaterial(u),
        stars: starMaterial(u),
    };
}

// Equirectangular thumbnail of the cube for GalaxySky.probe(): north at the top of the image.
export function createProbeNodeMaterial(cube, lod) {
    const material = new MeshBasicNodeMaterial();
    material.fragmentNode = Fn(() => {
        const p = uv();
        const lon = p.x.mul(2.0).sub(1.0).mul(Math.PI).toConst();
        const lat = float(0.5).sub(p.y).mul(Math.PI).toConst();
        const dir = vec3(cos(lat).mul(cos(lon)), cos(lat).mul(sin(lon)), sin(lat));
        return vec4(cubeTexture(cube, dir, float(lod)).rgb, 1.0);
    })();
    material.depthTest = false;
    material.depthWrite = false;
    return material;
}
