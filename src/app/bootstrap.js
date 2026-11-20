// Role: Application entry point - checks for WebGPU or WebGL 2, then mounts the React app, whose
//       React Three Fiber canvas creates the renderer and starts the engine
//       (src/ui/viewport/Viewport.tsx).
//       The sky and the planet's surface are computed on the GPU, so there are no images to load.

import {
    isGpuRenderingAvailable,
    showGpuRenderingUnavailable,
} from './core/renderer/gpu-support.js';
import { mountApp } from '../ui/main.tsx';

if (isGpuRenderingAvailable()) {
    document.getElementById('loader').hidden = true;
    mountApp();
} else {
    showGpuRenderingUnavailable();
}
