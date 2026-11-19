// Versioned, compact URL-fragment codec for view states. A view state is a flat object keyed by
// field path, and a fragment lists only the fields that differ from the defaults of its version:
//   v=1&bs=0.5&dm=torus&ca=30,-3,0
// Decoding never throws: values are parsed strictly, clamped into their ranges and reported as
// issues when something was wrong, and links of older versions are migrated to the latest schema
// one version at a time, so a shared link keeps its meaning when a later version changes defaults.
//
// Field descriptors (all take `key`, the URL key, and `path`, the state key):
//   { type: 'number', default, min, max, step }      linear, rounded to multiples of step
//   { type: 'number', scale: 'log', default, min, max, digits }   rounded to significant digits
//   { type: 'number', ..., wrap: true }              periodic, wrapped into [min, max)
//   { type: 'number', ..., nullable: true }          null means "not set" and encodes as empty
//   { type: 'bool', default }                        encoded 1 / 0
//   { type: 'enum', default, values: [[value, code], ...] }
//   { type: 'slug', default, maxLength, allowEmpty }  kebab-case identifier
//   { type: 'vec', default: [...], components: [numberSpec, ...] }   comma-separated
// Flags read by callers rather than by the codec: volatile (changes continuously; encode() can
// leave it out), history: 'push' (a change deserves its own history entry), custom (applied by
// the app itself), paths (presentation paths of the components of a vec).
// A schema is { version, fields, refine?(state, report), migrate?(previous, carried) }: refine
// applies constraints between fields and calls report(path, reason, value) for what it changed;
// migrate turns the state of the previous version into this one, where `carried` already holds
// every path that both versions share.

export const VIEW_STATE_MAX_LENGTH = 2048;

export const VIEW_STATE_ISSUES = Object.freeze([
    'too-long',
    'not-a-view-state',
    'unsupported-version',
    'unknown-key',
    'duplicate',
    'invalid',
    'unknown-value',
    'clamped',
]);

const KEY_PATTERN = /^[a-z][a-z0-9]{0,3}$/;
const CODE_PATTERN = /^[a-z0-9]+$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const STEP_PATTERN = /^\d+(?:\.\d{1,8})?$/;
const VERSION_PATTERN = /^\d{1,6}$/;
const ISSUE_TEXT_LIMIT = 64;

function stepDecimals(step) {
    const text = String(step);
    return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
}

function isStepMultiple(value, step) {
    const ratio = value / step;
    return Math.abs(ratio - Math.round(ratio)) <= 1e-9 * Math.max(1, Math.abs(ratio));
}

function quantize(spec, value) {
    const rounded =
        spec.scale === 'log'
            ? Number(value.toPrecision(spec.digits))
            : Number((Math.round(value / spec.step) * spec.step).toFixed(stepDecimals(spec.step)));
    return rounded === 0 ? 0 : rounded;
}

function parseNumber(text) {
    return typeof text === 'string' && NUMBER_PATTERN.test(text) ? Number(text) : NaN;
}

// Rounds to the field's precision and keeps it in range. "clamped" is reported only when the
// value lies outside the range even after rounding, so float noise at a bound is no issue.
function normalizeNumber(spec, raw) {
    const value = typeof raw === 'string' ? parseNumber(raw) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value)) return { reason: 'invalid' };
    if (spec.wrap) {
        const span = spec.max - spec.min;
        let wrapped = quantize(spec, value - span * Math.floor((value - spec.min) / span));
        if (wrapped >= spec.max) wrapped = quantize(spec, wrapped - span);
        return { value: wrapped, reason: null };
    }
    const rounded = quantize(spec, value);
    if (rounded >= spec.min && rounded <= spec.max) return { value: rounded, reason: null };
    return {
        value: quantize(spec, Math.min(spec.max, Math.max(spec.min, value))),
        reason: 'clamped',
    };
}

// Shorter of the plain and exponent forms: 6.5e9 rather than 6500000000, 21.2 rather than 2.12e1.
// On a tie large numbers take the exponent (4.297e6) and small ones stay plain (100).
function formatSignificant(value, digits) {
    const rounded = Number(value.toPrecision(digits));
    const plain = String(rounded).replace('e+', 'e');
    const exponent = rounded.toExponential().replace('e+', 'e');
    if (exponent.length === plain.length) return Math.abs(rounded) >= 1e4 ? exponent : plain;
    return exponent.length < plain.length ? exponent : plain;
}

