/**
 * Community cost and delete rules shared by the phone and the Worker.
 *
 * A room keeps a fixed number of messages, not a character budget and not a
 * 24 hour clock. Firebase bills Realtime Database for bytes downloaded.
 * limitToLast(N) is a count, so N messages is the cap the listener can
 * actually enforce. Each message is already capped (280 for a passenger,
 * 1000 for an operator), which caps the bytes inside that count.
 */
import { sanitizeInlineAlertImageUrl } from './alerts-feed.js';

/** Newest messages kept on a route. Listeners must use the same limitToLast. */
export const COMMUNITY_BUCKET_DEPTH = 80;
export const COMMUNITY_BODY_MAX = 280;
export const COMMUNITY_ADMIN_BODY_MAX = 1000;
/** Image addresses only. Bytes stay on the image host, not in the database. */
export const COMMUNITY_ADMIN_IMAGE_MAX = 4;

export const DELETED_MESSAGE = 'Deleted message';
export const DELETED_BY_ADMIN = 'Deleted by an Admin';

export function communityTombstoneLabel(by) {
    return by === 'admin' ? DELETED_BY_ADMIN : DELETED_MESSAGE;
}

export function isCommunityTombstone(post) {
    if (!post || typeof post !== 'object') return false;
    if (post.deleted === true) return true;
    const body = String(post.body || '');
    return body === DELETED_MESSAGE || body === DELETED_BY_ADMIN;
}

/**
 * Fields to merge onto the one message being removed.
 * replyTo on every other message is a copy made when that person quoted,
 * and this patch does not mention those messages, so their quotes stay.
 */
export function communityTombstonePatch(by, now = Date.now()) {
    const actor = by === 'admin' ? 'admin' : 'author';
    return {
        body: communityTombstoneLabel(actor),
        deleted: true,
        deletedBy: actor,
        deletedAt: now,
        photoURL: null,
        attachments: null,
        linkUrl: null,
        replyTo: null,
    };
}

export function sanitizeCommunityImageUrl(url) {
    return sanitizeInlineAlertImageUrl(url);
}

export function sanitizeCommunityLinkUrl(url) {
    const clean = String(url || '').trim();
    if (!clean) return '';
    let parsed;
    try { parsed = new URL(clean); } catch { return ''; }
    if (parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    if (parsed.href.length > 400) return '';
    return parsed.href;
}

/** Operators only. Passengers get an empty list even if they send some. */
export function sanitizeCommunityAttachments(raw, { admin = false } = {}) {
    if (!admin) return [];
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    list.forEach((item) => {
        if (out.length >= COMMUNITY_ADMIN_IMAGE_MAX) return;
        const url = sanitizeCommunityImageUrl(typeof item === 'string' ? item : item?.url);
        if (!url || out.includes(url)) return;
        out.push(url);
    });
    return out;
}

/**
 * Ids that fall off the end once the room is past `depth`.
 * Oldest first. Equal timestamps break ties by id so two callers agree.
 */
export function communityIdsPastBucket(entries, depth = COMMUNITY_BUCKET_DEPTH) {
    const rows = (Array.isArray(entries) ? entries : [])
        .map((row) => ({
            id: String(row?.id || ''),
            timestamp: Number(row?.timestamp) || 0,
        }))
        .filter((row) => row.id);
    rows.sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const keep = Math.max(1, Number(depth) || COMMUNITY_BUCKET_DEPTH);
    if (rows.length <= keep) return [];
    return rows.slice(0, rows.length - keep).map((row) => row.id);
}
