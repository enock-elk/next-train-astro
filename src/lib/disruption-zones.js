/**
 * Transit-incident geometry helpers.
 * Two-station "danger zones" use interval overlap, not a single hop
 * that spans the whole zone (real trips stop at every station).
 */
import { normalizeStationName } from './utils.js';

/**
 * First trip-stop index that contacts a two-station danger zone.
 * Returns -1 if the trip never enters the zone.
 *
 * @param {string[]} master geographic station order for the corridor
 * @param {Array<{ station?: string, name?: string }|string>} stopsArray
 * @param {string} zoneA
 * @param {string} zoneB
 */
export function firstContactInDangerZone(master, stopsArray, zoneA, zoneB) {
    if (!Array.isArray(master) || !master.length || !Array.isArray(stopsArray) || !stopsArray.length) {
        return -1;
    }
    const zA = master.indexOf(normalizeStationName(zoneA));
    const zB = master.indexOf(normalizeStationName(zoneB));
    if (zA < 0 || zB < 0) return -1;
    const minZone = Math.min(zA, zB);
    const maxZone = Math.max(zA, zB);

    const stationOf = (s) => (typeof s === 'string' ? s : (s?.station || s?.name || ''));
    const indices = stopsArray.map((s) => master.indexOf(normalizeStationName(stationOf(s))));
    const known = indices.filter((i) => i !== -1);
    if (!known.length) return -1;
    const tMin = Math.min(...known);
    const tMax = Math.max(...known);
    if (tMax < minZone || tMin > maxZone) return -1;

    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (idx !== -1 && idx >= minZone && idx <= maxZone) return i;
    }
    // Express skip: range overlaps but no stop sits inside the zone.
    for (let i = 0; i < indices.length - 1; i++) {
        const a = indices[i];
        const b = indices[i + 1];
        if (a === -1 || b === -1) continue;
        const hopMin = Math.min(a, b);
        const hopMax = Math.max(a, b);
        if (hopMax >= minZone && hopMin <= maxZone) return i;
    }
    return -1;
}

/**
 * Station names on `master` that sit inside a CRITICAL incident zone.
 * Route-wide (empty stations) returns the full master. Caller must
 * restrict that case to the incident's own routeId.
 *
 * @param {string[]} master
 * @param {{ tier?: string, stations?: string[] }} disruption
 */
export function stationsInCriticalZone(master, disruption) {
    if (!disruption || disruption.tier !== 'CRITICAL' || !Array.isArray(master) || !master.length) {
        return [];
    }
    const named = Array.isArray(disruption.stations) ? disruption.stations.filter(Boolean) : [];
    if (!named.length) return master.slice();
    const norms = named.map((s) => normalizeStationName(s));
    if (norms.length === 1) {
        return master.includes(norms[0]) ? [norms[0]] : [];
    }
    const idxA = master.indexOf(norms[0]);
    const idxB = master.indexOf(norms[1]);
    if (idxA < 0 || idxB < 0) return [];
    const lo = Math.min(idxA, idxB);
    const hi = Math.max(idxA, idxB);
    return master.slice(lo, hi + 1);
}

/**
 * Map of normalized station name → first CRITICAL incident that shades it
 * on this corridor (cross-corridor geometry included).
 *
 * @param {string} routeId
 * @param {string[]} master
 * @param {Record<string, object[]>} disruptions
 */
export function disruptedStationMap(routeId, master, disruptions) {
    const map = new Map();
    if (!routeId || !Array.isArray(master) || !master.length) return map;
    const bag = disruptions && typeof disruptions === 'object' ? disruptions : {};
    const all = Object.values(bag).flat().filter((d) => d && d.tier === 'CRITICAL');
    for (const d of all) {
        const named = Array.isArray(d.stations) ? d.stations.filter(Boolean) : [];
        if (!named.length && d.routeId !== routeId) continue;
        const hits = stationsInCriticalZone(master, d);
        for (const name of hits) {
            if (!map.has(name)) map.set(name, d);
        }
    }
    return map;
}
