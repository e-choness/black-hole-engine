import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import {
    bundledPackages,
    composeLegalNotice,
    legalNoticePlugin,
    packageDirectory,
    sourceUrl,
} from '../../config/legal-notice.js';

const root = mkdtempSync(path.join(tmpdir(), 'legal-notice-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function writePackage(location, manifest, files = {}) {
    const directory = path.join(root, 'node_modules', location);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest));
    for (const [name, text] of Object.entries(files)) {
        writeFileSync(path.join(directory, name), text);
    }
}

writePackage(
    'alpha',
    { name: 'alpha', version: '1.0.0', license: 'MIT', repository: 'git+https://x.test/a.git' },
    { LICENSE: 'MIT alpha\n' },
);
writePackage(
    '@scope/beta',
    {
        name: '@scope/beta',
        version: '2.0.0',
        license: { type: 'ISC' },
        repository: 'scope/beta',
        author: { name: 'Beta Org', email: 'beta@x.test' },
    },
    { 'LICENSE.md': 'ISC beta, with ``` inside' },
);
writePackage('alpha/node_modules/gamma', {
    name: 'gamma',
    version: '3.0.0',
    license: 'MIT',
    author: 'Gamma Author <gamma@x.test> (https://x.test/gamma)',
});
writePackage(
    'dual',
    { name: 'dual', version: '1.0.0', license: '(MIT OR Apache-2.0)' },
    { 'LICENSE-MIT': 'MIT dual', 'LICENSE-APACHE': 'Apache dual' },
);
writePackage('font', { name: 'font', version: '5.0.0', license: 'OFL-1.1' }, { LICENSE: 'OFL' });
writePackage('vite', { name: 'vite', version: '8.0.0', license: 'MIT' }, { 'LICENSE.md': 'V' });
writePackage('rolldown', { name: 'rolldown', version: '1.0.0', license: 'MIT' }, { LICENSE: 'R' });
writePackage('vite-plugin-pwa', { name: 'vite-plugin-pwa', version: '2.0.0', license: 'MIT' });
writePackage('extra', { name: 'extra', version: '1.0.0', license: 'MIT' }, { LICENSE: 'E' });
writePackage('unlicensed', { name: 'unlicensed', version: '1.0.0' });
writeFileSync(path.join(root, 'LICENSE.md'), '# Project terms\n\n```text\nMIT upstream\n```\n');

const modules = (...moduleIds) => ({ 'index.js': { type: 'chunk', moduleIds } });
const inRoot = (...segments) => path.join(root, ...segments);

const BUNDLE = {
    'index.js': {
        type: 'chunk',
        moduleIds: [
            inRoot('src', 'main.js'),
            inRoot('node_modules', 'alpha', 'index.js'),
            `${inRoot('node_modules', 'alpha', 'node_modules', 'gamma', 'x.js')}?commonjs-proxy`,
            inRoot('node_modules', '@scope', 'beta', 'dist', 'b.js'),
            inRoot('node_modules', 'dual', 'index.js'),
            '\0vite/preload-helper.js',
            '__vite-browser-external',
            '\0rolldown/runtime.js',
            '/@vite-plugin-pwa/virtual:pwa-register',
        ],
    },
    'assets/x.woff2': { type: 'asset', originalFileNames: ['node_modules/font/files/x.woff2'] },
    'assets/index.css': { type: 'asset', originalFileNames: ['index.html'] },
    'manifest.webmanifest': { type: 'asset' },
};

test('packageDirectory finds the innermost package of a file, scoped or not', () => {
    assert.equal(packageDirectory('/app/node_modules/three/build/x.js'), '/app/node_modules/three');
    assert.equal(packageDirectory('/app/node_modules/@s/p/a/b.js'), '/app/node_modules/@s/p');
    assert.equal(
        packageDirectory('/app/node_modules/a/node_modules/b/c.js?raw'),
        '/app/node_modules/a/node_modules/b',
    );
    assert.equal(packageDirectory('C:\\p\\node_modules\\q\\r.js'), 'C:/p/node_modules/q');
    assert.equal(packageDirectory('/app/src/main.js'), null);
    assert.equal(packageDirectory('/app/node_modules/@scope'), null);
});

test('sourceUrl turns package.json repositories into browsable URLs', () => {
    assert.equal(sourceUrl('git+https://github.com/a/b.git'), 'https://github.com/a/b');
    assert.equal(sourceUrl({ url: 'git://github.com/a/b.git' }), 'https://github.com/a/b');
    assert.equal(sourceUrl('git+ssh://git@github.com/a/b.git'), 'https://github.com/a/b');
    assert.equal(sourceUrl('git@gitlab.com:a/b.git'), 'https://gitlab.com/a/b');
    assert.equal(sourceUrl('github:a/b'), 'https://github.com/a/b');
    assert.equal(sourceUrl('a/b'), 'https://github.com/a/b');
    assert.equal(sourceUrl({ type: 'git', url: 'https://x.test/y' }), 'https://x.test/y');
    assert.equal(sourceUrl(undefined), null);
});

