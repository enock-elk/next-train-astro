/**
 * Pure alerts-channel feed rules (no DOM). Union scoping, expiry, posters, paging.
 */
import { cleanHttpUrl, isPublicPreviewUrl } from './link-preview.js';
export const ALERTS_PAGE_SIZE = 10;
export const ALERT_PIN_SVG = `<svg class="nt-alert-pin-icon w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 3H8v2h1v6.2L7 14v2h4v5h2v-5h4v-2l-2-2.8V5h1V3z"/></svg>`;
export const ALERT_IMAGE_PREFIX = '/images/alerts/';
/** Printed timetable sheets that back in-app schedules; also postable on alerts later. */
export const SCHEDULE_IMAGE_PREFIX = '/images/schedules/';
export const ALERT_REACTION_KEYS = ['like', 'love', 'laugh', 'wow', 'sad', 'pray'];
export const ALERT_REACTION_EMOJI = {
    like: '👍',
    love: '❤️',
    laugh: '😂',
    wow: '😮',
    sad: '😢',
    pray: '🙏',
};

/** Count chips only — picker emojis stay hidden until long-press. */
export function summarizeAlertReactions(notice, mineKey = '') {
    const counts = notice?.reactions && typeof notice.reactions === 'object' ? notice.reactions : {};
    return ALERT_REACTION_KEYS
        .map((key) => ({
            key,
            emoji: ALERT_REACTION_EMOJI[key],
            count: Number(counts[key] || 0) || 0,
            mine: mineKey === key,
        }))
        .filter((row) => row.count > 0 || row.mine);
}

/** WhatsApp-style breakdown: rows plus a total for the sheet header. */
export function buildAlertReactionBreakdown(notice, mineKey = '') {
    const rows = summarizeAlertReactions(notice, mineKey)
        .map((row) => ({ ...row, count: row.count > 0 ? row.count : (row.mine ? 1 : 0) }))
        .filter((row) => row.count > 0)
        .sort((a, b) => b.count - a.count || ALERT_REACTION_KEYS.indexOf(a.key) - ALERT_REACTION_KEYS.indexOf(b.key));
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return { total, rows };
}

const SEVERITY_SCORE = { critical: 3, warning: 2, info: 1 };

export function noticeTimestamp(notice) {
    if (!notice || typeof notice !== 'object') return 0;
    return Number(notice.repostedAt || notice.postedAt || notice.timestamp || 0) || 0;
}

export function isNoticeLive(notice, now = Date.now()) {
    if (!notice || typeof notice !== 'object') return false;
    const exp = Number(notice.expiresAt || 0);
    return !exp || exp > now;
}

function noticeHasPoll(node) {
    const poll = node?.poll;
    return !!(poll && typeof poll === 'object' && (poll.active || poll.question || poll.optionA || poll.optionB));
}

function childLooksLikeNotice(val) {
    return !!(val && typeof val === 'object' && (
        val.message || val.text || val.severity || val.imageUrls || val.imageUrl || noticeHasPoll(val)
    ));
}

export function isNoticeRecord(node) {
    return !!(node && typeof node === 'object' && (
        node.message || node.text || node.severity || node.id || node.imageUrls || node.imageUrl || noticeHasPoll(node)
    ));
}

/** Route ∪ region ∪ global. Pass routeId only when that corridor is real. */
export function noticeScopeKeys(region, routeId) {
    const keys = ['all'];
    const reg = String(region || '').trim();
    if (reg) keys.push(`all_${reg}`);
    if (routeId) keys.push(routeId);
    return keys;
}

function reactPathFor(sourceKey, id, raw, childKey) {
    if (childKey && raw && raw[childKey] && typeof raw[childKey] === 'object' && (raw[childKey].message || raw[childKey].text)) {
        return `${sourceKey}/${childKey}`;
    }
    if (id && raw && raw[id] && typeof raw[id] === 'object') return `${sourceKey}/${id}`;
    return String(sourceKey || '');
}

/**
 * Parse a Firebase notices/{target} node: legacy single object, map of posts, or array.
 */
