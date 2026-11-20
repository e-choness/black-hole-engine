import { memo, useLayoutEffect, useState } from 'react';
import {
    Canvas,
    useFrame,
    useStore,
    type DefaultRendererProps,
    type WebGPURootState,
} from '@react-three/fiber';
import { LinearSRGBColorSpace, NoToneMapping } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { preferredBackend } from '../../app/core/renderer/backend.js';
import {
    baseDevicePixelRatio,
    onEngineCanvasResize,
    renderEngineFrame,
    startEngine,
} from '../engine/engine';

// The ray tracer draws with WebGPURenderer, on WebGPU or on its WebGL 2 backend (backend.js).
// Every pass draws a full-screen quad, so a multisampled canvas would only cost memory. React
// Three Fiber passes the canvas element it renders and awaits the renderer's initialisation.
function newRenderer(canvas: HTMLCanvasElement) {
    return new WebGPURenderer({
        canvas,
        antialias: false,
        powerPreference: 'high-performance',
        forceWebGL: preferredBackend() === 'webgl',
    });
}

// React Three Fiber gives a new renderer ACES tone mapping and sRGB output; the output pass
// tone-maps and encodes itself, so the renderer draws it straight to the canvas.
function configureOutput(renderer: WebGPURenderer) {
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;
}

function createRenderer({ canvas }: DefaultRendererProps) {
    return newRenderer(canvas as HTMLCanvasElement);
}

// A renderer whose GPU device or WebGL context was lost never draws again. Its replacement takes
// the same canvas and size, and becomes the root's renderer, which React Three Fiber resizes and
// disposes; the engine has already disposed the lost one.
async function replaceRenderer(state: WebGPURootState) {
    const { renderer: lost, size, viewport } = state.get();
    const next = newRenderer(lost.domElement);
    configureOutput(next);
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
    const start = (state: WebGPURootState) => {
        configureOutput(state.renderer);
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
            replaceRenderer: () => replaceRenderer(state),
        });
        onReady();
    };
    return (
        <div className="viewport">
            <Canvas renderer={createRenderer} dpr={dpr} events={noEvents} onCreated={start}>
                <EngineFrame />
            </Canvas>
        </div>
    );
});
