/**
 * Private rider marks — bronze → platinum labels, not a public game.
 * localStorage first; signed-in users also keep users/{uid}.marks for carry-over.
 */
import { DYNAMIC_BASE_URL } from './config.js';
import { safeStorage } from './utils.js';
import { bootFirebase } from './firebase-boot.js';

const STORAGE_KEY = 'ntRiderMarksV1';

export const MARK_POINTS = {
    first_share_day: 5,
    join_confirm: 3,
    delay_confirm: 2,
    streak_3day: 8,
};

export const MARK_TIERS = [
    { id: 'bronze', label: 'Bronze', min: 0 },
    { id: 'silver', label: 'Silver', min: 30 },
    { id: 'gold', label: 'Gold', min: 100 },
    { id: 'platinum', label: 'Platinum', min: 250 },
];

function emptyState() {
    return {
        points: 0,
        lastShareDay: '',
        shareStreak: 0,
        awarded: {},
        updatedAt: 0,
    };
}

function todayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function yesterdayKey(d = new Date()) {
    const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    return todayKey(prev);
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

export function marksLabel(state = readMarks()) {
    const tier = tierForPoints(state.points);
    return `${tier.label} · ${state.points} mark${state.points === 1 ? '' : 's'}`;
}

function mergeStates(a, b) {
    const left = clampState(a);
    const right = clampState(b);
    const awarded = { ...left.awarded, ...right.awarded };
    const newer = (right.updatedAt || 0) >= (left.updatedAt || 0) ? right : left;
    return clampState({
        points: Math.max(left.points, right.points),
        lastShareDay: newer.lastShareDay || left.lastShareDay || right.lastShareDay,
        shareStreak: Math.max(left.shareStreak, right.shareStreak),
        awarded,
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

/**
 * @param {'first_share_day'|'join_confirm'|'delay_confirm'|'streak_3day'} action
 * @param {{ key?: string }} [opts]  dedupe key (train/day)
 * @returns {{ awarded: boolean, points: number, added: number, total: number, tier: object, label: string, state: object }}
 */
export function awardMark(action, opts = {}) {
    const pts = MARK_POINTS[action];
    if (!pts) {
        const state = readMarks();
        return { awarded: false, points: 0, added: 0, total: state.points, tier: tierForPoints(state.points), label: marksLabel(state), state };
    }

    let state = readMarks();
    const today = todayKey();
    const dedupe = opts.key || `${action}:${today}`;

    if (action === 'first_share_day') {
        if (state.lastShareDay === today || state.awarded[dedupe]) {
            return { awarded: false, points: 0, added: 0, total: state.points, tier: tierForPoints(state.points), label: marksLabel(state), state };
        }
        const streak = state.lastShareDay === yesterdayKey() ? (state.shareStreak || 0) + 1 : 1;
        state = {
            ...state,
            points: state.points + pts,
            lastShareDay: today,
            shareStreak: streak,
            awarded: { ...state.awarded, [dedupe]: true },
        };
        state = writeMarks(state);
        if (streak > 0 && streak % 3 === 0) {
            const streakAward = awardMark('streak_3day', { key: `streak:${today}:${streak}` });
            state = streakAward.state;
        }
        return {
            awarded: true,
            points: pts,
            added: state.points - (state.points - pts),
            total: state.points,
            tier: tierForPoints(state.points),
            label: marksLabel(state),
            state,
        };
    }

    if (state.awarded[dedupe]) {
        return { awarded: false, points: 0, added: 0, total: state.points, tier: tierForPoints(state.points), label: marksLabel(state), state };
    }

    state = writeMarks({
        ...state,
        points: state.points + pts,
        awarded: { ...state.awarded, [dedupe]: true },
    });
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

export function syncRiderMarksUi(state = readMarks()) {
    if (typeof document === 'undefined') return;
    const label = marksLabel(state);
    document.querySelectorAll('[data-rider-marks]').forEach((el) => {
        el.textContent = label;
        el.classList.remove('hidden');
    });
}

if (typeof window !== 'undefined') {
    window.awardMark = awardMark;
    window.syncRiderMarksUi = syncRiderMarksUi;
}