test('bundledPackages attributes modules, virtual modules, assets and extras', () => {
    const packages = bundledPackages(BUNDLE, { root, extra: ['extra'] });
    assert.deepEqual(
        packages.map((pkg) => `${pkg.name}@${pkg.version}`),
        [
            '@scope/beta@2.0.0',
            'alpha@1.0.0',
            'dual@1.0.0',
            'extra@1.0.0',
            'font@5.0.0',
            'gamma@3.0.0',
            'rolldown@1.0.0',
            'vite@8.0.0',
            'vite-plugin-pwa@2.0.0',
        ],
    );
    const byName = Object.fromEntries(packages.map((pkg) => [pkg.name, pkg]));
    assert.deepEqual(byName.alpha, {
        name: 'alpha',
        version: '1.0.0',
        license: 'MIT',
        author: null,
        source: 'https://x.test/a',
        text: 'MIT alpha',
    });
    assert.equal(byName['@scope/beta'].license, 'ISC');
    assert.equal(byName['@scope/beta'].author, 'Beta Org');
    assert.equal(byName['@scope/beta'].source, 'https://github.com/scope/beta');
    assert.equal(byName.dual.text, 'Apache dual\n\nMIT dual');
    assert.equal(byName.gamma.author, 'Gamma Author');
    assert.equal(byName.gamma.text, null);
});

test('bundledPackages refuses modules and packages it cannot attribute', () => {
    assert.throws(() => bundledPackages(modules('\0unknown-plugin/helper.js'), { root }), {
        message: /"\\u0000unknown-plugin\/helper\.js".*VIRTUAL_MODULE_PACKAGES/,
    });
    assert.throws(() => bundledPackages(modules(), { root, extra: ['missing'] }), {
        message: /no package\.json in .*missing/,
    });
    assert.throws(
        () => bundledPackages(modules(inRoot('node_modules', 'unlicensed', 'i.js')), { root }),
        { message: /unlicensed declares no license and ships no license file/ },
    );
});

test('composeLegalNotice keeps every text intact inside a fence it cannot close', () => {
    const notice = composeLegalNotice({
        license: '# Terms\n\n```text\nMIT\n```\n',
        packages: bundledPackages(BUNDLE, { root }),
    });
    assert.ok(notice.startsWith('# Legal\n\n## Project license\n\n````text\n# Terms\n'));
    assert.match(notice, /\n```\n````\n\n## Third-party packages\n/);
    assert.match(
        notice,
        /### @scope\/beta 2\.0\.0 \(ISC\)\n\nSource: <https:\/\/github\.com\/scope\/beta>\n\n````text\nISC beta, with ``` inside\n````/,
    );
    assert.match(
        notice,
        /### alpha 1\.0\.0 \(MIT\)\n\nSource: <https:\/\/x\.test\/a>\n\n```text\n/,
    );
    assert.match(
        notice,
        /### gamma 3\.0\.0 \(MIT\)\n\nThe package ships no license file; its package\.json declares MIT and names Gamma Author as its author\.\n/,
    );
    assert.doesNotMatch(notice, /x\.test\/gamma|@x\.test/);
    assert.ok(
        notice.endsWith(
            '### vite-plugin-pwa 2.0.0 (MIT)\n\nThe package ships no license file; its package.json declares MIT.\n',
        ),
    );
});

function emittedNotice(bundle) {
    const files = [];
    const plugin = legalNoticePlugin({ root, extraPackages: ['extra'] });
    plugin.generateBundle.call({ emitFile: (file) => files.push(file) }, {}, bundle);
    assert.equal(files.length, 1);
    assert.equal(files[0].type, 'asset');
    assert.equal(files[0].fileName, 'docs/LEGAL.md');
    return files[0].source;
}

test('a build assembles the notice from LICENSE.md and the bundled packages', () => {
    const notice = emittedNotice(BUNDLE);
    assert.match(notice, /````text\n# Project terms\n\n```text\nMIT upstream\n```\n````/);
    for (const heading of ['alpha 1.0.0 (MIT)', 'extra 1.0.0 (MIT)', 'font 5.0.0 (OFL-1.1)']) {
        assert.ok(notice.includes(`\n### ${heading}\n`), heading);
    }
});

test('a build ships the curated notice when the checkout has one, and still attributes', () => {
    mkdirSync(inRoot('docs'), { recursive: true });
    writeFileSync(inRoot('docs', 'LEGAL.md'), '# Curated\n');
    try {
        assert.equal(emittedNotice(BUNDLE), '# Curated\n');
        assert.throws(() => emittedNotice(modules('\0unknown-plugin/helper.js')), {
            message: /VIRTUAL_MODULE_PACKAGES/,
        });
    } finally {
        rmSync(inRoot('docs'), { recursive: true, force: true });
    }
});
