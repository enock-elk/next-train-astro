/**
 * Force-update / SW refresh path (SPA enforceAppVersion + handleUpdateFound parity).
 * Uses vite-plugin-pwa's registerSW while preserving cache-bust redirects and
 * session-stability marks so CleverAds are not injected into a dying page.
 */
import { APP_VERSION, FORCE_UPDATE_REQUIRED, withBase } from './config.js';
import { safeStorage, destructiveNetworkIsSafe } from './utils.js';
import { showToast, triggerHaptic } from './ui.js';
import { markPendingReload } from './session-stability.js';

/** If the incoming SW is not fully installed by then, keep the cached shell. */
const INCOMING_UPDATE_FALLBACK_MS = 30000;

/** Background the tab this long, then let a waiting worker activate in place. */
const QUIET_SKIP_WAITING_HIDDEN_MS = 5 * 60 * 1000;

/**
 * Activate a waiting service worker without reloading this tab.
 * Does not set __ntPendingUpdateToken, so controllerchange keeps the session.
 */
function armQuietSkipWaiting(getRegistration) {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    if (window.__ntQuietSkipArmed) return;
    window.__ntQuietSkipArmed = true;

    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
    let timer = null;
    const clear = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
    const trySkip = async () => {
        if (document.visibilityState !== 'hidden') return;
        try {
            const reg = typeof getRegistration === 'function' ? getRegistration() : getRegistration;
            const waiting = reg && reg.waiting;
            if (!waiting) return;
            waiting.postMessage({ type: 'SKIP_WAITING' });
            console.log('🛡️ Guardian: Idle skipWaiting — new SW applies without a reload.');
        } catch (e) {
            console.warn('🛡️ Guardian: Idle skipWaiting failed', e);
        }
    };
    const schedule = () => {
        clear();
        if (document.visibilityState !== 'hidden') {
            hiddenAt = 0;
            return;
        }
        hiddenAt = hiddenAt || Date.now();
        const wait = Math.max(0, QUIET_SKIP_WAITING_HIDDEN_MS - (Date.now() - hiddenAt));
        timer = setTimeout(trySkip, wait);
    };
    document.addEventListener('visibilitychange', schedule);
    schedule();
}

/**
 * Same-document restart. Numeric `?v=` used to be a cache-bust; iOS home-screen
 * PWAs treat that query as a new site (empty localStorage → Welcome + reload loop).
 * If this boot still has a leftover numeric `?v=`, hop to the clean start URL.
 */
export function reloadToApplyUpdate(reason = 'force_update') {
    markPendingReload(reason, 800);
    if (typeof window === 'undefined') return;
    try {
        const url = new URL(window.location.href);
        const v = url.searchParams.get('v');
        if (v && /^\d{8,}$/.test(v)) {
            url.searchParams.delete('v');
            const next = `${url.pathname}${url.search}${url.hash}`;
            console.log(`🛡️ Guardian: Restarting to implement the new version (${reason}). Stripping leftover ?v= so iOS keeps the pinned route.`);
            window.location.replace(next);
            return;
        }
    } catch { /* fall through to reload */ }
    console.log(`🛡️ Guardian: Restarting now to implement the new version (${reason}). Same URL (no ?v= hop).`);
    window.location.reload();
}

const FORCE_RELOAD_CAP_KEY = 'nt_force_update_cap';
const MAX_FORCE_RELOADS_PER_VERSION = 3;
const MAX_UNSTICKS_PER_VERSION = 1;
const VERSION_PROBE_TIMEOUT_MS = 4000;

function readForceCap(version) {
    try {
        const raw = sessionStorage.getItem(FORCE_RELOAD_CAP_KEY);
        const data = raw ? JSON.parse(raw) : null;
        if (!data || data.version !== version) return { version, reloads: 0, unsticks: 0 };
        return {
            version,
            reloads: Number(data.reloads) || 0,
            unsticks: Number(data.unsticks) || 0,
        };
    } catch {
        return { version, reloads: 0, unsticks: 0 };
    }
}

function writeForceCap(cap) {
    try { sessionStorage.setItem(FORCE_RELOAD_CAP_KEY, JSON.stringify(cap)); } catch { /* ignore */ }
}

function probeTimeout(promise, ms, fallback = null) {
    return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(fallback);
        }, ms);
        Promise.resolve(promise).then(
            (value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            },
            () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(fallback);
            },
        );
    });
}

