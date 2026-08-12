/**
 * Map tab — embed Leaflet /map + trip-tied location contribution.
 *
 * Contribute = volunteer coarse GPS tied to a train (moving / about to leave /
 * just arrived) for ~10 minutes so others can see where that ride was last seen.
 * Not a social “share my pin” link.
 */
import { withBase } from './config.js';
import { showToast, triggerHaptic } from './ui.js';
import { $currentRouteId } from '../store.js';
import { timeToSeconds, escapeHTML, formatTimeDisplay, isRealTime } from './utils.js';
import { currentTime } from './logic.js';
import { currentScheduleData } from './live-board.js';

/** ±10 minutes around scheduled station departure */
export const CONTRIBUTE_WINDOW_SEC = 10 * 60;

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

function ensureFrameSrc() {
    const frame = frameEl();
    if (!frame) return;
    // Prefer extensionless /map (CF Pages). Fallback keeps ?embed=1.
    let src = frame.getAttribute('data-map-src') || withBase('/map') + '?embed=1';
    // Never load /map.html in the iframe — CF Pages 308s it to /map, and old
    // _redirects 301 /map → /map.html caused ERR_TOO_MANY_REDIRECTS on lab.
    src = String(src).replace(/\/map\.html(\?|$)/, '/map$1');
    if (!frame.getAttribute('src')) {
        frame.setAttribute('src', src);
        document.getElementById('map-tab-placeholder')?.classList.add('hidden');
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

/**
 * Trains on the live board (and optional planner trip) within the contribute window.
 */
export function listContributeCandidates() {
    const routeId = $currentRouteId.get();
    const station = document.getElementById('station-select')?.value || '';
    const now = nowSeconds();
    /** @type {Array<{ trainId: string, scheduledTime: string, arrivalTime?: string, station: string, destination: string, routeId: string, source: string }>} */
    const out = [];
    const seen = new Set();

    const push = (c) => {
        if (!c?.trainId || !c.scheduledTime) return;
        if (!isRealTime(c.scheduledTime)) return;
        const dep = timeToSeconds(c.scheduledTime);
        if (dep == null || Number.isNaN(dep)) return;
        if (Math.abs(now - dep) > CONTRIBUTE_WINDOW_SEC) return;
        const key = `${c.routeId}|${c.trainId}|${c.scheduledTime}|${c.station}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(c);
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

function showContributeSheet() {
    const sheet = document.getElementById('map-contribute-sheet');
    const list = document.getElementById('map-contribute-list');
    const empty = document.getElementById('map-contribute-empty');
    if (!sheet || !list) return;

    const candidates = listContributeCandidates();
    list.innerHTML = '';
    if (!candidates.length) {
        empty?.classList.remove('hidden');
        sheet.classList.remove('hidden');
        setStatus('No trains in the 10‑minute window');
        return;
    }
    empty?.classList.add('hidden');

    candidates.forEach((c, i) => {
        const li = document.createElement('li');
        const dep = formatTimeDisplay(c.scheduledTime) || c.scheduledTime.slice(0, 5);
        const label = c.trainId === 'trip'
            ? `Trip · ${escapeHTML(c.station)} → ${escapeHTML(c.destination)} · ${escapeHTML(dep)}`
            : `Train ${escapeHTML(c.trainId)} · dep ${escapeHTML(dep)}${c.destination ? ` → ${escapeHTML(c.destination)}` : ''}`;
        li.innerHTML = `<button type="button" data-contribute-idx="${i}" class="w-full text-left px-3 py-2 rounded-xl bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800/60 text-[11px] font-bold text-gray-900 dark:text-white hover:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">${label}<span class="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mt-0.5">${c.source === 'planner' ? 'From your trip plan' : 'From live board'} · 10 min window</span></button>`;
        list.appendChild(li);
    });

    list.querySelectorAll('[data-contribute-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-contribute-idx'));
            const chosen = candidates[idx];
            if (chosen) contributeForTrain(chosen);
        });
    });

    sheet.classList.remove('hidden');
    setStatus('Pick a train to contribute');
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
    setStatus('Getting location for contribution…');
    hideContributeSheet();

    let coords = lastCoords;
    if (!coords) {
        const located = await locateOnMapTab();
        if (!located.ok) return located;
        coords = located.coords;
    }

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

export async function syncRidePingsToMap(routeId = $currentRouteId.get()) {
    if (!routeId) return;
    try {
        const { fetchRouteRidePings } = await import('./ride-pings.js');
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
            }));
        postToMap({ type: 'nt-map-ride-pings', pings: markers });
    } catch { /* optional */ }
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
        : 'Leaflet map · Contribute ties you to a train');
    if (frameLoaded) {
        postToMap({ type: 'nt-map-locate' });
        syncRidePingsToMap();
    }
}

export function deactivateMapTab() {
    hideContributeSheet();
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

    const frame = frameEl();
    frame?.addEventListener('load', () => {
        frameLoaded = true;
        document.getElementById('map-tab-placeholder')?.classList.add('hidden');
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
