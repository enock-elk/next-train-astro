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

function collectLinkPreviewImages(notice) {
    const urls = [];
    const push = (card) => {
        const image = typeof card?.image === 'string' ? card.image.trim() : '';
        if (!image || urls.includes(image)) return;
        if (!/^https:\/\//i.test(image)) return;
        urls.push(image);
    };
    push(notice?.linkPreview);
    (Array.isArray(notice?.linkPreviews) ? notice.linkPreviews : []).forEach(push);
    return urls;
}

function replyWorkerImageProxy(url) {
    if (typeof window === 'undefined') return '';
    const base = String(window.REPLY_WORKER_URL || '').replace(/\/$/, '');
    if (!base || !/^https:\/\//i.test(url)) return '';
    return `${base}/unfurl-image?url=${encodeURIComponent(url)}`;
}

async function storeAlertImage(cache, url) {
    try {
        const res = await fetch(url, { credentials: 'omit' });
        if (res && res.ok && res.type !== 'opaque') {
            await cache.put(url, res.clone());
            return true;
        }
    } catch { /* try the preview worker for bytes the page cannot read */ }
    const proxy = replyWorkerImageProxy(url);
    if (!proxy) return false;
    try {
        const proxied = await fetch(proxy, { credentials: 'omit' });
        if (!proxied.ok || proxied.type === 'opaque') return false;
        const type = String(proxied.headers.get('content-type') || '');
        if (!/^image\//i.test(type)) return false;
        await cache.put(url, proxied.clone());
        return true;
    } catch {
        return false;
    }
}

export async function cacheAlertImages(notice, resolveSrc) {
    if (!notice || typeof caches === 'undefined') return;
    const paths = collectNoticeImageUrls(notice);
    const layoutUrls = layoutAlertPost(notice).imageUrls || [];
    const rawExtra = Array.isArray(notice.imageUrls) ? notice.imageUrls : [];
    const previewImages = collectLinkPreviewImages(notice);
    const all = [...paths, ...layoutUrls, ...rawExtra, ...previewImages].filter(Boolean);
    const urls = [];
    all.forEach((path) => {
        const href = /^https:\/\//i.test(path) ? path : resolveNoticeImageUrl(path, resolveSrc);
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
        const stored = await storeAlertImage(cache, url);
        if (stored) idx[url] = { expiresAt, noticeId };
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
