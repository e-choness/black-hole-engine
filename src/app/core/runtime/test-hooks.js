import { QUALITY_PRESETS } from '../../ui/quality-presets.js';
import { shader } from './runtime-state.js';

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
});
