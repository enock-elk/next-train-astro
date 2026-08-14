/**
 * Timetable ghosts — each schedule column is a simulated train.
 * Position is interpolated between the last stop whose clock ≤ now and the next.
 */
import { $schedules, $globalStationIndex, $userRegion } from '../store.js';
import {
    normalizeStationName,
    timeToSeconds,
    isRealTime,
    scheduleCacheSlot,
    getDistanceFromLatLonInKm,
} from './utils.js';

export const GHOST_WINDOW_SEC = 30 * 60;
export const CLOSER_TRAIN_M = 400;
export const LOCATE_RAIL_M = 50;
export const LOCATE_GHOST_M = 2000;
/** Max metres from the ghost to count as a train tracker (lab: 2 km for nearby / I’m on it). */
export const TRAIN_TRACKER_MAX_M = 2000;
export const HEADING_AGREE_DEG = 90;
export const NO_COORDS_MESSAGE = 'Live sharing is off on this corridor — we don’t have station locations yet.';

const SKIP_COLS = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);

function currentClock() {
    if (typeof window !== 'undefined' && window.currentTime) return window.currentTime;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function currentDayType() {
    if (typeof window !== 'undefined' && window.currentDayType) return window.currentDayType;
    return 'weekday';
}

function nowSeconds(now) {
    if (typeof now === 'number' && Number.isFinite(now)) return now;
    if (typeof now === 'string' && now) return timeToSeconds(now);
    return timeToSeconds(currentClock());
}

export function haversineM(lat1, lon1, lat2, lon2) {
    return getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) * 1000;
}

