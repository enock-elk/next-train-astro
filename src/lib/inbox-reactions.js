/**
 * WhatsApp-style reactions on Feedback Hub / admin inbox bubbles.
 * Counts live on the inbox message. Rules allow extra fields while
 * message + timestamp stay the same.
 *
 * One actor is one emoji. The chips are rebuilt from reactedBy, so a
 * drifted reactions map cannot show extra faces. A commuter reaction on
 * an admin message sets reactionNotifyAt. That does not change the
 * feedback status, so the thread stays in Archives.
 */
import { DYNAMIC_BASE_URL } from './config.js';
import { ALERT_REACTION_EMOJI, ALERT_REACTION_KEYS } from './alerts-feed.js';
import { isAdminInboxMessage } from './inbox-receipts.js';
import { escapeHTML } from './utils.js';

export const INBOX_REACTION_KEYS = ALERT_REACTION_KEYS;
export const INBOX_REACTION_EMOJI = ALERT_REACTION_EMOJI;

export function inboxReactionActorId(deviceId = '') {
    try {
        if (window.firebaseAuth?.currentUser?.uid) return `uid_${window.firebaseAuth.currentUser.uid}`;
    } catch { /* ignore */ }
    let device = String(deviceId || '').trim();
    if (!device) {
        try { device = localStorage.getItem('next_train_device_id') || ''; } catch { device = ''; }
    }
    return device ? `dev_${device.slice(0, 80)}` : '';
}

function cleanReactedBy(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(raw).forEach(([actor, emoji]) => {
        if (!actor || !INBOX_REACTION_KEYS.includes(emoji)) return;
        out[String(actor).slice(0, 120)] = emoji;
    });
    return out;
}

function countsFromReactedBy(reactedBy) {
    const counts = {};
    Object.values(reactedBy || {}).forEach((emoji) => {
        if (!INBOX_REACTION_KEYS.includes(emoji)) return;
        counts[emoji] = (counts[emoji] || 0) + 1;
    });
    return counts;
}

/** People map only. A numeric reactions blob cannot add a second face. */
export function inboxReactionCounts(entry) {
    return countsFromReactedBy(cleanReactedBy(entry?.reactedBy));
}

export function summarizeInboxReactions(entry, mineKey = '') {
    const counts = inboxReactionCounts(entry);
    return INBOX_REACTION_KEYS
        .map((key) => ({
            key,
            emoji: INBOX_REACTION_EMOJI[key],
            count: counts[key] || 0,
            mine: mineKey === key,
        }))
        .filter((row) => row.count > 0);
}

export function inboxMineReactionKey(entry, actorId = inboxReactionActorId()) {
    const map = cleanReactedBy(entry?.reactedBy);
    const raw = actorId ? map[actorId] : '';
    return INBOX_REACTION_KEYS.includes(raw) ? raw : '';
}

export function renderInboxReactionChips(entry, actorId = inboxReactionActorId(), isOwn = false) {
    const mine = inboxMineReactionKey(entry, actorId);
    const rows = summarizeInboxReactions(entry, mine);
    if (!rows.length) {
        return `<div class="hidden" data-inbox-react-chips></div>`;
    }
    return `<div class="community-reaction-pills ${isOwn ? 'ml-auto mr-1' : ''}" data-inbox-react-chips>
        ${rows.map((row) => `
            <button type="button" data-inbox-react="${escapeHTML(row.key)}" class="community-reaction-pill" aria-label="${row.mine ? 'Remove your reaction' : `${row.count} ${escapeHTML(row.key)}`}">${row.emoji}${row.count > 1 ? ` ${row.count}` : ''}</button>
        `).join('')}
    </div>`;
}

export function renderInboxReactionPickerHtml() {
    return INBOX_REACTION_KEYS.map((key) => (
        `<button type="button" data-inbox-react-pick="${escapeHTML(key)}" class="w-10 h-10 text-xl rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none" aria-label="${escapeHTML(key)}">${INBOX_REACTION_EMOJI[key]}</button>`
    )).join('');
}

