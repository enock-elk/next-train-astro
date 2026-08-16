/**
 * Alerts channel UI — bell gateway, WhatsApp-style column, reactions.
 */
import { DYNAMIC_BASE_URL, ROUTES, withBase } from './config.js';
import { safeStorage, escapeHTML, repairMojibake } from './utils.js';
import { prepareRichHtml, injectRichTextStyles } from './rich-text.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';
import { $currentRouteId } from '../store.js';
import {
    ALERTS_PAGE_SIZE,
    ALERT_REACTION_KEYS,
    ALERT_REACTION_EMOJI,
    noticeTimestamp,
    noticeScopeKeys as scopeKeysFor,
    parseNoticeBucket,
    mergeUnionNotices,
    highestSeverity,
    criticalNotices,
    pageAlertsFeed,
    seenStorageKey,
    reactionStorageKey,
    shouldForceOpen,
    pickAutoOpenNotice as pickAutoOpenFromFeed,
    sanitizeAlertImageUrl,
    collectNoticeImageUrls,
    buildNoticesMeta,
    listNoticesInTarget,
} from './alerts-feed.js';

export {
    ALERTS_PAGE_SIZE,
    parseNoticeBucket,
    mergeUnionNotices,
    highestSeverity,
    pageAlertsFeed,
    sanitizeAlertImageUrl,
    collectNoticeImageUrls,
    buildNoticesMeta,
    shouldForceOpen,
};

/** @type {object[]} */
let cachedLiveNotices = [];
let visibleCount = ALERTS_PAGE_SIZE;
let highlightNoticeId = null;
let channelBound = false;

export function noticeScopeKeys(region, routeId) {
    return scopeKeysFor(region, routeId && ROUTES[routeId] ? routeId : '');
}

export function hasSeenNotice(notice) {
    try {
        return safeStorage.getItem(seenStorageKey(notice)) === 'true';
    } catch {
        return false;
    }
}

export function markNoticeSeen(notice) {
    try { safeStorage.setItem(seenStorageKey(notice), 'true'); } catch { /* ignore */ }
}

export function markNoticesSeen(notices) {
    (notices || []).forEach(markNoticeSeen);
}

export function unseenNotices(notices) {
    return (notices || []).filter((n) => !hasSeenNotice(n));
}

export function pickAutoOpenNotice(notices) {
    return pickAutoOpenFromFeed(notices, hasSeenNotice);
}

