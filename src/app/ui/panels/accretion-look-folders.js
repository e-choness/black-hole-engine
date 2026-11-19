export function setupAccretionLookFolders(options) {
    options = options || {};

    var gui = options.gui;
    var p = options.parameters;
    var observer = options.observer;
    var addControl = options.addControl;
    var setControlVisible = options.setControlVisible;
    var setControlsVisible = options.setControlsVisible;
    var getUpdateDependentVisibility =
        options.getUpdateDependentVisibility ||
        function () {
            return null;
        };
    var updateShader = options.updateShader || function () {};
    var updateUniformsLive = options.updateUniformsLive || function () {};
    var markShaderDirty = options.markShaderDirty || function () {};
    var diskTemperatureMin = options.diskTemperatureMin;
    var diskTemperatureMax = options.diskTemperatureMax;

    function syncDependentVisibility() {
        var updateDependentVisibility = getUpdateDependentVisibility();
        if (typeof updateDependentVisibility === 'function') {
            updateDependentVisibility();
        }
    }

    var diskFolder = gui.addFolder('Accretion disk');
    addControl(diskFolder, p, 'accretion_disk', {
        name: 'enabled',
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
        help: 'Toggles thermal emission from the accretion disk.',
    });
    var accretionModeCtrl = addControl(diskFolder, p, 'accretion_mode', {
        name: 'accretion type',
        options: ['thin_disk', 'thick_torus', 'slim_disk'],
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateShader();
            observer.turbulenceTimeOffset = -observer.time;
            markShaderDirty();
        },
        help: 'Thin disk: Novikov-Thorne / Page-Thorne disk with the spin-dependent ISCO (quasars/XRBs). Thick torus: ADAF/RIAF (M87*/Sgr A*). Slim disk: super-Eddington.',
    });
    var diskTempModeCtrl = addControl(diskFolder, p.disk, 'temperature_mode', {
        name: 'temperature scale',
        options: {
            'artist (Page-Thorne profile)': 'artist',
            'artist (uniform)': 'uniform',
            'physical (M, Mdot)': 'physical',
        },
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateUniformsLive();
        },
        help: 'Artist: the Page-Thorne profile with the peak temperature below. Artist uniform: the whole disk at that temperature, as in the film Interstellar (James et al. 2015). Physical: the Novikov-Thorne peak temperature of a hole of the given mass accreting at the given Eddington ratio (Page & Thorne 1974).',
    });
    var diskTempCtrl = addControl(diskFolder, p, 'disk_temperature', {
        min: diskTemperatureMin,
        max: diskTemperatureMax,
        step: 1,
        name: 'peak temperature (K)',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Effective temperature at the flux maximum of the Page-Thorne profile, or of the whole disk in uniform mode, before relativistic shifts. An artist choice: physical disks peak at 1e4-1e5 K around supermassive holes and 1e6-1e7 K around stellar-mass ones.',
    });
    var diskMassCtrl = addControl(diskFolder, p.disk, 'mass_msun', {
        min: 1,
        name: 'mass (M_sun)',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Black hole mass for the physical temperature scale; T_peak scales as M^-1/4.',
    });
    var diskEddingtonCtrl = addControl(diskFolder, p.disk, 'eddington_ratio', {
        min: 0.001,
        max: 3.0,
        step: 0.001,
        name: 'L / L_Edd',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Accretion rate as a fraction of the Eddington luminosity, Mdot = L / (eta c^2); T_peak scales as (L / L_Edd)^1/4.',
    });
    var diskColorCorrectionCtrl = addControl(diskFolder, p.disk, 'color_correction', {
        min: 1.0,
        max: 2.7,
        step: 0.01,
        name: 'colour correction f_col',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Spectral hardening of the photosphere, I = f_col^-4 B(f_col T): about 1.7 for stellar-mass disks, 1 to 2.7 for AGN.',
    });
    var diskLimbCtrl = addControl(diskFolder, p.disk, 'limb_darkening', {
        name: 'limb darkening',
        options: ['chandrasekhar', 'eddington', 'none'],
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Angular emission law in the gas frame, flux-normalised: Chandrasekhar 0.4214 (1 + 2.06 mu), Eddington 0.5 + 0.75 mu, or isotropic.',
    });
    var diskOpacityCtrl = addControl(diskFolder, p.disk, 'opacity', {
        min: 0.0,
        max: 1.0,
        step: 0.01,
        name: 'thin-disk opacity',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Fraction of the light behind the thin disk that it blocks: 1 for an optically thick disk, lower values let the images behind it through.',
    });

    var torusCenterCtrl = addControl(diskFolder, p.torus, 'r0', {
        min: 1.5,
        max: 10.0,
        step: 0.1,
        name: 'torus center r',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Center radius of the torus in r_s units (thick torus mode only).',
    });
    var torusHRCtrl = addControl(diskFolder, p.torus, 'h_ratio', {
        min: 0.1,
        max: 1.0,
        step: 0.01,
        name: 'torus H/R',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Height-to-radius ratio of the torus cross-section (thick torus mode only).',
    });
    var torusFalloffCtrl = addControl(diskFolder, p.torus, 'radial_falloff', {
        min: 0.5,
        max: 5.0,
        step: 0.1,
        name: 'radial falloff',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Power-law index for radial emissivity decay. Physical ADAF: 2-4. Lower = flatter profile, higher = more concentrated.',
    });
    var torusOpacityCtrl = addControl(diskFolder, p.torus, 'opacity', {
        min: 0.001,
        max: 0.15,
        step: 0.001,
        name: 'opacity',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Absorption coefficient. Low = optically thin (ADAF). Higher = more self-shielding and defined torus surface.',
    });
    var torusOuterCtrl = addControl(diskFolder, p.torus, 'outer_radius', {
        min: 1.5,
        max: 8.0,
        step: 0.1,
        name: 'outer extent',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Outer edge multiplier relative to torus center r0. Controls how far the torus extends.',
    });

    var slimHRCtrl = addControl(diskFolder, p.slim, 'h_ratio', {
        min: 0.05,
        max: 0.5,
        step: 0.01,
        name: 'slim H/R',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Base height-to-radius ratio of the slim disk. Higher = geometrically thicker.',
    });
    var slimOpacityCtrl = addControl(diskFolder, p.slim, 'opacity', {
        min: 0.1,
        max: 2.0,
        step: 0.01,
        name: 'slim opacity',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Absorption coefficient. Higher = more opaque, surface-like. Lower = more translucent, volumetric.',
    });
    var slimPuffCtrl = addControl(diskFolder, p.slim, 'puff_factor', {
        min: 0.0,
        max: 6.0,
        step: 0.1,
        name: 'ISCO puff',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'How much the disk puffs up near the ISCO due to radiation pressure. Higher = more pronounced thickening.',
    });

    var torusRows = [
        torusCenterCtrl,
        torusHRCtrl,
        torusFalloffCtrl,
        torusOpacityCtrl,
        torusOuterCtrl,
    ];
    var slimRows = [slimHRCtrl, slimOpacityCtrl, slimPuffCtrl];

    var grmhdEnabledCtrl = addControl(diskFolder, p.grmhd, 'enabled', {
        name: 'GRMHD-inspired',
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
        help: 'Enables GRMHD-inspired morphology controls: two-temperature plasma weighting, synchrotron-inspired emissivity corrections, MRI-inspired turbulence, and magnetic-field effects. These are semi-analytic visual models, not full GRMHD evolution.',
    });
    var grmhdRHighCtrl = addControl(diskFolder, p.grmhd, 'r_high', {
        min: 1.0,
        max: 160.0,
        step: 1.0,
        name: 'R_high',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Renderer-side Ti:Te / electron-heating proxy. Higher R_high suppresses high-beta disk-body emission most strongly in the GRMHD torus branch, while thin/slim disks keep the effect deliberately milder so the RGB disk remains visible.',
    });
    var grmhdBetaCtrl = addControl(diskFolder, p.grmhd, 'magnetic_beta', {
        min: 0.01,
        max: 100.0,
        step: 0.1,
        name: 'plasma beta',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Ratio of gas-to-magnetic pressure in the disk midplane. Low beta = strongly magnetized, high beta = gas dominated. GRMHD simulations: beta ~ 1-30.',
    });
    var grmhdMADCtrl = addControl(diskFolder, p.grmhd, 'mad_flux', {
        min: 0.0,
        max: 1.0,
        step: 0.01,
        name: 'MAD flux',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Magnetically Arrested Disk saturation. 0 = SANE (standard), 1 = full MAD. MAD state creates stronger B-fields, prominent m=1 spiral arms, and more powerful jets (Tchekhovskoy+ 2011).',
    });
    var grmhdDensityCtrl = addControl(diskFolder, p.grmhd, 'density_scale', {
        min: 0.1,
        max: 5.0,
        step: 0.1,
        name: 'density scale',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Normalization of the GRMHD density profile. Higher values increase overall emissivity and absorption.',
    });
    var grmhdTurbCtrl = addControl(diskFolder, p.grmhd, 'turbulence_amp', {
        min: 0.0,
        max: 3.0,
        step: 0.1,
        name: 'MRI turbulence',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Amplitude of MRI-driven turbulent density fluctuations. 0 = smooth, 1 = typical GRMHD, 3 = strongly turbulent. Controls log-normal density PDF and spiral arm contrast.',
    });
    var grmhdKappaCtrl = addControl(diskFolder, p.grmhd, 'electron_kappa', {
        min: 2.5,
        max: 8.0,
        step: 0.1,
        name: 'kappa (non-thermal)',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Kappa-distribution index for non-thermal electrons from magnetic reconnection. Kappa ~ 3.5 = strong non-thermal tail, Kappa ~ 8 = nearly thermal.',
    });
    var grmhdBFieldCtrl = addControl(diskFolder, p.grmhd, 'magnetic_field_str', {
        min: 0.1,
        max: 5.0,
        step: 0.1,
        name: 'B-field strength',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Overall magnetic field strength scaling. Affects synchrotron emissivity, self-absorption, and electron temperature.',
    });
    var grmhdRows = [
        grmhdRHighCtrl,
        grmhdBetaCtrl,
        grmhdMADCtrl,
        grmhdDensityCtrl,
        grmhdTurbCtrl,
        grmhdKappaCtrl,
        grmhdBFieldCtrl,
    ];

    function syncDiskEmissionRows() {
        var on = !!p.accretion_disk;
        var physical = p.disk.temperature_mode === 'physical';
        setControlVisible(diskTempModeCtrl, on);
        setControlVisible(diskTempCtrl, on && !physical);
        setControlsVisible([diskMassCtrl, diskEddingtonCtrl], on && physical);
        setControlsVisible([diskColorCorrectionCtrl, diskLimbCtrl], on);
        setControlVisible(diskOpacityCtrl, on && p.accretion_mode === 'thin_disk');
    }

    setControlVisible(accretionModeCtrl, !!p.accretion_disk);
    syncDiskEmissionRows();
    setControlsVisible(torusRows, !!p.accretion_disk && p.accretion_mode === 'thick_torus');
    setControlsVisible(slimRows, !!p.accretion_disk && p.accretion_mode === 'slim_disk');
    setControlVisible(grmhdEnabledCtrl, !!p.accretion_disk);
    setControlsVisible(grmhdRows, !!p.accretion_disk && !!p.grmhd.enabled);
    diskFolder.open();

    var jetFolder = gui.addFolder('Relativistic jets');
    addControl(jetFolder, p.jet, 'enabled', {
        name: 'enabled',
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
        help: 'Bipolar analytic jets aligned with the spin axis. The detailed mode adds GRMHD-inspired structure and Blandford-Znajek-like power scaling.',
    });
    var jetModeCtrl = addControl(jetFolder, p.jet, 'mode', {
        name: 'jet model',
        options: ['simple', 'physical'],
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
        help: 'Simple: smooth analytic jet. Physical: more detailed GRMHD-inspired jet model with spine/sheath, reconfinement knots, corona base, and disk occultation.',
    });
    var jetAngleCtrl = addControl(jetFolder, p.jet, 'half_angle', {
        min: 1.0,
        max: 25.0,
        step: 0.5,
        name: 'half-angle (deg)',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Opening half-angle of the jet. Typical AGN jets: 2-7 deg. Parabolic collimation narrows the beam with distance.',
    });
    var jetLorentzCtrl = addControl(jetFolder, p.jet, 'lorentz_factor', {
        min: 1.1,
        max: 20.0,
        step: 0.1,
        name: 'Lorentz Gamma',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Bulk Lorentz factor for relativistic beaming.',
    });
    var jetBrightCtrl = addControl(jetFolder, p.jet, 'brightness', {
        min: 0.05,
        max: 3.0,
        step: 0.01,
        name: 'brightness',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Overall jet synchrotron emission strength.',
    });
    var jetLengthCtrl = addControl(jetFolder, p.jet, 'length', {
        min: 5.0,
        max: 60.0,
        step: 1.0,
        name: 'length (r_s)',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Visible jet length in Schwarzschild radii.',
    });
    var jetSpectralIndexCtrl = addControl(jetFolder, p.jet, 'spectral_index', {
        min: -0.5,
        max: 2.5,
        step: 0.01,
        name: 'spectral index',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Optically thin synchrotron slope alpha, F_nu ~ nu^-alpha: sets the jet colour, which no Doppler shift changes, and the steady-jet beaming g^(2+alpha).',
    });
    var jetMagCtrl = addControl(jetFolder, p.jet, 'magnetization', {
        min: 1.0,
        max: 50.0,
        step: 0.5,
        name: 'sigma (magnetization)',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Plasma magnetization at jet base.',
    });
    var jetKnotCtrl = addControl(jetFolder, p.jet, 'knot_spacing', {
        min: 2.0,
        max: 15.0,
        step: 0.5,
        name: 'knot spacing',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Spacing of reconfinement shock knots.',
    });
    var jetCoronaCtrl = addControl(jetFolder, p.jet, 'corona_brightness', {
        min: 0.0,
        max: 5.0,
        step: 0.1,
        name: 'corona glow',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Brightness of the jet-corona connection at the base.',
    });
    var jetBaseWidthCtrl = addControl(jetFolder, p.jet, 'base_width', {
        min: 0.0,
        max: 1.0,
        step: 0.01,
        name: 'base width',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Controls how wide the jet funnel is at the base.',
    });
    var jetCoronaExtentCtrl = addControl(jetFolder, p.jet, 'corona_extent', {
        min: 0.0,
        max: 1.0,
        step: 0.01,
        name: 'corona extent',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Radial spread of the corona base emission.',
    });
    var jetCommonCtrls = [
        jetModeCtrl,
        jetAngleCtrl,
        jetLorentzCtrl,
        jetBrightCtrl,
        jetLengthCtrl,
        jetSpectralIndexCtrl,
    ];
    var jetPhysicalCtrls = [
        jetMagCtrl,
        jetKnotCtrl,
        jetCoronaCtrl,
        jetBaseWidthCtrl,
        jetCoronaExtentCtrl,
    ];

    var spinFolder = gui.addFolder('Black hole');
    addControl(spinFolder, p.black_hole, 'spin_enabled', {
        name: 'rotation enabled',
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateUniformsLive();
        },
        help: 'Enables Kerr-like rotation effects. Disable for a Schwarzschild-style shadow.',
    });
    var spinCtrl = addControl(spinFolder, p.black_hole, 'spin', {
        min: -0.998,
        max: 0.998,
        step: 0.001,
        name: 'a/M',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Signed Kerr spin.',
    });
    var spinStrengthCtrl = addControl(spinFolder, p.black_hole, 'spin_strength', {
        min: 0.0,
        max: 1.4,
        step: 0.01,
        name: 'shadow squeeze',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Visual strength multiplier for rotation-induced asymmetry in the shadow.',
    });
    spinFolder.open();

    var lookFolder = gui.addFolder('Look');
    addControl(lookFolder, p.look, 'tone_mapper', {
        options: {
            AgX: 'agx',
            'Khronos PBR Neutral': 'neutral',
            'ACES filmic': 'aces',
            'Scientific (log, Inferno)': 'scientific',
        },
        name: 'tone mapper',
        trackBlackHolePreset: true,
        onChange: markShaderDirty,
        help: 'AgX: rolls saturated blackbody colours towards white without hue skew. Neutral: keeps hue and saturation below the highlight shoulder. ACES: filmic contrast with some hue shift in bright saturated colours. Scientific: false colour of log2 luminance over 12 stops through the Inferno map, which is perceptually uniform and stays readable with colour-vision deficiency.',
    });
    var whiteBalanceKCtrl;
    addControl(lookFolder, p.look, 'white_balance_enabled', {
        name: 'white balance',
        trackBlackHolePreset: true,
        onChange: function () {
            setControlVisible(whiteBalanceKCtrl, p.look.white_balance_enabled);
            markShaderDirty();
        },
        help: 'Bradford chromatic adaptation that renders a blackbody at the chosen temperature as neutral white. Off: the camera is balanced for D65.',
    });
    whiteBalanceKCtrl = addControl(lookFolder, p.look, 'white_balance_k', {
        min: 1500,
        max: 20000,
        step: 50,
        name: 'white point (K)',
        trackBlackHolePreset: true,
        onChange: markShaderDirty,
        help: 'Blackbody temperature that appears white.',
    });
    setControlVisible(whiteBalanceKCtrl, p.look.white_balance_enabled);
    var exposureEvCtrl;
    var ev100Ctrl;
    function syncExposureRows() {
        setControlVisible(exposureEvCtrl, p.look.exposure_mode !== 'manual');
        setControlVisible(ev100Ctrl, p.look.exposure_mode === 'manual');
    }
    addControl(lookFolder, p.look, 'exposure_mode', {
        name: 'exposure',
        options: { 'anchored to disk': 'anchored', 'manual EV100': 'manual' },
        onChange: function () {
            syncExposureRows();
            updateUniformsLive();
        },
        help: 'Anchored: the disk photosphere at its peak temperature sets the exposure, so the image level stays put while the true relative dimming and brightening show. Manual: a photometric camera exposure EV100 on absolute luminance in cd/m^2.',
    });
    exposureEvCtrl = addControl(lookFolder, p.look, 'exposure_ev', {
        min: -6.0,
        max: 6.0,
        step: 0.05,
        name: 'exposure (EV)',
        onChange: updateUniformsLive,
        help: 'Exposure compensation in stops (factors of 2).',
    });
    ev100Ctrl = addControl(lookFolder, p.look, 'ev100', {
        min: -10.0,
        max: 70.0,
        step: 0.1,
        name: 'EV100',
        onChange: updateUniformsLive,
        help: 'Camera exposure value at ISO 100: H = 1 / (1.2 * 2^EV100). A 5000 K photosphere (9e8 cd/m^2) needs about 30.5.',
    });
    syncExposureRows();
    var lookDiskGainCtrl = addControl(lookFolder, p.look, 'disk_gain', {
        min: 0.4,
        max: 4.0,
        step: 0.01,
        name: 'disk intensity',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Brightness multiplier applied to the accretion disk emission.',
    });
    var lookGlowCtrl = addControl(lookFolder, p.look, 'glow', {
        min: 0.0,
        max: 2.0,
        step: 0.01,
        name: 'inner glow',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Extra bloom-like emphasis near the hotter inner disk region.',
    });
    var lookDopplerBoostCtrl = addControl(lookFolder, p.look, 'doppler_boost', {
        min: 0.0,
        max: 2.5,
        step: 0.01,
        name: 'doppler boost',
        onChange: updateUniformsLive,
        help: 'Controls visual strength of relativistic beaming contrast.',
    });
    var lookAberrationStrengthCtrl = addControl(lookFolder, p.look, 'aberration_strength', {
        min: 0.0,
        max: 3.0,
        step: 0.01,
        name: 'aberration strength',
        onChange: updateUniformsLive,
        help: 'Scales apparent directional warping from observer motion.',
    });
    addControl(lookFolder, p.look, 'galaxy_gain', {
        min: 0.0,
        max: 2.5,
        step: 0.01,
        name: 'sky gain',
        trackBlackHolePreset: true,
        onChange: updateUniformsLive,
        help: 'Brightness multiplier for the background sky: the Milky Way and its stars, seen from Earth and shown in galactic coordinates as a stand-in for the host galaxy.',
    });
    lookFolder.open();

    var ppFolder = gui.addFolder('Post-processing');
    addControl(ppFolder, p.bloom, 'enabled', {
        name: 'bloom',
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            markShaderDirty();
        },
        help: 'Energy-conserving glare of the camera optics, applied to the HDR frame before tone mapping: (1 - k) image + k blurred image, with no threshold.',
    });
    var bloomStrengthCtrl = addControl(ppFolder, p.bloom, 'strength', {
        min: 0.0,
        max: 0.25,
        step: 0.005,
        name: 'bloom strength',
        trackBlackHolePreset: true,
        onChange: markShaderDirty,
        help: 'Fraction k of all light spread into the glare (typical lenses 0.02 to 0.05).',
    });
    var bloomRadiusCtrl = addControl(ppFolder, p.bloom, 'radius', {
        min: 0.0,
        max: 0.95,
        step: 0.01,
        name: 'bloom radius',
        trackBlackHolePreset: true,
        onChange: markShaderDirty,
        help: 'Share of the glare passed on to each twice-as-wide blur level; higher values give wider halos.',
    });
    ppFolder.open();

    return {
        accretionModeCtrl: accretionModeCtrl,
        syncDiskEmissionRows: syncDiskEmissionRows,
        torusRows: torusRows,
        slimRows: slimRows,
        grmhdEnabledCtrl: grmhdEnabledCtrl,
        grmhdRows: grmhdRows,
        jetCommonCtrls: jetCommonCtrls,
        jetPhysicalCtrls: jetPhysicalCtrls,
        spinCtrl: spinCtrl,
        spinStrengthCtrl: spinStrengthCtrl,
        lookDiskGainCtrl: lookDiskGainCtrl,
        lookGlowCtrl: lookGlowCtrl,
        lookDopplerBoostCtrl: lookDopplerBoostCtrl,
        lookAberrationStrengthCtrl: lookAberrationStrengthCtrl,
        bloomStrengthCtrl: bloomStrengthCtrl,
        bloomRadiusCtrl: bloomRadiusCtrl,
    };
}