/** Compare release ids shaped like V9_09.12.1. Invalid ids are never newer. */
export function isAppVersionNewer(candidate, current = APP_VERSION) {
    const tuple = (value) => {
        const match = String(value || '').split(' - ')[0].trim().match(/^V?(\d+)_(\d{2})\.(\d{2})\.(\d+)$/i);
        return match ? match.slice(1).map(Number) : null;
    };
    const next = tuple(candidate);
    const active = tuple(current);
    if (!next || !active) return false;
    for (let i = 0; i < next.length; i += 1) {
        if (next[i] !== active[i]) return next[i] > active[i];
    }
    return false;
}

export function normalizeAppVersionId(value) {
    const id = String(value || '').split(' - ')[0].trim();
    return /^V?\d+_\d{2}\.\d{2}\.\d+$/i.test(id) ? id : '';
}

/** Newest-wins across probe sources so a stale SW/HTTP cache cannot hide a live ship. */
export function pickNewestAppVersion(versions, fallback = null) {
    let best = normalizeAppVersionId(fallback);
    for (const raw of versions || []) {
        const id = normalizeAppVersionId(raw);
        if (!id) continue;
        if (!best || isAppVersionNewer(id, best)) best = id;
    }
    return best || null;
}

/**
 * Same-origin `/app-version.json` only. The edge already serves that file
 * no-store. Cross-origin dump hosts reject the probe preflight.
 */
export function listAppVersionProbeUrls() {
    const seen = new Set();
    const urls = [];
    const add = (value) => {
        const raw = String(value || '').trim();
        if (!raw) return;
        let abs = raw;
        try {
            if (typeof location !== 'undefined' && location.origin) {
                abs = new URL(raw, location.origin).href;
            }
        } catch { /* keep raw */ }
        if (seen.has(abs)) return;
        seen.add(abs);
        urls.push(abs);
    };
    add(withBase('app-version.json'));
    return urls;
}

function isOriginVersionProbe(url) {
    try {
        if (typeof location === 'undefined' || !location.origin) return /nexttrain\.co\.za\/app-version\.json$/i.test(url);
        return new URL(url).origin === location.origin;
    } catch {
        return false;
    }
}

