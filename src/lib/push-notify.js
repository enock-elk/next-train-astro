/**
 * Web Push / FCM bootstrap for corridor alerts + optional room activity.
 * Requires PUBLIC_FIREBASE_VAPID_KEY at build time for FID registration.
 * Falls back to Notification API permission + local pref when VAPID missing.
 */
import { DYNAMIC_BASE_URL, APP_VERSION } from './config.js';
import { safeStorage } from './utils.js';
import { $currentRouteId, $deviceId, $userRegion } from '../store.js';
import { $account } from './account.js';
import { bootFirebase } from './firebase-boot.js';
import { FEATURE_KEYS, isFeatureEnabled, fetchFeatures, isLabEnvironment } from './features.js';
import { NOTIFY_PREF_KEY, getNotifyPref, getNotifyCategories, syncNotifyUi } from './prefs.js';

const SUB_ROUTES_KEY = 'notifyRouteIds';
const TOKEN_CACHE_KEY = 'fcmTokenCache';
const REGISTRATION_TYPE_CACHE_KEY = 'fcmRegistrationType';
let fidListenerBound = false;
const fidWaiters = new Set();
let subscriptionSyncBound = false;
let subscriptionSyncTimer = null;

function getVapidKey() {
    try {
        return String(import.meta.env?.PUBLIC_FIREBASE_VAPID_KEY || '').trim();
    } catch {
        return '';
    }
}

function getDeviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown';
}

function isOperatorSession() {
    if (typeof window === 'undefined') return false;
    return window.__ntAdminAuthed === true
        || document.documentElement.getAttribute('data-admin-authed') === '1';
}

