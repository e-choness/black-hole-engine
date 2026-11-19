// Formatting of physical quantities for HUD readouts. Output strings use typographic characters so
// readouts never wrap or misalign: a no-break space between value and unit and around the
// multiplication sign, a narrow no-break space as the digit-group separator ("12 000"), the
// minus sign U+2212 and Unicode superscript exponents ("1.92 × 10¹⁰ km"). toSpeech() turns these
// strings into words for aria-label / aria-valuetext, because screen readers read "10¹⁰" as
// "1010".

import {
    ASTRONOMICAL_UNIT,
    DAY,
    HOUR,
    JOULE_IN_ERG,
    JULIAN_YEAR,
    LIGHT_YEAR,
    MINUTE,
    PARSEC,
    SOLAR_LUMINOSITY,
    STANDARD_GRAVITY,
} from './constants.js';

export const NBSP = '\u{a0}';
export const NARROW_NBSP = '\u{202f}';
export const MINUS = '\u{2212}';
export const TIMES = '×';
export const MISSING = '—';
export const INFINITY = '∞';
export const SOLAR_MASS_SYMBOL = 'M☉';

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

export function toSuperscript(integer) {
    return String(Math.trunc(integer))
        .replace('-', '⁻')
        .replace(/\d/g, (digit) => SUPERSCRIPT_DIGITS[Number(digit)]);
}

function withMinus(text) {
    return text.startsWith('-') ? MINUS + text.slice(1) : text;
}

function trimFractionZeros(text) {
    return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

function groupDigits(text) {
    const [integer, fraction] = text.split('.');
    const digits = integer.replace('-', '');
    if (digits.length < 5) return text;
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
    const signed = integer.startsWith('-') ? `-${grouped}` : grouped;
    return fraction === undefined ? signed : `${signed}.${fraction}`;
}

function nonFiniteText(value) {
    if (value === Infinity) return INFINITY;
    if (value === -Infinity) return MINUS + INFINITY;
    return MISSING;
}

// Scientific notation with `digits` significant digits. toExponential() handles the rounding
// carry (9.996 -> 1.00e+1). Trailing zeros of the mantissa are dropped unless trimZeros is false.
export function formatScientificParts(value, digits = 3, { trimZeros = true } = {}) {
    const [rawMantissa, rawExponent] = value.toExponential(Math.max(0, digits - 1)).split('e');
    const mantissa = withMinus(trimZeros ? trimFractionZeros(rawMantissa) : rawMantissa);
    const exponent = Number(rawExponent);
    return {
        mantissa,
        exponent,
        text: `${mantissa}${NBSP}${TIMES}${NBSP}10${toSuperscript(exponent)}`,
    };
}

// `digits` significant digits, in plain decimal notation when the rounded magnitude lies in
// [scientificBelow, scientificAbove) and in scientific notation outside it. `decimals` fixes the
// number of decimal places of plain output instead ("0.67", "1.01"). Plain decimals keep
// trailing zeros ("0.500") unless trimZeros is set; scientific mantissas always drop them.
export function formatNumber(
    value,
    { digits = 3, decimals, scientificAbove = 1e5, scientificBelow = 1e-3, trimZeros = false } = {},
) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return nonFiniteText(value);
    if (value === 0) return decimals === undefined ? '0' : (0).toFixed(decimals);
    const rounded =
        decimals === undefined
            ? Number(value.toPrecision(digits))
            : Number(value.toFixed(decimals));
    const magnitude = Math.abs(rounded);
    if (magnitude >= scientificAbove || magnitude < scientificBelow) {
        return formatScientificParts(value, digits).text;
    }
    const places = decimals ?? Math.max(0, digits - 1 - Math.floor(Math.log10(magnitude)));
    let text = rounded.toFixed(places);
    if (trimZeros) text = trimFractionZeros(text);
    return withMinus(groupDigits(text));
}

export function formatSigned(value, options) {
    const text = formatNumber(value, options);
    return value > 0 ? `+${text}` : text;
}

function withUnit(text, unit) {
    return `${text}${NBSP}${unit}`;
}

// Zero is shown in the base unit ("0 s", "0 Hz") rather than the smallest prefix.
function pickUnit(magnitude, table) {
    if (magnitude === 0) return table.find((entry) => entry.size === 1) ?? table[0];
    let chosen = table[0];
    for (const entry of table) {
        if (magnitude >= entry.from) chosen = entry;
    }
    return chosen;
}

function formatWithTable(value, table, unit, options) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return nonFiniteText(value);
    const entry =
        unit === 'auto'
            ? pickUnit(Math.abs(value), table)
            : table.find((candidate) => candidate.symbol === unit);
    if (!entry) throw new RangeError(`unknown unit "${unit}"`);
    return withUnit(formatNumber(value / entry.size, options), entry.symbol);
}

