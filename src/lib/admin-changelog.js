/**
 * Operator-only build notes. Not shown in commuter What’s New.
 * Keyed by APP_VERSION (V9_MM.DD.n).
 */
export const ADMIN_CHANGELOG = {
    'V9_09.10.4': [
        'Commuter reports dock as an accordion under the board.',
        'Account points hydrate from users/{uid}/marks.',
    ],
    'V9_09.10.5': [
        'Expired Reports keeps same-day stale items.',
        'Map Stop sharing. Live sharing admin panel writes ride_share_log.',
    ],
    'V9_09.10.6': [
        'Map train glyphs scale with zoom. Share idle TTL is 30 minutes.',
        'Map popup Timetable opens the planner train sheet.',
    ],
    'V9_09.10.7': [
        'Check for Updates always restarts when online (clears SW / cache, then App updated toast).',
        'Live oval on rails; GPS pulse hidden while you share a train. Same-train pings averaged on-path.',
        'GPS vet enforced. Lab no longer skips path / speed / heading.',
        'Red live dots on train numbers and VIEW FULL TIMETABLE open the train sheet.',
        'System Health build notes. Account points merge on sign-in across devices.',
    ],
    'V9_09.10.8': [
        'NO SVC sits above the train number. The whole cancelled column opens the advisory.',
        'Full timetable waits for exclusions and keeps long-lived bans in local cache for offline.',
        'Downloaded PNG uses the older timetable type (bolder times, softer lines).',
    ],
};

export function lookupAdminChangelog(version) {
    const key = String(version || '').split(' - ')[0].trim();
    if (!key) return null;
    const notes = ADMIN_CHANGELOG[key];
    return Array.isArray(notes) && notes.length ? notes : null;
}
