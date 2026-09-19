/**
 * Planner telemetry: routing fails, batched trip plans, and immediate fare votes.
 *
 * Two trip buckets (intentionally separate):
 *  1. UI recent trips — plannerHistory_* in planner-ui.js (display cap 5)
 *  2. Telemetry queue — nt_trip_plan_queue_v1 here (flush to RTDB every 10)
 *
 * Fare votes write immediately to sys_logs/fare_votes/$voteId (create-once).
 * Offline devices keep a queue of one vote and flush on reconnect.
 *
 * Operator-approved live prices live at config/planner_fares/$fareKey
 * (public read, operator write). Votes stay create-once in sys_logs.
 *
 * RTDB sys_logs/trip_plans/$batchId allows create-once (!data.exists).
 * Auth token preferred; anonymous create-once still works without email claim.
 *
 * Live write path stays `sys_logs/trip_plans/$batchId`. Do not move or stop
 * that PUT. Archival / TTL for the ~20k-batch bloat is documented in
 * docs/R2-AND-TRIP-PLANS.md and ships later without changing this flush.
 */
import { DYNAMIC_BASE_URL, APP_VERSION, FARE_CONFIG } from './config.js';
import { safeStorage, normalizeStationName } from './utils.js';
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
function telemetryPathKey(raw) {
    return String(raw || 'unknown').replace(/[.#$[\]/]/g, '_');
}

function tripPairKey(origin, dest) {
    return `${telemetryPathKey(String(origin).toUpperCase())}~${telemetryPathKey(String(dest).toUpperCase())}`;
}

async function upsertIndexNode(url, createBody, patchBody) {
    try {
        const existing = await fetch(url, { cache: 'no-store' });
        if (existing.ok) {
            const prev = await existing.json();
            if (prev && typeof prev === 'object') {
                await fetch(url, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patchBody),
                });
                return;
            }
        }
    } catch { /* create */ }
    await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createBody),
    });
}

