// Version 1 of the shareable view state: what the viewer sees, without device settings. Defaults
// and ranges mirror shader.js, the parameter controls and the scenario state as of this version,
// with steps at least as fine as the sliders'. Paths use the syntax of
// src/app/presentation/runtime/path-bindings.js, so every field without `custom` can be read and
// written with getPresentationPathValue() and setPresentationPathValue() (collectViewState() and
// applyBoundViewState() below). The app applies custom fields itself:
//   camera.angles          [azimuth, elevation, roll] in degrees, see camera-angles.js;
//   scenario.mode          'static', 'orbit' (observer.motion), 'dive' or 'hover';
//   scenario.radius        current dive or hover radius in r_s (null: the start radius);
//   scenario.paused        dive or hover paused;
//   scenario.preset        id of the scenario the view started from, for its label and sources.
// The physical scale of src/features/units follows disk.mass_msun and disk.eddington_ratio.
// In dive and hover modes the app moves params.observer.distance along with the observer, so the
// state must carry the start radius (prevDistance) there and the current one in scenario.radius.
// Left out on purpose: GPU-dependent quality and solver settings (quality, kerr_mode, n_steps,
// sample_count, resolution_scale, taa, accumulation, max_revolutions, rk4_integration), the
// recording-only turbulence loop, and sound, which a link must never switch on.
// The spin range is the Thorne limit +-0.998 used by the units presets, wider than the slider.
//
// Frozen: a link omits every field at its default, so changing a key, default or range here would
// change what existing links mean. Add VIEW_STATE_V2 (with a migrate function where values need
// translating) to VIEW_STATE_VERSIONS instead.

import { createViewStateCodec } from './view-state-codec.js';

// Mirrors of app constants: observer.js OBSERVER_ORBIT_MIN, hoverState.minR, seekDive()'s floor.
export const ORBIT_MIN_DISTANCE = 3;
export const HOVER_MIN_RADIUS = 1.0002;
export const DIVE_MIN_RADIUS = 0.08;

const ANGLE = { min: -180, max: 180, step: 0.1, wrap: true };
const ELEVATION = { min: -90, max: 90, step: 0.1 };
const PAN = { min: -0.45, max: 0.45, step: 0.001 };

function number(key, path, defaultValue, min, max, step, flags = {}) {
    return { key, path, type: 'number', default: defaultValue, min, max, step, ...flags };
}

function bool(key, path, defaultValue, flags = {}) {
    return { key, path, type: 'bool', default: defaultValue, ...flags };
}

function choice(key, path, defaultValue, values, flags = {}) {
    return { key, path, type: 'enum', default: defaultValue, values, ...flags };
}

function deepFreeze(value) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const item of Object.values(value)) deepFreeze(item);
    }
    return value;
}

// Circular orbits need r >= 3 r_s; the dive and hover radius lies between the scenario's floor and
// its start radius; radius and pause mean nothing outside dive and hover.
function refineV1(state, report) {
    const mode = state['scenario.mode'];
    if (mode === 'orbit' && state['observer.distance'] < ORBIT_MIN_DISTANCE) {
        report('observer.distance', 'clamped', state['observer.distance']);
        state['observer.distance'] = ORBIT_MIN_DISTANCE;
    }
    if (mode !== 'dive' && mode !== 'hover') {
        state['scenario.radius'] = null;
        state['scenario.paused'] = false;
        return;
    }
    const radius = state['scenario.radius'];
    if (radius === null) return;
    const floor = mode === 'hover' ? HOVER_MIN_RADIUS : DIVE_MIN_RADIUS;
    const clamped = Math.min(state['observer.distance'], Math.max(floor, radius));
    if (clamped !== radius) {
        report('scenario.radius', 'clamped', radius);
        state['scenario.radius'] = clamped;
    }
}

