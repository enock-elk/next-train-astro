/**
 * Live ride sharing — riders volunteer where a train was last seen (Wave 3).
 *
 * RTDB: ride_pings/{routeId}/{deviceId}
 * {
 *   routeId, deviceId, station, trainId?, destination?,
 *   at, expiresAt, uid?, coarseLat?, coarseLng?, appVersion, source
 * }
 *
 * No GPS trails — optional coarse coords only to snap station / show on Leaflet.
 * TTL ~10 minutes (rules allow up to 20); one active ride per device.
 */
import { APP_VERSION, DYNAMIC_BASE_URL } from './config.js';
import { safeStorage, escapeHTML, normalizeStationName } from './utils.js';
import { $currentRouteId, $deviceId } from '../store.js';
import { $account } from './account.js';
import { showToast, triggerHaptic } from './ui.js';
import { bootFirebase } from './firebase-boot.js';
import { FEATURE_KEYS, fetchFeatures, isFeatureEnabled } from './features.js';
import {
    expectedPosition,
    isStationAheadOfGhost,
    lagMinutesFromFix,
    addMinutesToTime,
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
        return 'Live ride sharing isn’t enabled on the server yet (database rules not deployed).';
    }
    return `Couldn’t share your ride (${status}).`;
}

function ageLabel(at) {
    const mins = Math.max(0, Math.round((Date.now() - (at || Date.now())) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.round(mins / 60)}h ago`;
}

function activePings(list) {
    const now = Date.now();
    return (list || []).filter((p) => p && p.station && (p.expiresAt || 0) > now && (p.at || 0) > now - RIDE_PING_TTL_MS);
}

export function getCachedRidePings(routeId = $currentRouteId.get()) {
    return routeCache[routeId] || [];
}

export function trainHasLivePing(trainId, routeId = $currentRouteId.get()) {
    if (!trainId) return false;
    const id = String(trainId);
    return activePings(getCachedRidePings(routeId)).some((p) => String(p.trainId || '') === id);
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
    const live = activePings(pings).filter((p) => String(p.trainId || '') === id);
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
 * Aggregate last-seen at the board station (or busiest station on route).
 */
export function summarizeRidePings(pings, focusStation = '') {
    const live = activePings(pings);
    if (!live.length) return null;
    const focus = normalizeStationName(focusStation || '');
    let pool = live;
    if (focus) {
        const atStation = live.filter((p) => normalizeStationName(p.station) === focus);
        if (atStation.length) pool = atStation;
    }
    // Prefer freshest
    pool = [...pool].sort((a, b) => (b.at || 0) - (a.at || 0));
    const top = pool[0];
    const stationCounts = {};
    live.forEach((p) => {
        const s = normalizeStationName(p.station) || p.station;
        stationCounts[s] = (stationCounts[s] || 0) + 1;
    });
    return {
        count: pool.length,
        totalLive: live.length,
        station: top.station,
        at: top.at,
        trainId: top.trainId || null,
        age: ageLabel(top.at),
        stationCounts,
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
} = {}) {
    await fetchFeatures();
    if (!isRideCheckInEnabled(routeId)) {
        return { ok: false, message: 'Ride sharing isn’t on for this corridor yet.' };
    }
    const st = (station || document.getElementById('station-select')?.value || '').trim();
    if (!routeId || !st) return { ok: false, message: 'Pick a station first.' };
    if (!navigator.onLine) return { ok: false, message: 'You appear offline.' };

    const deviceId = getDeviceId();
    const now = Date.now();
    const acct = $account.get();
    const payload = {
        routeId,
        deviceId,
        station: st,
        trainId: trainId || null,
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
        if (!token) throw new Error('Sign-in required to contribute (anonymous is fine).');
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
            routeId, station: st, trainId: trainId || null, at: now, expiresAt: payload.expiresAt,
        }));
        const mins = Math.round(RIDE_PING_TTL_MS / 60000);
        const toastMsg = trainId
            ? `Sharing your ride on train ${trainId} · ${mins} min`
            : `Sharing your ride from ${st} · ${mins} min`;
        const others = activePings(getCachedRidePings(routeId))
            .filter((p) => String(p.trainId || '') === String(trainId || '') && p.deviceId !== deviceId);
        const marks = awardShareMarks({
            joinedLive: others.length > 0,
            confirmedCloser: source === 'closer_confirm',
            trainId: trainId || '',
        });
        showToast(marks.awarded ? `${toastMsg} · ${marks.label}` : toastMsg, 'success');
        notifyPingsUpdated(routeId);
        return { ok: true, ping: payload, marks };
    } catch (e) {
        return { ok: false, message: e?.message || 'Couldn’t share your ride' };
    }
}

export function renderRideSeenChip(routeId = $currentRouteId.get()) {
    const host = document.getElementById('ride-seen-chip');
    const cta = document.getElementById('ride-checkin-btn');
    if (!host) return;

    if (!isRideCheckInEnabled(routeId)) {
        host.classList.add('hidden');
        host.innerHTML = '';
        cta?.classList.add('hidden');
        return;
    }

    cta?.classList.remove('hidden');
    const station = document.getElementById('station-select')?.value || '';
    const pings = routeCache[routeId] || [];
    const summary = summarizeRidePings(pings, station);

    if (!summary) {
        host.classList.remove('hidden');
        host.innerHTML = `<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400"><span class="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600"></span>No riders sharing on this corridor</span>`;
        return;
    }

    const sharing = summary.totalLive;
    const trainLabel = summary.trainId
        ? `Train ${escapeHTML(summary.trainId)} is live · ${sharing} sharing`
        : `${sharing} rider${sharing === 1 ? '' : 's'} sharing`;
    const trainAttr = summary.trainId ? `data-focus-train="${escapeHTML(summary.trainId)}"` : '';

    host.classList.remove('hidden');
    host.innerHTML = `<button type="button" ${trainAttr} class="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 dark:text-blue-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm">
        <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_0_3px_rgba(59,130,246,0.35)]"></span>${trainLabel}
    </button>`;
}