function formatNumber(spec, value) {
    if (spec.scale === 'log') return formatSignificant(value, spec.digits);
    const text = value.toFixed(stepDecimals(spec.step));
    const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
    return trimmed === '-0' ? '0' : trimmed;
}

function numberTextLength(spec) {
    if (spec.scale === 'log') return spec.digits + 7;
    const integer = String(Math.floor(Math.max(Math.abs(spec.min), Math.abs(spec.max)))).length;
    const decimals = stepDecimals(spec.step);
    return (spec.min < 0 ? 1 : 0) + integer + (decimals > 0 ? decimals + 1 : 0);
}

function checkNumberSpec(spec, where, problems) {
    const finite = (value) => typeof value === 'number' && Number.isFinite(value);
    if (!finite(spec.min) || !finite(spec.max) || !(spec.min < spec.max)) {
        problems.push(`${where}: needs finite min < max`);
        return;
    }
    if (spec.scale === 'log') {
        if (!(spec.min > 0)) problems.push(`${where}: a log scale needs min > 0`);
        if (!Number.isInteger(spec.digits) || spec.digits < 1 || spec.digits > 10) {
            problems.push(`${where}: digits must be an integer in 1..10`);
        } else if (
            Number(spec.min.toPrecision(spec.digits)) !== spec.min ||
            Number(spec.max.toPrecision(spec.digits)) !== spec.max
        ) {
            problems.push(`${where}: min and max must have at most ${spec.digits} digits`);
        }
        if (spec.wrap) problems.push(`${where}: a log scale cannot wrap`);
    } else if (spec.scale !== undefined) {
        problems.push(`${where}: unknown scale "${spec.scale}"`);
    } else if (!(spec.step > 0) || !STEP_PATTERN.test(String(spec.step))) {
        problems.push(`${where}: step must be a positive decimal with at most 8 decimals`);
    } else if (!isStepMultiple(spec.min, spec.step) || !isStepMultiple(spec.max, spec.step)) {
        problems.push(`${where}: min and max must be multiples of step`);
    }
}

const numberType = {
    check(field, problems) {
        checkNumberSpec(field, `field ${field.key}`, problems);
    },
    normalize(field, raw) {
        if (raw === null && field.nullable) return { value: null, reason: null };
        return normalizeNumber(field, raw);
    },
    parse(field, text) {
        if (text === '' && field.nullable) return { value: null, reason: null };
        return normalizeNumber(field, parseNumber(text));
    },
    format(field, value) {
        return value === null ? '' : formatNumber(field, value);
    },
    textLength(field) {
        return numberTextLength(field);
    },
};

const boolType = {
    check() {},
    normalize(field, raw) {
        return typeof raw === 'boolean' ? { value: raw, reason: null } : { reason: 'invalid' };
    },
    parse(field, text) {
        if (text === '1' || text === 'true') return { value: true, reason: null };
        if (text === '0' || text === 'false') return { value: false, reason: null };
        return { reason: 'invalid' };
    },
    format(field, value) {
        return value ? '1' : '0';
    },
    textLength() {
        return 1;
    },
};

const enumType = {
    check(field, problems) {
        const where = `field ${field.key}`;
        if (!Array.isArray(field.values) || field.values.length === 0) {
            problems.push(`${where}: values must be a non-empty list of [value, code] pairs`);
            return;
        }
        const codes = new Set();
        const values = new Set();
        for (const entry of field.values) {
            const [value, code] = Array.isArray(entry) ? entry : [];
            if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
                problems.push(`${where}: code "${code}" must be alphanumeric`);
            }
            if (codes.has(code)) problems.push(`${where}: duplicate code "${code}"`);
            if (values.has(String(value))) problems.push(`${where}: duplicate value "${value}"`);
            codes.add(code);
            values.add(String(value));
        }
    },
    normalize(field, raw) {
        const entry =
            field.values.find(([value]) => value === raw) ??
            field.values.find(([value]) => String(value) === String(raw));
        return entry ? { value: entry[0], reason: null } : { reason: 'unknown-value' };
    },
    parse(field, text) {
        const entry = field.values.find(([, code]) => code === text);
        return entry ? { value: entry[0], reason: null } : { reason: 'unknown-value' };
    },
    format(field, value) {
        return field.values.find(([entry]) => entry === value)[1];
    },
    textLength(field) {
        return Math.max(...field.values.map(([, code]) => String(code).length));
    },
};

