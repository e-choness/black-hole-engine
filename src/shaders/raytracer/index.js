import vertexShaderSource from './vertex.glsl?raw';

// Concatenation order of the fragment-shader template: later shards use the macros, uniforms
// and functions declared by earlier ones, so this list is the single source of truth.
const SHARD_ORDER = [
    'core/defines.glsl',
    'core/math.glsl',
    'physics/geodesics.glsl',
    'physics/emission.glsl',
    'physics/accretion/core.glsl',
    'physics/accretion/thick-torus.glsl',
    'physics/accretion/slim-disk.glsl',
    'physics/accretion/grmhd.glsl',
    'physics/accretion/planet-irradiation.glsl',
    'physics/jet/simple.glsl',
    'physics/jet/physical-core.glsl',
    'physics/jet/physical-grmhd.glsl',
    'output/tonemapping.glsl',
    'physics/planet.glsl',
    'output/trace/setup.glsl',
    'output/trace/accretion-thin.glsl',
    'output/trace/accretion-thick.glsl',
    'output/trace/accretion-slim.glsl',
    'output/trace/jet.glsl',
    'output/trace/finish.glsl',
    'output/main.glsl',
];

const shardSources = import.meta.glob(
    ['./core/*.glsl', './physics/**/*.glsl', './output/**/*.glsl'],
    {
        query: '?raw',
        import: 'default',
        eager: true,
    },
);

function assembleFragmentTemplate() {
    const unlisted = new Set(Object.keys(shardSources).map((key) => key.slice(2)));
    const parts = SHARD_ORDER.map((name) => {
        const source = shardSources[`./${name}`];
        if (source === undefined) throw new Error(`Missing GLSL shard: ${name}`);
        unlisted.delete(name);
        return source;
    });
    if (unlisted.size > 0) {
        throw new Error(`GLSL shards missing from SHARD_ORDER: ${[...unlisted].join(', ')}`);
    }
    return parts.join('\n');
}

// Mustache template of the ray-tracing fragment shader, rendered by Shader.compile().
export const RAYTRACER_FRAGMENT_TEMPLATE = assembleFragmentTemplate();

// Full-screen quad vertex shader shared by the ray-tracing pass.
export const RAYTRACER_VERTEX_SHADER = vertexShaderSource;
