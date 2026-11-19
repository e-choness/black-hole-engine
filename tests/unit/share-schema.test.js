import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
    applyBoundViewState,
    collectViewState,
    DIVE_MIN_RADIUS,
    HOVER_MIN_RADIUS,
    ORBIT_MIN_DISTANCE,
    validateViewStateSchema,
    VIEW_STATE_MAX_LENGTH,
    VIEW_STATE_V1,
    VIEW_STATE_VERSIONS,
    viewStateCodec,
} from '../../src/features/share/index.js';
import { listMassPresets } from '../../src/features/units/presets.js';

// scenario-state.js reads localStorage while loading, and Node's built-in localStorage warns
// when it has no backing file, so the app modules are imported after stubbing it.
vi.stubGlobal('localStorage', { getItem: () => null });
const { Shader } = await import('../../src/app/core/shader.js');
const { Observer, OBSERVER_DISTANCE_MAX, OBSERVER_DISTANCE_MIN, OBSERVER_ORBIT_MIN } =
    await import('../../src/app/core/observer.js');
const { diveState, hoverState } = await import('../../src/app/core/scenarios/scenario-state.js');

const codec = viewStateCodec;
const reasons = (result) => result.issues.map((issue) => [issue.reason, issue.key]);

// The app's start-up state, resolved like path-bindings.js resolves presentation paths.
const shader = new Shader('');
const ROOTS = [
    ['cameraPan.', { x: 0, y: 0 }],
    ['observerState.', new Observer()],
    ['dive.', diveState],
    ['hover.', hoverState],
];

function appValue(path) {
    const [prefix, root] = ROOTS.find(([start]) => path.startsWith(start)) ?? [
        '',
        shader.parameters,
    ];
    return path
        .slice(prefix.length)
        .split('.')
        .reduce(
            (node, part) =>
                node !== undefined && Object.hasOwn(node, part) ? node[part] : undefined,
            root,
        );
}

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

test('version 1 is a valid, frozen schema', () => {
    assert.deepEqual(validateViewStateSchema(VIEW_STATE_V1), []);
    assert.equal(VIEW_STATE_VERSIONS.at(-1), VIEW_STATE_V1);
    assert.equal(codec.version, 1);
    assert.equal(codec.fields, VIEW_STATE_V1.fields);
    assert.ok(Object.isFrozen(VIEW_STATE_V1));
    assert.ok(Object.isFrozen(VIEW_STATE_V1.fields));
    assert.ok(VIEW_STATE_V1.fields.every((field) => Object.isFrozen(field)));
    assert.ok(Object.isFrozen(VIEW_STATE_V1.fields[0].default));
    assert.equal(VIEW_STATE_V1.fields.length, 78);
    assert.deepEqual(
        VIEW_STATE_V1.fields.filter((field) => field.history === 'push').map((field) => field.key),
        ['om', 'mp'],
    );
    assert.deepEqual(
        VIEW_STATE_V1.fields.filter((field) => field.volatile).map((field) => field.path),
        ['observerState.time', 'scenario.radius'],
    );
});

test('defaults and bound paths mirror the app at start-up', () => {
    for (const field of VIEW_STATE_V1.fields) {
        if (field.custom) continue;
        if (field.paths) {
            field.paths.forEach((path, index) => {
                assert.equal(appValue(path), field.default[index], path);
            });
            continue;
        }
        assert.deepEqual(appValue(field.path), field.default, field.path);
    }
    assert.equal(shader.parameters.observer.motion, false, 'scenario.mode starts static');
    assert.equal(diveState.active || hoverState.active || diveState.paused, false);
    assert.equal(ORBIT_MIN_DISTANCE, OBSERVER_ORBIT_MIN);
    assert.equal(HOVER_MIN_RADIUS, hoverState.minR);
    const distance = VIEW_STATE_V1.fields.find((field) => field.path === 'observer.distance');
    assert.deepEqual([distance.min, distance.max], [OBSERVER_DISTANCE_MIN, OBSERVER_DISTANCE_MAX]);
    const defaults = codec.defaults();
    assert.equal(defaults['scenario.preset'], 'default');
    assert.equal(defaults['disk.mass_msun'], shader.parameters.disk.mass_msun);
    assert.equal(defaults['disk.eddington_ratio'], shader.parameters.disk.eddington_ratio);
});

