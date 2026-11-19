// The parameter registry: one entry per inspector control, from which the inspector, the filter,
// the command palette and the per-row reset are all built. Paths use the syntax of
// src/app/presentation/runtime/path-bindings.js. `apply` names the side effect of a write
// (engine-actions commitParamChange): 'compile' rebuilds the shader, 'uniform' re-uploads uniforms,
// 'redraw' only marks the frame dirty, 'taa' also drops the TAA history and 'resolution' resizes
// the render targets. `track` marks the scenario or quality preset as customised on a change.

import {
    applyKerrMode,
    applyQualityPreset,
    observerDistanceMin,
    planetAvailable,
    qualityPresetLabels,
    resetTurbulenceClock,
    setCaptureSmoothing,
    setObserverDistance,
    setObserverMotion,
    timelineCapture,
    type ApplyKind,
    type EngineParams,
    type KerrMode,
    type PresetKind,
} from '../engine/engine';
import { SOLVER_LABELS } from '../lib/scenarios';
import { formatMass, formatNumber, formatTemperature, MINUS } from '../lib/units';

export type InspectorTab = 'blackhole' | 'disk' | 'jets' | 'observer' | 'look' | 'render';
export type ParamValue = number | boolean | string;

export const TABS: { id: InspectorTab; label: string }[] = [
    { id: 'blackhole', label: 'Black hole' },
    { id: 'disk', label: 'Disk' },
    { id: 'jets', label: 'Jets' },
    { id: 'observer', label: 'Observer' },
    { id: 'look', label: 'Look' },
    { id: 'render', label: 'Render' },
];

export interface ParamOption {
    value: string;
    label: string;
    hint?: string;
}

interface BaseDef {
    id: string;
    path: string;
    label: string;
    tab: InspectorTab;
    section: string;
    help: string;
    apply: ApplyKind;
    track?: PresetKind;
    visible?: (p: EngineParams) => boolean;
    available?: () => boolean;
    // Runs before the value is written (e.g. restart a clock).
    before?: () => void;
    // Replace the generic read, and the generic write, tracking and apply step.
    get?: () => ParamValue;
    set?: (value: ParamValue) => void;
}

export interface SliderDef extends BaseDef {
    control: 'slider';
    min: number;
    max: number;
    step: number;
    scale?: 'log';
    unit?: string;
    format?: (value: number) => string;
    marks?: [string, string];
    // A lower bound that depends on other parameters (still within min..max).
    floor?: (p: EngineParams) => number;
}

export interface ToggleDef extends BaseDef {
    control: 'toggle';
}

export interface ChoiceDef extends BaseDef {
    control: 'select' | 'segmented';
    options: ParamOption[];
}

export type ParamDef = SliderDef | ToggleDef | ChoiceDef;

type Shared = 'id' | 'path' | 'label' | 'tab' | 'section' | 'control' | 'apply';
type Extra<T extends ParamDef> = Omit<T, Shared | 'min' | 'max' | 'step' | 'options'> & {
    apply?: ApplyKind;
};
type Draft =
    | Omit<SliderDef, 'tab' | 'section'>
    | Omit<ToggleDef, 'tab' | 'section'>
    | Omit<ChoiceDef, 'tab' | 'section'>;

function slider(
    path: string,
    label: string,
    min: number,
    max: number,
    step: number,
    extra: Extra<SliderDef>,
): Draft {
    return { control: 'slider', id: path, path, label, min, max, step, apply: 'uniform', ...extra };
}

function toggle(path: string, label: string, extra: Extra<ToggleDef>): Draft {
    return { control: 'toggle', id: path, path, label, apply: 'compile', ...extra };
}

function choice(
    path: string,
    label: string,
    options: ParamOption[],
    extra: Extra<ChoiceDef> & { control?: 'select' | 'segmented' },
): Draft {
    return { control: 'select', id: path, path, label, options, apply: 'uniform', ...extra };
}

function section(
    tab: InspectorTab,
    name: string,
    drafts: Draft[],
    shown?: (p: EngineParams) => boolean,
): ParamDef[] {
    return drafts.map((draft) => {
        const visible = draft.visible;
        return {
            ...draft,
            tab,
            section: name,
            visible:
                shown && visible ? (p: EngineParams) => shown(p) && visible(p) : (shown ?? visible),
        } as ParamDef;
    });
}

