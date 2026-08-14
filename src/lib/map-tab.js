/**
 * Map tab — embed Leaflet /map + trip-tied location contribution.
 *
 * Presence = coarse GPS for ~10 minutes so others can see you (train optional).
 * Attaching a train still uses the 30s vet + closest-train confirm.
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
import { trainGoingLabel, trainGoingFullLabel } from './train-ghosts.js';

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
        scoreTrainForFix,
        expectedPosition,
        ghostHeadingDeg,
        headingAgrees,
        TRAIN_TRACKER_MAX_M,
        NO_COORDS_MESSAGE,
    } = await import('./train-ghosts.js');
    const routeId = $currentRouteId.get();
    if (!routeHasStationCoords(routeId)) {
        showCheckToast(NO_COORDS_MESSAGE);
        showToast(NO_COORDS_MESSAGE, 'info', 5000);
        return { ok: false, noCoords: true, message: NO_COORDS_MESSAGE };
    }

    showCheckToast('Checking your location…');
    let samples;
    try {
        samples = await sampleGpsFor(ONBOARD_SAMPLE_MS, (list) => {
            const last = list[list.length - 1];
            if (!last || !trainId) return;
            const metres = scoreTrainForFix(last.lat, last.lng, trainId);
            if (Number.isFinite(metres) && metres < 1e7) {
                showCheckToast(`You’re ${formatDistanceM(metres)} from Train ${trainId}`);
            }
        });
    } catch (e) {
        const msg = e?.code === 1
            ? 'Location permission denied'
            : (e?.message || 'Couldn’t get location');
        showCheckToast(msg);
        return { ok: false, message: msg };
    }

    if (!samples?.length) {
        const msg = 'Couldn’t get a GPS fix. Try again outdoors.';
        showCheckToast(msg);
        return { ok: false, message: msg };
    }

    const first = samples[0];
    const last = samples[samples.length - 1];
    const metres = scoreTrainForFix(last.lat, last.lng, trainId);
    if (Number.isFinite(metres)) {
        showCheckToast(`You’re ${formatDistanceM(metres)} from Train ${trainId}`);
        await pause(450);
    }

    showCheckToast('Checking velocity…');
    await pause(350);
    const displacement = haversineM(first, last);
    const dt = Math.max(1, (last.t - first.t) / 1000);
    const speedMps = typeof last.speed === 'number' && last.speed >= 0
        ? last.speed
        : displacement / dt;
    const kmh = Math.max(0, Math.round(speedMps * 3.6));
    showCheckToast(`You’re moving at about ${kmh} km/h`);
    await pause(450);

    let heading = last.heading;
    if ((heading == null || Number.isNaN(heading)) && samples.length >= 2) {
        heading = (Math.atan2(last.lng - first.lng, last.lat - first.lat) * 180) / Math.PI;
    }
    const ghost = expectedPosition(trainId);
    const agrees = headingAgrees(heading, ghostHeadingDeg(ghost));
    showCheckToast(agrees
        ? `Heading matches Train ${trainId}`
        : `Heading doesn’t match Train ${trainId} yet`);
    await pause(450);
    const tooFar = !Number.isFinite(metres) || metres > TRAIN_TRACKER_MAX_M;
    const moving = speedMps >= 1.5 || displacement >= MOVE_MIN_M;
    lastCoords = { lat: last.lat, lng: last.lng, accuracy: last.accuracy };

    return {
        ok: true,
        lat: last.lat,
        lng: last.lng,
        heading: typeof heading === 'number' && !Number.isNaN(heading) ? heading : null,
        speedMps,
        isMoving: moving,
        metres,
        headingAgrees: agrees,
        attach: !tooFar && moving && agrees,
        tooFar,
    };
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
        if (!place && !status) return 'Real-time: —';
        const seen = place ? `last seen ${place}${when ? ` - ${when}` : ''}` : '';
        return `Real-time: ${[seen, status].filter(Boolean).join(' · ') || '—'}`;
    } catch {
        if (!place) return 'Real-time: —';
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

    const {
        scoreAllTrainsForFix, TRAIN_TRACKER_MAX_M, timetableWhereLabel,
        routeHasStationCoords, NO_COORDS_MESSAGE, trainGoingFullLabel: goingLabel,
    } = await import('./train-ghosts.js');
    if (!routeHasStationCoords($currentRouteId.get())) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        if (empty) empty.textContent = NO_COORDS_MESSAGE;
        showToast(NO_COORDS_MESSAGE, 'info', 5000);
        return;
    }

    let coords = (Number.isFinite(lat) && Number.isFinite(lng))
        ? { lat, lng }
        : lastCoords;
    if (!coords) {
        try {
            const pos = await getPosition();
            coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            lastCoords = coords;
        } catch (e) {
            list.innerHTML = '';
            empty?.classList.remove('hidden');
            if (empty) empty.textContent = e?.code === 1
                ? 'Location is off — allow it to see trains near you.'
                : (e?.message || 'Couldn’t get your location.');
            return;
        }
    }

    let delayMod = {};
    let pingMod = {};
    try {
        delayMod = await import('./delay-reports.js');
        await delayMod.fetchRecentRouteReports?.($currentRouteId.get());
    } catch { /* reports optional */ }
    try {
        pingMod = await import('./ride-pings.js');
    } catch { /* optional */ }

    const ranked = scoreAllTrainsForFix(coords.lat, coords.lng);
    const board = listContributeCandidates(coords);
    const byId = new Map(board.map((c) => [String(c.trainId), c]));
    const rows = ranked.map((r) => {
        const extra = byId.get(String(r.trainId)) || {};
        return {
            ...extra,
            trainId: r.trainId,
            metres: r.metres,
            ghost: r.ghost,
            plausible: r.metres <= TRAIN_TRACKER_MAX_M,
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
            plausible: !!c.plausible && (c.distanceKm == null || c.distanceKm * 1000 <= TRAIN_TRACKER_MAX_M),
        });
    });
    rows.sort((a, b) => (a.metres || Infinity) - (b.metres || Infinity));

    list.innerHTML = '';
    if (!rows.length) {
        empty?.classList.remove('hidden');
        return;
    }
    empty?.classList.add('hidden');

    rows.forEach((c) => {
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
                c.plausible
                    ? 'Close enough to track this train'
                    : 'Too far from this train’s path — you’ll show as a person, not a tracker'
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
        primary: `Yes — train ${best.trainId}`,
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
        scoreTrainForFix, expectedPosition, ghostHeadingDeg, headingAgrees, TRAIN_TRACKER_MAX_M,
    } = await import('./train-ghosts.js');
    const metres = scoreTrainForFix(lat, lng, rec.trainId);
    const ghost = expectedPosition(rec.trainId);
    const agrees = headingAgrees(heading, ghostHeadingDeg(ghost));
    const moving = speedMps >= 1.5 || displacement >= MOVE_MIN_M;
    writeParkedWatch({ ...rec, lat, lng, at: Date.now() });
    if (!moving || !agrees) return;
    if (Number.isFinite(metres) && metres > TRAIN_TRACKER_MAX_M) return;

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
    if (!vet.ok) {
        if (!vet.noCoords) hideCheckToast();
        return vet;
    }

    const { resolveTrainAttachment, scoreTrainForFix, TRAIN_TRACKER_MAX_M, expectedPosition, ghostHeadingDeg, headingAgrees } = await import('./train-ghosts.js');
    const decision = resolveTrainAttachment(vet.lat, vet.lng, id);
    let finalId = id;
    let confirmedCloser = false;
    if (decision.action === 'confirm' && decision.best?.trainId) {
        const pick = await promptOnTrainSheet({
            title: 'Different train?',
            body: `You’re more likely on ${trainGoingLabel(decision.best.trainId)} than ${trainGoingLabel(id, destination)}. Show you as ${trainGoingLabel(decision.best.trainId)}?`,
            primary: `Yes, ${trainGoingLabel(decision.best.trainId)}`,
            secondary: `Keep ${trainGoingLabel(id, destination)}`,
            tertiary: 'Cancel',
        });
        if (pick === 'tertiary') {
            hideCheckToast();
            return { ok: false, cancelled: true };
        }
        if (pick === 'primary') {
            finalId = decision.best.trainId;
            confirmedCloser = true;
        }
    }

    const metres = Number.isFinite(vet.metres) && finalId === id
        ? vet.metres
        : scoreTrainForFix(vet.lat, vet.lng, finalId);
    const tooFar = Number.isFinite(metres) && metres > TRAIN_TRACKER_MAX_M;
    const st = station || document.getElementById('station-select')?.value || '';
    let moving = !!(vet.isMoving || (typeof vet.speedMps === 'number' && vet.speedMps >= 1.5));
    let headingOk = vet.headingAgrees !== false;

    if (!tooFar && !moving) {
        hideCheckToast();
        const parked = await promptOnTrainSheet({
            title: 'Is the train moving?',
            body: 'GPS doesn’t show movement yet — trains often sit at a station. If you’re parked, we’ll thank you for sharing and watch in the background until the train starts moving the right way.',
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
                showToast('Still looks parked — thanks, we’ll attach you when it moves', 'info', 5000);
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
            showToast('Thanks for sharing — we’ll attach you when the train starts moving', 'success', 5000);
            return { ...result, asPerson: true, parked: true };
        }
    }

    const attach = !tooFar && moving && headingOk;

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
            ? `You’re about ${formatDistanceM(metres)} from Train ${finalId} — sharing as a commuter`
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
        source: confirmedCloser ? 'closer_confirm' : source,
    });
    if (shared?.ok) {
        showCheckToast(`Sharing Train ${finalId} with other riders`);
        setTimeout(() => hideCheckToast(), 4000);
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
    trainId, station, destination, routeId, lat, lng, heading, speedMps, source, waitingFor, quiet = false,
}) {
    try {
        const { submitRideCheckIn, isRideCheckInEnabled, RIDE_PING_TTL_MS } = await import('./ride-pings.js');
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
            source: source || 'board_on_train',
            waitingFor: waitingFor || null,
            quiet,
        });

        if (!result.ok) {
            showToast(result.message || 'Couldn’t share', 'error');
            setStatus(result.message || 'Couldn’t share');
            return result;
        }

        const mins = Math.round((RIDE_PING_TTL_MS || 600000) / 60000);
        setStatus(trainId
            ? `Sharing · train ${trainId} · ${mins} min`
            : `Sharing where you are · ${mins} min`);
        postToMap({
            type: 'nt-map-contribute',
            lat,
            lng,
            trainId,
            station,
            expiresInMs: RIDE_PING_TTL_MS,
        });
        syncRidePingsToMap(routeId);
        if (trainId) {
            const { startOnboardPingLoop } = await import('./ride-pings.js');
            startOnboardPingLoop();
        }
        return { ok: true, trainId };
    } catch (e) {
        showToast(e?.message || 'Couldn’t share', 'error');
        return { ok: false, message: e?.message };
    }
}

