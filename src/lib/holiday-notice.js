/**
 * Upcoming public-holiday notice — week preview once, plus a day-before reminder.
 * Stacks holidays using planner-style info cards.
 * Only shown after the app has stabilized (schedules up, no pending reload).
 */
import { SPECIAL_DATES, HOLIDAY_NAMES } from './config.js';
import { safeStorage } from './utils.js';
import { openSmoothModal, closeSmoothModal } from './ui.js';
import { isReloadPending } from './session-stability.js';

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
    if (dayType === 'sunday') return 'No Sunday service';
    if (dayType === 'saturday') return 'Saturday / public-holiday timetable';
    return 'Special schedule';
}

/**
 * Holidays from today through +6 days that still need a notice.
 * - Mid-week preview (2–6 days out): once via week key
 * - Day before (tomorrow): eve key wins — week preview never runs for that holiday
 * - Holiday day itself: once via day key
 */
export function getUpcomingUnseenHolidays(now = new Date()) {
    const year = now.getFullYear();
    const out = [];
    for (let offset = 0; offset < 7; offset++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        const key = dateKeyFromDate(d);
        const name = HOLIDAY_NAMES?.[key];
        if (!name) continue;
        const dayType = SPECIAL_DATES?.[key] || 'saturday';
        const y = d.getFullYear();

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
            iso: `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
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
 * Show stacked holiday cards if any unseen holidays fall in the next week.
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
        if (!stabilized) {
            if (!holidayStabilityWaitStartedAt) holidayStabilityWaitStartedAt = Date.now();
            if (Date.now() - holidayStabilityWaitStartedAt < HOLIDAY_STABILITY_MAX_WAIT_MS) {
                setTimeout(() => maybeShowHolidayNotice(), 500);
            }
            return false;
        }
        holidayStabilityWaitStartedAt = 0;

        // Don't fight other overlays during settle (cap retries via the same wait clock)
        if (document.body.classList.contains('modal-active')) {
            if (!holidayStabilityWaitStartedAt) holidayStabilityWaitStartedAt = Date.now();
            if (Date.now() - holidayStabilityWaitStartedAt < HOLIDAY_STABILITY_MAX_WAIT_MS) {
                setTimeout(() => maybeShowHolidayNotice(), 800);
            }
            return false;
        }

        const holidays = getUpcomingUnseenHolidays();
        if (!holidays.length) return false;

        const modal = ensureHolidayModal();
        const cards = document.getElementById('holiday-notice-cards');
        const title = document.getElementById('holiday-notice-title');
        if (!cards) return false;

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
                    // Eve dismissal also retires the week preview for that holiday.
                    if (h.phase === 'eve') {
                        safeStorage.setItem(`${SEEN_WEEK_PREFIX}${h.key}_${h.year}`, 'true');
                    }
                } catch { /* ignore */ }
            });
            closeSmoothModal('holiday-notice-modal');
        };
        if (closeBtn) closeBtn.onclick = dismiss;

        openSmoothModal('holiday-notice-modal');
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
        .replace(/"/g, '&quot;');
}

if (typeof window !== 'undefined') {
    window.maybeShowHolidayNotice = maybeShowHolidayNotice;
}
