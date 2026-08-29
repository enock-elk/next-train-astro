/**
 * Build per-region rail track GeoJSON for the network map.
 *
 * Pulls OSM railway ways via Overpass, snaps Next Train station sequences onto
 * the rail graph, and writes public/tracks/rail-tracks-{REGION}.geojson.
 * (Kept outside public/data/ so production sync can ship tracks without
 * touching the protected schedule CDN folder on metrorail-app.)
 *
 * Station order and coordinates come from the timetable dump
 * (public/data/full-database.json) so the baked line follows the same stations
 * the board paints. STATIC_ROUTE_PATHS is only a fallback for routes the dump
 * does not carry.
 *
 * Usage: node scripts/build-rail-tracks.mjs [GP|WC|KZN|EC|all]
 *
 * Source geometry: © OpenStreetMap contributors (ODbL).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAP_APP = path.join(ROOT, 'public', 'js', 'map-app.js');
const CONFIG_JS = path.join(ROOT, 'src', 'lib', 'config.js');
const DUMP = path.join(ROOT, 'public', 'data', 'full-database.json');
const OUT_DIR = path.join(ROOT, 'public', 'tracks');

const OVERPASS_URLS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Floor bbox per region: south, west, north, east.
 * The query box is widened to enclose every station of that region plus
 * BBOX_PAD_DEG, so a terminus like Cato Ridge or Malmesbury still has rail.
 */
const REGION_BBOX = {
    GP: [-26.45, 27.62, -25.45, 28.52],
    WC: [-34.30, 18.28, -33.55, 19.05],
    KZN: [-30.10, 30.65, -29.50, 31.20],
    EC: [-33.12, 27.55, -32.82, 28.00],
};

/** ~17 km of slack so a terminus is never on the edge of the download. */
const BBOX_PAD_DEG = 0.15;

/** Region key inside the timetable dump. */
const REGION_DUMP_NODE = {
    GP: 'gauteng',
    WC: 'westerncape',
    KZN: 'kzn',
    EC: 'easterncape',
};

const SNAP_MAX_M = 950;
/** Settled-node ceiling per hop. A region graph is ~80k nodes. */
const MAX_SEGMENT_HOPS = 400000;
/** A hop's rail path this much longer than the chord is a wrong-way detour. */
const HOP_DETOUR_RATIO = 2.8;
const HOP_DETOUR_MIN_M = 900;

function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/** Parse STATION_COORDINATES + STATIC_ROUTE_PATHS from map-app.js */
function parseMapStatic(src) {
    const stations = {};
    const stationBlock = src.match(/const STATION_COORDINATES = \{([\s\S]*?)\n\s*\};/);
    if (!stationBlock) throw new Error('STATION_COORDINATES not found in map-app.js');
    for (const m of stationBlock[1].matchAll(/"([^"]+)":\s*\[([-\d.]+),\s*([-\d.]+)\]/g)) {
        stations[m[1]] = [parseFloat(m[2]), parseFloat(m[3])];
    }

    const paths = {};
    const pathBlock = src.match(/const STATIC_ROUTE_PATHS = \{([\s\S]*?)\n\s*\};/);
    if (!pathBlock) throw new Error('STATIC_ROUTE_PATHS not found in map-app.js');
    for (const m of pathBlock[1].matchAll(/'([^']+)':\s*\[([^\]]+)\]/g)) {
        const names = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
        if (names.length) paths[m[1]] = names;
    }
    return { stations, paths };
}

/** Every drawable route per region, straight from the app's ROUTES config. */
function parseRegionRoutes() {
    const src = fs.readFileSync(CONFIG_JS, 'utf8');
    const start = src.indexOf('export const ROUTES = {');
    if (start < 0) throw new Error('ROUTES not found in config.js');
    const open = src.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    if (end < 0) throw new Error('ROUTES block unbalanced');
    const routes = new Function(`return ${src.slice(open, end)};`)();
    const byRegion = {};
    const meta = {};
    for (const route of Object.values(routes)) {
        if (!route?.id || !route.region || route.id === 'special_event') continue;
        if (!byRegion[route.region]) byRegion[route.region] = [];
        byRegion[route.region].push(route.id);
        meta[route.id] = route;
    }
    return { byRegion, meta };
}

/**
 * Ordered stations for a route, mirroring what the map extracts at runtime:
 * timetable sheet rows that carry train times, coordinates from the sheet with
 * STATION_COORDINATES as rescue.
 */
