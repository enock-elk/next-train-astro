/**
 * Silent nearest-station locate on the live board and Trip Planner From field.
 * Coordinates stay on-device (findNearestStation).
 *
 * Installed PWA / Play Store TWA eagerly request a fused fix on startup (the OS
 * sheet appears only if location was never allowed). Permissions API is often
 * missing or stuck on "prompt" after the OS already granted location. A Chrome
 * tab still requires query=granted (or nt_geo_granted) and will not overwrite a
 * station the commuter set, except the one-shot installed startup refresh.
 */
import { $currentRouteId } from '../store.js';

export const AUTO_LOCATE_DEBOUNCE_MS = 120_000;
export const AUTO_LOCATE_RETRY_MS = 4_000;
export const AUTO_LOCATE_MAX_FAILS = 3;
export const GEO_GRANTED_KEY = 'nt_geo_granted';

let lastAutoLocateAt = 0;
let lastAutoLocateFailAt = 0;
let autoLocateFailCount = 0;
let autoLocateRetryTimer = 0;
let startupOverwriteArmed = true;

export function resetAutoLocateDebounce() {
    lastAutoLocateAt = 0;
    lastAutoLocateFailAt = 0;
}

export function noteAutoLocateApplied() {
    lastAutoLocateAt = Date.now();
    lastAutoLocateFailAt = 0;
    autoLocateFailCount = 0;
    if (autoLocateRetryTimer) {
        clearTimeout(autoLocateRetryTimer);
        autoLocateRetryTimer = 0;
    }
}

export function noteAutoLocateFailed() {
    lastAutoLocateAt = 0;
    lastAutoLocateFailAt = Date.now();
    autoLocateFailCount += 1;
    if (autoLocateFailCount > AUTO_LOCATE_MAX_FAILS) return;
    if (typeof window === 'undefined') return;
    if (autoLocateRetryTimer) clearTimeout(autoLocateRetryTimer);
    autoLocateRetryTimer = window.setTimeout(() => {
        autoLocateRetryTimer = 0;
        maybeAutoLocateBoard().catch(() => {});
    }, AUTO_LOCATE_RETRY_MS);
}

export function resetStartupLocateOverwrite() {
    startupOverwriteArmed = true;
}

export function disarmStartupLocateOverwrite() {
    startupOverwriteArmed = false;
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
export function fromStationIsClaimed(doc = typeof document !== 'undefined' ? document : null, opts = {}) {
    if (!doc) return false;
    const nextTrain = opts.nextTrainActive ?? nextTrainTabIsActive(doc);
    const planner = opts.plannerActive ?? tripPlannerTabIsActive(doc);
    const checkNt = nextTrain || (!nextTrain && !planner);
    const checkPl = planner || (!nextTrain && !planner);
    if (checkNt) {
        if (fieldHasStation(doc.getElementById('station-select'))) return true;
        if (fieldHasStation(doc.getElementById('station-search-input'))) return true;
    }
    if (checkPl) {
        if (fieldHasStation(doc.getElementById('planner-from'))) return true;
        if (fieldHasStation(doc.getElementById('planner-from-search'))) return true;
    }
    return false;
}

export function hasRememberedGeoGrant(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
        return storage?.getItem?.(GEO_GRANTED_KEY) === '1';
    } catch {
        return false;
    }
}

export function rememberGeolocationGranted(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
        storage?.setItem?.(GEO_GRANTED_KEY, '1');
    } catch { /* ignore */ }
}

/**
 * Home-screen PWA, Play Store TWA, or a session that already stamped standalone.
 * @param {{ standalone?: boolean, twa?: boolean }} [signals]
 */
export function isInstalledAppClient(signals) {
    if (signals && (signals.standalone != null || signals.twa != null)) {
        return !!(signals.standalone || signals.twa);
    }
    if (typeof window === 'undefined') return false;
    try {
        if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
        if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
        if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
        if (window.navigator?.standalone) return true;
        if (String(document.referrer || '').indexOf('android-app://') === 0) return true;
        if (sessionStorage.getItem('nt_standalone') === '1') return true;
        if (sessionStorage.getItem('nt_twa') === '1' || localStorage.getItem('nt_twa') === '1') return true;
        if (document.documentElement?.classList?.contains('nt-standalone')) return true;
        if (window.__ntAppClient?.app_source === 'twa' || window.__ntAppClient?.app_source === 'pwa') return true;
    } catch { /* ignore */ }
    return false;
}