export function addMinutesToTime(timeStr, minutes) {
    if (!isRealTime(timeStr) || !Number.isFinite(minutes)) return timeStr;
    const sec = timeToSeconds(timeStr) + Math.round(minutes * 60);
    const wrapped = ((sec % 86400) + 86400) % 86400;
    const hh = String(Math.floor(wrapped / 3600)).padStart(2, '0');
    const mm = String(Math.floor((wrapped % 3600) / 60)).padStart(2, '0');
    const ss = String(wrapped % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function stationCol(schedule) {
    return schedule?.stationColumnName || 'STATION';
}

export function trainIdsInSchedule(schedule) {
    if (!schedule?.headers) return [];
    const col = stationCol(schedule);
    return schedule.headers
        .map((h) => String(h || '').trim())
        .filter((h) => h && h !== col && !SKIP_COLS.has(h) && /^\d{4}/.test(h));
}

/**
 * Ordered stops for one timetable column.
 * @returns {Array<{ station: string, time: string, seconds: number }>}
 */
export function stopsForTrain(schedule, trainId) {
    if (!schedule?.rows?.length || !trainId) return [];
    const id = String(trainId).trim();
    const col = stationCol(schedule);
    const headers = (schedule.headers || []).map((h) => String(h || '').trim());
    const key = headers.find((h) => h === id) || headers.find((h) => h.replace(/[a-zA-Z]+$/, '') === id);
    if (!key) return [];

    const out = [];
    for (const row of schedule.rows) {
        const station = row?.[col] || row?.STATION;
        const time = row?.[key];
        if (!station || !isRealTime(time)) continue;
        out.push({
            station: String(station).trim(),
            time: String(time).trim(),
            seconds: timeToSeconds(time),
        });
    }
    return out;
}

export function currentDirectionSchedules(schedules = $schedules.get() || {}) {
    const dayType = currentDayType();
    const region = $userRegion.get() || 'GP';
    return ['a', 'b']
        .map((ab) => schedules[scheduleCacheSlot(dayType, region, ab)])
        .filter((s) => s?.rows?.length);
}

export function findStopsForTrain(trainId, opts = {}) {
    const schedules = opts.schedules
        ? (Array.isArray(opts.schedules) ? opts.schedules : Object.values(opts.schedules).filter(Boolean))
        : currentDirectionSchedules();
    for (const schedule of schedules) {
        const stops = stopsForTrain(schedule, trainId);
        if (stops.length) return { schedule, stops };
    }
    return { schedule: null, stops: [] };
}

export function coordsForStation(name, stationIndex = $globalStationIndex.get() || {}) {
    if (!name) return null;
    const direct = stationIndex[name];
    if (direct && typeof direct.lat === 'number' && typeof (direct.lon ?? direct.lng) === 'number') {
        return { lat: direct.lat, lng: direct.lon ?? direct.lng };
    }
    const target = normalizeStationName(name);
    if (stationIndex[target] && typeof stationIndex[target].lat === 'number') {
        const c = stationIndex[target];
        return { lat: c.lat, lng: c.lon ?? c.lng };
    }
    for (const [key, value] of Object.entries(stationIndex)) {
        if (value && typeof value.lat === 'number' && normalizeStationName(key) === target) {
            return { lat: value.lat, lng: value.lon ?? value.lng };
        }
    }
    return null;
}

/** True when this corridor has enough station coordinates to place ghosts / live sharing. */
export function routeHasStationCoords(routeId, opts = {}) {
    const index = opts.stationIndex || $globalStationIndex.get() || {};
    const schedules = opts.schedules
        ? (Array.isArray(opts.schedules) ? opts.schedules : Object.values(opts.schedules).filter(Boolean))
        : currentDirectionSchedules();
    const names = new Set();
    for (const sch of schedules) {
        const col = stationCol(sch);
        for (const row of sch.rows || []) {
            const st = row?.[col] || row?.STATION;
            if (st) names.add(String(st).trim());
        }
    }
    if (names.size < 2) {
        let n = 0;
        for (const coords of Object.values(index)) {
            if (!coords || typeof coords.lat !== 'number') continue;
            const routes = coords.routes;
            const onRoute = !routeId
                || (routes && typeof routes.has === 'function' && routes.has(routeId))
                || (Array.isArray(routes) && routes.includes(routeId));
            if (onRoute) n += 1;
            if (n >= 2) return true;
        }
        return false;
    }
    let withCoords = 0;
    for (const name of names) {
        if (coordsForStation(name, index)) withCoords += 1;
        if (withCoords >= 2) return true;
    }
    return false;
}

/** Bearing of the ghost (last stop → next stop), degrees clockwise from north. */
export function ghostHeadingDeg(ghost, stationIndex) {
    const stops = ghost?.stops;
    if (!stops?.length) return null;
    const lastIdx = Math.max(0, Number.isInteger(ghost.lastIdx) ? ghost.lastIdx : 0);
    const nextIdx = Number.isInteger(ghost.nextIdx)
        ? ghost.nextIdx
        : Math.min(stops.length - 1, lastIdx + 1);
    const index = stationIndex || $globalStationIndex.get() || {};
    const a = coordsForStation(stops[lastIdx]?.station, index);
    const b = coordsForStation(stops[nextIdx]?.station, index);
    if (!a || !b) return null;
    if (Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6) return null;
    return (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI;
}

export function headingAgrees(userHeading, ghostHeading, maxDelta = HEADING_AGREE_DEG) {
    if (!Number.isFinite(userHeading) || !Number.isFinite(ghostHeading)) return true;
    let d = Math.abs(userHeading - ghostHeading) % 360;
    if (d > 180) d = 360 - d;
    return d <= maxDelta;
}

function trainInWindow(stops, nowSec, windowSec) {
    if (!stops.length) return false;
    const first = stops[0].seconds;
    const last = stops[stops.length - 1].seconds;
    return nowSec >= first - windowSec && nowSec <= last + windowSec;
}

/**
 * Where the timetable says this train is right now.
 */
export function expectedPosition(trainId, now, opts = {}) {
    const nowSec = nowSeconds(now);
    const { stops } = findStopsForTrain(trainId, opts);
    if (!stops.length) return null;
    const stationIndex = opts.stationIndex || $globalStationIndex.get() || {};

    let lastIdx = -1;
    for (let i = 0; i < stops.length; i++) {
        if (stops[i].seconds <= nowSec) lastIdx = i;
    }

    const point = (idx, fraction, extra) => {
        const stop = stops[Math.max(0, Math.min(stops.length - 1, idx))];
        const c = coordsForStation(stop.station, stationIndex);
        return {
            trainId: String(trainId),
            lat: c?.lat ?? null,
            lng: c?.lng ?? null,
            progress: idx + (fraction || 0),
            lastIdx: extra.lastIdx,
            nextIdx: extra.nextIdx,
            fraction: fraction || 0,
            hopM: extra.hopM || 0,
            hopSec: extra.hopSec || 0,
            started: extra.started,
            finished: extra.finished,
            stops,
            nowSec,
        };
    };

    if (lastIdx === -1) {
        return point(0, 0, { lastIdx: -1, nextIdx: 0, started: false, finished: false });
    }
    if (lastIdx >= stops.length - 1) {
        return point(lastIdx, 1, { lastIdx, nextIdx: lastIdx, started: true, finished: true });
    }

    const a = stops[lastIdx];
    const b = stops[lastIdx + 1];
    const span = Math.max(1, b.seconds - a.seconds);
    const fraction = Math.min(1, Math.max(0, (nowSec - a.seconds) / span));
    const ca = coordsForStation(a.station, stationIndex);
    const cb = coordsForStation(b.station, stationIndex);
    const hopM = (ca && cb) ? haversineM(ca.lat, ca.lng, cb.lat, cb.lng) : 0;
    const lat = (ca && cb) ? ca.lat + (cb.lat - ca.lat) * fraction : (ca?.lat ?? null);
    const lng = (ca && cb) ? ca.lng + (cb.lng - ca.lng) * fraction : (ca?.lng ?? null);

    return {
        trainId: String(trainId),
        lat,
        lng,
        progress: lastIdx + fraction,
        lastIdx,
        nextIdx: lastIdx + 1,
        fraction,
        hopM,
        hopSec: span,
        started: true,
        finished: false,
        stops,
        nowSec,
    };
}

/** Metres from a fix to the ghost. Infinity when the ghost has no coords. */
export function scoreTrainForFix(lat, lng, trainId, opts = {}) {
    const ghost = expectedPosition(trainId, opts.now, opts);
    if (!ghost || ghost.lat == null || ghost.lng == null) return Infinity;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Infinity;
    return haversineM(lat, lng, ghost.lat, ghost.lng);
}

export function listTrainsInWindow(now, opts = {}) {
    const nowSec = nowSeconds(now);
    const windowSec = opts.windowSec ?? GHOST_WINDOW_SEC;
    const schedules = opts.schedules
        ? (Array.isArray(opts.schedules) ? opts.schedules : Object.values(opts.schedules).filter(Boolean))
        : currentDirectionSchedules();
    const seen = new Set();
    const out = [];
    for (const schedule of schedules) {
        for (const id of trainIdsInSchedule(schedule)) {
            if (seen.has(id)) continue;
            const stops = stopsForTrain(schedule, id);
            if (!trainInWindow(stops, nowSec, windowSec)) continue;
            seen.add(id);
            out.push(id);
        }
    }
    return out;
}

export function scoreAllTrainsForFix(lat, lng, opts = {}) {
    const nowSec = nowSeconds(opts.now);
    const ids = listTrainsInWindow(nowSec, opts);
    return ids
        .map((trainId) => {
            const ghost = expectedPosition(trainId, nowSec, opts);
            const metres = (ghost?.lat != null && ghost?.lng != null)
                ? haversineM(lat, lng, ghost.lat, ghost.lng)
                : Infinity;
            return { trainId, metres, ghost };
        })
        .filter((s) => Number.isFinite(s.metres))
        .sort((a, b) => a.metres - b.metres);
}

/**
 * Never auto-relabel. If another ID is clearly closer, ask the rider.
 * @returns {{ action: 'keep'|'confirm'|'use_best', best: object|null, picked: object|null }}
 */
export function resolveTrainAttachment(lat, lng, pickedId, opts = {}) {
    const ranked = scoreAllTrainsForFix(lat, lng, opts);
    const clearerM = opts.clearerM ?? CLOSER_TRAIN_M;
    if (!ranked.length) return { action: 'keep', best: null, picked: pickedId ? { trainId: pickedId, metres: Infinity, ghost: null } : null };

    const best = ranked[0];
    if (!pickedId) {
        return best.metres <= (opts.maxM ?? LOCATE_GHOST_M)
            ? { action: 'use_best', best, picked: null }
            : { action: 'keep', best, picked: null };
    }

    const picked = ranked.find((r) => String(r.trainId) === String(pickedId))
        || { trainId: String(pickedId), metres: Infinity, ghost: expectedPosition(pickedId, opts.now, opts) };

    if (String(picked.trainId) === String(best.trainId)) {
        return { action: 'keep', best, picked };
    }

    const gap = picked.metres - best.metres;
    const oneStopBetter = Number.isFinite(picked.ghost?.progress) && Number.isFinite(best.ghost?.progress)
        && Math.abs(picked.ghost.progress - best.ghost.progress) >= 1
        && best.metres < picked.metres;

    if (gap >= clearerM || oneStopBetter) {
        return { action: 'confirm', best, picked };
    }
    return { action: 'keep', best, picked };
}

/** Selected station is still ahead of the ghost (not yet reached). */
export function isStationAheadOfGhost(station, ghost) {
    if (!ghost?.stops?.length || !station) return false;
    if (ghost.finished) return false;
    const target = normalizeStationName(station);
    const idx = ghost.stops.findIndex((s) => normalizeStationName(s.station) === target);
    if (idx < 0) {
        return ghost.stops.some((s) => s.seconds > (ghost.nowSec || 0));
    }
    return idx > ghost.progress;
}

/**
 * Project a lat/lng onto the stop chain and return along-track progress.
 */
export function progressAlongStops(lat, lng, stops, stationIndex) {
    if (!stops?.length || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    let best = { progress: 0, dist: Infinity };
    for (let i = 0; i < stops.length; i++) {
        const c = coordsForStation(stops[i].station, stationIndex);
        if (!c) continue;
        const d = haversineM(lat, lng, c.lat, c.lng);
        if (d < best.dist) best = { progress: i, dist: d };
        if (i < stops.length - 1) {
            const n = coordsForStation(stops[i + 1].station, stationIndex);
            if (!n) continue;
            const hop = haversineM(c.lat, c.lng, n.lat, n.lng);
            if (hop < 20) continue;
            const t = projectFraction(lat, lng, c, n);
            const px = c.lat + (n.lat - c.lat) * t;
            const py = c.lng + (n.lng - c.lng) * t;
            const pd = haversineM(lat, lng, px, py);
            if (pd < best.dist) best = { progress: i + t, dist: pd };
        }
    }
    return Number.isFinite(best.progress) ? best.progress : null;
}

function projectFraction(lat, lng, a, b) {
    const dx = b.lat - a.lat;
    const dy = b.lng - a.lng;
    const den = dx * dx + dy * dy;
    if (den <= 0) return 0;
    return Math.min(1, Math.max(0, ((lat - a.lat) * dx + (lng - a.lng) * dy) / den));
}

function chainMetres(stops, fromProg, toProg, stationIndex) {
    if (!stops?.length) return 0;
    const lo = Math.min(fromProg, toProg);
    const hi = Math.max(fromProg, toProg);
    let metres = 0;
    const i0 = Math.floor(lo);
    const i1 = Math.floor(hi);
    for (let i = i0; i <= i1 && i < stops.length - 1; i++) {
        const a = coordsForStation(stops[i].station, stationIndex);
        const b = coordsForStation(stops[i + 1].station, stationIndex);
        if (!a || !b) continue;
        const hop = haversineM(a.lat, a.lng, b.lat, b.lng);
        const startF = i === i0 ? (lo - i) : 0;
        const endF = i === i1 ? (hi - i) : 1;
        metres += hop * Math.max(0, endF - startF);
    }
    return metres;
}

export function metresToMinutes(metres, ghost, speedMps) {
    const m = Math.abs(metres);
    if (speedMps >= 3 && speedMps <= 35) return m / speedMps / 60;
    if (ghost?.hopM > 80 && ghost?.hopSec > 0) return (m / ghost.hopM) * (ghost.hopSec / 60);
    return m / 400; // ~24 km/h
}

/**
 * Positive minutes = rider is behind the ghost (train is late).
 */
export function lagMinutesFromFix(lat, lng, ghost, speedMps, stationIndex) {
    if (!ghost?.stops?.length || ghost.lat == null) return null;
    const riderProg = progressAlongStops(lat, lng, ghost.stops, stationIndex ?? $globalStationIndex.get());
    if (riderProg == null) {
        const d = haversineM(lat, lng, ghost.lat, ghost.lng);
        return metresToMinutes(d, ghost, speedMps);
    }
    const along = chainMetres(ghost.stops, riderProg, ghost.progress, stationIndex ?? $globalStationIndex.get());
    const sign = ghost.progress >= riderProg ? 1 : -1;
    return sign * metresToMinutes(along, ghost, speedMps);
}

function shortStation(name) {
    return String(name || '').replace(/ STATION$/i, '').trim();
}

/** "1165 → Pienaarspoort" — never a bare train number. */
export function trainGoingLabel(trainId, destination) {
    const id = String(trainId || '').trim();
    const dest = shortStation(destination);
    if (id && dest) return `${id} → ${dest}`;
    if (id) return `Train ${id}`;
    return dest || 'Train';
}

/** Where the timetable says this train should be right now. */
export function timetableWhereLabel(trainId, opts = {}) {
    const ghost = expectedPosition(trainId, opts.now, opts);
    if (!ghost?.stops?.length) return '';
    const last = ghost.lastIdx >= 0 ? ghost.stops[ghost.lastIdx] : null;
    const next = Number.isInteger(ghost.nextIdx) ? ghost.stops[ghost.nextIdx] : ghost.stops[0];
    const clock = (stop) => String(stop?.time || '').slice(0, 5);
    if (!ghost.started && next) {
        return `Timetable: due ${shortStation(next.station)} ${clock(next)}`.trim();
    }
    if (ghost.finished && last) {
        return `Timetable: arrived ${shortStation(last.station)}`;
    }
    if (last && next && last.station !== next.station) {
        return `Timetable: ${shortStation(last.station)} → ${shortStation(next.station)}`;
    }
    if (last) return `Timetable: at ${shortStation(last.station)}`;
    return '';
}