function options(entries: [string, string][]): ParamOption[] {
    return entries.map(([value, label]) => ({ value, label }));
}

const fixed = (decimals: number) => (value: number) => formatNumber(value, { decimals });
const signedFixed = (decimals: number) => (value: number) =>
    (value < 0 ? MINUS : '') + formatNumber(Math.abs(value), { decimals });
const sci = (value: number) => formatNumber(value, { digits: 3 });

type P = EngineParams & Record<string, Record<string, unknown>>;
const disk = (p: EngineParams) => !!p.accretion_disk;
const diskMode = (mode: string) => (p: EngineParams) => disk(p) && p.accretion_mode === mode;
const physicalTemperature = (p: EngineParams) => p.disk.temperature_mode === 'physical';
const jet = (p: EngineParams) => !!p.jet.enabled;
const look = (p: EngineParams) => (p as P).look;

export const PARAMS: ParamDef[] = [
    ...section('blackhole', 'Black hole', [
        slider('disk.mass_msun', 'Mass', 1, 1e11, 0, {
            scale: 'log',
            format: (value) => formatMass(value, { digits: 3 }),
            marks: ['1 M☉ · stellar', '10¹¹ M☉'],
            track: 'scenario',
            help: 'Mass of the black hole. It sets the physical scale of every length and time in r_s and r_s/c, the derived quantities below, and the disk temperature on the physical temperature scale (T_peak ∝ M^−1/4).',
        }),
        toggle('black_hole.spin_enabled', 'Rotation', {
            apply: 'uniform',
            track: 'scenario',
            help: 'Enables Kerr-like rotation effects. Disable for a Schwarzschild-style shadow.',
        }),
        slider('black_hole.spin', 'Spin a/M', -0.998, 0.998, 0.001, {
            format: signedFixed(3),
            marks: [`${MINUS}0.998 retrograde`, '0.998 prograde'],
            track: 'scenario',
            visible: (p) => p.black_hole.spin_enabled,
            help: 'Signed Kerr spin.',
        }),
        slider('black_hole.spin_strength', 'Shadow squeeze', 0, 1.4, 0.01, {
            format: fixed(2),
            track: 'scenario',
            visible: (p) => p.black_hole.spin_enabled && p.kerr_mode !== 'full_kerr',
            help: 'Visual strength multiplier for rotation-induced asymmetry in the shadow.',
        }),
    ]),
    ...section('blackhole', 'Geodesic solver', [
        choice(
            'kerr_mode',
            'Solver',
            [
                {
                    value: 'fast',
                    label: SOLVER_LABELS.fast,
                    hint: 'Schwarzschild (Binet) photon lensing with a perturbative frame-dragging term. Fastest.',
                },
                {
                    value: 'kerr_inspired_disk_velocity',
                    label: SOLVER_LABELS.kerr_inspired_disk_velocity,
                    hint: 'The same photon lensing, while the emitting matter moves with the Kerr angular velocity.',
                },
                {
                    value: 'full_kerr',
                    label: SOLVER_LABELS.full_kerr,
                    hint: 'Kerr–Schild Hamiltonian geodesics with adaptive RK4. Exact for any spin; heavier on the GPU.',
                },
            ],
            {
                control: 'segmented',
                apply: 'compile',
                set: (value) => applyKerrMode(value as KerrMode),
                help: 'How photon paths and the motion of the emitting matter are computed. Binet · fast and Kerr-inspired trace Schwarzschild-like rays; Full Kerr integrates exact Kerr geodesics.',
            },
        ),
    ]),

    ...section('disk', 'Accretion', [
        toggle('accretion_disk', 'Accretion disk', {
            track: 'scenario',
            help: 'Toggles thermal emission from the accretion disk.',
        }),
        choice(
            'accretion_mode',
            'Geometry',
            options([
                ['thin_disk', 'Thin'],
                ['thick_torus', 'Thick torus'],
                ['slim_disk', 'Slim'],
            ]),
            {
                control: 'segmented',
                apply: 'compile',
                track: 'scenario',
                visible: disk,
                before: resetTurbulenceClock,
                help: 'Thin disk: Novikov-Thorne / Page-Thorne disk with the spin-dependent ISCO (quasars/XRBs). Thick torus: ADAF/RIAF (M87*/Sgr A*). Slim disk: super-Eddington.',
            },
        ),
    ]),
    ...section(
        'disk',
        'Emission',
        [
            choice(
                'disk.temperature_mode',
                'Temperature scale',
                options([
                    ['artist', 'Artist · Page–Thorne profile'],
                    ['uniform', 'Artist · uniform'],
                    ['physical', 'Physical (M, Ṁ)'],
                ]),
                {
                    track: 'scenario',
                    help: 'Artist: the Page-Thorne profile with the peak temperature below. Artist uniform: the whole disk at that temperature, as in the film Interstellar (James et al. 2015). Physical: the Novikov-Thorne peak temperature of a hole of the given mass accreting at the given Eddington ratio (Page & Thorne 1974).',
                },
            ),
            slider('disk_temperature', 'Peak temperature', 1000, 1e7, 1, {
                scale: 'log',
                format: (value) => formatTemperature(value),
                track: 'scenario',
                visible: (p) => !physicalTemperature(p),
                help: 'Effective temperature at the flux maximum of the Page-Thorne profile, or of the whole disk in uniform mode, before relativistic shifts. An artist choice: physical disks peak at 1e4-1e5 K around supermassive holes and 1e6-1e7 K around stellar-mass ones.',
            }),
            slider('disk.eddington_ratio', 'Eddington ratio L/L_Edd', 0.001, 3, 0.001, {
                scale: 'log',
                format: sci,
                track: 'scenario',
                visible: physicalTemperature,
                help: 'Accretion rate as a fraction of the Eddington luminosity, Mdot = L / (eta c^2); T_peak scales as (L / L_Edd)^1/4.',
            }),
            slider('disk.color_correction', 'Colour correction f_col', 1, 2.7, 0.01, {
                format: fixed(2),
                track: 'scenario',
                help: 'Spectral hardening of the photosphere, I = f_col^-4 B(f_col T): about 1.7 for stellar-mass disks, 1 to 2.7 for AGN.',
            }),
            choice(
                'disk.limb_darkening',
                'Limb darkening',
                options([
                    ['chandrasekhar', 'Chandrasekhar'],
                    ['eddington', 'Eddington'],
                    ['none', 'None (isotropic)'],
                ]),
                {
                    track: 'scenario',
                    help: 'Angular emission law in the gas frame, flux-normalised: Chandrasekhar 0.4214 (1 + 2.06 mu), Eddington 0.5 + 0.75 mu, or isotropic.',
                },
            ),
            slider('disk.opacity', 'Thin-disk opacity', 0, 1, 0.01, {
                format: fixed(2),
                track: 'scenario',
                visible: (p) => p.accretion_mode === 'thin_disk',
                help: 'Fraction of the light behind the thin disk that it blocks: 1 for an optically thick disk, lower values let the images behind it through.',
            }),
            choice(
                'radiance_model',
                'Radiance model',
                options([
                    ['bolometric', 'Bolometric (g⁴)'],
                    ['visible', 'Visible band Y(gT)'],
                ]),
                {
                    control: 'segmented',
                    help: 'Bolometric: brightness follows the total radiated power, sigma (g T)^4 / pi. Visible: brightness is the CIE luminance of the shifted blackbody, as the eye would see it.',
                },
            ),
        ],
        disk,
    ),
    ...section(
        'disk',
        'Thick torus',
        [
            slider('torus.r0', 'Centre radius', 1.5, 10, 0.1, {
                unit: 'r_s',
                format: fixed(1),
                track: 'scenario',
                help: 'Center radius of the torus in r_s units (thick torus mode only).',
            }),
            slider('torus.h_ratio', 'Height ratio H/R', 0.1, 1, 0.01, {
                format: fixed(2),
                track: 'scenario',
                help: 'Height-to-radius ratio of the torus cross-section (thick torus mode only).',
            }),
            slider('torus.radial_falloff', 'Radial falloff', 0.5, 5, 0.1, {
                format: fixed(1),
                track: 'scenario',
                help: 'Power-law index for radial emissivity decay. Physical ADAF: 2-4. Lower = flatter profile, higher = more concentrated.',
            }),
            slider('torus.opacity', 'Opacity', 0.001, 0.15, 0.001, {
                format: fixed(3),
                track: 'scenario',
                help: 'Absorption coefficient. Low = optically thin (ADAF). Higher = more self-shielding and defined torus surface.',
            }),
            slider('torus.outer_radius', 'Outer extent', 1.5, 8, 0.1, {
                unit: '× r₀',
                format: fixed(1),
                track: 'scenario',
                help: 'Outer edge multiplier relative to torus center r0. Controls how far the torus extends.',
            }),
        ],
        diskMode('thick_torus'),
    ),
    ...section(
        'disk',
        'Slim disk',
        [
            slider('slim.h_ratio', 'Height ratio H/R', 0.05, 0.5, 0.01, {
                format: fixed(2),
                track: 'scenario',
                help: 'Base height-to-radius ratio of the slim disk. Higher = geometrically thicker.',
            }),
            slider('slim.opacity', 'Opacity', 0.1, 2, 0.01, {
                format: fixed(2),
                track: 'scenario',
                help: 'Absorption coefficient. Higher = more opaque, surface-like. Lower = more translucent, volumetric.',
            }),
            slider('slim.puff_factor', 'ISCO puff', 0, 6, 0.1, {
                format: fixed(1),
                track: 'scenario',
                help: 'How much the disk puffs up near the ISCO due to radiation pressure. Higher = more pronounced thickening.',
            }),
        ],
        diskMode('slim_disk'),
    ),
    ...section(
        'disk',
        'GRMHD-inspired plasma',
        [
            toggle('grmhd.enabled', 'GRMHD-inspired', {
                track: 'scenario',
                help: 'Enables GRMHD-inspired morphology controls: two-temperature plasma weighting, synchrotron-inspired emissivity corrections, MRI-inspired turbulence, and magnetic-field effects. These are semi-analytic visual models, not full GRMHD evolution.',
            }),
            ...[
                slider('grmhd.r_high', 'R_high', 1, 160, 1, {
                    format: fixed(0),
                    help: 'Renderer-side Ti:Te / electron-heating proxy. Higher R_high suppresses high-beta disk-body emission most strongly in the GRMHD torus branch, while thin/slim disks keep the effect deliberately milder so the RGB disk remains visible.',
                }),
                slider('grmhd.magnetic_beta', 'Plasma β', 0.01, 100, 0.01, {
                    scale: 'log',
                    format: sci,
                    help: 'Ratio of gas-to-magnetic pressure in the disk midplane. Low beta = strongly magnetized, high beta = gas dominated. GRMHD simulations: beta ~ 1-30.',
                }),
                slider('grmhd.mad_flux', 'MAD flux', 0, 1, 0.01, {
                    format: fixed(2),
                    help: 'Magnetically Arrested Disk saturation. 0 = SANE (standard), 1 = full MAD. MAD state creates stronger B-fields, prominent m=1 spiral arms, and more powerful jets (Tchekhovskoy+ 2011).',
                }),
                slider('grmhd.density_scale', 'Density scale', 0.1, 5, 0.1, {
                    format: fixed(1),
                    help: 'Normalization of the GRMHD density profile. Higher values increase overall emissivity and absorption.',
                }),
                slider('grmhd.turbulence_amp', 'MRI turbulence', 0, 3, 0.1, {
                    format: fixed(1),
                    help: 'Amplitude of MRI-driven turbulent density fluctuations. 0 = smooth, 1 = typical GRMHD, 3 = strongly turbulent. Controls log-normal density PDF and spiral arm contrast.',
                }),
                slider('grmhd.electron_kappa', 'κ (non-thermal)', 2.5, 8, 0.1, {
                    format: fixed(1),
                    help: 'Kappa-distribution index for non-thermal electrons from magnetic reconnection. Kappa ~ 3.5 = strong non-thermal tail, Kappa ~ 8 = nearly thermal.',
                }),
                slider('grmhd.magnetic_field_str', 'B-field strength', 0.1, 5, 0.1, {
                    format: fixed(1),
                    help: 'Overall magnetic field strength scaling. Affects synchrotron emissivity, self-absorption, and electron temperature.',
                }),
            ].map((draft) => ({
                ...draft,
                track: 'scenario' as const,
                visible: (p: EngineParams) => !!(p as P).grmhd.enabled,
            })),
        ],
        disk,
    ),

    ...section('jets', 'Jets', [
        toggle('jet.enabled', 'Relativistic jets', {
            track: 'scenario',
            help: 'Bipolar analytic jets aligned with the spin axis. The detailed mode adds GRMHD-inspired structure and Blandford-Znajek-like power scaling.',
        }),
        ...[
            choice(
                'jet.mode',
                'Jet model',
                options([
                    ['simple', 'Simple'],
                    ['physical', 'Physical'],
                ]),
                {
                    control: 'segmented',
                    apply: 'compile',
                    help: 'Simple: smooth analytic jet. Physical: more detailed GRMHD-inspired jet model with spine/sheath, reconfinement knots, corona base, and disk occultation.',
                },
            ),
            slider('jet.half_angle', 'Half-angle', 1, 25, 0.5, {
                unit: '°',
                format: fixed(1),
                help: 'Opening half-angle of the jet. Typical AGN jets: 2-7 deg. Parabolic collimation narrows the beam with distance.',
            }),
            slider('jet.lorentz_factor', 'Lorentz factor Γ', 1.1, 20, 0.1, {
                format: fixed(1),
                help: 'Bulk Lorentz factor for relativistic beaming.',
            }),
            slider('jet.brightness', 'Brightness', 0.05, 3, 0.01, {
                format: fixed(2),
                help: 'Overall jet synchrotron emission strength.',
            }),
            slider('jet.length', 'Length', 5, 60, 1, {
                unit: 'r_s',
                format: fixed(0),
                help: 'Visible jet length in Schwarzschild radii.',
            }),
            slider('jet.spectral_index', 'Spectral index α', -0.5, 2.5, 0.01, {
                format: signedFixed(2),
                help: 'Optically thin synchrotron slope alpha, F_nu ~ nu^-alpha: sets the jet colour, which no Doppler shift changes, and the steady-jet beaming g^(2+alpha).',
            }),
        ].map((draft) => ({ ...draft, track: 'scenario' as const, visible: jet })),
    ]),
    ...section(
        'jets',
        'Physical jet',
        [
            slider('jet.magnetization', 'Magnetization σ', 1, 50, 0.5, {
                format: fixed(1),
                help: 'Plasma magnetization at jet base.',
            }),
            slider('jet.knot_spacing', 'Knot spacing', 2, 15, 0.5, {
                format: fixed(1),
                help: 'Spacing of reconfinement shock knots.',
            }),
            slider('jet.corona_brightness', 'Corona glow', 0, 5, 0.1, {
                format: fixed(1),
                help: 'Brightness of the jet-corona connection at the base.',
            }),
            slider('jet.base_width', 'Base width', 0, 1, 0.01, {
                format: fixed(2),
                help: 'Controls how wide the jet funnel is at the base.',
            }),
            slider('jet.corona_extent', 'Corona extent', 0, 1, 0.01, {
                format: fixed(2),
                help: 'Radial spread of the corona base emission.',
            }),
        ].map((draft) => ({ ...draft, track: 'scenario' as const })),
        (p) => jet(p) && p.jet.mode === 'physical',
    ),

    ...section('observer', 'Position', [
        slider('observer.distance', 'Distance r', 1.5, 30, 0.01, {
            unit: 'r_s',
            format: fixed(2),
            apply: 'redraw',
            floor: () => observerDistanceMin(),
            set: (value) => setObserverDistance(value as number),
            help: 'Distance of the observer from the centre, in Schwarzschild radii. A circular orbit needs r ≥ 3 r_s.',
        }),
        toggle('observer.motion', 'Circular orbit', {
            set: (value) => setObserverMotion(value as boolean),
            help: 'Moves the observer along a circular orbit at this distance, so aberration and Doppler shifts include the orbital speed. Turning it on moves the observer out to 3 r_s if it is closer.',
        }),
        slider('observer.orbital_inclination', 'Orbit inclination', -90, 90, 0.1, {
            unit: '°',
            format: signedFixed(1),
            apply: 'redraw',
            visible: (p) => p.observer.motion,
            help: 'Tilt of the circular orbit against the equatorial plane of the hole.',
        }),
        slider('time_scale', 'Time scale', 0, 6, 0.01, {
            unit: '×',
            format: fixed(2),
            apply: 'redraw',
            help: 'Simulated time per second, in light-crossing times r_s/c; the time bar shows the physical duration. 0 pauses the simulation.',
        }),
    ]),
    ...section('observer', 'Dive and hover', [
        slider('dive.speed', 'Fall speed', 0.01, 5, 0.01, {
            unit: '×',
            format: fixed(2),
            apply: 'redraw',
            help: 'Playback speed of the free-fall dive, on top of the simulation speed.',
        }),
        toggle('dive.cinematic', 'Slow down near the horizon', {
            apply: 'redraw',
            help: 'Slows the dive near the photon sphere and the horizon, where the view changes fastest.',
        }),
        slider('hover.speed', 'Descent speed', 0.01, 2, 0.01, {
            unit: '×',
            format: fixed(2),
            apply: 'redraw',
            help: 'How fast the hovering observer lowers itself towards the horizon, on top of the simulation speed.',
        }),
        toggle('capture.smoothing', 'Smooth recorded camera', {
            apply: 'redraw',
            get: () => timelineCapture.cameraSmoothingEnabled,
            set: (value) => setCaptureSmoothing(value as boolean),
            help: 'Smooths the orbit and pan moves that the time bar records from a dive or hover into the timeline.',
        }),
    ]),
    ...section('observer', 'Relativistic effects', [
        toggle('aberration', 'Aberration', {
            help: 'Changes apparent incoming ray direction due to observer velocity.',
        }),
        toggle('beaming', 'Relativistic beaming', {
            track: 'scenario',
            help: 'Scales the brightness of every emitter with the frequency ratio g = nu_obs / nu_emit: g^4 (bolometric) or Y(gT) / Y(T) (visible band) for thermal sources, g^(2+alpha) for synchrotron jets.',
        }),
        toggle('physical_beaming', 'Physical beaming', {
            track: 'scenario',
            visible: (p) => !!p.beaming,
            help: 'Exact relativistic beaming from the invariance of I_nu / nu^3. Off: a softened cinematic curve limited to g in [0.68, 1.61].',
        }),
        toggle('doppler_shift', 'Doppler colour shift', {
            track: 'scenario',
            help: 'Colour of thermal emitters at the shifted temperature g T. Synchrotron power laws keep their colour under any shift.',
        }),
        toggle('gravitational_time_dilation', 'Time dilation', {
            help: 'Accounts for rate differences between local and distant observer clocks.',
        }),
        toggle('lorentz_contraction', 'Lorentz contraction', {
            available: planetAvailable,
            visible: (p) => p.planet.enabled,
            help: 'Applies length contraction effects to moving scene elements.',
        }),
        toggle('light_travel_time', 'Light travel time', {
            help: 'Enables retarded-time rendering, where events are seen after light delay.',
        }),
    ]),
    ...section('observer', 'Test planet', [
        toggle('planet.enabled', 'Test planet', {
            available: planetAvailable,
            help: 'Adds an orbiting planet used as a reference object.',
        }),
        slider('planet.distance', 'Orbit radius', 3, 100, 0.1, {
            unit: 'r_s',
            format: fixed(1),
            available: planetAvailable,
            visible: (p) => p.planet.enabled,
            help: 'Orbital radius of the planet. Public controls clamp this to r >= 3 r_s so the reference body stays in the stable timelike-orbit regime.',
        }),
        slider('planet.radius', 'Radius', 0.01, 2, 0.01, {
            unit: 'r_s',
            format: fixed(2),
            available: planetAvailable,
            visible: (p) => p.planet.enabled,
            help: 'Planet size in simulation units.',
        }),
    ]),

    ...section('look', 'Tone and exposure', [
        choice(
            'look.tone_mapper',
            'Tone mapping',
            options([
                ['agx', 'AgX'],
                ['neutral', 'Khronos PBR Neutral'],
                ['aces', 'ACES filmic'],
                ['scientific', 'Scientific (log, Inferno)'],
            ]),
            {
                apply: 'redraw',
                track: 'scenario',
                help: 'AgX: rolls saturated blackbody colours towards white without hue skew. Neutral: keeps hue and saturation below the highlight shoulder. ACES: filmic contrast with some hue shift in bright saturated colours. Scientific: false colour of log2 luminance over 12 stops through the Inferno map, which is perceptually uniform and stays readable with colour-vision deficiency.',
            },
        ),
        choice(
            'look.exposure_mode',
            'Exposure',
            options([
                ['anchored', 'Anchored to disk'],
                ['manual', 'Manual EV100'],
            ]),
            {
                control: 'segmented',
                help: 'Anchored: the disk photosphere at its peak temperature sets the exposure, so the image level stays put while the true relative dimming and brightening show. Manual: a photometric camera exposure EV100 on absolute luminance in cd/m^2.',
            },
        ),
        slider('look.exposure_ev', 'Exposure compensation', -6, 6, 0.05, {
            unit: 'EV',
            format: signedFixed(2),
            visible: (p) => look(p).exposure_mode !== 'manual',
            help: 'Exposure compensation in stops (factors of 2).',
        }),
        slider('look.ev100', 'EV100', -10, 70, 0.1, {
            format: signedFixed(1),
            visible: (p) => look(p).exposure_mode === 'manual',
            help: 'Camera exposure value at ISO 100: H = 1 / (1.2 * 2^EV100). A 5000 K photosphere (9e8 cd/m^2) needs about 30.5.',
        }),
    ]),
    ...section('look', 'White balance', [
        toggle('look.white_balance_enabled', 'White balance', {
            apply: 'redraw',
            track: 'scenario',
            help: 'Bradford chromatic adaptation that renders a blackbody at the chosen temperature as neutral white. Off: the camera is balanced for D65.',
        }),
        slider('look.white_balance_k', 'White point', 1500, 20000, 50, {
            unit: 'K',
            format: fixed(0),
            apply: 'redraw',
            track: 'scenario',
            visible: (p) => !!look(p).white_balance_enabled,
            help: 'Blackbody temperature that appears white.',
        }),
    ]),
    ...section('look', 'Intensity', [
        slider('look.disk_gain', 'Disk intensity', 0.4, 4, 0.01, {
            format: fixed(2),
            track: 'scenario',
            visible: (p) => disk(p) || jet(p),
            help: 'Brightness multiplier applied to the accretion disk emission.',
        }),
        slider('look.glow', 'Inner glow', 0, 2, 0.01, {
            format: fixed(2),
            track: 'scenario',
            visible: diskMode('thin_disk'),
            help: 'Extra bloom-like emphasis near the hotter inner disk region.',
        }),
        slider('look.doppler_boost', 'Doppler boost', 0, 2.5, 0.01, {
            format: fixed(2),
            visible: (p) => !!p.beaming && !p.physical_beaming,
            help: 'Controls visual strength of relativistic beaming contrast.',
        }),
        slider('look.aberration_strength', 'Aberration strength', 0, 3, 0.01, {
            format: fixed(2),
            visible: (p) => !!p.aberration,
            help: 'Scales apparent directional warping from observer motion.',
        }),
        slider('look.galaxy_gain', 'Sky brightness', 0, 2.5, 0.01, {
            format: fixed(2),
            track: 'scenario',
            help: 'Brightness multiplier for the background sky: the Milky Way and its stars, seen from Earth and shown in galactic coordinates as a stand-in for the host galaxy.',
        }),
    ]),
    ...section('look', 'Bloom', [
        toggle('bloom.enabled', 'Bloom', {
            apply: 'redraw',
            track: 'scenario',
            help: 'Energy-conserving glare of the camera optics, applied to the HDR frame before tone mapping: (1 - k) image + k blurred image, with no threshold.',
        }),
        slider('bloom.strength', 'Strength', 0, 0.25, 0.005, {
            format: fixed(3),
            apply: 'redraw',
            track: 'scenario',
            visible: (p) => !!(p as P).bloom.enabled,
            help: 'Fraction k of all light spread into the glare (typical lenses 0.02 to 0.05).',
        }),
        slider('bloom.radius', 'Radius', 0, 0.95, 0.01, {
            format: fixed(2),
            apply: 'redraw',
            track: 'scenario',
            visible: (p) => !!(p as P).bloom.enabled,
            help: 'Share of the glare passed on to each twice-as-wide blur level; higher values give wider halos.',
        }),
    ]),

    ...section('render', 'Quality', [
        choice(
            'quality',
            'Quality preset',
            Object.entries(qualityPresetLabels).map(([label, value]) => ({ value, label })),
            {
                apply: 'compile',
                set: (value) => applyQualityPreset(value as string),
                help: 'Global render preset. Higher presets use more ray-marching steps and samples.',
            },
        ),
        ...[
            slider('n_steps', 'Ray steps', 20, 1400, 1, {
                format: fixed(0),
                help: 'More steps improve thin features and strong lensing, but reduce FPS.',
            }),
            slider('sample_count', 'Samples per pixel', 1, 12, 1, {
                format: fixed(0),
                help: 'Supersampling for anti-aliasing and smoother edges. Higher values are slower.',
            }),
            slider('max_revolutions', 'Max orbit turns', 1, 8, 0.1, {
                format: fixed(1),
                help: 'How many wrapped photon turns are traced before escape/capture cutoff.',
            }),
            toggle('rk4_integration', 'RK4 integration', {
                help: 'Higher-order integration for better stability in curved trajectories.',
            }),
        ].map((draft) => ({ ...draft, apply: 'compile' as const, track: 'quality' as const })),
        slider('resolution_scale', 'Resolution scale', 0.35, 2, 0.05, {
            unit: '×',
            format: fixed(2),
            apply: 'resolution',
            track: 'quality',
            help: 'Internal rendering resolution multiplier. <1 lowers cost, >1 supersamples for sharper output.',
        }),
    ]),
    ...section('render', 'Temporal anti-aliasing', [
        toggle('taa_enabled', 'TAA', {
            apply: 'taa',
            track: 'quality',
            help: 'Temporal anti-aliasing on the HDR frame: sub-pixel jitter and a history rectified by YCoCg variance clipping.',
        }),
        ...[
            slider('taa.history_weight', 'History weight', 0, 0.98, 0.01, {
                format: fixed(2),
                help: 'Higher = steadier image but more trailing risk. Lower = cleaner motion.',
            }),
            slider('taa.clip_gamma', 'Clip gamma', 0.25, 4, 0.05, {
                format: fixed(2),
                help: 'Half-width of the history clipping box, in standard deviations of the 3x3 neighbourhood. Lower values reject stale history more aggressively.',
            }),
            slider('taa.motion_rejection', 'Motion rejection', 0, 20, 0.1, {
                format: fixed(1),
                help: 'How quickly history influence drops as camera motion increases.',
            }),
            slider('taa.max_camera_delta', 'Max camera delta', 0.005, 0.5, 0.005, {
                format: fixed(3),
                help: 'Hard camera-motion cutoff where TAA history is fully discarded.',
            }),
        ].map((draft) => ({
            ...draft,
            apply: 'taa' as const,
            track: 'quality' as const,
            visible: (p: EngineParams) => !!p.taa_enabled,
        })),
    ]),
    ...section('render', 'Still accumulation', [
        toggle('accumulation.enabled', 'Still accumulation', {
            apply: 'taa',
            help: 'While the camera, the simulation clock and every ray-tracing setting stay unchanged, average successive jittered frames with equal weights, so a still converges to a clean, anti-aliased image. Pausing the clock (time scale 0) freezes an animated scene for it.',
        }),
        slider('accumulation.max_frames', 'Frames per still', 16, 4096, 16, {
            format: fixed(0),
            apply: 'taa',
            visible: (p) => !!(p as P).accumulation.enabled,
            help: 'Frames averaged into a still before it is final and ray tracing pauses until the view changes.',
        }),
    ]),
];

export const PARAMS_BY_ID = new Map(PARAMS.map((def) => [def.id, def]));
