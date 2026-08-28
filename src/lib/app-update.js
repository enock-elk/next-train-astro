/**
 * Force-update / SW refresh path (SPA enforceAppVersion + handleUpdateFound parity).
 * Uses vite-plugin-pwa's registerSW while preserving cache-bust redirects and
 * session-stability marks so CleverAds are not injected into a dying page.
 */
import { APP_VERSION, FORCE_UPDATE_REQUIRED, withBase } from './config.js';
import { safeStorage } from './utils.js';
import { showToast, triggerHaptic } from './ui.js';
import { markPendingReload } from './session-stability.js';

/** If the incoming SW is not fully installed by then, keep the cached shell. */
const INCOMING_UPDATE_FALLBACK_MS = 30000;

function hardReloadWithCacheBust(reason = 'force_update') {
    markPendingReload(reason, 800);
    const path = window.location.pathname || withBase('/');
    window.location.href = path + '?v=' + Date.now();
}

/**
 * Incoming = version on the CDN (`app-version.json`), not the shell currently running.
 * SPA legacy parity: toast must name the build users are about to receive.
 */
async function peekIncomingVersion() {
    try {
        const res = await fetch(withBase('app-version.json') + '?v=' + Date.now(), {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.version) return String(data.version).split(' - ')[0];
        }
    } catch (e) {
        console.warn('🛡️ Guardian: Failed to peek at incoming update version.', e);
    }
    // Last resort only — prefer blank over lying that "incoming" equals this shell.
    return String(APP_VERSION || 'Latest').split(' - ')[0];
}

/** Visible force-update toast (SPA parity) — always names the *incoming* version. */
function showCrucialUpdateToast(incomingVersion) {
    const label = incomingVersion || 'Latest';
    const msg = `Crucial system update incoming: ${label}.`;
    try {
        showToast(msg, 'error', 5000);
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

export async function handleUpdateClick(newVersion) {
    // Never wipe Cache Storage / unregister the SW here. That left returning
    // commuters with no shell if the reload raced a lock-screen or drop.
    // Activate a waiting worker when we can, then cache-bust navigate.
    markPendingReload('version_enforce', 5000);
    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (!online) {
        try {
            showToast('You are offline. Using saved times until you reconnect.', 'error', 4000);
        } catch { /* ignore */ }
        return;
    }
    try {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg?.waiting) {
                window.__ntPendingUpdateToken = Date.now();
                reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
        }
    } catch (e) {
        console.warn('SW activate failed during update', e);
    }

    safeStorage.setItem('app_installed_version', newVersion || APP_VERSION);
    hardReloadWithCacheBust('version_enforce');
}

/** Boot check: stored shell version vs bundled APP_VERSION. */
export function enforceAppVersion() {
    if (typeof window === 'undefined') return;

    const currentVersion = APP_VERSION || 'unknown';
    const storedVersion = safeStorage.getItem('app_installed_version');

    if (storedVersion && storedVersion !== currentVersion) {
        console.log(`[Guardian] Version Upgrade Available: ${storedVersion} -> ${currentVersion}`);

        if (FORCE_UPDATE_REQUIRED) {
            showCrucialUpdateToast(currentVersion);
            setTimeout(() => handleUpdateClick(currentVersion), 1600);
            return;
        }

        // New shell is already running — record it. Do not prompt or reload.
        safeStorage.setItem('app_installed_version', currentVersion);
        return;
    }

    if (!storedVersion) safeStorage.setItem('app_installed_version', currentVersion);
}

/**
 * Wire vite-plugin-pwa registerSW callbacks + SPA-style controllerchange guard.
 * @param {(opts: object) => (reloadPage?: boolean) => Promise<void>} registerSW
 */
export function bindAppUpdateLifecycle(registerSW) {
    if (typeof window === 'undefined' || typeof registerSW !== 'function') return;

    // reloadPage:false — skipWaiting only; controllerchange does SPA-style ?v= hard reload
    const api = { updateSW: async () => {} };

    api.updateSW = registerSW({
        immediate: true,
        async onNeedRefresh() {
            // New SW is waiting (precached). Toast the incoming version, then
            // skipWaiting. Do not wipe caches. If it does not take over in 30s,
            // keep the cached shell — never hard-reload a half-downloaded build.
            const incomingVersion = await peekIncomingVersion();
            console.log('GUARDIAN: Incoming update waiting →', incomingVersion);
            showCrucialUpdateToast(incomingVersion);

            const token = Date.now();
            window.__ntPendingUpdateToken = token;
            markPendingReload('sw_incoming_ready', INCOMING_UPDATE_FALLBACK_MS);
            try {
                await Promise.race([
                    api.updateSW(false),
                    new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('incoming_not_ready')), INCOMING_UPDATE_FALLBACK_MS);
                    }),
                ]);
            } catch (e) {
                window.__ntPendingUpdateToken = null;
                console.warn('🛡️ Guardian: Incoming update not ready in 30s — keeping cached version.', e);
                return;
            }
            setTimeout(() => {
                if (window.__ntPendingUpdateToken === token) {
                    window.__ntPendingUpdateToken = null;
                    console.warn('🛡️ Guardian: Incoming SW did not activate in 30s — keeping cached version.');
                }
            }, INCOMING_UPDATE_FALLBACK_MS);
        },
        onRegisteredSW(swUrl, registration) {
            console.log(`🛡️ Guardian PWA: Service worker registered at ${swUrl}`);
            if (!registration) return;
            const checkForWaitingSw = () => {
                if (typeof navigator === 'undefined' || !navigator.onLine) return;
                const update = registration.update();
                const timeout = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('sw_update_timeout')), 4000);
                });
                Promise.race([update, timeout]).catch(() => {});
            };
            setInterval(checkForWaitingSw, 60 * 60 * 1000);
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
        hardReloadWithCacheBust('sw_controllerchange');
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
                ? `<svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15"></path></svg>I've signed in — Try Again`
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
