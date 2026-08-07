/**
 * Remote holiday timetable approvals (per-region day types).
 * Notices only require admin approval once enforcement is live (from 11 Aug 2026).
 */
import { DYNAMIC_BASE_URL, SPECIAL_DATES } from './config.js';

/** Local calendar date (YYYY-MM-DD) when approval becomes mandatory for notices. */
export const HOLIDAY_APPROVAL_ENFORCE_FROM = '2026-08-11';

export const HOLIDAY_DAY_TYPE_OPTIONS = [
    { value: 'public_holiday', label: 'Public Holiday' },
    { value: 'saturday', label: 'Saturday' },
    { value: 'weekday', label: 'Weekday' },
    { value: 'sunday', label: 'Sunday (no service)' },
];

let cachedApprovals = null;
let loadPromise = null;
let loadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function pad2(n) {
    return String(n).padStart(2, '0');
}

function localIsoDate(now = new Date()) {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** True from 11 Aug 2026 local midnight onward. */
export function isHolidayApprovalEnforced(now = new Date()) {
    return localIsoDate(now) >= HOLIDAY_APPROVAL_ENFORCE_FROM;
}

export function getCachedHolidayApprovals() {
    return cachedApprovals;
}

export async function loadHolidayApprovals(force = false) {
    if (!force && !isHolidayApprovalEnforced()) {
        cachedApprovals = cachedApprovals || {};
        return cachedApprovals;
    }

    if (!force && cachedApprovals && (Date.now() - loadedAt) < CACHE_TTL_MS) {
        return cachedApprovals;
    }
    if (!force && loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const res = await fetch(`${DYNAMIC_BASE_URL}holiday_approvals.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!res.ok) {
                cachedApprovals = {};
            } else {
                const data = await res.json();
                cachedApprovals = (data && typeof data === 'object' && !data.error) ? data : {};
            }
        } catch {
            cachedApprovals = cachedApprovals || {};
        }
        loadedAt = Date.now();
        loadPromise = null;
        return cachedApprovals;
    })();

    return loadPromise;
}

export function getHolidayApproval(iso) {
    if (!iso || !cachedApprovals) return null;
    const entry = cachedApprovals[iso];
    return entry && typeof entry === 'object' ? entry : null;
}

/** Per-region approval row (new schema + legacy whole-holiday fallback). */
export function getRegionHolidayApproval(iso, region = 'GP') {
    const entry = getHolidayApproval(iso);
    if (!entry) return null;

    const code = region || 'GP';
    if (entry.regions && entry.regions[code] && typeof entry.regions[code] === 'object') {
        return entry.regions[code];
    }

    // Legacy: single approve for all regions
    if (entry.status === 'approved') {
        return {
            status: 'approved',
            dayType: entry.regionDayTypes?.[code] || entry.defaultDayType || SPECIAL_DATES?.[entry.dateKey] || 'saturday',
            approvedAt: entry.approvedAt || null,
        };
    }

    const legacyStatus = entry.status === 'rejected' ? 'deferred' : (entry.status || 'pending');
    return {
        status: legacyStatus,
        dayType: entry.defaultDayType || SPECIAL_DATES?.[entry.dateKey] || 'public_holiday',
    };
}

export function isHolidayApprovedForRegion(iso, region = 'GP') {
    const row = getRegionHolidayApproval(iso, region);
    return !!(row && row.status === 'approved');
}

/** @deprecated use isHolidayApprovedForRegion */
export function isHolidayApproved(iso) {
    return isHolidayApprovedForRegion(iso, 'GP');
}

/**
 * Whether a holiday notice may be shown for this ISO date in the user's region.
 * @param {string} iso
 * @param {string} [region='GP']
 * @param {Date} [now]
 */
export function canShowHolidayNotice(iso, region = 'GP', now = new Date()) {
    if (!iso) return false;
    const regionCode = typeof region === 'string' ? region : 'GP';
    const when = now instanceof Date ? now : new Date();
    if (!isHolidayApprovalEnforced(when)) return true;
    return isHolidayApprovedForRegion(iso, regionCode);
}

/**
 * Resolve schedule day-type for a holiday date key (MM-DD).
 * Approved region dayType wins; otherwise SPECIAL_DATES (calendar holiday still applies).
 * Deferred/pending regions do not override the calendar timetable — only the notice is gated.
 */
export function resolveHolidayDayType(dateKey, region, year = new Date().getFullYear()) {
    if (!dateKey) return null;
    const iso = `${year}-${dateKey}`;
    const row = getRegionHolidayApproval(iso, region || 'GP');
    if (row && row.status === 'approved' && row.dayType) return row.dayType;
    return SPECIAL_DATES?.[dateKey] || null;
}

export function invalidateHolidayApprovalsCache() {
    cachedApprovals = null;
    loadedAt = 0;
    loadPromise = null;
}
