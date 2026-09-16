/**
 * Corridor-aware OSM drape for baked gold tracks.
 *
 * Leaflet/OSM often has a short void (a bridge, a highway overpass, a yard
 * throat) while a parallel railway (Gautrain, a siding) sits a few metres off
 * the corridor. Snapping every sample to the nearest rail walks onto that
 * parallel line. When the graph is disconnected the bake instead drops a
 * kilometre-long chord.
 *
 * This drape:
 *  1. Walks OSM rail that stays inside a tube around the station-to-station
 *     chord, skipping Gautrain and yards.
 *  2. When no rail is in the tube, keeps the interpolated chord sample — a
 *     short, along-corridor jump across the map gap.
 *  3. Never joins two components with a sideways hop onto a parallel track.
 */
import { haversineM } from './rail-line-smooth.mjs';

export const MIN_CHORD_M = 200;
/** Philippi–Nyanga is ~3.2 km; De Wildt (~4.8 km) stays an honest chord. */
export const MAX_CHORD_M = 4000;
export const TUBE_M = 70;
export const MAX_LENGTH_RATIO = 1.5;
export const STRAY_PERP_M = 75;
export const STRAY_STEP_M = 250;
export const STRAY_MAX_CHORD_M = 2200;
export const MIN_GAP_STEP_M = 350;
export const MAX_GAP_STEP_M = 900;

export function lineLengthM(coords, from = 0, to = coords.length - 1) {
    let m = 0;
    for (let i = from + 1; i <= to; i++) {
        m += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    }
    return m;
}

export function nearestVert(coords, lat, lon) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
        const d = haversineM(lat, lon, coords[i][1], coords[i][0]);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return { i: best, d: bestD };
}

export function perpSignedM(lat, lon, a, b) {
    const lat0 = ((a.lat + b.lat) / 2) * Math.PI / 180;
    const toXY = (la, lo) => [
        lo * Math.PI / 180 * 6371000 * Math.cos(lat0),
        la * Math.PI / 180 * 6371000,
    ];
    const [pX, pY] = toXY(lat, lon);
    const [aX, aY] = toXY(a.lat, a.lon);
    const [bX, bY] = toXY(b.lat, b.lon);
    const abx = bX - aX;
    const aby = bY - aY;
    const len = Math.hypot(abx, aby);
    if (len < 1) return 0;
    return ((pX - aX) * -aby + (pY - aY) * abx) / len;
}

export function perpAbsM(lat, lon, a, b) {
    return Math.abs(perpSignedM(lat, lon, a, b));
}

export function pointToSeg(pLat, pLon, a, b) {
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

function hopBearingDot(from, to, hop) {
    const lat0 = ((hop.a.lat + hop.b.lat) / 2) * Math.PI / 180;
    const toXY = (la, lo) => [
        lo * Math.PI / 180 * 6371000 * Math.cos(lat0),
        la * Math.PI / 180 * 6371000,
    ];
    const [ax, ay] = toXY(from.lat, from.lon);
    const [bx, by] = toXY(to.lat, to.lon);
    const [hx, hy] = toXY(hop.b.lat, hop.b.lon);
    const [h0x, h0y] = toXY(hop.a.lat, hop.a.lon);
    const vx = bx - ax;
    const vy = by - ay;
    const wx = hx - h0x;
    const wy = hy - h0y;
    const vLen = Math.hypot(vx, vy);
    const wLen = Math.hypot(wx, wy);
    if (vLen < 1 || wLen < 1) return 1;
    return (vx * wx + vy * wy) / (vLen * wLen);
}

export function parseRailNetwork(xml, opts = {}) {
    const includeAbandoned = opts.includeAbandoned === true;
    const includeYard = opts.includeYard === true;
    const nodes = new Map();
    for (const m of xml.matchAll(/<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g)) {
        nodes.set(m[1], { id: m[1], lat: Number(m[2]), lon: Number(m[3]) });
    }
    const adj = new Map();
    const segs = [];
    const addEdge = (a, b, w) => {
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push({ to: b, w });
    };
    const allowed = new Set(['rail', 'light_rail', 'subway']);
    if (includeAbandoned) {
        allowed.add('abandoned');
        allowed.add('disused');
    }
    const wayRe = /<way id="(\d+)"[\s\S]*?<\/way>/g;
    let wm;
    while ((wm = wayRe.exec(xml))) {
        const block = wm[0];
        const rw = block.match(/k="railway" v="([^"]+)"/);
        if (!rw || !allowed.has(rw[1])) continue;
        if (!includeAbandoned && /k="abandoned"|k="disused" v="yes"/.test(block)) continue;
        const name = (block.match(/k="name" v="([^"]+)"/) || [])[1] || '';
        const operator = (block.match(/k="operator" v="([^"]+)"/) || [])[1] || '';
        const service = (block.match(/k="service" v="([^"]+)"/) || [])[1] || '';
        const gautrain = /gautrain/i.test(`${name} ${operator}`);
        const yard = /^(yard|siding|spur|crossover)$/i.test(service);
        const nds = [...block.matchAll(/<nd ref="(\d+)"/g)]
            .map((x) => x[1])
            .filter((id) => nodes.has(id));
        for (let i = 1; i < nds.length; i++) {
            const A = nodes.get(nds[i - 1]);
            const B = nodes.get(nds[i]);
            if (!A || !B) continue;
            segs.push({ A, B, gautrain, yard });
            if (gautrain) continue;
            if (yard && !includeYard && !includeAbandoned) continue;
            const w = haversineM(A.lat, A.lon, B.lat, B.lon);
            addEdge(A.id, B.id, w);
            addEdge(B.id, A.id, w);
        }
    }
    return { nodes, adj, segs };
}

