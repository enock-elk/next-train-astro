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
