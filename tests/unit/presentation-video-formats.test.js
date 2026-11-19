import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
    DEFAULT_PRESENTATION_VIDEO_CONTAINER,
    normalizePresentationVideoContainer,
    pickRecorderMimeType,
} from '../../src/app/presentation/runtime/presentation-video-formats.js';

test('normalizePresentationVideoContainer accepts known containers and defaults to MP4', function () {
    assert.equal(DEFAULT_PRESENTATION_VIDEO_CONTAINER, 'mp4');
    assert.equal(normalizePresentationVideoContainer('mp4'), 'mp4');
    assert.equal(normalizePresentationVideoContainer(' WebM '), 'webm');
    for (const value of [undefined, null, '', 'mkv', '__proto__', 42]) {
        assert.equal(normalizePresentationVideoContainer(value), 'mp4');
    }
});

test('pickRecorderMimeType tries the preferred container before the other one', function () {
    const everything = () => true;
    const nothing = () => false;
    const webmWithoutVp9 = (type) => type === 'video/webm;codecs=vp8' || type === 'video/webm';
    const plainMp4 = (type) => type === 'video/mp4';

    assert.equal(pickRecorderMimeType('mp4', everything), 'video/mp4;codecs=avc1');
    assert.equal(pickRecorderMimeType('webm', everything), 'video/webm;codecs=vp9');
    assert.equal(pickRecorderMimeType('mp4', webmWithoutVp9), 'video/webm;codecs=vp8');
    assert.equal(pickRecorderMimeType('webm', plainMp4), 'video/mp4');
    assert.equal(pickRecorderMimeType('webm', nothing), '');
});
