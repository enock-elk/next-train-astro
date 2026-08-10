/**
 * Phase 7 — Trust, shadow-ban & hardening helpers
 *
 * Shared by community.js, delay-reports.js, and admin (via window).
 *
 * RTDB (additive):
 *   users/{uid}/flags/{ shadowBanned, shadowBannedUntil, role }
 *   users/{uid}/trustScore
 *   delay_reports/{id}/{ verified, verifiedBy, verifiedAt }
 */
import { DYNAMIC_BASE_URL, withBase } from './config.js';
import { safeStorage } from './utils.js';
import { bootFirebase } from './firebase-boot.js';
import { $isOffline, $deviceId } from '../store.js';

/** In-session block list (admin ban takes effect without reload) */
export const localBlockList = new Set();

/** Persist soft block list across reloads on this device */
const BLOCK_LIST_KEY = 'nt_local_block_list_v1';
const RECENT_BODIES_KEY = 'nt_recent_bodies_v1';

try {
    const saved = JSON.parse(safeStorage.getItem(BLOCK_LIST_KEY) || '[]');
    if (Array.isArray(saved)) saved.forEach((id) => localBlockList.add(id));
} catch { /* ignore */ }

export function persistLocalBlockList() {
    safeStorage.setItem(BLOCK_LIST_KEY, JSON.stringify([...localBlockList]));
}

export function addToLocalBlockList(uid) {
    if (!uid) return;
    localBlockList.add(uid);
    persistLocalBlockList();
}

export function removeFromLocalBlockList(uid) {
    if (!uid) return;
    localBlockList.delete(uid);
    persistLocalBlockList();
}

export function prune(times, maxAge) {
    const cut = Date.now() - maxAge;
    return (times || []).filter((t) => t > cut);
}

export function readRateData(key, fallback = { global: [], routes: {} }) {
    try {
        return JSON.parse(safeStorage.getItem(key) || JSON.stringify(fallback)) || fallback;
    } catch {
        return { ...fallback };
    }
}

export function writeRateData(key, data) {
    safeStorage.setItem(key, JSON.stringify(data));
}

/**
 * @param {string} key localStorage key
 * @param {{ windowMs: number, max: number, cooldownMs?: number, routeId?: string, routeWindowMs?: number, routeMax?: number }} opts
 */
export function checkRateLimit(key, opts) {
    const {
        windowMs,
        max,
        cooldownMs = 0,
        routeId = null,
        routeWindowMs = windowMs,
        routeMax = 1,
    } = opts;
    const data = readRateData(key);
    const now = Date.now();
    data.global = prune(data.global, windowMs);

    if (data.global.length >= max) {
        return { ok: false, message: 'Slow down. Try again in a few minutes.' };
    }
    const last = data.global[data.global.length - 1];
    if (cooldownMs > 0 && last && now - last < cooldownMs) {
        return { ok: false, message: 'Wait a moment before trying again.' };
    }

    if (routeId) {
        if (!data.routes) data.routes = {};
        const routeTimes = prune(data.routes[routeId] || [], routeWindowMs);
        data.routes[routeId] = routeTimes;
        if (routeTimes.length >= routeMax || routeTimes.some((t) => now - t < routeWindowMs && routeMax === 1)) {
            return { ok: false, message: 'You already did this for this route recently.' };
        }
    }
    return { ok: true };
}

export function recordRateHit(key, opts) {
    const { windowMs, routeId = null, routeWindowMs = windowMs } = opts;
    const data = readRateData(key);
    const now = Date.now();
    data.global = prune(data.global, windowMs);
    data.global.push(now);
    if (routeId) {
        if (!data.routes) data.routes = {};
        data.routes[routeId] = prune(data.routes[routeId] || [], routeWindowMs);
        data.routes[routeId].push(now);
    }
    writeRateData(key, data);
}

