/**
 * Smooth trip / network paths using cached OSM rail GeoJSON
 * (public/tracks/rail-tracks-{REGION}.geojson from scripts/build-rail-tracks.mjs).
 *
 * © OpenStreetMap contributors (ODbL).
 */
import { withBase } from './config.js';

const SNAP_MAX_M = 900;
const MAX_HOPS = 14000;
/** Ignore bake-time straight-chord teleports when merging route LineStrings into a graph. */
const MAX_EDGE_M = 2500;
const HOP_DETOUR_RATIO = 2.8;
const HOP_DETOUR_MIN_M = 900;
const HOP_STRAY_M = 600;
const SKIP_STATION_M = 90;
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
                    if (w > 0 && w < MAX_EDGE_M) addEdge(prev, id, w);
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

/**
 * Snap a GPS point onto the rail graph. Rejects if farther than maxM.
 * @returns {Promise<{ ok: boolean, lat?: number, lon?: number, distanceM: number|null, trackBearing?: number|null }>}
 */
export async function snapToRail(lat, lon, region = 'GP', maxM = 150) {
    const bundle = await loadRegionBundle(region);
    if (!bundle?.graph || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, distanceM: null };
    }
    const id = nearestNode(bundle.graph, lat, lon, Math.max(maxM, SNAP_MAX_M));
    if (id == null) return { ok: false, distanceM: null };
    const n = bundle.graph.nodes[id];
    const distanceM = haversineM(lat, lon, n.lat, n.lon);
    let trackBearing = null;
    const neighbors = bundle.graph.adj.get(id) || [];
    if (neighbors.length) {
        const nb = bundle.graph.nodes[neighbors[0].to];
        if (nb) {
            trackBearing = (Math.atan2(nb.lon - n.lon, nb.lat - n.lat) * 180) / Math.PI;
        }
    }
    return {
        ok: distanceM <= maxM,
        lat: n.lat,
        lon: n.lon,
        distanceM,
        trackBearing,
    };
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

function pathLengthM(graph, nodePath) {
    if (!graph || !nodePath || nodePath.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < nodePath.length; i++) {
        const a = graph.nodes[nodePath[i - 1]];
        const b = graph.nodes[nodePath[i]];
        if (!a || !b) continue;
        sum += haversineM(a.lat, a.lon, b.lat, b.lon);
    }
    return sum;
}

function hopDetourTooLong(chordM, railM) {
    if (!Number.isFinite(railM) || railM <= 0) return true;
    if (!Number.isFinite(chordM) || chordM <= 0) return railM > HOP_DETOUR_MIN_M;
    return railM > Math.max(chordM * HOP_DETOUR_RATIO, chordM + HOP_DETOUR_MIN_M);
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

function hopStraysFromChord(graph, nodePath, a, b, maxM = HOP_STRAY_M) {
    if (!graph || !nodePath || nodePath.length < 3 || !a || !b) return false;
    for (let k = 1; k < nodePath.length - 1; k++) {
        const n = graph.nodes[nodePath[k]];
        if (!n) continue;
        if (pointToSegmentM(n.lat, n.lon, a.lat, a.lon, b.lat, b.lon) > maxM) return true;
    }
    return false;
}

function hopSkipsRouteStop(graph, nodePath, stops, hopIndex, skipM = SKIP_STATION_M) {
    if (!graph || !nodePath || nodePath.length < 3 || !stops) return false;
    for (let k = 1; k < nodePath.length - 1; k++) {
        const n = graph.nodes[nodePath[k]];
        if (!n) continue;
        for (let j = 0; j < stops.length; j++) {
            if (j === hopIndex || j === hopIndex + 1) continue;
            const s = stops[j];
            if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
            if (haversineM(n.lat, n.lon, s.lat, s.lon) < skipM) return true;
        }
    }
    return false;
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
                const chordM = haversineM(a.lat, a.lon, b.lat, b.lon);
                const railM = pathLengthM(graph, nodePath);
                const skips = hopSkipsRouteStop(graph, nodePath, stops, i);
                const strays = hopStraysFromChord(graph, nodePath, a, b);
                if (!skips && !strays && !hopDetourTooLong(chordM, railM)) {
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
        }

        // Chord fallback for this hop only
        if (!out.length) out.push([a.lat, a.lon]);
        out.push([b.lat, b.lon]);
    }

    if (out.length < 2 || railHops !== stops.length - 1) return null;

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
