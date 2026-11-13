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
import { safeStorage, escapeHTML, expandJhbLabel, applyFittedLabel, applyFittedLabels } from './utils.js';
import { sanitizeCommunityPhotoUrl } from './community-photo.js';
import { pictureMarkup, profilePhotosOn, settleDeferredPictures } from './data-saver.js';
import { renderTextWithShareChips, shareChipHtml } from './share-chips.js';
import { armGifPlayers } from './gif-play.js';
import { $currentRouteId, $userRegion, $deviceId } from '../store.js';
import { $account, offerNextTrainAccount } from './account.js';
import { isAdminAuthed } from './admin-chrome.js';
import { haltPanelText } from './reply-suggest.js';
import { closeSmoothModal, openLightbox, openSmoothModal, showToast, triggerHaptic } from './ui.js';
import { bindKeyboardThread } from './keyboard-thread.js';
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
import { FEATURE_KEYS, fetchFeatures, isFeatureEnabled, isCommunityOpenInRegion, isCommunityTabKilled, isListedCommunityRoute } from './features.js';
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
    COMMUNITY_SEE_MORE_WINDOW,
    clipCommunityText,
    communityTextLength,
    DELETED_BY_ADMIN,
    DELETED_MESSAGE,
    isCommunityTombstone,
    sanitizeCommunityAttachments,
    sanitizeCommunityImageUrl,
    sanitizeCommunityLinkUrl,
} from './community-policy.js';

const BODY_MAX = COMMUNITY_BODY_MAX;
/** The box can hold a too-long draft. The send cap is what actually posts. */
const COMPOSER_HOLD_MAX = 8000;

function communityTooLongMessage() {
    return 'That message is too long for one post. Shorten it a little. Your text is still in the box.';
}
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
/** Route whose feed is actually on screen. Opening the tab is not enough. */
let paintedCommunityRouteId = '';
/** True once auth has moved off the default guest placeholder. */
let communityAuthSettled = false;

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
        return `<span class="relative inline-flex w-[1.625rem] h-[1.625rem] shrink-0">
            <img src="${escapeHTML(safePhoto)}" alt="" class="w-[1.625rem] h-[1.625rem] rounded-full object-cover bg-gray-200 dark:bg-gray-700" loading="lazy" onerror="this.classList.add('hidden');const f=this.parentElement.querySelector('.avatar-fallback');if(f)f.classList.remove('hidden');"/>
            <span class="avatar-fallback hidden absolute inset-0 w-[1.625rem] h-[1.625rem] rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">${mark}</span>
        </span>`;
    }
    return `<span class="w-[1.625rem] h-[1.625rem] rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm shrink-0">${mark}</span>`;
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

function sameVisiblePost(a, b) {
    if (!a || !b) return false;
    if (a.postId && b.postId && a.postId === b.postId) return true;
    if (!a.uid || a.uid !== b.uid) return false;
    const bodyA = String(a.body || '').trim();
    const bodyB = String(b.body || '').trim();
    if (!bodyA || bodyA !== bodyB) return false;
    if ((a.replyTo?.postId || '') !== (b.replyTo?.postId || '')) return false;
    return Math.abs((Number(a.timestamp) || 0) - (Number(b.timestamp) || 0)) < 20000;
}

/** One send can land twice (a second tap, or the local copy and the saved copy). Keep one. */
function dedupeFeedPosts(list) {
    const out = [];
    (list || []).forEach((p) => {
        if (!p) return;
        const hit = out.findIndex((q) => sameVisiblePost(q, p));
        if (hit < 0) {
            out.push(p);
            return;
        }
        const prev = out[hit];
        if ((prev.pendingSend && !p.pendingSend) || (!prev.postId && p.postId)) out[hit] = p;
    });
    return out;
}

function mergeOverlayPosts(routeId, list) {
    const acct = $account.get();
    const myUid = acct.status === 'signed-in' ? acct.uid : null;
    const merged = [...list];
    const overlay = (localOverlayByRoute[routeId] || []).filter((p) => p.uid === myUid);
    overlay.forEach((p) => {
        if (!merged.some((q) => sameVisiblePost(q, p))) merged.push(p);
    });
    merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return dedupeFeedPosts(merged);
}

function upsertOutgoingPost(post) {
    if (!post?.postId || !post.routeId) return;
    const bucket = localOverlayByRoute[post.routeId] || (localOverlayByRoute[post.routeId] = []);
    const at = bucket.findIndex((p) => p.postId === post.postId);
    if (at >= 0) bucket[at] = post;
    else bucket.push(post);
    const idx = cachedFeedPosts.findIndex((p) => p.postId === post.postId);
    if (idx >= 0) cachedFeedPosts[idx] = { ...cachedFeedPosts[idx], ...post };
    else cachedFeedPosts = [...cachedFeedPosts, post].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    communityFeedPinned = true;
    applyFeedFilter(post.routeId);
}

function dropOutgoingPost(routeId, postId) {
    if (!routeId || !postId) return;
    if (localOverlayByRoute[routeId]) {
        localOverlayByRoute[routeId] = localOverlayByRoute[routeId].filter((p) => p.postId !== postId);
    }
    cachedFeedPosts = cachedFeedPosts.filter((p) => p.postId !== postId);
    applyFeedFilter(routeId);
}

function receiptMarkHtml(pending) {
    if (pending) {
        return `<span class="community-msg-receipt is-pending" aria-label="Sending"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.6V8.2l2.3 1.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    }
    return `<span class="community-msg-receipt is-sent" aria-label="Sent"><svg viewBox="0 0 18 14" aria-hidden="true"><path d="M1 7.4 3.3 9.8 8.2 4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.4 7.4 7.7 9.8 13.6 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
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
    if (isAdminAuthed()) return true;
    if (isCommunityTabKilled()) return false;
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

let communityDeleteAsk = null;

function askCommunityDelete({ title, body, confirmLabel } = {}) {
    if (communityDeleteAsk) return Promise.resolve(false);
    const modal = document.getElementById('community-delete-modal');
    const prompt = [title, body].filter(Boolean).join('\n\n');
    if (!modal) {
        return Promise.resolve(typeof window.confirm === 'function' ? window.confirm(prompt) : false);
    }
    const pending = new Promise((resolve) => {
        const titleEl = document.getElementById('community-delete-title');
        const bodyEl = document.getElementById('community-delete-body');
        const okBtn = document.getElementById('community-delete-confirm');
        const cancelBtn = document.getElementById('community-delete-cancel');
        if (titleEl) titleEl.textContent = title || 'Delete this message?';
        if (bodyEl) bodyEl.textContent = body || '';
        if (okBtn) okBtn.textContent = confirmLabel || 'Delete';
        let settled = false;
        const finish = (ok) => {
            if (settled) return;
            settled = true;
            communityDeleteAsk = null;
            modal.classList.add('hidden');
            document.removeEventListener('keydown', onKey);
            resolve(!!ok);
        };
        const onKey = (ev) => {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            finish(false);
        };
        modal.onclick = (ev) => {
            if (ev.target === modal) finish(false);
        };
        if (cancelBtn) cancelBtn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            finish(false);
        };
        if (okBtn) okBtn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            finish(true);
        };
        document.addEventListener('keydown', onKey);
        modal.classList.remove('hidden');
        (cancelBtn || okBtn)?.focus();
    });
    communityDeleteAsk = pending;
    return pending;
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

export async function submitCommunityPost(body, routeId = $currentRouteId.get(), options = {}) {
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
    if (text.length > textMax) {
        return { ok: false, message: communityTooLongMessage() };
    }
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

    const postId = options.postId || newId('cp');
    const category = 'general';
    const payload = {
        postId,
        routeId,
        region: $userRegion.get() || 'GP',
        body: text,
        category: COMMUNITY_CATEGORIES[category] ? category : 'general',
        uid: acct.uid,
        displayName: communityNameFor(acct),
        email: acct.email || null,
        deviceId: getDeviceId(),
        timestamp: Date.now(),
        hidden: false,
        replyCount: 0,
        appVersion: APP_VERSION,
        photoURL: null,
        ...(attachments.length ? { attachments: attachments.map((url) => ({ kind: 'image', url })) } : {}),
        ...(linkUrl ? { linkUrl } : {}),
        ...replyToPayload,
    };

    if (typeof options.onStage === 'function') {
        try { options.onStage({ ...payload, pendingSend: true }); } catch { /* the composer can stay if paint fails */ }
    }
    payload.photoURL = await publicCommuterPhoto(acct);

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
            if (!token) return { ok: false, needsAuth: true, postId };
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
                    postId,
                    message: data.error || 'Please wait before you can send another message.',
                    retryAfterMs: data.retryAfterMs || 20000,
                    reason: data.reason || 'cooldown',
                };
            }
            if (data.blocked) {
                return { ok: false, postId, message: data.error || 'That message isn’t allowed.' };
            }
            if (data.held) {
                recordRateHit();
                rememberBody(text);
                return { ok: true, held: true, message: data.message || 'We’re checking this message.' };
            }
            if (res.ok && data.ok) {
                if (data.shadowSilenced) {
                    const shown = { ...payload, ...(data.post || {}), postId: payload.postId, shadowOnly: true };
                    if (!localOverlayByRoute[routeId]) localOverlayByRoute[routeId] = [];
                    const at = localOverlayByRoute[routeId].findIndex((p) => p.postId === payload.postId);
                    if (at >= 0) localOverlayByRoute[routeId][at] = shown;
                    else localOverlayByRoute[routeId].push(shown);
                    recordRateHit();
                    rememberBody(text);
                    return { ok: true, post: shown, shadowSilenced: true };
                }
                recordRateHit();
                rememberBody(text);
                if (!Number.isFinite(Number(data.publicPoints))) {
                    await publishAcceptedCommunityPoints(postId);
                }
                return { ok: true, post: data.post || payload };
            }
            if (data.shadowSilenced) {
                const shown = { ...payload, shadowOnly: true };
                if (!localOverlayByRoute[routeId]) localOverlayByRoute[routeId] = [];
                const at = localOverlayByRoute[routeId].findIndex((p) => p.postId === payload.postId);
                if (at >= 0) localOverlayByRoute[routeId][at] = shown;
                else localOverlayByRoute[routeId].push(shown);
                recordRateHit();
                return { ok: true, post: shown, shadowSilenced: true };
            }
            if (res.status === 401 || res.status === 403) {
                return { ok: false, needsAuth: res.status === 401, postId, message: 'Sign in again to post.' };
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
        return { ok: false, postId, message: safeCommunityWriteError(e?.message) };
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
    if (text.length > BODY_MAX) {
        return { ok: false, message: communityTooLongMessage() };
    }

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
    const items = [];
    document.querySelectorAll('#community-route-list [data-route-raw]').forEach((el) => {
        const name = el.getAttribute('data-route-raw') || '';
        if (!name) return;
        items.push({
            el,
            short: formatRouteDisplayName(name),
            long: formatRouteDisplayName(expandJhbLabel(name)),
            asHtml: false,
        });
    });
    applyFittedLabels(items);
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
            return `<button type="button" class="community-reaction-pill community-reaction-who" data-post-id="${escapeHTML(postId)}" data-route="${escapeHTML(routeId)}" data-emoji="${r.id}" aria-label="Who reacted">${label}</button>`;
        })
        .join('');
    if (!pills) return '';
    return `<div class="community-reaction-pills" data-reactions-for="${escapeHTML(postId)}">${pills}</div>`;
}