const slugType = {
    check(field, problems) {
        if (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 64) {
            problems.push(`field ${field.key}: maxLength must be an integer in 1..64`);
        }
    },
    normalize(field, raw) {
        const valid =
            typeof raw === 'string' &&
            (raw === ''
                ? field.allowEmpty === true
                : raw.length <= field.maxLength && SLUG_PATTERN.test(raw));
        return valid ? { value: raw, reason: null } : { reason: 'invalid' };
    },
    parse(field, text) {
        return slugType.normalize(field, text);
    },
    format(field, value) {
        return value;
    },
    textLength(field) {
        return field.maxLength;
    },
};

function normalizeComponents(field, values) {
    if (!Array.isArray(values) || values.length !== field.components.length) {
        return { reason: 'invalid' };
    }
    let reason = null;
    const result = [];
    for (const [index, spec] of field.components.entries()) {
        const component = normalizeNumber(spec, values[index]);
        if (component.reason === 'invalid') return { reason: 'invalid' };
        if (component.reason) reason = component.reason;
        result.push(component.value);
    }
    return { value: result, reason };
}

const vecType = {
    check(field, problems) {
        const where = `field ${field.key}`;
        if (!Array.isArray(field.components) || field.components.length < 2) {
            problems.push(`${where}: components must list at least two number specs`);
            return;
        }
        field.components.forEach((spec, index) => {
            checkNumberSpec(spec ?? {}, `${where} component ${index}`, problems);
        });
        if (
            field.paths !== undefined &&
            (!Array.isArray(field.paths) ||
                field.paths.length !== field.components.length ||
                !field.paths.every((path) => typeof path === 'string' && path.length > 0))
        ) {
            problems.push(`${where}: paths must name one path per component`);
        }
    },
    normalize(field, raw) {
        return normalizeComponents(field, raw);
    },
    parse(field, text) {
        return normalizeComponents(field, text.split(','));
    },
    format(field, value) {
        return value
            .map((component, index) => formatNumber(field.components[index], component))
            .join(',');
    },
    textLength(field) {
        return field.components.reduce((sum, spec) => sum + numberTextLength(spec) + 1, -1);
    },
};

const TYPES = Object.freeze({
    number: numberType,
    bool: boolType,
    enum: enumType,
    slug: slugType,
    vec: vecType,
});

function cloneValue(value) {
    return Array.isArray(value) ? [...value] : value;
}

function sameValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    }
    return Object.is(a, b);
}

function describe(raw) {
    const text = Array.isArray(raw) ? raw.map(String).join(',') : String(raw);
    return text.length > ISSUE_TEXT_LIMIT ? `${text.slice(0, ISSUE_TEXT_LIMIT - 1)}…` : text;
}

function makeIssue(reason, field, raw, key = field?.key ?? null) {
    const issue = { reason, key, path: field?.path ?? null };
    if (raw !== undefined) issue.value = describe(raw);
    return issue;
}

function normalizeWith(schema, input, issues) {
    const source = input !== null && typeof input === 'object' ? input : {};
    const state = {};
    for (const field of schema.fields) {
        const raw = source[field.path];
        if (raw === undefined) {
            state[field.path] = cloneValue(field.default);
            continue;
        }
        const { value, reason } = TYPES[field.type].normalize(field, raw);
        if (reason) issues.push(makeIssue(reason, field, raw));
        state[field.path] = value === undefined ? cloneValue(field.default) : value;
    }
    schema.refine?.(state, (path, reason, raw) => {
        issues.push(makeIssue(reason, schema.byPath.get(path), raw));
    });
    return state;
}

