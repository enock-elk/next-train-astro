/**
 * Remote holiday timetable approvals (region-aware day types).
 * Notices only require admin approval once enforcement is live (from 11 Aug 2026).
 * First approve wins; until then the legacy SPECIAL_DATES notice path still runs.
 */
import { DYNAMIC_BASE_URL, SPECIAL_DATES } from './config.js';

/** Local calendar date (YYYY-MM-DD) when approval becomes mandatory for notices. */
export const HOLIDAY_APPROVAL_ENFORCE_FROM = '2026-08-11';

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
    // Before enforcement, skip the network round-trip for notice gating.
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

export function isHolidayApproved(iso) {
    const entry = getHolidayApproval(iso);
    return !!(entry && entry.status === 'approved');
}

/**
 * Whether a holiday notice may be shown for this ISO date.
 * Before 11 Aug 2026: always yes (legacy path — Women's Day / Observed phase-out).
 * From 11 Aug 2026: requires an approved holiday_approvals entry.
 * Seen-key dismissals remain the user's permanent opt-out either way.
 */
export function canShowHolidayNotice(iso, now = new Date()) {
    if (!iso) return false;
    if (!isHolidayApprovalEnforced(now)) return true;
    return isHolidayApproved(iso);
}

/**
 * Resolve schedule day-type for a holiday date key (MM-DD).
 * Approved region overrides win when present; otherwise SPECIAL_DATES fallback.
 */
export function resolveHolidayDayType(dateKey, region, year = new Date().getFullYear()) {
    if (!dateKey) return null;
    const iso = `${year}-${dateKey}`;
    const entry = getHolidayApproval(iso);
    if (entry && entry.status === 'approved') {
        const code = region || 'GP';
        const fromRegion = entry.regionDayTypes && entry.regionDayTypes[code];
        if (fromRegion) return fromRegion;
        if (entry.defaultDayType) return entry.defaultDayType;
    }
    return SPECIAL_DATES?.[dateKey] || null;
}

export function invalidateHolidayApprovalsCache() {
    cachedApprovals = null;
    loadedAt = 0;
    loadPromise = null;
}
