/**
 * Smooth trip / network paths using cached OSM rail GeoJSON
 * (public/tracks/rail-tracks-{REGION}.geojson from scripts/build-rail-tracks.mjs).
 *
 * © OpenStreetMap contributors (ODbL).
 */
import { withBase } from './config.js';

const SNAP_MAX_M = 900;
const MAX_HOPS = 14000;
/**
 * Longest edge accepted from a baked line. The bake keeps a straight chord
 * where OSM has no rail (~3.2 km at most), so those edges must stay in the
 * graph; anything wilder is a teleport from a stale file.
 */
const MAX_EDGE_M = 6000;
const HOP_DETOUR_RATIO = 2.8;
const HOP_DETOUR_MIN_M = 900;
const HOP_STRAY_M = 600;
const SKIP_STATION_M = 90;
/** Reject a hop that walks forward then back along the station chord (A>C>B). */
const HOP_BACKTRACK_M = 80;
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

function chordProgressM(pLat, pLon, aLat, aLon, bLat, bLon) {
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
    const len = Math.hypot(abx, aby);
    if (len < 1) return 0;
    return ((pX - aX) * abx + (pY - aY) * aby) / len;
}

/** True when a hop walks forward then doubles back (A > C > B). */
export function hopBacktracksAlongChord(points, a, b, slackM = HOP_BACKTRACK_M) {
    if (!points || points.length < 3 || !a || !b) return false;
    let prev = -Infinity;
    for (const p of points) {
        const lat = Array.isArray(p) ? p[0] : p.lat;
        const lon = Array.isArray(p) ? p[1] : p.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const prog = chordProgressM(lat, lon, a.lat, a.lon, b.lat, b.lon);
        if (prev !== -Infinity && prog < prev - slackM) return true;
        if (prog > prev) prev = prog;
    }
    return false;
}

function featureLines(feature) {
    const geom = feature?.geometry;
    if (!geom) return [];
    const toLatLngs = (line) => (line || [])
        .filter((pair) => pair && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
        .map(([lon, lat]) => /** @type {[number, number]} */ ([lat, lon]));
    if (geom.type === 'LineString') return [toLatLngs(geom.coordinates)];
    if (geom.type === 'MultiLineString') return (geom.coordinates || []).map(toLatLngs);
    return [];
}

function latlngsLengthM(latlngs) {
    if (!latlngs || latlngs.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < latlngs.length; i++) {
        sum += haversineM(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1]);
    }
    return sum;
}

function nearestPathIndexM(path, lat, lon, maxM = SNAP_MAX_M) {
    if (!path?.length) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < path.length; i++) {
        const d = haversineM(path[i][0], path[i][1], lat, lon);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return bestD <= maxM ? best : -1;
}

function hopSkipsRouteStopOnLatLngs(latlngs, stops, hopIndex, skipM = SKIP_STATION_M) {
    if (!latlngs || latlngs.length < 3 || !stops) return false;
    for (let k = 1; k < latlngs.length - 1; k++) {
        const n = latlngs[k];
        for (let j = 0; j < stops.length; j++) {
            if (j === hopIndex || j === hopIndex + 1) continue;
            const s = stops[j];
            if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
            if (haversineM(n[0], n[1], s.lat, s.lon) < skipM) return true;
        }
    }
    return false;
}

function hopStraysFromLatLngs(latlngs, a, b, maxM = HOP_STRAY_M) {
    if (!latlngs || latlngs.length < 3 || !a || !b) return false;
    for (let k = 1; k < latlngs.length - 1; k++) {
        const n = latlngs[k];
        if (pointToSegmentM(n[0], n[1], a.lat, a.lon, b.lat, b.lon) > maxM) return true;
    }
    return false;
}

