/**
 * Operator-only build notes. Not shown in commuter What’s New.
 * Keyed by APP_VERSION (V9_MM.DD.n). Older chips fall back to CHANGELOG_DATA.
 */
import { CHANGELOG_DATA } from './config.js';

export const ADMIN_CHANGELOG = {
    'V9_09.12.10': [
        'Export version is out of flow (top-right overlay). Footer height is the two paired rows only. Type sizes unchanged.',
        'Export NOTE copy is vertically centered (table-cell, html2canvas-safe).',
    ],
    'V9_09.12.9': [
        'See Next Available Day updates the day dropdown to the presented results (Saturday click → Weekday).',
        'Export footer: version top-right, GENERATED balances NextTrain.co.za, PRASA / Metrorail balances the unofficial line. Date has no weekday.',
        'No scheduled trains matches You are here (no card chrome, calendar SVG). Track Occupation sits beside See Monday Schedule.',
        'Grid Column Order tile title uses the same muted uppercase as other Dev Hub home tiles.',
    ],
    'V9_09.12.8': [
        'Two-station cuts include both named stations. TRAIN TERMINATES is the last safe stop before the first affected station (Pretoria→Kempton Park → Irene, not Olifantsfontein).',
        'Tap TRAIN TERMINATES to open the Line Severed modal. Marker look is unchanged.',
        'Result banner SVG is higher-right. Details is far bottom-right, below the icon.',
        'Departed · Show Next Train is blue again.',
    ],
    'V9_09.12.7': [
        'Trip map paints LINE SEVERED only when this itinerary contacts the danger zone (Pretoria–Rissik no longer inherits Olifantsfontein–Kempton Park).',
        'TRAIN TERMINATES at first contact is restored (origin injection was double-called).',
        'Live-share marker is two merged ovals that rotate with the rail; number stays upright.',
        'Target Route closed preview is the name only. Setting chips stay in the open list.',
        'Export grids use lighter cell borders. Footer left column has a quiet APP_VERSION.',
        'Departed + Show Next Train is one muted enclosed button.',
    ],
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
    'V9_09.10.9': [
        'Map train oval is longer, shows the train number, and a faint ring pulses around it.',
        'PNG export NO SVC is stacked text (no SVG slash).',
        'Alert posters keep loading until the image is ready. Clicks before then do not open the lightbox.',
        'Live sharing admin groups start/stop into one expandable session. Deploy RTDB rules so session PATCH is allowed.',
        'Crash shield ignores extension noise (xbrowser/swbrowser), empty Uncaught, SVG className, and missing .at. Planner zoom guard is defined. Store hydrate uses safeStorage.',
    ],
    'V9_09.10.10': [
        'Feedback thread wallpaper is darker than the white commuter bubbles.',
        'Feedback Options can grant experimental features per device (Add to beta) and search that device trip plans on demand.',
        'Community presence totals unique people across lab and production (host-scoped sessions).',
        'Hercules-Koedoespoort no longer follows the Daspoort spur past Hercules.',
        'Build notes open from feedback version chips and fall back to What’s New copy.',
    ],
    'V9_09.10.11': [
        'Live train fixes require trusted rail within 100 m and stay inside the scheduled journey.',
        'Tracking pauses at the last accepted location on stale, offline, reverse, or off-track fixes. The map never simulates movement.',
        'Train markers are numbered circles with direction and detailed tracking metrics. Next Train sharing dots and pulses are removed.',
        'Community language safety shares one multilingual classifier between the client and Worker. Held posts and replies can be approved or rejected.',
        'Community Monitor groups route conversations by latest activity with a separate unread cursor for each operator.',
        'Sign-in provider availability is controlled from System Controls. Facebook defaults unavailable; Google and email remain enabled.',
    ],
};

function stripHtml(html) {
    return String(html || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

export function versionSortKey(v) {
    const m = String(v || '').match(/^V(\d+)_(\d+)\.(\d+)(?:\.(\d+))?/i);
    if (!m) return 0;
    return ((((Number(m[1]) * 100) + Number(m[2])) * 100 + Number(m[3])) * 100) + Number(m[4] || 0);
}

export function lookupAdminChangelog(version) {
    const key = String(version || '').split(' - ')[0].trim();
    if (!key) return null;
    const notes = ADMIN_CHANGELOG[key];
    if (Array.isArray(notes) && notes.length) return notes;
    const row = CHANGELOG_DATA.find((item) => item.id === key || item.version === key);
    if (!row) return null;
    const features = Array.isArray(row.features) ? row.features : [row.features];
    const cleaned = features.map(stripHtml).filter(Boolean);
    return cleaned.length ? cleaned : null;
}

export function listAdminChangelogVersions() {
    const keys = new Set([
        ...Object.keys(ADMIN_CHANGELOG),
        ...CHANGELOG_DATA.map((item) => item.id).filter(Boolean),
    ]);
    return [...keys].sort((a, b) => versionSortKey(b) - versionSortKey(a));
}
