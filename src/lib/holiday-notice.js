/**
 * Upcoming public-holiday notice — week preview once, plus a day-before reminder.
 * Stacks holidays using planner-style info cards.
 * Only shown after the app has stabilized (schedules up, no pending reload).
 *
 * Back-compat: existing seen_holiday_* keys still suppress re-shows for users who
 * already dismissed a notice (e.g. Women's Day week/eve). Approval gating is
 * enforced only from 11 Aug 2026 so Women's Day / Observed can finish on the
 * legacy path.
 */
import { SPECIAL_DATES, HOLIDAY_NAMES } from './config.js';
import { safeStorage, scheduleDayTypeLabel } from './utils.js';
import { openSmoothModal, closeSmoothModal } from './ui.js';
import { isReloadPending } from './session-stability.js';
import { $userRegion } from '../store.js';
import {
    loadHolidayApprovals,
    canShowHolidayNotice,
    resolveHolidayDayType,
} from './holiday-approvals.js';

/** Wait for boot/schedules before first show; then give up (never interrupt a busy boot). */
const HOLIDAY_STABILITY_MAX_WAIT_MS = 25000;
let holidayStabilityWaitStartedAt = 0;

const SEEN_WEEK_PREFIX = 'seen_holiday_week_';
const SEEN_EVE_PREFIX = 'seen_holiday_eve_';
const SEEN_DAY_PREFIX = 'seen_holiday_day_';

function pad2(n) {
    return String(n).padStart(2, '0');
}

