/**
 * Smooth trip / network paths using cached OSM rail GeoJSON
 * (public/tracks/rail-tracks-{REGION}.geojson from scripts/build-rail-tracks.mjs).
 *
 * © OpenStreetMap contributors (ODbL).
 */
import { withBase } from './config.js';

const SNAP_MAX_M = 700;
const MAX_HOPS = 12000;
const cache = new Map(); // region -> { features, graph } | null

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

function quantizeKey(lat, lon) {
    // ~15 m grid — merges overlapping route LineStrings into one graph
    return `${Math.round(lat / 0.00015)},${Math.round(lon / 0.00015)}`;
}

function buildGraph(features) {
    const nodes = [];
    const keyToId = new Map();
    const adj = new Map();

    const getOrCreate = (lat, lon) => {
        const k = quantizeKey(lat, lon);
        if (keyToId.has(k)) return keyToId.get(k);
        const id = nodes.length;
        nodes.push({ lat, lon });
        keyToId.set(k, id);
        adj.set(id, []);
        return id;
    };

    const addEdge = (a, b, w) => {
        adj.get(a).push({ to: b, w });
        adj.get(b).push({ to: a, w });
    };

    for (const f of features) {
        const geom = f?.geometry;
        if (!geom) continue;
        const lines =
            geom.type === 'LineString'
                ? [geom.coordinates]
                : geom.type === 'MultiLineString'
                  ? geom.coordinates
                  : [];
        for (const line of lines) {
            let prev = null;
            for (const pair of line) {
                if (!pair || pair.length < 2) continue;
                const [lon, lat] = pair;
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                const id = getOrCreate(lat, lon);
                if (prev != null && prev !== id) {
                    const a = nodes[prev];
                    const b = nodes[id];
                    const w = haversineM(a.lat, a.lon, b.lat, b.lon);
                    if (w > 0) addEdge(prev, id, w);
                }
                prev = id;
            }
        }
    }

    return { nodes, adj };
}

function nearestNode(graph, lat, lon, maxM = SNAP_MAX_M) {
    let best = null;
    let bestD = Infinity;
    for (let id = 0; id < graph.nodes.length; id++) {
        if (!graph.adj.get(id)?.length) continue;
        const n = graph.nodes[id];
        const d = haversineM(lat, lon, n.lat, n.lon);
        if (d < bestD) {
            bestD = d;
            best = id;
        }
    }
    if (best == null || bestD > maxM) return null;
    return best;
}

function shortestPath(graph, startId, endId) {
    if (startId === endId) return [startId];
    const dist = new Map([[startId, 0]]);
    const prev = new Map();
    /** @type {Array<[number, number]>} */
    const pq = [[0, startId]];
    let hops = 0;

    while (pq.length) {
        let minIdx = 0;
        for (let i = 1; i < pq.length; i++) {
            if (pq[i][0] < pq[minIdx][0]) minIdx = i;
        }
        const [d, u] = pq.splice(minIdx, 1)[0];
        if (d !== dist.get(u)) continue;
        if (u === endId) break;
        if (++hops > MAX_HOPS) return null;
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

async function loadRegionBundle(region) {
    const key = String(region || 'GP').toUpperCase();
    if (cache.has(key)) return cache.get(key);

    try {
        const url = withBase(`tracks/rail-tracks-${key}.geojson`);
        const res = await fetch(url, { cache: 'default' });
        if (!res.ok) {
            cache.set(key, null);
            return null;
        }
        const fc = await res.json();
        const features = fc.features || [];
        if (!features.length) {
            cache.set(key, null);
            return null;
        }
        const graph = buildGraph(features);
        const bundle = { features, graph };
        cache.set(key, bundle);
        return bundle;
    } catch {
        cache.set(key, null);
        return null;
    }
}

/**
 * Snap an ordered list of stop coords onto OSM rails → dense [lat, lon][] path.
 * Returns null if tracks unavailable or pathfinding fails completely.
 *
 * @param {Array<{ lat: number, lon: number }>} stops
 * @param {string} [region]
 * @returns {Promise<Array<[number, number]>|null>}
 */
export async function smoothPathFromStops(stops, region = 'GP') {
    if (!Array.isArray(stops) || stops.length < 2) return null;
    const bundle = await loadRegionBundle(region);
    if (!bundle?.graph) return null;

    const { graph } = bundle;
    /** @type {Array<[number, number]>} */
    const out = [];
    let railHops = 0;

    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;

        const snapA = nearestNode(graph, a.lat, a.lon);
        const snapB = nearestNode(graph, b.lat, b.lon);

        if (snapA != null && snapB != null) {
            const nodePath = shortestPath(graph, snapA, snapB);
            if (nodePath && nodePath.length >= 2) {
                const seg = nodePath.map((id) => {
                    const n = graph.nodes[id];
                    return /** @type {[number, number]} */ ([n.lat, n.lon]);
                });
                if (!out.length) out.push(...seg);
                else out.push(...seg.slice(1));
                railHops++;
                continue;
            }
        }

        // Chord fallback for this hop only
        if (!out.length) out.push([a.lat, a.lon]);
        out.push([b.lat, b.lon]);
    }

    if (out.length < 2 || railHops === 0) return null;

    // Deduplicate consecutive duplicates
    const deduped = [out[0]];
    for (let i = 1; i < out.length; i++) {
        const p = out[i];
        const prev = deduped[deduped.length - 1];
        if (p[0] !== prev[0] || p[1] !== prev[1]) deduped.push(p);
    }
    return deduped.length > 1 ? deduped : null;
}

/** Nearest index on a [lat,lon][] path (for disruption overlays). */
export function nearestPathIndex(path, lat, lon) {
    if (!path?.length) return -1;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < path.length; i++) {
        const dLat = path[i][0] - lat;
        const dLon = path[i][1] - lon;
        const d = dLat * dLat + dLon * dLon;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}
