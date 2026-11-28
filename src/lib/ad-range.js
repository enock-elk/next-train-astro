/**
 * Ad revenue ranges for Live Telemetry.
 * All, then This month, then Last month, then each older month by name
 * back to May 2026. The current month stays labelled This month, so 1 December
 * moves November to Last month and adds the month before that by name.
 */

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export const AD_RANGE_FLOOR = { year: 2026, month: 5 };

function parts(todayIso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayIso || ''));
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function iso(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDay(year, month) {
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function adRevenueRangeChoices(todayIso) {
    const choices = [
        { id: 'all', label: 'All' },
        { id: 'month', label: 'This month' },
        { id: 'last', label: 'Last month' },
    ];
    const now = parts(todayIso);
    if (!now) return choices;
    let year = now.year;
    let month = now.month - 2;
    if (month < 1) {
        month += 12;
        year -= 1;
    }
    while (year > AD_RANGE_FLOOR.year || (year === AD_RANGE_FLOOR.year && month >= AD_RANGE_FLOOR.month)) {
        choices.push({
            id: `${year}-${String(month).padStart(2, '0')}`,
            label: `${MONTHS[month - 1]} ${year}`,
        });
        month -= 1;
        if (month < 1) {
            month = 12;
            year -= 1;
        }
    }
    return choices;
}

export function adRevenueRangeBounds(id, todayIso, firstHit = '') {
    const now = parts(todayIso);
    const end = now ? iso(now.year, now.month, now.day) : String(todayIso || '');
    if (id === 'all') {
        const start = /^\d{4}-\d{2}-\d{2}$/.test(String(firstHit || '')) ? String(firstHit) : '2026-01-01';
        return { start, end };
    }
    if (!now) return null;
    if (id === 'month') return { start: iso(now.year, now.month, 1), end };
    if (id === 'last') {
        const first = new Date(Date.UTC(now.year, now.month - 2, 1)).toISOString().slice(0, 10);
        const last = new Date(Date.UTC(now.year, now.month - 1, 0)).toISOString().slice(0, 10);
        return { start: first, end: last };
    }
    const named = /^(\d{4})-(\d{2})$/.exec(String(id || ''));
    if (!named) return null;
    const year = Number(named[1]);
    const month = Number(named[2]);
    if (month < 1 || month > 12) return null;
    return { start: iso(year, month, 1), end: lastDay(year, month) };
}
