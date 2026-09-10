/**
 * Corridor / environment feature flags (RTDB config/features.json).
 *
 * Shape:
 * {
 *   communityRealtime: { enabled: true, routeIds: ["pta-pien"] | ["*"] },
 *   delayReportsUi:    { enabled: true, routeIds: ["*"] },
 *   pushNotify:        { enabled: true, routeIds: ["pta-pien", "ct-bellv"] },
 *   mapTab:            { enabled: true, routeIds: ["pta-kempton"] },
 *   communityTab:      { enabled: true, routeIds: ["pta-kempton"] }
 * }
 *
 * Lab (`lab.nexttrain.co.za` or PUBLIC_LAB_MODE=true): missing/empty config →
 * realtime / delay / push / ride-checkin on (sharing still works for admins).
 * Map and Community tabs stay off until config/features lists pinned routes.
 * The green live-share chip uses `isRideCheckInPinned` (RTDB pins only, no
 * lab `*` default). Production: missing config → all off (safe merge).
 */
import { DYNAMIC_BASE_URL, PILOT_ROUTE_IDS } from './config.js';

export const FEATURE_KEYS = {
    COMMUNITY_REALTIME: 'communityRealtime',
    DELAY_REPORTS_UI: 'delayReportsUi',
    PUSH_NOTIFY: 'pushNotify',
    RIDE_CHECKIN: 'rideCheckIn',
    MAP_TAB: 'mapTab',
    COMMUNITY_TAB: 'communityTab',
};

export { PILOT_ROUTE_IDS };

export const GRANTABLE_FEATURES = [
    { key: FEATURE_KEYS.MAP_TAB, label: 'Map' },
    { key: FEATURE_KEYS.COMMUNITY_TAB, label: 'Community' },
    { key: FEATURE_KEYS.RIDE_CHECKIN, label: "I'm on it / live share" },
    { key: FEATURE_KEYS.DELAY_REPORTS_UI, label: 'Delay reports' },
    { key: FEATURE_KEYS.COMMUNITY_REALTIME, label: 'Community realtime' },
    { key: FEATURE_KEYS.PUSH_NOTIFY, label: 'Push notifications' },
];

const CACHE_TTL_MS = 60 * 1000;

/** @type {Record<string, { enabled?: boolean, routeIds?: string[] }> | null} */
let cachedFeatures = null;
/** @type {Record<string, boolean>} */
let grantedFeatures = {};
let loadedAt = 0;
/** @type {Promise<object|null> | null} */
let loadPromise = null;

const LAB_DEFAULTS = {
    communityRealtime: { enabled: true, routeIds: ['*'] },
    delayReportsUi: { enabled: true, routeIds: ['*'] },
    pushNotify: { enabled: true, routeIds: ['*'] },
    rideCheckIn: { enabled: true, routeIds: ['*'] },
    mapTab: { enabled: false, routeIds: [] },
    communityTab: { enabled: false, routeIds: [] },
};

/** Production defaults stay off until RTDB config/features is set (see docs/config-features-pilot.json). */
const PROD_DEFAULTS = {
    communityRealtime: { enabled: false, routeIds: [] },
    delayReportsUi: { enabled: false, routeIds: [] },
    pushNotify: { enabled: false, routeIds: [] },
    rideCheckIn: { enabled: false, routeIds: [] },
    mapTab: { enabled: false, routeIds: [] },
    communityTab: { enabled: false, routeIds: [] },
};

/** Suggested first production allow-list (paste into RTDB config/features). */
export const PILOT_FEATURES_SEED = {
    communityRealtime: { enabled: true, routeIds: [...PILOT_ROUTE_IDS] },
    delayReportsUi: { enabled: true, routeIds: [...PILOT_ROUTE_IDS] },
    pushNotify: { enabled: true, routeIds: [...PILOT_ROUTE_IDS] },
    rideCheckIn: { enabled: true, routeIds: [...PILOT_ROUTE_IDS] },
    mapTab: { enabled: false, routeIds: [] },
    communityTab: { enabled: false, routeIds: [] },
};

/**
 * Lab line detection — env at build time, or hostname at runtime.
 */
export function isLabEnvironment() {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.PUBLIC_LAB_MODE === 'true') {
            return true;
        }
    } catch { /* ignore */ }
    if (typeof location !== 'undefined') {
        const host = String(location.hostname || '').toLowerCase();
        if (host === 'lab.nexttrain.co.za' || host.startsWith('lab.')) return true;
    }
    return false;
}

/**
 * Skip GPS / path / speed checks. Off so lab actually vets shares.
 */
export function relaxLiveShareGuards() {
    return false;
}

function defaultsForEnv() {
    return isLabEnvironment() ? LAB_DEFAULTS : PROD_DEFAULTS;
}

export function getCachedFeatures() {
    return cachedFeatures;
}

export function getGrantedFeatures() {
    return { ...grantedFeatures };
}

export function isFeatureGranted(name) {
    return grantedFeatures[name] === true;
}

