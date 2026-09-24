/**
 * Strict map paint: station-to-station order, hop skip/detour guards.
 * Run: node scripts/verify-map-lines.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripStationPins, despikeRailLine } from './lib/rail-line-smooth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

{
    // Hook pin: 12 m off the previous rail vertex, 900 m chord on the other side.
    // That is Loftus / Rissik. The pin must drop; the long chord stays.
    const hook = stripStationPins(
        [[28.225414, -25.755025], [28.225357, -25.754940], [28.232275, -25.749263]],
        [[-25.754940, 28.225357]],
    );
    assert(hook.removed === 1, 'stripStationPins drops a one-sided station-pin hook');
    assert(hook.coords.length === 2, 'hook strip keeps the two rail/chord ends');
}

const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
assert(pkg.includes('"tracks:repair"'), 'package.json has tracks:repair');
assert(pkg.includes('"tracks:audit"'), 'package.json has tracks:audit');
assert(pkg.includes('"tracks:apply-patch"'), 'package.json has tracks:apply-patch');
const applyPatch = readFileSync(new URL('../scripts/apply-track-patch.mjs', import.meta.url), 'utf8');
assert(applyPatch.includes("ALLOWED_REGIONS = new Set(['GP', 'WC', 'KZN', 'EC'])"), 'apply-patch writes GP, WC, KZN and EC');
assert(!applyPatch.includes("HELD_REGIONS = new Set(['KZN'])"), 'apply-patch no longer refuses KZN editor exports');
assert(applyPatch.includes('stationOrderOverride'), 'apply-patch writes stationOrderOverride so paint follows the edited stop list');
assert(applyPatch.includes("kind === 'nexttrain-track-patch'"), 'apply-patch reads the map editor export');
const fillChords = readFileSync(new URL('../scripts/fill-rail-chords.mjs', import.meta.url), 'utf8');
assert(fillChords.includes("HELD_REGIONS = new Set(['KZN'])"), 'fill-chords refuses KZN');
assert(fillChords.includes('.sort((a, b) => b.lo - a.lo)'), 'fill-chords splices hops from the end so earlier indexes stay valid');
assert(fillChords.includes('gautrain') || fillChords.includes('Gautrain'), 'fill-chords ignores Gautrain-named OSM ways');
assert(fillChords.includes('despikedAgain'), 'fill-chords strips pin hooks again after a drape');
assert(fillChords.includes('shouldRepair'), 'fill-chords only rewrites the screenshot hops, not every rural edge');
assert(fillChords.includes('NOLU_MAIN_STOPS'), 'Nolungile is restitched onto Esplanade / Ysterplaat');
assert(fillChords.includes('YSTERPLAAT'), 'fill-chords knows the Ysterplaat OSM void');
assert(fillChords.includes('ct-nolu|CAPE TOWN|ESPLANADE'), 'fill-chords forces Cape Town→Esplanade off the Woodstock mainline');
assert(fillChords.includes('drapeSameComponent'), 'Nolungile Netreg and Philippi walk one OSM island, including abandoned Cape Flats rails');
assert(fillChords.includes('GRAPH_HOPS'), 'only Nolungile Bonteheuwel→Netreg and Nyanga→Philippi use the island walk');
assert(fillChords.includes('findForcedHops'), 'fill-chords can drape a dense hop that sits on the parallel railway');
const gapDrape = readFileSync(new URL('../scripts/lib/rail-gap-drape.mjs', import.meta.url), 'utf8');
assert(gapDrape.includes('sampleKeepGaps'), 'short OSM voids keep the corridor chord instead of snapping sideways');
assert(gapDrape.includes('gautrain'), 'gap drape skips Gautrain-named ways');
assert(gapDrape.includes('TUBE_M'), 'drape stays inside a corridor tube');

const plannerUi = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
assert(plannerUi.includes('routeId: routeId || null'), 'planner trip stops carry a corridor id for the bake slice');
assert(plannerUi.includes('addStops(trip.stops, trip.route?.id)'), 'direct trips pass the route id into the trip map');

const mapView = readFileSync(new URL('../src/components/MapView.astro', import.meta.url), 'utf8');
assert(!mapView.includes('Share my location'), 'Map tab has no Share my location control');
assert(!mapView.includes('map-tab-contribute-btn'), 'Map tab dropped the share-location button');

const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
assert(!mapApp.includes('Share my location'), 'map-app does not prompt Share my location');
assert(mapApp.includes('"TSHIAWELO", "MIDWAY", "LENZ"'), 'JHB Midway static path continues from Midway to Lenz');
assert(mapApp.includes('"LENZ": [-26.319519733948702, 27.82296719973482]'), 'map station dictionary includes Lenz');
assert(mapApp.includes('"NDABENI", "PINELANDS", "HAZENDAL"'), 'Cape Flats static path is Ndabeni then Pinelands then Hazendal');
assert(mapApp.includes('"AVOCA", "DUFF\'S ROAD"'), 'KZN north line is Avoca then Duff\'s Road');
assert(!mapApp.includes('"AVOCA", "TEMPLE"'), 'Avoca is not followed by Temple');
assert(mapApp.includes('applyCanonicalStationOrder(route.id, validStops, routeCoords)'), 'every drawn route is reordered before paint');
assert(mapApp.includes('railHopSkipsRouteStop(graph, nodePath, stops, i)'), 'OSM hop skip check is wired');
assert(mapApp.includes('railHopStraysFromChord(graph, nodePath, a, b, strayMax)'), 'OSM hops cannot stray off the station chord');
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
assert(mapApp.includes('railHops === 0'), 'graph smoothing keeps successful rail hops and falls back per failed hop');
assert(mapApp.includes('bakedLineCoversStops(baked, stops)'), 'baked line must pass every station before it is painted');
assert(
    mapApp.includes('"CAPE TOWN", "ESPLANADE", "YSTERPLAAT", "KENTEMADE", "CENTURY CITY"'),
    'Cape Town to Bellville is the Northern Line via Century City'
);
assert(mapApp.includes('stationOrderOverride'), 'map paint honours a manual station-order override');
assert(mapApp.includes('function applyGoldStationOrders'), 'gold-track station names are applied after the bake loads');
assert(mapApp.includes('function startTrackEditor'), 'full map has a gold-track editor');
assert(!/if \(currentRegion === 'KZN'\) return;/.test(mapApp), 'editor is available on KZN corridors');
assert(mapApp.includes('data-track-tool'), 'editor has Move Add Delete tools');
assert(!mapApp.includes('originalEvent.altKey'), 'editor does not rely on Alt-tap to delete');
const mapPage = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
assert(mapPage.includes('id="nt-track-editor"'), 'map page ships the line editor sheet');
assert(mapPage.includes('data-track-tool="move"'), 'editor defaults to Move');
assert(mapPage.includes('nt-track-editor-stations-toggle'), 'station list is behind a Stations control');
assert(mapPage.includes('html.nt-map-tab #nt-track-editor'), 'Map tab embed hides the editor');

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

/**
 * Stations may sit beside the rail. Smooth rail geometry is the contract, not
 * touching the station pin: Mutual is 1.5 km from the Cape Flats corridor
 * because its coordinate is wrong, and the line should still follow the track
 * rather than kick sideways to the pin. This bound only has to catch a corridor
 * painted on the wrong line; station order does the real work below.
 */
