/**
 * Map tab — embed Leaflet /map + trip-tied location contribution.
 *
 * Presence = coarse GPS until Stop or terminus so others can see you (train optional).
 * Attaching a train still runs the GPS / path / speed / heading checks.
 * `ENFORCE_LIVE_SHARE_VET` blocks a share when those checks fail.
 */
import { withBase, APP_VERSION } from './config.js';
import { showToast, showCheckToast, hideCheckToast, triggerHaptic } from './ui.js';
import { $currentRouteId, $globalStationIndex, $userRegion } from '../store.js';
import {
    timeToSeconds, escapeHTML, formatTimeDisplay, isRealTime,
    normalizeStationName, getDistanceFromLatLonInKm, safeStorage,
} from './utils.js';
import { currentTime } from './logic.js';
import { currentScheduleData } from './live-board.js';
import { trainGoingLabel, trainGoingFullLabel, TRACKING_WINDOW_SEC, compareNearbyTrainLikelihood, isGhostTrackable } from './train-ghosts.js';
import { relaxLiveShareGuards } from './features.js';
import { isAdminAuthed } from './admin-chrome.js';

/**
 * Map / board “Share my location” UI. Off until the feature ships to commuters.
 * Flip to true (and re-show MapView / nearby controls) when releasing.
 */
export const LIVE_LOCATION_SHARE_UI_ENABLED = false;

/**
 * Block a train share when GPS / path / speed / heading checks fail.
 */
export const ENFORCE_LIVE_SHARE_VET = true;

/**
 * A train stays linkable for 45 minutes either side of its scheduled time.
 */
export const CONTRIBUTE_WINDOW_SEC = TRACKING_WINDOW_SEC;

/** How far from the train's expected station a rider can be and still match. */
export const CONTRIBUTE_MATCH_KM = 5;

/** Foreground GPS sample window before a share is accepted. */
export const VET_WINDOW_MS = 30 * 1000;
const TRACK_MAX_M = 150;
const STATION_NEAR_M = 250;
const MOVE_MIN_M = 20;
const HIGHWAY_KMH = 90;

/** Others' pins: REST is a slow backup. Live updates come from the route listener. */
const PINGS_POLL_MS = 45 * 1000;
const PINGS_POLL_WITH_LISTENER_MS = 120 * 1000;
let pingsTimer = 0;
let lastMapPingSig = '';
let trackingCardMode = 'expanded';
const ADMIN_SHARE_ROLE_KEY = 'nt_admin_live_share_role';
let lastShareRequest = null;
let shareRestartInFlight = false;

let frameLoaded = false;
/** @type {{ lat: number, lng: number, accuracy?: number } | null} */
let lastCoords = null;

function adminShareRole() {
    if (!isAdminAuthed()) return 'auto';
    const role = safeStorage.getItem(ADMIN_SHARE_ROLE_KEY);
    return role === 'train' || role === 'person' ? role : 'auto';
}

function ensureShareChecksModal() {
    let modal = document.getElementById('nt-share-checks-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'nt-share-checks-modal';
    modal.className = 'fixed inset-0 z-[148] hidden flex items-end sm:items-center justify-center bg-gray-900/55 backdrop-blur-sm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'nt-share-checks-title');
    modal.innerHTML = `
        <div class="w-full max-w-md max-h-[88dvh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl">
            <div class="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
                <div class="min-w-0">
                    <p class="text-[9px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-300">Live location checks</p>
                    <h3 id="nt-share-checks-title" class="text-lg font-black text-gray-900 dark:text-white">Checking your train</h3>
                    <p id="nt-share-checks-status" class="mt-1 text-[12px] text-gray-500 dark:text-gray-400">Starting checks…</p>
                </div>
                <button type="button" data-share-checks-close class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 focus:outline-none" aria-label="Close">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
            <ol id="nt-share-checks-list" class="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-2"></ol>
            <fieldset id="nt-share-admin-override" class="hidden mx-4 mb-3 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-3">
                <legend class="px-1 text-[9px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300">Admin map marker override</legend>
                <div class="mt-1 grid grid-cols-3 gap-2 text-[11px] font-bold">
                    <label class="flex items-center justify-center gap-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 py-2"><input type="radio" name="nt-admin-share-role" value="auto"> Auto</label>
                    <label class="flex items-center justify-center gap-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 py-2"><input type="radio" name="nt-admin-share-role" value="train"> Train</label>
                    <label class="flex items-center justify-center gap-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 py-2"><input type="radio" name="nt-admin-share-role" value="person"> Person</label>
                </div>
                <p class="mt-2 text-[10px] text-violet-700 dark:text-violet-300">Restart checks after changing this override.</p>
            </fieldset>
            <div class="shrink-0 grid grid-cols-2 gap-2 p-4 border-t border-gray-100 dark:border-gray-800">
                <button type="button" id="nt-share-checks-restart" class="py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold focus:outline-none">Restart checks</button>
                <button type="button" data-share-checks-close class="py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm font-bold focus:outline-none">Close</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-share-checks-close]').forEach((button) => {
        button.addEventListener('click', () => modal.classList.add('hidden'));
    });
    modal.querySelectorAll('input[name="nt-admin-share-role"]').forEach((input) => {
        input.addEventListener('change', () => {
            if (input.checked) safeStorage.setItem(ADMIN_SHARE_ROLE_KEY, input.value);
        });
    });
    modal.querySelector('#nt-share-checks-restart')?.addEventListener('click', async () => {
        if (!lastShareRequest || shareRestartInFlight) return;
        shareRestartInFlight = true;
        try {
            await startOnTrainShare({ ...lastShareRequest, skipVolunteer: true, intent: 'onboard' });
        } finally {
            shareRestartInFlight = false;
        }
    });
    return modal;
}

function openShareChecks(trainId) {
    const modal = ensureShareChecksModal();
    modal.classList.remove('hidden');
    const title = modal.querySelector('#nt-share-checks-title');
    const status = modal.querySelector('#nt-share-checks-status');
    const list = modal.querySelector('#nt-share-checks-list');
    if (title) title.textContent = `Checking Train ${trainId}`;
    if (status) status.textContent = 'Starting checks…';
    if (list) list.innerHTML = '';
    const controls = modal.querySelector('#nt-share-admin-override');
    controls?.classList.toggle('hidden', !isAdminAuthed());
    const role = adminShareRole();
    const radio = modal.querySelector(`input[name="nt-admin-share-role"][value="${role}"]`);
    if (radio) radio.checked = true;
}

function addShareCheck(label, detail, state = 'pass') {
    const modal = ensureShareChecksModal();
    const list = modal.querySelector('#nt-share-checks-list');
    if (!list) return;
    const row = document.createElement('li');
    const tone = state === 'fail'
        ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
        : state === 'decision'
            ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30'
            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800';
    row.className = `rounded-xl border ${tone} px-3 py-2.5`;
    const heading = document.createElement('p');
    heading.className = 'text-[11px] font-black text-gray-900 dark:text-white';
    heading.textContent = label;
    const body = document.createElement('p');
    body.className = 'mt-0.5 text-[11px] leading-snug text-gray-600 dark:text-gray-300';
    body.textContent = detail;
    row.append(heading, body);
    list.appendChild(row);
    row.scrollIntoView({ block: 'nearest' });
}

function setShareDecision(text, accepted) {
    const status = ensureShareChecksModal().querySelector('#nt-share-checks-status');
    if (status) status.textContent = text;
    addShareCheck('Decision', text, accepted ? 'decision' : 'fail');
}

function frameEl() {
    return document.getElementById('map-tab-frame');
}

function statusEl() {
    return document.getElementById('map-tab-status');
}

function setStatus(text) {
    const el = statusEl();
    if (el) el.textContent = text;
}

function trackingAgeLabel(at, now = Date.now()) {
    if (!Number(at)) return 'Unknown';
    const sec = Math.max(0, Math.round((now - Number(at)) / 1000));
    return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)}m`;
}

function trackingDistanceLabel(metres) {
    if (!Number.isFinite(Number(metres))) return 'Unknown';
    const n = Number(metres);
    return n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(1)} km`;
}

function trackingHeadingLabel(deg) {
    if (!Number.isFinite(Number(deg))) return 'Unknown';
    const n = ((Math.round(Number(deg)) % 360) + 360) % 360;
    const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return `${n}° ${points[Math.round(n / 45) % 8]}`;
}

function setTrackingText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function renderTrackingStatusCard(active, marker = null) {
    const card = document.getElementById('map-tracking-card');
    const restore = document.getElementById('map-tracking-restore');
    if (!card || !restore) return;
    if (!active?.trainId) {
        card.classList.add('hidden');
        restore.classList.add('hidden');
        return;
    }
    const state = marker?.trackingState || active.trackingState || 'active';
    const paused = state === 'paused';
    const at = marker?.acceptedAt || marker?.at || active.acceptedAt || active.lastPingAt || active.at;
    const bearing = marker?.bearing ?? marker?.heading ?? active.bearing;
    const speed = marker?.speedMps;
    const accuracy = marker?.accuracy ?? active.accuracy;
    setTrackingText('map-tracking-title', `Tracking Train ${active.trainId}`);
    setTrackingText('map-tracking-state', paused ? 'Paused' : 'Active');
    setTrackingText('map-tracking-last-seen', `Last seen ${marker?.lastSeenLabel || active.lastSeenLabel || active.station || 'on the route'}`);
    setTrackingText('map-tracking-speed', Number.isFinite(speed) ? `${Math.round(Math.max(0, speed) * 3.6)} km/h` : 'Unknown');
    setTrackingText('map-tracking-heading', trackingHeadingLabel(bearing));
    setTrackingText('map-tracking-gps', trackingAgeLabel(at));
    setTrackingText('map-tracking-rail', trackingDistanceLabel(marker?.railDistanceM ?? active.railDistanceM));
    setTrackingText('map-tracking-accuracy', Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m` : 'Unknown');
    setTrackingText('map-tracking-count', String(Math.max(1, Number(marker?.n) || 1)));
    setTrackingText('map-tracking-restore-label', `Train ${active.trainId} · ${paused ? 'paused' : 'active'}`);
    const stateEl = document.getElementById('map-tracking-state');
    stateEl?.classList.toggle('bg-green-100', !paused);
    stateEl?.classList.toggle('dark:bg-green-950', !paused);
    stateEl?.classList.toggle('text-green-700', !paused);
    stateEl?.classList.toggle('dark:text-green-300', !paused);
    stateEl?.classList.toggle('bg-gray-200', paused);
    stateEl?.classList.toggle('dark:bg-gray-700', paused);
    stateEl?.classList.toggle('text-gray-700', paused);
    stateEl?.classList.toggle('dark:text-gray-200', paused);
    card.classList.toggle('hidden', trackingCardMode !== 'expanded');
    restore.classList.toggle('hidden', trackingCardMode !== 'minimized');
}

