import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    BACKGROUND_FLUX_CAP,
    BULGE_RADIUS,
    ENVELOPE_MEAN,
    GALAXY_BUDGETS,
    GALAXY_DEFAULTS,
    GALAXY_LIMITS,
    GALAXY_RADIUS,
    SKY_VIEWS,
    applySkyView,
    apparentPhaseRate,
    armStar,
    armStarCount,
    backgroundStar,
    bulgeStar,
    clampGalaxyParams,
    cloud,
    facesTouchedBySphere,
    galaxyBudgetForQuality,
    galaxyFrame,
    galaxyMatrix,
    galaxyPhase,
    hashU32,
    hashUnit,
    phaseTolerance,
    phaseUniforms,
    relativeAngularSpeed,
    skySignature,
    toHoleFrame,
    youngStarEnvelope,
} from '../../src/features/galaxy/model.js';
import { assertClose } from './support/assert-close.js';

const params = (overrides = {}) => clampGalaxyParams({ ...GALAXY_DEFAULTS, ...overrides });

const phasesAt = (time, p) => phaseUniforms(galaxyPhase(time, p), p);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);

describe('hash', () => {
    test('the shader hash uses the same constants and shifts as hashU32', () => {
        const nodes = fs.readFileSync('src/app/sky/galaxy-nodes.js', 'utf8');
        for (const fragment of [
            'h.assign(h.bitXor(h.shiftRight(uint(16))));',
            'h.assign(h.mul(uint(0x7feb352d)));',
            'h.assign(h.bitXor(h.shiftRight(uint(15))));',
            'h.assign(h.mul(uint(0x846ca68b)));',
            'hashU32(index.mul(uint(16)).add(uint(stream)).add(salt))',
            'float(h.shiftRight(uint(8))).mul(1.0 / 16777216.0)',
        ]) {
            assert.ok(nodes.includes(fragment), `galaxy-nodes.js lacks "${fragment}"`);
        }
    });

    test('is a deterministic 32-bit permutation with good avalanche', () => {
        assert.equal(hashU32(12345), hashU32(12345));
        let flipped = 0;
        const trials = 2000;
        for (let i = 0; i < trials; i++) {
            const a = hashU32(i * 7919);
            const b = hashU32((i * 7919) ^ (1 << (i % 32)));
            let x = (a ^ b) >>> 0;
            while (x) {
                flipped += x & 1;
                x >>>= 1;
            }
            assert.ok(a >= 0 && a <= 0xffffffff);
        }
        assertClose(flipped / trials, 16, { abs: 0.6 });
    });

    test('hashUnit is uniform on [0, 1) with 24-bit resolution', () => {
        const bins = new Array(64).fill(0);
        const n = 128000;
        for (let i = 0; i < n; i++) {
            const u = hashUnit(i, 3, 0x9e3779b9);
            assert.ok(u >= 0 && u < 1);
            assert.equal(u * 16777216, Math.round(u * 16777216));
            bins[Math.floor(u * 64)] += 1;
        }
        const expected = n / 64;
        const chi2 = bins.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
        // 63 degrees of freedom: chi^2 above 110 has p < 1e-4.
        assert.ok(chi2 < 110, `chi^2 = ${chi2}`);
    });

    test('streams of one particle are uncorrelated', () => {
        let sum = 0;
        const n = 50000;
        for (let i = 0; i < n; i++) sum += (hashUnit(i, 1, 0) - 0.5) * (hashUnit(i, 2, 0) - 0.5);
        assertClose(sum / n, 0, { abs: 0.003 });
    });
});

