/**
 * Planner telemetry: routing fails + batched successful trip plans.
 *
 * Two buckets (intentionally separate):
 *  1. UI recent trips — plannerHistory_* in planner-ui.js (display cap 5)
 *  2. Telemetry queue — nt_trip_plan_queue_v1 here (flush to RTDB every 10)
 *
 * RTDB sys_logs/trip_plans/$batchId allows create-once (!data.exists).
 * Auth token preferred; anonymous create-once still works without email claim.
 */
import { DYNAMIC_BASE_URL, APP_VERSION } from './config.js';
import { safeStorage } from './utils.js';
import { $deviceId, $userRegion } from '../store.js';

/** Optional signed-in Firebase uid (null for guests / anonymous). */
function authUid() {
    try {
        if (typeof window !== 'undefined' && window.$account?.get) {
            const a = window.$account.get();
            if (a?.status === 'signed-in' && a.uid) return a.uid;
        }
    } catch { /* ignore */ }
    try {
        return safeStorage.getItem('authUid') || null;
    } catch {
        return null;
    }
}

const FAIL_DEBOUNCE_MS = 45_000;
/** Flush telemetry batch size — independent of UI history display cap. */
export const TRIP_FLUSH_SIZE = 10;
/** Soft cap if flush keeps failing offline — avoid unbounded local growth. */
const TRIP_QUEUE_HARD_CAP = 50;
export const TRIP_QUEUE_KEY = 'nt_trip_plan_queue_v1';

let lastFailKey = '';
let lastFailAt = 0;
/** Prevent overlapping flushes from double-enqueue / online+visibility races. */
let flushInFlight = null;

function deviceId() {
    return $deviceId.get() || safeStorage.getItem('next_train_device_id') || 'unknown';
}

function uid() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureAuthToken() {
    if (typeof window === 'undefined') return '';
    try {
        // Dynamic import keeps firebase-vendor out of the planner/home critical chunk.
        if (!window.firebaseAuth) {
            const { bootFirebase } = await import('./firebase-boot.js');
            await bootFirebase();
        }
        if (window.firebaseAuth && !window.firebaseAuth.currentUser && window.firebaseSignInAnonymously) {
            await window.firebaseSignInAnonymously(window.firebaseAuth);
        }
        if (window.firebaseAuth?.currentUser && window.firebaseGetIdToken) {
            return await window.firebaseGetIdToken(window.firebaseAuth.currentUser, true) || '';
        }
    } catch {
        /* ignore — create-once rules still allow unauthenticated PUT */
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

    const did = deviceId();
    const payload = {
        origin,
        destination,
        reason: reason || 'UNKNOWN',
        dayType: dayType || null,
        timeOfDay: timeOfDay || null,
        timestamp: now,
        userId: did,
        deviceId: did,
        authUid: authUid(),
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

/** Current telemetry queue length (for diagnostics / tests). */
export function getTripPlanQueueLength() {
    return readTripQueue().length;
}

/**
 * Queue a successful trip plan for telemetry.
 * UI recent-trips history is separate (planner-ui savePlannerHistory).
 * Flushes to sys_logs/trip_plans when the queue reaches TRIP_FLUSH_SIZE.
 */
export function enqueueSuccessfulTripPlan(entry) {
    const queue = readTripQueue();
    const did = deviceId();
    queue.push({
        ...entry,
        timestamp: Date.now(),
        userId: did,
        deviceId: did,
        authUid: authUid(),
        region: entry.region || $userRegion.get() || null,
        dayType: entry.dayType || null,
        appVersion: APP_VERSION,
    });
    writeTripQueue(queue.slice(-TRIP_QUEUE_HARD_CAP));

    if (queue.length >= TRIP_FLUSH_SIZE) {
        flushTripPlanQueue();
    }
}

/** Collapse duplicate searches within one flush batch (same OD / day / dep). */
function dedupeTripsForBatch(trips) {
    const seen = new Set();
    const out = [];
    for (const t of trips || []) {
        if (!t?.origin || !t?.destination) continue;
        const key = [
            String(t.origin).toUpperCase(),
            String(t.destination).toUpperCase(),
            String(t.dayType || ''),
            String(t.region || ''),
            String(t.depTime || ''),
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
    }
    return out;
}

/**
 * Flush queued trip plans to RTDB. Only clears local queue after a successful write.
 * Still waits for TRIP_FLUSH_SIZE queue items, then writes unique trips only.
 * A later batch from the same user can log the same OD again.
 */
export async function flushTripPlanQueue(force = false) {
    if (flushInFlight) return flushInFlight;

    flushInFlight = (async () => {
        const queue = readTripQueue();
        if (!queue.length) return;
        if (!force && queue.length < TRIP_FLUSH_SIZE) return;

        const rawBatch = queue.slice(0, TRIP_FLUSH_SIZE);
        const remainder = queue.slice(TRIP_FLUSH_SIZE);
        const batch = dedupeTripsForBatch(rawBatch);
        if (!batch.length) {
            // All duplicates — drop the raw slice locally so the queue can progress
            writeTripQueue(remainder.slice(-TRIP_QUEUE_HARD_CAP));
            return;
        }
        const batchId = uid();
        const did = deviceId();
        const payload = {
            count: batch.length,
            rawCount: rawBatch.length,
            flushedAt: Date.now(),
            userId: did,
            deviceId: did,
            authUid: authUid(),
            region: $userRegion.get() || null,
            appVersion: APP_VERSION,
            trips: batch,
        };

        try {
            const q = await authQuery();
            const res = await fetch(`${DYNAMIC_BASE_URL}sys_logs/trip_plans/${batchId}.json${q}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                console.warn('🛡️ Guardian: trip_plans write failed', res.status);
                return;
            }
            // Success — reset flushed portion; keep any trips enqueued during the request
            const latest = readTripQueue();
            // Prefer remainder + anything appended after we snapshotted `queue`
            const appended = latest.length > queue.length ? latest.slice(queue.length) : [];
            writeTripQueue([...remainder, ...appended].slice(-TRIP_QUEUE_HARD_CAP));
        } catch (e) {
            console.warn('🛡️ Guardian: trip_plans write error', e);
            // Leave queue intact for retry
        }
    })();

    try {
        await flushInFlight;
    } finally {
        flushInFlight = null;
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        const q = readTripQueue();
        if (q.length >= TRIP_FLUSH_SIZE) flushTripPlanQueue();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            const q = readTripQueue();
            if (q.length >= TRIP_FLUSH_SIZE) flushTripPlanQueue();
        }
    });
}
