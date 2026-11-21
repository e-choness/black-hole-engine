import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { createViewStateSync, viewStateCodec } from '../../src/features/share/index.js';

const BASE = 'https://example.org/black-hole/?quality=low';
const PAGE = '/black-hole/?quality=low';

// Location, History and events of one tab. Fragment navigations fire popstate and then
// hashchange, as browsers do; pushState() and replaceState() fire nothing.
function createFakeWindow(href) {
    const listeners = new Map();
    const entries = [{ url: new URL(href), state: null }];
    let index = 0;
    const calls = [];
    const current = () => entries[index].url;
    const dispatch = (type) => {
        for (const listener of [...(listeners.get(type) ?? [])]) listener({ type });
    };
    const go = (step) => {
        const previous = current();
        index += step;
        dispatch('popstate');
        if (current().hash !== previous.hash) dispatch('hashchange');
    };
    return {
        calls,
        get entries() {
            return entries.map((entry) => entry.url.href);
        },
        location: {
            get hash() {
                return current().hash;
            },
            get pathname() {
                return current().pathname;
            },
            get search() {
                return current().search;
            },
            get origin() {
                return current().origin;
            },
        },
        history: {
            get state() {
                return entries[index].state;
            },
            pushState(state, title, url) {
                calls.push(['push', url]);
                entries.splice(index + 1);
                entries.push({ url: new URL(url, current()), state });
                index += 1;
            },
            replaceState(state, title, url) {
                calls.push(['replace', url]);
                entries[index] = { url: new URL(url, current()), state };
            },
            back: () => go(-1),
            forward: () => go(1),
        },
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(listener);
        },
        removeEventListener(type, listener) {
            listeners.get(type)?.delete(listener);
        },
        listenerCount() {
            return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
        },
        // The user types a new fragment into the address bar.
        editHash(hash) {
            const url = new URL(current());
            url.hash = hash;
            entries.splice(index + 1);
            entries.push({ url, state: null });
            index += 1;
            dispatch('popstate');
            dispatch('hashchange');
        },
    };
}

function setup(href = BASE) {
    const windowRef = createFakeWindow(href);
    const app = { state: {} };
    const applied = [];
    const sync = createViewStateSync({
        codec: viewStateCodec,
        windowRef,
        read: () => app.state,
        apply: (state, info) => {
            applied.push({ state, info });
            app.state = { ...state };
        },
    });
    return { windowRef, app, applied, sync };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

test('a view state in the address bar is applied once at start-up', () => {
    const { windowRef, applied, sync } = setup(`${BASE}#v=1&bs=0.5&ot=12`);
    sync.start();
    sync.start();
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].info, { source: 'load', issues: [], version: 1 });
    assert.equal(applied[0].state['black_hole.spin'], 0.5);
    assert.equal(applied[0].state['observerState.time'], 12);
    sync.schedule();
    vi.advanceTimersByTime(5000);
    assert.deepEqual(windowRef.calls, [], 'an unchanged view keeps the shared link as it is');
});

test('nothing is applied or written until the view changes', () => {
    const { windowRef, app, applied, sync } = setup();
    sync.schedule();
    vi.advanceTimersByTime(5000);
    assert.equal(sync.flush(), false, 'not started yet');
    sync.start();
    assert.deepEqual(applied, []);
    sync.schedule();
    vi.advanceTimersByTime(5000);
    assert.deepEqual(windowRef.calls, []);

    app.state = { 'black_hole.spin': 0.5 };
    sync.schedule();
    vi.advanceTimersByTime(399);
    assert.deepEqual(windowRef.calls, []);
    vi.advanceTimersByTime(1);
    assert.deepEqual(windowRef.calls, [['replace', `${PAGE}#v=4&bs=0.5`]]);
    assert.equal(windowRef.location.hash, '#v=4&bs=0.5');
});

