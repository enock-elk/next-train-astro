/**
 * Gold lock for baked rail geometry.
 *
 * public/tracks/rail-tracks-{GP,WC,KZN,EC}.geojson is the map. A bad rewrite
 * zig-zags, chords, or paints the wrong fork. The hashes in
 * public/tracks/GOLD.json are the last known-good snapshot (branch map-gold,
 * commit frozenAt). Changing a track file without updating GOLD.json fails.
 * Updating GOLD.json to silence this script is not an improvement: diff
 * origin/map-gold, run verify:map-lines and verify:map-hops, prove every
 * region is better or unchanged, then fast-forward map-gold.
 *
 * Run: node scripts/verify-map-gold.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = join(ROOT, 'public', 'tracks');
const GOLD_PATH = join(TRACKS, 'GOLD.json');
const REGIONS = ['EC', 'GP', 'KZN', 'WC'];
const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

function hashFile(path, algo) {
    return createHash(algo).update(readFileSync(path)).digest('hex');
}

assert(existsSync(GOLD_PATH), 'public/tracks/GOLD.json is the gold lockfile');
const gold = JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
assert(gold.branch === 'map-gold', 'GOLD.json points at the map-gold branch');
assert(typeof gold.frozenAt === 'string' && /^[0-9a-f]{40}$/.test(gold.frozenAt), 'frozenAt is a full git SHA');

for (const region of REGIONS) {
    const name = `rail-tracks-${region}.geojson`;
    const path = join(TRACKS, name);
    assert(existsSync(path), `${name} must exist`);
    const expected = gold.files?.[name];
    assert(expected?.md5 && expected?.sha256, `${name} has md5 and sha256 in GOLD.json`);
    if (!existsSync(path) || !expected?.md5 || !expected?.sha256) continue;
    const md5 = hashFile(path, 'md5');
    const sha256 = hashFile(path, 'sha256');
    assert(
        md5 === expected.md5 && sha256 === expected.sha256,
        `${name} drifted from gold (got md5 ${md5}). Diff origin/map-gold. Mapping work must improve all regions, not damage them. Only update GOLD.json after verify:map-lines and verify:map-hops pass, then fast-forward map-gold.`
    );
}

const extra = Object.keys(gold.files || {}).filter((name) => !REGIONS.some((r) => name === `rail-tracks-${r}.geojson`));
assert(extra.length === 0, `GOLD.json has unexpected files: ${extra.join(', ')}`);

const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
const instructions = readFileSync(join(ROOT, 'instructions.md'), 'utf8');
for (const [name, text] of [['AGENTS.md', agents], ['instructions.md', instructions]]) {
    assert(text.includes('## Map gold'), `${name} teaches Map gold`);
    assert(text.includes('map-gold'), `${name} names the map-gold branch`);
    assert(text.includes('verify:map-gold'), `${name} names verify:map-gold`);
    assert(text.includes('improve the maps across the regions'), `${name} requires mapping work to improve every region`);
    assert(text.includes('Do not rewrite gold map tracks'), `${name} Do not break still forbids rewriting gold tracks`);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
assert(pkg.scripts['verify:map-gold'] === 'node scripts/verify-map-gold.mjs', 'package.json has verify:map-gold');
assert(pkg.scripts['tracks:smooth'] === 'node scripts/smooth-baked-tracks.mjs GP WC EC', 'tracks:smooth never includes KZN');

const smooth = readFileSync(join(ROOT, 'scripts/smooth-baked-tracks.mjs'), 'utf8');
assert(smooth.includes("HELD_REGIONS = new Set(['KZN'])"), 'smooth-baked-tracks still holds KZN');
assert(smooth.includes('refusing to rewrite'), 'smooth-baked-tracks still refuses a KZN rewrite');

const mapApp = readFileSync(join(ROOT, 'public/js/map-app.js'), 'utf8');
assert(
    mapApp.includes("GHOST_GEOMETRY_REGIONS = new Set(['KZN'])"),
    'KZN keeps ghost-row geometry; other regions paint served stops'
);

const deploy = readFileSync(join(ROOT, '.github/workflows/deploy-production.yml'), 'utf8');
const productionBuild = readFileSync(join(ROOT, '.github/workflows/production-build.yml'), 'utf8');
for (const [name, workflow] of [['production deploy', deploy], ['production build', productionBuild]]) {
    assert(workflow.includes('npm run verify:map-gold'), `${name} gates on map gold`);
}

if (failures.length) {
    console.error('verify-map-gold FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-map-gold: ok (EC, GP, KZN, WC match origin/map-gold hashes)');
