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
                renderRideSeenChip(routeId);
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
        showToast(toastMsg, 'success');
        renderRideSeenChip(routeId);
        return { ok: true, ping: payload };
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

    const trainBit = summary.trainId ? `Train ${escapeHTML(summary.trainId)} · ` : '';
    const label = station && normalizeStationName(summary.station) === normalizeStationName(station)
        ? `${trainBit}Last seen here · ${escapeHTML(summary.age)}${summary.count > 1 ? ` · ${summary.count} riders` : ''}`
        : `${trainBit}Last seen at ${escapeHTML(summary.station)} · ${escapeHTML(summary.age)}`;

    host.classList.remove('hidden');
    host.innerHTML = `<span class="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 dark:text-blue-300"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>${label}</span>`;
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
    renderRideSeenChip(routeId);
}

export function bindRideCheckInUi() {
    if (typeof document === 'undefined' || window.__ntRideCheckInBound) return;
    window.__ntRideCheckInBound = true;

    document.getElementById('ride-checkin-btn')?.addEventListener('click', async () => {
        triggerHaptic();
        const routeId = $currentRouteId.get();
        const station = document.getElementById('station-select')?.value || '';
        const result = await submitRideCheckIn({ routeId, station, source: 'board_share' });
        if (!result.ok && result.message) showToast(result.message, 'error');
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
}
