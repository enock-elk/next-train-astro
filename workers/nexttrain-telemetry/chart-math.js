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

/** ISO week key YYYYWW for a YYYY-MM-DD day. Matches GA4 isoYearIsoWeek. */
export function isoWeekKey(isoDate) {
    const [y, m, d] = String(isoDate || '').split('-').map(Number);
    if (!y || !m || !d) return '';
    const date = new Date(Date.UTC(y, m - 1, d));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const isoYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${isoYear}${String(week).padStart(2, '0')}`;
}

/** Monday-Sunday bounds for a GA4 isoYearIsoWeek key. */
export function isoWeekBounds(yyyww) {
    const raw = String(yyyww || '');
    if (!/^\d{6}$/.test(raw)) return null;
    const y = Number(raw.slice(0, 4));
    const w = Number(raw.slice(4, 6));
    if (!y || w < 1 || w > 53) return null;
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const start = new Date(jan4);
    start.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (w - 1) * 7);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    const iso = (dt) => dt.toISOString().slice(0, 10);
    return { start: iso(start), end: iso(end) };
}

/** Date span covering the labels currently drawn on the user chart. */
export function adSpanForLabels(labels, range) {
    const keys = (Array.isArray(labels) ? labels : []).map((s) => String(s || '')).filter(Boolean);
    if (!keys.length || range === 'INTRADAY') return null;
    if (range === 'DAU') {
        const days = keys.filter((k) => /^\d{8}$/.test(k)).sort();
        if (!days.length) return null;
        const iso = (k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
        return { start: iso(days[0]), end: iso(days[days.length - 1]) };
    }
    if (range === 'WAU') {
        const weeks = keys.filter((k) => /^\d{6}$/.test(k)).sort();
        if (!weeks.length) return null;
        const first = isoWeekBounds(weeks[0]);
        const last = isoWeekBounds(weeks[weeks.length - 1]);
        if (!first || !last) return null;
        return { start: first.start, end: last.end };
    }
    if (range === 'MAU' || range === 'ALL') {
        const months = keys.filter((k) => /^\d{6}$/.test(k)).sort();
        if (!months.length) return null;
        const lastKey = months[months.length - 1];
        const y = Number(lastKey.slice(0, 4));
        const m = Number(lastKey.slice(4, 6));
        const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        return { start: `${months[0].slice(0, 4)}-${months[0].slice(4, 6)}-01`, end };
    }
    return null;
}

/**
 * Ad impression counts on the same buckets as the user chart.
 * daily is a map of YYYY-MM-DD → hits. Empty labels stay null so padded
 * slots do not draw a zero.
 */
export function alignAdSeries(labels, range, daily) {
    const map = daily instanceof Map ? daily : new Map(Object.entries(daily || {}));
    const sumWhere = (pred) => {
        let sum = 0;
        for (const [day, hits] of map) {
            if (pred(String(day))) sum += Number(hits) || 0;
        }
        return sum;
    };
    return (Array.isArray(labels) ? labels : []).map((label) => {
        const key = String(label || '');
        if (!key) return null;
        if (range === 'DAU' && /^\d{8}$/.test(key)) {
            const iso = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
            return Number(map.get(iso) || 0);
        }
        if (range === 'WAU' && /^\d{6}$/.test(key)) {
            return sumWhere((day) => isoWeekKey(day) === key);
        }
        if ((range === 'MAU' || range === 'ALL') && /^\d{6}$/.test(key)) {
            const prefix = `${key.slice(0, 4)}-${key.slice(4, 6)}`;
            return sumWhere((day) => day.startsWith(prefix));
        }
        return null;
    });
}

/** First-to-last change for the points on screen. Null slots are skipped. */
export function seriesTrend(values) {
    const nums = [];
    (Array.isArray(values) ? values : []).forEach((v) => {
        if (v === null || v === undefined || v === '') return;
        const n = Number(v);
        if (Number.isFinite(n)) nums.push(n);
    });
    if (!nums.length) return null;
    const first = nums[0];
    const last = nums[nums.length - 1];
    const sum = nums.reduce((a, b) => a + b, 0);
    const avg = sum / nums.length;
    const delta = last - first;
    const pct = first !== 0 ? (delta / first) * 100 : (last !== 0 ? 100 : 0);
    const trend = pct > 2 ? 'Growing' : (pct < -2 ? 'Down' : 'Flat');
    return { first, last, sum, avg, delta, pct, trend, count: nums.length };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** Calendar parts in Africa/Johannesburg, without depending on the host timezone. */
export function sastDateParts(now = new Date()) {
    const sast = new Date(now.getTime() + (2 * 60 * 60 * 1000));
    const year = sast.getUTCFullYear();
    const month = sast.getUTCMonth() + 1;
    const day = sast.getUTCDate();
    const pad = (n) => String(n).padStart(2, '0');
    return {
        year,
        month,
        day,
        dayKey: `${year}${pad(month)}${pad(day)}`,
        monthKey: `${year}${pad(month)}`,
        iso: `${year}-${pad(month)}-${pad(day)}`,
    };
}

/** Bucket that is still open, so it must not be compared with a finished one. */
export function inProgressKey(range, now = new Date()) {
    const parts = sastDateParts(now);
    if (range === 'DAU') return parts.dayKey;
    if (range === 'WAU') return isoWeekKey(parts.iso);
    if (range === 'MAU' || range === 'ALL') return parts.monthKey;
    return '';
}

function formatBucketLabel(key, range) {
    const raw = String(key || '');
    if (range === 'DAU' && /^\d{8}$/.test(raw)) {
        return `${Number(raw.slice(6, 8))} ${MONTH_LABELS[Number(raw.slice(4, 6)) - 1] || ''}`.trim();
    }
    if (range === 'WAU') {
        const bounds = isoWeekBounds(raw);
        if (!bounds) return raw;
        const [, m, d] = bounds.start.split('-');
        return `${Number(d)} ${MONTH_LABELS[Number(m) - 1] || ''}`.trim();
    }
    if ((range === 'MAU' || range === 'ALL') && /^\d{6}$/.test(raw)) {
        return `${MONTH_LABELS[Number(raw.slice(4, 6)) - 1] || ''} ${raw.slice(0, 4)}`.trim();
    }
    return raw;
}

function bucketSpan(key, range) {
    const raw = String(key || '');
    if (range === 'DAU' && /^\d{8}$/.test(raw)) {
        const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        return { start: iso, end: iso };
    }
    if (range === 'WAU') return isoWeekBounds(raw);
    if ((range === 'MAU' || range === 'ALL') && /^\d{6}$/.test(raw)) {
        const y = Number(raw.slice(0, 4));
        const m = Number(raw.slice(4, 6));
        const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        return { start: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-01`, end };
    }
    return null;
}

