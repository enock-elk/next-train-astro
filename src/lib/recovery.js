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

/** Soft banner — wait so slow 3G boots aren't treated as failures. */
const RECOVERY_BANNER_MS = 20_000;
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

function injectRecoveryBanner(reason) {
    if (typeof document === 'undefined') return;
    if (document.getElementById('nt-recovery-banner')) return;

    const bar = document.createElement('div');
    bar.id = 'nt-recovery-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
        'position:fixed',
        'left:12px',
        'right:12px',
        'bottom:max(16px,env(safe-area-inset-bottom))',
        'z-index:9998',
        'background:#0f172a',
        'color:#f1f5f9',
        'border:1px solid rgba(148,163,184,0.35)',
        'border-radius:14px',
        'padding:12px 14px',
        'box-shadow:0 12px 40px rgba(0,0,0,0.35)',
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
        'display:flex',
        'flex-direction:column',
        'gap:10px',
        'max-width:420px',
        'margin:0 auto',
    ].join(';');

    const online = typeof navigator !== 'undefined' && navigator.onLine;
    const title = online
        ? 'Still having trouble loading Next Train?'
        : 'Connection looks weak — need a hand?';
    const body = online
        ? 'If the app looks blank or stuck after an update, open recovery help to reset the saved copy or contact us.'
        : 'When signal returns, pull to refresh — or open recovery help for reset steps and contact options.';

    bar.innerHTML = `
        <div style="font-size:13px;font-weight:800;letter-spacing:0.01em">${title}</div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.4">${body}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="${helpUrl(reason)}" style="flex:1;min-width:8rem;text-align:center;background:#2563eb;color:#fff;font-weight:700;font-size:12px;padding:10px 12px;border-radius:10px;text-decoration:none">Open recovery help</a>
            <button type="button" id="nt-recovery-dismiss" style="flex:0 0 auto;background:transparent;border:1px solid rgba(148,163,184,0.35);color:#e2e8f0;font-weight:700;font-size:12px;padding:10px 12px;border-radius:10px;cursor:pointer">Dismiss</button>
        </div>
    `;
    document.body.appendChild(bar);
    bar.querySelector('#nt-recovery-dismiss')?.addEventListener('click', () => {
        bar.remove();
        try { sessionStorage.setItem('nt_recovery_banner_dismissed', String(Date.now())); } catch { /* ignore */ }
    });
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

    let dismissed = false;
    try {
        const t = Number(sessionStorage.getItem('nt_recovery_banner_dismissed') || 0);
        if (t && Date.now() - t < 30 * 60 * 1000) dismissed = true;
    } catch { /* ignore */ }

    const tick = (ms, fn) => setTimeout(fn, ms);

    // Soft connectivity hint while OS still says "online"
    tick(SLOW_BOOT_HINT_MS, () => {
        if (window._appStabilized) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        if (typeof window.engageConnectionStruggleUi === 'function') {
            window.engageConnectionStruggleUi('slow_boot');
        }
    });

    tick(RECOVERY_BANNER_MS, () => {
        if (dismissed) return;
        if (window._appStabilized) return;
        const reason = (() => {
            try {
                if (sessionStorage.getItem('error_reloaded') === 'true') return 'crash';
            } catch { /* ignore */ }
            if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
            if (typeof window !== 'undefined' && window.isLieFi) return 'server';
            return 'boot';
        })();
        injectRecoveryBanner(reason);
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
