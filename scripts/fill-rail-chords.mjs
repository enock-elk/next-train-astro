/**
 * Drape leftover chords, stray hops, and short OSM voids onto nearby rails.
 *
 * After tracks:smooth removes pin hooks, some hops are still a straight line
 * (Nyanga → Philippi) or have walked onto a parallel railway (Walker Street
 * onto Gautrain, because OSM has a bridge gap). Hercules starts on the station
 * pin then jumps 430 m because the yard graph is disconnected.
 *
 * This script pulls a small OSM bbox per hop from api.openstreetmap.org (not
 * Overpass). It follows non-Gautrain, non-yard rail inside a corridor tube and
 * keeps the interpolated chord sample when OSM has no rail in that tube — a
 * short along-corridor jump, never a sideways hop onto a parallel track.
 *
 * Cape Town ↔ Nolungile is restitched onto the Esplanade / Ysterplaat
 * alignment (from ct-bellv) before hops are draped: the August bake still ran
 * via Woodstock, and the N1 spaghetti at Ysterplaat is the same OSM-void case.
 * Cape Town → Esplanade is then forced onto the northern tracks: OSM connects
 * the Woodstock mainline, so a graph walk peels across the yard at MacGregor
 * Street. The drape stays in the corridor tube and jumps the OSM void.
 * Bonteheuwel → Netreg and Nyanga → Philippi walk the Cape Flats rails OSM
 * tags abandoned, on one connected island, so they follow the basemap instead
 * of a diagonal chord. The Kapteinsklip working is a second polyline from
 * Philippi only (map-app slices that bake).
 *
 * KZN is refused. Idempotent when there is nothing left to fill.
 *
 * Usage: node scripts/fill-rail-chords.mjs GP WC EC
 *        node scripts/fill-rail-chords.mjs --dry-run GP
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripStationPins, despikeRailLine, haversineM } from './lib/rail-line-smooth.mjs';
import {
    drapeHop,
    drapeSameComponent,
    findGapSteps,
    findRepairHops,
    hopBboxPadDeg,
    hopMetrics,
    lineLengthM,
    MAX_CHORD_M,
    MIN_CHORD_M,
    nearestVert,
    parseRailNetwork,
    TUBE_M,
} from './lib/rail-gap-drape.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = path.join(ROOT, 'public', 'tracks');
const MAP_APP = path.join(ROOT, 'public', 'js', 'map-app.js');
const HELD_REGIONS = new Set(['KZN']);

const OSM_MAP = 'https://api.openstreetmap.org/api/0.6/map';
const USER_AGENT = 'NextTrain/1.0 (rail-track fill; nexttrain.co.za; github.com/enock-elk)';
const OSM_GAP_MS = 1100;

const NOLU_MAIN_STOPS = [
    'CAPE TOWN', 'ESPLANADE', 'YSTERPLAAT', 'MUTUAL', 'LANGA', 'BONTEHEUWEL',
    'NETREG', 'HEIDEVELD', 'NYANGA', 'PHILIPPI', 'STOCK ROAD', 'MANDALAY', 'NOLUNGILE',
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const regions = args.filter((a) => a !== '--dry-run').map((r) => r.toUpperCase());
if (!regions.length) {
    console.error('Usage: node scripts/fill-rail-chords.mjs [--dry-run] GP WC EC');
    process.exit(1);
}

function parseStationPins(src) {
    const block = src.match(/const STATION_COORDINATES = \{([\s\S]*?)\n\s*\};/);
    if (!block) return {};
    const stations = {};
    for (const m of block[1].matchAll(/"([^"]+)":\s*\[([-\d.]+),\s*([-\d.]+)\]/g)) {
        stations[m[1]] = [parseFloat(m[2]), parseFloat(m[3])];
    }
    return stations;
}

const STATION_PINS = parseStationPins(fs.readFileSync(MAP_APP, 'utf8'));

function spliceHop(coords, hop, draped) {
    return [
        ...coords.slice(0, hop.lo + 1),
        ...draped.slice(1, -1),
        ...coords.slice(hop.hi),
    ];
}

async function fetchOsm(hop, parseOpts = {}) {
    const pad = hop._padRetry || hop._padOverride || hopBboxPadDeg(hop);
    const s = Math.min(hop.a.lat, hop.b.lat) - pad;
    const n = Math.max(hop.a.lat, hop.b.lat) + pad;
    const w = Math.min(hop.a.lon, hop.b.lon) - pad;
    const e = Math.max(hop.a.lon, hop.b.lon) + pad;
    const bbox = `${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)}`;
    const url = `${OSM_MAP}?bbox=${bbox}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/osm3xml, application/xml, text/xml' },
            signal: ctrl.signal,
        });
        if (!res.ok) {
            if (res.status === 400 && pad > 0.002) {
                hop._padRetry = pad * 0.5;
                return fetchOsm(hop, parseOpts);
            }
            throw new Error(`HTTP ${res.status}`);
        }
        return parseRailNetwork(await res.text(), parseOpts);
    } finally {
        clearTimeout(timer);
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

let osmCalls = 0;

async function drapeAndFetch(hop, sameComponent = false) {
    if (osmCalls) await sleep(OSM_GAP_MS);
    if (sameComponent) hop._padOverride = Math.max(hop._padOverride || 0, 0.008);
    const network = await fetchOsm(hop, sameComponent
        ? { includeAbandoned: true, includeYard: true }
        : {});
    osmCalls++;
    return sameComponent ? drapeSameComponent(hop, network) : drapeHop(hop, network);
}

/** Only the hops in the owner's screenshots. A full-network stray pass flattened live curves. */
const REPAIR_HOPS = new Set([
    'pta-pien|WALKER STREET|LOFTUS VERSFELD PARK',
    'ct-nolu|CAPE TOWN|ESPLANADE',
    'ct-nolu|NYANGA|PHILIPPI',
    'ct-nolu|BONTEHEUWEL|NETREG',
    'ct-nolu|HEIDEVELD|NYANGA',
    'ct-chrishani|NYANGA|PHILIPPI',
    'ct-chrishani|BONTEHEUWEL|NETREG',
    'ct-chrishani|HEIDEVELD|NYANGA',
    'ct-kapteinsklip|NYANGA|PHILIPPI',
    'ct-kapteinsklip|BONTEHEUWEL|NETREG',
    'ct-kapteinsklip|HEIDEVELD|NYANGA',
]);

