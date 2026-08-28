/**
 * Live presence — show where you are (train optional) for ~10 minutes.
 *
 * RTDB: ride_pings/{routeId}/{deviceId}
 * {
 *   routeId, deviceId, station, trainId?, waitingFor?, destination?,
 *   at, expiresAt, uid?, coarseLat?, coarseLng?, appVersion, source
 * }
 * trainId is set only when the rider is on-path and moving. Waiting / far
 * shares keep trainId null so clocks and the dashboard stay off that train.
 *
 * No GPS trails — optional coarse coords only to snap station / show on Leaflet.
 * TTL ~10 minutes (rules allow up to 20); one active ride per device.
 */
import { APP_VERSION, DYNAMIC_BASE_URL, ROUTES } from './config.js';
import { isAdminAuthed } from './admin-chrome.js';
import { safeStorage, escapeHTML, normalizeStationName, getDistanceFromLatLonInKm, formatTimeDisplay } from './utils.js';
import { $currentRouteId, $deviceId, $globalStationIndex } from '../store.js';
import { $account } from './account.js';
import { showToast, triggerHaptic } from './ui.js';
import { bootFirebase } from './firebase-boot.js';
import { FEATURE_KEYS, fetchFeatures, isFeatureEnabled, relaxLiveShareGuards } from './features.js';
import {
    expectedPosition,
    isStationAheadOfGhost,
    lagMinutesFromFix,
    addMinutesToTime,
    scoreTrainForFix,
    TRAIN_TRACKER_MAX_M,
    ghostHeadingDeg,
    headingAgrees,
    findStopsForTrain,
    progressAlongStops,
    trainGoingLabel,
} from './train-ghosts.js';
import { peekCachedRouteReports } from './delay-reports.js';
import { awardShareMarks } from './rider-marks.js';

export const RIDE_PING_TTL_MS = 10 * 60 * 1000;
const ACTIVE_KEY = 'ridePingActiveV1';

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

export function getActiveShare() {
    try {
        const raw = JSON.parse(safeStorage.getItem(ACTIVE_KEY) || 'null');
        if (!raw || (raw.expiresAt || 0) <= Date.now()) {
            if (raw) safeStorage.removeItem(ACTIVE_KEY);
            return null;
        }
        return raw;
    } catch {
        return null;
    }
}

function minutesLeft(expiresAt) {
    return Math.max(1, Math.round(((expiresAt || 0) - Date.now()) / 60000));
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
    const lat = typeof p.coarseLat === 'number' ? p.coarseLat : null;
    const lng = typeof p.coarseLng === 'number' ? p.coarseLng : null;
    if (lat == null || lng == null) return false;
    const metres = scoreTrainForFix(lat, lng, id, opts);
    if (!Number.isFinite(metres) || metres > TRAIN_TRACKER_MAX_M) return false;
    if (typeof p.speedMps !== 'number' || p.speedMps < 1.5) return false;
    if (typeof p.heading === 'number') {
        const ghost = expectedPosition(id, opts.now, opts);
        if (!headingAgrees(p.heading, ghostHeadingDeg(ghost))) return false;
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

function scorePingAgainstGhost(p, trainId, ghost, opts = {}) {
    const lat = typeof p.coarseLat === 'number' ? p.coarseLat : null;
    const lng = typeof p.coarseLng === 'number' ? p.coarseLng : null;
    const metres = (lat != null && lng != null)
        ? scoreTrainForFix(lat, lng, trainId, opts)
        : Infinity;
    const ghostH = ghostHeadingDeg(ghost);
    const headingOk = typeof p.heading === 'number'
        ? headingAgrees(p.heading, ghostH)
        : true;
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
 * 1) heading agrees with the ghost  2) closer to the ghost
 * 3) plausible train speed          4) fresher `at`
 */
export function rankVerifiedPings(pings, trainId, opts = {}) {
    const id = String(trainId || '');
    if (!id) return [];
    const live = activePings(pings).filter((p) => pingTracksTrain(p, id, opts));
    if (!live.length) return [];
    const ghost = expectedPosition(id, opts.now, opts);
    return live
        .map((p) => scorePingAgainstGhost(p, id, ghost, opts))
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
    if (p?.trainId && relaxLiveShareGuards()) return String(p.trainId);
    return pingTracksTrain(p, p?.trainId) ? String(p.trainId) : null;
}

