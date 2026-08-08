/**
 * Outage / broken-install recovery helpers.
 * Lifeboat page: public/help.html (self-contained, SW navigate fallback).
 */
import {
    withBase,
    SUPPORT_EMAIL,
    SUPPORT_WHATSAPP,
    SUPPORT_WHATSAPP_DISPLAY,
} from './config.js';

export { SUPPORT_EMAIL, SUPPORT_WHATSAPP, SUPPORT_WHATSAPP_DISPLAY };

/** Auto lifeboat — only with dual signal (not stabilized + broken shell). */
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
        'bottom:max(24px,env(safe-area-inset-bottom))',
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

function shellLooksBroken() {
    if (typeof document === 'undefined') return true;
    const main = document.getElementById('main-content');
    const shellReady = document.documentElement.classList.contains('nt-shell-ready');
    const header = document.getElementById('app-header');
    const board = document.getElementById('view-next-train');
    const tabs = document.getElementById('app-top-tabs');
    if (!shellReady || !main || !header) return true;
    // Dual signal: chrome exists but primary board never painted
    if (!board || !tabs) return true;
    try {
        const style = window.getComputedStyle(board);
        if (style.display === 'none' && !board.classList.contains('active')) return true;
    } catch { /* ignore */ }
    return false;
}

/**
 * Boot watchdog + loader escape hatch.
 * Manual escape is immediate; soft banner / auto-lifeboat are delayed so slow
 * but working connections are not treated as crashes.
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

    const tick = (ms, fn) => setTimeout(fn, ms);

    // Soft connectivity hint while OS still says "online"
    tick(SLOW_BOOT_HINT_MS, () => {
        if (window._appStabilized) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        if (typeof window.engageConnectionStruggleUi === 'function') {
            window.engageConnectionStruggleUi('slow_boot');
        }
    });

    tick(RECOVERY_AUTO_REDIRECT_MS, () => {
        if (window._appStabilized) return;
        // Dual signal: still not stabilized AND shell looks broken
        if (!shellLooksBroken()) return;
        try {
            if (sessionStorage.getItem('nt_lifeboat_auto') === '1') return;
            sessionStorage.setItem('nt_lifeboat_auto', '1');
        } catch { /* ignore */ }
        openRecoveryHelp('boot');
    });
}
