// Keeps the address bar in step with the view. On start-up and on back/forward navigation the view
// state in the fragment is decoded and handed to apply(). Local changes reported with schedule()
// are written back once they settle: with history.replaceState(), or with pushState() when a
// field marked history: 'push' changed (scenario mode, mass preset), so Back returns to the
// previous view. Volatile fields (simulation time, scenario radius) never reach the address bar;
// shareUrl() includes them. Writes wait for `delay` ms of quiet and come at most `maxWait` ms
// apart during continuous changes, because browsers throttle the History API (Safari allows 100
// calls per 30 s) and a URL that changes every frame is useless.
//
// read() returns the app's view state (partial states are filled with defaults);
// apply(state, { source: 'load' | 'navigation', issues, version }) applies a decoded one.

function sameValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    }
    return Object.is(a, b);
}

export function createViewStateSync({
    codec,
    read,
    apply,
    windowRef = globalThis.window,
    delay = 400,
    maxWait = 2000,
    timers = globalThis,
} = {}) {
    if (!codec || typeof read !== 'function' || typeof apply !== 'function') {
        throw new TypeError('createViewStateSync needs a codec, read() and apply()');
    }
    const pushFields = codec.fields.filter((field) => field.history === 'push');
    const bareEncoding = codec.encode(codec.defaults(), { volatile: false });
    let started = false;
    let disposed = false;
    let paused = false;
    let delayTimer = null;
    let maxTimer = null;
    let shownState = null;
    let shownEncoding = null;
    let lastFragment = null;

    const currentFragment = () => windowRef.location.hash.replace(/^#/, '');

    function clearTimers() {
        if (delayTimer !== null) timers.clearTimeout(delayTimer);
        if (maxTimer !== null) timers.clearTimeout(maxTimer);
        delayTimer = null;
        maxTimer = null;
    }

    function remember(state) {
        shownState = state;
        shownEncoding = codec.encode(state, { volatile: false });
    }

    // An empty fragment stands for the default view, i.e. the history entry before the first
    // change; a fragment that is not a view state (a plain anchor) is left alone.
    function handleLocation(source) {
        const fragment = currentFragment();
        if (fragment === lastFragment) return;
        lastFragment = fragment;
        const decoded = codec.decode(fragment);
        if (!decoded.present && (fragment !== '' || source === 'load')) {
            if (shownState === null) remember(codec.defaults());
            return;
        }
        clearTimers();
        remember(codec.normalize(decoded.state).state);
        apply(decoded.state, {
            source,
            issues: decoded.issues,
            version: decoded.version ?? codec.version,
        });
    }

    const onHashChange = () => handleLocation('navigation');
    const onPopState = () => handleLocation('navigation');

    function start() {
        if (started || disposed) return;
        started = true;
        windowRef.addEventListener('hashchange', onHashChange);
        windowRef.addEventListener('popstate', onPopState);
        handleLocation('load');
    }

    // Writes the current view now if it differs from what the address bar shows. history may be
    // 'push' or 'replace' to override the automatic choice. Returns whether the URL changed.
    function flush({ history = 'auto' } = {}) {
        clearTimers();
        if (!started || disposed || paused) return false;
        const { state } = codec.normalize(read());
        const encoding = codec.encode(state, { volatile: false });
        if (encoding === shownEncoding) return false;
        const push =
            history === 'push' ||
            (history === 'auto' &&
                pushFields.some((field) => !sameValue(shownState[field.path], state[field.path])));
        const fragment = encoding === bareEncoding ? '' : encoding;
        const { pathname, search } = windowRef.location;
        const url = `${pathname}${search}${fragment ? `#${fragment}` : ''}`;
        try {
            if (push) windowRef.history.pushState(null, '', url);
            else windowRef.history.replaceState(windowRef.history.state, '', url);
        } catch {
            // Throttled by the browser; the next schedule() tries again.
            return false;
        }
        remember(state);
        lastFragment = fragment;
        return true;
    }

    function schedule() {
        if (!started || disposed || paused) return;
        if (delayTimer !== null) timers.clearTimeout(delayTimer);
        delayTimer = timers.setTimeout(() => flush(), delay);
        if (maxTimer === null) maxTimer = timers.setTimeout(() => flush(), maxWait);
    }

    // While paused (presentation playback, recording) nothing is written; navigation still
    // reaches apply().
    function pause() {
        paused = true;
        clearTimers();
    }

    function resume() {
        if (!paused) return;
        paused = false;
        schedule();
    }

    // Link to the given (or current) view, volatile fields included. The query string is dropped:
    // it carries device and test switches such as ?quality=.
    function shareUrl(state = read()) {
        const { origin, pathname } = windowRef.location;
        return `${origin}${pathname}#${codec.encode(state)}`;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        clearTimers();
        windowRef.removeEventListener('hashchange', onHashChange);
        windowRef.removeEventListener('popstate', onPopState);
    }

    return Object.freeze({
        start,
        schedule,
        flush,
        pause,
        resume,
        shareUrl,
        dispose,
        get paused() {
            return paused;
        },
    });
}