export function trainHasLivePing(trainId, routeId = $currentRouteId.get()) {
    if (!trainId) return false;
    const id = String(trainId);
    return activePings(getCachedRidePings(routeId)).some((p) => pingTracksTrain(p, id));
}

function matchingDelayReport(trainId, routeId) {
    const id = String(trainId || '');
    return peekCachedRouteReports(routeId).some((r) => {
        if (!r || String(r.trainId || '') !== id) return false;
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
    const lat = typeof winner.coarseLat === 'number' ? winner.coarseLat : null;
    const lng = typeof winner.coarseLng === 'number' ? winner.coarseLng : null;
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
        if (!data || typeof data !== 'object') return [];
        return activePings(Object.values(data));
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
    source = 'board_checkin',
    waitingFor = null,
    quiet = false,
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
    if (!st && relaxLiveShareGuards()) st = 'here';
    if (!st) return { ok: false, message: 'Pick a station or allow location.' };
    if (!navigator.onLine) return { ok: false, message: 'You appear offline.' };

    const deviceId = getDeviceId();
    const now = Date.now();
    const acct = $account.get();
    const payload = {
        routeId,
        deviceId,
        station: st,
        trainId: trainId || null,
        waitingFor: waitingFor || null,
        destination: destination || null,
        at: now,
        expiresAt: now + RIDE_PING_TTL_MS,
        uid: acct.status === 'signed-in' ? acct.uid : null,
        coarseLat: typeof coarseLat === 'number' ? Math.round(coarseLat * 1000) / 1000 : null,
        coarseLng: typeof coarseLng === 'number' ? Math.round(coarseLng * 1000) / 1000 : null,
        heading: typeof heading === 'number' ? Math.round(heading) : null,
        speedMps: typeof speedMps === 'number' ? Math.round(speedMps * 10) / 10 : null,
        appVersion: APP_VERSION,
        source: source || 'board_checkin',
    };

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
            at: now, expiresAt: payload.expiresAt,
        }));
        const existing = getCachedRidePings(routeId).filter((p) => p.deviceId !== deviceId);
        routeCache[routeId] = activePings([payload, ...existing]);
        const mins = Math.round(RIDE_PING_TTL_MS / 60000);
        const toastMsg = trainId
            ? `Others can see ${trainId}${destination ? ` → ${stationShort(destination)}` : ''}`
            : waitingFor
                ? `You’re visible as a commuter - not on train ${waitingFor} yet`
                : `You’re visible at ${stationShort(st)} · ${mins} min`;
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

export async function stopRideShare({ quiet = false } = {}) {
    const active = getActiveShare();
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
        at: active?.at || now,
        expiresAt: now,
        appVersion: APP_VERSION,
        source: 'stop',
    };
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
        notifyPingsUpdated(routeId);
        import('./map-tab.js').then((m) => m.clearTripWatch?.()).catch(() => {});
        if (!quiet) showToast('Sharing ended', 'info');
        return { ok: true };
    } catch (e) {
        return { ok: false, message: e?.message || 'Couldn’t stop sharing' };
    }
}

let onboardPingTimer = 0;

export function stopOnboardPingLoop() {
    if (onboardPingTimer) {
        clearInterval(onboardPingTimer);
        onboardPingTimer = 0;
    }
}

/** While attached to a train, refresh the ping so others see movement. */
export function startOnboardPingLoop() {
    stopOnboardPingLoop();
    onboardPingTimer = setInterval(async () => {
        const active = getActiveShare();
        if (!active?.trainId) {
            stopOnboardPingLoop();
            return;
        }
        try {
            const pos = await oneShotGps();
            await submitRideCheckIn({
                routeId: active.routeId,
                station: active.station,
                trainId: active.trainId,
                destination: active.destination || null,
                coarseLat: pos.lat,
                coarseLng: pos.lng,
                heading: pos.heading,
                speedMps: pos.speedMps,
                source: 'onboard_ping',
                quiet: true,
            });
        } catch { /* keep last ping */ }
    }, 45000);
}