async function fetchPublishedVersion(url) {
    const bust = url.includes('?') ? `&ntv=${Date.now()}` : `?ntv=${Date.now()}`;
    const res = await fetch(url + bust, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return normalizeAppVersionId(data && (data.version || data.appVersion || data.APP_VERSION));
}

/**
 * Incoming = the published same-origin `app-version.json`.
 * Returns null when the probe fails so callers do not treat this shell as "incoming".
 */
export async function peekIncomingVersionReport() {
    const urls = listAppVersionProbeUrls();
    const sources = await Promise.all(urls.map(async (url) => {
        const version = await probeTimeout(fetchPublishedVersion(url), VERSION_PROBE_TIMEOUT_MS, null);
        return { url, version };
    }));
    const newest = pickNewestAppVersion(sources.map((row) => row.version));
    const originRow = sources.find((row) => isOriginVersionProbe(row.url) && row.version);
    console.log(`🛡️ Guardian: Version probe → newest ${newest || 'none'} | running ${APP_VERSION}`);
    return { version: newest, originVersion: originRow?.version || null, sources };
}

export async function peekIncomingVersion() {
    try {
        const report = await peekIncomingVersionReport();
        return report.version;
    } catch (e) {
        console.warn('🛡️ Guardian: Failed to peek at incoming update version.', e);
        return null;
    }
}

/**
 * Auto force-update target. Always return a published version newer than the
 * running shell so we *try* to install. Dump-ahead of production is handled
 * by already_current (no toast / no auto unstick / no reload). Stale origin
 * JSON still yields the dump so install can run.
 */
export function pickForceUpdateTarget(report, running = APP_VERSION) {
    const newest = report?.version || null;
    const originVersion = report?.originVersion || null;
    if (originVersion && isAppVersionNewer(originVersion, running)) return originVersion;
    if (newest && isAppVersionNewer(newest, running)) return newest;
    return null;
}

/** True when GitHub/jsDelivr is newer than the host the TWA/PWA is actually on. */
export function isDumpAheadOfOrigin(report, running = APP_VERSION) {
    const newest = normalizeAppVersionId(report?.version);
    const origin = normalizeAppVersionId(report?.originVersion);
    if (!newest || !origin) return false;
    return isAppVersionNewer(newest, origin) && !isAppVersionNewer(origin, running);
}

/** Precache finished. already_current / no_sw / timeout are not a downloaded shell. */
export function isIncomingWorkerDownloaded(installed) {
    const reason = installed && installed.reason;
    return !!(installed && installed.ok && (reason === 'waiting' || reason === 'installed'));
}

/**
 * Automatic toast only after a newer host shell is already on disk.
 * Dump-ahead of production must stay silent even if some other worker is waiting.
 */
export function shouldToastAutomaticUpdate({ downloaded, newer, dumpAhead } = {}) {
    return !!(downloaded && newer && !dumpAhead);
}

/** Visible force-update toast (SPA parity) — always names the *incoming* version. */
function showCrucialUpdateToast(incomingVersion) {
    if (crucialUpdateToastShown) return;
    crucialUpdateToastShown = true;
    const label = incomingVersion || 'Latest';
    const msg = `Crucial system update incoming: ${label}.`;
    try {
        showToast(msg, 'error', 5000, '', { cooldownMs: 30 * 60 * 1000 });
    } catch { /* ignore */ }

    // Fallback banner if #toast is not in the DOM yet (early boot / race).
    if (typeof document !== 'undefined' && !document.getElementById('toast')) {
        let el = document.getElementById('nt-force-update-banner');
        if (!el) {
            el = document.createElement('div');
            el.id = 'nt-force-update-banner';
            el.setAttribute('role', 'status');
            el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[10000] max-w-[90vw] px-4 py-3 rounded-xl shadow-2xl bg-red-900/95 text-white text-sm font-bold border border-red-700';
            document.body.appendChild(el);
        }
        el.textContent = msg;
    }
}

async function updateNetworkPreflight() {
    const online = typeof navigator === 'undefined' || navigator.onLine === true;
    if (!online) return false;
    if (typeof window.probeReachability !== 'function') return false;
    let preflight = 'unavailable';
    try {
        preflight = await window.probeReachability(3500);
    } catch {
        preflight = 'unavailable';
    }
    return preflight === 'ok';
}

const OFFLINE_SAVED_TIMES_TOAST = 'You are offline. Using saved times until you reconnect.';
const SLOW_SAVED_TIMES_TOAST = 'Network is slow. Using saved times until you reconnect.';
const SAVED_TIMES_TOAST_COOLDOWN_MS = 10 * 60 * 1000;
let lastSavedTimesToastAt = 0;
let crucialUpdateToastShown = false;
let forcedUpdateAnnounced = false;

function showSavedTimesToast() {
    const now = Date.now();
    if (lastSavedTimesToastAt && now - lastSavedTimesToastAt < SAVED_TIMES_TOAST_COOLDOWN_MS) return;
    lastSavedTimesToastAt = now;
    const online = typeof navigator === 'undefined' || navigator.onLine === true;
    try {
        showToast(online ? SLOW_SAVED_TIMES_TOAST : OFFLINE_SAVED_TIMES_TOAST, 'error', 4000, '', {
            cooldownMs: SAVED_TIMES_TOAST_COOLDOWN_MS,
        });
    } catch { /* ignore */ }
}

/**
 * Precache the incoming worker while the current shell stays in control.
 * Resolves ok:false on timeout / failed install so callers keep the cached app.
 */
export async function installIncomingServiceWorker(timeoutMs = INCOMING_UPDATE_FALLBACK_MS) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return { ok: true, reason: 'no_sw' };
    }
    let reg;
    try {
        reg = await navigator.serviceWorker.getRegistration();
    } catch {
        return { ok: false, reason: 'no_reg' };
    }
    if (!reg) return { ok: true, reason: 'no_reg' };
    if (reg.waiting) return { ok: true, reason: 'waiting' };

    return await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);

        const watch = (worker) => {
            if (!worker) return;
            if (worker.state === 'installed') {
                finish({ ok: true, reason: 'installed' });
                return;
            }
            if (worker.state === 'redundant') {
                finish({ ok: false, reason: 'redundant' });
                return;
            }
            worker.addEventListener('statechange', () => {
                if (worker.state === 'installed') finish({ ok: true, reason: 'installed' });
                else if (worker.state === 'redundant') finish({ ok: false, reason: 'redundant' });
            });
        };

        if (reg.installing) watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));

        Promise.resolve()
            .then(() => reg.update())
            .then(() => new Promise((r) => setTimeout(r, 50)))
            .then(() => {
                if (reg.waiting) finish({ ok: true, reason: 'waiting' });
                else if (reg.installing) watch(reg.installing);
                else finish({ ok: true, reason: 'already_current' });
            })
            .catch(() => {
                if (reg.waiting) finish({ ok: true, reason: 'waiting' });
                else finish({ ok: false, reason: 'update_failed' });
            });
    });
}

