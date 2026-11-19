// Renders the procedural galaxy (src/features/galaxy/model.js) into a cube map seen from the
// hole, which the ray tracer samples along the asymptotic direction of every escaping ray. Faces
// are re-rendered only when the sky changes: every face after a parameter, budget or context
// change, and while the galaxy turns only the faces its bounding sphere touches, once some
// particle would have moved by a third of a texel. `revision` counts the renders, so frame
// accumulation can tell when the sky behind a still view changed.

import * as THREE from 'three';
import { EMISSION_LUT } from '../core/physics/emission.js';
import { sampleBlackbodyLut } from '../core/physics/colorimetry.js';
import {
    ENVELOPE_MEAN,
    GALAXY_BUDGETS,
    REFERENCE_BUDGET,
    SALT,
    armStarCount,
    clampGalaxyParams,
    corotationRadius,
    facesTouchedBySphere,
    galaxyBounds,
    galaxyBudgetForQuality,
    galaxyFrame,
    galaxyMatrix,
    galaxyPhase,
    hashU32,
    phaseTolerance,
    phaseUniforms,
    seedSalt,
    skySignature,
} from '../../features/galaxy/model.js';
import {
    BACKGROUND_FRAGMENT,
    BACKGROUND_VERTEX,
    CLOUD_FRAGMENT,
    CLOUD_VERTEX,
    PROBE_FRAGMENT,
    PROBE_VERTEX,
    STAR_FRAGMENT,
    STAR_VERTEX,
} from './galaxy-shaders.js';

const ALL_FACES = 0b111111;
const NEAR = 0.01;
const FAR = 4000;
const DEFAULT_BUDGET = GALAXY_BUDGETS.high;

// webgpu-galaxy's colours (dense arm stars, sparse stars, cloud tint) plus a bulge and an H II
// region colour; 'stellar' uses blackbody colours of young OB stars, old K giants and the bulge.
const PALETTE_COLORS = {
    vivid: {
        young: '#1885ff',
        old: '#ffb28a',
        bulge: '#ffd9a8',
        cloud: '#ffdace',
        nebula: '#ff7aa8',
    },
    stellar: { young: 16000, old: 4300, bulge: 4800, cloud: 5600, nebula: '#ff7aa8' },
};

// Brightness of a background star of unit flux relative to webgpu-galaxy's star brightness.
const BACKGROUND_FLUX = 0.35;

const PALETTE_SIZE = 32;
const PALETTE_T_MIN = 2600;
const PALETTE_T_MAX = 25000;

function blackbodyColor(temperature) {
    const rgb = sampleBlackbodyLut(EMISSION_LUT, temperature).rgb;
    const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
    return new THREE.Color(rgb[0] / peak, rgb[1] / peak, rgb[2] / peak);
}

function paletteColor(value) {
    return typeof value === 'number' ? blackbodyColor(value) : new THREE.Color(value);
}