export function resolveAlertImageSrc(path) {
    const clean = sanitizeAlertImageUrl(path);
    if (!clean) return '';
    return withBase(clean.replace(/^\//, ''));
}

export function getCachedLiveNotices() {
    return cachedLiveNotices.slice();
}

export function setCachedLiveNotices(list) {
    cachedLiveNotices = Array.isArray(list) ? list.slice() : [];
    return cachedLiveNotices;
}

async function fetchBucket(key) {
    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}notices/${encodeURIComponent(key)}.json?t=${Date.now()}`);
        if (!res.ok) return [];
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html')) throw new Error('Captive Portal Detected');
        return parseNoticeBucket(await res.json(), key);
    } catch (e) {
        if (e?.message === 'Captive Portal Detected') throw e;
        return [];
    }
}

export async function fetchUnionNotices(region, routeId) {
    const keys = noticeScopeKeys(region, routeId);
    const buckets = await Promise.all(keys.map(fetchBucket));
    return mergeUnionNotices(buckets);
}

function formatPosted(notice) {
    const ts = noticeTimestamp(notice);
    if (!ts) return '';
    const date = new Date(ts);
    const label = (notice.isRepost || notice.repostedAt) ? 'Reposted' : 'Posted';
    return `${label} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${date.toLocaleDateString()}`;
}

function severityChrome(severity) {
    if (severity === 'critical') {
        return {
            bar: 'border-red-500',
            chip: 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300',
            label: 'Critical',
        };
    }
    if (severity === 'warning') {
        return {
            bar: 'border-amber-500',
            chip: 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300',
            label: 'Warning',
        };
    }
    return {
        bar: 'border-blue-500',
        chip: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300',
        label: 'Info',
    };
}

function renderPosterHtml(urls) {
    if (!urls.length) return '';
    const cells = urls.map((path) => {
        const src = escapeHTML(resolveAlertImageSrc(path));
        const safeJs = src.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `<button type="button" data-alert-lightbox="${escapeHTML(src)}" onclick="event.stopPropagation(); window.openLightbox('${safeJs}')" class="relative block w-full focus:outline-none cursor-zoom-in rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.99] transition-transform">
            <img src="${src}" alt="Service poster" class="w-full h-auto max-h-72 object-cover bg-gray-100 dark:bg-gray-900">
            <span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span>
        </button>`;
    }).join('');
    const grid = urls.length > 1 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1';
    return `<div class="${grid} mt-3 mb-1">${cells}</div>`;
}

function renderPollHtml(notice) {
    if (!notice.poll || !notice.poll.active) return '';
    const pollId = String(notice.id || 'preview');
    let voted = '';
    try { voted = safeStorage.getItem('poll_voted_' + pollId) || ''; } catch { voted = ''; }
    const meta = {
        question: notice.poll.question || '',
        optionA: notice.poll.optionA || '',
        optionB: notice.poll.optionB || '',
        optionC: notice.poll.optionC || '',
        showResults: !!notice.poll.showResults,
        severity: notice.severity || 'info',
    };
    const metaAttr = escapeHTML(JSON.stringify(meta));
    if (voted) {
        return `<div id="poll-container-${escapeHTML(pollId)}" data-poll-meta="${metaAttr}" class="mt-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/60 text-center"><p class="text-xs font-bold text-gray-700 dark:text-gray-200">Thanks for voting!</p></div>`;
    }
    const btn = (key, text) => text
        ? `<button type="button" data-poll-id="${escapeHTML(pollId)}" data-poll-opt="${key}" data-poll-text="${escapeHTML(text)}" class="nt-poll-vote flex-1 min-w-[30%] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 font-bold py-2 rounded-lg text-xs">${escapeHTML(text)}</button>`
        : '';
    return `<div id="poll-container-${escapeHTML(pollId)}" data-poll-meta="${metaAttr}" class="mt-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/60">
        <p class="text-sm font-black text-gray-800 dark:text-gray-100 mb-2 text-center">${escapeHTML(notice.poll.question || '')}</p>
        <div class="flex flex-wrap gap-2">${btn('A', notice.poll.optionA)}${btn('B', notice.poll.optionB)}${btn('C', notice.poll.optionC)}</div>
    </div>`;
}

function renderReactionsHtml(notice) {
    const mine = (() => {
        try { return safeStorage.getItem(reactionStorageKey(notice)) || ''; } catch { return ''; }
    })();
    const counts = notice.reactions && typeof notice.reactions === 'object' ? notice.reactions : {};
    const buttons = ALERT_REACTION_KEYS.map((key) => {
        const n = Number(counts[key] || 0) || 0;
        const on = mine === key;
        return `<button type="button" data-alert-react="${escapeHTML(key)}" data-alert-id="${escapeHTML(String(notice.id || ''))}" data-alert-src="${escapeHTML(String(notice._sourceKey || ''))}" class="nt-alert-react inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border transition-colors ${
            on
                ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-200'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
        }" ${mine && !on ? 'disabled' : ''}>${ALERT_REACTION_EMOJI[key]} <span data-alert-count="${key}">${n || ''}</span></button>`;
    }).join('');
    return `<div class="flex flex-wrap gap-1.5 mt-3">${buttons}</div>`;
}

