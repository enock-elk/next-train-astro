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
assert(mapApp.includes('function setSelectedLine'), 'line filter can reset without toggling');
assert(mapApp.includes('function fitNetworkView'), 'Show all lines restores the full network bounds');
assert(mapApp.includes('legend-show-all'), 'legend has an explicit Show all lines row');
assert(mapApp.includes("pane: 'nt-stations'"), 'station markers use a pane above route lines');
assert(mapApp.includes('function raiseStationMarkers'), 'filtering brings station markers back above lines');
assert(!mapApp.includes('status-badge'), 'Network Lines list has no LIVE text badges');
assert(!mapApp.includes("routeStatus = 'LIVE'"), 'legend does not label corridors LIVE');
assert(mapApp.includes("back.setAttribute('data-href'"), 'Back navigates via data-href on a button');
assert(mapApp.includes('function stationPopupHtml'), 'station popup lists corridors under the name');
assert(mapApp.includes('map-popup-route'), 'station popup rows use map-popup-route');
assert(mapApp.includes('pathVisitsStopsInOrder(latlngs, stops)'), 'baked GeoJSON must follow station order');
assert(mapApp.includes('return chords;'), 'fallback paint is station-to-station chords');
assert(mapApp.includes('railHops !== stops.length - 1'), 'graph smoothing wins only when every hop succeeds');
assert(mapApp.includes('bakedLineCoversStops(baked, stops)'), 'baked line must pass every station before it is painted');
assert(
    mapApp.includes('"CAPE TOWN", "ESPLANADE", "YSTERPLAAT", "KENTEMADE", "CENTURY CITY"'),
    'Cape Town to Bellville is the Northern Line via Century City'
);

const bake = readFileSync(new URL('../scripts/build-rail-tracks.mjs', import.meta.url), 'utf8');
assert(!/skip long chord/.test(bake), 'the bake never drops a hop, so a route cannot stop short of its terminus');
assert(bake.includes('snapHopToSharedComponent'), 'both ends of a hop snap into the same rail network');
assert(bake.includes('applyCanonicalStationOrder'), 'the bake uses the same station order the map paints');

// Every configured route must have a baked line that reaches all of its stops.
const config = readFileSync(new URL('../src/lib/config.js', import.meta.url), 'utf8');
const routesStart = config.indexOf('export const ROUTES = {');
const routesOpen = config.indexOf('{', routesStart);
let depth = 0;
let routesEnd = -1;
for (let i = routesOpen; i < config.length; i++) {
    if (config[i] === '{') depth++;
    else if (config[i] === '}') {
        depth--;
        if (depth === 0) { routesEnd = i + 1; break; }
    }
}
const ROUTES = new Function(`return ${config.slice(routesOpen, routesEnd)};`)();

function haversineM(aLat, aLon, bLat, bLon) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
function pointToSegmentM(pLat, pLon, aLat, aLon, bLat, bLon) {
    const lat0 = ((aLat + bLat) / 2) * Math.PI / 180;
    const toXY = (lat, lon) => [
        lon * Math.PI / 180 * 6371000 * Math.cos(lat0),
        lat * Math.PI / 180 * 6371000
    ];
    const [pX, pY] = toXY(pLat, pLon);
    const [aX, aY] = toXY(aLat, aLon);
    const [bX, bY] = toXY(bLat, bLon);
    const abx = bX - aX;
    const aby = bY - aY;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1) return Math.hypot(pX - aX, pY - aY);
    let t = ((pX - aX) * abx + (pY - aY) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(pX - (aX + t * abx), pY - (aY + t * aby));
}

const COVER_M = 450;
/**
 * A straight hop is honest where OSM has no rail (De Wildt and the Cape Flats
 * both have real gaps), but a corridor should not be mostly straight, and a
 * region should not be, at all.
 */
const MAX_ROUTE_CHORD_SHARE = 0.5;
const MAX_REGION_CHORD_SHARE = 0.15;