function slicePathBetween(latlngs, a, b) {
    if (!latlngs || latlngs.length < 2 || !a || !b) return null;
    const i1 = nearestPathIndexM(latlngs, a.lat, a.lon);
    const i2 = nearestPathIndexM(latlngs, b.lat, b.lon);
    if (i1 < 0 || i2 < 0) return null;
    if (i1 === i2) return [[a.lat, a.lon], [b.lat, b.lon]];
    const seg = i1 < i2 ? latlngs.slice(i1, i2 + 1) : latlngs.slice(i2, i1 + 1).reverse();
    return seg.length > 1 ? seg : null;
}

function hopSegmentAllowed(seg, a, b, stops, hopIndex) {
    if (!seg || seg.length < 2) return false;
    const chordM = haversineM(a.lat, a.lon, b.lat, b.lon);
    const railM = latlngsLengthM(seg);
    if (hopDetourTooLong(chordM, railM)) return false;
    if (hopStraysFromLatLngs(seg, a, b)) return false;
    if (hopSkipsRouteStopOnLatLngs(seg, stops, hopIndex)) return false;
    if (hopBacktracksAlongChord(seg, a, b)) return false;
    return true;
}

function appendHop(out, seg) {
    if (!seg || seg.length < 2) return;
    if (!out.length) out.push(...seg);
    else out.push(...seg.slice(1));
}

function dedupeLatLngs(out) {
    if (!out.length) return out;
    const deduped = [out[0]];
    for (let i = 1; i < out.length; i++) {
        const p = out[i];
        const prev = deduped[deduped.length - 1];
        if (p[0] !== prev[0] || p[1] !== prev[1]) deduped.push(p);
    }
    return deduped;
}

function bakedHopSegment(features, a, b, stops, hopIndex, preferredIds) {
    if (!features?.length) return null;
    const preferred = [];
    const rest = [];
    for (const f of features) {
        (preferredIds?.has(f?.properties?.routeId) ? preferred : rest).push(f);
    }
    for (const f of preferred.concat(rest)) {
        for (const line of featureLines(f)) {
            const seg = slicePathBetween(line, a, b);
            if (hopSegmentAllowed(seg, a, b, stops, hopIndex)) return seg;
        }
    }
    return null;
}

function graphHopSegment(graph, a, b, stops, hopIndex) {
    if (!graph) return null;
    const snapA = nearestNode(graph, a.lat, a.lon);
    const snapB = nearestNode(graph, b.lat, b.lon);
    if (snapA == null || snapB == null) return null;
    const nodePath = shortestPath(graph, snapA, snapB);
    if (!nodePath || nodePath.length < 2) return null;
    const seg = nodePath.map((id) => {
        const n = graph.nodes[id];
        return /** @type {[number, number]} */ ([n.lat, n.lon]);
    });
    if (!hopSegmentAllowed(seg, a, b, stops, hopIndex)) return null;
    if (hopSkipsRouteStop(graph, nodePath, stops, hopIndex)) return null;
    if (hopStraysFromChord(graph, nodePath, a, b)) return null;
    return seg;
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
 * Snap an ordered list of stop coords onto baked OSM rails, then the rail
 * graph. Each hop falls back to a straight station chord when no smooth path
 * exists. Never connects stations out of list order (A>C>B>D).
 *
 * @param {Array<{ lat: number, lon: number }>} stops
 * @param {string} [region]
 * @param {{ routeIds?: string[] }} [opts]
 * @returns {Promise<Array<[number, number]>|null>}
 */
export async function smoothPathFromStops(stops, region = 'GP', opts = {}) {
    if (!Array.isArray(stops) || stops.length < 2) return null;
    const bundle = await loadRegionBundle(region);
    if (!bundle) return null;

    const preferredIds = new Set((opts.routeIds || []).filter(Boolean));
    /** @type {Array<[number, number]>} */
    const out = [];

    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;

        const baked = bakedHopSegment(bundle.features, a, b, stops, i, preferredIds);
        if (baked) {
            appendHop(out, baked);
            continue;
        }
        const rail = graphHopSegment(bundle.graph, a, b, stops, i);
        if (rail) {
            appendHop(out, rail);
            continue;
        }
        appendHop(out, [[a.lat, a.lon], [b.lat, b.lon]]);
    }

    const deduped = dedupeLatLngs(out);
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