export function corridorSegs(network) {
    return (network.segs || []).filter((s) => !s.gautrain && !s.yard);
}

function nearestGraphNode(network, lat, lon, maxM) {
    let best = null;
    let bestD = Infinity;
    for (const id of network.adj.keys()) {
        const n = network.nodes.get(id);
        if (!n) continue;
        const d = haversineM(lat, lon, n.lat, n.lon);
        if (d < bestD) {
            bestD = d;
            best = n;
        }
    }
    return best && bestD <= maxM ? { node: best, d: bestD } : null;
}

function dijkstra(network, startId, endId, budgetM) {
    const dist = new Map([[startId, 0]]);
    const prev = new Map();
    const heap = [[0, startId]];
    const push = (d, id) => {
        heap.push([d, id]);
        for (let i = heap.length - 1; i > 0;) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            const tmp = heap[p];
            heap[p] = heap[i];
            heap[i] = tmp;
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (!heap.length) return top;
        heap[0] = last;
        let i = 0;
        for (;;) {
            const l = i * 2 + 1;
            const r = l + 1;
            let s = i;
            if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
            if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
            if (s === i) break;
            const tmp = heap[i];
            heap[i] = heap[s];
            heap[s] = tmp;
            i = s;
        }
        return top;
    };
    while (heap.length) {
        const [d, u] = pop();
        if (d !== dist.get(u)) continue;
        if (u === endId) break;
        if (d > budgetM) continue;
        for (const { to, w } of network.adj.get(u) || []) {
            const nd = d + w;
            if (nd < (dist.get(to) ?? Infinity)) {
                dist.set(to, nd);
                prev.set(to, u);
                push(nd, to);
            }
        }
    }
    if (!prev.has(endId) && startId !== endId) return null;
    const ids = [endId];
    for (let cur = endId; cur !== startId;) {
        cur = prev.get(cur);
        if (cur == null) return null;
        ids.push(cur);
    }
    ids.reverse();
    return { ids, m: dist.get(endId) || 0 };
}

function coordsFromIds(network, ids) {
    return ids.map((id) => {
        const n = network.nodes.get(id);
        return [n.lon, n.lat];
    });
}

function pathMaxPerp(coords, hop) {
    let worst = 0;
    for (const [lon, lat] of coords) {
        const p = perpAbsM(lat, lon, hop.a, hop.b);
        if (p > worst) worst = p;
    }
    return worst;
}

function pathMaxStep(coords) {
    let worst = 0;
    for (let i = 1; i < coords.length; i++) {
        const d = haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
        if (d > worst) worst = d;
    }
    return worst;
}

function snapInTube(lat, lon, segs, hop, tubeM) {
    let best = null;
    for (const seg of segs) {
        const hit = pointToSeg(lat, lon, seg.A, seg.B);
        if (hit.d > tubeM) continue;
        if (perpAbsM(hit.lat, hit.lon, hop.a, hop.b) > tubeM) continue;
        if (!best || hit.d < best.d) best = hit;
    }
    return best;
}

function sampleCount(chordM) {
    return Math.min(80, Math.max(24, Math.round(chordM / 40)));
}

/**
 * Follow rail inside the corridor tube; keep the chord sample across OSM voids.
 * That is the "comfortable jump" over a missing bridge or overpass.
 */
