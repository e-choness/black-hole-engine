// Cube-map lookup with explicit screen-space gradients. three r187 builds the gradients of
// texture(...).grad() as vec2, which a cube map rejects, so this node builds them as vec3 and
// mirrors their x like the lookup direction.

import { CubeTexture, CubeTextureNode } from 'three/webgpu';
import { nodeObject } from 'three/tsl';

class CubeGradientTextureNode extends CubeTextureNode {
    static get type() {
        return 'CubeGradientTextureNode';
    }

    constructor(value, uvNode = null, gradient = null) {
        super(value, uvNode);
        this.cubeGradient = gradient;
    }

    generateSnippet(builder, textureProperty, uvSnippet, levelSnippet, biasSnippet, depthSnippet) {
        if (!this.cubeGradient) return super.generateSnippet(...arguments);
        const gradient = this.cubeGradient.map((node) =>
            this.setupUV(builder, node).build(builder, 'vec3'),
        );
        return builder.generateTextureGrad(
            this.value,
            textureProperty,
            uvSnippet,
            gradient,
            depthSnippet,
            null,
        );
    }
}

// The cube-map uniform the ray tracer samples; its value is the texture to bind.
export function cubeGradientUniform(value = new CubeTexture()) {
    return nodeObject(new CubeGradientTextureNode(value));
}

// Sample of `base` (a cubeGradientUniform) along `dir` with the gradients dx and dy.
export function sampleCubeGradient(base, dir, dx, dy) {
    const node = new CubeGradientTextureNode(base.value, nodeObject(dir), [
        nodeObject(dx),
        nodeObject(dy),
    ]);
    node.referenceNode = base;
    return nodeObject(node);
}