function ensureReactionTray() {
    let sheet = document.getElementById('community-reaction-sheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'community-reaction-sheet';
    sheet.className = 'fixed z-[12] hidden w-max max-w-[min(92vw,20rem)]';
    sheet.innerHTML = `
        <div id="community-reaction-tray" class="flex flex-col items-stretch gap-1">
            <div id="community-reaction-sheet-emojis" class="flex items-center gap-0.5 rounded-full border border-white/10 bg-gray-950/95 px-1.5 py-1 text-white shadow-2xl"></div>
        </div>`;
    document.body.appendChild(sheet);
    sheet.style.userSelect = 'none';
    sheet.style.webkitUserSelect = 'none';
    sheet.style.webkitTouchCallout = 'none';
    sheet.addEventListener('contextmenu', (e) => e.preventDefault());
    return sheet;
}

function liveCommunityRow(postId, fallback) {
    const live = [...document.querySelectorAll('.community-post-row')].find((el) => (
        el.isConnected && el.getAttribute('data-post-id') === String(postId)
    ));
    if (live) return live;
    return fallback?.isConnected ? fallback : null;
}

function placeReactionTray() {
    const sheet = document.getElementById('community-reaction-sheet');
    if (!sheet) return;
    if (sheet.parentElement !== document.body) document.body.appendChild(sheet);
    sheet.classList.remove('hidden');
    const width = sheet.offsetWidth || 280;
    const height = sheet.offsetHeight || 48;
    const point = reactionPress || { x: window.innerWidth / 2, y: 180 };
    let left = point.x - (width / 2);
    left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
    const gap = 10;
    const chrome = document.querySelector('#view-community .community-chrome');
    const floor = (chrome?.getBoundingClientRect().bottom || 56) + 4;
    let top = point.y - height - gap;
    if (top < floor) top = point.y + gap;
    const bottomLimit = window.innerHeight - height - 64;
    if (top > bottomLimit) top = Math.max(floor, Math.min(bottomLimit, point.y - height - gap));
    sheet.style.left = `${left}px`;
    sheet.style.top = `${top}px`;
}

function communityMenuIcon(path) {
    return `<svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

function paintCommunityAdminMenu(post) {
    const menu = document.getElementById('community-select-menu');
    const btn = document.getElementById('community-select-menu-btn');
    if (!menu || !btn) return;
    if (!isAdminAuthed() || !post) {
        btn.classList.add('hidden');
        menu.classList.add('hidden');
        menu.innerHTML = '';
        return;
    }
    const tombstone = isCommunityTombstone(post);
    const item = (cls, label, icon, extra = '') => `<button type="button" class="${cls} flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none dark:text-gray-100 dark:hover:bg-gray-700" ${extra} role="menuitem">${icon}<span>${label}</span></button>`;
    menu.innerHTML = [
        tombstone ? '' : item('community-sheet-suggest', 'Suggest reply', communityMenuIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4 11.5-11.5z"/>')),
        item('community-sheet-lookup', 'Look up rider', communityMenuIcon('<circle cx="11" cy="8" r="3"/><path d="M5 19a6 6 0 0112 0"/><circle cx="18" cy="18" r="3"/><path d="M20.2 20.2L22 22"/>')),
        item('community-sheet-delete', 'Remove completely', communityMenuIcon('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>'), 'data-delete-mode="purge" data-delete-as="admin"'),
        !(tombstone && (post?.deletedBy === 'admin' || post?.body === DELETED_BY_ADMIN))
            ? item('community-sheet-delete', 'Deleted by an Admin', communityMenuIcon('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/>'), 'data-delete-mode="tombstone" data-delete-as="admin"')
            : '',
    ].filter(Boolean).join('');
    btn.classList.remove('hidden');
}

function syncCommunitySelectActions(post) {
    const acct = $account.get();
    const mine = !!(acct?.status === 'signed-in' && post?.uid && post.uid === acct.uid);
    const tombstone = isCommunityTombstone(post);
    document.getElementById('community-select-report')?.classList.toggle('hidden', !post || mine || tombstone);
    document.getElementById('community-select-delete')?.classList.toggle('hidden', !post || !mine || tombstone);
    paintCommunityAdminMenu(post);
}

/**
 * Sit the sheet on the bottom bar. The nav's rect is visual-viewport relative.
 * innerHeight can be taller than that visible hole (browser chrome on github.io),
 * and reserving innerHeight minus the visual top lifts the sheet so the composer
 * shows between the card and the bar.
 */
function pinSheetToAppColumn(sheet) {
    const frame = document.getElementById('main-content');
    if (!frame) return;
    const box = frame.getBoundingClientRect();
    if (box.width < 40) return;
    sheet.style.left = `${Math.round(box.left)}px`;
    sheet.style.right = 'auto';
    sheet.style.width = `${Math.round(box.width)}px`;
}

function placeSheetAboveNav(sheet) {
    if (!sheet || sheet.classList.contains('hidden')) return;
    pinSheetToAppColumn(sheet);
    const root = document.documentElement;
    if (root.classList.contains('nt-keyboard')) {
        const kb = parseFloat(getComputedStyle(root).getPropertyValue('--nt-kb-h')) || 0;
        sheet.style.bottom = `${Math.round(kb)}px`;
        return;
    }
    const nav = document.getElementById('bottom-nav');
    const style = nav ? getComputedStyle(nav) : null;
    const shown = !!(nav && style && style.display !== 'none' && style.visibility !== 'hidden' && !nav.classList.contains('hidden'));
    if (!shown) {
        sheet.style.bottom = '0px';
        return;
    }
    const rect = nav.getBoundingClientRect();
    const viewH = window.visualViewport?.height || window.innerHeight;
    sheet.style.bottom = `${Math.max(0, Math.round(viewH - rect.top))}px`;
}

function openReactionChooser(postId, anchorEl) {
    const row = document.querySelector(`.community-post-row[data-post-id="${String(postId).replace(/"/g, '')}"]`);
    const routeId = row?.getAttribute('data-route')
        || document.getElementById('community-route-select')?.value
        || '';
    const rect = anchorEl?.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) {
        reactionPress = { x: rect.left + rect.width / 2, y: rect.top + 4 };
    }
    openReactionSheet(postId, routeId, anchorEl);
    const tray = document.getElementById('community-reaction-sheet');
    if (tray) tray.style.zIndex = '160';
}

