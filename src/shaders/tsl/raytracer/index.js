// TSL ray tracer: builds the fragment node of the full-screen pass from the variant flags of
// Shader.variant() (src/app/core/shader.js) and the uniform nodes of uniforms.js. The node writes
// the mean pre-exposed linear Rec.709 radiance of SAMPLE_COUNT jittered rays per pixel to the
// RGBA16F scene target that the TAA, bloom and output passes read.

import {
    Fn,
    Loop,
    cos,
    float,
    fract,
    normalize,
    screenCoordinate,
    select,
    sin,
    sqrt,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { hash12 } from './math.js';
import { createGeodesics } from './geodesics.js';
import { createEmission } from './emission.js';
import { createAccretion } from './accretion.js';
import { createGrmhd } from './grmhd.js';
import { createJet } from './jet.js';
import { createPlanet } from './planet.js';
import { createTrace } from './trace.js';

export { createRaytracerUniforms } from './uniforms.js';
export { diskArcNormalisation } from './accretion.js';

// Largest value written to the half-float target (max 65504); NaN and negative values become 0
// so they cannot spread through the TAA history or the bloom chain.
const HDR_MAX = 6.0e4;

const FOV_ANGLE_DEG = 90.0;
const FOV_MULT = 1.0 / Math.tan(((Math.PI / 180) * FOV_ANGLE_DEG) / 2);

const finite = (x) => select(x.greaterThanEqual(0.0), x.min(HDR_MAX), float(0.0));

export function createRaytracerNode(F, U) {
    const geo = createGeodesics(F, U);
    const em = createEmission(F, U, geo);
    const acc = createAccretion(F, U, em);
    const grmhd = createGrmhd(F, U, acc);
    const jet = createJet(F, U, acc, grmhd);
    const planet = createPlanet(F, U, em, acc);
    const trace_ray = createTrace(F, U, { geo, em, acc, grmhd, jet, planet });
    const SAMPLE_COUNT = Math.max(1, Math.round(F.sample_count));

    // Low-discrepancy sub-pixel offset in [-0.5, 0.5]^2 for sample i.
    const sample_offset = (i, pixel) => {
        if (SAMPLE_COUNT <= 1) return vec2(0.0);
        const fi = float(i);
        const radius = sqrt(fi.add(0.5).div(SAMPLE_COUNT)).mul(0.5);
        const base_angle = fract(fi.mul(0.61803398875).add(hash12(pixel.mul(0.5)))).mul(
            2.0 * Math.PI,
        );
        return vec2(cos(base_angle), sin(base_angle)).mul(radius);
    };

    return Fn(() => {
        // Window coordinates with the origin at the bottom left, as the trace expects.
        const frag = vec2(screenCoordinate.x, U.resolution.y.sub(screenCoordinate.y)).toConst();
        const accumulated = vec3(0.0).toVar();
        const traceSample = (i) => {
            const p = frag
                .add(sample_offset(i, frag))
                .add(U.taa_jitter)
                .mul(2.0)
                .div(U.resolution)
                .sub(1.0)
                .toVar();
            p.y.mulAssign(U.resolution.y.div(U.resolution.x));
            const p_cam = p.add(U.cam_pan).toConst();
            const ray = normalize(
                U.cam_x.mul(p_cam.x).add(U.cam_y.mul(p_cam.y)).add(U.cam_z.mul(FOV_MULT)),
            );
            accumulated.addAssign(trace_ray(ray).rgb);
        };
        if (SAMPLE_COUNT === 1) traceSample(0);
        else Loop(SAMPLE_COUNT, ({ i }) => traceSample(i));
        const color = accumulated.div(SAMPLE_COUNT).toConst();
        return vec4(finite(color.x), finite(color.y), finite(color.z), 1.0);
    })();
}