/**
 * Anyone on the corridor: one GPS fix, no train required, 10 minutes.
 * After a share, open Trains near you so they can attach if they’re close.
 */
export async function startPresenceShare({
    source = 'board_presence',
    skipVolunteer = false,
    openNearby = true,
} = {}) {
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
        showToast(`Already visible · ${minutesLeft(existing.expiresAt)} min left`, 'info');
        return { ok: true, already: true };
    }

    if (!skipVolunteer) {
        const { promptOnTrainSheet } = await import('./map-tab.js');
        const choice = await promptOnTrainSheet({
            title: 'Show others where you are?',
            body: 'Share a rough location for 10 minutes so others on this corridor can see you. You don’t have to be on a train.',
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

    if (!isRideCheckInEnabled(routeId)) {
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
    const mine = getActiveShare();
    paintLiveDirectionHeaders(routeId);

    if (mine) {
        host.classList.remove('hidden');
        const trainBit = mine.trainId ? ` Train ${escapeHTML(String(mine.trainId))}` : ` at ${escapeHTML(stationShort(mine.station))}`;
        host.innerHTML = `<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300"><span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>You’re sharing${trainBit} · ${minutesLeft(mine.expiresAt)} min left</span>`;
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

function liveLocButtonHtml(count) {
    const n = Math.max(1, Number(count) || 1);
    return `<span class="nt-live-loc" aria-hidden="true">
        <span class="nt-live-loc-ring"></span>
        <span class="nt-live-loc-ring nt-live-loc-ring-delay"></span>
        <svg class="nt-live-loc-pin" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c-3.4 0-6.2 2.7-6.2 6.1 0 4.6 6.2 12.4 6.2 12.4s6.2-7.8 6.2-12.4C18.2 5.2 15.4 2.5 12 2.5zm0 8.3a2.2 2.2 0 110-4.4 2.2 2.2 0 010 4.4z"/></svg>
    </span><span class="nt-live-loc-count">${n}</span>`;
}

function ensureLiveLocStyles() {
    if (typeof document === 'undefined' || document.getElementById('nt-live-loc-style')) return;
    const style = document.createElement('style');
    style.id = 'nt-live-loc-style';
    style.textContent = `
        .nt-live-loc-btn {
            display: inline-flex; align-items: center; gap: 0.2rem;
            padding: 0.1rem 0.35rem 0.1rem 0.15rem; margin: 0;
            border: 0; background: transparent; color: #16a34a;
            cursor: pointer; vertical-align: middle; border-radius: 9999px;
        }
        .nt-live-loc-btn:focus-visible { outline: 2px solid #16a34a; outline-offset: 2px; }
        html.dark .nt-live-loc-btn { color: #4ade80; }
        .nt-live-loc { position: relative; width: 1.55rem; height: 1.55rem; display: inline-block; }
        .nt-live-loc-ring {
            position: absolute; inset: 0; border-radius: 9999px;
            border: 2px solid currentColor; opacity: 0.55;
            animation: nt-live-pulse 1.8s ease-out infinite;
        }
        .nt-live-loc-ring-delay { animation-delay: 0.55s; }
        .nt-live-loc-pin { position: relative; width: 1.15rem; height: 1.15rem; margin: 0.2rem; display: block; }
        .nt-live-loc-count { font-size: 10px; font-weight: 800; line-height: 1; min-width: 0.7rem; }
        @keyframes nt-live-pulse {
            0% { transform: scale(0.55); opacity: 0.7; }
            100% { transform: scale(1.85); opacity: 0; }
        }
        .nt-tracker-pin {
            width: 1.1rem; height: 1.1rem; color: #16a34a;
            filter: drop-shadow(0 0 4px rgba(22,163,74,0.55));
        }
        html.dark .nt-tracker-pin { color: #4ade80; }
        .nt-tracker-pin-wrap { position: relative; width: 1.15rem; height: 1.15rem; }
        .nt-tracker-pin-wrap .nt-live-loc-ring { inset: -3px; }
        .nt-tracker-secondary {
            width: 0.55rem; height: 0.55rem; border-radius: 9999px;
            background: #86efac; border: 2px solid #fff;
        }
        html.dark .nt-tracker-secondary { border-color: #1f2937; }
    `;
    document.head.appendChild(style);
}

export function setDirectionHeaderLabel(headerEl, destUpper) {
    if (!headerEl) return;
    headerEl.classList.add('flex', 'items-center', 'justify-center', 'gap-1.5', 'flex-wrap');
    let span = headerEl.querySelector('[data-header-dest]');
    if (!span) {
        const btn = headerEl.querySelector('[data-live-tracker]');
        const existing = headerEl.querySelector('.text-blue-500, .text-blue-400');
        const label = destUpper || existing?.textContent || '…';
        headerEl.innerHTML = `Next train to <span data-header-dest class="text-blue-500 dark:text-blue-400">${escapeHTML(label)}</span>`;
        if (btn) headerEl.appendChild(btn);
        span = headerEl.querySelector('[data-header-dest]');
    } else if (destUpper) {
        span.textContent = destUpper;
    }
}

function paintOneLiveHeader(headerEl, group, side) {
    if (!headerEl) return;
    setDirectionHeaderLabel(headerEl);
    let btn = headerEl.querySelector('[data-live-tracker]');
    if (!group?.trainId || !isRideCheckInEnabled($currentRouteId.get())) {
        btn?.remove();
        return;
    }
    ensureLiveLocStyles();
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nt-live-loc-btn';
        headerEl.appendChild(btn);
    }
    btn.setAttribute('data-live-tracker', group.trainId);
    btn.setAttribute('data-live-side', side);
    btn.setAttribute('aria-label', `${group.count} live on Train ${group.trainId}`);
    btn.innerHTML = liveLocButtonHtml(group.count);
}

export function paintLiveDirectionHeaders(routeId = $currentRouteId.get()) {
    if (typeof document === 'undefined') return;
    const route = ROUTES[routeId];
    const pret = document.getElementById('pretoria-header');
    const pien = document.getElementById('pienaarspoort-header');
    if (!route || !isRideCheckInEnabled(routeId)) {
        pret?.querySelector('[data-live-tracker]')?.remove();
        pien?.querySelector('[data-live-tracker]')?.remove();
        return;
    }
    const live = liveTrackersByDirection(routeId);
    paintOneLiveHeader(pret, live.a, 'a');
    paintOneLiveHeader(pien, live.b, 'b');
}

function hideLiveTrackerSheet() {
    document.getElementById('nt-live-tracker-modal')?.classList.add('hidden');
}

function trackerStopRow(stop, { pin, extras, first, last }) {
    const name = escapeHTML(String(stop.station || '').replace(/ STATION$/i, ''));
    const time = escapeHTML(formatTimeDisplay(stop.time) || String(stop.time || '').slice(0, 5));
    const textClass = last
        ? 'text-gray-900 dark:text-white font-bold'
        : first
            ? 'text-gray-900 dark:text-white font-bold'
            : 'text-gray-700 dark:text-gray-300 font-medium';
    const extraDots = extras
        ? `<span class="absolute -right-3 top-1.5 flex gap-0.5">${Array.from({ length: extras }, () => '<span class="nt-tracker-secondary"></span>').join('')}</span>`
        : '';
    const marker = pin
        ? `<div class="nt-tracker-pin-wrap absolute -left-[9px] top-1">
                <span class="nt-live-loc-ring"></span>
                <svg class="nt-tracker-pin relative" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c-3.4 0-6.2 2.7-6.2 6.1 0 4.6 6.2 12.4 6.2 12.4s6.2-7.8 6.2-12.4C18.2 5.2 15.4 2.5 12 2.5zm0 8.3a2.2 2.2 0 110-4.4 2.2 2.2 0 010 4.4z"/></svg>
           </div>`
        : `<div class="absolute -left-[5px] top-2 w-3 h-3 rounded-full ${last ? 'bg-red-500' : 'bg-blue-500 border-2 border-white dark:border-gray-800'}"></div>`;
    return `<div class="flex justify-between text-xs py-1.5 relative pl-5">
        ${marker}${extraDots}
        <span class="${textClass}">${name}</span>
        <span class="font-mono ${textClass}">${time}</span>
    </div>`;
}

function liveBetweenRow() {
    return `<div class="flex items-center gap-2 text-[11px] font-bold text-green-700 dark:text-green-400 py-1 relative pl-5">
        <div class="nt-tracker-pin-wrap absolute -left-[9px] top-0.5">
            <span class="nt-live-loc-ring"></span>
            <svg class="nt-tracker-pin relative" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c-3.4 0-6.2 2.7-6.2 6.1 0 4.6 6.2 12.4 6.2 12.4s6.2-7.8 6.2-12.4C18.2 5.2 15.4 2.5 12 2.5zm0 8.3a2.2 2.2 0 110-4.4 2.2 2.2 0 010 4.4z"/></svg>
        </div>
        Live here
    </div>`;
}

export function openLiveTrackerSheet(trainId, routeId = $currentRouteId.get()) {
    const modal = document.getElementById('nt-live-tracker-modal');
    const list = document.getElementById('nt-live-tracker-list');
    const title = document.getElementById('nt-live-tracker-title');
    const sub = document.getElementById('nt-live-tracker-sub');
    if (!modal || !list || !trainId) return;

    ensureLiveLocStyles();
    triggerHaptic();
    const id = String(trainId);
    const ranked = rankVerifiedPings(getCachedRidePings(routeId), id);
    const { stops } = findStopsForTrain(id);
    const driver = ranked[0]?.ping;
    const route = ROUTES[routeId];
    const dest = destinationForTrain(id, route) || '';
    if (title) title.textContent = trainGoingLabel(id, dest);
    if (sub) {
        sub.textContent = ranked.length
            ? `${ranked.length} sharing · clock follows the closest heading match`
            : 'No verified live share on this train right now';
    }

    if (!stops.length) {
        list.innerHTML = '<p class="text-sm font-semibold text-gray-500 dark:text-gray-400 text-center py-6">No station list for this train.</p>';
        modal.classList.remove('hidden');
        return;
    }

    const index = $globalStationIndex.get() || {};
    const driverProg = (driver && typeof driver.coarseLat === 'number')
        ? progressAlongStops(driver.coarseLat, driver.coarseLng, stops, index)
        : null;
    const lastIdx = driverProg == null ? -1 : Math.floor(driverProg);
    const frac = driverProg == null ? 0 : driverProg - lastIdx;
    const onStation = driverProg != null && (frac < 0.12 || frac > 0.88);
    const pinStationIdx = !onStation
        ? -1
        : (frac > 0.88 ? Math.min(stops.length - 1, lastIdx + 1) : lastIdx);

    const extraAt = {};
    ranked.slice(1).forEach((r) => {
        const p = r.ping;
        if (typeof p.coarseLat !== 'number' || typeof p.coarseLng !== 'number') return;
        const prog = progressAlongStops(p.coarseLat, p.coarseLng, stops, index);
        if (prog == null) return;
        const i = Math.round(prog);
        extraAt[i] = (extraAt[i] || 0) + 1;
    });

    let html = '<div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2 space-y-0">';
    stops.forEach((stop, i) => {
        html += trackerStopRow(stop, {
            pin: onStation && i === pinStationIdx,
            extras: extraAt[i] || 0,
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
        const pulse = e.target.closest?.('[data-focus-train]');
        if (pulse) {
            e.preventDefault();
            e.stopPropagation();
            const trainId = pulse.getAttribute('data-focus-train');
            if (trainId) {
                import('./map-tab.js').then((m) => m.focusTrainOnMap(trainId)).catch(() => {});
            }
            return;
        }
        const liveBtn = e.target.closest?.('[data-live-tracker]');
        if (liveBtn) {
            e.preventDefault();
            e.stopPropagation();
            const trainId = liveBtn.getAttribute('data-live-tracker');
            if (trainId) openLiveTrackerSheet(trainId);
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
    window.openLiveTrackerSheet = openLiveTrackerSheet;
    window.setDirectionHeaderLabel = setDirectionHeaderLabel;
    window.getCachedRidePings = getCachedRidePings;
    window.nearestStationOnRoute = nearestStationOnRoute;
}
