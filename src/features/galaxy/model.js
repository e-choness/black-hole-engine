// Procedural spiral galaxy used as the sky behind the hole. Star and dust-cloud placement follow
// galaxy.js of dgreenheck/webgpu-galaxy (spiral arms drawn per particle from a hash, a flat
// rotation curve, stars coloured by their distance from the arm ridge), but every particle is
// evaluated in closed form from its index and the galaxy phase instead of being integrated frame
// by frame. The GLSL in src/app/sky/galaxy-shaders.js mirrors the functions here, which the unit
// tests use as the reference.
//
// Lengths are in webgpu-galaxy units (a disk of radius 13), so its parameter values carry over.
// Only angles reach the image: the sky is rendered from the hole, which sits `distance` galaxy
// radii from the galaxy centre.

export const GALAXY_RADIUS = 13;

const TAU = 2 * Math.PI;
const DEG = Math.PI / 180;

// webgpu-galaxy's rotation law: dtheta/dt = -s / (1 + 0.1 r). The speed v = s r / (1 + 0.1 r)
// rises linearly in the core and flattens towards 10 s at large r, a flat rotation curve.
export const ROTATION_SOFTENING = 0.1;

export const SKY_MODES = ['galaxy', 'grid'];
export const ARM_MODELS = ['density_wave', 'winding'];
export const PALETTES = ['vivid', 'stellar'];

// Where the hole sits relative to the galaxy. `distance` is in galaxy radii from the centre,
// `inclination` the angle between the disk axis and the line of sight from the hole (0: face-on),
// `position_angle` the roll of the disk axis about that line, and longitude/latitude the direction
// of the galaxy centre in the hole frame (z on the spin axis; the default camera looks along +y).
// The outside view sets the galaxy a little above and right of the line of sight to the hole,
// whose lensing draws it into an arc beside the shadow at the default observer distance.
export const SKY_VIEWS = Object.freeze({
    outside: Object.freeze({
        distance: 4.5,
        inclination: 45,
        position_angle: 30,
        longitude: 80,
        latitude: 12,
    }),
    centre: Object.freeze({
        distance: 0,
        inclination: 70,
        position_angle: 20,
        longitude: 90,
        latitude: 0,
    }),
    disk: Object.freeze({
        distance: 0.62,
        inclination: 88,
        position_angle: 25,
        longitude: 75,
        latitude: 5,
    }),
});

// Writes the named view into a galaxy parameter object; false for an unknown name.
export function applySkyView(galaxy, view) {
    const fields = SKY_VIEWS[view];
    if (!fields) return false;
    Object.assign(galaxy, fields);
    galaxy.view = view;
    return true;
}

export const VIEW_FIELDS = Object.freeze([
    'distance',
    'inclination',
    'position_angle',
    'longitude',
    'latitude',
]);

export const GALAXY_DEFAULTS = Object.freeze({
    view: 'outside',
    ...SKY_VIEWS.outside,
    seed: 1,
    rotation_speed: 0.1,
    arms: 'density_wave',
    corotation: 0.6,
    lifetime: 0.12,
    arm_count: 2,
    spiral_tightness: 1.75,
    arm_width: 2.25,
    randomness: 1.8,
    thickness: 3,
    bulge: 0.15,
    star_size: 0.06,
    star_brightness: 0.3,
    palette: 'vivid',
    cloud_size: 3,
    cloud_opacity: 0.02,
    nebulae: 0.15,
    background_stars: 1,
});

// Ranges shared by the inspector, the share-link schema and clampGalaxyParams().
export const GALAXY_LIMITS = Object.freeze({
    distance: [0, 6],
    inclination: [0, 90],
    position_angle: [-180, 180],
    longitude: [-180, 180],
    latitude: [-90, 90],
    seed: [1, 9999],
    rotation_speed: [0, 1],
    corotation: [0.2, 1.2],
    lifetime: [0.02, 0.5],
    arm_count: [1, 6],
    spiral_tightness: [0, 6],
    arm_width: [0.5, 5],
    randomness: [0, 5],
    thickness: [0.1, 8],
    bulge: [0, 0.6],
    star_size: [0.02, 0.3],
    star_brightness: [0, 2],
    cloud_size: [0.5, 10],
    cloud_opacity: [0, 0.2],
    nebulae: [0, 0.6],
    background_stars: [0, 3],
});

