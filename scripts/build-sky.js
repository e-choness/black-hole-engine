// Builds the sky cube-map tiers from NASA SVS 3895 "Deep Star Maps" (Wright 2012), the galactic
// plate carree rendered from the Bright Star, Tycho-2 and UCAC3 catalogues (8192 x 4096, Galactic
// Centre in the middle, longitude increasing to the left). The source is downloaded into
// .cache/sky and checked against its SHA-256, reprojected to the six faces of a cube in galactic
// coordinates (x towards the Galactic Centre, z towards the north galactic pole) by supersampling
// in linear light, halved to the smaller tiers with a box filter, and written as sRGB JPEG faces
// to public/textures/sky/<size>/{px,nx,py,ny,pz,nz}.jpg. Faces follow the OpenGL cube-map
// convention, so a samplerCube lookup with a galactic direction needs no further flips.
//
//   docker compose run --rm --no-deps test node scripts/build-sky.js

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import jpeg from 'jpeg-js';

const SOURCE_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a003800/a003895/starmap_g8k.jpg';
const SOURCE_SHA256 = 'f69c968700ba3cc18e37c12fba1535c57bd68626086b19443aba1a9841034043';
const CACHE_DIR = path.resolve('.cache/sky');
const OUT_DIR = path.resolve('public/textures/sky');
const SIZES = [2048, 1024, 512];
const SUPERSAMPLE = 3;
const JPEG_QUALITY = 90;
const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
    const c = i / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function linearToSrgb8(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(v * 255)));
}

async function loadSource() {
    const file = path.join(CACHE_DIR, path.basename(SOURCE_URL));
    let bytes;
    try {
        bytes = await readFile(file);
    } catch {
        const response = await fetch(SOURCE_URL);
        if (!response.ok) throw new Error(`${SOURCE_URL}: HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, bytes);
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== SOURCE_SHA256) {
        throw new Error(`${file}: SHA-256 ${digest}, expected ${SOURCE_SHA256}`);
    }
    return jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 1024 });
}

// Direction of face texel coordinates (sc, tc) in [-1, 1], with s to the right and t downwards
// in the stored image (OpenGL ES 3.0 spec, table 3.21).
function faceDirection(face, sc, tc) {
    switch (face) {
        case 0:
            return [1, -tc, -sc];
        case 1:
            return [-1, -tc, sc];
        case 2:
            return [sc, 1, tc];
        case 3:
            return [sc, -1, -tc];
        case 4:
            return [sc, -tc, 1];
        default:
            return [-sc, -tc, -1];
    }
}

// Bilinear sample of the plate carree in linear light at galactic direction (x, y, z).
function sampleSource(src, x, y, z, out) {
    const { width, height, data } = src;
    const l = Math.atan2(y, x);
    const b = Math.atan2(z, Math.hypot(x, y));
    const px = (0.5 - l / (2 * Math.PI)) * width - 0.5;
    const py = Math.min(Math.max((0.5 - b / Math.PI) * height - 0.5, 0), height - 1);
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const y1 = Math.min(y0 + 1, height - 1);
    const xa = ((x0 % width) + width) % width;
    const xb = (xa + 1) % width;
    const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    const offsets = [y0 * width + xa, y0 * width + xb, y1 * width + xa, y1 * width + xb];
    for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += weights[k] * SRGB_TO_LINEAR[data[4 * offsets[k] + c]];
        out[c] += v;
    }
}

function renderFace(src, face, size) {
    const pixels = new Float32Array(size * size * 3);
    const acc = [0, 0, 0];
    const norm = 1 / (SUPERSAMPLE * SUPERSAMPLE);
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            acc[0] = acc[1] = acc[2] = 0;
            for (let sj = 0; sj < SUPERSAMPLE; sj++) {
                const tc = (2 * (j + (sj + 0.5) / SUPERSAMPLE)) / size - 1;
                for (let si = 0; si < SUPERSAMPLE; si++) {
                    const sc = (2 * (i + (si + 0.5) / SUPERSAMPLE)) / size - 1;
                    const [x, y, z] = faceDirection(face, sc, tc);
                    sampleSource(src, x, y, z, acc);
                }
            }
            const o = 3 * (j * size + i);
            pixels[o] = acc[0] * norm;
            pixels[o + 1] = acc[1] * norm;
            pixels[o + 2] = acc[2] * norm;
        }
    }
    return pixels;
}

function halve(pixels, size) {
    const half = size / 2;
    const out = new Float32Array(half * half * 3);
    for (let j = 0; j < half; j++) {
        for (let i = 0; i < half; i++) {
            for (let c = 0; c < 3; c++) {
                const at = (x, y) => pixels[3 * (y * size + x) + c];
                out[3 * (j * half + i) + c] =
                    0.25 *
                    (at(2 * i, 2 * j) +
                        at(2 * i + 1, 2 * j) +
                        at(2 * i, 2 * j + 1) +
                        at(2 * i + 1, 2 * j + 1));
            }
        }
    }
    return out;
}

async function writeFace(pixels, size, face) {
    const data = Buffer.alloc(size * size * 4);
    for (let p = 0; p < size * size; p++) {
        data[4 * p] = linearToSrgb8(pixels[3 * p]);
        data[4 * p + 1] = linearToSrgb8(pixels[3 * p + 1]);
        data[4 * p + 2] = linearToSrgb8(pixels[3 * p + 2]);
        data[4 * p + 3] = 255;
    }
    const dir = path.join(OUT_DIR, String(size));
    await mkdir(dir, { recursive: true });
    const encoded = jpeg.encode({ data, width: size, height: size }, JPEG_QUALITY);
    await writeFile(path.join(dir, `${FACES[face]}.jpg`), encoded.data);
}

const source = await loadSource();
for (let face = 0; face < 6; face++) {
    let pixels = renderFace(source, face, SIZES[0]);
    for (let k = 0; k < SIZES.length; k++) {
        if (k > 0) pixels = halve(pixels, SIZES[k - 1]);
        await writeFace(pixels, SIZES[k], face);
    }
    console.log(`face ${FACES[face]} done`);
}
