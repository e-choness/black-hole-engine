#!/bin/sh
# node_modules is a named volume that outlives image rebuilds: reinstall it whenever
# package-lock.json differs from the lockfile it was installed from. The directory itself is
# the lock so containers sharing the volume never install concurrently.
set -eu

lockfile=package-lock.json
stamp=node_modules/.package-lock.sha256

stamp_matches() {
    [ "$(cat "$stamp" 2>/dev/null || true)" = "$expected" ]
}

if [ -f "$lockfile" ] && [ -d node_modules ]; then
    expected=$(sha256sum "$lockfile" | cut -d ' ' -f 1)
    if ! stamp_matches; then
        exec 9<node_modules
        flock 9
        if ! stamp_matches; then
            echo "entrypoint: $lockfile changed, running npm ci" >&2
            npm ci
            echo "$expected" >"$stamp"
        fi
        exec 9<&-
    fi
fi

exec "$@"