const STATION_NEAR_CORRIDOR_M = 2000;
/** A corridor must still run the whole way to both of its termini. */
const TERMINI_M = 400;
/** Rail doubling back at a junction may nudge station order by this much. */
const ORDER_SLACK_M = 1500;
/** KZN ships as the reference shape; its Berea Road line forks at Duff's Road. */
const HELD_REGIONS = new Set(['KZN']);
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

        // The line must run along this corridor, and every stop must sit beside
        // it in route order, so a route can never stop short of a terminus the
        // way Cato Ridge did or wander onto a neighbouring branch.
        let worst = 0;
        let worstAt = 0;
        const along = stops.map(([lat, lon], idx) => {
            let best = Infinity;
            let at = 0;
            let travelled = 0;
            for (let i = 1; i < coords.length; i++) {
                const segM = haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
                const d = pointToSegmentM(lat, lon, coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
                if (d < best) { best = d; at = travelled; }
                travelled += segM;
            }
            if (best > worst) { worst = best; worstAt = idx; }
            return at;
        });
        assert(
            worst <= STATION_NEAR_CORRIDOR_M,
            `${id} baked line runs ${Math.round(worst)}m from ${props.stationNames?.[worstAt] || `stop ${worstAt}`}; that is a different corridor`
        );

        let up = true;
        let down = true;
        for (let i = 1; i < along.length; i++) {
            if (along[i] < along[i - 1] - ORDER_SLACK_M) up = false;
            if (along[i] > along[i - 1] + ORDER_SLACK_M) down = false;
        }
        assert(up || down, `${id} baked line does not pass its stations in route order`);

        const [firstLat, firstLon] = stops[0];
        const [lastLat, lastLon] = stops[stops.length - 1];
        const a = coords[0];
        const b = coords[coords.length - 1];
        const ends = haversineM(a[1], a[0], firstLat, firstLon) + haversineM(b[1], b[0], lastLat, lastLon);
        assert(ends <= TERMINI_M, `${id} baked line does not begin and end at its termini (${Math.round(ends)}m)`);

        // Smooth rail only: no vertex may be a station pin, and the line may not
        // leave the corridor and come straight back. Both used to happen at
        // almost every stop (Rissik 908m, Mzimhlope 1122m, Mayfair 554m), which
        // is the zig-zag the map painted. Re-running the cleaner must be a no-op.
        if (!HELD_REGIONS.has(region)) {
            const pinned = stripStationPins(coords, stops);
            assert(
                pinned.removed === 0,
                `${id} still routes through ${pinned.removed} station pins; run npm run tracks:smooth`
            );
            const spikes = despikeRailLine(coords);
            assert(
                spikes.excursions.length === 0,
                `${id} has ${spikes.excursions.length} out-and-back spike(s) (${spikes.excursions.map((m) => `${m}m`).join(', ')}); run npm run tracks:smooth`
            );
        }

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

{
    const gp = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-GP.geojson', import.meta.url), 'utf8'));
    const midway = gp.features.find((f) => f.properties?.routeId === 'jhb-midway');
    const names = midway?.properties?.stationNames || [];
    assert(names.includes('MIDWAY') && names[names.length - 1] === 'LENZ', 'jhb-midway bake continues from Midway to Lenz');
    assert(names.includes('LENZ'), 'jhb-midway bake includes a Lenz hop');
    assert(gp.properties?.generatedAt === '2026-08-29T01:37:44.682Z', 'GP tracks keep the live 29 Aug bake timestamp');
    assert(midway?.properties?.stationPinsStripped === true, 'GP geometry is smoothed, not re-downloaded from OSM');
    const pien = gp.features.find((f) => f.properties?.routeId === 'pta-pien');
    const pienCoords = pien?.geometry?.coordinates || [];
    const pienPins = new Set(
        (pienCoords || []).map((c) => `${Number(c[1]).toFixed(6)},${Number(c[0]).toFixed(6)}`)
    );
    const loftus = (pien?.properties?.stationCoords || [])[4];
    const rissik = (pien?.properties?.stationCoords || [])[5];
    assert(pien?.properties?.stationNames?.[4] === 'LOFTUS VERSFELD PARK', 'pta-pien stop 4 is Loftus');
    assert(pien?.properties?.stationNames?.[5] === 'RISSIK', 'pta-pien stop 5 is Rissik');
    assert(loftus && !pienPins.has(`${loftus[0].toFixed(6)},${loftus[1].toFixed(6)}`), 'pta-pien no longer routes through the Loftus pin');
    assert(rissik && !pienPins.has(`${rissik[0].toFixed(6)},${rissik[1].toFixed(6)}`), 'pta-pien no longer routes through the Rissik pin');
    let loftusI = 0;
    let rissikI = 0;
    let loftusD = Infinity;
    let rissikD = Infinity;
    for (let i = 0; i < pienCoords.length; i++) {
        const dL = haversineM(loftus[0], loftus[1], pienCoords[i][1], pienCoords[i][0]);
        const dR = haversineM(rissik[0], rissik[1], pienCoords[i][1], pienCoords[i][0]);
        if (dL < loftusD) { loftusD = dL; loftusI = i; }
        if (dR < rissikD) { rissikD = dR; rissikI = i; }
    }
    assert(
        Math.abs(rissikI - loftusI) > 8,
        `pta-pien Loftus→Rissik is draped onto rail (${Math.abs(rissikI - loftusI)} verts), not a two-point chord`
    );
    const walker = (pien?.properties?.stationCoords || [])[3];
    assert(pien?.properties?.stationNames?.[3] === 'WALKER STREET', 'pta-pien stop 3 is Walker Street');
    let walkerI = 0;
    let walkerD = Infinity;
    let walkerMaxStep = 0;
    let onGautrain = 0;
    for (let i = 0; i < pienCoords.length; i++) {
        const dW = haversineM(walker[0], walker[1], pienCoords[i][1], pienCoords[i][0]);
        if (dW < walkerD) { walkerD = dW; walkerI = i; }
        if (haversineM(-25.760072, 28.217299, pienCoords[i][1], pienCoords[i][0]) < 35) onGautrain++;
    }
    const wLo = Math.min(walkerI, loftusI);
    const wHi = Math.max(walkerI, loftusI);
    for (let i = wLo + 1; i <= wHi; i++) {
        const step = haversineM(pienCoords[i - 1][1], pienCoords[i - 1][0], pienCoords[i][1], pienCoords[i][0]);
        if (step > walkerMaxStep) walkerMaxStep = step;
    }
    // A 35 m hit is the Gautrain alignment south of Dougall. The owner’s
    // pta-pien patch grazes it (one vertex ~34 m). Fail if the hop sits on it.
    assert(onGautrain <= 1, 'pta-pien Walker→Loftus does not sit on the Gautrain alignment south of Dougall');
    assert(walkerMaxStep < 150, `pta-pien Walker→Loftus jumps OSM voids in short steps (max ${Math.round(walkerMaxStep)}m)`);
}

{
    const gp = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-GP.geojson', import.meta.url), 'utf8'));
    const herc = gp.features.find((f) => f.properties?.routeId === 'herc-koed');
    const hc = herc?.geometry?.coordinates || [];
    const hercPin = (herc?.properties?.stationCoords || [])[0];
    assert(hc.length > 8 && hercPin, 'herc-koed has a rail path out of Hercules');
    const firstStep = haversineM(hc[0][1], hc[0][0], hc[1][1], hc[1][0]);
    const fromPin = haversineM(hercPin[0], hercPin[1], hc[0][1], hc[0][0]);
    assert(firstStep < 80, `herc-koed leaves Hercules on rail, not a 430 m pin chord (first step ${Math.round(firstStep)}m)`);
    assert(fromPin < 150, `herc-koed starts on the Mabopane through rails (${Math.round(fromPin)}m from the pin)`);
    assert(hc[1][1] > hc[0][1], 'herc-koed leaves Hercules north toward Capital Park, not a diagonal across the yard');
}

{
    const gp = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-GP.geojson', import.meta.url), 'utf8'));
    const naledi = gp.features.find((f) => f.properties?.routeId === 'jhb-soweto');
    const names = naledi?.properties?.stationNames || [];
    const coords = naledi?.geometry?.coordinates || [];
    assert(names[0] === 'JOHANNESBURG' && names[names.length - 1] === 'NALEDI', 'jhb-soweto bake lists Park Station through Naledi');
    assert(coords.length === 558, `jhb-soweto gold is the full Park-to-Naledi export (${coords.length} verts)`);
}

{
    const gp = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-GP.geojson', import.meta.url), 'utf8'));
    const kzn = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-KZN.geojson', import.meta.url), 'utf8'));
    const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
    const feature = (fc, id) => fc.features.find((f) => f.properties?.routeId === id);
    const verts = (fc, id) => (feature(fc, id)?.geometry?.coordinates || []).length;
    const names = (fc, id) => feature(fc, id)?.properties?.stationNames || [];
    const exports = [
        { fc: gp, id: 'pta-saul', n: 402, stations: ['PRETORIA', 'PRETORIA WES', 'MITCHELLSTRAAT', 'KALAFONG', 'ATTERIDGEVILLE', 'SAULSVILLE'] },
        { fc: gp, id: 'pta-dewildt', n: 571, stations: ['PRETORIA', 'PRETORIA-B', 'PRETORIA WES', 'HERCULES', 'DASPOORT', 'MOUNTAIN VIEW', 'WONDERBOOM', 'PRETORIA-N', 'WOLMERTON', 'WINTERSNEST', 'ROSSLYN', 'GA-RANKUWA', 'TAILLARDSHOOP', 'DE WILDT'] },
        { fc: gp, id: 'herc-koed', n: 218, stations: ['HERCULES', 'CAPITAL PARK', 'GEZINA', 'DEERNESS', 'VILLIERIA', 'PIERNEEFSRUS', 'QUEENSWOOD', 'KOEDOESPOORT'] },
        { fc: gp, id: 'germ-kwesine', n: 340, stations: ['GERMISTON', 'ELSBURG', 'KATLEHONG', 'LINDELA', 'PILOT', 'KWESINE'] },
        { fc: kzn, id: 'kzn-bridgecity', n: 980, stations: ['BEREA ROAD', 'DURBAN', 'MOSES MABHIDA', 'UMGENI', 'BRIARDENE', 'GREENWOOD PARK', 'RED HILL', 'AVOCA', "DUFF'S ROAD", 'TEMBALIHLE', 'KWAMASHU', 'BRIDGE CITY'] },
    ];
    for (const row of exports) {
        assert(verts(row.fc, row.id) === row.n, `${row.id} gold is the full operator export`);
        assert(JSON.stringify(names(row.fc, row.id)) === JSON.stringify(row.stations), `${row.id} bake station list matches the operator export`);
        const staticBlock = mapApp.match(new RegExp(`'${row.id}':\\s*\\[([^\\]]+)\\]`));
        const staticNames = (staticBlock?.[1] || '').match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) || [];
        assert(JSON.stringify(staticNames) === JSON.stringify(row.stations), `${row.id} STATIC station list matches the operator export`);
    }
    assert(!mapApp.includes("'pta-saul': [\"PRETORIA\", \"PRETORIA WES\", \"MITCHELLSTRAAT\", \"SCHUTTESTRAAT\""), 'pta-saul STATIC does not reinsert Schuttestraat over the export');
}

