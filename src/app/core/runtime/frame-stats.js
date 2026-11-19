// Frame counter and the CPU time spent issuing the last frame, read by the UI's quality chip.
// GPU time is not measured; WebGL timer queries are not available everywhere.
export const frameStats = { frames: 0, renderMs: 0 };

export function recordRenderedFrame(milliseconds) {
    frameStats.frames += 1;
    frameStats.renderMs = milliseconds;
}