export function parseNoticeBucket(raw, sourceKey, now = Date.now()) {
    if (!raw) return [];
    const stamp = (n, key) => {
        if (!n || typeof n !== 'object') return null;
        const id = n.id || key || null;
        return {
            ...n,
            id,
            _sourceKey: sourceKey,
            _reactPath: n._reactPath || reactPathFor(sourceKey, id, raw, key),
        };
    };

    if (Array.isArray(raw)) {
        return raw.map((n, i) => stamp(n, n?.id || String(i))).filter((n) => n && isNoticeLive(n, now));
    }
    if (typeof raw !== 'object') return [];

    const children = [];
    Object.entries(raw).forEach(([key, val]) => {
        if (key === 'reactions') return;
        if (childLooksLikeNotice(val)) {
            const row = stamp(val, val.id || key);
            if (row && isNoticeLive(row, now)) children.push(row);
        }
    });

    const rootLooksLikeNotice = !!(raw.message || raw.text || raw.imageUrls || raw.imageUrl || noticeHasPoll(raw));
    if (children.length) {
        if (rootLooksLikeNotice && raw.id) {
            const root = stamp(raw, raw.id);
            if (root && isNoticeLive(root, now) && !children.some((c) => c.id === root.id)) {
                children.unshift(root);
            }
        }
        return children;
    }
    if (rootLooksLikeNotice || raw.id || raw.severity) {
        const row = stamp(raw, raw.id);
        return row && isNoticeLive(row, now) ? [row] : [];
    }
    return [];
}

export function mergeUnionNotices(buckets) {
    const seenFallback = new Set();
    const byId = new Map();
    const unkeyed = [];

    const scopeRank = (key) => {
        const k = String(key || '');
        if (!k || k === 'all') return 0;
        if (/^all_/i.test(k)) return 1;
        return 2;
    };

    (buckets || []).forEach((list) => {
        (list || []).forEach((n) => {
            const id = n?.id != null && String(n.id).trim() ? String(n.id) : '';
            if (id) {
                const prev = byId.get(id);
                if (!prev || scopeRank(n._sourceKey) > scopeRank(prev._sourceKey)) {
                    byId.set(id, n);
                }
                return;
            }
            const key = `${n._sourceKey || ''}::${noticeTimestamp(n)}`;
            if (seenFallback.has(key)) return;
            seenFallback.add(key);
            unkeyed.push(n);
        });
    });

    const out = [...byId.values(), ...unkeyed];
    return sortAlertsFeed(out);
}

export function isNoticePinned(notice) {
    return notice?.pinned === true || notice?.pinned === 1 || notice?.pinned === 'true';
}

/** Oldest-first, with admin-pinned cards last so they sit at the bottom of the WhatsApp-style feed. */
export function sortAlertsFeed(notices) {
    const list = Array.isArray(notices) ? notices.slice() : [];
    list.sort((a, b) => {
        const ap = isNoticePinned(a) ? 1 : 0;
        const bp = isNoticePinned(b) ? 1 : 0;
        if (ap !== bp) return ap - bp;
        if (ap && bp) {
            const pinA = Number(a?.pinnedAt || 0);
            const pinB = Number(b?.pinnedAt || 0);
            if (pinA !== pinB) return pinA - pinB;
        }
        return noticeTimestamp(a) - noticeTimestamp(b);
    });
    return list;
}

export function highestSeverity(notices) {
    let best = 'info';
    let score = 0;
    (notices || []).forEach((n) => {
        const sev = n?.severity || 'info';
        const s = SEVERITY_SCORE[sev] || 1;
        if (s > score) {
            score = s;
            best = sev;
        }
    });
    return best;
}

export function criticalNotices(notices) {
    return (notices || []).filter((n) => (n.severity || 'info') === 'critical');
}

export function pageAlertsFeed(sortedOldestFirst, count = ALERTS_PAGE_SIZE) {
    const list = Array.isArray(sortedOldestFirst) ? sortedOldestFirst : [];
    const n = Math.max(1, Number(count) || ALERTS_PAGE_SIZE);
    if (list.length <= n) return { visible: list, hiddenCount: 0 };
    return { visible: list.slice(-n), hiddenCount: list.length - n };
}

export function seenStorageKey(notice) {
    const src = notice?._sourceKey || 'x';
    const id = notice?.id || notice?.timestamp || 'x';
    return `seen_notice_${src}_${id}`;
}

export function reactionStorageKey(notice) {
    return `nt_alert_reacted_${notice?._sourceKey || 'x'}_${notice?.id || 'x'}`;
}

