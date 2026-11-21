/**
 * CleverAds stats for Dev mode. The script id stays in the Worker secret
 * CLEVER_SCRIPT_ID. Clever rejects a range longer than 3 months, so a search
 * is several windows stitched here. The phone never sees the token.
 */

const API = 'https://c2p-api.cleverwebserver.com/v3/hits';

export function isoTodayUtc(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

export function addUtcDays(iso, days) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return '';
    const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
    return dt.toISOString().slice(0, 10);
}

export function addUtcMonths(iso, months) {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return '';
    const shifted = new Date(Date.UTC(y, m - 1 + Number(months || 0), 1));
    const last = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
    const day = Math.min(d, last);
    return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), day)).toISOString().slice(0, 10);
}

/** Windows that stay inside Clever's 3-month cap. */
export function cleverWindows(start, end) {
    const windows = [];
    let cursor = start;
    let guard = 0;
    while (cursor && end && cursor <= end && guard < 24) {
        const cap = addUtcDays(addUtcMonths(cursor, 3), -1);
        const windowEnd = cap && cap < end ? cap : end;
        windows.push({ start: cursor, end: windowEnd });
        if (windowEnd >= end) break;
        cursor = addUtcDays(windowEnd, 1);
        guard += 1;
    }
    return windows;
}

function scriptIdOk(id) {
    return /^[A-Za-z0-9+/=_-]{8,128}$/.test(String(id || ''));
}

async function fetchWindow(scriptId, start, end) {
    const dataUrl = `${API}/data?scriptId=${encodeURIComponent(scriptId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const domainUrl = `${API}/domains/${scriptId}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const [dataRes, domainRes] = await Promise.all([
        fetch(dataUrl, { headers: { Accept: 'application/json' } }),
        fetch(domainUrl, { headers: { Accept: 'application/json' } }),
    ]);
    const dataJson = await dataRes.json().catch(() => ({}));
    const payload = dataJson?.data;
    if (!dataRes.ok || payload?.status === 'error' || payload?.errors) {
        const message = Array.isArray(payload?.errors) ? payload.errors.join(' ') : `Clever returned ${dataRes.status}`;
        const err = new Error(message || 'Clever rejected that period');
        err.status = dataRes.status || 502;
        throw err;
    }
    let domains = [];
    if (domainRes.ok) {
        const domainJson = await domainRes.json().catch(() => ({}));
        const list = domainJson?.data;
        if (Array.isArray(list)) domains = list.map((d) => String(d || '')).filter(Boolean);
    }
    return { payload, domains };
}

function deviceSplit(browsers) {
    const labels = browsers?.dataset?.label || [];
    const series = browsers?.dataset?.series;
    const data = Array.isArray(series) ? (series[0]?.data || []) : (series?.data || []);
    const at = (name) => {
        const i = labels.findIndex((label) => String(label || '').toLowerCase() === name);
        const n = Number(data[i]);
        return Number.isFinite(n) ? n : 0;
    };
    return { desktop: at('desktop'), mobile: at('mobile') };
}

function countryRows(countries) {
    const labels = countries?.dataset?.label || [];
    const values = countries?.dataset?.series?.value || [];
    return labels.map((code, i) => ({
        code: String(code || ''),
        hits: Number(values[i]) || 0,
    })).filter((row) => row.code);
}

/**
 * @param {Array<{ payload: object, domains?: string[] }>} parts
 */
