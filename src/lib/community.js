/**
 * Phase 6 — Route community (v1 chronological feed)
 *
 * RTDB:
 *   route_community/{routeId}/posts/{postId}
 *   route_community/{routeId}/posts/{postId}/replies/{replyId}
 *   moderation_queue/{reportId}
 *
 * Shadow-ban policy: rules reject writes; client still shows the author's
 * own post in a session overlay so they appear silenced without schema rewrites.
 */
import { APP_VERSION, DYNAMIC_BASE_URL, ROUTES } from './config.js';
import { safeStorage, escapeHTML } from './utils.js';
import { $currentRouteId, $userRegion, $deviceId } from '../store.js';
import { $account } from './account.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';
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

const BODY_MAX = 280;
const FEED_LIMIT = 40;
const RATE_KEY = 'communityPostRateV1';
const AUTH_GLOBAL_MS = 30 * 60 * 1000;
const AUTH_GLOBAL_MAX = 8;
const AUTH_COOLDOWN_MS = 20 * 1000;

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

/** @type {Record<string, object[]>} local-only posts for shadow-banned authors */
const localOverlayByRoute = {};

function getDeviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown';
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
        const list = Object.values(data)
            .filter((p) => p && typeof p === 'object' && p.body)
            .filter((p) => {
                if (p.hidden && p.uid !== myUid) return false;
                if (p.shadowOnly && p.uid !== myUid) return false;
                return true;
            })
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        const overlay = (localOverlayByRoute[routeId] || []).filter((p) => p.uid === myUid);
        const ids = new Set(list.map((p) => p.postId));
        overlay.forEach((p) => {
            if (!ids.has(p.postId)) list.push(p);
        });
        list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        return list;
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
    const category = document.getElementById('community-category')?.value || 'general';
    const payload = {
        postId,
        routeId,
        region: $userRegion.get() || 'GP',
        body: text,
        category: COMMUNITY_CATEGORIES[category] ? category : 'general',
        uid: acct.uid,
        displayName: acct.displayName || 'Passenger',
        deviceId: getDeviceId(),
        timestamp: Date.now(),
        hidden: false,
        replyCount: 0,
        appVersion: APP_VERSION,
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
    return ROUTES[routeId]?.name || routeId || 'Route';
}

function renderPostCard(post, routeId) {
    const name = escapeHTML(post.displayName || 'Passenger');
    const body = escapeHTML(post.body || '');
    const when = relativeTime(post.timestamp);
    const postId = escapeHTML(post.postId || '');
    const uid = escapeHTML(post.uid || '');
    const catKey = COMMUNITY_CATEGORIES[post.category] ? post.category : 'general';
    const cat = COMMUNITY_CATEGORIES[catKey];
    const replies = post.replyCount ? `<span class="text-gray-400">${post.replyCount} repl${post.replyCount === 1 ? 'y' : 'ies'}</span>` : '';

    return `
      <article class="community-post border-b border-gray-100 dark:border-gray-800 py-3.5 px-1" data-post-id="${postId}" data-category="${catKey}">
        <div class="flex items-start justify-between gap-2 mb-1">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 mb-0.5 flex-wrap">
              <p class="text-xs font-black text-gray-900 dark:text-white truncate">${name}</p>
              <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${cat.class}">${cat.label}</span>
            </div>
            <p class="text-[10px] text-gray-400 font-medium">${when}${replies ? ` · ${replies}` : ''}</p>
          </div>
          <div class="relative shrink-0">
            <button type="button" class="community-more-btn p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none" aria-label="More" data-post-id="${postId}">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/></svg>
            </button>
            <div class="community-menu hidden absolute right-0 top-8 z-20 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 text-left">
              <button type="button" class="community-report-msg w-full text-left px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700" data-post-id="${postId}" data-uid="${uid}" data-snippet="${body.slice(0, 80)}">Report message</button>
              <button type="button" class="community-report-user w-full text-left px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40" data-uid="${uid}" data-post-id="${postId}">Report user</button>
            </div>
          </div>
        </div>
        <p class="text-sm text-gray-800 dark:text-gray-200 leading-snug whitespace-pre-wrap break-words">${body}</p>
        <div class="mt-2 flex items-center gap-3">
          <button type="button" class="community-toggle-replies text-[11px] font-bold text-blue-600 dark:text-blue-400 focus:outline-none" data-post-id="${postId}" data-route="${escapeHTML(routeId)}">Replies</button>
        </div>
        <div class="community-replies hidden mt-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-2" data-replies-for="${postId}"></div>
      </article>`;
}

