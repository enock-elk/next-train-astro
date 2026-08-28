/**
 * Strict map paint: station-to-station order, hop skip/detour guards.
 * Run: node scripts/verify-map-lines.mjs
 */
import { readFileSync } from 'node:fs';

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

function orderStopsForPaint(staticNames, extracted) {
    if (!staticNames?.length) return extracted;
    const byName = new Map();
    for (const s of extracted || []) {
        if (s?.name) byName.set(s.name, s);
    }
    const ordered = [];
    for (const name of staticNames) {
        const s = byName.get(name);
        if (s) ordered.push(s);
    }
    return ordered.length > 1 ? ordered : extracted;
}

function hopDetourTooLong(chordM, railM, ratio = 2.8, minExtra = 900) {
    if (!Number.isFinite(railM) || railM <= 0) return true;
    if (!Number.isFinite(chordM) || chordM <= 0) return railM > minExtra;
    return railM > Math.max(chordM * ratio, chordM + minExtra);
}

function railHopSkipsRouteStop(pathPoints, stops, hopIndex, skipM = 90) {
    if (!pathPoints || pathPoints.length < 3 || !stops) return false;
    const dist = (a, b) => {
        const dLat = a.lat - b.lat;
        const dLon = a.lon - b.lon;
        return Math.sqrt(dLat * dLat + dLon * dLon) * 111000;
    };
    for (let k = 1; k < pathPoints.length - 1; k++) {
        const n = pathPoints[k];
        for (let j = 0; j < stops.length; j++) {
            if (j === hopIndex || j === hopIndex + 1) continue;
            if (dist(n, stops[j]) < skipM) return true;
        }
    }
    return false;
}

const flatsOrder = [
    'CAPE TOWN', 'WOODSTOCK', 'SALT RIVER', 'KOEBERG RD', 'MAITLAND', 'MUTUAL',
    'NDABENI', 'PINELANDS', 'HAZENDAL', 'ATHLONE'
];
const scrambled = [
    { name: 'HAZENDAL', lat: -33.93, lon: 18.5 },
    { name: 'NDABENI', lat: -33.91, lon: 18.5 },
    { name: 'PINELANDS', lat: -33.92, lon: 18.5 },
    { name: 'MUTUAL', lat: -33.90, lon: 18.5 },
    { name: 'MAITLAND', lat: -33.89, lon: 18.5 }
];
const ordered = orderStopsForPaint(flatsOrder, scrambled);
assert(
    ordered.map((s) => s.name).join('>') === 'MAITLAND>MUTUAL>NDABENI>PINELANDS>HAZENDAL',
    'canonical order follows the static station list, not sheet scramble'
);

assert(!hopDetourTooLong(400, 500), 'short along-track hop is allowed');
assert(hopDetourTooLong(400, 4000), 'hop that wanders kilometres off the chord is rejected');

const stops = [
    { name: 'NDABENI', lat: 0, lon: 0 },
    { name: 'PINELANDS', lat: 0, lon: 0.01 },
    { name: 'HAZENDAL', lat: 0, lon: 0.02 }
];
const skipPath = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.02 },
    { lat: 0, lon: 0.01 }
];
assert(
    railHopSkipsRouteStop(skipPath, stops, 0),
    'Ndabeni→Pinelands hop that passes Hazendal is a skip'
);
assert(
    !railHopSkipsRouteStop(
        [{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0.005 }, { lat: 0, lon: 0.01 }],
        stops,
        0
    ),
    'Ndabeni→Pinelands hop that does not pass Hazendal is kept'
);

const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
assert(mapApp.includes('"NDABENI", "PINELANDS", "HAZENDAL"'), 'Cape Flats static path is Ndabeni then Pinelands then Hazendal');
assert(mapApp.includes('"AVOCA", "DUFF\'S ROAD"'), 'KZN north line is Avoca then Duff\'s Road');
assert(!mapApp.includes('"AVOCA", "TEMPLE"'), 'Avoca is not followed by Temple');
assert(mapApp.includes('applyCanonicalStationOrder(route.id, validStops, routeCoords)'), 'every drawn route is reordered before paint');
assert(mapApp.includes('railHopSkipsRouteStop(graph, nodePath, stops, i)'), 'OSM hop skip check is wired');
assert(mapApp.includes('railHopStraysFromChord(graph, nodePath, a, b)'), 'OSM hops cannot stray off the station chord');
assert(mapApp.includes('function applySelectedLine'), 'Network Lines rows isolate one corridor');
assert(mapApp.includes('pathVisitsStopsInOrder(baked, stops)'), 'baked GeoJSON must follow station order');
assert(mapApp.includes('return chords;'), 'fallback paint is station-to-station chords');

const railTracks = readFileSync(new URL('../src/lib/rail-tracks.js', import.meta.url), 'utf8');
assert(railTracks.includes('hopStraysFromChord(graph, nodePath, a, b)'), 'planner trip map rejects OSM hops that leave the station chord');

if (failures.length) {
    console.error('verify-map-lines failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-map-lines: ok');
