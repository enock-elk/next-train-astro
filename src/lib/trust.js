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
import { DYNAMIC_BASE_URL } from './config.js';
import { safeStorage } from './utils.js';
import { bootFirebase } from './firebase-boot.js';

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

/** Fetch full flags object for a user */
export async function fetchUserFlags(uid) {
    if (!uid) return null;
    try {
        if (!window.firebaseDb) await bootFirebase();
        if (window.firebaseDb && window.firebaseDbGet) {
            const snap = await window.firebaseDbGet(
                window.firebaseDbRef(window.firebaseDb, `users/${uid}/flags`)
            );
            return snap.exists() ? snap.val() : null;
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
    try {
        if (!window.firebaseDb) await bootFirebase();
        if (window.firebaseDb && window.firebaseDbGet) {
            const snap = await window.firebaseDbGet(
                window.firebaseDbRef(window.firebaseDb, `devices/${deviceId}/flags`)
            );
            return snap.exists() ? snap.val() : null;
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

export function computeBanUntil(durationMs) {
    if (!durationMs || durationMs <= 0) return 0;
    return Date.now() + durationMs;
}

if (typeof window !== 'undefined') {
    window.trustIsShadowBanned = isShadowBanned;
    window.trustLocalBlockList = localBlockList;
    window.trustAddToBlockList = addToLocalBlockList;
    window.trustRemoveFromBlockList = removeFromLocalBlockList;
    window.trustFetchUserFlags = fetchUserFlags;
    window.trustFetchTrustScore = fetchTrustScore;
    window.SHADOW_BAN_DURATIONS = SHADOW_BAN_DURATIONS;
    window.trustComputeBanUntil = computeBanUntil;
}
