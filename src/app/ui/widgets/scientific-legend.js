// Colour bar of the Scientific tone mapper: the Inferno window of log2 luminance, labelled in
// cd/m^2 at whole decades. It follows the exposure and is shown only while that mode is active;
// the DOM is touched only when the window or the visibility changes.

import { infernoColor, scientificLuminanceRange } from '../../graphics/output-pass.js';

const GRADIENT_STOPS = 16;
const LOG2_10 = Math.log2(10);

let legend = null;
let shownKey = 'hidden';

function decadeLabel(exponent) {
    const label = document.createElement('span');
    const power = document.createElement('sup');
    power.textContent = String(exponent).replace('-', '−');
    label.append('10', power);
    return label;
}

function formatLuminance(log2Value) {
    return (2 ** log2Value).toExponential(1).replace('e+', 'e');
}

function createLegend() {
    const root = document.createElement('div');
    root.id = 'scientific-legend';
    root.className = 'scientific-legend';
    root.setAttribute('role', 'img');
    root.hidden = true;

    const bar = document.createElement('div');
    bar.className = 'scientific-legend-bar';
    const stops = [];
    for (let i = 0; i <= GRADIENT_STOPS; i++) {
        const rgb = infernoColor(i / GRADIENT_STOPS).map((v) => Math.round(v * 255));
        stops.push(`rgb(${rgb.join(', ')}) ${((100 * i) / GRADIENT_STOPS).toFixed(2)}%`);
    }
    bar.style.background = `linear-gradient(to right, ${stops.join(', ')})`;

    const ticks = document.createElement('div');
    ticks.className = 'scientific-legend-ticks';
    const caption = document.createElement('div');
    caption.className = 'scientific-legend-caption';
    root.append(bar, ticks, caption);
    document.body.appendChild(root);
    return { root, ticks, caption };
}

export function updateScientificLegend(parameters, log2Exposure) {
    const visible = parameters.look.tone_mapper === 'scientific' && Number.isFinite(log2Exposure);
    const bolometric = parameters.radiance_model !== 'visible';
    const range = visible ? scientificLuminanceRange(log2Exposure) : null;
    const key = visible ? `${range.log2Max.toFixed(4)} ${bolometric}` : 'hidden';
    if (key === shownKey) return;
    shownKey = key;
    if (!legend) {
        if (!visible) return;
        legend = createLegend();
    }
    legend.root.hidden = !visible;
    if (!visible) return;

    const span = range.log2Max - range.log2Min;
    const firstDecade = Math.ceil(range.log2Min / LOG2_10);
    const lastDecade = Math.floor(range.log2Max / LOG2_10);
    const labels = [];
    for (let k = firstDecade; k <= lastDecade; k++) {
        const label = decadeLabel(k);
        label.style.left = `${((100 * (k * LOG2_10 - range.log2Min)) / span).toFixed(2)}%`;
        labels.push(label);
    }
    legend.ticks.replaceChildren(...labels);

    const quantity = bolometric ? 'bolometric radiance (6504 K efficacy)' : 'luminance';
    legend.caption.textContent = `${quantity} in cd/m², log scale`;
    legend.root.setAttribute(
        'aria-label',
        `Scientific false colour: ${quantity} from ${formatLuminance(range.log2Min)} to ` +
            `${formatLuminance(range.log2Max)} cd/m² on a log scale, dark to bright through ` +
            'the Inferno colour map',
    );
}
