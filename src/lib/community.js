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
import { APP_VERSION, COMMUNITY_WORKER_FALLBACK_URL, COMMUNITY_WORKER_URL, DYNAMIC_BASE_URL, REPLY_WORKER_URL, ROUTES } from './config.js';
import { formatAccountDisplayName } from './display-name.js';
import { safeStorage, escapeHTML, expandJhbLabel, applyFittedLabel } from './utils.js';
import { sanitizeCommunityPhotoUrl } from './community-photo.js';
import { pictureMarkup, profilePhotosOn, settleDeferredPictures } from './data-saver.js';
import { armGifPlayers } from './gif-play.js';
import { $currentRouteId, $userRegion, $deviceId } from '../store.js';
import { $account, offerNextTrainAccount } from './account.js';
import { isAdminAuthed } from './admin-chrome.js';
import { showToast, triggerHaptic } from './ui.js';
import { bootFirebase } from './firebase-boot.js';
import {
    isShadowBanned,
    isBlockedLocally,
    checkRateLimit,
    recordRateHit as recordTrustRateHit,
    checkContentSafety,
    rememberBody,
    queueAutoModeration,
    startRateLimitCountdown,
} from './trust.js';
import { joinCommunityPresence, leaveCommunityPresence, signalCommunityTyping } from './community-presence.js';
import { FEATURE_KEYS, fetchFeatures, isFeatureEnabled, isFeatureGranted, isListedCommunityRoute } from './features.js';
import {
    awardCommunityMarks,
    contributionDayKey,
    marksPublicSnapshot,
    readMarks,
    renderBubbleMarksHtml,
    showMarksInCommunity,
    showPhotoInAlerts,
} from './rider-marks.js';
import {
    COMMUNITY_ADMIN_BODY_MAX,
    COMMUNITY_ADMIN_IMAGE_MAX,
    COMMUNITY_BODY_MAX,
    COMMUNITY_BUCKET_DEPTH,
    DELETED_BY_ADMIN,
    DELETED_MESSAGE,
    isCommunityTombstone,
    sanitizeCommunityAttachments,
    sanitizeCommunityImageUrl,
    sanitizeCommunityLinkUrl,
} from './community-policy.js';

const BODY_MAX = COMMUNITY_BODY_MAX;
/** Phone listeners share this count. The database keeps older messages for Community Monitor. */
const FEED_LIMIT = COMMUNITY_BUCKET_DEPTH;
const RATE_KEY = 'communityPostRateV1';
const AUTH_GLOBAL_MS = 30 * 60 * 1000;
const AUTH_GLOBAL_MAX = 8;
const AUTH_COOLDOWN_MS = 20 * 1000;
/** Operator-raised cap from users/{uid}/communityAllowance. Default stays 8. */
let communitySendMax = AUTH_GLOBAL_MAX;

/** @type {(() => void) | null} */
let postsUnsub = null;
/** @type {string | null} */
let postsListenRouteId = null;
/** True once the live post listener has delivered a snapshot for the open room. */
let postsSnapSeen = false;
/** Resolves when that snapshot arrives, or false after a short wait. */
let postsReady = Promise.resolve(false);
/** @type {(() => void) | null} */
let reactionsUnsub = null;
/** @type {string | null} */
let reactionsListenRouteId = null;
/** @type {(() => void)[]} */
let reactionPostUnsubs = [];
let reactionPostKey = '';
let reactionsPollTimer = null;
let reactionPaintTimer = null;
let reactionsFetchedAt = 0;
let reactionsFetchedKey = '';
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
let quotaHintTimer = null;
const UNREAD_SEEN_PREFIX = 'communityLastSeen_';
const LAST_ROOM_PREFIX = 'communityLastRoom_';
const UNREAD_POLL_MS = 60 * 1000;
const UNREAD_AWAY_MS = 3 * 60 * 1000;
let unreadPolledAt = 0;
/** @type {Record<string, number>} */
let cachedUnreadByRoute = {};

/** @type {Record<string, object[]>} local-only posts for shadow-banned authors */
const localOverlayByRoute = {};
/** Operator-only composer extras. Image addresses, not file bytes. */
const adminImages = [];
let adminLinkUrl = '';

function communityWorkerBase() {
    return COMMUNITY_WORKER_URL || COMMUNITY_WORKER_FALLBACK_URL;
}

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
        max: communitySendMax,
        cooldownMs: AUTH_COOLDOWN_MS,
    });
}

/** Read a quiet per-account cap. Missing or unreadable stays at 8. */
export async function refreshCommunitySendMax() {
    const acct = $account.get();
    if (!acct?.uid || acct.status !== 'signed-in' || isAdminAuthed()) {
        communitySendMax = AUTH_GLOBAL_MAX;
        return communitySendMax;
    }
    try {
        const q = await authQuery();
        if (!q) return communitySendMax;
        const res = await fetch(
            `${DYNAMIC_BASE_URL}users/${encodeURIComponent(acct.uid)}/communityAllowance.json${q}`
        );
        if (!res.ok) return communitySendMax;
        const data = await res.json();
        const n = Number(data?.max);
        if (Number.isFinite(n) && n >= AUTH_GLOBAL_MAX && n <= 200) communitySendMax = Math.floor(n);
    } catch {
        /* keep the last cap */
    }
    return communitySendMax;
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

function communityPointsSnapshot() {
    return {
        snapshotPoints: Number(readMarks()?.points) || 0,
        dayKey: contributionDayKey(),
    };
}

/** One small public total after an accepted message. Skipped when the post worker already wrote it. */
async function publishAcceptedCommunityPoints(eventId) {
    if (!COMMUNITY_WORKER_URL || !eventId) return null;
    try {
        const token = await ensureAuthToken();
        if (!token) return null;
        const res = await fetch(`${COMMUNITY_WORKER_URL}/community/points`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ eventId, ...communityPointsSnapshot() }),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok && Number.isFinite(Number(data.points)) ? Number(data.points) : null;
    } catch {
        return null;
    }
}

async function authQuery() {
    const token = await ensureAuthToken();
    return token ? `?auth=${encodeURIComponent(token)}` : '';
}

function communityActivityPayload(payload, kind) {
    return {
        kind,
        postId: payload.postId,
        ...(kind === 'reply' ? { replyId: payload.replyId } : {}),
        uid: payload.uid,
        timestamp: payload.timestamp,
    };
}