function timetableStations(dumpRegion, route, stations) {
    if (!dumpRegion || !route?.sheetKeys) return null;
    for (const key of [route.sheetKeys.weekday_to_a, route.sheetKeys.weekday_to_b]) {
        const sheet = key && dumpRegion[key];
        if (!Array.isArray(sheet)) continue;
        const out = [];
        for (const row of sheet) {
            if (!row || typeof row !== 'object') continue;
            const raw = row.STATION;
            if (!raw) continue;
            const label = String(raw).trim();
            const lower = label.toLowerCase();
            if (!label || lower === 'station') continue;
            if (lower.includes('last updated') || lower.includes('inter-station')) continue;
            // Ghost-row pruning: a row with no train times is not a served stop
            const hasTimes = Object.keys(row).some((k) => (
                k !== 'STATION' && k !== 'COORDINATES' && k !== 'KM_MARK' && k !== 'row_index'
                && row[k] && String(row[k]).trim() !== '' && String(row[k]).trim() !== '-'
            ));
            if (!hasTimes) continue;
            const name = label.replace(/ STATION/gi, '').toUpperCase();
            let lat = null;
            let lon = null;
            if (row.COORDINATES) {
                const parts = String(row.COORDINATES).split(',').map((s) => parseFloat(s.trim()));
                if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
                    [lat, lon] = parts;
                }
            }
            if (lat === null && stations[name]) [lat, lon] = stations[name];
            if (lat === null) continue;
            if (out.some((s) => s.name === name)) continue;
            out.push({ name, lat, lon });
        }
        if (out.length > 1) return { stops: out, sheetKey: key };
    }
    return null;
}

function stopsAreAdjacent(stops, a, b) {
    for (let i = 0; i < stops.length - 1; i++) {
        const x = stops[i].name;
        const y = stops[i + 1].name;
        if ((x === a && y === b) || (x === b && y === a)) return true;
    }
    return false;
}

/**
 * Official corridor is Koeberg Rd → Maitland → Mutual, but a sheet often lists
 * only one of the pair. The map inserts the missing one, so the bake must too
 * or the baked line will not pass the station the map paints.
 */
function ensureMaitlandMutualAdjacency(stops, stations) {
    const mai = stations.MAITLAND;
    const mut = stations.MUTUAL;
    if (!mai || !mut || !stops.length) return stops;
    if (stopsAreAdjacent(stops, 'MAITLAND', 'MUTUAL')) return stops;
    const names = stops.map((s) => s.name);
    const iMut = names.indexOf('MUTUAL');
    const iMai = names.indexOf('MAITLAND');
    const prevIsEastBranch = (idx) => {
        const prev = names[idx - 1];
        return prev === 'LANGA' || prev === 'BONTEHEUWEL' || prev === 'NDABENI' || prev === 'PINELANDS';
    };
    if (iMut >= 0 && iMai < 0) {
        stops.splice(prevIsEastBranch(iMut) ? iMut + 1 : iMut, 0, { name: 'MAITLAND', lat: mai[0], lon: mai[1] });
    } else if (iMai >= 0 && iMut < 0) {
        stops.splice(iMai + 1, 0, { name: 'MUTUAL', lat: mut[0], lon: mut[1] });
    }
    return stops;
}

/** Paint order is the official station list, exactly as the map applies it. */
function applyCanonicalStationOrder(routeId, stops, paths) {
    const names = paths[routeId];
    if (!names || names.length < 2) return stops;
    const byName = new Map();
    for (const s of stops) byName.set(s.name, s);
    const ordered = [];
    for (const name of names) {
        const s = byName.get(name);
        if (s) ordered.push(s);
    }
    return ordered.length > 1 ? ordered : stops;
}

/** Fallback station list from the hardcoded corridor definition. */
function staticStations(routeId, paths, stations) {
    const names = paths[routeId];
    if (!names?.length) return null;
    const out = [];
    for (const name of names) {
        const c = stations[name];
        if (!c) continue;
        out.push({ name, lat: c[0], lon: c[1] });
    }
    return out.length > 1 ? { stops: out, sheetKey: 'STATIC_ROUTE_PATHS' } : null;
}