function openReactionSheet(postId, routeId, anchorEl) {
    const post = findCachedPost(postId);
    const tombstone = isCommunityTombstone(post);
    if (tombstone) {
        closeReactionSheet();
        return;
    }
    const liveRow = liveCommunityRow(postId, anchorEl);
    reactionAnchor = liveRow || anchorEl || null;
    if (!reactionPress && reactionAnchor?.getBoundingClientRect) {
        const rect = reactionAnchor.getBoundingClientRect();
        if (rect.width || rect.height) reactionPress = { x: rect.left + rect.width / 2, y: rect.top + 8 };
    }
    reactionGuardUntil = Date.now() + 700;
    try { window.getSelection()?.removeAllRanges(); } catch { /* the tray must not sit inside a text selection */ }
    const sheet = ensureReactionTray();
    sheet.dataset.postId = postId;
    sheet.dataset.routeId = routeId;
    sheet.dataset.replyId = '';
    sheet.dataset.uid = post?.uid || '';
    sheet.dataset.email = post?.email || '';
    const { myEmoji } = summarizeReactions(postId);
    const row = sheet.querySelector('#community-reaction-sheet-emojis');
    if (row) {
        row.innerHTML = WA_REACTIONS.map((r) => `
            <button type="button" class="community-react-btn h-10 w-10 text-xl rounded-full ${myEmoji === r.id ? 'bg-white/15 ring-1 ring-white/40' : 'hover:bg-white/10'}" data-post-id="${escapeHTML(postId)}" data-route="${escapeHTML(routeId)}" data-emoji="${r.id}" aria-label="${myEmoji === r.id ? 'Remove reaction' : 'React ' + r.emoji}">${r.emoji}</button>
        `).join('');
    }
    sheet.classList.remove('hidden');
    placeReactionTray();
    triggerHaptic();
}

const COMMUNITY_REACT_ALL = `<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14.2c1.1 1.3 2.4 2 4 2s2.9-.7 4-2"/><circle cx="9" cy="10" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="0.8" fill="currentColor" stroke="none"/></svg>`;

let communityReactFilter = 'all';

function reactorPhoto(uid) {
    const rows = cachedFeedPosts || [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i]?.uid === uid && rows[i].photoURL) return rows[i].photoURL;
    }
    return '';
}

function ensureCommunityReactionsModal() {
    let sheet = document.getElementById('community-reactions-modal');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'community-reactions-modal';
    sheet.className = 'nt-sheet-above-nav fixed inset-x-0 top-0 z-[100] hidden flex flex-col justify-end bg-black/50';
    sheet.innerHTML = `
        <div class="mx-auto flex max-h-[78vh] w-full max-w-md flex-col rounded-t-2xl border-t border-gray-200 bg-white shadow-2xl transform transition-transform duration-300 scale-95 dark:border-gray-700 dark:bg-gray-800">
            <div class="flex justify-center pt-2" aria-hidden="true"><span class="h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600"></span></div>
            <p class="px-4 pb-2 pt-3 text-base font-black text-gray-900 dark:text-white" data-community-react-title>Reactions</p>
            <div class="flex gap-2 overflow-x-auto px-4 pb-2" data-community-react-chips></div>
            <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-community-react-list></div>
        </div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', (e) => {
        if (e.target === sheet) {
            closeReactionSheet();
            closeSmoothModal('community-reactions-modal');
            return;
        }
        const choose = e.target.closest?.('[data-community-react-choose]');
        if (choose && sheet.contains(choose)) {
            e.preventDefault();
            e.stopPropagation();
            openReactionChooser(sheet.dataset.postId || '', choose);
            return;
        }
        const chip = e.target.closest?.('[data-community-react-filter]');
        if (!chip || !sheet.contains(chip)) return;
        e.preventDefault();
        const next = chip.getAttribute('data-community-react-filter') || 'all';
        communityReactFilter = communityReactFilter === next ? 'all' : next;
        void paintCommunityReactionsModal(sheet.dataset.postId || '');
    });
    return sheet;
}

function openCommunityReactionsModal(postId) {
    if (!postId) return;
    closeReactionSheet();
    communityReactFilter = 'all';
    const sheet = ensureCommunityReactionsModal();
    sheet.dataset.postId = String(postId);
    const wasHidden = sheet.classList.contains('hidden');
    void paintCommunityReactionsModal(postId);
    if (wasHidden) openSmoothModal('community-reactions-modal');
    placeSheetAboveNav(sheet);
    requestAnimationFrame(() => placeSheetAboveNav(sheet));
    triggerHaptic();
}

function reactorName(uid) {
    const acct = $account.get();
    const own = acct?.status === 'signed-in' && acct.uid && acct.uid === uid
        ? String(acct.displayName || '').trim()
        : '';
    if (own) return own;
    loadBestPublicNames();
    const profile = publicProfiles.get(uid);
    const fromProfile = String(profile?.displayName || '').trim();
    if (fromProfile) return fromProfile;
    const remembered = bestPublicNames.get(uid)?.name;
    if (remembered) return remembered;
    const post = (cachedFeedPosts || []).find((row) => row?.uid === uid && String(row.displayName || '').trim());
    return String(post?.displayName || '').trim() || 'Passenger';
}

function drawCommunityReactionsModal(sheet, people) {
    const counts = {};
    people.forEach((row) => { counts[row.emojiId] = (counts[row.emojiId] || 0) + 1; });
    const total = people.length;
    const title = sheet.querySelector('[data-community-react-title]');
    if (title) title.textContent = total === 1 ? '1 reaction' : `${total} reactions`;
    const chips = sheet.querySelector('[data-community-react-chips]');
    const chipClass = (on) => `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold ${
        on
            ? 'border-gray-300 bg-gray-200 text-gray-900 dark:border-gray-500 dark:bg-gray-600 dark:text-white'
            : 'border-gray-200 bg-gray-100 text-gray-900 dark:border-gray-600 dark:bg-gray-900/80 dark:text-white'
    }`;
    if (chips) {
        const faces = WA_REACTIONS
            .filter((r) => counts[r.id])
            .sort((a, b) => counts[b.id] - counts[a.id] || WA_REACTIONS.indexOf(a) - WA_REACTIONS.indexOf(b));
        chips.innerHTML = [
            `<button type="button" data-community-react-choose="1" class="${chipClass(false)}" aria-label="Choose a reaction">${COMMUNITY_REACT_ALL}</button>`,
            ...faces.map((r) => {
                const on = communityReactFilter === r.id;
                return `<button type="button" data-community-react-filter="${r.id}" class="${chipClass(on)}" aria-pressed="${on ? 'true' : 'false'}" aria-label="${escapeHTML(r.emoji)} ${counts[r.id]}"><span aria-hidden="true">${r.emoji}</span><span class="tabular-nums">${counts[r.id]}</span></button>`;
            }),
        ].join('');
    }
    const shown = communityReactFilter === 'all'
        ? people
        : people.filter((row) => row.emojiId === communityReactFilter);
    const list = sheet.querySelector('[data-community-react-list]');
    if (!list) return;
    list.innerHTML = shown.map((row) => {
        const name = reactorName(row.uid);
        const emoji = WA_REACTIONS.find((r) => r.id === row.emojiId)?.emoji || '';
        const color = nameColorFor(authorColorKey(row.uid, name));
        return `<div class="flex items-center gap-3 px-2 py-2" data-community-react-person="${escapeHTML(row.uid)}">
            ${renderAvatarHtml(reactorPhoto(row.uid), name, color)}
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">${escapeHTML(name)}</span>
            <span class="text-xl leading-none" aria-hidden="true">${emoji}</span>
        </div>`;
    }).join('');
}

async function paintCommunityReactionsModal(postId) {
    const sheet = document.getElementById('community-reactions-modal');
    if (!sheet || sheet.dataset.postId !== String(postId)) return;
    const byUid = cachedReactionsByPost[postId] || {};
    const people = Object.entries(byUid)
        .map(([uid, entry]) => ({
            uid,
            emojiId: entry?.emoji || '',
            at: Number(entry?.at) || 0,
        }))
        .filter((row) => WA_REACTIONS.some((r) => r.id === row.emojiId))
        .sort((a, b) => b.at - a.at);
    drawCommunityReactionsModal(sheet, people);
    try { await loadPublicProfiles(people.map((row) => row.uid)); } catch { /* a name on a message still shows */ }
    if (sheet.dataset.postId !== String(postId)) return;
    drawCommunityReactionsModal(sheet, people);
}

let selectedCommunity = null;
let reactionAnchor = null;
let reactionGuardUntil = 0;
let reactionPress = null;
let pendingCommunityFocus = null;
let communityFlashPostId = '';
let communityFocusHold = 0;

export function queueCommunityFocus(routeId, postId = '', opts = {}) {
    pendingCommunityFocus = {
        routeId: String(routeId || ''),
        postId: String(postId || ''),
        fetched: false,
        announce: opts.announce === true,
        announced: false,
    };
}

function announceCommunityFocus(focus, found) {
    if (!focus?.announce || focus.announced) return;
    focus.announced = true;
    showToast(
        found ? 'Opened a community message' : 'This message is no longer available',
        found ? 'success' : 'info',
        found ? 2500 : 4000
    );
}

async function fetchOneCommunityPost(routeId, postId) {
    try {
        const q = await authQuery();
        const res = await fetch(`${DYNAMIC_BASE_URL}route_community/${encodeURIComponent(routeId)}/posts/${encodeURIComponent(postId)}.json${q}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || typeof data !== 'object') return null;
        return { ...data, postId: data.postId || postId };
    } catch {
        return null;
    }
}

