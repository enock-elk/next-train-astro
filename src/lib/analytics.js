/**
 * Single analytics path: GA4 (gtag) + Clarity custom events + offline queue.
 * Leaf module — do not import ui/hub/planner (cycle risk). OfflineTracker lives on window.
 */

function scheduleIdle(fn) {
    try {
        queueMicrotask(fn);
    } catch {
        setTimeout(fn, 0);
    }
}

function readRegion(params) {
    try {
        if (params && params.region) return String(params.region);
        if (typeof localStorage === 'undefined') return '';
        return localStorage.getItem('userRegion') || '';
    } catch {
        return '';
    }
}

/** Fire gtag + Clarity now. Clarity is not gated on region. */
export function sendAnalyticsNow(name, params = {}) {
    const payload = params && typeof params === 'object' ? params : {};
    try {
        if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
            window.gtag('event', name, payload);
        }
    } catch { /* ignore */ }
    try {
        if (typeof window === 'undefined' || typeof window.clarity !== 'function') return;
        const region = readRegion(payload);
        if (region) window.clarity('set', 'crm_region', region);
        window.clarity('event', name);
    } catch { /* ignore */ }
}

/**
 * Queue-behind-UI tracker. Offline / GA-not-ready → OfflineTracker.
 * Always Clarity-pings when a live send happens (including flushed queue items).
 */
export function trackAnalyticsEvent(name, params = {}) {
    if (typeof window === 'undefined' || !name) return;
    const payload = params && typeof params === 'object' ? { ...params } : {};
    scheduleIdle(() => {
        try {
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            const tracker = window.OfflineTracker;
            const gaReady = typeof tracker?.gaReady === 'function' ? tracker.gaReady() : (
                window.__ntGaReady === true && typeof window.gtag === 'function'
            );
            if (offline || !gaReady) {
                if (typeof tracker?.enqueue === 'function') {
                    tracker.enqueue(name, payload);
                    if (!offline && typeof tracker.flush === 'function') tracker.flush();
                } else {
                    sendAnalyticsNow(name, payload);
                }
                return;
            }
            sendAnalyticsNow(name, payload);
        } catch { /* ignore */ }
    });
}

if (typeof window !== 'undefined') {
    window.trackAnalyticsEvent = trackAnalyticsEvent;
}