/** Drop a stuck controlling worker so the next load can fetch a fresh sw.js. Pins stay. */
export async function unstickStaleServiceWorker() {
    if (typeof window === 'undefined') return false;
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) {
                console.log('🛡️ Guardian: Unsticking stale service worker →', reg.active?.scriptURL || reg.waiting?.scriptURL || '(registration)');
                await reg.unregister();
            }
        }
    } catch (e) {
        console.warn('🛡️ Guardian: Unstick unregister failed', e);
    }
    try {
        if ('caches' in window) {
            const names = await caches.keys();
            await Promise.all(names.map((name) => caches.delete(name)));
            console.log('🛡️ Guardian: Unstick dropped Cache Storage so the next boot cannot mix hashed shells.');
        }
    } catch (e) {
        console.warn('🛡️ Guardian: Unstick cache delete failed', e);
    }
    return true;
}

export async function activateWaitingServiceWorker() {
    if (!('serviceWorker' in navigator)) return true;
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        try { await reg?.update?.(); } catch { /* an already-waiting worker is enough */ }
        const waiting = reg?.waiting;
        if (!waiting) return true;

        const activated = new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
                clearTimeout(timer);
                resolve(value);
            };
            const onControllerChange = () => finish(true);
            const timer = setTimeout(() => finish(false), 8000);
            navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
            waiting.postMessage({ type: 'SKIP_WAITING' });
        });
        return await activated;
    } catch (e) {
        console.warn('SW activate failed during update', e);
        return false;
    }
}

export async function handleUpdateClick(newVersion, options = {}) {
    // Never wipe identity here. Activate a waiting worker when we can, then
    // same-URL reload. Do not write app_installed_version before the new shell
    // is actually running (that was the stored-20.3 / running-20.1 reload loop).
    // Automatic toasts wait until waiting/installed. Never toast dump-ahead.
    if (!await updateNetworkPreflight()) {
        showSavedTimesToast();
        return false;
    }

    const target = normalizeAppVersionId(newVersion) || await peekIncomingVersion() || APP_VERSION;
    const newer = isAppVersionNewer(target, APP_VERSION);
    const cap = readForceCap(target);
    const ignoreCap = options.ignoreCap === true;
    const unstickMode = options.unstick === 'always';
    const originVersion = normalizeAppVersionId(options.originVersion);
    const originNewer = !!(originVersion && isAppVersionNewer(originVersion, APP_VERSION));
    const dumpAhead = options.dumpAhead === true
        || (!!originVersion && isAppVersionNewer(target, originVersion) && !originNewer);

    if (newer) {
        console.log(`🛡️ Guardian: NEW APP VERSION found: ${target} (running ${APP_VERSION}). Not downloaded yet.`);
    } else {
        console.log(`🛡️ Guardian: Update check — running ${APP_VERSION}, published ${target}.`);
    }

    if (!ignoreCap && newer && cap.reloads >= MAX_FORCE_RELOADS_PER_VERSION) {
        console.warn(`🛡️ Guardian: Force-update restart cap (${MAX_FORCE_RELOADS_PER_VERSION}) reached for ${target}. Stopping so this session cannot loop.`);
        return false;
    }

    markPendingReload('version_enforce', 10000);
    const installed = await installIncomingServiceWorker();
    if (!installed.ok) {
        console.warn(`🛡️ Guardian: Incoming version ${target} NOT downloaded (${installed.reason}). Keeping ${APP_VERSION}. Will retry.`);
        return false;
    }
    const downloaded = isIncomingWorkerDownloaded(installed);
    console.log(`🛡️ Guardian: Incoming version ${target} ${downloaded ? 'downloaded' : 'checked'} (${installed.reason}).`);

    if (installed.reason === 'already_current') {
        if (newer && unstickMode) {
            if (!ignoreCap && cap.unsticks >= MAX_UNSTICKS_PER_VERSION) {
                console.warn(`🛡️ Guardian: Service worker still ${APP_VERSION} while published ${target}, but unstick already ran. Not looping.`);
                return false;
            }
            console.warn(`🛡️ Guardian: Service worker still ${APP_VERSION} while published ${target} (cached sw.js). Unsticking: unregister + drop Cache Storage. Pin kept. Restart will fetch the new shell.`);
            await unstickStaleServiceWorker();
            writeForceCap({ version: target, reloads: cap.reloads + 1, unsticks: cap.unsticks + 1 });
            console.log(`🛡️ Guardian: Restarting in this tick to implement ${target}.`);
            reloadToApplyUpdate('version_unstick');
            return true;
        }
        if (!newer) {
            console.log(`🛡️ Guardian: Already on ${APP_VERSION}. No restart.`);
            return false;
        }
        if (originNewer) {
            if (!ignoreCap && cap.unsticks >= MAX_UNSTICKS_PER_VERSION) {
                console.warn(`🛡️ Guardian: Origin ${originVersion} is live but the worker is already_current and unstick already ran. Not looping.`);
                return false;
            }
            console.warn(`🛡️ Guardian: Origin ${originVersion} is live but the worker is already_current (cached sw.js). Unsticking silently so the next boot can download ${originVersion}. No toast until that download finishes.`);
            await unstickStaleServiceWorker();
            writeForceCap({ version: target, reloads: cap.reloads + 1, unsticks: cap.unsticks + 1 });
            reloadToApplyUpdate('version_unstick');
            return true;
        }
        console.log(`🛡️ Guardian: Published ${target} is newer than ${APP_VERSION} but the origin service worker is already_current (dump-ahead of production, or cached sw.js). Auto force-update will not toast or restart until the worker actually installs. Check for Updates and NUKE can unstick.`);
        if (typeof window !== 'undefined' && window.__ntForcedUpdateVersion === target) {
            window.__ntForcedUpdateVersion = null;
        }
        return false;
    }

    if (!downloaded) {
        console.warn(`🛡️ Guardian: Incoming version ${target} NOT downloaded (${installed.reason}). Keeping ${APP_VERSION}. Will retry.`);
        return false;
    }

    if (dumpAhead && !originNewer) {
        console.log(`🛡️ Guardian: Dump ${target} is ahead of origin ${originVersion || 'unknown'}. Waiting worker is not that host shell. No toast. Quiet skipWaiting can still apply a same-generation hash.`);
        if (typeof window !== 'undefined' && window.__ntForcedUpdateVersion === target) {
            window.__ntForcedUpdateVersion = null;
        }
        return false;
    }

    if (shouldToastAutomaticUpdate({
        downloaded,
        newer,
        dumpAhead: dumpAhead && !originNewer,
    }) && options.announce === true) {
        showCrucialUpdateToast(originNewer ? originVersion : target);
        forcedUpdateAnnounced = true;
    }

    if (!await activateWaitingServiceWorker()) {
        console.warn(`🛡️ Guardian: Incoming version ${target} downloaded but skipWaiting did not activate. Keeping ${APP_VERSION}.`);
        return false;
    }

    writeForceCap({ version: target, reloads: cap.reloads + 1, unsticks: cap.unsticks });
    console.log(`🛡️ Guardian: Incoming version ${target} is active. Restarting now to implement it (running was ${APP_VERSION}).`);
    reloadToApplyUpdate('version_enforce');
    return true;
}

