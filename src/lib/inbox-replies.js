/**
 * Commuter inbox visibility for admin replies.
 * Do not surface this rule in What’s New or other commuter copy.
 */

export const ADMIN_REPLY_HIDE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export const INBOX_REPLY_ACKS_KEY = 'ntInboxAcknowledgedV1';

function stableHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function inboxReplyIdentity(entry, firebaseKey = '') {
    const explicitId = String(firebaseKey || entry?.id || '').trim();
    if (explicitId) return explicitId;
    if (!entry || typeof entry !== 'object') return '';
    const legacyValue = JSON.stringify([
        Number(entry.timestamp) || 0,
        String(entry.message || entry.text || ''),
        String(entry.from || ''),
        String(entry.fromName || ''),
        String(entry.feedbackId || ''),
    ]);
    return `legacy_${stableHash(legacyValue)}`;
}

export function inboxReplyAckToken(deviceId, entry, firebaseKey = '') {
    const replyId = inboxReplyIdentity(entry, firebaseKey);
    return replyId ? `${String(deviceId || 'installation')}:${replyId}` : '';
}

export function parseInboxReplyAcks(raw) {
    try {
        const values = JSON.parse(raw || '[]');
        return new Set(Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value) : []);
    } catch {
        return new Set();
    }
}

export function addInboxReplyAcks(raw, tokens) {
    const acknowledgements = parseInboxReplyAcks(raw);
    for (const token of tokens || []) {
        if (token) acknowledgements.add(String(token));
    }
    return JSON.stringify([...acknowledgements]);
}

export function inboxReplyStillVisible(entry, now = Date.now(), locallyAcknowledged = false) {
    if (!entry || typeof entry !== 'object') return false;
    if (locallyAcknowledged) return false;
    if (entry.read === true || entry.acknowledged === true) {
        return false;
    }
    const viewedAt = Number(entry.viewedAt) || 0;
    if (viewedAt > 0 && (now - viewedAt) >= ADMIN_REPLY_HIDE_AFTER_MS) return false;
    return true;
}
