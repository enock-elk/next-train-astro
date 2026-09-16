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
import { findGapSteps, findRepairHops } from './lib/rail-gap-drape.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = path.join(ROOT, 'public', 'tracks');
const HELD_REGIONS = new Set(['KZN']);

const raw = process.argv.slice(2).map((a) => a.toUpperCase());
const regions = !raw.length || raw.includes('ALL')
    ? ['GP', 'WC', 'KZN', 'EC']
    : raw;

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

        const repair = findRepairHops(coords, stops, names);
        for (const hop of repair) {
            chords++;
            console.log(
                `  ${id}: ${hop.kind.toUpperCase()} ${hop.from} → ${hop.to}`
                + `  ${Math.round(hop.chordM)}m  ${hop.between} verts between  perp ${Math.round(hop.maxPerp)}m`
            );
        }
        for (const hop of findGapSteps(coords, repair)) {
            chords++;
            console.log(
                `  ${id}: GAP ${hop.from} → ${hop.to}`
                + `  ${Math.round(hop.chordM)}m jump`
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
