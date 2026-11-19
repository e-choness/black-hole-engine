import { Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TWO_PI = 2 * Math.PI;
const PRIMARY_BUTTON = 1;
const SECONDARY_BUTTON = 2;

// OrbitControls with the observer's gesture set. OrbitControls keeps the orbit maths, pointer
// capture, touch-action and context-menu handling; its own gestures are switched off and these
// handlers drive the public rotate/update API instead:
//   - left drag orbits; dragging across the full canvas width or height turns by 360 degrees;
//   - right drag calls panCallback(deltaX, deltaY, width, height) with pixel deltas;
//   - a left+right chord rolls the camera about the view direction and stays a roll while
//     the left button is held;
//   - one finger orbits; two fingers call panCallback with the movement of their midpoint and
//     zoomCallback(distanceDelta), where distanceDelta > 0 means the fingers moved apart.
// Mouse wheel zoom is left to the GUI, which owns the observer distance.
export class ObserverControls extends OrbitControls {
    panCallback = null;
    zoomCallback = null;

    #mouseMode = null;
    #mouseLast = new Vector2();
    #touchMode = null;
    #touchCenter = new Vector2();
    #touchDistance = 0;
    #viewDirection = new Vector3();

    constructor(object, domElement) {
        super(object, domElement);
        this.enableRotate = false;
        this.enableZoom = false;
        this.enablePan = false;
        this.up0 = this.object.up.clone();

        this.domElement.addEventListener('contextmenu', this.#onContextMenu);
        this.domElement.addEventListener('pointerdown', this.#onPointerDown);
        this.domElement.addEventListener('pointermove', this.#onPointerMove);
        this.domElement.addEventListener('pointerup', this.#onPointerUp);
        this.domElement.addEventListener('pointercancel', this.#onPointerUp);
        this.domElement.addEventListener('touchstart', this.#onTouchChange, { passive: true });
        this.domElement.addEventListener('touchmove', this.#onTouchMove, { passive: true });
        this.domElement.addEventListener('touchend', this.#onTouchChange, { passive: true });
        this.domElement.addEventListener('touchcancel', this.#onTouchChange, { passive: true });
    }

    saveState() {
        super.saveState();
        this.up0.copy(this.object.up);
    }

    reset() {
        this.object.up.copy(this.up0);
        super.reset();
    }

    dispose() {
        this.domElement.removeEventListener('contextmenu', this.#onContextMenu);
        this.domElement.removeEventListener('pointerdown', this.#onPointerDown);
        this.domElement.removeEventListener('pointermove', this.#onPointerMove);
        this.domElement.removeEventListener('pointerup', this.#onPointerUp);
        this.domElement.removeEventListener('pointercancel', this.#onPointerUp);
        this.domElement.removeEventListener('touchstart', this.#onTouchChange);
        this.domElement.removeEventListener('touchmove', this.#onTouchMove);
        this.domElement.removeEventListener('touchend', this.#onTouchChange);
        this.domElement.removeEventListener('touchcancel', this.#onTouchChange);
        super.dispose();
    }

    #rotate(deltaX, deltaY) {
        const element = this.domElement;
        this.rotateLeft(((TWO_PI * deltaX) / element.clientWidth) * this.rotateSpeed);
        this.rotateUp(((TWO_PI * deltaY) / element.clientHeight) * this.rotateSpeed);
    }

    #roll(deltaX) {
        const direction = this.#viewDirection.subVectors(this.target, this.object.position);
        if (direction.lengthSq() === 0) return;
        const angle = ((TWO_PI * deltaX) / this.domElement.clientWidth) * this.rotateSpeed;
        this.object.up.applyAxisAngle(direction.normalize(), angle).normalize();
        this.update();
    }

    #pan(deltaX, deltaY) {
        const element = this.domElement;
        this.panCallback?.(deltaX, deltaY, element.clientWidth, element.clientHeight);
    }

    // Right drag pans, so the context menu stays suppressed even while the controls are
    // disabled (OrbitControls only suppresses it while enabled).
    #onContextMenu = (event) => {
        event.preventDefault();
    };

    // Pressing a second mouse button during a drag produces a pointermove with the new
    // `buttons` mask rather than a pointerdown, so chords are resolved on every move.
    #onPointerDown = (event) => {
        if (!this.enabled || event.pointerType === 'touch') return;
        event.preventDefault();
        this.domElement.setPointerCapture(event.pointerId);
        this.#mouseLast.set(event.clientX, event.clientY);
        if (event.button === 0) this.#mouseMode = 'rotate';
        else if (event.button === 2) this.#mouseMode = 'pan';
        else this.#mouseMode = null;
    };

    #onPointerMove = (event) => {
        if (!this.enabled || event.pointerType === 'touch') return;
        const buttons = event.buttons & (PRIMARY_BUTTON | SECONDARY_BUTTON);
        let nextMode = this.#mouseMode;
        if (buttons === (PRIMARY_BUTTON | SECONDARY_BUTTON)) nextMode = 'roll';
        else if (buttons === SECONDARY_BUTTON) nextMode = 'pan';
        else if (buttons === PRIMARY_BUTTON && nextMode === null) nextMode = 'rotate';
        if (nextMode !== this.#mouseMode) {
            this.#mouseMode = nextMode;
            this.#mouseLast.set(event.clientX, event.clientY);
            return;
        }
        if (this.#mouseMode === null) return;

        const deltaX = event.clientX - this.#mouseLast.x;
        const deltaY = event.clientY - this.#mouseLast.y;
        this.#mouseLast.set(event.clientX, event.clientY);
        if (this.#mouseMode === 'rotate') this.#rotate(deltaX, deltaY);
        else if (this.#mouseMode === 'roll') this.#roll(deltaX);
        else this.#pan(deltaX, deltaY);
    };

    #onPointerUp = (event) => {
        if (event.pointerType === 'touch') return;
        this.#mouseMode = null;
    };

    // Touch gestures use touch events, which report every finger in one event per frame, so a
    // pinch produces one pan and one zoom step per frame.
    #onTouchChange = (event) => {
        const touches = event.touches;
        if (touches.length === 1) {
            this.#touchMode = 'rotate';
            this.#touchCenter.set(touches[0].pageX, touches[0].pageY);
        } else if (touches.length === 2) {
            this.#touchMode = 'pinch';
            this.#measurePinch(touches);
        } else {
            this.#touchMode = null;
        }
    };

    #onTouchMove = (event) => {
        if (!this.enabled) return;
        const touches = event.touches;
        if (this.#touchMode === 'rotate' && touches.length === 1) {
            const deltaX = touches[0].pageX - this.#touchCenter.x;
            const deltaY = touches[0].pageY - this.#touchCenter.y;
            this.#touchCenter.set(touches[0].pageX, touches[0].pageY);
            this.#rotate(deltaX, deltaY);
        } else if (this.#touchMode === 'pinch' && touches.length === 2) {
            const previousX = this.#touchCenter.x;
            const previousY = this.#touchCenter.y;
            const previousDistance = this.#touchDistance;
            this.#measurePinch(touches);
            this.#pan(this.#touchCenter.x - previousX, this.#touchCenter.y - previousY);
            const distanceDelta = this.#touchDistance - previousDistance;
            if (distanceDelta !== 0) this.zoomCallback?.(distanceDelta);
        }
    };

    #measurePinch(touches) {
        const a = touches[0];
        const b = touches[1];
        this.#touchCenter.set((a.pageX + b.pageX) / 2, (a.pageY + b.pageY) / 2);
        this.#touchDistance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
    }
}