const UPDATED_TOAST_KEY = 'nt_show_updated_toast';
const LATEST_TOAST_KEY = 'nt_show_latest_toast';
let forcedUpdatePromise = null;

function scheduleForcedUpdate(version, extras = {}) {
    if (typeof window === 'undefined') return;
    window.__ntForcedUpdateVersion = version;
    window.__ntForcedUpdateOriginVersion = extras.originVersion || null;
    window.__ntForcedUpdateDumpAhead = extras.dumpAhead === true;
    const attempt = () => {
        if (!window.__ntForcedUpdateVersion || forcedUpdatePromise) return;
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        const announce = !forcedUpdateAnnounced && !crucialUpdateToastShown;
        forcedUpdatePromise = handleUpdateClick(window.__ntForcedUpdateVersion, {
            announce,
            unstick: false,
            originVersion: window.__ntForcedUpdateOriginVersion,
            dumpAhead: window.__ntForcedUpdateDumpAhead === true,
        })
            .then((started) => {
                if (started) window.__ntForcedUpdateVersion = null;
            })
            .finally(() => {
                forcedUpdatePromise = null;
            });
    };

    if (!window.__ntForcedUpdateRetryBound) {
        window.__ntForcedUpdateRetryBound = true;
        window.addEventListener('online', attempt);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') attempt();
        });
        setInterval(attempt, 60_000);
    }
    setTimeout(attempt, 1600);
}

async function probeNetworkAndForceUpdate() {
    if (!FORCE_UPDATE_REQUIRED) return;
    const report = await peekIncomingVersionReport();
    const target = pickForceUpdateTarget(report, APP_VERSION);
    if (!target) {
        console.log(`🛡️ Guardian: No newer app version than ${APP_VERSION}. Published ${report.version || 'unknown'}.`);
        return;
    }
    const dumpAhead = isDumpAheadOfOrigin(report, APP_VERSION);
    console.log(`🛡️ Guardian: NEW APP VERSION found: ${target} (running ${APP_VERSION}). Not downloaded yet.${dumpAhead ? ' Dump is ahead of the host — will download if the origin worker actually updates; no toast until then.' : ' Force-update will download, then toast and restart to implement it.'}`);
    scheduleForcedUpdate(target, { originVersion: report.originVersion, dumpAhead });
}

