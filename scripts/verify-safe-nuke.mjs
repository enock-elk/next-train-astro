/**
 * Deterministic safe-NUKE verification.
 * Run: node scripts/verify-safe-nuke.mjs
 */
import { readFileSync } from 'node:fs';
import {
    KILLSWITCH_APPLIED_KEY,
    KILLSWITCH_PENDING_KEY,
    cacheClearPolicy,
    createAsyncMutex,
    destructiveNetworkIsSafe,
    isProtectedVolatileKey,
    newestUnappliedKillswitchTimestamp,
    shouldDeleteCacheForPolicy,
    VOLATILE_FLUSH_PROTECTED_KEYS,
    VOLATILE_FLUSH_PROTECTED_PREFIXES,
} from '../src/lib/utils.js';
import { ALERT_IMAGE_CACHE, ALERT_IMAGE_INDEX_KEY } from '../src/lib/alert-image-cache.js';
import { FORCE_UPDATE_REQUIRED } from '../src/lib/config.js';

const failures = [];
const assert = (condition, message) => {
    if (!condition) failures.push(message);
};

// Mutex is FIFO, deduplicates destructive overlap, and unlocks after rejection.
const mutex = createAsyncMutex();
const order = [];
let active = 0;
let maxActive = 0;
const first = mutex.runExclusive(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push('first:start');
    await Promise.resolve();
    order.push('first:end');
    active -= 1;
});
const second = mutex.runExclusive(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push('second');
    active -= 1;
});
await Promise.all([first, second]);
assert(maxActive === 1, 'mutex never overlaps tasks');
assert(order.join(',') === 'first:start,first:end,second', 'mutex preserves FIFO order');
await mutex.runExclusive(async () => { throw new Error('expected'); }).catch(() => {});
let recovered = false;
await mutex.runExclusive(async () => { recovered = true; });
assert(recovered, 'mutex unlocks after a rejected task');

// A pending interrupted timestamp and a newer remote value collapse to one target.
assert(newestUnappliedKillswitchTimestamp(12, 11, 10) === 12, 'newest remote timestamp wins');
assert(newestUnappliedKillswitchTimestamp(11, 13, 10) === 13, 'newest interrupted timestamp wins');
assert(newestUnappliedKillswitchTimestamp(12, 12, 12) === 0, 'already-applied timestamp clears once');
assert(newestUnappliedKillswitchTimestamp('bad', 14, 13) === 14, 'invalid remote value cannot hide pending work');
assert(KILLSWITCH_APPLIED_KEY !== KILLSWITCH_PENDING_KEY, 'pending and applied markers are distinct');

// Identity, auth/admin sessions, preferences, queues, and optional schedule snapshots survive.
for (const key of [
    'next_train_device_id',
    'userProfile',
    'theme',
    'colourPack',
    'navStyle',
    'authUid',
    'firebase:authUser:app:[DEFAULT]',
    'analytics_queue',
    'nt_trip_plan_queue_v1',
    KILLSWITCH_APPLIED_KEY,
    KILLSWITCH_PENDING_KEY,
]) {
    assert(isProtectedVolatileKey(key), `protected localStorage key: ${key}`);
}
assert(isProtectedVolatileKey('full_db_GP', { preserveSchedules: true }), 'last-good local schedule can be protected');
assert(!isProtectedVolatileKey('full_db_GP'), 'manual volatile flush may clear its local schedule copy');
assert(!isProtectedVolatileKey('throwaway_runtime_flag'), 'unrelated volatile keys remain clearable');

// Destructive operations require all three independent network signals.
assert(destructiveNetworkIsSafe({ online: true, lieFi: false, preflight: 'ok' }), 'usable network passes guard');
assert(!destructiveNetworkIsSafe({ online: false, lieFi: false, preflight: 'ok' }), 'offline blocks destruction');
assert(!destructiveNetworkIsSafe({ online: true, lieFi: true, preflight: 'ok' }), 'Lie-Fi blocks destruction');
assert(!destructiveNetworkIsSafe({ online: true, lieFi: false, preflight: 'timeout' }), 'failed preflight blocks destruction');

