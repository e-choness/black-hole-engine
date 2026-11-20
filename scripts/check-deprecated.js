import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Fails when package-lock.json installs a version that its publisher has deprecated on the npm
// registry, the condition npm ci only warns about. The registry's abbreviated metadata carries the
// deprecation message of every version, so one request per package name answers it.
//   docker compose run --rm test npm run check:deprecated

const CONCURRENCY = 16;
const ABBREVIATED_METADATA = 'application/vnd.npm.install-v1+json';

// Every name@version the lockfile installs from a registry. Aliased packages (`"x": "npm:y@1"`)
// record the real name in their entry, so the registry is asked for the package that is actually
// installed. Links and workspace folders are local, so they are left out.
export function installedPackages(lock) {
    const installed = new Map();
    for (const [path, entry] of Object.entries(lock.packages ?? {})) {
        const folder = path.lastIndexOf('node_modules/');
        if (folder < 0 || entry.link || !entry.version) continue;
        const name = entry.name ?? path.slice(folder + 'node_modules/'.length);
        if (!installed.has(name)) installed.set(name, new Set());
        installed.get(name).add(entry.version);
    }
    return installed;
}

// [{ name, version, message }] for each installed version that the metadata marks deprecated.
export function deprecatedVersions(name, versions, metadata) {
    const found = [];
    for (const version of versions) {
        const message = metadata.versions?.[version]?.deprecated;
        if (message) found.push({ name, version, message });
    }
    return found;
}

async function fetchMetadata(registry, name) {
    const response = await fetch(new URL(name.replace('/', '%2f'), registry), {
        headers: { accept: ABBREVIATED_METADATA },
    });
    if (!response.ok) throw new Error(`${name}: the registry answered ${response.status}`);
    return response.json();
}

async function main() {
    const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org/').replace(
        /\/?$/,
        '/',
    );
    const lock = JSON.parse(
        await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
    );
    const queue = [...installedPackages(lock)];
    const total = queue.length;
    const deprecated = [];
    await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
            for (let next = queue.pop(); next; next = queue.pop()) {
                const [name, versions] = next;
                deprecated.push(
                    ...deprecatedVersions(name, versions, await fetchMetadata(registry, name)),
                );
            }
        }),
    );
    if (deprecated.length === 0) {
        console.log(`None of the ${total} installed packages is deprecated.`);
        return;
    }
    deprecated.sort((a, b) => a.name.localeCompare(b.name));
    for (const { name, version, message } of deprecated) {
        console.error(`${name}@${version} is deprecated: ${message}`);
    }
    console.error('Update the package or the dependency that brings it in (npm ls <name>).');
    process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await main();
}
