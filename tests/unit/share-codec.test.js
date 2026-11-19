import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
    createViewStateCodec,
    validateViewStateSchema,
    VIEW_STATE_ISSUES,
    VIEW_STATE_MAX_LENGTH,
} from '../../src/features/share/view-state-codec.js';

// One field of every kind.
const DEMO = {
    version: 1,
    fields: [
        { key: 'n', path: 'linear', type: 'number', default: 0.5, min: -1, max: 1, step: 0.01 },
        {
            key: 'm',
            path: 'mass',
            type: 'number',
            scale: 'log',
            default: 6.5e9,
            min: 1,
            max: 1e11,
            digits: 4,
        },
        {
            key: 'r',
            path: 'radius',
            type: 'number',
            default: null,
            nullable: true,
            min: 0,
            max: 10,
            step: 0.5,
        },
        { key: 'b', path: 'flag', type: 'bool', default: true },
        {
            key: 'e',
            path: 'mode',
            type: 'enum',
            default: 'thin',
            values: [
                ['thin', 't'],
                ['thick', 'k'],
                [2, 'two'],
            ],
        },
        {
            key: 's',
            path: 'preset',
            type: 'slug',
            default: 'm87-star',
            maxLength: 12,
            allowEmpty: true,
        },
        {
            key: 'c',
            path: 'angles',
            type: 'vec',
            default: [0, -3],
            components: [
                { min: -180, max: 180, step: 0.1, wrap: true },
                { min: -90, max: 90, step: 0.1 },
            ],
        },
        {
            key: 't',
            path: 'time',
            type: 'number',
            default: 0,
            min: 0,
            max: 1000,
            step: 0.01,
            volatile: true,
        },
    ],
};

const codec = createViewStateCodec([DEMO]);

const reasons = (result) => result.issues.map((issue) => [issue.reason, issue.key]);

// xorshift32: deterministic pseudo-random numbers in [0, 1).
function random(seed) {
    let state = seed >>> 0 || 1;
    return () => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 4294967296;
    };
}

// Raw values that partly lie outside the ranges, to exercise clamping on the way in.
function randomState(fields, next) {
    const state = {};
    const pick = (list) => list[Math.floor(next() * list.length)];
    const numberIn = (spec) => {
        if (spec.scale === 'log') {
            const low = Math.log10(spec.min) - 1;
            const high = Math.log10(spec.max) + 1;
            return 10 ** (low + (high - low) * next());
        }
        const span = spec.max - spec.min;
        return spec.min - 0.2 * span + 1.4 * span * next();
    };
    for (const field of fields) {
        if (next() < 0.3) continue;
        if (field.type === 'number') {
            state[field.path] = field.nullable && next() < 0.3 ? null : numberIn(field);
        } else if (field.type === 'bool') state[field.path] = next() < 0.5;
        else if (field.type === 'enum') state[field.path] = pick(field.values)[0];
        else if (field.type === 'slug') state[field.path] = pick(['', 'sgr-a-star', 'ton-618']);
        else state[field.path] = field.components.map(numberIn);
    }
    return state;
}

test('the defaults encode to the bare version and decode back', () => {
    assert.equal(codec.version, 1);
    assert.equal(codec.maxLength, VIEW_STATE_MAX_LENGTH);
    assert.equal(codec.encode(codec.defaults()), 'v=1');
    assert.equal(codec.encode({}), 'v=1');
    const decoded = codec.decode('#v=1');
    assert.deepEqual(decoded, { state: codec.defaults(), issues: [], version: 1, present: true });
    assert.deepEqual(codec.defaults(), {
        linear: 0.5,
        mass: 6.5e9,
        radius: null,
        flag: true,
        mode: 'thin',
        preset: 'm87-star',
        angles: [0, -3],
        time: 0,
    });
    const first = codec.defaults();
    first.angles[0] = 99;
    assert.deepEqual(codec.defaults().angles, [0, -3], 'defaults are fresh copies');
});

test('only fields that differ from their defaults are written, in schema order', () => {
    assert.equal(
        codec.encode({ mode: 'thick', angles: [12.34, 5], flag: false, linear: -0.25 }),
        'v=1&n=-0.25&b=0&e=k&c=12.3,5',
    );
    assert.equal(codec.encode({ mode: 2, preset: '', radius: 2.5 }), 'v=1&r=2.5&e=two&s=');
    assert.equal(codec.encode({ linear: 0.1 + 0.2 }), 'v=1&n=0.3');
    assert.equal(codec.encode({ linear: -0.004 }), 'v=1&n=0', 'no negative zero');
    assert.equal(codec.encode({ linear: 0.504 }), 'v=1', 'rounds onto the default');
});