export function markAppUpdatedToast() {
    if (typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.removeItem(LATEST_TOAST_KEY);
        sessionStorage.setItem(UPDATED_TOAST_KEY, APP_VERSION);
    } catch { /* ignore */ }
}

export function markLatestVersionToast() {
    if (typeof sessionStorage === 'undefined') return;
    try {
        sessionStorage.removeItem(UPDATED_TOAST_KEY);
        sessionStorage.setItem(LATEST_TOAST_KEY, APP_VERSION);
    } catch { /* ignore */ }
}

export function maybeShowUpdatedVersionToast() {
    if (typeof sessionStorage === 'undefined') return;
    try {
        if (!sessionStorage.getItem(UPDATED_TOAST_KEY)) return;
        sessionStorage.removeItem(UPDATED_TOAST_KEY);
    } catch {
        return;
    }
    showToast(`App updated to version ${APP_VERSION}`, 'success', 3000);
}

export function maybeShowLatestVersionToast() {
    if (typeof sessionStorage === 'undefined') return;
    try {
        if (!sessionStorage.getItem(LATEST_TOAST_KEY)) return;
        sessionStorage.removeItem(LATEST_TOAST_KEY);
    } catch {
        return;
    }
    showToast(`You’re on the latest version, ${APP_VERSION}.`, 'info', 3000);
}

/** Boot check: record the running shell, then peek the network for a newer ship. */
export function enforceAppVersion() {
    if (typeof window === 'undefined') return;

    maybeShowUpdatedVersionToast();
    maybeShowLatestVersionToast();

    const currentVersion = APP_VERSION || 'unknown';
    const storedVersion = safeStorage.getItem('app_installed_version');

    if (storedVersion && storedVersion !== currentVersion) {
        console.log(`[Guardian] Running shell is ${currentVersion} (was stored ${storedVersion}). Recording this shell — not looping on stored vs running.`);
    }
    safeStorage.setItem('app_installed_version', currentVersion);

    if (FORCE_UPDATE_REQUIRED) {
        probeNetworkAndForceUpdate().catch((e) => {
            console.warn('🛡️ Guardian: Force-update probe failed', e);
        });
    }
}

/**
 * Wire vite-plugin-pwa registerSW callbacks + SPA-style controllerchange guard.
 * @param {(opts: object) => (reloadPage?: boolean) => Promise<void>} registerSW
 */