export function mergeCleverParts(parts) {
    const days = new Map();
    const countries = new Map();
    const domains = new Set();
    const currencies = new Map();
    let hits = 0;
    let revenue = 0;
    let desktopHits = 0;
    let mobileHits = 0;
    let deviceHits = 0;
    let firstHit = '';
    let lastSyncedAt = '';
    let dealType = '';
    let coin = 'USD';

    for (const part of parts) {
        const gp = part?.payload?.globalPerformance || {};
        const windowHits = Number(gp.hits) || 0;
        hits += windowHits;
        revenue += Number(gp.value) || 0;
        if (gp.dealType) dealType = gp.dealType;
        if (gp.coin) coin = gp.coin;
        if (gp.firstHit && (!firstHit || gp.firstHit < firstHit)) firstHit = gp.firstHit;
        if (gp.lastSyncedAt && gp.lastSyncedAt > lastSyncedAt) lastSyncedAt = gp.lastSyncedAt;
        const split = deviceSplit(part?.payload?.browsers);
        if (windowHits > 0 && (split.desktop || split.mobile)) {
            desktopHits += windowHits * (split.desktop / 100);
            mobileHits += windowHits * (split.mobile / 100);
            deviceHits += windowHits;
        }
        const visitors = part?.payload?.visitors?.dataset || {};
        const labels = visitors.label || [];
        const seriesHits = visitors.series?.hits || [];
        labels.forEach((day, i) => {
            const key = String(day || '');
            if (!key) return;
            days.set(key, (days.get(key) || 0) + (Number(seriesHits[i]) || 0));
        });
        countryRows(part?.payload?.countries).forEach((row) => {
            countries.set(row.code, (countries.get(row.code) || 0) + row.hits);
        });
        (part?.payload?.currencies || []).forEach((row) => {
            const code = String(row?.currency || coin || 'USD');
            const prev = currencies.get(code) || { currency: code, revenue: 0, hits: 0 };
            prev.revenue += Number(row?.revenue) || 0;
            prev.hits += Number(row?.hits) || 0;
            currencies.set(code, prev);
        });
        (part?.domains || []).forEach((domain) => domains.add(domain));
    }

    const labels = [...days.keys()].sort();
    const series = labels.map((day) => days.get(day) || 0);
    const geos = [...countries.entries()]
        .map(([code, count]) => ({ code, hits: count }))
        .sort((a, b) => b.hits - a.hits);
    const totalDevice = deviceHits || hits || 1;
    return {
        hits,
        revenue: Math.round(revenue * 100) / 100,
        coin,
        dealType: dealType || 'CPM',
        firstHit,
        lastSyncedAt,
        desktop: deviceHits ? Math.round((desktopHits / totalDevice) * 10000) / 100 : 0,
        mobile: deviceHits ? Math.round((mobileHits / totalDevice) * 10000) / 100 : 0,
        labels,
        series,
        geos,
        currencies: [...currencies.values()],
        domains: [...domains],
    };
}

export async function loadCleverRange(scriptId, start, end) {
    if (!scriptIdOk(scriptId)) {
        const err = new Error('Ad stats are not configured');
        err.status = 503;
        throw err;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
        const err = new Error('Choose a start and end date');
        err.status = 400;
        throw err;
    }
    const probe = await fetchWindow(scriptId, end, end);
    const knownFirst = String(probe.payload?.globalPerformance?.firstHit || '');
    const from = knownFirst && start < knownFirst ? knownFirst : start;
    if (from > end) {
        return {
            hits: 0,
            revenue: 0,
            coin: 'USD',
            dealType: 'CPM',
            firstHit: knownFirst,
            lastSyncedAt: probe.payload?.globalPerformance?.lastSyncedAt || '',
            desktop: 0,
            mobile: 0,
            labels: [],
            series: [],
            geos: [],
            currencies: [],
            domains: probe.domains || [],
            start: from,
            end,
            requestedStart: start,
            windows: 0,
        };
    }
    const windows = cleverWindows(from, end);
    const parts = [];
    for (const window of windows) {
        if (window.start === end && window.end === end) parts.push(probe);
        else parts.push(await fetchWindow(scriptId, window.start, window.end));
    }
    const merged = mergeCleverParts(parts);
    return {
        ...merged,
        start: from,
        end,
        requestedStart: start,
        windows: windows.length,
        firstHit: merged.firstHit || knownFirst,
    };
}
