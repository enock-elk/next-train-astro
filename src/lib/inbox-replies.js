/**
 * Commuter inbox visibility for admin replies.
 * Storage is unchanged — this only decides whether the banner still shows.
 * Do not surface this rule in What’s New or other commuter copy.
 */

export const ADMIN_REPLY_HIDE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export function inboxReplyStillVisible(entry, now = Date.now()) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.read === true || entry.acknowledged === true) return false;
    const viewedAt = Number(entry.viewedAt) || 0;
    if (viewedAt > 0 && (now - viewedAt) >= ADMIN_REPLY_HIDE_AFTER_MS) return false;
    return true;
}
