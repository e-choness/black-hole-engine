import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DAY, HOUR, JULIAN_YEAR, STANDARD_GRAVITY } from '../../src/features/units/constants.js';
import {
    clockToSpeech,
    formatAcceleration,
    formatAngle,
    formatClock,
    formatDuration,
    formatFrequency,
    formatLength,
    formatMass,
    formatNumber,
    formatPower,
    formatScientificParts,
    formatSigned,
    formatSpeed,
    formatTemperature,
    formatTidalGradient,
    MINUS,
    NARROW_NBSP,
    NBSP,
    toSpeech,
    toSuperscript,
} from '../../src/features/units/format.js';
import { createMassScale } from '../../src/features/units/mass-scaling.js';

// Readable expectations: "_" stands for a no-break space, "^" for a narrow no-break space and
// "-" at the start of a word for the minus sign.
function typo(text) {
    return text
        .replace(/(^|_)-/g, '$1\u{2212}')
        .replaceAll('_', '\u{a0}')
        .replaceAll('^', '\u{202f}');
}

test('typographic characters are the intended code points', () => {
    assert.equal(NBSP, String.fromCodePoint(0xa0));
    assert.equal(NARROW_NBSP, String.fromCodePoint(0x202f));
    assert.equal(MINUS, String.fromCodePoint(0x2212));
    assert.equal(typo('-1_^2_-3'), `${MINUS}1${NBSP}${NARROW_NBSP}2${NBSP}${MINUS}3`);
});

test('superscript exponents', () => {
    assert.equal(toSuperscript(10), '¹⁰');
    assert.equal(toSuperscript(-9), '⁻⁹');
    assert.equal(toSuperscript(0), '⁰');
    assert.equal(toSuperscript(47), '⁴⁷');
});

test('scientific notation handles rounding carries and signs', () => {
    assert.equal(formatScientificParts(9.996e7, 3).text, typo('1_×_10⁸'));
    assert.equal(formatScientificParts(-1.234e-5, 2).text, typo('-1.2_×_10⁻⁵'));
    assert.deepEqual(
        {
            mantissa: formatScientificParts(6.5e9).mantissa,
            exponent: formatScientificParts(6.5e9).exponent,
        },
        { mantissa: '6.5', exponent: 9 },
    );
    assert.equal(formatScientificParts(2e10, 3, { trimZeros: false }).text, typo('2.00_×_10¹⁰'));
});

test('numbers switch between plain and scientific notation on the rounded value', () => {
    assert.equal(formatNumber(0), '0');
    assert.equal(formatNumber(0.9293), '0.929');
    assert.equal(formatNumber(-0.5), typo('-0.500'));
    assert.equal(formatNumber(9.996), '10.0');
    assert.equal(formatNumber(1234.5), '1230');
    assert.equal(formatNumber(12000), typo('12^000'));
    assert.equal(formatNumber(99999.6), typo('1_×_10⁵'));
    assert.equal(formatNumber(1e-4), typo('1_×_10⁻⁴'));
    assert.equal(formatNumber(0.5, { trimZeros: true }), '0.5');
    assert.equal(formatNumber(1.0261, { digits: 4 }), '1.026');
    assert.equal(formatNumber(0.67055, { decimals: 2 }), '0.67');
    assert.equal(formatNumber(1.0119, { decimals: 2 }), '1.01');
    assert.equal(formatNumber(0, { decimals: 2 }), '0.00');
    assert.equal(formatNumber(Number.NaN), '—');
    assert.equal(formatNumber(Infinity), '∞');
    assert.equal(formatNumber(-Infinity), typo('-∞'));
    assert.equal(formatNumber(undefined), '—');
    assert.equal(formatSigned(0.0488, { digits: 2 }), '+0.049');
    assert.equal(formatSigned(-0.0488, { digits: 2 }), typo('-0.049'));
    assert.equal(formatSigned(0), '0');
});

test('HUD readouts from the design reproduce exactly for M87*', () => {
    const scale = createMassScale({ massSolar: 6.5e9, spin: 0.94 });
    assert.equal(formatLength(scale.schwarzschildRadius, { unit: 'km' }), typo('1.92_×_10¹⁰_km'));
    assert.equal(formatDuration(scale.lightCrossingTime), typo('17.8_h'));
    assert.equal(
        formatPower(scale.eddingtonLuminosity, { unit: 'erg/s', digits: 2 }),
        typo('8.2_×_10⁴⁷_erg/s'),
    );
    assert.equal(
        formatLength(scale.toMeters(11, 'rs'), { unit: 'km', digits: 2 }),
        typo('2.1_×_10¹¹_km'),
    );
    const radii = scale.radiiIn('rs');
    assert.equal(formatNumber(radii.horizonOuter, { decimals: 2 }), '0.67');
    assert.equal(formatNumber(radii.iscoPrograde, { decimals: 2 }), '1.01');
    assert.equal(formatNumber(radii.photonOrbitPrograde, { decimals: 2 }), '0.71');
    assert.equal(formatMass(scale.massSolar), typo('6.5_×_10⁹_M☉'));
    assert.equal(formatTemperature(12000), typo('12^000_K'));
    assert.equal(formatSpeed(1 / Math.sqrt(20)), typo('0.224_c'));
    assert.equal(
        formatTidalGradient(3.1e-9 * STANDARD_GRAVITY, { digits: 2 }),
        typo('3.1_×_10⁻⁹_g/m'),
    );
});