export function bindAppUpdateLifecycle(registerSW) {
    if (typeof window === 'undefined' || typeof registerSW !== 'function') return;

    // reloadPage:false — skipWaiting only; controllerchange reloads the same URL
    const api = { updateSW: async () => {} };

    api.updateSW = registerSW({
        immediate: true,
        async onNeedRefresh() {
            // New SW is waiting (precached). Same-version hash updates stay quiet.
            // A *newer* APP_VERSION is a force-update: toast only after this
            // download, then restart. path in enforceAppVersion(); it is not how FOUC is fixed.
            const report = await peekIncomingVersionReport();
            const incomingVersion = report.version;
            const downloaded = true;
            const dumpAhead = isDumpAheadOfOrigin(report, APP_VERSION);
            if (incomingVersion && isAppVersionNewer(incomingVersion, APP_VERSION) && FORCE_UPDATE_REQUIRED) {
                if (dumpAhead) {
                    console.log(`🛡️ Guardian: Dump ${incomingVersion} is ahead of origin ${report.originVersion || 'unknown'} (running ${APP_VERSION}). Waiting SW is not that host shell. No toast.`);
                    return;
                }
                console.log(`🛡️ Guardian: NEW APP VERSION found: ${incomingVersion} (running ${APP_VERSION}). Downloaded: yes (waiting SW). Restart will implement it.`);
                scheduleForcedUpdate(incomingVersion, { originVersion: report.originVersion, dumpAhead: false });
                return;
            }
            console.log('GUARDIAN: Incoming update waiting (quiet) →', incomingVersion);
            console.log(`🛡️ Guardian: Incoming SW downloaded: ${downloaded ? 'yes' : 'no'}. Quiet — applies after idle skipWaiting or next launch.`);
        },
        onRegisteredSW(swUrl, registration) {
            console.log(`🛡️ Guardian PWA: Service worker registered at ${swUrl}`);
            if (!registration) return;
            armQuietSkipWaiting(() => registration);
            const checkForWaitingSw = () => {
                if (typeof navigator === 'undefined' || !navigator.onLine) return;
                const update = registration.update();
                const timeout = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('sw_update_timeout')), 4000);
                });
                Promise.race([update, timeout]).catch(() => {});
                if (FORCE_UPDATE_REQUIRED) {
                    peekIncomingVersionReport().then((report) => {
                        const target = pickForceUpdateTarget(report, APP_VERSION);
                        if (!target) return;
                        const dumpAhead = isDumpAheadOfOrigin(report, APP_VERSION);
                        const waiting = !!(registration.waiting || registration.installing);
                        console.log(`🛡️ Guardian: NEW APP VERSION found: ${target} (running ${APP_VERSION}). Downloaded: ${waiting ? 'yes (waiting/installing)' : 'not yet'}.${dumpAhead ? ' Dump is ahead of the host — no toast until the origin worker installs.' : waiting ? ' Restart will implement it.' : ' Downloading, then toast and restart.'}`);
                        scheduleForcedUpdate(target, { originVersion: report.originVersion, dumpAhead });
                    }).catch(() => {});
                }
            };
            setInterval(checkForWaitingSw, 5 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') checkForWaitingSw();
            });
        },
        onRegisterError(error) {
            console.error('🛡️ Guardian PWA: Registration failed', error);
        },
    });

    window.triggerAppUpdate = async function triggerAppUpdate() {
        showToast('Updating...', 'success');
        markPendingReload('sw_user_update', INCOMING_UPDATE_FALLBACK_MS);
        const token = Date.now();
        window.__ntPendingUpdateToken = token;
        try {
            await Promise.race([
                api.updateSW(false),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('incoming_not_ready')), INCOMING_UPDATE_FALLBACK_MS);
                }),
            ]);
        } catch (e) {
            window.__ntPendingUpdateToken = null;
            console.warn('🛡️ Guardian: Manual update not ready in 30s — keeping cached version.', e);
            return;
        }
        setTimeout(() => {
            if (window.__ntPendingUpdateToken === token) {
                window.__ntPendingUpdateToken = null;
                console.warn('🛡️ Guardian: Manual update did not activate in 30s — keeping cached version.');
            }
        }, INCOMING_UPDATE_FALLBACK_MS);
    };

    window.handleUpdateClick = handleUpdateClick;

    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return;

    // A waiting worker can activate in the background; do not skipWaiting on
    // lock-screen / pocket idle — that used to hard-reload into a cold boot.
    let refreshing = false;
    const reloadWhenVisible = () => {
        if (refreshing) return;
        if (!window.__ntPendingUpdateToken) return;
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
            const once = () => {
                if (document.visibilityState !== 'visible') return;
                document.removeEventListener('visibilitychange', once);
                reloadWhenVisible();
            };
            document.addEventListener('visibilitychange', once);
            return;
        }

        let lastReload = null;
        try { lastReload = sessionStorage.getItem('sw_last_reload'); } catch (e) {}
        const now = Date.now();
        if (lastReload && (now - parseInt(lastReload, 10)) < 30000) {
            console.warn('🛡️ Guardian: Suppressed rapid infinite reload (SW loop blocked).');
            return;
        }
        try { sessionStorage.setItem('sw_last_reload', now.toString()); } catch (e) {}

        refreshing = true;
        window.__ntPendingUpdateToken = null;
        reloadToApplyUpdate('sw_controllerchange');
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        if (!window.__ntPendingUpdateToken) {
            console.log('🛡️ Guardian: New SW active — applying on next launch (session kept).');
            return;
        }
        reloadWhenVisible();
    });
}

/**
 * On Astro cutover: drop the old SPA service-worker.js and its Cache Storage
 * buckets (`metrorail-next-train-*`) so they cannot keep serving zombie HTML/JS.
 * Does not touch identity keys in localStorage.
 */
export async function cleanupLegacySpaShell() {
    if (typeof window === 'undefined' || window.__ntSpaCleanupDone) return;
    window.__ntSpaCleanupDone = true;

    try {
        if ('caches' in window) {
            const names = await caches.keys();
            await Promise.all(names.map((name) => {
                if (/metrorail-next-train/i.test(name)) {
                    console.log('🛡️ Guardian: Purging legacy SPA cache →', name);
                    return caches.delete(name);
                }
                return Promise.resolve();
            }));
        }
    } catch (e) {
        console.warn('🛡️ Guardian: Legacy cache purge failed', e);
    }

    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) {
                const script =
                    reg.active?.scriptURL ||
                    reg.waiting?.scriptURL ||
                    reg.installing?.scriptURL ||
                    '';
                if (/service-worker(\.min)?\.js/i.test(script)) {
                    console.log('🛡️ Guardian: Unregistering legacy SPA worker →', script);
                    await reg.unregister();
                }
            }
        }
    } catch (e) {
        console.warn('🛡️ Guardian: Legacy SW unregister failed', e);
    }
}