export function getNotifyRouteIds() {
    try {
        const raw = safeStorage.getItem(SUB_ROUTES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
        return [];
    }
}

export function setNotifyRouteIds(ids) {
    const next = [...new Set((ids || []).map(String).filter(Boolean))];
    safeStorage.setItem(SUB_ROUTES_KEY, JSON.stringify(next));
    return next;
}

export function getPinnedRouteIds() {
    const ids = [];
    for (const region of ['GP', 'WC', 'KZN', 'EC']) {
        const id = safeStorage.getItem(`defaultRoute_${region}`);
        if (id) ids.push(String(id));
    }
    return [...new Set(ids)];
}

export function refreshPushSubscriptionAudience() {
    scheduleSubscriptionSync();
}

export function ensureCurrentRouteSubscribed() {
    const rid = $currentRouteId.get();
    if (!rid) return getNotifyRouteIds();
    const ids = getNotifyRouteIds();
    if (!ids.includes(rid)) {
        ids.push(rid);
        setNotifyRouteIds(ids);
    }
    return ids;
}

async function ensureMessaging() {
    await bootFirebase();
    if (!window.firebaseMessaging || (!window.firebaseRegisterMessaging && !window.firebaseGetToken)) return null;
    return window.firebaseMessaging;
}

async function ensurePushAuth() {
    await bootFirebase();
    if (window.firebaseAuth?.currentUser) return window.firebaseAuth.currentUser;
    if (window.firebaseAuth && window.firebaseSignInAnonymously) {
        try {
            const credential = await window.firebaseSignInAnonymously(window.firebaseAuth);
            return credential?.user || window.firebaseAuth.currentUser || null;
        } catch (e) {
            console.warn('FCM anonymous auth failed', e);
        }
    }
    return null;
}

async function persistToken(token, { enabled = true, registrationType = 'token' } = {}) {
    if (!token) return;
    safeStorage.setItem(TOKEN_CACHE_KEY, token);
    safeStorage.setItem(REGISTRATION_TYPE_CACHE_KEY, registrationType);
    const deviceId = getDeviceId();
    const acct = $account.get();
    const firebaseUser = await ensurePushAuth();
    if (!firebaseUser) throw new Error('Notification sign-in unavailable');
    const routeIds = getNotifyRouteIds();
    const pinnedRouteIds = getPinnedRouteIds();
    const categories = getNotifyCategories();
    const payload = {
        token,
        registrationType,
        updatedAt: Date.now(),
        deviceId,
        uid: firebaseUser.uid,
        region: $userRegion.get() || 'GP',
        routeIds,
        pinnedRouteIds,
        categories,
        enabled: !!enabled,
        appVersion: APP_VERSION,
        lab: isLabEnvironment(),
        userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 180) : '',
    };
    if (acct.status === 'signed-in' && acct.uid) payload.accountUid = acct.uid;

    try {
        if (window.firebaseDb && window.firebaseDbRef && window.firebaseDbSet && window.firebaseAuth?.currentUser) {
            const ref = window.firebaseDbRef(window.firebaseDb, `push_subscriptions/${deviceId}`);
            await window.firebaseDbSet(ref, payload);
            return;
        }
    } catch (e) {
        console.warn('FCM token RTDB write failed', e);
    }

    // REST fallback (auth optional — rules require auth)
    try {
        let q = '';
        if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
            const t = await window.firebaseGetIdToken(window.firebaseAuth.currentUser);
            if (t) q = `?auth=${encodeURIComponent(t)}`;
        }
        await fetch(`${DYNAMIC_BASE_URL}push_subscriptions/${encodeURIComponent(deviceId)}.json${q}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (e) {
        console.warn('FCM token REST write failed', e);
    }
}

function resolveFidWaiters(fid) {
    for (const finish of [...fidWaiters]) finish(fid);
    fidWaiters.clear();
}

function bindFidRegistration(messaging) {
    if (fidListenerBound || !window.firebaseOnRegistered) return false;
    fidListenerBound = true;
    window.firebaseOnRegistered(messaging, (fid) => {
        if (!fid) return;
        persistToken(fid, {
            enabled: getNotifyPref(),
            registrationType: 'fid',
        }).then(() => resolveFidWaiters(fid)).catch((error) => {
            console.warn('FCM FID persistence failed', error);
            resolveFidWaiters(null);
        });
    });
    return true;
}

function waitForRegisteredFid(timeoutMs = 12_000) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (fid) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            fidWaiters.delete(finish);
            resolve(fid || null);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        fidWaiters.add(finish);
    });
}

/**
 * Register FCM using the existing PWA service worker. Current Firebase SDKs
 * return an Installation ID through onRegistered(); legacy getToken remains a
 * migration fallback for older cached bundles.
 * @returns {Promise<string|null>}
 */
export async function registerPushToken() {
    await fetchFeatures();
    const routeId = $currentRouteId.get() || '';
    if (!isOperatorSession() && !isFeatureEnabled(FEATURE_KEYS.PUSH_NOTIFY, routeId) && !isLabEnvironment()) {
        // Still allow token if any route in allow-list matches a subscribed id
        const allowed = getNotifyRouteIds().some((id) => isFeatureEnabled(FEATURE_KEYS.PUSH_NOTIFY, id));
        if (!allowed && !isFeatureEnabled(FEATURE_KEYS.PUSH_NOTIFY, '')) return null;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) return null;
    if (Notification.permission !== 'granted') return null;

    const vapidKey = getVapidKey();
    if (!vapidKey) {
        console.info('FCM: PUBLIC_FIREBASE_VAPID_KEY not set — permission saved, token deferred');
        return null;
    }

    const messaging = await ensureMessaging();
    if (!messaging) return null;

    try {
        let registration = null;
        if ('serviceWorker' in navigator) {
            registration = await navigator.serviceWorker.ready;
        }
        const options = {
            vapidKey,
            ...(registration ? { serviceWorkerRegistration: registration } : {}),
        };
        if (window.firebaseRegisterMessaging && window.firebaseOnRegistered) {
            bindFidRegistration(messaging);
            const fidPromise = waitForRegisteredFid();
            await window.firebaseRegisterMessaging(messaging, options);
            return await fidPromise;
        }
        const token = await window.firebaseGetToken(messaging, options);
        if (token) await persistToken(token, { registrationType: 'token' });
        return token || null;
    } catch (e) {
        console.warn('FCM getToken failed', e);
        return null;
    }
}

/** Foreground message toast (ops / delay confirms). */
export async function bindForegroundPush() {
    if (typeof window === 'undefined' || window.__ntFcmForeground) return;
    window.__ntFcmForeground = true;
    const messaging = await ensureMessaging();
    if (!messaging || !window.firebaseOnMessage) return;
    try {
        window.firebaseOnMessage(messaging, (payload) => {
            const title = payload?.notification?.title || payload?.data?.title || 'Next Train';
            const body = payload?.notification?.body || payload?.data?.body || '';
            if (typeof window.showToast === 'function') {
                window.showToast(body ? `${title}: ${body}` : title, 'info', 5000);
            }
        });
    } catch (e) {
        console.warn('FCM onMessage bind failed', e);
    }
}

/**
 * Called from prefs when user enables notifications.
 * @returns {Promise<{ ok: boolean, token: string|null, message?: string }>}
 */
export async function enablePushNotifications() {
    await fetchFeatures();
    ensureCurrentRouteSubscribed();
    safeStorage.setItem(NOTIFY_PREF_KEY, 'true');

    const token = await registerPushToken();
    await bindForegroundPush();
    syncNotifyUi(true);

    if (!getVapidKey()) {
        return {
            ok: true,
            token: null,
            message: isLabEnvironment()
                ? 'Permission on - add PUBLIC_FIREBASE_VAPID_KEY to finish FCM on lab'
                : 'Permission on - push delivery wiring completes when VAPID is configured',
        };
    }
    if (!token) {
        return { ok: true, token: null, message: 'Notifications enabled - token pending (SW / network)' };
    }
    return { ok: true, token, message: 'Push alerts enabled for your routes' };
}

export async function disablePushNotifications() {
    safeStorage.setItem(NOTIFY_PREF_KEY, 'false');
    const token = safeStorage.getItem(TOKEN_CACHE_KEY);
    if (token) {
        try {
            await persistToken(token, {
                enabled: false,
                registrationType: cachedRegistrationType(),
            });
        } catch (e) {
            console.warn('FCM subscription disable failed', e);
        }
    }
    syncNotifyUi(false);
    return false;
}

function cachedRegistrationType() {
    return safeStorage.getItem(REGISTRATION_TYPE_CACHE_KEY) === 'fid' ? 'fid' : 'token';
}

function scheduleSubscriptionSync() {
    if (!getNotifyPref()) return;
    const registrationId = safeStorage.getItem(TOKEN_CACHE_KEY);
    if (!registrationId) return;
    clearTimeout(subscriptionSyncTimer);
    subscriptionSyncTimer = setTimeout(() => {
        ensureCurrentRouteSubscribed();
        persistToken(registrationId, {
            enabled: true,
            registrationType: cachedRegistrationType(),
        }).catch((error) => console.warn('FCM audience refresh failed', error));
    }, 300);
}

function bindSubscriptionSync() {
    if (subscriptionSyncBound) return;
    subscriptionSyncBound = true;
    $currentRouteId.subscribe(scheduleSubscriptionSync);
    $userRegion.subscribe(scheduleSubscriptionSync);
    $account.subscribe(scheduleSubscriptionSync);
}

/** Boot hook — refresh token if pref already on. */
export async function hydratePushNotifications() {
    await fetchFeatures();
    bindSubscriptionSync();
    if (!getNotifyPref()) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        ensureCurrentRouteSubscribed();
        await registerPushToken();
        await bindForegroundPush();
    }
    syncNotifyUi(getNotifyPref());
}

function noticeBody(raw) {
    return String(raw || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

/**
 * In-app toast + optional system notification. Never used for raw presence pings.
 */
export function alertLiveEvent({ title, body, dedupeKey, toast = true, system = true } = {}) {
    if (dedupeKey && safeStorage.getItem(dedupeKey) === '1') return false;
    if (dedupeKey) safeStorage.setItem(dedupeKey, '1');
    const headline = title || 'Next Train';
    const text = noticeBody(body);
    if (toast && typeof window !== 'undefined' && typeof window.showToast === 'function') {
        window.showToast(text ? `${headline}: ${text}` : headline, 'info', 5000);
    }
    if (system && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
            new Notification(headline, { body: text, tag: dedupeKey || headline });
        } catch { /* ignore */ }
    }
    return true;
}

export function maybeNotifyOfficialNotice(notice, { toast = true } = {}) {
    if (!getNotifyPref() || !notice) return false;
    if (!getNotifyCategories().incidents) return false;
    const id = notice.id || notice.timestamp || notice.message || notice.text || 'x';
    const key = `notified_notice_${notice._sourceKey || 'x'}_${id}`;
    return alertLiveEvent({
        title: notice.severity === 'critical' ? 'Service alert' : 'Corridor notice',
        body: notice.message || notice.text || '',
        dedupeKey: key,
        toast,
        system: true,
    });
}

export function maybeNotifyVerifiedDelay(agg, ctx = {}) {
    if (!getNotifyPref() || !agg?.isVerified || !agg.trainKey) return false;
    if (!getNotifyCategories().delays) return false;
    const routeId = ctx.routeId || $currentRouteId.get();
    const region = $userRegion.get() || 'GP';
    const pinned = safeStorage.getItem(`defaultRoute_${region}`) || '';
    if (routeId && routeId !== $currentRouteId.get() && routeId !== pinned) return false;
    const late = agg.status === 'cancelled'
        ? 'Cancelled / no-show'
        : agg.status === 'early'
            ? `~${agg.avgLateMin || 3} min early`
            : agg.status === 'on_time'
                ? 'On time'
                : `~${agg.avgLateMin || 10} min late`;
    const station = ctx.station ? String(ctx.station).replace(/ STATION$/i, '') : '';
    return alertLiveEvent({
        title: ctx.trainId ? `Train ${ctx.trainId}` : 'Live alert',
        body: station ? `${late} · ${station}` : late,
        dedupeKey: `notified_delay_${agg.trainKey}`,
        toast: true,
        system: true,
    });
}

export async function maybeOfferCorridorAlerts() {
    // Hidden until corridor push alerts ship to commuters.
    return false;
}

if (typeof window !== 'undefined') {
    window.enablePushNotifications = enablePushNotifications;
    window.registerPushToken = registerPushToken;
    window.alertLiveEvent = alertLiveEvent;
    window.maybeNotifyOfficialNotice = maybeNotifyOfficialNotice;
    window.maybeNotifyVerifiedDelay = maybeNotifyVerifiedDelay;
}
