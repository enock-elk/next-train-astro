/**
 * WhatsApp-style reactions on Feedback Hub / admin inbox bubbles.
 * Counts live on the inbox message. Rules allow extra fields while
 * message + timestamp stay the same.
 */
import { DYNAMIC_BASE_URL } from './config.js';
import { ALERT_REACTION_EMOJI, ALERT_REACTION_KEYS } from './alerts-feed.js';
import { escapeHTML } from './utils.js';

export const INBOX_REACTION_KEYS = ALERT_REACTION_KEYS;
export const INBOX_REACTION_EMOJI = ALERT_REACTION_EMOJI;

export function inboxReactionActorId(deviceId = '') {
    try {
        if (window.firebaseAuth?.currentUser?.uid) return `uid_${window.firebaseAuth.currentUser.uid}`;
    } catch { /* ignore */ }
    const device = String(deviceId || '').trim()
        || (typeof localStorage !== 'undefined' ? (localStorage.getItem('next_train_device_id') || '') : '');
    return device ? `dev_${device.slice(0, 80)}` : '';
}

export function summarizeInboxReactions(entry, mineKey = '') {
    const counts = entry?.reactions && typeof entry.reactions === 'object' ? entry.reactions : {};
    return INBOX_REACTION_KEYS
        .map((key) => ({
            key,
            emoji: INBOX_REACTION_EMOJI[key],
            count: Math.max(0, Number(counts[key]) || 0),
            mine: mineKey === key,
        }))
        .filter((row) => row.count > 0 || row.mine);
}

export function inboxMineReactionKey(entry, actorId = inboxReactionActorId()) {
    const map = entry?.reactedBy && typeof entry.reactedBy === 'object' ? entry.reactedBy : {};
    const raw = actorId ? map[actorId] : '';
    return INBOX_REACTION_KEYS.includes(raw) ? raw : '';
}

export function renderInboxReactionChips(entry, actorId = inboxReactionActorId()) {
    const mine = inboxMineReactionKey(entry, actorId);
    const rows = summarizeInboxReactions(entry, mine);
    if (!rows.length) {
        return `<div class="nt-inbox-react-chips mt-1 min-h-0" data-inbox-react-chips></div>`;
    }
    return `<div class="nt-inbox-react-chips mt-1 flex flex-wrap gap-1" data-inbox-react-chips>
        ${rows.map((row) => `
            <button type="button" data-inbox-react="${escapeHTML(row.key)}" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[11px] leading-none ${
                row.mine
                    ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-400 text-blue-800 dark:text-blue-100'
                    : 'bg-white/80 dark:bg-gray-800/80 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200'
            }" aria-label="${row.count} ${escapeHTML(row.key)}">
                <span aria-hidden="true">${row.emoji}</span>
                <span class="font-bold tabular-nums">${row.count}</span>
            </button>
        `).join('')}
    </div>`;
}

export function renderInboxReactionPickerHtml() {
    return INBOX_REACTION_KEYS.map((key) => (
        `<button type="button" data-inbox-react-pick="${escapeHTML(key)}" class="w-10 h-10 text-xl rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none" aria-label="${escapeHTML(key)}">${INBOX_REACTION_EMOJI[key]}</button>`
    )).join('');
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

function nextReactionState(entry, emoji, actorId) {
    const prev = inboxMineReactionKey(entry, actorId);
    const counts = { ...(entry?.reactions && typeof entry.reactions === 'object' ? entry.reactions : {}) };
    const reactedBy = { ...(entry?.reactedBy && typeof entry.reactedBy === 'object' ? entry.reactedBy : {}) };
    if (prev && counts[prev] != null) counts[prev] = Math.max(0, Number(counts[prev] || 0) - 1);
    if (prev === emoji) {
        delete reactedBy[actorId];
    } else {
        counts[emoji] = Math.max(0, Number(counts[emoji] || 0) + 1);
        reactedBy[actorId] = emoji;
    }
    INBOX_REACTION_KEYS.forEach((key) => {
        if (!counts[key]) delete counts[key];
    });
    return { reactions: counts, reactedBy };
}

export async function submitInboxReaction({ deviceId, messageId, entry, emoji }) {
    if (!deviceId || !messageId || !INBOX_REACTION_KEYS.includes(emoji)) return null;
    const actorId = inboxReactionActorId();
    if (!actorId) return null;
    const token = await inboxAuthToken();
    if (!token) return null;
    const next = nextReactionState(entry, emoji, actorId);
    const url = `${DYNAMIC_BASE_URL}inbox/${encodeURIComponent(deviceId)}/${encodeURIComponent(messageId)}.json?auth=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
    });
    if (!res.ok) return null;
    return { ...entry, ...next };
}
