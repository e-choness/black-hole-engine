// Regenerates src/app/core/physics/emission-lut.json, the blackbody and synchrotron colour table
// of the renderer. Run in Docker: docker compose run --rm --no-deps test node scripts/generate-emission-lut.js
import { writeFileSync } from 'node:fs';
import { buildEmissionLut } from '../src/app/core/physics/colorimetry.js';

// Colours keep 7 significant digits; log10 Y keeps 9, so the Rayleigh-Jeans slope taken from the
// last two entries stays accurate.
const round = (v) => Number(v.toPrecision(7));
const roundEntry = (v, i) => Number(v.toPrecision(i % 4 === 3 ? 9 : 7));
const lut = buildEmissionLut();
const out = {
    ...lut,
    bolometricEfficacy: round(lut.bolometricEfficacy),
    blackbody: lut.blackbody.map(roundEntry),
    powerLaw: lut.powerLaw.map(round),
};
const target = new URL('../src/app/core/physics/emission-lut.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(`wrote ${target.pathname}: ${lut.size} entries per row`);
