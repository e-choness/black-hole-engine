import { memo, useLayoutEffect, useState } from 'react';
import {
    Canvas as NodeCanvas,
    type DefaultRendererProps,
    type WebGPURootState,
} from '@react-three/fiber';
import {
    Canvas,
    useFrame,
    useStore,
    type DefaultGLProps,
    type RootState,
} from '@react-three/fiber/legacy';
import { LinearSRGBColorSpace, NoToneMapping, WebGLRenderer } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { preferredBackend, useNodeRenderer } from '../../app/core/renderer/backend.js';
import {
    baseDevicePixelRatio,
    onEngineCanvasResize,
    renderEngineFrame,
    startEngine,
} from '../engine/engine';

// The GLSL ray tracer draws with WebGLRenderer from the legacy entry. Every pass draws a
// full-screen quad, so a multisampled canvas would only cost memory. On the web, React Three Fiber
// passes the canvas element it renders.
function createRenderer({ canvas }: DefaultGLProps) {
    return new WebGLRenderer({
        canvas: canvas as HTMLCanvasElement,
        antialias: false,
        powerPreference: 'high-performance',
    });
}

// The node (TSL) ray tracer draws with WebGPURenderer from the default entry, on WebGPU or on its
// WebGL 2 backend (backend.js); React Three Fiber awaits its initialisation.
function newNodeRenderer(canvas: HTMLCanvasElement) {
    return new WebGPURenderer({
        canvas,
        antialias: false,
        powerPreference: 'high-performance',
        forceWebGL: preferredBackend() === 'webgl',
    });
}

function createNodeRenderer({ canvas }: DefaultRendererProps) {
    return newNodeRenderer(canvas as HTMLCanvasElement);
}

// React Three Fiber gives the renderer ACES tone mapping and sRGB output; the output pass tone-maps
// and encodes itself, so WebGPURenderer draws it straight to the canvas.
function configureRenderer(renderer: WebGLRenderer | WebGPURenderer) {
    renderer.toneMapping = NoToneMapping;
    if (useNodeRenderer) renderer.outputColorSpace = LinearSRGBColorSpace;
}

// A renderer whose GPU device or WebGL context was lost never draws again. Its replacement takes
// the same canvas and size, and becomes the root's renderer, which React Three Fiber resizes and
// disposes; the engine has already disposed the lost one.
async function replaceNodeRenderer(state: WebGPURootState) {
    const { renderer: lost, size, viewport } = state.get();
    const next = newNodeRenderer(lost.domElement);
    configureRenderer(next);
    next.setPixelRatio(viewport.dpr);
    next.setSize(size.width, size.height, false);
    await next.init();
    const { internal } = state.get();
    internal.actualRenderer = next;
    internal.releaseRenderer = () => next.dispose();
    state.set({ renderer: next });
    return next;
}

// The engine reads pointer input on the canvas itself.
function noEvents() {
    return { enabled: false, priority: 0 };
}

// A job in the render phase replaces React Three Fiber's own render of the scene, so the engine
// draws every frame through its own passes. A resize clears the canvas, so the passes follow the
// new drawing buffer and the next frame is drawn.
function EngineFrame() {
    const store = useStore();
    useLayoutEffect(
        () =>
            store.subscribe((state, previous) => {
                if (
                    state.size.width !== previous.size.width ||
                    state.size.height !== previous.size.height ||
                    state.viewport.dpr !== previous.viewport.dpr
                ) {
                    onEngineCanvasResize();
                }
            }),
        [store],
    );
    useFrame(renderEngineFrame, { phase: 'render' });
    return null;
}

interface ViewportProps {
    onReady: () => void;
}

// The canvas fills the window underneath the interface; its pixel ratio carries the render scale.
export const Viewport = memo(function Viewport({ onReady }: ViewportProps) {
    const [dpr, setDpr] = useState(baseDevicePixelRatio);
    const start = (state: RootState | WebGPURootState) => {
        configureRenderer(state.renderer);
        startEngine({
            gl: state.renderer,
            size: () => state.get().size,
            setDpr,
            setCamera: (camera) => state.set({ camera }),
            restoreSize: () => {
                const { renderer, size, viewport } = state.get();
                renderer.setPixelRatio(viewport.dpr);
                renderer.setSize(size.width, size.height);
            },
            replaceRenderer: useNodeRenderer
                ? () => replaceNodeRenderer(state as WebGPURootState)
                : undefined,
        });
        onReady();
    };
    return (
        <div className="viewport">
            {useNodeRenderer ? (
                <NodeCanvas
                    renderer={createNodeRenderer}
                    dpr={dpr}
                    events={noEvents}
                    onCreated={start}
                >
                    <EngineFrame />
                </NodeCanvas>
            ) : (
                <Canvas gl={createRenderer} dpr={dpr} events={noEvents} onCreated={start}>
                    <EngineFrame />
                </Canvas>
            )}
        </div>
    );
});