// Particle budget and cube-face size per quality preset. webgpu-galaxy's demo draws 750 000
// stars and 5 000 clouds; per-particle brightness is scaled by the budget so every preset shows
// the same total light.
export const GALAXY_BUDGETS = Object.freeze({
    mobile: Object.freeze({ face: 384, stars: 60000, clouds: 800, background: 3000 }),
    optimal: Object.freeze({ face: 512, stars: 160000, clouds: 1500, background: 5000 }),
    medium: Object.freeze({ face: 768, stars: 250000, clouds: 2500, background: 7000 }),
    high: Object.freeze({ face: 1024, stars: 400000, clouds: 3500, background: 9000 }),
    ultra: Object.freeze({ face: 1536, stars: 750000, clouds: 5000, background: 12000 }),
    cinematic: Object.freeze({ face: 2048, stars: 1000000, clouds: 8000, background: 16000 }),
});

export const REFERENCE_BUDGET = Object.freeze({ stars: 750000, clouds: 5000, background: 9000 });

export function galaxyBudgetForQuality(quality) {
    return GALAXY_BUDGETS[quality] || null;
}

function clamp(value, [min, max]) {
    return Math.min(max, Math.max(min, value));
}

// Returns a complete, range-checked parameter set; unknown or invalid entries take the default.
export function clampGalaxyParams(params = {}) {
    const out = { ...GALAXY_DEFAULTS };
    for (const [key, range] of Object.entries(GALAXY_LIMITS)) {
        const value = Number(params[key]);
        if (Number.isFinite(value)) out[key] = clamp(value, range);
    }
    out.arm_count = Math.round(out.arm_count);
    out.seed = Math.round(out.seed);
    if (ARM_MODELS.includes(params.arms)) out.arms = params.arms;
    if (PALETTES.includes(params.palette)) out.palette = params.palette;
    if (params.view === 'custom' || Object.hasOwn(SKY_VIEWS, params.view)) out.view = params.view;
    return out;
}

// --- Hash ------------------------------------------------------------------------------------

// lowbias32 integer hash (C. Wellons, "Hash function prospector", 2018). Integer arithmetic is
// exact in GLSL ES 3.0 and in JS through Math.imul, so both sides draw identical particles.
export function hashU32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    x ^= x >>> 16;
    return x >>> 0;
}

// Salts separate the particle populations; each particle uses streams 0..15.
export const SALT = Object.freeze({
    arm: 0,
    bulge: 0x68e31da4,
    cloud: 0xb5297a4d,
    sky: 0x1b56c4e9,
});

export function seedSalt(seed, population) {
    return (Math.imul(seed >>> 0, 0x9e3779b9) + population) >>> 0;
}

// Uniform in [0, 1) with 24 bits, the precision of a float32 mantissa.
export function hashUnit(index, stream, salt) {
    const key = (Math.imul(index >>> 0, 16) + stream + salt) >>> 0;
    return (hashU32(key) >>> 8) / 16777216;
}

// --- Dynamics --------------------------------------------------------------------------------

export function corotationRadius(params) {
    return params.corotation * GALAXY_RADIUS;
}

// Angular speed relative to the pattern speed: kappa(r) = Omega(r) / Omega_p.
export function relativeAngularSpeed(r, corotation) {
    return (1 + ROTATION_SOFTENING * corotation) / (1 + ROTATION_SOFTENING * Math.abs(r));
}

// Pattern phase Phi = Omega_p t, the rotation of the spiral pattern since t = 0, with Omega_p
// the angular speed at the corotation radius. Every particle angle is a function of Phi.
export function galaxyPhase(time, params) {
    const omegaP = params.rotation_speed / (1 + ROTATION_SOFTENING * corotationRadius(params));
    return omegaP * time;
}

