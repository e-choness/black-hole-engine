import { expect, test, vi } from 'vitest';

// The registry reaches the engine only through src/ui/engine/engine.ts, which is replaced here by
// a stand-in that resolves paths against a fresh Shader's parameters.
const engine = vi.hoisted(() => ({
    parameters: {} as Record<string, unknown>,
    capture: { cameraSmoothingEnabled: false },
}));

function resolve(path: string): { parent: Record<string, unknown>; key: string } {
    const parts = path.split('.');
    let parent = engine.parameters;
    for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
    return { parent, key: parts[parts.length - 1] };
}

vi.mock('../../src/ui/engine/engine', () => ({
    applyKerrMode: () => {},
    applyQualityPreset: () => {},
    observerDistanceMin: () => 1.5,
    planetAvailable: () => true,
    qualityPresetLabels: { Custom: 'custom', 'Mobile (fastest)': 'mobile', High: 'high' },
    resetTurbulenceClock: () => {},
    setCaptureSmoothing: (enabled: boolean) => {
        engine.capture.cameraSmoothingEnabled = enabled;
    },
    timelineCapture: engine.capture,
    setObserverDistance: () => {},
    setObserverMotion: () => {},
    blackHolePresets: {},
    CUSTOM_PRESET: 'Custom',
    commitParamChange: () => {},
    getPathValue: (path: string) => {
        const { parent, key } = resolve(path);
        return parent[key];
    },
    setPathValue: (path: string, value: unknown) => {
        const { parent, key } = resolve(path);
        if (parent[key] === value) return false;
        parent[key] = value;
        return true;
    },
    markQualityCustom: () => {},
    markScenarioCustom: () => {},
    selectSkyView: (view: string) => {
        (
            (engine.parameters.sky as Record<string, unknown>).galaxy as Record<string, unknown>
        ).view = view;
    },
    params: () => engine.parameters,
    subscribePresetApplied: () => () => {},
}));

vi.stubGlobal('localStorage', { getItem: () => null });
const { Shader } = await import('../../src/app/core/shader.js');
engine.parameters = new (
    Shader as unknown as new (source: string) => {
        parameters: Record<string, unknown>;
    }
)('').parameters;
const scenarios = await import('../../src/app/core/scenarios/scenario-state.js');
engine.parameters.dive = { ...scenarios.diveState };
engine.parameters.hover = { ...scenarios.hoverState };
const { PARAMS } = await import('../../src/ui/params/registry');
const { clampSlider, initParams, isModified, readParam, resetParam, setParam } =
    await import('../../src/ui/params/params');
const { parseNumber, editableNumber } = await import('../../src/ui/lib/number-input');

// Every control of the former lil-gui panels, observer widget and animations panel, with the
// surface that replaces it. The inspector rows are checked against the registry below.
const LEGACY_INSPECTOR_PATHS = [
    'quality',
    'kerr_mode',
    'n_steps',
    'sample_count',
    'max_revolutions',
    'resolution_scale',
    'taa_enabled',
    'taa.history_weight',
    'taa.clip_gamma',
    'taa.motion_rejection',
    'taa.max_camera_delta',
    'accumulation.enabled',
    'accumulation.max_frames',
    'rk4_integration',
    'accretion_disk',
    'accretion_mode',
    'disk.temperature_mode',
    'disk_temperature',
    'disk.mass_msun',
    'disk.eddington_ratio',
    'disk.color_correction',
    'disk.limb_darkening',
    'disk.opacity',
    'torus.r0',
    'torus.h_ratio',
    'torus.radial_falloff',
    'torus.opacity',
    'torus.outer_radius',
    'slim.h_ratio',
    'slim.opacity',
    'slim.puff_factor',
    'grmhd.enabled',
    'grmhd.r_high',
    'grmhd.magnetic_beta',
    'grmhd.mad_flux',
    'grmhd.density_scale',
    'grmhd.turbulence_amp',
    'grmhd.electron_kappa',
    'grmhd.magnetic_field_str',
    'jet.enabled',
    'jet.mode',
    'jet.half_angle',
    'jet.lorentz_factor',
    'jet.brightness',
    'jet.length',
    'jet.spectral_index',
    'jet.magnetization',
    'jet.knot_spacing',
    'jet.corona_brightness',
    'jet.base_width',
    'jet.corona_extent',
    'black_hole.spin_enabled',
    'black_hole.spin',
    'black_hole.spin_strength',
    'look.tone_mapper',
    'look.white_balance_enabled',
    'look.white_balance_k',
    'look.exposure_mode',
    'look.exposure_ev',
    'look.ev100',
    'look.disk_gain',
    'look.glow',
    'look.doppler_boost',
    'look.aberration_strength',
    'look.galaxy_gain',
    'bloom.enabled',
    'bloom.strength',
    'bloom.radius',
    'planet.enabled',
    'planet.distance',
    'planet.radius',
    'aberration',
    'beaming',
    'physical_beaming',
    'doppler_shift',
    'radiance_model',
    'gravitational_time_dilation',
    'lorentz_contraction',
    'light_travel_time',
    'time_scale',
    'observer.distance',
    'observer.motion',
    'dive.speed',
    'dive.cinematic',
    'hover.speed',
    'capture.smoothing',
];

