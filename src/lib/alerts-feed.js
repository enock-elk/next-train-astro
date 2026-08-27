/**
 * Pure alerts-channel feed rules (no DOM). Union scoping, expiry, posters, paging.
 */
export const ALERTS_PAGE_SIZE = 10;
export const ALERT_IMAGE_PREFIX = '/images/alerts/';
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

export function isNoticeRecord(node) {
    return !!(node && typeof node === 'object' && (node.message || node.text || node.severity || node.id));
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
        if (val && typeof val === 'object' && (val.message || val.text || val.severity)) {
            const row = stamp(val, val.id || key);
            if (row && isNoticeLive(row, now)) children.push(row);
        }
    });

    const rootLooksLikeNotice = !!(raw.message || raw.text);
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
    out.sort((a, b) => noticeTimestamp(a) - noticeTimestamp(b));
    return out;
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
    if (!path.startsWith(ALERT_IMAGE_PREFIX)) return null;
    if (path.includes('..') || path.includes('//')) return null;
    if (!/^\/images\/alerts\/[A-Za-z0-9._-]+$/.test(path)) return null;
    return path;
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
 * Reply / poll / count chips / real links stay excluded.
 */
export function shouldIgnoreAlertLongPress(target) {
    if (!target || typeof target.closest !== 'function') return true;
    if (target.closest('[data-alert-lightbox]')) return false;
    if (target.closest('[data-alert-media]')) return false;
    if (target.closest('button[onclick*="openLightbox"]')) return false;
    if (target.closest('[data-alert-reply], [data-alert-jump], [data-alert-summary], .nt-poll-vote')) return true;
    if (target.closest('a, input, textarea, select')) return true;
    if (target.closest('button')) return true;
    return false;
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

/** Allow already-published Firebase Storage attachments; reject everything else. */
export function sanitizeInlineAlertImageUrl(url) {
    const s = String(url || '').trim();
    if (!s || /[\s<>]/.test(s)) return null;
    const alerts = sanitizeAlertImageUrl(s);
    if (alerts) return alerts;
    try {
        const u = new URL(s);
        if (u.protocol !== 'https:') return null;
        const host = u.hostname.toLowerCase();
        if (
            host === 'firebasestorage.googleapis.com'
            || host.endsWith('.firebasestorage.app')
            || host.endsWith('.googleusercontent.com')
        ) {
            return u.href;
        }
    } catch {
        return null;
    }
    return null;
}

/** Pull lightbox/img tags out of the body so photos can sit above the text. */
export function hoistAlertImagesFromHtml(html) {
    const urls = [];
    let body = String(html || '');
    body = body.replace(/<button\b[^>]*>[\s\S]*?<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/button>/gi, (_, src) => {
        const s = String(src || '').trim();
        if (s && !urls.includes(s)) urls.push(s);
        return '';
    });
    body = body.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_, src) => {
        const s = String(src || '').trim();
        if (s && !urls.includes(s)) urls.push(s);
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
    return {
        title: split.title,
        imageUrls: images.slice(0, 4),
        body: stripAlertSignoffHtml(hoisted.body),
    };
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
        if (val && typeof val === 'object' && (val.message || val.text || val.severity)) {
            children.push({ ...val, _key: val.id || key });
        }
    });
    if (children.length) return children;
    if (node.message || node.text || node.id) return [{ ...node, _key: node.id || 'legacy' }];
    return [];
}

export function isLegacySingleNotice(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    if (!(node.message || node.text)) return false;
    return !Object.entries(node).some(([key, val]) => (
        key !== 'reactions'
        && val
        && typeof val === 'object'
        && (val.message || val.text || val.severity)
    ));
}
