import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isMobileDevice, preferredBackend } from '../../src/app/core/renderer/backend.js';

const CHROME_DESKTOP =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const FIREFOX_DESKTOP =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0';
const SAFARI_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ANDROID =
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';

const nav = (userAgent, extra = {}) => ({ userAgent, gpu: {}, maxTouchPoints: 0, ...extra });

test('desktop browsers with WebGPU get WebGPU', () => {
    assert.equal(preferredBackend(nav(CHROME_DESKTOP)), 'webgpu');
    assert.equal(preferredBackend(nav(SAFARI_MAC)), 'webgpu');
});

test('phones, tablets and iPads get WebGL 2', () => {
    assert.equal(preferredBackend(nav(IPHONE)), 'webgl');
    assert.equal(preferredBackend(nav(ANDROID)), 'webgl');
    assert.equal(preferredBackend(nav(SAFARI_MAC, { maxTouchPoints: 5 })), 'webgl');
    assert.equal(isMobileDevice(nav(SAFARI_MAC, { maxTouchPoints: 5 })), true);
});

test('client hints decide when the browser sends them', () => {
    assert.equal(isMobileDevice(nav(CHROME_DESKTOP, { userAgentData: { mobile: true } })), true);
    assert.equal(isMobileDevice(nav(ANDROID, { userAgentData: { mobile: false } })), false);
});

test('browsers without WebGPU, and Firefox, get WebGL 2', () => {
    const noGpu = { userAgent: CHROME_DESKTOP, maxTouchPoints: 0 };
    assert.equal(preferredBackend(noGpu), 'webgl');
    assert.equal(preferredBackend(nav(FIREFOX_DESKTOP)), 'webgl');
});
