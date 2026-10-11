/**
 * Private rider points — bronze → platinum labels, not a public game.
 * localStorage first; signed-in users also keep users/{uid}.marks for carry-over.
 *
 * Streaks count consecutive Metrorail service days (Monday to Saturday).
 * Sunday does not add to a streak and does not break one.
 */
import { DYNAMIC_BASE_URL, ROUTES } from './config.js';
import { safeStorage } from './utils.js';
import { bootFirebase } from './firebase-boot.js';

const STORAGE_KEY = 'ntRiderMarksV1';
const STORAGE_KEY_GUEST = 'ntRiderMarksV1:guest';

export function marksStorageKey(uid) {
    return uid ? `${STORAGE_KEY}:${uid}` : STORAGE_KEY_GUEST;
}
const PHOTO_PREF_KEY = 'ntShowPhotoInAlerts';
const MARKS_COMMUNITY_PREF_KEY = 'ntShowMarksInCommunity';

export const MARK_POINTS = {
    first_community_post: 5,
    community_message: 2,
    first_share_day: 2,
    join_confirm: 1,
    delay_report: 2,
    delay_confirm: 1,
    streak_3day: 5,
    streak_5day: 8,
};

export const MARK_TIERS = [
    { id: 'bronze', label: 'Bronze', min: 0 },
    { id: 'silver', label: 'Silver', min: 80 },
    { id: 'gold', label: 'Gold', min: 250 },
    { id: 'platinum', label: 'Platinum', min: 600 },
];

export const MARK_CATALOG = [
    {
        id: 'first_community_post',
        title: 'First community post',
        how: 'Post once in a route room.',
        points: MARK_POINTS.first_community_post,
        badge: true,
    },
    {
        id: 'community_message',
        title: 'Community message',
        how: 'Post or reply in a route room. Points once per service day.',
        points: MARK_POINTS.community_message,
        badge: false,
    },
    {
        id: 'first_share_day',
        title: 'Share your trip',
        how: 'Share live location on the map while on a train. Points once per service day.',
        points: MARK_POINTS.first_share_day,
        badge: true,
    },
    {
        id: 'join_confirm',
        title: 'Join a live trip',
        how: 'Confirm you are on a shared train. Points once per service day.',
        points: MARK_POINTS.join_confirm,
        badge: false,
    },
    {
        id: 'delay_report',
        title: 'Delay report',
        how: 'Send a status report for a train near its scheduled time. Points once per service day.',
        points: MARK_POINTS.delay_report,
        badge: true,
    },
    {
        id: 'delay_confirm',
        title: 'Report validation',
        how: 'Confirm another commuter’s delay report. Points once per service day.',
        points: MARK_POINTS.delay_confirm,
        badge: true,
    },
    {
        id: 'streak_3day',
        title: '3 service-day streak',
        how: 'Contribute on 3 Monday-to-Saturday days in a row. Sundays do not break the streak.',
        points: MARK_POINTS.streak_3day,
        badge: true,
    },
    {
        id: 'streak_5day',
        title: '5 service-day streak',
        how: 'Contribute on 5 Monday-to-Saturday days in a row. Sundays do not break the streak.',
        points: MARK_POINTS.streak_5day,
        badge: true,
        requires: ['streak_3day'],
    },
];

function emptyState() {
    return {
        points: 0,
        lastShareDay: '',
        shareStreak: 0,
        awarded: {},
        history: [],
        updatedAt: 0,
    };
}

function todayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Calendar day used in share/join/community award keys. */
export function contributionDayKey(d = new Date()) {
    return todayKey(d);
}

