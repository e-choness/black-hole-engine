import { once } from 'node:events';
import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
    PWA_EVENTS,
    TEXTURE_CACHE_NAME,
    createPwaController,
    isTextureRequest,
} from '../../src/features/pwa/index.js';

const ORIGIN = 'https://example.org';

// registerSW() of virtual:pwa-register: keeps the callbacks so a test can play the lifecycle.
function createFakeRegisterSW() {
    const fake = {
        calls: [],
        updates: [],
        options: null,
        failUpdate: null,
        registerSW(options) {
            fake.calls.push(options);
            fake.options = options;
            return async (reloadPage) => {
                fake.updates.push(reloadPage);
                if (fake.failUpdate) throw fake.failUpdate;
            };
        },
    };
    return fake;
}

// Cache Storage with one cache per name; urls listed in `failing` cannot be fetched.
function createFakeCaches({ failing = [] } = {}) {
    const stores = new Map();
    return {
        stores,
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Set());
            const store = stores.get(name);
            return {
                async match(url) {
                    return store.has(url) ? { url } : undefined;
                },
                async add(url) {
                    if (failing.includes(url)) throw new TypeError(`Failed to fetch ${url}`);
                    store.add(url);
                },
            };
        },
    };
}

function resourceTimings(urls) {
    return {
        getEntriesByType: (type) => (type === 'resource' ? urls.map((name) => ({ name })) : []),
    };
}

function recordEvents(eventTarget) {
    const events = [];
    for (const type of Object.values(PWA_EVENTS)) {
        eventTarget.addEventListener(type, (event) => events.push({ type, detail: event.detail }));
    }
    return events;
}

function setup(overrides = {}) {
    const fake = createFakeRegisterSW();
    const eventTarget = new EventTarget();
    const events = recordEvents(eventTarget);
    const navigatorRef = { serviceWorker: { controller: null }, onLine: true };
    const reload = vi.fn();
    const controller = createPwaController({
        registerSW: fake.registerSW,
        eventTarget,
        navigatorRef,
        cachesRef: undefined,
        reload,
        ...overrides,
    });
    return { fake, eventTarget, events, navigatorRef, reload, controller };
}

afterEach(() => {
    vi.useRealTimers();
});

test('start() registers once, after the page load, and reports the registration', () => {
    const { fake, controller } = setup();
    const changes = [];
    controller.subscribe(() => changes.push(controller.getSnapshot().status));
    const idle = controller.getSnapshot();
    assert.deepEqual(idle, {
        status: 'idle',
        offlineReady: false,
        updateReady: false,
        error: null,
    });
    assert.ok(Object.isFrozen(idle));

    assert.equal(controller.start(), true);
    assert.equal(controller.start(), true);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.options.immediate, false, 'registration waits for the load event');

    fake.options.onRegisteredSW('./sw.js', { update: async () => {} });
    assert.deepEqual(changes, ['registering', 'registered']);
    const registered = controller.getSnapshot();
    fake.options.onRegisteredSW('./sw.js', { update: async () => {} });
    assert.equal(controller.getSnapshot(), registered, 'unchanged snapshots keep their identity');
    controller.dispose();
});

test('without service workers the controller reports unsupported and never registers', () => {
    const { fake, controller, events } = setup({ navigatorRef: {} });
    assert.equal(controller.start(), false);
    assert.equal(controller.start(), false);
    assert.equal(controller.getSnapshot().status, 'unsupported');
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(events, []);
});

test('the first installation copies the loaded textures into the runtime cache', async () => {
    const cachesRef = createFakeCaches({ failing: [`${ORIGIN}/app/textures/stars.png`] });
    const preloaded = await cachesRef.open(TEXTURE_CACHE_NAME);
    await preloaded.add(`${ORIGIN}/app/textures/spectra.png`);
    const { fake, controller, events, eventTarget } = setup({
        cachesRef,
        performanceRef: resourceTimings([
            `${ORIGIN}/app/textures/milkyway.jpg`,
            `${ORIGIN}/app/textures/milkyway.jpg`,
            `${ORIGIN}/app/textures/spectra.png`,
            `${ORIGIN}/app/textures/stars.png`,
            `https://cdn.example.net/textures/remote.png`,
            `${ORIGIN}/app/assets/index-abc.js`,
            'not a url',
        ]),
        warmCache: {
            cacheName: TEXTURE_CACHE_NAME,
            match: (url) => isTextureRequest({ url, sameOrigin: url.origin === ORIGIN }),
        },
    });
    controller.start();
    const ready = once(eventTarget, PWA_EVENTS.offlineReady);
    fake.options.onOfflineReady();
    assert.equal(controller.getSnapshot().offlineReady, false, 'reported after the copy');
    await ready;

    assert.deepEqual(
        [...cachesRef.stores.get(TEXTURE_CACHE_NAME)].sort(),
        [`${ORIGIN}/app/textures/milkyway.jpg`, `${ORIGIN}/app/textures/spectra.png`],
        'same-origin textures only; a failed copy is left to the worker',
    );
    assert.deepEqual(controller.getSnapshot(), {
        status: 'offline-ready',
        offlineReady: true,
        updateReady: false,
        error: null,
    });
    assert.deepEqual(events, [{ type: PWA_EVENTS.offlineReady, detail: {} }]);
});