test('log-scale numbers keep significant digits in the shorter notation', () => {
    const text = (mass) => codec.encode({ mass });
    assert.equal(text(4.2971e6), 'v=1&m=4.297e6');
    assert.equal(text(6.51e9), 'v=1&m=6.51e9');
    assert.equal(text(21.2), 'v=1&m=21.2');
    assert.equal(text(12345), 'v=1&m=12350');
    assert.equal(text(1e11), 'v=1&m=1e11');
    assert.equal(text(1), 'v=1&m=1');
    assert.equal(codec.decode('v=1&m=4.297e6').state.mass, 4.297e6);
    assert.equal(codec.decode('v=1&m=4.29712e+6').state.mass, 4.297e6);
});

test('angles wrap around instead of being clamped', () => {
    const angles = (text) => codec.decode(`v=1&c=${text}`);
    assert.deepEqual(angles('190,-3').state.angles, [-170, -3]);
    assert.deepEqual(angles('180,-3').state.angles, [-180, -3]);
    assert.deepEqual(angles('-540.04,-3').state.angles, [-180, -3]);
    assert.deepEqual(angles('179.97,-3').state.angles, [-180, -3]);
    assert.deepEqual(angles('190,-3').issues, []);
    assert.deepEqual(reasons(angles('10,95')), [['clamped', 'c']]);
    assert.deepEqual(angles('10,95').state.angles, [10, 90]);
});

test('bad values fall back to defaults or are clamped, and every repair is reported', () => {
    const cases = [
        ['n=5', { linear: 1 }, [['clamped', 'n']]],
        ['n=-1.004', { linear: -1 }, []],
        ['n=abc', {}, [['invalid', 'n']]],
        ['n=', {}, [['invalid', 'n']]],
        ['n=1e999', {}, [['invalid', 'n']]],
        ['n=0x10', {}, [['invalid', 'n']]],
        ['n=NaN', {}, [['invalid', 'n']]],
        ['n=Infinity', {}, [['invalid', 'n']]],
        ['n=.25', { linear: 0.25 }, []],
        ['n=%2B0.25', { linear: 0.25 }, []],
        ['m=0', { mass: 1 }, [['clamped', 'm']]],
        ['m=2e11', { mass: 1e11 }, [['clamped', 'm']]],
        ['b=0', { flag: false }, []],
        ['b=false', { flag: false }, []],
        ['b=true', { flag: true }, []],
        ['b=yes', {}, [['invalid', 'b']]],
        ['e=zz', {}, [['unknown-value', 'e']]],
        ['e=K', {}, [['unknown-value', 'e']]],
        ['s=', { preset: '' }, []],
        ['s=Bad_Slug', {}, [['invalid', 's']]],
        ['s=-ab', {}, [['invalid', 's']]],
        [`s=${'a'.repeat(13)}`, {}, [['invalid', 's']]],
        ['c=1,2,3', {}, [['invalid', 'c']]],
        ['c=1', {}, [['invalid', 'c']]],
        ['c=1,x', {}, [['invalid', 'c']]],
        ['c=10%2C-3.5', { angles: [10, -3.5] }, []],
        ['r=', {}, []],
        ['r=12', { radius: 10 }, [['clamped', 'r']]],
        ['zz=1', {}, [['unknown-key', 'zz']]],
        ['n=0.1&n=0.2', { linear: 0.1 }, [['duplicate', 'n']]],
        ['v=1', {}, [['duplicate', 'v']]],
        ['n=%E0%A4%A', {}, [['invalid', 'n']]],
        ['n', {}, [['invalid', 'n']]],
    ];
    for (const [text, changes, expected] of cases) {
        const decoded = codec.decode(`#v=1&${text}`);
        assert.equal(decoded.present, true, text);
        assert.deepEqual(decoded.state, { ...codec.defaults(), ...changes }, text);
        assert.deepEqual(reasons(decoded), expected, text);
        for (const issue of decoded.issues) assert.ok(VIEW_STATE_ISSUES.includes(issue.reason));
    }
    const clamped = codec.decode('v=1&n=5').issues[0];
    assert.deepEqual(clamped, { reason: 'clamped', key: 'n', path: 'linear', value: '5' });
    const long = codec.decode(`v=1&zz=${'x'.repeat(200)}`).issues[0];
    assert.equal(long.value.length, 64, 'reported values are shortened');
});