export async function refreshRideSeenSurface(routeId = $currentRouteId.get()) {
    await fetchFeatures();
    if (!isRideCheckInEnabled(routeId)) {
        renderRideSeenChip(routeId);
        stopRidePingsListener(routeId);
        return;
    }
    if (!routeListeners[routeId]) startRidePingsListener(routeId);
    if (!routeCache[routeId]) {
        routeCache[routeId] = await fetchRouteRidePings(routeId);
    }
    notifyPingsUpdated(routeId);
}

export function bindRideCheckInUi() {
    if (typeof document === 'undefined' || window.__ntRideCheckInBound) return;
    window.__ntRideCheckInBound = true;

    document.getElementById('ride-checkin-btn')?.addEventListener('click', async () => {
        triggerHaptic();
        const onTrain = document.querySelector('#pretoria-time [data-on-train], #pienaarspoort-time [data-on-train]');
        if (onTrain) {
            const { startOnTrainShare } = await import('./map-tab.js');
            await startOnTrainShare({
                trainId: onTrain.getAttribute('data-on-train'),
                station: onTrain.getAttribute('data-station') || document.getElementById('station-select')?.value || '',
                destination: onTrain.getAttribute('data-dest') || '',
                routeId: onTrain.getAttribute('data-route') || $currentRouteId.get(),
                source: 'board_on_train',
            });
            return;
        }
        const routeId = $currentRouteId.get();
        const station = document.getElementById('station-select')?.value || '';
        const result = await submitRideCheckIn({ routeId, station, source: 'board_share' });
        if (!result.ok && result.message) showToast(result.message, 'error');
    });

    document.addEventListener('click', (e) => {
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
    window.refreshRideSeenSurface = refreshRideSeenSurface;
    window.bindRideCheckInUi = bindRideCheckInUi;
    window.computeRideDelta = computeRideDelta;
    window.getRideDelta = getRideDelta;
    window.decorateJourneyLive = decorateJourneyLive;
}