export function sampleKeepGaps(hop, segs) {
    const n = sampleCount(hop.chordM);
    const draped = [];
    let railHits = 0;
    let gapHits = 0;
    let prev = null;
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const lat = hop.a.lat + t * (hop.b.lat - hop.a.lat);
        const lon = hop.a.lon + t * (hop.b.lon - hop.a.lon);
        const hit = snapInTube(lat, lon, segs, hop, TUBE_M);
        let ptLat = lat;
        let ptLon = lon;
        if (hit) {
            const candidate = { lat: hit.lat, lon: hit.lon };
            if (prev && hopBearingDot(prev, candidate, hop) < 0.15) {
                // Sideways onto a parallel railway (Gautrain at Walker).
                ptLat = lat;
                ptLon = lon;
                gapHits++;
            } else {
                ptLat = hit.lat;
                ptLon = hit.lon;
                railHits++;
            }
        } else {
            gapHits++;
        }
        if (prev && haversineM(prev.lat, prev.lon, ptLat, ptLon) < 8) continue;
        draped.push([ptLon, ptLat]);
        prev = { lat: ptLat, lon: ptLon };
    }
    if (draped.length < 3) return { ok: false, reason: 'too few verts' };
    const len = lineLengthM(draped);
    if (len > hop.chordM * MAX_LENGTH_RATIO) {
        return { ok: false, reason: `drape ${Math.round(len)}m vs chord ${Math.round(hop.chordM)}m` };
    }
    return {
        ok: true,
        coords: draped,
        len: Math.round(len),
        worst: Math.round(pathMaxPerp(draped, hop)),
        railHits,
        gapHits,
        method: `tube+gap (${railHits} rail, ${gapHits} jumps)`,
    };
}

export function drapeHop(hop, network) {
    const segs = corridorSegs(network);
    const sa = nearestGraphNode(network, hop.a.lat, hop.a.lon, 120);
    const sb = nearestGraphNode(network, hop.b.lat, hop.b.lon, 120);
    let graph = null;
    if (sa && sb) {
        const budget = Math.max(hop.chordM * 2.8, hop.chordM + 900);
        const path = dijkstra(network, sa.node.id, sb.node.id, budget);
        if (path && path.ids.length >= 2) {
            const coords = coordsFromIds(network, path.ids);
            const perp = pathMaxPerp(coords, hop);
            const step = pathMaxStep(coords);
            const len = path.m;
            // Walker without Gautrain is disconnected. Hercules is a yard-throat
            // gap whose connected path has to leave the chord (north, then east).
            // A high-perp connected path on a station hop is the parallel railway
            // (Woodstock mainline vs the Esplanade / Northern Line tracks).
            if (
                coords.length >= 3
                && len <= hop.chordM * MAX_LENGTH_RATIO
                && step <= 200
            ) {
                graph = {
                    ok: true,
                    coords,
                    len: Math.round(len),
                    worst: Math.round(perp),
                    railHits: coords.length,
                    gapHits: 0,
                    method: 'rail graph',
                };
            }
        }
    }
    if (graph && hop.kind === 'gap') return graph;
    if (graph && graph.worst <= TUBE_M) return graph;
    const tube = sampleKeepGaps(hop, segs);
    if (graph && (!tube.ok || graph.worst <= tube.worst)) return graph;
    return tube;
}

function componentIds(network, startId) {
    const seen = new Set([startId]);
    const stack = [startId];
    while (stack.length) {
        const u = stack.pop();
        for (const { to } of network.adj.get(u) || []) {
            if (seen.has(to)) continue;
            seen.add(to);
            stack.push(to);
        }
    }
    return seen;
}

function nodesNear(network, lat, lon, maxM) {
    const out = [];
    for (const id of network.adj.keys()) {
        const n = network.nodes.get(id);
        if (!n) continue;
        const d = haversineM(lat, lon, n.lat, n.lon);
        if (d <= maxM) out.push({ id, d });
    }
    return out;
}

/**
 * Walk one OSM component that has a node near both ends. Cape Flats rails are
 * tagged abandoned/disused in places and split into parallel islands, so the
 * nearest node to Bonteheuwel is often a different component from Netreg.
 * Snapping both ends into the same island follows the basemap rails instead of
 * the station-to-station chord.
 */
export function drapeSameComponent(hop, network) {
    const nearA = nodesNear(network, hop.a.lat, hop.a.lon, 180).sort((x, y) => x.d - y.d);
    const nearB = nodesNear(network, hop.b.lat, hop.b.lon, 180).sort((x, y) => x.d - y.d);
    if (!nearA.length || !nearB.length) return { ok: false, reason: 'no snaps' };
    const seen = new Set();
    let best = null;
    for (const a of nearA) {
        if (seen.has(a.id)) continue;
        const comp = componentIds(network, a.id);
        for (const id of comp) seen.add(id);
        const b = nearB.find((n) => comp.has(n.id));
        if (!b) continue;
        const budget = Math.max(hop.chordM * 2.8, hop.chordM + 900);
        const path = dijkstra(network, a.id, b.id, budget);
        if (!path || path.ids.length < 3) continue;
        const coords = coordsFromIds(network, path.ids);
        const step = pathMaxStep(coords);
        if (path.m > hop.chordM * 2.8 || step > 250) continue;
        const score = a.d + b.d;
        if (best && score >= best.score) continue;
        best = {
            ok: true,
            coords,
            len: Math.round(path.m),
            worst: Math.round(pathMaxPerp(coords, hop)),
            railHits: coords.length,
            gapHits: 0,
            method: 'same-component rail',
            score,
        };
    }
    if (!best) return { ok: false, reason: 'no same-component path' };
    delete best.score;
    return best;
}

