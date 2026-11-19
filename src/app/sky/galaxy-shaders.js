// GLSL of the galaxy sky (src/features/galaxy/model.js holds the reference implementation of
// every placement and motion function). Particles carry no vertex data: each instance draws its
// parameters from an integer hash of gl_InstanceID, so structural changes are uniform updates.
// The scene is rendered from the hole into the six faces of a cube map; sizes are in pixels of a
// face, whose 90 degree field of view gives a focal length of face / 2 pixels.

import {
    BACKGROUND_FLUX_CAP,
    BULGE_RADIUS,
    GALAXY_RADIUS,
    NEAR_DISTANCE,
    ROTATION_SOFTENING,
} from '../../features/galaxy/model.js';

const float = (value) => {
    const text = String(value);
    return /[.eE]/.test(text) ? text : `${text}.0`;
};

const COMMON = /* glsl */ `
const float TAU = 6.283185307179586;
const float GALAXY_RADIUS = ${float(GALAXY_RADIUS)};
const float SOFTENING = ${float(ROTATION_SOFTENING)};
const float NEAR_DISTANCE = ${float(NEAR_DISTANCE)};
// Sprites stay between these sizes and their brightness is rescaled to the light they carry, so
// sub-pixel stars do not flicker in and out of the texel grid and nearby ones stay points.
const float MIN_POINT = 2.0;
const float MAX_POINT = 4.0;
// Angular diameter (rad) above which a particle's light grows more slowly than its solid angle:
// each particle is a star cloud, and from inside the galaxy the nearest ones would otherwise
// outshine the rest of the sky.
const float SOFT_ANGLE = 0.012;

uniform float u_face;
uniform float u_arm_count;
uniform float u_tightness;
uniform float u_arm_width;
uniform float u_randomness;
uniform float u_thickness;
uniform float u_corotation;
uniform float u_phase;
uniform float u_phase_angle;
uniform float u_phase_cycles;
uniform float u_lifetime_angle;
uniform float u_density_wave;
uniform float u_envelope_norm;

// lowbias32 (C. Wellons 2018); identical to hashU32() in model.js.
uint hash_u32(uint x) {
    x ^= x >> 16u;
    x *= 0x7feb352du;
    x ^= x >> 15u;
    x *= 0x846ca68bu;
    x ^= x >> 16u;
    return x;
}

float hash_unit(uint index, uint stream, uint salt) {
    return float(hash_u32(index * 16u + stream + salt) >> 8u) * (1.0 / 16777216.0);
}

// Omega(r) / Omega_p for webgpu-galaxy's rotation law Omega ~ 1 / (1 + 0.1 r).
float relative_speed(float r) {
    return (1.0 + SOFTENING * u_corotation) / (1.0 + SOFTENING * abs(r));
}

float young_envelope(float age) {
    return smoothstep(0.0, 0.06, age) * (1.0 - age) * (1.0 - age) * u_envelope_norm;
}

// Angle of an arm particle at the current pattern phase and its age as a fraction of the
// lifetime. Density-wave particles are born on the rigidly rotating arm and drift at their own
// angular speed; winding particles keep their angular speed from t = 0.
vec2 arm_motion(float theta0, float r, float phase_offset) {
    float kappa = relative_speed(r);
    if (u_density_wave > 0.5) {
        float age = fract(u_phase_cycles + phase_offset);
        return vec2(theta0 - u_phase_angle + age * u_lifetime_angle * (1.0 - kappa), age);
    }
    return vec2(theta0 - kappa * u_phase, 0.0);
}

// Sprite size in pixels for an angular diameter in radians, and the brightness factor that gives
// the resized sprite the light of the particle: its solid angle, softened above SOFT_ANGLE.
vec2 sprite(float angle) {
    float size = angle * 0.5 * u_face;
    float point = clamp(size, MIN_POINT, MAX_POINT);
    float light = size * size / (1.0 + (angle * angle) / (SOFT_ANGLE * SOFT_ANGLE));
    return vec2(point, light / (point * point));
}
`;

const POINT_FRAGMENT = /* glsl */ `
in vec3 v_color;
out vec4 fragColor;

void main() {
    // webgpu-galaxy's soft round star.
    float d = length(gl_PointCoord * 2.0 - 1.0);
    float shape = (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - smoothstep(0.3, 1.0, d));
    if (shape <= 0.0) discard;
    fragColor = vec4(v_color * shape, 1.0);
}
`;