export function showTrackingStatusCard() {
    trackingCardMode = 'expanded';
    import('./ride-pings.js').then((ride) => {
        const active = ride.getActiveShare?.();
        const trainPings = active?.trainId
            ? (ride.getCachedRidePings?.(active.routeId) || []).filter((p) => String(p.trainId || '') === String(active.trainId))
            : [];
        const own = trainPings.find((p) => p.deviceId === getDeviceId());
        const marker = own ? { ...own, n: trainPings.length || 1 } : null;
        renderTrackingStatusCard(active, marker);
    }).catch(() => {});
}

function nowSeconds() {
    const t = (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : currentTime;
    return timeToSeconds(t || '00:00:00');
}

/**
 * Always load map.html. Extensionless `/map` is a document navigation that
 * Workbox used to serve as index.html (second header + bottom bar in the tab).
 * map.html is denylisted from navigateFallback, including on older SWs.
 */
function mapFrameSrc() {
    const frame = frameEl();
    const raw = frame?.getAttribute('data-map-src') || `${withBase('/map.html')}?embed=1`;
    let src = String(raw);
    if (!/\/map\.html(\?|$|#)/.test(src)) {
        src = src.replace(/\/map(\?|$|#)/, '/map.html$1');
    }
    if (!/[?&]v=/.test(src)) {
        src += (src.includes('?') ? '&' : '?') + `v=${encodeURIComponent(APP_VERSION)}`;
    }
    return src;
}

let frameWatchdog = 0;

function showFrameFallback() {
    document.getElementById('map-tab-placeholder')?.classList.add('hidden');
    document.getElementById('map-tab-fallback')?.classList.remove('hidden');
    setStatus('Map didn’t load - reload or open full map');
}

function armFrameWatchdog() {
    if (frameWatchdog) clearTimeout(frameWatchdog);
    frameWatchdog = setTimeout(() => {
        if (!frameLoaded) showFrameFallback();
    }, 8000);
}

function ensureFrameSrc(force = false) {
    const frame = frameEl();
    if (!frame) return;
    if (force || !frame.getAttribute('src')) {
        frameLoaded = false;
        document.getElementById('map-tab-fallback')?.classList.add('hidden');
        document.getElementById('map-tab-placeholder')?.classList.add('hidden');
        // Cache-bust on retry so a cached redirect chain isn't replayed.
        const src = force ? `${mapFrameSrc()}&r=${Date.now()}` : mapFrameSrc();
        frame.setAttribute('src', src);
        armFrameWatchdog();
    }
}

function exposeEmbedBridge() {
    if (typeof window === 'undefined') return;
    window.__ntMapTabEmbed = true;
    // Do not set __ntCloseInAppSheet here. map.html treats that flag as “I am the
    // sidenav full-screen sheet” and would open #nt-inapp-sheet over this tab.
}

function postToMap(payload) {
    const frame = frameEl();
    try {
        frame?.contentWindow?.postMessage(payload, '*');
    } catch { /* ignore */ }
}

/** Coords for a station name from the global index (keys are display names). */
function stationCoords(name) {
    const index = $globalStationIndex.get() || {};
    if (!name) return null;
    const direct = index[name];
    if (direct && typeof direct.lat === 'number') return direct;
    const target = normalizeStationName(name);
    for (const [key, value] of Object.entries(index)) {
        if (value && typeof value.lat === 'number' && normalizeStationName(key) === target) return value;
    }
    return null;
}

/**
 * Does the rider's position agree with where this train should be?
 * Returns km to the train's expected station, or null when we can't tell.
 */
function distanceToExpectedStation(candidate, coords) {
    if (!coords || typeof coords.lat !== 'number') return null;
    const st = stationCoords(candidate.station);
    if (!st) return null;
    return getDistanceFromLatLonInKm(coords.lat, coords.lng, st.lat, st.lon);
}

function haversineM(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lng - a.lng);
    const x =
        Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
}

function nearestStationMeters(lat, lng) {
    const index = $globalStationIndex.get() || {};
    let best = Infinity;
    Object.values(index).forEach((st) => {
        if (!st || typeof st.lat !== 'number') return;
        const d = getDistanceFromLatLonInKm(lat, lng, st.lat, st.lon) * 1000;
        if (d < best) best = d;
    });
    return Number.isFinite(best) ? best : null;
}

function setVetProgress(pct, label) {
    const bar = document.getElementById('map-vet-bar');
    const wrap = document.getElementById('map-vet-progress');
    const text = document.getElementById('map-vet-label');
    wrap?.classList.remove('hidden');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (text && label) text.textContent = label;
}

function hideVetProgress() {
    document.getElementById('map-vet-progress')?.classList.add('hidden');
}

function sampleGpsFor(ms, onTick) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Location isn’t available on this device.'));
            return;
        }
        const samples = [];
        const started = Date.now();
        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                samples.push({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    speed: pos.coords.speed,
                    heading: pos.coords.heading,
                    t: Date.now(),
                });
                const pct = Math.min(100, ((Date.now() - started) / ms) * 100);
                onTick?.(samples, pct);
            },
            (err) => {
                if (err.code === 1) {
                    navigator.geolocation.clearWatch(watchId);
                    reject(err);
                }
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
        setTimeout(() => {
            navigator.geolocation.clearWatch(watchId);
            resolve(samples);
        }, ms);
    });
}

async function vetLocationSamples(samples) {
    if (!samples.length) return { ok: false, message: 'Couldn’t get a GPS fix. Try again outdoors.' };
    const first = samples[0];
    const last = samples[samples.length - 1];
    const displacement = haversineM(first, last);
    const dt = Math.max(1, (last.t - first.t) / 1000);
    const speedMps = typeof last.speed === 'number' && last.speed >= 0
        ? last.speed
        : displacement / dt;
    const speedKmh = speedMps * 3.6;
    if (speedKmh > HIGHWAY_KMH) {
        return { ok: false, message: 'That speed doesn’t look like a train.' };
    }
    for (let i = 1; i < samples.length; i++) {
        const d = haversineM(samples[i - 1], samples[i]);
        const s = Math.max(0.2, (samples[i].t - samples[i - 1].t) / 1000);
        if (d / s > 50) {
            return { ok: false, message: 'GPS jumped - try again near the tracks.' };
        }
    }

    const region = $userRegion.get() || 'GP';
    let snap = null;
    try {
        const { snapToRail } = await import('./rail-tracks.js');
        snap = await snapToRail(last.lat, last.lng, region, 400);
    } catch { /* tracks optional */ }

    const nearStation = nearestStationMeters(last.lat, last.lng);
    const atPlatform = nearStation != null && nearStation < STATION_NEAR_M;
    if (snap && snap.distanceM != null && snap.distanceM > TRACK_MAX_M && !atPlatform) {
        return { ok: false, message: 'You need to be near the railway to contribute.' };
    }

    const isMoving = displacement >= MOVE_MIN_M;
    if (!isMoving && !atPlatform && !(snap && snap.distanceM <= TRACK_MAX_M)) {
        return { ok: false, message: 'Stand at a station, or contribute while the train is moving.' };
    }

    let heading = last.heading;
    if ((heading == null || Number.isNaN(heading)) && samples.length >= 2) {
        heading = (Math.atan2(last.lng - first.lng, last.lat - first.lat) * 180) / Math.PI;
    }

    const lat = snap?.ok ? snap.lat : last.lat;
    const lng = snap?.ok ? snap.lon : last.lng;
    lastCoords = { lat, lng, accuracy: last.accuracy };
    return {
        ok: true,
        lat,
        lng,
        heading: typeof heading === 'number' ? heading : null,
        speedMps,
        isMoving,
        atPlatform,
        trackM: snap?.distanceM ?? null,
    };
}

let lastVet = null;

/**
 * 30s foreground sample → snap to track / station. Used before contribute or join.
 */
export async function runContributeVet() {
    if (lastVet && Date.now() - lastVet.at < 60000 && lastVet.result?.ok) {
        return lastVet.result;
    }
    document.getElementById('map-contribute-sheet')?.classList.remove('hidden');
    setStatus('Checking you’re on the railway… 30s');
    setVetProgress(0, 'Hold still or stay on the train - 30 seconds');
    try {
        const samples = await sampleGpsFor(VET_WINDOW_MS, (_s, pct) => {
            const left = Math.max(0, Math.ceil((100 - pct) / 100 * 30));
            setVetProgress(pct, `Checking location… ${left}s`);
            setStatus(`Checking you’re genuine… ${left}s`);
        });
        const vet = await vetLocationSamples(samples);
        hideVetProgress();
        lastVet = { at: Date.now(), result: vet };
        if (!vet.ok) {
            setStatus(vet.message);
            showToast(vet.message, 'error');
        }
        return vet;
    } catch (e) {
        hideVetProgress();
        const msg = e?.code === 1
            ? 'Location permission denied'
            : (e?.message || 'Couldn’t get location');
        setStatus(msg);
        showToast(msg, 'error');
        return { ok: false, message: msg };
    }
}

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const ONBOARD_SAMPLE_MS = 8000;

/**
 * I’m on it: start GPS immediately and narrate checks in a dismissable toast.
 * Does not re-check scheduled time — the board already windows reports.
 */
