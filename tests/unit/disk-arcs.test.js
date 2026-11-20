import { describe, expect, it, vi } from 'vitest';
import { diskArcNormalisation } from '../../src/shaders/tsl/raytracer/accretion.js';
import { createNoiseVolume, NOISE_VOLUME_SIZE } from '../../src/shaders/tsl/nodes/noise.js';

// Shader's start-up state reads localStorage, which Node warns about without a backing file.
vi.stubGlobal('localStorage', { getItem: () => null });
const { Shader } = await import('../../src/app/core/shader.js');

describe('disk arcs', () => {
    it('divides the density by its sampled mean at whole sharpnesses', () => {
        expect(diskArcNormalisation(1)).toBeCloseTo(1 / 0.7498, 6);
        expect(diskArcNormalisation(4)).toBeCloseTo(1 / 0.3844, 6);
        expect(diskArcNormalisation(10)).toBeCloseTo(1 / 0.1767, 6);
    });

    it('interpolates geometrically between them and clamps the sharpness', () => {
        expect(diskArcNormalisation(4.5)).toBeCloseTo(1 / Math.sqrt(0.3844 * 0.3238), 6);
        expect(diskArcNormalisation(0.2)).toBe(diskArcNormalisation(1));
        expect(diskArcNormalisation(14)).toBe(diskArcNormalisation(10));
        let previous = 0;
        for (let s = 1; s <= 10.0001; s += 0.1) {
            const norm = diskArcNormalisation(s);
            expect(norm).toBeGreaterThan(previous);
            previous = norm;
        }
    });

    it('draws the same uniform noise volume on every device', () => {
        const a = createNoiseVolume();
        const b = createNoiseVolume();
        const data = a.image.data;
        expect(data.length).toBe(NOISE_VOLUME_SIZE ** 3);
        expect(data).toEqual(b.image.data);
        const counts = new Uint32Array(256);
        let sum = 0;
        for (const value of data) {
            counts[value]++;
            sum += value;
        }
        expect(sum / data.length / 255).toBeCloseTo(0.5, 2);
        expect(Math.min(...counts)).toBeGreaterThan(0);
    });

    it('compiles the arcs into the thin disk only', () => {
        const shader = new Shader();
        expect(shader.variant().disk_arcs).toBe(true);
        shader.parameters.disk.structure = 'plasma';
        expect(shader.variant().disk_arcs).toBe(false);
        shader.parameters.disk.structure = 'arcs';
        shader.parameters.accretion_mode = 'thick_torus';
        expect(shader.variant().disk_arcs).toBe(false);
    });
});