// System and manual sources intentionally have different cleanup behavior.
const system = cacheClearPolicy('system_killswitch');
const manual = cacheClearPolicy('check_updates');
const factory = cacheClearPolicy('modal_confirm');
assert(!system.unregisterServiceWorkers && system.preservePrecache, 'killswitch preserves active SW and precache shell');
assert(system.preserveScheduleCaches && !system.deleteScheduleDatabase, 'killswitch preserves last-good schedules');
assert(!system.flushLocalStorage && !system.resetLook && !system.showUpdatedToast, 'killswitch preserves state and avoids success toast');
assert(manual.downloadThenSwap && manual.preservePrecache, 'Check for Updates keeps the cached shell until the incoming install finishes');
assert(!manual.unregisterServiceWorkers && !manual.flushLocalStorage, 'Check for Updates does not wipe before the incoming install');
assert(!manual.resetLook && !manual.deleteScheduleDatabase && manual.showUpdatedToast, 'Check for Updates keeps look/schedules and still toasts');
assert(!shouldDeleteCacheForPolicy('workbox-precache-v9', system), 'killswitch keeps current precache');
assert(!shouldDeleteCacheForPolicy('schedule-dump', system), 'killswitch keeps schedule runtime cache');
assert(shouldDeleteCacheForPolicy('static-runtime', system), 'killswitch removes obsolete static runtime cache');
assert(shouldDeleteCacheForPolicy('astro-hashed', system), 'killswitch removes obsolete hashed asset cache');
assert(shouldDeleteCacheForPolicy(ALERT_IMAGE_CACHE, system), 'killswitch removes cached alert posters');
assert(!shouldDeleteCacheForPolicy('workbox-precache-v9', manual), 'Check for Updates keeps the precache');
assert(shouldDeleteCacheForPolicy(ALERT_IMAGE_CACHE, factory), 'factory reset removes cached alert posters');
assert(!VOLATILE_FLUSH_PROTECTED_KEYS.includes(ALERT_IMAGE_INDEX_KEY), 'alert image index is not a protected localStorage key');
assert(!VOLATILE_FLUSH_PROTECTED_PREFIXES.some((prefix) => ALERT_IMAGE_INDEX_KEY.startsWith(prefix)), 'alert image index is not under a protected prefix');
assert(!isProtectedVolatileKey(ALERT_IMAGE_INDEX_KEY), 'alert image index is flushed on nuke');

assert(FORCE_UPDATE_REQUIRED === true, 'FORCE_UPDATE_REQUIRED is true for this build');

const logic = readFileSync(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
const hub = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
const update = readFileSync(new URL('../src/lib/app-update.js', import.meta.url), 'utf8');
assert(logic.includes('killswitchCheckPromise'), 'concurrent killswitch calls share one in-flight check');
assert(logic.includes("safeStorage.setItem(KILLSWITCH_PENDING_KEY"), 'killswitch writes pending marker before cleanup');
assert(logic.indexOf('safeStorage.setItem(KILLSWITCH_APPLIED_KEY') > logic.indexOf("performHardCacheClear('system_killswitch')"), 'killswitch marks applied only after cleanup');
assert(logic.includes("setInterval(() => poke({ visibleOnly: true }), 60_000)"), 'visible online sessions check periodically');
assert(hub.indexOf('probeReachability(3500)') < hub.indexOf("if ('caches' in window)"), 'killswitch preflights before Cache Storage changes');
assert(hub.includes("performHardCacheClear('check_updates', {"), 'manual Check for Updates still goes through the update path');
assert(hub.includes("policy.systemKillswitch || (source === 'check_updates' && !skipNetworkPreflight)"), 'Check for Updates still preflights unless the commuter confirmed');
assert(hub.includes('policy.systemKillswitch && isLieFi'), 'manual retry probes again instead of trusting a stale Lie-Fi flag');
assert(hub.includes('openNetworkSlowConfirm'), 'slow Check for Updates asks before swapping');
assert(hub.includes('installIncomingServiceWorker'), 'Check for Updates downloads the incoming worker before dropping the cached shell');
assert(hub.includes('Kept your saved app. Try again on a stronger connection.'), 'failed Check for Updates keeps the cached app');
assert(hub.includes('skipNetworkPreflight'), 'confirmed Check for Updates can skip only the check_updates probe');
assert(!hub.includes('skipNetworkPreflight') || hub.includes('policy.systemKillswitch || (source === \'check_updates\' && !skipNetworkPreflight)'), 'killswitch never skips the network preflight');
assert(update.indexOf('await activateWaitingServiceWorker()') < update.indexOf("hardReloadWithCacheBust('version_enforce')"), 'forced update activates waiting SW before reload');
assert(update.includes("window.addEventListener('online', attempt)"), 'forced update retries immediately when online');
assert(update.includes("document.visibilityState === 'visible'"), 'forced update defers until visible');

if (failures.length) {
    console.error(`verify-safe-nuke: ${failures.length} failed`);
    for (const failure of failures) console.error(' -', failure);
    process.exit(1);
}

console.log('verify-safe-nuke: ok');
