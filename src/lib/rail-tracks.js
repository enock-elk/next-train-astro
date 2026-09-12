/**
 * Smooth trip / network paths using cached OSM rail GeoJSON
 * (public/tracks/rail-tracks-{REGION}.geojson from scripts/build-rail-tracks.mjs).
 *
 * © OpenStreetMap contributors (ODbL).
 */
import { withBase } from './config.js';

const SNAP_MAX_M = 900;
const MAX_HOPS = 80000;
/** Station coords may sit off the rail; still slice the bake within this. */
const BAKED_COVER_M = 900;
/** Draw a short stub from an off-track station onto the rail. */
const STUB_MIN_M = 20;
/**
 * Longest edge accepted from a baked line. The bake keeps a straight chord
 * where OSM has no rail (~3.2 km at most), so those edges must stay in the
 * graph; anything wilder is a teleport from a stale file.
 */
const MAX_EDGE_M = 6000;
/** A tracker fix is never accepted farther than this from trusted rail. */
export const TRACKER_SNAP_MAX_M = 100;
const TRUST_EDGE_FLOOR_M = 250;
const TRUST_EDGE_CAP_M = 700;
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

function featureLines(feature) {
    const geom = feature?.geometry;
    if (geom?.type === 'LineString') return [geom.coordinates];
    if (geom?.type === 'MultiLineString') return geom.coordinates;
    return [];
}

function edgeLengths(feature) {
    const lengths = [];
    for (const line of featureLines(feature)) {
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1];
            const b = line[i];
            if (!a || !b) continue;
            const metres = haversineM(a[1], a[0], b[1], b[0]);
            if (Number.isFinite(metres) && metres > 0) lengths.push(metres);
        }
    }
    return lengths.sort((a, b) => a - b);
}

/**
 * Chord-free bakes are wholly sourced from OSM. For mixed bakes, derive a
 * conservative route-specific cutoff from normal OSM edge density. This
 * excludes the long station-to-station fallback chords without guessing
 * which hop indices produced them.
 */
export function trustedEdgeThresholdM(feature) {
    if (!(Number(feature?.properties?.chordHops) > 0)) return MAX_EDGE_M;
    const lengths = edgeLengths(feature);
    if (!lengths.length) return 0;
    const p95 = lengths[Math.floor((lengths.length - 1) * 0.95)];
    return Math.min(TRUST_EDGE_CAP_M, Math.max(TRUST_EDGE_FLOOR_M, p95 * 3));
}

function projectToSegment(lat, lon, a, b) {
    const lat0 = ((a[1] + b[1]) / 2) * Math.PI / 180;
    const xScale = 6371000 * Math.cos(lat0);
    const yScale = 6371000;
    const ax = a[0] * Math.PI / 180 * xScale;
    const ay = a[1] * Math.PI / 180 * yScale;
    const bx = b[0] * Math.PI / 180 * xScale;
    const by = b[1] * Math.PI / 180 * yScale;
    const px = lon * Math.PI / 180 * xScale;
    const py = lat * Math.PI / 180 * yScale;
    const dx = bx - ax;
    const dy = by - ay;
    const den = dx * dx + dy * dy;
    const t = den > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / den)) : 0;
    return {
        t,
        lat: a[1] + (b[1] - a[1]) * t,
        lon: a[0] + (b[0] - a[0]) * t,
        distanceM: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)),
    };
}