test('automatic length units step from metres to light-years', () => {
    assert.equal(formatLength(100), typo('100_m'));
    assert.equal(formatLength(0), typo('0_m'));
    assert.equal(formatLength(31304), typo('31.3_km'));
    assert.equal(formatLength(1.919e13), typo('128_AU'));
    assert.equal(formatLength(1e17), typo('10.6_ly'));
    assert.equal(formatLength(1e17, { unit: 'pc' }), typo('3.24_pc'));
    assert.throws(() => formatLength(1, { unit: 'furlong' }), RangeError);
});

test('automatic duration, frequency, power, acceleration and angle units', () => {
    assert.equal(formatDuration(104e-6), typo('104_µs'));
    assert.equal(formatDuration(5e-10), typo('0.500_ns'));
    assert.equal(formatDuration(90), typo('1.50_min'));
    assert.equal(formatDuration(1.5 * DAY), typo('36.0_h'));
    assert.equal(formatDuration(10.3 * DAY), typo('10.3_d'));
    assert.equal(formatDuration(3 * JULIAN_YEAR), typo('3.00_yr'));
    assert.equal(formatFrequency(642.1), typo('642_Hz'));
    assert.equal(formatFrequency(1.6953e-3), typo('1.70_mHz'));
    assert.equal(formatFrequency(0), typo('0_Hz'));
    assert.equal(formatFrequency(1.121e-6), typo('1.12_µHz'));
    assert.equal(formatFrequency(1729), typo('1.73_kHz'));
    assert.equal(formatPower(2.6651e32), typo('2.67_×_10³²_W'));
    assert.equal(formatPower(3.828e26 * 2, { unit: 'L☉' }), typo('2.00_L☉'));
    assert.equal(formatAcceleration(100 * STANDARD_GRAVITY), typo('100_g'));
    assert.equal(formatAcceleration(9.8, { unit: 'm/s²' }), typo('9.80_m/s²'));
    const muas = Math.PI / 648000 / 1e6;
    assert.equal(formatAngle(39.69 * muas), typo('39.7_µas'));
    assert.equal(formatAngle(2.5e3 * muas), typo('2.50_mas'));
    assert.equal(formatAngle(Math.PI / 4), typo('45.0_deg'));
});

test('clock readouts', () => {
    const t = 41 * DAY + 6 * HOUR + 12 * 60 + 8.9;
    assert.equal(formatClock(t), typo('41_d_06:12:08'));
    assert.equal(formatClock(t, { showSeconds: false }), typo('41_d_06:12'));
    assert.equal(formatClock(38 * DAY + 8 * HOUR + 11 * 60 + 37), typo('38_d_08:11:37'));
    assert.equal(formatClock(6 * HOUR + 5), '06:00:05');
    assert.equal(formatClock(60), '00:01:00');
    assert.equal(formatClock(-90), typo('-00:01:30'));
    assert.equal(formatClock(5e-3), typo('5.00_ms'));
    assert.equal(formatClock(0), typo('0_s'));
    assert.equal(formatClock(3 * JULIAN_YEAR + t), typo('3_yr_41_d_06:12:08'));
    assert.equal(formatClock(JULIAN_YEAR + 60), typo('1_yr_0_d_00:01:00'));
    assert.equal(formatClock(2e4 * JULIAN_YEAR), typo('20^000_yr'));
    assert.equal(formatClock(Number.NaN), '—');
    assert.equal(formatClock(Infinity), '∞');
});

test('speech text for screen readers', () => {
    assert.equal(toSpeech(typo('1.92_×_10¹⁰_km')), '1.92 times 10 to the power 10 kilometres');
    assert.equal(toSpeech(typo('3.1_×_10⁻⁹_g/m')), '3.1 times 10 to the power minus 9 g per metre');
    assert.equal(toSpeech(typo('12^000_K')), '12000 kelvin');
    assert.equal(toSpeech(typo('6.5_×_10⁹_M☉')), '6.5 times 10 to the power 9 solar masses');
    assert.equal(toSpeech('+0.049'), 'plus 0.049');
    assert.equal(toSpeech(typo('-0.5')), 'minus 0.5');
    assert.equal(toSpeech('—'), 'not available');
    assert.equal(toSpeech(typo('17.8_h')), '17.8 hours');
    assert.equal(
        clockToSpeech(41 * DAY + 6 * HOUR + 12 * 60 + 8),
        '41 days 6 hours 12 minutes 8 seconds',
    );
    assert.equal(clockToSpeech(JULIAN_YEAR + DAY + 60), '1 year 1 day 1 minute');
    assert.equal(clockToSpeech(-3600), 'minus 1 hour');
    assert.equal(clockToSpeech(5e-3), '5.00 milliseconds');
    assert.equal(clockToSpeech(60), '1 minute');
});
