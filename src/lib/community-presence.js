/**
 * Phase 8 — Lightweight room presence + typing (RTDB)
 * Path: route_community/{routeId}/presence/{sessionId}
 *        route_community/{routeId}/typing/{sessionId}
 */
import { bootFirebase } from './firebase-boot.js';
import { $account } from './account.js';
import { $deviceId } from '../store.js';
import { safeStorage } from './utils.js';

const PRESENCE_TTL_MS = 90 * 1000;
const TYPING_TTL_MS = 4 * 1000;

let presenceUnsub = null;
let typingUnsub = null;
let heartbeatTimer = null;
let activeRouteId = null;
let sessionId = null;

function getSessionId() {
    if (sessionId) return sessionId;
    const acct = $account.get();
    const base = acct.status === 'signed-in' && acct.uid
        ? acct.uid
        : ($deviceId.get() || safeStorage.getItem('next_train_device_id') || `anon_${Math.random().toString(36).slice(2, 8)}`);
    sessionId = `s_${base}`.replace(/[.#$\[\]]/g, '_');
    return sessionId;
}

async function ensureDb() {
    if (!window.firebaseDb) await bootFirebase();
    return !!(window.firebaseDb && window.firebaseDbRef && window.firebaseDbSet);
}

function presencePath(routeId, sid = getSessionId()) {
    return `route_community/${routeId}/presence/${sid}`;
}

function typingPath(routeId, sid = getSessionId()) {
    return `route_community/${routeId}/typing/${sid}`;
}

function displayLabel() {
    const acct = $account.get();
    if (acct.status === 'signed-in' && acct.displayName) return acct.displayName;
    return 'Someone';
}

export async function joinCommunityPresence(routeId) {
    if (!routeId) return;
    await leaveCommunityPresence();
    activeRouteId = routeId;
    if (!(await ensureDb())) {
        updatePresenceUi(1, false);
        return;
    }

    const sid = getSessionId();
    const ref = window.firebaseDbRef(window.firebaseDb, presencePath(routeId, sid));
    const payload = {
        uid: $account.get().uid || null,
        name: displayLabel(),
        at: Date.now(),
    };

    try {
        await window.firebaseDbSet(ref, payload);
        if (window.firebaseDbOnDisconnect) {
            window.firebaseDbOnDisconnect(ref).remove().catch(() => {});
        }
    } catch {
        updatePresenceUi(1, false);
        return;
    }

    heartbeatTimer = setInterval(() => {
        if (!activeRouteId) return;
        window.firebaseDbUpdate?.(
            window.firebaseDbRef(window.firebaseDb, presencePath(activeRouteId, sid)),
            { at: Date.now() }
        ).catch(() => {});
    }, 25000);

    if (window.firebaseDbOnValue) {
        const roomRef = window.firebaseDbRef(window.firebaseDb, `route_community/${routeId}/presence`);
        presenceUnsub = window.firebaseDbOnValue(roomRef, (snap) => {
            const data = snap.val() || {};
            const now = Date.now();
            const live = Object.values(data).filter((p) => p && (now - (p.at || 0)) < PRESENCE_TTL_MS);
            updatePresenceUi(Math.max(1, live.length), true);
        }, () => updatePresenceUi(1, false));

        const typingRef = window.firebaseDbRef(window.firebaseDb, `route_community/${routeId}/typing`);
        typingUnsub = window.firebaseDbOnValue(typingRef, (snap) => {
            const data = snap.val() || {};
            const now = Date.now();
            const others = Object.entries(data)
                .filter(([k, v]) => k !== sid && v && (now - (v.at || 0)) < TYPING_TTL_MS)
                .map(([, v]) => v.name || 'Someone');
            updateTypingUi(others);
        });
    } else {
        updatePresenceUi(1, false);
    }
}

export async function leaveCommunityPresence() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (typeof presenceUnsub === 'function') {
        try { presenceUnsub(); } catch { /* */ }
        presenceUnsub = null;
    }
    if (typeof typingUnsub === 'function') {
        try { typingUnsub(); } catch { /* */ }
        typingUnsub = null;
    }
    if (activeRouteId && window.firebaseDb && window.firebaseDbRemove) {
        try {
            await window.firebaseDbRemove(window.firebaseDbRef(window.firebaseDb, presencePath(activeRouteId)));
            await window.firebaseDbRemove(window.firebaseDbRef(window.firebaseDb, typingPath(activeRouteId)));
        } catch { /* */ }
    }
    activeRouteId = null;
    updateTypingUi([]);
}

let typingClearTimer = null;

export async function signalCommunityTyping(routeId, isTyping) {
    if (!routeId || !(await ensureDb()) || !window.firebaseDbSet) return;
    const sid = getSessionId();
    const ref = window.firebaseDbRef(window.firebaseDb, typingPath(routeId, sid));
    try {
        if (isTyping) {
            await window.firebaseDbSet(ref, { name: displayLabel(), at: Date.now() });
            if (typingClearTimer) clearTimeout(typingClearTimer);
            typingClearTimer = setTimeout(() => signalCommunityTyping(routeId, false), TYPING_TTL_MS);
        } else if (window.firebaseDbRemove) {
            await window.firebaseDbRemove(ref);
        }
    } catch { /* optional */ }
}

function updatePresenceUi(count, live) {
    const el = document.getElementById('community-presence');
    if (!el) return;
    if (!live) {
        el.textContent = 'Room online';
        return;
    }
    el.textContent = count <= 1 ? 'Just you here' : `${count} looking at this line`;
}

function updateTypingUi(names) {
    const el = document.getElementById('community-typing');
    if (!el) return;
    if (!names.length) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    const label = names.length === 1 ? `${names[0]} is typing…` : 'Several people typing…';
    el.textContent = label;
    el.classList.remove('hidden');
}