test('fragments without a view state leave the app alone', () => {
    const expectNothing = (source, expected) => {
        const decoded = codec.decode(source);
        assert.equal(decoded.present, false, String(source));
        assert.equal(decoded.version, null);
        assert.deepEqual(decoded.state, codec.defaults());
        assert.deepEqual(reasons(decoded), expected, String(source));
    };
    expectNothing('', []);
    expectNothing('#', []);
    expectNothing(undefined, []);
    expectNothing(null, []);
    expectNothing('#about', [['not-a-view-state', null]]);
    expectNothing('#v=7&n=0.2', [['unsupported-version', 'v']]);
    expectNothing('#v=one', [['unsupported-version', 'v']]);
    expectNothing('#v=&n=0.2', [['unsupported-version', 'v']]);
    const long = `#v=1${'&n=0.1'.repeat(400)}`;
    assert.ok(long.length > VIEW_STATE_MAX_LENGTH);
    expectNothing(long, [['too-long', null]]);
});

test('decode() takes URLs, Location-like objects and bare fragments', () => {
    const mode = (source) => codec.decode(source).state.mode;
    assert.equal(mode('https://example.org/app/?quality=low#v=1&e=k'), 'thick');
    assert.equal(mode(new URL('https://example.org/#v=1&e=k')), 'thick');
    assert.equal(mode({ hash: '#v=1&e=k' }), 'thick');
    assert.equal(mode('v=1&e=k'), 'thick');
    assert.equal(mode('#&&v=1&&e=k&'), 'thick');
});

test('random states survive encode and decode unchanged', () => {
    const next = random(20261119);
    for (let i = 0; i < 300; i += 1) {
        const raw = randomState(DEMO.fields, next);
        const { state } = codec.normalize(raw);
        const text = codec.encode(state);
        assert.equal(codec.encode(raw), text);
        const decoded = codec.decode(`#${text}`);
        assert.deepEqual(decoded.issues, [], text);
        assert.deepEqual(decoded.state, state, text);
        assert.equal(codec.encode(decoded.state), text);
    }
});

test('volatile fields can be left out of a fragment', () => {
    const state = { time: 12.5, linear: 0 };
    assert.equal(codec.encode(state), 'v=1&n=0&t=12.5');
    assert.equal(codec.encode(state, { volatile: false }), 'v=1&n=0');
});

test('normalize() repairs values coming from the app and says what it changed', () => {
    const { state, issues } = codec.normalize({
        linear: Number.NaN,
        mass: -5,
        flag: 'yes',
        mode: 'nope',
        preset: 42,
        angles: [1],
        time: '12.5',
        unrelated: true,
    });
    assert.deepEqual(state, { ...codec.defaults(), mass: 1, time: 12.5 });
    assert.deepEqual(
        issues.map((issue) => [issue.reason, issue.key, issue.value]),
        [
            ['invalid', 'n', 'NaN'],
            ['clamped', 'm', '-5'],
            ['invalid', 'b', 'yes'],
            ['unknown-value', 'e', 'nope'],
            ['invalid', 's', '42'],
            ['invalid', 'c', '1'],
        ],
    );
    assert.equal(codec.normalize({ mode: '2' }).state.mode, 2, 'enum values match by text');
    assert.deepEqual(codec.normalize(null), { state: codec.defaults(), issues: [] });
    assert.deepEqual(codec.normalize('v=1&n=0'), { state: codec.defaults(), issues: [] });
});

test('links of an older version are migrated and keep their meaning', () => {
    const V1 = {
        version: 1,
        fields: [
            { key: 'a', path: 'a', type: 'number', default: 1, min: 0, max: 10, step: 1 },
            { key: 'o', path: 'old', type: 'number', default: 5, min: 0, max: 60, step: 1 },
        ],
    };
    const V2 = {
        version: 2,
        fields: [
            { key: 'a', path: 'a', type: 'number', default: 2, min: 0, max: 10, step: 1 },
            { key: 'n', path: 'renamed', type: 'number', default: 5, min: 0, max: 100, step: 1 },
            {
                key: 'x',
                path: 'extra',
                type: 'enum',
                default: 'x',
                values: [
                    ['x', 'x'],
                    ['y', 'y'],
                ],
            },
        ],
        migrate: (previous, carried) => ({ ...carried, renamed: previous.old * 2 }),
    };
    const migrating = createViewStateCodec([V1, V2]);
    assert.equal(migrating.version, 2);
    const decode = (text) => migrating.decode(text);
    assert.deepEqual(decode('v=1').state, { a: 1, renamed: 10, extra: 'x' });
    assert.equal(decode('v=1').version, 1);
    assert.deepEqual(decode('v=1&a=3&o=7').state, { a: 3, renamed: 14, extra: 'x' });
    assert.deepEqual(decode('v=2&a=3').state, { a: 3, renamed: 5, extra: 'x' });
    assert.deepEqual(reasons(decode('v=1&o=60')), [['clamped', 'n']]);
    assert.deepEqual(decode('v=1&o=60').state.renamed, 100);
    assert.deepEqual(reasons(decode('v=1&n=3')), [['unknown-key', 'n']]);
    assert.equal(migrating.encode({ a: 1 }), 'v=2&a=1');
    assert.equal(migrating.encode(decode('v=1').state), 'v=2&a=1&n=10');

    const carried = createViewStateCodec([V1, { ...V2, migrate: undefined }]);
    assert.deepEqual(carried.decode('v=1&o=7').state, { a: 1, renamed: 5, extra: 'x' });
});