test('offline-ready comes straight away without a cache to warm', async () => {
    for (const overrides of [
        { warmCache: null, cachesRef: createFakeCaches() },
        { warmCache: { cacheName: 'x', match: () => true }, cachesRef: undefined },
        {
            warmCache: { cacheName: 'x', match: () => true },
            cachesRef: createFakeCaches(),
            performanceRef: undefined,
        },
    ]) {
        const { fake, controller, eventTarget } = setup(overrides);
        controller.start();
        const ready = once(eventTarget, PWA_EVENTS.offlineReady);
        fake.options.onOfflineReady();
        await ready;
        assert.equal(controller.getSnapshot().status, 'offline-ready');
    }
});

test('a new version waits for applyUpdate(), then reloads once it controls the page', async () => {
    const { fake, controller, events, reload } = setup();
    controller.start();
    assert.equal(controller.applyUpdate(), false, 'nothing to apply yet');
    fake.options.onRegisteredSW('./sw.js', { update: async () => {} });

    fake.options.onNeedRefresh();
    assert.deepEqual(controller.getSnapshot(), {
        status: 'update-ready',
        offlineReady: false,
        updateReady: true,
        error: null,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, PWA_EVENTS.updateReady);
    assert.equal(events[0].detail.applyUpdate, controller.applyUpdate);

    assert.equal(events[0].detail.applyUpdate(), true);
    assert.equal(controller.getSnapshot().status, 'updating');
    await vi.waitFor(() => assert.deepEqual(fake.updates, [true]));
    assert.equal(reload.mock.calls.length, 0, 'the reload waits for the new worker');
    fake.options.onNeedReload();
    assert.equal(reload.mock.calls.length, 1);
});

test('a failed update returns to the prompt with the error', async () => {
    const { fake, controller } = setup();
    controller.start();
    fake.options.onNeedRefresh();
    fake.failUpdate = new Error('the waiting worker is gone');
    controller.applyUpdate();
    await vi.waitFor(() => assert.equal(controller.getSnapshot().status, 'update-ready'));
    assert.equal(controller.getSnapshot().error, 'the waiting worker is gone');
});

test('an update found before offline-ready keeps the update prompt', async () => {
    const { fake, controller, eventTarget } = setup();
    controller.start();
    fake.options.onNeedRefresh();
    const ready = once(eventTarget, PWA_EVENTS.offlineReady);
    fake.options.onOfflineReady();
    await ready;
    assert.deepEqual(controller.getSnapshot(), {
        status: 'update-ready',
        offlineReady: true,
        updateReady: true,
        error: null,
    });
});

test('registration errors matter only while no worker controls the page', () => {
    const failing = setup();
    failing.controller.start();
    const error = new TypeError('Failed to register a ServiceWorker');
    failing.fake.options.onRegisterError(error);
    assert.deepEqual(failing.controller.getSnapshot(), {
        status: 'error',
        offlineReady: false,
        updateReady: false,
        error: 'Failed to register a ServiceWorker',
    });
    assert.deepEqual(failing.events, [{ type: PWA_EVENTS.error, detail: { error } }]);

    const offline = setup();
    offline.navigatorRef.serviceWorker.controller = {};
    offline.controller.start();
    offline.fake.options.onRegisterError('offline');
    assert.equal(offline.controller.getSnapshot().status, 'registered');
    assert.equal(offline.controller.getSnapshot().error, 'offline');
    assert.deepEqual(offline.events, []);
});

test('long sessions look for a new version every interval while online', async () => {
    vi.useFakeTimers();
    const registration = { installing: null, update: vi.fn(async () => {}) };
    const { fake, controller, navigatorRef } = setup({ updateInterval: 1000 });
    assert.equal(await controller.checkForUpdate(), false, 'not registered yet');
    controller.start();
    fake.options.onRegisteredSW('./sw.js', registration);
    fake.options.onRegisteredSW('./sw.js', registration);

    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(registration.update.mock.calls.length, 1, 'one timer despite two callbacks');
    navigatorRef.onLine = false;
    await vi.advanceTimersByTimeAsync(1000);
    navigatorRef.onLine = true;
    registration.installing = {};
    await vi.advanceTimersByTimeAsync(1000);
    assert.equal(registration.update.mock.calls.length, 1, 'skipped offline and during installs');

    registration.installing = null;
    registration.update.mockRejectedValueOnce(new TypeError('network error'));
    assert.equal(await controller.checkForUpdate(), false);
    assert.equal(await controller.checkForUpdate(), true);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    assert.equal(registration.update.mock.calls.length, 3);
});

test('dispose() silences the controller', async () => {
    const { fake, controller, events, reload } = setup();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.start();
    const snapshot = controller.getSnapshot();
    controller.dispose();
    controller.dispose();
    fake.options.onNeedRefresh();
    fake.options.onOfflineReady();
    fake.options.onNeedReload();
    fake.options.onRegisterError(new Error('late'));
    fake.options.onRegisteredSW('./sw.js', { update: async () => {} });
    await Promise.resolve();
    assert.equal(controller.getSnapshot(), snapshot);
    assert.equal(controller.start(), false);
    assert.equal(controller.applyUpdate(), false);
    assert.equal(await controller.checkForUpdate(), false);
    assert.deepEqual(events, []);
    assert.equal(listener.mock.calls.length, 1, 'only the change to registering');
    assert.equal(reload.mock.calls.length, 0);
});

test('the controller needs registerSW()', () => {
    assert.throws(() => createPwaController(), TypeError);
    assert.throws(() => createPwaController({ registerSW: 'yes' }), TypeError);
});
