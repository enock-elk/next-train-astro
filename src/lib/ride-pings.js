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
    alignBearingToJourney,
    findStopsForTrain,
    progressAlongStops,
    progressAlongStopsDetailed,
    journeyHeadingAtProgress,
    journeyHeadingDeg,
    journeyPositionLabel,
    trainGoingLabel,
    trainTerminusName,
    railPathForTrain,
    scoreFixToRailPath,
    coordsForStation,
    haversineM,
} from './train-ghosts.js';
import { TRACKER_SNAP_MAX_M } from './rail-tracks.js';
import { peekCachedRouteReports, isReportStillLive, routeHasNoScheduledTrains } from './delay-reports.js';
import { awardShareMarks } from './rider-marks.js';
import {
    formatGpsPingAge,
    formatGpsPingClock,
    formatLastSeenWithPingClock,
    gpsPingSuccessAt,
    isRidePingGpsStale,
    RIDE_GPS_STALE_MS,
    RIDE_INTERPOLATION_MAX_MS,
} from './gps-freshness.js';
import {
    imuPredictFromGpsAnchor,
    IMU_LOCAL_TICK_MS,
    peekMotionFusion,
    readPingMotionClass,
    requestMotionPermission,
    startMotionFusion,
    stopMotionFusion,
} from './motion-fusion.js';

/** Sliding share TTL. Last successful ping + this window, then the session ends. */
export const RIDE_SHARE_IDLE_MS = 30 * 60 * 1000;
/** Alias kept for callers / verifies: idle window is the write TTL. */
export const RIDE_PING_TTL_MS = RIDE_SHARE_IDLE_MS;
export {
    formatGpsPingAge,
    formatGpsPingClock,
    formatLastSeenWithPingClock,
    gpsPingSuccessAt,
    isRidePingGpsStale,
    RIDE_GPS_STALE_MS,
    RIDE_INTERPOLATION_MAX_MS,
};
/** Pause, then drop the train share if the rider stays off the rails this long. */
export const RIDE_OFFTRACK_GRACE_MS = 3 * 60 * 1000;
/** Drop immediately if GPS is this far from the selected rail, even inside the grace window. */
export const RIDE_OFFTRACK_HARD_M = 400;
/** After “I’m still on it”, skip another off-track drop prompt for this long. */
export const RIDE_OFFTRACK_STAY_MS = 5 * 60 * 1000;
const SESSION_POINTS_KEY = 'nt_ride_share_session_points';

/** Pause vs drop while a regular rider is sharing as a train. */
export function offTrackShareDecision({ offTrackSince = 0, distanceM = null, now = Date.now() } = {}) {
    if (Number.isFinite(distanceM) && distanceM >= RIDE_OFFTRACK_HARD_M) return 'drop_far';
    if (offTrackSince && (now - Number(offTrackSince) >= RIDE_OFFTRACK_GRACE_MS)) return 'drop_grace';
    return 'pause';
}

