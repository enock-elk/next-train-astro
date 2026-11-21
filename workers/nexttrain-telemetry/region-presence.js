/**
 * Exact daily region split.
 * One reporting device is stored once per Johannesburg day. A later report the
 * same day moves that device to the newly selected region. It does not add a
 * second card. The stored key is a hash, not the browser id.
 */

export const REGION_CODES = ['GP', 'WC', 'KZN', 'EC'];
const REGION_SET = new Set(REGION_CODES);
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
export const REGION_RETENTION_DAYS = 35;

const ALLOWED_ORIGINS = new Set([
    'https://nexttrain.co.za',
    'https://www.nexttrain.co.za',
    'https://lab.nexttrain.co.za',
    'https://enock-elk.github.io',
    'https://next-train-lab.pages.dev',
]);

export function johannesburgDay(nowMs = Date.now()) {
    const shifted = new Date(Number(nowMs) + SAST_OFFSET_MS);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function retentionFloorDay(nowMs = Date.now(), keepDays = REGION_RETENTION_DAYS) {
    return johannesburgDay(Number(nowMs) - (keepDays * 24 * 60 * 60 * 1000));
}

export function isReportableDeviceId(value) {
    const id = String(value || '').trim();
    if (id.length < 8 || id.length > 120) return false;
    if (id === 'unknown' || id === 'Anonymous / Legacy') return false;
    return /^[A-Za-z0-9_.:@-]+$/.test(id);
}

export function parsePresenceBody(raw) {
    let data;
    try {
        data = JSON.parse(String(raw || ''));
    } catch {
        return { ok: false, status: 400, error: 'Invalid JSON' };
    }
    const region = String(data?.region || '').trim().toUpperCase();
    const deviceId = String(data?.deviceId || '').trim();
    if (!REGION_SET.has(region)) {
        return { ok: false, status: 400, error: 'Region must be GP, WC, KZN, or EC' };
    }
    if (!isReportableDeviceId(deviceId)) {
        return { ok: false, status: 400, error: 'Device id is not reportable' };
    }
    return { ok: true, region, deviceId };
}

export function presenceOriginAllowed(origin) {
    const value = String(origin || '').trim();
    if (!value || value === 'null') return false;
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (ALLOWED_ORIGINS.has(url.origin)) return true;
    const host = url.hostname;
    if (url.protocol === 'https:' && host.endsWith('.next-train-lab.pages.dev')) return true;
    if (url.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) return true;
    return false;
}

export function presenceCorsHeaders(origin) {
    const headers = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
    if (presenceOriginAllowed(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

export async function hashDeviceId(deviceId, pepper) {
    const secret = String(pepper || '');
    if (!secret) throw new Error('REGION_PRESENCE_PEPPER is not set');
    const material = new TextEncoder().encode(`${secret}\n${deviceId}`);
    const digest = await crypto.subtle.digest('SHA-256', material);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function emptyRegionCounts() {
    return { GP: 0, WC: 0, KZN: 0, EC: 0, total: 0 };
}

export function tallyRegionCounts(rows) {
    const out = emptyRegionCounts();
    for (const row of rows || []) {
        const region = String(row?.region || '').trim().toUpperCase();
        const n = Number(row?.n) || 0;
        if (!REGION_SET.has(region) || n <= 0) continue;
        out[region] += n;
        out.total += n;
    }
    return out;
}

/**
 * In-memory twin of the D1 upsert. Tests use this to prove a device moves
 * instead of being counted twice. The Worker uses the SQL in region-store.js.
 */
export function assignReportingDevice(rows, event) {
    const next = new Map(rows || []);
    const key = `${event.day}\0${event.deviceHash}`;
    const prev = next.get(key);
    if (!prev) {
        next.set(key, {
            day: event.day,
            deviceHash: event.deviceHash,
            region: event.region,
            firstSeen: event.now,
            lastSeen: event.now,
        });
    } else {
        next.set(key, { ...prev, region: event.region, lastSeen: event.now });
    }
    const floor = event.retentionFloor;
    if (floor) {
        for (const [rowKey, row] of next) {
            if (row.day < floor) next.delete(rowKey);
        }
    }
    return next;
}

export function countsForDay(rows, day) {
    const grouped = new Map();
    for (const row of (rows || new Map()).values()) {
        if (row.day !== day) continue;
        grouped.set(row.region, (grouped.get(row.region) || 0) + 1);
    }
    return tallyRegionCounts([...grouped].map(([region, n]) => ({ region, n })));
}

export function sentryStatusFromResult({ configured, ok = true, count = 0, detail = '' } = {}) {
    if (!configured) {
        return {
            todayErrors: '--',
            sentryStatus: 'unconfigured',
            sentryErrorDetail: 'SENTRY_AUTH_TOKEN, SENTRY_ORG, or SENTRY_PROJECT is not set on the telemetry Worker.',
        };
    }
    if (!ok) {
        return {
            todayErrors: 'ERR',
            sentryStatus: 'error',
            sentryErrorDetail: safeSentryDetail(detail) || 'Sentry request failed',
        };
    }
    const n = Number(count) || 0;
    if (n <= 0) {
        return { todayErrors: '0', sentryStatus: 'zero', sentryErrorDetail: null };
    }
    return { todayErrors: String(n), sentryStatus: 'ok', sentryErrorDetail: null };
}

export function safeSentryDetail(text) {
    return String(text || '')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
}
