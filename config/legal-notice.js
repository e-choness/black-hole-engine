import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE_MODULES = '/node_modules/';
const LICENSE_FILE = /^(licen[cs]e|copying)([.-][\w.-]+)?$/i;

// Bundled modules without a file in node_modules, mapped to the package their code comes from:
// Vite's preload helper and its empty stand-in for Node.js built-ins, Rolldown's runtime and
// vite-plugin-pwa's registration module. Any other such module fails the build until it is added.
export const VIRTUAL_MODULE_PACKAGES = [
    [/^\0vite\/|^__vite-browser-external/, 'vite'],
    [/^\0rolldown\/runtime/, 'rolldown'],
    [/^\/@vite-plugin-pwa\//, 'vite-plugin-pwa'],
];

const toPosix = (file) => file.replaceAll('\\', '/');

// The package a file belongs to: the directory after the last node_modules segment, which is the
// innermost install of a nested dependency, including the scope of a scoped package.
export function packageDirectory(file) {
    const posix = toPosix(file.split('?')[0]);
    const at = posix.lastIndexOf(NODE_MODULES);
    if (at < 0) return null;
    const segments = posix.slice(at + NODE_MODULES.length).split('/');
    const depth = segments[0].startsWith('@') ? 2 : 1;
    if (segments.length <= depth) return null;
    return posix.slice(0, at + NODE_MODULES.length) + segments.slice(0, depth).join('/');
}

// A browsable URL for a package.json repository: git+https, git://, ssh:// and git@host:path URLs
// become https URLs, and the github:owner/name and owner/name shorthands point at GitHub.
export function sourceUrl(repository) {
    const url = typeof repository === 'string' ? repository : repository?.url;
    if (!url) return null;
    if (/^(github:)?[\w.-]+\/[\w.-]+$/.test(url)) {
        return `https://github.com/${url.replace(/^github:/, '')}`;
    }
    return url
        .replace(/^git\+/, '')
        .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
        .replace(/^git@([^:/]+):/, 'https://$1/')
        .replace(/\.git$/, '');
}

function declaredLicense(manifest) {
    if (typeof manifest.license === 'string') return manifest.license;
    if (manifest.license?.type) return manifest.license.type;
    if (Array.isArray(manifest.licenses)) {
        return manifest.licenses.map((entry) => entry.type ?? entry).join(' OR ');
    }
    return null;
}

// The author's name, without the e-mail address and URL that the "Name <mail> (url)" form adds.
function authorName(author) {
    const name = typeof author === 'string' ? author.replace(/\s*[<(].*$/, '') : author?.name;
    return name?.trim() || null;
}

function readPackage(directory) {
    const manifestPath = path.join(directory, 'package.json');
    if (!existsSync(manifestPath)) {
        throw new Error(`black-hole:legal-notice: no package.json in ${directory}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const licenseFiles = readdirSync(directory)
        .filter((name) => LICENSE_FILE.test(name))
        .sort();
    const license = declaredLicense(manifest);
    if (!license && licenseFiles.length === 0) {
        throw new Error(
            `black-hole:legal-notice: ${manifest.name} declares no license and ships no license file`,
        );
    }
    return {
        name: manifest.name,
        version: manifest.version,
        license: license ?? 'see the license text',
        author: authorName(manifest.author),
        source: sourceUrl(manifest.repository) ?? manifest.homepage ?? null,
        text: licenseFiles.length
            ? licenseFiles
                  .map((name) => readFileSync(path.join(directory, name), 'utf8').trim())
                  .join('\n\n')
            : null,
    };
}

// Every package with code or assets in the bundle, plus `extra` packages whose code reaches the
// site outside the module graph, sorted by name. Modules under `root` and outside node_modules
// are the project's own.
export function bundledPackages(bundle, { root = ROOT, extra = [] } = {}) {
    const base = `${toPosix(path.resolve(root)).replace(/\/$/, '')}/`;
    const directories = new Set(extra.map((name) => `${base}node_modules/${name}`));
    const attribute = (id) => {
        const directory = packageDirectory(id);
        if (directory) {
            directories.add(directory);
            return;
        }
        if (toPosix(id).startsWith(base)) return;
        const match = VIRTUAL_MODULE_PACKAGES.find(([pattern]) => pattern.test(id));
        if (!match) {
            throw new Error(
                `black-hole:legal-notice: cannot tell which package the bundled module ${JSON.stringify(id)} comes from; map it in VIRTUAL_MODULE_PACKAGES (config/legal-notice.js)`,
            );
        }
        directories.add(`${base}node_modules/${match[1]}`);
    };
    for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') output.moduleIds.forEach(attribute);
        else
            (output.originalFileNames ?? []).forEach((name) => attribute(path.resolve(root, name)));
    }
    const packages = new Map();
    for (const directory of directories) {
        const data = readPackage(directory);
        packages.set(`${data.name}@${data.version}`, data);
    }
    return [...packages.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );
}

// A fence one backtick longer than any run of backticks in the text, so the text cannot close it.
function fenced(text) {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}text\n${text}\n${fence}`;
}

export function composeLegalNotice({ license, packages }) {
    const sections = packages.map((pkg) => {
        const lines = [`### ${pkg.name} ${pkg.version} (${pkg.license})`, ''];
        if (pkg.source) lines.push(`Source: <${pkg.source}>`, '');
        const author = pkg.author ? ` and names ${pkg.author} as its author` : '';
        lines.push(
            pkg.text
                ? fenced(pkg.text)
                : `The package ships no license file; its package.json declares ${pkg.license}${author}.`,
        );
        return lines.join('\n');
    });
    return [
        '# Legal',
        '',
        '## Project license',
        '',
        fenced(license.trim()),
        '',
        '## Third-party packages',
        '',
        'The site bundles code and fonts from these packages. Minification strips their license',
        'comments, so their license files follow.',
        '',
        sections.join('\n\n'),
        '',
    ].join('\n');
}

// The help sheet links to docs/LEGAL.md, so every build ships one next to the page. A checkout
// that has the curated notice (docs/ is not tracked) ships it as it is; any other build assembles
// one from LICENSE and the license files of the bundled packages. Every build attributes each
// bundled module, so a module of unknown origin fails local builds as well.
export function legalNoticePlugin({ root = ROOT, extraPackages = [] } = {}) {
    return {
        name: 'black-hole:legal-notice',
        apply: 'build',
        generateBundle(_, bundle) {
            const packages = bundledPackages(bundle, { root, extra: extraPackages });
            const curated = path.join(root, 'docs', 'LEGAL.md');
            const source = existsSync(curated)
                ? readFileSync(curated, 'utf8')
                : composeLegalNotice({
                      license: readFileSync(path.join(root, 'LICENSE'), 'utf8'),
                      packages,
                  });
            this.emitFile({ type: 'asset', fileName: 'docs/LEGAL.md', source });
        },
    };
}
