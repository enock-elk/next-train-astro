/**
 * Map tab — embed Leaflet /map + trip-tied location contribution.
 *
 * Contribute = volunteer coarse GPS tied to a train (moving / about to leave /
 * just arrived) for ~10 minutes so others can see where that ride was last seen.
 * Not a social “share my pin” link.
 */
import { withBase, APP_VERSION } from './config.js';
import { showToast, triggerHaptic } from './ui.js';
import { $currentRouteId, $globalStationIndex, $userRegion } from '../store.js';
import {
    timeToSeconds, escapeHTML, formatTimeDisplay, isRealTime,
    normalizeStationName, getDistanceFromLatLonInKm,
} from './utils.js';
import { currentTime } from './logic.js';
import { currentScheduleData } from './live-board.js';

/**
 * A train stays linkable for 30 minutes either side of its scheduled time —
 * Metrorail delays routinely run that long, so a tighter window would reject
 * the riders who are most worth hearing from.
 */
export const CONTRIBUTE_WINDOW_SEC = 30 * 60;

/** How far from the train's expected station a rider can be and still match. */
export const CONTRIBUTE_MATCH_KM = 5;

/** Foreground GPS sample window before a share is accepted. */
export const VET_WINDOW_MS = 30 * 1000;
const TRACK_MAX_M = 150;
const STATION_NEAR_M = 250;
const MOVE_MIN_M = 20;
const HIGHWAY_KMH = 90;

/** Others' pins refresh while the Map tab is open. */
const PINGS_REFRESH_MS = 45 * 1000;
let pingsTimer = 0;

let frameLoaded = false;
/** @type {{ lat: number, lng: number, accuracy?: number } | null} */
let lastCoords = null;

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

function nowSeconds() {
    const t = (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : currentTime;
    return timeToSeconds(t || '00:00:00');
}

/**
 * Extensionless /map with a version query. `/map.html` 308s to `/map`, and the
 * old permanent `/map → /map.html` redirect stays in the browser cache, so a
 * plain `/map` request can still loop; the query bypasses that cached entry.
 */
function mapFrameSrc() {
    const frame = frameEl();
    const raw = frame?.getAttribute('data-map-src') || `${withBase('/map')}?embed=1`;
    let src = String(raw).replace(/\/map\.html(\?|$)/, '/map$1');
    if (!/[?&]v=/.test(src)) {
        src += (src.includes('?') ? '&' : '?') + `v=${encodeURIComponent(APP_VERSION)}`;
    }
    return src;
}

let frameWatchdog = 0;

function showFrameFallback() {
    document.getElementById('map-tab-placeholder')?.classList.add('hidden');
    document.getElementById('map-tab-fallback')?.classList.remove('hidden');
    setStatus('Map didn’t load — reload or open full map');
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
        document.getElementById('map-tab-placeholder')?.classList.remove('hidden');
        // Cache-bust on retry so a cached redirect chain isn't replayed.
        const src = force ? `${mapFrameSrc()}&r=${Date.now()}` : mapFrameSrc();
        frame.setAttribute('src', src);
        armFrameWatchdog();
    }
}