export const VIEW_STATE_V1 = deepFreeze({
    version: 1,
    fields: [
        {
            key: 'ca',
            path: 'camera.angles',
            type: 'vec',
            default: [0, -3, 0],
            components: [ANGLE, ELEVATION, ANGLE],
            custom: true,
        },
        {
            key: 'cp',
            path: 'cameraPan',
            type: 'vec',
            default: [0, 0],
            components: [PAN, PAN],
            paths: ['cameraPan.x', 'cameraPan.y'],
        },
        choice(
            'om',
            'scenario.mode',
            'static',
            [
                ['static', 's'],
                ['orbit', 'o'],
                ['dive', 'd'],
                ['hover', 'h'],
            ],
            { custom: true, history: 'push' },
        ),
        number('od', 'observer.distance', 11, 1.5, 30, 0.01),
        number('oi', 'observer.orbital_inclination', -10, -90, 90, 0.1),
        number('ox', 'time_scale', 1, 0, 6, 0.01),
        number('ot', 'observerState.time', 0, 0, 1e7, 0.01, { volatile: true }),
        number('or', 'scenario.radius', null, 0.08, 30, 0.0001, {
            nullable: true,
            custom: true,
            volatile: true,
        }),
        bool('op', 'scenario.paused', false, { custom: true }),
        number('ov', 'dive.speed', 1, 0.01, 5, 0.01),
        bool('oa', 'dive.cinematic', false),
        number('oh', 'hover.speed', 0.3, 0.01, 2, 0.01),

        number('bs', 'black_hole.spin', 0.9, -0.998, 0.998, 0.001),
        bool('be', 'black_hole.spin_enabled', true),
        number('bq', 'black_hole.spin_strength', 1, 0, 1.4, 0.01),

        {
            key: 'mm',
            path: 'disk.mass_msun',
            type: 'number',
            scale: 'log',
            default: 1e8,
            min: 1,
            max: 1e11,
            digits: 4,
        },
        {
            key: 'mp',
            path: 'scenario.preset',
            type: 'slug',
            default: 'default',
            maxLength: 40,
            allowEmpty: true,
            custom: true,
            history: 'push',
        },
        {
            key: 'me',
            path: 'disk.eddington_ratio',
            type: 'number',
            scale: 'log',
            default: 0.1,
            min: 0.001,
            max: 3,
            digits: 3,
        },

        bool('de', 'accretion_disk', true),
        choice('dm', 'accretion_mode', 'thin_disk', [
            ['thin_disk', 'thin'],
            ['thick_torus', 'torus'],
            ['slim_disk', 'slim'],
        ]),
        choice('dk', 'disk.temperature_mode', 'artist', [
            ['artist', 'art'],
            ['uniform', 'uni'],
            ['physical', 'phys'],
        ]),
        number('dt', 'disk_temperature', 5000, 1000, 1e7, 1),
        number('dc', 'disk.color_correction', 1, 1, 2.7, 0.01),
        choice('dl', 'disk.limb_darkening', 'chandrasekhar', [
            ['chandrasekhar', 'ch'],
            ['eddington', 'ed'],
            ['none', 'no'],
        ]),
        number('dq', 'disk.opacity', 1, 0, 1, 0.01),
        choice('rm', 'radiance_model', 'bolometric', [
            ['bolometric', 'bol'],
            ['visible', 'vis'],
        ]),
        number('tr', 'torus.r0', 4, 1.5, 10, 0.01),
        number('th', 'torus.h_ratio', 0.45, 0.1, 1, 0.01),
        number('tf', 'torus.radial_falloff', 2.5, 0.5, 5, 0.01),
        number('to', 'torus.opacity', 0.015, 0.001, 0.15, 0.001),
        number('te', 'torus.outer_radius', 3.5, 1.5, 8, 0.01),
        number('sh', 'slim.h_ratio', 0.15, 0.05, 0.5, 0.01),
        number('so', 'slim.opacity', 0.6, 0.1, 2, 0.01),
        number('sp', 'slim.puff_factor', 2.5, 0, 6, 0.01),
        bool('ge', 'grmhd.enabled', true),
        number('gr', 'grmhd.r_high', 40, 1, 160, 0.1),
        number('gb', 'grmhd.magnetic_beta', 10, 0.01, 100, 0.01),
        number('gm', 'grmhd.mad_flux', 0, 0, 1, 0.01),
        number('gd', 'grmhd.density_scale', 1, 0.1, 5, 0.01),
        number('gt', 'grmhd.turbulence_amp', 1, 0, 3, 0.01),
        number('gk', 'grmhd.electron_kappa', 5, 2.5, 8, 0.01),
        number('gf', 'grmhd.magnetic_field_str', 1, 0.1, 5, 0.01),

        bool('je', 'jet.enabled', false),
        choice('jm', 'jet.mode', 'simple', [
            ['simple', 'simple'],
            ['physical', 'phys'],
        ]),
        number('ja', 'jet.half_angle', 5, 1, 25, 0.1),
        number('jl', 'jet.lorentz_factor', 3, 1.1, 20, 0.01),
        number('jb', 'jet.brightness', 1.2, 0.05, 3, 0.01),
        number('jn', 'jet.length', 30, 5, 60, 0.1),
        number('js', 'jet.spectral_index', 0.7, -0.5, 2.5, 0.01),
        number('jg', 'jet.magnetization', 10, 1, 50, 0.1),
        number('jk', 'jet.knot_spacing', 6, 2, 15, 0.1),
        number('jc', 'jet.corona_brightness', 1.5, 0, 5, 0.01),
        number('jw', 'jet.base_width', 0.4, 0, 1, 0.01),
        number('jx', 'jet.corona_extent', 0.5, 0, 1, 0.01),

        choice('lt', 'look.tone_mapper', 'agx', [
            ['agx', 'agx'],
            ['neutral', 'neutral'],
            ['aces', 'aces'],
            ['scientific', 'sci'],
        ]),
        bool('lk', 'look.white_balance_enabled', false),
        number('lc', 'look.white_balance_k', 6500, 1500, 20000, 50),
        choice('lm', 'look.exposure_mode', 'anchored', [
            ['anchored', 'anc'],
            ['manual', 'man'],
        ]),
        number('lx', 'look.exposure_ev', 0, -6, 6, 0.05),
        number('lv', 'look.ev100', 30, -10, 70, 0.1),
        number('ld', 'look.disk_gain', 1, 0.4, 4, 0.01),
        number('lw', 'look.glow', 0, 0, 2, 0.01),
        number('lb', 'look.doppler_boost', 1, 0, 2.5, 0.01),
        number('la', 'look.aberration_strength', 1, 0, 3, 0.01),
        number('lg', 'look.galaxy_gain', 0.4, 0, 2.5, 0.01),
        bool('pe', 'bloom.enabled', true),
        number('ps', 'bloom.strength', 0.04, 0, 0.25, 0.005),
        number('pr', 'bloom.radius', 0.7, 0, 0.95, 0.01),

        bool('ne', 'planet.enabled', true),
        number('nd', 'planet.distance', 14, 3, 100, 0.01),
        number('nr', 'planet.radius', 0.4, 0.01, 2, 0.01),

        bool('ra', 'aberration', true),
        bool('rb', 'beaming', true),
        bool('rp', 'physical_beaming', true),
        bool('rd', 'doppler_shift', true),
        bool('rt', 'gravitational_time_dilation', true),
        bool('rl', 'lorentz_contraction', true),
        bool('rc', 'light_travel_time', true),
    ],
    refine: refineV1,
});

