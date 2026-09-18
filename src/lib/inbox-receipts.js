/**
 * Admin-only WhatsApp-style inbox receipts.
 * Commuter Messages UI does not render ticks. RTDB update keeps message + timestamp.
 */

import { DYNAMIC_BASE_URL } from './config.js';

export function isAdminInboxMessage(entry, id = '') {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.from === 'commuter') return false;
    if (String(id || entry.id || '').startsWith('cm_')) return false;
    return !!(entry.message || entry.text);
}

export function inboxEntriesFromMap(inboxData) {
    if (!inboxData || typeof inboxData !== 'object') return [];
    return Object.entries(inboxData).map(([id, m]) => ({ id, ...(m && typeof m === 'object' ? m : {}) }));
}

async function inboxReceiptAuthToken() {
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

export async function patchInboxMessageFields(deviceId, messageId, fields) {
    const id = String(deviceId || '').trim();
    const msgId = String(messageId || '').trim();
    if (!id || !msgId || !fields || typeof fields !== 'object') return false;
    const token = await inboxReceiptAuthToken();
    if (!token) return false;
    const url = `${DYNAMIC_BASE_URL}inbox/${encodeURIComponent(id)}/${encodeURIComponent(msgId)}.json?auth=${encodeURIComponent(token)}`;
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
        });
        return res.ok;
    } catch {
        return false;
    }
}

export async function markInboxDelivered(deviceId, entries) {
    const now = Date.now();
    const targets = (entries || []).filter((m) => isAdminInboxMessage(m, m?.id) && m.id && !m.delivered);
    if (!deviceId || !targets.length) return;
    await Promise.all(targets.map((m) => (
        patchInboxMessageFields(deviceId, m.id, { delivered: true, deliveredAt: now })
    )));
}

export async function markInboxRead(deviceId, entries) {
    const now = Date.now();
    const targets = (entries || []).filter((m) => isAdminInboxMessage(m, m?.id) && m.id && !m.read);
    if (!deviceId || !targets.length) return;
    await Promise.all(targets.map((m) => (
        patchInboxMessageFields(deviceId, m.id, { read: true, readAt: now, viewedAt: now })
    )));
}