const CONTRIB_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `09 Oct 2026`. Accepts `YYYY-MM-DD` or a timestamp. */
export function formatContributionDate(dayOrAt) {
    let date;
    if (typeof dayOrAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dayOrAt)) {
        const [y, m, d] = dayOrAt.split('-').map(Number);
        date = new Date(y, m - 1, d);
    } else {
        date = new Date(dayOrAt);
    }
    if (Number.isNaN(date.getTime())) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    return `${dd} ${CONTRIB_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Trip length for the contribution sheet. Empty when we never stored a start. */
export function formatContributionDuration(detail) {
    const start = Number(detail?.startedAt) || 0;
    const end = Number(detail?.endedAt) || 0;
    if (start && !end) return 'Still on this trip';
    if (!start || !end || end < start) return '';
    const mins = Math.round((end - start) / 60000);
    if (mins < 1) return 'Under 1 min';
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    if (!rem) return hours === 1 ? '1 hr' : `${hours} hr`;
    return `${hours} hr ${rem} min`;
}

/** Metrorail service days: Monday (1) through Saturday (6). Sunday is 0. */
export function isServiceDay(d = new Date()) {
    const day = d.getDay();
    return day >= 1 && day <= 6;
}

function previousServiceDay(d = new Date()) {
    const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    while (!isServiceDay(prev)) {
        prev.setDate(prev.getDate() - 1);
    }
    return prev;
}

const HISTORY_LIMIT = 240;
const DETAIL_FIELDS = ['trainId', 'routeId', 'route', 'origin', 'destination', 'note', 'startedAt', 'endedAt'];
const STICKY_DETAIL = new Set(['origin', 'startedAt']);

function contributionRouteLabel(routeId) {
    const name = ROUTES[routeId]?.name || '';
    if (!name) return '';
    return String(name)
        .replace(/\s*<->\s*/g, ' - ')
        .replace(/\s*↔\s*/g, ' - ')
        .replace(/\s+[–—]\s+/g, ' - ')
        .trim();
}

function sanitizeDetail(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const field of DETAIL_FIELDS) {
        const value = raw[field];
        if (field === 'startedAt' || field === 'endedAt') {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0) out[field] = n;
            continue;
        }
        if (typeof value !== 'string') continue;
        const text = value.trim().slice(0, 140);
        if (text) out[field] = text;
    }
    if (!out.route && out.routeId) {
        const label = contributionRouteLabel(out.routeId);
        if (label) out.route = label;
    }
    return Object.keys(out).length ? out : null;
}

/** Later pings can fill the train. The first boarding station and start time stay. */
function mergeDetail(prev, next) {
    const older = sanitizeDetail(prev) || {};
    const newer = sanitizeDetail(next) || {};
    const merged = { ...older };
    for (const field of DETAIL_FIELDS) {
        if (newer[field] == null || newer[field] === '') continue;
        if (STICKY_DETAIL.has(field) && merged[field] != null && merged[field] !== '') continue;
        merged[field] = newer[field];
    }
    return Object.keys(merged).length ? merged : null;
}

function clampHistory(raw) {
    if (!Array.isArray(raw)) return [];
    const rows = [];
    for (const row of raw) {
        if (!row || typeof row !== 'object' || typeof row.action !== 'string') continue;
        const next = {
            action: String(row.action),
            points: Math.max(0, Number(row.points) || 0),
            at: Number(row.at) || 0,
            key: typeof row.key === 'string' ? row.key : '',
        };
        const detail = sanitizeDetail(row.detail);
        if (detail) next.detail = detail;
        rows.push(next);
    }
    const byKey = new Map();
    const noKey = [];
    for (const row of rows) {
        if (!row.key) {
            noKey.push(row);
            continue;
        }
        const prev = byKey.get(row.key);
        if (!prev) {
            byKey.set(row.key, row);
            continue;
        }
        const newer = (row.at || 0) >= (prev.at || 0) ? row : prev;
        const older = newer === row ? prev : row;
        const detail = mergeDetail(older.detail, newer.detail);
        const kept = { ...newer };
        if (detail) kept.detail = detail;
        else delete kept.detail;
        byKey.set(row.key, kept);
    }
    // One row per award key. The old 40-row cap left only recent trip shares.
    return [...byKey.values(), ...noKey]
        .sort((a, b) => (a.at || 0) - (b.at || 0))
        .slice(-HISTORY_LIMIT);
}

function clampState(raw) {
    const base = emptyState();
    if (!raw || typeof raw !== 'object') return base;
    const points = Math.max(0, Math.min(100000, Number(raw.points) || 0));
    const awarded = raw.awarded && typeof raw.awarded === 'object' ? { ...raw.awarded } : {};
    return {
        points,
        lastShareDay: typeof raw.lastShareDay === 'string' ? raw.lastShareDay : '',
        shareStreak: Math.max(0, Number(raw.shareStreak) || 0),
        awarded,
        history: clampHistory(raw.history),
        updatedAt: Number(raw.updatedAt) || 0,
    };
}

export function readMarks() {
    try {
        const uid = authUid();
        const key = marksStorageKey(uid);
        let raw = safeStorage.getItem(key);
        if (!raw && !uid) raw = safeStorage.getItem(STORAGE_KEY);
        return clampState(JSON.parse(raw || 'null'));
    } catch {
        return emptyState();
    }
}

function writeMarks(state) {
    const next = clampState({ ...state, updatedAt: Date.now() });
    const uid = authUid();
    safeStorage.setItem(marksStorageKey(uid), JSON.stringify(next));
    persistRemote(next);
    syncRiderMarksUi(next);
    return next;
}

/** Drop the previous account's local cache from the UI when the signed-in uid changes. */
export function switchMarksAccount(nextUid) {
    const uid = nextUid || null;
    try {
        const raw = safeStorage.getItem(marksStorageKey(uid));
        syncRiderMarksUi(clampState(JSON.parse(raw || 'null')));
    } catch {
        syncRiderMarksUi(emptyState());
    }
}

export function tierForPoints(points) {
    let tier = MARK_TIERS[0];
    for (const t of MARK_TIERS) {
        if ((points || 0) >= t.min) tier = t;
    }
    return tier;
}

export function nextTierForPoints(points) {
    const current = tierForPoints(points);
    const idx = MARK_TIERS.findIndex((t) => t.id === current.id);
    return MARK_TIERS[idx + 1] || null;
}

export function pointsWord(n) {
    return Number(n) === 1 ? 'point' : 'points';
}

export function marksLabel(state = readMarks()) {
    const tier = tierForPoints(state.points);
    return `${tier.label} · ${state.points} ${pointsWord(state.points)}`;
}

const MEDAL_FILL = {
    bronze: '#cd7f32',
    silver: '#c0c0c0',
    gold: '#e6b800',
    platinum: '#9aa4b2',
};

/** Compact medal for a community name row. */
export function medalSvg(tierId = 'bronze') {
    const fill = MEDAL_FILL[tierId] || MEDAL_FILL.bronze;
    return `<svg class="community-bubble-medal" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="${fill}" stroke="rgba(0,0,0,0.28)" stroke-width="1.1"/><path d="M8 4.15l1.05 2.14 2.36.34-1.7 1.66.4 2.35L8 9.55l-2.11 1.09.4-2.35-1.7-1.66 2.36-.34z" fill="#fff" opacity="0.95"/></svg>`;
}

/** Name-row brag: "77 [svg]". */
export function marksBubbleLabel(state = readMarks()) {
    return String(Number(state.points) || 0);
}

export function marksPublicSnapshot(state = readMarks()) {
    if (!showMarksInCommunity()) return null;
    const points = Number(state.points) || 0;
    return { points, tier: tierForPoints(points).id };
}

export function renderBubbleMarksHtml(stateOrSnap) {
    if (!stateOrSnap) return '';
    const points = Number(stateOrSnap.points);
    if (!Number.isFinite(points)) return '';
    const tierId = stateOrSnap.tier || tierForPoints(points).id;
    const label = marksBubbleLabel({ points });
    return `<span class="community-bubble-marks" aria-label="${escapeAttr(`${label} ${tierForPoints(points).label}`)}"><span>${escapeAttr(label)}</span> ${medalSvg(tierId)}</span>`;
}

function escapeAttr(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function catalogFor(action) {
    return MARK_CATALOG.find((c) => c.id === action) || null;
}

function pushHistory(state, action, points, key, detail) {
    const row = { action, points, at: Date.now(), key: key || '' };
    const clean = sanitizeDetail(detail);
    if (clean) row.detail = clean;
    const history = clampHistory([...(state.history || []), row]);
    return { ...state, history };
}

function applyDetail(state, key, detail) {
    const clean = sanitizeDetail(detail);
    if (!clean || !key) return state;
    let changed = false;
    const history = (state.history || []).map((row) => {
        if (row.key !== key) return row;
        const merged = mergeDetail(row.detail, clean);
        const before = JSON.stringify(row.detail || null);
        const after = JSON.stringify(merged);
        if (before === after) return row;
        changed = true;
        const next = { ...row };
        if (merged) next.detail = merged;
        else delete next.detail;
        return next;
    });
    if (!changed) return state;
    return { ...state, history };
}

/** Fill a share row after the trip ends. Does nothing when that award is not stored. */
export function rememberContributionDetail(key, detail) {
    const state = readMarks();
    const next = applyDetail(state, key, detail);
    if (next === state) return state;
    return writeMarks(next);
}

export function mergeMarksStates(a, b) {
    const left = clampState(a);
    const right = clampState(b);
    const awarded = { ...left.awarded, ...right.awarded };
    const newer = (right.updatedAt || 0) >= (left.updatedAt || 0) ? right : left;
    const history = clampHistory([...(left.history || []), ...(right.history || [])]);
    return clampState({
        points: Math.max(left.points, right.points),
        lastShareDay: newer.lastShareDay || left.lastShareDay || right.lastShareDay,
        shareStreak: Math.max(left.shareStreak, right.shareStreak),
        awarded,
        history,
        updatedAt: Math.max(left.updatedAt, right.updatedAt),
    });
}

function mergeStates(a, b) {
    return mergeMarksStates(a, b);
}

function authUid() {
    return safeStorage.getItem('authUid') || null;
}

async function persistRemote(state) {
    const uid = authUid();
    if (!uid || typeof window === 'undefined') return;
    try {
        if (!window.firebaseAuth) await bootFirebase();
        const user = window.firebaseAuth?.currentUser;
        if (!user || user.isAnonymous || user.uid !== uid) return;
        const token = window.firebaseGetIdToken
            ? await window.firebaseGetIdToken(user, false)
            : null;
        if (!token) return;
        await fetch(
            `${DYNAMIC_BASE_URL}users/${encodeURIComponent(uid)}/marks.json?auth=${encodeURIComponent(token)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state),
            }
        );
    } catch {
        /* local copy is enough */
    }
}