export const VIEW_STATE_VERSIONS = Object.freeze([VIEW_STATE_V1]);

const LATEST_FIELDS = VIEW_STATE_VERSIONS.at(-1).fields;

export const viewStateCodec = createViewStateCodec(VIEW_STATE_VERSIONS);

// Reads a view state from the app: bound fields through getPathValue(path), e.g.
// getPresentationPathValue, and custom fields from `custom`, whose entries also override bound
// fields (the start radius for observer.distance during a dive or hover).
export function collectViewState(getPathValue, custom = {}, fields = LATEST_FIELDS) {
    const state = {};
    for (const field of fields) {
        if (Object.hasOwn(custom, field.path)) state[field.path] = custom[field.path];
        else if (field.paths) state[field.path] = field.paths.map((path) => getPathValue(path));
        else if (!field.custom) state[field.path] = getPathValue(field.path);
    }
    return state;
}

// Writes the bound fields of a decoded state through setPathValue(path, value), e.g.
// setPresentationPathValue, and returns the custom fields for the app to apply itself.
export function applyBoundViewState(state, setPathValue, fields = LATEST_FIELDS) {
    const custom = {};
    for (const field of fields) {
        const value = state[field.path];
        if (field.custom) custom[field.path] = value;
        else if (field.paths)
            field.paths.forEach((path, index) => setPathValue(path, value[index]));
        else setPathValue(field.path, value);
    }
    return custom;
}