// Every problem of one schema, so a test can show them all at once. An empty list means valid.
export function validateViewStateSchema(schema, { maxLength = VIEW_STATE_MAX_LENGTH } = {}) {
    const problems = [];
    if (!Number.isInteger(schema?.version) || schema.version < 1) {
        problems.push('version must be a positive integer');
    }
    if (!Array.isArray(schema?.fields) || schema.fields.length === 0) {
        problems.push('fields must be a non-empty array');
        return problems;
    }
    for (const name of ['refine', 'migrate']) {
        if (schema[name] !== undefined && typeof schema[name] !== 'function') {
            problems.push(`${name} must be a function`);
        }
    }
    const keys = new Set();
    const paths = new Set();
    let length = `v=${schema.version}`.length;
    for (const [index, field] of schema.fields.entries()) {
        const where = `field ${field?.key ?? index}`;
        if (typeof field?.key !== 'string' || !KEY_PATTERN.test(field.key) || field.key === 'v') {
            problems.push(`${where}: key must be 1-4 lowercase letters or digits, not "v"`);
        }
        if (typeof field?.path !== 'string' || field.path.length === 0) {
            problems.push(`${where}: path is required`);
        }
        if (keys.has(field?.key)) problems.push(`${where}: duplicate key`);
        if (paths.has(field?.path)) problems.push(`${where}: duplicate path ${field.path}`);
        keys.add(field?.key);
        paths.add(field?.path);
        const type = TYPES[field?.type];
        if (!type) {
            problems.push(`${where}: unknown type "${field?.type}"`);
            continue;
        }
        if (field.history !== undefined && field.history !== 'push') {
            problems.push(`${where}: history must be "push" when set`);
        }
        if (field.paths !== undefined && field.type !== 'vec') {
            problems.push(`${where}: only vec fields take paths`);
        }
        const before = problems.length;
        type.check(field, problems);
        if (problems.length > before) continue;
        const normalized = type.normalize(field, field.default);
        if (normalized.reason || !sameValue(normalized.value, field.default)) {
            problems.push(`${where}: default ${describe(field.default)} is not a normalized value`);
        }
        length += 1 + field.key.length + 1 + type.textLength(field);
    }
    if (problems.length === 0) {
        const issues = [];
        const defaults = normalizeWith(prepareSchema(schema), {}, issues);
        const changed = schema.fields.some(
            (field) => !sameValue(defaults[field.path], field.default),
        );
        if (issues.length > 0 || changed)
            problems.push('refine must accept the defaults unchanged');
        if (length > maxLength) {
            problems.push(`the longest fragment (${length} characters) exceeds ${maxLength}`);
        }
    }
    return problems;
}

function prepareSchema(schema) {
    return {
        version: schema.version,
        fields: schema.fields,
        refine: schema.refine,
        migrate: schema.migrate,
        byKey: new Map(schema.fields.map((field) => [field.key, field])),
        byPath: new Map(schema.fields.map((field) => [field.path, field])),
        defaultText: new Map(
            schema.fields.map((field) => [
                field.key,
                TYPES[field.type].format(field, field.default),
            ]),
        ),
    };
}

