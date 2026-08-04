/**
 * Planner telemetry: routing fails + batched successful trip plans.
 * Batches successful plans (flush at 10) to limit RTDB write cost.
 * RTDB sys_logs requires auth — anonymous sign-in + id token (same as delay reports).
 */
import { DYNAMIC_BASE_URL, APP_VERSION } from './config.js';
import { safeStorage } from './utils.js';
import { $deviceId, $userRegion } from '../store.js';
import { bootFirebase } from './firebase-boot.js';

const FAIL_DEBOUNCE_MS = 45_000;
const TRIP_FLUSH_SIZE = 10;
const TRIP_QUEUE_KEY = 'nt_trip_plan_queue_v1';

let lastFailKey = '';
let lastFailAt = 0;

function deviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown';
}

function uid() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureAuthToken() {
    if (typeof window === 'undefined') return '';
    try {
        if (!window.firebaseAuth) await bootFirebase();
        if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
            await window.firebaseSignInAnonymously(window.firebaseAuth);
        }
        if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true) || '';
        }
    } catch {
        /* ignore */
    }
    return '';
}

async function authQuery() {
    const token = await ensureAuthToken();
    return token ? `?auth=${encodeURIComponent(token)}` : '';
}

/**
 * Log a planner failure once per origin|dest|reason|day within the debounce window
 * (prevents double-count from double-invoked search / rapid retries).
 */
export async function logRoutingFail({ origin, destination, reason, dayType, timeOfDay }) {
    const key = `${origin}|${destination}|${reason || 'UNKNOWN'}|${dayType || 'unknown'}`;
    const now = Date.now();
    if (key === lastFailKey && now - lastFailAt < FAIL_DEBOUNCE_MS) {
        return; // dedupe
    }
    lastFailKey = key;
    lastFailAt = now;

    const payload = {
        origin,
        destination,
        reason: reason || 'UNKNOWN',
        dayType: dayType || null,
        timeOfDay: timeOfDay || null,
        timestamp: now,
        deviceId: deviceId(),
        region: $userRegion.get() || null,
        appVersion: APP_VERSION,
    };

    const failId = uid();
    try {
        const q = await authQuery();
        const res = await fetch(`${DYNAMIC_BASE_URL}sys_logs/routing_fails/${failId}.json${q}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            console.warn('🛡️ Guardian: routing_fails write failed', res.status);
        }
    } catch (e) {
        console.warn('🛡️ Guardian: routing_fails write error', e);
    }
}

function readTripQueue() {
    try {
        const arr = JSON.parse(safeStorage.getItem(TRIP_QUEUE_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function writeTripQueue(arr) {
    safeStorage.setItem(TRIP_QUEUE_KEY, JSON.stringify(arr));
}

/** Queue a successful trip plan; flush to RTDB every TRIP_FLUSH_SIZE entries. */
export function enqueueSuccessfulTripPlan(entry) {
    const queue = readTripQueue();
    queue.push({
        ...entry,
        timestamp: Date.now(),
        deviceId: deviceId(),
        region: $userRegion.get() || null,
        appVersion: APP_VERSION,
    });
    if (queue.length >= TRIP_FLUSH_SIZE) {
        flushTripPlanQueue(queue);
    } else {
        writeTripQueue(queue);
    }
}

export async function flushTripPlanQueue(queue = readTripQueue()) {
    if (!queue.length) return;
    writeTripQueue([]);
    const batchId = uid();
    const payload = {
        count: queue.length,
        flushedAt: Date.now(),
        deviceId: deviceId(),
        region: $userRegion.get() || null,
        appVersion: APP_VERSION,
        trips: queue,
    };
    try {
        const q = await authQuery();
        const res = await fetch(`${DYNAMIC_BASE_URL}sys_logs/trip_plans/${batchId}.json${q}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            console.warn('🛡️ Guardian: trip_plans write failed', res.status);
            writeTripQueue([...queue, ...readTripQueue()].slice(0, 50));
        }
    } catch {
        writeTripQueue([...queue, ...readTripQueue()].slice(0, 50));
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        const q = readTripQueue();
        if (q.length >= TRIP_FLUSH_SIZE) flushTripPlanQueue(q);
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            const q = readTripQueue();
            // Opportunistic flush if we have a meaningful batch when backgrounding
            if (q.length >= TRIP_FLUSH_SIZE) flushTripPlanQueue(q);
        }
    });
}