test('every mass preset can be carried by a link', () => {
    for (const preset of listMassPresets()) {
        const { state, issues } = codec.normalize({
            'scenario.preset': preset.id,
            'disk.mass_msun': preset.massSolar,
            'disk.eddington_ratio': preset.eddingtonRatio,
            'black_hole.spin': preset.spin,
        });
        assert.deepEqual(issues, [], preset.id);
        assert.equal(state['disk.mass_msun'], preset.massSolar, preset.id);
        assert.equal(state['black_hole.spin'], preset.spin, preset.id);
    }
});

test('a typical shared view is short and readable', () => {
    const m87View = {
        'camera.angles': [35.24, 12.5, 0],
        accretion_mode: 'thick_torus',
        disk_temperature: 20000,
        'torus.opacity': 0.02,
        'jet.enabled': true,
        'jet.mode': 'physical',
        'jet.half_angle': 4,
        'jet.lorentz_factor': 5,
        'jet.length': 35,
        'jet.magnetization': 15,
        'jet.knot_spacing': 7,
        'jet.base_width': 0.35,
        'jet.corona_extent': 0.6,
        'grmhd.r_high': 80,
        'grmhd.magnetic_beta': 5,
        'grmhd.mad_flux': 0.8,
        'grmhd.density_scale': 1.2,
        'grmhd.turbulence_amp': 1.5,
        'grmhd.electron_kappa': 4.5,
        'grmhd.magnetic_field_str': 1.5,
        'bloom.strength': 0.08,
        'bloom.radius': 0.9,
    };
    const text = codec.encode(m87View);
    assert.equal(
        text,
        'v=1&ca=35.2,12.5,0&dm=torus&dt=20000&to=0.02&gr=80&gb=5&gm=0.8&gd=1.2&gt=1.5&gk=4.5' +
            '&gf=1.5&je=1&jm=phys&ja=4&jl=5&jn=35&jg=15&jk=7&jw=0.35&jx=0.6&ps=0.08&pr=0.9',
    );
    assert.deepEqual(codec.decode(`#${text}`).state, codec.normalize(m87View).state);
    assert.equal(
        codec.encode({
            'scenario.mode': 'dive',
            'scenario.radius': 1.23456,
            'scenario.paused': true,
            'observerState.time': 1234.567,
            'scenario.preset': 'sgr-a-star',
            'disk.mass_msun': 4.297e6,
            'black_hole.spin': -0.5,
        }),
        'v=1&om=d&ot=1234.57&or=1.2346&op=1&bs=-0.5&mm=4.297e6&mp=sgr-a-star',
    );
});

test('the longest possible version 1 fragment fits the length limit', () => {
    const longest = {};
    const widest = (spec) =>
        spec.min < 0 ? spec.min + spec.step : Number((spec.max - spec.step).toFixed(8)) || spec.max;
    for (const field of VIEW_STATE_V1.fields) {
        if (field.type === 'number' && field.scale === 'log') {
            longest[field.path] = Number((field.min * 1.23456789).toPrecision(field.digits));
        } else if (field.type === 'number') longest[field.path] = widest(field);
        else if (field.type === 'bool') longest[field.path] = !field.default;
        else if (field.type === 'enum') {
            longest[field.path] = field.values.reduce((a, b) =>
                b[1].length > a[1].length ? b : a,
            )[0];
        } else if (field.type === 'slug') longest[field.path] = 'a'.repeat(field.maxLength);
        else longest[field.path] = field.components.map(widest);
    }
    longest['scenario.mode'] = 'dive';
    const text = codec.encode(longest);
    assert.ok(text.length <= VIEW_STATE_MAX_LENGTH, `${text.length} characters`);
    assert.ok(text.length < 800, `${text.length} characters`);
    const decoded = codec.decode(text);
    assert.deepEqual(decoded.issues, []);
    assert.equal(codec.encode(decoded.state), text);
});