describe('disk stars', () => {
    test('follow webgpu-galaxy: sqrt radius sampling, equal arms, thickness taper', () => {
        const p = params({ arms: 'winding', arm_count: 3 });
        const phases = phasesAt(0, p);
        const n = 30000;
        const radii = [];
        let maxAbsY = 0;
        for (let i = 0; i < n; i++) {
            const star = armStar(i, p, phases);
            radii.push(Math.abs(star.r));
            maxAbsY = Math.max(maxAbsY, Math.abs(star.position[1]));
        }
        radii.sort((a, b) => a - b);
        // Median of sqrt(u) R is R / sqrt(2); the symmetric arm-width offset barely moves it.
        assertClose(radii[n / 2], GALAXY_RADIUS / Math.SQRT2, { rel: 0.03 });
        assert.ok(maxAbsY <= 0.5 * p.thickness * 1.2 + 1e-9);
    });

    test('winding arms equal webgpu-galaxy frame-by-frame integration', () => {
        // Port of helpers.js applyDifferentialRotation: rotate (x, z) by -s / (0.1 r + 1) dt.
        const p = params({ arms: 'winding', rotation_speed: 0.35 });
        const dt = 1 / 60;
        const steps = 3600;
        for (const index of [0, 17, 4242, 99999]) {
            const start = armStar(index, p, phasesAt(0, p)).position;
            let [x, y, z] = start;
            for (let k = 0; k < steps; k++) {
                const angle = (-p.rotation_speed / (Math.hypot(x, z) * 0.1 + 1)) * dt;
                const c = Math.cos(angle);
                const s = Math.sin(angle);
                [x, z] = [x * c - z * s, x * s + z * c];
            }
            const closed = armStar(index, p, phasesAt(steps * dt, p)).position;
            assertClose(closed[0], x, { abs: 1e-9 });
            assertClose(closed[1], y, { abs: 1e-12 });
            assertClose(closed[2], z, { abs: 1e-9 });
        }
    });

    // Light-weighted phase of the m = arm_count Fourier mode of the disk stars in an annulus,
    // in the frame rotating with the pattern.
    function armPhase(p, time, [rMin, rMax]) {
        const phases = phasesAt(time, p);
        let re = 0;
        let im = 0;
        for (let i = 0; i < 80000; i++) {
            const star = armStar(i, p, phases);
            const r = Math.abs(star.r);
            if (r < rMin || r >= rMax) continue;
            const theta = Math.atan2(star.position[2], star.position[0]) + phases.phase;
            re += star.envelope * Math.cos(p.arm_count * theta);
            im += star.envelope * Math.sin(p.arm_count * theta);
        }
        return Math.atan2(im, re) / p.arm_count;
    }

    // Signed difference of two m-fold symmetric angles, in (-pi/m, pi/m].
    function phaseDifference(a, b, m) {
        const d = (a - b) * m;
        return Math.atan2(Math.sin(d), Math.cos(d)) / m;
    }

    const INNER = [4.5, 5.5];
    const OUTER = [10.5, 11.5];
    // Pitch: phase of the arm in the inner annulus relative to the outer one.
    const pitch = (p, t) =>
        phaseDifference(armPhase(p, t, INNER), armPhase(p, t, OUTER), p.arm_count);

    // Change of a star's angle in the frame rotating with the pattern since t = 0, in (-pi, pi].
    function rotatingDrift(p, index, time) {
        const start = phasesAt(0, p);
        const now = phasesAt(time, p);
        const d =
            armStar(index, p, now).theta +
            now.phase -
            (armStar(index, p, start).theta + start.phase);
        return Math.atan2(Math.sin(d), Math.cos(d));
    }

    test('density-wave stars never drift more than one lifetime from their birth arm', () => {
        const p = params({ arms: 'density_wave' });
        const k = (r) => relativeAngularSpeed(r, p.corotation * GALAXY_RADIUS);
        const lifetimeAngle = 2 * Math.PI * p.lifetime;
        for (const time of [7, 600, 1e6]) {
            for (let i = 0; i < 3000; i++) {
                const { r } = armStar(i, p, phasesAt(time, p));
                const bound = lifetimeAngle * Math.abs(1 - k(r)) + 1e-9;
                assert.ok(Math.abs(rotatingDrift(p, i, time)) <= bound, `star ${i} at t = ${time}`);
            }
        }
    });

    test('density-wave ages stay uniform, so the pattern is stationary', () => {
        const p = params({ arms: 'density_wave' });
        assert.ok(galaxyPhase(600, p) > 4 * Math.PI, 'the interval must span several rotations');
        const phases = phasesAt(600, p);
        const bins = new Array(10).fill(0);
        const n = 20000;
        for (let i = 0; i < n; i++) bins[Math.floor(armStar(i, p, phases).age * 10)] += 1;
        const chi2 = bins.reduce((sum, count) => sum + (count - n / 10) ** 2 / (n / 10), 0);
        // 9 degrees of freedom: chi^2 above 30 has p < 5e-4.
        assert.ok(chi2 < 30, `chi^2 = ${chi2}`);
    });

    test('winding stars drift without bound', () => {
        const p = params({ arms: 'winding' });
        let largest = 0;
        for (let i = 0; i < 500; i++)
            largest = Math.max(largest, Math.abs(rotatingDrift(p, i, 600)));
        assert.ok(largest > 3, `largest drift ${largest} rad`);
    });

    test('winding arms wind up at the differential rotation rate', () => {
        const p = params({ arms: 'winding' });
        const k = (r) => relativeAngularSpeed(r, p.corotation * GALAXY_RADIUS);
        // A short interval, so the arms wind visibly but stay coherent within each annulus.
        const later = 30;
        const expected = -(k(5) - k(11)) * galaxyPhase(later, p);
        assert.ok(Math.abs(expected) > 0.4 && Math.abs(expected) < Math.PI / (2 * p.arm_count));
        const shift = phaseDifference(pitch(p, later), pitch(p, 0), p.arm_count);
        assertClose(shift, expected, { abs: 0.08 });
    });

    test('the young-star envelope is normalised and vanishes at birth and death', () => {
        assert.equal(youngStarEnvelope(0), 0);
        assert.equal(youngStarEnvelope(1), 0);
        let sum = 0;
        const n = 100000;
        for (let i = 0; i < n; i++) sum += youngStarEnvelope((i + 0.5) / n);
        assertClose(sum / n, ENVELOPE_MEAN, { rel: 1e-6 });
    });

    test('density-wave phases stay exact for float32 at late times', () => {
        const p = params();
        const late = phaseUniforms(1e9 + 0.25, p);
        assert.ok(late.phaseAngle >= 0 && late.phaseAngle < 2 * Math.PI);
        assert.ok(late.phaseCycles >= 0 && late.phaseCycles < 1);
        assertClose(late.lifetimeAngle, 2 * Math.PI * p.lifetime);
    });

    test('the bulge is a flattened sphere within four scale radii', () => {
        const p = params();
        const phases = phasesAt(0, p);
        let maxR = 0;
        let sumXZ = 0;
        let sumY = 0;
        for (let i = 0; i < 60000; i++) {
            const [x, y, z] = bulgeStar(i, p, phases).position;
            maxR = Math.max(maxR, Math.hypot(x, y / 0.6, z));
            sumXZ += x * x + z * z;
            sumY += y * y;
        }
        assert.ok(maxR <= 4 * BULGE_RADIUS * (1 + 1e-9));
        // Isotropic: <x^2 + z^2> = 2 <y'^2> with y = 0.6 y'.
        assertClose(sumY / sumXZ, (0.36 * 1) / 2, { rel: 0.05 });
    });

    test('the arm/bulge split covers the whole budget', () => {
        assert.equal(armStarCount(1000, 0.15), 850);
        assert.equal(armStarCount(1000, 0), 1000);
    });
});