function windowFromKeys(keys, valueMap) {
    const nums = keys.map((key) => valueMap.get(key));
    const sum = nums.reduce((total, n) => total + n, 0);
    const spanStart = bucketSpan(keys[0], valueMap.range);
    const spanEnd = bucketSpan(keys[keys.length - 1], valueMap.range);
    const firstLabel = formatBucketLabel(keys[0], valueMap.range);
    const lastLabel = formatBucketLabel(keys[keys.length - 1], valueMap.range);
    return {
        keys,
        sum,
        avg: nums.length ? sum / nums.length : 0,
        count: nums.length,
        start: spanStart?.start || '',
        end: spanEnd?.end || '',
        label: keys.length > 1 ? `${firstLabel} to ${lastLabel}` : firstLabel,
    };
}

function trendFromSums(currentSum, previousSum) {
    const delta = currentSum - previousSum;
    const pct = previousSum !== 0 ? (delta / previousSum) * 100 : (currentSum !== 0 ? 100 : 0);
    const trend = pct > 2 ? 'Growing' : (pct < -2 ? 'Down' : 'Flat');
    return { delta, pct, trend };
}

/**
 * Compare the latest complete period with the complete period of the same
 * length immediately before it. The open day, week, or month is left out.
 * DAU uses 7 days (or fewer when history is shorter). WAU and MAU use one
 * finished week or month. ALL uses one finished month.
 */
