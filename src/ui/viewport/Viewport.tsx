import { memo, useLayoutEffect, useState } from 'react';
import { Canvas, useFrame, useStore, type RootState } from '@react-three/fiber';
import { WebGLRenderer } from 'three';
import {
    baseDevicePixelRatio,
    onEngineCanvasResize,
    renderEngineFrame,
    startEngine,
    type EngineTextures,
} from '../engine/engine';

// Every pass draws a full-screen quad, so a multisampled canvas would only cost memory. On the web,
// React Three Fiber passes the canvas element it renders.
function createRenderer({ canvas }: { canvas: EventTarget }) {
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

// The engine draws every frame through its own passes; priority 1 keeps React Three Fiber from
// rendering the scene itself. A resize clears the canvas, so the passes follow the new drawing
// buffer and the next frame is drawn.
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
    useFrame(renderEngineFrame, 1);
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
        startEngine(textures, {
            gl: state.gl,
            size: () => state.get().size,
            setDpr,
            setCamera: (camera) => state.set({ camera }),
            restoreSize: () => {
                const { gl, size, viewport } = state.get();
                gl.setPixelRatio(viewport.dpr);
                gl.setSize(size.width, size.height);
            },
        });
        onReady();
    };
    return (
        <div className="viewport">
            <Canvas gl={createRenderer} flat dpr={dpr} events={noEvents} onCreated={start}>
                <EngineFrame />
            </Canvas>
        </div>
    );
});