export function shouldForceOpen(notice) {
    if (!notice) return false;
    const severity = notice.severity || 'info';
    return notice.forcePopup === true || (notice.forcePopup == null && severity === 'critical');
}

export function pickAutoOpenNotice(notices, isSeen = () => false) {
    const candidates = (notices || [])
        .filter((n) => shouldForceOpen(n) && !isSeen(n))
        .sort((a, b) => noticeTimestamp(b) - noticeTimestamp(a));
    return candidates[0] || null;
}

export function sanitizeAlertImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let path = url.trim();
    if (!path) return null;
    try {
        if (/^https?:\/\//i.test(path)) {
            const u = new URL(path);
            path = u.pathname || '';
        }
    } catch {
        return null;
    }
    const q = path.indexOf('?');
    if (q >= 0) path = path.slice(0, q);
    const hash = path.indexOf('#');
    if (hash >= 0) path = path.slice(0, hash);
    if (path.includes('..') || path.includes('//')) return null;
    if (path.startsWith(ALERT_IMAGE_PREFIX)) {
        if (!/^\/images\/alerts\/[A-Za-z0-9._-]+$/.test(path)) return null;
        return path;
    }
    if (path.startsWith(SCHEDULE_IMAGE_PREFIX)) {
        if (!/^\/images\/schedules\/[a-z0-9]+\/[A-Za-z0-9._-]+\.jpe?g$/i.test(path)) return null;
        return path;
    }
    return null;
}

export function collectNoticeImageUrls(notice) {
    const raw = (Array.isArray(notice?.imageUrls) && notice.imageUrls.length)
        ? notice.imageUrls
        : (notice?.imageUrl ? [notice.imageUrl] : []);
    const out = [];
    raw.forEach((u) => {
        const s = sanitizeAlertImageUrl(u);
        if (s && !out.includes(s) && out.length < 2) out.push(s);
    });
    return out;
}

/**
 * Hold-to-react should work on catalog posters and hoisted photos.
 * Reply / poll (including results) / count chips / real links stay excluded.
 */
export function shouldIgnoreAlertLongPress(target) {
    if (!target || typeof target.closest !== 'function') return true;
    if (target.closest('[data-alert-video]')) return true;
    if (target.closest('[data-alert-lightbox]')) return false;
    if (target.closest('[data-alert-media]')) return false;
    if (target.closest('button[onclick*="openLightbox"]')) return false;
    if (target.closest('[data-alert-reply], [data-alert-jump], [data-alert-summary], [data-alert-react-add], .nt-poll-vote, .nt-poll, [data-poll-shell]')) return true;
    if (target.closest('a, input, textarea, select')) return true;
    if (target.closest('button')) return true;
    return false;
}

/**
 * First See more lands on this many characters of the post.
 * Sized from the commuter sample that should stay visible through
 * "increase. Students, unemployed people a". Each later tap reveals
 * the same number again, and drops the button when the rest is shorter.
 */
export const ALERT_SEE_MORE_WINDOW = 764;

export function alertCopyNeedsSeeMore(html) {
    return stripHtmlToText(html).length > ALERT_SEE_MORE_WINDOW;
}

/** Characters visible after `step` reveals. Step 1 is the first window. */
export function alertSeeMoreLimit(step) {
    const n = Math.max(1, Number(step) || 1);
    return ALERT_SEE_MORE_WINDOW * n;
}

function decodeBasicEntity(raw) {
    const name = String(raw || '').slice(1, -1).toLowerCase();
    if (name === 'amp') return '&';
    if (name === 'lt') return '<';
    if (name === 'gt') return '>';
    if (name === 'quot') return '"';
    return '';
}