// Linear sRGB of blackbodies on a logarithmic temperature grid, each scaled to a peak of 1.
function createTemperaturePalette() {
    const data = new Uint16Array(PALETTE_SIZE * 4);
    for (let i = 0; i < PALETTE_SIZE; i++) {
        const t = PALETTE_T_MIN * Math.pow(PALETTE_T_MAX / PALETTE_T_MIN, i / (PALETTE_SIZE - 1));
        const color = blackbodyColor(t);
        data.set(
            [color.r, color.g, color.b, 1].map((v) => THREE.DataUtils.toHalfFloat(v)),
            i * 4,
        );
    }
    const texture = new THREE.DataTexture(
        data,
        PALETTE_SIZE,
        1,
        THREE.RGBAFormat,
        THREE.HalfFloatType,
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
}

const NOISE_SIZE = 128;
const NOISE_OCTAVES = [8, 16, 32, 64];

// Tileable fractal value noise for the cloud wisps: four octaves on periodic lattices of 8 to 64
// cells, normalised to [0, 1]. Generated once, so a cloud fragment costs one texture fetch.
function createCloudNoise() {
    const size = NOISE_SIZE;
    const field = new Float32Array(size * size);
    const ease = (t) => t * t * (3 - 2 * t);
    let amplitude = 0.5;
    let total = 0;
    NOISE_OCTAVES.forEach((cells, octave) => {
        const lattice = (i, j) =>
            hashU32(((j % cells) * cells + (i % cells)) * NOISE_OCTAVES.length + octave) /
            4294967296;
        for (let y = 0; y < size; y++) {
            const fy = (y / size) * cells;
            const j = Math.floor(fy);
            const ty = ease(fy - j);
            for (let x = 0; x < size; x++) {
                const fx = (x / size) * cells;
                const i = Math.floor(fx);
                const tx = ease(fx - i);
                const a = lattice(i, j);
                const b = lattice(i + 1, j);
                const c = lattice(i, j + 1);
                const d = lattice(i + 1, j + 1);
                field[y * size + x] +=
                    amplitude * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
            }
        }
        total += amplitude;
        amplitude *= 0.5;
    });
    const data = new Uint8Array(size * size);
    for (let k = 0; k < field.length; k++) data[k] = Math.round((255 * field[k]) / total);
    const texture = new THREE.DataTexture(
        data,
        size,
        size,
        THREE.RedFormat,
        THREE.UnsignedByteType,
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
}

// HDR cube storage: packed R11G11B10F (4 bytes per texel) where float colour buffers exist,
// else RGBA16F, else 8-bit.
function cubeTargetFormat(renderer) {
    if (renderer.extensions.has('EXT_color_buffer_float')) {
        return {
            name: 'R11F_G11F_B10F',
            type: THREE.UnsignedInt101111Type,
            format: THREE.RGBFormat,
        };
    }
    if (renderer.extensions.has('EXT_color_buffer_half_float')) {
        return { name: 'RGBA16F', type: THREE.HalfFloatType, format: THREE.RGBAFormat };
    }
    return { name: 'RGBA8', type: THREE.UnsignedByteType, format: THREE.RGBAFormat };
}

function instancedPoint() {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    geometry.instanceCount = 0;
    return geometry;
}

function instancedQuad() {
    const geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    geometry.instanceCount = 0;
    return geometry;
}

function additiveMaterial(uniforms, vertexShader, fragmentShader) {
    return new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms,
        vertexShader,
        fragmentShader,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
}

export class GalaxySky {
    constructor(renderer, { anisotropy = 1 } = {}) {
        this.renderer = renderer;
        this.anisotropy = anisotropy;
        this.format = cubeTargetFormat(renderer);
        this.budget = DEFAULT_BUDGET;
        this.target = null;
        this.signature = '';
        this.phase = NaN;
        this.tolerance = 0;
        this.galaxyFaces = ALL_FACES;
        this.revision = 0;
        this.renders = 0;
        this.palette = createTemperaturePalette();
        this.cloudNoise = createCloudNoise();

        const shared = {
            u_face: { value: 0 },
            u_arm_count: { value: 2 },
            u_tightness: { value: 0 },
            u_arm_width: { value: 1 },
            u_randomness: { value: 0 },
            u_thickness: { value: 1 },
            u_corotation: { value: 0 },
            u_phase: { value: 0 },
            u_phase_angle: { value: 0 },
            u_phase_cycles: { value: 0 },
            u_lifetime_angle: { value: 1 },
            u_density_wave: { value: 1 },
            u_envelope_norm: { value: 1 / ENVELOPE_MEAN },
        };
        this.uniforms = {
            ...shared,
            u_arm_salt: { value: 0 },
            u_bulge_salt: { value: 0 },
            u_cloud_salt: { value: 0 },
            u_sky_salt: { value: 0 },
            u_arm_stars: { value: 0 },
            u_star_size: { value: 0.06 },
            u_star_flux: { value: 0 },
            u_young_color: { value: new THREE.Color() },
            u_old_color: { value: new THREE.Color() },
            u_bulge_color: { value: new THREE.Color() },
            u_cloud_size: { value: 1 },
            u_cloud_flux: { value: 0 },
            u_nebulae: { value: 0 },
            u_cloud_tint: { value: new THREE.Color() },
            u_nebula_color: { value: new THREE.Color() },
            u_sky_count_scale: { value: 1 },
            u_sky_flux: { value: 0 },
            u_palette: { value: this.palette },
            u_cloud_noise: { value: this.cloudNoise },
        };

        this.scene = new THREE.Scene();
        this.background = new THREE.Points(
            instancedPoint(),
            additiveMaterial(this.uniforms, BACKGROUND_VERTEX, BACKGROUND_FRAGMENT),
        );
        this.clouds = new THREE.Mesh(
            instancedQuad(),
            additiveMaterial(this.uniforms, CLOUD_VERTEX, CLOUD_FRAGMENT),
        );
        this.stars = new THREE.Points(
            instancedPoint(),
            additiveMaterial(this.uniforms, STAR_VERTEX, STAR_FRAGMENT),
        );
        // The galaxy's placement in the hole frame is the model matrix of its particles.
        for (const object of [this.background, this.clouds, this.stars]) {
            object.frustumCulled = false;
            object.matrixAutoUpdate = false;
            this.scene.add(object);
        }

        this.cubeCamera = new THREE.CubeCamera(NEAR, FAR, this.ensureTarget(this.budget.face));
        this.syncCameras();

        this.onContextRestored = () => {
            this.signature = '';
        };
        renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    }

    get texture() {
        return this.target.texture;
    }

    syncCameras() {
        if (this.cubeCamera.coordinateSystem !== this.renderer.coordinateSystem) {
            this.cubeCamera.coordinateSystem = this.renderer.coordinateSystem;
            this.cubeCamera.updateCoordinateSystem();
        }
        this.cubeCamera.updateMatrixWorld(true);
    }

    ensureTarget(face) {
        if (this.target && this.target.width === face) return this.target;
        const previous = this.target;
        this.target = new THREE.WebGLCubeRenderTarget(face, {
            type: this.format.type,
            format: this.format.format,
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            anisotropy: this.anisotropy,
        });
        if (this.cubeCamera) this.cubeCamera.renderTarget = this.target;
        if (previous) previous.dispose();
        this.signature = '';
        return this.target;
    }

    setAnisotropy(value) {
        this.anisotropy = Math.max(1, value);
        if (this.target && this.target.texture.anisotropy !== this.anisotropy) {
            this.target.texture.anisotropy = this.anisotropy;
            this.target.texture.needsUpdate = true;
        }
    }

    applyParams(params, budget) {
        const u = this.uniforms;
        const frame = galaxyFrame(params);
        const matrix = new THREE.Matrix4().fromArray(galaxyMatrix(frame));
        for (const object of [this.stars, this.clouds]) {
            object.matrix.copy(matrix);
            object.matrixWorldNeedsUpdate = true;
        }

        const bounds = galaxyBounds(params, frame);
        this.galaxyFaces = facesTouchedBySphere(bounds.centre, bounds.radius);
        this.tolerance = phaseTolerance(params, frame, budget.face);

        const armStars = armStarCount(budget.stars, params.bulge);
        this.stars.geometry.instanceCount = budget.stars;
        this.clouds.geometry.instanceCount = budget.clouds;
        this.background.geometry.instanceCount = budget.background;

        u.u_face.value = budget.face;
        u.u_arm_count.value = params.arm_count;
        u.u_tightness.value = params.spiral_tightness;
        u.u_arm_width.value = params.arm_width;
        u.u_randomness.value = params.randomness;
        u.u_thickness.value = params.thickness;
        u.u_corotation.value = corotationRadius(params);
        u.u_density_wave.value = params.arms === 'density_wave' ? 1 : 0;
        u.u_arm_salt.value = seedSalt(params.seed, SALT.arm);
        u.u_bulge_salt.value = seedSalt(params.seed, SALT.bulge);
        u.u_cloud_salt.value = seedSalt(params.seed, SALT.cloud);
        u.u_sky_salt.value = seedSalt(params.seed, SALT.sky);
        u.u_arm_stars.value = armStars;
        u.u_star_size.value = params.star_size;
        u.u_star_flux.value = params.star_brightness * (REFERENCE_BUDGET.stars / budget.stars);
        u.u_cloud_size.value = params.cloud_size;
        u.u_cloud_flux.value = params.cloud_opacity * (REFERENCE_BUDGET.clouds / budget.clouds);
        u.u_nebulae.value = params.nebulae;
        u.u_sky_count_scale.value = Math.pow(
            budget.background / REFERENCE_BUDGET.background,
            -2 / 3,
        );
        u.u_sky_flux.value = params.background_stars * BACKGROUND_FLUX;

        const colors = PALETTE_COLORS[params.palette] || PALETTE_COLORS.vivid;
        u.u_young_color.value.copy(paletteColor(colors.young));
        u.u_old_color.value.copy(paletteColor(colors.old));
        u.u_bulge_color.value.copy(paletteColor(colors.bulge));
        u.u_cloud_tint.value.copy(paletteColor(colors.cloud));
        u.u_nebula_color.value.copy(paletteColor(colors.nebula));
    }

    setPhase(phase, params) {
        const phases = phaseUniforms(phase, params);
        this.uniforms.u_phase.value = phases.phase;
        this.uniforms.u_phase_angle.value = phases.phaseAngle;
        this.uniforms.u_phase_cycles.value = phases.phaseCycles;
        this.uniforms.u_lifetime_angle.value = phases.lifetimeAngle;
    }

    // Brings the cube up to date for the galaxy parameters, the quality preset (null keeps the
    // current budget) and the simulation time. Returns true when faces were rendered.
    update({ params, quality, time }) {
        const budget = galaxyBudgetForQuality(quality) || this.budget;
        this.budget = budget;
        this.ensureTarget(budget.face);
        const p = clampGalaxyParams(params);
        const signature = skySignature(p, budget, 'galaxy');
        let faces = 0;
        if (signature !== this.signature) {
            this.signature = signature;
            this.applyParams(p, budget);
            faces = ALL_FACES;
        }
        const phase = galaxyPhase(time, p);
        if (!faces && Math.abs(phase - this.phase) <= this.tolerance) return false;
        if (!faces) faces = this.galaxyFaces;
        this.setPhase(phase, p);
        this.phase = phase;
        if (faces) this.renderFaces(faces);
        this.revision += 1;
        return true;
    }

    renderFaces(mask) {
        const renderer = this.renderer;
        this.syncCameras();
        const previousTarget = renderer.getRenderTarget();
        const previousFace = renderer.getActiveCubeFace();
        const previousLevel = renderer.getActiveMipmapLevel();
        const previousAutoClear = renderer.autoClear;
        const previousClearColor = renderer.getClearColor(new THREE.Color());
        const previousClearAlpha = renderer.getClearAlpha();
        renderer.autoClear = true;
        renderer.setClearColor(0x000000, 1);

        const texture = this.target.texture;
        const autoMipmaps = texture.mipmapsAutoUpdate;
        const last = 31 - Math.clz32(mask);
        const cameras = this.cubeCamera.children;
        for (let face = 0; face < 6; face++) {
            if (!(mask & (1 << face))) continue;
            // Mipmaps are generated once, after the last face of this update.
            texture.mipmapsAutoUpdate = face === last ? autoMipmaps : false;
            renderer.setRenderTarget(this.target, face);
            renderer.render(this.scene, cameras[face]);
        }
        texture.mipmapsAutoUpdate = autoMipmaps;

        renderer.setRenderTarget(previousTarget, previousFace, previousLevel);
        renderer.autoClear = previousAutoClear;
        renderer.setClearColor(previousClearColor, previousClearAlpha);
        this.renders += 1;
    }

    status() {
        return {
            revision: this.revision,
            renders: this.renders,
            face: this.budget.face,
            stars: this.stars.geometry.instanceCount,
            clouds: this.clouds.geometry.instanceCount,
            background: this.background.geometry.instanceCount,
            format: this.format.name,
            galaxyFaces: this.galaxyFaces,
        };
    }

    // Reads back an equirectangular thumbnail of the cube (longitude across, latitude up, in the
    // hole frame) for tests and diagnostics: linear RGB rows from the south pole up.
    probe(width = 64, height = 32) {
        const renderer = this.renderer;
        const float = renderer.extensions.has('EXT_color_buffer_float');
        const target = new THREE.WebGLRenderTarget(width, height, {
            type: float ? THREE.FloatType : THREE.HalfFloatType,
            depthBuffer: false,
        });
        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                u_cube: { value: this.target.texture },
                // Mip level whose texels match a probe pixel, so stars are averaged, not point-sampled.
                u_lod: { value: Math.max(0, Math.log2((Math.PI * this.budget.face) / width)) },
            },
            vertexShader: PROBE_VERTEX,
            fragmentShader: PROBE_FRAGMENT,
            depthTest: false,
            depthWrite: false,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        quad.frustumCulled = false;
        const scene = new THREE.Scene();
        scene.add(quad);
        const previousTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(target);
        renderer.render(scene, new THREE.Camera());
        const raw = float
            ? new Float32Array(width * height * 4)
            : new Uint16Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, raw);
        renderer.setRenderTarget(previousTarget);
        target.dispose();
        material.dispose();
        quad.geometry.dispose();
        const rgb = new Float32Array(width * height * 3);
        for (let i = 0; i < width * height; i++) {
            for (let c = 0; c < 3; c++) {
                const v = raw[i * 4 + c];
                rgb[i * 3 + c] = float ? v : THREE.DataUtils.fromHalfFloat(v);
            }
        }
        return { width, height, rgb };
    }

    dispose() {
        this.renderer.domElement.removeEventListener(
            'webglcontextrestored',
            this.onContextRestored,
        );
        for (const object of [this.background, this.clouds, this.stars]) {
            object.geometry.dispose();
            object.material.dispose();
        }
        this.palette.dispose();
        this.cloudNoise.dispose();
        this.target.dispose();
    }
}
