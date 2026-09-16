/**
 * Read-only report of leftover pin hooks and station-to-station chords.
 *
 * Does not write GeoJSON. KZN is listed as held.
 *
 * Usage: node scripts/audit-rail-tracks.mjs [GP|WC|KZN|EC|all]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripStationPins, despikeRailLine, haversineM } from './lib/rail-line-smooth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = path.join(ROOT, 'public', 'tracks');
const HELD_REGIONS = new Set(['KZN']);
const MIN_CHORD_M = 200;
const MAX_CHORD_M = 2000;

const raw = process.argv.slice(2).map((a) => a.toUpperCase());
const regions = !raw.length || raw.includes('ALL')
    ? ['GP', 'WC', 'KZN', 'EC']
    : raw;

function lineLengthM(coords, from, to) {
    let m = 0;
    for (let i = from + 1; i <= to; i++) {
        m += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    }
    return m;
}

function nearestVert(coords, lat, lon) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
        const d = haversineM(lat, lon, coords[i][1], coords[i][0]);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return { i: best, d: bestD };
}

console.log('Rail track audit. KZN is held. Repair (GP WC EC only): npm run tracks:repair\n');

let hooks = 0;
let carriers = 0;
let chords = 0;
let wouldStrip = 0;
let wouldDespike = 0;

for (const region of regions) {
    const file = path.join(TRACKS, `rail-tracks-${region}.geojson`);
    if (!fs.existsSync(file)) {
        console.log(`${region}: missing ${file}`);
        continue;
    }
    const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(`=== ${region}${HELD_REGIONS.has(region) ? ' (held, do not rewrite)' : ''} ===`);

    for (const feature of fc.features || []) {
        const id = feature.properties?.routeId;
        const coords = feature.geometry?.coordinates || [];
        const stops = feature.properties?.stationCoords || [];
        const names = feature.properties?.stationNames || [];
        if (coords.length < 2) continue;

        const pinned = stripStationPins(coords, stops);
        const spikes = despikeRailLine(coords);
        if (pinned.removed) {
            wouldStrip += pinned.removed;
            console.log(`  ${id}: stripStationPins would drop ${pinned.removed} hook/pin verts`);
        }
        if (spikes.excursions.length) {
            wouldDespike += spikes.excursions.length;
            console.log(`  ${id}: despike ${spikes.excursions.map((m) => `${m}m`).join(', ')}`);
        }

        const pinSet = new Set(
            stops.filter((c) => Array.isArray(c) && c.length === 2)
                .map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`)
        );
        for (let i = 0; i < coords.length; i++) {
            const key = `${coords[i][1].toFixed(6)},${coords[i][0].toFixed(6)}`;
            if (!pinSet.has(key)) continue;
            const idx = stops.findIndex((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}` === key);
            const prev = coords[i - 1];
            const next = coords[i + 1];
            const prevD = prev ? haversineM(prev[1], prev[0], coords[i][1], coords[i][0]) : Infinity;
            const nextD = next ? haversineM(coords[i][1], coords[i][0], next[1], next[0]) : Infinity;
            const stub = Math.min(prevD, nextD);
            const kind = stub <= 150 ? 'hook' : 'chord-carrier';
            if (kind === 'hook') hooks++;
            else carriers++;
            console.log(
                `  ${id}: PIN ${kind} ${names[idx] || i}`
                + `  prev ${Math.round(prevD)}m next ${Math.round(nextD)}m`
            );
        }

        for (let s = 0; s < stops.length - 1; s++) {
            const a = stops[s];
            const b = stops[s + 1];
            const i1 = nearestVert(coords, a[0], a[1]);
            const i2 = nearestVert(coords, b[0], b[1]);
            const lo = Math.min(i1.i, i2.i);
            const hi = Math.max(i1.i, i2.i);
            const chordM = haversineM(a[0], a[1], b[0], b[1]);
            const alongM = lineLengthM(coords, lo, hi);
            const between = hi - lo - 1;
            if (chordM < MIN_CHORD_M || chordM > MAX_CHORD_M) continue;
            if (between > 1) continue;
            if (alongM > chordM * 1.12) continue;
            chords++;
            console.log(
                `  ${id}: CHORD ${names[s] || s} → ${names[s + 1] || s + 1}`
                + `  ${Math.round(chordM)}m  ${between} verts between`
            );
        }
    }
    console.log('');
}

console.log(
    `Totals: ${hooks} hook pins, ${carriers} chord-carrier pins, ${chords} short chords.`
    + (wouldStrip || wouldDespike
        ? ` Smooth would drop ${wouldStrip} pins / ${wouldDespike} spikes.`
        : '')
);
console.log('Repair (never KZN): npm run tracks:repair');
console.log('Then paste any leftover CHORD lines to Cursor if a hop still cuts the railway.');