/**
 * Volunteer coarse location for a specific train (10‑minute ride ping).
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
    });
}

/** Push every rider who opted in on this corridor onto the embedded map. */
export async function syncRidePingsToMap(routeId = $currentRouteId.get()) {
    if (!routeId) return;
    try {
        const { fetchRouteRidePings, pingPublicTrainId } = await import('./ride-pings.js');
        const mine = getDeviceId();
        const pings = await fetchRouteRidePings(routeId);
        const markers = (pings || [])
            .filter((p) => typeof p.coarseLat === 'number' && typeof p.coarseLng === 'number')
            .map((p) => ({
                lat: p.coarseLat,
                lng: p.coarseLng,
                trainId: pingPublicTrainId(p),
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

    const { scoreTrainForFix, TRAIN_TRACKER_MAX_M } = await import('./train-ghosts.js');
    const ghostM = scoreTrainForFix(lat, lng, watch.trainId);
    if (Number.isFinite(ghostM) && ghostM <= TRAIN_TRACKER_MAX_M) {
        return;
    }

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
            result.ok ? 'Thanks — we’ll show this train as late' : (result.message || 'Couldn’t send the late report'),
            result.ok ? 'success' : 'error',
        );
        return;
    }
    if (pick === 'secondary') {
        await stopRideShare({ quiet: true });
        showToast('Thanks — we stopped tracking you', 'success');
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
    if (lastCoords && from) {
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
          <p class="text-[10px] text-gray-600 dark:text-gray-400 leading-snug">Share this trip to help other riders — and earn marks.</p>
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
        showToast('Quick sign-in to share this trip and earn marks.', 'info');
        openAccountModal();
        const ok = await waitForSignedIn();
        if (!ok) {
            showToast('Sign in when you’re ready — you can still use the trip plan.', 'info');
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
    const nearStation = from
        ? haversineM(lastCoords, { lat: from.lat, lng: from.lon ?? from.lng }) <= 400
        : false;

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
        : 'People sharing on this corridor');
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

    document.getElementById('map-tab-contribute-btn')?.addEventListener('click', () => {
        openContributePicker();
    });
    document.getElementById('map-tab-nearby-btn')?.addEventListener('click', () => {
        triggerHaptic();
        openNearbyTrainsModal();
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
    window.startOnTrainShare = startOnTrainShare;
    window.focusTrainOnMap = focusTrainOnMap;
    window.maybePromptLocateOnTrain = maybePromptLocateOnTrain;
    window.maybeOfferPlannerContribute = maybeOfferPlannerContribute;
    window.openNearbyTrainsModal = openNearbyTrainsModal;
    window.clearTripWatch = clearTripWatch;
    window.bindMapTabUi = bindMapTabUi;
    // Legacy name used by map-app share FAB — route to contribute picker
    window.shareMyLocation = openContributePicker;
    window.promptOnTrainSheet = promptOnTrainSheet;
    window.maybeOfferParkedResume = maybeOfferParkedResume;
    window.startParkedTrainWatch = startParkedTrainWatch;
}
