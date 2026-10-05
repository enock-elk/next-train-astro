/**
 * Single analytics path: GA4 (gtag) + Clarity custom events + offline queue.
 * Leaf module — do not import ui/hub/planner (cycle risk). OfflineTracker lives on window.
 * Every event gets region_id (and region) when a GP/WC/KZN/EC code is known.
 */

/** After the next paint when possible — microtasks still count against INP. */
function scheduleIdle(fn) {
    try {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => { try { fn(); } catch { /* ignore */ } }, { timeout: 2000 });
            return;
        }
    } catch { /* fall through */ }
    setTimeout(() => { try { fn(); } catch { /* ignore */ } }, 0);
}

function normalizeRegionCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return (code === 'GP' || code === 'WC' || code === 'KZN' || code === 'EC') ? code : '';
}

function readRegion(params) {
    try {
        const fromParams = normalizeRegionCode(
            params?.region_id || params?.region || params?.seo_region || ''
        );
        if (fromParams) return fromParams;
        if (typeof localStorage === 'undefined') return '';
        return normalizeRegionCode(localStorage.getItem('userRegion') || '');
    } catch {
        return '';
    }
}

/** Attach region_id on every payload. Callers can still pass a more specific region. */
export function withAnalyticsRegion(params = {}) {
    const payload = params && typeof params === 'object' ? { ...params } : {};
    const region = readRegion(payload);
    if (region) {
        if (!payload.region_id) payload.region_id = region;
        if (!payload.region) payload.region = region;
    }
    return payload;
}

/** Fire gtag + Clarity now. Clarity is not gated on region. */
export function sendAnalyticsNow(name, params = {}) {
    const payload = withAnalyticsRegion(params);
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
    const payload = withAnalyticsRegion(params);
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