// Shader inputs derived from Phi in double precision: Phi itself (winding arms and the bulge),
// Phi mod 2 pi (the rigid rotation of the density-wave pattern) and the fraction of a young-star
// lifetime elapsed, so the density-wave terms stay exact in float32 at any time.
export function phaseUniforms(phase, params) {
    const lifetimeAngle = TAU * params.lifetime;
    return {
        phase,
        phaseAngle: positiveModulo(phase, TAU),
        phaseCycles: positiveModulo(phase / lifetimeAngle, 1),
        lifetimeAngle,
    };
}

function positiveModulo(value, period) {
    const r = value % period;
    return r < 0 ? r + period : r;
}

function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// Brightness of a young star over its life (age as a fraction of the lifetime): it ignites in
// the arm and fades as its massive members die.
export function youngStarEnvelope(age) {
    return smoothstep(0, 0.06, age) * (1 - age) * (1 - age);
}

// Mean of youngStarEnvelope over a lifetime (Simpson's rule), so the density-wave galaxy is as
// bright on average as the winding one.
export const ENVELOPE_MEAN = (() => {
    const n = 4096;
    let sum = youngStarEnvelope(0) + youngStarEnvelope(1);
    for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * youngStarEnvelope(i / n);
    return sum / (3 * n);
})();

// --- Particles (reference implementations of the GLSL) --------------------------------------

// Number of disk (arm) stars for a total star budget; the rest form the bulge.
export function armStarCount(total, bulge) {
    return Math.round(total * (1 - bulge));
}

// One disk star in galaxy coordinates (y on the disk axis). Arm placement is webgpu-galaxy's;
// with arms: 'density_wave' the star is born on the rigidly rotating arm and drifts with its own
// angular speed for one lifetime before the particle is reborn, so the pattern never winds up.
export function armStar(index, params, phases) {
    const salt = seedSalt(params.seed, SALT.arm);
    const u = (stream) => hashUnit(index, stream, salt);
    const radius = Math.sqrt(u(1)) * GALAXY_RADIUS;
    const nr = radius / GALAXY_RADIUS;
    const arm = Math.floor(u(2) * params.arm_count);
    const angleOffset = (u(3) - 0.5) * params.randomness;
    const radiusOffset = (u(4) - 0.5) * params.arm_width;
    const theta0 =
        (arm * TAU) / params.arm_count + nr * params.spiral_tightness * TAU + angleOffset;
    const r = radius + radiusOffset;
    const y = (u(5) - 0.5) * params.thickness * (1.2 - nr);
    const sparsity = Math.min(
        0.5 *
            (Math.abs(radiusOffset) / (0.5 * params.arm_width + 0.01) +
                Math.abs(angleOffset) / (0.5 * params.randomness + 0.01)),
        1,
    );
    const kappa = relativeAngularSpeed(r, corotationRadius(params));
    let theta;
    let age = 0;
    let envelope = 1;
    if (params.arms === 'density_wave') {
        age = positiveModulo(phases.phaseCycles + u(6), 1);
        theta = theta0 - phases.phaseAngle + age * phases.lifetimeAngle * (1 - kappa);
        envelope = youngStarEnvelope(age) / ENVELOPE_MEAN;
    } else {
        theta = theta0 - kappa * phases.phase;
    }
    return {
        position: [Math.cos(theta) * r, y, Math.sin(theta) * r],
        theta,
        r,
        sparsity,
        age,
        envelope,
        colorMix: Math.max(sparsity, smoothstep(0.2, 1, age)),
    };
}

// Bulge scale radius in galaxy units.
export const BULGE_RADIUS = 0.11 * GALAXY_RADIUS;
const BULGE_FLATTENING = 0.6;