export const STAR_VERTEX = /* glsl */ `
${COMMON}
const float BULGE_RADIUS = ${float(BULGE_RADIUS)};
const float BULGE_FLATTENING = 0.6;

uniform uint u_arm_salt;
uniform uint u_bulge_salt;
uniform uint u_arm_stars;
uniform float u_star_size;
uniform float u_star_flux;
uniform vec3 u_young_color;
uniform vec3 u_old_color;
uniform vec3 u_bulge_color;

out vec3 v_color;

void main() {
    uint id = uint(gl_InstanceID);
    vec3 p;
    vec3 color;
    float flux = u_star_flux;
    if (id < u_arm_stars) {
        float radius = sqrt(hash_unit(id, 1u, u_arm_salt)) * GALAXY_RADIUS;
        float nr = radius / GALAXY_RADIUS;
        float arm = floor(hash_unit(id, 2u, u_arm_salt) * u_arm_count);
        float angle_offset = (hash_unit(id, 3u, u_arm_salt) - 0.5) * u_randomness;
        float radius_offset = (hash_unit(id, 4u, u_arm_salt) - 0.5) * u_arm_width;
        float theta0 = arm * TAU / u_arm_count + nr * u_tightness * TAU + angle_offset;
        float r = radius + radius_offset;
        float y = (hash_unit(id, 5u, u_arm_salt) - 0.5) * u_thickness * (1.2 - nr);
        float sparsity = min(0.5 * (abs(radius_offset) / (0.5 * u_arm_width + 0.01) +
            abs(angle_offset) / (0.5 * u_randomness + 0.01)), 1.0);
        vec2 motion = arm_motion(theta0, r, hash_unit(id, 6u, u_arm_salt));
        p = vec3(cos(motion.x) * r, y, sin(motion.x) * r);
        color = mix(u_young_color, u_old_color, max(sparsity, smoothstep(0.2, 1.0, motion.y)));
        if (u_density_wave > 0.5) flux *= young_envelope(motion.y);
    } else {
        // Flattened Plummer bulge truncated at four scale radii.
        uint j = id - u_arm_stars;
        float m = 0.02 + 0.94 * hash_unit(j, 1u, u_bulge_salt);
        float radius = min(BULGE_RADIUS / sqrt(pow(m, -2.0 / 3.0) - 1.0), 4.0 * BULGE_RADIUS);
        float cz = 2.0 * hash_unit(j, 2u, u_bulge_salt) - 1.0;
        float r = radius * sqrt(max(0.0, 1.0 - cz * cz));
        float theta = TAU * hash_unit(j, 3u, u_bulge_salt) - relative_speed(r) * u_phase;
        p = vec3(cos(theta) * r, radius * cz * BULGE_FLATTENING, sin(theta) * r);
        color = u_bulge_color;
    }

    vec4 world = modelMatrix * vec4(p, 1.0);
    float dist = length(world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
    vec2 s = sprite(u_star_size / max(dist, NEAR_DISTANCE));
    gl_PointSize = s.x;
    // Stars inside the near distance would be single sprites across the view, so they fade out.
    v_color = color * flux * s.y * smoothstep(0.0, NEAR_DISTANCE, dist);
}
`;

export const STAR_FRAGMENT = POINT_FRAGMENT;