export async function hydrateRemoteMarks({ persist = false } = {}) {
    const uid = authUid();
    if (!uid || typeof window === 'undefined' || !navigator.onLine) {
        syncRiderMarksUi();
        return readMarks();
    }
    try {
        if (!window.firebaseAuth) await bootFirebase();
        const user = window.firebaseAuth?.currentUser;
        if (!user || user.isAnonymous || user.uid !== uid) {
            syncRiderMarksUi();
            return readMarks();
        }
        const token = window.firebaseGetIdToken
            ? await window.firebaseGetIdToken(user, false)
            : null;
        const url = `${DYNAMIC_BASE_URL}users/${encodeURIComponent(uid)}/marks.json${token ? `?auth=${encodeURIComponent(token)}` : ''}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
            if (persist) await persistRemote(readMarks());
            syncRiderMarksUi();
            return readMarks();
        }
        const remote = await res.json();
        if (!remote || typeof remote !== 'object') {
            if (persist) await persistRemote(readMarks());
            syncRiderMarksUi();
            return readMarks();
        }
        const merged = mergeStates(readMarks(), remote);
        safeStorage.setItem(marksStorageKey(uid), JSON.stringify(merged));
        const historyChanged = (merged.history || []).length !== (remote.history || []).length;
        if (persist || merged.points !== (remote.points || 0) || merged.updatedAt !== (remote.updatedAt || 0) || historyChanged) {
            await persistRemote(merged);
        }
        syncRiderMarksUi(merged);
        return merged;
    } catch {
        syncRiderMarksUi();
        return readMarks();
    }
}

/** Photo on public commuter surfaces is off until the rider opts in. */
export function showPhotoInAlerts() {
    return safeStorage.getItem(PHOTO_PREF_KEY) === '1';
}

/** Community level chip is on unless the rider turns it off. */
export function showMarksInCommunity() {
    return safeStorage.getItem(MARKS_COMMUNITY_PREF_KEY) !== '0';
}

export async function setShowPhotoInAlerts(on) {
    safeStorage.setItem(PHOTO_PREF_KEY, on ? '1' : '0');
    const uid = authUid();
    if (!uid || typeof window === 'undefined') return;
    try {
        if (!window.firebaseAuth) await bootFirebase();
        const user = window.firebaseAuth?.currentUser;
        if (!user || user.isAnonymous || user.uid !== uid || !window.firebaseDb) return;
        await window.firebaseDbUpdate(
            window.firebaseDbRef(window.firebaseDb, `users/${uid}/prefs`),
            { showPhotoInAlerts: !!on, updatedAt: Date.now() }
        );
    } catch {
        /* local pref is enough */
    }
}

export async function setShowMarksInCommunity(on) {
    safeStorage.setItem(MARKS_COMMUNITY_PREF_KEY, on ? '1' : '0');
    syncRiderMarksUi();
    const uid = authUid();
    if (!uid || typeof window === 'undefined') return;
    try {
        if (!window.firebaseAuth) await bootFirebase();
        const user = window.firebaseAuth?.currentUser;
        if (!user || user.isAnonymous || user.uid !== uid || !window.firebaseDb) return;
        await window.firebaseDbUpdate(
            window.firebaseDbRef(window.firebaseDb, `users/${uid}/prefs`),
            { showMarksInCommunity: !!on, updatedAt: Date.now() }
        );
    } catch {
        /* local pref is enough */
    }
}

function bumpServiceStreak(state, now = new Date()) {
    if (!isServiceDay(now)) {
        return { state, streak: state.shareStreak || 0, grew: false };
    }
    const today = todayKey(now);
    if (state.lastShareDay === today) {
        return { state, streak: state.shareStreak || 0, grew: false };
    }
    const prev = todayKey(previousServiceDay(now));
    const streak = state.lastShareDay === prev ? (state.shareStreak || 0) + 1 : 1;
    return {
        state: { ...state, lastShareDay: today, shareStreak: streak },
        streak,
        grew: true,
    };
}

function maybeAwardStreaks(state) {
    const streak = state.shareStreak || 0;
    let next = state;
    if (streak >= 3) {
        const r = awardMark('streak_3day', { key: 'badge:streak_3', _nested: true, state: next });
        next = r.state;
    }
    if (streak >= 5) {
        const r = awardMark('streak_5day', { key: 'badge:streak_5', _nested: true, state: next });
        next = r.state;
    }
    return next;
}

/**
 * @param {keyof typeof MARK_POINTS} action
 * @param {{ key?: string, _nested?: boolean, state?: object }} [opts]
 */
export function awardMark(action, opts = {}) {
    const pts = MARK_POINTS[action];
    const incoming = opts.state ? clampState(opts.state) : readMarks();
    if (!pts) {
        return {
            awarded: false, points: 0, added: 0, total: incoming.points,
            tier: tierForPoints(incoming.points), label: marksLabel(incoming), state: incoming,
        };
    }

    let state = incoming;
    const today = todayKey();
    const dedupe = opts.key || `${action}:${today}`;

    if (state.awarded[dedupe]) {
        const withDetail = opts.detail ? applyDetail(state, dedupe, opts.detail) : state;
        if (!opts._nested && withDetail !== state) state = writeMarks(withDetail);
        else state = withDetail;
        return {
            awarded: false, points: 0, added: 0, total: state.points,
            tier: tierForPoints(state.points), label: marksLabel(state), state,
        };
    }

    const countsAsServiceDay = action === 'first_share_day'
        || action === 'join_confirm'
        || action === 'delay_report'
        || action === 'first_community_post'
        || action === 'community_message'
        || action === 'delay_confirm';

    if (countsAsServiceDay && !opts._nested) {
        const bumped = bumpServiceStreak(state);
        state = bumped.state;
    }

    state = pushHistory({
        ...state,
        points: state.points + pts,
        awarded: { ...state.awarded, [dedupe]: true },
    }, action, pts, dedupe, opts.detail);

    if (!opts._nested) {
        state = maybeAwardStreaks(state);
        state = writeMarks(state);
    }

    return {
        awarded: true,
        points: pts,
        added: pts,
        total: state.points,
        tier: tierForPoints(state.points),
        label: marksLabel(state),
        state,
    };
}

/** Post or reply: the one-time badge, then the same daily points as the other features. */
export function awardCommunityMarks(opts = {}) {
    const detail = opts.detail || null;
    const first = awardMark('first_community_post', { key: 'badge:first_community_post', detail });
    const daily = awardMark('community_message', { key: `community:${todayKey()}`, detail });
    const state = daily.state || first.state;
    return {
        awarded: !!(first.awarded || daily.awarded),
        added: (first.added || 0) + (daily.added || 0),
        label: marksLabel(state),
        total: state.points,
        tier: tierForPoints(state.points),
        state,
    };
}

export function awardShareMarks({ joinedLive = false, confirmedCloser = false, trainId = '', detail = null } = {}) {
    const shareDetail = { ...(detail || {}) };
    if (trainId && !shareDetail.trainId) shareDetail.trainId = trainId;
    const share = awardMark('first_share_day', { key: `share:${todayKey()}`, detail: shareDetail });
    let join = { awarded: false, state: share.state, label: share.label, total: share.total };
    if (joinedLive || confirmedCloser) {
        join = awardMark('join_confirm', { key: `join:${todayKey()}`, detail: shareDetail });
    }
    const state = join.state || share.state;
    return {
        awarded: share.awarded || join.awarded,
        added: (share.added || 0) + (join.added || 0),
        label: marksLabel(state),
        total: state.points,
        tier: tierForPoints(state.points),
        state,
    };
}

/** Thank-you card after an auto-stopped train share. */
export function showShareThanksOverlay({ points = 0 } = {}) {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('nt-share-thanks');
    if (!el) {
        el = document.createElement('div');
        el.id = 'nt-share-thanks';
        el.className = 'fixed inset-x-4 z-[140] hidden pointer-events-none';
        el.style.bottom = 'calc(5.5rem + env(safe-area-inset-bottom, 0px))';
        document.body.appendChild(el);
    }
    const pts = Math.max(0, Number(points) || 0);
    const pointsHtml = pts > 0
        ? `<p class="nt-share-thanks-points mt-1 text-[22px] font-black text-amber-600 dark:text-amber-300">+${pts} points</p>`
        : '';
    el.innerHTML = `
        <div class="rounded-2xl bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 shadow-xl px-4 py-3 text-center">
            <p class="text-[15px] font-bold text-gray-900 dark:text-white">Thanks for contributing</p>
            ${pointsHtml}
        </div>`;
    el.classList.remove('hidden');
    const pointsEl = el.querySelector('.nt-share-thanks-points');
    if (pointsEl) {
        pointsEl.style.transform = 'translateY(10px)';
        pointsEl.style.opacity = '0';
        requestAnimationFrame(() => {
            pointsEl.style.transition = 'transform 420ms ease, opacity 420ms ease';
            pointsEl.style.transform = 'translateY(0)';
            pointsEl.style.opacity = '1';
        });
    }
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

export function listContributions(state = readMarks()) {
    const rows = [...(state.history || [])].reverse();
    return rows.map((row) => {
        const cat = catalogFor(row.action);
        return {
            ...row,
            title: cat?.title || row.action,
            points: row.points,
        };
    });
}

const AWARD_KEY_RULES = [
    { re: /^share:(\d{4}-\d{2}-\d{2})$/, action: 'first_share_day' },
    { re: /^join:(\d{4}-\d{2}-\d{2})$/, action: 'join_confirm' },
    { re: /^community:(\d{4}-\d{2}-\d{2})$/, action: 'community_message' },
    { re: /^badge:first_community_post$/, action: 'first_community_post' },
    { re: /^badge:streak_3$/, action: 'streak_3day' },
    { re: /^badge:streak_5$/, action: 'streak_5day' },
];

function awardKeyParts(key) {
    const text = String(key || '');
    for (const rule of AWARD_KEY_RULES) {
        const match = text.match(rule.re);
        if (match) return { action: rule.action, day: match[1] || '' };
    }
    const split = text.match(/^([a-z0-9_]+):(\d{4}-\d{2}-\d{2})$/);
    if (split && MARK_POINTS[split[1]]) return { action: split[1], day: split[2] };
    if (MARK_POINTS[text]) return { action: text, day: '' };
    return null;
}

function dayAtFromKey(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return 0;
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

export function listContributionDays(state = readMarks(), { limit = 12 } = {}) {
    const groups = new Map();
    const seenKeys = new Set();
    const seenActions = new Set();
    const ensure = (day, at) => {
        let group = groups.get(day);
        if (!group) {
            group = { day, at: at || dayAtFromKey(day), total: 0, items: [] };
            groups.set(day, group);
        }
        if ((at || 0) > (group.at || 0)) group.at = at;
        return group;
    };
    const pushItem = (group, item) => {
        const existing = group.items.find((row) => row.action === item.action);
        if (existing) {
            existing.points += Number(item.points) || 0;
            const detail = mergeDetail(existing.detail, item.detail);
            if (detail) existing.detail = detail;
            if (!existing.key && item.key) existing.key = item.key;
            return;
        }
        const next = { ...item };
        if (!next.detail) delete next.detail;
        group.items.push(next);
    };
    for (const row of state.history || []) {
        if (!row?.at) continue;
        const day = todayKey(new Date(row.at));
        const cat = catalogFor(row.action);
        const group = ensure(day, row.at || 0);
        if (row.key) seenKeys.add(row.key);
        seenActions.add(row.action);
        group.total += Number(row.points) || 0;
        pushItem(group, {
            action: row.action,
            title: cat?.title || row.action,
            points: Number(row.points) || 0,
            key: row.key || '',
            detail: sanitizeDetail(row.detail),
            how: cat?.how || '',
        });
    }
    const awarded = state.awarded && typeof state.awarded === 'object' ? state.awarded : {};
    for (const key of Object.keys(awarded)) {
        if (!awarded[key] || seenKeys.has(key)) continue;
        const parts = awardKeyParts(key);
        if (!parts) continue;
        if (!parts.day && seenActions.has(parts.action)) continue;
        const cat = catalogFor(parts.action);
        const points = MARK_POINTS[parts.action] || 0;
        if (!points) continue;
        const group = ensure(parts.day || '', dayAtFromKey(parts.day));
        if (group.items.some((item) => item.action === parts.action)) continue;
        group.total += points;
        pushItem(group, {
            action: parts.action,
            title: cat?.title || parts.action,
            points,
            key,
            detail: null,
            how: cat?.how || '',
        });
        seenKeys.add(key);
        seenActions.add(parts.action);
    }
    return [...groups.values()]
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, limit);
}

export function badgeProgress(action, state = readMarks()) {
    const streak = Number(state.shareStreak) || 0;
    if (action === 'streak_3day') {
        return {
            current: Math.min(streak, 3),
            total: 3,
            ratio: Math.min(1, streak / 3),
            unlocked: badgeUnlocked(action, state),
        };
    }
    if (action === 'streak_5day') {
        return {
            current: Math.min(streak, 5),
            total: 5,
            ratio: Math.min(1, streak / 5),
            unlocked: badgeUnlocked(action, state),
        };
    }
    const unlocked = badgeUnlocked(action, state);
    return {
        current: unlocked ? 1 : 0,
        total: 1,
        ratio: unlocked ? 1 : 0,
        unlocked,
    };
}

export function paintCommunityMarksChip(state = readMarks()) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('community-marks-chip');
    if (!el) return;
    // Title chip is leftover chrome. Points live on named message bubbles.
    el.textContent = '';
    el.classList.add('hidden');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    void state;
}

export function badgeUnlocked(action, state = readMarks()) {
    if (!action) return false;
    return Object.keys(state.awarded || {}).some((k) => k === action || k.startsWith(`${action}:`) || k.includes(action));
}

export function syncRiderMarksUi(state = readMarks()) {
    if (typeof document === 'undefined') return;
    const label = marksLabel(state);
    const signedIn = typeof window !== 'undefined' && window.$account?.get?.()?.status === 'signed-in';
    document.querySelectorAll('[data-rider-marks]').forEach((el) => {
        el.textContent = label;
        if (el.id === 'settings-account-points') {
            el.classList.toggle('hidden', !signedIn);
            return;
        }
        el.classList.remove('hidden');
    });
    if (typeof window !== 'undefined' && typeof window.paintAccountPoints === 'function') {
        window.paintAccountPoints(state);
    }
    paintCommunityMarksChip(state);
}

if (typeof window !== 'undefined') {
    window.awardMark = awardMark;
    window.syncRiderMarksUi = syncRiderMarksUi;
    window.showPhotoInAlerts = showPhotoInAlerts;
}
