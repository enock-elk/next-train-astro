/**
 * Operator chrome (Map / Community tabs, Account, Notifications).
 * Hidden in HTML by default — reveal only after allowlisted admin auth.
 * Never use five-tap unlock or the admin-ready / admin-session-active flags as the gate.
 */
import { safeStorage } from './utils.js';

export function isAdminAuthed() {
    return typeof window !== 'undefined' && window.__ntAdminAuthed === true;
}

export function applyAdminAuthedChrome(authed) {
    const on = !!authed;
    if (typeof window !== 'undefined') window.__ntAdminAuthed = on;
    if (typeof document === 'undefined') return;

    document.documentElement.setAttribute('data-admin-authed', on ? '1' : '0');

    document.querySelectorAll('[data-admin-authed-only]').forEach((el) => {
        if (on) {
            el.hidden = false;
            el.removeAttribute('hidden');
            el.classList.remove('hidden');
            el.removeAttribute('inert');
            el.setAttribute('aria-hidden', 'false');
        } else {
            el.hidden = true;
            el.setAttribute('hidden', '');
            el.classList.add('hidden');
            el.setAttribute('inert', '');
            el.setAttribute('aria-hidden', 'true');
        }
    });

    if (!on) {
        const tab = safeStorage.getItem('activeTab');
        if (tab === 'community' || tab === 'map') {
            if (typeof window.switchTab === 'function') window.switchTab('next-train');
            else safeStorage.setItem('activeTab', 'next-train');
        }
    }

    if (typeof window.syncBottomNavActive === 'function') {
        window.syncBottomNavActive(safeStorage.getItem('activeTab') || 'next-train');
    }
}

if (typeof window !== 'undefined') {
    window.isAdminAuthed = isAdminAuthed;
    window.applyAdminAuthedChrome = applyAdminAuthedChrome;
}