async function writeCommunityActivity(routeId, messageId, payload, kind, q) {
    const res = await fetch(
        `${DYNAMIC_BASE_URL}community_activity/${encodeURIComponent(routeId)}/${encodeURIComponent(messageId)}.json${q}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(communityActivityPayload(payload, kind)),
        }
    );
    if (!res.ok) throw new Error(`Activity index failed (${res.status})`);
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

/** One colour per person for this reading of the log, including quotes. */
function authorColorKey(uid, displayName, postId) {
    const direct = String(uid || '').trim();
    if (direct) return direct;
    const id = String(postId || '').trim();
    if (id) {
        const quoted = findCachedPost(id);
        if (quoted?.uid) return String(quoted.uid);
    }
    const name = String(displayName || '').trim();
    if (name) {
        const match = (cachedFeedPosts || []).find((post) => post?.uid && String(post.displayName || '') === name);
        if (match?.uid) return String(match.uid);
        return name;
    }
    return id || 'x';
}

function communityNameFor(acct) {
    return acct?.displayName || formatAccountDisplayName(acct?.email ? String(acct.email).split('@')[0] : 'Passenger');
}

function avatarInitial(name) {
    const ch = Array.from(String(name || '').trim())[0] || '';
    if (!ch || !/^[\p{L}\p{N}]$/u.test(ch)) return '';
    return ch.toLocaleUpperCase();
}

function avatarInk(color) {
    return /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? String(color) : '#64748b';
}

/** Letter in this person's colour. A small disc when the name has no letter. No person emoji. */
function avatarMarkHtml(name, color) {
    const ink = avatarInk(color);
    const letter = avatarInitial(name);
    if (!letter) {
        return `<span class="community-avatar-mark" style="background:${ink}" aria-hidden="true"></span>`;
    }
    return `<span class="community-avatar-letter" style="color:${ink}">${escapeHTML(letter)}</span>`;
}

function renderAvatarHtml(photoURL, name, color) {
    const mark = avatarMarkHtml(name, color);
    const safePhoto = profilePhotosOn() ? sanitizeCommunityPhotoUrl(photoURL) : '';
    if (safePhoto) {
        return `<span class="relative inline-flex w-8 h-8 shrink-0">
            <img src="${escapeHTML(safePhoto)}" alt="" class="w-8 h-8 rounded-full object-cover bg-gray-200 dark:bg-gray-700" loading="lazy" onerror="this.classList.add('hidden');const f=this.parentElement.querySelector('.avatar-fallback');if(f)f.classList.remove('hidden');"/>
            <span class="avatar-fallback hidden absolute inset-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">${mark}</span>
        </span>`;
    }
    return `<span class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-base shrink-0">${mark}</span>`;
}

async function publicCommuterPhoto(acct) {
    try {
        const { showPhotoInAlerts } = await import('./rider-marks.js');
        return showPhotoInAlerts() ? (acct?.photoURL || null) : null;
    } catch {
        return null;
    }
}

/** @type {{ postId: string, routeId: string, displayName: string, body: string } | null} */
let replyDraft = null;

function getLastCommunityRoom() {
    const region = $userRegion.get() || 'GP';
    const id = safeStorage.getItem(LAST_ROOM_PREFIX + region) || '';
    return id && ROUTES[id] ? id : '';
}

function setLastCommunityRoom(routeId) {
    const region = $userRegion.get() || 'GP';
    if (!routeId || !ROUTES[routeId]) return;
    safeStorage.setItem(LAST_ROOM_PREFIX + region, routeId);
}

function syncReplyDraftForRoute(routeId) {
    if (replyDraft && routeId && replyDraft.routeId && replyDraft.routeId !== routeId) {
        clearReplyDraft();
    }
}

function setReplyDraft(post, routeId) {
    if (!post?.postId || isCommunityTombstone(post)) {
        clearReplyDraft();
        return;
    }
    replyDraft = {
        postId: post.postId,
        routeId: routeId || $currentRouteId.get(),
        uid: post.uid || '',
        displayName: post.displayName || 'Passenger',
        body: String(post.body || (communityImageUrls(post).length ? 'Photo' : '')).slice(0, 120),
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
    return (list || [])
        .filter((p) => p && typeof p === 'object' && (p.body || p.linkUrl || (Array.isArray(p.attachments) && p.attachments.length)))
        .filter((p) => {
            if (p.pendingReview) return false;
            if (p.hidden && p.uid !== myUid && !isCommunityTombstone(p)) return false;
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
    postsSnapSeen = false;
    postsReady = Promise.resolve(false);
    stopRealtimeReactions();
}

function stopReactionPostListeners() {
    reactionPostUnsubs.forEach((fn) => {
        try { fn(); } catch { /* already gone */ }
    });
    reactionPostUnsubs = [];
    reactionPostKey = '';
    if (reactionPaintTimer) {
        clearTimeout(reactionPaintTimer);
        reactionPaintTimer = null;
    }
}

function stopRealtimeReactions() {
    if (typeof reactionsUnsub === 'function') {
        try { reactionsUnsub(); } catch { /* ignore */ }
    }
    reactionsUnsub = null;
    reactionsListenRouteId = null;
    cachedReactionsByPost = {};
    stopReactionPostListeners();
    reactionsFetchedAt = 0;
    reactionsFetchedKey = '';
    if (reactionsPollTimer) {
        clearInterval(reactionsPollTimer);
        reactionsPollTimer = null;
    }
}

async function applyReactionsMap(routeId, reactionsMap) {
    cachedReactionsByPost = reactionsMap && typeof reactionsMap === 'object' ? reactionsMap : {};
    feedSilentRepaint = true;
    applyFeedFilter(routeId);
    feedSilentRepaint = false;
}

function startReactionsPoll(routeId) {
    if (reactionsPollTimer) clearInterval(reactionsPollTimer);
    const tick = async () => {
        if (document.hidden) return;
        if (safeStorage.getItem('activeTab') !== 'community') return;
        const viewing = document.getElementById('community-route-select')?.value || postsListenRouteId;
        if (viewing !== routeId) return;
        const map = await fetchPostReactions(routeId, cachedFeedPosts.map((p) => p.postId));
        await applyReactionsMap(routeId, map);
    };
    tick();
    reactionsPollTimer = setInterval(tick, 45000);
}

function scheduleReactionPaint(routeId) {
    if (reactionPaintTimer) return;
    reactionPaintTimer = setTimeout(() => {
        reactionPaintTimer = null;
        if (reactionsListenRouteId !== routeId) return;
        feedSilentRepaint = true;
        applyFeedFilter(routeId);
        feedSilentRepaint = false;
    }, 50);
}

/** One listener per visible post. The parent reactions node grows with the kept log. */
function syncVisibleReactionListeners(routeId) {
    const ids = [...new Set(cachedFeedPosts.map((p) => p.postId).filter(Boolean))].sort();
    const key = `${routeId}|${ids.join(',')}`;
    if (key === reactionPostKey && reactionPostUnsubs.length === ids.length) return;
    stopReactionPostListeners();
    reactionPostKey = key;
    if (!ids.length || !window.firebaseDb || !window.firebaseDbRef || !window.firebaseDbOnValue) return;
    ids.forEach((postId) => {
        const ref = window.firebaseDbRef(
            window.firebaseDb,
            `route_community/${routeId}/post_reactions/${postId}`
        );
        const unsub = window.firebaseDbOnValue(ref, (snap) => {
            if (reactionsListenRouteId !== routeId) return;
            const val = snap?.val?.() || null;
            if (val && typeof val === 'object') cachedReactionsByPost[postId] = val;
            else delete cachedReactionsByPost[postId];
            scheduleReactionPaint(routeId);
        }, () => { /* a missing post stays quiet */ });
        reactionPostUnsubs.push(unsub);
    });
}

/**
 * Live reactions for the posts on screen. Falls back to per-post REST
 * when the SDK is missing.
 */
async function startRealtimeReactions(routeId) {
    stopRealtimeReactions();
    if (!routeId) return false;
    await bootFirebase();
    if (window.firebaseDb && window.firebaseDbRef && window.firebaseDbOnValue) {
        reactionsListenRouteId = routeId;
        syncVisibleReactionListeners(routeId);
        return true;
    }
    startReactionsPoll(routeId);
    return false;
}

/**
 * Live RTDB feed when communityRealtime is enabled for this route.
 * Falls back to REST (fetchRoutePosts) when flag off or SDK unavailable.
 */
function communityRoomAllowed(routeId) {
    if (!routeId || !ROUTES[routeId]) return false;
    if (isAdminAuthed() || isFeatureGranted(FEATURE_KEYS.COMMUNITY_TAB)) return true;
    return isListedCommunityRoute(routeId);
}

async function startRealtimePosts(routeId) {
    stopRealtimePosts();
    if (!routeId) return false;
    await fetchFeatures();
    if (!communityRoomAllowed(routeId)) return false;
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
        postsSnapSeen = false;
        postsReady = new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 4000);
            postsUnsub = window.firebaseDbOnValue(q, (snap) => {
                postsSnapSeen = true;
                clearTimeout(timer);
                if (postsListenRouteId !== routeId) {
                    resolve(true);
                    return;
                }
                const data = snap?.val?.() || null;
                const acct = $account.get();
                const myUid = acct.status === 'signed-in' ? acct.uid : null;
                const list = data
                    ? postsVisibleFilter(Object.values(data), myUid)
                    : [];
                cachedFeedPosts = mergeOverlayPosts(routeId, list);
                if (reactionsListenRouteId === routeId) syncVisibleReactionListeners(routeId);
                feedSilentRepaint = true;
                applyFeedFilter(routeId);
                feedSilentRepaint = false;
                if (safeStorage.getItem('activeTab') === 'community') {
                    markCommunityRouteSeen(routeId, { silent: true });
                }
                resolve(true);
            }, (err) => {
                console.warn('Community realtime listener failed; falling back to REST', err);
                clearTimeout(timer);
                const hadSnapshot = postsSnapSeen;
                stopRealtimePosts();
                resolve(false);
                if (hadSnapshot) renderCommunityFeed(routeId, { forceRest: true });
            });
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
        const res = await fetch(
            `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts.json${q ? `${q}&` : '?'}orderBy="timestamp"&limitToLast=${FEED_LIMIT}`
        );
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
            .filter((r) => r && r.body && !r.pendingReview && (!r.hidden || r.uid === myUid))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    } catch {
        return [];
    }
}

function shouldFallbackCommunityWrite(res, data) {
    const err = String(data?.error || '');
    return (res && res.status >= 500)
        || /Admin env incomplete/i.test(err)
        || /FIREBASE_PRIVATE_KEY/i.test(err)
        || /Google auth failed/i.test(err);
}

function safeCommunityWriteError(message, status) {
    const text = String(message || '');
    if (/Admin env incomplete|FIREBASE_|Google auth|RTDB /i.test(text)) {
        return 'Could not post. Try again in a moment.';
    }
    return text || (status ? `Post failed (${status})` : 'Could not post.');
}

export async function deleteCommunityMessage({ routeId, postId, replyId = '', mode = 'tombstone', as = 'author' } = {}) {
    const token = await ensureAuthToken();
    if (!token) throw new Error('Sign in again to delete this message.');
    const res = await fetch(`${communityWorkerBase()}/community/message`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            op: 'delete',
            routeId,
            postId,
            replyId: replyId || undefined,
            mode: mode === 'purge' ? 'purge' : 'tombstone',
            as: as === 'author' ? 'author' : 'admin',
        }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 && isAdminAuthed()) {
        const { ensureAdminLoaded } = await import('./admin-bridge.js');
        const Admin = await ensureAdminLoaded();
        if (mode === 'purge') {
            if (!Admin?.deletePublishedCommunityMessage) throw new Error('Admin tools unavailable.');
            await Admin.deletePublishedCommunityMessage(routeId, postId, replyId || undefined);
        } else {
            if (!Admin?.tombstoneCommunityMessage) throw new Error('Admin tools unavailable.');
            await Admin.tombstoneCommunityMessage(routeId, postId, replyId || undefined);
        }
    } else if (!res.ok || data.ok === false) {
        throw new Error(data.error || 'Could not delete this message.');
    }
    if (replyId) return data;
    if (mode === 'purge') {
        cachedFeedPosts = cachedFeedPosts.filter((p) => String(p.postId) !== String(postId));
        if (localOverlayByRoute[routeId]) {
            localOverlayByRoute[routeId] = localOverlayByRoute[routeId].filter((p) => String(p.postId) !== String(postId));
        }
        delete cachedReactionsByPost[postId];
    } else {
        const label = as === 'admin' ? DELETED_BY_ADMIN : DELETED_MESSAGE;
        const actor = as === 'admin' ? 'admin' : 'author';
        cachedFeedPosts = cachedFeedPosts.map((p) => (
            String(p.postId) === String(postId)
                ? { ...p, body: label, deleted: true, deletedBy: actor, photoURL: null, attachments: null, linkUrl: null, replyTo: null }
                : p
        ));
    }
    applyFeedFilter(routeId);
    return data;
}

export async function submitCommunityPost(body, routeId = $currentRouteId.get()) {
    const text = (body || '').trim();
    const acct = $account.get();
    const operator = isAdminAuthed();
    const attachments = operator ? sanitizeCommunityAttachments(adminImages, { admin: true }) : [];
    const linkUrl = operator ? sanitizeCommunityLinkUrl(adminLinkUrl) : '';
    const textMax = operator ? COMMUNITY_ADMIN_BODY_MAX : BODY_MAX;
    if (acct.status !== 'signed-in' || !acct.uid) {
        return { ok: false, needsAuth: true };
    }
    if (acct.authProvider === 'password' && !acct.emailVerified) {
        return { ok: false, message: 'Verify your email before posting. Open Account and use the link we sent.' };
    }
    if (!routeId) return { ok: false, message: 'Select a route first.' };
    if ((!text || text.length < 2) && !attachments.length && !linkUrl) return { ok: false, message: 'Write a short message.' };
    if (text.length > textMax) return { ok: false, message: `Max ${textMax} characters.` };
    if (!navigator.onLine) return { ok: false, message: 'You appear offline.' };

    if (isBlockedLocally(acct.uid)) {
        return { ok: false, message: 'Action not permitted.' };
    }

    if (!operator) {
        await refreshCommunitySendMax();
        const limit = checkCommunityRateLimit();
        if (!limit.ok) return limit;
    }

    const replyToPayload = replyDraft?.postId && !isCommunityTombstone(findCachedPost(replyDraft.postId)) ? {
        replyTo: {
            postId: replyDraft.postId,
            ...(replyDraft.uid ? { uid: replyDraft.uid } : {}),
            displayName: replyDraft.displayName,
            body: replyDraft.body,
        },
    } : {};
    const safety = text ? checkContentSafety(text) : { verdict: 'allow' };
    if (!operator && safety.verdict === 'block') return { ok: false, message: safety.message, reason: safety.reason };
    if (operator && safety.verdict === 'block' && safety.reason !== 'url') {
        return { ok: false, message: safety.message, reason: safety.reason };
    }
    if (!operator && safety.verdict === 'review') {
        const held = await queueAutoModeration({
            source: 'community_post',
            reason: safety.reason,
            body: text,
            routeId,
            targetUid: acct.uid,
            publish: {
                kind: 'community_post',
                routeId,
                payload: {
                    postId: newId('cp'),
                    routeId,
                    region: $userRegion.get() || 'GP',
                    body: text,
                    category: 'general',
                    uid: acct.uid,
                    displayName: communityNameFor(acct),
                    photoURL: await publicCommuterPhoto(acct),
                    email: acct.email || null,
                    deviceId: getDeviceId(),
                    timestamp: Date.now(),
                    hidden: false,
                    replyCount: 0,
                    appVersion: APP_VERSION,
                    ...replyToPayload,
                },
            },
        });
        if (!held.ok) return { ok: false, message: held.message || 'Could not send for review.' };
        recordRateHit();
        rememberBody(text);
        return { ok: true, held: true, message: safety.message };
    }

    const postId = newId('cp');
    const category = 'general';
    const payload = {
        postId,
        routeId,
        region: $userRegion.get() || 'GP',
        body: text,
        category: COMMUNITY_CATEGORIES[category] ? category : 'general',
        uid: acct.uid,
        displayName: communityNameFor(acct),
        photoURL: await publicCommuterPhoto(acct),
        email: acct.email || null,
        deviceId: getDeviceId(),
        timestamp: Date.now(),
        hidden: false,
        replyCount: 0,
        appVersion: APP_VERSION,
        ...(attachments.length ? { attachments: attachments.map((url) => ({ kind: 'image', url })) } : {}),
        ...(linkUrl ? { linkUrl } : {}),
        ...replyToPayload,
    };

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
            if (!token) return { ok: false, needsAuth: true };
            const res = await fetch(`${COMMUNITY_WORKER_URL}/community/post`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    ...payload,
                    region: $userRegion.get() || 'GP',
                    ...communityPointsSnapshot(),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 429) {
                return {
                    ok: false,
                    message: data.error || 'Please wait before you can send another message.',
                    retryAfterMs: data.retryAfterMs || 20000,
                    reason: data.reason || 'cooldown',
                };
            }
            if (data.blocked) {
                return { ok: false, message: data.error || 'That message isn’t allowed.' };
            }
            if (data.held) {
                recordRateHit();
                rememberBody(text);
                return { ok: true, held: true, message: data.message || 'We’re checking this message.' };
            }
            if (res.ok && data.ok) {
                if (data.shadowSilenced) {
                    if (!localOverlayByRoute[routeId]) localOverlayByRoute[routeId] = [];
                    localOverlayByRoute[routeId].push({ ...(data.post || payload), shadowOnly: true });
                    recordRateHit();
                    rememberBody(text);
                    return { ok: true, post: data.post || payload, shadowSilenced: true };
                }
                recordRateHit();
                rememberBody(text);
                if (!Number.isFinite(Number(data.publicPoints))) {
                    await publishAcceptedCommunityPoints(postId);
                }
                return { ok: true, post: data.post || payload };
            }
            if (res.status === 401 || res.status === 403 || data.shadowSilenced) {
                if (!localOverlayByRoute[routeId]) localOverlayByRoute[routeId] = [];
                localOverlayByRoute[routeId].push({ ...payload, shadowOnly: true });
                recordRateHit();
                return { ok: true, post: payload, shadowSilenced: true };
            }
            if (!shouldFallbackCommunityWrite(res, data)) {
                throw new Error(safeCommunityWriteError(data.error, res.status));
            }
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
        // The message body remains authoritative. Indexing follows the accepted
        // write so rules can verify this user owns the published message.
        try {
            await writeCommunityActivity(routeId, postId, payload, 'post', q);
        } catch (e) {
            console.warn('Community activity indexing failed', e);
        }
        recordRateHit();
        rememberBody(text);
        await publishAcceptedCommunityPoints(postId);
        import('./account.js').then((m) => m.recordAccountActivity?.('community_post', { routeId })).catch(() => {});
        return { ok: true, post: payload };
    } catch (e) {
        return { ok: false, message: safeCommunityWriteError(e?.message) };
    }
}