export const CLOUD_VERTEX = /* glsl */ `
${COMMON}
uniform uint u_cloud_salt;
uniform float u_cloud_size;
uniform float u_cloud_flux;
uniform float u_nebulae;
uniform vec3 u_cloud_tint;
uniform vec3 u_nebula_color;

out vec2 v_uv;
out vec3 v_color;
out vec2 v_offset;

void main() {
    uint id = uint(gl_InstanceID);
    float radius = pow(hash_unit(id, 1u, u_cloud_salt), 0.7) * GALAXY_RADIUS;
    float nr = radius / GALAXY_RADIUS;
    float arm = floor(hash_unit(id, 2u, u_cloud_salt) * u_arm_count);
    float theta0 = arm * TAU / u_arm_count + nr * u_tightness * TAU +
        (hash_unit(id, 3u, u_cloud_salt) - 0.5) * u_randomness;
    float r = radius + (hash_unit(id, 4u, u_cloud_salt) - 0.5) * u_arm_width;
    float y = (hash_unit(id, 5u, u_cloud_salt) - 0.5) * u_thickness * (1.15 - nr);
    vec2 motion = arm_motion(theta0, r, hash_unit(id, 6u, u_cloud_salt));
    float envelope = u_density_wave > 0.5 ? young_envelope(motion.y) : 1.0;
    bool nebula = hash_unit(id, 8u, u_cloud_salt) < u_nebulae;
    float size = (hash_unit(id, 7u, u_cloud_salt) * 0.5 + 0.7) * (1.0 - 0.5 * nr) * u_cloud_size *
        (nebula ? 0.45 : 1.0);
    float rotation = TAU * hash_unit(id, 9u, u_cloud_salt);

    // Billboard facing the cube origin, so a cloud is oriented alike in every face.
    vec3 centre = (modelMatrix * vec4(cos(motion.x) * r, y, sin(motion.x) * r, 1.0)).xyz;
    float dist = length(centre);
    vec3 n = centre / max(dist, 1e-6);
    vec3 helper = abs(n.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 bu = normalize(cross(helper, n));
    vec3 bv = cross(n, bu);
    vec2 q = position.xy;
    vec2 qr = vec2(cos(rotation) * q.x - sin(rotation) * q.y, sin(rotation) * q.x + cos(rotation) * q.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(centre + (bu * qr.x + bv * qr.y) * size, 1.0);

    // Clouds within a few of their own sizes would sweep across the view, so they fade out, and
    // invisible ones are moved outside the clip volume instead of being filled.
    float near_fade = smoothstep(1.5, 4.0, dist / size);
    if (near_fade * envelope <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vec3 color = nebula ? u_nebula_color * 3.0 : u_cloud_tint * (1.0 - 0.3 * nr);
    v_color = color * u_cloud_flux * envelope * near_fade;
    v_uv = uv;
    v_offset = vec2(hash_unit(id, 10u, u_cloud_salt), hash_unit(id, 11u, u_cloud_salt));
}
`;

export const CLOUD_FRAGMENT = /* glsl */ `
uniform sampler2D u_cloud_noise;
in vec2 v_uv;
in vec3 v_color;
in vec2 v_offset;
out vec4 fragColor;

void main() {
    // Soft wisp in place of webgpu-galaxy's cloud.png: a radial falloff cut by tileable fractal
    // noise (GalaxySky's cloud noise texture) at an offset that differs per cloud.
    vec2 q = v_uv * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 >= 1.0) discard;
    float falloff = (1.0 - r2) * (1.0 - r2);
    float wisps = smoothstep(0.27, 0.9, texture(u_cloud_noise, q * 0.225 + v_offset).r);
    fragColor = vec4(v_color * (falloff * wisps * 2.0), 1.0);
}
`;

export const BACKGROUND_VERTEX = /* glsl */ `
${COMMON}
const float BACKGROUND_FLUX_CAP = ${float(BACKGROUND_FLUX_CAP)};
// Angular diameter of a background star sprite (rad).
const float STAR_ANGLE = 0.004;

uniform uint u_sky_salt;
uniform float u_sky_count_scale;
uniform float u_sky_flux;
uniform sampler2D u_palette;

out vec3 v_color;

void main() {
    uint id = uint(gl_InstanceID);
    float z = 2.0 * hash_unit(id, 1u, u_sky_salt) - 1.0;
    float phi = TAU * hash_unit(id, 2u, u_sky_salt);
    float s = sqrt(max(0.0, 1.0 - z * z));
    vec3 dir = vec3(s * cos(phi), s * sin(phi), z);
    float flux = min(u_sky_count_scale * pow(max(hash_unit(id, 3u, u_sky_salt), 1e-7), -2.0 / 3.0),
        BACKGROUND_FLUX_CAP);
    // The palette spans log T from 2600 K to 25 000 K; x^1.8 favours the cooler, commoner stars.
    vec3 color = textureLod(u_palette, vec2(pow(hash_unit(id, 4u, u_sky_salt), 1.8), 0.5), 0.0).rgb;
    gl_Position = projectionMatrix * viewMatrix * vec4(dir * 1000.0, 1.0);
    vec2 sp = sprite(STAR_ANGLE);
    gl_PointSize = sp.x;
    v_color = color * flux * u_sky_flux * sp.y;
}
`;

export const BACKGROUND_FRAGMENT = POINT_FRAGMENT;

// Equirectangular thumbnail of the cube for GalaxySky.probe().
export const PROBE_VERTEX = /* glsl */ `
out vec2 v_uv;
void main() {
    v_uv = uv;
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`;

export const PROBE_FRAGMENT = /* glsl */ `
uniform samplerCube u_cube;
uniform float u_lod;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    float lon = (v_uv.x * 2.0 - 1.0) * 3.141592653589793;
    float lat = (v_uv.y - 0.5) * 3.141592653589793;
    vec3 dir = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
    fragColor = vec4(textureLod(u_cube, dir, u_lod).rgb, 1.0);
}
`;
