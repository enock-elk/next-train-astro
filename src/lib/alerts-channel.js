/**
 * Alerts channel UI — bell gateway, WhatsApp-style column, reactions.
 */
import { DYNAMIC_BASE_URL, ROUTES, withBase } from './config.js';
import { safeStorage, escapeHTML, repairMojibake, formatAppDate } from './utils.js';
import { prepareRichHtml, injectRichTextStyles } from './rich-text.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';
import { $currentRouteId } from '../store.js';
import {
    ALERTS_PAGE_SIZE,
    ALERT_REACTION_KEYS,
    ALERT_REACTION_EMOJI,
    buildAlertReactionBreakdown,
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
    sanitizeInlineAlertImageUrl,
    collectNoticeImageUrls,
    layoutAlertPost,
    shouldIgnoreAlertLongPress,
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
    layoutAlertPost,
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
    if (clean) return withBase(clean.replace(/^\//, ''));
    return sanitizeInlineAlertImageUrl(path) || '';
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
    return `${label} ${formatAppDate(date, { withTime: true })}`;
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
        const href = resolveAlertImageSrc(path);
        if (!href) return '';
        const src = escapeHTML(href);
        return `<button type="button" data-alert-lightbox="${src}" class="relative block w-full focus:outline-none cursor-zoom-in rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.99] transition-transform">
            <img src="${src}" alt="Service poster" draggable="false" class="w-full h-auto max-h-72 object-cover bg-gray-100 dark:bg-gray-900 pointer-events-none">
            <span class="nt-zoom-plus absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 text-white text-xs font-bold leading-none flex items-center justify-center border border-white/20 pointer-events-none select-none shadow-sm" aria-hidden="true">+</span>
        </button>`;
    }).join('');
    const grid = urls.length > 1 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1';
    return `<div class="${grid} mt-2 mb-1" data-alert-media>${cells}</div>`;
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

function mineReactionKey(notice) {
    try { return safeStorage.getItem(reactionStorageKey(notice)) || ''; } catch { return ''; }
}

function renderReactionsHtml(notice) {
    const mine = mineReactionKey(notice);
    const { total, rows } = buildAlertReactionBreakdown(notice, mine);
    if (!total) {
        return `<div class="nt-alert-react-summary mt-2 min-h-0" data-alert-summary="${escapeHTML(String(notice.id || ''))}"></div>`;
    }
    const faces = rows.map((row) => (
        `<span class="text-sm leading-none" aria-hidden="true">${row.emoji}</span>`
    )).join('');
    return `<button type="button" class="nt-alert-react-summary mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-100 focus:outline-none" data-alert-summary="${escapeHTML(String(notice.id || ''))}" data-alert-id="${escapeHTML(String(notice.id || ''))}" data-alert-src="${escapeHTML(String(notice._sourceKey || ''))}" aria-label="${total} reactions">
        <span class="inline-flex items-center gap-0.5">${faces}</span>
        <span class="text-[11px] font-bold tabular-nums">${total}</span>
    </button>`;
}

function hideAlertReactionPicker() {
    document.getElementById('alerts-reaction-picker')?.classList.add('hidden');
}

function openAlertReactionPicker(notice, anchorEl) {
    if (!notice || !anchorEl) return;
    hideAlertReactionBreakdown();
    let sheet = document.getElementById('alerts-reaction-picker');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'alerts-reaction-picker';
        sheet.className = 'hidden fixed z-[130]';
        sheet.innerHTML = `<div class="nt-alert-react-pill flex items-center gap-0.5 px-2 py-1.5 rounded-full bg-gray-950/95 text-white shadow-2xl border border-white/10" data-alert-picker-row></div>`;
        document.body.appendChild(sheet);
        sheet.addEventListener('click', (e) => {
            const btn = e.target.closest?.('[data-alert-react]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const id = btn.getAttribute('data-alert-id');
            const src = btn.getAttribute('data-alert-src');
            const emoji = btn.getAttribute('data-alert-react');
            const target = cachedLiveNotices.find((n) => String(n.id) === String(id) && String(n._sourceKey) === String(src));
            hideAlertReactionPicker();
            if (target) submitAlertReaction(target, emoji);
        });
    }
    const mine = mineReactionKey(notice);
    const row = sheet.querySelector('[data-alert-picker-row]');
    if (row) {
        row.innerHTML = ALERT_REACTION_KEYS.map((key) => (
            `<button type="button" data-alert-react="${escapeHTML(key)}" data-alert-id="${escapeHTML(String(notice.id || ''))}" data-alert-src="${escapeHTML(String(notice._sourceKey || ''))}" class="w-10 h-10 text-xl rounded-full ${
                mine === key ? 'bg-white/15 ring-1 ring-white/40' : 'hover:bg-white/10'
            }" aria-label="React ${ALERT_REACTION_EMOJI[key]}">${ALERT_REACTION_EMOJI[key]}</button>`
        )).join('');
    }
    const rect = anchorEl.getBoundingClientRect();
    sheet.classList.remove('hidden');
    const pillW = Math.min(320, window.innerWidth - 16);
    const pressX = Number(anchorEl._ntPx);
    const pressY = Number(anchorEl._ntPy);
    const midX = Number.isFinite(pressX) ? pressX : (rect.left + rect.width / 2);
    const anchorY = Number.isFinite(pressY) ? pressY : rect.top;
    const left = Math.max(8, Math.min(window.innerWidth - pillW - 8, midX - (pillW / 2)));
    let top = anchorY - 58;
    if (top < 8) top = Math.min(window.innerHeight - 64, anchorY + 16);
    sheet.style.left = `${left}px`;
    sheet.style.top = `${top}px`;
    triggerHaptic();
}

function hideAlertReactionBreakdown() {
    document.getElementById('alerts-reaction-breakdown')?.classList.add('hidden');
}

function openAlertReactionBreakdown(notice) {
    if (!notice) return;
    hideAlertReactionPicker();
    let sheet = document.getElementById('alerts-reaction-breakdown');
    if (!sheet) {
        sheet = document.createElement('div');
        sheet.id = 'alerts-reaction-breakdown';
        sheet.className = 'hidden fixed inset-0 z-[132]';
        sheet.innerHTML = `
            <div class="absolute inset-0 bg-black/50" data-breakdown-scrim></div>
            <div class="absolute left-0 right-0 bottom-0 bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl border-t border-gray-200 dark:border-gray-700 px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <div class="flex justify-center mb-3"><span class="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" aria-hidden="true"></span></div>
                <p class="text-base font-black text-gray-900 dark:text-white mb-3" data-breakdown-title>Reactions</p>
                <div class="flex flex-wrap gap-2" data-breakdown-chips></div>
            </div>`;
        document.body.appendChild(sheet);
        sheet.querySelector('[data-breakdown-scrim]')?.addEventListener('click', hideAlertReactionBreakdown);
    }
    const mine = mineReactionKey(notice);
    const { total, rows } = buildAlertReactionBreakdown(notice, mine);
    const title = sheet.querySelector('[data-breakdown-title]');
    if (title) title.textContent = total === 1 ? '1 reaction' : `${total} reactions`;
    const chips = sheet.querySelector('[data-breakdown-chips]');
    if (chips) {
        chips.innerHTML = rows.map((row) => (
            `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-600 text-sm font-bold text-gray-900 dark:text-white ${
                row.mine ? 'ring-1 ring-blue-400' : ''
            }">${row.emoji} <span class="tabular-nums">${row.count}</span></span>`
        )).join('');
    }
    sheet.classList.remove('hidden');
    triggerHaptic();
}

function renderPostCard(notice, opts = {}) {
    const severity = notice.severity || 'info';
    const chrome = severityChrome(severity);
    const layout = layoutAlertPost(notice);
    const highlight = opts.highlight && String(notice.id) === String(opts.highlight);
    const body = prepareRichHtml(layout.body);
    const titleHtml = layout.title
        ? `<h3 class="text-base font-black text-gray-900 dark:text-white leading-snug mb-2" data-alert-title>${escapeHTML(layout.title)}</h3>`
        : '';
    const mediaHtml = renderPosterHtml(layout.imageUrls);
    const bodyHtml = body
        ? `<div class="nt-rich-body text-sm text-gray-800 dark:text-gray-200 leading-relaxed ${mediaHtml ? 'mt-3' : ''}" data-alert-body>${body}</div>`
        : '';
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
    return `<article id="alert-post-${escapeHTML(String(notice.id || ''))}" data-alert-post="${escapeHTML(String(notice.id || ''))}" data-alert-id="${escapeHTML(String(notice.id || ''))}" data-alert-src="${escapeHTML(String(notice._sourceKey || ''))}" class="nt-alert-card bg-white dark:bg-gray-800 rounded-2xl shadow-sm border-l-4 ${chrome.bar} border border-gray-100 dark:border-gray-700 p-4 select-none ${highlight ? 'ring-2 ring-red-400 ring-offset-2 dark:ring-offset-gray-900' : ''}">
        <div class="flex items-center justify-between gap-2 mb-2">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${chrome.chip}">${chrome.label}</span>
            <span class="text-[10px] text-gray-400 dark:text-gray-500 font-mono">${escapeHTML(formatPosted(notice))}</span>
        </div>
        ${titleHtml}
        ${mediaHtml}
        ${bodyHtml}
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
    hideAlertReactionPicker();
    hideAlertReactionBreakdown();
    if (!el || el.classList.contains('hidden')) {
        if (typeof window !== 'undefined') window.__ntAlertsOpen = false;
        return;
    }
    // Park home underneath (same as sidenav map sheet): hide first, then pop hash.
    if (typeof window !== 'undefined') window.__ntAlertsParkHome = true;
    closeSmoothModal('alerts-channel', true);
    if (location.hash === '#alerts') {
        try { history.back(); } catch { /* ignore */ }
    }
    if (typeof window !== 'undefined') window.__ntAlertsOpen = false;
}

export function openAlertsChannel(opts = {}) {
    const notices = opts.notices || cachedLiveNotices;
    if (opts.resetVisible !== false) visibleCount = ALERTS_PAGE_SIZE;
    highlightNoticeId = opts.highlightId || null;
    renderAlertsChannel(notices, { highlightId: highlightNoticeId });
    markNoticesSeen(notices);
    applyBellFromNotices(notices);
    if (typeof window !== 'undefined') {
        window.__ntAlertsOpen = true;
        window.__ntAlertsParkHome = false;
    }
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

    // Lab header is brand-left with an inline bell — do not force SPA absolute chrome.
    let bellClass = 'relative p-2 rounded-full focus:outline-none transition-colors ';
    let dotClass = 'absolute top-1.5 right-1.5 block h-2 w-2 rounded-full ring-2 ring-white dark:ring-gray-900 ';
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
    if (bellSvg) bellSvg.setAttribute('class', 'w-5 h-5');
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
            const wrap = card.querySelector('[data-alert-summary]');
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

    const closeChannel = (e) => {
        e.preventDefault();
        triggerHaptic();
        closeAlertsChannel();
    };
    document.getElementById('alerts-channel-back')?.addEventListener('click', closeChannel);
    document.getElementById('alerts-channel-close')?.addEventListener('click', closeChannel);

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

    let longTimer = null;
    let longFired = false;
    let pressCard = null;
    const clearLong = () => {
        if (longTimer) clearTimeout(longTimer);
        longTimer = null;
        pressCard?.classList.remove('is-pressing');
        pressCard = null;
    };
    const ignoreLongPressTarget = (target) => shouldIgnoreAlertLongPress(target);
    const startLongPress = (card) => {
        longFired = false;
        pressCard = card;
        card.classList.add('is-pressing');
        longTimer = setTimeout(() => {
            longFired = true;
            const id = card.getAttribute('data-alert-id');
            const src = card.getAttribute('data-alert-src');
            const notice = cachedLiveNotices.find((n) => String(n.id) === String(id) && String(n._sourceKey) === String(src));
            if (notice) openAlertReactionPicker(notice, card);
            card.classList.remove('is-pressing');
        }, 480);
    };

    root.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const card = e.target.closest?.('.nt-alert-card');
        if (!card) return;
        card._ntPx = e.clientX;
        card._ntPy = e.clientY;
        if (ignoreLongPressTarget(e.target)) return;
        startLongPress(card);
    });
    root.addEventListener('pointermove', (e) => {
        if (!pressCard) return;
        const dx = Math.abs((e.clientX || 0) - (pressCard._ntPx || e.clientX || 0));
        const dy = Math.abs((e.clientY || 0) - (pressCard._ntPy || e.clientY || 0));
        if (dx > 10 || dy > 10) clearLong();
    });
    root.addEventListener('pointerup', clearLong);
    root.addEventListener('pointercancel', clearLong);
    root.addEventListener('contextmenu', (e) => {
        const card = e.target.closest?.('.nt-alert-card');
        if (!card || ignoreLongPressTarget(e.target)) return;
        e.preventDefault();
        const id = card.getAttribute('data-alert-id');
        const src = card.getAttribute('data-alert-src');
        const notice = cachedLiveNotices.find((n) => String(n.id) === String(id) && String(n._sourceKey) === String(src));
        if (notice) openAlertReactionPicker(notice, card);
    });
    document.getElementById('alerts-channel-scroll')?.addEventListener('scroll', hideAlertReactionPicker, { passive: true });
    document.addEventListener('pointerdown', (e) => {
        const picker = document.getElementById('alerts-reaction-picker');
        if (!picker || picker.classList.contains('hidden')) return;
        if (picker.contains(e.target)) return;
        hideAlertReactionPicker();
    });

    root.addEventListener('click', (e) => {
        if (!longFired) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        longFired = false;
    }, true);

    root.addEventListener('click', (e) => {
        if (longFired) {
            e.preventDefault();
            e.stopPropagation();
            longFired = false;
            return;
        }
        const lightbox = e.target.closest?.('[data-alert-lightbox]');
        if (lightbox) {
            e.preventDefault();
            const src = lightbox.getAttribute('data-alert-lightbox');
            if (src && typeof window.openLightbox === 'function') window.openLightbox(src);
            return;
        }
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
        const summary = e.target.closest?.('[data-alert-summary]');
        if (summary && summary.getAttribute('data-alert-id')) {
            e.preventDefault();
            const id = summary.getAttribute('data-alert-id');
            const src = summary.getAttribute('data-alert-src');
            const notice = cachedLiveNotices.find((n) => String(n.id) === String(id) && String(n._sourceKey) === String(src));
            if (notice) openAlertReactionBreakdown(notice);
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
                    alertKind: 'notice',
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
