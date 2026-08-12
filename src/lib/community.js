/**
 * Phase 6 — Route community (v1 chronological feed)
 *
 * RTDB:
 *   route_community/{routeId}/posts/{postId}
 *   route_community/{routeId}/posts/{postId}/replies/{replyId}
 *   route_community/{routeId}/post_reactions/{postId}/{uid} = { emoji, at }
 *   moderation_queue/{reportId}
 *
 * Shadow-ban policy: rules reject writes; client still shows the author's
 * own post in a session overlay so they appear silenced without schema rewrites.
 */
import { APP_VERSION, COMMUNITY_WORKER_URL, DYNAMIC_BASE_URL, ROUTES } from './config.js';
import { safeStorage, escapeHTML } from './utils.js';
import { $currentRouteId, $userRegion, $deviceId } from '../store.js';
import { $account } from './account.js';
import { showToast, triggerHaptic, openSmoothModal } from './ui.js';
import { bootFirebase } from './firebase-boot.js';
import {
    isShadowBanned,
    isBlockedLocally,
    checkRateLimit,
    recordRateHit as recordTrustRateHit,
    checkContentSafety,
    rememberBody,
} from './trust.js';
import { joinCommunityPresence, leaveCommunityPresence, signalCommunityTyping } from './community-presence.js';
import { FEATURE_KEYS, fetchFeatures, isFeatureEnabled } from './features.js';

const BODY_MAX = 280;
/** Blaze cost control — plan: limitToLast(5–10). */
const FEED_LIMIT = 10;
/** Pilot freshness — hide / ignore posts older than 24h (Worker cron also wipes). */
const POST_TTL_MS = 24 * 60 * 60 * 1000;
const RATE_KEY = 'communityPostRateV1';
const AUTH_GLOBAL_MS = 30 * 60 * 1000;
const AUTH_GLOBAL_MAX = 8;
const AUTH_COOLDOWN_MS = 20 * 1000;

/** @type {(() => void) | null} */
let postsUnsub = null;
/** @type {string | null} */
let postsListenRouteId = null;
/** Skip full "Loading…" flash on realtime patches */
let feedSilentRepaint = false;

/** WhatsApp / Channels reaction set */
export const WA_REACTIONS = [
    { id: 'thumb', emoji: '👍' },
    { id: 'heart', emoji: '❤️' },
    { id: 'laugh', emoji: '😂' },
    { id: 'wow', emoji: '😮' },
    { id: 'sad', emoji: '😢' },
    { id: 'pray', emoji: '🙏' },
];