for (const region of ['GP', 'WC', 'KZN', 'EC']) {
    const fc = JSON.parse(readFileSync(new URL(`../public/tracks/rail-tracks-${region}.geojson`, import.meta.url), 'utf8'));
    const byId = new Map();
    for (const f of fc.features || []) {
        if (f?.properties?.routeId) byId.set(f.properties.routeId, f);
    }
    const configured = Object.values(ROUTES)
        .filter((r) => r.region === region && r.id !== 'special_event')
        .map((r) => r.id);
    for (const id of configured) {
        assert(byId.has(id), `${region} bake is missing ${id}`);
    }
    let regionHops = 0;
    let regionChords = 0;
    for (const [id, feature] of byId) {
        const props = feature.properties || {};
        const coords = feature.geometry?.coordinates || [];
        assert(coords.length > 1, `${id} baked line has no geometry`);
        const stops = props.stationCoords;
        assert(Array.isArray(stops) && stops.length > 1, `${id} baked line does not record its stops`);
        if (!Array.isArray(stops)) continue;

        // Every stop the map paints must sit on the baked line, so a route can
        // never stop short of a terminus the way Cato Ridge did.
        let worst = 0;
        let worstAt = 0;
        stops.forEach(([lat, lon], idx) => {
            let best = Infinity;
            for (let i = 1; i < coords.length; i++) {
                const d = pointToSegmentM(lat, lon, coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
                if (d < best) best = d;
            }
            if (best > worst) { worst = best; worstAt = idx; }
        });
        assert(
            worst <= COVER_M,
            `${id} baked line misses ${props.stationNames?.[worstAt] || `stop ${worstAt}`} by ${Math.round(worst)}m`
        );

        const [firstLat, firstLon] = stops[0];
        const [lastLat, lastLon] = stops[stops.length - 1];
        const a = coords[0];
        const b = coords[coords.length - 1];
        const ends = haversineM(a[1], a[0], firstLat, firstLon) + haversineM(b[1], b[0], lastLat, lastLon);
        assert(ends <= COVER_M, `${id} baked line does not begin and end at its termini (${Math.round(ends)}m)`);

        const hops = stops.length - 1;
        const chordHops = Number(props.chordHops || 0);
        regionHops += hops;
        regionChords += chordHops;
        assert(
            chordHops / hops <= MAX_ROUTE_CHORD_SHARE,
            `${id} is straight for ${chordHops} of ${hops} hops; rebake or check OSM on that corridor`
        );
    }
    assert(
        regionHops > 0 && regionChords / regionHops <= MAX_REGION_CHORD_SHARE,
        `${region} is straight for ${regionChords} of ${regionHops} hops; the bake is not following rail`
    );
}

const railTracks = readFileSync(new URL('../src/lib/rail-tracks.js', import.meta.url), 'utf8');
assert(railTracks.includes('hopStraysFromChord(graph, nodePath, a, b)'), 'planner trip map rejects OSM hops that leave the station chord');
assert(railTracks.includes('railHops !== stops.length - 1'), 'planner trip map requires every hop before accepting graph smoothing');
const wcTracks = readFileSync(new URL('../public/tracks/rail-tracks-WC.geojson', import.meta.url), 'utf8');
assert(wcTracks.includes('"routeId":"ct-bellv"'), 'WC bake includes Cape Town to Bellville');

function escapeMapHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
function stationPopupHtml(origName, routeSet, routes) {
    const title = escapeMapHtml(String(origName || '').replace(/ STATION/gi, ''));
    const ids = routeSet instanceof Set ? [...routeSet] : [...(routeSet || [])];
    const rows = [];
    const seen = new Set();
    (routes || []).forEach((item) => {
        if (!item || !ids.includes(item.routeId) || seen.has(item.routeId)) return;
        seen.add(item.routeId);
        const label = escapeMapHtml(String(item.name || item.routeId));
        const color = item.color || '#64748b';
        rows.push(`<div class="map-popup-route"><span class="map-popup-swatch" style="background:${color}"></span>${label}</div>`);
    });
    ids.forEach((rid) => {
        if (seen.has(rid)) return;
        rows.push(`<div class="map-popup-route"><span class="map-popup-swatch" style="background:#64748b"></span>${escapeMapHtml(rid)}</div>`);
    });
    const list = rows.length ? `<div class="map-popup-routes">${rows.join('')}</div>` : '';
    return `<div class="map-popup-station"><b class="map-popup-name">${title}</b>${list}</div>`;
}
const clairwood = stationPopupHtml('CLAIRWOOD', new Set(['kzn-umlazi', 'kzn-winklespruit']), [
    { routeId: 'kzn-umlazi', name: 'Durban <-> Umlazi', color: '#ef4444' },
    { routeId: 'kzn-winklespruit', name: 'Durban <-> Winklespruit', color: '#3b82f6' },
    { routeId: 'kzn-bridgecity', name: 'Berea Road <-> Bridge City', color: '#22c55e' }
]);
assert(clairwood.includes('CLAIRWOOD') && clairwood.includes('map-popup-name'), 'popup title is the station name');
assert(clairwood.includes('Durban &lt;-&gt; Umlazi') && clairwood.includes('Durban &lt;-&gt; Winklespruit'), 'popup lists every corridor that stops there');
assert(!clairwood.includes('Bridge City'), 'popup omits corridors that do not stop there');

if (failures.length) {
    console.error('verify-map-lines failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-map-lines: ok');