function readSessionPoints() {
    const n = Number(safeStorage.getItem(SESSION_POINTS_KEY) || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function addSessionPoints(added) {
    const n = Number(added) || 0;
    if (n <= 0) return readSessionPoints();
    const next = readSessionPoints() + n;
    safeStorage.setItem(SESSION_POINTS_KEY, String(next));
    return next;
}

function clearSessionPoints() {
    safeStorage.removeItem(SESSION_POINTS_KEY);
}
export const TRACKING_STATE = Object.freeze({
    ACTIVE: 'active',
    PAUSED: 'paused',
    STOPPED: 'stopped',
});
const REVERSE_PROGRESS_TOLERANCE = 0.08;
const CONSENSUS_MIN_BAND = 0.2;
const ACTIVE_KEY = 'ridePingActiveV1';
const SHARE_SESSION_KEY = 'nt_ride_share_session';
/** Test cadence: publish every 4s so a ping can land before the 15s glide/grey cap. */
export const ONBOARD_FAST_PING_MS = 4 * 1000;
export const ONBOARD_MOVING_PING_MS = 4 * 1000;
export const ONBOARD_STATIONARY_PING_MS = 4 * 1000;
const DIRECTION_CONFLICT_MIN_SAMPLES = 3;
const DIRECTION_CONFLICT_MIN_MS = 20 * 1000;

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

export const TERMINUS_APPROACH_SLACK = 0.12;
export const TERMINUS_TRAVELED_SLACK = 0.5;
export const TERMINUS_PLATFORM_M = 120;
export const TERMINUS_LEAVE_M = 150;
export const TERMINUS_ARRIVAL_FRACTION = 0.88;

/**
 * End the share only after the rider has actually travelled toward the last
 * stop. Sitting at the terminus when sharing starts (admin test, wait at
 * Pretoria, attach on arrival) must not kill the session on the first GPS tick.
 */
export function terminusStopShouldFire({
    atLast = false,
    lastIndex = 0,
    minProgressSeen = null,
} = {}) {
    if (!atLast) return false;
    if (!Number.isFinite(lastIndex) || lastIndex < 1) return false;
    if (!Number.isFinite(minProgressSeen)) return false;
    return minProgressSeen < lastIndex - TERMINUS_TRAVELED_SLACK;
}

/** True only on the last platform, not midway on the last hop (Mears → Pretoria). */
export function atTerminusPlatform({
    nearestIsLast = false,
    progress = null,
    lastIndex = 0,
    distanceToLastM = null,
} = {}) {
    if (!nearestIsLast) return false;
    if (Number.isFinite(distanceToLastM) && distanceToLastM <= TERMINUS_PLATFORM_M) return true;
    if (Number.isFinite(progress) && Number.isFinite(lastIndex) && lastIndex >= 1) {
        return progress >= lastIndex - (1 - TERMINUS_ARRIVAL_FRACTION);
    }
    return false;
}

export function shouldPromptLeftTrain({
    arrivedAtTerminus = false,
    distanceToLastM = null,
    leftPrompted = false,
} = {}) {
    if (!arrivedAtTerminus || leftPrompted) return false;
    return Number.isFinite(distanceToLastM) && distanceToLastM > TERMINUS_LEAVE_M;
}

export function remainingCorridorTerminusFromStops(stops, routeId) {
    const route = ROUTES[routeId];
    if (!route || !stops?.length) return null;
    const lastN = normalizeStationName(stops[stops.length - 1]?.station);
    if (!lastN) return null;
    if (lastN === normalizeStationName(route.destA) || lastN === normalizeStationName(route.destB)) {
        return null;
    }
    const firstN = normalizeStationName(stops[0]?.station);
    if (firstN === normalizeStationName(route.destA)) return route.destB;
    if (firstN === normalizeStationName(route.destB)) return route.destA;
    return route.destB || null;
}

export function trainEndsAtStation(trainId, stationName) {
    const { stops } = findStopsForTrain(String(trainId || ''));
    if (!stops.length || !stationName) return false;
    return normalizeStationName(stops[stops.length - 1]?.station) === normalizeStationName(stationName);
}

function shareProgressAlongTrain(trainId, lat, lng) {
    const { stops } = findStopsForTrain(String(trainId || ''));
    if (!stops.length || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { stops, progress: null, lastIndex: Math.max(0, stops.length - 1) };
    }
    return {
        stops,
        progress: progressAlongStops(lat, lng, stops, $globalStationIndex.get() || {}),
        lastIndex: stops.length - 1,
    };
}

function distanceToLastStopM(trainId, lat, lng) {
    const { stops } = findStopsForTrain(String(trainId || ''));
    const last = stops[stops.length - 1];
    const coords = coordsForStation(last?.station, $globalStationIndex.get() || {});
    if (!coords || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return haversineM(lat, lng, coords.lat, coords.lng);
}

function shareReachedTerminus(trainId, lat, lng, station, share = {}) {
    if (share.terminusStay) return false;
    const id = String(trainId || '');
    if (!id) return false;
    const { stops, progress, lastIndex } = shareProgressAlongTrain(id, lat, lng);
    if (!stops.length) return false;
    const last = stops[lastIndex]?.station;
    const nearestIsLast = !!(station && last && normalizeStationName(station) === normalizeStationName(last));
    const atLast = atTerminusPlatform({
        nearestIsLast,
        progress,
        lastIndex,
        distanceToLastM: distanceToLastStopM(id, lat, lng),
    });
    const minSeen = Number.isFinite(share.minProgressSeen) ? share.minProgressSeen : progress;
    return terminusStopShouldFire({
        atLast,
        lastIndex,
        minProgressSeen: minSeen,
    });
}

function nextMinProgressSeen(share, trainId, lat, lng) {
    const { progress } = shareProgressAlongTrain(trainId, lat, lng);
    if (progress == null) return share?.minProgressSeen;
    const prev = Number.isFinite(share?.minProgressSeen) ? share.minProgressSeen : progress;
    return Math.min(prev, progress);
}

function persistActiveSharePatch(patch) {
    const active = getActiveShare();
    if (!active) return null;
    const next = { ...active, ...patch };
    safeStorage.setItem(ACTIVE_KEY, JSON.stringify(next));
    return next;
}

let sharePromptOpen = false;

async function confirmShareContinue({ title, body, keepLabel, stopLabel, switchLabel } = {}) {
    if (sharePromptOpen) return 'busy';
    sharePromptOpen = true;
    try {
        const { promptOnTrainSheet } = await import('./map-tab.js');
        const choice = await promptOnTrainSheet({
            title,
            body,
            primary: switchLabel || keepLabel,
            secondary: switchLabel ? keepLabel : stopLabel,
            tertiary: switchLabel ? stopLabel : undefined,
        });
        if (switchLabel) {
            if (choice === 'primary') return 'switch';
            if (choice === 'secondary') return 'keep';
            return 'stop';
        }
        return choice === 'primary' ? 'keep' : 'stop';
    } catch {
        return 'busy';
    } finally {
        sharePromptOpen = false;
    }
}

async function ensureAuthToken(forceRefresh = false) {
    if (!window.firebaseAuth) await bootFirebase();
    if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
        try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
    }
    if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
        try {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, forceRefresh);
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
    allowReverse = false,
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
    const reverseTolerance = allowReverse ? 0.35 : REVERSE_PROGRESS_TOLERANCE;
    if (Number.isFinite(previousProgress) && progress < previousProgress - reverseTolerance) {
        return {
            ok: false,
            state: TRACKING_STATE.PAUSED,
            reason: 'reverseProgress',
            geometryUnavailable: false,
            progress,
        };
    }
    const journeyH = journeyHeadingAtProgress(id, progress, { stationIndex, ...(schedules ? { schedules } : {}) })
        ?? journeyHeadingDeg(id, { stationIndex, ...(schedules ? { schedules } : {}) });
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
        // Station-to-station timetable heading, not GPS/campus tangent.
        bearing: Number.isFinite(journeyH)
            ? journeyH
            : alignBearingToJourney(snap.trackBearing, journeyH),
    };
}

export function adaptiveOnboardPingMs(speedMps) {
    const speed = Number(speedMps);
    if (!Number.isFinite(speed) || speed < 1.5) return ONBOARD_STATIONARY_PING_MS;
    return speed >= 3 ? ONBOARD_FAST_PING_MS : ONBOARD_MOVING_PING_MS;
}

/** Sustained mismatch detector. Stationary, inaccurate and interchange samples are not evidence. */
export function updateDirectionObservation(previous = {}, {
    speedMps,
    heading,
    expectedHeading,
    accuracy,
    nearInterchange = false,
    now = Date.now(),
} = {}) {
    const reliable = Number(speedMps) >= 1.5
        && Number.isFinite(heading)
        && Number.isFinite(expectedHeading)
        && (!Number.isFinite(accuracy) || Number(accuracy) <= 50);
    if (nearInterchange) {
        return {
            conflicts: 0,
            consistent: Number(previous.consistent || 0),
            conflictSince: 0,
            warning: false,
        };
    }
    if (!reliable) return { ...previous, warning: !!previous.warning };
    if (headingAgrees(Number(heading), Number(expectedHeading))) {
        const consistent = Number(previous.consistent || 0) + 1;
        return {
            conflicts: 0,
            consistent,
            conflictSince: 0,
            warning: consistent < 2 && !!previous.warning,
        };
    }
    const conflicts = Number(previous.conflicts || 0) + 1;
    const conflictSince = Number(previous.conflictSince || now);
    return {
        conflicts,
        consistent: 0,
        conflictSince,
        warning: conflicts >= DIRECTION_CONFLICT_MIN_SAMPLES
            && now - conflictSince >= DIRECTION_CONFLICT_MIN_MS,
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
export async function stopShareIfIdle({ waitForOnboard = true } = {}) {
    const raw = peekStoredShare();
    if (!raw || !shareSessionIdle(raw) || idleStopInFlight) return false;
    if (Date.now() - lastIdleAttempt < 5000) return false;
    lastIdleAttempt = Date.now();
    idleStopInFlight = true;
    try {
        const hidden = typeof document !== 'undefined' && document.hidden;
        await stopRideShare({ reason: 'idle', quiet: hidden, waitForOnboard });
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
            speedMps: readPingMotionClass(p) === 'still' ? 0 : p.speedMps,
            motionClass: readPingMotionClass(p),
            mine: p.deviceId === mineDeviceId,
            routeId: p.routeId || routeId,
            projectedProgress: p.projectedProgress,
            routeProgressM: p.routeProgressM,
            railDistanceM: p.railDistanceM,
            bearing: p.bearing,
            trackingState: state,
            acceptedAt: p.acceptedAt,
            fixAt: p.fixAt,
            lastPingAt: p.lastPingAt,
            lastSeenLabel: p.lastSeenLabel || p.station || '',
            destination: p.destination || '',
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
                    || (p.trackingState === TRACKING_STATE.ACTIVE && isRidePingGpsStale(p))
                )
                && Number.isFinite(p.projectedProgress)
                && Number.isFinite(p.lat)
                && Number.isFinite(p.lng)
            )
            .sort((a, b) => gpsPingSuccessAt(b) - gpsPingSuccessAt(a));
        // Fresh GPS wins. Stale/unreachable sharers drop out of `active`; another
        // rider's accurate ping becomes the driver. If nobody is reachable, keep
        // the last projected point and paint it paused (grey).
        const kept = active.length ? active : paused.slice(0, 1);
        if (!kept.length) continue;
        const medianProgress = median(kept.map((p) => p.projectedProgress));
        const driver = [...kept].sort((a, b) => {
            const fa = gpsPingSuccessAt(a);
            const fb = gpsPingSuccessAt(b);
            if (fb !== fa) return fb - fa;
            const da = Math.abs(a.projectedProgress - medianProgress);
            const db = Math.abs(b.projectedProgress - medianProgress);
            return da - db;
        })[0];
        const newest = kept.reduce((a, b) => (gpsPingSuccessAt(a) >= gpsPingSuccessAt(b) ? a : b), kept[0]);
        const metricPing = (key) => {
            const hit = [...kept, ...list].find((p) => typeof p?.[key] === 'number' && Number.isFinite(p[key]));
            return hit ? hit[key] : null;
        };
        const pausedOnly = active.length === 0;
        out.push({
            lat: driver.lat,
            lng: driver.lng,
            trainId,
            n: active.length || list.length,
            mine: list.some((p) => p.mine),
            at: newest.at,
            expiresAt: newest.expiresAt,
            heading: newest.heading ?? metricPing('heading'),
            speedMps: (() => {
                const cls = readPingMotionClass(newest) || readPingMotionClass(driver);
                if (cls === 'still') return 0;
                return typeof newest.speedMps === 'number' ? newest.speedMps : metricPing('speedMps');
            })(),
            motionClass: readPingMotionClass(newest) || readPingMotionClass(driver),
            station: newest.station,
            routeId: newest.routeId,
            bearing: (() => {
                const journeyH = journeyHeadingAtProgress(trainId, medianProgress);
                return Number.isFinite(journeyH)
                    ? journeyH
                    : (Number.isFinite(driver.bearing) ? driver.bearing : null);
            })(),
            onRails: true,
            projectedProgress: medianProgress,
            routeProgressM: driver.routeProgressM,
            railDistanceM: typeof newest.railDistanceM === 'number' ? newest.railDistanceM : metricPing('railDistanceM'),
            trackingState: pausedOnly ? TRACKING_STATE.PAUSED : TRACKING_STATE.ACTIVE,
            acceptedAt: newest.acceptedAt || driver.acceptedAt || metricPing('acceptedAt'),
            fixAt: newest.fixAt || driver.fixAt || metricPing('fixAt'),
            lastPingAt: newest.lastPingAt || driver.lastPingAt,
            lastSeenLabel: newest.lastSeenLabel || driver.lastSeenLabel,
            destination: trainTerminusName(trainId, newest.destination || driver.lastSeenLabel),
            accuracy: typeof newest.accuracy === 'number' ? newest.accuracy : metricPing('accuracy'),
            pauseReason: pausedOnly ? (newest.pauseReason || 'staleGps') : '',
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
        && !isRidePingGpsStale(p)
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

export function isTrackingInterchange(stationName, stationIndex = $globalStationIndex.get() || {}) {
    const target = normalizeStationName(stationName || '');
    if (!target) return false;
    const configured = Object.values(ROUTES).some((route) =>
        [route?.transferStation, route?.relayStation]
            .some((name) => normalizeStationName(name || '') === target)
    );
    if (configured) return true;
    const entry = Object.entries(stationIndex).find(([name]) => normalizeStationName(name) === target)?.[1];
    const routes = entry?.routes;
    const count = routes instanceof Set ? routes.size : (Array.isArray(routes) ? routes.length : 0);
    return count > 1;
}

function nearTrackingInterchange(pos, routeId, stationIndex = $globalStationIndex.get() || {}) {
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return false;
    const nearest = nearestStationOnRoute(pos.lat, pos.lng, routeId);
    if (!nearest || !isTrackingInterchange(nearest.stationName, stationIndex)) return false;
    const accuracyM = Number.isFinite(pos.accuracy) ? Number(pos.accuracy) : 0;
    const radiusM = Math.min(350, Math.max(250, accuracyM * 2));
    return nearest.distKm * 1000 <= radiusM;
}

async function oneShotGps() {
    const {
        peekLastGeoFix,
        waitForGeoFix,
        requestGeoLocateFix,
        reusableGeoFix,
        GEO_REUSE_MAX_AGE_MS,
    } = await import('./geo-watch.js');
    const last = reusableGeoFix(peekLastGeoFix());
    if (last) return last;
    try {
        return await waitForGeoFix({ maxAgeMs: GEO_REUSE_MAX_AGE_MS, timeoutMs: 12000 });
    } catch (err) {
        try {
            return await requestGeoLocateFix();
        } catch (locateErr) {
            const kept = reusableGeoFix(peekLastGeoFix());
            if (kept) return kept;
            throw locateErr || err;
        }
    }
}

export function getCachedRidePings(routeId = $currentRouteId.get()) {
    return routeCache[routeId] || [];
}

function pingTracksTrain(p, trainId, opts = {}) {
    const id = String(trainId || '');
    if (!id || String(p?.trainId || '') !== id) return false;
    if (relaxLiveShareGuards()) return true;
    if (p.trackingState !== TRACKING_STATE.ACTIVE || isRidePingGpsStale(p)) return false;
    const lat = typeof p.projectedLat === 'number' ? p.projectedLat : null;
    const lng = typeof p.projectedLng === 'number' ? p.projectedLng : null;
    if (lat == null || lng == null) return false;
    if (!Number.isFinite(p.projectedProgress)) return false;
    if (p.adminOverrideRole === 'train') return true;
    const metres = Number(p.railDistanceM);
    if (!Number.isFinite(metres) || metres > TRACKER_SNAP_MAX_M) return false;
    const speed = typeof p.speedMps === 'number' ? p.speedMps : 0;
    // Station / crawl GPS is still an accurate ping. Heading only when moving.
    if (speed >= 1.5 && typeof p.heading === 'number') {
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
    const df = (b.fixAt || 0) - (a.fixAt || 0);
    if (df) return df;
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
        fixAt: gpsPingSuccessAt(p),
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

function destinationForTrain(trainId, _route) {
    return trainTerminusName(trainId) || null;
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

/** True while a rider is still sharing this train (paused counts; Stop / expiry does not). */
export function isLiveTrainShareActive(ping) {
    if (!ping) return false;
    if (String(ping.trackingState || '') === TRACKING_STATE.STOPPED) return false;
    return activePings([ping]).length > 0;
}

/**
 * Look up whether Train `trainId` is still being shared on `routeId`.
 * @returns {Promise<{ status: 'live'|'stopped'|'offline'|'missing', ping?: object }>}
 */
export async function findLiveTrainShare(trainId, routeId) {
    const id = String(trainId || '');
    const rid = String(routeId || '');
    if (!id) return { status: 'missing' };
    const pick = (list) => (list || [])
        .filter((p) => String(p.trainId || '') === id && isLiveTrainShareActive(p))
        .sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (rid && online) {
        const pings = await fetchRouteRidePings(rid);
        const hit = pick(pings);
        if (hit) return { status: 'live', ping: hit };
        return { status: 'stopped' };
    }
    const cached = pick(getCachedRidePings(rid));
    if (cached) return { status: 'live', ping: cached };
    if (!online) return { status: 'offline' };
    return { status: 'stopped' };
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

export async function startRidePingsListener(routeId, { force = false } = {}) {
    if (!routeId) return;
    stopRidePingsListener(routeId);
    await fetchFeatures();
    if (!force && !isRideCheckInEnabled(routeId) && !isAdminAuthed()) return;

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
    motionClass = '',
    source = 'board_checkin',
    waitingFor = null,
    quiet = false,
    trackingState = null,
    pauseReason = '',
    adminOverrideRole = '',
    overrideProjected = null,
    projectedFix = null,
    gpsFixAt = null,
} = {}) {
    await fetchFeatures();
    const trustedAdminOverride = isAdminAuthed() && (adminOverrideRole === 'train' || adminOverrideRole === 'person')
        ? adminOverrideRole
        : '';
    if (!isRideCheckInEnabled(routeId) && !trustedAdminOverride) {
        return { ok: false, message: 'Ride sharing isn’t on for this corridor yet.' };
    }
    let st = (station || document.getElementById('station-select')?.value || '').trim();
    if (!st && typeof coarseLat === 'number' && typeof coarseLng === 'number') {
        st = nearestStationOnRoute(coarseLat, coarseLng, routeId)?.stationName || '';
    }
    if (!routeId) return { ok: false, message: 'Pick a corridor first.' };
    if (!st && trustedAdminOverride) st = 'here';
    if (trainId) {
        destination = trainTerminusName(trainId, destination) || destination || null;
    }
    if (
        source !== 'onboard_ping'
        && source !== 'stop'
        && source !== 'onboard_off_path'
        && trustedAdminOverride !== 'train'
        && routeHasNoScheduledTrains()
    ) {
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
    if (!String(source || '').startsWith('onboard_') && source !== 'stop') {
        clearSessionPoints();
    }
    let projection = projectedFix?.ok ? projectedFix : null;
    let resolvedState = trackingState;
    let resolvedPauseReason = pauseReason;
    if (trainId && trustedAdminOverride === 'train' && !overrideProjected && Number.isFinite(coarseLat) && Number.isFinite(coarseLng)) {
        const path = await railPathForTrain(trainId, { routeId, region: ROUTES[routeId]?.region || 'GP' });
        overrideProjected = scoreFixToRailPath(coarseLat, coarseLng, path);
    }
    if (trainId && projection?.ok && !resolvedState) {
        resolvedState = TRACKING_STATE.ACTIVE;
        resolvedPauseReason = '';
    } else if (trainId && !resolvedState) {
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
            bearing: (() => {
                const journeyH = journeyHeadingAtProgress(trainId, overrideProjected.pathFraction);
                return Number.isFinite(journeyH)
                    ? journeyH
                    : alignBearingToJourney(overrideProjected.trackBearing, heading);
            })(),
        };
        resolvedState = TRACKING_STATE.ACTIVE;
        resolvedPauseReason = '';
    }
    if (!resolvedState) resolvedState = TRACKING_STATE.ACTIVE;
    const fusion = peekMotionFusion();
    if (!(typeof heading === 'number' && Number.isFinite(heading)) && Number.isFinite(fusion.heading)) {
        heading = fusion.heading;
    }
    if (!(typeof speedMps === 'number' && Number.isFinite(speedMps) && speedMps >= 1.5)
        && fusion.motionClass === 'ride'
        && Number.isFinite(fusion.speedMps)
        && fusion.speedMps >= 1.5) {
        speedMps = fusion.speedMps;
    }
    const resolvedMotion = readPingMotionClass(fusion)
        || readPingMotionClass({ motionClass })
        || readPingMotionClass(previous);
    if (resolvedMotion === 'still') speedMps = 0;
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
        heading: typeof heading === 'number' ? Math.round(heading) : (typeof previous?.heading === 'number' ? previous.heading : null),
        speedMps: typeof speedMps === 'number' ? Math.round(speedMps * 10) / 10 : (typeof previous?.speedMps === 'number' ? previous.speedMps : null),
        accuracy: typeof accuracy === 'number' ? Math.round(accuracy) : (typeof previous?.accuracy === 'number' ? previous.accuracy : null),
        appVersion: APP_VERSION,
        source: source || 'board_checkin',
        trackingState: resolvedState,
    };
    if (resolvedMotion) payload.motionClass = resolvedMotion;
    if (trustedAdminOverride) payload.adminOverrideRole = trustedAdminOverride;
    if (resolvedPauseReason) payload.pauseReason = resolvedPauseReason;
    if (projection?.ok) {
        payload.projectedLat = projection.projectedLat;
        payload.projectedLng = projection.projectedLng;
        payload.projectedProgress = projection.projectedProgress;
        payload.routeProgressM = Math.round(projection.routeProgressM);
        payload.railDistanceM = Math.round(projection.distanceM);
        payload.acceptedAt = now;
        payload.fixAt = Number(gpsFixAt || previous?.fixAt || now) || now;
        payload.lastSeenLabel = projection.lastSeenLabel || st;
        if (Number.isFinite(projection.bearing)) payload.bearing = Math.round(projection.bearing);
    } else if (resolvedState === TRACKING_STATE.PAUSED && previous) {
        for (const key of ['projectedLat', 'projectedLng', 'projectedProgress', 'routeProgressM', 'railDistanceM', 'acceptedAt', 'fixAt', 'lastSeenLabel', 'bearing', 'speedMps', 'accuracy', 'heading', 'motionClass']) {
            if (payload[key] == null && previous[key] != null) payload[key] = previous[key];
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
            speedMps: payload.speedMps,
            heading: payload.heading,
            motionClass: payload.motionClass || '',
            fixAt: payload.fixAt || previous?.fixAt || now,
            directionObservation: previous?.directionObservation || null,
            directionWarning: !!previous?.directionWarning,
            adminOverrideRole: payload.adminOverrideRole || '',
            source: payload.source,
            offTrackSince: projection?.ok ? 0 : (previous?.offTrackSince || 0),
            offTrackStayUntil: projection?.ok ? 0 : (Number(previous?.offTrackStayUntil) || 0),
            terminusStay: Boolean(previous?.terminusStay),
            terminusArrived: Boolean(previous?.terminusArrived),
            leftTrainPrompted: Boolean(previous?.leftTrainPrompted),
            hubSwitchStay: Boolean(previous?.hubSwitchStay),
            directionStay: Boolean(previous?.directionStay),
            minProgressSeen: nextMinProgressSeen(previous, trainId, coarseLat, coarseLng),
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
        const marks = awardShareMarks({
            joinedLive: !!(trainId && others.length > 0),
            confirmedCloser: source === 'closer_confirm',
            trainId: trainId || '',
        });
        if (marks?.added) addSessionPoints(marks.added);
        if (!quiet) showToast(toastMsg, 'success');
        notifyPingsUpdated(routeId);
        return { ok: true, ping: payload };
    } catch (e) {
        return { ok: false, message: e?.message || 'Couldn’t share your location' };
    }
}

export async function stopRideShare({ quiet = false, reason = '', waitForOnboard = true } = {}) {
    const active = peekStoredShare();
    const routeId = active?.routeId || $currentRouteId.get();
    const deviceId = getDeviceId();
    if (!routeId || !deviceId) return { ok: false };
    stopOnboardPingLoop();
    if (waitForOnboard) await onboardProjectionChain.catch(() => {});
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
        const sessionPoints = readSessionPoints();
        safeStorage.removeItem(ACTIVE_KEY);
        clearSessionPoints();
        stopOnboardPingLoop();
        stopShareIdleWatch();
        import('./geo-watch.js').then((g) => g.releaseGeoWatch('share')).catch(() => {});
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
        if (reason === 'off_track_far' || reason === 'off_track_grace') {
            import('./rider-marks.js').then((m) => {
                m.showShareThanksOverlay({ points: sessionPoints });
            }).catch(() => {});
            if (!quiet) {
                showToast('Sharing stopped. You were no longer on this corridor.', 'info', 4000);
            }
        } else if (!quiet) {
            const msg = reason === 'terminus'
                ? 'Sharing stopped at the last station.'
                : reason === 'direction'
                    ? 'Sharing stopped. Your movement no longer matched this train.'
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
let onboardImuTimer = 0;
let onboardImuBusy = false;
let onboardGpsRailAnchor = null;
let onboardGeoUnsub = null;
let onboardProjectionChain = Promise.resolve();
let onboardLatestFix = null;
let onboardPendingFix = null;
let onboardPendingOptions = null;
let onboardDrainRunning = false;
let onboardLastBroadcastAt = 0;
let onboardWatchStartedAt = 0;
let onboardGeneration = 0;

export function stopOnboardPingLoop() {
    onboardGeneration++;
    if (onboardPingTimer) {
        clearInterval(onboardPingTimer);
        onboardPingTimer = 0;
    }
    if (onboardImuTimer) {
        clearInterval(onboardImuTimer);
        onboardImuTimer = 0;
    }
    onboardImuBusy = false;
    onboardGpsRailAnchor = null;
    stopMotionFusion();
    if (onboardGeoUnsub) {
        onboardGeoUnsub();
        onboardGeoUnsub = null;
    }
    onboardLatestFix = null;
    onboardPendingFix = null;
    onboardPendingOptions = null;
    onboardLastBroadcastAt = 0;
    onboardWatchStartedAt = 0;
}

async function pauseActiveTracker(active, reason, pos = null) {
    const paused = {
        ...active,
        trackingState: TRACKING_STATE.PAUSED,
        pauseReason: reason,
        at: Date.now(),
        offTrackSince: active.offTrackSince || Date.now(),
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
        heading: pos?.heading ?? active.heading ?? null,
        speedMps: pos?.speedMps ?? active.speedMps ?? null,
        accuracy: pos?.accuracy ?? active.accuracy ?? null,
        motionClass: pos?.motionClass || active.motionClass || '',
        source: 'onboard_paused',
        quiet: true,
        trackingState: TRACKING_STATE.PAUSED,
        pauseReason: reason,
        adminOverrideRole: active.adminOverrideRole || '',
    });
}

export async function pauseRideShare({ reason = 'user', quiet = false } = {}) {
    const active = getActiveShare();
    if (!active?.trainId) return { ok: false, message: 'You’re not sharing' };
    const result = await pauseActiveTracker(active, reason, onboardLatestFix);
    if (!quiet && reason === 'user') {
        showToast('Sharing paused. Restart when you are ready.', 'info');
    }
    return result?.ok === false ? result : { ok: true };
}

export async function resumeRideShare({ quiet = false } = {}) {
    const active = peekStoredShare();
    if (!active?.trainId || shareSessionIdle(active)) {
        return { ok: false, message: 'You’re not sharing' };
    }
    persistActiveSharePatch({ trackingState: TRACKING_STATE.ACTIVE, pauseReason: '' });
    if (!onboardGeoUnsub) startOnboardPingLoop();
    else if (onboardLatestFix) queueOnboardFix(onboardLatestFix, { forceBroadcast: true });
    else {
        import('./geo-watch.js').then((g) => {
            const last = g.peekLastGeoFix();
            if (last) queueOnboardFix(last, { forceBroadcast: true });
        }).catch(() => {});
    }
    if (!quiet) showToast('Sharing restarted', 'success');
    notifyPingsUpdated(active.routeId);
    return { ok: true };
}

function cacheLocalProjectedFix(active, pos, projection, near, observation) {
    const now = Date.now();
    const deviceId = getDeviceId();
    const local = {
        routeId: active.routeId,
        deviceId,
        station: near?.stationName || active.station,
        trainId: active.trainId,
        destination: active.destination || null,
        at: now,
        acceptedAt: now,
        fixAt: Number(pos.t || now),
        expiresAt: active.expiresAt || now + RIDE_SHARE_IDLE_MS,
        coarseLat: pos.lat,
        coarseLng: pos.lng,
        heading: Number.isFinite(pos.heading) ? pos.heading : null,
        speedMps: Number.isFinite(pos.speedMps) ? pos.speedMps : null,
        motionClass: readPingMotionClass(pos) || readPingMotionClass(peekMotionFusion()),
        accuracy: Number.isFinite(pos.accuracy) ? pos.accuracy : null,
        trackingState: TRACKING_STATE.ACTIVE,
        projectedLat: projection.projectedLat,
        projectedLng: projection.projectedLng,
        projectedProgress: projection.projectedProgress,
        routeProgressM: projection.routeProgressM,
        railDistanceM: projection.distanceM,
        bearing: projection.bearing,
        lastSeenLabel: projection.lastSeenLabel,
        source: 'onboard_local',
    };
    const stored = {
        ...active,
        station: local.station,
        trackingState: TRACKING_STATE.ACTIVE,
        pauseReason: '',
        projectedLat: local.projectedLat,
        projectedLng: local.projectedLng,
        projectedProgress: local.projectedProgress,
        routeProgressM: Math.round(local.routeProgressM),
        railDistanceM: Math.round(local.railDistanceM),
        acceptedAt: now,
        fixAt: local.fixAt,
        lastSeenLabel: local.lastSeenLabel,
        bearing: local.bearing,
        heading: local.heading,
        speedMps: local.speedMps,
        motionClass: local.motionClass || '',
        accuracy: local.accuracy,
        offTrackSince: 0,
        offTrackStayUntil: 0,
        terminusStay: Boolean(active.terminusStay),
        terminusArrived: Boolean(active.terminusArrived),
        leftTrainPrompted: Boolean(active.leftTrainPrompted),
        hubSwitchStay: Boolean(active.hubSwitchStay),
        directionStay: observation?.warning ? Boolean(active.directionStay) : false,
        directionObservation: observation,
        directionWarning: !!observation?.warning,
        minProgressSeen: nextMinProgressSeen(active, active.trainId, pos.lat, pos.lng),
    };
    safeStorage.setItem(ACTIVE_KEY, JSON.stringify(stored));
    const existing = getCachedRidePings(active.routeId).filter((p) => p.deviceId !== deviceId);
    routeCache[active.routeId] = activePings([local, ...existing]);
    notifyPingsUpdated(active.routeId);
    return stored;
}

async function suggestConnectingTrain(trainId, routeId, hubStation) {
    const { stops } = findStopsForTrain(String(trainId || ''));
    const dest = remainingCorridorTerminusFromStops(stops, routeId);
    if (!dest || !hubStation) return null;
    try {
        const { planDirectTrip } = await import('./planner-core.js');
        const dayType = (typeof window !== 'undefined' && window.currentDayType) || 'weekday';
        const result = planDirectTrip(hubStation, dest, dayType, false, {});
        const trips = Array.isArray(result?.trips) ? result.trips : [];
        const next = trips.find((t) => String(t.train || '') !== String(trainId || ''));
        if (!next?.train) return null;
        return {
            trainId: String(next.train),
            depTime: String(next.depTime || '').slice(0, 5),
            dest,
        };
    } catch {
        return null;
    }
}

async function processOnboardFix(pos, { forceBroadcast = false, generation = onboardGeneration } = {}) {
    if (generation !== onboardGeneration) return;
    if (!pos || await stopShareIfIdle({ waitForOnboard: false })) return;
    if (generation !== onboardGeneration) return;
    const active = getActiveShare();
    if (!active?.trainId) {
        stopOnboardPingLoop();
        return;
    }
    if (active.trackingState === TRACKING_STATE.PAUSED && active.pauseReason === 'user') {
        return;
    }
    const autoPaused = active.trackingState === TRACKING_STATE.PAUSED && active.pauseReason !== 'user';
    const near = nearestStationOnRoute(pos.lat, pos.lng, active.routeId);
    const minProgressSeen = nextMinProgressSeen(active, active.trainId, pos.lat, pos.lng);
    if (Number.isFinite(minProgressSeen) && minProgressSeen !== active.minProgressSeen) {
        persistActiveSharePatch({ minProgressSeen });
        active.minProgressSeen = minProgressSeen;
    }
    if (active.terminusStay) {
        const { progress, lastIndex } = shareProgressAlongTrain(active.trainId, pos.lat, pos.lng);
        const distLast = distanceToLastStopM(active.trainId, pos.lat, pos.lng);
        const last = shareProgressAlongTrain(active.trainId, pos.lat, pos.lng).stops?.slice(-1)[0]?.station;
        const nearestIsLast = !!(near?.stationName && last
            && normalizeStationName(near.stationName) === normalizeStationName(last));
        const atPlatform = atTerminusPlatform({
            nearestIsLast,
            progress,
            lastIndex,
            distanceToLastM: distLast,
        });
        if (atPlatform || (progress != null && progress < lastIndex - TERMINUS_TRAVELED_SLACK)) {
            persistActiveSharePatch({ terminusStay: false });
            active.terminusStay = false;
        }
    }
    const { stops, progress, lastIndex } = shareProgressAlongTrain(active.trainId, pos.lat, pos.lng);
    const distLast = distanceToLastStopM(active.trainId, pos.lat, pos.lng);
    const lastStop = stops[lastIndex]?.station;
    const nearestIsLast = !!(near?.stationName && lastStop
        && normalizeStationName(near.stationName) === normalizeStationName(lastStop));
    const atPlatform = atTerminusPlatform({
        nearestIsLast,
        progress,
        lastIndex,
        distanceToLastM: distLast,
    });
    if (atPlatform && !active.terminusArrived) {
        persistActiveSharePatch({ terminusArrived: true });
        active.terminusArrived = true;
    }
    const connectingDest = remainingCorridorTerminusFromStops(stops, active.routeId);
    let handledHub = false;
    if (atPlatform && connectingDest && !active.hubSwitchStay) {
        const next = await suggestConnectingTrain(active.trainId, active.routeId, lastStop);
        if (next?.trainId) {
            handledHub = true;
            const destLabel = String(next.dest || connectingDest).replace(/ STATION$/i, '');
            const when = next.depTime ? ` departing ${next.depTime}` : '';
            const pick = await confirmShareContinue({
                title: 'Switch trains?',
                body: `Train ${active.trainId} ends here. Switch to Train ${next.trainId}${when} toward ${destLabel}, or keep sharing this train.`,
                switchLabel: `Switch to ${next.trainId}`,
                keepLabel: 'Stay on this train',
                stopLabel: 'Stop sharing',
            });
            if (pick === 'busy') return;
            if (pick === 'stop') {
                await stopRideShare({ reason: 'hub_switch', waitForOnboard: false });
                return;
            }
            if (pick === 'switch') {
                persistActiveSharePatch({
                    trainId: next.trainId,
                    destination: next.dest || connectingDest,
                    hubSwitchStay: true,
                    terminusStay: false,
                    terminusArrived: false,
                    leftTrainPrompted: false,
                    minProgressSeen: null,
                    projectedProgress: null,
                });
                active.trainId = next.trainId;
                active.destination = next.dest || connectingDest;
                active.hubSwitchStay = true;
                active.terminusStay = false;
                active.terminusArrived = false;
                active.leftTrainPrompted = false;
            } else {
                persistActiveSharePatch({ hubSwitchStay: true });
                active.hubSwitchStay = true;
            }
        }
    }
    if (!handledHub && shareReachedTerminus(active.trainId, pos.lat, pos.lng, near?.stationName || active.station, active)) {
        const pick = await confirmShareContinue({
            title: 'Has this train arrived?',
            body: `You’re at the last station for Train ${active.trainId}. Stop sharing if it has arrived, or keep going if you’re still on it.`,
            keepLabel: 'Still on the train',
            stopLabel: 'Yes, we’ve arrived',
        });
        if (pick === 'busy') return;
        if (pick !== 'keep') {
            await stopRideShare({ reason: 'terminus', waitForOnboard: false });
            return;
        }
        persistActiveSharePatch({ terminusStay: true, terminusArrived: true });
        active.terminusStay = true;
        active.terminusArrived = true;
    }
    if (shouldPromptLeftTrain({
        arrivedAtTerminus: !!active.terminusArrived,
        distanceToLastM: distLast,
        leftPrompted: !!active.leftTrainPrompted,
    })) {
        const pick = await confirmShareContinue({
            title: 'Have you left this train?',
            body: 'Your location has moved away from the last station. Stop sharing if you have left, or keep going if you are still on it.',
            keepLabel: 'I’m still on it',
            stopLabel: 'I’ve left the train',
        });
        if (pick === 'busy') return;
        if (pick !== 'keep') {
            await stopRideShare({ reason: 'left_terminus', waitForOnboard: false });
            return;
        }
        persistActiveSharePatch({ leftTrainPrompted: true });
        active.leftTrainPrompted = true;
    }
    if (active.adminOverrideRole === 'train' && isAdminAuthed()) {
        const due = forceBroadcast || autoPaused || Date.now() - onboardLastBroadcastAt >= adaptiveOnboardPingMs(pos.speedMps);
        if (!due) return;
        if (generation !== onboardGeneration) return;
        const result = await submitRideCheckIn({
            routeId: active.routeId,
            station: near?.stationName || active.station,
            trainId: active.trainId,
            destination: active.destination || null,
            coarseLat: pos.lat,
            coarseLng: pos.lng,
            heading: pos.heading,
            speedMps: pos.speedMps,
            accuracy: pos.accuracy,
            motionClass: pos.motionClass || '',
            source: 'admin_override_train',
            quiet: true,
            adminOverrideRole: 'train',
            gpsFixAt: Number(pos.t || Date.now()),
        });
        if (result.ok) onboardLastBroadcastAt = Date.now();
        return;
    }

    const nearInterchange = nearTrackingInterchange(pos, active.routeId);
    const projection = await projectTrainTrackerFix({
        lat: pos.lat,
        lng: pos.lng,
        trainId: active.trainId,
        routeId: active.routeId,
        previousProgress: active.projectedProgress,
        allowReverse: nearInterchange,
    });
    if (generation !== onboardGeneration) return;
    if (!projection.ok) {
        const now = Date.now();
        if (active.offTrackStayUntil && now < Number(active.offTrackStayUntil)) {
            await pauseActiveTracker({ ...active, offTrackSince: 0 }, projection.reason || 'offTrack', pos);
            return;
        }
        const offTrackSince = active.offTrackSince || now;
        const decision = offTrackShareDecision({
            offTrackSince,
            distanceM: projection.distanceM,
        });
        if (decision === 'drop_far' || decision === 'drop_grace') {
            const pick = await confirmShareContinue({
                title: 'Still on this train?',
                body: decision === 'drop_far'
                    ? 'Your location is no longer on this train’s path. Sharing will stop unless you are still on it.'
                    : 'We have not seen you on this train’s path for a few minutes. Sharing will stop unless you are still on it.',
                keepLabel: 'I’m still on it',
                stopLabel: 'Stop sharing',
            });
            if (pick === 'busy') return;
            if (pick !== 'keep') {
                await stopRideShare({
                    reason: decision === 'drop_far' ? 'off_track_far' : 'off_track_grace',
                    waitForOnboard: false,
                });
                return;
            }
            const offTrackStayUntil = now + RIDE_OFFTRACK_STAY_MS;
            persistActiveSharePatch({ offTrackSince: 0, offTrackStayUntil });
            await pauseActiveTracker({
                ...active,
                offTrackSince: 0,
                offTrackStayUntil,
            }, projection.reason || 'offTrack', pos);
            return;
        }
        await pauseActiveTracker({ ...active, offTrackSince }, projection.reason || 'offTrack', pos);
        return;
    }

    const expectedHeading = journeyHeadingAtProgress(active.trainId, projection.projectedProgress);
    let observation = updateDirectionObservation(active.directionObservation, {
        speedMps: pos.speedMps,
        heading: pos.heading,
        expectedHeading,
        accuracy: pos.accuracy,
        nearInterchange,
    });
    if (observation.warning && !active.directionStay) {
        const pick = await confirmShareContinue({
            title: 'Still on this train?',
            body: 'Your movement does not match this train’s direction. Sharing will stop unless you are still on it.',
            keepLabel: 'I’m still on it',
            stopLabel: 'Stop sharing',
        });
        if (pick === 'busy') return;
        if (pick !== 'keep') {
            await stopRideShare({ reason: 'direction', waitForOnboard: false });
            return;
        }
        persistActiveSharePatch({ directionStay: true, directionWarning: false });
        active.directionStay = true;
        observation = { ...observation, warning: false, conflicts: 0 };
    } else if (!observation.warning && active.directionStay) {
        persistActiveSharePatch({ directionStay: false });
        active.directionStay = false;
    }
    onboardGpsRailAnchor = {
        lat: projection.projectedLat,
        lng: projection.projectedLng,
        t: Number(pos.t || Date.now()),
    };
    const local = cacheLocalProjectedFix(active, pos, projection, near, observation);
    const interval = adaptiveOnboardPingMs(pos.speedMps);
    if (!navigator.onLine || (!forceBroadcast && !autoPaused && Date.now() - onboardLastBroadcastAt < interval)) return;
    if (generation !== onboardGeneration) return;
    const result = await submitRideCheckIn({
        routeId: local.routeId,
        station: local.station,
        trainId: local.trainId,
        destination: local.destination || null,
        coarseLat: pos.lat,
        coarseLng: pos.lng,
        heading: pos.heading,
        speedMps: pos.speedMps,
        accuracy: pos.accuracy,
        motionClass: pos.motionClass || '',
        source: active.trackingState === TRACKING_STATE.PAUSED ? 'onboard_resume' : 'onboard_ping',
        quiet: true,
        projectedFix: projection,
        gpsFixAt: Number(pos.t || local.fixAt || Date.now()),
    });
    if (result.ok) onboardLastBroadcastAt = Date.now();
}

function queueOnboardFix(pos, options) {
    if (!pos) return;
    onboardLatestFix = pos;
    onboardPendingFix = pos;
    onboardPendingOptions = {
        forceBroadcast: !!(onboardPendingOptions?.forceBroadcast || options?.forceBroadcast),
    };
    if (onboardDrainRunning) return;
    const generation = onboardGeneration;
    onboardDrainRunning = true;
    onboardProjectionChain = onboardProjectionChain
        .catch(() => {})
        .then(async () => {
            try {
                while (generation === onboardGeneration && onboardPendingFix) {
                    const latest = onboardPendingFix;
                    const pendingOptions = onboardPendingOptions || {};
                    onboardPendingFix = null;
                    onboardPendingOptions = null;
                    await processOnboardFix(latest, { ...pendingOptions, generation });
                }
            } finally {
                onboardDrainRunning = false;
                if (onboardPendingFix && onboardGeoUnsub) {
                    queueOnboardFix(onboardPendingFix, onboardPendingOptions || {});
                }
            }
        });
}

function queueOnboardPause(reason, pos = null) {
    const generation = onboardGeneration;
    onboardProjectionChain = onboardProjectionChain
        .catch(() => {})
        .then(async () => {
            if (generation !== onboardGeneration) return;
            const current = getActiveShare();
            if (!current?.trainId) return;
            if (current.trackingState === TRACKING_STATE.PAUSED && current.pauseReason === reason) return;
            await pauseActiveTracker(current, reason, pos);
        });
    return onboardProjectionChain;
}

async function tickOnboardImu() {
    if (onboardImuBusy) return;
    const generation = onboardGeneration;
    const active = getActiveShare();
    if (!active?.trainId || active.trackingState === TRACKING_STATE.PAUSED) return;
    const fusion = peekMotionFusion();
    if (!fusion.running) return;
    const lastGps = onboardLatestFix;
    if (!lastGps || lastGps.fromImu) return;
    const gpsAge = Date.now() - Number(lastGps.t || 0);
    if (!Number.isFinite(gpsAge) || gpsAge < 200 || gpsAge >= RIDE_GPS_STALE_MS) return;
    if (!onboardGpsRailAnchor || !Number.isFinite(onboardGpsRailAnchor.lat) || !Number.isFinite(onboardGpsRailAnchor.lng)) return;
    const heading = Number.isFinite(fusion.heading)
        ? fusion.heading
        : (Number.isFinite(active.bearing) ? active.bearing : lastGps.heading);
    const speedMps = Number.isFinite(fusion.speedMps) ? fusion.speedMps : lastGps.speedMps;
    const predicted = imuPredictFromGpsAnchor(onboardGpsRailAnchor, {
        motionClass: fusion.motionClass,
        heading,
        speedMps,
    }, Date.now());
    if (!predicted) return;
    onboardImuBusy = true;
    try {
        const projection = await projectTrainTrackerFix({
            lat: predicted.lat,
            lng: predicted.lng,
            trainId: active.trainId,
            routeId: active.routeId,
            previousProgress: active.projectedProgress,
        });
        if (!projection.ok || generation !== onboardGeneration) return;
        const current = getActiveShare();
        if (!current?.trainId || current.trackingState === TRACKING_STATE.PAUSED) return;
        cacheLocalProjectedFix(current, {
            ...lastGps,
            lat: predicted.lat,
            lng: predicted.lng,
            heading,
            speedMps,
            motionClass: fusion.motionClass,
            fromImu: true,
        }, projection, null, current.directionObservation);
    } finally {
        onboardImuBusy = false;
    }
}

/** Every accepted fix moves the local pill; Firebase receives coalesced pings (4s while testing). */
export function startOnboardPingLoop() {
    stopOnboardPingLoop();
    startMotionFusion();
    startShareIdleWatch();
    const active = getActiveShare();
    onboardLastBroadcastAt = Number(active?.lastPingAt || active?.at || 0);
    onboardWatchStartedAt = Date.now();
    import('./geo-watch.js').then((g) => {
        g.acquireGeoWatch('share');
        onboardGeoUnsub = g.subscribeGeoFix((fix) => {
            if (fix && !fix.fromImu) queueOnboardFix(fix);
        });
        const last = g.peekLastGeoFix();
        if (last) queueOnboardFix(last);
    }).catch(() => {});
    onboardImuTimer = setInterval(() => {
        tickOnboardImu().catch(() => {});
    }, IMU_LOCAL_TICK_MS);
    onboardPingTimer = setInterval(async () => {
        const current = getActiveShare();
        if (!current?.trainId) {
            stopOnboardPingLoop();
            return;
        }
        if (current.trackingState === TRACKING_STATE.PAUSED && current.pauseReason === 'user') {
            return;
        }
        if (!navigator.onLine) {
            await queueOnboardPause('offline');
            return;
        }
        const lastFixAt = Number(onboardLatestFix?.t || onboardWatchStartedAt || 0);
        if (lastFixAt && Date.now() - lastFixAt >= RIDE_GPS_STALE_MS) {
            await queueOnboardPause('staleGps', onboardLatestFix);
            return;
        }
        const due = Date.now() - onboardLastBroadcastAt >= adaptiveOnboardPingMs(onboardLatestFix?.speedMps);
        if (due && onboardLatestFix) queueOnboardFix(onboardLatestFix, { forceBroadcast: true });
    }, ONBOARD_FAST_PING_MS);
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
    requestMotionPermission();
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
        motionClass: coords?.motionClass || '',
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
    const mapOpen = typeof document !== 'undefined'
        && document.getElementById('view-map')?.classList.contains('active');
    if (!isRideCheckInEnabled(routeId) && !isAdminAuthed() && !mapOpen) {
        renderRideSeenChip(routeId);
        stopRidePingsListener(routeId);
        return;
    }
    if (!isRideCheckInEnabled(routeId)) {
        renderRideSeenChip(routeId);
        if (!routeListeners[routeId]) startRidePingsListener(routeId, { force: true });
        const fetched = await fetchRouteRidePings(routeId);
        if (fetched.length || !routeCache[routeId]?.length) {
            routeCache[routeId] = fetched;
        }
        notifyPingsUpdated(routeId);
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

export function openLiveTrackerSheet(trainId, routeId = $currentRouteId.get(), { silent = false } = {}) {
    const modal = document.getElementById('nt-live-tracker-modal');
    const list = document.getElementById('nt-live-tracker-list');
    const title = document.getElementById('nt-live-tracker-title');
    const sub = document.getElementById('nt-live-tracker-sub');
    if (!modal || !list || !trainId) return;
    if (!canSeeLiveShareChrome(routeId) && !iAmSharingTrain(trainId, routeId)) return;

    if (!silent) triggerHaptic();
    const id = String(trainId);
    modal.dataset.trainId = id;
    modal.dataset.routeId = String(routeId || '');
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
    window.addEventListener('nt-ride-pings-updated', (event) => {
        const modal = document.getElementById('nt-live-tracker-modal');
        if (!modal || modal.classList.contains('hidden') || !modal.dataset.trainId) return;
        const routeId = modal.dataset.routeId || $currentRouteId.get();
        if (event?.detail?.routeId && event.detail.routeId !== routeId) return;
        openLiveTrackerSheet(modal.dataset.trainId, routeId, { silent: true });
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
    window.pauseRideShare = pauseRideShare;
    window.resumeRideShare = resumeRideShare;
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
