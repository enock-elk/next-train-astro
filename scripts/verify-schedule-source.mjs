/**
 * Assert the GitHub schedule fallback is this Astro repo, not the old SPA tree.
 * Run: node scripts/verify-schedule-source.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ASTRO_DATA_CDN = 'https://cdn.jsdelivr.net/gh/enock-elk/next-train-astro@main/public/data/';
const OLD_SPA_DATA_CDN = 'https://cdn.jsdelivr.net/gh/enock-elk/metrorail-app@main/data/';
const REGION_KEYS = ['gauteng', 'westerncape', 'kzn', 'easterncape'];

const failures = [];
const fail = (msg) => failures.push(msg);

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

for (const rel of [
    'src/lib/config.js',
    'public/js/admin.js',
    'public/js/map-app.js',
]) {
    const src = read(rel);
    if (src.includes(OLD_SPA_DATA_CDN)) {
        fail(`${rel} still points the GitHub dump at metrorail-app/data/`);
    }
    if (!src.includes(ASTRO_DATA_CDN)) {
        fail(`${rel} is missing ${ASTRO_DATA_CDN}`);
    }
}

const dumpPath = join(ROOT, 'public/data/full-database.json');
if (!existsSync(dumpPath)) {
    fail('public/data/full-database.json is missing — GitHub fallback would 404');
} else {
    let dump;
    try {
        dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
    } catch (e) {
        fail(`public/data/full-database.json is not valid JSON: ${e.message}`);
        dump = null;
    }
    if (dump && typeof dump === 'object') {
        for (const key of REGION_KEYS) {
            if (!dump[key] || typeof dump[key] !== 'object') {
                fail(`public/data/full-database.json missing region object "${key}"`);
            }
        }
        const kzn = dump.kzn;
        for (const key of [
            'durbn_to_cross_sat',
            'cross_to_durbn_sat',
            'durbn_to_cross_weekday',
            'cross_to_durbn_weekday',
        ]) {
            if (!Array.isArray(kzn?.[key]) || kzn[key].length < 3) {
                fail(`public/data/full-database.json kzn missing Crossmoor sheet "${key}"`);
            }
        }
        const crossStations = new Set(
            (kzn?.cross_to_durbn_sat || [])
                .map((row) => String(row?.STATION || '').toUpperCase())
                .filter((name) => name && !name.includes('UPDATED')),
        );
        for (const station of ['CROSSMOOR', 'CHATSGLEN', 'HAVENSIDE', 'BAYVIEW', 'WESTCLIFF']) {
            if (!crossStations.has(station)) {
                fail(`Crossmoor Saturday inbound sheet missing station ${station}`);
            }
        }
    }
}

const deploy = read('.github/workflows/deploy-production.yml');
if (!deploy.includes('Overlaid schedule JSON') || !deploy.includes("name '*.json'")) {
    fail('deploy-production.yml must overlay public/data JSON onto metrorail-app data/');
}

if (failures.length) {
    console.error('verify-schedule-source failed:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log('verify-schedule-source: GitHub fallback is next-train-astro public/data/');