// `from` is the magnitude (in SI base units) from which the automatic choice switches to a unit.
const LENGTH_UNITS = [
    { symbol: 'm', size: 1, from: 0 },
    { symbol: 'km', size: 1e3, from: 1e3 },
    { symbol: 'AU', size: ASTRONOMICAL_UNIT, from: 0.1 * ASTRONOMICAL_UNIT },
    { symbol: 'ly', size: LIGHT_YEAR, from: 0.1 * LIGHT_YEAR },
    { symbol: 'pc', size: PARSEC, from: Infinity },
];

const DURATION_UNITS = [
    { symbol: 'ns', size: 1e-9, from: 0 },
    { symbol: 'µs', size: 1e-6, from: 1e-6 },
    { symbol: 'ms', size: 1e-3, from: 1e-3 },
    { symbol: 's', size: 1, from: 1 },
    { symbol: 'min', size: MINUTE, from: MINUTE },
    { symbol: 'h', size: HOUR, from: HOUR },
    { symbol: 'd', size: DAY, from: 2 * DAY },
    { symbol: 'yr', size: JULIAN_YEAR, from: JULIAN_YEAR },
];

const FREQUENCY_UNITS = [
    { symbol: 'nHz', size: 1e-9, from: 0 },
    { symbol: 'µHz', size: 1e-6, from: 1e-6 },
    { symbol: 'mHz', size: 1e-3, from: 1e-3 },
    { symbol: 'Hz', size: 1, from: 1 },
    { symbol: 'kHz', size: 1e3, from: 1e3 },
];

const POWER_UNITS = [
    { symbol: 'W', size: 1, from: 0 },
    { symbol: 'erg/s', size: 1 / JOULE_IN_ERG, from: Infinity },
    { symbol: 'L☉', size: SOLAR_LUMINOSITY, from: Infinity },
];

const ACCELERATION_UNITS = [
    { symbol: 'g', size: STANDARD_GRAVITY, from: 0 },
    { symbol: 'm/s²', size: 1, from: Infinity },
];

const TIDAL_GRADIENT_UNITS = [
    { symbol: 'g/m', size: STANDARD_GRAVITY, from: 0 },
    { symbol: 's⁻²', size: 1, from: Infinity },
];

const ARCSECOND = Math.PI / 648000;

const ANGLE_UNITS = [
    { symbol: 'µas', size: 1e-6 * ARCSECOND, from: 0 },
    { symbol: 'mas', size: 1e-3 * ARCSECOND, from: 1e-3 * ARCSECOND },
    { symbol: 'arcsec', size: ARCSECOND, from: ARCSECOND },
    { symbol: 'deg', size: Math.PI / 180, from: Math.PI / 180 },
];

export function formatLength(meters, { unit = 'auto', ...options } = {}) {
    return formatWithTable(meters, LENGTH_UNITS, unit, options);
}

export function formatDuration(seconds, { unit = 'auto', ...options } = {}) {
    return formatWithTable(seconds, DURATION_UNITS, unit, options);
}

export function formatFrequency(hertz, { unit = 'auto', ...options } = {}) {
    return formatWithTable(hertz, FREQUENCY_UNITS, unit, options);
}

export function formatPower(watts, { unit = 'W', ...options } = {}) {
    return formatWithTable(watts, POWER_UNITS, unit, options);
}

export function formatAcceleration(metersPerSecond2, { unit = 'g', ...options } = {}) {
    return formatWithTable(metersPerSecond2, ACCELERATION_UNITS, unit, options);
}

// Tidal stretch per metre of body length (m s^-2 per m), e.g. "3.1 × 10⁻⁹ g/m".
export function formatTidalGradient(perSecondSquared, { unit = 'g/m', ...options } = {}) {
    return formatWithTable(perSecondSquared, TIDAL_GRADIENT_UNITS, unit, options);
}

export function formatAngle(radians, { unit = 'auto', ...options } = {}) {
    return formatWithTable(radians, ANGLE_UNITS, unit, options);
}

export function formatTemperature(kelvin, options) {
    if (typeof kelvin !== 'number' || !Number.isFinite(kelvin)) return nonFiniteText(kelvin);
    return withUnit(formatNumber(kelvin, options), 'K');
}

export function formatMass(massSolar, options) {
    if (typeof massSolar !== 'number' || !Number.isFinite(massSolar)) {
        return nonFiniteText(massSolar);
    }
    return withUnit(formatNumber(massSolar, { trimZeros: true, ...options }), SOLAR_MASS_SYMBOL);
}

