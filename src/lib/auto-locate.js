/**
 * Silent nearest-station locate on the live board.
 * Only runs when the OS already granted geolocation — never prompts.
 * Coordinates stay on-device (findNearestStation).
 */
import { $currentRouteId } from '../store.js';

export const AUTO_LOCATE_DEBOUNCE_MS = 120_000;

let lastAutoLocateAt = 0;

export function resetAutoLocateDebounce() {
    lastAutoLocateAt = 0;
}

export function welcomeIsActive(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return false;
    const welcome = doc.getElementById('welcome-modal');
    return !!(welcome && !welcome.classList.contains('hidden'));
}

export function nextTrainTabIsActive(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return false;
    return !!doc.getElementById('view-next-train')?.classList.contains('active');
}

/** Pure gate used by tests. Does not read Permissions API. */
export function boardIsReadyForAutoLocate({
    welcomeActive = false,
    routeId = '',
    nextTrainActive = false,
    visible = true,
} = {}) {
    if (welcomeActive) return false;
    if (!String(routeId || '').trim()) return false;
    if (!nextTrainActive) return false;
    if (visible === false) return false;
    return true;
}

export async function geolocationAlreadyGranted() {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return false;
    try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        return status?.state === 'granted';
    } catch {
        return false;
    }
}

/**
 * @param {{ now?: number, locate?: function, routeId?: string, granted?: boolean }} [opts]
 * @returns {Promise<boolean>} true if findNearestStation(true) was called
 */
export async function maybeAutoLocateBoard(opts = {}) {
    const now = Number(opts.now) || Date.now();
    if (now - lastAutoLocateAt < AUTO_LOCATE_DEBOUNCE_MS) return false;

    const locate = opts.locate
        || (typeof window !== 'undefined' ? window.findNearestStation : null);
    if (typeof locate !== 'function') return false;

    const ready = boardIsReadyForAutoLocate({
        welcomeActive: opts.welcomeActive ?? welcomeIsActive(),
        routeId: opts.routeId ?? $currentRouteId.get(),
        nextTrainActive: opts.nextTrainActive ?? nextTrainTabIsActive(),
        visible: opts.visible ?? (typeof document === 'undefined' ? true : document.visibilityState === 'visible'),
    });
    if (!ready) return false;

    const granted = opts.granted != null ? !!opts.granted : await geolocationAlreadyGranted();
    if (!granted) return false;

    lastAutoLocateAt = now;
    locate(true);
    return true;
}

export function bindAutoLocateTriggers() {
    if (typeof window === 'undefined' || window.__ntAutoLocateBound) return;
    window.__ntAutoLocateBound = true;
    const kick = () => {
        maybeAutoLocateBoard().catch(() => {});
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') kick();
    });
    window.addEventListener('nt-tab-changed', (e) => {
        if (e?.detail?.tab === 'next-train') kick();
    });
}