/** Open a cleartext HTTP URL so captive Wi‑Fi portals can intercept and show login. */
export function openCaptivePortalBrowser() {
    // neverssl.com is intentionally HTTP — HTTPS often bypasses hotel/cafe login pages
    const url = 'http://neverssl.com/';
    try {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch { /* ignore */ }
    try {
        window.open(url, '_blank', 'noopener,noreferrer');
    } catch { /* ignore */ }
}

/**
 * @param {'weak'|'captive'} [mode]
 */
export function initNetworkStruggleModal() {
    if (typeof window === 'undefined' || window.__ntNetworkStruggleBound) return;
    window.__ntNetworkStruggleBound = true;

    const applyStruggleMode = (mode = 'weak') => {
        const modal = document.getElementById('network-struggle-modal');
        if (!modal) return;
        const captive = mode === 'captive';
        modal.dataset.struggleMode = captive ? 'captive' : 'weak';
        const title = document.getElementById('network-struggle-title');
        const body = document.getElementById('network-struggle-body');
        const portalBtn = document.getElementById('network-struggle-open-portal');
        const retryBtn = document.getElementById('network-struggle-retry');
        if (title) {
            title.textContent = captive ? 'Wi‑Fi Sign-In Required' : 'Weak Signal Detected';
        }
        if (body) {
            body.textContent = captive
                ? 'This Wi‑Fi needs you to sign in before the internet works. Open your phone’s browser to complete login, then return here and tap Try Again.'
                : 'Your connection is struggling. We need a few seconds of stable internet to download the timetables so they work offline.';
        }
        if (portalBtn) {
            portalBtn.classList.toggle('hidden', !captive);
            portalBtn.classList.toggle('flex', captive);
        }
        if (retryBtn) {
            retryBtn.textContent = '';
            retryBtn.innerHTML = captive
                ? `<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15"></path></svg>I've signed in - Try Again`
                : `<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15"></path></svg>Try Again`;
        }
    };

    window.openCaptivePortalBrowser = openCaptivePortalBrowser;

    window.triggerNetworkStruggleModal = function triggerNetworkStruggleModal(mode = 'weak') {
        const normalized = mode === 'captive' ? 'captive' : 'weak';
        const modal = document.getElementById('network-struggle-modal');
        if (modal && !modal.classList.contains('hidden') && modal.dataset.struggleMode === normalized) {
            return; // already showing this mode
        }
        // Captive popup: at most once per 45s so guardianFetch HTML traps don't spam
        if (normalized === 'captive') {
            const now = Date.now();
            if (window.__ntCaptiveModalAt && now - window.__ntCaptiveModalAt < 45_000) return;
            window.__ntCaptiveModalAt = now;
        }
        applyStruggleMode(normalized);
        try { triggerHaptic(); } catch (e) {}
        try {
            history.pushState({ modal: 'network-struggle' }, '', '#network-struggle');
        } catch (e) {}
        if (typeof window.openSmoothModal === 'function') {
            window.openSmoothModal('network-struggle-modal');
        } else {
            modal?.classList.remove('hidden');
        }
    };

    document.addEventListener('click', (e) => {
        const portal = e.target.closest?.('#network-struggle-open-portal');
        const retry = e.target.closest?.('#network-struggle-retry');
        const dismiss = e.target.closest?.('#network-struggle-dismiss');
        if (portal) {
            e.preventDefault();
            openCaptivePortalBrowser();
            return;
        }
        if (retry) {
            if (typeof window.closeSmoothModal === 'function') {
                window.closeSmoothModal('network-struggle-modal');
            }
            try { window.resetReachabilityProbe?.(); } catch { /* ignore */ }
            setTimeout(() => {
                if (typeof window.loadAllSchedules === 'function') window.loadAllSchedules(true);
                else window.location.reload();
            }, 350);
        }
        if (dismiss) {
            if (location.hash === '#network-struggle') {
                try { history.back(); } catch (err) {
                    if (typeof window.closeSmoothModal === 'function') {
                        window.closeSmoothModal('network-struggle-modal');
                    }
                }
            } else if (typeof window.closeSmoothModal === 'function') {
                window.closeSmoothModal('network-struggle-modal');
            }
        }
    });
}
