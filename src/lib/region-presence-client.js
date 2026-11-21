/**
 * Report the selected app region once per Johannesburg day.
 * A region change reports again. The Worker moves that device; it does not
 * count it in both regions. A failed send stays unsent and retries later.
 */

const ENDPOINT = 'https://nexttrain-telemetry.enock.workers.dev/region-presence';
const REGIONS = new Set(['GP', 'WC', 'KZN', 'EC']);
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

let onlineRetryBound = false;

function johannesburgDay(nowMs = Date.now()) {
    const shifted = new Date(nowMs + SAST_OFFSET_MS);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function readDeviceId() {
    try {
        const fromWindow = typeof window !== 'undefined' ? window.NEXT_TRAIN_DEVICE_ID : '';
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('next_train_device_id') : '';
        const id = String(fromWindow || stored || '').trim();
        if (id.length < 8 || id.length > 120) return '';
        if (!/^[A-Za-z0-9_.:@-]+$/.test(id)) return '';
        return id;
    } catch {
        return '';
    }
}

function sentKey(day, region) {
    return `nt-region-presence:${day}:${region}`;
}

function alreadySent(day, region) {
    try {
        return localStorage.getItem(sentKey(day, region)) === '1';
    } catch {
        return false;
    }
}

function markSent(day, region) {
    try {
        localStorage.setItem(sentKey(day, region), '1');
    } catch { /* ignore */ }
}

function schedule(fn) {
    try {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => { try { fn(); } catch { /* ignore */ } }, { timeout: 2000 });
            return;
        }
    } catch { /* fall through */ }
    setTimeout(() => { try { fn(); } catch { /* ignore */ } }, 0);
}

function bindOnlineRetry() {
    if (onlineRetryBound || typeof window === 'undefined') return;
    onlineRetryBound = true;
    window.addEventListener('online', () => {
        let region = '';
        try { region = localStorage.getItem('userRegion') || ''; } catch { region = ''; }
        reportSelectedRegionPresence(region);
    });
}

async function sendPresence(deviceId, region, day, attempt) {
    try {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId, region }),
            keepalive: true,
        });
        if (!res.ok) throw new Error(String(res.status));
        markSent(day, region);
    } catch {
        if (attempt < 3) {
            setTimeout(() => { sendPresence(deviceId, region, day, attempt + 1).catch(() => {}); }, 5000 * (attempt + 1));
            return;
        }
        bindOnlineRetry();
    }
}

/** Fire-and-forget. Never blocks boot or region switching. */
export function reportSelectedRegionPresence(region, waitAttempt = 0) {
    if (typeof window === 'undefined') return;
    const code = String(region || '').trim().toUpperCase();
    if (!REGIONS.has(code)) return;
    const day = johannesburgDay();
    if (alreadySent(day, code)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        bindOnlineRetry();
        return;
    }
    schedule(() => {
        const deviceId = readDeviceId();
        if (!deviceId) {
            if (waitAttempt < 5) setTimeout(() => reportSelectedRegionPresence(code, waitAttempt + 1), 1000);
            return;
        }
        if (alreadySent(day, code)) return;
        sendPresence(deviceId, code, day, 0).catch(() => {});
    });
}