function communityPostGone(post) {
    return !post || post.deleted || post.hidden || post.removed;
}

async function revealCommunityFocus(routeId) {
    const focus = pendingCommunityFocus;
    if (!focus || focus.routeId !== routeId || !focus.postId) return;
    const cached = findCachedPost(focus.postId);
    if (communityPostGone(cached) && cached) {
        pendingCommunityFocus = null;
        announceCommunityFocus(focus, false);
        return;
    }
    if (!cached && !focus.fetched) {
        focus.fetched = true;
        const one = await fetchOneCommunityPost(routeId, focus.postId);
        if (!communityPostGone(one) && pendingCommunityFocus === focus) {
            cachedFeedPosts = [...cachedFeedPosts.filter((row) => row.postId !== one.postId), one]
                .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
            applyFeedFilter(routeId);
            return;
        }
        if (communityPostGone(one)) {
            pendingCommunityFocus = null;
            announceCommunityFocus(focus, false);
            return;
        }
    }
    pendingCommunityFocus = null;
    const row = [...document.querySelectorAll('.community-post-row')].find((el) => el.getAttribute('data-post-id') === focus.postId);
    if (!row) {
        announceCommunityFocus(focus, false);
        return;
    }
    revealCommunityRow(row);
    announceCommunityFocus(focus, true);
}

/** Scroll the room only. scrollIntoView also moves #app-scroll and leaves a blank under the tab. */
function revealCommunityRow(row, opts = {}) {
    const scroller = row.closest('.community-feed-scroll');
    if (scroller) {
        const box = scroller.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const below = rowRect.bottom - (box.bottom - 16);
        const above = (box.top + 16) - rowRect.top;
        if (below > 0) scroller.scrollTop += below;
        else if (above > 0) scroller.scrollTop -= above;
    }
    const root = document.scrollingElement || document.documentElement;
    if (root) root.scrollTop = 0;
    const app = document.getElementById('app-scroll');
    if (app) app.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch { /* ignore */ }
    const bubble = row.querySelector('.community-bubble');
    if (!opts.keepHold) {
        communityFlashPostId = row.getAttribute('data-post-id') || '';
        communityFocusHold = Date.now() + 2500;
    }
    bubble?.classList.remove('nt-community-force-flash');
    // Restart the ring if the same link is opened twice.
    if (bubble) void bubble.offsetWidth;
    bubble?.classList.add('nt-community-force-flash');
}

function shareOrigin() {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) return location.origin;
    return 'https://nexttrain.co.za';
}

function communityShareUrl(routeId, postId) {
    return `${shareOrigin()}/og/c/${encodeURIComponent(routeId)}/${encodeURIComponent(postId)}`;
}

async function copyPlainText(text) {
    const value = String(text || '').trim().slice(0, 4000);
    if (!value) return false;
    try {
        if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
        await Promise.race([
            navigator.clipboard.writeText(value),
            new Promise((_, reject) => { setTimeout(() => reject(new Error('timeout')), 1500); }),
        ]);
        showToast('Copied', 'success');
        return true;
    } catch {
        try {
            const area = document.createElement('textarea');
            area.value = value;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.left = '-9999px';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            if (ok) {
                showToast('Copied', 'success');
                return true;
            }
        } catch { /* leave the selection bar up */ }
        showToast('Could not copy.', 'error');
        return false;
    }
}

function setCommunitySelecting(on) {
    document.querySelector('#view-community .community-chrome')?.classList.toggle('is-selecting', !!on);
    const home = document.getElementById('community-chrome-home');
    if (on) home?.setAttribute('aria-hidden', 'true');
    else home?.removeAttribute('aria-hidden');
}

function clearCommunitySelection() {
    selectedCommunity = null;
    document.querySelectorAll('.community-post-row.is-selected').forEach((el) => el.classList.remove('is-selected'));
    document.getElementById('community-chrome-home')?.classList.remove('hidden');
    const bar = document.getElementById('community-select-bar');
    bar?.classList.add('hidden');
    bar?.classList.remove('flex');
    setCommunitySelecting(false);
    document.getElementById('community-select-menu')?.classList.add('hidden');
    document.getElementById('community-select-report')?.classList.add('hidden');
    document.getElementById('community-select-delete')?.classList.add('hidden');
    document.getElementById('community-select-menu-btn')?.classList.add('hidden');
    closeReactionSheet();
}

function selectCommunityPost(postId, routeId) {
    const post = findCachedPost(postId);
    if (!post) return;
    selectedCommunity = { post, routeId };
    document.querySelectorAll('.community-post-row').forEach((el) => {
        el.classList.toggle('is-selected', el.getAttribute('data-post-id') === String(postId));
    });
    document.getElementById('community-chrome-home')?.classList.remove('hidden');
    const bar = document.getElementById('community-select-bar');
    bar?.classList.remove('hidden');
    bar?.classList.add('flex');
    setCommunitySelecting(true);
    document.getElementById('community-select-menu')?.classList.add('hidden');
    syncCommunitySelectActions(post);
}

function closeReactionSheet() {
    const tray = document.getElementById('community-reaction-sheet');
    tray?.classList.add('hidden');
    if (tray) tray.style.zIndex = '';
}

function communityActionTarget() {
    const selected = selectedCommunity?.post?.postId ? selectedCommunity : null;
    if (selected) {
        return {
            postId: selected.post.postId,
            routeId: selected.routeId || '',
            post: selected.post,
            uid: selected.post.uid || '',
            email: selected.post.email || '',
        };
    }
    const sheet = document.getElementById('community-reaction-sheet');
    const postId = sheet?.dataset.postId || '';
    const post = findCachedPost(postId);
    return {
        postId,
        routeId: sheet?.dataset.routeId || '',
        post,
        uid: post?.uid || sheet?.dataset.uid || '',
        email: post?.email || sheet?.dataset.email || '',
    };
}

const publicProfiles = new Map();
let feedAuthorMeta = new Map();
let communityFeedPinned = true;
let communityScrollGuardUntil = 0;
let communityScrollGeneration = 0;
let communityOpenAnchor = null;

function beginCommunityOpenAnchor(routeId) {
    const raw = safeStorage.getItem(unreadSeenKey(routeId));
    const n = parseInt(raw || '', 10);
    communityOpenAnchor = {
        routeId,
        seen: Number.isFinite(n) && n > 0 ? n : 0,
        placed: false,
        scrollTop: 0,
    };
}
let profileRepaintRoute = '';
const BEST_POINTS_KEY = 'nt-public-points-v1';
const bestPublicPoints = new Map();
const hintedPointUids = new Set();

function loadBestPublicPoints() {
    if (bestPublicPoints.size) return;
    try {
        const data = JSON.parse(safeStorage.getItem(BEST_POINTS_KEY) || '{}');
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
        safeStorage.setItem(BEST_POINTS_KEY, JSON.stringify(obj));
    } catch {
        /* the in-memory total still covers this visit */
    }
    return n;
}

const PUBLIC_NAMES_KEY = 'nt-public-names-v1';
const bestPublicNames = new Map();