describe('clouds and background stars', () => {
    test('a share of the clouds are smaller H II regions', () => {
        const p = params({ nebulae: 0.25 });
        const phases = phasesAt(0, p);
        let nebulae = 0;
        for (let i = 0; i < 8000; i++) {
            const c = cloud(i, p, phases);
            if (c.nebula) nebulae += 1;
            assert.ok(c.size > 0 && c.size <= 1.2 * p.cloud_size);
        }
        assertClose(nebulae / 8000, 0.25, { abs: 0.02 });
    });

    test('the bright end of the star field does not depend on the star count', () => {
        const p = params();
        const brighterThan = (count, flux) => {
            let n = 0;
            for (let i = 0; i < count; i++) if (backgroundStar(i, count, p).flux > flux) n += 1;
            return n;
        };
        const few = brighterThan(4000, 4);
        const many = brighterThan(16000, 4);
        assert.ok(few > 50);
        assertClose(many / few, 1, { abs: 0.25 });
        for (let i = 0; i < 2000; i++) {
            const star = backgroundStar(i, 16000, p);
            assertClose(norm(star.direction), 1, { rel: 1e-12 });
            assert.ok(star.flux <= BACKGROUND_FLUX_CAP);
            assert.ok(star.temperature >= 2600 && star.temperature <= 25000);
        }
    });
});