/** Cape Flats hops where OSM tags the running rails abandoned, so the tube
 *  chord is wrong. Walk one connected island, including those ways. Nolungile
 *  only — Chris Hani / Kapteinsklip keep their current bake. */
const GRAPH_HOPS = new Set([
    'ct-nolu|BONTEHEUWEL|NETREG',
    'ct-nolu|NYANGA|PHILIPPI',
]);

function shouldRepair(routeId, hop) {
    if (routeId === 'herc-koed' && hop.kind === 'gap' && hop.lo === 0) return true;
    return REPAIR_HOPS.has(`${routeId}|${hop.from}|${hop.to}`);
}

/**
 * Allowlisted station hops that are dense on the wrong railway (Cape Town →
 * Esplanade rides the Woodstock mainline, then peels north at MacGregor
 * Street). findRepairHops misses those: too many verts, steps under 250 m.
 */
function findForcedHops(coords, stops, names, routeId) {
    const hops = [];
    if (!Array.isArray(stops) || stops.length < 2) return hops;
    for (let s = 0; s < stops.length - 1; s++) {
        const from = names?.[s];
        const to = names?.[s + 1];
        if (!REPAIR_HOPS.has(`${routeId}|${from}|${to}`)) continue;
        const a = stops[s];
        const b = stops[s + 1];
        if (!a || !b) continue;
        const m = hopMetrics(coords, a[0], a[1], b[0], b[1]);
        if (m.chordM < MIN_CHORD_M || m.chordM > MAX_CHORD_M) continue;
        const graphHop = GRAPH_HOPS.has(`${routeId}|${from}|${to}`);
        if (graphHop) {
            if (m.maxPerp > 200 && m.between >= 20) continue;
        } else if (m.maxPerp <= TUBE_M) {
            continue;
        }
        hops.push({
            from,
            to,
            kind: 'forced',
            ...m,
        });
    }
    return hops;
}

