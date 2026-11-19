// Video containers offered for presentation recordings. Offline recordings are encoded with
// WebCodecs and written by Mediabunny using the first encodable entry of `codecs`; realtime
// recordings use MediaRecorder with the first supported entry of `recorderMimeTypes`.

export const PRESENTATION_VIDEO_CONTAINERS = Object.freeze({
    mp4: Object.freeze({
        label: 'MP4 (H.264)',
        mimeType: 'video/mp4',
        extension: '.mp4',
        codecs: Object.freeze(['avc']),
        recorderMimeTypes: Object.freeze(['video/mp4;codecs=avc1', 'video/mp4']),
    }),
    webm: Object.freeze({
        label: 'WebM (VP9 / AV1)',
        mimeType: 'video/webm',
        extension: '.webm',
        codecs: Object.freeze(['vp9', 'av1']),
        recorderMimeTypes: Object.freeze([
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ]),
    }),
});

// Codecs a recording can ask for by name. Each belongs to one container; MediaRecorder tries its
// MIME types before the container's generic ones.
export const PRESENTATION_VIDEO_CODECS = Object.freeze({
    avc: Object.freeze({
        label: 'MP4 (H.264)',
        container: 'mp4',
        recorderMimeTypes: Object.freeze(['video/mp4;codecs=avc1']),
    }),
    vp9: Object.freeze({
        label: 'WebM (VP9)',
        container: 'webm',
        recorderMimeTypes: Object.freeze(['video/webm;codecs=vp9']),
    }),
    av1: Object.freeze({
        label: 'WebM (AV1)',
        container: 'webm',
        recorderMimeTypes: Object.freeze(['video/webm;codecs=av01', 'video/webm;codecs=av1']),
    }),
});

export const DEFAULT_PRESENTATION_VIDEO_CONTAINER = 'mp4';

export function normalizePresentationVideoCodec(value) {
    const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return Object.hasOwn(PRESENTATION_VIDEO_CODECS, clean) ? clean : '';
}

export function normalizePresentationVideoContainer(value) {
    const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return Object.hasOwn(PRESENTATION_VIDEO_CONTAINERS, clean)
        ? clean
        : DEFAULT_PRESENTATION_VIDEO_CONTAINER;
}

// Returns the first MIME type accepted by `isTypeSupported`, trying the requested codec, then the
// preferred container, then the others, or '' when none is supported.
export function pickRecorderMimeType(container, isTypeSupported, codec) {
    const codecSpec = PRESENTATION_VIDEO_CODECS[normalizePresentationVideoCodec(codec)];
    if (codecSpec) {
        for (const mimeType of codecSpec.recorderMimeTypes) {
            if (isTypeSupported(mimeType)) return mimeType;
        }
    }
    const preferred = normalizePresentationVideoContainer(
        codecSpec ? codecSpec.container : container,
    );
    const order = [preferred].concat(
        Object.keys(PRESENTATION_VIDEO_CONTAINERS).filter((key) => key !== preferred),
    );
    for (const key of order) {
        for (const mimeType of PRESENTATION_VIDEO_CONTAINERS[key].recorderMimeTypes) {
            if (isTypeSupported(mimeType)) return mimeType;
        }
    }
    return '';
}
