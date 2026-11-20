// Uniform nodes of the ray tracer, keyed by name; renderer.js updates each node's .value.

import { texture, uniform } from 'three/tsl';
import { cubeGradientUniform } from '../nodes/cube-gradient.js';

export function createRaytracerUniforms(values) {
    const uniforms = {};
    for (const [name, value] of Object.entries(values)) {
        if (name === 'sky_cube') uniforms[name] = cubeGradientUniform(value || undefined);
        else if (value && value.isTexture) uniforms[name] = texture(value);
        else uniforms[name] = uniform(value);
    }
    return uniforms;
}
