export function setupSimulationFolders(options) {
    options = options || {};

    var gui = options.gui;
    var p = options.parameters;
    var observer = options.observer;
    var addControl = options.addControl;
    var updateUniforms = options.updateUniforms || function () {};
    var updateShader = options.updateShader || function () {};
    var markShaderDirty = options.markShaderDirty || function () {};
    var planetOrbitMin = options.planetOrbitMin;
    var getUpdateDependentVisibility =
        options.getUpdateDependentVisibility ||
        function () {
            return null;
        };

    function syncDependentVisibility() {
        var updateDependentVisibility = getUpdateDependentVisibility();
        if (typeof updateDependentVisibility === 'function') {
            updateDependentVisibility();
        }
    }

    var folder = gui.addFolder('Planet');
    addControl(folder, p.planet, 'enabled', {
        name: 'enabled',
        help: 'Adds an orbiting planet used as a reference object.',
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
    });
    var planetDistanceCtrl = addControl(folder, p.planet, 'distance', {
        min: planetOrbitMin,
        step: 0.1,
        name: 'distance',
        onChange: updateUniforms,
        help: 'Orbital radius of the planet. Public controls clamp this to r >= 3 r_s so the reference body stays in the stable timelike-orbit regime.',
    });
    var planetRadiusCtrl = addControl(folder, p.planet, 'radius', {
        min: 0.01,
        max: 2.0,
        step: 0.01,
        name: 'radius',
        onChange: updateUniforms,
        help: 'Planet size in simulation units.',
    });
    folder.domElement.classList.add('planet-controls');

    folder = gui.addFolder('Relativistic effects');
    addControl(folder, p, 'aberration', {
        name: 'aberration (ray dir)',
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
        help: 'Changes apparent incoming ray direction due to observer velocity.',
    });
    addControl(folder, p, 'beaming', {
        name: 'beaming (intensity)',
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
        help: 'Scales the brightness of every emitter with the frequency ratio g = nu_obs / nu_emit: g^4 (bolometric) or Y(gT) / Y(T) (visible band) for thermal sources, g^(2+alpha) for synchrotron jets.',
    });
    var physicalBeamingCtrl = addControl(folder, p, 'physical_beaming', {
        name: 'physical beaming',
        trackBlackHolePreset: true,
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
        help: 'Exact relativistic beaming from the invariance of I_nu / nu^3. Off: a softened cinematic curve limited to g in [0.68, 1.61].',
    });
    addControl(folder, p, 'doppler_shift', {
        name: 'doppler shift (color)',
        trackBlackHolePreset: true,
        onChange: updateShader,
        help: 'Colour of thermal emitters at the shifted temperature g T. Synchrotron power laws keep their colour under any shift.',
    });
    addControl(folder, p, 'radiance_model', {
        name: 'radiance model',
        options: { 'bolometric (g^4)': 'bolometric', 'visible band Y(gT)': 'visible' },
        onChange: function () {
            updateUniforms();
            markShaderDirty();
        },
        help: 'Bolometric: brightness follows the total radiated power, sigma (g T)^4 / pi. Visible: brightness is the CIE luminance of the shifted blackbody, as the eye would see it.',
    });
    addControl(folder, p, 'gravitational_time_dilation', {
        name: 'time dilation',
        onChange: updateShader,
        className: 'planet-controls indirect-planet-controls',
        help: 'Accounts for rate differences between local and distant observer clocks.',
    });
    var lorentzContractionCtrl = addControl(folder, p, 'lorentz_contraction', {
        name: 'lorentz contraction',
        onChange: updateShader,
        className: 'planet-controls indirect-planet-controls',
        help: 'Applies length contraction effects to moving scene elements.',
    });
    folder.open();

    folder = gui.addFolder('Time');
    addControl(folder, p, 'light_travel_time', {
        onChange: function () {
            syncDependentVisibility();
            updateShader();
        },
        help: 'Enables retarded-time rendering, where events are seen after light delay.',
    });
    addControl(folder, p, 'time_scale', {
        min: 0,
        max: 6,
        step: 0.01,
        name: 'time scale',
        help: 'Simulation clock multiplier.',
    });
    var resetSimObj = {
        'reset simulation': function () {
            observer.time = 0.0;
            markShaderDirty();
        },
    };
    folder.add(resetSimObj, 'reset simulation').name('↺ reset simulation');

    return {
        planetDistanceCtrl: planetDistanceCtrl,
        planetRadiusCtrl: planetRadiusCtrl,
        physicalBeamingCtrl: physicalBeamingCtrl,
        lorentzContractionCtrl: lorentzContractionCtrl,
    };
}
