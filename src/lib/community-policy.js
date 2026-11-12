/**
 * Community cost and delete rules shared by the phone and the Worker.
 *
 * The phone listens to a fixed number of messages. Firebase bills Realtime
 * Database for bytes downloaded. limitToLast(N) is a count, so N messages is
 * the cap a phone can actually enforce. The database keeps the older messages
 * so Community Monitor can page through the full log. Each message is already
 * capped at 4000 characters. The bubble folds at the same length as an
 * alert (See more...), so a real note is stored whole and a pasted essay is not.
 */
import { ALERT_SEE_MORE_WINDOW, sanitizeInlineAlertImageUrl } from './alerts-feed.js';

/** Newest messages a phone listens to. The database keeps the rest. */
export const COMMUNITY_BUCKET_DEPTH = 80;
/** Hard send cap. A normal message fits. A pasted essay does not. */
export const COMMUNITY_BODY_MAX = 4000;
export const COMMUNITY_ADMIN_BODY_MAX = 4000;
/** Same first window as an alert. Later taps reveal the same amount again. */
export const COMMUNITY_SEE_MORE_WINDOW = ALERT_SEE_MORE_WINDOW;

/** Collapsed length, matching how an alert counts its text. */
export function communityTextLength(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().length;
}

/**
 * Cut plain text for the bubble. Line breaks stay. The cut uses the same
 * collapsed-character count as an alert, then an ellipsis.
 */
export function clipCommunityText(text, limit) {
    const raw = String(text || '');
    const max = Math.max(0, Number(limit) || 0);
    if (communityTextLength(raw) <= max) return raw;
    let count = 0;
    let i = 0;
    let started = false;
    while (i < raw.length && count < max) {
        if (/\s/.test(raw[i])) {
            let j = i;
            while (j < raw.length && /\s/.test(raw[j])) j += 1;
            if (!started) {
                i = j;
                continue;
            }
            if (count + 1 > max) break;
            count += 1;
            i = j;
            continue;
        }
        count += 1;
        started = true;
        i += 1;
    }
    return `${raw.slice(0, i).replace(/\s+$/u, '')}…`;
}
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
