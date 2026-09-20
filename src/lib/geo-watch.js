/**
 * One geolocation watch for the map tab and an active share.
 *
 * Map-only seek uses fused / network location. An active share upgrades to
 * high-accuracy GPS and keeps the watch running while the document is hidden
 * so the tracking card stays live. Locate can still request a short
 * high-accuracy fix. Map-only hidden / locked documents drop the watch and
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
let lastWatchCallbackAt = 0;
let shareWatchdogTimer = 0;
let wakeLockSentinel = null;
let wantShareWakeLock = false;

const SEEK_OPTS = { enableHighAccuracy: false, maximumAge: 2500, timeout: 15000 };
const SHARE_OPTS = { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 };
const LOCATE_OPTS = { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 };
const STATIONARY_SPEED_MPS = 1.5;
const MAX_PLAUSIBLE_SPEED_MPS = 70;
/** Restart a silent share watch so Android cannot freeze fused GPS for minutes. */
const SHARE_SILENT_RESTART_MS = 8 * 1000;

/** Map pin / last fused sample is still good enough to attach or list nearby trains. */
export const GEO_REUSE_MAX_AGE_MS = 30 * 1000;

function distanceM(a, b) {
    if (!a || !b) return 0;
    const rad = Math.PI / 180;
    const p1 = a.lat * rad;
    const p2 = b.lat * rad;
    const dp = (b.lat - a.lat) * rad;
    const dl = (b.lng - a.lng) * rad;
    const h = Math.sin(dp / 2) ** 2
        + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingDeg(a, b) {
    const rad = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad)
        - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
}

/**
 * Accuracy-aware motion sample. Displacement inside the combined GPS circle is
 * stationary even when the OS reports ~5 km/h jitter. Real walking at 5 km/h
 * still reports once the fix leaves that circle. Cruise-speed first samples
 * (~14 km/h+) are trusted before a second point exists.
 */
export function refineMotionFix(raw, previous = null) {
    if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;
    if (Number.isFinite(raw.accuracy) && raw.accuracy > 250) return null;
    if (!previous || !Number.isFinite(previous.t)) {
        const reported = Number.isFinite(raw.speedMps) ? raw.speedMps : 0;
        const cruise = reported >= 4;
        return {
            ...raw,
            speedMps: cruise ? reported : 0,
            stationary: !cruise,
        };
    }
    if (raw.t <= previous.t) return null;
    const dt = Math.max(0.25, (raw.t - previous.t) / 1000);
    const movedM = distanceM(previous, raw);
    const derivedSpeed = movedM / dt;
    if (derivedSpeed > MAX_PLAUSIBLE_SPEED_MPS) return null;

    const accuracy = Number.isFinite(raw.accuracy) ? raw.accuracy : 25;
    const previousAccuracy = Number.isFinite(previous.accuracy) ? previous.accuracy : accuracy;
    const uncertaintyM = Math.max(
        6,
        Math.min(200, Math.hypot(accuracy, previousAccuracy) * 0.75)
    );
    const reportedSpeed = Number.isFinite(raw.speedMps) ? raw.speedMps : null;
    // Sitting still: the pin has not left the accuracy blob. Ignore OS speed.
    const stationary = movedM <= uncertaintyM;
    if (stationary) {
        return {
            ...raw,
            speedMps: 0,
            heading: Number.isFinite(previous.heading) ? previous.heading : raw.heading,
            movedM,
            stationary: true,
        };
    }

    const measuredSpeed = reportedSpeed != null && reportedSpeed >= STATIONARY_SPEED_MPS
        ? reportedSpeed
        : derivedSpeed;
    const previousSpeed = previous.stationary
        ? measuredSpeed
        : (Number.isFinite(previous.speedMps) ? previous.speedMps : measuredSpeed);
    return {
        ...raw,
        speedMps: Math.max(0, previousSpeed * 0.35 + measuredSpeed * 0.65),
        heading: movedM > uncertaintyM
            ? bearingDeg(previous, raw)
            : (Number.isFinite(raw.heading) ? raw.heading : previous.heading),
        movedM,
        stationary: false,
    };
}

/**
 * Card / ping display: prefer the refined stationary flag. Do not floor real
 * 5 km/h walking; only hide a sample already marked stationary.
 */
export function trustedDisplaySpeedMps({ speedMps, stationary } = {}) {
    if (stationary) return 0;
    const speed = Number(speedMps);
    if (!Number.isFinite(speed) || speed < 0) return NaN;
    return speed;
}

/**
 * Android fused/GPS often re-delivers the same coords with the same timestamp
 * while stationary. That is still a successful GPS callback; bump `t` so the
 * tracking card stays live without jumping the pin.
 */
