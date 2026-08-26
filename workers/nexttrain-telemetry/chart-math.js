/**
 * Pure telemetry chart helpers shared by the Worker and verify scripts.
 * Keep this file free of env / fetch so Node can import it.
 */

const REGION_KEYS = new Set(['GP', 'WC', 'KZN', 'EC']);
const UNSET_KEYS = new Set(['', '(NOT SET)', '(OTHER)', '-', 'UNDEFINED', 'NULL', 'NONE']);

export function classifyCrmRegion(raw) {
    const value = String(raw ?? '').trim();
    const key = value.toUpperCase();
    if (REGION_KEYS.has(key)) return key;
    if (key === 'GAUTENG') return 'GP';
    if (key === 'WESTERN CAPE' || key === 'WESTERNCAPE') return 'WC';
    if (key === 'KWAZULU-NATAL' || key === 'KWAZULU NATAL' || key === 'NL') return 'KZN';
    if (key === 'EASTERN CAPE' || key === 'EASTERNCAPE') return 'EC';
    if (!key || UNSET_KEYS.has(key) || key === '(NOT SET)' || key === '(OTHER)') return 'UNSET';
    return 'OTHER';
}

/** Current 30-min bucket index on the packed [yesterday 0..47 | today 48..95] timeline. */
export function currentIntradayBucket(nowHour, nowMinute) {
    const h = Math.max(0, Math.min(23, Number(nowHour) || 0));
    const m = Math.max(0, Math.min(59, Number(nowMinute) || 0));
    return 48 + (h * 2) + (m >= 30 ? 1 : 0);
}

/**
 * End index (inclusive) for INTRADAY chartData.
 * Uses the latest GA4 row we actually received, never past "now".
 * A fixed 3-hour lag buffer is not required and hides hours that already have data.
 */
export function clipIntradayCutoff(lastSeenToday, nowHour, nowMinute) {
    const nowBucket = currentIntradayBucket(nowHour, nowMinute);
    const seen = Number(lastSeenToday);
    if (Number.isFinite(seen) && seen >= 48) {
        return Math.min(seen, nowBucket);
    }
    return 47;
}

export function yearMonthKey(year, month) {
    return `${year}${String(month).padStart(2, '0')}`;
}

/** Inclusive YYYYMM keys from start (e.g. 202601) through end (e.g. 202608). */
export function enumerateYearMonths(startKey, endKey) {
    const start = String(startKey || '202601');
    const end = String(endKey || start);
    let y = parseInt(start.slice(0, 4), 10);
    let m = parseInt(start.slice(4, 6), 10);
    const endY = parseInt(end.slice(0, 4), 10);
    const endM = parseInt(end.slice(4, 6), 10);
    const out = [];
    if (!y || !m || !endY || !endM) return out;
    while (y < endY || (y === endY && m <= endM)) {
        out.push(yearMonthKey(y, m));
        m += 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
        if (out.length > 240) break;
    }
    return out;
}

export function fillYearMonthSeries(rowMap, startKey, endKey) {
    const map = rowMap instanceof Map ? rowMap : new Map(Object.entries(rowMap || {}));
    const keys = enumerateYearMonths(startKey, endKey);
    return {
        labels: keys,
        counts: keys.map((k) => Number(map.get(k)) || 0),
    };
}

/**
 * Client-side window into worker chartData.
 * ALL plots every month from the worker (Jan 2026 → now). Do not slice to 7.
 */
export function sliceChartWindow({ range, offset = 0, counts = [], labels = [] }) {
    const rawCounts = Array.isArray(counts) ? counts : [];
    const rawLabels = Array.isArray(labels) ? labels : [];
    const masterLen = rawCounts.length;
    const weeksAgo = Number(offset) || 0;

    if (range === 'INTRADAY') {
        const todayStart = masterLen > 48 ? 48 : 0;
        let startIndex;
        let endIndex;
        if (weeksAgo === 0) {
            startIndex = todayStart;
            endIndex = masterLen;
        } else if (weeksAgo === 1 && masterLen > 48) {
            startIndex = 0;
            endIndex = 48;
        } else {
            startIndex = 0;
            endIndex = 0;
        }
        let active = rawCounts.slice(startIndex, endIndex);
        let labs = rawLabels.slice(startIndex, endIndex);
        if (active.length < 48) {
            const padLen = 48 - active.length;
            active = [...active, ...Array(padLen).fill(null)];
            labs = [...labs, ...Array(padLen).fill('')];
        } else if (active.length > 48) {
            active = active.slice(0, 48);
            labs = labs.slice(0, 48);
        }
        return { counts: active, labels: labs, startIndex, endIndex };
    }

    if (range === 'ALL') {
        return { counts: rawCounts.slice(), labels: rawLabels.slice(), startIndex: 0, endIndex: masterLen };
    }

    const pointsPerView = 7;
    let endIndex = masterLen - (weeksAgo * pointsPerView);
    let startIndex = endIndex - pointsPerView;
    if (startIndex < 0) startIndex = 0;
    if (endIndex < 0) endIndex = 0;
    let active = rawCounts.slice(startIndex, endIndex);
    let labs = rawLabels.slice(startIndex, endIndex);
    if (active.length < pointsPerView && masterLen > 0) {
        const padLen = pointsPerView - active.length;
        active = [...Array(padLen).fill(0), ...active];
        labs = [...Array(padLen).fill(''), ...labs];
    }
    return { counts: active, labels: labs, startIndex, endIndex };
}