test('schemas are checked before any link is read', () => {
    const field = { key: 'a', path: 'a', type: 'number', default: 0, min: 0, max: 1, step: 0.1 };
    const problems = (fields, extra = {}, options) =>
        validateViewStateSchema({ version: 1, fields, ...extra }, options);
    assert.deepEqual(problems([field]), []);
    const expectProblem = (fields, pattern, extra, options) => {
        const found = problems(fields, extra, options);
        assert.ok(
            found.some((problem) => pattern.test(problem)),
            `${pattern}: ${found.join('; ')}`,
        );
    };
    expectProblem([field, { ...field, path: 'b' }], /duplicate key/);
    expectProblem([field, { ...field, key: 'b' }], /duplicate path/);
    expectProblem([{ ...field, key: 'v' }], /key must be/);
    expectProblem([{ ...field, key: 'Ab' }], /key must be/);
    expectProblem([{ ...field, path: '' }], /path is required/);
    expectProblem([{ ...field, type: 'date' }], /unknown type/);
    expectProblem([{ ...field, min: 0.05 }], /multiples of step/);
    expectProblem([{ ...field, step: 0 }], /step must be/);
    expectProblem([{ ...field, min: 2 }], /min < max/);
    expectProblem([{ ...field, default: 3 }], /not a normalized value/);
    expectProblem([{ ...field, default: 0.25 }], /not a normalized value/);
    expectProblem([{ ...field, default: null }], /not a normalized value/);
    expectProblem([{ ...field, scale: 'log', digits: 3 }], /log scale needs min > 0/);
    expectProblem(
        [{ ...field, scale: 'log', min: 1.2345, max: 10, digits: 3 }],
        /at most 3 digits/,
    );
    expectProblem([{ ...field, scale: 'sqrt' }], /unknown scale/);
    expectProblem([{ ...field, history: 'replace' }], /history must be/);
    expectProblem([{ ...field, paths: ['x'] }], /only vec fields/);
    expectProblem(
        [
            {
                key: 'e',
                path: 'e',
                type: 'enum',
                default: 1,
                values: [
                    [1, 'a'],
                    [2, 'a'],
                ],
            },
        ],
        /duplicate code/,
    );
    expectProblem(
        [{ key: 'e', path: 'e', type: 'enum', default: 1, values: [[1, 'a b']] }],
        /alphanumeric/,
    );
    expectProblem([{ key: 's', path: 's', type: 'slug', default: '', maxLength: 0 }], /maxLength/);
    expectProblem(
        [
            {
                key: 'c',
                path: 'c',
                type: 'vec',
                default: [0, 0],
                components: [field, field],
                paths: ['x'],
            },
        ],
        /one path per component/,
    );
    expectProblem(
        [{ key: 'c', path: 'c', type: 'vec', default: [0], components: [field] }],
        /at least two/,
    );
    expectProblem([field], /refine must accept the defaults/, {
        refine: (state, report) => report('a', 'clamped', state.a),
    });
    expectProblem([field], /refine must accept the defaults/, {
        refine: (state) => {
            state.a = 1;
        },
    });
    expectProblem([field], /refine must be a function/, { refine: 'yes' });
    expectProblem([field], /exceeds 8/, {}, { maxLength: 8 });
    assert.deepEqual(validateViewStateSchema({ version: 0, fields: [] }), [
        'version must be a positive integer',
        'fields must be a non-empty array',
    ]);

    assert.throws(() => createViewStateCodec([]), /at least one schema/);
    assert.throws(() => createViewStateCodec([{ version: 1, fields: [{ ...field, min: 2 }] }]), {
        name: 'TypeError',
        message: /version 1: field a: needs finite min < max/,
    });
    assert.throws(
        () =>
            createViewStateCodec([
                { version: 2, fields: [field] },
                { version: 1, fields: [field] },
            ]),
        /versions must increase/,
    );
    assert.equal(createViewStateCodec({ version: 3, fields: [field] }).version, 3);
});