export async function submitCommunityReply(postId, body, routeId = $currentRouteId.get()) {
    const text = (body || '').trim();
    const acct = $account.get();
    if (acct.status !== 'signed-in' || !acct.uid) {
        return { ok: false, needsAuth: true };
    }
    if (acct.authProvider === 'password' && !acct.emailVerified) {
        return { ok: false, message: 'Verify your email before replying. Open Account and use the link we sent.' };
    }
    if (!routeId || !postId) return { ok: false, message: 'Missing post.' };
    if (!text || text.length < 1) return { ok: false, message: 'Write a reply.' };
    if (text.length > BODY_MAX) return { ok: false, message: `Max ${BODY_MAX} characters.` };

    if (isBlockedLocally(acct.uid)) {
        return { ok: false, message: 'Action not permitted.' };
    }
    if (!isAdminAuthed()) {
        await refreshCommunitySendMax();
        const limit = checkCommunityRateLimit();
        if (!limit.ok) return limit;
    }

    const safety = checkContentSafety(text);
    if (safety.verdict === 'block') return { ok: false, message: safety.message, reason: safety.reason };
    if (safety.verdict === 'review') {
        const held = await queueAutoModeration({
            source: 'community_reply',
            reason: safety.reason,
            body: text,
            routeId,
            targetUid: acct.uid,
            publish: {
                kind: 'community_reply',
                routeId,
                postId,
                payload: {
                    replyId: newId('cr'),
                    postId,
                    routeId,
                    body: text,
                    uid: acct.uid,
                    displayName: communityNameFor(acct),
                    deviceId: getDeviceId(),
                    timestamp: Date.now(),
                    hidden: false,
                    appVersion: APP_VERSION,
                },
            },
        });
        if (!held.ok) return { ok: false, message: held.message || 'Could not send for review.' };
        recordRateHit();
        rememberBody(text);
        return { ok: true, held: true, message: safety.message };
    }

    const replyId = newId('cr');
    const payload = {
        replyId,
        postId,
        routeId,
        body: text,
        uid: acct.uid,
        displayName: communityNameFor(acct),
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
        try {
            await writeCommunityActivity(routeId, replyId, payload, 'reply', q);
        } catch (e) {
            console.warn('Community reply activity indexing failed', e);
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
        await publishAcceptedCommunityPoints(replyId);
        import('./account.js').then((m) => m.recordAccountActivity?.('community_reply', { routeId, postId })).catch(() => {});
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
        reportedByName: acct.status === 'signed-in' ? communityNameFor(acct) : null,
        reportedByEmail: acct.email || null,
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
    return formatRouteDisplayName(expandJhbLabel(ROUTES[routeId]?.name || routeId || 'Route'));
}

/** Johannesburg when the pill or open list can hold it on one line. */
function fitCommunityRouteLabels() {
    const display = document.getElementById('community-route-display');
    const routeSel = document.getElementById('community-route-select');
    const raw = ROUTES[routeSel?.value]?.name || '';
    if (display && raw) {
        applyFittedLabel(
            display,
            formatRouteDisplayName(raw),
            formatRouteDisplayName(expandJhbLabel(raw)),
            false
        );
    }
    document.querySelectorAll('#community-route-list [data-route-raw]').forEach((el) => {
        const name = el.getAttribute('data-route-raw') || '';
        if (!name) return;
        applyFittedLabel(
            el,
            formatRouteDisplayName(name),
            formatRouteDisplayName(expandJhbLabel(name)),
            false
        );
    });
}

export async function fetchPostReactions(routeId, postIds = null) {
    if (!routeId || !navigator.onLine) return {};
    const ids = (Array.isArray(postIds) && postIds.length
        ? postIds
        : cachedFeedPosts.map((p) => p.postId)
    ).filter(Boolean);
    if (!ids.length) return {};
    const cacheKey = `${routeId}|${ids.join(',')}`;
    if (reactionsFetchedKey === cacheKey && Date.now() - reactionsFetchedAt < 20000 && cachedReactionsByPost) {
        return cachedReactionsByPost;
    }
    try {
        const q = await authQuery();
        const pairs = await Promise.all(ids.map(async (postId) => {
            try {
                const r = await fetch(
                    `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/post_reactions/${encodeURIComponent(postId)}.json${q}`
                );
                if (!r.ok) return [postId, null];
                const data = await r.json();
                return [postId, data && typeof data === 'object' ? data : null];
            } catch {
                return [postId, null];
            }
        }));
        const out = {};
        pairs.forEach(([id, map]) => {
            if (map) out[id] = map;
        });
        reactionsFetchedKey = cacheKey;
        reactionsFetchedAt = Date.now();
        return out;
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
        return { ok: false, needsAuth: true };
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

function renderReactionSummary(postId, isOwn = false, routeId = '') {
    const { counts, myEmoji } = summarizeReactions(postId);
    const pills = WA_REACTIONS
        .filter((r) => (counts[r.id] || 0) > 0)
        .map((r) => {
            const label = `${r.emoji}${counts[r.id] > 1 ? ` ${counts[r.id]}` : ''}`;
            if (myEmoji === r.id) {
                return `<button type="button" class="community-reaction-pill community-react-btn" data-post-id="${escapeHTML(postId)}" data-route="${escapeHTML(routeId)}" data-emoji="${r.id}" aria-label="Remove reaction">${label}</button>`;
            }
            return `<span class="community-reaction-pill">${label}</span>`;
        })
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
                <div class="mt-3 grid grid-cols-2 gap-2" id="community-reaction-sheet-actions">
                    <button type="button" class="community-sheet-reply py-2.5 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100">Reply</button>
                    <button type="button" class="community-sheet-report py-2.5 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">Report</button>
                </div>
            </div>`;
        document.body.appendChild(sheet);
        sheet.querySelector('[data-reaction-scrim]')?.addEventListener('click', () => sheet.classList.add('hidden'));
    }

    sheet.dataset.postId = postId;
    sheet.dataset.routeId = routeId;
    sheet.dataset.replyId = '';
    const post = findCachedPost(postId);
    const tombstone = isCommunityTombstone(post);
    const acctNow = $account.get();
    const mine = !!(acctNow?.status === 'signed-in' && post?.uid && post.uid === acctNow.uid);
    if (tombstone && !isAdminAuthed()) return;
    sheet.dataset.uid = post?.uid || '';
    sheet.dataset.email = post?.email || '';
    const actions = sheet.querySelector('#community-reaction-sheet-actions');
    if (actions) {
        const ownDelete = mine && !tombstone
            ? `<button type="button" class="community-sheet-delete col-span-2 py-2.5 rounded-xl text-xs font-bold bg-red-600 text-white" data-delete-mode="tombstone" data-delete-as="author">Delete</button>`
            : '';
        const suggestBtn = isAdminAuthed() && !tombstone
            ? `<button type="button" class="community-sheet-suggest col-span-2 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 text-white">Suggest reply</button>`
            : '';
        const adminActions = isAdminAuthed()
            ? `${suggestBtn}
                    <button type="button" class="community-sheet-lookup col-span-2 py-2.5 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">Look up rider</button>
                    <button type="button" class="community-sheet-delete col-span-2 py-2.5 rounded-xl text-xs font-bold bg-red-600 text-white" data-delete-mode="purge" data-delete-as="admin">Remove completely</button>
                    ${tombstone && (post?.deletedBy === 'admin' || post?.body === DELETED_BY_ADMIN) ? '' : '<button type="button" class="community-sheet-delete col-span-2 py-2.5 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300" data-delete-mode="tombstone" data-delete-as="admin">Deleted by an Admin</button>'}`
            : '';
        const { myEmoji: mineNow } = summarizeReactions(postId);
        const removeMine = !tombstone && mineNow
            ? `<button type="button" class="community-react-btn col-span-2 py-2.5 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100" data-post-id="${escapeHTML(postId)}" data-route="${escapeHTML(routeId)}" data-emoji="${escapeHTML(mineNow)}" aria-label="Remove reaction">Remove reaction</button>`
            : '';
        const talk = tombstone
            ? ''
            : `<button type="button" class="community-sheet-reply py-2.5 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100">Reply</button>
                    <button type="button" class="community-sheet-report py-2.5 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400">Report</button>`;
        actions.innerHTML = `
                    ${talk}
                    ${removeMine}
                    ${ownDelete}
                    ${adminActions}
        `;
    }
    const { myEmoji } = summarizeReactions(postId);
    const row = sheet.querySelector('#community-reaction-sheet-emojis');
    if (row) {
        row.innerHTML = tombstone ? '' : WA_REACTIONS.map((r) => `
            <button type="button" class="community-react-btn flex-1 h-11 text-xl rounded-xl ${myEmoji === r.id ? 'bg-blue-50 dark:bg-blue-900/40 ring-1 ring-blue-400' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}" data-post-id="${escapeHTML(postId)}" data-route="${escapeHTML(routeId)}" data-emoji="${r.id}" aria-label="${myEmoji === r.id ? 'Remove reaction' : 'React ' + r.emoji}">${r.emoji}</button>
        `).join('');
    }
    sheet.classList.remove('hidden');
    triggerHaptic();
}

function closeReactionSheet() {
    document.getElementById('community-reaction-sheet')?.classList.add('hidden');
}

const publicProfiles = new Map();
let feedAuthorMeta = new Map();
let communityFeedPinned = true;
let profileRepaintRoute = '';
const BEST_POINTS_KEY = 'nt-public-points-v1';
const bestPublicPoints = new Map();
const hintedPointUids = new Set();

function loadBestPublicPoints() {
    if (bestPublicPoints.size || typeof localStorage === 'undefined') return;
    try {
        const data = JSON.parse(localStorage.getItem(BEST_POINTS_KEY) || '{}');
        Object.entries(data || {}).forEach(([uid, value]) => {
            const points = Number(value);
            if (uid && Number.isFinite(points) && points > 0) bestPublicPoints.set(uid, points);
        });
    } catch {
        /* a missing memory just uses the message or the public total */
    }
}

function rememberPublicPoints(uid, points) {
    loadBestPublicPoints();
    const n = Number(points);
    if (!uid || !Number.isFinite(n) || n <= 0) return 0;
    const prev = bestPublicPoints.get(uid) || 0;
    if (n <= prev) return prev;
    bestPublicPoints.set(uid, n);
    try {
        const obj = {};
        bestPublicPoints.forEach((value, key) => { obj[key] = value; });
        localStorage.setItem(BEST_POINTS_KEY, JSON.stringify(obj));
    } catch {
        /* the in-memory total still covers this visit */
    }
    return n;
}

const PUBLIC_NAMES_KEY = 'nt-public-names-v1';
const bestPublicNames = new Map();

function loadBestPublicNames() {
    if (bestPublicNames.size || typeof localStorage === 'undefined') return;
    try {
        const data = JSON.parse(localStorage.getItem(PUBLIC_NAMES_KEY) || '{}');
        Object.entries(data || {}).forEach(([uid, row]) => {
            const name = String(row?.name || '').trim();
            const ts = Number(row?.ts) || 0;
            if (uid && name) bestPublicNames.set(uid, { name: name.slice(0, 80), ts });
        });
    } catch {
        /* a missing memory uses the name stored on the message */
    }
}

function persistPublicNames() {
    try {
        const rows = [...bestPublicNames.entries()]
            .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
            .slice(0, 200);
        const obj = {};
        rows.forEach(([uid, row]) => { obj[uid] = row; });
        localStorage.setItem(PUBLIC_NAMES_KEY, JSON.stringify(obj));
    } catch {
        /* the in-memory name still covers this visit */
    }
}

function rememberPublicName(uid, name, ts) {
    const clean = String(name || '').trim().slice(0, 80);
    const when = Number(ts) || 0;
    if (!uid || !clean || clean === 'Passenger' || clean === 'You') return '';
    loadBestPublicNames();
    const prev = bestPublicNames.get(uid);
    if (prev && prev.ts > when) return prev.name;
    if (prev && prev.ts === when && prev.name === clean) return prev.name;
    bestPublicNames.set(uid, { name: clean, ts: when });
    persistPublicNames();
    return clean;
}

/** Current account name, then the newest name already seen for this person. */
function syncedDisplayName(uid, profile, post, latest) {
    const profileName = String(profile && !profile.missing ? profile.displayName || '' : '').trim();
    if (profileName) {
        rememberPublicName(uid, profileName, Math.max(Number(profile.updatedAt) || 0, Date.now()));
        return profileName.slice(0, 80);
    }
    const latestName = String(latest?.displayName || '').trim();
    const postName = String(post?.displayName || '').trim();
    if (latestName) rememberPublicName(uid, latestName, Number(latest?.ts) || 0);
    if (postName) rememberPublicName(uid, postName, Number(post?.timestamp) || 0);
    loadBestPublicNames();
    return bestPublicNames.get(uid)?.name || latestName || postName || 'Passenger';
}

function bestKnownPoints(uid, profile, post, latest) {
    loadBestPublicPoints();
    const candidates = [
        Number(profile && !profile.missing ? profile.points : NaN),
        Number(post?.marks?.points),
        Number(latest?.points),
        bestPublicPoints.get(uid) || 0,
    ].filter((n) => Number.isFinite(n) && n > 0);
    if (!candidates.length) return 0;
    return rememberPublicPoints(uid, Math.max(...candidates));
}

function latestAuthorMeta(posts) {
    const map = new Map();
    (posts || []).forEach((post) => {
        const uid = post?.uid;
        if (!uid) return;
        const ts = Number(post.timestamp) || 0;
        const prev = map.get(uid);
        const points = Number(post.marks?.points);
        const pointValue = Number.isFinite(points) && points > 0 ? points : 0;
        if (pointValue > 0) rememberPublicPoints(uid, pointValue);
        const newer = !prev || ts >= prev.ts;
        map.set(uid, {
            ts: newer ? ts : prev.ts,
            points: Math.max(prev?.points || 0, pointValue) || null,
            tier: (pointValue > 0 ? post.marks?.tier : '') || prev?.tier || '',
            hasMarks: pointValue > 0 || !!prev?.hasMarks,
            photoURL: newer ? (post.photoURL || prev?.photoURL || '') : (prev?.photoURL || post.photoURL || ''),
            displayName: newer ? (post.displayName || prev?.displayName || '') : (prev?.displayName || post.displayName || ''),
        });
        const chosen = map.get(uid);
        if (chosen?.displayName) rememberPublicName(uid, chosen.displayName, chosen.ts);
    });
    return map;
}

function publicMarksFromPost(post, latest) {
    const points = bestKnownPoints(post?.uid, null, post, latest);
    if (!points) return null;
    return { points, tier: latest?.tier || post?.marks?.tier || '' };
}

function authorPresentation(post, isOwn) {
    if (isOwn) {
        const acct = $account.get();
        return {
            displayName: 'You',
            photoURL: showPhotoInAlerts() ? (acct?.photoURL || '') : '',
            marks: showMarksInCommunity() ? marksPublicSnapshot(readMarks()) : null,
        };
    }
    const profile = post?.uid ? publicProfiles.get(post.uid) : null;
    const latest = post?.uid ? feedAuthorMeta.get(post.uid) : null;
    if (profile && !profile.missing) {
        const showPhoto = profile.showPhoto === true;
        const showMarks = profile.showMarks !== false;
        const points = showMarks ? bestKnownPoints(post.uid, profile, post, latest) : 0;
        if (showMarks && points > Number(profile.points || 0)) hintPublicPoints(post.uid, points);
        return {
            displayName: syncedDisplayName(post.uid, profile, post, latest),
            photoURL: showPhoto ? (post.photoURL || latest?.photoURL || '') : '',
            marks: showMarks && points > 0
                ? { points, tier: profile.tier || latest?.tier || post?.marks?.tier || '' }
                : null,
        };
    }
    const newestHidPhoto = latest && !latest.photoURL && (post.photoURL || latest.photoURL);
    return {
        displayName: syncedDisplayName(post.uid, null, post, latest),
        photoURL: newestHidPhoto ? '' : (post.photoURL || ''),
        marks: publicMarksFromPost(post, latest),
    };
}

async function loadPublicProfiles(uids) {
    const now = Date.now();
    const need = [...new Set((uids || []).filter(Boolean))].filter((uid) => {
        const hit = publicProfiles.get(uid);
        const freshFor = Number(hit?.points) === 0 ? 60 * 1000 : 10 * 60 * 1000;
        return !hit || now - hit.fetchedAt > freshFor;
    });
    if (!need.length) return false;
    let changed = false;
    await Promise.all(need.slice(0, 40).map(async (uid) => {
        try {
            const res = await fetch(`${DYNAMIC_BASE_URL}public_profile/${encodeURIComponent(uid)}.json`);
            if (!res.ok) return;
            const data = await res.json();
            const row = data && typeof data === 'object' ? data : {};
            loadBestPublicPoints();
            if (row.displayName) rememberPublicName(uid, row.displayName, Number(row.updatedAt) || Date.now());
            if (Number(row.points) > 0) rememberPublicPoints(uid, row.points);
            else if ((bestPublicPoints.get(uid) || 0) > Number(row.points || 0)) hintPublicPoints(uid, bestPublicPoints.get(uid));
            publicProfiles.set(uid, {
                ...row,
                missing: !data,
                fetchedAt: Date.now(),
            });
            changed = true;
        } catch {
            /* keep the message snapshot */
        }
    }));
    return changed;
}

/** An admin, or the rider, can lift a missing public total up to a number already on a message. */
function hintPublicPoints(uid, points) {
    const n = Number(points);
    if (!uid || !Number.isFinite(n) || n <= 0 || hintedPointUids.has(uid)) return;
    const mine = $account.get()?.status === 'signed-in' && $account.get()?.uid === uid;
    if (!mine && !isAdminAuthed()) return;
    hintedPointUids.add(uid);
    const base = communityWorkerBase();
    if (!base) return;
    ensureAuthToken().then(async (token) => {
        if (!token) return;
        const res = await fetch(`${base}/community/points-seen`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ uid, points: n }),
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const stored = Number(data.points);
        if (!Number.isFinite(stored) || stored <= 0) return;
        rememberPublicPoints(uid, stored);
        const prev = publicProfiles.get(uid);
        publicProfiles.set(uid, {
            ...(prev && typeof prev === 'object' ? prev : {}),
            points: Math.max(stored, Number(prev?.points) || 0),
            missing: false,
            fetchedAt: Date.now(),
        });
    }).catch(() => {});
}

function pinCommunityFeedToLatest() {
    const scroller = document.querySelector('#view-community .community-feed-scroll');
    if (!scroller) return;
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (communityFeedPinned || gap < 160) scroller.scrollTop = scroller.scrollHeight;
}

function bindCommunityFeedPin() {
    const scroller = document.querySelector('#view-community .community-feed-scroll');
    if (!scroller || scroller.dataset.pinBound === '1') return;
    scroller.dataset.pinBound = '1';
    scroller.addEventListener('scroll', () => {
        const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        communityFeedPinned = gap < 160;
    }, { passive: true });
}

function communityImageUrls(post) {
    if (isCommunityTombstone(post)) return [];
    return sanitizeCommunityAttachments(post?.attachments, { admin: true });
}

function renderCommunityMedia(post) {
    if (isCommunityTombstone(post)) return '';
    const images = communityImageUrls(post);
    const imageHtml = images.length
        ? `<div class="community-msg-images">${images.map((url) => pictureMarkup(url, { link: true })).join('')}</div>`
        : '';
    const link = sanitizeCommunityLinkUrl(post?.linkUrl);
    const linkHtml = link
        ? `<a class="community-msg-link" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(link.replace(/^https:\/\//, ''))}</a>`
        : '';
    return `${imageHtml}${linkHtml}`;
}

function renderPostCard(post, routeId, { grouped = false } = {}) {
    const tombstone = isCommunityTombstone(post);
    const body = tombstone
        ? escapeHTML(post.deletedBy === 'admin' || post.body === DELETED_BY_ADMIN ? DELETED_BY_ADMIN : DELETED_MESSAGE)
        : escapeHTML(post.body || '');
    const clock = formatClock24(post.timestamp);
    const postId = escapeHTML(post.postId || '');
    const uid = escapeHTML(post.uid || '');
    const acct = $account.get();
    const myUid = acct?.status === 'signed-in' ? (acct.uid || '') : '';
    const isOwn = !!(myUid && post.uid && post.uid === myUid);
    const shown = authorPresentation(post, isOwn);
    const photoURL = shown.photoURL || '';
    const displayName = shown.displayName || (isOwn ? 'You' : 'Passenger');
    const nameColor = nameColorFor(authorColorKey(post.uid, displayName));
    const replyTo = !tombstone && post.replyTo && typeof post.replyTo === 'object' ? post.replyTo : null;
    const quoteShown = replyTo
        ? syncedDisplayName(
            replyTo.uid,
            replyTo.uid ? publicProfiles.get(replyTo.uid) : null,
            { displayName: replyTo.displayName, timestamp: 0, uid: replyTo.uid },
            replyTo.uid ? feedAuthorMeta.get(replyTo.uid) : null,
        )
        : '';
    const quoteColor = replyTo
        ? nameColorFor(authorColorKey(replyTo.uid, quoteShown, replyTo.postId))
        : nameColor;
    const quoteHtml = replyTo
        ? `<div class="mb-1.5 rounded-lg px-2 py-1.5 text-left ${isOwn ? 'bg-black/10 dark:bg-black/20' : 'bg-gray-100 dark:bg-gray-900/60'} border-l-[3px]" style="border-left-color:${quoteColor}">
             <p class="text-[11px] font-bold truncate" style="color:${quoteColor}">${escapeHTML(quoteShown || 'Passenger')}</p>
             <p class="text-[11px] opacity-80 truncate">${escapeHTML(String(replyTo.body || '').slice(0, 100))}</p>
           </div>`
        : '';

    const avatar = isOwn
        ? ''
        : grouped
            ? `<div class="community-avatar community-avatar-spacer" aria-hidden="true"></div>`
            : `<div class="community-avatar">${renderAvatarHtml(photoURL, displayName, nameColor)}</div>`;
    const bubbleCls = isOwn ? 'community-bubble community-bubble-own' : 'community-bubble community-bubble-other';
    const marksSnap = shown.marks;
    const marksHtml = !grouped && marksSnap ? renderBubbleMarksHtml(marksSnap) : '';
    const nameHtml = grouped
        ? ''
        : `<div class="community-bubble-name-row" style="color:${isOwn ? 'inherit' : nameColor}"><span class="community-bubble-name truncate">${escapeHTML(displayName)}</span>${marksHtml}</div>`;

    return `
      <div class="community-post-row ${isOwn ? 'justify-end' : 'justify-start gap-2'}${grouped ? ' is-grouped' : ''}${tombstone ? ' is-deleted' : ''}" data-post-id="${postId}" data-route="${escapeHTML(routeId)}" data-uid="${uid}"${tombstone ? ' data-deleted="1"' : ''}>
        <div class="community-swipe-hint" aria-hidden="true">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/></svg>
        </div>
        ${avatar}
        <div class="community-bubble-wrap">
          <article class="community-post min-w-0" data-post-id="${postId}" data-uid="${uid}" data-email="${escapeHTML(post.email || '')}" data-category="${escapeHTML(post.category || 'general')}">
            <div class="${bubbleCls} shadow-sm">
              ${nameHtml}
              <div class="community-bubble-body">
                ${quoteHtml}
                ${renderCommunityMedia(post)}
                ${body ? `<div class="community-msg-text${tombstone ? ' community-msg-deleted' : ''}">${body}<span class="community-msg-time">${clock}</span></div>` : `<div class="community-msg-text"><span class="community-msg-time">${clock}</span></div>`}
              </div>
            </div>
            ${tombstone ? '' : renderReactionSummary(post.postId || '', isOwn, routeId)}
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
    feedAuthorMeta = latestAuthorMeta(posts);
    bindCommunityFeedPin();

    if (!posts.length) {
        listEl.innerHTML = '';
        if (emptyEl) {
            emptyEl.classList.remove('hidden');
            emptyEl.innerHTML = `<p class="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">No posts on this line yet</p>
                   <p class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">Be the first to share a heads-up, or ask a question.</p>`;
        }
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    let html = '';
    let lastDate = '';
    let prevUid = '';
    posts.forEach((p) => {
        const dayKey = new Date(p.timestamp || 0).toDateString();
        if (dayKey && dayKey !== lastDate) {
            html += `<div class="flex justify-center w-full my-3">
                <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200/70 dark:bg-gray-800/70 px-3 py-1 rounded-full uppercase tracking-widest shadow-sm border border-gray-200 dark:border-gray-700">${escapeHTML(formatDayDivider(p.timestamp))}</span>
            </div>`;
            lastDate = dayKey;
            prevUid = '';
        }
        const uid = String(p.uid || '');
        const grouped = !!(uid && prevUid && uid === prevUid);
        html += renderPostCard(p, routeId, { grouped });
        prevUid = uid;
    });
    listEl.innerHTML = html;
    settleDeferredPictures(listEl);
    armGifPlayers(listEl);
    wireCommunityChatGestures(listEl);
    pinCommunityFeedToLatest();
    if (profileRepaintRoute === routeId) return;
    const uids = posts.map((p) => p.uid);
    loadPublicProfiles(uids).then((changed) => {
        if (!changed) return;
        const openId = document.getElementById('community-route-select')?.value || '';
        if (openId !== routeId) return;
        profileRepaintRoute = routeId;
        try { applyFeedFilter(routeId); } finally { profileRepaintRoute = ''; }
    }).catch(() => {});
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

    listEl.addEventListener('touchend', (e) => {
        clearLong();
        if (!activeRow) return;
        const row = activeRow;
        const dx = parseFloat(row.dataset.swipeDx || '0') || 0;
        row.classList.remove('is-swiping', 'is-pressing');
        row.style.transform = '';
        delete row.dataset.swipeDx;
        if (dx >= 12) {
            e.stopPropagation();
        }
        if (!longFired && dx >= 48 && row.getAttribute('data-deleted') !== '1') {
            const postId = row.getAttribute('data-post-id');
            const routeId = row.getAttribute('data-route');
            const post = findCachedPost(postId);
            if (post && !isCommunityTombstone(post)) {
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

function regionCommunityRoutes() {
    const region = $userRegion.get() || 'GP';
    return Object.values(ROUTES).filter((r) => (
        r.isActive && r.region === region && r.id !== 'special_event' && communityRoomAllowed(r.id)
    ));
}

function resolveCommunityRoute(routeId) {
    const routes = regionCommunityRoutes();
    const id = String(routeId || '');
    if (id && routes.some((r) => r.id === id)) return id;
    return routes[0]?.id || '';
}

function viewingCommunityRouteId() {
    if (safeStorage.getItem('activeTab') !== 'community') return '';
    return document.getElementById('community-route-select')?.value
        || getLastCommunityRoom()
        || $currentRouteId.get()
        || getPinnedRouteId()
        || '';
}

function unreadSeenKey(routeId) {
    return UNREAD_SEEN_PREFIX + routeId;
}

/**
 * A missing cursor means this session has not opened the route.
 * A signed-in account cursor counts as already seen on another session.
 * Never invent a "seen now" stamp just because the cursor is missing.
 */
export function communityUnreadCursor(localRaw, remoteSeen) {
    const local = localRaw == null || localRaw === '' ? NaN : parseInt(localRaw, 10);
    const remote = Number(remoteSeen);
    const hasLocal = Number.isFinite(local) && local > 0;
    const hasRemote = Number.isFinite(remote) && remote > 0;
    if (!hasLocal && !hasRemote) return { lastSeen: 0, established: false };
    return {
        lastSeen: Math.max(hasLocal ? local : 0, hasRemote ? remote : 0),
        established: true,
    };
}

function communityMessageCountsAsUnread(message, myUid, lastSeen) {
    const ts = Number(message?.timestamp) || 0;
    if (ts <= lastSeen) return false;
    if (message?.pendingReview || message?.shadowOnly) return false;
    if (message?.hidden && message.uid !== myUid) return false;
    if (myUid && message.uid === myUid) return false;
    return !!(message?.body || message?.linkUrl || (Array.isArray(message?.attachments) && message.attachments.length));
}

/** Posts in this page, plus replies already nested on those posts. */
export function countCommunityUnreadPosts(posts, myUid, lastSeen) {
    let total = 0;
    (posts || []).forEach((post) => {
        if (communityMessageCountsAsUnread(post, myUid, lastSeen)) total += 1;
        const replies = post?.replies && typeof post.replies === 'object' ? Object.values(post.replies) : [];
        replies.forEach((reply) => {
            if (communityMessageCountsAsUnread(reply, myUid, lastSeen)) total += 1;
        });
    });
    return total;
}

let accountSeenCache = { uid: '', at: 0, map: null };

async function readAccountCommunitySeen() {
    const acct = $account.get();
    if (acct?.status !== 'signed-in' || !acct.uid) return null;
    const now = Date.now();
    if (accountSeenCache.uid === acct.uid && accountSeenCache.map && now - accountSeenCache.at < 60 * 1000) {
        return accountSeenCache.map;
    }
    try {
        const q = await authQuery();
        if (!q) return accountSeenCache.uid === acct.uid ? accountSeenCache.map : null;
        const res = await fetch(
            `${DYNAMIC_BASE_URL}users/${encodeURIComponent(acct.uid)}/community_seen.json${q}`
        );
        if (!res.ok) return accountSeenCache.uid === acct.uid ? accountSeenCache.map : null;
        const data = await res.json();
        const map = data && typeof data === 'object' ? data : {};
        accountSeenCache = { uid: acct.uid, at: now, map };
        return map;
    } catch {
        return accountSeenCache.uid === acct.uid ? accountSeenCache.map : null;
    }
}

export async function markCommunityRouteSeen(routeId = getPinnedRouteId(), opts = {}) {
    if (!routeId) return;
    const seenAt = Date.now();
    safeStorage.setItem(unreadSeenKey(routeId), String(seenAt));
    cachedUnreadByRoute[routeId] = 0;
    paintUnreadFromCache();
    const acct = $account.get();
    if (acct?.status === 'signed-in' && acct.uid) {
        if (accountSeenCache.uid === acct.uid && accountSeenCache.map) {
            accountSeenCache.map[routeId] = seenAt;
            accountSeenCache.at = Date.now();
        }
        try {
            const q = await authQuery();
            if (q) {
                await fetch(
                    `${DYNAMIC_BASE_URL}users/${encodeURIComponent(acct.uid)}/community_seen/${encodeURIComponent(routeId)}.json${q}`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(seenAt),
                    }
                );
            }
        } catch {
            /* this device still has the local cursor */
        }
    }
    if (!isAdminAuthed()) return;
    try {
        if (!acct?.uid) return;
        const q = await authQuery();
        if (!q) return;
        await fetch(
            `${DYNAMIC_BASE_URL}admin_state/${encodeURIComponent(acct.uid)}/community_seen/${encodeURIComponent(routeId)}.json${q}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(seenAt),
            }
        );
    } catch {
        /* local seen cursor still keeps the commuter surface responsive */
    }
}

function paintUnreadFromCache() {
    const viewing = viewingCommunityRouteId();
    if (viewing) cachedUnreadByRoute[viewing] = 0;
    const rooms = Object.entries(cachedUnreadByRoute)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ id, n, label: routeLabel(id) }));
    const total = rooms.reduce((sum, r) => sum + r.n, 0);
    paintCommunityUnreadBadge(total, rooms);
    const rid = document.getElementById('community-route-select')?.value;
    if (rid || document.getElementById('community-route-list')) {
        syncCommunityRoutePicker(rid);
    }
}

function paintCommunityUnreadBadge(count, rooms = []) {
    const labels = [document.getElementById('community-unread-badge'), document.getElementById('community-unread-badge-top')];
    const n = Math.max(0, Number(count) || 0);
    const text = n > 99 ? '99+' : String(n);
    const roomNames = rooms.map((r) => r.label).filter(Boolean);
    const hint = roomNames.length
        ? (roomNames.length === 1
            ? `${n} unread on ${roomNames[0]}`
            : `${n} unread: ${roomNames.join(', ')}`)
        : '';
    labels.forEach((el) => {
        if (!el) return;
        if (n <= 0) {
            el.classList.add('hidden');
            el.textContent = '0';
            el.removeAttribute('title');
        } else {
            el.classList.remove('hidden');
            el.textContent = text;
            if (hint) el.setAttribute('title', hint);
        }
    });
    const bottom = document.getElementById('bottom-nav-community');
    if (bottom) {
        bottom.setAttribute('aria-label', n > 0
            ? `Community - ${hint || `${n} unread`}`
            : 'Community - route feed');
        if (hint) bottom.setAttribute('title', hint);
        else bottom.removeAttribute('title');
    }
}

async function fetchPostsNewerThan(routeId, lastSeen) {
    const q = await authQuery();
    const joiner = q ? `${q}&` : '?';
    const url = `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts.json${joiner}orderBy=%22timestamp%22&startAt=${Number(lastSeen) + 1}&limitToLast=20`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.values(data);
}

async function countUnreadOnRoute(routeId, viewingId, accountSeen) {
    if (!routeId || routeId === viewingId) return 0;
    try {
        const cursor = communityUnreadCursor(
            safeStorage.getItem(unreadSeenKey(routeId)),
            accountSeen ? accountSeen[routeId] : null
        );
        let posts = await fetchPostsNewerThan(routeId, cursor.established ? cursor.lastSeen : 0);
        if (!posts) posts = await fetchRoutePosts(routeId);
        const acct = $account.get();
        const myUid = acct?.status === 'signed-in' ? (acct.uid || '') : '';
        return countCommunityUnreadPosts(posts, myUid, cursor.established ? cursor.lastSeen : 0);
    } catch {
        return 0;
    }
}

let unreadRefreshToken = 0;

/**
 * Count unread posts per region room (newer than last visit) and name them on the badge.
 * Opening a room clears that room immediately. A slower poll cannot paint it back.
 */
export async function refreshCommunityUnreadBadge() {
    const token = ++unreadRefreshToken;
    try { await fetchFeatures(); } catch { /* defaults */ }
    if (token !== unreadRefreshToken) return 0;
    const routes = regionCommunityRoutes();
    if (!routes.length) {
        cachedUnreadByRoute = {};
        paintCommunityUnreadBadge(0);
        return 0;
    }
    const viewing = viewingCommunityRouteId();
    if (viewing) {
        cachedUnreadByRoute[viewing] = 0;
        paintUnreadFromCache();
        void markCommunityRouteSeen(viewing, { silent: true });
    }

    const accountSeen = await readAccountCommunitySeen();
    const next = {};
    await Promise.all(routes.map(async (r) => {
        next[r.id] = await countUnreadOnRoute(r.id, viewing, accountSeen);
    }));
    if (token !== unreadRefreshToken) return 0;
    const stillViewing = viewingCommunityRouteId();
    if (stillViewing) next[stillViewing] = 0;
    cachedUnreadByRoute = next;
    paintUnreadFromCache();
    return Object.values(next).reduce((sum, n) => sum + n, 0);
}

function unreadPollDue() {
    const onCommunity = safeStorage.getItem('activeTab') === 'community';
    const wait = onCommunity ? UNREAD_POLL_MS : UNREAD_AWAY_MS;
    return Date.now() - unreadPolledAt >= wait;
}

export function startCommunityUnreadWatch() {
    if (typeof window === 'undefined' || window.__ntCommunityUnreadWatch) return;
    window.__ntCommunityUnreadWatch = true;
    unreadPolledAt = Date.now();
    refreshCommunityUnreadBadge();
    unreadPollTimer = setInterval(() => {
        if (document.hidden || !unreadPollDue()) return;
        unreadPolledAt = Date.now();
        refreshCommunityUnreadBadge();
    }, UNREAD_POLL_MS);
    window.addEventListener('focus', () => {
        if (Date.now() - unreadPolledAt < 45000) return;
        unreadPolledAt = Date.now();
        refreshCommunityUnreadBadge();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (Date.now() - unreadPolledAt < 45000) return;
        unreadPolledAt = Date.now();
        refreshCommunityUnreadBadge();
    });
}

export async function renderCommunityFeed(routeId = $currentRouteId.get(), opts = {}) {
    communityFeedPinned = true;
    const listEl = document.getElementById('community-feed-list');
    const emptyEl = document.getElementById('community-feed-empty');
    const titleEl = document.getElementById('community-route-title');
    if (!listEl) return;
    try { await fetchFeatures(); } catch { /* defaults */ }
    if (!communityRoomAllowed(routeId)) routeId = resolveCommunityRoute('');
    else routeId = resolveCommunityRoute(routeId);
    if (!routeId) {
        if (titleEl) titleEl.textContent = 'Community';
        listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-8">No community is open for this region.</p>`;
        if (emptyEl) emptyEl.classList.add('hidden');
        return;
    }

    if (titleEl) titleEl.textContent = routeLabel(routeId);
    paintCategoryFilters();

    const forceRest = !!opts.forceRest;
    if (!feedSilentRepaint) {
        listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-8 animate-pulse">Loading feed…</p>`;
        if (emptyEl) emptyEl.classList.add('hidden');
    }

    // Prefer the live window. A second REST download of the same posts is skipped
    // once that snapshot has arrived.
    if (!forceRest) {
        const live = await startRealtimePosts(routeId);
        if (live) {
            const saw = await postsReady;
            if (saw && postsSnapSeen && postsListenRouteId === routeId) {
                startRealtimeReactions(routeId);
                if (postsListenRouteId === routeId) applyFeedFilter(routeId);
                return;
            }
        }
    }

    stopRealtimePosts();
    const posts = await fetchRoutePosts(routeId);
    cachedFeedPosts = posts;
    startRealtimeReactions(routeId);
    const reactionsMap = await fetchPostReactions(routeId, posts.map((p) => p.postId));
    cachedReactionsByPost = reactionsMap && typeof reactionsMap === 'object' ? reactionsMap : {};
    applyFeedFilter(routeId);
}

function syncCommunityRoutePicker(routeId) {
    const routeSel = document.getElementById('community-route-select');
    const display = document.getElementById('community-route-display');
    const list = document.getElementById('community-route-list');
    if (!routeSel) return;

    const routes = regionCommunityRoutes();
    let activeId = resolveCommunityRoute(routeId || routeSel.value || $currentRouteId.get() || '');

    routeSel.innerHTML = routes.map((r) =>
        `<option value="${r.id}" ${r.id === activeId ? 'selected' : ''}>${escapeHTML(formatRouteDisplayName(r.name || r.id))}</option>`
    ).join('') || '<option value="">No routes</option>';

    if (activeId) routeSel.value = activeId;

    const label = formatRouteDisplayName(ROUTES[routeSel.value]?.name || routeSel.value || 'Select route');
    if (display) display.textContent = label;
    const triggerUnread = document.getElementById('community-route-unread');
    if (triggerUnread) {
        const other = Object.entries(cachedUnreadByRoute)
            .filter(([id, n]) => n > 0 && id !== routeSel.value)
            .reduce((sum, [, n]) => sum + n, 0);
        if (other > 0) {
            triggerUnread.classList.remove('hidden');
            triggerUnread.textContent = other > 99 ? '99+' : String(other);
        } else {
            triggerUnread.classList.add('hidden');
            triggerUnread.textContent = '0';
        }
    }

    if (list) {
        const allRoutes = [...routes];
        list.innerHTML = allRoutes.map((r) => {
            const selected = r.id === routeSel.value;
            const unread = r.id === routeSel.value ? 0 : (cachedUnreadByRoute[r.id] || 0);
            const unreadHtml = unread > 0
                ? `<span class="community-room-unread">${unread > 99 ? '99+' : unread}</span>`
                : '';
            return `<li role="option" data-route-id="${escapeHTML(r.id)}" aria-selected="${selected ? 'true' : 'false'}" class="px-3.5 py-3 text-sm font-bold cursor-pointer transition-colors border-b border-gray-100 dark:border-gray-700 last:border-0 flex items-center gap-2 ${
                selected
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                    : 'text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
            }"><span class="min-w-0 flex-1 truncate" data-route-raw="${escapeHTML(r.name || r.id)}">${escapeHTML(formatRouteDisplayName(r.name || r.id))}</span>${unreadHtml}</li>`;
        }).join('') || `<li class="px-3.5 py-3 text-sm text-gray-400">No routes</li>`;
    }
    requestAnimationFrame(() => fitCommunityRouteLabels());
}

function setCommunityRouteListOpen(open) {
    const list = document.getElementById('community-route-list');
    const chevron = document.getElementById('community-route-chevron');
    const trigger = document.getElementById('community-route-trigger');
    const wrap = document.getElementById('community-route-dropdown');
    if (!list) return;
    list.classList.toggle('hidden', !open);
    wrap?.classList.toggle('is-open', open);
    document.querySelector('.community-route-row')?.classList.toggle('is-open', open);
    const hint = document.getElementById('community-guest-hint');
    if (hint && !hint.classList.contains('hidden')) {
        hint.style.visibility = open ? 'hidden' : '';
    }
    if (chevron) chevron.classList.toggle('rotate-180', open);
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) requestAnimationFrame(() => fitCommunityRouteLabels());
}

const KIND_PLACEHOLDER = 'Please be kind and respectful.';
const COMPOSER_DRAFT_KEY = 'ntCommunityComposerDraft';

function rememberComposerDraft(value) {
    const text = String(value ?? '');
    if (text) safeStorage.setItem(COMPOSER_DRAFT_KEY, text);
    else safeStorage.removeItem(COMPOSER_DRAFT_KEY);
}

function restoreComposerDraft(composer) {
    const el = composer || document.getElementById('community-composer');
    if (!el || el.value) return;
    const saved = safeStorage.getItem(COMPOSER_DRAFT_KEY) || '';
    if (!saved) return;
    el.value = saved;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 160)}px`;
}

function keepComposerText(composer) {
    const el = composer || document.getElementById('community-composer');
    const typed = el?.value || '';
    if (typed) rememberComposerDraft(typed);
    return () => {
        if (!el) {
            restoreComposerDraft();
            return;
        }
        if (typed && el.value !== typed) el.value = typed;
        if (el.value) rememberComposerDraft(el.value);
    };
}

const ACCOUNT_POST_PROMPT = {
    title: 'Only signed-in users can post',
    body: 'Would you like to quickly create a Next Train account so you can post and open more features?',
};

function paintAdminAttachPreview() {
    const box = document.getElementById('community-attach-preview');
    if (!box) return;
    const images = adminImages.map((url) => (
        `<button type="button" class="community-attach-chip" data-remove-image="${escapeHTML(url)}">Image <span aria-hidden="true">×</span></button>`
    )).join('');
    const link = adminLinkUrl
        ? `<button type="button" class="community-attach-chip" data-remove-link="1">${escapeHTML(adminLinkUrl.replace(/^https:\/\//, '').slice(0, 42))} <span aria-hidden="true">×</span></button>`
        : '';
    box.innerHTML = `${images}${link}`;
}

function syncComposerChrome() {
    const composer = document.getElementById('community-composer');
    if (!composer) return;
    composer.disabled = false;
    const operator = isAdminAuthed();
    composer.maxLength = operator ? COMMUNITY_ADMIN_BODY_MAX : BODY_MAX;
    document.getElementById('community-admin-tools')?.classList.toggle('hidden', !operator);
    restoreComposerDraft(composer);
    if (document.activeElement === composer) composer.placeholder = '';
    else composer.placeholder = KIND_PLACEHOLDER;
    paintAdminAttachPreview();
}

async function fillCommunityPosterSelect() {
    const sel = document.getElementById('community-poster-select');
    if (!sel || sel.dataset.loaded === '1') return;
    try {
        const base = typeof window.withBase === 'function' ? window.withBase('/images/alerts/manifest.json') : '/images/alerts/manifest.json';
        const res = await fetch(base);
        if (!res.ok) return;
        const data = await res.json();
        const posters = Array.isArray(data?.posters) ? data.posters : [];
        sel.innerHTML = `<option value="">Service alert poster…</option>${posters.map((p) => {
            const file = String(p?.file || '').trim();
            if (!file) return '';
            return `<option value="${escapeHTML(`/images/alerts/${file}`)}">${escapeHTML(p.label || file)}</option>`;
        }).join('')}`;
        sel.dataset.loaded = '1';
    } catch {
        /* the image address field still works */
    }
}

function addAdminImage(raw) {
    const url = sanitizeCommunityImageUrl(raw);
    if (!url) {
        showToast('Use a public image address, or a service alert poster.', 'error');
        return false;
    }
    if (adminImages.includes(url)) return true;
    if (adminImages.length >= COMMUNITY_ADMIN_IMAGE_MAX) {
        showToast(`Maximum ${COMMUNITY_ADMIN_IMAGE_MAX} images on one message.`, 'warning');
        return false;
    }
    adminImages.push(url);
    paintAdminAttachPreview();
    return true;
}

function addAdminAddress(raw) {
    const value = String(raw || '').trim();
    if (!value) return;
    if (sanitizeCommunityImageUrl(value)) {
        addAdminImage(value);
        return;
    }
    const link = sanitizeCommunityLinkUrl(value);
    if (!link) {
        showToast('Use a full https link.', 'error');
        return;
    }
    adminLinkUrl = link;
    paintAdminAttachPreview();
}

async function communityPostsSince(routeId, since) {
    const cached = (cachedFeedPosts || []).filter((p) => p && (Number(p.timestamp) || 0) >= since);
    try {
        const url = `${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts.json?orderBy=%22timestamp%22&startAt=${since}&limitToLast=80`;
        const res = await fetch(url);
        if (!res.ok) return cached;
        const data = await res.json();
        const rows = data && typeof data === 'object' ? Object.values(data) : [];
        return rows.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
    } catch {
        return cached;
    }
}

async function suggestCommunityReply(focusPostId = '') {
    if (!isAdminAuthed()) return;
    const btn = document.getElementById('community-suggest-btn');
    const composer = document.getElementById('community-composer');
    const errEl = document.getElementById('community-error');
    const routeId = document.getElementById('community-route-select')?.value || $currentRouteId.get();
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const loaded = routeId ? await communityPostsSince(routeId, since) : [];
    const focus = findCachedPost(focusPostId) || loaded.find((p) => p?.postId === focusPostId) || null;
    const windowPosts = loaded
        .filter((p) => p && !isCommunityTombstone(p) && (p.body || p.linkUrl) && (Number(p.timestamp) || 0) >= since)
        .slice(-60);
    if (focus && !isCommunityTombstone(focus) && !windowPosts.some((p) => p.postId === focus.postId)) {
        windowPosts.push(focus);
    }
    const thread = windowPosts
        .map((p) => {
            const mine = $account.get()?.uid && p.uid === $account.get().uid;
            const fromAdmin = mine || ['enockelk@gmail.com', 'thandeka05nxumalo@gmail.com'].includes(String(p.email || '').toLowerCase());
            const priority = focus && p.postId === focus.postId;
            return {
                from: fromAdmin ? 'admin' : 'commuter',
                text: `${priority ? 'PRIORITY: ' : ''}${p.displayName || 'Passenger'}: ${p.body || p.linkUrl || ''}`,
                at: Number(p.timestamp) || 0,
            };
        });
    if (!thread.length) {
        if (errEl) errEl.textContent = 'Nothing in this room to answer yet.';
        return;
    }
    const token = await ensureAuthToken();
    if (!token) {
        showToast('Sign in again to use Co-Pilot.', 'error');
        return;
    }
    if (btn) btn.disabled = true;
    if (errEl) errEl.textContent = '';
    try {
        const res = await fetch(`${REPLY_WORKER_URL}/suggest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                region: $userRegion.get() || 'GP',
                routeId,
                note: focus
                    ? 'This is the public community room for one train line. The line marked PRIORITY is the message to answer. The other lines are the past 24 hours, for context only. Answer the priority message first. One short reply an operator can post. No email sign-off. Stay under 280 characters.'
                    : 'This is the public community room for one train line. Write one short reply an operator can post in that room. No email sign-off. Stay under 280 characters. Answer the latest passenger questions.',
                thread,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Co-Pilot could not draft a reply.');
        if (data.action === 'halt') {
            if (errEl) errEl.textContent = data.reason || 'Co-Pilot needs a fact before it can draft this.';
            return;
        }
        const draft = String(data.reply || '').trim();
        if (!draft) {
            if (errEl) errEl.textContent = 'Co-Pilot returned an empty draft.';
            return;
        }
        if (composer) {
            composer.value = draft.slice(0, COMMUNITY_ADMIN_BODY_MAX);
            composer.style.height = 'auto';
            composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 44), 160)}px`;
            rememberComposerDraft(composer.value);
            composer.focus();
        }
    } catch (err) {
        showToast(err?.message || 'Co-Pilot could not draft a reply.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

export function openRouteCommunity(opts = {}) {
    void openRouteCommunityNow(opts);
}

let publishedCommunityName = '';

/** Write this account's current name so older messages in every room pick it up. */
function publishOwnCommunityName() {
    const acct = $account.get();
    const name = String(acct?.displayName || '').trim();
    if (acct?.status !== 'signed-in' || !acct.uid || !name || name === publishedCommunityName) return;
    publishedCommunityName = name;
    import('./rider-marks.js')
        .then((m) => m.publishPublicProfile({ displayName: name }))
        .catch(() => { publishedCommunityName = ''; });
}

async function openRouteCommunityNow(opts = {}) {
    try { await fetchFeatures(); } catch { /* defaults */ }
    const requested = opts.routeId || getLastCommunityRoom() || $currentRouteId.get() || getPinnedRouteId() || '';
    const routeId = resolveCommunityRoute(requested);
    const routeSel = document.getElementById('community-route-select');
    const guestHint = document.getElementById('community-guest-hint');
    const errEl = document.getElementById('community-error');
    const titleEl = document.getElementById('community-route-title');

    if (routeId) setLastCommunityRoom(routeId);
    syncReplyDraftForRoute(routeId);
    syncCommunityRoutePicker(routeId);

    guestHintDismissedThisOpen = false;
    if (guestHint) guestHint.classList.add('hidden');
    syncComposerChrome();
    if (errEl) errEl.textContent = '';

    const activeRoute = routeSel?.value || routeId;
    if (titleEl) titleEl.textContent = routeLabel(activeRoute);
    if (activeRoute) {
        setLastCommunityRoom(activeRoute);
        syncReplyDraftForRoute(activeRoute);
    }

    // Ensure the Community view is showing (avoid re-entrancy loops)
    if (safeStorage.getItem('activeTab') !== 'community' && typeof window.switchTab === 'function') {
        window.switchTab('community');
        return;
    }

    publishOwnCommunityName();

    triggerHaptic();
    communityFeedPinned = true;
    renderCommunityFeed(activeRoute);
    joinCommunityPresence(activeRoute);
    if (activeRoute) markCommunityRouteSeen(activeRoute);
    refreshCommunityUnreadBadge();
    refreshCommunitySendMax().finally(() => paintCommunityQuotaHint());
    startQuotaHintWatch();
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
            const rid = resolveCommunityRoute(routeSel?.value || getLastCommunityRoom() || $currentRouteId.get());
            if (rid && communityRoomAllowed(rid)) {
                startRealtimePosts(rid);
                startRealtimeReactions(rid);
                joinCommunityPresence(rid);
            }
        }
    });
}

let communityWaitCancel = null;

function paintCommunityQuotaHint() {
    const el = document.getElementById('community-quota-hint');
    if (!el) return;
    bindCommunityQuotaNote();
    const signed = $account.get().status === 'signed-in';
    if (!signed || isAdminAuthed()) {
        el.textContent = '';
        el.hidden = true;
        const note = document.getElementById('community-quota-note');
        if (note) note.hidden = true;
        return;
    }
    const limit = checkCommunityRateLimit();
    const left = Math.max(0, Number(limit.remaining) || 0);
    const note = document.getElementById('community-quota-note');
    if (left > 3) {
        el.textContent = '';
        el.hidden = true;
        if (note) note.hidden = true;
        return;
    }
    el.hidden = false;
    el.textContent = `${left} left`;
    if (!limit.ok && limit.reason === 'quota' && !communityWaitCancel) {
        paintCommunityWait(limit);
    }
}

function bindCommunityQuotaNote() {
    const btn = document.getElementById('community-quota-hint');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
        const note = document.getElementById('community-quota-note');
        if (!note) return;
        const open = note.hidden;
        note.hidden = !open;
        if (!open) return;
        note.textContent = `Community is still being tried out. Each account can send ${communitySendMax} messages in 30 minutes. This is how many you have left.`;
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindCommunityQuotaNote, { once: true });
    else bindCommunityQuotaNote();
}

function startQuotaHintWatch() {
    paintCommunityQuotaHint();
    if (quotaHintTimer) return;
    quotaHintTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (safeStorage.getItem('activeTab') !== 'community') return;
        paintCommunityQuotaHint();
    }, 10000);
}

function paintCommunityWait(limit) {
    const errEl = document.getElementById('community-error');
    const btn = document.getElementById('community-post-btn');
    if (communityWaitCancel) communityWaitCancel();
    communityWaitCancel = startRateLimitCountdown(errEl, limit.retryAfterMs || 20000, {
        reason: limit.reason || 'cooldown',
        onDone: () => {
            communityWaitCancel = null;
            if (btn) btn.disabled = false;
            if (errEl && /wait/i.test(errEl.textContent || '')) errEl.textContent = '';
            paintCommunityQuotaHint();
        },
    });
    if (btn) btn.disabled = true;
}

function liveModerateComposer() {
    const composer = document.getElementById('community-composer');
    const errEl = document.getElementById('community-error');
    const btn = document.getElementById('community-post-btn');
    if (!composer || !errEl) return;
    const safety = checkContentSafety(composer.value, { live: true });
    if (safety.verdict === 'block' && safety.reason !== 'url') {
        errEl.textContent = safety.message;
        if (btn) btn.disabled = true;
        return;
    }
    if (btn && !communityWaitCancel) btn.disabled = false;
    if (errEl && (safety.reason === 'url' || safety.reason === 'profanity' || /allowed|swearing|links|Couldn't post/i.test(errEl.textContent || ''))) {
        errEl.textContent = '';
    }
}

async function handlePostSubmit() {
    const routeSel = document.getElementById('community-route-select');
    const composer = document.getElementById('community-composer');
    const errEl = document.getElementById('community-error');
    const btn = document.getElementById('community-post-btn');
    const routeId = routeSel?.value || $currentRouteId.get();
    const body = composer?.value || '';

    if (errEl) errEl.textContent = '';
    if ($account.get().status !== 'signed-in') {
        if (btn) btn.disabled = false;
        const restore = keepComposerText(composer);
        await offerNextTrainAccount(ACCOUNT_POST_PROMPT);
        restore();
        return;
    }
    if (btn) btn.disabled = true;

    const result = await submitCommunityPost(body, routeId);
    paintCommunityQuotaHint();
    if (!result.ok) {
        if (errEl) errEl.textContent = result.needsAuth ? '' : (result.message || '');
        if (result.retryAfterMs) {
            paintCommunityWait(result);
        }
        if (btn) btn.disabled = false;
        if (result.needsAuth) {
            if ($account.get().status !== 'signed-in') {
                const restore = keepComposerText(composer);
                await offerNextTrainAccount(ACCOUNT_POST_PROMPT);
                restore();
            } else if (errEl) {
                errEl.textContent = result.message || 'Sign in again to post.';
            }
            if (btn) btn.disabled = false;
        }
        return;
    }

    if (composer) {
        composer.value = '';
        composer.style.height = '';
    }
    rememberComposerDraft('');
    clearReplyDraft();
    adminImages.splice(0, adminImages.length);
    adminLinkUrl = '';
    paintAdminAttachPreview();
    signalCommunityTyping(routeId, false);
    if (result.held) {
        showToast(result.message || 'Held for review - it won’t show until an admin approves it.', 'info');
        if (errEl) errEl.textContent = result.message || 'Held for review. It won’t appear until approved.';
    } else {
        showToast('Posted to the route feed', 'success');
    }
    if (!result.held && !result.shadowSilenced) awardCommunityMarks({ detail: { routeId } });
    // Realtime listener will refresh; REST fallback still re-renders.
    // Own bubbles read live points, so repaint after the award either way.
    if (!postsListenRouteId || postsListenRouteId !== routeId) {
        await renderCommunityFeed(routeId);
    } else {
        applyFeedFilter(routeId);
    }
    if (btn) btn.disabled = false;
    paintCommunityQuotaHint();
}

async function expandReplies(postId, routeId, container) {
    container.classList.remove('hidden');
    container.innerHTML = `<p class="text-[10px] text-gray-400 py-1">Loading…</p>`;
    const replies = await fetchReplies(routeId, postId);

    let html = replies.length
        ? replies.map((r) => `
            <div class="text-left">
              <p class="text-[10px] font-bold text-gray-600 dark:text-gray-300">${escapeHTML(r.displayName || 'Passenger')} · <span class="font-medium text-gray-400">${relativeTime(r.timestamp)}</span></p>
              <p class="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">${escapeHTML(r.body || '')}</p>
            </div>`).join('')
        : `<p class="text-[11px] text-gray-400">No replies yet.</p>`;

    html += `
      <div class="pt-2 flex gap-2 items-start">
        <input type="text" maxlength="${BODY_MAX}" class="community-reply-input flex-1 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Write a reply…" data-post-id="${escapeHTML(postId)}" />
        <button type="button" class="community-reply-send shrink-0 px-2.5 py-2 rounded-lg bg-blue-600 text-white text-[10px] font-bold disabled:opacity-50" data-post-id="${escapeHTML(postId)}" data-route="${escapeHTML(routeId)}">Reply</button>
      </div>`;
    container.innerHTML = html;
}

export function bindCommunityUi() {
    if (typeof document === 'undefined' || window.__ntCommunityBound) return;
    window.__ntCommunityBound = true;
    bindCommunityVisibilityTeardown();
    import('./rider-marks.js').then((m) => m.paintCommunityMarksChip?.()).catch(() => {});
    $account.subscribe(() => {
        import('./rider-marks.js').then((m) => m.paintCommunityMarksChip?.()).catch(() => {});
    });

    const open = (e) => {
        e?.preventDefault?.();
        if (typeof window.switchTab === 'function') window.switchTab('community');
        else openRouteCommunity();
    };

    document.getElementById('route-community-open-btn')?.addEventListener('click', open);
    document.getElementById('sidenav-community-btn')?.addEventListener('click', () => {
        triggerHaptic();
        if (typeof window.closeAppHub === 'function') window.closeAppHub(true);
        setTimeout(() => {
            if (typeof window.switchTab === 'function') window.switchTab('community');
            else openRouteCommunity();
        }, 50);
    });

    document.getElementById('community-post-btn')?.addEventListener('click', () => handlePostSubmit());
    document.getElementById('community-suggest-btn')?.addEventListener('click', () => { suggestCommunityReply(); });
    document.getElementById('community-attach-btn')?.addEventListener('click', () => {
        const tray = document.getElementById('community-attach-tray');
        if (!tray || !isAdminAuthed()) return;
        tray.classList.toggle('hidden');
        if (!tray.classList.contains('hidden')) fillCommunityPosterSelect();
    });
    document.getElementById('community-attach-add')?.addEventListener('click', () => {
        const input = document.getElementById('community-attach-url');
        addAdminAddress(input?.value || '');
        if (input) input.value = '';
    });
    document.getElementById('community-poster-select')?.addEventListener('change', (e) => {
        const value = e.target.value;
        if (value) addAdminImage(value);
        e.target.value = '';
    });
    document.getElementById('community-attach-preview')?.addEventListener('click', (e) => {
        const image = e.target.closest?.('[data-remove-image]');
        if (image) {
            const url = image.getAttribute('data-remove-image');
            const idx = adminImages.indexOf(url);
            if (idx >= 0) adminImages.splice(idx, 1);
            paintAdminAttachPreview();
            return;
        }
        if (e.target.closest?.('[data-remove-link]')) {
            adminLinkUrl = '';
            paintAdminAttachPreview();
        }
    });
    document.getElementById('community-route-select')?.addEventListener('change', (e) => {
        const rid = resolveCommunityRoute(e.target.value);
        if (!rid || !communityRoomAllowed(rid)) return;
        const titleEl = document.getElementById('community-route-title');
        if (titleEl) titleEl.textContent = routeLabel(rid);
        const display = document.getElementById('community-route-display');
        if (display) display.textContent = routeLabel(rid);
        setLastCommunityRoom(rid);
        syncReplyDraftForRoute(rid);
        renderCommunityFeed(rid);
        joinCommunityPresence(rid);
        communityFeedPinned = true;
        if (rid) markCommunityRouteSeen(rid);
        refreshCommunityUnreadBadge();
        paintCommunityQuotaHint();
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
    document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest?.('#community-route-dropdown')) {
            setCommunityRouteListOpen(false);
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setCommunityRouteListOpen(false);
    });
    window.addEventListener('resize', () => fitCommunityRouteLabels());
    document.getElementById('community-refresh-btn')?.addEventListener('click', () => {
        const rid = document.getElementById('community-route-select')?.value || $currentRouteId.get();
        renderCommunityFeed(rid);
    });
    document.getElementById('community-signin-cta')?.addEventListener('click', async () => {
        const composer = document.getElementById('community-composer');
        const restore = keepComposerText(composer);
        await offerNextTrainAccount(ACCOUNT_POST_PROMPT);
        restore();
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
    restoreComposerDraft(composerEl);
    composerEl?.addEventListener('input', () => {
        rememberComposerDraft(composerEl.value);
        // Auto-grow with new lines (WhatsApp-style), capped
        composerEl.style.height = 'auto';
        const next = Math.min(Math.max(composerEl.scrollHeight, 44), 160);
        composerEl.style.height = `${next}px`;
        liveModerateComposer();
        paintCommunityQuotaHint();

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
            showToast(result.ok ? 'Thanks - report sent to moderation.' : (result.message || 'Report failed'), result.ok ? 'success' : 'error');
            return;
        }

        const sheetDelete = t.closest?.('.community-sheet-delete');
        if (sheetDelete) {
            e.preventDefault();
            const sheet = document.getElementById('community-reaction-sheet');
            const postId = sheet?.dataset.postId || '';
            const routeId = sheet?.dataset.routeId || '';
            const replyId = sheet?.dataset.replyId || '';
            const mode = sheetDelete.getAttribute('data-delete-mode') === 'purge' ? 'purge' : 'tombstone';
            const as = sheetDelete.getAttribute('data-delete-as') === 'author' ? 'author' : 'admin';
            if (as === 'admin' && !isAdminAuthed()) return;
            closeReactionSheet();
            if (!routeId || !postId) return;
            const prompt = mode === 'purge'
                ? 'Remove this message completely? Quotes people already made keep their text.'
                : (as === 'admin'
                    ? 'Replace this message with Deleted by an Admin? Quotes people already made keep their text.'
                    : 'Delete this message? It will say Deleted message. Quotes people already made keep their text.');
            const ok = typeof window.confirm === 'function' ? window.confirm(prompt) : true;
            if (!ok) return;
            try {
                await deleteCommunityMessage({ routeId, postId, replyId, mode, as });
                showToast(mode === 'purge' ? 'Message removed.' : 'Message deleted.', 'success');
                triggerHaptic();
            } catch (err) {
                showToast(err?.message || 'Could not delete this message.', 'error');
            }
            return;
        }

        const sheetSuggest = t.closest?.('.community-sheet-suggest');
        if (sheetSuggest) {
            e.preventDefault();
            if (!isAdminAuthed()) return;
            const sheet = document.getElementById('community-reaction-sheet');
            const focusId = sheet?.dataset.postId || '';
            closeReactionSheet();
            suggestCommunityReply(focusId);
            return;
        }

        const sheetLookup = t.closest?.('.community-sheet-lookup');
        if (sheetLookup) {
            e.preventDefault();
            if (!isAdminAuthed()) return;
            const sheet = document.getElementById('community-reaction-sheet');
            const uid = sheet?.dataset.uid || '';
            const email = sheet?.dataset.email || '';
            closeReactionSheet();
            const { ensureAdminLoaded, openDevHubUi } = await import('./admin-bridge.js');
            const Admin = await ensureAdminLoaded();
            if (!Admin) {
                showToast('Admin tools unavailable', 'error');
                return;
            }
            openDevHubUi();
            try { Admin.setupUserTrustManager?.(); } catch { /* ignore */ }
            setTimeout(() => {
                Admin.openUserTrustLookup?.({ uid, email });
            }, 80);
            return;
        }

        const reactBtn = t.closest?.('.community-react-btn');
        if (reactBtn) {
            e.preventDefault();
            triggerHaptic();
            const postId = reactBtn.getAttribute('data-post-id');
            const routeId = reactBtn.getAttribute('data-route');
            const emojiId = reactBtn.getAttribute('data-emoji');
            let result = await togglePostReaction(routeId, postId, emojiId);
            if (!result.ok && result.needsAuth) {
                await offerNextTrainAccount(ACCOUNT_POST_PROMPT);
                return;
            }
            if (!result.ok) {
                if (!result.needsAuth) showToast(result.message || 'Could not react', 'error');
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
            if ($account.get().status !== 'signed-in') {
                const typedReply = input?.value || '';
                const composer = document.getElementById('community-composer');
                if (typedReply && composer && !composer.value) {
                    composer.value = typedReply;
                    rememberComposerDraft(typedReply);
                }
                const restore = keepComposerText(composer);
                await offerNextTrainAccount(ACCOUNT_POST_PROMPT);
                restore();
                if (input && typedReply && input.isConnected && input.value !== typedReply) input.value = typedReply;
                return;
            }
            const result = await submitCommunityReply(postId, input?.value || '', routeId);
            paintCommunityQuotaHint();
            if (!result.ok) {
                if (result.needsAuth) return;
                showToast(result.message || 'Reply failed', 'error');
                if (result.retryAfterMs) paintCommunityWait(result);
                return;
            }
            if (input) input.value = '';
            if (result.held) {
                showToast(result.message || 'Held for review - it won’t show until approved.', 'info');
                return;
            }
            if (!result.shadowSilenced) awardCommunityMarks({ detail: { routeId } });
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
    window.addEventListener('ntdatasaver', () => {
        const view = document.getElementById('view-community');
        if (!view || view.classList.contains('hidden')) return;
        const routeId = document.getElementById('community-route-select')?.value || '';
        if (routeId) applyFeedFilter(routeId);
    });
    window.openRouteCommunity = openRouteCommunity;
    window.renderCommunityFeed = renderCommunityFeed;
    window.leaveCommunityRoom = leaveCommunityRoom;
}
