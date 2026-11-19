import assert from 'node:assert/strict';

export function assertClose(actual, expected, { rel = 1e-12, abs = 0 } = {}, message) {
    const tolerance = Math.max(abs, rel * Math.abs(expected));
    assert.ok(
        typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
        message ?? `expected ${actual} to be within ${tolerance} of ${expected}`,
    );
}

// Checks that `actual` rounds to a reference value printed as text ("0.94281", "2.665e32"), i.e.
// lies within half a unit in the last printed place.
export function assertRoundsTo(actual, expectedText, message) {
    const [mantissa, exponent = '0'] = expectedText.toLowerCase().split('e');
    const places = mantissa.includes('.') ? mantissa.split('.')[1].length : 0;
    const unit = 10 ** (Number(exponent) - places);
    const expected = Number(expectedText);
    const tolerance = 0.5 * unit * (1 + 1e-9);
    assert.ok(
        typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
        message ?? `expected ${actual} to round to ${expectedText} (tolerance ${tolerance})`,
    );
}