export function formatSpeed(fractionOfLight, options) {
    if (typeof fractionOfLight !== 'number' || !Number.isFinite(fractionOfLight)) {
        return nonFiniteText(fractionOfLight);
    }
    return withUnit(formatNumber(fractionOfLight, options), 'c');
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

// Clock-style readout of a time span: "06:12:08", "41 d 06:12:08", "3 yr 41 d 06:12:08". Spans
// under a minute use SI prefixes instead ("6.04 ms"), and spans of 10^4 years or more scientific
// years, because a clock face carries no information there. Values are truncated like a clock,
// so the seconds never show 60.
export function formatClock(seconds, { showSeconds = true } = {}) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return nonFiniteText(seconds);
    const sign = seconds < 0 ? MINUS : '';
    const span = Math.abs(seconds);
    if (span < MINUTE) return sign + formatDuration(span);
    if (span >= 1e4 * JULIAN_YEAR) return sign + formatDuration(span, { unit: 'yr' });
    const whole = Math.floor(span);
    const years = Math.floor(whole / JULIAN_YEAR);
    const afterYears = whole - years * JULIAN_YEAR;
    const days = Math.floor(afterYears / DAY);
    const afterDays = afterYears - days * DAY;
    const hours = Math.floor(afterDays / HOUR);
    const minutes = Math.floor((afterDays - hours * HOUR) / MINUTE);
    const secs = Math.floor(afterDays - hours * HOUR - minutes * MINUTE);
    let time = `${pad2(hours)}:${pad2(minutes)}`;
    if (showSeconds) time += `:${pad2(secs)}`;
    const parts = [];
    if (years > 0) parts.push(`${years}${NBSP}yr`);
    if (years > 0 || days > 0) parts.push(`${days}${NBSP}d`);
    parts.push(time);
    return sign + parts.join(NBSP);
}

const UNIT_WORDS = {
    m: 'metres',
    km: 'kilometres',
    AU: 'astronomical units',
    ly: 'light-years',
    pc: 'parsecs',
    ns: 'nanoseconds',
    µs: 'microseconds',
    ms: 'milliseconds',
    s: 'seconds',
    min: 'minutes',
    h: 'hours',
    d: 'days',
    yr: 'years',
    nHz: 'nanohertz',
    µHz: 'microhertz',
    mHz: 'millihertz',
    Hz: 'hertz',
    kHz: 'kilohertz',
    W: 'watts',
    'erg/s': 'ergs per second',
    'L☉': 'solar luminosities',
    g: 'g',
    'm/s²': 'metres per second squared',
    'g/m': 'g per metre',
    's⁻²': 'per second squared',
    µas: 'microarcseconds',
    mas: 'milliarcseconds',
    arcsec: 'arcseconds',
    deg: 'degrees',
    K: 'kelvin',
    [SOLAR_MASS_SYMBOL]: 'solar masses',
    c: 'times the speed of light',
};

const SUPERSCRIPT_PATTERN = /10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g;

function superscriptToNumber(text) {
    return text.replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (character) =>
        character === '⁻' ? 'minus ' : String(SUPERSCRIPT_DIGITS.indexOf(character)),
    );
}

// Words for a formatted quantity, e.g. "1.92 × 10¹⁰ km" -> "1.92 times 10 to the power 10
// kilometres". Clock strings are spoken by clockToSpeech().
export function toSpeech(text) {
    let speech = text
        .replaceAll(NARROW_NBSP, '')
        .replaceAll(NBSP, ' ')
        .replace(SUPERSCRIPT_PATTERN, (match, exponent) => {
            return `10 to the power ${superscriptToNumber(exponent)}`;
        })
        .replaceAll(TIMES, 'times')
        .replace(/^\+/, 'plus ')
        .replaceAll(MINUS, 'minus ')
        .replaceAll(INFINITY, 'infinity')
        .replaceAll(MISSING, 'not available');
    const lastSpace = speech.lastIndexOf(' ');
    const unit = lastSpace >= 0 ? speech.slice(lastSpace + 1) : '';
    if (Object.hasOwn(UNIT_WORDS, unit)) {
        speech = `${speech.slice(0, lastSpace)} ${UNIT_WORDS[unit]}`;
    }
    return speech.replace(/\s+/g, ' ').trim();
}

function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Words for formatClock(): "41 days 6 hours 12 minutes 8 seconds".
export function clockToSpeech(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || Math.abs(seconds) < MINUTE) {
        return toSpeech(formatClock(seconds));
    }
    if (Math.abs(seconds) >= 1e4 * JULIAN_YEAR) return toSpeech(formatClock(seconds));
    const span = Math.floor(Math.abs(seconds));
    const years = Math.floor(span / JULIAN_YEAR);
    let rest = span - years * JULIAN_YEAR;
    const days = Math.floor(rest / DAY);
    rest -= days * DAY;
    const hours = Math.floor(rest / HOUR);
    rest -= hours * HOUR;
    const minutes = Math.floor(rest / MINUTE);
    const secs = rest - minutes * MINUTE;
    const parts = [];
    if (years) parts.push(plural(years, 'year'));
    if (days) parts.push(plural(days, 'day'));
    if (hours) parts.push(plural(hours, 'hour'));
    if (minutes) parts.push(plural(minutes, 'minute'));
    if (secs || parts.length === 0) parts.push(plural(secs, 'second'));
    return (seconds < 0 ? 'minus ' : '') + parts.join(' ');
}