{
    // KZN is the reference shape except where an operator gold-track patch
    // rewrote a corridor. Its Berea Road corridor forks at Duff's Road: the
    // line runs out to kwaMashu and the special Duff's Road - Bridge City
    // train continues from there, so the branch is geometry rather than a
    // spike and must survive.
    const kzn = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-KZN.geojson', import.meta.url), 'utf8'));
    assert(kzn.properties?.generatedAt === '2026-08-29T01:38:53.715Z', 'KZN tracks keep the live 29 Aug bake timestamp');
    const bridge = kzn.features.find((f) => f.properties?.routeId === 'kzn-bridgecity');
    assert((bridge?.geometry?.coordinates || []).length === 980, 'KZN Bridge City geometry is the operator gold-track patch');
    assert(
        !kzn.features.some((f) => f.properties?.stationPinsStripped),
        'KZN is held as the reference shape and is never smoothed',
    );
    const names = bridge?.properties?.stationNames || [];
    assert(names.includes("DUFF'S ROAD") && names.includes('KWAMASHU'), 'KZN Bridge City keeps the Duff\u2019s Road fork stations');
}

const railTracks = readFileSync(new URL('../src/lib/rail-tracks.js', import.meta.url), 'utf8');
assert(railTracks.includes('const BAKED_COVER_M = 2000'), 'planner gold cover matches the map (2000 m)');
assert(!/const BAKED_COVER_M = 900/.test(railTracks), 'planner cover is not the old 900 m miss');
assert(railTracks.includes('hopStraysFromChord(graph, nodePath, a, b)'), 'planner trip map rejects OSM hops that leave the station chord');
assert(railTracks.includes('sliceBakedHop'), 'planner trip map slices the baked corridor per hop');
{
    // KZN's Berea Road corridor is a single LineString carrying a fork: it runs
    // Duff's Road -> Tembalihle -> kwaMashu, then doubles back to reach Bridge
    // City, because the Duff's Road - Bridge City working branches off the
    // kwaMashu line. Slicing Duff's Road -> Bridge City used to walk that whole
    // branch, so a trip to Bridge City drew itself through kwaMashu (27.1 km).
    const kzn = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-KZN.geojson', import.meta.url), 'utf8'));
    const feature = kzn.features.find((f) => f.properties?.routeId === 'kzn-bridgecity');
    const names = feature?.properties?.stationNames || [];
    const coords = feature?.properties?.stationCoords || [];
    const stop = (name) => {
        const i = names.indexOf(name);
        return i < 0 ? null : { name, lat: coords[i][0], lon: coords[i][1], routeId: 'kzn-bridgecity' };
    };
    const trunk = ['DURBAN', 'MOSES MABHIDA', 'UMGENI', 'BRIARDENE', 'GREENWOOD PARK', 'RED HILL', 'AVOCA', "DUFF'S ROAD"];
    const toBridgeCity = [...trunk, 'BRIDGE CITY'].map(stop).filter(Boolean);
    const toKwaMashu = [...trunk, 'TEMBALIHLE', 'KWAMASHU'].map(stop).filter(Boolean);

    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const m = String(url).match(/rail-tracks-([A-Z]+)\.geojson/);
        if (!m) return { ok: false };
        const body = readFileSync(new URL(`../public/tracks/rail-tracks-${m[1]}.geojson`, import.meta.url), 'utf8');
        return { ok: true, json: async () => JSON.parse(body) };
    };
    const { smoothPathFromStops } = await import('../src/lib/rail-tracks.js');
    const nearestM = (path, s) => {
        let best = Infinity;
        for (const [lat, lon] of path || []) {
            const d = haversineM(lat, lon, s.lat, s.lon);
            if (d < best) best = d;
        }
        return best;
    };

    const bridgePath = await smoothPathFromStops(toBridgeCity, 'KZN');
    const kwaPath = await smoothPathFromStops(toKwaMashu, 'KZN');
    globalThis.fetch = realFetch;

    const kwaStop = stop('KWAMASHU');
    const bridgeStop = stop('BRIDGE CITY');
    assert(!!bridgePath && !!kwaPath, 'KZN fork trips build a path');
    if (bridgePath && kwaPath && kwaStop && bridgeStop) {
        assert(
            nearestM(bridgePath, kwaStop) > 1000,
            `a Bridge City trip must not run out to kwaMashu (got ${Math.round(nearestM(bridgePath, kwaStop))}m)`
        );
        assert(
            nearestM(bridgePath, bridgeStop) < 200,
            'a Bridge City trip still reaches Bridge City'
        );
        assert(
            nearestM(kwaPath, kwaStop) < 200,
            'a kwaMashu trip still reaches kwaMashu'
        );
        assert(
            nearestM(kwaPath, bridgeStop) > 1000,
            `a kwaMashu trip must not run out to Bridge City (got ${Math.round(nearestM(kwaPath, bridgeStop))}m)`
        );
    }
}

