/**
 * Drape leftover station-to-station chords onto nearby OSM rails.
 *
 * After tracks:smooth removes pin hooks, some hops are still a straight line
 * (Loftus Versfeld Park → Rissik on pta-pien). Those hops exist because the
 * Aug 2026 bake could not walk OSM between the two stops (Gautrain sits metres
 * from Metrorail here). This script pulls a small OSM bbox per hop from
 * api.openstreetmap.org (not Overpass), ignores Gautrain-named ways, and
 * drapes the chord onto the nearest remaining rail.
 *
 * KZN is refused. A hop is skipped when the drape would wander, lengthen the
 * corridor, or sit too far from rail (true OSM gaps such as De Wildt stay as
 * chords). Idempotent when there is nothing left to fill.
 *
 * Usage: node scripts/fill-rail-chords.mjs GP WC EC
 *        node scripts/fill-rail-chords.mjs --dry-run GP
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripStationPins, despikeRailLine, haversineM } from './lib/rail-line-smooth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = path.join(ROOT, 'public', 'tracks');
const HELD_REGIONS = new Set(['KZN']);

const OSM_MAP = 'https://api.openstreetmap.org/api/0.6/map';
const USER_AGENT = 'NextTrain/1.0 (rail-track fill; nexttrain.co.za; github.com/enock-elk)';
/** Ignore hops shorter than a city block; those are already rail. */
const MIN_CHORD_M = 200;
/** De Wildt / Cape Flats OSM gaps stay as honest chords. */
const MAX_CHORD_M = 2000;
const MAX_VERTS_BETWEEN = 1;
const MAX_DRAPE_SNAP_M = 100;
const MAX_FAIL_FRACTION = 0.2;
const MAX_LENGTH_RATIO = 1.25;
const SAMPLE_COUNT = 24;
const BBOX_PAD_DEG = 0.0035;
const OSM_GAP_MS = 1100;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const regions = args.filter((a) => a !== '--dry-run').map((r) => r.toUpperCase());
if (!regions.length) {
    console.error('Usage: node scripts/fill-rail-chords.mjs [--dry-run] GP WC EC');
    process.exit(1);
}

function lineLengthM(coords, from = 0, to = coords.length - 1) {
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
    return best;
}

function pointToSeg(pLat, pLon, a, b) {
    const lat0 = ((a.lat + b.lat) / 2) * Math.PI / 180;
    const toXY = (lat, lon) => [
        lon * Math.PI / 180 * 6371000 * Math.cos(lat0),
        lat * Math.PI / 180 * 6371000,
    ];
    const [pX, pY] = toXY(pLat, pLon);
    const [aX, aY] = toXY(a.lat, a.lon);
    const [bX, bY] = toXY(b.lat, b.lon);
    const abx = bX - aX;
    const aby = bY - aY;
    const len2 = abx * abx + aby * aby;
    let t = len2 < 1 ? 0 : ((pX - aX) * abx + (pY - aY) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    return {
        d: Math.hypot(pX - (aX + t * abx), pY - (aY + t * aby)),
        lat: a.lat + t * (b.lat - a.lat),
        lon: a.lon + t * (b.lon - a.lon),
    };
}

function findChordHops(coords, stops, names) {
    const hops = [];
    if (!Array.isArray(stops) || stops.length < 2) return hops;
    for (let s = 0; s < stops.length - 1; s++) {
        const a = stops[s];
        const b = stops[s + 1];
        if (!a || !b) continue;
        const i1 = nearestVert(coords, a[0], a[1]);
        const i2 = nearestVert(coords, b[0], b[1]);
        const lo = Math.min(i1, i2);
        const hi = Math.max(i1, i2);
        const chordM = haversineM(a[0], a[1], b[0], b[1]);
        const alongM = lineLengthM(coords, lo, hi);
        const between = hi - lo - 1;
        if (chordM < MIN_CHORD_M || chordM > MAX_CHORD_M) continue;
        if (between > MAX_VERTS_BETWEEN) continue;
        if (alongM > chordM * 1.12) continue;
        hops.push({
            from: names?.[s] || `stop ${s}`,
            to: names?.[s + 1] || `stop ${s + 1}`,
            lo,
            hi,
            chordM,
            a: { lat: coords[lo][1], lon: coords[lo][0] },
            b: { lat: coords[hi][1], lon: coords[hi][0] },
        });
    }
    return hops;
}

function parseRailSegments(xml) {
    const nodes = new Map();
    for (const m of xml.matchAll(/<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g)) {
        nodes.set(m[1], { lat: Number(m[2]), lon: Number(m[3]) });
    }
    const segs = [];
    const wayRe = /<way id="(\d+)"[\s\S]*?<\/way>/g;
    let wm;
    while ((wm = wayRe.exec(xml))) {
        const block = wm[0];
        const rw = block.match(/k="railway" v="([^"]+)"/);
        if (!rw || !['rail', 'light_rail', 'subway'].includes(rw[1])) continue;
        if (/k="abandoned"|k="disused" v="yes"/.test(block)) continue;
        const name = (block.match(/k="name" v="([^"]+)"/) || [])[1] || '';
        const operator = (block.match(/k="operator" v="([^"]+)"/) || [])[1] || '';
        if (/gautrain/i.test(`${name} ${operator}`)) continue;
        const nds = [...block.matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]);
        for (let i = 1; i < nds.length; i++) {
            const A = nodes.get(nds[i - 1]);
            const B = nodes.get(nds[i]);
            if (A && B) segs.push([A, B]);
        }
    }
    return segs;
}

