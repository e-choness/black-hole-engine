import { useCallback, useState } from 'react';
import { App } from './App';
import type { EngineTextures } from './engine/engine';
import { initParams } from './params/params';
import { Viewport } from './viewport/Viewport';

// The viewport starts the engine once React Three Fiber has created the renderer. The interface
// mounts after it, so every control can read the engine directly.
export function Root({ textures }: { textures: EngineTextures }) {
    const [engineReady, setEngineReady] = useState(false);
    const onReady = useCallback(() => {
        initParams();
        setEngineReady(true);
    }, []);
    return (
        <>
            <Viewport textures={textures} onReady={onReady} />
            {engineReady && <App />}
        </>
    );
}
