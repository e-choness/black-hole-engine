// Service worker lifecycle for the UI. registerSW() is the function of vite-plugin-pwa's
// virtual:pwa-register module in 'prompt' mode (config/pwa.js): a new version waits until the user
// accepts it, because an automatic reload would interrupt a running simulation or recording.
//
// getSnapshot() returns { status, offlineReady, updateReady, error } and subscribe(callback)
// reports changes, the contract of React's useSyncExternalStore(); the snapshot object is replaced
// only when a value changes. status is one of
//   idle          start() not called yet
//   unsupported   no service workers (insecure context or an old browser), or the page is
//                 embedded in another page's frame (the itch.io page), where it can't be
//                 installed and a worker would only be partitioned under the embedding site
//   registering   waiting for the page load, then for the registration
//   registered    a worker is registered; on a repeat visit it already serves the app offline
//   offline-ready the first installation finished: the app now works offline
//   update-ready  a new version is installed and waits for applyUpdate()
//   updating      applyUpdate() was called; the page reloads when the new worker takes over
//   error         registration failed while no worker controls the page
// The same moments are dispatched on `eventTarget` (window) for code that does not import this
// module: PWA_EVENTS.offlineReady, PWA_EVENTS.updateReady with detail.applyUpdate, and
// PWA_EVENTS.error with detail.error.

export const PWA_EVENTS = Object.freeze({
    offlineReady: 'bh:pwa-offline-ready',
    updateReady: 'bh:pwa-update-ready',
    error: 'bh:pwa-error',
});

const HOUR = 60 * 60 * 1000;

function describeError(error) {
    if (error instanceof Error) return error.message || error.name;
    return String(error);
}

export function createPwaController({
    registerSW,
    eventTarget = globalThis.window,
    navigatorRef = globalThis.navigator,
    embedded = globalThis.window !== undefined && globalThis.window.top !== globalThis.window,
    reload = () => globalThis.location.reload(),
    updateInterval = HOUR,
    timers = globalThis,
} = {}) {
    if (typeof registerSW !== 'function') {
        throw new TypeError('createPwaController needs registerSW()');
    }
    const listeners = new Set();
    let snapshot = Object.freeze({
        status: 'idle',
        offlineReady: false,
        updateReady: false,
        error: null,
    });
    let started = false;
    let disposed = false;
    let updateServiceWorker = null;
    let registration = null;
    let updateTimer = null;

    function update(changes) {
        if (disposed) return;
        const next = { ...snapshot, ...changes };
        if (Object.keys(next).every((key) => Object.is(next[key], snapshot[key]))) return;
        snapshot = Object.freeze(next);
        for (const listener of [...listeners]) listener();
    }

    function emit(type, detail) {
        if (disposed || !eventTarget) return;
        eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
    }

    function handleOfflineReady() {
        update({
            offlineReady: true,
            status: snapshot.updateReady ? snapshot.status : 'offline-ready',
        });
        emit(PWA_EVENTS.offlineReady, {});
    }

    function handleNeedRefresh() {
        update({ updateReady: true, status: 'update-ready' });
        emit(PWA_EVENTS.updateReady, { applyUpdate });
    }

    function handleRegistered(swUrl, swRegistration) {
        if (disposed) return;
        registration = swRegistration ?? null;
        if (snapshot.status === 'registering') update({ status: 'registered' });
        if (registration && updateInterval > 0 && updateTimer === null) {
            updateTimer = timers.setInterval(() => {
                void checkForUpdate();
            }, updateInterval);
        }
    }

    function handleRegisterError(error) {
        if (disposed) return;
        const message = describeError(error);
        // Offline, the update check that comes with register() fails although the active worker
        // still serves the app.
        if (navigatorRef?.serviceWorker?.controller) {
            update({
                status: snapshot.status === 'registering' ? 'registered' : snapshot.status,
                error: message,
            });
            return;
        }
        update({ status: 'error', error: message });
        emit(PWA_EVENTS.error, { error });
    }

    // Registers once the page has loaded, so the precache downloads do not compete with the
    // start-up. Returns false where service workers are unavailable.
    function start() {
        if (disposed) return false;
        if (started) return snapshot.status !== 'unsupported';
        started = true;
        if (embedded || !navigatorRef || !('serviceWorker' in navigatorRef)) {
            update({ status: 'unsupported' });
            return false;
        }
        update({ status: 'registering' });
        updateServiceWorker = registerSW({
            immediate: false,
            onOfflineReady: () => {
                if (!disposed) handleOfflineReady();
            },
            onNeedRefresh: () => {
                if (!disposed) handleNeedRefresh();
            },
            onNeedReload: () => {
                if (!disposed) reload();
            },
            onRegisteredSW: handleRegistered,
            onRegisterError: handleRegisterError,
        });
        return true;
    }

    // Activates the waiting version; the page reloads as soon as it controls the page.
    function applyUpdate() {
        if (disposed || !snapshot.updateReady || typeof updateServiceWorker !== 'function') {
            return false;
        }
        update({ status: 'updating' });
        Promise.resolve()
            .then(() => updateServiceWorker(true))
            .catch((error) => update({ status: 'update-ready', error: describeError(error) }));
        return true;
    }

    // Asks the browser to look for a new sw.js now; start() also does this every
    // `updateInterval` ms for long sessions. Resolves to whether a check ran.
    async function checkForUpdate() {
        if (disposed || !registration || registration.installing) return false;
        if (navigatorRef?.onLine === false) return false;
        try {
            await registration.update();
            return true;
        } catch {
            return false;
        }
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    // The registration stays; only this controller stops reacting and checking.
    function dispose() {
        if (disposed) return;
        if (updateTimer !== null) timers.clearInterval(updateTimer);
        updateTimer = null;
        listeners.clear();
        disposed = true;
    }

    return Object.freeze({
        start,
        applyUpdate,
        checkForUpdate,
        subscribe,
        getSnapshot: () => snapshot,
        dispose,
    });
}
