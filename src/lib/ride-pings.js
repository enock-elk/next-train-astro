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
import { APP_VERSION, DYNAMIC_BASE_URL } from './config.js';
import { safeStorage, escapeHTML, normalizeStationName, getDistanceFromLatLonInKm } from './utils.js';
import { $currentRouteId, $deviceId, $globalStationIndex } from '../store.js';
import { $account } from './account.js';
import { showToast, triggerHaptic } from './ui.js';
import { bootFirebase } from './firebase-boot.js';
import { FEATURE_KEYS, fetchFeatures, isFeatureEnabled } from './features.js';
import {
    expectedPosition,
    isStationAheadOfGhost,
    lagMinutesFromFix,
    addMinutesToTime,
    scoreTrainForFix,
    TRAIN_TRACKER_MAX_M,
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

function pingTracksTrain(p, trainId) {
    const id = String(trainId || '');
    if (!id || String(p?.trainId || '') !== id) return false;
    const lat = typeof p.coarseLat === 'number' ? p.coarseLat : null;
    const lng = typeof p.coarseLng === 'number' ? p.coarseLng : null;
    if (lat == null || lng == null) return false;
    const metres = scoreTrainForFix(lat, lng, id);
    if (!Number.isFinite(metres) || metres > TRAIN_TRACKER_MAX_M) return false;
    return typeof p.speedMps === 'number' && p.speedMps >= 1.5;
}

/** Train id others should see — only on-path and moving. Waiting / far = commuter. */
export function pingPublicTrainId(p) {
    return pingTracksTrain(p, p?.trainId) ? String(p.trainId) : null;
}

export function trainHasLivePing(trainId, routeId = $currentRouteId.get()) {
    if (!trainId) return false;
    const id = String(trainId);
    return activePings(getCachedRidePings(routeId)).some((p) => pingTracksTrain(p, id));
}

function median(nums) {
    const a = [...nums].filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
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
 * Median lag of active pings vs the timetable ghost.
 * Soft label from ≥1 ping; rewrite clocks only with ≥2 devices or 1 ping + a matching delay report.
 * Apply only to stations the ghost has not reached yet.
 */
export function computeRideDelta(pings, trainId, opts = {}) {
    const id = String(trainId || '');
    if (!id) return null;
    const live = activePings(pings).filter((p) => pingTracksTrain(p, id));
    if (!live.length) return null;

    const ghost = expectedPosition(id, opts.now, opts);
    if (!ghost) return null;

    const lags = live.map((p) => {
        const lat = typeof p.coarseLat === 'number' ? p.coarseLat : null;
        const lng = typeof p.coarseLng === 'number' ? p.coarseLng : null;
        if (lat == null || lng == null) return null;
        return lagMinutesFromFix(lat, lng, ghost, p.speedMps, opts.stationIndex);
    }).filter(Number.isFinite);

    const lagMin = median(lags);
    if (lagMin == null) return null;

    const devices = new Set(live.map((p) => p.deviceId || p.uid || `${p.coarseLat},${p.coarseLng}`));
    const routeId = opts.routeId || $currentRouteId.get();
    const hasDelay = matchingDelayReport(id, routeId);
    const rounded = Math.round(lagMin);

    return {
        trainId: id,
        lagMin: rounded,
        pingCount: live.length,
        deviceCount: devices.size,
        soft: true,
        rewrite: devices.size >= 2 || (devices.size >= 1 && hasDelay),
        ghost,
        liveHint: liveHint(rounded),
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
                ? `You’re visible as a commuter — not on train ${waitingFor} yet`
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
            showToast('Location is off — we can’t show you on the map', 'error');
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

export function renderRideSeenChip(routeId = $currentRouteId.get()) {
    const host = document.getElementById('ride-seen-chip');
    const cta = document.getElementById('ride-checkin-btn');
    if (!host) return;

    if (!isRideCheckInEnabled(routeId)) {
        host.classList.add('hidden');
        host.innerHTML = '';
        cta?.classList.add('hidden');
        document.getElementById('ride-nearby-btn')?.classList.add('hidden');
        return;
    }

    cta?.classList.add('hidden');
    document.getElementById('ride-nearby-btn')?.classList.remove('hidden');
    const mine = getActiveShare();

    const station = document.getElementById('station-select')?.value || '';
    const pings = routeCache[routeId] || [];
    const summary = summarizeRidePings(pings, station);

    if (mine && !summary) {
        host.classList.remove('hidden');
        host.innerHTML = `<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300"><span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>You’re visible at ${escapeHTML(stationShort(mine.station))} · ${minutesLeft(mine.expiresAt)} min left</span>`;
        return;
    }

    if (!summary) {
        host.classList.remove('hidden');
        host.innerHTML = `<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400"><span class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span>Nobody visible yet — be the first</span>`;
        return;
    }

    const bits = [];
    if (mine) {
        bits.push(`<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300">You’re visible · ${minutesLeft(mine.expiresAt)} min</span>`);
    }
    if (summary.peopleCount) {
        const places = summary.topStations.map((s) => escapeHTML(stationShort(s))).join(', ');
        const people = `${summary.peopleCount} commuter${summary.peopleCount === 1 ? '' : 's'} last seen${places ? ` · ${places}` : ''}${summary.age ? ` · ${escapeHTML(summary.age)}` : ''}`;
        bits.push(`<button type="button" data-focus-map class="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 dark:text-blue-300 hover:underline focus:outline-none">${people}</button>`);
    }
    if (summary.topTrainId) {
        bits.push(`<button type="button" data-focus-train="${escapeHTML(summary.topTrainId)}" class="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 dark:text-blue-300 hover:underline focus:outline-none"><span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_0_3px_rgba(59,130,246,0.35)]"></span>${escapeHTML(String(summary.topTrainId))} is live · last seen ${escapeHTML(stationShort(summary.station || ''))}</button>`);
    }

    host.classList.remove('hidden');
    host.innerHTML = `<div class="flex flex-col items-start gap-0.5 min-w-0">${bits.join('')}</div>`;
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

    fetchFeatures().then(() => refreshRideSeenSurface($currentRouteId.get())).catch(() => {});
}

if (typeof window !== 'undefined') {
    window.submitRideCheckIn = submitRideCheckIn;
    window.startPresenceShare = startPresenceShare;
    window.stopRideShare = stopRideShare;
    window.refreshRideSeenSurface = refreshRideSeenSurface;
    window.bindRideCheckInUi = bindRideCheckInUi;
    window.computeRideDelta = computeRideDelta;
    window.getRideDelta = getRideDelta;
    window.decorateJourneyLive = decorateJourneyLive;
}
