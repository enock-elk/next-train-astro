/**
 * Build per-region rail track GeoJSON for the network map.
 *
 * Pulls OSM railway ways via Overpass, snaps Next Train station sequences onto
 * the rail graph, and writes public/tracks/rail-tracks-{REGION}.geojson.
 * (Kept outside public/data/ so production sync can ship tracks without
 * touching the protected schedule CDN folder on metrorail-app.)
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
const OUT_DIR = path.join(ROOT, 'public', 'tracks');

const OVERPASS_URLS = [
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
];

/** south, west, north, east */
const REGION_BBOX = {
    GP: [-26.45, 27.62, -25.45, 28.52],
    WC: [-34.30, 18.28, -33.55, 19.05],
    KZN: [-30.10, 30.65, -29.50, 31.20],
    EC: [-33.12, 27.55, -32.82, 28.00],
};

const REGION_ROUTES = {
    GP: [
        'pta-pien', 'pta-mabopane', 'mab-belle', 'pta-dewildt', 'herc-koed',
        'pta-saul', 'pta-kempton', 'germ-leralla', 'germ-kwesine', 'jhb-germiston',
        'jhb-rand', 'jhb-soweto', 'jhb-midway', 'pta-irene',
    ],
    WC: [
        'ct-chrishani', 'ct-kapteinsklip', 'bellville-mutual', 'ct-malm',
        'ct-flats', 'ct-nolu', 'ct-simon', 'ct-bellv', 'ct-kraai', 'ct-eerst',
        'ct-strnd', 'ct-well',
    ],
    KZN: [
        'kzn-umlazi', 'kzn-bridgecity', 'kzn-winklespruit', 'kzn-catoridge', 'kzn-pinetown',
    ],
    EC: ['ec-berlin'],
};

const SNAP_MAX_M = 650;
const MAX_SEGMENT_HOPS = 8000;

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
        if (el.tags?.service === 'yard' || el.tags?.service === 'spur') continue;
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
    console.log(`  Graph: ${nodes.size} nodes, ${wayCount} ways, ${adj.size} connected`);
    return { nodes, adj };
}

function nearestNode(graph, lat, lon, maxM = SNAP_MAX_M) {
    let best = null;
    let bestD = Infinity;
    for (const [id, n] of graph.nodes) {
        if (!graph.adj.has(id)) continue;
        const d = haversineM(lat, lon, n.lat, n.lon);
        if (d < bestD) {
            bestD = d;
            best = id;
        }
    }
    if (best == null || bestD > maxM) return null;
    return { id: best, dist: bestD };
}

/** Dijkstra — returns node id path or null */
function shortestPath(graph, startId, endId) {
    if (startId === endId) return [startId];
    const dist = new Map([[startId, 0]]);
    const prev = new Map();
    const pq = [[0, startId]]; // [dist, id] — simple binary heap substitute via sort pops
    let hops = 0;

    while (pq.length) {
        pq.sort((a, b) => a[0] - b[0]);
        const [d, u] = pq.shift();
        if (d !== dist.get(u)) continue;
        if (u === endId) break;
        if (++hops > MAX_SEGMENT_HOPS) return null;
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

function buildRouteLine(graph, stations, stationNames) {
    const coords = [];
    let snapped = 0;
    let straight = 0;

    for (let i = 0; i < stationNames.length - 1; i++) {
        const aName = stationNames[i];
        const bName = stationNames[i + 1];
        const a = stations[aName];
        const b = stations[bName];
        if (!a || !b) continue;

        const snapA = nearestNode(graph, a[0], a[1]);
        const snapB = nearestNode(graph, b[0], b[1]);

        if (snapA && snapB) {
            const nodePath = shortestPath(graph, snapA.id, snapB.id);
            if (nodePath && nodePath.length >= 2) {
                const seg = pathToCoords(graph, nodePath);
                if (!coords.length) coords.push(...seg);
                else coords.push(...seg.slice(1));
                snapped++;
                continue;
            }
        }
        // Fallback: straight chord for this hop only
        if (!coords.length) coords.push([a[1], a[0]]);
        coords.push([b[1], b[0]]);
        straight++;
    }

    return {
        coords: dedupeCoords(coords),
        snapped,
        straight,
        stationCount: stationNames.length,
    };
}

async function buildRegion(region, stations, paths) {
    console.log(`\n=== ${region} ===`);
    const bbox = REGION_BBOX[region];
    const routeIds = (REGION_ROUTES[region] || []).filter((id) => paths[id]);
    if (!routeIds.length) {
        console.warn(`  No static paths for ${region}, skip`);
        return null;
    }

    const osm = await fetchOverpass(bbox);
    const graph = buildRailGraph(osm);
    const features = [];

    for (const routeId of routeIds) {
        const names = paths[routeId];
        const result = buildRouteLine(graph, stations, names);
        if (result.coords.length < 2) {
            console.warn(`  ${routeId}: no geometry`);
            continue;
        }
        console.log(
            `  ${routeId}: ${result.coords.length} pts (rail hops ${result.snapped}, straight ${result.straight})`
        );
        features.push({
            type: 'Feature',
            properties: {
                routeId,
                source: 'OpenStreetMap',
                license: 'ODbL',
                stations: names.length,
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
    console.log(`Parsed ${Object.keys(stations).length} stations, ${Object.keys(paths).length} static paths`);

    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const region of regions) {
        try {
            const fc = await buildRegion(region, stations, paths);
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