test('random version 1 states survive encode and decode unchanged', () => {
    const next = random(42);
    const pick = (list) => list[Math.floor(next() * list.length)];
    const numberIn = (spec) => {
        if (spec.scale === 'log') {
            const low = Math.log10(spec.min);
            return 10 ** (low + (Math.log10(spec.max) - low) * next());
        }
        return spec.min + (spec.max - spec.min) * next();
    };
    for (let i = 0; i < 300; i += 1) {
        const raw = {};
        for (const field of VIEW_STATE_V1.fields) {
            if (next() < 0.5) continue;
            if (field.type === 'number') {
                raw[field.path] = field.nullable && next() < 0.3 ? null : numberIn(field);
            } else if (field.type === 'bool') raw[field.path] = next() < 0.5;
            else if (field.type === 'enum') raw[field.path] = pick(field.values)[0];
            else if (field.type === 'slug')
                raw[field.path] = pick(['', 'sgr-a-star', 'stellar-10']);
            else raw[field.path] = field.components.map(numberIn);
        }
        const { state } = codec.normalize(raw);
        const text = codec.encode(state);
        const decoded = codec.decode(text);
        assert.deepEqual(decoded.issues, [], text);
        assert.deepEqual(decoded.state, state, text);
        assert.equal(
            codec.encode(decoded.state, { volatile: false }),
            codec.encode(state, { volatile: false }),
        );
    }
});

test('scenario rules: orbits stay stable, radius and pause only exist in dive and hover', () => {
    const decode = (text) => codec.decode(`v=1&${text}`);
    const orbit = decode('om=o&od=2');
    assert.equal(orbit.state['observer.distance'], ORBIT_MIN_DISTANCE);
    assert.deepEqual(reasons(orbit), [['clamped', 'od']]);
    assert.equal(decode('od=2').state['observer.distance'], 2, 'a static observer may come closer');

    const staticView = decode('or=2&op=1');
    assert.equal(staticView.state['scenario.radius'], null);
    assert.equal(staticView.state['scenario.paused'], false);
    assert.deepEqual(staticView.issues, []);

    const hover = decode('om=h&or=0.5');
    assert.equal(hover.state['scenario.radius'], HOVER_MIN_RADIUS);
    assert.deepEqual(reasons(hover), [['clamped', 'or']]);
    const dive = decode('om=d&od=5&or=8');
    assert.equal(dive.state['scenario.radius'], 5);
    assert.deepEqual(reasons(dive), [['clamped', 'or']]);
    assert.equal(decode('om=d&or=0.01').state['scenario.radius'], DIVE_MIN_RADIUS);

    const paused = decode('om=d&or=1.2345&op=1');
    assert.equal(paused.state['scenario.mode'], 'dive');
    assert.equal(paused.state['scenario.radius'], 1.2345);
    assert.equal(paused.state['scenario.paused'], true);
    assert.deepEqual(paused.issues, []);
});

test('collectViewState() and applyBoundViewState() bridge presentation paths', () => {
    const store = new Map([
        ['black_hole.spin', 0.5],
        ['cameraPan.x', 0.1],
        ['cameraPan.y', -0.2],
        ['observer.distance', 7.5],
        ['jet.mode', 'physical'],
    ]);
    const reads = [];
    const state = collectViewState(
        (path) => {
            reads.push(path);
            return store.get(path);
        },
        { 'camera.angles': [10, 0, 0], 'scenario.mode': 'dive', 'observer.distance': 20 },
    );
    assert.equal(state['black_hole.spin'], 0.5);
    assert.deepEqual(state.cameraPan, [0.1, -0.2]);
    assert.equal(state['observer.distance'], 20, 'custom entries override bound paths');
    assert.deepEqual(state['camera.angles'], [10, 0, 0]);
    assert.equal(state['scenario.mode'], 'dive');
    assert.equal(state['jet.enabled'], undefined);
    assert.ok(!reads.some((path) => path.startsWith('scenario.')));
    assert.ok(!reads.includes('camera.angles') && !reads.includes('observer.distance'));

    const normalized = codec.normalize(state).state;
    assert.equal(normalized['jet.mode'], 'physical');
    assert.equal(normalized['jet.enabled'], false, 'missing paths take their defaults');

    const writes = new Map();
    const custom = applyBoundViewState(normalized, (path, value) => writes.set(path, value));
    assert.deepEqual(Object.keys(custom).sort(), [
        'camera.angles',
        'scenario.mode',
        'scenario.paused',
        'scenario.preset',
        'scenario.radius',
    ]);
    assert.equal(writes.get('cameraPan.x'), 0.1);
    assert.equal(writes.get('cameraPan.y'), -0.2);
    assert.equal(writes.get('black_hole.spin'), 0.5);
    assert.equal(writes.get('observer.distance'), 20);
    assert.ok(!writes.has('cameraPan') && !writes.has('camera.angles'));
    assert.equal(writes.size, VIEW_STATE_V1.fields.length - Object.keys(custom).length + 1);
});
