/**
 * Outage / broken-install recovery helpers.
 * Lifeboat page: public/help.html (self-contained, SW navigate fallback).
 *
 * Auto-redirect only counts time the app is actually on screen. Phone lock /
 * pocket / backgrounded tabs must not be treated as a stuck boot.
 */
import {
    withBase,
    SUPPORT_EMAIL,
    SUPPORT_WHATSAPP,
    SUPPORT_WHATSAPP_DISPLAY,
} from './config.js';

export { SUPPORT_EMAIL, SUPPORT_WHATSAPP, SUPPORT_WHATSAPP_DISPLAY };

/** Auto lifeboat — only with dual signal (overlay still up + visible time). */
const RECOVERY_AUTO_REDIRECT_MS = 55_000;
/** Soft “connection struggling” strip while still “online” but not stabilized. */
const SLOW_BOOT_HINT_MS = 18_000;

/** @param {string} [reason] */
export function helpUrl(reason = 'broken_install') {
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return `${withBase('help.html')}${q}`;
}

/** @param {string} [reason] */
export function openRecoveryHelp(reason = 'broken_install') {
    if (typeof window === 'undefined') return;
    try {
        window.location.href = helpUrl(reason);
    } catch {
        /* ignore */
    }
}

export function whatsappSupportUrl(prefill = '') {
    const base = `https://wa.me/${SUPPORT_WHATSAPP}`;
    if (!prefill) return base;
    return `${base}?text=${encodeURIComponent(prefill)}`;
}

export function mailtoSupportUrl(subject = 'Next Train help', body = '') {
    let href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    if (body) href += `&body=${encodeURIComponent(body)}`;
    return href;
}

/**
 * Persist last crash for the lifeboat form diagnostics.
 * @param {unknown} details
 */
export function stashLastCrash(details) {
    try {
        sessionStorage.setItem('nt_last_crash', typeof details === 'string' ? details : JSON.stringify(details));
    } catch {
        /* ignore */
    }
}

function isForeground() {
    return typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function ensureLoaderEscape() {
    if (typeof document === 'undefined') return;
    const overlay = document.getElementById('loading-overlay');
    if (!overlay || overlay.querySelector('[data-nt-help-escape]')) return;

    const link = document.createElement('a');
    link.setAttribute('data-nt-help-escape', '1');
    link.href = helpUrl('boot');
    link.textContent = 'App stuck? Get help';
    link.style.cssText = [
        'position:absolute',
        'bottom:max(24px,var(--nt-sys-bottom,env(safe-area-inset-bottom)))',
        'left:50%',
        'transform:translateX(-50%)',
        'font-size:12px',
        'font-weight:700',
        'color:#64748b',
        'text-decoration:underline',
        'z-index:2',
        'padding:8px 12px',
    ].join(';');
    if (getComputedStyle(overlay).position === 'static') {
        overlay.style.position = 'fixed';
    }
    overlay.appendChild(link);
}

/** True while the boot logo is still covering the board. */
function overlayStillBlocking() {
    if (typeof document === 'undefined') return false;
    if (document.documentElement.classList.contains('nt-shell-ready')) return false;
    const overlay = document.getElementById('loading-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return false;
    try {
        const style = window.getComputedStyle(overlay);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
            return false;
        }
    } catch { /* ignore */ }
    return true;
}

function coreUiIsUsable() {
    if (typeof document === 'undefined') return false;
    if (document.documentElement.classList.contains('nt-onboarding')) return true;
    const welcome = document.getElementById('welcome-modal');
    if (welcome && !welcome.classList.contains('hidden')) return true;
    const routeModal = document.getElementById('route-modal');
    if (routeModal && !routeModal.classList.contains('hidden')) return true;
    const views = ['view-next-train', 'view-trip-planner', 'view-map', 'view-community'];
    if (views.some((id) => document.getElementById(id)?.classList.contains('active'))) return true;
    const header = document.getElementById('app-header');
    const main = document.getElementById('main-content');
    if (document.documentElement.classList.contains('nt-shell-ready') && header && main) return true;
    return false;
}

/**
 * Dual signal for a truly broken shell — chrome missing, not “wrong tab”.
 * Planner / Map / Community hide #view-next-train; that is not a crash.
 */
function shellLooksBroken() {
    if (typeof document === 'undefined') return true;
    if (!isForeground()) return false;
    if (!overlayStillBlocking()) return false;
    const main = document.getElementById('main-content');
    const header = document.getElementById('app-header');
    if (!main || !header) return true;
    if (coreUiIsUsable()) return false;
    return true;
}

/**
 * Run `fn` after `ms` of *visible* time. Hidden / lock-screen time is ignored,
 * and overdue timers from a pocket-lock do not fire on unlock.
 */
function onVisibleElapsed(ms, fn) {
    if (typeof document === 'undefined') return;
    let elapsed = 0;
    let last = Date.now();
    let timer = null;
    let done = false;

    const clear = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const arm = () => {
        clear();
        if (done) return;
        if (!isForeground()) {
            last = Date.now();
            return;
        }
        last = Date.now();
        const remaining = Math.max(0, ms - elapsed);
        timer = setTimeout(() => {
            if (done) return;
            if (!isForeground()) {
                last = Date.now();
                return;
            }
            elapsed += Date.now() - last;
            last = Date.now();
            if (elapsed >= ms) {
                done = true;
                clear();
                fn();
                return;
            }
            arm();
        }, remaining);
    };

    document.addEventListener('visibilitychange', () => {
        if (done) return;
        if (!isForeground()) {
            clear();
            last = Date.now();
            return;
        }
        last = Date.now();
        arm();
    });

    if (isForeground()) arm();
}

/**
 * Boot watchdog + loader escape hatch.
 * Manual escape is immediate; auto-lifeboat only if the logo overlay is still
 * covering a broken shell after 55s of on-screen time.
 */
export function initRecoveryWatchdog() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.__ntRecoveryWatchdogBound) return;
    window.__ntRecoveryWatchdogBound = true;

    window.openRecoveryHelp = openRecoveryHelp;
    window.ntHelpUrl = helpUrl;

    ensureLoaderEscape();
    setTimeout(ensureLoaderEscape, 500);
    // Remove any leftover soft banner from older builds
    try { document.getElementById('nt-recovery-banner')?.remove(); } catch { /* ignore */ }

    onVisibleElapsed(SLOW_BOOT_HINT_MS, () => {
        if (window._appStabilized) return;
        if (!overlayStillBlocking()) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        if (typeof window.engageConnectionStruggleUi === 'function') {
            window.engageConnectionStruggleUi('slow_boot');
        }
    });

    onVisibleElapsed(RECOVERY_AUTO_REDIRECT_MS, () => {
        if (window._appStabilized) return;
        if (!overlayStillBlocking()) return;
        if (!shellLooksBroken()) return;
        try {
            if (sessionStorage.getItem('nt_lifeboat_auto') === '1') return;
            sessionStorage.setItem('nt_lifeboat_auto', '1');
        } catch { /* ignore */ }
        openRecoveryHelp('boot');
    });
}
