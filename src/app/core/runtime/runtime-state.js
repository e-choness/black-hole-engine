import * as THREE from 'three';
import { Observer, bindObserverShader } from '../observer.js';

export const DISK_TEMPERATURE_MIN = 1000.0;
export const DISK_TEMPERATURE_MAX = 1.0e7;

// The React Three Fiber canvas that hosts the renderer (src/ui/viewport/Viewport.tsx): gl, size()
// in CSS pixels, setDpr(ratio), setCamera(camera) and restoreSize(), which applies its size and
// pixel ratio to gl again after an offline recording resized the drawing buffer.
export let viewportHost = null;
export let camera = null;
export let scene = null;
export let renderer = null;
export let cameraControls = null;
export let shader = null;
export const observer = new Observer();
export const cameraPan = new THREE.Vector2(0, 0);
export let refreshAllControllersGlobal = null;
export let bloomPass = null;
export let taaPass = null;
export let outputPass = null;
export let hdrTarget = null;
export let shaderUniforms = null;
export const baseDevicePixelRatio = Math.max(window.devicePixelRatio || 1.0, 1.0);
export let rendererContextLost = false;
export const lastTaaCameraMat = new THREE.Matrix4().identity();

export let updateUniforms = function () {};
export let applyRenderScaleFromSettings = function () {};
export let resetTemporalAAHistory = function () {};

export function setViewportHost(value) {
    viewportHost = value;
}
export function setCamera(value) {
    camera = value;
}
export function setScene(value) {
    scene = value;
}
export function setRenderer(value) {
    renderer = value;
}
export function setCameraControls(value) {
    cameraControls = value;
}
export function setShader(value) {
    shader = value;
    bindObserverShader(value);
}
export function setRefreshAllControllersGlobal(value) {
    refreshAllControllersGlobal = value;
}
export function setBloomPass(value) {
    bloomPass = value;
}
export function setTaaPass(value) {
    taaPass = value;
}
export function setOutputPass(value) {
    outputPass = value;
}
export function setHdrTarget(value) {
    hdrTarget = value;
}
export function setShaderUniforms(value) {
    shaderUniforms = value;
}
export function setRendererContextLost(value) {
    rendererContextLost = !!value;
}
export function setUpdateUniforms(value) {
    updateUniforms = value || function () {};
}
export function setApplyRenderScaleFromSettings(value) {
    applyRenderScaleFromSettings = value || function () {};
}
export function setResetTemporalAAHistory(value) {
    resetTemporalAAHistory = value || function () {};
}