function paintCategoryFilters() {
    document.querySelectorAll('[data-community-filter]').forEach((btn) => {
        const id = btn.getAttribute('data-community-filter');
        const on = id === activeCategoryFilter;
        btn.classList.toggle('is-selected', on);
        btn.classList.toggle('bg-blue-600', on);
        btn.classList.toggle('text-white', on);
        btn.classList.toggle('bg-gray-100', !on);
        btn.classList.toggle('dark:bg-gray-800', !on);
        btn.classList.toggle('text-gray-600', !on);
        btn.classList.toggle('dark:text-gray-300', !on);
    });
}

function applyFeedFilter(routeId) {
    const listEl = document.getElementById('community-feed-list');
    const emptyEl = document.getElementById('community-feed-empty');
    if (!listEl) return;
    const posts = activeCategoryFilter === 'all'
        ? cachedFeedPosts
        : cachedFeedPosts.filter((p) => (p.category || 'general') === activeCategoryFilter);

    if (!posts.length) {
        listEl.innerHTML = '';
        if (emptyEl) {
            emptyEl.classList.remove('hidden');
            emptyEl.innerHTML = activeCategoryFilter === 'all'
                ? `<p class="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">No posts on this line yet</p>
                   <p class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">Be the first to share a heads-up for fellow passengers. Keep it kind — this is a quiet feed, not a shouting match.</p>`
                : `<p class="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">Nothing in this category</p>
                   <p class="text-[12px] text-gray-500 dark:text-gray-400">Try All, or be the first to post here.</p>`;
        }
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    listEl.innerHTML = posts.map((p) => renderPostCard(p, routeId)).join('');
}

export async function renderCommunityFeed(routeId = $currentRouteId.get()) {
    const listEl = document.getElementById('community-feed-list');
    const emptyEl = document.getElementById('community-feed-empty');
    const titleEl = document.getElementById('community-route-title');
    const softEl = document.getElementById('community-be-kind');
    if (!listEl) return;

    if (titleEl) titleEl.textContent = routeLabel(routeId);
    if (softEl) softEl.classList.remove('hidden');
    paintCategoryFilters();

    listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-8 animate-pulse">Loading feed…</p>`;
    if (emptyEl) emptyEl.classList.add('hidden');

    cachedFeedPosts = await fetchRoutePosts(routeId);
    applyFeedFilter(routeId);
}

export function openRouteCommunity(opts = {}) {
    const routeId = opts.routeId || $currentRouteId.get() || '';
    const routeSel = document.getElementById('community-route-select');
    const composer = document.getElementById('community-composer');
    const guestHint = document.getElementById('community-guest-hint');
    const errEl = document.getElementById('community-error');

    if (routeSel) {
        const region = $userRegion.get() || 'GP';
        const routes = Object.values(ROUTES).filter((r) => r.isActive && r.region === region && r.id !== 'special_event');
        routeSel.innerHTML = routes.map((r) =>
            `<option value="${r.id}" ${r.id === routeId ? 'selected' : ''}>${escapeHTML(r.name || r.id)}</option>`
        ).join('') || '<option value="">No routes</option>';
        if (routeId && !routes.find((r) => r.id === routeId) && ROUTES[routeId]) {
            routeSel.insertAdjacentHTML('afterbegin', `<option value="${routeId}" selected>${escapeHTML(ROUTES[routeId].name)}</option>`);
        }
    }

    const signed = $account.get().status === 'signed-in';
    if (guestHint) guestHint.classList.toggle('hidden', signed);
    if (composer) {
        composer.disabled = !signed;
        composer.placeholder = signed ? 'Share something for this line…' : 'Sign in to post';
    }
    if (errEl) errEl.textContent = '';

    const activeRoute = routeSel?.value || routeId;
    if (typeof window.syncBottomNavActive === 'function') window.syncBottomNavActive('community');
    triggerHaptic();
    openSmoothModal('route-community-modal');
    renderCommunityFeed(activeRoute);
    joinCommunityPresence(activeRoute);
}

function closeCommunityRoom() {
    leaveCommunityPresence();
    closeSmoothModal('route-community-modal');
    const tab = safeStorage.getItem('activeTab') || 'next-train';
    if (typeof window.syncBottomNavActive === 'function') window.syncBottomNavActive(tab);
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
            closeSmoothModal('route-community-modal');
            setTimeout(() => openSmoothModal('account-modal'), 80);
        }
        return;
    }

    if (composer) composer.value = '';
    signalCommunityTyping(routeId, false);
    showToast('Posted to the route feed', 'success');
    await renderCommunityFeed(routeId);
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

    const open = (e) => {
        e?.preventDefault?.();
        openRouteCommunity({ routeId: $currentRouteId.get() });
    };

    document.getElementById('route-community-open-btn')?.addEventListener('click', open);
    document.getElementById('sidenav-community-btn')?.addEventListener('click', () => {
        triggerHaptic();
        if (typeof window.closeAppHub === 'function') window.closeAppHub(true);
        setTimeout(() => openRouteCommunity({ routeId: $currentRouteId.get() }), 50);
    });

    document.getElementById('community-modal-close')?.addEventListener('click', () => closeCommunityRoom());
    document.getElementById('community-post-btn')?.addEventListener('click', () => handlePostSubmit());
    document.getElementById('community-route-select')?.addEventListener('change', (e) => {
        const rid = e.target.value;
        renderCommunityFeed(rid);
        joinCommunityPresence(rid);
    });
    document.getElementById('community-refresh-btn')?.addEventListener('click', () => {
        const rid = document.getElementById('community-route-select')?.value || $currentRouteId.get();
        renderCommunityFeed(rid);
    });
    document.getElementById('community-signin-cta')?.addEventListener('click', () => {
        leaveCommunityPresence();
        closeSmoothModal('route-community-modal');
        setTimeout(() => openSmoothModal('account-modal'), 80);
    });

    document.querySelectorAll('[data-community-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            activeCategoryFilter = btn.getAttribute('data-community-filter') || 'all';
            paintCategoryFilters();
            const rid = document.getElementById('community-route-select')?.value || $currentRouteId.get();
            applyFeedFilter(rid);
        });
    });

    let typingTimer = null;
    document.getElementById('community-composer')?.addEventListener('input', () => {
        const rid = document.getElementById('community-route-select')?.value || $currentRouteId.get();
        signalCommunityTyping(rid, true);
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = setTimeout(() => signalCommunityTyping(rid, false), 2500);
    });

    // When modal is closed via backdrop/history, leave presence
    const modal = document.getElementById('route-community-modal');
    if (modal && !modal.dataset.presenceWatch) {
        modal.dataset.presenceWatch = '1';
        const obs = new MutationObserver(() => {
            if (modal.classList.contains('hidden')) {
                leaveCommunityPresence();
                const tab = safeStorage.getItem('activeTab') || 'next-train';
                if (typeof window.syncBottomNavActive === 'function') window.syncBottomNavActive(tab);
            }
        });
        obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('click', async (e) => {
        const t = e.target;

        // Close menus when clicking outside
        if (!t.closest?.('.community-more-btn') && !t.closest?.('.community-menu')) {
            document.querySelectorAll('.community-menu').forEach((m) => m.classList.add('hidden'));
        }

        const more = t.closest?.('.community-more-btn');
        if (more) {
            e.preventDefault();
            const menu = more.parentElement?.querySelector('.community-menu');
            document.querySelectorAll('.community-menu').forEach((m) => {
                if (m !== menu) m.classList.add('hidden');
            });
            menu?.classList.toggle('hidden');
            return;
        }

        const reportMsg = t.closest?.('.community-report-msg');
        if (reportMsg) {
            e.preventDefault();
            document.querySelectorAll('.community-menu').forEach((m) => m.classList.add('hidden'));
            const result = await submitModerationReport({
                type: 'message',
                routeId: document.getElementById('community-route-select')?.value || $currentRouteId.get(),
                targetPostId: reportMsg.getAttribute('data-post-id'),
                targetUid: reportMsg.getAttribute('data-uid'),
                snippet: reportMsg.getAttribute('data-snippet'),
            });
            showToast(result.ok ? 'Thanks — report sent to moderation.' : (result.message || 'Report failed'), result.ok ? 'success' : 'error');
            return;
        }

        const reportUser = t.closest?.('.community-report-user');
        if (reportUser) {
            e.preventDefault();
            document.querySelectorAll('.community-menu').forEach((m) => m.classList.add('hidden'));
            const result = await submitModerationReport({
                type: 'user',
                routeId: document.getElementById('community-route-select')?.value || $currentRouteId.get(),
                targetUid: reportUser.getAttribute('data-uid'),
                targetPostId: reportUser.getAttribute('data-post-id'),
            });
            showToast(result.ok ? 'User report sent.' : (result.message || 'Report failed'), result.ok ? 'success' : 'error');
            return;
        }

        const toggle = t.closest?.('.community-toggle-replies');
        if (toggle) {
            e.preventDefault();
            const postId = toggle.getAttribute('data-post-id');
            const routeId = toggle.getAttribute('data-route');
            const box = document.querySelector(`.community-replies[data-replies-for="${postId}"]`);
            if (!box) return;
            if (!box.classList.contains('hidden') && box.dataset.loaded === '1') {
                box.classList.add('hidden');
                return;
            }
            await expandReplies(postId, routeId, box);
            box.dataset.loaded = '1';
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
}
