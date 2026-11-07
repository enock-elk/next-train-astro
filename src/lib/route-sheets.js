/**
 * Per-route Sunday and Special sheets.
 *
 * Weekday and Saturday keys stay on ROUTES.sheetKeys. A Sunday tab
 * PTA-to-PIEN_Sun syncs as pta_to_pien_sun. A special tab
 * PTA-to-PIEN_Special syncs as pta_to_pien_special.
 *
 * config/route_sheets turns a route on. Other routes stay on their normal day.
 * An enabled sheet with no times does not replace the normal board.
 */
import { DYNAMIC_BASE_URL, ROUTES } from './config.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const META_KEYS = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index', 'lastUpdated', 'headers', 'rows']);

let cachedConfig = null;
let loadedAt = 0;
let loadPromise = null;
let readDatabase = () => null;
let readAsOf = () => null;
let asOfOverride = null;
const asOfStack = [];

const RECHECK_MS = 3 * 60 * 1000;

export function setRouteSheetDatabaseReader(fn) {
    readDatabase = typeof fn === 'function' ? fn : () => null;
}

/** Sim "specific date", or null for the real Johannesburg day. */
export function setRouteSheetAsOfReader(fn) {
    readAsOf = typeof fn === 'function' ? fn : () => null;
}

/** Planner lookahead. Nested calls restore the previous day. */
export function pushRouteSheetAsOf(asOf) {
    asOfStack.push(asOfOverride);
    asOfOverride = asOf || null;
    return () => {
        asOfOverride = asOfStack.length ? asOfStack.pop() : null;
    };
}

export function routeSheetAsOfNow() {
    return asOfOverride;
}

export function normalizeRouteSheetDates(raw) {
    if (raw == null || raw === '') return [];
    const parts = Array.isArray(raw) ? raw : String(raw).split(/[\s,;]+/);
    const out = [];
    const seen = new Set();
    for (const part of parts) {
        const day = String(part || '').trim().slice(0, 10);
        if (!DATE_RE.test(day) || seen.has(day)) continue;
        seen.add(day);
        out.push(day);
    }
    out.sort();
    return out;
}

/** Johannesburg calendar YYYY-MM-DD. */
export function johannesburgDateKey(date = new Date()) {
    try {
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Johannesburg',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const key = fmt.format(date);
        if (DATE_RE.test(key)) return key;
    } catch { /* fall through */ }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function dateFromIso(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 10, 0, 0));
}

function resolveAsOf(asOf) {
    if (asOf instanceof Date) return asOf;
    if (typeof asOf === 'string' && DATE_RE.test(asOf)) return dateFromIso(asOf);
    const reader = readAsOf();
    if (typeof reader === 'string' && DATE_RE.test(reader)) return dateFromIso(reader);
    if (reader instanceof Date) return reader;
    return new Date();
}

export function routeSheetEntryApplies(entry, asOf = null) {
    if (!entry || entry.active !== true) return false;
    const dates = normalizeRouteSheetDates(entry.dates);
    if (!dates.length) return true;
    return dates.includes(johannesburgDateKey(resolveAsOf(asOf)));
}

/**
 * Firebase key for a Sunday or Special direction.
 * Derived from the weekday key so existing sheetKeys objects stay unchanged.
 */
export function extraSheetKey(route, family, ab = 'a') {
    const dir = ab === 'b' || ab === 'B' ? 'b' : 'a';
    const slot = family === 'sunday' ? 'sunday' : (family === 'special' ? 'special' : '');
    if (!slot) return '';
    const explicit = route?.sheetKeys?.[`${slot}_to_${dir}`];
    if (explicit) return String(explicit);
    const weekday = route?.sheetKeys?.[`weekday_to_${dir}`];
    if (!weekday || !/_weekday$/.test(String(weekday))) return '';
    const suffix = slot === 'sunday' ? 'sun' : 'special';
    return String(weekday).replace(/_weekday$/, `_${suffix}`);
}

/** Spreadsheet tab that syncs to extraSheetKey. PIEN-to-PTA_Sun, PTA-to-PIEN_Special. */
export function suggestedSheetTab(route, family, ab = 'a') {
    const key = extraSheetKey(route, family, ab);
    if (!key) return '';
    const suffix = key.endsWith('_sun') ? 'Sun' : 'Special';
    const base = key.replace(/_(sun|special)$/, '');
    const parts = base.split('_').map((part) => (part === 'to' ? 'to' : part.toUpperCase()));
    return `${parts.join('-')}_${suffix}`;
}

export function getCachedRouteSheets() {
    return cachedConfig;
}