/** Cut rich HTML so its plain text is `limit` characters, then an ellipsis. */
export function clipHtmlToTextLength(html, limit) {
    const input = String(html || '');
    const max = Math.max(0, Number(limit) || 0);
    if (stripHtmlToText(input).length <= max) return input;
    let out = '';
    let count = 0;
    let started = false;
    let gap = false;
    const open = [];
    const voidTags = new Set(['br', 'hr', 'img', 'wbr', 'input', 'meta', 'link']);
    let i = 0;
    const emitSpace = () => {
        if (!started || !gap || count >= max) {
            gap = false;
            return count >= max;
        }
        out += ' ';
        count += 1;
        gap = false;
        return count >= max;
    };
    while (i < input.length && count < max) {
        if (input[i] === '<') {
            const end = input.indexOf('>', i);
            if (end < 0) break;
            const tag = input.slice(i, end + 1);
            const name = (tag.match(/^<\/?\s*([a-zA-Z0-9]+)/) || [])[1]?.toLowerCase() || '';
            const closing = /^<\s*\//.test(tag);
            const self = /\/\s*>$/.test(tag) || voidTags.has(name);
            /* A tag is a gap, same as the space stripHtmlToText inserts.
               Do not emit that space here. The next letter emits one space,
               so <b> between two words does not count twice. */
            gap = started || gap;
            out += tag;
            if (closing) {
                const at = open.lastIndexOf(name);
                if (at >= 0) open.splice(at, 1);
            } else if (name && !self) open.push(name);
            i = end + 1;
            continue;
        }
        if (/\s/.test(input[i]) || input.slice(i, i + 6).toLowerCase() === '&nbsp;') {
            gap = true;
            i += input.slice(i, i + 6).toLowerCase() === '&nbsp;' ? 6 : 1;
            continue;
        }
        if (input[i] === '&') {
            const semi = input.indexOf(';', i);
            const raw = semi > i && semi - i < 12 ? input.slice(i, semi + 1) : '';
            const decoded = raw ? decodeBasicEntity(raw) : '';
            if (decoded) {
                if (emitSpace()) break;
                if (count + decoded.length > max) break;
                out += raw;
                count += decoded.length;
                started = true;
                i = semi + 1;
                continue;
            }
        }
        if (emitSpace()) break;
        out += input[i];
        count += 1;
        started = true;
        i += 1;
    }
    out += '…';
    for (let n = open.length - 1; n >= 0; n -= 1) out += `</${open[n]}>`;
    return out;
}

export function buildAlertSeeMoreMarkup(innerHtml, opts = {}) {
    const full = String(innerHtml || '');
    const clipped = clipHtmlToTextLength(full, ALERT_SEE_MORE_WINDOW);
    const extra = opts.className ? ` ${opts.className}` : '';
    const stored = full.replace(/<\/template/gi, '<\\/template');
    return `<div class="nt-alert-copy${extra}"><div class="nt-rich-body nt-alert-body text-sm text-gray-800 dark:text-gray-200 leading-relaxed" data-alert-body data-see-more-step="1">${clipped}</div><template data-alert-full>${stored}</template><button type="button" class="nt-alert-see-more" data-alert-see-more>See more...</button></div>`;
}

/**
 * One See more tap. Reveal another full window when the post is still
 * that long. Otherwise show the rest and drop the button.
 */
export function expandAlertSeeMore(button) {
    const copy = button?.closest?.('.nt-alert-copy');
    const body = copy?.querySelector?.('[data-alert-body]');
    if (!body) {
        button?.remove?.();
        return;
    }
    const template = copy.querySelector?.('template[data-alert-full]');
    const full = template ? template.innerHTML : '';
    if (!full) {
        body.classList.remove('is-collapsed');
        body.style.webkitLineClamp = '';
        body.style.lineClamp = '';
        button.remove();
        return;
    }
    const step = Math.max(1, Number(body.getAttribute('data-see-more-step')) || 1);
    const nextStep = step + 1;
    if (stripHtmlToText(full).length > alertSeeMoreLimit(nextStep)) {
        body.innerHTML = clipHtmlToTextLength(full, alertSeeMoreLimit(nextStep));
        body.setAttribute('data-see-more-step', String(nextStep));
        return;
    }
    body.innerHTML = full;
    body.classList.remove('is-collapsed');
    body.style.webkitLineClamp = '';
    body.style.lineClamp = '';
    body.removeAttribute('data-see-more-step');
    template.remove();
    button.remove();
}