function renderPostCard(notice, opts = {}) {
    const severity = notice.severity || 'info';
    const chrome = severityChrome(severity);
    const posters = collectNoticeImageUrls(notice);
    const highlight = opts.highlight && String(notice.id) === String(opts.highlight);
    const body = prepareRichHtml(notice.message || notice.text || '');
    let extra = '';
    if (notice.sourceName) {
        const sName = escapeHTML(notice.sourceName);
        const sUrl = notice.sourceUrl ? escapeHTML(notice.sourceUrl) : null;
        const cite = sUrl
            ? `<a href="${sUrl}" target="_blank" rel="noopener" class="hover:underline text-blue-600 dark:text-blue-400 font-medium">${sName}</a>`
            : `<span class="font-medium text-gray-700 dark:text-gray-300">${sName}</span>`;
        extra += `<div class="mt-3 text-[10px] text-gray-500 dark:text-gray-400 italic">Source: ${cite}</div>`;
    }
    if (notice.ctaUrl && notice.ctaText) {
        extra += `<a href="${escapeHTML(notice.ctaUrl)}" target="_blank" rel="noopener" class="mt-3 inline-flex items-center justify-center w-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-bold py-2 px-3 rounded-lg text-xs uppercase tracking-wide border border-blue-200 dark:border-blue-800">${escapeHTML(notice.ctaText)}</a>`;
    }
    const rawHtml = repairMojibake(notice.message || notice.text || '');
    const snippet = htmlToPlainSnippet(rawHtml, 6).replace(/[—–].*/, '').trim();
    return `<article id="alert-post-${escapeHTML(String(notice.id || ''))}" data-alert-post="${escapeHTML(String(notice.id || ''))}" class="nt-alert-card bg-white dark:bg-gray-800 rounded-2xl shadow-sm border-l-4 ${chrome.bar} border border-gray-100 dark:border-gray-700 p-4 ${highlight ? 'ring-2 ring-red-400 ring-offset-2 dark:ring-offset-gray-900' : ''}">
        <div class="flex items-center justify-between gap-2 mb-2">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${chrome.chip}">${chrome.label}</span>
            <span class="text-[10px] text-gray-400 dark:text-gray-500 font-mono">${escapeHTML(formatPosted(notice))}</span>
        </div>
        <div class="nt-rich-body text-sm text-gray-800 dark:text-gray-200 leading-relaxed">${body}</div>
        ${renderPosterHtml(posters)}
        ${extra}
        ${renderPollHtml(notice)}
        ${renderReactionsHtml(notice)}
        <button type="button" class="nt-alert-reply mt-3 w-full text-xs font-bold text-blue-600 dark:text-blue-400 py-2 rounded-lg border border-blue-100 dark:border-blue-900/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus:outline-none" data-alert-reply="${escapeHTML(String(notice.id || ''))}" data-alert-snippet="${escapeHTML(snippet)}">Reply</button>
    </article>`;
}

function htmlToPlainSnippet(html, maxWords = 8) {
    if (!html) return '';
    const spaced = String(html)
        .replace(/<\s*br\s*\/?>/gi, ' ')
        .replace(/<\/\s*(h[1-6]|p|div|li|tr|section|article)\s*>/gi, ' ')
        .replace(/<\s*(h[1-6]|p|div|li|tr|section|article)(\s[^>]*)?>/gi, ' ');
    let text = '';
    try {
        const doc = new DOMParser().parseFromString(spaced, 'text/html');
        text = doc.body?.textContent || '';
    } catch {
        text = spaced.replace(/<[^>]+>/g, ' ');
    }
    text = text.replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    return words.slice(0, maxWords).join(' ') + (words.length > maxWords ? '...' : '');
}

function renderPinStrip(notices) {
    const crit = criticalNotices(notices);
    const host = document.getElementById('alerts-pin-strip');
    if (!host) return;
    if (!crit.length) {
        host.innerHTML = '';
        host.classList.add('hidden');
        return;
    }
    host.classList.remove('hidden');
    host.innerHTML = crit.map((n) => {
        const snippet = escapeHTML(htmlToPlainSnippet(n.message || n.text || '', 10) || 'Critical advisory');
        return `<button type="button" data-alert-jump="${escapeHTML(String(n.id || ''))}" class="w-full text-left px-3 py-2.5 rounded-xl bg-red-600 text-white shadow-sm mb-2 last:mb-0 focus:outline-none">
            <p class="text-[10px] font-black uppercase tracking-widest opacity-80">Pinned · Critical</p>
            <p class="text-sm font-bold leading-snug mt-0.5 line-clamp-2">${snippet}</p>
        </button>`;
    }).join('');
}

export function renderAlertsChannel(notices = cachedLiveNotices, opts = {}) {
    injectRichTextStyles();
    const feed = document.getElementById('alerts-feed');
    const empty = document.getElementById('alerts-empty');
    const earlierBtn = document.getElementById('alerts-load-earlier');
    if (!feed) return false;

    const list = Array.isArray(notices) ? notices : [];
    cachedLiveNotices = list;
    if (opts.resetVisible) visibleCount = ALERTS_PAGE_SIZE;
    if (opts.highlightId) highlightNoticeId = opts.highlightId;

    renderPinStrip(list);

    if (!list.length) {
        feed.innerHTML = '';
        empty?.classList.remove('hidden');
        earlierBtn?.classList.add('hidden');
        return true;
    }
    empty?.classList.add('hidden');

    const page = pageAlertsFeed(list, visibleCount);
    if (earlierBtn) {
        earlierBtn.classList.toggle('hidden', page.hiddenCount <= 0);
        earlierBtn.textContent = page.hiddenCount > 0
            ? `Show earlier (${page.hiddenCount})`
            : 'Show earlier';
    }
    feed.innerHTML = page.visible.map((n) => renderPostCard(n, { highlight: highlightNoticeId })).join('');
    return true;
}