/** Test hook. Pass null to clear. */
export function setCachedRouteSheets(config) {
    cachedConfig = config && typeof config === 'object' ? config : null;
}

function routeRow(routeId) {
    const id = String(routeId || '');
    const row = cachedConfig?.routes?.[id];
    return row && typeof row === 'object' ? row : null;
}

/** 'special' | 'sunday' | null from the switch alone. Special wins. */
export function configuredRouteSheetMode(routeId, dayType, asOf = null) {
    const row = routeRow(routeId);
    if (!row) return null;
    const when = asOf != null ? asOf : asOfOverride;
    if (routeSheetEntryApplies(row.special, when)) return 'special';
    if (dayType === 'sunday' && routeSheetEntryApplies(row.sunday, when)) return 'sunday';
    return null;
}

export function rawSheetHasTrains(db, key) {
    if (!db || !key) return false;
    let rows = db[key];
    if (!rows) return false;
    if (!Array.isArray(rows) && typeof rows === 'object') {
        if (Array.isArray(rows.rows)) rows = rows.rows;
        else {
            rows = Object.keys(rows)
                .filter((k) => k !== 'lastUpdated' && k !== 'headers' && k !== 'rows')
                .map((k) => rows[k])
                .filter((row) => row && typeof row === 'object');
        }
    }
    if (!Array.isArray(rows)) return false;
    return rows.some((row) => {
        if (!row || typeof row !== 'object') return false;
        return Object.keys(row).some((col) => {
            if (META_KEYS.has(col)) return false;
            if (/^last updated/i.test(col)) return false;
            const value = row[col];
            return value != null && String(value).trim() !== '';
        });
    });
}

export function familyHasTrains(db, route, family) {
    if (!db || !route || (family !== 'sunday' && family !== 'special')) return false;
    return rawSheetHasTrains(db, extraSheetKey(route, family, 'a'))
        || rawSheetHasTrains(db, extraSheetKey(route, family, 'b'));
}

/**
 * Sheet family to paint. Null keeps the normal weekday / Saturday / no-service path.
 * Before the timetable download, the switch is trusted. After it, empty tabs do not swap the board.
 */
export function effectiveRouteSheetMode(route, dayType, asOf = null) {
    const id = typeof route === 'string' ? route : route?.id;
    const when = asOf != null ? asOf : asOfOverride;
    const mode = configuredRouteSheetMode(id, dayType, when);
    if (!mode) return null;
    const routeObj = route && typeof route === 'object' && route.sheetKeys ? route : ROUTES[id];
    if (!routeObj) return null;
    const db = readDatabase();
    if (!db) return mode;
    if (!familyHasTrains(db, routeObj, mode)) return null;
    return mode;
}

export function routeSheetNote(route, dayType, asOf = null) {
    const mode = effectiveRouteSheetMode(route, dayType, asOf);
    if (!mode) return null;
    const id = typeof route === 'string' ? route : route?.id;
    const entry = routeRow(id)?.[mode === 'special' ? 'special' : 'sunday'] || {};
    const title = String(entry.title || '').trim();
    const body = String(entry.body || '').trim();
    return {
        mode,
        title: title || (mode === 'sunday' ? 'Sunday Schedule' : 'Special'),
        body: body || (mode === 'sunday'
            ? 'Sunday trains are running on this line today.'
            : 'This line is using its special timetable today.'),
    };
}

export async function fetchRouteSheets(force = false) {
    if (loadedAt && !force && (Date.now() - loadedAt) < RECHECK_MS) return cachedConfig;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const before = JSON.stringify(cachedConfig?.routes || null);
        try {
            const res = await fetch(`${DYNAMIC_BASE_URL}config/route_sheets.json`);
            loadedAt = Date.now();
            if (res.ok) {
                const data = await res.json();
                cachedConfig = (data && typeof data === 'object' && !data.error) ? data : null;
            }
        } catch {
            loadedAt = Date.now();
        }
        loadPromise = null;
        const after = JSON.stringify(cachedConfig?.routes || null);
        if (before !== after && typeof window !== 'undefined' && typeof window.updateTime === 'function') {
            try { window.updateTime(); } catch { /* ignore */ }
        }
        return cachedConfig;
    })();
    return loadPromise;
}

if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        fetchRouteSheets(false);
    });
    window.fetchRouteSheets = fetchRouteSheets;
    window.extraSheetKey = extraSheetKey;
    window.suggestedSheetTab = suggestedSheetTab;
    window.normalizeRouteSheetDates = normalizeRouteSheetDates;
}