/** Widen the download box so no station sits on (or past) the edge. */
function bboxForStops(region, allStops) {
    const floor = REGION_BBOX[region];
    let [s, w, n, e] = floor ? [...floor] : [90, 180, -90, -180];
    for (const stop of allStops) {
        s = Math.min(s, stop.lat);
        n = Math.max(n, stop.lat);
        w = Math.min(w, stop.lon);
        e = Math.max(e, stop.lon);
    }
    return [
        +(s - BBOX_PAD_DEG).toFixed(4),
        +(w - BBOX_PAD_DEG).toFixed(4),
        +(n + BBOX_PAD_DEG).toFixed(4),
        +(e + BBOX_PAD_DEG).toFixed(4),
    ];
}

async function fetchOverpass(bbox) {
    const [s, w, n, e] = bbox;
    const query = `
[out:json][timeout:180];
(
  way["railway"="rail"](${s},${w},${n},${e});
  way["railway"="light_rail"](${s},${w},${n},${e});
  way["railway"="subway"](${s},${w},${n},${e});
);
out body;
>;
out skel qt;
`.trim();

    let lastErr;
    for (const url of OVERPASS_URLS) {
        try {
            console.log(`  Overpass → ${url}`);
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 90000);
            let res;
            try {
                res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'NextTrain/1.0 (rail-track bake; nexttrain.co.za; contact via github.com/enock-elk)',
                        Accept: 'application/json',
                    },
                    body: `data=${encodeURIComponent(query)}`,
                    signal: ctrl.signal,
                });
            } finally {
                clearTimeout(timer);
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.elements?.length) throw new Error('Empty Overpass response');
            return data;
        } catch (err) {
            lastErr = err;
            console.warn(`  failed: ${err.message}`);
            await new Promise((r) => setTimeout(r, 2500));
        }
    }
    throw lastErr || new Error('Overpass failed');
}

function buildRailGraph(osm) {
    const nodes = new Map();
    for (const el of osm.elements) {
        if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lon: el.lon });
    }

    /** @type {Map<number, Array<{to:number, w:number}>>} */
    const adj = new Map();
    const addEdge = (a, b, w) => {
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push({ to: b, w });
        adj.get(b).push({ to: a, w });
    };

    let wayCount = 0;
    for (const el of osm.elements) {
        if (el.type !== 'way' || !el.nodes?.length) continue;
        const railway = el.tags?.railway;
        if (!railway || !['rail', 'light_rail', 'subway'].includes(railway)) continue;
        // Yard and spur ways carry real connectivity (Koedoespoort is only
        // reachable through them), so they stay in. Detour budgets keep a hop
        // from shortcutting through a yard.
        if (el.tags?.railway === 'abandoned' || el.tags?.disused === 'yes') continue;
        wayCount++;
        for (let i = 0; i < el.nodes.length - 1; i++) {
            const a = el.nodes[i];
            const b = el.nodes[i + 1];
            const na = nodes.get(a);
            const nb = nodes.get(b);
            if (!na || !nb) continue;
            const w = haversineM(na.lat, na.lon, nb.lat, nb.lon);
            if (w > 0) addEdge(a, b, w);
        }
    }
    const component = labelComponents(adj);
    console.log(`  Graph: ${nodes.size} nodes, ${wayCount} ways, ${adj.size} connected, ${component.count} components`);
    return { nodes, adj, comp: component.comp };
}

/** Connected-component id per node, so a hop never tries to cross networks. */
function labelComponents(adj) {
    const comp = new Map();
    let count = 0;
    for (const id of adj.keys()) {
        if (comp.has(id)) continue;
        const stack = [id];
        comp.set(id, count);
        while (stack.length) {
            const u = stack.pop();
            for (const { to } of adj.get(u) || []) {
                if (!comp.has(to)) {
                    comp.set(to, count);
                    stack.push(to);
                }
            }
        }
        count++;
    }
    return { comp, count };
}

/** Nearest reachable node within maxM, per connected component. */
function nearestNodePerComponent(graph, lat, lon, maxM = SNAP_MAX_M) {
    const best = new Map();
    for (const [id, n] of graph.nodes) {
        if (!graph.adj.has(id)) continue;
        const d = haversineM(lat, lon, n.lat, n.lon);
        if (d > maxM) continue;
        const c = graph.comp.get(id);
        const cur = best.get(c);
        if (!cur || d < cur.dist) best.set(c, { id, dist: d });
    }
    return best;
}

/**
 * Snap both ends of a hop into the same rail network.
 * Pretoria and Rhodesfield sit metres from Gautrain track, which is a separate
 * component; picking the plain nearest node there made the hop unroutable.
 */