function currentDeviceId() {
    try {
        return String(localStorage.getItem('$deviceId') || localStorage.getItem('next_train_device_id') || '').trim();
    } catch {
        return '';
    }
}

async function fetchFeatureGrants() {
    const deviceId = currentDeviceId();
    if (!deviceId) {
        grantedFeatures = {};
        return;
    }
    try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const res = await fetch(`${DYNAMIC_BASE_URL}config/feature_grants/${encodeURIComponent(deviceId)}.json?t=${Date.now()}`, {
            cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        grantedFeatures = data && typeof data === 'object' && !data.error ? data : {};
    } catch {
        // Keep last known grants on transient failures
    }
}

/**
 * Normalize a feature entry; missing keys fall back to env defaults.
 * @param {string} name
 * @param {object|null} raw
 */
function normalizeEntry(name, raw) {
    const fallback = defaultsForEnv()[name] || { enabled: false, routeIds: [] };
    if (!raw || typeof raw !== 'object') return { ...fallback };
    const routeIds = Array.isArray(raw.routeIds)
        ? raw.routeIds.map((id) => String(id)).filter(Boolean)
        : (fallback.routeIds || []);
    const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : !!fallback.enabled;
    return { enabled, routeIds };
}

export async function fetchFeatures(force = false) {
    if (!force && cachedFeatures && (Date.now() - loadedAt) < CACHE_TTL_MS) {
        return cachedFeatures;
    }
    if (!force && loadPromise) return loadPromise;

    loadPromise = (async () => {
        const base = defaultsForEnv();
        let remote = null;
        try {
            if (typeof navigator === 'undefined' || navigator.onLine !== false) {
                const res = await fetch(`${DYNAMIC_BASE_URL}config/features.json?t=${Date.now()}`, {
                    cache: 'no-store',
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === 'object' && !data.error) remote = data;
                }
            }
        } catch {
            // Keep last known / defaults on transient failures
        }

        const merged = { ...base };
        if (remote) {
            for (const key of Object.keys(FEATURE_KEYS).map((k) => FEATURE_KEYS[k])) {
                if (remote[key] != null) merged[key] = normalizeEntry(key, remote[key]);
                else merged[key] = normalizeEntry(key, base[key]);
            }
            // Pass through any extra keys for future flags
            for (const [key, val] of Object.entries(remote)) {
                if (merged[key] == null) merged[key] = normalizeEntry(key, val);
            }
        }

        await fetchFeatureGrants();
        cachedFeatures = merged;
        loadedAt = Date.now();
        loadPromise = null;
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('nt-features-updated', { detail: merged }));
        }
        return cachedFeatures;
    })();

    return loadPromise;
}

/**
 * @param {string} name feature key
 * @param {string} [routeId]
 * @returns {boolean}
 */
export function isFeatureEnabled(name, routeId = '') {
    if (grantedFeatures[name] === true) return true;
    // Lab testers need ride sharing on every corridor, even if RTDB still
    // has the production allow-list. The green chip does not use this shortcut.
    if (name === FEATURE_KEYS.RIDE_CHECKIN && isLabEnvironment()) return true;
    const bag = cachedFeatures || defaultsForEnv();
    const entry = normalizeEntry(name, bag?.[name]);
    if (!entry.enabled) return false;
    const ids = entry.routeIds || [];
    if (!ids.length) return false;
    if (ids.includes('*')) return true;
    if (!routeId) return ids.length > 0; // enabled for some routes; caller may gate further
    return ids.includes(routeId);
}

/**
 * Commuter live-share chrome. No lab always-on, and lab default `*` is not a pin.
 * Explicit RTDB route ids (or production `*`) count.
 * @param {string} [routeId]
 */
export function isRideCheckInPinned(routeId = '') {
    if (grantedFeatures[FEATURE_KEYS.RIDE_CHECKIN] === true) return true;
    const bag = cachedFeatures || defaultsForEnv();
    const entry = normalizeEntry(FEATURE_KEYS.RIDE_CHECKIN, bag?.[FEATURE_KEYS.RIDE_CHECKIN]);
    if (!entry.enabled) return false;
    const ids = entry.routeIds || [];
    if (!ids.length) return false;
    if (ids.includes('*')) return !isLabEnvironment();
    if (!routeId) return true;
    return ids.includes(String(routeId));
}

/** Async variant — ensures config is loaded once. */
export async function isFeatureEnabledAsync(name, routeId = '') {
    await fetchFeatures();
    return isFeatureEnabled(name, routeId);
}

if (typeof window !== 'undefined') {
    window.fetchFeatures = fetchFeatures;
    window.isFeatureEnabled = isFeatureEnabled;
    window.isFeatureGranted = isFeatureGranted;
    window.getGrantedFeatures = getGrantedFeatures;
    window.isRideCheckInPinned = isRideCheckInPinned;
    window.isLabEnvironment = isLabEnvironment;
    window.relaxLiveShareGuards = relaxLiveShareGuards;
    window.GRANTABLE_FEATURES = GRANTABLE_FEATURES;
}
