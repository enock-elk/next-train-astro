/**
 * Session stability signals for third-party scripts (ads).
 * Queued reloads (error recovery, cache sync, killswitch) should defer
 * CleverAds briefly — never indefinitely.
 */

/** @param {string} reason @param {number} delayMs expected ms until navigation */
export function markPendingReload(reason = 'reload', delayMs = 1000) {
    if (typeof window === 'undefined') return;
    const until = Date.now() + Math.max(0, delayMs) + 400; // buffer past the hop
    window._pendingSessionReload = { reason, until, markedAt: Date.now() };
    console.log(`🛡️ Guardian: Pending session reload (${reason}) — ads deferred ~${delayMs}ms`);
}

export function clearPendingReload() {
    if (typeof window === 'undefined') return;
    window._pendingSessionReload = null;
}

export function isReloadPending() {
    if (typeof window === 'undefined') return false;
    const p = window._pendingSessionReload;
    if (!p) return false;
    if (Date.now() >= p.until) {
        // Reload never fired — release the lock so ads are not held forever
        window._pendingSessionReload = null;
        return false;
    }
    return true;
}

/** True when schedules are up and no short-term reload is queued. */
export function isStableForThirdParty() {
    if (typeof window === 'undefined') return false;
    if (window._suppressReloads) return false;
    if (isReloadPending()) return false;
    if (!window._appStabilized) return false;
    return true;
}

/** Force-update is queued or currently applying a newer shell. */
export function isForcedUpdatePending() {
    if (typeof window === 'undefined') return false;
    return !!window.__ntForcedUpdateVersion;
}

/**
 * Read-only: an ad inject is in flight. Do not change ad code — only wait.
 * `_adScriptInjected` / `_adScriptLoaded` / `nt-ads-entering` are set by clever-ads.
 */
export function isAdInjectionPending() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (window._adNetworkDestroyed) return false;
    if (document.documentElement.classList.contains('nt-ads-entering')) return true;
    if (window._adScriptInjected && !window._adScriptLoaded) return true;
    return false;
}

/** Phone is quiet enough for force-open Alerts / holiday reminders. */
export function isSettledForAutoNotices() {
    if (!isStableForThirdParty()) return false;
    if (isForcedUpdatePending()) return false;
    if (isAdInjectionPending()) return false;
    return true;
}

const AUTO_NOTICE_SETTLE_MAX_MS = 20000;

/** Run `fn` once the phone has settled, or after the wait cap. */
export function whenSettledForAutoNotices(fn, startedAt = Date.now()) {
    if (typeof window === 'undefined') return;
    if (typeof fn !== 'function') return;
    if (isSettledForAutoNotices() || (Date.now() - startedAt) >= AUTO_NOTICE_SETTLE_MAX_MS) {
        try { fn(); } catch { /* ignore */ }
        return;
    }
    setTimeout(() => whenSettledForAutoNotices(fn, startedAt), 400);
}