function scrollFeedTo(noticeId, toBottom = false) {
    const scroller = document.getElementById('alerts-channel-scroll');
    if (!scroller) return;
    if (noticeId) {
        const el = document.getElementById(`alert-post-${noticeId}`);
        if (el) {
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
        }
    }
    if (toBottom) {
        requestAnimationFrame(() => {
            scroller.scrollTop = scroller.scrollHeight;
        });
    }
}

export function closeAlertsChannel() {
    const el = document.getElementById('alerts-channel');
    if (!el || el.classList.contains('hidden')) return;
    if (location.hash === '#alerts') {
        try { history.back(); } catch { closeSmoothModal('alerts-channel'); }
    } else {
        closeSmoothModal('alerts-channel');
    }
}

export function openAlertsChannel(opts = {}) {
    const notices = opts.notices || cachedLiveNotices;
    if (opts.resetVisible !== false) visibleCount = ALERTS_PAGE_SIZE;
    highlightNoticeId = opts.highlightId || null;
    renderAlertsChannel(notices, { highlightId: highlightNoticeId });
    markNoticesSeen(notices);
    applyBellFromNotices(notices);
    openSmoothModal('alerts-channel', 'top-right');
    setTimeout(() => {
        if (highlightNoticeId) scrollFeedTo(highlightNoticeId, false);
        else scrollFeedTo(null, true);
    }, 80);
    bindAlertsChannelOnce();
}

export function applyBellFromNotices(notices) {
    const bellBtn = document.getElementById('notice-bell');
    const dot = document.getElementById('notice-dot');
    if (!bellBtn) return;

    if (!notices || notices.length === 0) {
        bellBtn.classList.add('hidden');
        return;
    }

    const severity = highestSeverity(notices);
    const unseen = unseenNotices(notices);
    const unseenCritical = unseen.some((n) => (n.severity || '') === 'critical');

    let bellClass = 'absolute top-2 right-4 z-[70] p-2 rounded-full shadow-sm focus:outline-none transition-colors ';
    let dotClass = 'absolute top-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-gray-800 transform translate-x-1/4 -translate-y-1/4 ';
    if (severity === 'critical') {
        bellClass += 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800';
        dotClass += 'bg-red-600';
    } else if (severity === 'warning') {
        bellClass += 'bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800';
        dotClass += 'bg-yellow-500';
    } else {
        bellClass += 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800';
        dotClass += 'bg-blue-600';
    }
    bellBtn.className = bellClass;
    bellBtn.classList.remove('hidden');
    bellBtn.setAttribute('aria-label', 'Service alerts');
    const bellSvg = bellBtn.querySelector('svg');
    if (bellSvg) bellSvg.setAttribute('class', 'w-6 h-6');
    if (dot) {
        dot.className = dotClass;
        if (unseen.length) dot.classList.remove('hidden');
        else dot.classList.add('hidden');
    }
    if (unseenCritical) bellBtn.classList.add('animate-shake');
    else bellBtn.classList.remove('animate-shake');

    bellBtn.onclick = () => {
        triggerHaptic();
        if (typeof window.trackAnalyticsEvent === 'function') {
            window.trackAnalyticsEvent('view_service_alert', {
                severity,
                route_id: $currentRouteId.get() || 'all',
                live_count: notices.length,
            });
        }
        openAlertsChannel({ notices, resetVisible: true });
    };
}

async function ensureReactAuthToken() {
    try {
        if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
            await window.firebaseSignInAnonymously(window.firebaseAuth);
        }
        if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true) || '';
        }
    } catch { /* ignore */ }
    return '';
}