function stripHtmlToText(html) {
    return String(html || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

const LEADING_HEADING_RE = /^\s*<(h[1-4])(\s[^>]*)?>([\s\S]*?)<\/\1>\s*/i;

/** Title field wins; otherwise a leading h1–h4 from the WYSIWYG Title control. */
export function splitAlertTitleAndBody(html, explicitTitle = '') {
    const explicit = String(explicitTitle || '').trim();
    let body = String(html || '');
    const match = body.match(LEADING_HEADING_RE);
    if (match) {
        const extracted = stripHtmlToText(match[3]);
        if (extracted) {
            return { title: explicit || extracted, body: body.slice(match[0].length) };
        }
    }
    return { title: explicit, body };
}

const PUBLIC_IMAGE_FILE = /\.(jpe?g|png|gif|webp)$/i;
const PUBLIC_VIDEO_FILE = /\.(mp4|webm|mov|m4v|ogv)$/i;

function isStoredImageHost(host) {
    const name = String(host || '').toLowerCase();
    return name === 'firebasestorage.googleapis.com'
        || name === 'storage.googleapis.com'
        || name.endsWith('.firebasestorage.app')
        || name.endsWith('.googleusercontent.com');
}

/**
 * Catalog posters, Firebase Storage, or a public https image file.
 * The file can live on Imgur or any other public host. Pages are not images.
 */
export function sanitizeInlineAlertImageUrl(url) {
    const s = String(url || '').trim();
    if (!s || /[\s<>]/.test(s)) return null;
    const alerts = sanitizeAlertImageUrl(s);
    if (alerts) return alerts;
    try {
        const u = new URL(s);
        if (u.protocol !== 'https:') return null;
        if (u.username || u.password) return null;
        if (isStoredImageHost(u.hostname)) return u.href;
        const cleaned = cleanHttpUrl(u.href);
        if (!cleaned || !isPublicPreviewUrl(cleaned)) return null;
        const pub = new URL(cleaned);
        let path = pub.pathname || '';
        try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
        if (!PUBLIC_IMAGE_FILE.test(path)) return null;
        return pub.href;
    } catch {
        return null;
    }
}

/** Full view uses the saved poster bytes, not a second download of the https address. */
export function preferSavedPosterSrc(objectUrl, liveSrc, fallback) {
    const blob = String(objectUrl || '');
    if (blob.startsWith('blob:')) return blob;
    const live = String(liveSrc || '');
    if (live.startsWith('blob:')) return live;
    return String(fallback || live || '');
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** YouTube watch id, or empty. Nothing is fetched. */
export function youtubeVideoId(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return ''; }
    const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^(www|m)\./, '');
    let id = '';
    if (host === 'youtu.be') id = u.pathname.split('/').filter(Boolean)[0] || '';
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
        if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
        else {
            const parts = u.pathname.split('/').filter(Boolean);
            if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1] || '';
        }
    }
    id = String(id || '').split(/[?&#]/)[0];
    return YOUTUBE_ID.test(id) ? id : '';
}

/** Vimeo clip id, or empty. Nothing is fetched. */
export function vimeoVideoId(url) {
    let u;
    try { u = new URL(String(url || '')); } catch { return ''; }
    const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return '';
    const parts = u.pathname.split('/').filter(Boolean);
    return parts.find((part) => /^\d{6,12}$/.test(part)) || '';
}

/** file, youtube, or vimeo. Empty when the address is not a video we can show. */
export function alertVideoKind(url) {
    const clean = cleanHttpUrl(url);
    if (!clean || !isPublicPreviewUrl(clean)) return '';
    if (youtubeVideoId(clean)) return 'youtube';
    if (vimeoVideoId(clean)) return 'vimeo';
    try {
        const pub = new URL(clean);
        let path = pub.pathname || '';
        try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
        if (PUBLIC_VIDEO_FILE.test(path)) return 'file';
    } catch { /* ignore */ }
    return '';
}

/**
 * Still picture for a YouTube link. Same jpeg an embed shows before play.
 * Vimeo has no fixed picture address. A video file has no picture until it plays.
 */
export function alertVideoPosterUrl(url) {
    const id = youtubeVideoId(url);
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

/** Player address. Only used after the commuter taps Play. */
export function alertVideoEmbedUrl(url) {
    const yt = youtubeVideoId(url);
    if (yt) return `https://www.youtube-nocookie.com/embed/${yt}?rel=0&playsinline=1`;
    const vimeo = vimeoVideoId(url);
    if (vimeo) return `https://player.vimeo.com/video/${vimeo}?playsinline=1`;
    return '';
}

/**
 * A direct video file, or a YouTube / Vimeo watch page.
 * The returned address is safe to keep. It does not load the video.
 */
export function sanitizeAlertVideoUrl(url) {
    const kind = alertVideoKind(url);
    if (!kind) return null;
    const clean = cleanHttpUrl(url);
    if (kind === 'youtube') return `https://www.youtube.com/watch?v=${youtubeVideoId(clean)}`;
    if (kind === 'vimeo') return `https://vimeo.com/${vimeoVideoId(clean)}`;
    return clean;
}

function pushVideoUrl(urls, raw) {
    const clean = sanitizeAlertVideoUrl(String(raw || '').trim().replace(/&amp;/gi, '&'));
    if (clean && !urls.includes(clean)) urls.push(clean);
}

/** Lift direct video files out of the body. The player is added separately and must not preload. */
export function extractAlertVideoUrls(html) {
    const urls = [];
    let body = String(html || '');
    body = body.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, (tag) => {
        const found = String(tag || '').matchAll(/\bsrc=["']([^"']+)["']/gi);
        for (const match of found) pushVideoUrl(urls, match[1]);
        return '';
    });
    body = body.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, (tag, href) => {
        const before = urls.length;
        pushVideoUrl(urls, href);
        return urls.length > before ? '' : tag;
    });
    body = body.replace(/https:\/\/[^\s<>"']+/gi, (raw) => {
        const trimmed = raw.replace(/[),.;]+$/, '');
        const before = urls.length;
        pushVideoUrl(urls, trimmed);
        if (urls.length === before) return raw;
        return raw.slice(trimmed.length);
    });
    return { urls, body };
}