// One bulge star: a flattened Plummer sphere truncated at four scale radii, rotating with the
// disk's rotation law.
export function bulgeStar(index, params, phases) {
    const salt = seedSalt(params.seed, SALT.bulge);
    const u = (stream) => hashUnit(index, stream, salt);
    const m = 0.02 + 0.94 * u(1);
    const radius = Math.min(BULGE_RADIUS / Math.sqrt(Math.pow(m, -2 / 3) - 1), 4 * BULGE_RADIUS);
    const cz = 2 * u(2) - 1;
    const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
    const r = radius * sz;
    const kappa = relativeAngularSpeed(r, corotationRadius(params));
    const theta = TAU * u(3) - kappa * phases.phase;
    return { position: [Math.cos(theta) * r, radius * cz * BULGE_FLATTENING, Math.sin(theta) * r] };
}

// One dust cloud: webgpu-galaxy's placement (radius ~ u^0.7 for a flatter spread, a slightly
// thinner layer, size shrinking outwards), with the young-star dynamics; a share of the clouds
// are compact H II regions.
export function cloud(index, params, phases) {
    const salt = seedSalt(params.seed, SALT.cloud);
    const u = (stream) => hashUnit(index, stream, salt);
    const radius = Math.pow(u(1), 0.7) * GALAXY_RADIUS;
    const nr = radius / GALAXY_RADIUS;
    const arm = Math.floor(u(2) * params.arm_count);
    const theta0 =
        (arm * TAU) / params.arm_count +
        nr * params.spiral_tightness * TAU +
        (u(3) - 0.5) * params.randomness;
    const r = radius + (u(4) - 0.5) * params.arm_width;
    const y = (u(5) - 0.5) * params.thickness * (1.15 - nr);
    const kappa = relativeAngularSpeed(r, corotationRadius(params));
    let theta;
    let envelope = 1;
    if (params.arms === 'density_wave') {
        const age = positiveModulo(phases.phaseCycles + u(6), 1);
        theta = theta0 - phases.phaseAngle + age * phases.lifetimeAngle * (1 - kappa);
        envelope = youngStarEnvelope(age) / ENVELOPE_MEAN;
    } else {
        theta = theta0 - kappa * phases.phase;
    }
    const nebula = u(8) < params.nebulae;
    const size = (u(7) * 0.5 + 0.7) * (1 - 0.5 * nr) * params.cloud_size * (nebula ? 0.45 : 1);
    return {
        position: [Math.cos(theta) * r, y, Math.sin(theta) * r],
        size,
        rotation: TAU * u(9),
        nebula,
        envelope,
        shade: 1 - 0.3 * nr,
    };
}

// Distant star field: directions uniform on the sphere and a Euclidean flux distribution
// N(>F) ~ F^-3/2, normalised so the bright end does not depend on the star count.
export const BACKGROUND_FLUX_CAP = 80;

export function backgroundStar(index, count, params) {
    const salt = seedSalt(params.seed, SALT.sky);
    const u = (stream) => hashUnit(index, stream, salt);
    const z = 2 * u(1) - 1;
    const phi = TAU * u(2);
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    const scale = Math.pow(count / REFERENCE_BUDGET.background, -2 / 3);
    const flux = Math.min(scale * Math.pow(Math.max(u(3), 1e-7), -2 / 3), BACKGROUND_FLUX_CAP);
    const temperature = Math.exp(
        Math.log(2600) + (Math.log(25000) - Math.log(2600)) * Math.pow(u(4), 1.8),
    );
    return { direction: [s * Math.cos(phi), s * Math.sin(phi), z], flux, temperature };
}

// --- Placement of the galaxy in the hole frame ----------------------------------------------

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
}

function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function normalize(a) {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
}

function rejectFrom(v, axis) {
    return sub(v, scale(axis, dot(v, axis)));
}