function snapHopToSharedComponent(graph, a, b) {
    const candA = nearestNodePerComponent(graph, a.lat, a.lon);
    const candB = nearestNodePerComponent(graph, b.lat, b.lon);
    let best = null;
    for (const [comp, sa] of candA) {
        const sb = candB.get(comp);
        if (!sb) continue;
        const cost = sa.dist + sb.dist;
        if (!best || cost < best.cost) best = { cost, a: sa, b: sb };
    }
    return best;
}

/** Min-heap keyed on distance. A sorted array made long hops time out. */
class MinHeap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(item) {
        const a = this.a;
        a.push(item);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p][0] <= a[i][0]) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }
    pop() {
        const a = this.a;
        const top = a[0];
        const last = a.pop();
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < a.length && a[l][0] < a[m][0]) m = l;
                if (r < a.length && a[r][0] < a[m][0]) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top;
    }
}

/**
 * Dijkstra — returns node id path or null.
 * maxDistM stops the search from crawling the whole region when two stations
 * are not actually connected by rail.
 */
function shortestPath(graph, startId, endId, maxDistM = Infinity) {
    if (startId === endId) return [startId];
    const dist = new Map([[startId, 0]]);
    const prev = new Map();
    const pq = new MinHeap();
    pq.push([0, startId]);
    let settled = 0;

    while (pq.size) {
        const [d, u] = pq.pop();
        if (d !== dist.get(u)) continue;
        if (u === endId) break;
        if (d > maxDistM) break;
        if (++settled > MAX_SEGMENT_HOPS) return null;
        for (const { to, w } of graph.adj.get(u) || []) {
            const nd = d + w;
            if (nd < (dist.get(to) ?? Infinity)) {
                dist.set(to, nd);
                prev.set(to, u);
                pq.push([nd, to]);
            }
        }
    }
    if (!prev.has(endId) && startId !== endId) return null;
    const path = [endId];
    for (let cur = endId; cur !== startId; ) {
        cur = prev.get(cur);
        if (cur == null) return null;
        path.push(cur);
    }
    path.reverse();
    return path;
}

function pathToCoords(graph, nodeIds) {
    return nodeIds.map((id) => {
        const n = graph.nodes.get(id);
        return [n.lon, n.lat]; // GeoJSON order
    });
}

function dedupeCoords(coords) {
    const out = [];
    for (const c of coords) {
        const prev = out[out.length - 1];
        if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) out.push(c);
    }
    return out;
}

function pathLengthM(graph, nodeIds) {
    let sum = 0;
    for (let i = 1; i < nodeIds.length; i++) {
        const a = graph.nodes.get(nodeIds[i - 1]);
        const b = graph.nodes.get(nodeIds[i]);
        if (!a || !b) continue;
        sum += haversineM(a.lat, a.lon, b.lat, b.lon);
    }
    return sum;
}

function detourTooLong(chordM, railM) {
    if (!Number.isFinite(railM) || railM <= 0) return true;
    if (!Number.isFinite(chordM) || chordM <= 0) return railM > HOP_DETOUR_MIN_M;
    return railM > Math.max(chordM * HOP_DETOUR_RATIO, chordM + HOP_DETOUR_MIN_M);
}

/**
 * One continuous LineString through every stop in order.
 * A hop with no usable rail path keeps its straight chord, so the line never
 * teleports and never stops short of the terminus.
 */
function buildRouteLine(graph, stops) {
    const coords = [];
    let snapped = 0;
    let straight = 0;
    const chordHops = [];

    const pushChord = (a, b) => {
        if (!coords.length) coords.push([a.lon, a.lat]);
        coords.push([b.lon, b.lat]);
        straight++;
    };

    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        const snap = snapHopToSharedComponent(graph, a, b);
        const chordM = haversineM(a.lat, a.lon, b.lat, b.lon);

        if (snap) {
            const budgetM = Math.max(chordM * HOP_DETOUR_RATIO, chordM + HOP_DETOUR_MIN_M);
            const nodePath = shortestPath(graph, snap.a.id, snap.b.id, budgetM);
            if (nodePath && nodePath.length >= 2 && !detourTooLong(chordM, pathLengthM(graph, nodePath))) {
                const seg = pathToCoords(graph, nodePath);
                // Bridge the snap gap so the line stays continuous through the stop
                if (!coords.length) coords.push([a.lon, a.lat]);
                coords.push(...seg);
                coords.push([b.lon, b.lat]);
                snapped++;
                continue;
            }
        }
        pushChord(a, b);
        chordHops.push(`${a.name}→${b.name} (${Math.round(chordM)}m)`);
    }

    return {
        coords: dedupeCoords(coords),
        snapped,
        straight,
        chordHops,
        stationCount: stops.length,
    };
}

