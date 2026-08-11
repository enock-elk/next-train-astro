/**
 * Web Push / FCM bootstrap for corridor alerts + optional room activity.
 * Requires PUBLIC_FIREBASE_VAPID_KEY at build time for getToken().
 * Falls back to Notification API permission + local pref when VAPID missing.
 */
import { DYNAMIC_BASE_URL, APP_VERSION } from './config.js';
import { safeStorage } from './utils.js';
import { $currentRouteId, $deviceId } from '../store.js';
import { $account } from './account.js';
import { bootFirebase } from './firebase-boot.js';
import { FEATURE_KEYS, isFeatureEnabled, fetchFeatures, isLabEnvironment } from './features.js';
import { NOTIFY_PREF_KEY, getNotifyPref, syncNotifyUi } from './prefs.js';

const SUB_ROUTES_KEY = 'notifyRouteIds';
const TOKEN_CACHE_KEY = 'fcmTokenCache';

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
    if (!window.firebaseMessaging || !window.firebaseGetToken) return null;
    return window.firebaseMessaging;
}

async function persistToken(token) {
    if (!token) return;
    safeStorage.setItem(TOKEN_CACHE_KEY, token);
    const deviceId = getDeviceId();
    const acct = $account.get();
    const routeIds = getNotifyRouteIds();
    const payload = {
        token,
        updatedAt: Date.now(),
        deviceId,
        uid: acct.status === 'signed-in' ? acct.uid : null,
        routeIds,
        appVersion: APP_VERSION,
        lab: isLabEnvironment(),
        userAgent: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 180) : '',
    };

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

/**
 * Request FCM token using the existing PWA service worker registration.
 * @returns {Promise<string|null>}
 */
export async function registerPushToken() {
    await fetchFeatures();
    const routeId = $currentRouteId.get() || '';
    if (!isFeatureEnabled(FEATURE_KEYS.PUSH_NOTIFY, routeId) && !isLabEnvironment()) {
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
        const token = await window.firebaseGetToken(messaging, {
            vapidKey,
            ...(registration ? { serviceWorkerRegistration: registration } : {}),
        });
        if (token) await persistToken(token);
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
                ? 'Permission on — add PUBLIC_FIREBASE_VAPID_KEY to finish FCM on lab'
                : 'Permission on — push delivery wiring completes when VAPID is configured',
        };
    }
    if (!token) {
        return { ok: true, token: null, message: 'Notifications enabled — token pending (SW / network)' };
    }
    return { ok: true, token, message: 'Push alerts enabled for your routes' };
}

export async function disablePushNotifications() {
    safeStorage.setItem(NOTIFY_PREF_KEY, 'false');
    syncNotifyUi(false);
    return false;
}

/** Boot hook — refresh token if pref already on. */
export async function hydratePushNotifications() {
    await fetchFeatures();
    if (!getNotifyPref()) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        ensureCurrentRouteSubscribed();
        await registerPushToken();
        await bindForegroundPush();
    }
    syncNotifyUi(getNotifyPref());
}

if (typeof window !== 'undefined') {
    window.enablePushNotifications = enablePushNotifications;
    window.registerPushToken = registerPushToken;
}