function exposeEmbedBridge() {
    if (typeof window === 'undefined') return;
    window.__ntMapTabEmbed = true;
    if (typeof window.__ntCloseInAppSheet !== 'function') {
        window.__ntCloseInAppSheet = () => {
            import('./ui.js').then((m) => m.switchTab?.('next-train')).catch(() => {});
        };
    }
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
            return { ok: false, message: 'GPS jumped — try again near the tracks.' };
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
    setVetProgress(0, 'Hold still or stay on the train — 30 seconds');
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

/**
 * Trains on the live board (and the open planner trip) inside the 30-minute
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
            plausible: distanceKm == null || distanceKm <= CONTRIBUTE_MATCH_KM,
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

function driftLabel(driftMin) {
    if (driftMin === 0) return 'due now';
    if (driftMin > 0) return `${driftMin} min ago`;
    return `in ${Math.abs(driftMin)} min`;
}

async function showContributeSheet() {
    const sheet = document.getElementById('map-contribute-sheet');
    const list = document.getElementById('map-contribute-list');
    const empty = document.getElementById('map-contribute-empty');
    if (!sheet || !list) return;

    sheet.classList.remove('hidden');
    empty?.classList.add('hidden');
    list.innerHTML = '';

    const vet = await runContributeVet();
    if (!vet.ok) {
        empty?.classList.remove('hidden');
        if (empty) empty.textContent = vet.message || 'Couldn’t verify your location.';
        return;
    }

    const candidates = listContributeCandidates({ lat: vet.lat, lng: vet.lng });
    list.innerHTML = '';
    if (!candidates.length) {
        empty?.classList.remove('hidden');
        setStatus('No trains within 30 minutes on this board');
        return;
    }
    empty?.classList.add('hidden');

    candidates.forEach((c, i) => {
        const li = document.createElement('li');
        const dep = formatTimeDisplay(c.scheduledTime) || c.scheduledTime.slice(0, 5);
        const label = c.trainId === 'trip'
            ? `Trip · ${escapeHTML(c.station)} → ${escapeHTML(c.destination)}`
            : `Train ${escapeHTML(c.trainId)}${c.destination ? ` → ${escapeHTML(c.destination)}` : ''}`;

        const near = c.distanceKm == null
            ? 'position unknown'
            : `${c.distanceKm.toFixed(1)} km from ${escapeHTML(c.station)}`;
        const meta = `${escapeHTML(dep)} · ${driftLabel(c.driftMin)} · ${near}`;

        const tone = c.plausible
            ? 'border-amber-200 dark:border-amber-800/60 hover:border-blue-400'
            : 'border-gray-200 dark:border-gray-700 opacity-60';
        const note = c.plausible
            ? `${c.source === 'planner' ? 'From your trip plan' : 'From live board'} · shares for 10 min`
            : 'Too far from this train to link';

        li.innerHTML = `<button type="button" data-contribute-idx="${i}" ${c.plausible ? '' : 'disabled'} class="w-full text-left px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border ${tone} text-[11px] font-bold text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed">${label}<span class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mt-0.5">${meta}</span><span class="block text-[10px] text-gray-400 dark:text-gray-500">${note}</span></button>`;
        list.appendChild(li);
    });

    list.querySelectorAll('[data-contribute-idx]:not([disabled])').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-contribute-idx'));
            const chosen = candidates[idx];
            if (chosen) contributeForTrain(chosen);
        });
    });

    const matches = candidates.filter((c) => c.plausible).length;
    setStatus(matches ? 'Pick the train you’re on' : 'No train matches your position');
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

/**
 * Volunteer coarse location for a specific train (10‑minute ride ping).
 */
export async function contributeForTrain(candidate) {
    triggerHaptic();
    if (!candidate?.routeId) {
        showToast('Pick a corridor first', 'error');
        return { ok: false };
    }
    setStatus('Checking you’re on the railway…');

    const vet = await runContributeVet();
    if (!vet.ok) return vet;
    const coords = { lat: vet.lat, lng: vet.lng };
    hideContributeSheet();

    try {
        const { submitRideCheckIn, isRideCheckInEnabled, RIDE_PING_TTL_MS } = await import('./ride-pings.js');
        const { fetchFeatures } = await import('./features.js');
        await fetchFeatures();
        if (!isRideCheckInEnabled(candidate.routeId)) {
            showToast('Ride contribution isn’t on for this corridor yet', 'error');
            setStatus('Contribution not available on this corridor');
            return { ok: false };
        }

        const result = await submitRideCheckIn({
            routeId: candidate.routeId,
            station: candidate.station,
            trainId: candidate.trainId === 'trip' ? null : candidate.trainId,
            destination: candidate.destination || null,
            coarseLat: coords.lat,
            coarseLng: coords.lng,
            heading: vet.heading,
            speedMps: vet.speedMps,
            source: candidate.source === 'planner' ? 'planner_contribute' : 'map_contribute',
        });

        if (!result.ok) {
            showToast(result.message || 'Could not contribute', 'error');
            setStatus(result.message || 'Contribution failed');
            return result;
        }

        const mins = Math.round((RIDE_PING_TTL_MS || 600000) / 60000);
        setStatus(`Contributing · train ${candidate.trainId} · ${mins} min`);
        showToast(`Sharing your ride for ${mins} minutes`, 'success');

        postToMap({
            type: 'nt-map-contribute',
            lat: coords.lat,
            lng: coords.lng,
            trainId: candidate.trainId,
            station: candidate.station,
            expiresInMs: RIDE_PING_TTL_MS,
        });

        // Refresh corridor pings onto the map
        syncRidePingsToMap(candidate.routeId);
        return { ok: true };
    } catch (e) {
        showToast(e?.message || 'Could not contribute', 'error');
        return { ok: false, message: e?.message };
    }
}

/** Push every rider who opted in on this corridor onto the embedded map. */
export async function syncRidePingsToMap(routeId = $currentRouteId.get()) {
    if (!routeId) return;
    try {
        const { fetchRouteRidePings } = await import('./ride-pings.js');
        const mine = getDeviceId();
        const pings = await fetchRouteRidePings(routeId);
        const markers = (pings || [])
            .filter((p) => typeof p.coarseLat === 'number' && typeof p.coarseLng === 'number')
            .map((p) => ({
                lat: p.coarseLat,
                lng: p.coarseLng,
                trainId: p.trainId || null,
                station: p.station || '',
                at: p.at,
                expiresAt: p.expiresAt,
                heading: p.heading,
                speedMps: p.speedMps,
                mine: p.deviceId === mine,
                deviceId: p.deviceId,
                routeId: p.routeId || routeId,
            }));
        postToMap({ type: 'nt-map-ride-pings', pings: markers });

        const others = markers.filter((m) => !m.mine).length;
        if (others > 0) {
            setStatus(`${others} rider${others === 1 ? '' : 's'} sharing on this corridor`);
        }
    } catch { /* optional */ }
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
    pingsTimer = setInterval(() => {
        if (document.getElementById('view-map')?.classList.contains('active')) {
            syncRidePingsToMap();
        }
    }, PINGS_REFRESH_MS);
}

function stopPingsPolling() {
    if (pingsTimer) clearInterval(pingsTimer);
    pingsTimer = 0;
}

export function openContributePicker() {
    triggerHaptic();
    showContributeSheet();
}

/**
 * Soft offer when user is viewing a planner trip that looks “now”.
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
    if (!candidates.length) {
        banner?.remove();
        return;
    }

    if (!banner) {
        banner = document.createElement('div');
        banner.id = bannerId;
        banner.className = 'mx-4 mb-3 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50';
        results.insertBefore(banner, results.firstChild);
    }

    const c = candidates[0];
    banner.innerHTML = `
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-black text-gray-900 dark:text-white">On this trip?</p>
          <p class="text-[10px] text-gray-600 dark:text-gray-400 leading-snug">Contribute your location for 10 minutes so others can track train ${escapeHTML(c.trainId)}.</p>
        </div>
        <button type="button" id="planner-contribute-go" class="shrink-0 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-[10px] font-bold">Contribute</button>
        <button type="button" id="planner-contribute-dismiss" class="shrink-0 p-1 text-gray-400" aria-label="Dismiss">✕</button>
      </div>`;
    document.getElementById('planner-contribute-go')?.addEventListener('click', () => {
        import('./ui.js').then((m) => m.switchTab?.('map')).catch(() => {});
        setTimeout(() => contributeForTrain(c), 200);
    });
    document.getElementById('planner-contribute-dismiss')?.addEventListener('click', () => banner.remove());
}

export function activateMapTab() {
    exposeEmbedBridge();
    ensureFrameSrc();
    setStatus(lastCoords
        ? `Located · ±${Math.round(lastCoords.accuracy || 0)} m`
        : 'You and other riders sharing right now');
    if (frameLoaded) {
        postToMap({ type: 'nt-map-locate' });
        syncRidePingsToMap();
    }
    startPingsPolling();
}

export function deactivateMapTab() {
    hideContributeSheet();
    stopPingsPolling();
}

export function bindMapTabUi() {
    if (typeof document === 'undefined' || window.__ntMapTabBound) return;
    window.__ntMapTabBound = true;
    exposeEmbedBridge();

    document.getElementById('map-tab-locate-btn')?.addEventListener('click', () => {
        locateOnMapTab();
    });
    document.getElementById('map-tab-contribute-btn')?.addEventListener('click', () => {
        openContributePicker();
    });
    // Back-compat if old Share button id remains in cache
    document.getElementById('map-tab-share-btn')?.addEventListener('click', () => {
        openContributePicker();
    });
    document.getElementById('map-contribute-cancel')?.addEventListener('click', hideContributeSheet);

    document.getElementById('map-tab-retry')?.addEventListener('click', () => {
        ensureFrameSrc(true);
    });

    const frame = frameEl();
    frame?.addEventListener('load', () => {
        frameLoaded = true;
        if (frameWatchdog) clearTimeout(frameWatchdog);
        document.getElementById('map-tab-placeholder')?.classList.add('hidden');
        document.getElementById('map-tab-fallback')?.classList.add('hidden');
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
            });
        }
    });
}

if (typeof window !== 'undefined') {
    window.activateMapTab = activateMapTab;
    window.openContributePicker = openContributePicker;
    window.contributeForTrain = contributeForTrain;
    window.maybeOfferPlannerContribute = maybeOfferPlannerContribute;
    window.bindMapTabUi = bindMapTabUi;
    // Legacy name used by map-app share FAB — route to contribute picker
    window.shareMyLocation = openContributePicker;
}
