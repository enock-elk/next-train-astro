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
 * Last timed trip stop before the inclusive danger zone (the train's
 * last safe station). Zone endpoints count as affected, so Pretoria→
 * Kempton Park with Olifantsfontein–Kempton Park terminates at Irene
 * (or Pinedene), not at Olifantsfontein.
 *
 * Starts inside the zone → 0. No overlap → -1. An express hop that
 * jumps into the zone uses the hop start (already the last safe stop).
 */
export function lastSafeStopBeforeDangerZone(master, stopsArray, zoneA, zoneB) {
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

    let firstIn = -1;
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (idx !== -1 && idx >= minZone && idx <= maxZone) {
            firstIn = i;
            break;
        }
    }
    if (firstIn > 0) return firstIn - 1;
    if (firstIn === 0) return 0;

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

/** Operating days an incident can target. Missing applyDays means all of these. */
export const ALL_DISRUPTION_DAYS = ['weekday', 'saturday', 'sunday', 'public_holiday'];

/**
 * Days the incident applies. Missing / empty = every operating day (legacy rows).
 * @param {{ applyDays?: string[] }} d
 */
export function disruptionApplyDays(d) {
    const raw = Array.isArray(d?.applyDays) ? d.applyDays : [];
    const days = raw
        .map((x) => String(x || '').trim().toLowerCase())
        .filter((x) => ALL_DISRUPTION_DAYS.includes(x));
    return days.length ? days : ALL_DISRUPTION_DAYS.slice();
}

export function disruptionAppliesToDay(d, dayType) {
    const day = String(dayType || 'weekday').trim().toLowerCase();
    return disruptionApplyDays(d).includes(day || 'weekday');
}

/** Minutes from midnight, or null if the value is empty / not HH:MM. */
export function hhmmToMinutes(value) {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || h > 23) return null;
    return h * 60 + min;
}

/**
 * Inclusive clock window. Both empty = all day (null).
 * Overnight windows (22:00-05:00) wrap midnight.
 * @returns {{ start: number, end: number } | null}
 */
export function disruptionWindowMinutes(d) {
    const start = hhmmToMinutes(d?.startTime);
    const end = hhmmToMinutes(d?.endTime);
    if (start == null && end == null) return null;
    return { start: start ?? 0, end: end ?? (23 * 60 + 59) };
}

export function disruptionIsAllDay(d) {
    return disruptionWindowMinutes(d) == null;
}

export function disruptionAppliesToTime(d, timeStr) {
    const win = disruptionWindowMinutes(d);
    if (!win) return true;
    const t = hhmmToMinutes(timeStr);
    if (t == null) return false;
    if (win.start <= win.end) return t >= win.start && t <= win.end;
    return t >= win.start || t <= win.end;
}

/** True when any listed time sits in the window. Empty list = do not hide (legacy / unknown). */
export function disruptionAppliesToAnyTime(d, times) {
    if (disruptionIsAllDay(d)) return true;
    const list = (Array.isArray(times) ? times : []).filter((t) => hhmmToMinutes(t) != null);
    if (!list.length) return true;
    return list.some((t) => disruptionAppliesToTime(d, t));
}

export function disruptionAppliesToDayAndTime(d, dayType, timeStr) {
    return disruptionAppliesToDay(d, dayType) && disruptionAppliesToTime(d, timeStr);
}

/** CRITICAL cancelled-station paint. Missing / false = hidden (default off). */
export function disruptionShowsCancelledOnMap(d) {
    return !!(d && d.showCancelledOnMap === true);
}

export function collectStopTimes(stopsArray) {
    if (!Array.isArray(stopsArray)) return [];
    const out = [];
    for (const s of stopsArray) {
        if (!s || typeof s === 'string') continue;
        for (const key of ['time', 'dep', 'arr', 'depTime', 'arrTime']) {
            if (s[key]) out.push(s[key]);
        }
    }
    return out;
}

/** Clock times at stops that actually sit inside the incident, not the whole trip. */
export function collectDisruptionContactTimes(stopsArray, disruption, master) {
    if (!Array.isArray(stopsArray) || !stopsArray.length) return [];
    const named = Array.isArray(disruption?.stations)
        ? disruption.stations.map((s) => normalizeStationName(s)).filter(Boolean)
        : [];
    if (!named.length) return collectStopTimes(stopsArray);

    let zone = named;
    if (named.length >= 2 && Array.isArray(master) && master.length) {
        const idxA = master.indexOf(named[0]);
        const idxB = master.indexOf(named[1]);
        if (idxA >= 0 && idxB >= 0) {
            zone = master.slice(Math.min(idxA, idxB), Math.max(idxA, idxB) + 1);
        }
    }
    const zoneSet = new Set(zone);
    const hits = [];
    for (const s of stopsArray) {
        const name = normalizeStationName(typeof s === 'string' ? s : (s?.station || s?.name || ''));
        if (!zoneSet.has(name)) continue;
        if (typeof s === 'string') continue;
        for (const key of ['time', 'dep', 'arr', 'depTime', 'arrTime']) {
            if (s[key]) hits.push(s[key]);
        }
    }
    return hits;
}

/**
 * Map of normalized station name → first CRITICAL incident that shades it
 * on this corridor (cross-corridor geometry included).
 *
 * @param {string} routeId
 * @param {string[]} master
 * @param {Record<string, object[]>} disruptions
 * @param {string} [dayType]
 */
export function disruptedStationMap(routeId, master, disruptions, dayType) {
    const map = new Map();
    if (!routeId || !Array.isArray(master) || !master.length) return map;
    const bag = disruptions && typeof disruptions === 'object' ? disruptions : {};
    const all = Object.values(bag).flat().filter((d) => d && d.tier === 'CRITICAL');
    for (const d of all) {
        if (!disruptionAppliesToDay(d, dayType)) continue;
        const named = Array.isArray(d.stations) ? d.stations.filter(Boolean) : [];
        if (!named.length && d.routeId !== routeId) continue;
        const hits = stationsInCriticalZone(master, d);
        for (const name of hits) {
            if (!map.has(name)) map.set(name, d);
        }
    }
    return map;
}
