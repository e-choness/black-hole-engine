// Ray-sphere intersection and shading of the orbiting reference planet: Lorentz contraction,
// light-travel-time retardation, Doppler temperature shift and relativistic beaming of the disk
// light it reflects. Its surface is either the reference stripes drawn here or the map in
// planet_map, whose albedo trace.js applies after the march so it can be filtered.

import {
    Fn,
    If,
    clamp,
    cos,
    dot,
    exp2,
    float,
    floor,
    fract,
    max,
    min,
    mix,
    mod,
    normalize,
    select,
    sin,
    sqrt,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { M_PI, contract, sphere_map, sq } from './math.js';

const PLANET_AMBIENT = 0.0;
const PLANET_LIGHTNESS = 1.5;
const PLANET_LIGHT_REF_DISTANCE = 14.0;
const PLANET_AXIAL_TILT = (30.0 * Math.PI) / 180.0;

// Orbit of the planet derived from its uniforms, as consts of the calling function.
export function planetConstants(U) {
    const radius = U.planet_radius;
    const distance = max(U.planet_distance, U.planet_radius.add(1.5)).toConst();
    const orbital_v = float(1.0).div(sqrt(distance.sub(1.0).mul(2.0)));
    const orbital_ang_vel = orbital_v
        .negate()
        .mul(sqrt(max(float(1.0).sub(float(1.0).div(distance)), 0.0)))
        .div(distance)
        .toConst();
    const max_rotation = max(orbital_ang_vel.mul(distance).add(1.0).div(radius), 0.0);
    const rotation_ang_vel = orbital_ang_vel.negate().add(max_rotation.mul(0.5)).toConst();
    const gamma = float(1.0)
        .div(sqrt(float(1.0).sub(sq(orbital_ang_vel.mul(distance)))))
        .toConst();
    return { radius, distance, orbital_ang_vel, rotation_ang_vel, gamma };
}

// Surface coordinates: p * ROT_Y(tilt), which swaps x and y and tilts the axis in the yz plane.
const planetCoords = (p) => {
    const c = Math.cos(PLANET_AXIAL_TILT);
    const s = Math.sin(PLANET_AXIAL_TILT);
    return vec3(p.y.mul(c).add(p.z.mul(s)), p.x, p.y.mul(s).sub(p.z.mul(c)));
};

// Eight meridian stripes, white and grey (sRGB 127), swapped between the hemispheres so that the
// spin and the poles are visible. Each edge is a linear ramp 1/512 of the map wide.
const planet_albedo = Fn(
    ([uv]) => {
        const EDGE = 1.0 / 512.0;
        const stripe = uv.x.mul(8.0).toConst();
        const edge_distance = min(fract(stripe), float(1.0).sub(fract(stripe))).div(8.0);
        const across_stripes = select(
            mod(floor(stripe), 2.0).lessThan(0.5),
            float(1.0),
            float(-1.0),
        ).mul(min(edge_distance.div(0.5 * EDGE), 1.0));
        const across_equator = clamp(
            float(0.5)
                .sub(uv.y)
                .div(0.5 * EDGE),
            -1.0,
            1.0,
        );
        return mix(vec3(1.0), vec3(0.212231), across_stripes.mul(across_equator).mul(0.5).add(0.5));
    },
    { uv: 'vec2', return: 'vec3' },
);

// The march step seen from the moving planet: its direction and the offset from the planet's
// centre, both contracted along the orbit, the planet's velocity, and the coefficients of the
// ray-sphere quadratic.
function planetStep(F, P, old_pos, ray_in, t, dt, planet_pos0) {
    const ray = ray_in.div(dt).toVar();
    const planet_dir = vec3(planet_pos0.y, planet_pos0.x.negate(), 0.0).div(P.distance).toConst();

    let planet_vel;
    if (F.light_travel_time) {
        const planet_ang1 = t.sub(dt).mul(P.orbital_ang_vel).toConst();
        const planet_pos1 = vec3(cos(planet_ang1), sin(planet_ang1), 0.0).mul(P.distance);
        planet_vel = planet_pos1.sub(planet_pos0).div(dt).toConst();
        // Into the moving planet's frame.
        ray.subAssign(planet_vel);
    } else {
        planet_vel = planet_dir.mul(P.orbital_ang_vel.mul(P.distance)).toConst();
    }

    const d = old_pos.sub(planet_pos0).toVar();
    if (F.lorentz_contraction) {
        ray.assign(contract(ray, planet_dir, P.gamma));
        d.assign(contract(d, planet_dir, P.gamma));
    }

    const dotp = dot(d, ray).toConst();
    const c_coeff = dot(d, d).sub(sq(P.radius));
    const ray2 = dot(ray, ray).toConst();
    const discr = dotp.mul(dotp).sub(ray2.mul(c_coeff)).toConst();
    return { ray, planet_dir, planet_vel, d, dotp, ray2, discr };
}

// Surface coordinate of a point on the unit sphere, turned by the planet's rotation at the time
// the light left it; isec_t is the hit's position as a fraction of the step.
function surfaceCoord(F, P, t, dt, isec_t, surface_point) {
    const rot_phase = float(t).toVar();
    if (F.light_travel_time) rot_phase.subAssign(isec_t.mul(dt));
    rot_phase.assign(rot_phase.mul(P.rotation_ang_vel).mul(0.5 / M_PI));
    const tex_coord = sphere_map(planetCoords(surface_point)).toVar();
    tex_coord.x.assign(mod(tex_coord.x.add(rot_phase), 1.0));
    return tex_coord;
}

export function createPlanet(F, U, em, acc) {
    const planet_intersection = Fn(
        ([old_pos, ray_in, t, dt, planet_pos0, ray_doppler_factor]) => {
            const P = planetConstants(U);
            const { ray, planet_dir, planet_vel, d, dotp, ray2, discr } = planetStep(
                F,
                P,
                old_pos,
                ray_in,
                t,
                dt,
                planet_pos0,
            );
            If(discr.lessThan(0.0), () => {
                return vec4(0.0);
            });
            const isec_t = dotp.negate().sub(sqrt(discr)).div(ray2).toVar();
            const min_isec_dt = F.lorentz_contraction ? dt.negate() : float(0.0);
            If(isec_t.lessThan(min_isec_dt).or(isec_t.greaterThan(dt)), () => {
                return vec4(0.0);
            });

            const surface_point = d.add(ray.mul(isec_t)).div(P.radius).toConst();
            isec_t.divAssign(dt);

            const light_dir = vec3(planet_pos0).toVar();
            if (F.light_travel_time) light_dir.addAssign(planet_vel.mul(isec_t).mul(dt));
            light_dir.assign(light_dir.div(P.distance));
            if (F.light_travel_time) light_dir.subAssign(planet_vel);
            if (F.lorentz_contraction) light_dir.assign(contract(light_dir, planet_dir, P.gamma));
            light_dir.assign(normalize(light_dir));

            const diffuse = max(0.0, dot(surface_point, light_dir.negate()));
            const distance_attenuation = clamp(
                sq(float(PLANET_LIGHT_REF_DISTANCE).div(max(P.distance, P.radius.add(1.0)))),
                0.05,
                4.0,
            );
            const lightness = diffuse
                .mul(1.0 - PLANET_AMBIENT)
                .add(PLANET_AMBIENT)
                .mul(PLANET_LIGHTNESS)
                .mul(distance_attenuation);

            // The reflected disk light keeps the colour temperature of the irradiation; the
            // planet's motion shifts it twice (incoming along light_dir, outgoing along the ray) on
            // top of the frame ratio from the caller.
            const light_temperature = acc.planet_irradiation_temperature().toConst();
            const planet_transfer = sq(P.gamma)
                .mul(dot(planet_vel, light_dir).add(1.0))
                .mul(float(1.0).sub(dot(planet_vel, normalize(ray))))
                .mul(ray_doppler_factor);
            const planet_g = float(1.0).div(max(planet_transfer, 0.05)).toConst();
            const light_color = em
                .blackbody(em.color_shift(planet_g).mul(light_temperature))
                .rgb.mul(em.thermal_brightness_ratio(light_temperature, planet_g));

            const albedo = F.planet_textured
                ? vec3(1.0)
                : planet_albedo(surfaceCoord(F, P, t, dt, isec_t, surface_point));
            const rgb = albedo.mul(lightness).mul(light_color).mul(exp2(U.log2_look_scale));
            return vec4(rgb, select(isec_t.lessThan(0.0), float(0.5), isec_t));
        },
        {
            old_pos: 'vec3',
            ray_in: 'vec3',
            t: 'float',
            dt: 'float',
            planet_pos0: 'vec3',
            ray_doppler_factor: 'float',
            return: 'vec4',
        },
    );

    // Map coordinate of the point where a step that hits the planet meets it. The map has east to
    // the right, against the longitude of sphere_map, so the prograde spin turns it eastwards.
    const planet_surface_coord = Fn(
        ([old_pos, ray_in, t, dt, planet_pos0]) => {
            const P = planetConstants(U);
            const { ray, d, dotp, ray2, discr } = planetStep(
                F,
                P,
                old_pos,
                ray_in,
                t,
                dt,
                planet_pos0,
            );
            const isec_t = dotp
                .negate()
                .sub(sqrt(max(discr, 0.0)))
                .div(ray2)
                .toConst();
            const surface_point = d.add(ray.mul(isec_t)).div(P.radius).toConst();
            const coord = surfaceCoord(F, P, t, dt, isec_t.div(dt), surface_point);
            return vec2(float(1.0).sub(coord.x), coord.y);
        },
        {
            old_pos: 'vec3',
            ray_in: 'vec3',
            t: 'float',
            dt: 'float',
            planet_pos0: 'vec3',
            return: 'vec2',
        },
    );

    return { planet_intersection, planet_surface_coord };
}