function dateKeyFromDate(d) {
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function scheduleLabelForType(dayType) {
    return scheduleDayTypeLabel(dayType);
}

/**
 * Holidays from today through +6 days that still need a notice.
 * - Seen keys (week/eve/day) always win: already-dismissed users are never re-prompted.
 * - From 11 Aug 2026, caller must load approvals; unapproved holidays are omitted.
 */
export function getUpcomingUnseenHolidays(now = new Date()) {
    const year = now.getFullYear();
    const region = (typeof $userRegion?.get === 'function' ? $userRegion.get() : null) || 'GP';
    const out = [];
    for (let offset = 0; offset < 7; offset++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        const key = dateKeyFromDate(d);
        const name = HOLIDAY_NAMES?.[key];
        if (!name) continue;
        const y = d.getFullYear();
        const iso = `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        // Legacy path through Women's Day Observed; approval gate from 11 Aug 2026 (per region).
        if (!canShowHolidayNotice(iso, region, now)) continue;

        const dayType = resolveHolidayDayType(key, region, y) || SPECIAL_DATES?.[key] || 'public_holiday';

        let seenKey;
        let phase;
        if (offset === 0) {
            phase = 'day';
            seenKey = `${SEEN_DAY_PREFIX}${key}_${y}`;
        } else if (offset === 1) {
            // Eve replaces week for this holiday — mark week seen so it cannot also fire.
            phase = 'eve';
            seenKey = `${SEEN_EVE_PREFIX}${key}_${y}`;
            try { safeStorage.setItem(`${SEEN_WEEK_PREFIX}${key}_${y}`, 'true'); } catch { /* ignore */ }
        } else {
            phase = 'week';
            seenKey = `${SEEN_WEEK_PREFIX}${key}_${y}`;
        }

        // Back-compat: users who already tapped "Got it" keep their dismiss forever.
        if (safeStorage.getItem(seenKey) === 'true') continue;

        out.push({
            key,
            year: y,
            seenKey,
            phase,
            name,
            dayType,
            scheduleLabel: scheduleLabelForType(dayType),
            offset,
            whenLabel: offset === 0
                ? 'Today'
                : offset === 1
                    ? 'Tomorrow'
                    : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
            iso,
        });
    }
    return out.filter((h) => h.year === year || h.year === year + 1);
}

function ensureHolidayModal() {
    let modal = document.getElementById('holiday-notice-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'holiday-notice-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-[220] hidden flex items-center justify-center p-4 backdrop-blur-sm';
    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm max-h-[85vh] flex flex-col border border-amber-200 dark:border-amber-900/40 overflow-hidden">
            <div class="px-4 pt-4 pb-2 border-b border-gray-100 dark:border-gray-700 shrink-0">
                <p class="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">Public holiday notice</p>
                <h3 id="holiday-notice-title" class="text-lg font-black text-gray-900 dark:text-white tracking-tight mt-0.5">Coming up this week</h3>
            </div>
            <div id="holiday-notice-cards" class="p-4 space-y-3 overflow-y-auto custom-scrollbar"></div>
            <div class="p-4 pt-0 shrink-0">
                <button type="button" id="holiday-notice-close" class="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3 rounded-xl text-sm shadow-sm focus:outline-none">Got it</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
}

/**
 * Show stacked holiday cards if any unseen, approved holidays fall in the next week.
 * Call after welcome is done so it does not fight first-run UX.
 * Retries until `window._appStabilized` (or max wait), so it never races boot.
 */
export function maybeShowHolidayNotice() {
    try {
        if (typeof document === 'undefined') return false;
        const welcome = document.getElementById('welcome-modal');
        if (welcome && !welcome.classList.contains('hidden')) return false;
        if (safeStorage.getItem('welcomeSeen') !== 'true') return false;

        const stabilized = typeof window !== 'undefined' && !!window._appStabilized && !isReloadPending();
        if (!holidayStabilityWaitStartedAt) holidayStabilityWaitStartedAt = Date.now();
        const waitedTooLong = (Date.now() - holidayStabilityWaitStartedAt) >= HOLIDAY_STABILITY_MAX_WAIT_MS;

        if (!stabilized) {
            if (!waitedTooLong) setTimeout(() => maybeShowHolidayNotice(), 500);
            else holidayStabilityWaitStartedAt = 0;
            return false;
        }

        // Don't fight other overlays during settle (same wait clock as boot)
        if (document.body.classList.contains('modal-active')) {
            if (!waitedTooLong) setTimeout(() => maybeShowHolidayNotice(), 800);
            else holidayStabilityWaitStartedAt = 0;
            return false;
        }
        holidayStabilityWaitStartedAt = 0;

        // Load approvals when enforcement is live; before 11 Aug this is a no-op cache.
        loadHolidayApprovals().then(() => {
            const holidays = getUpcomingUnseenHolidays();
            if (!holidays.length) return;

            const modal = ensureHolidayModal();
            const cards = document.getElementById('holiday-notice-cards');
            const title = document.getElementById('holiday-notice-title');
            if (!cards) return;

            const onlyEve = holidays.every((h) => h.phase === 'eve');
            const onlyDay = holidays.every((h) => h.phase === 'day');
            if (title) {
                if (onlyEve) title.textContent = 'Holiday tomorrow';
                else if (onlyDay) title.textContent = 'Public holiday today';
                else title.textContent = 'Coming up this week';
            }

            cards.innerHTML = holidays.map((h) => `
                <div class="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-900/20 p-3.5 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">${escapeSafe(h.whenLabel)}</p>
                    <p class="text-sm font-black text-gray-900 dark:text-white mt-0.5 leading-snug">${escapeSafe(h.name)}</p>
                    <p class="text-xs text-gray-600 dark:text-gray-300 mt-1.5 leading-relaxed">${escapeSafe(h.scheduleLabel)}</p>
                </div>`).join('');

            const closeBtn = document.getElementById('holiday-notice-close');
            const dismiss = () => {
                holidays.forEach((h) => {
                    try {
                        safeStorage.setItem(h.seenKey, 'true');
                        if (h.phase === 'eve') {
                            safeStorage.setItem(`${SEEN_WEEK_PREFIX}${h.key}_${h.year}`, 'true');
                        }
                    } catch { /* ignore */ }
                });
                closeSmoothModal('holiday-notice-modal');
            };
            if (closeBtn) closeBtn.onclick = dismiss;

            openSmoothModal('holiday-notice-modal');
        }).catch(() => { /* ignore */ });

        return true;
    } catch (e) {
        console.warn('Holiday notice failed', e);
        return false;
    }
}

function escapeSafe(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

if (typeof window !== 'undefined') {
    window.maybeShowHolidayNotice = maybeShowHolidayNotice;
}
