// The timeline editor's overlay settings: looping, the annotations and parameter values shown on
// screen and burnt into renders, which parameters the values list, and where it sits.
export function setupOverlaysModal(options) {
    var panel = options.panel;
    var esc = options.esc;
    var rememberState = options.rememberState;
    var rebuildTrackList = options.rebuildTrackList;
    var getSelectedTrack = options.getSelectedTrack;
    var getPresentationState = options.getPresentationState;
    var getPresentationParamHudState = options.getPresentationParamHudState;
    var isParamInHud = options.isParamInHud;
    var setPresentationLoop = options.setPresentationLoop;
    var setPresentationAnnotationsEnabled = options.setPresentationAnnotationsEnabled;
    var setPresentationAnnotationsIncludedInRecording =
        options.setPresentationAnnotationsIncludedInRecording;
    var setPresentationParamHudEnabled = options.setPresentationParamHudEnabled;
    var setPresentationParamHudIncludedInRecording =
        options.setPresentationParamHudIncludedInRecording;
    var removeParamFromHud = options.removeParamFromHud;
    var addParamToHud = options.addParamToHud;
    var clearParamHud = options.clearParamHud;
    var setParamHudLayout = options.setParamHudLayout;

    var elements = options.elements;
    var overlaysBtn = elements.overlaysBtn;
    var renderBtn = elements.renderBtn;
    var modal = elements.modal;
    var closeBtn = elements.closeBtn;
    var loopCb = elements.loopCb;
    var annotCb = elements.annotCb;
    var annotRecordCb = elements.annotRecordCb;
    var hudShowCb = elements.hudShowCb;
    var hudRecordCb = elements.hudRecordCb;
    var hudXInput = elements.hudXInput;
    var hudYInput = elements.hudYInput;
    var hudFsInput = elements.hudFsInput;
    var hudLayoutRow = elements.hudLayoutRow;
    var hudEmptyEl = elements.hudEmptyEl;
    var hudListEl = elements.hudListEl;
    var addSelectedBtn = elements.addSelectedBtn;
    var clearHudBtn = elements.clearHudBtn;

    function renderHudList() {
        var hudState = getPresentationParamHudState() || { items: [] };
        var items = Array.isArray(hudState.items) ? hudState.items : [];
        clearHudBtn.disabled = items.length === 0;
        var selectedTrack = getSelectedTrack();
        addSelectedBtn.disabled = !selectedTrack || isParamInHud(selectedTrack);

        hudEmptyEl.hidden = items.length > 0;
        var html = '';
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            html +=
                '<button type="button" class="tl-ov-chip" data-remove-hud-path="' +
                esc(item.path) +
                '" aria-label="Remove ' +
                esc(item.label || item.path) +
                ' from the values">' +
                '<span class="tl-ov-chip-label">' +
                esc(item.label || item.path) +
                '</span>' +
                '<span class="tl-ov-chip-x" aria-hidden="true">&times;</span>' +
                '</button>';
        }
        hudListEl.innerHTML = html;
    }

    function sync() {
        var state = getPresentationState() || {};
        renderBtn.disabled = !!state.recording;
        if (!modal.classList.contains('is-open')) return;

        loopCb.checked = !!state.loop;
        annotCb.checked = !!state.annotations_enabled;
        annotRecordCb.checked = !!state.annotations_in_recording;
        hudShowCb.checked = !!state.param_hud_enabled;
        hudRecordCb.checked = !!state.param_hud_in_recording;
        hudLayoutRow.hidden = !(state.param_hud_count > 0);

        var hudState = getPresentationParamHudState();
        if (document.activeElement !== hudXInput) hudXInput.value = hudState.anchorX.toFixed(2);
        if (document.activeElement !== hudYInput) hudYInput.value = hudState.anchorY.toFixed(2);
        if (document.activeElement !== hudFsInput) hudFsInput.value = hudState.fontSize;
        renderHudList();
    }

    function open() {
        modal.classList.add('is-open');
        overlaysBtn.classList.add('is-active');
        overlaysBtn.setAttribute('aria-expanded', 'true');
        sync();
    }

    function close() {
        if (modal.contains(document.activeElement)) overlaysBtn.focus();
        modal.classList.remove('is-open');
        overlaysBtn.classList.remove('is-active');
        overlaysBtn.setAttribute('aria-expanded', 'false');
    }

    // Registered before the editor's own key handler, so Escape closes this dialog first even when
    // the focus is in one of its fields.
    window.addEventListener(
        'keydown',
        function (e) {
            if (e.key !== 'Escape' || !modal.classList.contains('is-open')) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        },
        true,
    );

    overlaysBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (modal.classList.contains('is-open')) close();
        else open();
    });
    closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        close();
    });

    // The capture dialog renders the loaded timeline; the interface listens for this request.
    renderBtn.addEventListener('click', function () {
        close();
        window.dispatchEvent(new Event('bh:render-timeline'));
    });

    function bindToggle(checkbox, apply) {
        checkbox.addEventListener('change', function () {
            apply(checkbox.checked);
            rememberState();
        });
    }
    bindToggle(loopCb, setPresentationLoop);
    bindToggle(annotCb, setPresentationAnnotationsEnabled);
    bindToggle(annotRecordCb, setPresentationAnnotationsIncludedInRecording);
    bindToggle(hudShowCb, setPresentationParamHudEnabled);
    bindToggle(hudRecordCb, setPresentationParamHudIncludedInRecording);

    function afterHudChange() {
        sync();
        rebuildTrackList();
        rememberState();
    }

    hudListEl.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-remove-hud-path]');
        if (!chip) return;
        removeParamFromHud(chip.getAttribute('data-remove-hud-path'));
        afterHudChange();
    });
    addSelectedBtn.addEventListener('click', function () {
        var selectedTrack = getSelectedTrack();
        if (!selectedTrack) return;
        addParamToHud(selectedTrack, selectedTrack);
        afterHudChange();
    });
    clearHudBtn.addEventListener('click', function () {
        clearParamHud();
        afterHudChange();
    });

    function applyHudLayout() {
        var x = parseFloat(hudXInput.value);
        var y = parseFloat(hudYInput.value);
        var fs = parseFloat(hudFsInput.value);
        setParamHudLayout({
            anchorX: isFinite(x) ? x : undefined,
            anchorY: isFinite(y) ? y : undefined,
            fontSize: isFinite(fs) ? fs : undefined,
        });
        sync();
        rememberState();
    }
    hudXInput.addEventListener('input', applyHudLayout);
    hudYInput.addEventListener('input', applyHudLayout);
    hudFsInput.addEventListener('input', applyHudLayout);

    panel.addEventListener(
        'click',
        function (e) {
            if (
                modal.classList.contains('is-open') &&
                !modal.contains(e.target) &&
                e.target !== overlaysBtn
            ) {
                close();
            }
        },
        true,
    );

    return { sync: sync, open: open, close: close };
}
