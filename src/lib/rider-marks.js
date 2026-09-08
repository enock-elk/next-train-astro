/**
 * Private rider points — bronze → platinum labels, not a public game.
 * localStorage first; signed-in users also keep users/{uid}.marks for carry-over.
 *
 * Streaks count consecutive Metrorail service days (Monday to Saturday).
 * Sunday does not add to a streak and does not break one.
 */
import { DYNAMIC_BASE_URL } from './config.js';
import { safeStorage } from './utils.js';
import { bootFirebase } from './firebase-boot.js';

const STORAGE_KEY = 'ntRiderMarksV1';
const PHOTO_PREF_KEY = 'ntShowPhotoInAlerts';

export const MARK_POINTS = {
    first_community_post: 10,
    first_share_day: 5,
    join_confirm: 3,
    delay_report: 5,
    delay_confirm: 2,
    streak_3day: 8,
    streak_5day: 15,
};

export const MARK_TIERS = [
    { id: 'bronze', label: 'Bronze', min: 0 },
    { id: 'silver', label: 'Silver', min: 30 },
    { id: 'gold', label: 'Gold', min: 100 },
    { id: 'platinum', label: 'Platinum', min: 250 },
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
        id: 'first_share_day',
        title: 'Share your trip',
        how: 'Share live location on the map while on a train, once per service day.',
        points: MARK_POINTS.first_share_day,
        badge: true,
    },
    {
        id: 'join_confirm',
        title: 'Join a live trip',
        how: 'Confirm you are on a shared train.',
        points: MARK_POINTS.join_confirm,
        badge: false,
    },
    {
        id: 'delay_report',
        title: 'Delay report',
        how: 'Send a status report for a train near its scheduled time.',
        points: MARK_POINTS.delay_report,
        badge: true,
    },
    {
        id: 'delay_confirm',
        title: 'Report validation',
        how: 'Confirm another commuter’s delay report.',
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

function clampHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((row) => row && typeof row === 'object' && typeof row.action === 'string')
        .slice(-40)
        .map((row) => ({
            action: String(row.action),
            points: Math.max(0, Number(row.points) || 0),
            at: Number(row.at) || 0,
            key: typeof row.key === 'string' ? row.key : '',
        }));
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
        return clampState(JSON.parse(safeStorage.getItem(STORAGE_KEY) || 'null'));
    } catch {
        return emptyState();
    }
}

function writeMarks(state) {
    const next = clampState({ ...state, updatedAt: Date.now() });
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    persistRemote(next);
    syncRiderMarksUi(next);
    return next;
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

export function catalogFor(action) {
    return MARK_CATALOG.find((c) => c.id === action) || null;
}

function pushHistory(state, action, points, key) {
    const history = clampHistory([
        ...(state.history || []),
        { action, points, at: Date.now(), key: key || '' },
    ]);
    return { ...state, history };
}

function mergeStates(a, b) {
    const left = clampState(a);
    const right = clampState(b);
    const awarded = { ...left.awarded, ...right.awarded };
    const newer = (right.updatedAt || 0) >= (left.updatedAt || 0) ? right : left;
    const history = clampHistory([...(left.history || []), ...(right.history || [])]
        .sort((x, y) => (x.at || 0) - (y.at || 0)));
    return clampState({
        points: Math.max(left.points, right.points),
        lastShareDay: newer.lastShareDay || left.lastShareDay || right.lastShareDay,
        shareStreak: Math.max(left.shareStreak, right.shareStreak),
        awarded,
        history,
        updatedAt: Math.max(left.updatedAt, right.updatedAt),
    });
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

export async function hydrateRemoteMarks() {
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
            syncRiderMarksUi();
            return readMarks();
        }
        const remote = await res.json();
        if (!remote || typeof remote !== 'object') {
            syncRiderMarksUi();
            return readMarks();
        }
        const merged = mergeStates(readMarks(), remote);
        safeStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        if (merged.points !== (remote.points || 0) || merged.updatedAt !== (remote.updatedAt || 0)) {
            persistRemote(merged);
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
        return {
            awarded: false, points: 0, added: 0, total: state.points,
            tier: tierForPoints(state.points), label: marksLabel(state), state,
        };
    }

    const countsAsServiceDay = action === 'first_share_day'
        || action === 'delay_report'
        || action === 'first_community_post'
        || action === 'delay_confirm';

    if (countsAsServiceDay && !opts._nested) {
        const bumped = bumpServiceStreak(state);
        state = bumped.state;
    }

    state = pushHistory({
        ...state,
        points: state.points + pts,
        awarded: { ...state.awarded, [dedupe]: true },
    }, action, pts, dedupe);

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

export function awardShareMarks({ joinedLive = false, confirmedCloser = false, trainId = '' } = {}) {
    const share = awardMark('first_share_day', { key: `share:${todayKey()}` });
    let join = { awarded: false, state: share.state, label: share.label, total: share.total };
    if (joinedLive || confirmedCloser) {
        join = awardMark('join_confirm', { key: `join:${todayKey()}:${trainId || 'train'}` });
    }
    const state = join.state || share.state;
    return {
        awarded: share.awarded || join.awarded,
        label: marksLabel(state),
        total: state.points,
        tier: tierForPoints(state.points),
        state,
    };
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

export function badgeUnlocked(action, state = readMarks()) {
    if (!action) return false;
    return Object.keys(state.awarded || {}).some((k) => k === action || k.startsWith(`${action}:`) || k.includes(action));
}

export function syncRiderMarksUi(state = readMarks()) {
    if (typeof document === 'undefined') return;
    const label = marksLabel(state);
    document.querySelectorAll('[data-rider-marks]').forEach((el) => {
        el.textContent = label;
        el.classList.remove('hidden');
    });
    if (typeof window !== 'undefined' && typeof window.paintAccountPoints === 'function') {
        window.paintAccountPoints(state);
    }
}

if (typeof window !== 'undefined') {
    window.awardMark = awardMark;
    window.syncRiderMarksUi = syncRiderMarksUi;
    window.showPhotoInAlerts = showPhotoInAlerts;
}