export async function geolocationPermissionState() {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        const state = String(status?.state || '');
        if (state === 'granted' || state === 'denied' || state === 'prompt') return state;
        return 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * True when startup/silent locate may call getCurrentPosition.
 * Installed clients try unless OS geolocation is denied. Browser tabs stay
 * granted-or-remembered so a regular tab does not open a permission sheet.
 * @param {{ state?: string, remembered?: boolean, installed?: boolean }} [opts]
 */
export async function geolocationAlreadyGranted(opts = {}) {
    const state = opts.state != null ? opts.state : await geolocationPermissionState();
    if (state === 'granted') return true;
    if (state === 'denied') return false;
    const remembered = opts.remembered != null ? !!opts.remembered : hasRememberedGeoGrant();
    if (remembered) return true;
    const installed = opts.installed != null ? !!opts.installed : isInstalledAppClient();
    // Installed PWA / Play TWA: Permissions API is often missing (unknown) or
    // stuck on prompt after the OS already granted location. Eagerly try.
    if (installed && state !== 'denied') return true;
    return false;
}

/** Re-check right before applying GPS so an in-flight locate cannot steal the picker. */
export function shouldApplySilentLocate(doc = typeof document !== 'undefined' ? document : null, opts = {}) {
    if (stationPickerIsEngaged(doc)) {
        disarmStartupLocateOverwrite();
        return false;
    }
    const nextTrainActive = opts.nextTrainActive ?? nextTrainTabIsActive(doc);
    const plannerActive = opts.plannerActive ?? tripPlannerTabIsActive(doc);
    if (!fromStationIsClaimed(doc, { nextTrainActive, plannerActive })) return true;
    const installed = opts.installed != null ? !!opts.installed : isInstalledAppClient();
    const overwrite = opts.startupOverwrite != null ? !!opts.startupOverwrite : (startupOverwriteArmed && installed);
    return overwrite;
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
    startupOverwrite = false,
} = {}) {
    if (welcomeActive) return false;
    if (!String(routeId || '').trim()) return false;
    if (!nextTrainActive && !plannerActive) return false;
    if (visible === false) return false;
    if (pickerEngaged) return false;
    if (fromAlreadySet && !startupOverwrite) return false;
    return true;
}

/**
 * @param {{ now?: number, locate?: function, routeId?: string, granted?: boolean }} [opts]
 * @returns {Promise<boolean>} true if findNearestStation(true) was called
 */
export async function maybeAutoLocateBoard(opts = {}) {
    const now = Number(opts.now) || Date.now();
    if (now - lastAutoLocateAt < AUTO_LOCATE_DEBOUNCE_MS) return false;
    if (lastAutoLocateFailAt && now - lastAutoLocateFailAt < AUTO_LOCATE_RETRY_MS) return false;

    const locate = opts.locate
        || (typeof window !== 'undefined' ? window.findNearestStation : null);
    if (typeof locate !== 'function') return false;

    const doc = opts.doc ?? (typeof document !== 'undefined' ? document : null);
    const installed = opts.installed != null ? !!opts.installed : isInstalledAppClient();
    const pickerEngaged = opts.pickerEngaged ?? stationPickerIsEngaged(doc);
    if (pickerEngaged) disarmStartupLocateOverwrite();
    const startupOverwrite = opts.startupOverwrite != null
        ? !!opts.startupOverwrite
        : (startupOverwriteArmed && installed && !pickerEngaged);
    const nextTrainActive = opts.nextTrainActive ?? nextTrainTabIsActive(doc);
    const plannerActive = opts.plannerActive ?? tripPlannerTabIsActive(doc);
    const ready = boardIsReadyForAutoLocate({
        welcomeActive: opts.welcomeActive ?? welcomeIsActive(doc),
        routeId: opts.routeId ?? $currentRouteId.get(),
        nextTrainActive,
        plannerActive,
        visible: opts.visible ?? (typeof document === 'undefined' ? true : document.visibilityState === 'visible'),
        pickerEngaged,
        fromAlreadySet: opts.fromAlreadySet ?? fromStationIsClaimed(doc, { nextTrainActive, plannerActive }),
        startupOverwrite,
    });
    if (!ready) return false;

    lastAutoLocateAt = now;
    const granted = opts.granted != null ? !!opts.granted : await geolocationAlreadyGranted({ installed });
    if (!granted) {
        lastAutoLocateAt = 0;
        return false;
    }

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
    window.addEventListener('pageshow', kick);
    window.addEventListener('nt-welcome-closed', kick);
    window.addEventListener('nt-tab-changed', (e) => {
        const tab = e?.detail?.tab;
        if (tab === 'next-train' || tab === 'trip-planner') kick();
    });
}