export function projectToTrustedFeature(feature, lat, lon) {
    const thresholdM = trustedEdgeThresholdM(feature);
    let best = null;
    let routeM = 0;
    let totalM = 0;
    for (const line of featureLines(feature)) {
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1];
            const b = line[i];
            const edgeM = haversineM(a[1], a[0], b[1], b[0]);
            if (!Number.isFinite(edgeM) || edgeM <= 0) continue;
            if (edgeM <= thresholdM) {
                const projected = projectToSegment(lat, lon, a, b);
                if (!best || projected.distanceM < best.distanceM) {
                    best = { ...projected, routeM: totalM + edgeM * projected.t };
                }
            }
            totalM += edgeM;
        }
    }
    if (best) routeM = best.routeM;
    return best ? { ...best, routeM, totalM, thresholdM } : null;
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
export async function snapToRail(lat, lon, region = 'GP', maxM = TRACKER_SNAP_MAX_M, routeId = '') {
    const bundle = await loadRegionBundle(region);
    if (!bundle?.graph) {
        return { ok: false, geometryUnavailable: true, distanceM: null };
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { ok: false, geometryUnavailable: false, distanceM: null };
    }
    if (routeId) {
        const feature = bundle.byId?.get(routeId);
        if (!feature) return { ok: false, geometryUnavailable: true, distanceM: null };
        const projected = projectToTrustedFeature(feature, lat, lon);
        if (!projected) return { ok: false, geometryUnavailable: true, distanceM: null };
        const limitM = Math.min(TRACKER_SNAP_MAX_M, Math.max(0, Number(maxM) || 0));
        return {
            ok: projected.distanceM <= limitM,
            geometryUnavailable: false,
            lat: projected.lat,
            lon: projected.lon,
            distanceM: projected.distanceM,
            routeM: projected.routeM,
            routeFraction: projected.totalM > 0 ? projected.routeM / projected.totalM : 0,
            trustedEdgeThresholdM: projected.thresholdM,
        };
    }
    const id = nearestNode(bundle.graph, lat, lon, Math.max(maxM, SNAP_MAX_M));
    if (id == null) return { ok: false, geometryUnavailable: false, distanceM: null };
    const n = bundle.graph.nodes[id];
    const distanceM = haversineM(lat, lon, n.lat, n.lon);
    return {
        ok: distanceM <= maxM,
        geometryUnavailable: false,
        lat: n.lat,
        lon: n.lon,
        distanceM,
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
        const byId = new Map();
        for (const f of features) {
            const id = f?.properties?.routeId;
            if (id) byId.set(id, f);
        }
        const bundle = { features, graph, byId };
        cache.set(key, bundle);
        return bundle;
    } catch {
        cache.set(key, null);
        return null;
    }
}

