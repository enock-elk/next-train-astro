/**
 * Phase 8 — Lightweight room presence + typing (RTDB)
 * Path: route_community/{routeId}/presence/{sessionId}
 *        route_community/{routeId}/typing/{sessionId}
 *
 * Lab and production share this RTDB tree. Session keys are host-scoped so
 * one host's onDisconnect cannot wipe the other. The UI counts unique people
 * (signed-in uid, else device id) so the same person on both hosts is 1.
 */
import { bootFirebase } from './firebase-boot.js';
import { $account } from './account.js';
import { $deviceId } from '../store.js';
import { safeStorage } from './utils.js';

const PRESENCE_TTL_MS = 150 * 1000;
const TYPING_TTL_MS = 4 * 1000;

let presenceUnsub = null;
let typingUnsub = null;
let heartbeatTimer = null;
let activeRouteId = null;
let sessionId = null;
let lastLiveCount = 1;

function presenceHostTag() {
    try {
        const host = String(location.hostname || '').toLowerCase();
        if (host === 'lab.nexttrain.co.za' || host.startsWith('lab.')) return 'lab';
        if (host === 'nexttrain.co.za' || host === 'www.nexttrain.co.za') return 'prod';
        if (host.includes('pages.dev')) return 'pages';
        if (host === 'localhost' || host === '127.0.0.1') return 'local';
        return 'web';
    } catch {
        return 'web';
    }
}

function currentDeviceId() {
    return String($deviceId.get() || safeStorage.getItem('next_train_device_id') || '').trim();
}

function signedInUid() {
    const acct = $account.get();
    if (acct.status === 'signed-in' && acct.uid) return String(acct.uid).trim();
    return '';
}

function getSessionId() {
    if (sessionId) return sessionId;
    const base = signedInUid() || currentDeviceId() || `anon_${Math.random().toString(36).slice(2, 8)}`;
    sessionId = `s_${presenceHostTag()}_${base}`.replace(/[.#$\[\]]/g, '_');
    return sessionId;
}

function personKey(sid, row) {
    const uid = String(row?.uid || '').trim();
    const deviceId = String(row?.deviceId || '').trim();
    return uid || deviceId || String(sid || '').trim();
}

function countPresencePeople(data) {
    const now = Date.now();
    const people = new Set();
    Object.entries(data || {}).forEach(([sid, row]) => {
        if (!row || typeof row !== 'object') return;
        if (now - (Number(row.at) || 0) >= PRESENCE_TTL_MS) return;
        const person = personKey(sid, row);
        if (person) people.add(person);
    });
    return people.size;
}

async function ensureDb() {
    if (!window.firebaseDb) await bootFirebase();
    // Presence/typing rules require auth != null (anonymous is enough for guests).
    if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
        try { await window.firebaseSignInAnonymously(window.firebaseAuth); } catch { /* optional */ }
    }
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

function applyPresenceSnapshot(data, live) {
    if (!live) {
        updatePresenceUi(lastLiveCount, lastLiveCount > 1);
        return;
    }
    const n = Math.max(1, countPresencePeople(data));
    lastLiveCount = n;
    updatePresenceUi(n, true);
}

export async function joinCommunityPresence(routeId) {
    if (!routeId) return;
    await leaveCommunityPresence();
    activeRouteId = routeId;
    if (!(await ensureDb())) {
        applyPresenceSnapshot(null, false);
        return;
    }

    const sid = getSessionId();
    const ref = window.firebaseDbRef(window.firebaseDb, presencePath(routeId, sid));
    const payload = {
        uid: signedInUid() || null,
        deviceId: currentDeviceId() || null,
        host: presenceHostTag(),
        name: displayLabel(),
        at: Date.now(),
    };

    try {
        await window.firebaseDbSet(ref, payload);
        if (window.firebaseDbOnDisconnect) {
            window.firebaseDbOnDisconnect(ref).remove().catch(() => {});
        }
    } catch {
        applyPresenceSnapshot(null, false);
        return;
    }

    heartbeatTimer = setInterval(() => {
        if (!activeRouteId) return;
        window.firebaseDbUpdate?.(
            window.firebaseDbRef(window.firebaseDb, presencePath(activeRouteId, sid)),
            { at: Date.now(), host: presenceHostTag() }
        ).catch(() => {});
    }, 20000);

    if (window.firebaseDbOnValue) {
        const roomRef = window.firebaseDbRef(window.firebaseDb, `route_community/${routeId}/presence`);
        presenceUnsub = window.firebaseDbOnValue(roomRef, (snap) => {
            applyPresenceSnapshot(snap.val() || {}, true);
        }, () => applyPresenceSnapshot(null, false));

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
        applyPresenceSnapshot(null, false);
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
    lastLiveCount = 1;
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
    const n = Math.max(1, Number(count) || 1);
    if (!live && n <= 1) {
        el.textContent = 'Just you here';
        return;
    }
    el.textContent = count <= 1 ? 'Just you here' : `${n} looking at this line`;
}

function explainCommunityPresence() {
    let modal = document.getElementById('community-presence-info-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'community-presence-info-modal';
        modal.className = 'fixed inset-0 bg-black/70 z-[140] hidden flex items-center justify-center p-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-5">
                <h3 class="text-base font-black text-gray-900 dark:text-white mb-2">Who’s here</h3>
                <p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-3">
                    This shows how many people currently have this route’s Community open. It’s a live room count, not a contact list, so you can tell when the line is quiet or active.
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
                    Presence updates while you’re on the page and clears shortly after you leave.
                </p>
                <button type="button" id="community-presence-info-close" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl focus:outline-none">Got it</button>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (typeof window.closeSmoothModal === 'function') window.closeSmoothModal('community-presence-info-modal');
                else modal.classList.add('hidden');
            }
        });
        modal.querySelector('#community-presence-info-close')?.addEventListener('click', () => {
            if (typeof window.closeSmoothModal === 'function') window.closeSmoothModal('community-presence-info-modal');
            else modal.classList.add('hidden');
        });
    }
    if (typeof window.openSmoothModal === 'function') window.openSmoothModal('community-presence-info-modal');
    else modal.classList.remove('hidden');
}

export function bindCommunityPresenceInfo() {
    if (typeof document === 'undefined' || window.__ntCommunityPresenceInfoBound) return;
    window.__ntCommunityPresenceInfoBound = true;
    document.getElementById('community-presence')?.addEventListener('click', (e) => {
        e.preventDefault();
        explainCommunityPresence();
    });
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
