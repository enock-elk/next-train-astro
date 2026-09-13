/**
 * One battery-safe geolocation watch for the map tab and an active share.
 *
 * Seek uses fused / network location (not GPS-only). Locate can request a
 * short high-accuracy fix. Hidden / locked documents drop the watch and
 * keep the last fix. Holders ('map' | 'share') decide when to seek.
 */
const holders = new Set();
const listeners = new Set();

/** @type {{ lat: number, lng: number, accuracy: number|null, heading: number|null, speedMps: number|null, t: number } | null} */
let lastFix = null;
/** @type {number | null} */
let watchId = null;
let boundLifecycle = false;
let mode = 'off';

const SEEK_OPTS = { enableHighAccuracy: false, maximumAge: 2500, timeout: 15000 };
const LOCATE_OPTS = { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 };

function fromCoords(coords) {
    return {
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
        heading: typeof coords.heading === 'number' && Number.isFinite(coords.heading)
            ? coords.heading
            : null,
        speedMps: typeof coords.speed === 'number' && coords.speed >= 0
            ? coords.speed
            : null,
        t: Date.now(),
    };
}

function emit(fix) {
    lastFix = fix;
    listeners.forEach((fn) => {
        try { fn(fix); } catch { /* listener */ }
    });
}

function clearWatch() {
    if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
    mode = 'off';
}

function startSeekWatch() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    if (watchId != null && mode === 'seek') return;
    clearWatch();
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            if (pos?.coords) emit(fromCoords(pos.coords));
        },
        () => { /* keep last fix; next tick may recover */ },
        SEEK_OPTS
    );
    mode = 'seek';
    if (lastFix) emit(lastFix);
}

function applyWatch() {
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (hidden || holders.size === 0) {
        clearWatch();
        return;
    }
    startSeekWatch();
}

function bindLifecycle() {
    if (boundLifecycle || typeof document === 'undefined') return;
    boundLifecycle = true;
    document.addEventListener('visibilitychange', () => {
        applyWatch();
    });
    window.addEventListener('pagehide', () => {
        clearWatch();
    });
    window.addEventListener('pageshow', () => {
        applyWatch();
    });
}

export function peekLastGeoFix() {
    return lastFix;
}

export function subscribeGeoFix(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function acquireGeoWatch(holder) {
    if (!holder) return;
    bindLifecycle();
    holders.add(String(holder));
    applyWatch();
}

export function releaseGeoWatch(holder) {
    holders.delete(String(holder));
    applyWatch();
}

export function geoWatchHolders() {
    return [...holders];
}

/** Recenter-quality fix. Reuses a recent watch sample when the OS still has one. */
export function requestGeoLocateFix() {
    return new Promise((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            reject(Object.assign(new Error('Location isn’t available on this device.'), { code: 2 }));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const fix = fromCoords(pos.coords);
                emit(fix);
                resolve(fix);
            },
            reject,
            LOCATE_OPTS
        );
    });
}

export function waitForGeoFix({ maxAgeMs = 8000, timeoutMs = 12000 } = {}) {
    if (lastFix && Date.now() - lastFix.t <= maxAgeMs) {
        return Promise.resolve(lastFix);
    }
    bindLifecycle();
    if (holders.size === 0) acquireGeoWatch('wait');
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsub();
            releaseGeoWatch('wait');
            fn(value);
        };
        const timer = setTimeout(() => {
            if (lastFix) finish(resolve, lastFix);
            else finish(reject, Object.assign(new Error('Couldn’t get a GPS fix.'), { code: 3 }));
        }, timeoutMs);
        const unsub = subscribeGeoFix((fix) => {
            if (fix && Date.now() - fix.t <= maxAgeMs) finish(resolve, fix);
        });
    });
}
