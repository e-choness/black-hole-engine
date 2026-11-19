import { expect, test } from '@playwright/test';
import { openSimulation, trackPageProblems } from './support.js';

// Touch emulation provides the Touch and TouchEvent constructors used for the pinch gesture.
test.use({ hasTouch: true });

function readView() {
    const get = window.blackHolePresentation.getPathValue;
    const vector = (path) => ['x', 'y', 'z'].map((axis) => get(`${path}.${axis}`));
    return {
        position: vector('camera.position'),
        up: vector('camera.up'),
        pan: [get('cameraPan.x'), get('cameraPan.y')],
        distance: window.__BH__.params.observer.distance,
    };
}

// Two fingers that start 40 px apart around (x, y) and spread to 120 px in two moves.
function pinchOut({ x, y }) {
    const canvas = document.getElementById('bh-canvas');
    const finger = (identifier, offset) =>
        new Touch({
            identifier,
            target: canvas,
            clientX: x + offset,
            clientY: y,
            pageX: x + offset,
            pageY: y,
        });
    const fire = (type, touches) =>
        canvas.dispatchEvent(
            new TouchEvent(type, {
                touches,
                targetTouches: touches,
                changedTouches: touches,
                bubbles: true,
                cancelable: true,
            }),
        );
    fire('touchstart', [finger(1, -20), finger(2, 20)]);
    fire('touchmove', [finger(1, -40), finger(2, 40)]);
    fire('touchmove', [finger(1, -60), finger(2, 60)]);
    fire('touchend', []);
}

function expectVectorClose(actual, expected) {
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
}

test('mouse and touch gestures orbit, pan, roll and zoom the observer', async ({ page }) => {
    const problems = trackPageProblems(page);
    await openSimulation(page);
    const box = await page.locator('#bh-canvas').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const initial = await page.evaluate(readView);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y + 30, { steps: 4 });
    await page.mouse.up();
    const orbited = await page.evaluate(readView);
    expect(orbited.position).not.toEqual(initial.position);
    expect(Math.hypot(...orbited.position)).toBeCloseTo(Math.hypot(...initial.position), 3);
    expect(orbited.pan).toEqual(initial.pan);

    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + 20, y + 50, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    const panned = await page.evaluate(readView);
    expect(panned.pan[0]).toBeGreaterThan(orbited.pan[0]);
    expect(panned.pan[1]).toBeGreaterThan(orbited.pan[1]);
    expect(panned.position).toEqual(orbited.position);

    await page.mouse.down();
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + 100, y + 50, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await page.mouse.up();
    const rolled = await page.evaluate(readView);
    expect(rolled.up).not.toEqual(panned.up);
    expectVectorClose(rolled.position, panned.position);
    expect(rolled.pan).toEqual(panned.pan);

    await page.evaluate(pinchOut, { x, y });
    const zoomed = await page.evaluate(readView);
    expect(zoomed.distance).toBeCloseTo(rolled.distance / 1.08 ** 2, 6);
    expect(zoomed.pan).toEqual(rolled.pan);

    expect(problems).toEqual([]);
});