function snapToSegs(lat, lon, segs) {
    let best = { d: Infinity, lat, lon };
    for (const [A, B] of segs) {
        const hit = pointToSeg(lat, lon, A, B);
        if (hit.d < best.d) best = hit;
    }
    return best;
}

function drapeHop(hop, segs) {
    const draped = [];
    let fails = 0;
    let worst = 0;
    for (let i = 0; i <= SAMPLE_COUNT; i++) {
        const t = i / SAMPLE_COUNT;
        const lat = hop.a.lat + t * (hop.b.lat - hop.a.lat);
        const lon = hop.a.lon + t * (hop.b.lon - hop.a.lon);
        const hit = snapToSegs(lat, lon, segs);
        if (hit.d > MAX_DRAPE_SNAP_M) {
            fails++;
            continue;
        }
        if (hit.d > worst) worst = hit.d;
        const prev = draped[draped.length - 1];
        if (prev && haversineM(prev[1], prev[0], hit.lat, hit.lon) < 8) continue;
        draped.push([hit.lon, hit.lat]);
    }
    if (!draped.length) return { ok: false, reason: 'no snaps' };
    const failFrac = fails / (SAMPLE_COUNT + 1);
    if (failFrac > MAX_FAIL_FRACTION) {
        return { ok: false, reason: `${Math.round(failFrac * 100)}% of samples missed rail` };
    }
    const len = lineLengthM(draped);
    if (len > hop.chordM * MAX_LENGTH_RATIO) {
        return { ok: false, reason: `drape ${Math.round(len)}m vs chord ${Math.round(hop.chordM)}m` };
    }
    if (draped.length < 3) return { ok: false, reason: 'too few verts' };
    return { ok: true, coords: draped, worst: Math.round(worst), len: Math.round(len) };
}

async function fetchOsm(hop) {
    const s = Math.min(hop.a.lat, hop.b.lat) - BBOX_PAD_DEG;
    const n = Math.max(hop.a.lat, hop.b.lat) + BBOX_PAD_DEG;
    const w = Math.min(hop.a.lon, hop.b.lon) - BBOX_PAD_DEG;
    const e = Math.max(hop.a.lon, hop.b.lon) + BBOX_PAD_DEG;
    const bbox = `${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)}`;
    const url = `${OSM_MAP}?bbox=${bbox}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/osm3xml, application/xml, text/xml' },
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return parseRailSegments(await res.text());
    } finally {
        clearTimeout(timer);
    }
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

let osmCalls = 0;

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

    for (const feature of fc.features || []) {
        const original = feature?.geometry?.coordinates;
        const stationCoords = feature?.properties?.stationCoords;
        const names = feature?.properties?.stationNames;
        const routeId = feature?.properties?.routeId;
        if (!Array.isArray(original) || original.length < 2) continue;

        const pinned = stripStationPins(original, stationCoords || []);
        const despiked = despikeRailLine(pinned.coords);
        let coords = despiked.coords;
        pinTotal += pinned.removed;
        spikeTotal += despiked.excursions.length;

        const hops = findChordHops(coords, stationCoords, names)
            .sort((a, b) => b.lo - a.lo);
        for (const hop of hops) {
            let segs;
            try {
                if (osmCalls) await sleep(OSM_GAP_MS);
                segs = await fetchOsm(hop);
                osmCalls++;
            } catch (err) {
                console.log(`  ${region} ${routeId} ${hop.from}→${hop.to}: OSM skip (${err.message})`);
                skipped++;
                continue;
            }
            const draped = drapeHop(hop, segs);
            if (!draped.ok) {
                console.log(`  ${region} ${routeId} ${hop.from}→${hop.to}: keep chord ${Math.round(hop.chordM)}m (${draped.reason})`);
                skipped++;
                continue;
            }
            const next = [
                ...coords.slice(0, hop.lo + 1),
                ...draped.coords.slice(1, -1),
                ...coords.slice(hop.hi),
            ];
            if (next.length < 2) {
                skipped++;
                continue;
            }
            console.log(
                `  ${region} ${String(routeId).padEnd(18)} ${hop.from} → ${hop.to}`
                + `  chord ${Math.round(hop.chordM)}m → ${draped.len}m rail`
                + `  ${hop.hi - hop.lo + 1}→${draped.coords.length} verts`
                + `  max snap ${draped.worst}m`
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
            let worst = 0;
            for (const [lat, lon] of stationCoords || []) {
                let best = Infinity;
                for (let i = 1; i < coords.length; i++) {
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
        `${region}: ${pinTotal} pin hooks, ${spikeTotal} spikes, ${filled} chords draped`
        + (skipped ? `, ${skipped} chords kept` : '')
        + (dryRun ? ' (dry-run, not written)' : ` → ${file}`)
        + '\n'
    );
}
