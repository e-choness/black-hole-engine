// Offline recording encoder: WebCodecs encoding and MP4/WebM writing through Mediabunny. The
// presentation controller imports this module on demand, so Mediabunny is only downloaded
// once an offline recording starts.

import {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    Quality,
    StreamTarget,
    WebMOutputFormat,
    getFirstEncodableVideoCodec,
} from 'mediabunny';
import {
    PRESENTATION_VIDEO_CONTAINERS,
    normalizePresentationVideoContainer,
} from './presentation-video-formats.js';

// Resolves to the first codec of the container that WebCodecs can encode with these settings,
// or null when there is none.
export function selectOfflineVideoCodec(container, settings) {
    const spec = PRESENTATION_VIDEO_CONTAINERS[normalizePresentationVideoContainer(container)];
    return getFirstEncodableVideoCodec(spec.codecs, {
        width: settings.width,
        height: settings.height,
        quality: new Quality({ bitrate: settings.bitrate }),
        frameRate: settings.frameRate,
    });
}

// Creates and starts an output that encodes frames captured from `settings.canvas`. Without
// `settings.writable` the file is assembled in memory and exposed as `target.buffer` once the
// output is finalized.
export async function createOfflineVideoOutput(settings) {
    const container = normalizePresentationVideoContainer(settings.container);
    const format = container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
    const target = settings.writable
        ? new StreamTarget(settings.writable, { chunked: true })
        : new BufferTarget();
    const output = new Output({ format, target });
    const source = new CanvasSource(settings.canvas, {
        codec: settings.codec,
        quality: new Quality({ bitrate: settings.bitrate }),
        keyFrameInterval: 1,
        onEncodedPacket: settings.onEncodedPacket,
    });
    output.addVideoTrack(source, { frameRate: settings.frameRate });
    try {
        await output.start();
    } catch (err) {
        await output.cancel().catch(() => {});
        throw err;
    }
    return { output, source, target, mimeType: format.mimeType };
}