function fragmentOf(source) {
    if (source === null || source === undefined) return '';
    if (typeof source === 'object' && typeof source.hash === 'string') {
        return source.hash.replace(/^#/, '');
    }
    const text = String(source);
    const hash = text.indexOf('#');
    return hash >= 0 ? text.slice(hash + 1) : text;
}

function safeDecode(text) {
    try {
        return decodeURIComponent(text);
    } catch {
        return null;
    }
}

function parsePairs(fragment) {
    return fragment
        .split('&')
        .filter((part) => part !== '')
        .map((part) => {
            const separator = part.indexOf('=');
            const rawKey = separator < 0 ? part : part.slice(0, separator);
            const raw = separator < 0 ? '' : part.slice(separator + 1);
            return { key: safeDecode(rawKey) ?? rawKey, value: safeDecode(raw), raw };
        });
}

function carryOver(state, schema) {
    const carried = {};
    for (const field of schema.fields) {
        if (Object.hasOwn(state, field.path)) carried[field.path] = cloneValue(state[field.path]);
    }
    return carried;
}

// `versions` lists the schemas from oldest to newest; encode() always writes the newest.
export function createViewStateCodec(versions, { maxLength = VIEW_STATE_MAX_LENGTH } = {}) {
    const list = Array.isArray(versions) ? versions : [versions];
    const problems = [];
    if (list.length === 0) problems.push('at least one schema version is required');
    list.forEach((schema, index) => {
        for (const problem of validateViewStateSchema(schema, { maxLength })) {
            problems.push(`version ${schema?.version ?? `#${index}`}: ${problem}`);
        }
        if (index > 0 && !(schema?.version > list[index - 1]?.version)) {
            problems.push(`version ${schema?.version}: versions must increase`);
        }
    });
    if (problems.length > 0) {
        throw new TypeError(`invalid view-state schema:\n  ${problems.join('\n  ')}`);
    }
    const schemas = list.map(prepareSchema);
    const latest = schemas.at(-1);
    const byVersion = new Map(schemas.map((schema) => [schema.version, schema]));

    function defaults() {
        return normalizeWith(latest, {}, []);
    }

    // State of the latest version with every field present, valid and rounded.
    function normalize(input) {
        const issues = [];
        return { state: normalizeWith(latest, input, issues), issues };
    }

    // With volatile: false the fields flagged volatile are left out, as if at their defaults.
    function encode(input, { volatile = true } = {}) {
        const state = normalizeWith(latest, input, []);
        const parts = [`v=${latest.version}`];
        for (const field of latest.fields) {
            if (field.volatile && !volatile) continue;
            const text = TYPES[field.type].format(field, state[field.path]);
            if (text !== latest.defaultText.get(field.key)) parts.push(`${field.key}=${text}`);
        }
        return parts.join('&');
    }

    // Accepts a fragment with or without '#', a URL string, or a Location or URL object.
    // `present` tells whether a view state was found and decoded; otherwise `state` holds the
    // defaults and the app should keep its own start-up state.
    function decode(source) {
        const fragment = fragmentOf(source);
        const fail = (issues) => ({ state: defaults(), issues, version: null, present: false });
        if (fragment === '') return fail([]);
        if (fragment.length > maxLength) {
            return fail([
                { reason: 'too-long', key: null, path: null, value: String(fragment.length) },
            ]);
        }
        const pairs = parsePairs(fragment);
        const versionPairs = pairs.filter((pair) => pair.key === 'v');
        if (versionPairs.length === 0)
            return fail([makeIssue('not-a-view-state', null, undefined)]);
        const issues = versionPairs
            .slice(1)
            .map((pair) => makeIssue('duplicate', null, pair.raw, 'v'));
        const versionText = versionPairs[0].value;
        const schema =
            versionText !== null && VERSION_PATTERN.test(versionText)
                ? byVersion.get(Number(versionText))
                : undefined;
        if (!schema) {
            issues.push(makeIssue('unsupported-version', null, versionPairs[0].raw, 'v'));
            return fail(issues);
        }

        const input = {};
        const seen = new Set();
        for (const pair of pairs) {
            if (pair.key === 'v') continue;
            const field = schema.byKey.get(pair.key);
            if (!field) {
                issues.push(makeIssue('unknown-key', null, pair.raw, pair.key));
                continue;
            }
            if (seen.has(field.key)) {
                issues.push(makeIssue('duplicate', field, pair.raw));
                continue;
            }
            seen.add(field.key);
            const { value, reason } =
                pair.value === null
                    ? { reason: 'invalid' }
                    : TYPES[field.type].parse(field, pair.value);
            if (reason) issues.push(makeIssue(reason, field, pair.raw));
            if (value !== undefined) input[field.path] = value;
        }

        let state = normalizeWith(schema, input, issues);
        for (const next of schemas.slice(schemas.indexOf(schema) + 1)) {
            const carried = carryOver(state, next);
            state = normalizeWith(
                next,
                next.migrate ? next.migrate(state, carried) : carried,
                issues,
            );
        }
        return { state, issues, version: schema.version, present: true };
    }

    return Object.freeze({
        version: latest.version,
        fields: latest.fields,
        maxLength,
        defaults,
        normalize,
        encode,
        decode,
    });
}