export async function runOnboardToastVet(trainId) {
    const {
        routeHasStationCoords,
        expectedPosition,
        ghostHeadingDeg,
        headingAgrees,
        journeyHeadingDeg,
        railPathForTrain,
        scoreFixToRailPath,
        TRAIN_TRACKER_MAX_M,
        NO_COORDS_MESSAGE,
    } = await import('./train-ghosts.js');
    const routeId = $currentRouteId.get();
    openShareChecks(trainId);
    if (!routeHasStationCoords(routeId)) {
        addShareCheck('Rail geometry', NO_COORDS_MESSAGE, 'fail');
        setShareDecision(NO_COORDS_MESSAGE, false);
        showToast(NO_COORDS_MESSAGE, 'info', 5000);
        return { ok: false, noCoords: true, message: NO_COORDS_MESSAGE };
    }

    addShareCheck('Rail geometry', `Station coordinates are available for Train ${trainId}.`);
    const railPath = await railPathForTrain(trainId, { routeId, region: $userRegion.get() || 'GP' });
    if (!railPath?.length) {
        const message = 'Couldn’t build the selected train’s rail path.';
        addShareCheck('Selected train path', message, 'fail');
        setShareDecision(message, false);
        return { ok: false, noCoords: true, message };
    }
    addShareCheck('Selected train path', `Built an origin-to-terminus path with ${railPath.length} rail points.`);
    let samples;
    try {
        samples = await sampleGpsFor(ONBOARD_SAMPLE_MS, (list) => {
            const last = list[list.length - 1];
            const status = document.getElementById('nt-share-checks-status');
            if (status && last) status.textContent = `Collecting GPS fixes… ${list.length} received`;
        });
    } catch (e) {
        const msg = e?.code === 1
            ? 'Location permission denied'
            : (e?.message || 'Couldn’t get location');
        addShareCheck('GPS samples', msg, 'fail');
        setShareDecision(msg, false);
        return { ok: false, message: msg };
    }

    if (!samples?.length) {
        const msg = 'Couldn’t get a GPS fix. Try again outdoors.';
        addShareCheck('GPS samples', msg, 'fail');
        setShareDecision(msg, false);
        return { ok: false, message: msg };
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    addShareCheck('GPS samples', `${samples.length} fixes received. Accuracy is ${Number.isFinite(last.accuracy) ? `±${Math.round(last.accuracy)} m` : 'unknown'}.`);
    const pathPoint = scoreFixToRailPath(last.lat, last.lng, railPath);
    const metres = pathPoint?.distanceM ?? Infinity;
    addShareCheck(
        'Distance to selected rail path',
        Number.isFinite(metres)
            ? `Closest rail point on Train ${trainId}’s path is ${formatDistanceM(metres)} away.`
            : 'Couldn’t measure distance to the selected train path.',
        Number.isFinite(metres) ? 'pass' : 'fail'
    );
    const nearStation = nearestStationMeters(last.lat, last.lng);
    const atPlatform = nearStation != null && nearStation < STATION_NEAR_M;
    const onRails = metres <= TRACK_MAX_M || atPlatform;
    addShareCheck(
        'Rail proximity',
        atPlatform
            ? `Within ${formatDistanceM(nearStation)} of a station platform.`
            : (onRails ? 'GPS fix is close to the selected train path.' : `GPS fix is ${formatDistanceM(metres)} from the selected train path.`),
        onRails ? 'pass' : 'fail'
    );

    const displacement = haversineM(first, last);
    const dt = Math.max(1, (last.t - first.t) / 1000);
    const hasGpsSpeed = typeof last.speed === 'number' && last.speed >= 0 && !Number.isNaN(last.speed);
    const derivedSpeed = displacement / dt;
    const hasDerivedSpeed = samples.length >= 2 && displacement >= MOVE_MIN_M;
    const speedMps = hasGpsSpeed ? last.speed : (hasDerivedSpeed ? derivedSpeed : null);
    if (speedMps != null) {
        const kmh = Math.max(0, Math.round(speedMps * 3.6));
        addShareCheck('Movement', `GPS reports about ${kmh} km/h over ${Math.round(displacement)} m.`);
    } else {
        addShareCheck('Movement', 'No reliable speed from GPS yet.', 'fail');
    }

    let heading = last.heading;
    if ((heading == null || Number.isNaN(heading)) && samples.length >= 2) {
        heading = (Math.atan2(last.lng - first.lng, last.lat - first.lat) * 180) / Math.PI;
    }
    const ghost = expectedPosition(trainId);
    const journeyH = journeyHeadingDeg(trainId);
    const ghostH = ghostHeadingDeg(ghost);
    const targetH = Number.isFinite(journeyH) ? journeyH : ghostH;
    const moving = (speedMps != null && speedMps >= 1.5) || displacement >= MOVE_MIN_M;
    const agrees = headingAgrees(heading, targetH);
    const headingPass = !moving || atPlatform || agrees;
    addShareCheck(
        'Direction',
        !moving
            ? 'Direction is deferred until movement is detected.'
            : (headingPass ? `Heading agrees with Train ${trainId}’s journey.` : `Heading does not agree with Train ${trainId}’s journey yet.`),
        headingPass ? 'pass' : 'fail'
    );
    const tooFar = !Number.isFinite(metres) || metres > TRAIN_TRACKER_MAX_M;
    lastCoords = {
        lat: onRails && pathPoint ? pathPoint.lat : last.lat,
        lng: onRails && pathPoint ? pathPoint.lon : last.lng,
        accuracy: last.accuracy,
    };

    const attach = onRails && !tooFar && (moving || atPlatform) && headingPass;
    const ok = onRails && !tooFar && headingPass;
    if (!ok) {
        const msg = !onRails
            ? 'You need to be near the railway to share this train.'
            : tooFar
                ? `You’re too far from Train ${trainId}’s rail path`
                : `Heading doesn’t match Train ${trainId}`;
        setShareDecision(`${msg}. You will not appear as the train.`, false);
        return {
            ok: false,
            message: msg,
            lat: lastCoords.lat,
            lng: lastCoords.lng,
            heading: typeof heading === 'number' && !Number.isNaN(heading) ? heading : null,
            speedMps,
            isMoving: moving,
            metres,
            headingAgrees: agrees,
            attach: false,
            tooFar,
            onRails,
            trackM: Number.isFinite(metres) ? metres : null,
            pathPoint,
            atPlatform,
            actualLat: last.lat,
            actualLng: last.lng,
        };
    }

    setShareDecision(attach
        ? `Checks passed. You can appear as Train ${trainId}.`
        : `Checks passed, but movement is not confirmed; you will appear as a person.`, attach);
    return {
        ok: true,
        lat: lastCoords.lat,
        lng: lastCoords.lng,
        heading: typeof heading === 'number' && !Number.isNaN(heading) ? heading : null,
        speedMps,
        isMoving: moving,
        metres,
        headingAgrees: agrees,
        attach,
        tooFar,
        onRails,
        trackM: Number.isFinite(metres) ? metres : null,
        pathPoint,
        atPlatform,
        actualLat: last.lat,
        actualLng: last.lng,
    };
}

/**
 * Trains on the live board (and the open planner trip) inside the 45-minute
 * window. When we know the rider's position, each candidate is also scored for
 * whether that position makes sense for the train.
 */
export function listContributeCandidates(coords = lastCoords) {
    const routeId = $currentRouteId.get();
    const station = document.getElementById('station-select')?.value || '';
    const now = nowSeconds();
    /** @type {Array<{ trainId: string, scheduledTime: string, arrivalTime?: string, station: string, destination: string, routeId: string, source: string, driftMin: number, distanceKm: number|null, plausible: boolean }>} */
    const out = [];
    const seen = new Set();

    const push = (c) => {
        if (!c?.trainId || !c.scheduledTime) return;
        if (!isRealTime(c.scheduledTime)) return;
        const dep = timeToSeconds(c.scheduledTime);
        if (dep == null || Number.isNaN(dep)) return;
        const drift = now - dep;
        if (Math.abs(drift) > CONTRIBUTE_WINDOW_SEC) return;
        const key = `${c.routeId}|${c.trainId}|${c.scheduledTime}|${c.station}`;
        if (seen.has(key)) return;
        seen.add(key);

        const distanceKm = distanceToExpectedStation(c, coords);
        out.push({
            ...c,
            driftMin: Math.round(drift / 60),
            distanceKm,
            // Unknown distance stays linkable — we only block a clear mismatch.
            plausible: relaxLiveShareGuards() || distanceKm == null || distanceKm <= CONTRIBUTE_MATCH_KM,
        });
    };

    // Board schedule keyed by destination
    try {
        Object.entries(currentScheduleData || {}).forEach(([dest, journeys]) => {
            (journeys || []).forEach((j) => {
                const scheduledTime = j.departureTime || j.train1?.departureTime;
                const trainId = j.train || j.train1?.train;
                push({
                    trainId: String(trainId || ''),
                    scheduledTime: String(scheduledTime || ''),
                    arrivalTime: j.arrivalTime || j.train1?.arrivalAtTransfer || '',
                    station: station || j.from || '',
                    destination: dest || j.train1?.headboardDestination || '',
                    routeId,
                    source: 'board',
                });
            });
        });
    } catch { /* ignore */ }

    // Planner: currently viewed trip (if any)
    try {
        const trips = window.currentTripOptions || [];
        const idx = window._plannerCurrentTripIndex || 0;
        const trip = trips[idx];
        if (trip) {
            const legs = trip.legs || (trip.leg1 ? [trip.leg1, trip.leg2, trip.leg3].filter(Boolean) : []);
            const primary = legs[0] || trip;
            const scheduledTime = primary.depTime || trip.depTime;
            const trainId = primary.train || trip.train || trip.trainId;
            push({
                trainId: String(trainId || 'trip'),
                scheduledTime: String(scheduledTime || ''),
                arrivalTime: primary.arrTime || trip.arrTime || '',
                station: trip.from || station,
                destination: trip.to || '',
                routeId: primary.routeId || trip.routeId || routeId,
                source: 'planner',
            });
        }
    } catch { /* ignore */ }

    return out.sort((a, b) => timeToSeconds(a.scheduledTime) - timeToSeconds(b.scheduledTime));
}

function hideContributeSheet() {
    document.getElementById('map-contribute-sheet')?.classList.add('hidden');
}

function formatDistanceM(metres) {
    if (!Number.isFinite(metres)) return 'distance unknown';
    if (metres < 1000) return `${Math.round(metres)} m`;
    return `${(metres / 1000).toFixed(1)} km`;
}

function clockHm(ts) {
    const d = new Date(ts || 0);
    if (Number.isNaN(d.getTime()) || !ts) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function stationShortName(name) {
    return String(name || '').replace(/ STATION$/i, '').trim();
}

function nearbyRealtimeLine(trainId, extra = {}, pingMod = {}, delayMod = {}) {
    const routeId = extra.routeId || $currentRouteId.get();
    let place = '';
    let when = '';
    try {
        const pings = pingMod.getCachedRidePings?.(routeId) || [];
        const ranked = pingMod.rankVerifiedPings?.(pings, trainId) || [];
        const driver = ranked[0]?.ping;
        if (driver) {
            place = stationShortName(driver.station);
            if (!place && typeof driver.coarseLat === 'number') {
                const near = pingMod.nearestStationOnRoute?.(driver.coarseLat, driver.coarseLng, routeId);
                place = stationShortName(near?.stationName);
            }
            when = clockHm(driver.at);
        }
    } catch { /* optional */ }
    try {
        const reports = delayMod.reportsForTrain?.(trainId, routeId) || [];
        if (!place && reports[0]) {
            place = stationShortName(reports[0].station);
            when = clockHm(reports[0].timestamp);
        }
        const status = delayMod.reportStatusPhrase?.(delayMod.summarizeReportsForTrain?.(trainId, routeId)) || '';
        if (!place && !status) return 'Real-time: -';
        const seen = place ? `last seen ${place}${when ? ` - ${when}` : ''}` : '';
        return `Real-time: ${[seen, status].filter(Boolean).join(' · ') || '-'}`;
    } catch {
        if (!place) return 'Real-time: -';
        return `Real-time: last seen ${place}${when ? ` - ${when}` : ''}`;
    }
}

function hideNearbyTrainsModal() {
    document.getElementById('nt-nearby-trains-modal')?.classList.add('hidden');
}

/**
 * Full-screen list of timetable trains scored against the rider's fix.
 */
export async function openNearbyTrainsModal({ lat, lng } = {}) {
    hideContributeSheet();
    const modal = document.getElementById('nt-nearby-trains-modal');
    const list = document.getElementById('nt-nearby-list');
    const empty = document.getElementById('nt-nearby-empty');
    if (!modal || !list) return;

    modal.classList.remove('hidden');
    list.innerHTML = `<p class="text-[12px] font-semibold text-gray-500 dark:text-gray-400 text-center py-6">Finding trains near you…</p>`;
    empty?.classList.add('hidden');
    let pingMod = {};
    try {
        pingMod = await import('./ride-pings.js');
    } catch { /* optional */ }
    const currentShare = pingMod.getActiveShare?.();

    const {
        scoreAllTrainsForFix, TRAIN_TRACKER_MAX_M, timetableWhereLabel,
        routeHasStationCoords, NO_COORDS_MESSAGE, trainGoingFullLabel: goingLabel,
    } = await import('./train-ghosts.js');
    if (!routeHasStationCoords($currentRouteId.get()) && !relaxLiveShareGuards()) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        if (empty) empty.textContent = NO_COORDS_MESSAGE;
        showToast(NO_COORDS_MESSAGE, 'info', 5000);
        return;
    }

    let coords = (Number.isFinite(lat) && Number.isFinite(lng))
        ? { lat, lng }
        : (lastCoords || (
            Number.isFinite(currentShare?.projectedLat) && Number.isFinite(currentShare?.projectedLng)
                ? { lat: currentShare.projectedLat, lng: currentShare.projectedLng }
                : null
        ));
    if (!coords) {
        try {
            const pos = await getPosition();
            coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            lastCoords = coords;
        } catch (e) {
            list.innerHTML = '';
            empty?.classList.remove('hidden');
            if (empty) empty.textContent = e?.code === 1
                ? 'Location is off - allow it to see trains near you.'
                : (e?.message || 'Couldn’t get your location.');
            return;
        }
    }

    let delayMod = {};
    try {
        delayMod = await import('./delay-reports.js');
        await delayMod.fetchRecentRouteReports?.($currentRouteId.get());
    } catch { /* reports optional */ }
    const ranked = relaxLiveShareGuards() && !routeHasStationCoords($currentRouteId.get())
        ? []
        : scoreAllTrainsForFix(coords.lat, coords.lng);
    const board = listContributeCandidates(coords);
    const byId = new Map(board.map((c) => [String(c.trainId), c]));
    const rows = ranked.map((r) => {
        const extra = byId.get(String(r.trainId)) || {};
        return {
            ...extra,
            trainId: r.trainId,
            metres: r.metres,
            ghost: r.ghost,
            plausible: relaxLiveShareGuards() || r.metres <= TRAIN_TRACKER_MAX_M,
            scheduledTime: extra.scheduledTime || '',
            destination: extra.destination || '',
            station: extra.station || document.getElementById('station-select')?.value || '',
            routeId: extra.routeId || $currentRouteId.get(),
            driftMin: extra.driftMin,
        };
    });
    board.forEach((c) => {
        if (rows.some((r) => String(r.trainId) === String(c.trainId))) return;
        rows.push({
            ...c,
            metres: c.distanceKm != null ? c.distanceKm * 1000 : Infinity,
            plausible: relaxLiveShareGuards()
                || (!!c.plausible && (c.distanceKm == null || c.distanceKm * 1000 <= TRAIN_TRACKER_MAX_M)),
        });
    });
    const now = nowSeconds();
    const nearby = rows.filter((c) => {
        if (currentShare?.trainId && String(c.trainId) === String(currentShare.trainId)) return false;
        if (c.ghost && !isGhostTrackable(c.ghost, now)) return false;
        if (Number.isFinite(c.driftMin) && Math.abs(c.driftMin) * 60 > TRACKING_WINDOW_SEC) return false;
        return true;
    });
    nearby.sort(compareNearbyTrainLikelihood);

    list.innerHTML = '';
    if (currentShare?.trainId) {
        const ownPing = (pingMod.getCachedRidePings?.(currentShare.routeId) || [])
            .find((p) => p.deviceId === getDeviceId());
        const state = ownPing?.trackingState || currentShare.trackingState || 'active';
        const current = document.createElement('section');
        current.className = 'rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 px-4 py-3';
        current.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-[9px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-300">Currently tracking</p>
                    <p class="text-sm font-black text-gray-900 dark:text-white">Train ${escapeHTML(String(currentShare.trainId))}</p>
                    <p class="mt-0.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400">${state === 'paused' ? 'Paused at the last accepted position' : 'Active tracking'}</p>
                </div>
                <span class="shrink-0 px-2 py-1 rounded-full ${state === 'paused' ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' : 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300'} text-[9px] font-black uppercase">${state === 'paused' ? 'Paused' : 'Active'}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 mt-3">
                <button type="button" data-current-tracking-details class="py-2 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[11px] font-black">Tracking details</button>
                <button type="button" data-current-tracking-stop class="py-2 rounded-xl border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-[11px] font-black">Stop sharing</button>
            </div>`;
        current.querySelector('[data-current-tracking-details]')?.addEventListener('click', () => {
            hideNearbyTrainsModal();
            showTrackingStatusCard();
        });
        current.querySelector('[data-current-tracking-stop]')?.addEventListener('click', async () => {
            const result = await pingMod.stopRideShare?.();
            if (!result?.ok && result?.message) showToast(result.message, 'error');
            hideNearbyTrainsModal();
            syncMapShareChrome();
            syncRidePingsToMap();
        });
        list.appendChild(current);
    }
    if (!nearby.length && !currentShare?.trainId) {
        empty?.classList.remove('hidden');
        return;
    }
    empty?.classList.add('hidden');

    nearby.forEach((c) => {
        const dep = c.scheduledTime
            ? (formatTimeDisplay(c.scheduledTime) || String(c.scheduledTime).slice(0, 5))
            : '';
        const when = Number.isFinite(c.driftMin) ? driftLabel(c.driftMin) : '';
        const dist = formatDistanceM(c.metres);
        const dest = c.destination ? String(c.destination).replace(/ STATION$/i, '') : '';
        const going = (goingLabel || trainGoingFullLabel)(c.trainId, dest || c.destination);
        const where = timetableWhereLabel(c.trainId) || '';
        const liveLine = nearbyRealtimeLine(c.trainId, c, pingMod, delayMod);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `w-full text-left px-3.5 py-3 rounded-xl border ${
            c.plausible
                ? 'bg-white dark:bg-gray-800 border-blue-200 dark:border-blue-800 hover:border-blue-500'
                : 'bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700'
        } focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`;
        btn.innerHTML = `
            <p class="text-sm font-black text-gray-900 dark:text-white">${escapeHTML(going)}</p>
            <p class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mt-0.5">${[dep, when, dist].filter(Boolean).join(' · ')}</p>
            ${where ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">${escapeHTML(where)}</p>` : ''}
            <p class="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">${escapeHTML(liveLine)}</p>
            <p class="text-[11px] mt-1 ${c.plausible ? 'text-blue-600 dark:text-blue-300 font-bold' : 'text-amber-700 dark:text-amber-300'}">${
                ENFORCE_LIVE_SHARE_VET
                    ? (c.plausible
                        ? 'Close enough to track this train'
                        : 'Too far from this train’s path - you’ll show as a person, not a tracker')
                    : 'Tap to share as this train'
            }</p>`;
        btn.addEventListener('click', () => {
            hideNearbyTrainsModal();
            startOnTrainShare({
                trainId: c.trainId,
                station: c.station,
                destination: c.destination || '',
                routeId: c.routeId || $currentRouteId.get(),
                source: c.source === 'planner' ? 'planner_contribute' : 'nearby_modal',
                skipVolunteer: true,
                scheduledTime: c.scheduledTime,
            });
        });
        list.appendChild(btn);
    });
}

function driftLabel(driftMin) {
    if (driftMin === 0) return 'due now';
    if (driftMin > 0) return `${driftMin} min ago`;
    return `in ${Math.abs(driftMin)} min`;
}

async function showContributeSheet() {
    return openNearbyTrainsModal();
}

function getPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Location isn’t available on this device.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 20000,
        });
    });
}

export async function locateOnMapTab() {
    triggerHaptic();
    setStatus('Getting your location…');
    try {
        const pos = await getPosition();
        lastCoords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
        };
        setStatus(`You’re here · ±${Math.round(lastCoords.accuracy || 0)} m`);
        postToMap({
            type: 'nt-map-locate',
            lat: lastCoords.lat,
            lng: lastCoords.lng,
            accuracy: lastCoords.accuracy,
        });
        return { ok: true, coords: lastCoords };
    } catch (e) {
        const msg = e?.code === 1
            ? 'Location permission denied'
            : (e?.message || 'Couldn’t get location');
        setStatus(msg);
        showToast(msg, 'error');
        return { ok: false, message: msg };
    }
}

function hideOnTrainSheet() {
    document.getElementById('nt-on-train-sheet')?.classList.add('hidden');
}

/**
 * @returns {Promise<'primary'|'secondary'|'tertiary'>}
 */
export function promptOnTrainSheet({ title, body, primary, secondary, tertiary } = {}) {
    return new Promise((resolve) => {
        const sheet = document.getElementById('nt-on-train-sheet');
        const titleEl = document.getElementById('nt-on-train-title');
        const bodyEl = document.getElementById('nt-on-train-body');
        const primaryBtn = document.getElementById('nt-on-train-primary');
        const secondaryBtn = document.getElementById('nt-on-train-secondary');
        const tertiaryBtn = document.getElementById('nt-on-train-tertiary');
        if (!sheet || !primaryBtn) {
            resolve('secondary');
            return;
        }
        if (titleEl) titleEl.textContent = title || 'Show others where you are?';
        if (bodyEl) bodyEl.textContent = body || '';
        primaryBtn.textContent = primary || 'Show where I am';
        if (secondaryBtn) secondaryBtn.textContent = secondary || 'Not now';
        if (tertiaryBtn) {
            if (tertiary) {
                tertiaryBtn.textContent = tertiary;
                tertiaryBtn.classList.remove('hidden');
            } else {
                tertiaryBtn.classList.add('hidden');
            }
        }
        sheet.classList.remove('hidden');

        const done = (value) => {
            primaryBtn.removeEventListener('click', onPrimary);
            secondaryBtn?.removeEventListener('click', onSecondary);
            tertiaryBtn?.removeEventListener('click', onTertiary);
            sheet.removeEventListener('click', onBackdrop);
            hideOnTrainSheet();
            resolve(value);
        };
        const onPrimary = () => done('primary');
        const onSecondary = () => done('secondary');
        const onTertiary = () => done('tertiary');
        const onBackdrop = (e) => {
            if (e.target === sheet) done('secondary');
        };
        primaryBtn.addEventListener('click', onPrimary);
        secondaryBtn?.addEventListener('click', onSecondary);
        tertiaryBtn?.addEventListener('click', onTertiary);
        sheet.addEventListener('click', onBackdrop);
    });
}

export async function focusTrainOnMap(trainId) {
    if (!trainId) return;
    triggerHaptic();
    const { switchTab } = await import('./ui.js');
    switchTab('map');
    await syncRidePingsToMap();
    const send = () => postToMap({ type: 'nt-map-focus-train', trainId: String(trainId) });
    send();
    setTimeout(send, 500);
    setTimeout(send, 1400);
}

const locatePromptSeen = new Set();

/** After Locate: if snapped to rails and a ghost is nearby, ask once. */
export async function maybePromptLocateOnTrain(detail) {
    if (!detail || detail.isAuto) return;
    const { isRideCheckInEnabled } = await import('./ride-pings.js');
    if (!isRideCheckInEnabled()) return;
    const lat = Number(detail.lat);
    const lon = Number(detail.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const { snapToRail } = await import('./rail-tracks.js');
    const { resolveTrainAttachment, LOCATE_RAIL_M, LOCATE_GHOST_M } = await import('./train-ghosts.js');
    const region = $userRegion.get() || 'GP';
    const snap = await snapToRail(lat, lon, region, 80);
    if (!snap.ok || (snap.distanceM ?? 999) > LOCATE_RAIL_M) return;

    const decision = resolveTrainAttachment(snap.lat ?? lat, snap.lon ?? lon, null, { maxM: LOCATE_GHOST_M });
    const best = decision.best;
    if (!best?.trainId || best.metres > LOCATE_GHOST_M) return;
    if (locatePromptSeen.has(best.trainId)) return;
    locatePromptSeen.add(best.trainId);

    const choice = await promptOnTrainSheet({
        title: `Are you on train ${best.trainId}?`,
        body: `You’re next to the rails and train ${best.trainId} should be nearby. Share so others can see it?`,
        primary: `Yes - train ${best.trainId}`,
        secondary: 'No thanks',
    });
    if (choice !== 'primary') return;
    await startOnTrainShare({
        trainId: best.trainId,
        station: detail.station || document.getElementById('station-select')?.value || '',
        destination: '',
        routeId: $currentRouteId.get(),
        source: 'locate_prompt',
        skipVolunteer: true,
    });
}

const PARKED_WATCH_KEY = 'ntParkedTrainWatchV1';
const PARKED_POLL_MS = 15000;
let parkedWatchTimer = 0;

function readParkedWatch() {
    try {
        const raw = JSON.parse(safeStorage.getItem(PARKED_WATCH_KEY) || 'null');
        return raw && typeof raw === 'object' ? raw : null;
    } catch {
        return null;
    }
}

function writeParkedWatch(rec) {
    try { safeStorage.setItem(PARKED_WATCH_KEY, JSON.stringify(rec)); } catch { /* ignore */ }
}

function clearParkedWatch() {
    try { safeStorage.removeItem(PARKED_WATCH_KEY); } catch { /* ignore */ }
}

export function stopParkedTrainWatch({ aborted = false } = {}) {
    if (parkedWatchTimer) {
        clearInterval(parkedWatchTimer);
        parkedWatchTimer = 0;
    }
    if (aborted) {
        const rec = readParkedWatch();
        if (rec?.trainId) writeParkedWatch({ ...rec, watching: false, aborted: true, abortedAt: Date.now() });
    }
}

async function parkedWatchTick() {
    if (typeof document !== 'undefined' && document.hidden) {
        stopParkedTrainWatch({ aborted: true });
        return;
    }
    const rec = readParkedWatch();
    if (!rec?.trainId || rec.aborted) {
        stopParkedTrainWatch();
        return;
    }
    if ((rec.until || 0) <= Date.now()) {
        stopParkedTrainWatch();
        showToast('Stopped watching this parked train', 'info');
        return;
    }
    let pos;
    try {
        pos = await getPosition();
    } catch {
        return;
    }
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    lastCoords = { lat, lng, accuracy: pos.coords.accuracy };
    const prev = { lat: rec.lat, lng: rec.lng };
    const displacement = (Number.isFinite(prev.lat) && Number.isFinite(prev.lng))
        ? haversineM(prev, { lat, lng })
        : 0;
    const speedMps = typeof pos.coords.speed === 'number' && pos.coords.speed >= 0
        ? pos.coords.speed
        : displacement / (PARKED_POLL_MS / 1000);
    let heading = typeof pos.coords.heading === 'number' ? pos.coords.heading : null;
    if ((heading == null || Number.isNaN(heading)) && Number.isFinite(prev.lat)) {
        heading = (Math.atan2(lng - prev.lng, lat - prev.lat) * 180) / Math.PI;
    }
    const {
        railPathForTrain, scoreFixToRailPath, journeyHeadingDeg, headingAgrees,
    } = await import('./train-ghosts.js');
    const path = await railPathForTrain(rec.trainId, {
        routeId: rec.routeId,
        region: $userRegion.get() || 'GP',
    });
    const pathPoint = scoreFixToRailPath(lat, lng, path);
    const agrees = headingAgrees(heading, journeyHeadingDeg(rec.trainId));
    const moving = speedMps >= 1.5 || displacement >= MOVE_MIN_M;
    writeParkedWatch({ ...rec, lat, lng, at: Date.now() });
    if (!moving || !agrees) return;
    if (!Number.isFinite(pathPoint?.distanceM) || pathPoint.distanceM > TRACK_MAX_M) return;

    stopParkedTrainWatch();
    clearParkedWatch();
    const shared = await finishRideShare({
        trainId: rec.trainId,
        station: rec.station,
        destination: rec.destination,
        routeId: rec.routeId,
        lat,
        lng,
        heading,
        speedMps,
        source: 'parked_departed',
    });
    if (shared?.ok) {
        showCheckToast(`Sharing Train ${rec.trainId} with other riders`);
        setTimeout(() => hideCheckToast(), 4000);
        scheduleTripWatch({
            trainId: rec.trainId,
            station: rec.station,
            scheduledTime: rec.scheduledTime || '',
            routeId: rec.routeId,
            destination: rec.destination,
        });
    }
}

export function startParkedTrainWatch(payload) {
    stopParkedTrainWatch();
    const rec = {
        trainId: payload.trainId,
        station: payload.station || '',
        destination: payload.destination || '',
        routeId: payload.routeId || $currentRouteId.get(),
        scheduledTime: payload.scheduledTime || '',
        lat: payload.lat,
        lng: payload.lng,
        watching: true,
        aborted: false,
        at: Date.now(),
        until: Date.now() + 10 * 60 * 1000,
    };
    writeParkedWatch(rec);
    bindParkedWatchLifecycle();
    parkedWatchTimer = setInterval(() => { parkedWatchTick().catch(() => {}); }, PARKED_POLL_MS);
}

function bindParkedWatchLifecycle() {
    if (typeof window === 'undefined' || window.__ntParkedWatchBound) return;
    window.__ntParkedWatchBound = true;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (parkedWatchTimer) stopParkedTrainWatch({ aborted: true });
        } else {
            maybeOfferParkedResume();
        }
    });
    window.addEventListener('pagehide', () => {
        if (parkedWatchTimer) stopParkedTrainWatch({ aborted: true });
    });
}

export async function maybeOfferParkedResume() {
    const rec = readParkedWatch();
    if (!rec?.aborted || !rec.trainId) return;
    if ((rec.until || 0) <= Date.now()) {
        clearParkedWatch();
        return;
    }
    const pick = await promptOnTrainSheet({
        title: 'Tracking paused',
        body: 'We couldn’t continue tracking and closed the location to save your battery.',
        primary: 'Continue',
        secondary: 'Close',
    });
    if (pick === 'primary') {
        startParkedTrainWatch(rec);
        showToast('Watching for the train to start moving', 'info');
        return;
    }
    clearParkedWatch();
}

/**
 * Board / map / locate: volunteer sheet → GPS checks → public ping.
 */
export async function startOnTrainShare({
    trainId,
    station,
    destination = '',
    routeId = $currentRouteId.get(),
    source = 'board_on_train',
    skipVolunteer = false,
    scheduledTime = '',
    intent: forcedIntent = '',
} = {}) {
    lastShareRequest = { trainId, station, destination, routeId, source, scheduledTime, intent: 'onboard' };
    triggerHaptic();
    const id = trainId === 'trip' ? null : (trainId || null);
    if (!routeId) {
        showToast('Pick a corridor first', 'error');
        return { ok: false };
    }
    if (!id) {
        showToast('Pick a train first', 'error');
        return { ok: false };
    }
    const { routeHasNoScheduledTrains } = await import('./delay-reports.js');
    if (routeHasNoScheduledTrains()) {
        showToast('There are no trains to share today.', 'info');
        return { ok: false };
    }

    hideContributeSheet();

    let intent = forcedIntent === 'waiting' || forcedIntent === 'onboard' ? forcedIntent : 'onboard';
    if (!skipVolunteer && !forcedIntent) {
        const choice = await promptOnTrainSheet({
            title: trainGoingLabel(id, destination),
            body: `Are you on ${trainGoingLabel(id, destination)}, or waiting at the station? We’ll only move the live clock if you’re on it and moving.`,
            primary: 'I’m on it',
            secondary: 'I’m waiting',
            tertiary: 'Not now',
        });
        if (choice !== 'primary' && choice !== 'secondary') {
            return { ok: false, cancelled: true };
        }
        intent = choice === 'secondary' ? 'waiting' : 'onboard';
    }

    if (intent === 'waiting') {
        let pos;
        try {
            pos = await getPosition();
        } catch {
            showToast('Location is needed to show you as a commuter.', 'error');
            return { ok: false };
        }
        lastCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const result = await finishRideShare({
            trainId: null,
            waitingFor: id,
            station: station || document.getElementById('station-select')?.value || '',
            destination,
            routeId,
            lat: lastCoords.lat,
            lng: lastCoords.lng,
            source: 'waiting',
        });
        return { ...result, asPerson: true, waiting: true };
    }

    setStatus('Checking your location…');
    const vet = await runOnboardToastVet(id);
    const enforce = ENFORCE_LIVE_SHARE_VET;
    const overrideRole = adminShareRole();
    if (isAdminAuthed() && overrideRole !== 'auto') {
        addShareCheck('Admin override', `Force this share to appear as a ${overrideRole}.`, 'decision');
    }

    if (!vet.ok) {
        if (enforce && overrideRole === 'auto') {
            if (!vet.noCoords) hideCheckToast();
            return vet;
        }
        let lat = lastCoords?.lat ?? null;
        let lng = lastCoords?.lng ?? null;
        let heading = null;
        let speedMps = null;
        try {
            const pos = await getPosition();
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            heading = typeof pos.coords.heading === 'number' ? pos.coords.heading : null;
            speedMps = typeof pos.coords.speed === 'number' ? pos.coords.speed : null;
            lastCoords = { lat, lng, accuracy: pos.coords.accuracy };
        } catch { /* still attach so the share is visible */ }
        if (
            (overrideRole === 'train' || overrideRole === 'person')
            && (!Number.isFinite(lat) || !Number.isFinite(lng))
        ) {
            setShareDecision(`Admin ${overrideRole} override still needs a GPS fix.`, false);
            return vet;
        }
        if (overrideRole === 'train' || overrideRole === 'person') {
            vet.ok = true;
            vet.lat = lat;
            vet.lng = lng;
            vet.actualLat = lat;
            vet.actualLng = lng;
            vet.heading = heading;
            vet.speedMps = speedMps;
            vet.isMoving = false;
            vet.headingAgrees = false;
            vet.metres = vet.trackM ?? Infinity;
        } else {
            const st = station || document.getElementById('station-select')?.value || 'here';
            const sharedAnyway = await finishRideShare({
                trainId: id,
                station: st,
                destination,
                routeId,
                lat,
                lng,
                heading,
                speedMps,
                source,
            });
            if (sharedAnyway?.ok) {
                scheduleTripWatch({
                    trainId: id,
                    station: st,
                    scheduledTime: scheduledTime || '',
                    routeId,
                    destination,
                });
            }
            return sharedAnyway;
        }
    }

    if (overrideRole === 'person') {
        const st = station || document.getElementById('station-select')?.value || 'here';
        const result = await finishRideShare({
            trainId: null,
            waitingFor: id,
            station: st,
            destination,
            routeId,
            lat: vet.actualLat ?? vet.lat,
            lng: vet.actualLng ?? vet.lng,
            heading: vet.heading,
            speedMps: vet.speedMps,
            source: 'admin_override_person',
            adminOverrideRole: 'person',
        });
        setShareDecision(`Admin override applied. You appear as a person waiting for Train ${id}.`, !!result?.ok);
        return { ...result, asPerson: true, adminOverride: 'person' };
    }

    const { TRAIN_TRACKER_MAX_M, expectedPosition, ghostHeadingDeg, headingAgrees } = await import('./train-ghosts.js');
    let finalId = id;
    let confirmedCloser = false;

    const metres = vet.metres;
    const tooFar = Number.isFinite(metres) && metres > TRAIN_TRACKER_MAX_M;
    const st = station || document.getElementById('station-select')?.value || '';
    let moving = !!(vet.isMoving || (typeof vet.speedMps === 'number' && vet.speedMps >= 1.5));
    let headingOk = vet.headingAgrees !== false;

    if (enforce && overrideRole !== 'train' && !tooFar && !moving) {
        hideCheckToast();
        const parked = await promptOnTrainSheet({
            title: 'Is the train moving?',
            body: 'GPS doesn’t show movement yet - trains often sit at a station. If you’re parked, we’ll thank you for sharing and watch in the background until the train starts moving the right way.',
            primary: 'Yes, we’re moving',
            secondary: 'No, we’re parked',
            tertiary: 'Cancel',
        });
        if (parked === 'tertiary') {
            return { ok: false, cancelled: true };
        }
        if (parked === 'primary') {
            showCheckToast('Checking movement again…');
            try {
                const extra = await sampleGpsFor(5000);
                if (extra?.length >= 2) {
                    const a = extra[0];
                    const b = extra[extra.length - 1];
                    const d = haversineM(a, b);
                    const dt = Math.max(1, (b.t - a.t) / 1000);
                    const spd = typeof b.speed === 'number' && b.speed >= 0 ? b.speed : d / dt;
                    moving = spd >= 1.5 || d >= MOVE_MIN_M;
                    vet.lat = b.lat;
                    vet.lng = b.lng;
                    vet.speedMps = spd;
                    let extraH = b.heading;
                    if ((extraH == null || Number.isNaN(extraH)) && extra.length >= 2) {
                        extraH = (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI;
                    }
                    vet.heading = extraH;
                    headingOk = headingAgrees(extraH, ghostHeadingDeg(expectedPosition(finalId)));
                    lastCoords = { lat: b.lat, lng: b.lng, accuracy: b.accuracy };
                }
            } catch { /* keep moving=false */ }
            if (!moving) {
                const result = await finishRideShare({
                    trainId: null,
                    waitingFor: finalId,
                    station: st,
                    destination,
                    routeId,
                    lat: vet.lat,
                    lng: vet.lng,
                    heading: vet.heading,
                    speedMps: vet.speedMps,
                    source: 'parked_station',
                    quiet: true,
                });
                hideCheckToast();
                startParkedTrainWatch({
                    trainId: finalId,
                    station: st,
                    destination,
                    routeId,
                    scheduledTime,
                    lat: vet.lat,
                    lng: vet.lng,
                });
                showToast('Still looks parked - thanks, we’ll attach you when it moves', 'info', 5000);
                return { ...result, asPerson: true, parked: true };
            }
        } else {
            const result = await finishRideShare({
                trainId: null,
                waitingFor: finalId,
                station: st,
                destination,
                routeId,
                lat: vet.lat,
                lng: vet.lng,
                heading: vet.heading,
                speedMps: vet.speedMps,
                source: 'parked_station',
                quiet: true,
            });
            startParkedTrainWatch({
                trainId: finalId,
                station: st,
                destination,
                routeId,
                scheduledTime,
                lat: vet.lat,
                lng: vet.lng,
            });
            showToast('Thanks for sharing - we’ll attach you when the train starts moving', 'success', 5000);
            return { ...result, asPerson: true, parked: true };
        }
    }

    const attach = overrideRole === 'train' || !enforce || (!tooFar && moving && headingOk);

    if (!attach) {
        const result = await finishRideShare({
            trainId: null,
            waitingFor: finalId,
            station: st,
            destination,
            routeId,
            lat: vet.lat,
            lng: vet.lng,
            heading: vet.heading,
            speedMps: vet.speedMps,
            source: tooFar ? 'presence_too_far' : 'waiting_not_moving',
        });
        hideCheckToast();
        showToast(tooFar
            ? `You’re about ${formatDistanceM(metres)} from the selected rail path - sharing as a commuter`
            : 'We’ll show you as a commuter until you’re moving with the train', 'info', 5000);
        return { ...result, asPerson: true, tooFar, waiting: !tooFar };
    }

    const shared = await finishRideShare({
        trainId: finalId,
        station: st,
        destination,
        routeId,
        lat: vet.lat,
        lng: vet.lng,
        heading: vet.heading,
        speedMps: vet.speedMps,
        source: overrideRole === 'train' ? 'admin_override_train' : (confirmedCloser ? 'closer_confirm' : source),
        adminOverrideRole: overrideRole === 'train' ? 'train' : '',
        overrideProjected: overrideRole === 'train' ? vet.pathPoint : null,
    });
    if (shared?.ok) {
        setShareDecision(
            overrideRole === 'train'
                ? `Admin override applied. You appear as Train ${finalId}.`
                : `Sharing accepted. You appear as Train ${finalId}.`,
            true
        );
        scheduleTripWatch({
            trainId: finalId,
            station: st,
            scheduledTime: scheduledTime || '',
            routeId,
            destination,
        });
    } else {
        hideCheckToast();
    }
    return shared;
}

async function finishRideShare({
    trainId, station, destination, routeId, lat, lng, heading, speedMps, accuracy, source, waitingFor,
    quiet = false, adminOverrideRole = '', overrideProjected = null,
}) {
    try {
        const { submitRideCheckIn, isRideCheckInEnabled } = await import('./ride-pings.js');
        const { fetchFeatures } = await import('./features.js');
        await fetchFeatures();
        if (!isRideCheckInEnabled(routeId)) {
            showToast('Ride contribution isn’t on for this corridor yet', 'error');
            setStatus('Contribution not available on this corridor');
            return { ok: false };
        }

        const result = await submitRideCheckIn({
            routeId,
            station,
            trainId,
            destination: destination || null,
            coarseLat: lat,
            coarseLng: lng,
            heading,
            speedMps,
            accuracy: accuracy ?? lastCoords?.accuracy ?? null,
            source: source || 'board_on_train',
            waitingFor: waitingFor || null,
            quiet,
            adminOverrideRole,
            overrideProjected,
        });

        if (!result.ok) {
            if (!result.cancelled) showToast(result.message || 'Couldn’t share', 'error');
            setStatus(result.message || 'Couldn’t share');
            return result;
        }

        setStatus(trainId
            ? `Sharing · train ${trainId}`
            : 'Sharing where you are');
        postToMap({
            type: 'nt-map-contribute',
            lat,
            lng,
            trainId,
            station,
        });
        syncRidePingsToMap(routeId);
        syncMapShareChrome();
        if (trainId) {
            const { startOnboardPingLoop } = await import('./ride-pings.js');
            startOnboardPingLoop();
            trackingCardMode = 'expanded';
            showTrackingStatusCard();
        }
        return { ok: true, trainId };
    } catch (e) {
        showToast(e?.message || 'Couldn’t share', 'error');
        return { ok: false, message: e?.message };
    }
}

/**
 * Volunteer coarse location for a specific train.
 */
export async function contributeForTrain(candidate) {
    return startOnTrainShare({
        trainId: candidate?.trainId,
        station: candidate?.station,
        destination: candidate?.destination || '',
        routeId: candidate?.routeId || $currentRouteId.get(),
        source: candidate?.source === 'planner' ? 'planner_contribute'
            : candidate?.source === 'map_join' ? 'map_join'
            : 'map_contribute',
        scheduledTime: candidate?.scheduledTime || '',
        skipVolunteer: candidate?.source === 'map_join' || candidate?.skipVolunteer === true,
    });
}

/** Push corridor riders onto the embedded map. Prefer the live listener cache. */
export async function syncRidePingsToMap(routeId = $currentRouteId.get()) {
    if (!routeId) return;
    try {
        const ride = await import('./ride-pings.js');
        const mine = getDeviceId();
        let pings = ride.getCachedRidePings?.(routeId) || [];
        if (!ride.hasRidePingsListener?.(routeId) || !pings.length) {
            pings = await ride.fetchRouteRidePings(routeId);
        }
        const markers = typeof ride.compactPingsForMap === 'function'
            ? await ride.compactPingsForMap(pings, { mineDeviceId: mine, routeId })
            : (pings || [])
                .filter((p) => typeof p.coarseLat === 'number' && typeof p.coarseLng === 'number')
                .map((p) => ({
                    lat: p.coarseLat,
                    lng: p.coarseLng,
                    trainId: ride.pingPublicTrainId(p),
                    station: p.station || '',
                    at: p.at,
                    expiresAt: p.expiresAt,
                    heading: p.heading,
                    speedMps: p.speedMps,
                    mine: p.deviceId === mine,
                    n: 1,
                    routeId: p.routeId || routeId,
                }));
        const groupedMine = markers.find((m) => m.mine) || null;
        const ownPing = (pings || []).find((p) => p.deviceId === mine) || null;
        const ownMetrics = ownPing
            ? { ...groupedMine, ...ownPing, n: groupedMine?.n || 1 }
            : groupedMine;
        renderTrackingStatusCard(ride.getActiveShare?.(), ownMetrics);
        const sig = markers.map((m) => `${m.trainId || ''}:${m.lat}:${m.lng}:${m.n || 1}:${m.mine ? 1 : 0}:${m.at || 0}:${m.bearing || ''}:${m.trackingState || ''}:${m.accuracy || ''}:${m.railDistanceM || ''}`).join('|');
        if (sig === lastMapPingSig) return;
        lastMapPingSig = sig;
        postToMap({ type: 'nt-map-ride-pings', pings: markers });

        const others = markers.filter((m) => !m.mine).length;
        if (others > 0) {
            setStatus(`${others} rider${others === 1 ? '' : 's'} sharing on this corridor`);
        }
    } catch { /* optional */ }
}

export function syncMapShareChrome() {
    const btn = document.getElementById('map-tab-stop-btn');
    if (!btn) return;
    import('./ride-pings.js').then(({ getActiveShare }) => {
        const mine = getActiveShare();
        const on = !!mine;
        btn.classList.toggle('hidden', !on);
        if (on) {
            btn.removeAttribute('hidden');
            btn.setAttribute('aria-hidden', 'false');
        } else {
            btn.setAttribute('hidden', '');
            btn.setAttribute('aria-hidden', 'true');
        }
        btn.setAttribute('aria-label', mine?.trainId ? `Stop sharing Train ${mine.trainId}` : 'Stop sharing');
        if (!mine) renderTrackingStatusCard(null);
    }).catch(() => {});
}

function getDeviceId() {
    try {
        return localStorage.getItem('next_train_device_id') || '';
    } catch {
        return '';
    }
}

function startPingsPolling() {
    stopPingsPolling();
    const schedule = async () => {
        let ms = PINGS_POLL_MS;
        try {
            const ride = await import('./ride-pings.js');
            const id = $currentRouteId.get();
            if (ride.hasRidePingsListener?.(id)) ms = PINGS_POLL_WITH_LISTENER_MS;
        } catch { /* keep REST interval */ }
        pingsTimer = setTimeout(async () => {
            if (document.getElementById('view-map')?.classList.contains('active')) {
                lastMapPingSig = '';
                await syncRidePingsToMap();
            }
            if (pingsTimer) schedule();
        }, ms);
    };
    schedule();
}

function stopPingsPolling() {
    if (pingsTimer) clearTimeout(pingsTimer);
    pingsTimer = 0;
}

export function openContributePicker() {
    if (!LIVE_LOCATION_SHARE_UI_ENABLED) return;
    import('./ride-pings.js').then((m) => m.startPresenceShare({ source: 'map_presence' })).catch(() => {
        triggerHaptic();
        showContributeSheet();
    });
}

const TRIP_WATCH_KEY = 'ntTripWatchV1';
let tripWatchTimer = 0;

function scheduledTimeToMs(scheduledTime) {
    const sec = timeToSeconds(scheduledTime);
    if (!scheduledTime || !Number.isFinite(sec)) return NaN;
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + sec * 1000;
}

export function clearTripWatch() {
    if (tripWatchTimer) {
        clearTimeout(tripWatchTimer);
        tripWatchTimer = 0;
    }
    try { safeStorage.removeItem(TRIP_WATCH_KEY); } catch { /* ignore */ }
}

/** After a train attach: later ask late vs didn’t board if they’re still at the station. */
export function scheduleTripWatch({ trainId, station, scheduledTime, routeId, destination } = {}) {
    clearTripWatch();
    if (!trainId) return;
    const depMs = scheduledTimeToMs(scheduledTime);
    const fireAt = Number.isFinite(depMs)
        ? depMs + 2 * 60 * 1000
        : Date.now() + 3 * 60 * 1000;
    const delay = Math.min(8 * 60 * 1000, Math.max(90 * 1000, fireAt - Date.now()));
    const payload = {
        trainId,
        station: station || '',
        scheduledTime: scheduledTime || '',
        routeId: routeId || '',
        destination: destination || '',
        fireAt: Date.now() + delay,
    };
    try { safeStorage.setItem(TRIP_WATCH_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
    tripWatchTimer = setTimeout(() => runTripWatch(payload), delay);
}

export function resumeTripWatch() {
    if (tripWatchTimer) return;
    let raw = null;
    try { raw = JSON.parse(safeStorage.getItem(TRIP_WATCH_KEY) || 'null'); } catch { return; }
    if (!raw?.trainId) return;
    const delay = (raw.fireAt || 0) - Date.now();
    if (delay > 20 * 60 * 1000) {
        clearTripWatch();
        return;
    }
    tripWatchTimer = setTimeout(() => runTripWatch(raw), Math.max(0, delay));
}

async function runTripWatch(watch) {
    tripWatchTimer = 0;
    try { safeStorage.removeItem(TRIP_WATCH_KEY); } catch { /* ignore */ }
    const { getActiveShare, stopRideShare } = await import('./ride-pings.js');
    const mine = getActiveShare();
    if (!mine || String(mine.trainId || '') !== String(watch.trainId)) return;

    let pos;
    try {
        pos = await getPosition();
    } catch {
        return;
    }
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    lastCoords = { lat, lng, accuracy: pos.coords.accuracy };

    const st = stationCoords(watch.station);
    const stationM = st
        ? haversineM({ lat, lng }, { lat: st.lat, lng: st.lon ?? st.lng })
        : Infinity;
    if (stationM > STATION_NEAR_M) return;

    const pick = await promptOnTrainSheet({
        title: `Still at ${watch.station || 'the station'}?`,
        body: `Train ${watch.trainId} should have left. We can’t tell if it’s running late or you didn’t board.`,
        primary: 'Train is late',
        secondary: 'I didn’t board',
        tertiary: 'I’m on it',
    });

    if (pick === 'primary') {
        const { submitQuickDelayReport } = await import('./delay-reports.js');
        const result = await submitQuickDelayReport({
            routeId: watch.routeId || mine.routeId,
            trainId: watch.trainId,
            scheduledTime: watch.scheduledTime,
            station: watch.station,
            destination: watch.destination,
            status: 'late',
            lateBucket: 'unsure',
            source: 'trip_watch',
        });
        showToast(
            result.ok ? 'Thanks - we’ll show this train as late' : (result.message || 'Couldn’t send the late report'),
            result.ok ? 'success' : 'error',
        );
        return;
    }
    if (pick === 'secondary') {
        await stopRideShare({ quiet: true });
        showToast('Thanks - we stopped tracking you', 'success');
        return;
    }
    showToast(`Still showing you on train ${watch.trainId}`, 'info');
}

/**
 * Soft offer when a planner trip leaves within 15 minutes.
 * On tap: quick sign-in if needed, then share as a train tracker only if
 * the rider is close to the departure station.
 */
export function maybeOfferPlannerContribute() {
    const bannerId = 'planner-contribute-banner';
    let banner = document.getElementById(bannerId);
    const results = document.getElementById('planner-results-section');
    if (!results || results.classList.contains('hidden')) {
        banner?.remove();
        return;
    }

    const candidates = listContributeCandidates().filter((c) => c.source === 'planner');
    const c = candidates[0];
    if (!c?.trainId) {
        banner?.remove();
        return;
    }

    const untilSec = timeToSeconds(c.scheduledTime) - nowSeconds();
    if (untilSec > 15 * 60 || untilSec < -2 * 60) {
        banner?.remove();
        return;
    }

    const from = stationCoords(c.station);
    if (!relaxLiveShareGuards() && lastCoords && from) {
        const d = haversineM(lastCoords, { lat: from.lat, lng: from.lon ?? from.lng });
        if (d > 800) {
            banner?.remove();
            return;
        }
    }

    if (!banner) {
        banner = document.createElement('div');
        banner.id = bannerId;
        banner.className = 'mx-4 mb-3 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50';
        results.insertBefore(banner, results.firstChild);
    }

    const mins = Math.max(1, Math.round(Math.abs(untilSec) / 60));
    const when = untilSec >= 0 ? `Leaves in about ${mins} min` : `Due about ${mins} min ago`;
    banner.innerHTML = `
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-black text-gray-900 dark:text-white">${when}.</p>
          <p class="text-[10px] text-gray-600 dark:text-gray-400 leading-snug">Share this trip to help other riders - and earn points.</p>
        </div>
        <button type="button" id="planner-contribute-go" class="shrink-0 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-bold">Share this trip</button>
        <button type="button" id="planner-contribute-dismiss" class="shrink-0 p-1 text-gray-400" aria-label="Dismiss">✕</button>
      </div>`;
    document.getElementById('planner-contribute-go')?.addEventListener('click', () => {
        sharePlannerTrip(c);
    });
    document.getElementById('planner-contribute-dismiss')?.addEventListener('click', () => banner.remove());
}

async function sharePlannerTrip(c) {
    const { $account, openAccountModal, waitForSignedIn } = await import('./account.js');
    if ($account.get().status !== 'signed-in') {
        showToast('Quick sign-in to share this trip and earn points.', 'info');
        openAccountModal();
        const ok = await waitForSignedIn();
        if (!ok) {
            showToast('Sign in when you’re ready - you can still use the trip plan.', 'info');
            return;
        }
    }

    showToast('Checking you’re near the station…', 'info');
    let pos;
    try {
        pos = await getPosition();
    } catch {
        showToast('Location is needed to share this trip.', 'error');
        return;
    }
    lastCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const from = stationCoords(c.station);
    const nearStation = relaxLiveShareGuards() || (from
        ? haversineM(lastCoords, { lat: from.lat, lng: from.lon ?? from.lng }) <= 400
        : false);

    if (nearStation) {
        const { switchTab } = await import('./ui.js');
        switchTab('map');
        startOnTrainShare({
            trainId: c.trainId,
            station: c.station,
            destination: c.destination || '',
            routeId: c.routeId || $currentRouteId.get(),
            source: 'planner_contribute',
            skipVolunteer: true,
            scheduledTime: c.scheduledTime,
        });
        return;
    }

    await finishRideShare({
        trainId: null,
        station: c.station,
        destination: c.destination || '',
        routeId: c.routeId || $currentRouteId.get(),
        lat: lastCoords.lat,
        lng: lastCoords.lng,
        source: 'planner_presence_far',
    });
    const pick = await promptOnTrainSheet({
        title: 'You’re a bit far from the station',
        body: `Other riders can see you, but not as a train tracker for ${c.trainId}. Get closer to ${c.station || 'the station'} to appear on that train.`,
        primary: 'See trains near you',
        secondary: 'OK',
    });
    if (pick === 'primary') openNearbyTrainsModal({ lat: lastCoords.lat, lng: lastCoords.lng });
}

export function activateMapTab() {
    exposeEmbedBridge();
    ensureFrameSrc();
    setStatus(lastCoords
        ? `Located · ±${Math.round(lastCoords.accuracy || 0)} m`
        : 'Network overview');
    if (frameLoaded) {
        postToMap({ type: 'nt-map-locate' });
        lastMapPingSig = '';
        syncRidePingsToMap();
    }
    import('./ride-pings.js').then((m) => {
        m.stopShareIfIdle?.();
        const id = $currentRouteId.get();
        if (id && !m.hasRidePingsListener?.(id)) m.startRidePingsListener?.(id);
    }).catch(() => {});
    startPingsPolling();
    syncMapShareChrome();
}

export function deactivateMapTab() {
    hideContributeSheet();
    stopPingsPolling();
}

export function bindMapTabUi() {
    if (typeof document === 'undefined' || window.__ntMapTabBound) return;
    window.__ntMapTabBound = true;
    exposeEmbedBridge();

    // Hide share controls until LIVE_LOCATION_SHARE_UI_ENABLED ships.
    if (!LIVE_LOCATION_SHARE_UI_ENABLED) {
        ['map-tab-contribute-btn', 'map-tab-share-btn', 'map-contribute-sheet', 'nt-nearby-presence'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.add('hidden');
            el.setAttribute('hidden', '');
            el.setAttribute('aria-hidden', 'true');
        });
    }

    document.getElementById('map-tab-contribute-btn')?.addEventListener('click', () => {
        openContributePicker();
    });
    document.getElementById('map-tab-nearby-btn')?.addEventListener('click', () => {
        triggerHaptic();
        openNearbyTrainsModal();
    });
    document.getElementById('map-tab-stop-btn')?.addEventListener('click', async () => {
        triggerHaptic();
        const { stopRideShare } = await import('./ride-pings.js');
        const result = await stopRideShare();
        if (!result.ok && result.message) showToast(result.message, 'error');
        syncMapShareChrome();
        syncRidePingsToMap();
    });
    document.getElementById('map-tracking-stop')?.addEventListener('click', async () => {
        triggerHaptic();
        const { stopRideShare } = await import('./ride-pings.js');
        const result = await stopRideShare();
        if (!result.ok && result.message) showToast(result.message, 'error');
        syncMapShareChrome();
        syncRidePingsToMap();
    });
    document.getElementById('map-tracking-minimize')?.addEventListener('click', () => {
        trackingCardMode = 'minimized';
        syncRidePingsToMap();
    });
    document.getElementById('map-tracking-dismiss')?.addEventListener('click', () => {
        trackingCardMode = 'dismissed';
        syncRidePingsToMap();
    });
    document.getElementById('map-tracking-restore')?.addEventListener('click', showTrackingStatusCard);
    window.addEventListener('nt-ride-pings-updated', (ev) => {
        syncMapShareChrome();
        if (document.getElementById('view-map')?.classList.contains('active')) {
            syncRidePingsToMap(ev?.detail?.routeId);
        }
    });
    // Back-compat if old Share button id remains in cache
    document.getElementById('map-tab-share-btn')?.addEventListener('click', () => {
        openContributePicker();
    });
    document.getElementById('map-contribute-cancel')?.addEventListener('click', hideContributeSheet);
    document.getElementById('nt-nearby-close')?.addEventListener('click', hideNearbyTrainsModal);
    document.getElementById('nt-nearby-dismiss')?.addEventListener('click', hideNearbyTrainsModal);
    document.getElementById('nt-nearby-trains-modal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'nt-nearby-trains-modal') hideNearbyTrainsModal();
    });
    document.getElementById('nt-nearby-presence')?.addEventListener('click', async () => {
        if (!LIVE_LOCATION_SHARE_UI_ENABLED) return;
        hideNearbyTrainsModal();
        const { getActiveShare, startPresenceShare } = await import('./ride-pings.js');
        if (getActiveShare()) return;
        startPresenceShare({ source: 'nearby_presence', skipVolunteer: true, openNearby: false });
    });
    resumeTripWatch();
    bindParkedWatchLifecycle();
    const parked = readParkedWatch();
    if (parked?.aborted) maybeOfferParkedResume();
    else if (parked?.watching && (parked.until || 0) > Date.now()) startParkedTrainWatch(parked);

    document.getElementById('map-tab-retry')?.addEventListener('click', () => {
        ensureFrameSrc(true);
    });

    const frame = frameEl();
    frame?.addEventListener('load', () => {
        try {
            const doc = frame.contentDocument;
            const nestedSpa = !!(doc && (
                doc.getElementById('bottom-nav')
                || doc.getElementById('nt-header')
                || doc.documentElement?.classList.contains('nt-map-iframe-escape')
            ));
            if (nestedSpa) {
                let innerHref = '';
                try { innerHref = frame.contentWindow?.location?.href || ''; } catch { innerHref = ''; }
                const bounced = /[?&]ntMapEsc=1/.test(innerHref) || /[?&]ntMapEsc=1/.test(frame.getAttribute('src') || '');
                if (bounced) {
                    showFrameFallback();
                    return;
                }
                const src = frame.getAttribute('src') || '';
                if (!/\/map\.html/.test(src)) {
                    ensureFrameSrc(true);
                    return;
                }
                // Layout bounce to map.html is in flight — wait for the next load.
                return;
            }
        } catch { /* cross-origin */ }
        frameLoaded = true;
        if (frameWatchdog) clearTimeout(frameWatchdog);
        document.getElementById('map-tab-placeholder')?.classList.add('hidden');
        document.getElementById('map-tab-fallback')?.classList.add('hidden');
        lastMapPingSig = '';
        syncRidePingsToMap();
    });

    window.addEventListener('message', (ev) => {
        const data = ev?.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'nt-map-location' && typeof data.lat === 'number') {
            lastCoords = {
                lat: data.lat,
                lng: data.lng,
                accuracy: data.accuracy,
            };
            setStatus(`You’re here · ±${Math.round(lastCoords.accuracy || 0)} m`);
        }
        if (data.type === 'nt-map-join-train' && data.trainId) {
            const routeId = $currentRouteId.get();
            const station = document.getElementById('station-select')?.value || data.station || '';
            contributeForTrain({
                trainId: String(data.trainId),
                scheduledTime: data.scheduledTime || '',
                station,
                destination: data.destination || '',
                routeId: data.routeId || routeId,
                source: 'map_join',
                skipVolunteer: true,
            });
        }
        if (data.type === 'nt-map-stop-share') {
            import('./ride-pings.js').then(async ({ stopRideShare }) => {
                const result = await stopRideShare();
                if (!result.ok && result.message) showToast(result.message, 'error');
                syncMapShareChrome();
                lastMapPingSig = '';
                syncRidePingsToMap();
            }).catch(() => {});
        }
        if (data.type === 'nt-map-open-timetable') {
            const trainId = String(data.trainId || '').trim();
            const routeId = String(data.routeId || '').trim() || $currentRouteId.get();
            if (!trainId || !routeId) return;
            import('./planner-ui.js').then((mod) => {
                if (typeof mod.openPlannerTrainSheet === 'function') {
                    mod.openPlannerTrainSheet(routeId, trainId);
                }
            }).catch(() => {
                showToast('Full timetable for this train is not available.', 'error');
            });
        }
        if (data.type === 'nt-map-show-tracking-details' && data.trainId) {
            import('./ride-pings.js').then((ride) => {
                const active = ride.getActiveShare?.();
                if (active?.trainId && String(active.trainId) === String(data.trainId)) {
                    showTrackingStatusCard();
                    return;
                }
                ride.openLiveTrackerSheet?.(String(data.trainId), data.routeId || $currentRouteId.get());
            }).catch(() => {});
        }
    });
}

if (typeof window !== 'undefined') {
    window.activateMapTab = activateMapTab;
    window.openContributePicker = openContributePicker;
    window.contributeForTrain = contributeForTrain;
    window.startOnTrainShare = startOnTrainShare;
    window.focusTrainOnMap = focusTrainOnMap;
    window.maybePromptLocateOnTrain = maybePromptLocateOnTrain;
    window.maybeOfferPlannerContribute = maybeOfferPlannerContribute;
    window.openNearbyTrainsModal = openNearbyTrainsModal;
    window.clearTripWatch = clearTripWatch;
    window.bindMapTabUi = bindMapTabUi;
    window.syncMapShareChrome = syncMapShareChrome;
    window.showTrackingStatusCard = showTrackingStatusCard;
    // Legacy name used by map-app share FAB — route to contribute picker
    window.shareMyLocation = openContributePicker;
    window.promptOnTrainSheet = promptOnTrainSheet;
    window.maybeOfferParkedResume = maybeOfferParkedResume;
    window.startParkedTrainWatch = startParkedTrainWatch;
}