export function equivalentPeriodTrend(labels, values, range, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const preferred = range === 'DAU' ? 7 : 1;
    if (range === 'INTRADAY') {
        if (!options.liveEdge) return null;
        const counts = Array.isArray(values) ? values : [];
        if (counts.length <= 48) return null;
        const yesterday = counts.slice(0, 48).map((n) => (n == null || n === '' ? 0 : Number(n) || 0));
        const today = [];
        counts.slice(48).forEach((n) => {
            if (n === null || n === undefined || n === '') return;
            today.push(Number(n) || 0);
        });
        const elapsed = today.slice(0, -1);
        if (!elapsed.length) return null;
        const prev = yesterday.slice(0, elapsed.length);
        const currentSum = elapsed.reduce((total, n) => total + n, 0);
        const previousSum = prev.reduce((total, n) => total + n, 0);
        const change = trendFromSums(currentSum, previousSum);
        return {
            ...change,
            width: elapsed.length,
            unit: 'same hours',
            versus: 'versus the same hours yesterday',
            current: { sum: currentSum, avg: currentSum / elapsed.length, count: elapsed.length, label: 'Today so far', start: '', end: '', keys: [] },
            previous: { sum: previousSum, avg: prev.length ? previousSum / prev.length : 0, count: prev.length, label: 'Yesterday, same hours', start: '', end: '', keys: [] },
        };
    }
    const valueMap = new Map();
    const labs = Array.isArray(labels) ? labels : [];
    const vals = Array.isArray(values) ? values : [];
    for (let i = 0; i < labs.length; i++) {
        const key = String(labs[i] || '');
        if (!key) continue;
        const raw = vals[i];
        if (raw === null || raw === undefined || raw === '') continue;
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        valueMap.set(key, n);
    }
    valueMap.range = range;
    const keys = [...valueMap.keys()].sort();
    if (!keys.length) return null;
    let endIdx = keys.length - 1;
    if (options.endLabel && keys.includes(String(options.endLabel))) {
        endIdx = keys.indexOf(String(options.endLabel));
    }
    const openKey = options.openKey || inProgressKey(range, now);
    if (openKey && keys[endIdx] === openKey) endIdx -= 1;
    let chosen = null;
    for (let width = Math.min(preferred, endIdx + 1); width >= 1; width -= 1) {
        const curStart = endIdx - width + 1;
        const prevStart = curStart - width;
        if (curStart < 0 || prevStart < 0) continue;
        const currentKeys = keys.slice(curStart, endIdx + 1);
        const prevKeys = keys.slice(prevStart, curStart);
        if (currentKeys.length === width && prevKeys.length === width) {
            chosen = { width, currentKeys, prevKeys };
            break;
        }
    }
    if (!chosen) return null;
    const current = windowFromKeys(chosen.currentKeys, valueMap);
    const previous = windowFromKeys(chosen.prevKeys, valueMap);
    const change = trendFromSums(current.sum, previous.sum);
    const noun = range === 'DAU'
        ? (chosen.width === 1 ? 'day' : 'days')
        : (range === 'WAU' ? 'full week' : 'full month');
    const versus = range === 'DAU'
        ? `versus the previous ${chosen.width} ${noun}`
        : `versus the previous ${noun}`;
    return {
        ...change,
        width: chosen.width,
        unit: noun,
        versus,
        current,
        previous,
    };
}

/** Viewable impressions per active user across two equal complete periods. */
export function equivalentViewability(userTrend, adTrend) {
    if (!userTrend?.current || !adTrend?.current || !userTrend.previous || !adTrend.previous) return null;
    const curUsers = Number(userTrend.current.sum);
    const prevUsers = Number(userTrend.previous.sum);
    if (!Number.isFinite(curUsers) || !Number.isFinite(prevUsers) || curUsers <= 0 || prevUsers <= 0) return null;
    const current = (Number(adTrend.current.sum) || 0) / curUsers;
    const previous = (Number(adTrend.previous.sum) || 0) / prevUsers;
    const change = trendFromSums(current, previous);
    return {
        ...change,
        current,
        previous,
        avg: current,
        versus: userTrend.versus,
        width: userTrend.width,
        currentLabel: userTrend.current.label,
        previousLabel: userTrend.previous.label,
    };
}

/** Viewable impressions per active user, one rate per bucket that has users. */
export function viewabilityTrend(users, ads) {
    const rates = [];
    const len = Math.min(Array.isArray(users) ? users.length : 0, Array.isArray(ads) ? ads.length : 0);
    for (let i = 0; i < len; i++) {
        const u = Number(users[i]);
        const a = ads[i];
        if (!Number.isFinite(u) || u <= 0 || a === null || a === undefined) continue;
        rates.push((Number(a) || 0) / u);
    }
    return seriesTrend(rates);
}
