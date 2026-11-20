import { memo, useLayoutEffect, useState } from 'react';
import {
    Canvas,
    useFrame,
    useStore,
    type DefaultGLProps,
    type RootState,
} from '@react-three/fiber/legacy';
import { NoToneMapping, WebGLRenderer } from 'three';
import {
    baseDevicePixelRatio,
    onEngineCanvasResize,
    renderEngineFrame,
    startEngine,
    type EngineTextures,
} from '../engine/engine';

// The ray tracer is GLSL, so the canvas takes WebGLRenderer from the legacy entry. Every pass
// draws a full-screen quad, so a multisampled canvas would only cost memory. On the web, React
// Three Fiber passes the canvas element it renders.
function createRenderer({ canvas }: DefaultGLProps) {
    return new WebGLRenderer({
        canvas: canvas as HTMLCanvasElement,
        antialias: false,
        powerPreference: 'high-performance',
    });
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
    textures: EngineTextures;
    onReady: () => void;
}

// The canvas fills the window underneath the interface; its pixel ratio carries the render scale.
export const Viewport = memo(function Viewport({ textures, onReady }: ViewportProps) {
    const [dpr, setDpr] = useState(baseDevicePixelRatio);
    const start = (state: RootState) => {
        // React Three Fiber gives the renderer ACES tone mapping; the output pass tone-maps itself.
        state.renderer.toneMapping = NoToneMapping;
        startEngine(textures, {
            gl: state.renderer,
            size: () => state.get().size,
            setDpr,
            setCamera: (camera) => state.set({ camera }),
            restoreSize: () => {
                const { renderer, size, viewport } = state.get();
                renderer.setPixelRatio(viewport.dpr);
                renderer.setSize(size.width, size.height);
            },
        });
        onReady();
    };
    return (
        <div className="viewport">
            <Canvas gl={createRenderer} dpr={dpr} events={noEvents} onCreated={start}>
                <EngineFrame />
            </Canvas>
        </div>
    );
});
