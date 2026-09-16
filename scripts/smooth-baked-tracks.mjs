/**
 * Apply the current bake's geometry clean-up to an existing rail-tracks file.
 *
 * build-rail-tracks.mjs now strips station pins and despikes as it writes, so
 * this only exists to bring bakes made by the older generator up to the same
 * shape without re-downloading OSM. Keeping the existing OSM snapshot matters:
 * it is the geometry the regions were validated against, and Overpass
 * rate-limits (504s) the region-sized queries.
 *
 * KZN is deliberately excluded by default. Its corridors are the reference
 * shape, and the Berea Road line forks at Duff's Road for the kwaMashu and
 * Bridge City branches, so its geometry is left exactly as it ships.
 *
 * Also drops one-sided station-pin hooks (Loftus 11 m, Rissik 34 m). Long
 * chords where OSM has no rail stay put; npm run tracks:fill-chords drapes
 * those onto Metro rails without a full Overpass rebake.
 *
 * Idempotent. Usage: node scripts/smooth-baked-tracks.mjs GP WC EC
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripStationPins, despikeRailLine, haversineM } from './lib/rail-line-smooth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = path.join(ROOT, 'public', 'tracks');
const HELD_REGIONS = new Set(['KZN']);

const regions = process.argv.slice(2).map((r) => r.toUpperCase());
if (!regions.length) {
    console.error('Usage: node scripts/smooth-baked-tracks.mjs GP WC EC');
    process.exit(1);
}

function lineLengthKm(coords) {
    let m = 0;
    for (let i = 1; i < coords.length; i++) {
        m += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    }
    return m / 1000;
}

for (const region of regions) {
    if (HELD_REGIONS.has(region)) {
        console.error(`${region} is held as the reference shape (Duff's Road fork); refusing to rewrite it.`);
        continue;
    }
    const file = path.join(TRACKS, `rail-tracks-${region}.geojson`);
    if (!fs.existsSync(file)) {
        console.error(`  ${region}: ${file} not found`);
        continue;
    }
    const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
    let pinsTotal = 0;
    let spikesTotal = 0;

    for (const feature of fc.features || []) {
        const original = feature?.geometry?.coordinates;
        const stationCoords = feature?.properties?.stationCoords;
        if (!Array.isArray(original) || original.length < 2) continue;

        const beforeKm = lineLengthKm(original);
        const pinned = stripStationPins(original, stationCoords || []);
        const despiked = despikeRailLine(pinned.coords);
        const coords = despiked.coords;
        if (coords.length < 2) continue;

        let worst = 0;
        for (const [lat, lon] of stationCoords || []) {
            let best = Infinity;
            for (const [vlon, vlat] of coords) {
                const d = haversineM(lat, lon, vlat, vlon);
                if (d < best) best = d;
            }
            if (best > worst) worst = best;
        }

        feature.geometry.coordinates = coords;
        feature.properties.stationPinsStripped = true;
        feature.properties.maxStationOffsetM = Math.round(worst);
        pinsTotal += pinned.removed;
        spikesTotal += despiked.excursions.length;

        const tag = despiked.excursions.length
            ? ` spikes removed: ${despiked.excursions.map((m) => `${m}m`).join(', ')}`
            : '';
        console.log(
            `  ${region} ${String(feature.properties.routeId).padEnd(18)}`
            + ` ${String(original.length).padStart(5)}->${String(coords.length).padStart(5)} verts`
            + `  ${beforeKm.toFixed(1)}->${lineLengthKm(coords).toFixed(1)}km`
            + `  furthest station ${Math.round(worst)}m${tag}`
        );
    }

    fs.writeFileSync(file, JSON.stringify(fc));
    console.log(`${region}: ${pinsTotal} station pins, ${spikesTotal} spikes removed → ${file}\n`);
}
