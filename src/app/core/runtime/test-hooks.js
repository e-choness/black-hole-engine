import { QUALITY_PRESETS } from '../../ui/quality-presets.js';
import { hdrTarget, renderer, rendererContextLost, shader, taaPass } from './runtime-state.js';
import { probeSky, skyStatus } from '../sky.js';
import { planetSurfaceStatus } from '../planet-surface.js';

// URL switches used by automated tests and reproducible screenshots:
//   ?quality=<preset>  start with that quality preset and skip the GPU benchmark
//   ?e2e=1             skip the benchmark, ignore the stored preset and freeze the simulation clock
const query = new URLSearchParams(window.location.search);

export const isE2eMode = query.get('e2e') === '1';

const qualityParam = query.get('quality');
export const requestedQualityPreset =
    qualityParam !== null && Object.hasOwn(QUALITY_PRESETS, qualityParam) ? qualityParam : null;

let frameCount = 0;
let resolveReady;
const ready = new Promise((resolve) => {
    resolveReady = resolve;
});

export function notifyFrameRendered() {
    frameCount += 1;
    // Resolve on the following animation frame so the first frame has been presented.
    if (frameCount === 1) requestAnimationFrame(() => resolveReady());
}

window.__BH__ = Object.freeze({
    ready,
    get frameCount() {
        return frameCount;
    },
    get params() {
        return shader ? shader.parameters : null;
    },
    // True from the loss of the GPU context or device until a renderer draws again.
    get contextLost() {
        return rendererContextLost;
    },
    get accumulatedFrames() {
        return taaPass ? taaPass.accumulatedFrames : 0;
    },
    // Drawing-buffer size of the canvas and the size of the scene target the passes render into.
    get viewport() {
        return {
            canvas: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
            passes: hdrTarget ? [hdrTarget.width, hdrTarget.height] : null,
        };
    },
    // Loading state of the planet's map: 'idle', 'loading', 'ready' or 'failed'.
    get planetSurface() {
        return planetSurfaceStatus();
    },
    // Galaxy cube: revision, face size, particle counts and storage format.
    get sky() {
        return skyStatus();
    },
    // Equirectangular readback of the galaxy cube: { width, height, rgb } in linear light, or a
    // promise of it with WebGPURenderer, whose readback is asynchronous.
    probeSky(width, height) {
        return probeSky(width, height);
    },
    // Takes the WebGPU device away as a driver reset would. A page can only destroy its device,
    // and three reports no loss for that, so the hook reports it the way three reports a real one.
    loseGpuDevice() {
        if (!renderer || !renderer.backend || !renderer.backend.isWebGPUBackend) return false;
        renderer.backend.device.destroy();
        renderer.onDeviceLost({ api: 'WebGPU', message: 'Device lost by test', reason: 'unknown' });
        return true;
    },
});
