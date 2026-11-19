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

export const DEFAULT_PRESENTATION_VIDEO_CONTAINER = 'mp4';

export function normalizePresentationVideoContainer(value) {
    const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return Object.hasOwn(PRESENTATION_VIDEO_CONTAINERS, clean)
        ? clean
        : DEFAULT_PRESENTATION_VIDEO_CONTAINER;
}

// Returns the first MIME type accepted by `isTypeSupported`, trying the preferred container
// before the others, or '' when none is supported.
export function pickRecorderMimeType(container, isTypeSupported) {
    const preferred = normalizePresentationVideoContainer(container);
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