export function hopMetrics(coords, aLat, aLon, bLat, bLon) {
    const i1 = nearestVert(coords, aLat, aLon);
    const i2 = nearestVert(coords, bLat, bLon);
    const lo = Math.min(i1.i, i2.i);
    const hi = Math.max(i1.i, i2.i);
    const chordM = haversineM(aLat, aLon, bLat, bLon);
    const alongM = lineLengthM(coords, lo, hi);
    const between = hi - lo - 1;
    const hop = {
        a: { lat: coords[lo][1], lon: coords[lo][0] },
        b: { lat: coords[hi][1], lon: coords[hi][0] },
    };
    let maxPerp = 0;
    let maxStep = 0;
    for (let i = lo + 1; i <= hi; i++) {
        const step = haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
        if (step > maxStep) maxStep = step;
        const p = perpAbsM(coords[i][1], coords[i][0], hop.a, hop.b);
        if (p > maxPerp) maxPerp = p;
    }
    return {
        lo, hi, chordM, alongM, between, maxPerp, maxStep, i1, i2,
        a: hop.a,
        b: hop.b,
    };
}

export function findRepairHops(coords, stops, names) {
    const hops = [];
    if (!Array.isArray(stops) || stops.length < 2) return hops;
    for (let s = 0; s < stops.length - 1; s++) {
        const a = stops[s];
        const b = stops[s + 1];
        if (!a || !b) continue;
        const m = hopMetrics(coords, a[0], a[1], b[0], b[1]);
        if (m.chordM < MIN_CHORD_M || m.chordM > MAX_CHORD_M) continue;
        const chordLike = m.between <= 1 && m.alongM <= m.chordM * 1.12;
        const from = names?.[s] || `stop ${s}`;
        const to = names?.[s + 1] || `stop ${s + 1}`;
        if (/DE WILDT/i.test(`${from} ${to}`)) continue;
        const strayShort = m.between >= 2
            && m.chordM <= STRAY_MAX_CHORD_M
            && m.maxPerp > STRAY_PERP_M
            && m.maxStep > STRAY_STEP_M;
        if (!chordLike && !strayShort) continue;
        hops.push({
            from,
            to,
            kind: strayShort ? 'stray' : 'chord',
            ...m,
        });
    }
    return hops;
}

export function findGapSteps(coords, hops) {
    const covered = new Set();
    for (const hop of hops) {
        if (hop.hi - hop.lo <= 1) continue;
        for (let i = hop.lo; i < hop.hi; i++) covered.add(i);
    }
    const gaps = [];
    for (let i = 1; i < coords.length; i++) {
        if (covered.has(i - 1)) continue;
        const step = haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
        if (step < MIN_GAP_STEP_M || step > MAX_GAP_STEP_M) continue;
        const prevStep = i >= 2
            ? haversineM(coords[i - 2][1], coords[i - 2][0], coords[i - 1][1], coords[i - 1][0])
            : 0;
        const nextStep = i + 1 < coords.length
            ? haversineM(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0])
            : 0;
        // Rural OSM is a run of 200–400 m edges. A map gap is an isolated jump
        // (Hercules 430 m then 80 m; Walker 364 m then 52 m).
        if (step < Math.max(prevStep, nextStep, 50) * 2.2) continue;
        gaps.push({
            from: `v#${i - 1}`,
            to: `v#${i}`,
            kind: 'gap',
            lo: i - 1,
            hi: i,
            chordM: step,
            alongM: step,
            between: 0,
            maxPerp: 0,
            maxStep: step,
            a: { lat: coords[i - 1][1], lon: coords[i - 1][0] },
            b: { lat: coords[i][1], lon: coords[i][0] },
        });
    }
    return gaps;
}

export function hopBboxPadDeg(hop) {
    // api.openstreetmap.org/map 400s when the bbox contains >50k nodes.
    // Long urban hops (Nyanga→Philippi) must stay tight.
    const raw = (hop.chordM / 111000) * 0.12;
    return Math.min(0.005, Math.max(0.0025, raw));
}
