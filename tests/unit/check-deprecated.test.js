import { test } from 'vitest';
import assert from 'node:assert/strict';
import { deprecatedVersions, installedPackages } from '../../scripts/check-deprecated.js';

const lock = {
    packages: {
        '': { name: 'black-hole', dependencies: { alpha: '^1.0.0' } },
        'node_modules/alpha': { version: '1.0.0' },
        'node_modules/@scope/beta': { version: '2.0.0' },
        'node_modules/alpha/node_modules/@scope/beta': { version: '1.5.0' },
        'node_modules/aliased': { name: 'real-name', version: '3.0.0' },
        'node_modules/linked': { resolved: 'packages/linked', link: true },
        'packages/linked': { version: '0.0.1' },
    },
};

test('lists every installed name and version, nested and aliased ones under their real name, local ones left out', () => {
    const installed = installedPackages(lock);
    assert.deepEqual(
        [...installed].map(([name, versions]) => [name, [...versions].sort()]),
        [
            ['alpha', ['1.0.0']],
            ['@scope/beta', ['1.5.0', '2.0.0']],
            ['real-name', ['3.0.0']],
        ],
    );
});

test('reports only the installed versions that the registry marks deprecated', () => {
    const metadata = {
        versions: {
            '1.5.0': { deprecated: 'Upgrade to 2' },
            '2.0.0': {},
            '0.9.0': { deprecated: 'Not installed' },
        },
    };
    assert.deepEqual(deprecatedVersions('@scope/beta', new Set(['1.5.0', '2.0.0']), metadata), [
        { name: '@scope/beta', version: '1.5.0', message: 'Upgrade to 2' },
    ]);
    assert.deepEqual(deprecatedVersions('alpha', new Set(['1.0.0']), {}), []);
});