/** Pull lightbox/img tags out of the body so photos can sit above the text. */
export function hoistAlertImagesFromHtml(html) {
    const urls = [];
    const pushUrl = (raw) => {
        const s = String(raw || '').trim().replace(/&amp;/gi, '&');
        if (s && !urls.includes(s)) urls.push(s);
    };
    const pushImgTag = (tag) => {
        pushUrl((String(tag || '').match(/\bsrc=["']([^"']+)["']/i) || [])[1]);
        pushUrl((String(tag || '').match(/\bdata-nt-src=["']([^"']+)["']/i) || [])[1]);
    };
    let body = String(html || '');
    body = body.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, (tag) => {
        const img = tag.match(/<img\b[^>]*>/i);
        if (!img) return tag;
        pushImgTag(img[0]);
        return '';
    });
    body = body.replace(/<img\b[^>]*>/gi, (tag) => {
        pushImgTag(tag);
        return '';
    });
    body = body.replace(/^(?:\s|&nbsp;|<br\s*\/?>)+/gi, '');
    body = body.replace(/(?:\s|&nbsp;|<br\s*\/?>)+$/gi, '');
    return { urls, body };
}

/** Admin compose appends `- Signoff` as a trailing span; the card header shows authorName instead. */
export function stripAlertSignoffHtml(html) {
    let body = String(html || '');
    body = body.replace(/(?:<br\s*\/?>|&nbsp;|\s)*<span\b[^>]*>\s*[-—–]\s*[^<]*<\/span>\s*$/i, '');
    body = body.replace(/(?:<br\s*\/?>|&nbsp;|\s)+$/gi, '');
    return body;
}

/** Short label for the union bucket a notice came from. */
export function noticeScopeLabel(sourceKey) {
    const key = String(sourceKey || '').trim();
    if (!key || key === 'all') return 'Network';
    const regionMatch = key.match(/^all_([A-Z0-9]+)$/i);
    if (regionMatch) {
        const code = regionMatch[1].toUpperCase();
        const names = { GP: 'Gauteng', WC: 'Western Cape', KZN: 'KwaZulu-Natal', EC: 'Eastern Cape' };
        return names[code] || code;
    }
    return key;
}

/**
 * WhatsApp-style card order: title (if any) → images → remaining text.
 * Channel posters (`imageUrls`) plus any inline <img> in the message.
 */