function featureLatLngs(feature) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return coords
        .map((pair) => (pair && pair.length >= 2 ? [pair[1], pair[0]] : null))
        .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function nearestPathIndexM(path, lat, lon, maxM = BAKED_COVER_M) {
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

/** Slice a baked corridor between two stops. Stations may sit off the rail. */
function sliceBakedHop(feature, a, b) {
    const latlngs = featureLatLngs(feature);
    if (!latlngs || latlngs.length < 2 || !a || !b) return null;
    const i1 = nearestPathIndexM(latlngs, a.lat, a.lon);
    const i2 = nearestPathIndexM(latlngs, b.lat, b.lon);
    if (i1 < 0 || i2 < 0) return null;
    if (i1 === i2) return null;
    const seg = i1 < i2 ? latlngs.slice(i1, i2 + 1) : latlngs.slice(i2, i1 + 1).reverse();
    return seg.length > 1 ? seg : null;
}

function appendPoint(out, lat, lon) {
    const last = out[out.length - 1];
    if (last && last[0] === lat && last[1] === lon) return;
    out.push([lat, lon]);
}

function appendSeg(out, seg, fromStop, toStop) {
    if (!seg || seg.length < 2) return;
    if (fromStop && haversineM(fromStop.lat, fromStop.lon, seg[0][0], seg[0][1]) >= STUB_MIN_M) {
        appendPoint(out, fromStop.lat, fromStop.lon);
    }
    if (!out.length) out.push(...seg);
    else out.push(...seg.slice(1));
    const end = seg[seg.length - 1];
    if (toStop && haversineM(toStop.lat, toStop.lon, end[0], end[1]) >= STUB_MIN_M) {
        appendPoint(out, toStop.lat, toStop.lon);
    }
}

function graphHop(graph, a, b, stops, hopIndex) {
    const snapA = nearestNode(graph, a.lat, a.lon);
    const snapB = nearestNode(graph, b.lat, b.lon);
    if (snapA == null || snapB == null) return null;
    const nodePath = shortestPath(graph, snapA, snapB);
    if (!nodePath || nodePath.length < 2) return null;
    const chordM = haversineM(a.lat, a.lon, b.lat, b.lon);
    const railM = pathLengthM(graph, nodePath);
    if (hopSkipsRouteStop(graph, nodePath, stops, hopIndex)) return null;
    if (hopStraysFromChord(graph, nodePath, a, b)) return null;
    if (hopDetourTooLong(chordM, railM)) return null;
    return nodePath.map((id) => {
        const n = graph.nodes[id];
        return /** @type {[number, number]} */ ([n.lat, n.lon]);
    });
}

/**
 * Snap an ordered list of stop coords onto OSM rails → dense [lat, lon][] path.
 * Uses the baked corridor for each hop when routeId is known. Off-track
 * stations get a short stub onto the rail; a hop that cannot snap stays a
 * chord so the rest of the journey can still follow the tracks.
 *
 * @param {Array<{ lat: number, lon: number, routeId?: string }>} stops
 * @param {string} [region]
 * @returns {Promise<Array<[number, number]>|null>}
 */
export async function smoothPathFromStops(stops, region = 'GP') {
    if (!Array.isArray(stops) || stops.length < 2) return null;
    const bundle = await loadRegionBundle(region);
    if (!bundle?.graph) return null;

    const { graph, byId } = bundle;
    /** @type {Array<[number, number]>} */
    const out = [];
    let railHops = 0;

    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) continue;

        const routeId = a.routeId || b.routeId;
        const baked = routeId && byId ? byId.get(routeId) : null;
        const bakedSeg = baked ? sliceBakedHop(baked, a, b) : null;
        if (bakedSeg) {
            appendSeg(out, bakedSeg, a, b);
            railHops++;
            continue;
        }

        const graphSeg = graphHop(graph, a, b, stops, i);
        if (graphSeg) {
            appendSeg(out, graphSeg, a, b);
            railHops++;
            continue;
        }

        appendPoint(out, a.lat, a.lon);
        appendPoint(out, b.lat, b.lon);
    }

    if (out.length < 2) return null;

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

/**
 * Exact nearest point on a dense [lat, lon][] rail path.
 * Returns distance to the path itself, not to a timetable ghost or vertex.
 */
export function closestPointOnPath(path, lat, lon) {
    if (!Array.isArray(path) || path.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    let best = null;
    let travelledM = 0;
    for (let i = 1; i < path.length; i += 1) {
        const a = path[i - 1];
        const b = path[i];
        if (!a || !b || !Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) continue;
        const lat0 = ((a[0] + b[0]) / 2) * Math.PI / 180;
        const scaleX = Math.PI / 180 * 6371000 * Math.cos(lat0);
        const scaleY = Math.PI / 180 * 6371000;
        const px = lat * scaleY;
        const py = lon * scaleX;
        const ax = a[0] * scaleY;
        const ay = a[1] * scaleX;
        const bx = b[0] * scaleY;
        const by = b[1] * scaleX;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const fraction = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const projectedLat = a[0] + (b[0] - a[0]) * fraction;
        const projectedLon = a[1] + (b[1] - a[1]) * fraction;
        const distanceM = haversineM(lat, lon, projectedLat, projectedLon);
        const segmentM = haversineM(a[0], a[1], b[0], b[1]);
        if (!best || distanceM < best.distanceM) {
            best = {
                lat: projectedLat,
                lon: projectedLon,
                distanceM,
                segmentIndex: i - 1,
                fraction,
                routeM: travelledM + segmentM * fraction,
            };
        }
        travelledM += segmentM;
    }
    if (best) {
        best.totalM = travelledM;
        best.pathFraction = travelledM > 0 ? best.routeM / travelledM : 0;
    }
    return best;
}