{
    // Cape Town <-> Nolungile moved onto the Esplanade / Ysterplaat alignment,
    // but the August bake still runs via Woodstock and Salt River. Slicing a
    // stale bake drew every trip down the wrong side of the city, so a hop is
    // only sliced from a bake that carries both of its stations.
    const dump = JSON.parse(readFileSync(new URL('../public/data/full-database.json', import.meta.url), 'utf8'));
    const rows = dump.westerncape?.ct_to_nolu_weekday || [];
    const trains = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'STATION' && k !== 'COORDINATES');
    const calls = (station, id) => {
        const row = rows.find((r) => String(r.STATION || '').trim().toUpperCase() === station);
        const v = String(row?.[id] == null ? '' : row[id]).trim();
        return !!(v && v !== '-' && v !== '---');
    };
    const train = trains.find((id) => calls('ESPLANADE', id) && calls('YSTERPLAAT', id)) || trains[0];
    const stops = rows.filter((r) => {
        const n = String(r.STATION || '').trim();
        if (!n || /last updated|inter-station/i.test(n)) return false;
        const v = String(r[train] == null ? '' : r[train]).trim();
        return v && v !== '-' && v !== '---';
    }).map((r) => {
        const p = String(r.COORDINATES || '').split(',').map(Number);
        return { name: String(r.STATION).replace(/ STATION/gi, '').toUpperCase().trim(), lat: p[0], lon: p[1], routeId: 'ct-nolu' };
    }).filter((s) => Number.isFinite(s.lat));

    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const m = String(url).match(/rail-tracks-([A-Z]+)\.geojson/);
        if (!m) return { ok: false };
        const body = readFileSync(new URL(`../public/tracks/rail-tracks-${m[1]}.geojson`, import.meta.url), 'utf8');
        return { ok: true, json: async () => JSON.parse(body) };
    };
    const { smoothPathFromStops } = await import('../src/lib/rail-tracks.js');
    const path = await smoothPathFromStops(stops, 'WC');
    globalThis.fetch = realFetch;

    const nearestM = (p, s) => {
        let best = Infinity;
        for (const [lat, lon] of p || []) {
            const d = haversineM(lat, lon, s.lat, s.lon);
            if (d < best) best = d;
        }
        return best;
    };
    const esplanade = stops.find((s) => s.name === 'ESPLANADE');
    const ysterplaat = stops.find((s) => s.name === 'YSTERPLAAT');
    assert(!!path && !!esplanade && !!ysterplaat, 'Cape Town to Nolungile builds a path through Esplanade and Ysterplaat');
    if (path && esplanade && ysterplaat) {
        assert(nearestM(path, esplanade) < 250, `the Nolungile trip runs via Esplanade (got ${Math.round(nearestM(path, esplanade))}m)`);
        assert(nearestM(path, ysterplaat) < 250, `the Nolungile trip runs via Ysterplaat (got ${Math.round(nearestM(path, ysterplaat))}m)`);
    }
}