/** All-time unique users + unique origin/destination pairs (sibling of trip_plans). */
async function upsertTripPlanIndexes(userId, region, trips, q) {
    const now = Date.now();
    const did = telemetryPathKey(userId);
    if (!did || did === 'unknown') return;
    const userUrl = `${DYNAMIC_BASE_URL}sys_logs/trip_plan_users/${encodeURIComponent(did)}.json${q}`;
    await upsertIndexNode(
        userUrl,
        { firstSeen: now, lastSeen: now, region: region || null },
        { lastSeen: now, region: region || null },
    );
    const seen = new Set();
    for (const t of trips || []) {
        if (!t?.origin || !t?.destination) continue;
        const key = tripPairKey(t.origin, t.destination);
        if (seen.has(key)) continue;
        seen.add(key);
        const pairUrl = `${DYNAMIC_BASE_URL}sys_logs/trip_plan_pairs/${encodeURIComponent(key)}.json${q}`;
        await upsertIndexNode(
            pairUrl,
            {
                firstSeen: now,
                lastSeen: now,
                origin: t.origin,
                destination: t.destination,
            },
            { lastSeen: now },
        );
    }
}

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
            try {
                await upsertTripPlanIndexes(did, payload.region, batch, q);
            } catch (idxErr) {
                console.warn('🛡️ Guardian: trip_plan index write failed', idxErr);
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

/** Same floor as the board fare button: half-rand ceil, then whole rand (R7.50 → 7). */
export function roundFareVoteRand(raw) {
    let n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    n = Math.ceil(n * 2) / 2;
    return Math.floor(n);
}

export const FARE_VOTE_QUEUE_KEY = 'nt_fare_vote_queue_v1';
const FARE_VOTE_SENT_KEY = 'nt_fare_vote_sent_v1';

export function fareVoteCooldownKey({ origin, destination, dayType, isOffPeak, profile } = {}) {
    return [
        String(origin || '').toUpperCase(),
        String(destination || '').toUpperCase(),
        String(dayType || ''),
        isOffPeak ? 'off' : 'peak',
        String(profile || 'Adult'),
    ].join('|');
}

function readFareVoteSentKeys() {
    try {
        const arr = JSON.parse(safeStorage.getItem(FARE_VOTE_SENT_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

export function hasFareVoteBeenSent(key) {
    if (!key) return false;
    return readFareVoteSentKeys().includes(key);
}

export function markFareVoteSent(key) {
    if (!key) return;
    const keys = readFareVoteSentKeys();
    if (keys.includes(key)) return;
    keys.push(key);
    safeStorage.setItem(FARE_VOTE_SENT_KEY, JSON.stringify(keys.slice(-200)));
}

function readFareVoteQueue() {
    try {
        const arr = JSON.parse(safeStorage.getItem(FARE_VOTE_QUEUE_KEY) || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function writeFareVoteQueue(arr) {
    safeStorage.setItem(FARE_VOTE_QUEUE_KEY, JSON.stringify(Array.isArray(arr) ? arr.slice(-1) : []));
}

export function getFareVoteQueueLength() {
    return readFareVoteQueue().length;
}

/** Offline buffer is exactly one vote (latest wins). */
export function enqueueFareVoteOffline(payload) {
    if (!payload || typeof payload !== 'object') return;
    writeFareVoteQueue([payload]);
}

function clipStr(value, max) {
    return String(value || '').slice(0, max);
}

export function buildFareVotePayload({
    origin,
    destination,
    routeIds,
    km,
    crowKm,
    smoothKm,
    abKm,
    zone,
    quotedPrice,
    reportedPrice,
    agree,
    isOffPeak,
    dayType,
    depTime,
    profile,
    region,
    deviceId: did,
    authUid: uidOverride,
    appVersion,
    at,
} = {}) {
    const quoted = roundFareVoteRand(quotedPrice);
    const reported = roundFareVoteRand(reportedPrice == null ? quotedPrice : reportedPrice);
    const routes = Array.isArray(routeIds)
        ? routeIds.map((id) => clipStr(id, 40)).filter(Boolean).slice(0, 8)
        : [];
    const smoothNum = Number(smoothKm != null ? smoothKm : km);
    const abNum = Number(abKm != null ? abKm : crowKm);
    const smooth = Number.isFinite(smoothNum) ? smoothNum : null;
    const ab = Number.isFinite(abNum) ? abNum : null;
    return {
        origin: clipStr(origin, 79),
        destination: clipStr(destination, 79),
        routeIds: routes,
        km: smooth,
        crowKm: ab,
        smoothKm: smooth,
        abKm: ab,
        zone: clipStr(zone, 8) || null,
        quotedPrice: quoted,
        reportedPrice: reported,
        agree: !!agree,
        isOffPeak: !!isOffPeak,
        dayType: clipStr(dayType, 24) || null,
        depTime: clipStr(depTime, 8) || null,
        profile: clipStr(profile || 'Adult', 40),
        region: region != null ? clipStr(region, 8) : ($userRegion.get() || null),
        deviceId: clipStr(did || deviceId(), 79),
        authUid: uidOverride !== undefined ? uidOverride : authUid(),
        appVersion: clipStr(appVersion || APP_VERSION, 32),
        at: Number(at) || Date.now(),
    };
}

async function putFareVote(payload) {
    const voteId = uid();
    const q = await authQuery();
    const res = await fetch(`${DYNAMIC_BASE_URL}sys_logs/fare_votes/${voteId}.json${q}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(String(res.status));
    return voteId;
}

export async function flushFareVoteQueue() {
    const queue = readFareVoteQueue();
    if (!queue.length) return false;
    const payload = queue[0];
    try {
        await putFareVote(payload);
        writeFareVoteQueue([]);
        return true;
    } catch (e) {
        console.warn('🛡️ Guardian: fare_votes flush failed', e);
        return false;
    }
}

/**
 * Write one fare vote immediately (create-once). Queue locally only if the
 * device is offline, replacing any pending vote (queue length 1).
 */
export async function submitFareVote(input) {
    const payload = buildFareVotePayload(input);
    const key = fareVoteCooldownKey(payload);
    if (hasFareVoteBeenSent(key)) return { skipped: true };
    if (!payload.origin || !payload.destination) return { skipped: true };
    if (payload.quotedPrice < 1 || payload.quotedPrice > 500) return { skipped: true };
    if (payload.reportedPrice < 1 || payload.reportedPrice > 500) return { skipped: true };

    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) {
        enqueueFareVoteOffline(payload);
        markFareVoteSent(key);
        return { queued: true };
    }
    try {
        const voteId = await putFareVote(payload);
        markFareVoteSent(key);
        return { ok: true, voteId };
    } catch (e) {
        console.warn('🛡️ Guardian: fare_votes write failed', e);
        enqueueFareVoteOffline(payload);
        markFareVoteSent(key);
        return { queued: true };
    }
}

export const FARE_TICKET_PHOTOS_PATH = 'sys_logs/fare_ticket_photos';

export function buildFareTicketPhotoPayload({ ticketUrl, deviceId: did, at } = {}) {
    return {
        ticketUrl: clipStr(ticketUrl, 1999),
        deviceId: clipStr(did || deviceId(), 79),
        at: Number(at) || Date.now(),
    };
}

/** Create-once sidecar. Votes cannot be patched, so the photo is a second PUT. */
export async function putFareTicketPhoto(voteId, input = {}) {
    const id = clipStr(voteId, 80);
    const payload = buildFareTicketPhotoPayload(input);
    if (!id || payload.ticketUrl.length < 13 || !payload.deviceId) return { skipped: true };
    const q = await authQuery();
    const res = await fetch(`${DYNAMIC_BASE_URL}${FARE_TICKET_PHOTOS_PATH}/${encodeURIComponent(id)}.json${q}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(String(res.status));
    return { ok: true };
}

const PLANNER_FARES_PATH = 'config/planner_fares';
let cachedPlannerFares = null;
let cachedPlannerFaresAt = 0;
const PLANNER_FARES_TTL_MS = 60 * 1000;

function fareOverrideSlug(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/ STATION$/i, '')
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40);
}

function fareOverrideDay(dayType) {
    const raw = String(dayType || 'weekday').toLowerCase();
    if (raw === 'saturday' || raw === 'sunday' || raw === 'public_holiday') return raw;
    return 'weekday';
}

export function plannerFareOverrideKey({ origin, destination, profile, isOffPeak, dayType } = {}) {
    const prof = fareOverrideSlug(profile || 'Adult') || 'ADULT';
    const always = !!(FARE_CONFIG.profiles[profile || 'Adult']?.alwaysDiscount
        || FARE_CONFIG.profiles[String(profile || '').replace(/^\w/, (c) => c.toUpperCase())]?.alwaysDiscount);
    const peakSlot = always ? 'all' : (isOffPeak ? 'off' : 'peak');
    return [
        fareOverrideSlug(origin) || 'ORIGIN',
        fareOverrideSlug(destination) || 'DEST',
        prof,
        peakSlot,
        fareOverrideDay(dayType),
    ].join('__');
}

export function setPlannerFareOverridesCache(map) {
    cachedPlannerFares = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    cachedPlannerFaresAt = Date.now();
}

export async function ensurePlannerFareOverrides(force = false) {
    if (!force && cachedPlannerFares && (Date.now() - cachedPlannerFaresAt) < PLANNER_FARES_TTL_MS) {
        return cachedPlannerFares;
    }
    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}${PLANNER_FARES_PATH}.json`, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            setPlannerFareOverridesCache(data && typeof data === 'object' ? data : {});
        } else if (!cachedPlannerFares) {
            setPlannerFareOverridesCache({});
        }
    } catch {
        if (!cachedPlannerFares) setPlannerFareOverridesCache({});
    }
    return cachedPlannerFares || {};
}

export function lookupPlannerFareOverride({ origin, destination, profile, isOffPeak, dayType } = {}) {
    const map = cachedPlannerFares;
    if (!map) return null;
    const key = plannerFareOverrideKey({ origin, destination, profile, isOffPeak, dayType });
    const row = map[key];
    if (!row || typeof row !== 'object') return null;
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 1 || price > 500) return null;
    return { ...row, key, price };
}

export function applyApprovedPlannerFare(fare, trip = {}) {
    if (!fare) return fare;
    const hit = lookupPlannerFareOverride({
        origin: normalizeStationName(trip.from || trip.origin || ''),
        destination: normalizeStationName(trip.to || trip.destination || ''),
        profile: fare.profile || 'Adult',
        isOffPeak: !!fare.isOffPeak,
        dayType: fare.dayType,
    });
    if (!hit) return fare;
    return {
        ...fare,
        price: hit.price,
        priceLabel: String(Math.floor(hit.price)),
        rawPriceLabel: String(hit.price),
        approved: true,
        approvedKey: hit.key,
    };
}

export function buildPlannerFareOverrideRecord(vote = {}, { approvedBy, at } = {}) {
    const price = Number(vote.reportedPrice);
    return {
        origin: String(vote.origin || '').slice(0, 79),
        destination: String(vote.destination || '').slice(0, 79),
        profile: String(vote.profile || 'Adult').slice(0, 40),
        isOffPeak: !!vote.isOffPeak,
        dayType: String(vote.dayType || 'weekday').slice(0, 24),
        price: Number.isFinite(price) ? price : 0,
        voteId: String(vote.id || vote.voteId || '').slice(0, 80),
        quotedPrice: Number(vote.quotedPrice) || null,
        approvedAt: Number(at) || Date.now(),
        approvedBy: String(approvedBy || '').slice(0, 80),
    };
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
        const q = readTripQueue();
        if (q.length >= TRIP_FLUSH_SIZE) flushTripPlanQueue();
        flushFareVoteQueue();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            const q = readTripQueue();
            if (q.length >= TRIP_FLUSH_SIZE) flushTripPlanQueue();
        }
        if (document.visibilityState === 'visible') {
            flushFareVoteQueue();
        }
    });
}