function lerpHop(hop, stepM = 40) {
    const n = Math.max(2, Math.round(hop.chordM / stepM));
    const coords = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        coords.push([
            hop.a.lon + t * (hop.b.lon - hop.a.lon),
            hop.a.lat + t * (hop.b.lat - hop.a.lat),
        ]);
    }
    return coords;
}

async function restitchNoluViaYsterplaat(fc) {
    const nolu = (fc.features || []).find((f) => f.properties?.routeId === 'ct-nolu');
    const bellv = (fc.features || []).find((f) => f.properties?.routeId === 'ct-bellv');
    const yst = STATION_PINS.YSTERPLAAT;
    const mut = STATION_PINS.MUTUAL;
    if (!nolu || !bellv || !yst || !mut) return false;
    const noluCoords = nolu.geometry?.coordinates;
    const bellvCoords = bellv.geometry?.coordinates;
    if (!Array.isArray(noluCoords) || !Array.isArray(bellvCoords)) return false;
    const ysterOnNolu = nearestVert(noluCoords, yst[0], yst[1]);
    if (ysterOnNolu.d < 40) return false;

    const ysterOnBellv = nearestVert(bellvCoords, yst[0], yst[1]);
    const mutualOnNolu = nearestVert(noluCoords, mut[0], mut[1]);
    if (ysterOnBellv.d > 80 || mutualOnNolu.d > 120) {
        console.log(`  WC ct-nolu: restitch skip (Ysterplaat on bellv ${Math.round(ysterOnBellv.d)}m, Mutual on nolu ${Math.round(mutualOnNolu.d)}m)`);
        return false;
    }
    const prefix = bellvCoords.slice(0, ysterOnBellv.i + 1);
    const suffix = noluCoords.slice(mutualOnNolu.i);
    const hop = {
        from: 'YSTERPLAAT',
        to: 'MUTUAL',
        kind: 'restitch',
        a: { lat: prefix[prefix.length - 1][1], lon: prefix[prefix.length - 1][0] },
        b: { lat: suffix[0][1], lon: suffix[0][0] },
        chordM: haversineM(
            prefix[prefix.length - 1][1], prefix[prefix.length - 1][0],
            suffix[0][1], suffix[0][0],
        ),
    };
    let mid;
    try {
        const draped = await drapeAndFetch(hop);
        mid = draped.ok ? draped.coords : lerpHop(hop);
        console.log(
            `  WC ct-nolu           YSTERPLAAT → MUTUAL`
            + `  restitch ${Math.round(hop.chordM)}m → ${Math.round(lineLengthM(mid))}m`
            + `  ${draped.ok ? draped.method : 'chord jump (OSM void)'}`
        );
    } catch (err) {
        mid = lerpHop(hop);
        console.log(`  WC ct-nolu YSTERPLAAT→MUTUAL: OSM skip (${err.message}); jumping the N1 gap`);
    }
    const coords = [
        ...prefix,
        ...mid.slice(1, -1),
        ...suffix,
    ];
    const names = NOLU_MAIN_STOPS.filter((name) => STATION_PINS[name]);
    const stationCoords = names.map((name) => {
        const [lat, lon] = STATION_PINS[name];
        return [+lat.toFixed(6), +lon.toFixed(6)];
    });
    nolu.geometry.coordinates = coords;
    nolu.properties.stationNames = names;
    nolu.properties.stationCoords = stationCoords;
    nolu.properties.noluViaYsterplaat = true;
    return true;
}

