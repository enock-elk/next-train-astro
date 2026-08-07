/**
 * Admin-forced schedule day-type per region (System Controls).
 * App boots with the normal calendar day type; when a remote override is active
 * and differs, commuters see a one-time modal then timetables switch.
 */
import { DYNAMIC_BASE_URL } from './config.js';
import { safeStorage } from './utils.js';
import { openSmoothModal, closeSmoothModal } from './ui.js';
import { $userRegion } from '../store.js';

let cachedConfig = null;
let loadedAt = 0;
let loadPromise = null;
const CACHE_TTL_MS = 60 * 1000;
const PROMPT_UNLOCK_MS = 5 * 60 * 1000;

/** Region → forced dayType when commuter has acknowledged the override. */
const appliedOverrides = {};

export function getCachedScheduleOverride() {
    return cachedConfig;
}

export function getAppliedScheduleOverride(region) {
    const code = region || $userRegion.get() || 'GP';
    return appliedOverrides[code] || null;
}

export function clearAppliedScheduleOverrides() {
    Object.keys(appliedOverrides).forEach((k) => { delete appliedOverrides[k]; });
}

export async function fetchScheduleOverride(force = false) {
    if (!force && cachedConfig && (Date.now() - loadedAt) < CACHE_TTL_MS) {
        return cachedConfig;
    }
    if (!force && loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const res = await fetch(`${DYNAMIC_BASE_URL}config/schedule_override.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!res.ok) {
                cachedConfig = null;
                clearAppliedScheduleOverrides();
            } else {
                const data = await res.json();
                cachedConfig = (data && typeof data === 'object' && !data.error) ? data : null;
                if (!cachedConfig?.regions) clearAppliedScheduleOverrides();
            }
        } catch {
            // Keep last known config on transient failures
        }
        loadedAt = Date.now();
        loadPromise = null;
        syncAppliedOverridesFromConfig();
        return cachedConfig;
    })();

    return loadPromise;
}

function syncAppliedOverridesFromConfig() {
    const regions = cachedConfig?.regions;
    if (!regions || typeof regions !== 'object') {
        clearAppliedScheduleOverrides();
        return;
    }
    Object.keys(appliedOverrides).forEach((code) => {
        const r = regions[code];
        if (!r?.active || !r.dayType) delete appliedOverrides[code];
        else if (appliedOverrides[code] !== r.dayType) delete appliedOverrides[code];
    });
}

function regionOverrideEntry(region) {
    const code = region || $userRegion.get() || 'GP';
    const r = cachedConfig?.regions?.[code];
    if (!r?.active || !r.dayType) return null;
    return { code, ...r };
}

function seenKeyFor(entry, rev) {
    return `seen_sched_override_${entry.code}_${rev}`;
}

/** Stable revision so title/body edits re-prompt even if timestamps are missing. */
function revisionFor(entry) {
    const stamp = cachedConfig?.updatedAt || entry?.updatedAt;
    if (stamp) return String(stamp);
    const s = `${entry?.dayType || ''}|${entry?.title || ''}|${entry?.body || ''}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    return `c${h}`;
}

/**
 * Apply admin override to a calendar-derived day type (after holiday resolution).
 */
export function resolveDayTypeWithOverride(baseDayType, region) {
    const entry = regionOverrideEntry(region);
    if (!entry) return baseDayType;
    const rev = revisionFor(entry);
    const seen = safeStorage.getItem(seenKeyFor(entry, rev)) === 'true';
    if (seen || appliedOverrides[entry.code]) {
        appliedOverrides[entry.code] = entry.dayType;
        return entry.dayType;
    }
    return baseDayType;
}

let promptInFlight = false;

/**
 * If override differs from the live (pre-override) day type, show modal once per revision.
 */
export async function maybePromptScheduleOverride(baseDayType) {
    if (typeof document === 'undefined' || promptInFlight) return false;
    const entry = regionOverrideEntry();
    if (!entry || !entry.dayType || entry.dayType === baseDayType) return false;

    const rev = revisionFor(entry);
    const seenKey = seenKeyFor(entry, rev);
    if (safeStorage.getItem(seenKey) === 'true') {
        appliedOverrides[entry.code] = entry.dayType;
        return false;
    }

    const modal = document.getElementById('schedule-override-modal');
    if (!modal) return false;
    if (document.body.classList.contains('modal-active')) {
        setTimeout(() => maybePromptScheduleOverride(baseDayType), 1200);
        return false;
    }

    promptInFlight = true;
    const titleEl = document.getElementById('schedule-override-title');
    const bodyEl = document.getElementById('schedule-override-body');
    const okBtn = document.getElementById('schedule-override-ok');
    if (titleEl) titleEl.textContent = entry.title?.trim() || 'Schedule update';
    if (bodyEl) {
        bodyEl.textContent = entry.body?.trim()
            || 'Your timetable has been switched to match the schedule type set by our team for your region.';
    }

    return new Promise((resolve) => {
        let settled = false;
        let observer = null;
        let unlockTimer = null;

        const finish = (applied) => {
            if (settled) return;
            settled = true;
            promptInFlight = false;
            if (unlockTimer) clearTimeout(unlockTimer);
            try { observer?.disconnect(); } catch { /* ignore */ }
            resolve(!!applied);
        };

        const applyAndClose = () => {
            try { safeStorage.setItem(seenKey, 'true'); } catch { /* ignore */ }
            appliedOverrides[entry.code] = entry.dayType;
            closeSmoothModal('schedule-override-modal');
            if (typeof window !== 'undefined' && typeof window.updateTime === 'function') {
                window.updateTime();
            }
            if (typeof window !== 'undefined' && typeof window.findNextTrains === 'function') {
                window.findNextTrains();
            }
            finish(true);
        };

        if (okBtn) okBtn.onclick = applyAndClose;

        try {
            observer = new MutationObserver(() => {
                if (modal.classList.contains('hidden')) finish(false);
            });
            observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
        } catch { /* ignore */ }

        unlockTimer = setTimeout(() => finish(false), PROMPT_UNLOCK_MS);

        try {
            openSmoothModal('schedule-override-modal');
        } catch {
            finish(false);
        }
    });
}

if (typeof window !== 'undefined') {
    window.fetchScheduleOverride = fetchScheduleOverride;
    window.maybePromptScheduleOverride = maybePromptScheduleOverride;
}
