/**
 * Live presence — show where you are (train optional) until Stop or terminus.
 *
 * RTDB: ride_pings/{routeId}/{deviceId}
 * {
 *   routeId, deviceId, station, trainId?, waitingFor?, destination?,
 *   at, expiresAt, uid?, email?, coarseLat?, coarseLng?, appVersion, source
 * }
 * trainId is set only when the rider is on-path and moving. Waiting / far
 * shares keep trainId null so clocks and the dashboard stay off that train.
 *
 * No GPS trails — optional coarse coords only to snap station / show on Leaflet.
 * Safety TTL is 30 minutes of no session activity (rules must allow the same
 * window). Foreground GPS pings slide that window; backgrounded sessions die
 * when `expiresAt` elapses even if JS timers were killed. One active ride per account.
 */
import { APP_VERSION, DYNAMIC_BASE_URL, ROUTES } from './config.js';
import { isAdminAuthed, getPinnedRouteIds } from './admin-chrome.js';
import { safeStorage, escapeHTML, normalizeStationName, getDistanceFromLatLonInKm, formatTimeDisplay } from './utils.js';
import { $currentRouteId, $deviceId, $globalStationIndex } from '../store.js';
import { $account } from './account.js';
import { showToast, triggerHaptic } from './ui.js';
import { bootFirebase } from './firebase-boot.js';
import { FEATURE_KEYS, fetchFeatures, isFeatureEnabled, isRideCheckInPinned, relaxLiveShareGuards } from './features.js';
import {
    expectedPosition,
    isStationAheadOfGhost,
    lagMinutesFromFix,
    addMinutesToTime,
    headingAgrees,
    findStopsForTrain,
    progressAlongStops,
    progressAlongStopsDetailed,
    journeyHeadingAtProgress,
    journeyPositionLabel,
    trainGoingLabel,
    railPathForTrain,
    scoreFixToRailPath,
} from './train-ghosts.js';
import { TRACKER_SNAP_MAX_M } from './rail-tracks.js';
import { peekCachedRouteReports, isReportStillLive, routeHasNoScheduledTrains } from './delay-reports.js';
import { awardShareMarks } from './rider-marks.js';

/** Sliding share TTL. Last successful ping + this window, then the session ends. */
export const RIDE_SHARE_IDLE_MS = 30 * 60 * 1000;
/** Alias kept for callers / verifies: idle window is the write TTL. */
export const RIDE_PING_TTL_MS = RIDE_SHARE_IDLE_MS;
/** Two missed onboard pings (loop is 45s). Map glyph goes slate. */
export const RIDE_GPS_STALE_MS = 90 * 1000;
export const TRACKING_STATE = Object.freeze({
    ACTIVE: 'active',
    PAUSED: 'paused',
    STOPPED: 'stopped',
});
const REVERSE_PROGRESS_TOLERANCE = 0.08;
const CONSENSUS_MIN_BAND = 0.2;
const ACTIVE_KEY = 'ridePingActiveV1';
const SHARE_SESSION_KEY = 'nt_ride_share_session';

/** @type {Record<string, () => void>} */
const routeListeners = {};
/** @type {Record<string, object[]>} */
const routeCache = {};

function getDeviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown';
}

export function isRideCheckInEnabled(routeId = $currentRouteId.get()) {
    return isFeatureEnabled(FEATURE_KEYS.RIDE_CHECKIN, routeId || '');
}

/** Green chip / tracker entry: admin, or a pinned corridor that RTDB allow-lists. */
export function canSeeLiveShareChrome(routeId = $currentRouteId.get()) {
    if (isAdminAuthed()) return true;
    const pins = getPinnedRouteIds();
    if (!pins.length) return false;
    const current = String(routeId || '');
    if (current && !pins.includes(current)) return false;
    const ids = current ? [current] : pins;
    return ids.some((id) => isRideCheckInPinned(id));
}

function isMyDevicePing(p) {
    const deviceId = getDeviceId();
    return !!(p && deviceId && p.deviceId === deviceId);
}

function iAmSharingTrain(trainId, routeId = $currentRouteId.get()) {
    const id = String(trainId || '');
    if (!id) return false;
    const mine = getActiveShare();
    if (mine && String(mine.trainId || '') === id && (!mine.routeId || mine.routeId === routeId)) return true;
    return activePings(getCachedRidePings(routeId)).some((p) => isMyDevicePing(p) && String(p.trainId || '') === id);
}

/**
 * Chip / map / tracker copy. Never call a solo self-share “1 rider”.
 * @param {{ count?: number, iAmSharing?: boolean }} opts
 */
export function sharingStatusCopy({ count = 0, iAmSharing = false } = {}) {
    const n = Math.max(0, Number(count) || 0);
    if (iAmSharing) {
        const others = Math.max(0, n - 1);
        if (others <= 0) return 'You’re sharing';
        if (others === 1) return 'You and 1 other are sharing';
        return `You and ${others} others are sharing`;
    }
    if (n <= 0) return '';
    if (n === 1) return '1 sharing';
    return `${n} sharing`;
}

function shareReachedTerminus(trainId, lat, lng, station) {
    const id = String(trainId || '');
    if (!id) return false;
    const { stops } = findStopsForTrain(id);
    if (!stops.length) return false;
    const last = stops[stops.length - 1]?.station;
    if (station && last && normalizeStationName(station) === normalizeStationName(last)) return true;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const prog = progressAlongStops(lat, lng, stops, $globalStationIndex.get() || {});
    if (prog == null) return false;
    return prog >= (stops.length - 1) - 0.15;
}

async function ensureAuthToken() {
    if (!window.firebaseAuth) await bootFirebase();
    if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
        try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
    }
    if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
        try {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true);
        } catch {
            return '';
        }
    }
    return '';
}

/**
 * RTDB REST answers 401 for both "bad token" and "rules deny". The ride_pings
 * rules in firebase-database.rules.json must be deployed for live sharing to
 * work at all: `npm run firebase:rules`.
 */
function permissionMessage(status) {
    if (status === 401 || status === 403) {
        return 'Live sharing isn’t enabled on the server yet (database rules not deployed).';
    }
    return `Couldn’t share your location (${status}).`;
}

