/**
 * Force-update / SW refresh path (SPA enforceAppVersion + handleUpdateFound parity).
 * Uses vite-plugin-pwa's registerSW while preserving cache-bust redirects and
 * session-stability marks so CleverAds are not injected into a dying page.
 */
import { APP_VERSION, FORCE_UPDATE_REQUIRED, withBase } from './config.js';
import { safeStorage } from './utils.js';
import { showToast, triggerHaptic } from './ui.js';
import { markPendingReload } from './session-stability.js';

function hardReloadWithCacheBust(reason = 'force_update') {
    markPendingReload(reason, 800);
    const path = window.location.pathname || withBase('/');
    window.location.href = path + '?v=' + Date.now();
}

async function peekIncomingVersion() {
    let incoming = String(APP_VERSION || 'Latest').split(' - ')[0];
    try {
        const res = await fetch(withBase('app-version.json') + '?v=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            if (data && data.version) incoming = String(data.version).split(' - ')[0];
        }
    } catch (e) {
        console.warn('🛡️ Guardian: Failed to peek at incoming update version.', e);
    }
    return incoming;
}

export async function handleUpdateClick(newVersion) {
    // Defer ads immediately — cache wipe can take hundreds of ms before navigation
    markPendingReload('version_enforce', 5000);
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }
        }
        if ('caches' in window) {
            const names = await caches.keys();
            for (const name of names) {
                await caches.delete(name);
            }
        }
    } catch (e) {
        console.warn('Cache clear failed during update', e);
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
            handleUpdateClick(currentVersion);
            return;
        }

        const toast = document.createElement('div');
        toast.id = 'update-toast';
        toast.className = 'fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center space-x-4 z-[100] cursor-pointer hover:scale-105 transition-transform w-[90%] max-w-sm';
        toast.innerHTML = `
            <div class="bg-white/20 rounded-full p-2 animate-pulse">
                <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m-15.357-2a8.001 8.001 0 0015.357 2m0 0H15"></path></svg>
            </div>
            <div class="flex flex-col">
                <span class="text-base font-bold">New Features Ready</span>
                <span class="text-xs text-blue-100">Tap here to finish updating to ${currentVersion}.</span>
            </div>`;
        toast.addEventListener('click', () => handleUpdateClick(currentVersion));
        document.body.appendChild(toast);
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
            const incomingVersion = await peekIncomingVersion();

            if (FORCE_UPDATE_REQUIRED) {
                console.log('GUARDIAN: Force Update Triggered.');
                showToast(`Crucial system update incoming: ${incomingVersion}.`, 'error', 5000);
                markPendingReload('sw_force_update', 2500);
                const token = Date.now();
                window.__ntPendingUpdateToken = token;
                try {
                    await api.updateSW(false);
                } catch (e) {
                    hardReloadWithCacheBust('sw_force_fallback');
                    return;
                }
                // Fallback if controllerchange never fires
                setTimeout(() => {
                    if (window.__ntPendingUpdateToken === token) {
                        hardReloadWithCacheBust('sw_force_timeout');
                    }
                }, 2800);
                return;
            }

            console.log('GUARDIAN: Silent Update Available.');
            const actionHTML = `
                <button type="button" id="nt-trigger-app-update" class="bg-white/20 hover:bg-white/40 text-white px-3 py-1 rounded text-xs font-bold transition-colors">
                    UPDATE
                </button>`;
            showToast(`New version (${incomingVersion}) available.`, 'info', 10000, actionHTML);
            setTimeout(() => {
                document.getElementById('nt-trigger-app-update')?.addEventListener('click', () => {
                    window.triggerAppUpdate?.();
                });
            }, 0);
        },
        onRegisteredSW(swUrl) {
            console.log(`🛡️ Guardian PWA: Service worker registered at ${swUrl}`);
        },
        onRegisterError(error) {
            console.error('🛡️ Guardian PWA: Registration failed', error);
        },
    });

    window.triggerAppUpdate = async function triggerAppUpdate() {
        showToast('Updating...', 'success');
        markPendingReload('sw_user_update', 2500);
        const token = Date.now();
        window.__ntPendingUpdateToken = token;
        try {
            await api.updateSW(false);
        } catch (e) {
            hardReloadWithCacheBust('sw_user_fallback');
            return;
        }
        setTimeout(() => {
            if (window.__ntPendingUpdateToken === token) {
                hardReloadWithCacheBust('sw_user_timeout');
            }
        }, 2800);
    };

    window.handleUpdateClick = handleUpdateClick;

    if (!('serviceWorker' in navigator)) return;

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;

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

export function initNetworkStruggleModal() {
    if (typeof window === 'undefined' || window.__ntNetworkStruggleBound) return;
    window.__ntNetworkStruggleBound = true;

    window.triggerNetworkStruggleModal = function triggerNetworkStruggleModal() {
        try { triggerHaptic(); } catch (e) {}
        try {
            history.pushState({ modal: 'network-struggle' }, '', '#network-struggle');
        } catch (e) {}
        if (typeof window.openSmoothModal === 'function') {
            window.openSmoothModal('network-struggle-modal');
        } else {
            document.getElementById('network-struggle-modal')?.classList.remove('hidden');
        }
    };

    document.addEventListener('click', (e) => {
        const retry = e.target.closest?.('#network-struggle-retry');
        const dismiss = e.target.closest?.('#network-struggle-dismiss');
        if (retry) {
            if (typeof window.closeSmoothModal === 'function') {
                window.closeSmoothModal('network-struggle-modal');
            }
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
