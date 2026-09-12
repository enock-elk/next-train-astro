/**
 * Expiry-aware Cache Storage for alert posters.
 * Workbox's generic `images` bucket is capped and has no notice expiry.
 */
import { safeStorage } from './utils.js';
import { collectNoticeImageUrls, layoutAlertPost, sanitizeAlertImageUrl, sanitizeInlineAlertImageUrl } from './alerts-feed.js';

export const ALERT_IMAGE_CACHE = 'nt-alert-images-v1';
export const ALERT_IMAGE_INDEX_KEY = 'nt_alert_img_index_v1';

function readIndex() {
    try {
        const raw = safeStorage.getItem(ALERT_IMAGE_INDEX_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function writeIndex(idx) {
    try {
        safeStorage.setItem(ALERT_IMAGE_INDEX_KEY, JSON.stringify(idx || {}));
    } catch { /* ignore */ }
}

function resolveNoticeImageUrl(path, resolveSrc) {
    if (typeof resolveSrc === 'function') {
        const href = resolveSrc(path);
        if (href) return href;
    }
    return sanitizeAlertImageUrl(path) || sanitizeInlineAlertImageUrl(path) || '';
}

export async function resolveCachedAlertImage(url) {
    if (!url || typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(ALERT_IMAGE_CACHE);
        return await cache.match(url);
    } catch {
        return null;
    }
}

export async function cacheAlertImages(notice, resolveSrc) {
    if (!notice || typeof caches === 'undefined') return;
    const paths = collectNoticeImageUrls(notice);
    const layoutUrls = layoutAlertPost(notice).imageUrls || [];
    const rawExtra = Array.isArray(notice.imageUrls) ? notice.imageUrls : [];
    const all = [...paths, ...layoutUrls, ...rawExtra].filter(Boolean);
    const urls = [];
    all.forEach((path) => {
        const href = resolveNoticeImageUrl(path, resolveSrc);
        if (href && !urls.includes(href)) urls.push(href);
    });
    if (!urls.length) return;

    const expiresAt = Number(notice.expiresAt || 0);
    const noticeId = String(notice.id || '');
    let cache;
    try {
        cache = await caches.open(ALERT_IMAGE_CACHE);
    } catch {
        return;
    }
    const idx = readIndex();
    for (const url of urls) {
        try {
            const res = await fetch(url, { credentials: 'omit' });
            if (res && res.ok) await cache.put(url, res.clone());
            idx[url] = { expiresAt, noticeId };
        } catch { /* CORS / offline — skip this url */ }
    }
    writeIndex(idx);
}

export async function pruneExpiredAlertImages(liveNotices = [], now = Date.now()) {
    if (typeof caches === 'undefined') return;
    const liveIds = new Set((liveNotices || []).map((n) => String(n?.id || '')).filter(Boolean));
    let cache;
    try {
        cache = await caches.open(ALERT_IMAGE_CACHE);
    } catch {
        return;
    }
    const idx = readIndex();
    let changed = false;
    for (const [url, meta] of Object.entries(idx)) {
        const exp = Number(meta?.expiresAt || 0);
        const id = String(meta?.noticeId || '');
        const expired = exp > 0 && exp <= now;
        const gone = !!id && !liveIds.has(id);
        if (expired || gone) {
            try { await cache.delete(url); } catch { /* ignore */ }
            delete idx[url];
            changed = true;
        }
    }
    if (changed) writeIndex(idx);
}