async function authQuery() {
    if (!window.firebaseAuth) await bootFirebase();
    if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
        try {
            const token = await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true);
            return token ? `?auth=${encodeURIComponent(token)}` : '';
        } catch {
            return '';
        }
    }
    return '';
}

function flagsAreBanned(flags) {
    if (!flags || flags.shadowBanned !== true) return false;
    const until = Number(flags.shadowBannedUntil || 0);
    if (until > 0 && Date.now() > until) return false;
    return true;
}

/** Avoid hanging Firebase RTDB get() when offline (blocks schedule cache boot). */
function trustNetworkAvailable() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function withTimeout(promise, ms, label = 'trust') {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            console.warn(`🛡️ Guardian: ${label} timed out after ${ms}ms`);
            resolve(null);
        }, ms);
        Promise.resolve(promise).then(
            (v) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(v);
            },
            () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(null);
            }
        );
    });
}

/** Fetch full flags object for a user */
export async function fetchUserFlags(uid) {
    if (!uid) return null;
    if (!trustNetworkAvailable()) return null;
    try {
        if (!window.firebaseDb) await bootFirebase();
        if (window.firebaseDb && window.firebaseDbGet) {
            const snap = await withTimeout(
                window.firebaseDbGet(
                    window.firebaseDbRef(window.firebaseDb, `users/${uid}/flags`)
                ),
                2500,
                'fetchUserFlags'
            );
            return snap && snap.exists() ? snap.val() : null;
        }
        const q = await authQuery();
        const res = await fetch(`${DYNAMIC_BASE_URL}users/${uid}/flags.json${q}`);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/** Device-level ban flags (guests / pre-account device IDs). */
export async function fetchDeviceFlags(deviceId) {
    if (!deviceId) return null;
    if (!trustNetworkAvailable()) return null;
    try {
        if (!window.firebaseDb) await bootFirebase();
        if (window.firebaseDb && window.firebaseDbGet) {
            const snap = await withTimeout(
                window.firebaseDbGet(
                    window.firebaseDbRef(window.firebaseDb, `devices/${deviceId}/flags`)
                ),
                2500,
                'fetchDeviceFlags'
            );
            return snap && snap.exists() ? snap.val() : null;
        }
        const q = await authQuery();
        const res = await fetch(`${DYNAMIC_BASE_URL}devices/${encodeURIComponent(deviceId)}/flags.json${q}`);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Shadow-ban with optional duration.
 * Policy: if shadowBannedUntil > 0 and now > until → treat as not banned (expired).
 * Also respects device-level bans under devices/{deviceId}/flags.
 */
export async function isShadowBanned(uid) {
    if (uid && localBlockList.has(uid)) return true;
    if (uid && flagsAreBanned(await fetchUserFlags(uid))) return true;

    const deviceId = (typeof window !== 'undefined' && (window.NEXT_TRAIN_DEVICE_ID || safeStorage.getItem('next_train_device_id'))) || null;
    if (deviceId && deviceId !== uid) {
        if (localBlockList.has(deviceId)) return true;
        if (flagsAreBanned(await fetchDeviceFlags(deviceId))) return true;
        // Guest ban stubs may also live at users/{deviceId}
        if (flagsAreBanned(await fetchUserFlags(deviceId))) return true;
    }
    return false;
}

export function isBlockedLocally(uid) {
    return !!(uid && localBlockList.has(uid));
}

/** Basic link / promo spam */
export function isLinkSpam(text) {
    if (!text) return false;
    if (/https?:\/\/\S+/i.test(text)) return true;
    if (/\bwww\.\S+/i.test(text)) return true;
    if (/\b[\w-]+\.(com|net|org|io|co\.za|xyz|info)\b/i.test(text)) return true;
    // Excessive repeated characters
    if (/(.)\1{8,}/.test(text)) return true;
    return false;
}

function normalizeBody(text) {
    return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getRecentBodies(limit = 12) {
    try {
        const arr = JSON.parse(safeStorage.getItem(RECENT_BODIES_KEY) || '[]');
        return Array.isArray(arr) ? arr.slice(-limit) : [];
    } catch {
        return [];
    }
}

export function rememberBody(text) {
    const norm = normalizeBody(text);
    if (!norm) return;
    const arr = getRecentBodies(20);
    arr.push(norm);
    safeStorage.setItem(RECENT_BODIES_KEY, JSON.stringify(arr.slice(-20)));
}

export function isDuplicateBody(text, recentBodies = getRecentBodies()) {
    const norm = normalizeBody(text);
    if (!norm || norm.length < 4) return false;
    return recentBodies.some((b) => b === norm);
}

/**
 * Content gate used before community / report writes.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkContentSafety(text, { allowLinks = false } = {}) {
    if (!allowLinks && isLinkSpam(text)) {
        return { ok: false, message: 'Links and promo spam aren’t allowed.' };
    }
    if (isDuplicateBody(text)) {
        return { ok: false, message: 'You already sent that message.' };
    }
    return { ok: true };
}

export async function fetchTrustScore(uid) {
    if (!uid) return 0;
    try {
        if (!window.firebaseDb) await bootFirebase();
        if (window.firebaseDb && window.firebaseDbGet) {
            const snap = await window.firebaseDbGet(
                window.firebaseDbRef(window.firebaseDb, `users/${uid}/trustScore`)
            );
            const v = snap.exists() ? snap.val() : 0;
            return typeof v === 'number' ? v : 0;
        }
        const q = await authQuery();
        const res = await fetch(`${DYNAMIC_BASE_URL}users/${uid}/trustScore.json${q}`);
        if (!res.ok) return 0;
        const v = await res.json();
        return typeof v === 'number' ? v : 0;
    } catch {
        return 0;
    }
}

/** Duration presets for admin UI (ms). 0 = permanent */
export const SHADOW_BAN_DURATIONS = [
    { label: '1 hour', ms: 60 * 60 * 1000 },
    { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
    { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
    { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
    { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
    { label: 'Permanent', ms: 0 },
];

/**
 * How a shadow ban feels to the target (never says “banned”).
 * - offline: current lie-fi / offline flicker
 * - freeze: UI captures input and feels frozen
 * - fouc: strip stylesheets → browser-default “true FOUC”
 * - lost: persistent 404 / End of the Line (Return Home bounces back)
 */
export const SHADOW_BAN_MODES = [
    { id: 'offline', label: 'Fake offline / lie-fi', hint: 'Offline banner + flaky connection feel' },
    { id: 'freeze', label: 'Freeze / unresponsive', hint: 'App looks loaded but ignores all input' },
    { id: 'fouc', label: 'True FOUC (unstyled)', hint: 'CSS disabled — raw HTML like a failed stylesheet load' },
    { id: 'lost', label: '404 / End of the Line', hint: 'Served the station-not-found page; Home always returns there' },
];

const BAN_LOST_KEY = 'nt_shadow_ban_lost';

function clearLostBanFlag() {
    try {
        sessionStorage.removeItem(BAN_LOST_KEY);
        localStorage.removeItem(BAN_LOST_KEY);
    } catch { /* ignore */ }
}

function setLostBanFlag() {
    try {
        sessionStorage.setItem(BAN_LOST_KEY, '1');
        localStorage.setItem(BAN_LOST_KEY, '1');
    } catch { /* ignore */ }
}

const VALID_BAN_MODES = new Set(SHADOW_BAN_MODES.map((m) => m.id));
let _globalBanModeCache = null;
let _globalBanModeFetchedAt = 0;

export function normalizeShadowBanMode(mode) {
    const m = String(mode || '').trim().toLowerCase();
    return VALID_BAN_MODES.has(m) ? m : 'offline';
}

export function computeBanUntil(durationMs) {
    if (!durationMs || durationMs <= 0) return 0;
    return Date.now() + durationMs;
}

async function fetchGlobalShadowBanMode() {
    // Global default is admin-only (not publicly readable). Per-ban
    // flags.shadowBanMode still wins; otherwise use the safe default.
    const now = Date.now();
    if (_globalBanModeCache && now - _globalBanModeFetchedAt < 60_000) {
        return _globalBanModeCache;
    }
    _globalBanModeCache = 'offline';
    _globalBanModeFetchedAt = now;
    return 'offline';
}

/**
 * @returns {Promise<{ banned: boolean, mode: string }|null>}
 */
async function resolveShadowBanEnforcement() {
    const uid = safeStorage.getItem('authUid') || null;
    const deviceId = $deviceId.get() || safeStorage.getItem('next_train_device_id') || window.NEXT_TRAIN_DEVICE_ID || null;

    let banned = false;
    let modeFromFlags = null;

    const considerFlags = (flags) => {
        if (!flagsAreBanned(flags)) return;
        banned = true;
        if (flags?.shadowBanMode) modeFromFlags = flags.shadowBanMode;
    };

    if (uid && localBlockList.has(uid)) banned = true;
    if (uid) considerFlags(await fetchUserFlags(uid));

    if (deviceId && deviceId !== uid) {
        if (localBlockList.has(deviceId)) banned = true;
        considerFlags(await fetchDeviceFlags(deviceId));
        considerFlags(await fetchUserFlags(deviceId));
    }

    if (!banned) return null;

    const mode = normalizeShadowBanMode(
        modeFromFlags || (await fetchGlobalShadowBanMode())
    );
    return { banned: true, mode };
}

function applyBanModeOffline() {
    const pulseOffline = () => {
        try { $isOffline.set(true); } catch { /* ignore */ }
        const ind = document.getElementById('offline-indicator');
        if (ind) ind.style.display = '';
        const wrap = document.getElementById('offline-wrapper');
        if (wrap) wrap.classList.remove('hidden');
    };
    pulseOffline();

    const flicker = () => {
        if (!window.__ntShadowBanCloak) return;
        pulseOffline();
        const ind = document.getElementById('offline-indicator');
        if (ind && Math.random() < 0.35) {
            ind.style.display = 'none';
            setTimeout(() => { if (window.__ntShadowBanCloak) pulseOffline(); }, 900 + Math.random() * 1600);
        }
    };
    setInterval(flicker, 7000);

    try {
        document.documentElement.classList.remove('nt-shell-ready');
        setTimeout(() => {
            try { document.documentElement.classList.add('nt-shell-ready'); } catch { /* ignore */ }
        }, 1800 + Math.random() * 1200);
    } catch { /* ignore */ }

    const weak = document.getElementById('weak-signal-modal');
    if (weak && typeof window.openSmoothModal === 'function') {
        setTimeout(() => {
            try { window.openSmoothModal('weak-signal-modal'); } catch { /* ignore */ }
        }, 2200);
    }
}

function applyBanModeFreeze() {
    try { $isOffline.set(true); } catch { /* ignore */ }
    const ind = document.getElementById('offline-indicator');
    if (ind) ind.style.display = '';

    let freeze = document.getElementById('nt-ban-freeze-overlay');
    if (!freeze) {
        freeze = document.createElement('div');
        freeze.id = 'nt-ban-freeze-overlay';
        freeze.setAttribute('aria-hidden', 'true');
        freeze.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483646',
            'background:transparent', 'touch-action:none', 'cursor:wait',
            'pointer-events:auto',
        ].join(';');
        const block = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        };
        ['click', 'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend',
            'mousedown', 'mouseup', 'keydown', 'keyup', 'wheel', 'contextmenu', 'submit',
        ].forEach((ev) => freeze.addEventListener(ev, block, true));
        document.documentElement.addEventListener('scroll', block, { capture: true, passive: false });
        document.body.appendChild(freeze);
    }
    try {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
    } catch { /* ignore */ }
}

function applyBanModeFouc() {
    try {
        document.documentElement.classList.remove('dark', 'nt-shell-ready');
    } catch { /* ignore */ }

    document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
        try {
            el.disabled = true;
            el.setAttribute('data-nt-ban-fouc', '1');
            el.setAttribute('media', 'not all');
        } catch { /* ignore */ }
    });
    document.querySelectorAll('style').forEach((el) => {
        try {
            el.disabled = true;
            el.setAttribute('data-nt-ban-fouc', '1');
            if (!el.dataset.ntBanFoucPrev) {
                el.dataset.ntBanFoucPrev = el.textContent || '';
                el.textContent = '';
            }
        } catch { /* ignore */ }
    });

    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    const main = document.getElementById('main-content');
    if (main) {
        main.style.visibility = 'visible';
        main.style.display = 'block';
    }

    let strip = document.getElementById('nt-ban-fouc-offline');
    if (!strip) {
        strip = document.createElement('div');
        strip.id = 'nt-ban-fouc-offline';
        strip.textContent = '📡 You are offline. Reopen the app when signal returns.';
        document.body.insertBefore(strip, document.body.firstChild);
    }

    // Keep fighting late-injected styles (PWA / Vite HMR / ads)
    if (!window.__ntBanFoucWatch) {
        window.__ntBanFoucWatch = setInterval(() => {
            if (!window.__ntShadowBanCloak || window.__ntShadowBanMode !== 'fouc') return;
            document.querySelectorAll('link[rel="stylesheet"]:not([data-nt-ban-fouc])').forEach((el) => {
                try {
                    el.disabled = true;
                    el.setAttribute('data-nt-ban-fouc', '1');
                    el.setAttribute('media', 'not all');
                } catch { /* ignore */ }
            });
        }, 1500);
    }
}

/** Persistent 404 — Return Home reloads the app, which cloaks them back here. */
function applyBanModeLost() {
    setLostBanFlag();
    const on404 = /404\.html?$/i.test(location.pathname) || /\/404\/?$/i.test(location.pathname);
    if (on404) return;
    try {
        location.replace(withBase('404.html'));
    } catch {
        try { location.href = withBase('404.html'); } catch { /* ignore */ }
    }
}

/**
 * Cloaked enforcement for shadow-banned devices/accounts.
 * Mode comes from per-ban flags.shadowBanMode, else safe default (offline).
 * Never tells the user they are banned.
 */
export async function applyShadowBanCloak() {
    if (typeof window === 'undefined' || window.__ntBanCloakApplied) return false;
    // Offline: do not touch Firebase — RTDB get() can hang and block boot.
    if (!trustNetworkAvailable()) return false;

    const verdict = await resolveShadowBanEnforcement();
    if (!verdict?.banned) {
        clearLostBanFlag();
        return false;
    }

    const mode = normalizeShadowBanMode(verdict.mode);
    window.__ntBanCloakApplied = true;
    window.__ntShadowBanCloak = true;
    window.__ntShadowBanMode = mode;

    if (mode === 'freeze') applyBanModeFreeze();
    else if (mode === 'fouc') applyBanModeFouc();
    else if (mode === 'lost') applyBanModeLost();
    else {
        clearLostBanFlag();
        applyBanModeOffline();
    }

    return true;
}

if (typeof window !== 'undefined') {
    window.trustIsShadowBanned = isShadowBanned;
    window.trustApplyShadowBanCloak = applyShadowBanCloak;
    window.trustLocalBlockList = localBlockList;
    window.trustAddToBlockList = addToLocalBlockList;
    window.trustRemoveFromBlockList = removeFromLocalBlockList;
    window.trustFetchUserFlags = fetchUserFlags;
    window.trustFetchTrustScore = fetchTrustScore;
    window.SHADOW_BAN_DURATIONS = SHADOW_BAN_DURATIONS;
    window.SHADOW_BAN_MODES = SHADOW_BAN_MODES;
    window.trustComputeBanUntil = computeBanUntil;
    window.trustNormalizeShadowBanMode = normalizeShadowBanMode;
}