export function confirmStationaryWatchTick(raw, previous, now = Date.now()) {
    if (!raw || !previous) return null;
    if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;
    if (!Number.isFinite(previous.lat) || !Number.isFinite(previous.lng)) return null;
    if (!(Number(raw.t) <= Number(previous.t))) return null;
    const moved = distanceM(previous, raw);
    const band = Math.max(6, Number(raw.accuracy) || Number(previous.accuracy) || 25);
    if (moved > band * 1.5) return null;
    return {
        ...previous,
        ...raw,
        t: now,
        speedMps: 0,
        heading: Number.isFinite(previous.heading) ? previous.heading : raw.heading,
        stationary: true,
    };
}

function fromCoords(coords, timestamp = Date.now()) {
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
        t: Number.isFinite(timestamp) ? timestamp : Date.now(),
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

function desiredWatchKind() {
    if (holders.has('share')) return 'share';
    if (holders.size === 0) return 'off';
    if (typeof document !== 'undefined' && document.hidden) return 'off';
    return 'map';
}

function ingestWatchPosition(pos) {
    lastWatchCallbackAt = Date.now();
    if (!pos?.coords) return;
    const raw = fromCoords(pos.coords, pos.timestamp);
    const fix = refineMotionFix(raw, lastFix) || confirmStationaryWatchTick(raw, lastFix);
    if (fix) emit(fix);
}

function startWatch(kind) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    if (kind !== 'map' && kind !== 'share') return;
    if (watchId != null && mode === kind) return;
    clearWatch();
    watchId = navigator.geolocation.watchPosition(
        ingestWatchPosition,
        () => { lastWatchCallbackAt = lastWatchCallbackAt || Date.now(); },
        kind === 'share' ? SHARE_OPTS : SEEK_OPTS
    );
    mode = kind;
    if (lastFix) emit(lastFix);
}

function syncShareWatchdog(on) {
    if (!on) {
        if (shareWatchdogTimer) {
            clearInterval(shareWatchdogTimer);
            shareWatchdogTimer = 0;
        }
        return;
    }
    if (shareWatchdogTimer) return;
    shareWatchdogTimer = setInterval(() => {
        if (desiredWatchKind() !== 'share') return;
        const last = lastWatchCallbackAt || lastFix?.t || 0;
        if (last && Date.now() - last < SHARE_SILENT_RESTART_MS) return;
        lastWatchCallbackAt = Date.now();
        clearWatch();
        startWatch('share');
    }, 4000);
}

async function syncShareWakeLock(on) {
    wantShareWakeLock = on;
    if (!on) {
        try { await wakeLockSentinel?.release(); } catch { /* ignore */ }
        wakeLockSentinel = null;
        return;
    }
    if (typeof navigator === 'undefined' || !navigator.wakeLock) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
        if (wakeLockSentinel) return;
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
            wakeLockSentinel = null;
        });
    } catch { /* unsupported or denied */ }
}

function applyWatch() {
    const kind = desiredWatchKind();
    syncShareWakeLock(kind === 'share');
    syncShareWatchdog(kind === 'share');
    if (kind === 'off') {
        clearWatch();
        return;
    }
    startWatch(kind);
}

function bindLifecycle() {
    if (boundLifecycle || typeof document === 'undefined') return;
    boundLifecycle = true;
    document.addEventListener('visibilitychange', () => {
        applyWatch();
    });
    window.addEventListener('pagehide', () => {
        clearWatch();
        syncShareWatchdog(false);
        syncShareWakeLock(false);
    });
    window.addEventListener('pageshow', () => {
        applyWatch();
    });
}

export function peekLastGeoFix() {
    return lastFix;
}

/**
 * Keep the map pin / last fused sample when a second GPS request times out
 * or refineMotionFix drops a jump. Android often fails getCurrentPosition
 * while watchPosition is already painting a usable fix.
 */
export function reusableGeoFix(fix, now = Date.now(), maxAgeMs = GEO_REUSE_MAX_AGE_MS) {
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;
    if (!Number.isFinite(fix.t) || now - fix.t > maxAgeMs) return null;
    return fix;
}

export function locateFixOrLast(refined, last = lastFix, now = Date.now(), maxAgeMs = GEO_REUSE_MAX_AGE_MS) {
    if (refined && Number.isFinite(refined.lat) && Number.isFinite(refined.lng)) return refined;
    return reusableGeoFix(last, now, maxAgeMs);
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
        const reuse = () => reusableGeoFix(lastFix);
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            const kept = reuse();
            if (kept) {
                resolve(kept);
                return;
            }
            reject(Object.assign(new Error('Location isn’t available on this device.'), { code: 2 }));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const fix = refineMotionFix(fromCoords(pos.coords, pos.timestamp), lastFix);
                const chosen = locateFixOrLast(fix, lastFix);
                if (!chosen) {
                    reject(Object.assign(new Error('Location jumped too far to trust.'), { code: 2 }));
                    return;
                }
                if (chosen === fix) emit(fix);
                resolve(chosen);
            },
            (err) => {
                const kept = reuse();
                if (kept) {
                    resolve(kept);
                    return;
                }
                reject(err);
            },
            LOCATE_OPTS
        );
    });
}

export function waitForGeoFix({ maxAgeMs = GEO_REUSE_MAX_AGE_MS, timeoutMs = 12000 } = {}) {
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