assert(railTracks.includes('function bakeServesHop'), 'a hop is only sliced from a bake that carries both of its stations');
assert(railTracks.includes('function dropOutAndBack'), 'a baked hop never leaves the corridor and comes back');
assert(
    mapApp.includes('BRANCH_TRAIN_THRESHOLD'),
    'a stop carried by a single train is a branch, not the corridor shape (Philippi fork)',
);
assert(
    mapApp.includes('NOLU_KAPTEINSKLIP_SPUR'),
    'Nolungile also paints Philippi through Lentegeur and Mitchells Plain to Kapteinsklip',
);
assert(
    mapApp.includes('resolveNoluKapteinsklipSpurLatLngs'),
    'the Kapteinsklip working is a second Nolungile polyline, not a detour of the main corridor',
);
assert(
    mapApp.includes("clipBakedHop(baked, stops[0], stops[stops.length - 1])"),
    'the Kapteinsklip spur is sliced from Philippi, not the whole Cape Town bake',
);
assert(
    mapApp.includes('KZN_BRIDGE_CITY_MAIN'),
    'network map paints Berea Road to Bridge City on the trunk, not via kwaMashu',
);
assert(
    mapApp.includes('KZN_KWAMASHU_SPUR'),
    'Duff\'s Road to kwaMashu is a second kzn-bridgecity polyline',
);
assert(
    mapApp.includes('function stitchBakedStops') && mapApp.includes('function dropOutAndBack'),
    'network map hop-stitches kzn-bridgecity with dropOutAndBack, same as the planner',
);
assert(
    mapApp.includes('resolveKznKwamashuSpurLatLngs'),
    'the kwaMashu working is a second Bridge City polyline, not a detour of the main corridor',
);
assert(
    mapApp.includes('goldById'),
    'fork paint keeps the gold bake so the kwaMashu spur can still be sliced',
);
{
    const stitchAt = mapApp.indexOf("routeObj.routeId === 'kzn-bridgecity' && !preferBakeId");
    const graphAt = mapApp.indexOf('smoothStopsOnRailGraph(bundle.graph, stops, baked)');
    assert(stitchAt >= 0 && graphAt >= 0 && stitchAt < graphAt, 'kzn-bridgecity is hop-stitched before graph smooth');
}
{
    const mapPage = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
    assert(mapPage.includes('id="nt-track-fork-a"'), 'fork editor has Branch A');
    assert(mapPage.includes('id="nt-track-fork-b"'), 'fork editor has Branch B');
    assert(mapPage.includes('id="nt-track-fork-preset"') && mapPage.includes("Duff's Road split"), 'fork editor has a Duff\'s Road split preset');
    assert(mapPage.includes('id="nt-track-fork-clear"'), 'fork editor can reset the split');
    assert(mapPage.includes('id="nt-track-fork-save"'), 'fork editor can save both arms');
}
assert(
    /'ct-nolu': \[[^\]]*PHILIPPI", "STOCK ROAD", "MANDALAY", "NOLUNGILE"/.test(mapApp),
    'Nolungile main static path leaves Kapteinsklip off the Stock Road corridor',
);
assert(
    !/'ct-nolu': \[[^\]]*LENTEGEUR[^\]]*STOCK ROAD/.test(mapApp),
    'Nolungile main path does not run Lentegeur before Stock Road',
);
assert(
    /validStops\.splice\(idx, 0, \{ name, lat: coord\[0\], lon: coord\[1\], inactive: true/.test(mapApp),
    'the Maitland/Mutual geometry stop never claims a route, so Mutual stops showing Cape Town to Retreat',
);
assert(!railTracks.includes('STUB_MIN_M'), 'planner and tracking no longer stub sideways to an off-track station pin');
assert(railTracks.includes('function appendSeg(out, seg)'), 'planner appends rail segments only, never a station coordinate');
assert(
    mapApp.includes('function corridorGeometryStops'),
    'network map paints the corridor from the stops its trains actually serve',
);
assert(
    mapApp.includes("GHOST_GEOMETRY_REGIONS = new Set(['KZN'])"),
    'KZN keeps painting its ghost rows so its shape is left exactly as it is',
);
assert(!railTracks.includes('railHops !== stops.length - 1'), 'planner keeps rail hops when one station sits off the track');
assert(!mapApp.includes('railHops !== stops.length - 1'), 'network map also keeps valid rail hops when another hop falls back');

{
    const gp = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-GP.geojson', import.meta.url), 'utf8'));
    const belle = gp.features.find((f) => f.properties?.routeId === 'mab-belle');
    const coords = belle?.geometry?.coordinates || [];
    const stops = belle?.properties?.stationCoords || [];
    let hopPts = 0;
    for (let i = 0; i < stops.length - 1; i++) {
        const [aLat, aLon] = stops[i];
        const [bLat, bLon] = stops[i + 1];
        let i1 = -1;
        let i2 = -1;
        let d1 = Infinity;
        let d2 = Infinity;
        for (let k = 0; k < coords.length; k++) {
            const [lon, lat] = coords[k];
            const da = haversineM(lat, lon, aLat, aLon);
            const db = haversineM(lat, lon, bLat, bLon);
            if (da < d1) { d1 = da; i1 = k; }
            if (db < d2) { d2 = db; i2 = k; }
        }
        assert(d1 <= 900 && d2 <= 900, `mab-belle hop ${i} is farther than 900m from the bake`);
        hopPts += Math.abs(i2 - i1);
    }
    assert(hopPts > (stops.length - 1) * 4, `mab-belle planner hops should be rail-dense, got ${hopPts} pts over ${stops.length - 1} hops`);
}
const wcTracks = readFileSync(new URL('../public/tracks/rail-tracks-WC.geojson', import.meta.url), 'utf8');
assert(wcTracks.includes('"routeId":"ct-bellv"'), 'WC bake includes Cape Town to Bellville');
{
    const wc = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-WC.geojson', import.meta.url), 'utf8'));
    const nolu = wc.features.find((f) => f.properties?.routeId === 'ct-nolu');
    const names = nolu?.properties?.stationNames || [];
    const coords = nolu?.geometry?.coordinates || [];
    assert(names.includes('YSTERPLAAT') && names.includes('ESPLANADE'), 'ct-nolu bake lists Esplanade and Ysterplaat');
    assert(names.includes('NETREG') && names.includes('HEIDEVELD'), 'ct-nolu bake lists the Bonteheuwel south fork via Netreg');
    assert(!names.includes('WOODSTOCK'), 'ct-nolu bake no longer runs Woodstock / Salt River');
    const yst = (nolu?.properties?.stationCoords || [])[names.indexOf('YSTERPLAAT')];
    const esp = (nolu?.properties?.stationCoords || [])[names.indexOf('ESPLANADE')];
    const nya = (nolu?.properties?.stationCoords || [])[names.indexOf('NYANGA')];
    const phi = (nolu?.properties?.stationCoords || [])[names.indexOf('PHILIPPI')];
    const near = ([lat, lon]) => {
        let best = Infinity;
        let idx = 0;
        for (let i = 0; i < coords.length; i++) {
            const d = haversineM(lat, lon, coords[i][1], coords[i][0]);
            if (d < best) { best = d; idx = i; }
        }
        return { d: best, i: idx };
    };
    assert(yst && near(yst).d < 40, `ct-nolu passes Ysterplaat (got ${Math.round(near(yst).d)}m)`);
    assert(esp && near(esp).d < 50, `ct-nolu passes Esplanade (got ${Math.round(near(esp).d)}m)`);
    const nPhi = Math.abs(near(phi).i - near(nya).i);
    assert(nPhi > 8, `ct-nolu Nyanga→Philippi is draped (${nPhi} verts), not a two-point chord across the Cape Flats`);
    let phiSouth = Infinity;
    const nyaI = near(nya).i;
    const phiI = near(phi).i;
    const pLo = Math.min(nyaI, phiI);
    const pHi = Math.max(nyaI, phiI);
    for (let i = pLo; i <= pHi; i++) {
        if (coords[i][1] < phiSouth) phiSouth = coords[i][1];
    }
    assert(phiSouth < -34.010, `ct-nolu Nyanga→Philippi follows the Duinefontein rails south (southmost ${phiSouth.toFixed(5)})`);
    const duine = near([-34.008458, 18.565089]);
    assert(duine.d < 80, `ct-nolu passes the Cape Flats rails at Duinefontein (got ${Math.round(duine.d)}m)`);
    const bon = (nolu?.properties?.stationCoords || [])[names.indexOf('BONTEHEUWEL')];
    const nrg = (nolu?.properties?.stationCoords || [])[names.indexOf('NETREG')];
    if (bon && nrg) {
        const lo = Math.min(near(bon).i, near(nrg).i);
        const hi = Math.max(near(bon).i, near(nrg).i);
        const hopA = { lat: coords[lo][1], lon: coords[lo][0] };
        const hopB = { lat: coords[hi][1], lon: coords[hi][0] };
        const lat0 = ((hopA.lat + hopB.lat) / 2) * Math.PI / 180;
        const toXY = (la, lo) => [lo * Math.PI / 180 * 6371000 * Math.cos(lat0), la * Math.PI / 180 * 6371000];
        const [aX, aY] = toXY(hopA.lat, hopA.lon);
        const [bX, bY] = toXY(hopB.lat, hopB.lon);
        const abx = bX - aX;
        const aby = bY - aY;
        const len = Math.hypot(abx, aby) || 1;
        let maxPerp = 0;
        for (let i = lo; i <= hi; i++) {
            const [pX, pY] = toXY(coords[i][1], coords[i][0]);
            const perp = Math.abs((pX - aX) * -aby + (pY - aY) * abx) / len;
            if (perp > maxPerp) maxPerp = perp;
        }
        assert(maxPerp > 200, `ct-nolu Bonteheuwel→Netreg follows the Kalksteenfontein rails (max perp ${Math.round(maxPerp)}m)`);
    }
    const cape = (nolu?.properties?.stationCoords || [])[names.indexOf('CAPE TOWN')];
    const woodstock = [-33.925058, 18.446139];
    assert(near(woodstock).d > 100, `ct-nolu stays off the Woodstock pin (got ${Math.round(near(woodstock).d)}m)`);
    let woodSouth = 0;
    for (const [lon, lat] of coords) {
        if (lon > 18.444 && lon < 18.450 && lat < -33.9246) woodSouth++;
    }
    assert(woodSouth === 0, `ct-nolu does not peel across the Woodstock yard at MacGregor Street (${woodSouth} verts on the southern mainline)`);
    if (cape && esp) {
        const lo = Math.min(near(cape).i, near(esp).i);
        const hi = Math.max(near(cape).i, near(esp).i);
        const hopA = { lat: coords[lo][1], lon: coords[lo][0] };
        const hopB = { lat: coords[hi][1], lon: coords[hi][0] };
        const lat0 = ((hopA.lat + hopB.lat) / 2) * Math.PI / 180;
        const toXY = (la, lo) => [lo * Math.PI / 180 * 6371000 * Math.cos(lat0), la * Math.PI / 180 * 6371000];
        const [aX, aY] = toXY(hopA.lat, hopA.lon);
        const [bX, bY] = toXY(hopB.lat, hopB.lon);
        const abx = bX - aX;
        const aby = bY - aY;
        const len = Math.hypot(abx, aby) || 1;
        let maxPerp = 0;
        for (let i = lo; i <= hi; i++) {
            const [pX, pY] = toXY(coords[i][1], coords[i][0]);
            const perp = Math.abs((pX - aX) * -aby + (pY - aY) * abx) / len;
            if (perp > maxPerp) maxPerp = perp;
        }
        // Operator WC patch (Sep 2026) follows a slightly more bent Northern
        // Line into Esplanade (~201 m off the chord). The Woodstock-yard peel
        // is still refused by the pin / MacGregor probes above.
        assert(maxPerp < 220, `ct-nolu Cape Town→Esplanade stays on the Northern Line (max perp ${Math.round(maxPerp)}m)`);
    }
}

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

{
    const dir = mkdtempSync(path.join(tmpdir(), 'nt-track-patch-'));
    const kznFile = path.join(dir, 'kzn.json');
    writeFileSync(kznFile, JSON.stringify({
        kind: 'nexttrain-track-patch',
        region: 'KZN',
        routeId: 'kzn-umlazi',
        coordinates: [[31.02, -29.84], [31.01, -29.85]]
    }));
    const kzn = spawnSync(process.execPath, ['scripts/apply-track-patch.mjs', '--dry-run', kznFile], {
        encoding: 'utf8',
        cwd: ROOT
    });
    assert(kzn.status === 0, `apply-patch dry-run accepts KZN (${kzn.stderr || kzn.stdout})`);
    assert(/kzn-umlazi/.test(`${kzn.stdout}\n${kzn.stderr}`), 'apply-patch dry-run names the KZN corridor');

    const wc = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-WC.geojson', import.meta.url), 'utf8'));
    const kap = wc.features.find((f) => f.properties?.routeId === 'ct-kapteinsklip');
    const wcFile = path.join(dir, 'wc.json');
    writeFileSync(wcFile, JSON.stringify({
        kind: 'nexttrain-track-patch',
        region: 'WC',
        routeId: 'ct-kapteinsklip',
        stationNames: kap.properties.stationNames,
        coordinates: kap.geometry.coordinates.slice(0, 8)
    }));
    const wcRun = spawnSync(process.execPath, ['scripts/apply-track-patch.mjs', '--dry-run', wcFile], {
        encoding: 'utf8',
        cwd: ROOT
    });
    assert(wcRun.status === 0, `apply-patch dry-run WC ok (${wcRun.stderr || wcRun.stdout})`);
    assert(/ct-kapteinsklip/.test(wcRun.stdout), 'apply-patch dry-run names the corridor');
}

if (failures.length) {
    console.error('verify-map-lines failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-map-lines: ok');