describe('placement in the hole frame', () => {
    test('the galaxy centre lies along the view direction at distance x R', () => {
        for (const view of Object.values(SKY_VIEWS)) {
            const frame = galaxyFrame(params(view));
            const lon = (view.longitude * Math.PI) / 180;
            const lat = (view.latitude * Math.PI) / 180;
            const d = view.distance * GALAXY_RADIUS;
            assertClose(frame.centre[0], d * Math.cos(lat) * Math.cos(lon), { abs: 1e-12 });
            assertClose(frame.centre[1], d * Math.cos(lat) * Math.sin(lon), { abs: 1e-12 });
            assertClose(frame.centre[2], d * Math.sin(lat), { abs: 1e-12 });
        }
    });

    test('the axes are orthonormal and right-handed, and the disk axis has the inclination', () => {
        for (const inclination of [0, 15, 50, 89, 90]) {
            for (const position_angle of [-120, 0, 30]) {
                for (const latitude of [-90, -10, 8, 90]) {
                    const p = params({ inclination, position_angle, latitude, longitude: 100 });
                    const { x, y, z, direction } = galaxyFrame(p);
                    for (const axis of [x, y, z]) assertClose(norm(axis), 1, { rel: 1e-12 });
                    assertClose(dot(x, y), 0, { abs: 1e-12 });
                    assertClose(dot(y, z), 0, { abs: 1e-12 });
                    assertClose(dot(x, z), 0, { abs: 1e-12 });
                    const handed = [
                        x[1] * y[2] - x[2] * y[1],
                        x[2] * y[0] - x[0] * y[2],
                        x[0] * y[1] - x[1] * y[0],
                    ];
                    assertClose(dot(handed, z), 1, { rel: 1e-12 });
                    // atan2 of |y x d| and -y . d stays accurate near 0 and 90 degrees.
                    const yd = [
                        y[1] * direction[2] - y[2] * direction[1],
                        y[2] * direction[0] - y[0] * direction[2],
                        y[0] * direction[1] - y[1] * direction[0],
                    ];
                    const angle = (Math.atan2(norm(yd), -dot(y, direction)) * 180) / Math.PI;
                    assertClose(angle, inclination, { abs: 1e-9 });
                }
            }
        }
    });

    test('toHoleFrame and the column-major matrix agree', () => {
        const frame = galaxyFrame(params());
        const m = galaxyMatrix(frame);
        const p = [1.5, -0.25, 3];
        const q = toHoleFrame(frame, p);
        for (let r = 0; r < 3; r++) {
            assertClose(m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r], q[r], {
                abs: 1e-12,
            });
        }
    });

    test('the default view puts the galaxy behind the hole as seen by the default camera', () => {
        // The default camera sits near -y and looks along +y (camera-runtime.js).
        const { direction } = galaxyFrame(params());
        assert.ok(direction[1] > 0.9);
    });

    test('views write the named geometry', () => {
        const galaxy = { ...GALAXY_DEFAULTS };
        assert.equal(applySkyView(galaxy, 'disk'), true);
        assert.equal(galaxy.view, 'disk');
        assert.equal(galaxy.distance, SKY_VIEWS.disk.distance);
        assert.equal(applySkyView(galaxy, 'nowhere'), false);
    });
});