async function buildRegion(region, stations, paths, regionRoutes, dump) {
    console.log(`\n=== ${region} ===`);
    const routeIds = regionRoutes.byRegion[region] || [];
    if (!routeIds.length) {
        console.warn(`  No routes configured for ${region}, skip`);
        return null;
    }

    const dumpRegion = dump?.[REGION_DUMP_NODE[region]] || null;
    const plans = [];
    for (const routeId of routeIds) {
        const route = regionRoutes.meta[routeId];
        const fromSheet = timetableStations(dumpRegion, route, stations);
        const plan = fromSheet || staticStations(routeId, paths, stations);
        if (!plan) {
            console.warn(`  ${routeId}: no station list (timetable or static), skip`);
            continue;
        }
        // Same stop list the map paints, so the baked line always covers it
        let stops = plan.stops;
        if (region === 'WC') stops = ensureMaitlandMutualAdjacency(stops, stations);
        stops = applyCanonicalStationOrder(routeId, stops, paths);
        if (stops.length < 2) {
            console.warn(`  ${routeId}: fewer than two stops after ordering, skip`);
            continue;
        }
        plans.push({ routeId, sheetKey: plan.sheetKey, stops });
    }
    if (!plans.length) return null;

    const bbox = bboxForStops(region, plans.flatMap((p) => p.stops));
    const osm = await fetchOverpass(bbox);
    const graph = buildRailGraph(osm);
    const features = [];

    for (const plan of plans) {
        const result = buildRouteLine(graph, plan.stops);
        if (result.coords.length < 2) {
            console.warn(`  ${plan.routeId}: no geometry`);
            continue;
        }
        console.log(
            `  ${plan.routeId}: ${result.coords.length} pts, ${plan.stops.length} stops` +
            ` (rail hops ${result.snapped}, chord hops ${result.straight}) via ${plan.sheetKey}`
        );
        for (const hop of result.chordHops) console.log(`      chord: ${hop}`);
        features.push({
            type: 'Feature',
            properties: {
                routeId: plan.routeId,
                source: 'OpenStreetMap',
                license: 'ODbL',
                stations: plan.stops.length,
                stationNames: plan.stops.map((s) => s.name),
                stationCoords: plan.stops.map((s) => [+s.lat.toFixed(6), +s.lon.toFixed(6)]),
                railHops: result.snapped,
                chordHops: result.straight,
                stationSource: plan.sheetKey,
            },
            geometry: {
                type: 'LineString',
                coordinates: result.coords,
            },
        });
    }

    return {
        type: 'FeatureCollection',
        properties: {
            region,
            generatedAt: new Date().toISOString(),
            bbox,
            attribution: '© OpenStreetMap contributors',
            license: 'ODbL',
        },
        features,
    };
}

async function main() {
    const arg = (process.argv[2] || 'all').toUpperCase();
    const regions = arg === 'ALL' ? Object.keys(REGION_BBOX) : [arg];
    for (const r of regions) {
        if (!REGION_BBOX[r]) {
            console.error(`Unknown region: ${r}`);
            process.exit(1);
        }
    }

    const src = fs.readFileSync(MAP_APP, 'utf8');
    const { stations, paths } = parseMapStatic(src);
    const regionRoutes = parseRegionRoutes();
    let dump = null;
    try {
        dump = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
    } catch (err) {
        console.warn(`Timetable dump unavailable (${err.message}); falling back to STATIC_ROUTE_PATHS`);
    }
    console.log(`Parsed ${Object.keys(stations).length} stations, ${Object.keys(paths).length} static paths`);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const region of regions) {
        try {
            const fc = await buildRegion(region, stations, paths, regionRoutes, dump);
            if (!fc?.features?.length) continue;
            const outPath = path.join(OUT_DIR, `rail-tracks-${region}.geojson`);
            fs.writeFileSync(outPath, JSON.stringify(fc));
            const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
            console.log(`  Wrote ${outPath} (${kb} KB, ${fc.features.length} routes)`);
        } catch (err) {
            console.error(`  ${region} FAILED:`, err.message);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