test('continuous changes are written at most every maxWait', () => {
    const { windowRef, app, sync } = setup();
    sync.start();
    for (let step = 0; step < 50; step += 1) {
        app.state = { 'camera.angles': [step, -3, 0] };
        sync.schedule();
        vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(400);
    assert.deepEqual(windowRef.calls, [
        ['replace', `${PAGE}#v=4&ca=19,-3,0`],
        ['replace', `${PAGE}#v=4&ca=39,-3,0`],
        ['replace', `${PAGE}#v=4&ca=49,-3,0`],
    ]);
});

test('volatile fields stay out of the address bar but go into share links', () => {
    const { windowRef, app, sync } = setup();
    sync.start();
    app.state = { 'observerState.time': 12.5, 'black_hole.spin': 0.5 };
    assert.equal(sync.flush(), true);
    assert.deepEqual(windowRef.calls, [['replace', `${PAGE}#v=4&bs=0.5`]]);
    assert.equal(sync.shareUrl(), 'https://example.org/black-hole/#v=4&ot=12.5&bs=0.5');
    assert.equal(sync.shareUrl({}), 'https://example.org/black-hole/#v=4');
    app.state = { 'observerState.time': 99, 'black_hole.spin': 0.5 };
    assert.equal(sync.flush(), false);
});

test('a new scenario mode or mass preset gets its own history entry', () => {
    const { windowRef, app, sync } = setup();
    sync.start();
    app.state = { 'scenario.mode': 'orbit' };
    sync.flush();
    app.state = { 'scenario.mode': 'orbit', 'observer.distance': 20 };
    sync.flush();
    app.state = { ...app.state, 'scenario.preset': 'sgr-a-star' };
    sync.flush();
    app.state = { ...app.state, 'black_hole.spin': 0.5 };
    sync.flush({ history: 'push' });
    app.state = { ...app.state, 'scenario.mode': 'static' };
    sync.flush({ history: 'replace' });
    assert.deepEqual(windowRef.calls, [
        ['push', `${PAGE}#v=4&om=o`],
        ['replace', `${PAGE}#v=4&om=o&od=20`],
        ['push', `${PAGE}#v=4&om=o&od=20&mp=sgr-a-star`],
        ['push', `${PAGE}#v=4&om=o&od=20&bs=0.5&mp=sgr-a-star`],
        ['replace', `${PAGE}#v=4&od=20&bs=0.5&mp=sgr-a-star`],
    ]);
    assert.equal(windowRef.entries.length, 4);
});

test('back and forward re-apply earlier views without echoing them', () => {
    const { windowRef, app, applied, sync } = setup();
    sync.start();
    app.state = { 'scenario.mode': 'orbit' };
    sync.flush();
    app.state = { 'scenario.mode': 'orbit', 'black_hole.spin': 0.5 };
    sync.flush();
    app.state = { 'scenario.mode': 'dive', 'black_hole.spin': 0.5 };
    sync.flush();
    const written = windowRef.calls.length;

    windowRef.history.back();
    assert.equal(applied.length, 1, 'popstate and hashchange apply once');
    assert.equal(applied[0].info.source, 'navigation');
    assert.equal(applied[0].state['scenario.mode'], 'orbit');
    assert.equal(applied[0].state['black_hole.spin'], 0.5);
    sync.schedule();
    vi.advanceTimersByTime(5000);
    assert.equal(windowRef.calls.length, written);

    windowRef.history.back();
    assert.equal(applied.length, 2);
    assert.deepEqual(
        applied[1].state,
        viewStateCodec.defaults(),
        'no fragment is the default view',
    );
    windowRef.history.forward();
    assert.equal(applied.length, 3);
    assert.equal(applied[2].state['scenario.mode'], 'orbit');
    assert.equal(windowRef.calls.length, written);
});

test('edited fragments are applied together with their issues', () => {
    const { windowRef, app, applied, sync } = setup();
    sync.start();
    windowRef.editHash('#v=1&bs=9');
    assert.equal(applied.length, 1);
    assert.equal(applied[0].state['black_hole.spin'], 0.998);
    assert.deepEqual(applied[0].info.issues, [
        { reason: 'clamped', key: 'bs', path: 'black_hole.spin', value: '9' },
    ]);
    assert.equal(app.state['black_hole.spin'], 0.998);
    sync.schedule();
    vi.advanceTimersByTime(5000);
    assert.deepEqual(windowRef.calls, []);
});

test('fragments that are no view state are left alone', () => {
    const { windowRef, app, applied, sync } = setup(`${BASE}#credits`);
    sync.start();
    windowRef.editHash('#about');
    assert.deepEqual(applied, []);
    app.state = { 'black_hole.spin': 0.5 };
    assert.equal(sync.flush(), true);
    assert.equal(windowRef.location.hash, '#v=4&bs=0.5');
});

test('a view back at its defaults clears the fragment', () => {
    const { windowRef, app, sync } = setup();
    sync.start();
    app.state = { 'black_hole.spin': 0.5 };
    sync.flush();
    app.state = {};
    sync.flush();
    assert.deepEqual(windowRef.calls.at(-1), ['replace', PAGE]);
    assert.equal(windowRef.location.hash, '');
});

test('pause() holds writes until resume(); navigation still applies', () => {
    const { windowRef, app, applied, sync } = setup();
    sync.start();
    sync.pause();
    assert.equal(sync.paused, true);
    app.state = { 'black_hole.spin': 0.5 };
    sync.schedule();
    vi.advanceTimersByTime(5000);
    assert.equal(sync.flush(), false);
    assert.deepEqual(windowRef.calls, []);
    windowRef.editHash('#v=1&bs=0.3');
    assert.equal(applied.length, 1);
    app.state = { 'black_hole.spin': 0.4 };
    sync.resume();
    sync.resume();
    assert.equal(sync.paused, false);
    vi.advanceTimersByTime(400);
    assert.deepEqual(windowRef.calls, [['replace', `${PAGE}#v=4&bs=0.4`]]);
});

test('a throttled History API is retried on the next change', () => {
    const { windowRef, app, sync } = setup();
    const replaceState = windowRef.history.replaceState;
    let failures = 1;
    windowRef.history.replaceState = (...args) => {
        if (failures-- > 0) throw new Error('SecurityError: too many calls');
        replaceState(...args);
    };
    sync.start();
    app.state = { 'black_hole.spin': 0.5 };
    assert.equal(sync.flush(), false);
    sync.schedule();
    vi.advanceTimersByTime(400);
    assert.deepEqual(windowRef.calls, [['replace', `${PAGE}#v=4&bs=0.5`]]);
});

test('dispose() stops listening and cancels pending writes', () => {
    const { windowRef, app, applied, sync } = setup();
    sync.start();
    assert.equal(windowRef.listenerCount(), 2);
    app.state = { 'black_hole.spin': 0.5 };
    sync.schedule();
    sync.dispose();
    sync.dispose();
    vi.advanceTimersByTime(5000);
    windowRef.editHash('#v=1&bs=0.3');
    sync.start();
    assert.deepEqual(windowRef.calls, []);
    assert.deepEqual(applied, []);
    assert.equal(windowRef.listenerCount(), 0);
});

test('the sync needs a codec, read() and apply()', () => {
    assert.throws(() => createViewStateSync(), TypeError);
    assert.throws(
        () => createViewStateSync({ codec: viewStateCodec, read: () => ({}) }),
        TypeError,
    );
});
