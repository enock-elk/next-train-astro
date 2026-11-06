/**
 * Expiry-aware Cache Storage for alert posters.
 * Workbox's generic `images` bucket is capped and has no notice expiry.
 */
import { safeStorage } from './utils.js';
import { collectNoticeImageUrls, layoutAlertPost, sanitizeAlertImageUrl, sanitizeAlertVideoUrl, sanitizeInlineAlertImageUrl } from './alerts-feed.js';

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

/** File type for a saved poster. Opaque responses do not carry a MIME type. */
export function imageMimeForUrl(url) {
    let path = String(url || '');
    try { path = decodeURIComponent(path); } catch { /* keep the raw string */ }
    path = path.split(/[?#]/)[0].toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
}

function typedImageBlob(blob, url) {
    if (!blob || blob.size <= 0) return null;
    const type = blob.type && blob.type.startsWith('image/') ? blob.type : imageMimeForUrl(url);
    if (blob.type === type) return blob;
    return new Blob([blob], { type });
}

const inflightAlertImages = new Map();

/**
 * Bytes for a poster, from this device's cache when the alert is still live.
 * A cross-origin file is stored with no-cors so a host that blocks script
 * fetches can still be kept until the notice expires.
 */
export function loadAlertImageBlob(url, meta = {}) {
    const href = String(url || '');
    if (!href) return Promise.resolve(null);
    if (inflightAlertImages.has(href)) return inflightAlertImages.get(href);
    const job = loadAlertImageBlobNow(href, meta).finally(() => {
        inflightAlertImages.delete(href);
    });
    inflightAlertImages.set(href, job);
    return job;
}

async function loadAlertImageBlobNow(url, meta) {
    if (typeof caches === 'undefined') return null;
    const cached = await resolveCachedAlertImage(url);
    if (cached) {
        try {
            const blob = typedImageBlob(await cached.blob(), url);
            if (blob) return blob;
        } catch { /* fetch a fresh copy */ }
    }
    let res;
    try {
        res = await fetch(url, { mode: 'no-cors', credentials: 'omit' });
    } catch {
        return null;
    }
    let blob = null;
    try { blob = typedImageBlob(await res.blob(), url); } catch { return null; }
    if (!blob) return null;
    try {
        const cache = await caches.open(ALERT_IMAGE_CACHE);
        await cache.put(url, new Response(blob, {
            status: 200,
            headers: { 'Content-Type': blob.type || imageMimeForUrl(url) },
        }));
        const idx = readIndex();
        idx[url] = {
            expiresAt: Number(meta.expiresAt || 0),
            noticeId: String(meta.noticeId || ''),
        };
        writeIndex(idx);
    } catch { /* the blob can still paint this visit */ }
    return blob;
}

export async function cacheAlertImages(notice, resolveSrc) {
    if (!notice || typeof caches === 'undefined') return;
    const paths = collectNoticeImageUrls(notice);
    const layoutUrls = layoutAlertPost(notice).imageUrls || [];
    const rawExtra = Array.isArray(notice.imageUrls) ? notice.imageUrls : [];
    const all = [...paths, ...layoutUrls, ...rawExtra].filter(Boolean);
    const urls = [];
    all.forEach((path) => {
        if (sanitizeAlertVideoUrl(path)) return;
        const href = resolveNoticeImageUrl(path, resolveSrc);
        if (href && !sanitizeAlertVideoUrl(href) && !urls.includes(href)) urls.push(href);
    });
    if (!urls.length) return;

    const expiresAt = Number(notice.expiresAt || 0);
    const noticeId = String(notice.id || '');
    for (const url of urls) {
        await loadAlertImageBlob(url, { expiresAt, noticeId });
    }
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
