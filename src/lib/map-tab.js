/**
 * Map tab — embed /map.html + locate / share-my-location.
 *
 * Sharing uses the Web Share API (fallback: clipboard). Optionally snaps to a
 * station check-in (ride_pings) so the board “last seen” chip updates — no GPS trails.
 */
import { withBase } from './config.js';
import { showToast, triggerHaptic } from './ui.js';
import { $currentRouteId } from '../store.js';

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

function ensureFrameSrc() {
    const frame = frameEl();
    if (!frame) return;
    const src = frame.getAttribute('data-map-src') || withBase('/map.html') + '?embed=1';
    if (!frame.getAttribute('src')) {
        frame.setAttribute('src', src);
        document.getElementById('map-tab-placeholder')?.classList.add('hidden');
    }
}

/** Parent handshake so map.html hides its Back chrome in the tab iframe. */
function exposeEmbedBridge() {
    if (typeof window === 'undefined') return;
    window.__ntMapTabEmbed = true;
    // map.html also checks __ntCloseInAppSheet — provide a no-op close for tab mode
    if (typeof window.__ntCloseInAppSheet !== 'function') {
        window.__ntCloseInAppSheet = () => {
            import('./ui.js').then((m) => m.switchTab?.('next-train')).catch(() => {});
        };
    }
}

export function activateMapTab() {
    exposeEmbedBridge();
    ensureFrameSrc();
    setStatus(lastCoords
        ? `Located · ±${Math.round(lastCoords.accuracy || 0)} m`
        : 'Tap Locate or Share when you’re ready');
    // Nudge iframe locate after load
    const frame = frameEl();
    if (frameLoaded && frame?.contentWindow) {
        try {
            frame.contentWindow.postMessage({ type: 'nt-map-locate' }, '*');
        } catch { /* ignore */ }
    }
}

export function deactivateMapTab() {
    // Keep iframe warm (faster return); stop nothing continuous from parent.
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
        const frame = frameEl();
        frame?.contentWindow?.postMessage({
            type: 'nt-map-locate',
            lat: lastCoords.lat,
            lng: lastCoords.lng,
            accuracy: lastCoords.accuracy,
        }, '*');
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
 * Share a maps link (and optionally check in at nearest board station).
 */
export async function shareMyLocation() {
    triggerHaptic();
    setStatus('Preparing share…');

    let coords = lastCoords;
    if (!coords) {
        const located = await locateOnMapTab();
        if (!located.ok) return located;
        coords = located.coords;
    }

    const mapsUrl = `https://maps.google.com/?q=${coords.lat},${coords.lng}`;
    const text = `I'm on the Metrorail network — find me here:\n${mapsUrl}`;
    const shareData = {
        title: 'My location — Next Train',
        text,
        url: mapsUrl,
    };

    try {
        if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
            await navigator.share(shareData);
            setStatus('Location shared');
            showToast('Location shared', 'success');
        } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(mapsUrl);
            setStatus('Link copied');
            showToast('Location link copied', 'success');
        } else {
            showToast(mapsUrl, 'info');
        }
    } catch (e) {
        if (e?.name === 'AbortError') {
            setStatus('Share cancelled');
            return { ok: false, message: 'cancelled' };
        }
        try {
            await navigator.clipboard?.writeText?.(mapsUrl);
            showToast('Location link copied', 'success');
        } catch {
            showToast('Couldn’t share location', 'error');
            return { ok: false, message: e?.message || 'share failed' };
        }
    }

    // Soft corridor check-in (station-first) when a route + station are selected
    try {
        const station = document.getElementById('station-select')?.value || '';
        const routeId = $currentRouteId.get();
        if (routeId && station) {
            const { submitRideCheckIn, isRideCheckInEnabled } = await import('./ride-pings.js');
            const { fetchFeatures } = await import('./features.js');
            await fetchFeatures();
            if (isRideCheckInEnabled(routeId)) {
                await submitRideCheckIn({
                    routeId,
                    station,
                    coarseLat: coords.lat,
                    coarseLng: coords.lng,
                });
            }
        }
    } catch { /* optional */ }

    return { ok: true, coords };
}

export function bindMapTabUi() {
    if (typeof document === 'undefined' || window.__ntMapTabBound) return;
    window.__ntMapTabBound = true;
    exposeEmbedBridge();

    document.getElementById('map-tab-locate-btn')?.addEventListener('click', () => {
        locateOnMapTab();
    });
    document.getElementById('map-tab-share-btn')?.addEventListener('click', () => {
        shareMyLocation();
    });

    const frame = frameEl();
    frame?.addEventListener('load', () => {
        frameLoaded = true;
        document.getElementById('map-tab-placeholder')?.classList.add('hidden');
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
    window.shareMyLocation = shareMyLocation;
    window.bindMapTabUi = bindMapTabUi;
}