export function layoutAlertPost(notice) {
    const raw = String(notice?.message || notice?.text || '');
    const split = splitAlertTitleAndBody(raw, notice?.title);
    const hoisted = hoistAlertImagesFromHtml(split.body);
    const images = [];
    collectNoticeImageUrls(notice).forEach((u) => {
        if (!images.includes(u)) images.push(u);
    });
    hoisted.urls.forEach((u) => {
        const clean = sanitizeInlineAlertImageUrl(u);
        if (clean && !images.includes(clean)) images.push(clean);
    });
    const videos = [];
    const rawMedia = (Array.isArray(notice?.imageUrls) && notice.imageUrls.length)
        ? notice.imageUrls
        : (notice?.imageUrl ? [notice.imageUrl] : []);
    rawMedia.forEach((u) => pushVideoUrl(videos, u));
    pushVideoUrl(videos, notice?.ctaUrl);
    const extracted = extractAlertVideoUrls(hoisted.body);
    extracted.urls.forEach((u) => pushVideoUrl(videos, u));
    return {
        title: split.title,
        imageUrls: images.filter((u) => !sanitizeAlertVideoUrl(u)).slice(0, 4),
        videoUrls: videos.slice(0, 2),
        body: stripAlertSignoffHtml(extracted.body),
    };
}

const ALERT_VIDEO_PLAY_ICON = `<svg class="h-8 w-8" width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.14-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z"></path></svg>`;

/**
 * A play control only. The video element has no address until the commuter taps,
 * so nothing is fetched or played on its own.
 */
function escapeAlertAttr(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function renderAlertVideoMarkup(urls) {
    const list = (Array.isArray(urls) ? urls : []).map((u) => sanitizeAlertVideoUrl(u)).filter(Boolean);
    if (!list.length) return '';
    const cells = list.map((href) => {
        const src = escapeAlertAttr(href);
        const kind = alertVideoKind(href);
        const poster = alertVideoPosterUrl(href);
        const picture = poster
            ? `<img alt="" src="${escapeAlertAttr(poster)}" referrerpolicy="no-referrer" draggable="false" class="absolute inset-0 h-full w-full object-cover" data-alert-video-poster>`
            : (kind === 'vimeo'
                ? `<img alt="" referrerpolicy="no-referrer" draggable="false" class="absolute inset-0 h-full w-full object-cover" data-alert-video-poster data-alert-video-poster-pending data-alert-video-page="${src}">`
                : '');
        const file = kind === 'file'
            ? `<video controls playsinline preload="none" class="hidden max-h-72 w-full bg-black" data-alert-video-el></video>`
            : '';
        return `<div class="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-900 dark:border-gray-700" data-alert-video data-alert-video-kind="${kind}">
            ${file}
            <button type="button" data-alert-video-play data-alert-video-src="${src}" class="relative flex min-h-[10rem] w-full items-center justify-center focus:outline-none">${picture}<span data-alert-video-play-chip class="relative z-[1] flex items-center gap-2 rounded-full bg-black/55 px-3 py-2 font-bold text-white">${ALERT_VIDEO_PLAY_ICON}<span>Play video</span></span></button>
        </div>`;
    }).join('');
    return `<div class="mb-1 mt-2 grid grid-cols-1 gap-2" data-alert-media>${cells}</div>`;
}

export function buildNoticesMeta(notices) {
    const live = (notices || []).filter((n) => isNoticeLive(n));
    const latest = live.slice().sort((a, b) => noticeTimestamp(b) - noticeTimestamp(a))[0] || null;
    const crit = live
        .filter((n) => (n.severity || '') === 'critical')
        .sort((a, b) => noticeTimestamp(b) - noticeTimestamp(a))[0] || null;
    return {
        latestId: latest?.id || null,
        latestAt: latest ? noticeTimestamp(latest) : 0,
        latestCriticalAt: crit ? noticeTimestamp(crit) : 0,
        latestSeverity: highestSeverity(live),
        liveCount: live.length,
    };
}

/** Flatten a target node for admin (includes expired). */
export function listNoticesInTarget(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) {
        return node.filter((n) => n && typeof n === 'object').map((n, i) => ({ ...n, _key: n.id || String(i) }));
    }
    const children = [];
    Object.entries(node).forEach(([key, val]) => {
        if (key === 'reactions') return;
        if (childLooksLikeNotice(val)) {
            children.push({ ...val, _key: val.id || key });
        }
    });
    if (children.length) return children;
    if (node.message || node.text || node.id || node.imageUrls || node.imageUrl || noticeHasPoll(node)) {
        return [{ ...node, _key: node.id || 'legacy' }];
    }
    return [];
}

export function isLegacySingleNotice(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    if (!(node.message || node.text)) return false;
    return !Object.entries(node).some(([key, val]) => (
        key !== 'reactions'
        && val
        && typeof val === 'object'
        && (val.message || val.text || val.severity || val.imageUrls || val.imageUrl)
    ));
}
