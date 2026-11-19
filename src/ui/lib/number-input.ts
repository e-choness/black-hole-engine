const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

// Accepts what the value chips display ("6.5 × 10⁹ M☉", "12 000 K", "−0.5") as well as plain
// numbers; returns NaN for anything else.
export function parseNumber(text: string): number {
    let clean = text.replace(/[\s,]/g, '').replace(/[−–]/g, '-');
    clean = clean.replace(/×10\^?([-⁻]?[0-9⁰¹²³⁴⁵⁶⁷⁸⁹]+)/, (_, exponent: string) => {
        const digits = [...exponent].map((char) => {
            if (char === '⁻') return '-';
            const index = SUPERSCRIPT_DIGITS.indexOf(char);
            return index >= 0 ? String(index) : char;
        });
        return `e${digits.join('')}`;
    });
    clean = clean.replace(/[^0-9eE.+-]/g, '');
    return clean ? Number(clean) : Number.NaN;
}

// The text an edited chip starts with: plain digits, or exponent notation for very large and
// very small values.
export function editableNumber(value: number): string {
    const magnitude = Math.abs(value);
    if (magnitude >= 1e6 || (magnitude > 0 && magnitude < 1e-3)) {
        return value.toExponential(3).replace('e+', 'e');
    }
    return String(Number(value.toPrecision(6)));
}