/** True when a commuter reaction on this admin message has not been opened. */
export function inboxReactionNeedsAdminAttention(entry) {
    const at = Number(entry?.reactionNotifyAt) || 0;
    if (!at) return false;
    return at > (Number(entry?.reactionSeenAt) || 0);
}

/**
 * This admin's own bubble. A short fromName ("Enock") matches the email
 * label. Another admin's fromUid does not.
 */
export function inboxMessageMatchesAdmin(entry, ident) {
    if (!isAdminInboxMessage(entry, entry?.id)) return false;
    const uid = String(ident?.uid || '').trim();
    if (!uid) return false;
    const fromUid = String(entry?.fromUid || '').trim();
    if (fromUid) return fromUid === uid;
    const stored = String(entry?.fromName || '').trim().toLowerCase();
    if (!stored || stored === 'admin') return false;
    const short = String(ident?.short || '').trim().toLowerCase();
    const name = String(ident?.name || '').trim().toLowerCase();
    if (short && stored === short) return true;
    if (name && stored === name) return true;
    return false;
}

async function inboxAuthToken() {
    try {
        if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
            await window.firebaseSignInAnonymously(window.firebaseAuth);
        }
        if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true) || '';
        }
    } catch { /* ignore */ }
    return '';
}

function currentDeviceActor() {
    let device = '';
    try {
        device = localStorage.getItem('next_train_device_id') || '';
    } catch { /* ignore */ }
    return device ? `dev_${device.slice(0, 80)}` : '';
}

/**
 * The same phone can react once as a guest and again after sign-in.
 * Keep the signed-in emoji, or move the guest emoji onto that account.
 */
export function collapseViewerGuestReaction(entry, actorId = inboxReactionActorId(), deviceId = '') {
    const reactedBy = cleanReactedBy(entry?.reactedBy);
    if (!String(actorId || '').startsWith('uid_')) return null;
    const guest = deviceId ? `dev_${String(deviceId).slice(0, 80)}` : currentDeviceActor();
    if (!guest || guest === actorId || !reactedBy[guest]) return null;
    if (!reactedBy[actorId]) reactedBy[actorId] = reactedBy[guest];
    delete reactedBy[guest];
    return { reactions: countsFromReactedBy(reactedBy), reactedBy };
}

/** One emoji per actor. Counts are derived, never incremented on top of old numbers. */
export function nextInboxReaction(entry, emoji, actorId) {
    const reactedBy = cleanReactedBy(entry?.reactedBy);
    if (actorId && String(actorId).startsWith('uid_')) {
        const guest = currentDeviceActor();
        if (guest && guest !== actorId) delete reactedBy[guest];
    }
    const prev = actorId && INBOX_REACTION_KEYS.includes(reactedBy[actorId]) ? reactedBy[actorId] : '';
    if (actorId && prev === emoji) delete reactedBy[actorId];
    else if (actorId) reactedBy[actorId] = emoji;
    return { reactions: countsFromReactedBy(reactedBy), reactedBy };
}

export async function submitInboxReaction({ deviceId, messageId, entry, emoji, notifyAdmin = false }) {
    if (!deviceId || !messageId || !INBOX_REACTION_KEYS.includes(emoji)) return null;
    const actorId = inboxReactionActorId();
    if (!actorId) return null;
    const token = await inboxAuthToken();
    if (!token) return null;
    const next = nextInboxReaction(entry, emoji, actorId);
    const body = { reactions: next.reactions, reactedBy: next.reactedBy };
    if (notifyAdmin && isAdminInboxMessage(entry, messageId)) {
        if (next.reactedBy[actorId]) body.reactionNotifyAt = Date.now();
        else if (!Object.keys(next.reactedBy).length) body.reactionNotifyAt = null;
    }
    const url = `${DYNAMIC_BASE_URL}inbox/${encodeURIComponent(deviceId)}/${encodeURIComponent(messageId)}.json?auth=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return { ...entry, ...body };
}