test('every legacy parameter control has an inspector row', () => {
    const paths = new Set(PARAMS.map((def) => def.path));
    expect(LEGACY_INSPECTOR_PATHS.filter((path) => !paths.has(path))).toEqual([]);
    expect(new Set(PARAMS.map((def) => def.id)).size).toBe(PARAMS.length);
});

test('registry entries match the engine parameters they edit', () => {
    for (const def of PARAMS) {
        const value = readParam(def);
        if (def.control === 'slider') {
            expect(typeof value, def.path).toBe('number');
            expect(def.min, def.path).toBeLessThan(def.max);
            expect(value as number, def.path).toBeGreaterThanOrEqual(def.min);
            expect(value as number, def.path).toBeLessThanOrEqual(def.max);
            if (def.scale === 'log') expect(def.min, def.path).toBeGreaterThan(0);
        } else if (def.control === 'toggle') {
            expect(typeof value, def.path).toBe('boolean');
        } else {
            const values = def.options.map((option) => option.value);
            expect(values, def.path).toContain(value);
        }
        expect(def.help.length, def.path).toBeGreaterThan(10);
    }
});

test('slider values are clamped and snapped to the step', () => {
    const steps = PARAMS.find((def) => def.path === 'n_steps');
    const mass = PARAMS.find((def) => def.path === 'disk.mass_msun');
    if (steps?.control !== 'slider' || mass?.control !== 'slider') throw new Error('missing');
    expect(clampSlider(steps, 5)).toBe(20);
    expect(clampSlider(steps, 123.6)).toBe(124);
    expect(clampSlider(steps, 1e9)).toBe(1400);
    expect(clampSlider(mass, 6.54321e9)).toBe(6.543e9);
    expect(clampSlider(mass, 0.1)).toBe(1);
});

test('the per-row reset returns to the start-up value', () => {
    initParams();
    const spin = PARAMS.find((def) => def.path === 'black_hole.spin')!;
    const start = resolve(spin.path);
    const initial = start.parent[start.key];
    setParam(spin, -0.5);
    expect(start.parent[start.key]).toBe(-0.5);
    expect(isModified(spin)).toBe(true);
    resetParam(spin);
    expect(start.parent[start.key]).toBe(initial);
    expect(isModified(spin)).toBe(false);
});

test('value chips accept displayed and plain numbers', () => {
    expect(parseNumber('6.5 × 10⁹ M☉')).toBe(6.5e9);
    expect(parseNumber('1.2 × 10⁻³')).toBeCloseTo(1.2e-3);
    expect(parseNumber('12 000 K')).toBe(12000);
    expect(parseNumber('−0.5')).toBe(-0.5);
    expect(parseNumber('3e8')).toBe(3e8);
    expect(parseNumber('abc')).toBeNaN();
    expect(editableNumber(6.5e9)).toBe('6.500e9');
    expect(editableNumber(0.9)).toBe('0.9');
});

test('moving the galaxy by hand leaves the named view', () => {
    const galaxy = (engine.parameters.sky as Record<string, unknown>).galaxy as Record<
        string,
        unknown
    >;
    const distance = PARAMS.find((def) => def.path === 'sky.galaxy.distance')!;
    const view = PARAMS.find((def) => def.path === 'sky.galaxy.view')!;
    expect(galaxy.view).toBe('outside');
    setParam(distance, 2.5);
    expect(galaxy.distance).toBe(2.5);
    expect(galaxy.view).toBe('custom');
    setParam(view, 'disk');
    expect(galaxy.view).toBe('disk');
});