export async function submitAlertReaction(notice, emoji) {
    if (!notice || !ALERT_REACTION_KEYS.includes(emoji)) return false;
    const storeKey = reactionStorageKey(notice);
    if (safeStorage.getItem(storeKey)) {
        showToast('You already reacted to this notice.', 'info');
        return false;
    }
    const token = await ensureReactAuthToken();
    if (!token) {
        showToast('Could not save reaction. Try again in a moment.', 'error');
        return false;
    }
    const path = notice._reactPath || `${notice._sourceKey}/${notice.id}`;
    const url = `${DYNAMIC_BASE_URL}notices/${path}/reactions/${encodeURIComponent(emoji)}.json?auth=${encodeURIComponent(token)}`;
    try {
        const curRes = await fetch(url);
        const cur = curRes.ok ? await curRes.json() : 0;
        const next = (Number(cur) || 0) + 1;
        const put = await fetch(url, { method: 'PUT', body: JSON.stringify(next) });
        if (!put.ok) throw new Error(`react ${put.status}`);
        safeStorage.setItem(storeKey, emoji);
        if (!notice.reactions || typeof notice.reactions !== 'object') notice.reactions = {};
        notice.reactions[emoji] = next;
        const card = document.querySelector(`[data-alert-post="${CSS.escape ? CSS.escape(String(notice.id)) : notice.id}"]`);
        if (card) {
            const wrap = card.querySelector('.nt-alert-react')?.parentElement;
            if (wrap) wrap.outerHTML = renderReactionsHtml(notice);
        }
        triggerHaptic();
        return true;
    } catch (e) {
        console.warn('Alert reaction failed', e);
        showToast('Could not save reaction.', 'error');
        return false;
    }
}

function bindAlertsChannelOnce() {
    if (channelBound) return;
    const root = document.getElementById('alerts-channel');
    if (!root) return;
    channelBound = true;

    document.getElementById('alerts-channel-back')?.addEventListener('click', (e) => {
        e.preventDefault();
        triggerHaptic();
        closeAlertsChannel();
    });

    document.getElementById('alerts-load-earlier')?.addEventListener('click', () => {
        triggerHaptic();
        const scroller = document.getElementById('alerts-channel-scroll');
        const prevHeight = scroller?.scrollHeight || 0;
        visibleCount += ALERTS_PAGE_SIZE;
        renderAlertsChannel(cachedLiveNotices);
        requestAnimationFrame(() => {
            if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollHeight - prevHeight);
        });
    });

    root.addEventListener('click', (e) => {
        const jump = e.target.closest?.('[data-alert-jump]');
        if (jump) {
            const id = jump.getAttribute('data-alert-jump');
            highlightNoticeId = id;
            const page = pageAlertsFeed(cachedLiveNotices, visibleCount);
            if (id && !page.visible.some((n) => String(n.id) === String(id))) {
                visibleCount = cachedLiveNotices.length;
                renderAlertsChannel(cachedLiveNotices, { highlightId: id });
            }
            scrollFeedTo(id, false);
            return;
        }
        const reactBtn = e.target.closest?.('[data-alert-react]');
        if (reactBtn) {
            e.preventDefault();
            const id = reactBtn.getAttribute('data-alert-id');
            const src = reactBtn.getAttribute('data-alert-src');
            const emoji = reactBtn.getAttribute('data-alert-react');
            const notice = cachedLiveNotices.find((n) => String(n.id) === String(id) && String(n._sourceKey) === String(src));
            if (notice) submitAlertReaction(notice, emoji);
            return;
        }
        const replyBtn = e.target.closest?.('[data-alert-reply]');
        if (replyBtn) {
            e.preventDefault();
            triggerHaptic();
            const id = replyBtn.getAttribute('data-alert-reply');
            const snippet = replyBtn.getAttribute('data-alert-snippet') || '';
            if (typeof window.openFeedbackReplyFromOverlay === 'function') {
                window.openFeedbackReplyFromOverlay('alerts-channel', {
                    label: 'Replying to Advisory:',
                    snippet,
                    rawMsg: snippet,
                    alertId: id || '',
                });
            }
        }
    });
}

export function initAlertsChannel() {
    bindAlertsChannelOnce();
    if (typeof window === 'undefined') return;
    window.openAlertsChannel = openAlertsChannel;
    window.closeAlertsChannel = closeAlertsChannel;
    window.renderAlertsChannel = renderAlertsChannel;
    window.sanitizeAlertImageUrl = sanitizeAlertImageUrl;
    window.collectNoticeImageUrls = collectNoticeImageUrls;
    window.parseNoticeBucket = parseNoticeBucket;
    window.buildNoticesMeta = buildNoticesMeta;
    window.listNoticesInTarget = listNoticesInTarget;
}

if (typeof window !== 'undefined') {
    window.withBase = window.withBase || withBase;
    window.sanitizeAlertImageUrl = sanitizeAlertImageUrl;
    window.collectNoticeImageUrls = collectNoticeImageUrls;
}