// Galaxy axes and centre in the hole frame: p_hole = centre + x p.x + y p.y + z p.z, where y is
// the disk axis. The centre lies at distance * R along `direction`; the disk axis makes the
// angle `inclination` with the line of sight -direction, tilted towards position_angle, measured
// from the projected spin axis towards the viewer's right.
export function galaxyFrame(params) {
    const lon = params.longitude * DEG;
    const lat = params.latitude * DEG;
    const inc = params.inclination * DEG;
    const pa = params.position_angle * DEG;
    const direction = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    let up = rejectFrom([0, 0, 1], direction);
    if (Math.hypot(...up) < 1e-6) up = rejectFrom([1, 0, 0], direction);
    up = normalize(up);
    const right = cross(direction, up);
    const tilt = add(scale(up, Math.cos(pa)), scale(right, Math.sin(pa)));
    const y = normalize(add(scale(direction, -Math.cos(inc)), scale(tilt, Math.sin(inc))));
    const a = rejectFrom(direction, y);
    const b = rejectFrom(tilt, y);
    const x = normalize(Math.hypot(...a) >= Math.hypot(...b) ? a : b);
    const z = cross(x, y);
    return { centre: scale(direction, params.distance * GALAXY_RADIUS), direction, x, y, z };
}

export function toHoleFrame(frame, p) {
    return add(
        frame.centre,
        add(add(scale(frame.x, p[0]), scale(frame.y, p[1])), scale(frame.z, p[2])),
    );
}

// Column-major 4x4 matrix of galaxyFrame(), for THREE.Matrix4.fromArray().
export function galaxyMatrix(frame) {
    const { x, y, z, centre } = frame;
    return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, ...centre, 1];
}

// Outer edge of the particle disk and its half thickness, in galaxy units.
export function galaxyExtent(params) {
    return {
        radius: GALAXY_RADIUS + 0.5 * params.arm_width,
        halfThickness: 0.6 * params.thickness + 4 * BULGE_RADIUS * BULGE_FLATTENING,
    };
}

// Bounding sphere of every particle except the distant star field.
export function galaxyBounds(params, frame) {
    const extent = galaxyExtent(params);
    return {
        centre: frame.centre,
        radius: Math.hypot(extent.radius, extent.halfThickness) + 0.5 * params.cloud_size,
    };
}

// Nearest distance at which galaxy particles are drawn: closer ones would be single sprites
// filling the view.
export const NEAR_DISTANCE = 0.35;

// Upper bound of the angular speed on the sky (rad per rad of pattern phase) of any galaxy
// particle seen from the hole: the fastest linear speed, r kappa(r) at the disk edge, over the
// nearest particle distance.
export function apparentPhaseRate(params, frame) {
    const extent = galaxyExtent(params);
    const rc = corotationRadius(params);
    const speed = extent.radius * relativeAngularSpeed(extent.radius, rc);
    const nearest = Math.hypot(...frame.centre) - Math.hypot(extent.radius, extent.halfThickness);
    return speed / Math.max(nearest, NEAR_DISTANCE);
}

// Pattern phase over which no particle moves more than `texels` cube texels (a texel at the
// face centre spans 2 / face rad).
export function phaseTolerance(params, frame, face, texels = 0.35) {
    return (texels * 2) / face / apparentPhaseRate(params, frame);
}

// Cube faces in three.js CubeCamera order (+x, -x, +y, -y, +z, -z), each the set of directions
// d with d . axis >= |d . u| and >= |d . v|. True when the sphere can contribute to the face.
const FACE_AXES = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
    [2, 0],
    [2, 1],
];

export function sphereTouchesFace(face, centre, radius) {
    const distance = Math.hypot(...centre);
    if (distance <= radius) return true;
    const [axis, negative] = FACE_AXES[face];
    const sign = negative ? -1 : 1;
    const a = sign * centre[axis];
    for (let k = 0; k < 3; k++) {
        if (k === axis) continue;
        // Planes d . axis = +-d . e_k through the origin, with inward normals (axis -+ e_k)/sqrt 2.
        if ((a - centre[k]) / Math.SQRT2 < -radius) return false;
        if ((a + centre[k]) / Math.SQRT2 < -radius) return false;
    }
    return true;
}

export function facesTouchedBySphere(centre, radius) {
    let mask = 0;
    for (let face = 0; face < 6; face++) {
        if (sphereTouchesFace(face, centre, radius)) mask |= 1 << face;
    }
    return mask;
}

// Everything except time that changes the rendered sky; a change re-renders every face.
export function skySignature(params, budget, mode) {
    return JSON.stringify([mode, budget, clampGalaxyParams(params)]);
}