function loadBestPublicNames() {
    if (bestPublicNames.size) return;
    try {
        const data = JSON.parse(safeStorage.getItem(PUBLIC_NAMES_KEY) || '{}');
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
        safeStorage.setItem(PUBLIC_NAMES_KEY, JSON.stringify(obj));
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
    const generation = ++communityScrollGeneration;
    communityScrollGuardUntil = Date.now() + 450;
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (communityFeedPinned || gap < 160) {
        scroller.scrollTop = scroller.scrollHeight;
        requestAnimationFrame(() => {
            if (generation !== communityScrollGeneration) return;
            if (communityFeedPinned || gap < 160) scroller.scrollTop = scroller.scrollHeight;
        });
    }
}

function placeCommunityOpen(routeId, listEl) {
    const scroller = listEl?.closest?.('.community-feed-scroll');
    const anchor = communityOpenAnchor;
    if (!scroller || !anchor || anchor.routeId !== routeId || anchor.placed) return false;
    const generation = ++communityScrollGeneration;
    const mine = $account.get()?.uid || '';
    const rows = [...listEl.querySelectorAll('.community-post-row')];
    const firstNew = anchor.seen > 0
        ? rows.find((row) => Number(row.dataset.ts || 0) > anchor.seen && row.dataset.uid !== mine)
        : null;
    communityScrollGuardUntil = Date.now() + 500;
    const place = () => {
        if (firstNew) {
            const top = firstNew.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
            scroller.scrollTop = Math.max(0, top - 12);
            communityFeedPinned = false;
        } else {
            communityFeedPinned = true;
            scroller.scrollTop = scroller.scrollHeight;
        }
        anchor.scrollTop = scroller.scrollTop;
    };
    place();
    anchor.placed = true;
    requestAnimationFrame(() => {
        if (generation !== communityScrollGeneration) return;
        communityScrollGuardUntil = Date.now() + 400;
        place();
    });
    return true;
}

function bindCommunityFeedPin() {
    const scroller = document.querySelector('#view-community .community-feed-scroll');
    if (!scroller || scroller.dataset.pinBound === '1') return;
    scroller.dataset.pinBound = '1';
    scroller.addEventListener('scroll', () => {
        if (Date.now() < communityScrollGuardUntil) return;
        const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        communityFeedPinned = gap < 160;
    }, { passive: true });
}

function communityImageUrls(post) {
    if (isCommunityTombstone(post)) return [];
    return sanitizeCommunityAttachments(post?.attachments, { admin: true });
}

function communityPictureHtml(url) {
    const inner = pictureMarkup(url);
    // The data-saver hold is already a button. A shown photo gets its own,
    // so a tap stays in the app instead of opening the image host.
    if (inner.includes('data-nt-defer-src')) return inner;
    return `<button type="button" class="community-msg-photo" aria-label="View photo">${inner}</button>`;
}

function renderCommunityMedia(post) {
    if (isCommunityTombstone(post)) return '';
    const images = communityImageUrls(post);
    const imageHtml = images.length
        ? `<div class="community-msg-images${images.length === 1 ? ' is-single' : ''}">${images.map((url) => communityPictureHtml(url)).join('')}</div>`
        : '';
    const link = sanitizeCommunityLinkUrl(post?.linkUrl);
    const linkHtml = link
        ? (shareChipHtml(link) || `<a class="community-msg-link" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${escapeHTML(link.replace(/^https:\/\//, ''))}</a>`)
        : '';
    return `${imageHtml}${linkHtml}`;
}

function communityBodyHtml(post, tombstone) {
    if (tombstone) {
        return escapeHTML(post.deletedBy === 'admin' || post.body === DELETED_BY_ADMIN ? DELETED_BY_ADMIN : DELETED_MESSAGE);
    }
    return String(post.body || '');
}

function communityBubbleTextHtml(body, clock, receipt, tombstone) {
    const time = `<span class="community-msg-time">${clock}${receipt}</span>`;
    if (!body) return `<div class="community-msg-text">${time}</div>`;
    if (tombstone || communityTextLength(body) <= COMMUNITY_SEE_MORE_WINDOW) {
        const shown = tombstone ? body : renderTextWithShareChips(body);
        return `<div class="community-msg-text${tombstone ? ' community-msg-deleted' : ''}">${shown}${time}</div>`;
    }
    const clipped = renderTextWithShareChips(clipCommunityText(body, COMMUNITY_SEE_MORE_WINDOW));
    return `<div class="community-msg-text" data-community-see-step="1"><span class="community-msg-copy">${clipped}</span>${time}<button type="button" class="nt-alert-see-more community-see-more" data-community-see-more>See more...</button><template data-community-full>${escapeHTML(body)}</template></div>`;
}

function expandCommunitySeeMore(button) {
    const box = button.closest('.community-msg-text');
    const copy = box?.querySelector('.community-msg-copy');
    const template = box?.querySelector('template[data-community-full]');
    if (!box || !copy || !template) {
        button.remove();
        return;
    }
    const full = template.content?.textContent || '';
    const step = Math.max(1, Number(box.getAttribute('data-community-see-step')) || 1);
    const next = step + 1;
    const limit = COMMUNITY_SEE_MORE_WINDOW * next;
    if (communityTextLength(full) > limit) {
        copy.innerHTML = renderTextWithShareChips(clipCommunityText(full, limit));
        box.setAttribute('data-community-see-step', String(next));
        return;
    }
    copy.innerHTML = renderTextWithShareChips(full);
    button.remove();
    template.remove();
    box.removeAttribute('data-community-see-step');
}

function renderPostCard(post, routeId, { grouped = false } = {}) {
    const tombstone = isCommunityTombstone(post);
    const body = communityBodyHtml(post, tombstone);
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
      <div class="community-post-row ${isOwn ? 'justify-end' : 'justify-start gap-1'}${grouped ? ' is-grouped' : ''}${tombstone ? ' is-deleted' : ''}" data-post-id="${postId}" data-route="${escapeHTML(routeId)}" data-uid="${uid}" data-ts="${Number(post.timestamp) || 0}"${tombstone ? ' data-deleted="1"' : ''}>
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
                ${communityBubbleTextHtml(body, clock, isOwn && !tombstone ? receiptMarkHtml(!!post.pendingSend) : '', tombstone)}
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
    const posts = dedupeFeedPosts(cachedFeedPosts);
    feedAuthorMeta = latestAuthorMeta(posts);
    bindCommunityFeedPin();

    if (!posts.length) {
        listEl.innerHTML = '';
        wireCommunityChatGestures(listEl);
        if (emptyEl) {
            emptyEl.classList.remove('hidden');
            emptyEl.innerHTML = `<p class="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">No posts on this line yet</p>
                   <p class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">Be the first to share a heads-up, or ask a question.</p>`;
        }
        const focusingEmpty = pendingCommunityFocus && pendingCommunityFocus.routeId === routeId && pendingCommunityFocus.postId;
        if (focusingEmpty) void revealCommunityFocus(routeId);
        rememberPaintedCommunityRoute(routeId);
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    let html = '';
    let lastDate = '';
    let prevUid = '';
    const scroller = listEl.closest('.community-feed-scroll');
    const prevTop = scroller ? scroller.scrollTop : 0;
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
    if (selectedCommunity && selectedCommunity.routeId === routeId) {
        const id = String(selectedCommunity.post?.postId || '').replace(/"/g, '');
        const still = id ? listEl.querySelector(`[data-post-id="${id}"]`) : null;
        if (still) {
            still.classList.add('is-selected');
            const fresh = findCachedPost(id) || selectedCommunity.post;
            selectedCommunity.post = fresh;
            syncCommunitySelectActions(fresh);
        } else clearCommunitySelection();
    }
    const focusing = pendingCommunityFocus && pendingCommunityFocus.routeId === routeId && pendingCommunityFocus.postId;
    const heldId = communityFlashPostId;
    const heldRow = heldId ? listEl.querySelector(`[data-post-id="${String(heldId).replace(/"/g, '')}"]`) : null;
    if (focusing) void revealCommunityFocus(routeId);
    else if (heldRow && Date.now() < communityFocusHold) revealCommunityRow(heldRow, { keepHold: true });
    else if (communityOpenAnchor?.routeId === routeId && !communityOpenAnchor.placed && profileRepaintRoute !== routeId) {
        placeCommunityOpen(routeId, listEl);
    } else if (profileRepaintRoute === routeId || (communityOpenAnchor?.routeId === routeId && communityOpenAnchor.placed && !communityFeedPinned) || (feedSilentRepaint && !communityFeedPinned)) {
        if (scroller) {
            communityScrollGeneration += 1;
            communityScrollGuardUntil = Date.now() + 400;
            scroller.scrollTop = prevTop;
        }
    } else pinCommunityFeedToLatest();
    rememberPaintedCommunityRoute(routeId);
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
    listEl.addEventListener('selectstart', (e) => e.preventDefault());

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

    const communityInlineControl = (target) => target?.closest?.('.community-share-chip, .community-msg-link, [data-community-see-more]');

    listEl.addEventListener('touchstart', (e) => {
        if (communityInlineControl(e.target)) return;
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
            if (postId && routeId) {
                reactionPress = { x: startX, y: startY };
                try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
                const live = liveCommunityRow(postId, row);
                openReactionSheet(postId, routeId, live);
                selectCommunityPost(postId, routeId);
            }
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
        if (communityInlineControl(e.target)) return;
        const row = e.target.closest?.('.community-post-row');
        if (!row) return;
        e.preventDefault();
        row.classList.add('is-pressing');
        const postId = row.getAttribute('data-post-id');
        const routeId = row.getAttribute('data-route');
        reactionPress = { x: e.clientX, y: e.clientY };
        try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
        const live = liveCommunityRow(postId, row);
        openReactionSheet(postId, routeId, live);
        selectCommunityPost(postId, routeId);
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
    const selected = document.getElementById('community-route-select')?.value || '';
    if (!selected || selected !== paintedCommunityRouteId) return '';
    return selected;
}

/** Mark only the room whose messages are on screen. Other rooms keep their counts. */
function rememberPaintedCommunityRoute(routeId) {
    if (!routeId || safeStorage.getItem('activeTab') !== 'community') return;
    const selected = document.getElementById('community-route-select')?.value || '';
    if (selected !== routeId) return;
    paintedCommunityRouteId = routeId;
    if (feedSilentRepaint || profileRepaintRoute === routeId) return;
    markCommunityRouteSeen(routeId);
    refreshCommunityUnreadBadge();
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

/**
 * A signed-in count waits until this account's seen cursors have loaded.
 * A guest count waits until auth has settled, so a restoring session
 * does not paint every recent message as unread and then clear it.
 */
export function communityUnreadMayCount(status, opts = {}) {
    if (status === 'signed-in') return opts.seenLoaded === true;
    if (status === 'guest') return opts.authSettled === true;
    return false;
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
    if (acct?.status !== 'signed-in' || !acct.uid) return undefined;
    const now = Date.now();
    if (accountSeenCache.uid === acct.uid && accountSeenCache.map && now - accountSeenCache.at < 60 * 1000) {
        return accountSeenCache.map;
    }
    try {
        const q = await authQuery();
        if (!q) return null;
        const res = await fetch(
            `${DYNAMIC_BASE_URL}users/${encodeURIComponent(acct.uid)}/community_seen.json${q}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        const map = data && typeof data === 'object' ? data : {};
        accountSeenCache = { uid: acct.uid, at: now, map };
        return map;
    } catch {
        return null;
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
    const acct = $account.get();
    const signedIn = acct?.status === 'signed-in' && !!acct.uid;
    let accountSeen = null;
    if (signedIn) {
        accountSeen = await readAccountCommunitySeen();
        if (token !== unreadRefreshToken) return 0;
    }
    const mayCount = communityUnreadMayCount(acct?.status, {
        seenLoaded: signedIn && accountSeen != null,
        authSettled: communityAuthSettled,
    });
    if (!mayCount) return Object.values(cachedUnreadByRoute).reduce((sum, n) => sum + (Number(n) || 0), 0);
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

    const next = {};
    await Promise.all(routes.map(async (r) => {
        next[r.id] = await countUnreadOnRoute(r.id, viewing, signedIn ? accountSeen : null);
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
    const noteAccount = (acct) => {
        if (acct?.status === 'loading' || acct?.status === 'pending' || acct?.status === 'signed-in') {
            communityAuthSettled = true;
        }
        if (acct?.status === 'guest' && window.firebaseAuth && (!window.firebaseAuth.currentUser || window.firebaseAuth.currentUser.isAnonymous)) {
            communityAuthSettled = true;
        }
        if ((acct?.uid || '') !== (accountSeenCache.uid || '')) {
            accountSeenCache = { uid: acct?.uid || '', at: 0, map: null };
        }
    };
    noteAccount($account.get());
    $account.subscribe((acct) => {
        noteAccount(acct);
        refreshCommunityUnreadBadge();
    });
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
    if (!feedSilentRepaint) beginCommunityOpenAnchor(routeId);

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
    const openId = paintedCommunityRouteId && routeSel.value === paintedCommunityRouteId ? routeSel.value : '';
    const triggerUnread = document.getElementById('community-route-unread');
    if (triggerUnread) {
        const other = Object.entries(cachedUnreadByRoute)
            .filter(([id, n]) => n > 0 && id !== openId)
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
            const unread = r.id === openId ? 0 : (cachedUnreadByRoute[r.id] || 0);
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
    if (open) {
        requestAnimationFrame(() => {
            fitCommunityRouteLabels();
            paintCommunityRouteMore();
        });
    } else {
        list.classList.remove('has-more-below');
    }
}

function paintCommunityRouteMore() {
    const list = document.getElementById('community-route-list');
    if (!list || list.classList.contains('hidden')) return;
    const more = list.scrollHeight - list.clientHeight - list.scrollTop > 6;
    list.classList.toggle('has-more-below', more);
}

const KIND_PLACEHOLDER = 'Please be kind and respectful.';
const COMPOSER_DRAFT_KEY = 'ntCommunityComposerDraft';

function rememberComposerDraft(value) {
    const text = String(value ?? '');
    if (text) safeStorage.setItem(COMPOSER_DRAFT_KEY, text);
    else safeStorage.removeItem(COMPOSER_DRAFT_KEY);
}

function fitCommunityComposer(el) {
    if (!el) return;
    const cap = 160;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 60), cap);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > cap + 2 ? 'auto' : 'hidden';
    const end = el.selectionEnd ?? el.value.length;
    if (el.style.overflowY === 'auto' && end >= el.value.length - 1) el.scrollTop = el.scrollHeight;
}

function restoreComposerDraft(composer) {
    const el = composer || document.getElementById('community-composer');
    if (!el || el.value) return;
    const saved = safeStorage.getItem(COMPOSER_DRAFT_KEY) || '';
    if (!saved) return;
    el.value = saved;
    fitCommunityComposer(el);
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

function syncCommunityCopilot() {
    const box = document.getElementById('community-copilot');
    if (!box) return;
    const visible = (id) => {
        const el = document.getElementById(id);
        return !!(el && !el.classList.contains('hidden'));
    };
    const show = isAdminAuthed() && (visible('community-suggest-halt') || visible('community-suggest-status'));
    box.classList.toggle('hidden', !show);
}

function setCommunityGuideReady(on) {
    document.getElementById('community-guide-open')?.classList.toggle('hidden', !on);
    syncCommunityCopilot();
}

const CHAR_HINT_REMAINING = 400;

function paintCommunityCharHint() {
    const el = document.getElementById('community-char-hint');
    const composer = document.getElementById('community-composer');
    if (!el || !composer) return;
    const max = isAdminAuthed() ? COMMUNITY_ADMIN_BODY_MAX : BODY_MAX;
    const left = max - String(composer.value || '').length;
    const postBtn = document.getElementById('community-post-btn');
    if (postBtn && !communityPostBusy) postBtn.disabled = left < 0;
    if (left > CHAR_HINT_REMAINING) {
        el.hidden = true;
        el.textContent = '';
        el.classList.remove('is-over');
        return;
    }
    el.hidden = false;
    el.classList.toggle('is-over', left < 0);
    el.textContent = left < 0
        ? 'Over the limit. Shorten it or it will not send.'
        : `${left} characters left`;
}

function syncComposerChrome() {
    const composer = document.getElementById('community-composer');
    if (!composer) return;
    composer.disabled = false;
    const operator = isAdminAuthed();
    composer.maxLength = COMPOSER_HOLD_MAX;
    document.getElementById('community-attach-btn')?.classList.toggle('hidden', !operator);
    composer.classList.toggle('community-composer-with-clip', operator);
    syncCommunityCopilot();
    restoreComposerDraft(composer);
    paintCommunityCharHint();
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

function communityImageAlreadyStored(url) {
    const clean = sanitizeCommunityImageUrl(url);
    if (!clean) return false;
    if (clean.startsWith('/images/')) return true;
    try {
        const parsed = new URL(clean);
        const host = parsed.hostname.toLowerCase();
        const ours = host === 'nexttrain-community.enock.workers.dev'
            || /^nexttrain-community\.[a-z0-9-]+\.workers\.dev$/.test(host);
        return ours && (parsed.pathname.startsWith('/community-images/') || parsed.pathname.startsWith('/alerts/'));
    } catch {
        return false;
    }
}

async function uploadCommunityPhoto(file) {
    if (!file) return '';
    if (file.size > 4 * 1024 * 1024) {
        showToast('Photo is too large. Max 4MB.', 'error');
        return '';
    }
    const token = await ensureAuthToken();
    if (!token) {
        showToast('Sign in again to add a photo.', 'error');
        return '';
    }
    const res = await fetch(`${communityWorkerBase().replace(/\/$/, '')}/community/image`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
        showToast(data.error || 'Could not store that photo.', 'error');
        return '';
    }
    return data.url;
}

async function importCommunityPhoto(raw) {
    const token = await ensureAuthToken();
    if (!token) {
        showToast('Sign in again to add a photo.', 'error');
        return '';
    }
    const res = await fetch(`${communityWorkerBase().replace(/\/$/, '')}/community/image-from-url`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: raw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
        showToast(data.error || 'Could not store that photo.', 'error');
        return '';
    }
    return data.url;
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

async function addAdminAddress(raw) {
    const value = String(raw || '').trim();
    if (!value) return;
    if (sanitizeCommunityImageUrl(value)) {
        const stored = communityImageAlreadyStored(value) ? value : await importCommunityPhoto(value);
        if (stored) addAdminImage(stored);
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
    const composer = document.getElementById('community-composer');
    const errEl = document.getElementById('community-error');
    const routeId = document.getElementById('community-route-select')?.value || $currentRouteId.get();
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const loaded = routeId ? await communityPostsSince(routeId, since) : [];
    const focus = findCachedPost(focusPostId) || loaded.find((p) => p?.postId === focusPostId) || null;
    const adminAuthor = (p) => {
        const mine = $account.get()?.uid && p.uid === $account.get().uid;
        return !!(mine || ['enockelk@gmail.com', 'thandeka05nxumalo@gmail.com'].includes(String(p?.email || '').toLowerCase()));
    };
    // The held message is the only thing to answer. The rest of the room
    // was making Co-Pilot reply to older posts. One message, priority 10.
    let target = focus && !isCommunityTombstone(focus) ? focus : null;
    if (!target) {
        target = [...loaded].reverse().find((p) => p && !isCommunityTombstone(p) && (p.body || p.linkUrl) && !adminAuthor(p)) || null;
    }
    const thread = target
        ? [{
            from: adminAuthor(target) ? 'admin' : 'commuter',
            text: `${target.displayName || 'Passenger'}: ${target.body || target.linkUrl || ''}`,
            at: Number(target.timestamp) || 0,
        }]
        : [];
    if (!thread.length) {
        if (errEl) errEl.textContent = 'Nothing in this room to answer yet.';
        return;
    }
    const token = await ensureAuthToken();
    if (!token) {
        showToast('Sign in again to use Co-Pilot.', 'error');
        return;
    }
    const status = document.getElementById('community-suggest-status');
    const statusText = document.getElementById('community-suggest-status-text');
    const halt = document.getElementById('community-suggest-halt');
    const guideBtn = document.getElementById('community-guide-open');
    guideBtn?.classList.add('hidden');
    if (errEl) errEl.textContent = '';
    if (status && statusText) {
        status.classList.remove('hidden');
        statusText.textContent = 'Reading this message and writing a reply.';
        syncCommunityCopilot();
    }
    const guidance = [
        document.getElementById('community-guide-text')?.value || '',
        document.getElementById('community-suggest-context')?.value || '',
    ].map((part) => String(part || '').trim()).filter(Boolean).join('\n');
    const roomNote = 'PRIORITY: the held message. Answer only the single message in this thread. Do not answer any other message. One short reply an operator can post. No email sign-off.';
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
                note: guidance ? `${roomNote}\n\nOperator guidance for this draft:\n${guidance}` : roomNote,
                thread,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Co-Pilot could not draft a reply.');
        if (data.action === 'halt') {
            const text = haltPanelText(data) || data.reason || 'Co-Pilot needs a fact before it can draft this.';
            const haltText = document.getElementById('community-suggest-halt-text');
            if (haltText) haltText.textContent = text;
            halt?.classList.remove('hidden');
            guideBtn?.classList.add('hidden');
            syncCommunityCopilot();
            return;
        }
        const draft = String(data.reply || '').trim();
        if (!draft) {
            if (errEl) errEl.textContent = 'Co-Pilot returned an empty draft.';
            return;
        }
        halt?.classList.add('hidden');
        guideBtn?.classList.remove('hidden');
        syncCommunityCopilot();
        if (composer) {
            composer.value = draft.slice(0, COMPOSER_HOLD_MAX);
            fitCommunityComposer(composer);
            rememberComposerDraft(composer.value);
            composer.focus();
            if (draft.length > COMMUNITY_ADMIN_BODY_MAX && errEl) {
                errEl.textContent = communityTooLongMessage();
            }
            paintCommunityCharHint();
        }
    } catch (err) {
        showToast(err?.message || 'Co-Pilot could not draft a reply.', 'error');
    } finally {
        status?.classList.add('hidden');
        syncCommunityCopilot();
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
    const requested = pendingCommunityFocus?.routeId || opts.routeId || getLastCommunityRoom() || $currentRouteId.get() || getPinnedRouteId() || '';
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

let communityPostBusy = false;

async function handlePostSubmit() {
    if (communityPostBusy) return;
    communityPostBusy = true;
    try {
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

    const draft = body;
    let stagedId = '';
    const result = await submitCommunityPost(body, routeId, {
        onStage(post) {
            stagedId = post.postId;
            if (composer) {
                composer.value = '';
                composer.style.height = '';
            }
            rememberComposerDraft('');
            upsertOutgoingPost(post);
        },
    });
    paintCommunityQuotaHint();
    if (!result.ok) {
        const failedId = result.postId || stagedId;
        if (failedId) dropOutgoingPost(routeId, failedId);
        if (composer && draft && !composer.value) {
            composer.value = draft;
            fitCommunityComposer(composer);
            rememberComposerDraft(draft);
        }
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

    const typedFlat = String(draft || '').replace(/\s+/g, ' ').trim();
    const sentFlat = String(result.post?.body || '').replace(/\s+/g, ' ').trim();
    const cutShort = !result.held && typedFlat.length > sentFlat.length && sentFlat.length > 0 && typedFlat.startsWith(sentFlat);
    if (cutShort) {
        const failedId = result.post?.postId || result.postId || stagedId;
        if (failedId) dropOutgoingPost(routeId, failedId);
        if (composer && draft) {
            composer.value = draft;
            fitCommunityComposer(composer);
            rememberComposerDraft(draft);
        }
        if (errEl) errEl.textContent = communityTooLongMessage();
        paintCommunityCharHint();
        if (btn) btn.disabled = false;
        return;
    }
    if (result.held) {
        const heldId = result.post?.postId || result.postId || stagedId;
        if (heldId) dropOutgoingPost(routeId, heldId);
    } else if (result.post) {
        upsertOutgoingPost({ ...result.post, pendingSend: false });
    }
    if (composer && composer.value) {
        composer.value = '';
        composer.style.height = '';
    }
    rememberComposerDraft('');
    setCommunityGuideReady(false);
    paintCommunityCharHint();
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
    } finally {
        communityPostBusy = false;
    }
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
        <input type="text" maxlength="${COMPOSER_HOLD_MAX}" class="community-reply-input flex-1 p-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="Write a reply…" data-post-id="${escapeHTML(postId)}" />
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

    document.getElementById('community-select-back')?.addEventListener('click', (e) => {
        e.preventDefault();
        clearCommunitySelection();
    });
    document.getElementById('community-select-copy')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const post = selectedCommunity?.post;
        if (!post) return;
        const link = communityShareUrl(selectedCommunity.routeId, post.postId);
        let text = String(post.body || '').slice(0, 8000)
            .replace(/<img\b[^>]*>/gi, ' ')
            .replace(/\bdata:[^,\s]{0,80},[a-z0-9+/=\s]{40,}/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length < 12) text = text ? `${text}\n${link}` : link;
        copyPlainText(text);
    });
    document.getElementById('community-select-share')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const post = selectedCommunity?.post;
        if (!post) return;
        const url = communityShareUrl(selectedCommunity.routeId, post.postId);
        if (typeof navigator.share === 'function') {
            try {
                await navigator.share({ url });
                return;
            } catch (err) {
                if (err?.name === 'AbortError') return;
                try {
                    await navigator.share({ text: url });
                    return;
                } catch (err2) {
                    if (err2?.name === 'AbortError') return;
                }
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            showToast('Link copied', 'success');
        } catch {
            showToast('Could not share.', 'error');
        }
    });
    document.getElementById('community-select-menu-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const menu = document.getElementById('community-select-menu');
        const opening = menu?.classList.contains('hidden');
        if (opening) closeReactionSheet();
        menu?.classList.toggle('hidden');
    });

    document.getElementById('community-post-btn')?.addEventListener('click', () => handlePostSubmit());
    document.getElementById('community-suggest-again')?.addEventListener('click', () => { suggestCommunityReply(); });
    document.getElementById('community-composer')?.addEventListener('input', () => {
        paintCommunityCharHint();
        if (!document.getElementById('community-composer')?.value) setCommunityGuideReady(false);
    });
    const closeCommunityGuide = () => document.getElementById('community-guide-modal')?.classList.add('hidden');
    document.getElementById('community-guide-open')?.addEventListener('click', () => {
        document.getElementById('community-guide-modal')?.classList.remove('hidden');
    });
    document.getElementById('community-guide-close')?.addEventListener('click', closeCommunityGuide);
    document.getElementById('community-guide-cancel')?.addEventListener('click', closeCommunityGuide);
    document.getElementById('community-guide-modal')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeCommunityGuide();
    });
    document.getElementById('community-guide-go')?.addEventListener('click', () => {
        const guide = document.getElementById('community-guide-text')?.value || '';
        const context = document.getElementById('community-suggest-context');
        if (context) context.value = guide;
        closeCommunityGuide();
        suggestCommunityReply();
    });
    document.getElementById('community-attach-btn')?.addEventListener('click', () => {
        const modal = document.getElementById('community-attach-modal');
        if (!modal || !isAdminAuthed()) return;
        if (modal.parentElement !== document.body) document.body.appendChild(modal);
        modal.classList.remove('hidden');
        placeSheetAboveNav(modal);
        requestAnimationFrame(() => placeSheetAboveNav(modal));
        fillCommunityPosterSelect();
    });
    document.getElementById('community-attach-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });
    document.getElementById('community-attach-add')?.addEventListener('click', () => {
        const input = document.getElementById('community-attach-url');
        const value = input?.value || '';
        if (input) input.value = '';
        addAdminAddress(value);
    });
    document.getElementById('community-attach-file')?.addEventListener('change', async (e) => {
        const input = e.target;
        const file = input.files?.[0];
        input.value = '';
        if (!file || !isAdminAuthed()) return;
        const url = await uploadCommunityPhoto(file);
        if (url) addAdminImage(url);
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
        paintCommunityQuotaHint();
    });
    document.getElementById('community-route-trigger')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = document.getElementById('community-route-list');
        const open = list?.classList.contains('hidden');
        setCommunityRouteListOpen(!!open);
    });
    document.getElementById('community-route-list')?.addEventListener('scroll', () => paintCommunityRouteMore(), { passive: true });
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
    bindKeyboardThread();
    const placeOpenSheets = () => {
        placeSheetAboveNav(document.getElementById('community-reactions-modal'));
        placeSheetAboveNav(document.getElementById('community-attach-modal'));
    };
    window.visualViewport?.addEventListener('resize', placeOpenSheets, { passive: true });
    window.visualViewport?.addEventListener('scroll', placeOpenSheets, { passive: true });
    composerEl?.addEventListener('input', () => {
        rememberComposerDraft(composerEl.value);
        // Auto-grow with new lines (WhatsApp-style), capped
        fitCommunityComposer(composerEl);
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

    document.addEventListener('pointerdown', (e) => {
        if (Date.now() < reactionGuardUntil) return;
        const sheet = document.getElementById('community-reaction-sheet');
        const menu = document.getElementById('community-select-menu');
        const bar = document.getElementById('community-select-bar');
        const trayOpen = !!(sheet && !sheet.classList.contains('hidden'));
        const menuOpen = !!(menu && !menu.classList.contains('hidden'));
        const selecting = !!(bar && !bar.classList.contains('hidden'));
        if (!trayOpen && !menuOpen && !selecting) return;
        if (e.target.closest?.('#community-reaction-sheet, #community-reactions-modal, #community-select-bar, #community-select-menu, #community-delete-modal')) return;
        closeReactionSheet();
        menu?.classList.add('hidden');
        clearCommunitySelection();
    }, true);

    document.addEventListener('click', async (e) => {
        const t = e.target;
        if (t.closest?.('#community-delete-modal')) return;

        const seeMore = t.closest?.('[data-community-see-more]');
        if (seeMore) {
            e.preventDefault();
            e.stopPropagation();
            expandCommunitySeeMore(seeMore);
            return;
        }

        const photo = t.closest?.('.community-msg-photo, .community-msg-images img, .community-msg-images .nt-gif, .community-msg-images a');
        if (photo?.closest?.('.community-msg-images')) {
            if (t.closest?.('[data-nt-defer-src], [data-nt-gif-replay]')) return;
            if (Date.now() < reactionGuardUntil) return;
            e.preventDefault();
            const img = photo.tagName === 'IMG' ? photo : photo.querySelector('img');
            const src = img?.dataset?.ntGifSrc || img?.dataset?.ntGifPlay || img?.currentSrc || img?.getAttribute?.('src') || photo.getAttribute?.('href') || '';
            // The viewer treats a bare image as an unloaded poster and refuses
            // to open it. The button around the photo is the poster host.
            const host = img?.closest?.('.community-msg-photo') || img || photo;
            if (host?.setAttribute) host.setAttribute('data-alert-ready', '1');
            if (src) openLightbox(src, host);
            return;
        }

        const whoPill = t.closest?.('.community-reaction-who');
        if (whoPill) {
            e.preventDefault();
            openCommunityReactionsModal(whoPill.getAttribute('data-post-id'));
            return;
        }

        const selectedRow = t.closest?.('.community-post-row.is-selected');
        if (selectedRow && !t.closest('button, a') && Date.now() >= reactionGuardUntil) {
            clearCommunitySelection();
            return;
        }

        const sheetReply = t.closest?.('.community-sheet-reply');
        if (sheetReply) {
            e.preventDefault();
            const target = communityActionTarget();
            closeReactionSheet();
            if (target.post) setReplyDraft(target.post, target.routeId);
            return;
        }

        const sheetReport = t.closest?.('.community-sheet-report');
        if (sheetReport) {
            e.preventDefault();
            const target = communityActionTarget();
            const acct = $account.get();
            const ownMessage = !!(acct?.status === 'signed-in' && target.post?.uid && target.post.uid === acct.uid);
            closeReactionSheet();
            document.getElementById('community-select-menu')?.classList.add('hidden');
            if (!target.postId || ownMessage) return;
            const result = await submitModerationReport({
                type: 'message',
                routeId: target.routeId || document.getElementById('community-route-select')?.value || $currentRouteId.get(),
                targetPostId: target.postId,
                targetUid: target.uid,
                snippet: String(target.post?.body || '').slice(0, 80),
            });
            showToast(result.ok ? 'Thanks - report sent to moderation.' : (result.message || 'Report failed'), result.ok ? 'success' : 'error');
            if (result.ok) clearCommunitySelection();
            return;
        }

        const sheetDelete = t.closest?.('.community-sheet-delete');
        if (sheetDelete) {
            e.preventDefault();
            const target = communityActionTarget();
            const postId = target.postId || '';
            const routeId = target.routeId || '';
            const replyId = document.getElementById('community-reaction-sheet')?.dataset.replyId || '';
            const mode = sheetDelete.getAttribute('data-delete-mode') === 'purge' ? 'purge' : 'tombstone';
            const as = sheetDelete.getAttribute('data-delete-as') === 'author' ? 'author' : 'admin';
            if (as === 'admin' && !isAdminAuthed()) return;
            if (as === 'author') {
                const acct = $account.get();
                const ownMessage = !!(acct?.status === 'signed-in' && target.post?.uid && target.post.uid === acct.uid);
                if (!ownMessage) return;
            }
            closeReactionSheet();
            document.getElementById('community-select-menu')?.classList.add('hidden');
            if (!routeId || !postId) return;
            const ask = mode === 'purge'
                ? {
                    title: 'Remove this message?',
                    body: 'This takes the bubble away. Quotes people already made keep their text.',
                    confirmLabel: 'Remove',
                }
                : (as === 'admin'
                    ? {
                        title: 'Deleted by an Admin?',
                        body: 'The bubble will say Deleted by an Admin. Quotes people already made keep their text.',
                        confirmLabel: 'Delete',
                    }
                    : {
                        title: 'Delete this message?',
                        body: 'It will say Deleted message. Quotes people already made keep their text.',
                        confirmLabel: 'Delete',
                    });
            const ok = await askCommunityDelete(ask);
            if (!ok) return;
            clearCommunitySelection();
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
            const focusId = communityActionTarget().postId || '';
            closeReactionSheet();
            document.getElementById('community-select-menu')?.classList.add('hidden');
            suggestCommunityReply(focusId);
            return;
        }

        const sheetLookup = t.closest?.('.community-sheet-lookup');
        if (sheetLookup) {
            e.preventDefault();
            if (!isAdminAuthed()) return;
            const target = communityActionTarget();
            const uid = target.uid || '';
            const email = target.email || '';
            closeReactionSheet();
            document.getElementById('community-select-menu')?.classList.add('hidden');
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
            clearCommunitySelection();
            const rid = document.getElementById('community-route-select')?.value || routeId;
            applyFeedFilter(rid);
            closeReactionSheet();
            const who = document.getElementById('community-reactions-modal');
            if (who && !who.classList.contains('hidden') && who.dataset.postId === String(postId)) {
                void paintCommunityReactionsModal(postId);
            }
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
    window.addEventListener('nt-features-updated', () => {
        if (safeStorage.getItem('activeTab') !== 'community') return;
        const routeId = document.getElementById('community-route-select')?.value || '';
        if (!routeId || isListedCommunityRoute(routeId)) return;
        if (!isCommunityOpenInRegion($userRegion.get())) return;
        openRouteCommunity();
    });
    window.addEventListener('ntdatasaver', () => {
        const view = document.getElementById('view-community');
        if (!view || view.classList.contains('hidden')) return;
        const routeId = document.getElementById('community-route-select')?.value || '';
        if (routeId) applyFeedFilter(routeId);
    });
    window.openRouteCommunity = openRouteCommunity;
    window.queueCommunityFocus = queueCommunityFocus;
    window.renderCommunityFeed = renderCommunityFeed;
    window.leaveCommunityRoom = leaveCommunityRoom;
}