function recountChordHops(coords, stops) {
    if (!Array.isArray(stops) || stops.length < 2) return 0;
    let n = 0;
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
        if (between <= 1 && alongM <= chordM * 1.12 && chordM >= 200) n++;
    }
    return n;
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
    let pinTotal = 0;
    let spikeTotal = 0;
    let filled = 0;
    let skipped = 0;

    if (region === 'WC' && !dryRun) {
        try {
            await restitchNoluViaYsterplaat(fc);
        } catch (err) {
            console.log(`  WC ct-nolu restitch failed (${err.message})`);
        }
    } else if (region === 'WC' && dryRun) {
        const nolu = (fc.features || []).find((f) => f.properties?.routeId === 'ct-nolu');
        const yst = STATION_PINS.YSTERPLAAT;
        if (nolu && yst) {
            const d = nearestVert(nolu.geometry.coordinates, yst[0], yst[1]).d;
            console.log(`  WC ct-nolu: Ysterplaat currently ${Math.round(d)}m from bake (dry-run, restitch skipped)`);
        }
    }

    for (const feature of fc.features || []) {
        const original = feature?.geometry?.coordinates;
        const stationCoords = feature?.properties?.stationCoords;
        const names = feature?.properties?.stationNames;
        const routeId = feature?.properties?.routeId;
        if (!Array.isArray(original) || original.length < 2) continue;
        // Nolungile is the only WC corridor this pass rewrites. Chris Hani and
        // Kapteinsklip keep the shared Central Line bake; the map spur slices
        // Kapteinsklip from Philippi instead of redrawing Cape Town → Mutual.
        if (region === 'WC' && routeId !== 'ct-nolu') continue;

        const pinned = stripStationPins(original, stationCoords || []);
        const despiked = despikeRailLine(pinned.coords);
        let coords = despiked.coords;
        pinTotal += pinned.removed;
        spikeTotal += despiked.excursions.length;

        const stationHops = findRepairHops(coords, stationCoords, names);
        const forcedHops = findForcedHops(coords, stationCoords, names, routeId);
        const gapHops = findGapSteps(coords, stationHops);
        const seen = new Set();
        const hops = [...stationHops, ...forcedHops, ...gapHops]
            .filter((hop) => shouldRepair(routeId, hop))
            .filter((hop) => {
                const key = `${hop.lo}:${hop.hi}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => b.lo - a.lo);
        for (const hop of hops) {
            let draped;
            try {
                draped = await drapeAndFetch(hop, GRAPH_HOPS.has(`${routeId}|${hop.from}|${hop.to}`));
            } catch (err) {
                console.log(`  ${region} ${routeId} ${hop.from}→${hop.to}: OSM skip (${err.message})`);
                skipped++;
                continue;
            }
            if (!draped.ok) {
                console.log(`  ${region} ${routeId} ${hop.from}→${hop.to}: keep ${hop.kind} ${Math.round(hop.chordM)}m (${draped.reason})`);
                skipped++;
                continue;
            }
            if (hop.kind === 'gap' && String(draped.method || '').startsWith('tube+gap') && (draped.gapHits || 0) === 0) {
                skipped++;
                continue;
            }
            const next = spliceHop(coords, hop, draped.coords);
            if (next.length < 2) {
                skipped++;
                continue;
            }
            console.log(
                `  ${region} ${String(routeId).padEnd(18)} ${hop.from} → ${hop.to}`
                + `  ${hop.kind} ${Math.round(hop.chordM)}m → ${draped.len}m`
                + `  ${hop.hi - hop.lo + 1}→${draped.coords.length} verts`
                + `  ${draped.method}  max perp ${draped.worst}m`
            );
            coords = next;
            filled++;
        }

        const cleaned = stripStationPins(coords, stationCoords || []);
        const despikedAgain = despikeRailLine(cleaned.coords);
        pinTotal += cleaned.removed;
        spikeTotal += despikedAgain.excursions.length;
        coords = despikedAgain.coords;

        if (!dryRun) {
            feature.geometry.coordinates = coords;
            feature.properties.stationPinsStripped = true;
            feature.properties.chordHops = recountChordHops(coords, stationCoords || []);
            let worst = 0;
            for (const [lat, lon] of stationCoords || []) {
                let best = Infinity;
                for (let i = 0; i < coords.length; i++) {
                    const d = haversineM(lat, lon, coords[i][1], coords[i][0]);
                    if (d < best) best = d;
                }
                if (best > worst) worst = best;
            }
            feature.properties.maxStationOffsetM = Math.round(worst);
        }
    }

    if (!dryRun) {
        fs.writeFileSync(file, JSON.stringify(fc));
    }
    console.log(
        `${region}: ${pinTotal} pin hooks, ${spikeTotal} spikes, ${filled} hops draped`
        + (skipped ? `, ${skipped} hops kept` : '')
        + (dryRun ? ' (dry-run, not written)' : ` → ${file}`)
        + '\n'
    );
}