export const COMMUNITY_CATEGORIES = {
    general: { label: 'General', class: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300' },
    delay: { label: 'Delay', class: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' },
    safety: { label: 'Safety', class: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
    other: { label: 'Other', class: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
};

/** @type {string} */
let activeCategoryFilter = 'all';
/** @type {object[]} */
let cachedFeedPosts = [];
/** @type {Record<string, Record<string, { emoji: string, at: number }>>} postId → uid → reaction */
let cachedReactionsByPost = {};
/** Posts whose full reaction picker is open (legacy unused) */
const expandedReactionPosts = new Set();
/** Guest hint dismissed for current Community visit only */
let guestHintDismissedThisOpen = false;
let unreadPollTimer = null;
const UNREAD_SEEN_PREFIX = 'communityLastSeen_';
const UNREAD_POLL_MS = 60 * 1000;

/** @type {Record<string, object[]>} local-only posts for shadow-banned authors */
const localOverlayByRoute = {};

function getDeviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown';
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Professional corridor label: "A <-> B" → "A – B" */
export function formatRouteDisplayName(name) {
    if (!name) return '';
    return String(name)
        .replace(/\s*<->\s*/g, ' – ')
        .replace(/\s*↔\s*/g, ' – ')
        .trim();
}

export function checkCommunityRateLimit() {
    return checkRateLimit(RATE_KEY, {
        windowMs: AUTH_GLOBAL_MS,
        max: AUTH_GLOBAL_MAX,
        cooldownMs: AUTH_COOLDOWN_MS,
    });
}

function recordRateHit() {
    recordTrustRateHit(RATE_KEY, { windowMs: AUTH_GLOBAL_MS });
}

async function ensureAuthToken() {
    if (!window.firebaseAuth) await bootFirebase();
    if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
        try {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true);
        } catch {
            return '';
        }
    }
    return '';
}

async function authQuery() {
    const token = await ensureAuthToken();
    return token ? `?auth=${encodeURIComponent(token)}` : '';
}

export { isShadowBanned };

function relativeTime(ts) {
    const mins = Math.max(0, Math.round((Date.now() - (ts || Date.now())) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
}

function formatClock24(ts) {
    const d = new Date(ts || Date.now());
    if (Number.isNaN(d.getTime())) return '--:--';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDayDivider(ts) {
    const date = new Date(ts || Date.now());
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const msg = date.toDateString();
    if (msg === today.toDateString()) return 'Today';
    if (msg === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

const NAME_COLORS = ['#02a698', '#53bdeb', '#06cf9c', '#e742a4', '#a281f7', '#ff7b72', '#25d366', '#d97706'];

function nameColorFor(seed) {
    const s = String(seed || 'x');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    return NAME_COLORS[Math.abs(h) % NAME_COLORS.length];
}

function renderAvatarHtml(photoURL) {
    if (photoURL) {
        return `<span class="relative inline-flex w-8 h-8 shrink-0">
            <img src="${escapeHTML(photoURL)}" alt="" class="w-8 h-8 rounded-full object-cover bg-gray-200 dark:bg-gray-700" loading="lazy" onerror="this.classList.add('hidden');const f=this.parentElement.querySelector('.avatar-fallback');if(f)f.classList.remove('hidden');"/>
            <span class="avatar-fallback hidden absolute inset-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-base" aria-hidden="true">🙍</span>
        </span>`;
    }
    return `<span class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-base shrink-0" aria-hidden="true">🙍</span>`;
}

/** @type {{ postId: string, routeId: string, displayName: string, body: string } | null} */
let replyDraft = null;

function setReplyDraft(post, routeId) {
    if (!post?.postId) {
        clearReplyDraft();
        return;
    }
    replyDraft = {
        postId: post.postId,
        routeId: routeId || $currentRouteId.get(),
        displayName: post.displayName || 'Passenger',
        body: String(post.body || '').slice(0, 120),
    };
    const bar = document.getElementById('community-reply-bar');
    const nameEl = document.getElementById('community-reply-bar-name');
    const snipEl = document.getElementById('community-reply-bar-snippet');
    if (nameEl) nameEl.textContent = replyDraft.displayName;
    if (snipEl) snipEl.textContent = replyDraft.body;
    bar?.classList.remove('hidden');
    document.getElementById('community-composer')?.focus();
}

function clearReplyDraft() {
    replyDraft = null;
    document.getElementById('community-reply-bar')?.classList.add('hidden');
}

function findCachedPost(postId) {
    return cachedFeedPosts.find((p) => p.postId === postId) || null;
}

function postsVisibleFilter(list, myUid) {
    const cut = Date.now() - POST_TTL_MS;
    return (list || [])
        .filter((p) => p && typeof p === 'object' && p.body)
        .filter((p) => {
            if ((p.timestamp || 0) < cut) return false;
            if (p.hidden && p.uid !== myUid) return false;
            if (p.shadowOnly && p.uid !== myUid) return false;
            return true;
        })
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function mergeOverlayPosts(routeId, list) {
    const acct = $account.get();
    const myUid = acct.status === 'signed-in' ? acct.uid : null;
    const merged = [...list];
    const overlay = (localOverlayByRoute[routeId] || []).filter((p) => p.uid === myUid);
    const ids = new Set(merged.map((p) => p.postId));
    overlay.forEach((p) => {
        if (!ids.has(p.postId)) merged.push(p);
    });
    merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return merged;
}

function stopRealtimePosts() {
    if (typeof postsUnsub === 'function') {
        try { postsUnsub(); } catch { /* ignore */ }
    }
    postsUnsub = null;
    postsListenRouteId = null;
}

/**
 * Live RTDB feed when communityRealtime is enabled for this route.
 * Falls back to REST (fetchRoutePosts) when flag off or SDK unavailable.
 */
async function startRealtimePosts(routeId) {
    stopRealtimePosts();
    if (!routeId) return false;
    await fetchFeatures();
    if (!isFeatureEnabled(FEATURE_KEYS.COMMUNITY_REALTIME, routeId)) return false;

    await bootFirebase();
    if (!window.firebaseDb || !window.firebaseDbRef || !window.firebaseDbOnValue) return false;

    // Guests need anonymous auth for some SDK paths; posts node is public-read.
    if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
        try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
    }

    try {
        const baseRef = window.firebaseDbRef(
            window.firebaseDb,
            `route_community/${routeId}/posts`
        );
        const q = (window.firebaseDbQuery && window.firebaseDbOrderByChild && window.firebaseDbLimitToLast)
            ? window.firebaseDbQuery(
                baseRef,
                window.firebaseDbOrderByChild('timestamp'),
                window.firebaseDbLimitToLast(FEED_LIMIT)
            )
            : baseRef;

        postsListenRouteId = routeId;
        postsUnsub = window.firebaseDbOnValue(q, (snap) => {
            if (postsListenRouteId !== routeId) return;
            const data = snap?.val?.() || null;
            const acct = $account.get();
            const myUid = acct.status === 'signed-in' ? acct.uid : null;
            const list = data
                ? postsVisibleFilter(Object.values(data), myUid)
                : [];
            cachedFeedPosts = mergeOverlayPosts(routeId, list);
            feedSilentRepaint = true;
            applyFeedFilter(routeId);
            feedSilentRepaint = false;
            // Keep unread badge honest while room is open
            if (routeId === getPinnedRouteId() && safeStorage.getItem('activeTab') === 'community') {
                markCommunityRouteSeen(routeId);
            }
        }, (err) => {
            console.warn('Community realtime listener failed; falling back to REST', err);
            stopRealtimePosts();
            renderCommunityFeed(routeId, { forceRest: true });
        });
        return true;
    } catch (e) {
        console.warn('Community realtime start failed', e);
        stopRealtimePosts();
        return false;
    }
}

export async function fetchRoutePosts(routeId) {
    if (!routeId || !navigator.onLine) return [];
    try {
        const q = await authQuery();
        // Prefer ordered query; fall back to full route posts node
        let res = await fetch(
            `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts.json${q ? `${q}&` : '?'}orderBy="timestamp"&limitToLast=${FEED_LIMIT}`
        );
        if (!res.ok) {
            res = await fetch(`${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts.json${q}`);
        }
        if (!res.ok) return [];
        const data = await res.json();
        if (!data) return [];
        const acct = $account.get();
        const myUid = acct.status === 'signed-in' ? acct.uid : null;
        const list = postsVisibleFilter(Object.values(data), myUid);
        return mergeOverlayPosts(routeId, list);
    } catch {
        return [];
    }
}

export async function fetchReplies(routeId, postId) {
    if (!routeId || !postId) return [];
    try {
        const q = await authQuery();
        const res = await fetch(
            `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts/${encodeURIComponent(postId)}/replies.json${q}`
        );
        if (!res.ok) return [];
        const data = await res.json();
        if (!data) return [];
        const acct = $account.get();
        const myUid = acct.status === 'signed-in' ? acct.uid : null;
        return Object.values(data)
            .filter((r) => r && r.body && (!r.hidden || r.uid === myUid))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    } catch {
        return [];
    }
}

export async function submitCommunityPost(body, routeId = $currentRouteId.get()) {
    const text = (body || '').trim();
    const acct = $account.get();
    if (acct.status !== 'signed-in' || !acct.uid) {
        return { ok: false, message: 'Sign in to post in this route’s community.' };
    }
    if (!routeId) return { ok: false, message: 'Select a route first.' };
    if (!text || text.length < 2) return { ok: false, message: 'Write a short message.' };
    if (text.length > BODY_MAX) return { ok: false, message: `Max ${BODY_MAX} characters.` };
    if (!navigator.onLine) return { ok: false, message: 'You appear offline.' };

    if (isBlockedLocally(acct.uid)) {
        return { ok: false, message: 'Action not permitted.' };
    }

    const safety = checkContentSafety(text);
    if (!safety.ok) return safety;

    const limit = checkCommunityRateLimit();
    if (!limit.ok) return limit;

    const postId = newId('cp');
    const category = 'general';
    const payload = {
        postId,
        routeId,
        region: $userRegion.get() || 'GP',
        body: text,
        category: COMMUNITY_CATEGORIES[category] ? category : 'general',
        uid: acct.uid,
        displayName: acct.displayName || 'Passenger',
        photoURL: acct.photoURL || null,
        deviceId: getDeviceId(),
        timestamp: Date.now(),
        hidden: false,
        replyCount: 0,
        appVersion: APP_VERSION,
    };
    if (replyDraft?.postId) {
        payload.replyTo = {
            postId: replyDraft.postId,
            displayName: replyDraft.displayName,
            body: replyDraft.body,
        };
    }

    const banned = await isShadowBanned(acct.uid);
    if (banned) {
        // Policy: author still sees their own; others never get the write
        if (!localOverlayByRoute[routeId]) localOverlayByRoute[routeId] = [];
        localOverlayByRoute[routeId].push({ ...payload, shadowOnly: true });
        recordRateHit();
        rememberBody(text);
        return { ok: true, post: payload, shadowSilenced: true };
    }

    try {
        // Prefer Cloudflare write bouncer when configured (rate + sanitize + Admin write).
        if (COMMUNITY_WORKER_URL) {
            const token = await ensureAuthToken();
            if (!token) return { ok: false, message: 'Sign in to post in this route’s community.' };
            const res = await fetch(`${COMMUNITY_WORKER_URL}/community/post`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    ...payload,
                    region: $userRegion.get() || 'GP',
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 429) {
                return { ok: false, message: data.error || 'Slow down — try again shortly.' };
            }
            if (!res.ok || !data.ok) {
                if (res.status === 401 || res.status === 403 || data.shadowSilenced) {
                    if (!localOverlayByRoute[routeId]) localOverlayByRoute[routeId] = [];
                    localOverlayByRoute[routeId].push({ ...payload, shadowOnly: true });
                    recordRateHit();
                    return { ok: true, post: payload, shadowSilenced: true };
                }
                throw new Error(data.error || `Post failed (${res.status})`);
            }
            if (data.shadowSilenced) {
                if (!localOverlayByRoute[routeId]) localOverlayByRoute[routeId] = [];
                localOverlayByRoute[routeId].push({ ...(data.post || payload), shadowOnly: true });
                recordRateHit();
                rememberBody(text);
                return { ok: true, post: data.post || payload, shadowSilenced: true };
            }
            recordRateHit();
            rememberBody(text);
            return { ok: true, post: data.post || payload };
        }

        const q = await authQuery();
        const res = await fetch(
            `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts/${postId}.json${q}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
        if (!res.ok) {
            // Rules rejected (e.g. shadow ban server-side) — still show to author
            if (res.status === 401 || res.status === 403) {
                if (!localOverlayByRoute[routeId]) localOverlayByRoute[routeId] = [];
                localOverlayByRoute[routeId].push({ ...payload, shadowOnly: true });
                recordRateHit();
                return { ok: true, post: payload, shadowSilenced: true };
            }
            throw new Error(`Post failed (${res.status})`);
        }
        recordRateHit();
        rememberBody(text);
        return { ok: true, post: payload };
    } catch (e) {
        return { ok: false, message: e?.message || 'Could not post.' };
    }
}

export async function submitCommunityReply(postId, body, routeId = $currentRouteId.get()) {
    const text = (body || '').trim();
    const acct = $account.get();
    if (acct.status !== 'signed-in' || !acct.uid) {
        return { ok: false, message: 'Sign in to reply.' };
    }
    if (!routeId || !postId) return { ok: false, message: 'Missing post.' };
    if (!text || text.length < 1) return { ok: false, message: 'Write a reply.' };
    if (text.length > BODY_MAX) return { ok: false, message: `Max ${BODY_MAX} characters.` };

    if (isBlockedLocally(acct.uid)) {
        return { ok: false, message: 'Action not permitted.' };
    }
    const safety = checkContentSafety(text);
    if (!safety.ok) return safety;

    const limit = checkCommunityRateLimit();
    if (!limit.ok) return limit;

    const replyId = newId('cr');
    const payload = {
        replyId,
        postId,
        routeId,
        body: text,
        uid: acct.uid,
        displayName: acct.displayName || 'Passenger',
        deviceId: getDeviceId(),
        timestamp: Date.now(),
        hidden: false,
        appVersion: APP_VERSION,
    };

    const banned = await isShadowBanned(acct.uid);
    if (banned) {
        recordRateHit();
        rememberBody(text);
        return { ok: true, reply: payload, shadowSilenced: true };
    }

    try {
        const q = await authQuery();
        const res = await fetch(
            `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts/${encodeURIComponent(postId)}/replies/${replyId}.json${q}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                recordRateHit();
                rememberBody(text);
                return { ok: true, reply: payload, shadowSilenced: true };
            }
            throw new Error(`Reply failed (${res.status})`);
        }
        // Best-effort replyCount bump
        try {
            await fetch(
                `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts/${encodeURIComponent(postId)}/replyCount.json${q}`,
                { method: 'PUT', body: JSON.stringify((await fetchReplyCount(routeId, postId)) + 1) }
            );
        } catch { /* optional */ }
        recordRateHit();
        rememberBody(text);
        return { ok: true, reply: payload };
    } catch (e) {
        return { ok: false, message: e?.message || 'Could not reply.' };
    }
}

async function fetchReplyCount(routeId, postId) {
    try {
        const q = await authQuery();
        const res = await fetch(
            `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts/${encodeURIComponent(postId)}/replyCount.json${q}`
        );
        if (!res.ok) return 0;
        const n = await res.json();
        return typeof n === 'number' ? n : 0;
    } catch {
        return 0;
    }
}

/**
 * Report message or user → moderation_queue
 * @param {{ type: 'message'|'user', routeId: string, targetPostId?: string, targetReplyId?: string, targetUid?: string, snippet?: string }} opts
 */
export async function submitModerationReport(opts) {
    const acct = $account.get();
    const reportId = newId('mq');
    const payload = {
        reportId,
        type: opts.type || 'message',
        routeId: opts.routeId || $currentRouteId.get() || null,
        targetPostId: opts.targetPostId || null,
        targetReplyId: opts.targetReplyId || null,
        targetUid: opts.targetUid || null,
        snippet: (opts.snippet || '').slice(0, 160) || null,
        reportedByUid: acct.status === 'signed-in' ? acct.uid : null,
        reportedByDeviceId: getDeviceId(),
        timestamp: Date.now(),
        status: 'open',
        appVersion: APP_VERSION,
    };

    try {
        // Guests may need anonymous auth for write rules
        if (!window.firebaseAuth) await bootFirebase();
        if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
            try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
        }
        const q = await authQuery();
        const res = await fetch(`${DYNAMIC_BASE_URL}moderation_queue/${reportId}.json${q}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`Report failed (${res.status})`);
        return { ok: true, reportId };
    } catch (e) {
        return { ok: false, message: e?.message || 'Could not send report.' };
    }
}

function routeLabel(routeId) {
    return formatRouteDisplayName(ROUTES[routeId]?.name || routeId || 'Route');
}

export async function fetchPostReactions(routeId) {
    if (!routeId || !navigator.onLine) return {};
    try {
        const q = await authQuery();
        const res = await fetch(
            `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/post_reactions.json${q}`
        );
        if (!res.ok) return {};
        const data = await res.json();
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

/**
 * Toggle a WhatsApp-style reaction (one per user). Same emoji again removes it.
 * @param {string} routeId
 * @param {string} postId
 * @param {string} emojiId
 */
export async function togglePostReaction(routeId, postId, emojiId) {
    const acct = $account.get();
    if (acct.status !== 'signed-in' || !acct.uid) {
        return { ok: false, message: 'Sign in to react.', needsAuth: true };
    }
    if (!WA_REACTIONS.some((r) => r.id === emojiId)) {
        return { ok: false, message: 'Unknown reaction.' };
    }
    if (!routeId || !postId) return { ok: false, message: 'Missing post.' };
    if (!navigator.onLine) return { ok: false, message: 'You appear offline.' };

    const mine = cachedReactionsByPost[postId]?.[acct.uid];
    const removing = mine && mine.emoji === emojiId;

    try {
        const q = await authQuery();
        const url = `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/post_reactions/${encodeURIComponent(postId)}/${encodeURIComponent(acct.uid)}.json${q}`;
        const res = await fetch(url, {
            method: removing ? 'DELETE' : 'PUT',
            headers: removing ? undefined : { 'Content-Type': 'application/json' },
            body: removing ? undefined : JSON.stringify({ emoji: emojiId, at: Date.now() }),
        });
        if (!res.ok) throw new Error(`Reaction failed (${res.status})`);

        if (!cachedReactionsByPost[postId]) cachedReactionsByPost[postId] = {};
        if (removing) delete cachedReactionsByPost[postId][acct.uid];
        else cachedReactionsByPost[postId][acct.uid] = { emoji: emojiId, at: Date.now() };

        return { ok: true, removed: removing };
    } catch (e) {
        return { ok: false, message: e?.message || 'Could not react.' };
    }
}

function summarizeReactions(postId) {
    const byUid = cachedReactionsByPost[postId] || {};
    const counts = {};
    WA_REACTIONS.forEach((r) => { counts[r.id] = 0; });
    Object.values(byUid).forEach((entry) => {
        if (entry?.emoji && counts[entry.emoji] !== undefined) counts[entry.emoji] += 1;
    });
    const acct = $account.get();
    const myEmoji = acct.status === 'signed-in' ? byUid[acct.uid]?.emoji : null;
    return { counts, myEmoji };
}

function renderReactionSummary(postId, isOwn = false) {
    const { counts } = summarizeReactions(postId);
    const pills = WA_REACTIONS
        .filter((r) => (counts[r.id] || 0) > 0)
        .map((r) => `<span class="community-reaction-pill">${r.emoji}${counts[r.id] > 1 ? ` ${counts[r.id]}` : ''}</span>`)
        .join('');
    if (!pills) return '';
    return `<div class="community-reaction-pills ${isOwn ? 'ml-auto mr-1' : ''}" data-reactions-for="${escapeHTML(postId)}">${pills}</div>`;
}

function openReactionSheet(postId, routeId) {
    let sheet = document.getElementById('community-reaction-sheet');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'community-reaction-sheet';
        sheet.className = 'fixed inset-0 z-[145] hidden';
        sheet.innerHTML = `
            <div class="absolute inset-0 bg-black/50" data-reaction-scrim></div>
            <div class="absolute left-1/2 -translate-x-1/2 bottom-24 sm:bottom-28 w-[min(92vw,22rem)] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 px-3 py-3">
                <p class="text-[10px] font-bold uppercase tracking-widest text-gray-400 text-center mb-2">React</p>
                <div class="flex items-center justify-between gap-1" id="community-reaction-sheet-emojis"></div>
                <div class="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" class="community-sheet-reply py-2.5 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100">Reply</button>
                    <button type="button" class="community-sheet-report py-2.5 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">Report</button>
                </div>
            </div>`;
        document.body.appendChild(sheet);
        sheet.querySelector('[data-reaction-scrim]')?.addEventListener('click', () => sheet.classList.add('hidden'));
    }

    sheet.dataset.postId = postId;
    sheet.dataset.routeId = routeId;
    const { myEmoji } = summarizeReactions(postId);
    const row = sheet.querySelector('#community-reaction-sheet-emojis');
    if (row) {
        row.innerHTML = WA_REACTIONS.map((r) => `
            <button type="button" class="community-react-btn flex-1 h-11 text-xl rounded-xl ${myEmoji === r.id ? 'bg-blue-50 dark:bg-blue-900/40 ring-1 ring-blue-400' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}" data-post-id="${escapeHTML(postId)}" data-route="${escapeHTML(routeId)}" data-emoji="${r.id}" aria-label="React ${r.emoji}">${r.emoji}</button>
        `).join('');
    }
    sheet.classList.remove('hidden');
    triggerHaptic();
}

function closeReactionSheet() {
    document.getElementById('community-reaction-sheet')?.classList.add('hidden');
}

function renderPostCard(post, routeId) {
    const body = escapeHTML(post.body || '');
    const clock = formatClock24(post.timestamp);
    const postId = escapeHTML(post.postId || '');
    const uid = escapeHTML(post.uid || '');
    const acct = $account.get();
    const myUid = acct?.status === 'signed-in' ? (acct.uid || '') : '';
    const isOwn = !!(myUid && post.uid && post.uid === myUid);
    const photoURL = post.photoURL || (isOwn ? acct.photoURL : null) || '';
    const nameColor = nameColorFor(post.uid || post.displayName);
    const replyTo = post.replyTo && typeof post.replyTo === 'object' ? post.replyTo : null;
    const quoteHtml = replyTo
        ? `<div class="mb-1.5 rounded-lg px-2 py-1.5 text-left ${isOwn ? 'bg-black/10 dark:bg-black/20' : 'bg-gray-100 dark:bg-gray-900/60'} border-l-[3px]" style="border-left-color:${nameColorFor(replyTo.displayName || replyTo.postId)}">
             <p class="text-[11px] font-bold truncate" style="color:${nameColorFor(replyTo.displayName || replyTo.postId)}">${escapeHTML(replyTo.displayName || 'Passenger')}</p>
             <p class="text-[11px] opacity-80 truncate">${escapeHTML(String(replyTo.body || '').slice(0, 100))}</p>
           </div>`
        : '';

    const avatar = isOwn
        ? ''
        : `<div class="community-avatar">${renderAvatarHtml(photoURL)}</div>`;
    const bubbleCls = isOwn ? 'community-bubble community-bubble-own' : 'community-bubble community-bubble-other';
    // Always show who posted (commenter) — own messages labelled "You"
    const displayName = isOwn ? 'You' : (post.displayName || 'Passenger');
    const nameHtml = `<div class="community-bubble-name-row truncate" style="color:${isOwn ? 'inherit' : nameColor}">${escapeHTML(displayName)}</div>`;

    return `
      <div class="community-post-row ${isOwn ? 'justify-end' : 'justify-start gap-2'}" data-post-id="${postId}" data-route="${escapeHTML(routeId)}">
        <div class="community-swipe-hint" aria-hidden="true">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/></svg>
        </div>
        ${avatar}
        <div class="community-bubble-wrap">
          <article class="community-post min-w-0" data-post-id="${postId}" data-uid="${uid}" data-category="${escapeHTML(post.category || 'general')}">
            <div class="${bubbleCls} shadow-sm">
              ${nameHtml}
              <div class="community-bubble-body">
                ${quoteHtml}
                <div class="community-msg-text">${body}<span class="community-msg-time">${clock}</span></div>
              </div>
            </div>
            ${renderReactionSummary(post.postId || '', isOwn)}
          </article>
        </div>
      </div>`;
}

function paintCategoryFilters() {
    // Category chips removed from UI for now; keep no-op for later revive.
}

function applyFeedFilter(routeId) {
    const listEl = document.getElementById('community-feed-list');
    const emptyEl = document.getElementById('community-feed-empty');
    if (!listEl) return;
    const posts = cachedFeedPosts;

    if (!posts.length) {
        listEl.innerHTML = '';
        if (emptyEl) {
            emptyEl.classList.remove('hidden');
            emptyEl.innerHTML = `<p class="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">No posts on this line yet</p>
                   <p class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">Be the first to share a heads-up for fellow passengers. Keep it kind — this is a quiet feed, not a shouting match.</p>`;
        }
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    let html = '';
    let lastDate = '';
    posts.forEach((p) => {
        const dayKey = new Date(p.timestamp || 0).toDateString();
        if (dayKey && dayKey !== lastDate) {
            html += `<div class="flex justify-center w-full my-3">
                <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200/70 dark:bg-gray-800/70 px-3 py-1 rounded-full uppercase tracking-widest shadow-sm border border-gray-200 dark:border-gray-700">${escapeHTML(formatDayDivider(p.timestamp))}</span>
            </div>`;
            lastDate = dayKey;
        }
        html += renderPostCard(p, routeId);
    });
    listEl.innerHTML = html;
    wireCommunityChatGestures(listEl);
}

function wireCommunityChatGestures(listEl) {
    if (!listEl || listEl.dataset.gesturesBound === '1') {
        // Rebind after re-render: always attach to current rows via delegation once
    }
    if (listEl.dataset.gesturesBound === '1') return;
    listEl.dataset.gesturesBound = '1';

    let startX = 0;
    let startY = 0;
    let activeRow = null;
    let longTimer = null;
    let longFired = false;
    let moved = false;

    const clearLong = () => {
        if (longTimer) clearTimeout(longTimer);
        longTimer = null;
    };

    listEl.addEventListener('touchstart', (e) => {
        const row = e.target.closest?.('.community-post-row');
        if (!row || e.touches.length !== 1) return;
        activeRow = row;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        moved = false;
        longFired = false;
        clearLong();
        row.classList.add('is-pressing');
        longTimer = setTimeout(() => {
            longFired = true;
            const postId = row.getAttribute('data-post-id');
            const routeId = row.getAttribute('data-route');
            if (postId && routeId) openReactionSheet(postId, routeId);
        }, 480);
    }, { passive: true });

    listEl.addEventListener('touchmove', (e) => {
        if (!activeRow || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            moved = true;
            clearLong();
            activeRow.classList.remove('is-pressing');
        }
        // Swipe right to reply
        if (dx > 12 && Math.abs(dx) > Math.abs(dy)) {
            activeRow.classList.add('is-swiping');
            activeRow.classList.remove('is-pressing');
            const shift = Math.min(72, dx * 0.55);
            activeRow.dataset.swipeDx = String(shift);
            activeRow.style.transform = `translateX(${shift}px)`;
        }
    }, { passive: true });

    listEl.addEventListener('touchend', () => {
        clearLong();
        if (!activeRow) return;
        const row = activeRow;
        const dx = parseFloat(row.dataset.swipeDx || '0') || 0;
        row.classList.remove('is-swiping', 'is-pressing');
        row.style.transform = '';
        delete row.dataset.swipeDx;
        if (!longFired && dx >= 48) {
            const postId = row.getAttribute('data-post-id');
            const routeId = row.getAttribute('data-route');
            const post = findCachedPost(postId);
            if (post) {
                triggerHaptic();
                setReplyDraft(post, routeId);
            }
        }
        activeRow = null;
    });

    listEl.addEventListener('touchcancel', () => {
        clearLong();
        if (activeRow) {
            activeRow.classList.remove('is-swiping', 'is-pressing');
            activeRow.style.transform = '';
        }
        activeRow = null;
    });

    // Desktop: context menu / long-click alternate
    listEl.addEventListener('contextmenu', (e) => {
        const row = e.target.closest?.('.community-post-row');
        if (!row) return;
        e.preventDefault();
        row.classList.add('is-pressing');
        openReactionSheet(row.getAttribute('data-post-id'), row.getAttribute('data-route'));
        setTimeout(() => row.classList.remove('is-pressing'), 400);
    });
}

function getPinnedRouteId() {
    const region = $userRegion.get() || 'GP';
    return safeStorage.getItem('defaultRoute_' + region) || '';
}

function unreadSeenKey(routeId) {
    return UNREAD_SEEN_PREFIX + routeId;
}

function getLastSeen(routeId) {
    if (!routeId) return Date.now();
    const raw = safeStorage.getItem(unreadSeenKey(routeId));
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : 0;
}

export function markCommunityRouteSeen(routeId = getPinnedRouteId()) {
    if (!routeId) return;
    safeStorage.setItem(unreadSeenKey(routeId), String(Date.now()));
    paintCommunityUnreadBadge(0);
}

function paintCommunityUnreadBadge(count) {
    const labels = [document.getElementById('community-unread-badge'), document.getElementById('community-unread-badge-top')];
    const n = Math.max(0, Number(count) || 0);
    const text = n > 99 ? '99+' : String(n);
    labels.forEach((el) => {
        if (!el) return;
        if (n <= 0) {
            el.classList.add('hidden');
            el.textContent = '0';
        } else {
            el.classList.remove('hidden');
            el.textContent = text;
        }
    });
    const bottom = document.getElementById('bottom-nav-community');
    if (bottom) {
        bottom.setAttribute('aria-label', n > 0
            ? `Community — ${n} unread on pinned route`
            : 'Community — route feed');
    }
}

/**
 * Count unread posts on the user's pinned route (newer than last visit).
 */
export async function refreshCommunityUnreadBadge() {
    const routeId = getPinnedRouteId();
    if (!routeId || !ROUTES[routeId]) {
        paintCommunityUnreadBadge(0);
        return 0;
    }
    // While viewing that room, treat as read
    if (safeStorage.getItem('activeTab') === 'community') {
        const viewing = document.getElementById('community-route-select')?.value || $currentRouteId.get();
        if (viewing === routeId) {
            markCommunityRouteSeen(routeId);
            return 0;
        }
    }

    try {
        const raw = safeStorage.getItem(unreadSeenKey(routeId));
        if (!raw) {
            // First watch: seed last-seen so historic posts aren't all "unread"
            safeStorage.setItem(unreadSeenKey(routeId), String(Date.now()));
            paintCommunityUnreadBadge(0);
            return 0;
        }
        const posts = await fetchRoutePosts(routeId);
        const lastSeen = getLastSeen(routeId);
        const myUid = $account.get()?.uid || '';
        const unread = posts.filter((p) => {
            const ts = p.timestamp || 0;
            if (ts <= lastSeen) return false;
            if (myUid && p.uid === myUid) return false;
            return true;
        }).length;
        paintCommunityUnreadBadge(unread);
        return unread;
    } catch {
        return 0;
    }
}

export function startCommunityUnreadWatch() {
    if (typeof window === 'undefined' || window.__ntCommunityUnreadWatch) return;
    window.__ntCommunityUnreadWatch = true;
    refreshCommunityUnreadBadge();
    unreadPollTimer = setInterval(() => {
        if (document.hidden) return;
        refreshCommunityUnreadBadge();
    }, UNREAD_POLL_MS);
    window.addEventListener('focus', () => refreshCommunityUnreadBadge());
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshCommunityUnreadBadge();
    });
}

export async function renderCommunityFeed(routeId = $currentRouteId.get(), opts = {}) {
    const listEl = document.getElementById('community-feed-list');
    const emptyEl = document.getElementById('community-feed-empty');
    const titleEl = document.getElementById('community-route-title');
    if (!listEl) return;

    if (titleEl) titleEl.textContent = routeLabel(routeId);
    paintCategoryFilters();

    const forceRest = !!opts.forceRest;
    if (!feedSilentRepaint) {
        listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-8 animate-pulse">Loading feed…</p>`;
        if (emptyEl) emptyEl.classList.add('hidden');
    }

    // Prefer live listener when feature is on for this route
    if (!forceRest) {
        const live = await startRealtimePosts(routeId);
        if (live) {
            // Listener will paint; still fetch reactions once
            const reactionsMap = await fetchPostReactions(routeId);
            cachedReactionsByPost = reactionsMap && typeof reactionsMap === 'object' ? reactionsMap : {};
            if (!cachedFeedPosts.length) {
                // First paint may race before first onValue — soft REST seed
                const posts = await fetchRoutePosts(routeId);
                if (postsListenRouteId === routeId && posts.length && !cachedFeedPosts.length) {
                    cachedFeedPosts = posts;
                    applyFeedFilter(routeId);
                }
            } else {
                applyFeedFilter(routeId);
            }
            return;
        }
    }

    stopRealtimePosts();
    const [posts, reactionsMap] = await Promise.all([
        fetchRoutePosts(routeId),
        fetchPostReactions(routeId),
    ]);
    cachedFeedPosts = posts;
    cachedReactionsByPost = reactionsMap && typeof reactionsMap === 'object' ? reactionsMap : {};
    applyFeedFilter(routeId);
}

function syncCommunityRoutePicker(routeId) {
    const routeSel = document.getElementById('community-route-select');
    const display = document.getElementById('community-route-display');
    const list = document.getElementById('community-route-list');
    if (!routeSel) return;

    const region = $userRegion.get() || 'GP';
    const routes = Object.values(ROUTES).filter((r) => r.isActive && r.region === region && r.id !== 'special_event');
    let activeId = routeId || routeSel.value || $currentRouteId.get() || '';
    if (activeId && !routes.find((r) => r.id === activeId) && ROUTES[activeId]) {
        // keep foreign route at top of list for deep links
    }

    routeSel.innerHTML = routes.map((r) =>
        `<option value="${r.id}" ${r.id === activeId ? 'selected' : ''}>${escapeHTML(formatRouteDisplayName(r.name || r.id))}</option>`
    ).join('') || '<option value="">No routes</option>';

    if (activeId && !routes.find((r) => r.id === activeId) && ROUTES[activeId]) {
        routeSel.insertAdjacentHTML('afterbegin', `<option value="${activeId}" selected>${escapeHTML(formatRouteDisplayName(ROUTES[activeId].name))}</option>`);
    }
    if (!activeId && routes[0]) {
        activeId = routes[0].id;
        routeSel.value = activeId;
    } else if (activeId) {
        routeSel.value = activeId;
    }

    const label = formatRouteDisplayName(ROUTES[routeSel.value]?.name || routeSel.value || 'Select route');
    if (display) display.textContent = label;

    if (list) {
        const allRoutes = [...routes];
        if (activeId && !allRoutes.find((r) => r.id === activeId) && ROUTES[activeId]) {
            allRoutes.unshift(ROUTES[activeId]);
        }
        list.innerHTML = allRoutes.map((r) => {
            const selected = r.id === routeSel.value;
            return `<li role="option" data-route-id="${escapeHTML(r.id)}" aria-selected="${selected ? 'true' : 'false'}" class="px-3.5 py-3 text-sm font-bold cursor-pointer transition-colors border-b border-gray-100 dark:border-gray-700 last:border-0 ${
                selected
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
            }">${escapeHTML(formatRouteDisplayName(r.name || r.id))}</li>`;
        }).join('') || `<li class="px-3.5 py-3 text-sm text-gray-400">No routes</li>`;
    }
}

function setCommunityRouteListOpen(open) {
    const list = document.getElementById('community-route-list');
    const chevron = document.getElementById('community-route-chevron');
    const trigger = document.getElementById('community-route-trigger');
    if (!list) return;
    list.classList.toggle('hidden', !open);
    if (chevron) chevron.classList.toggle('rotate-180', open);
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}

const KIND_PLACEHOLDER = 'Please be kind and respectful.';

function syncComposerChrome(signed = $account.get().status === 'signed-in') {
    const composer = document.getElementById('community-composer');
    if (!composer) return;
    composer.disabled = !signed;
    if (!signed) {
        composer.placeholder = 'Sign in to post';
        return;
    }
    if (document.activeElement === composer) {
        composer.placeholder = '';
    } else {
        composer.placeholder = KIND_PLACEHOLDER;
    }
}

export function openRouteCommunity(opts = {}) {
    const routeId = opts.routeId || $currentRouteId.get() || '';
    const routeSel = document.getElementById('community-route-select');
    const guestHint = document.getElementById('community-guest-hint');
    const errEl = document.getElementById('community-error');
    const titleEl = document.getElementById('community-route-title');

    syncCommunityRoutePicker(routeId);

    // Always re-show guest hint when an unsigned user opens Community
    guestHintDismissedThisOpen = false;
    const signed = $account.get().status === 'signed-in';
    if (guestHint) guestHint.classList.toggle('hidden', signed);
    syncComposerChrome(signed);
    if (errEl) errEl.textContent = '';

    const activeRoute = routeSel?.value || routeId;
    if (titleEl) titleEl.textContent = routeLabel(activeRoute);

    // Ensure the Community view is showing (avoid re-entrancy loops)
    if (safeStorage.getItem('activeTab') !== 'community' && typeof window.switchTab === 'function') {
        window.switchTab('community');
        return;
    }

    triggerHaptic();
    renderCommunityFeed(activeRoute);
    joinCommunityPresence(activeRoute);
    if (activeRoute && activeRoute === getPinnedRouteId()) markCommunityRouteSeen(activeRoute);
    else refreshCommunityUnreadBadge();
}

export function leaveCommunityRoom() {
    stopRealtimePosts();
    leaveCommunityPresence();
}

/** Destroy chat listeners when the Community tab is not visible (Blaze control). */
function bindCommunityVisibilityTeardown() {
    if (typeof document === 'undefined' || window.__ntCommunityVisBound) return;
    window.__ntCommunityVisBound = true;
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopRealtimePosts();
            leaveCommunityPresence();
            return;
        }
        if (safeStorage.getItem('activeTab') === 'community') {
            const routeSel = document.getElementById('community-route-select');
            const rid = routeSel?.value || $currentRouteId.get();
            if (rid) {
                startRealtimePosts(rid);
                joinCommunityPresence(rid);
            }
        }
    });
}

async function handlePostSubmit() {
    const routeSel = document.getElementById('community-route-select');
    const composer = document.getElementById('community-composer');
    const errEl = document.getElementById('community-error');
    const btn = document.getElementById('community-post-btn');
    const routeId = routeSel?.value || $currentRouteId.get();
    const body = composer?.value || '';

    if (errEl) errEl.textContent = '';
    if (btn) btn.disabled = true;

    const result = await submitCommunityPost(body, routeId);
    if (!result.ok) {
        if (errEl) errEl.textContent = result.message;
        if (btn) btn.disabled = false;
        if (result.message?.includes('Sign in')) {
            setTimeout(() => openSmoothModal('account-modal'), 80);
        }
        return;
    }

    if (composer) {
        composer.value = '';
        composer.style.height = '';
    }
    clearReplyDraft();
    signalCommunityTyping(routeId, false);
    showToast('Posted to the route feed', 'success');
    // Realtime listener will refresh; REST fallback still re-renders
    if (!postsListenRouteId || postsListenRouteId !== routeId) {
        await renderCommunityFeed(routeId);
    }
    if (btn) btn.disabled = false;
}

async function expandReplies(postId, routeId, container) {
    container.classList.remove('hidden');
    container.innerHTML = `<p class="text-[10px] text-gray-400 py-1">Loading…</p>`;
    const replies = await fetchReplies(routeId, postId);
    const acct = $account.get();
    const signed = acct.status === 'signed-in';

    let html = replies.length
        ? replies.map((r) => `
            <div class="text-left">
              <p class="text-[10px] font-bold text-gray-600 dark:text-gray-300">${escapeHTML(r.displayName || 'Passenger')} · <span class="font-medium text-gray-400">${relativeTime(r.timestamp)}</span></p>
              <p class="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">${escapeHTML(r.body || '')}</p>
            </div>`).join('')
        : `<p class="text-[11px] text-gray-400">No replies yet.</p>`;

    html += `
      <div class="pt-2 flex gap-2 items-start">
        <input type="text" maxlength="${BODY_MAX}" class="community-reply-input flex-1 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="${signed ? 'Write a reply…' : 'Sign in to reply'}" ${signed ? '' : 'disabled'} data-post-id="${escapeHTML(postId)}" />
        <button type="button" class="community-reply-send shrink-0 px-2.5 py-2 rounded-lg bg-blue-600 text-white text-[10px] font-bold disabled:opacity-50" data-post-id="${escapeHTML(postId)}" data-route="${escapeHTML(routeId)}" ${signed ? '' : 'disabled'}>Reply</button>
      </div>`;
    container.innerHTML = html;
}

export function bindCommunityUi() {
    if (typeof document === 'undefined' || window.__ntCommunityBound) return;
    window.__ntCommunityBound = true;
    bindCommunityVisibilityTeardown();

    const open = (e) => {
        e?.preventDefault?.();
        if (typeof window.switchTab === 'function') window.switchTab('community');
        else openRouteCommunity({ routeId: $currentRouteId.get() });
    };

    document.getElementById('route-community-open-btn')?.addEventListener('click', open);
    document.getElementById('sidenav-community-btn')?.addEventListener('click', () => {
        triggerHaptic();
        if (typeof window.closeAppHub === 'function') window.closeAppHub(true);
        setTimeout(() => {
            if (typeof window.switchTab === 'function') window.switchTab('community');
            else openRouteCommunity({ routeId: $currentRouteId.get() });
        }, 50);
    });

    document.getElementById('community-post-btn')?.addEventListener('click', () => handlePostSubmit());
    document.getElementById('community-route-select')?.addEventListener('change', (e) => {
        const rid = e.target.value;
        const titleEl = document.getElementById('community-route-title');
        if (titleEl) titleEl.textContent = routeLabel(rid);
        const display = document.getElementById('community-route-display');
        if (display) display.textContent = routeLabel(rid);
        renderCommunityFeed(rid);
        joinCommunityPresence(rid);
        if (rid && rid === getPinnedRouteId()) markCommunityRouteSeen(rid);
        else refreshCommunityUnreadBadge();
    });
    document.getElementById('community-route-trigger')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = document.getElementById('community-route-list');
        const open = list?.classList.contains('hidden');
        setCommunityRouteListOpen(!!open);
    });
    document.getElementById('community-route-list')?.addEventListener('click', (e) => {
        const item = e.target.closest?.('[data-route-id]');
        if (!item) return;
        const rid = item.getAttribute('data-route-id');
        const routeSel = document.getElementById('community-route-select');
        if (routeSel && rid) {
            routeSel.value = rid;
            routeSel.dispatchEvent(new Event('change'));
        }
        setCommunityRouteListOpen(false);
        syncCommunityRoutePicker(rid);
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest?.('#community-route-dropdown')) {
            setCommunityRouteListOpen(false);
        }
    });
    document.getElementById('community-refresh-btn')?.addEventListener('click', () => {
        const rid = document.getElementById('community-route-select')?.value || $currentRouteId.get();
        renderCommunityFeed(rid);
    });
    document.getElementById('community-signin-cta')?.addEventListener('click', () => {
        openSmoothModal('account-modal');
    });
    document.getElementById('community-guest-hint-dismiss')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        guestHintDismissedThisOpen = true;
        document.getElementById('community-guest-hint')?.classList.add('hidden');
    });
    document.getElementById('community-reply-bar-clear')?.addEventListener('click', () => clearReplyDraft());

    startCommunityUnreadWatch();
    import('./community-presence.js').then((m) => m.bindCommunityPresenceInfo?.()).catch(() => {});

    // Category filter chips removed from UI for now.

    let typingTimer = null;
    const composerEl = document.getElementById('community-composer');
    composerEl?.addEventListener('focus', () => {
        if ($account.get().status === 'signed-in') composerEl.placeholder = '';
    });
    composerEl?.addEventListener('blur', () => {
        syncComposerChrome($account.get().status === 'signed-in');
    });
    composerEl?.addEventListener('input', () => {
        // Auto-grow with new lines (WhatsApp-style), capped
        composerEl.style.height = 'auto';
        const next = Math.min(Math.max(composerEl.scrollHeight, 52), 160);
        composerEl.style.height = `${next}px`;

        const rid = document.getElementById('community-route-select')?.value || $currentRouteId.get();
        signalCommunityTyping(rid, true);
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = setTimeout(() => signalCommunityTyping(rid, false), 2500);
    });

    // Refresh guest/composer chrome when account changes
    window.addEventListener('accountchange', () => {
        if (safeStorage.getItem('activeTab') !== 'community') return;
        openRouteCommunity({ routeId: document.getElementById('community-route-select')?.value || $currentRouteId.get() });
    });

    document.addEventListener('click', async (e) => {
        const t = e.target;

        const sheetReply = t.closest?.('.community-sheet-reply');
        if (sheetReply) {
            e.preventDefault();
            const sheet = document.getElementById('community-reaction-sheet');
            const postId = sheet?.dataset.postId;
            const routeId = sheet?.dataset.routeId;
            closeReactionSheet();
            const post = findCachedPost(postId);
            if (post) setReplyDraft(post, routeId);
            return;
        }

        const sheetReport = t.closest?.('.community-sheet-report');
        if (sheetReport) {
            e.preventDefault();
            const sheet = document.getElementById('community-reaction-sheet');
            const postId = sheet?.dataset.postId;
            const routeId = sheet?.dataset.routeId || document.getElementById('community-route-select')?.value || $currentRouteId.get();
            closeReactionSheet();
            const post = findCachedPost(postId);
            const result = await submitModerationReport({
                type: 'message',
                routeId,
                targetPostId: postId,
                targetUid: post?.uid,
                snippet: String(post?.body || '').slice(0, 80),
            });
            showToast(result.ok ? 'Thanks — report sent to moderation.' : (result.message || 'Report failed'), result.ok ? 'success' : 'error');
            return;
        }

        const reactBtn = t.closest?.('.community-react-btn');
        if (reactBtn) {
            e.preventDefault();
            triggerHaptic();
            const postId = reactBtn.getAttribute('data-post-id');
            const routeId = reactBtn.getAttribute('data-route');
            const emojiId = reactBtn.getAttribute('data-emoji');
            const result = await togglePostReaction(routeId, postId, emojiId);
            if (!result.ok) {
                if (result.needsAuth) {
                    showToast('Sign in to react', 'info');
                    setTimeout(() => openSmoothModal('account-modal'), 80);
                } else {
                    showToast(result.message || 'Could not react', 'error');
                }
                return;
            }
            closeReactionSheet();
            const rid = document.getElementById('community-route-select')?.value || routeId;
            applyFeedFilter(rid);
            return;
        }

        const send = t.closest?.('.community-reply-send');
        if (send) {
            e.preventDefault();
            const postId = send.getAttribute('data-post-id');
            const routeId = send.getAttribute('data-route');
            const input = document.querySelector(`.community-reply-input[data-post-id="${postId}"]`);
            const result = await submitCommunityReply(postId, input?.value || '', routeId);
            if (!result.ok) {
                showToast(result.message || 'Reply failed', 'error');
                return;
            }
            if (input) input.value = '';
            showToast('Reply posted', 'success');
            const box = document.querySelector(`.community-replies[data-replies-for="${postId}"]`);
            if (box) {
                box.dataset.loaded = '0';
                await expandReplies(postId, routeId, box);
                box.dataset.loaded = '1';
            }
        }
    });
}

if (typeof window !== 'undefined') {
    window.openRouteCommunity = openRouteCommunity;
    window.renderCommunityFeed = renderCommunityFeed;
    window.leaveCommunityRoom = leaveCommunityRoom;
}