describe('re-render scheduling', () => {
    test('the phase tolerance shrinks with the face size and inside the galaxy', () => {
        const outside = params();
        const frame = galaxyFrame(outside);
        const coarse = phaseTolerance(outside, frame, 384);
        const fine = phaseTolerance(outside, frame, 2048);
        assert.ok(fine < coarse);
        assertClose(coarse / fine, 2048 / 384, { rel: 1e-12 });
        // Inside the disk the nearest particles are close, so they cross texels fastest.
        const inside = params(SKY_VIEWS.disk);
        assert.ok(
            apparentPhaseRate(inside, galaxyFrame(inside)) > apparentPhaseRate(outside, frame),
        );
    });

    test('only the cube faces a sphere can reach are flagged', () => {
        assert.equal(facesTouchedBySphere([100, 0, 0], 5), 0b000001);
        assert.equal(facesTouchedBySphere([0, -100, 0], 5), 0b001000);
        assert.equal(facesTouchedBySphere([0, 0, 1], 5), 0b111111);
        // On the +x/+y edge the sphere reaches both faces.
        assert.equal(facesTouchedBySphere([50, 50, 0], 5), 0b000101);
    });

    test('the signature tracks parameters and budget, not time', () => {
        const p = params();
        const base = skySignature(p, GALAXY_BUDGETS.high, 'galaxy');
        assert.equal(skySignature({ ...p }, GALAXY_BUDGETS.high, 'galaxy'), base);
        assert.notEqual(skySignature({ ...p, arm_count: 3 }, GALAXY_BUDGETS.high, 'galaxy'), base);
        assert.notEqual(skySignature(p, GALAXY_BUDGETS.ultra, 'galaxy'), base);
    });
});

describe('parameters and budgets', () => {
    test('clampGalaxyParams clamps ranges, rounds counts and rejects unknown choices', () => {
        const p = clampGalaxyParams({
            distance: 99,
            arm_count: 2.6,
            seed: 0,
            arms: 'spiral',
            palette: 'stellar',
            view: 'custom',
            star_brightness: Number.NaN,
        });
        assert.equal(p.distance, GALAXY_LIMITS.distance[1]);
        assert.equal(p.arm_count, 3);
        assert.equal(p.seed, 1);
        assert.equal(p.arms, GALAXY_DEFAULTS.arms);
        assert.equal(p.palette, 'stellar');
        assert.equal(p.view, 'custom');
        assert.equal(p.star_brightness, GALAXY_DEFAULTS.star_brightness);
    });

    test('defaults are inside their ranges', () => {
        for (const [key, [min, max]] of Object.entries(GALAXY_LIMITS)) {
            assert.ok(GALAXY_DEFAULTS[key] >= min && GALAXY_DEFAULTS[key] <= max, key);
        }
    });

    test('budgets grow with the quality preset; custom keeps the current one', () => {
        const order = ['mobile', 'optimal', 'medium', 'high', 'ultra', 'cinematic'];
        for (let i = 1; i < order.length; i++) {
            const a = galaxyBudgetForQuality(order[i - 1]);
            const b = galaxyBudgetForQuality(order[i]);
            for (const key of ['face', 'stars', 'clouds', 'background'])
                assert.ok(b[key] >= a[key], key);
        }
        assert.equal(galaxyBudgetForQuality('custom'), null);
    });
});
