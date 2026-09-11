/**
 * Commuter inbox visibility for admin replies.
 * Storage is unchanged — this only decides whether the banner still shows.
 * Do not surface this rule in What’s New or other commuter copy.
 */

export const ADMIN_REPLY_HIDE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** Commuter copies live under inbox/ for the Feedback Hub chat. They are not admin replies. */
export function isCommuterInboxEntry(entry, id = '') {
    if (!entry || typeof entry !== 'object') return false;
    if (String(entry.from || '').toLowerCase() === 'commuter') return true;
    const key = String(id || entry.id || '');
    return key.startsWith('cm_');
}

export function inboxReplyStillVisible(entry, now = Date.now(), id = '') {
    if (!entry || typeof entry !== 'object') return false;
    if (isCommuterInboxEntry(entry, id)) return false;
    if (entry.read === true || entry.acknowledged === true) return false;
    const viewedAt = Number(entry.viewedAt) || 0;
    if (viewedAt > 0 && (now - viewedAt) >= ADMIN_REPLY_HIDE_AFTER_MS) return false;
    return true;
}
