/**
 * Silent nearest-station locate on the live board and Trip Planner From field.
 * Only runs when the OS already granted geolocation — never prompts.
 * Coordinates stay on-device (findNearestStation).
 * Never overwrites a From station the commuter is picking or has already set.
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

export function tripPlannerTabIsActive(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return false;
    return !!doc.getElementById('view-trip-planner')?.classList.contains('active');
}

function elHasClass(el, className) {
    if (!el) return false;
    const list = el.classList;
    if (list?.contains) return list.contains(className);
    return String(el.className || '').split(/\s+/).includes(className);
}

function fieldHasStation(el) {
    if (!el) return false;
    if (String(el.value || '').trim()) return true;
    if (String(el.dataset?.resolvedValue || '').trim()) return true;
    return false;
}

/** Dropdown open, From field focused, or the commuter is typing a From station. */
export function stationPickerIsEngaged(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return false;
    const ntList = doc.getElementById('next-train-autocomplete-list');
    if (ntList && !elHasClass(ntList, 'hidden')) return true;
    const fromList = doc.getElementById('planner-from-autocomplete-list');
    if (fromList && !elHasClass(fromList, 'hidden')) return true;

    const active = doc.activeElement;
    if (!active) return false;
    const id = String(active.id || '');
    if (
        id === 'station-search-input'
        || id === 'station-select'
        || id === 'station-field-wrap'
        || id === 'planner-from-search'
        || id === 'planner-from'
    ) return true;
    if (typeof active.closest === 'function') {
        if (active.closest('#station-field-wrap, #planner-from-field-wrap, #next-train-autocomplete-list, #planner-from-autocomplete-list')) {
            return true;
        }
    }
    if (ntList && typeof ntList.contains === 'function' && ntList.contains(active)) return true;
    if (fromList && typeof fromList.contains === 'function' && fromList.contains(active)) return true;
    return false;
}

/** Next Train station or Trip Planner From already has a value (including leftover typed text). */
export function fromStationIsClaimed(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return false;
    if (fieldHasStation(doc.getElementById('station-select'))) return true;
    if (fieldHasStation(doc.getElementById('station-search-input'))) return true;
    if (fieldHasStation(doc.getElementById('planner-from'))) return true;
    if (fieldHasStation(doc.getElementById('planner-from-search'))) return true;
    return false;
}

/** Re-check right before applying GPS so an in-flight locate cannot steal the picker. */
export function shouldApplySilentLocate(doc = typeof document !== 'undefined' ? document : null) {
    return !stationPickerIsEngaged(doc) && !fromStationIsClaimed(doc);
}

/** Pure gate used by tests. Does not read Permissions API. */
export function boardIsReadyForAutoLocate({
    welcomeActive = false,
    routeId = '',
    nextTrainActive = false,
    plannerActive = false,
    visible = true,
    pickerEngaged = false,
    fromAlreadySet = false,
} = {}) {
    if (welcomeActive) return false;
    if (!String(routeId || '').trim()) return false;
    if (!nextTrainActive && !plannerActive) return false;
    if (visible === false) return false;
    if (pickerEngaged) return false;
    if (fromAlreadySet) return false;
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

    const doc = opts.doc ?? (typeof document !== 'undefined' ? document : null);
    const ready = boardIsReadyForAutoLocate({
        welcomeActive: opts.welcomeActive ?? welcomeIsActive(doc),
        routeId: opts.routeId ?? $currentRouteId.get(),
        nextTrainActive: opts.nextTrainActive ?? nextTrainTabIsActive(doc),
        plannerActive: opts.plannerActive ?? tripPlannerTabIsActive(doc),
        visible: opts.visible ?? (typeof document === 'undefined' ? true : document.visibilityState === 'visible'),
        pickerEngaged: opts.pickerEngaged ?? stationPickerIsEngaged(doc),
        fromAlreadySet: opts.fromAlreadySet ?? fromStationIsClaimed(doc),
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
        const tab = e?.detail?.tab;
        if (tab === 'next-train' || tab === 'trip-planner') kick();
    });
}