function ageLabel(at) {
    const mins = Math.max(0, Math.round((Date.now() - (at || Date.now())) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.round(mins / 60)}h ago`;
}

function activePings(list) {
    const now = Date.now();
    return (list || []).filter((p) => {
        if (!p || (p.expiresAt || 0) <= now || (p.at || 0) <= now - RIDE_PING_TTL_MS) return false;
        return !!(p.station || (typeof p.coarseLat === 'number' && typeof p.coarseLng === 'number'));
    });
}

function peekStoredShare() {
    try {
        return JSON.parse(safeStorage.getItem(ACTIVE_KEY) || 'null');
    } catch {
        return null;
    }
}

export function isRidePingGpsStale(at, now = Date.now()) {
    const t = Number(at || 0);
    return !t || (now - t) >= RIDE_GPS_STALE_MS;
}

function roundCoord(value) {
    return Math.round(value * 100000) / 100000;
}

/**
 * Validate and project one train fix onto trusted geometry for this route and
 * bind it to the scheduled origin-to-terminus stop sequence.
 */
export async function projectTrainTrackerFix({
    lat,
    lng,
    trainId,
    routeId,
    previousProgress = null,
    stationIndex = $globalStationIndex.get() || {},
    schedules,
} = {}) {
    const id = String(trainId || '');
    const route = ROUTES[routeId];
    const { stops } = findStopsForTrain(id, schedules ? { schedules } : {});
    if (!id || !route || stops.length < 2) {
        return { ok: false, state: TRACKING_STATE.PAUSED, reason: 'geometryUnavailable', geometryUnavailable: true };
    }
    let snap;
    try {
        const { snapToRail, TRACKER_SNAP_MAX_M } = await import('./rail-tracks.js');
        snap = await snapToRail(lat, lng, route.region || 'GP', TRACKER_SNAP_MAX_M, routeId);
    } catch {
        return { ok: false, state: TRACKING_STATE.PAUSED, reason: 'geometryUnavailable', geometryUnavailable: true };
    }
    if (!snap.ok) {
        return {
            ok: false,
            state: TRACKING_STATE.PAUSED,
            reason: snap.geometryUnavailable ? 'geometryUnavailable' : 'offTrack',
            geometryUnavailable: !!snap.geometryUnavailable,
            distanceM: snap.distanceM,
        };
    }
    const projected = progressAlongStopsDetailed(snap.lat, snap.lon, stops, stationIndex);
    if (!projected) {
        return { ok: false, state: TRACKING_STATE.PAUSED, reason: 'geometryUnavailable', geometryUnavailable: true };
    }
    const progress = projected.progress;
    if (Number.isFinite(previousProgress) && progress < previousProgress - REVERSE_PROGRESS_TOLERANCE) {
        return {
            ok: false,
            state: TRACKING_STATE.PAUSED,
            reason: 'reverseProgress',
            geometryUnavailable: false,
            progress,
        };
    }
    return {
        ok: true,
        state: TRACKING_STATE.ACTIVE,
        geometryUnavailable: false,
        projectedLat: roundCoord(snap.lat),
        projectedLng: roundCoord(snap.lon),
        projectedProgress: progress,
        routeProgressM: snap.routeM,
        distanceM: snap.distanceM,
        lastSeenLabel: journeyPositionLabel(stops, progress),
        bearing: journeyHeadingAtProgress(id, progress, { stationIndex, ...(schedules ? { schedules } : {}) }),
    };
}

function shareSessionIdle(raw, now = Date.now()) {
    if (!raw) return true;
    if ((raw.expiresAt || 0) <= now) return true;
    const last = Number(raw.lastPingAt || raw.at || 0);
    return !!(last && now - last >= RIDE_SHARE_IDLE_MS);
}

export function getActiveShare() {
    const raw = peekStoredShare();
    if (!raw || shareSessionIdle(raw)) return null;
    return raw;
}

export function hasRidePingsListener(routeId) {
    return !!(routeId && routeListeners[routeId]);
}

let idleStopInFlight = false;
let lastIdleAttempt = 0;
let shareWatchTimer = 0;
let shareIdleBound = false;

function startShareIdleWatch() {
    if (typeof document !== 'undefined' && !shareIdleBound) {
        shareIdleBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') stopShareIfIdle();
        });
    }
    if (shareWatchTimer) return;
    shareWatchTimer = setInterval(() => { stopShareIfIdle(); }, 60 * 1000);
}

function stopShareIdleWatch() {
    if (shareWatchTimer) {
        clearInterval(shareWatchTimer);
        shareWatchTimer = 0;
    }
}

/** Expire a share that has had no ping activity for 30 minutes (or whose TTL elapsed). */
export async function stopShareIfIdle() {
    const raw = peekStoredShare();
    if (!raw || !shareSessionIdle(raw) || idleStopInFlight) return false;
    if (Date.now() - lastIdleAttempt < 5000) return false;
    lastIdleAttempt = Date.now();
    idleStopInFlight = true;
    try {
        const hidden = typeof document !== 'undefined' && document.hidden;
        await stopRideShare({ reason: 'idle', quiet: hidden });
        return true;
    } finally {
        idleStopInFlight = false;
    }
}

/**
 * One map marker per train (plus unattached people). Drops deviceId / uid / email
 * so the iframe never needs other riders' identifiers. Same-train pings are
 * averaged only when they sit on the rails and on that train’s path.
 */
export async function compactPingsForMap(pings, { mineDeviceId = '', routeId = '' } = {}) {
    const trains = {};
    const loose = [];
    (pings || []).forEach((p) => {
        if (typeof p?.coarseLat !== 'number' || typeof p?.coarseLng !== 'number') return;
        const state = p.trackingState || TRACKING_STATE.ACTIVE;
        const keepsAcceptedTrain = !!(
            p.trainId
            && (state === TRACKING_STATE.ACTIVE || state === TRACKING_STATE.PAUSED)
            && typeof p.projectedLat === 'number'
            && typeof p.projectedLng === 'number'
            && Number.isFinite(p.projectedProgress)
        );
        const publicId = pingPublicTrainId(p);
        const trainId = keepsAcceptedTrain ? String(p.trainId) : (publicId || '');
        const lat = trainId ? p.projectedLat : p.coarseLat;
        const lng = trainId ? p.projectedLng : p.coarseLng;
        const row = {
            lat,
            lng,
            trainId: trainId || '',
            station: p.station || '',
            at: p.at || 0,
            expiresAt: p.expiresAt,
            heading: p.heading,
            speedMps: p.speedMps,
            mine: p.deviceId === mineDeviceId,
            routeId: p.routeId || routeId,
            projectedProgress: p.projectedProgress,
            routeProgressM: p.routeProgressM,
            railDistanceM: p.railDistanceM,
            bearing: p.bearing,
            trackingState: state,
            acceptedAt: p.acceptedAt,
            lastSeenLabel: p.lastSeenLabel || p.station || '',
            accuracy: p.accuracy,
            pauseReason: p.pauseReason || '',
        };
        if (trainId) {
            (trains[trainId] = trains[trainId] || []).push(row);
        } else {
            loose.push({ ...row, n: 1 });
        }
    });
    const out = [];
    for (const trainId of Object.keys(trains)) {
        const list = trains[trainId];
        const active = consensusProjectedPings(list);
        const paused = list
            .filter((p) =>
                (
                    p.trackingState === TRACKING_STATE.PAUSED
                    || (p.trackingState === TRACKING_STATE.ACTIVE && isRidePingGpsStale(p.acceptedAt || p.at))
                )
                && Number.isFinite(p.projectedProgress)
                && Number.isFinite(p.lat)
                && Number.isFinite(p.lng)
            )
            .sort((a, b) => (b.at || 0) - (a.at || 0));
        const kept = active.length ? active : paused.slice(0, 1);
        if (!kept.length) continue;
        const medianProgress = median(kept.map((p) => p.projectedProgress));
        const driver = [...kept].sort((a, b) => {
            const da = Math.abs(a.projectedProgress - medianProgress);
            const db = Math.abs(b.projectedProgress - medianProgress);
            return da - db || (b.at || 0) - (a.at || 0);
        })[0];
        const newest = kept.reduce((a, b) => ((a.at || 0) >= (b.at || 0) ? a : b), kept[0]);
        const pausedOnly = active.length === 0;
        out.push({
            lat: driver.lat,
            lng: driver.lng,
            trainId,
            n: active.length || list.length,
            mine: list.some((p) => p.mine),
            at: newest.at,
            expiresAt: newest.expiresAt,
            heading: newest.heading,
            speedMps: newest.speedMps,
            station: newest.station,
            routeId: newest.routeId,
            bearing: Number.isFinite(driver.bearing)
                ? driver.bearing
                : journeyHeadingAtProgress(trainId, driver.projectedProgress),
            onRails: true,
            projectedProgress: medianProgress,
            routeProgressM: driver.routeProgressM,
            railDistanceM: newest.railDistanceM,
            trackingState: pausedOnly ? TRACKING_STATE.PAUSED : TRACKING_STATE.ACTIVE,
            acceptedAt: driver.acceptedAt,
            lastSeenLabel: driver.lastSeenLabel,
            accuracy: newest.accuracy,
            pauseReason: pausedOnly ? newest.pauseReason : '',
        });
    }
    return out.concat(loose);
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return NaN;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median/MAD consensus on accepted along-journey progress, never raw GPS. */
export function consensusProjectedPings(pings) {
    const valid = (pings || []).filter((p) =>
        p?.trackingState === TRACKING_STATE.ACTIVE
        && !isRidePingGpsStale(p.acceptedAt || p.at)
        && Number.isFinite(p.projectedProgress)
        && Number.isFinite(p.lat ?? p.projectedLat)
        && Number.isFinite(p.lng ?? p.projectedLng)
    ).map((p) => ({
        ...p,
        lat: p.lat ?? p.projectedLat,
        lng: p.lng ?? p.projectedLng,
    }));
    if (valid.length < 3) return valid;
    const centre = median(valid.map((p) => p.projectedProgress));
    const mad = median(valid.map((p) => Math.abs(p.projectedProgress - centre)));
    const band = Math.max(CONSENSUS_MIN_BAND, mad * 3);
    return valid.filter((p) => Math.abs(p.projectedProgress - centre) <= band);
}

function stationShort(name) {
    return String(name || '').replace(/ STATION$/i, '').trim() || 'here';
}

export function nearestStationOnRoute(lat, lon, routeId = $currentRouteId.get()) {
    const index = $globalStationIndex.get() || {};
    let best = null;
    for (const [name, coords] of Object.entries(index)) {
        if (!coords || typeof coords.lat !== 'number') continue;
        const routes = coords.routes;
        const onRoute = !routeId
            || (routes && typeof routes.has === 'function' && routes.has(routeId))
            || (Array.isArray(routes) && routes.includes(routeId));
        if (!onRoute) continue;
        const dist = getDistanceFromLatLonInKm(lat, lon, coords.lat, coords.lon ?? coords.lng);
        if (!best || dist < best.distKm) {
            best = { stationName: name, distKm: dist, lat: coords.lat, lon: coords.lon ?? coords.lng };
        }
    }
    return best;
}

function oneShotGps() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(Object.assign(new Error('Location isn’t available on this device.'), { code: 2 }));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                heading: typeof pos.coords.heading === 'number' ? pos.coords.heading : null,
                speedMps: typeof pos.coords.speed === 'number' ? pos.coords.speed : null,
            }),
            reject,
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 }
        );
    });
}

export function getCachedRidePings(routeId = $currentRouteId.get()) {
    return routeCache[routeId] || [];
}

function pingTracksTrain(p, trainId, opts = {}) {
    const id = String(trainId || '');
    if (!id || String(p?.trainId || '') !== id) return false;
    if (relaxLiveShareGuards()) return true;
    if (p.trackingState !== TRACKING_STATE.ACTIVE || isRidePingGpsStale(p.acceptedAt || p.at)) return false;
    const lat = typeof p.projectedLat === 'number' ? p.projectedLat : null;
    const lng = typeof p.projectedLng === 'number' ? p.projectedLng : null;
    if (lat == null || lng == null) return false;
    if (!Number.isFinite(p.projectedProgress)) return false;
    if (p.adminOverrideRole === 'train') return true;
    const metres = Number(p.railDistanceM);
    if (!Number.isFinite(metres) || metres > TRACKER_SNAP_MAX_M) return false;
    if (typeof p.speedMps !== 'number' || p.speedMps < 1.5) return false;
    if (typeof p.heading === 'number') {
        const scheduledHeading = journeyHeadingAtProgress(id, p.projectedProgress, opts);
        if (!headingAgrees(p.heading, scheduledHeading)) return false;
    }
    return true;
}

/** Sort key for verified sharers: heading, proximity, train-like speed, freshness. Lower is better. */
export function compareRankedPings(a, b) {
    if (!!a.headingOk !== !!b.headingOk) return a.headingOk ? -1 : 1;
    const dm = (a.metres || Infinity) - (b.metres || Infinity);
    if (dm) return dm;
    if (!!a.trainLike !== !!b.trainLike) return a.trainLike ? -1 : 1;
    const ds = (a.speedScore || 0) - (b.speedScore || 0);
    if (ds) return ds;
    return (b.at || 0) - (a.at || 0);
}

function scoreTrackedPing(p, trainId, opts = {}) {
    const metres = Number.isFinite(Number(p.railDistanceM)) ? Number(p.railDistanceM) : Infinity;
    const ghostH = journeyHeadingAtProgress(trainId, p.projectedProgress, opts);
    const headingOk = headingAgrees(
        typeof p.heading === 'number' ? p.heading : NaN,
        ghostH
    );
    const speed = typeof p.speedMps === 'number' ? p.speedMps : 0;
    const trainLike = speed >= 3 && speed <= 35;
    const speedScore = trainLike ? 0 : Math.abs(speed - 15);
    return {
        ping: p,
        metres,
        headingOk,
        trainLike,
        speedScore,
        speed,
        at: p.at || 0,
    };
}

/**
 * Rank verified on-path pings for one train. Do not average GPS — pick a driver.
 * 1) heading agrees with the journey 2) closer to the selected rail path
 * 3) plausible train speed          4) fresher `at`
 */
export function rankVerifiedPings(pings, trainId, opts = {}) {
    const id = String(trainId || '');
    if (!id) return [];
    const live = consensusProjectedPings(
        activePings(pings).filter((p) => pingTracksTrain(p, id, opts))
    );
    if (!live.length) return [];
    return live
        .map((p) => scoreTrackedPing(p, id, opts))
        .sort(compareRankedPings);
}

function journeyTrainId(j) {
    return String(j?.train || j?.train1?.train || '').trim();
}

function scheduleDataMap() {
    if (typeof window !== 'undefined' && window.currentScheduleData && typeof window.currentScheduleData === 'object') {
        return window.currentScheduleData;
    }
    return {};
}

function destinationForTrain(trainId, route) {
    if (!trainId || !route) return null;
    const id = String(trainId);
    const data = scheduleDataMap();
    for (const dest of [route.destA, route.destB]) {
        const journeys = dest ? (data[dest] || []) : [];
        if (journeys.some((j) => journeyTrainId(j) === id)) return dest;
    }
    const { stops } = findStopsForTrain(id);
    if (!stops.length) {
        return null;
    }
    const last = stops[stops.length - 1]?.station || '';
    if (normalizeStationName(last) === normalizeStationName(route.destA)) return route.destA;
    if (normalizeStationName(last) === normalizeStationName(route.destB)) return route.destB;
    return null;
}

function pickLiveGroup(pings, opts = {}) {
    if (!pings?.length) return null;
    const byTrain = {};
    pings.forEach((p) => {
        const k = String(p.trainId || '');
        if (!k) return;
        (byTrain[k] || (byTrain[k] = [])).push(p);
    });
    let best = null;
    Object.entries(byTrain).forEach(([trainId, list]) => {
        const ranked = rankVerifiedPings(list, trainId, opts);
        if (!ranked.length) return;
        const driver = ranked[0];
        if (!best || compareRankedPings(driver, best.driver) < 0) {
            best = { trainId, driver, ranked, count: ranked.length };
        }
    });
    return best;
}

/** Live verified group per direction — header pin + badge. Not gated on the viewer’s station. */
export function liveTrackersByDirection(routeId = $currentRouteId.get(), opts = {}) {
    const route = ROUTES[routeId];
    if (!route) return { a: null, b: null };
    const verified = activePings(getCachedRidePings(routeId)).filter((p) => pingTracksTrain(p, p.trainId, opts));
    const buckets = { a: [], b: [] };
    verified.forEach((p) => {
        const dest = destinationForTrain(p.trainId, route);
        if (dest && normalizeStationName(dest) === normalizeStationName(route.destA)) buckets.a.push(p);
        else if (dest && normalizeStationName(dest) === normalizeStationName(route.destB)) buckets.b.push(p);
    });
    return {
        a: pickLiveGroup(buckets.a, opts),
        b: pickLiveGroup(buckets.b, opts),
    };
}

/** Train id others should see — only on-path and moving. Waiting / far = commuter. */
export function pingPublicTrainId(p) {
    if (p?.trainId && p?.adminOverrideRole === 'train') return String(p.trainId);
    if (p?.trainId && relaxLiveShareGuards()) return String(p.trainId);
    return pingTracksTrain(p, p?.trainId) ? String(p.trainId) : null;
}

export function trainHasLivePing(trainId, routeId = $currentRouteId.get()) {
    if (!trainId) return false;
    const id = String(trainId);
    return activePings(getCachedRidePings(routeId)).some((p) => pingTracksTrain(p, id));
}

export function liveTrainIdsForRoute(routeId = $currentRouteId.get()) {
    const ids = new Set();
    activePings(getCachedRidePings(routeId)).forEach((p) => {
        const id = pingPublicTrainId(p);
        if (id) ids.add(String(id));
    });
    return ids;
}

function matchingDelayReport(trainId, routeId) {
    const id = String(trainId || '');
    return peekCachedRouteReports(routeId).some((r) => {
        if (!r || String(r.trainId || '') !== id || !isReportStillLive(r)) return false;
        const s = r.trainStatus || r.status;
        return s === 'late' || s === 'early';
    });
}

/**
 * Lag of the ranked driver ping vs the timetable ghost.
 * Soft label from ≥1 ping; rewrite clocks only with ≥2 devices or 1 ping + a matching delay report.
 * Apply only to stations the ghost has not reached yet (decorateJourneyLive).
 */
export function computeRideDelta(pings, trainId, opts = {}) {
    const id = String(trainId || '');
    if (!id) return null;
    const ranked = rankVerifiedPings(pings, id, opts);
    if (!ranked.length) return null;

    const ghost = expectedPosition(id, opts.now, opts);
    if (!ghost) return null;

    const winner = ranked[0].ping;
    const lat = typeof winner.projectedLat === 'number' ? winner.projectedLat : null;
    const lng = typeof winner.projectedLng === 'number' ? winner.projectedLng : null;
    if (lat == null || lng == null) return null;
    const lagMinRaw = lagMinutesFromFix(lat, lng, ghost, winner.speedMps, opts.stationIndex);
    if (!Number.isFinite(lagMinRaw)) return null;

    const devices = new Set(ranked.map((r) => r.ping.deviceId || r.ping.uid || `${r.ping.coarseLat},${r.ping.coarseLng}`));
    const routeId = opts.routeId || $currentRouteId.get();
    const hasDelay = matchingDelayReport(id, routeId);
    const rounded = Math.round(lagMinRaw);

    return {
        trainId: id,
        lagMin: rounded,
        pingCount: ranked.length,
        deviceCount: devices.size,
        soft: true,
        rewrite: devices.size >= 2 || (devices.size >= 1 && hasDelay),
        ghost,
        liveHint: liveHint(rounded),
        driver: winner,
    };
}

function liveHint(lagMin) {
    if (!Number.isFinite(lagMin)) return 'Live';
    if (lagMin === 0) return 'Live · on time';
    const abs = Math.abs(lagMin);
    return `Live · ~${abs} min ${lagMin > 0 ? 'late' : 'early'}`;
}

export function getRideDelta(trainId, routeId = $currentRouteId.get()) {
    return computeRideDelta(getCachedRidePings(routeId), trainId, { routeId });
}

/** Live clock decoration for a board card whose selected station is still ahead. */
export function decorateJourneyLive(trainId, station, rawTime, arrivalTime, routeId = $currentRouteId.get()) {
    const delta = getRideDelta(trainId, routeId);
    if (!delta?.ghost) {
        return { useLive: false, liveHint: '', schedNote: '', liveTime: rawTime, liveArrival: arrivalTime || '', ahead: false };
    }
    const ahead = isStationAheadOfGhost(station, delta.ghost);
    if (!ahead) {
        return { useLive: false, liveHint: '', schedNote: '', liveTime: rawTime, liveArrival: arrivalTime || '', ahead: false };
    }
    const liveTime = delta.rewrite ? addMinutesToTime(rawTime, delta.lagMin) : rawTime;
    const liveArrival = (delta.rewrite && arrivalTime) ? addMinutesToTime(arrivalTime, delta.lagMin) : (arrivalTime || '');
    return {
        useLive: !!delta.rewrite,
        liveHint: delta.liveHint,
        schedNote: delta.rewrite ? `Sched ${String(rawTime || '').slice(0, 5)}` : '',
        liveTime,
        liveArrival,
        ahead: true,
        delta,
    };
}

function notifyPingsUpdated(routeId) {
    renderRideSeenChip(routeId);
    paintLiveDirectionHeaders(routeId);
    try {
        window.dispatchEvent(new CustomEvent('nt-ride-pings-updated', { detail: { routeId } }));
    } catch { /* ignore */ }
}

/**
 * People (no train) vs trains on this corridor.
 */
export function summarizeRidePings(pings, focusStation = '') {
    const live = activePings(pings);
    if (!live.length) return null;
    const people = live.filter((p) => !pingTracksTrain(p, p.trainId));
    const trainCounts = {};
    live.forEach((p) => {
        if (!pingTracksTrain(p, p.trainId)) return;
        const k = String(p.trainId);
        trainCounts[k] = (trainCounts[k] || 0) + 1;
    });
    const stationCounts = {};
    people.forEach((p) => {
        const s = p.station || '';
        if (!s) return;
        stationCounts[s] = (stationCounts[s] || 0) + 1;
    });
    const topStations = Object.entries(stationCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([s]) => s);
    const topTrain = Object.entries(trainCounts).sort((a, b) => b[1] - a[1])[0] || null;
    const focus = normalizeStationName(focusStation || '');
    const atFocus = focus
        ? live.filter((p) => normalizeStationName(p.station) === focus).length
        : 0;
    const freshest = [...live].sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    return {
        count: live.length,
        totalLive: live.length,
        peopleCount: people.length,
        trainCount: Object.keys(trainCounts).length,
        topTrainId: topTrain ? topTrain[0] : null,
        topTrainSharing: topTrain ? topTrain[1] : 0,
        topStations,
        station: freshest?.station || topStations[0] || '',
        at: freshest?.at,
        trainId: topTrain ? topTrain[0] : null,
        age: ageLabel(freshest?.at),
        stationCounts,
        atFocus,
    };
}

export async function fetchRouteRidePings(routeId) {
    if (!routeId || !navigator.onLine) return [];
    try {
        // Prefer public read (rules .read: true). A stale ?auth= token makes Firebase
        // REST return 401 even for public paths — fall back without auth.
        const token = await ensureAuthToken();
        const urls = [
            `${DYNAMIC_BASE_URL}ride_pings/${encodeURIComponent(routeId)}.json`,
        ];
        if (token) {
            urls.unshift(`${urls[0]}?auth=${encodeURIComponent(token)}`);
        }
        let data = null;
        for (const url of urls) {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) {
                data = await res.json();
                break;
            }
            if (res.status !== 401 && res.status !== 403) break;
        }
        if (!data || typeof data !== 'object') {
            if (routeId) routeCache[routeId] = [];
            return [];
        }
        const list = activePings(Object.values(data));
        routeCache[routeId] = list;
        return list;
    } catch {
        return [];
    }
}

export async function startRidePingsListener(routeId) {
    if (!routeId) return;
    stopRidePingsListener(routeId);
    await fetchFeatures();
    if (!isRideCheckInEnabled(routeId)) return;

    await bootFirebase();
    if (!window.firebaseDb || !window.firebaseDbRef || !window.firebaseDbOnValue) return;
    if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
        try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
    }

    try {
        const ref = window.firebaseDbRef(window.firebaseDb, `ride_pings/${routeId}`);
        const unsub = window.firebaseDbOnValue(ref, (snap) => {
            const data = snap?.val?.() || null;
            routeCache[routeId] = data ? activePings(Object.values(data)) : [];
            if ($currentRouteId.get() === routeId) {
                notifyPingsUpdated(routeId);
            }
        }, () => stopRidePingsListener(routeId));
        routeListeners[routeId] = typeof unsub === 'function' ? unsub : () => {};
    } catch (e) {
        console.warn('Ride pings listener failed', e);
    }
}

export function stopRidePingsListener(routeId) {
    if (routeId && routeListeners[routeId]) {
        try { routeListeners[routeId](); } catch { /* ignore */ }
        delete routeListeners[routeId];
        return;
    }
    Object.keys(routeListeners).forEach((id) => {
        try { routeListeners[id](); } catch { /* ignore */ }
        delete routeListeners[id];
    });
}

function pingMatchesAccount(p, uid, emailLc) {
    if (!p) return false;
    if (uid && p.uid && p.uid === uid) return true;
    if (emailLc && p.email && String(p.email).toLowerCase() === emailLc) return true;
    return false;
}

async function findConflictingShare({ deviceId, uid, email }) {
    if (!uid && !email) return null;
    const emailLc = email ? String(email).toLowerCase() : '';
    const now = Date.now();
    const matches = (p) => {
        if (!p || p.deviceId === deviceId) return false;
        if ((p.expiresAt || 0) <= now) return false;
        return pingMatchesAccount(p, uid, emailLc);
    };
    for (const list of Object.values(routeCache)) {
        const hit = activePings(list).find(matches);
        if (hit) return hit;
    }
    try {
        const token = await ensureAuthToken();
        const urls = [`${DYNAMIC_BASE_URL}ride_pings.json`];
        if (token) urls.unshift(`${urls[0]}?auth=${encodeURIComponent(token)}`);
        let data = null;
        for (const url of urls) {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) {
                data = await res.json();
                break;
            }
            if (res.status !== 401 && res.status !== 403) break;
        }
        if (!data || typeof data !== 'object') return null;
        for (const nodes of Object.values(data)) {
            if (!nodes || typeof nodes !== 'object') continue;
            const list = Array.isArray(nodes) ? nodes : Object.values(nodes);
            const found = list.find(matches);
            if (found) return found;
        }
    } catch { /* ignore */ }
    return null;
}

async function expireRemoteShare(ping) {
    if (!ping?.routeId || !ping?.deviceId) return { ok: false, message: 'Couldn’t find the other share.' };
    const now = Date.now();
    const payload = {
        routeId: ping.routeId,
        deviceId: ping.deviceId,
        station: ping.station || 'here',
        at: now,
        expiresAt: now,
        appVersion: APP_VERSION,
        source: 'stop_remote',
    };
    if (ping.trainId) payload.trainId = ping.trainId;
    if (ping.waitingFor) payload.waitingFor = ping.waitingFor;
    if (ping.destination) payload.destination = ping.destination;
    if (ping.uid) payload.uid = ping.uid;
    if (ping.email) payload.email = ping.email;
    if (typeof ping.coarseLat === 'number') payload.coarseLat = ping.coarseLat;
    if (typeof ping.coarseLng === 'number') payload.coarseLng = ping.coarseLng;
    if (typeof ping.heading === 'number') payload.heading = ping.heading;
    if (typeof ping.speedMps === 'number') payload.speedMps = ping.speedMps;
    try {
        const token = await ensureAuthToken();
        if (!token) throw new Error('Sign-in required to stop the other share.');
        const res = await fetch(
            `${DYNAMIC_BASE_URL}ride_pings/${encodeURIComponent(ping.routeId)}/${encodeURIComponent(ping.deviceId)}.json?auth=${encodeURIComponent(token)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
        if (!res.ok) throw new Error(permissionMessage(res.status));
        appendRideShareLog({
            action: 'stop',
            routeId: ping.routeId,
            trainId: ping.trainId || null,
            deviceId: ping.deviceId,
            uid: ping.uid,
            email: ping.email,
            source: 'stop_remote',
            at: now,
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, message: e?.message || 'Couldn’t stop the other share' };
    }
}

async function putRideShareLog(region, entryId, payload, token) {
    const res = await fetch(
        `${DYNAMIC_BASE_URL}ride_share_log/${encodeURIComponent(region)}/${encodeURIComponent(entryId)}.json?auth=${encodeURIComponent(token)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }
    );
    return res.ok;
}

async function patchRideShareLog(region, entryId, patch, token) {
    const res = await fetch(
        `${DYNAMIC_BASE_URL}ride_share_log/${encodeURIComponent(region)}/${encodeURIComponent(entryId)}.json?auth=${encodeURIComponent(token)}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        }
    );
    return res.ok;
}

function readShareSession() {
    try {
        return JSON.parse(safeStorage.getItem(SHARE_SESSION_KEY) || 'null');
    } catch {
        return null;
    }
}

function writeShareSession(row) {
    try {
        if (!row) safeStorage.removeItem(SHARE_SESSION_KEY);
        else safeStorage.setItem(SHARE_SESSION_KEY, JSON.stringify(row));
    } catch { /* ignore */ }
}

async function appendRideShareLog({ action, routeId, trainId, deviceId, uid, email, source, at }) {
    if (action === 'onboard_ping') return;
    const fbUid = (typeof window !== 'undefined' && window.firebaseAuth?.currentUser?.uid) || uid || null;
    if (!fbUid || !routeId || !deviceId) return;
    const region = String(ROUTES[routeId]?.region || 'GP');
    const now = at || Date.now();
    const payload = {
        region,
        routeId,
        deviceId,
        uid: fbUid,
        source: source || '',
        at: now,
        appVersion: APP_VERSION,
    };
    if (trainId) payload.trainId = String(trainId);
    if (email) payload.email = String(email);
    try {
        const token = await ensureAuthToken();
        if (!token) return;
        const existing = readShareSession();
        const ownSession = !!(existing && existing.uid === fbUid && existing.id && existing.region);

        if (action === 'stop') {
            if (ownSession) {
                const ok = await patchRideShareLog(existing.region, existing.id, {
                    action: 'session',
                    status: 'stopped',
                    stoppedAt: now,
                    at: now,
                    source: source || 'stop',
                    stopSource: source || 'stop',
                }, token);
                if (ok) {
                    writeShareSession(null);
                    return;
                }
            }
            const entryId = `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            await putRideShareLog(region, entryId, { ...payload, action: 'stop' }, token);
            writeShareSession(null);
            return;
        }

        if (action !== 'start') return;

        if (ownSession) {
            const patch = {
                action: 'session',
                status: 'live',
                at: now,
                source: source || existing.source || '',
                routeId,
            };
            if (trainId) patch.trainId = String(trainId);
            const ok = await patchRideShareLog(existing.region, existing.id, patch, token);
            if (ok) {
                writeShareSession({
                    ...existing,
                    routeId,
                    trainId: trainId || existing.trainId || '',
                });
                return;
            }
        }
        const entryId = `ls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const sessionPayload = { ...payload, action: 'session', status: 'live', startedAt: now };
        let ok = await putRideShareLog(region, entryId, sessionPayload, token);
        if (!ok) {
            ok = await putRideShareLog(region, entryId, { ...payload, action: 'start' }, token);
        }
        if (ok) {
            writeShareSession({
                id: entryId,
                region,
                uid: fbUid,
                deviceId,
                routeId,
                trainId: trainId || '',
                startedAt: now,
            });
        }
    } catch { /* optional history */ }
}

/**
 * Share a ride from the current station / optional train (no continuous GPS).
 */
export async function submitRideCheckIn({
    routeId = $currentRouteId.get(),
    station,
    trainId = null,
    destination = null,
    coarseLat = null,
    coarseLng = null,
    heading = null,
    speedMps = null,
    accuracy = null,
    source = 'board_checkin',
    waitingFor = null,
    quiet = false,
    trackingState = null,
    pauseReason = '',
    adminOverrideRole = '',
    overrideProjected = null,
} = {}) {
    await fetchFeatures();
    if (!isRideCheckInEnabled(routeId)) {
        return { ok: false, message: 'Ride sharing isn’t on for this corridor yet.' };
    }
    let st = (station || document.getElementById('station-select')?.value || '').trim();
    if (!st && typeof coarseLat === 'number' && typeof coarseLng === 'number') {
        st = nearestStationOnRoute(coarseLat, coarseLng, routeId)?.stationName || '';
    }
    if (!routeId) return { ok: false, message: 'Pick a corridor first.' };
    if (source !== 'onboard_ping' && source !== 'stop' && source !== 'onboard_off_path' && routeHasNoScheduledTrains()) {
        return { ok: false, message: 'There are no trains to share today.' };
    }
    if (!st && relaxLiveShareGuards()) st = 'here';
    if (!st) return { ok: false, message: 'Pick a station or allow location.' };
    if (!navigator.onLine) return { ok: false, message: 'You appear offline.' };

    const deviceId = getDeviceId();
    const now = Date.now();
    const acct = $account.get();
    const uid = acct.status === 'signed-in' ? acct.uid : null;
    const email = acct.status === 'signed-in' ? (acct.email || null) : null;
    const trustedAdminOverride = isAdminAuthed() && (adminOverrideRole === 'train' || adminOverrideRole === 'person')
        ? adminOverrideRole
        : '';
    if (source !== 'onboard_ping' && source !== 'stop' && source !== 'onboard_off_path') {
        const clash = await findConflictingShare({ deviceId, uid, email });
        if (clash) {
            const trainBit = clash.trainId ? ` Train ${clash.trainId}` : '';
            const { promptOnTrainSheet } = await import('./map-tab.js');
            const choice = await promptOnTrainSheet({
                title: 'Already sharing elsewhere',
                body: `You’re already sharing${trainBit} on another device. Stop that share and continue here?`,
                primary: 'Stop the other share',
                secondary: 'Keep the other share',
            });
            if (choice !== 'primary') {
                return { ok: false, cancelled: true, message: 'Still sharing on the other device.' };
            }
            const stopped = await expireRemoteShare(clash);
            if (!stopped.ok) return { ok: false, message: stopped.message };
        }
    }
    const previous = peekStoredShare();
    let projection = null;
    let resolvedState = trackingState;
    let resolvedPauseReason = pauseReason;
    if (trainId && trustedAdminOverride === 'train' && !overrideProjected && Number.isFinite(coarseLat) && Number.isFinite(coarseLng)) {
        const path = await railPathForTrain(trainId, { routeId, region: ROUTES[routeId]?.region || 'GP' });
        overrideProjected = scoreFixToRailPath(coarseLat, coarseLng, path);
    }
    if (trainId && !resolvedState) {
        const previousProgress = previous?.routeId === routeId && String(previous?.trainId || '') === String(trainId)
            ? previous.projectedProgress
            : null;
        projection = await projectTrainTrackerFix({
            lat: coarseLat,
            lng: coarseLng,
            trainId,
            routeId,
            previousProgress,
        });
        resolvedState = projection.ok ? TRACKING_STATE.ACTIVE : TRACKING_STATE.PAUSED;
        resolvedPauseReason = projection.ok ? '' : projection.reason;
    }
    if (trainId && trustedAdminOverride === 'train' && overrideProjected) {
        projection = {
            ok: true,
            projectedLat: roundCoord(overrideProjected.lat),
            projectedLng: roundCoord(overrideProjected.lon),
            projectedProgress: Number.isFinite(overrideProjected.pathFraction) ? overrideProjected.pathFraction : 0,
            routeProgressM: Number.isFinite(overrideProjected.routeM) ? overrideProjected.routeM : 0,
            distanceM: Number.isFinite(overrideProjected.distanceM) ? overrideProjected.distanceM : 0,
            lastSeenLabel: st,
            bearing: Number.isFinite(heading) ? heading : null,
        };
        resolvedState = TRACKING_STATE.ACTIVE;
        resolvedPauseReason = '';
    }
    if (!resolvedState) resolvedState = TRACKING_STATE.ACTIVE;
    const payload = {
        routeId,
        deviceId,
        station: st,
        trainId: trainId || null,
        waitingFor: waitingFor || null,
        destination: destination || null,
        at: now,
        expiresAt: now + RIDE_SHARE_IDLE_MS,
        uid,
        email,
        coarseLat: typeof coarseLat === 'number' ? Math.round(coarseLat * 1000) / 1000 : null,
        coarseLng: typeof coarseLng === 'number' ? Math.round(coarseLng * 1000) / 1000 : null,
        heading: typeof heading === 'number' ? Math.round(heading) : null,
        speedMps: typeof speedMps === 'number' ? Math.round(speedMps * 10) / 10 : null,
        accuracy: typeof accuracy === 'number' ? Math.round(accuracy) : null,
        appVersion: APP_VERSION,
        source: source || 'board_checkin',
        trackingState: resolvedState,
    };
    if (trustedAdminOverride) payload.adminOverrideRole = trustedAdminOverride;
    if (resolvedPauseReason) payload.pauseReason = resolvedPauseReason;
    if (projection?.ok) {
        payload.projectedLat = projection.projectedLat;
        payload.projectedLng = projection.projectedLng;
        payload.projectedProgress = projection.projectedProgress;
        payload.routeProgressM = Math.round(projection.routeProgressM);
        payload.railDistanceM = Math.round(projection.distanceM);
        payload.acceptedAt = now;
        payload.lastSeenLabel = projection.lastSeenLabel || st;
        if (Number.isFinite(projection.bearing)) payload.bearing = Math.round(projection.bearing);
    } else if (resolvedState === TRACKING_STATE.PAUSED && previous) {
        for (const key of ['projectedLat', 'projectedLng', 'projectedProgress', 'routeProgressM', 'railDistanceM', 'acceptedAt', 'lastSeenLabel', 'bearing']) {
            if (previous[key] != null) payload[key] = previous[key];
        }
    }

    try {
        const token = await ensureAuthToken();
        if (!token) throw new Error('Sign-in required to share (anonymous is fine).');
        const authParam = `?auth=${encodeURIComponent(token)}`;
        const res = await fetch(
            `${DYNAMIC_BASE_URL}ride_pings/${encodeURIComponent(routeId)}/${encodeURIComponent(deviceId)}.json${authParam}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
        if (!res.ok) throw new Error(permissionMessage(res.status));
        safeStorage.setItem(ACTIVE_KEY, JSON.stringify({
            routeId, station: st, trainId: trainId || null, destination: destination || null,
            at: now, lastPingAt: now, startedAt: previous?.startedAt || now, expiresAt: payload.expiresAt,
            trackingState: payload.trackingState, pauseReason: payload.pauseReason || '',
            projectedLat: payload.projectedLat, projectedLng: payload.projectedLng,
            projectedProgress: payload.projectedProgress, routeProgressM: payload.routeProgressM,
            railDistanceM: payload.railDistanceM,
            acceptedAt: payload.acceptedAt, lastSeenLabel: payload.lastSeenLabel, bearing: payload.bearing,
            accuracy: payload.accuracy,
            adminOverrideRole: payload.adminOverrideRole || '',
            source: payload.source,
        }));
        startShareIdleWatch();
        const existing = getCachedRidePings(routeId).filter((p) => p.deviceId !== deviceId);
        routeCache[routeId] = activePings([payload, ...existing]);
        if (source !== 'onboard_ping' && source !== 'stop' && source !== 'onboard_off_path') {
            appendRideShareLog({
                action: 'start',
                routeId,
                trainId: trainId || null,
                deviceId,
                uid,
                email,
                source: source || 'board_checkin',
                at: now,
            });
        }
        const toastMsg = trainId
            ? `Others can see ${trainId}${destination ? ` → ${stationShort(destination)}` : ''}`
            : waitingFor
                ? `You’re visible as a commuter - not on train ${waitingFor} yet`
                : `You’re visible at ${stationShort(st)}`;
        const others = activePings(getCachedRidePings(routeId))
            .filter((p) => String(p.trainId || '') === String(trainId || '') && p.deviceId !== deviceId);
        awardShareMarks({
            joinedLive: !!(trainId && others.length > 0),
            confirmedCloser: source === 'closer_confirm',
            trainId: trainId || '',
        });
        if (!quiet) showToast(toastMsg, 'success');
        notifyPingsUpdated(routeId);
        return { ok: true, ping: payload };
    } catch (e) {
        return { ok: false, message: e?.message || 'Couldn’t share your location' };
    }
}

export async function stopRideShare({ quiet = false, reason = '' } = {}) {
    const active = peekStoredShare();
    const routeId = active?.routeId || $currentRouteId.get();
    const deviceId = getDeviceId();
    if (!routeId || !deviceId) return { ok: false };
    const station = active?.station || document.getElementById('station-select')?.value || 'Unknown';
    const now = Date.now();
    const payload = {
        routeId,
        deviceId,
        station,
        trainId: active?.trainId || null,
        at: now,
        expiresAt: now,
        appVersion: APP_VERSION,
        source: 'stop',
        trackingState: TRACKING_STATE.STOPPED,
    };
    for (const key of ['projectedLat', 'projectedLng', 'projectedProgress', 'routeProgressM', 'railDistanceM', 'acceptedAt', 'lastSeenLabel', 'bearing']) {
        if (active?.[key] != null) payload[key] = active[key];
    }
    try {
        const token = await ensureAuthToken();
        if (!token) throw new Error('Couldn’t stop sharing');
        const res = await fetch(
            `${DYNAMIC_BASE_URL}ride_pings/${encodeURIComponent(routeId)}/${encodeURIComponent(deviceId)}.json?auth=${encodeURIComponent(token)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
        if (!res.ok) throw new Error(permissionMessage(res.status));
        safeStorage.removeItem(ACTIVE_KEY);
        stopOnboardPingLoop();
        stopShareIdleWatch();
        appendRideShareLog({
            action: 'stop',
            routeId,
            trainId: active?.trainId || null,
            deviceId,
            uid: $account.get().status === 'signed-in' ? $account.get().uid : null,
            email: $account.get().status === 'signed-in' ? ($account.get().email || null) : null,
            source: reason ? `stop_${reason}` : 'stop',
            at: now,
        });
        notifyPingsUpdated(routeId);
        import('./map-tab.js').then((m) => m.clearTripWatch?.()).catch(() => {});
        if (!quiet) {
            const msg = reason === 'terminus'
                ? 'Sharing ended at the last station'
                : reason === 'idle'
                    ? 'Sharing ended after 30 minutes idle'
                    : 'Sharing ended';
            showToast(msg, 'info');
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, message: e?.message || 'Couldn’t stop sharing' };
    }
}

let onboardPingTimer = 0;
let onboardPromptInFlight = false;

export function stopOnboardPingLoop() {
    if (onboardPingTimer) {
        clearInterval(onboardPingTimer);
        onboardPingTimer = 0;
    }
}

async function pauseActiveTracker(active, reason, pos = null) {
    const paused = {
        ...active,
        trackingState: TRACKING_STATE.PAUSED,
        pauseReason: reason,
        at: Date.now(),
    };
    safeStorage.setItem(ACTIVE_KEY, JSON.stringify(paused));
    if (!navigator.onLine) return { ok: false, offline: true };
    return submitRideCheckIn({
        routeId: active.routeId,
        station: active.station,
        trainId: active.trainId,
        destination: active.destination || null,
        coarseLat: pos?.lat ?? active.projectedLat ?? null,
        coarseLng: pos?.lng ?? active.projectedLng ?? null,
        heading: pos?.heading ?? null,
        speedMps: pos?.speedMps ?? null,
        accuracy: pos?.accuracy ?? active.accuracy ?? null,
        source: 'onboard_paused',
        quiet: true,
        trackingState: TRACKING_STATE.PAUSED,
        pauseReason: reason,
        adminOverrideRole: active.adminOverrideRole || '',
    });
}

/** While attached to a train, refresh the ping so others see movement. */
export function startOnboardPingLoop() {
    stopOnboardPingLoop();
    startShareIdleWatch();
    const tick = async () => {
        if (await stopShareIfIdle()) return;
        const active = getActiveShare();
        if (!active?.trainId) {
            stopOnboardPingLoop();
            return;
        }
        if (typeof document !== 'undefined' && document.hidden) {
            if (active.trackingState !== TRACKING_STATE.PAUSED || active.pauseReason !== 'staleGps') {
                await pauseActiveTracker(active, 'staleGps');
            }
            return;
        }
        if (!navigator.onLine) {
            if (active.trackingState !== TRACKING_STATE.PAUSED || active.pauseReason !== 'offline') {
                await pauseActiveTracker(active, 'offline');
            }
            return;
        }
        try {
            const pos = await oneShotGps();
            const near = nearestStationOnRoute(pos.lat, pos.lng, active.routeId);
            if (shareReachedTerminus(active.trainId, pos.lat, pos.lng, near?.stationName || active.station)) {
                await stopRideShare({ reason: 'terminus' });
                return;
            }
            if (active.adminOverrideRole === 'train' && isAdminAuthed()) {
                await submitRideCheckIn({
                    routeId: active.routeId,
                    station: near?.stationName || active.station,
                    trainId: active.trainId,
                    destination: active.destination || null,
                    coarseLat: pos.lat,
                    coarseLng: pos.lng,
                    heading: pos.heading,
                    speedMps: pos.speedMps,
                    accuracy: pos.accuracy,
                    source: 'admin_override_train',
                    quiet: true,
                    adminOverrideRole: 'train',
                });
                return;
            }
            const projection = await projectTrainTrackerFix({
                lat: pos.lat,
                lng: pos.lng,
                trainId: active.trainId,
                routeId: active.routeId,
                previousProgress: active.projectedProgress,
            });
            const offPath = !projection.ok;
            if (offPath) {
                if (onboardPromptInFlight) return;
                onboardPromptInFlight = true;
                stopOnboardPingLoop();
                try {
                    await pauseActiveTracker(active, projection.reason, pos);
                    const { promptOnTrainSheet, startOnTrainShare } = await import('./map-tab.js');
                    const choice = await promptOnTrainSheet({
                        title: 'Still on this train?',
                        body: `You’re no longer on the path for Train ${active.trainId}. Are you still on it?`,
                        primary: 'Yes, still on it',
                        secondary: 'Just show me as a person',
                        tertiary: 'Stop sharing',
                    });
                    if (choice === 'primary') {
                        await startOnTrainShare({
                            trainId: active.trainId,
                            station: near?.stationName || active.station,
                            destination: active.destination || '',
                            routeId: active.routeId,
                            source: 'onboard_revet',
                            skipVolunteer: true,
                        });
                    } else if (choice === 'tertiary') {
                        await stopRideShare({ reason: 'off_path' });
                    }
                } finally {
                    onboardPromptInFlight = false;
                }
                return;
            }
            await submitRideCheckIn({
                routeId: active.routeId,
                station: near?.stationName || active.station,
                trainId: active.trainId,
                destination: active.destination || null,
                coarseLat: pos.lat,
                coarseLng: pos.lng,
                heading: pos.heading,
                speedMps: pos.speedMps,
                accuracy: pos.accuracy,
                source: 'onboard_ping',
                quiet: true,
            });
        } catch {
            await pauseActiveTracker(active, 'fixFailure');
        }
    };
    onboardPingTimer = setInterval(tick, 45000);
}

/**
 * Anyone on the corridor: one GPS fix, no train required.
 * After a share, open Trains near you so they can attach if they’re close.
 */
export async function startPresenceShare({
    source = 'board_presence',
    skipVolunteer = false,
    openNearby = true,
} = {}) {
    const { LIVE_LOCATION_SHARE_UI_ENABLED } = await import('./map-tab.js');
    if (!LIVE_LOCATION_SHARE_UI_ENABLED) {
        return { ok: false, disabled: true };
    }
    triggerHaptic();
    const routeId = $currentRouteId.get();
    if (!routeId) {
        showToast('Pick a corridor first', 'error');
        return { ok: false };
    }
    await fetchFeatures();
    if (!isRideCheckInEnabled(routeId)) {
        showToast('Live sharing isn’t on for this corridor yet', 'error');
        return { ok: false };
    }

    const existing = getActiveShare();
    if (existing) {
        showToast('Already visible on this device', 'info');
        return { ok: true, already: true };
    }

    if (!skipVolunteer) {
        const { promptOnTrainSheet } = await import('./map-tab.js');
        const choice = await promptOnTrainSheet({
            title: 'Show others where you are?',
            body: 'Share a rough location so others on this corridor can see you. You don’t have to be on a train. Stop when you are done, or sharing ends at the last station.',
            primary: 'Show where I am',
            secondary: 'Not now',
        });
        if (choice !== 'primary') return { ok: false, cancelled: true };
    }

    let coords = null;
    try {
        coords = await oneShotGps();
    } catch (e) {
        if (e?.code === 1) {
            showToast('Location is off - we can’t show you on the map', 'error');
        }
    }

    let station = document.getElementById('station-select')?.value || '';
    if (coords) {
        const near = nearestStationOnRoute(coords.lat, coords.lng, routeId);
        if (near && (!station || near.distKm < 3)) station = near.stationName;
    }

    const result = await submitRideCheckIn({
        routeId,
        station,
        trainId: null,
        coarseLat: coords?.lat ?? null,
        coarseLng: coords?.lng ?? null,
        heading: coords?.heading,
        speedMps: coords?.speedMps,
        source,
    });
    if (!result.ok) {
        if (result.message) showToast(result.message, 'error');
        return result;
    }

    if (coords && openNearby) {
        try {
            const { openNearbyTrainsModal } = await import('./map-tab.js');
            openNearbyTrainsModal({ lat: coords.lat, lng: coords.lng });
        } catch { /* optional */ }
    }

    try {
        const { syncRidePingsToMap } = await import('./map-tab.js');
        syncRidePingsToMap?.(routeId);
    } catch { /* map tab optional */ }

    return result;
}

function syncRidePresenceRow() {
    const row = document.getElementById('ride-presence-row');
    if (!row) return;
    const nearbyBtn = document.getElementById('ride-nearby-btn');
    const chip = document.getElementById('ride-seen-chip');
    const nearbyShown = !!(nearbyBtn && !nearbyBtn.classList.contains('hidden') && isAdminAuthed());
    const chipShown = !!(chip && !chip.classList.contains('hidden') && (chip.innerHTML || '').trim());
    row.hidden = !(nearbyShown || chipShown);
}

export function renderRideSeenChip(routeId = $currentRouteId.get()) {
    const host = document.getElementById('ride-seen-chip');
    const cta = document.getElementById('ride-checkin-btn');
    if (!host) return;

    const mine = getActiveShare();
    if (!mine && peekStoredShare()) stopShareIfIdle();
    if (!isRideCheckInEnabled(routeId) && !mine) {
        host.classList.add('hidden');
        host.innerHTML = '';
        cta?.classList.add('hidden');
        document.getElementById('ride-nearby-btn')?.classList.add('hidden');
        paintLiveDirectionHeaders(routeId);
        syncRidePresenceRow();
        return;
    }

    cta?.classList.add('hidden');
    if (isAdminAuthed()) document.getElementById('ride-nearby-btn')?.classList.remove('hidden');
    else document.getElementById('ride-nearby-btn')?.classList.add('hidden');
    paintLiveDirectionHeaders(routeId);

    if (mine) {
        host.classList.add('hidden');
        host.innerHTML = '';
        syncRidePresenceRow();
        return;
    }

    host.classList.add('hidden');
    host.innerHTML = '';
    syncRidePresenceRow();
}

export async function refreshRideSeenSurface(routeId = $currentRouteId.get()) {
    await fetchFeatures();
    if (!isRideCheckInEnabled(routeId)) {
        renderRideSeenChip(routeId);
        stopRidePingsListener(routeId);
        return;
    }
    if (!routeListeners[routeId]) startRidePingsListener(routeId);
    const fetched = await fetchRouteRidePings(routeId);
    if (fetched.length || !routeCache[routeId]?.length) {
        routeCache[routeId] = fetched;
    }
    notifyPingsUpdated(routeId);
}

export function setDirectionHeaderLabel(headerEl, destUpper) {
    if (!headerEl) return;
    headerEl.classList.add('flex', 'items-center', 'justify-center', 'gap-1.5', 'flex-wrap');
    let span = headerEl.querySelector('[data-header-dest]');
    if (!span) {
        const existing = headerEl.querySelector('.text-blue-500, .text-blue-400');
        const label = destUpper || existing?.textContent || '…';
        headerEl.innerHTML = `Next train to <span data-header-dest class="text-blue-500 dark:text-blue-400">${escapeHTML(label)}</span>`;
        span = headerEl.querySelector('[data-header-dest]');
    } else if (destUpper) {
        span.textContent = destUpper;
    }
}

export function paintLiveDirectionHeaders(routeId = $currentRouteId.get()) {
    void routeId;
}

function hideLiveTrackerSheet() {
    document.getElementById('nt-live-tracker-modal')?.classList.add('hidden');
    document.getElementById('nt-live-tracker-stop')?.classList.add('hidden');
}

function trackerStopRow(stop, { pin, first, last }) {
    const name = escapeHTML(String(stop.station || '').replace(/ STATION$/i, ''));
    const time = escapeHTML(formatTimeDisplay(stop.time) || String(stop.time || '').slice(0, 5));
    const textClass = last
        ? 'text-gray-900 dark:text-white font-bold'
        : first
            ? 'text-gray-900 dark:text-white font-bold'
            : 'text-gray-700 dark:text-gray-300 font-medium';
    const marker = pin
        ? '<span class="absolute -left-[3px] top-1.5 w-1 h-5 rounded bg-green-500" aria-hidden="true"></span>'
        : `<span class="absolute -left-[3px] top-2 w-1 h-4 rounded ${last ? 'bg-red-500' : 'bg-blue-500'}" aria-hidden="true"></span>`;
    return `<div class="flex justify-between text-xs py-1.5 relative pl-5">
        ${marker}
        <span class="${textClass}">${name}</span>
        <span class="font-mono ${textClass}">${time}</span>
    </div>`;
}

function liveBetweenRow() {
    return `<div class="flex items-center gap-2 text-[11px] font-bold text-green-700 dark:text-green-400 py-1 relative pl-5">
        <span class="absolute -left-[3px] top-1 w-1 h-5 rounded bg-green-500" aria-hidden="true"></span>
        Live here
    </div>`;
}

export function openLiveTrackerSheet(trainId, routeId = $currentRouteId.get()) {
    const modal = document.getElementById('nt-live-tracker-modal');
    const list = document.getElementById('nt-live-tracker-list');
    const title = document.getElementById('nt-live-tracker-title');
    const sub = document.getElementById('nt-live-tracker-sub');
    if (!modal || !list || !trainId) return;
    if (!canSeeLiveShareChrome(routeId) && !iAmSharingTrain(trainId, routeId)) return;

    triggerHaptic();
    const id = String(trainId);
    const ranked = rankVerifiedPings(getCachedRidePings(routeId), id);
    const { stops } = findStopsForTrain(id);
    const driver = ranked[0]?.ping;
    const route = ROUTES[routeId];
    const dest = destinationForTrain(id, route) || '';
    if (title) title.textContent = trainGoingLabel(id, dest);
    const iAmSharing = iAmSharingTrain(id, routeId);
    if (sub) {
        sub.textContent = ranked.length
            ? `${sharingStatusCopy({ count: ranked.length, iAmSharing })} · clock follows the closest heading match`
            : 'No verified live share on this train right now';
    }
    const stop = document.getElementById('nt-live-tracker-stop');
    if (stop) stop.classList.toggle('hidden', !iAmSharing);

    if (!stops.length) {
        list.innerHTML = '<p class="text-sm font-semibold text-gray-500 dark:text-gray-400 text-center py-6">No station list for this train.</p>';
        modal.classList.remove('hidden');
        return;
    }

    const driverProg = (driver && typeof driver.projectedProgress === 'number')
        ? driver.projectedProgress
        : null;
    const lastIdx = driverProg == null ? -1 : Math.floor(driverProg);
    const frac = driverProg == null ? 0 : driverProg - lastIdx;
    const onStation = driverProg != null && (frac < 0.12 || frac > 0.88);
    const pinStationIdx = !onStation
        ? -1
        : (frac > 0.88 ? Math.min(stops.length - 1, lastIdx + 1) : lastIdx);

    let html = '<div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2 space-y-0">';
    stops.forEach((stop, i) => {
        html += trackerStopRow(stop, {
            pin: onStation && i === pinStationIdx,
            first: i === 0,
            last: i === stops.length - 1,
        });
        if (!onStation && driverProg != null && i === lastIdx) {
            html += liveBetweenRow();
        }
    });
    html += '</div>';
    list.innerHTML = html;
    modal.classList.remove('hidden');
}

export function bindRideCheckInUi() {
    if (typeof document === 'undefined' || window.__ntRideCheckInBound) return;
    window.__ntRideCheckInBound = true;

    document.getElementById('ride-checkin-btn')?.addEventListener('click', async () => {
        triggerHaptic();
        const action = document.getElementById('ride-checkin-btn')?.getAttribute('data-presence-action');
        if (action === 'stop' || getActiveShare()) {
            const result = await stopRideShare();
            if (!result.ok && result.message) showToast(result.message, 'error');
            return;
        }
        await startPresenceShare({ source: 'board_presence' });
    });

    document.getElementById('ride-nearby-btn')?.addEventListener('click', () => {
        if (!isAdminAuthed()) return;
        triggerHaptic();
        import('./map-tab.js').then((m) => m.openNearbyTrainsModal()).catch(() => {});
    });

    document.addEventListener('click', (e) => {
        const people = e.target.closest?.('[data-focus-map]');
        if (people) {
            e.preventDefault();
            import('./ui.js').then((m) => m.switchTab?.('map')).catch(() => {});
            return;
        }
        const onTrain = e.target.closest?.('[data-on-train]');
        if (onTrain) {
            e.preventDefault();
            import('./map-tab.js').then((m) => m.startOnTrainShare({
                trainId: onTrain.getAttribute('data-on-train'),
                station: onTrain.getAttribute('data-station') || document.getElementById('station-select')?.value || '',
                destination: onTrain.getAttribute('data-dest') || '',
                routeId: onTrain.getAttribute('data-route') || $currentRouteId.get(),
                source: 'board_on_train',
                scheduledTime: onTrain.getAttribute('data-time') || '',
            })).catch(() => {});
        }
    });

    window.addEventListener('nt-locate-fix', (ev) => {
        const detail = ev?.detail;
        if (!detail || detail.isAuto) return;
        import('./map-tab.js').then((m) => m.maybePromptLocateOnTrain(detail)).catch(() => {});
    });

    let lastRoute = '';
    $currentRouteId.subscribe((id) => {
        if (lastRoute && lastRoute !== id) stopRidePingsListener(lastRoute);
        lastRoute = id || '';
        if (id) refreshRideSeenSurface(id);
    });

    document.getElementById('station-select')?.addEventListener('change', () => {
        renderRideSeenChip($currentRouteId.get());
    });

    window.addEventListener('nt-features-updated', () => {
        refreshRideSeenSurface($currentRouteId.get());
    });

    document.getElementById('nt-live-tracker-close')?.addEventListener('click', hideLiveTrackerSheet);
    document.getElementById('nt-live-tracker-dismiss')?.addEventListener('click', hideLiveTrackerSheet);
    document.getElementById('nt-live-tracker-stop')?.addEventListener('click', async () => {
        const result = await stopRideShare();
        if (!result.ok && result.message) showToast(result.message, 'error');
        hideLiveTrackerSheet();
    });
    document.getElementById('nt-live-tracker-modal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'nt-live-tracker-modal') hideLiveTrackerSheet();
    });

    fetchFeatures().then(() => refreshRideSeenSurface($currentRouteId.get())).catch(() => {});
}

if (typeof window !== 'undefined') {
    window.submitRideCheckIn = submitRideCheckIn;
    window.startPresenceShare = startPresenceShare;
    window.stopRideShare = stopRideShare;
    window.refreshRideSeenSurface = refreshRideSeenSurface;
    window.renderRideSeenChip = renderRideSeenChip;
    window.bindRideCheckInUi = bindRideCheckInUi;
    window.computeRideDelta = computeRideDelta;
    window.getRideDelta = getRideDelta;
    window.decorateJourneyLive = decorateJourneyLive;
    window.rankVerifiedPings = rankVerifiedPings;
    window.paintLiveDirectionHeaders = paintLiveDirectionHeaders;
    window.liveTrainIdsForRoute = liveTrainIdsForRoute;
    window.openLiveTrackerSheet = openLiveTrackerSheet;
    window.setDirectionHeaderLabel = setDirectionHeaderLabel;
    window.getCachedRidePings = getCachedRidePings;
    window.stopShareIfIdle = stopShareIfIdle;
    window.compactPingsForMap = compactPingsForMap;
    window.nearestStationOnRoute = nearestStationOnRoute;
    window.canSeeLiveShareChrome = canSeeLiveShareChrome;
    window.sharingStatusCopy = sharingStatusCopy;
}
