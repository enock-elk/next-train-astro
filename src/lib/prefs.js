/**
 * App preferences (localStorage) — Settings, dual nav, appearance packs
 */
import { safeStorage } from './utils.js';

export const NAV_STYLE_KEY = 'navStyle';
export const COLOUR_PACK_KEY = 'colourPack';
export const NOTIFY_PREF_KEY = 'notifyRoomActivity';

export const NAV_STYLES = {
    TOP: 'top',
    BOTTOM: 'bottom',
};

/** @typedef {'classic' | 'midnight' | 'contrast' | 'signal' | 'ember'} ColourPackId */

export const COLOUR_PACKS = {
    CLASSIC: 'classic',
    MIDNIGHT: 'midnight',
    CONTRAST: 'contrast',
    SIGNAL: 'signal',
    EMBER: 'ember',
};

export const COLOUR_PACK_LABELS = {
    classic: 'Classic',
    midnight: 'Midnight',
    contrast: 'High contrast',
    signal: 'Signal',
    ember: 'Ember',
};

const VALID_PACKS = new Set(Object.values(COLOUR_PACKS));

export function getNavStyle() {
    const v = safeStorage.getItem(NAV_STYLE_KEY);
    return v === NAV_STYLES.BOTTOM ? NAV_STYLES.BOTTOM : NAV_STYLES.TOP;
}

export function setNavStyle(style) {
    const next = style === NAV_STYLES.BOTTOM ? NAV_STYLES.BOTTOM : NAV_STYLES.TOP;
    safeStorage.setItem(NAV_STYLE_KEY, next);
    applyNavChrome(next);
    return next;
}

export function getColourPack() {
    const v = safeStorage.getItem(COLOUR_PACK_KEY);
    return VALID_PACKS.has(v) ? v : COLOUR_PACKS.CLASSIC;
}

function syncThemeColorMeta() {
    if (typeof document === 'undefined') return;
    const meta = document.querySelector('meta[name="theme-color"]');
    const color = getComputedStyle(document.documentElement)
        .getPropertyValue('--nt-theme-meta')
        .trim() || '#1d4ed8';
    if (meta) meta.setAttribute('content', color);
}

export function syncColourPackUi(pack = getColourPack()) {
    if (typeof document === 'undefined') return;
    const label = COLOUR_PACK_LABELS[pack] || COLOUR_PACK_LABELS.classic;
    const disp = document.getElementById('settings-colour-pack-display');
    if (disp) disp.textContent = label;

    document.querySelectorAll('[data-colour-pack-option]').forEach((btn) => {
        const opt = btn.getAttribute('data-colour-pack-option');
        const active = opt === pack;
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.classList.toggle('is-selected', active);
    });
}

export function setColourPack(pack) {
    const next = VALID_PACKS.has(pack) ? pack : COLOUR_PACKS.CLASSIC;
    safeStorage.setItem(COLOUR_PACK_KEY, next);
    if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-colour-pack', next);
        requestAnimationFrame(() => syncThemeColorMeta());
        syncColourPackUi(next);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('colourpackchange', { detail: { pack: next } }));
        }
    }
    return next;
}

/**
 * Event-delegation binder so Colour Pack clicks always work
 * (survives Astro module order / partial re-inits).
 */
export function bindColourPackControls() {
    if (typeof document === 'undefined') return;
    if (window.__ntColourPackBound) {
        syncColourPackUi(getColourPack());
        return;
    }
    window.__ntColourPackBound = true;

    const onPick = (e) => {
        const btn = e.target?.closest?.('[data-colour-pack-option]');
        if (!btn) return;
        // Ignore if control lives outside Settings
        if (!btn.closest('#sidenav') && !btn.closest('#colour-pack-picker')) return;
        e.preventDefault();
        e.stopPropagation();
        const pack = btn.getAttribute('data-colour-pack-option');
        if (!pack || !VALID_PACKS.has(pack)) return;
        const prev = getColourPack();
        setColourPack(pack);
        if (typeof window.triggerHaptic === 'function') window.triggerHaptic();
        if (pack !== prev && typeof window.showToast === 'function') {
            window.showToast(`${COLOUR_PACK_LABELS[pack] || 'Classic'} look applied`);
        }
    };

    document.addEventListener('click', onPick, true);
    syncColourPackUi(getColourPack());
}

export function hydratePrefs() {
    applyNavChrome(getNavStyle());
    setColourPack(getColourPack());
    applyReturningUserChrome();
    bindColourPackControls();
    syncNotifyUi();
}

/** Phase 8 — preference stub for room / delay push (FCM later) */
export function getNotifyPref() {
    return safeStorage.getItem(NOTIFY_PREF_KEY) === 'true';
}

export function syncNotifyUi(enabled = getNotifyPref()) {
    if (typeof document === 'undefined') return;
    const cb = document.getElementById('settings-notify-checkbox');
    if (cb) cb.checked = !!enabled;
    const hint = document.getElementById('settings-notify-hint');
    if (hint) {
        if (!('Notification' in window)) {
            hint.textContent = 'Not supported on this device';
        } else if (Notification.permission === 'denied') {
            hint.textContent = 'Blocked in browser settings';
        } else if (enabled && Notification.permission === 'granted') {
            hint.textContent = 'On — push delivery coming soon';
        } else {
            hint.textContent = 'Room activity & delay confirms (soon)';
        }
    }
}

export async function setNotifyPref(wantOn) {
    if (!wantOn) {
        safeStorage.setItem(NOTIFY_PREF_KEY, 'false');
        syncNotifyUi(false);
        return false;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
        safeStorage.setItem(NOTIFY_PREF_KEY, 'false');
        syncNotifyUi(false);
        return false;
    }
    let perm = Notification.permission;
    if (perm === 'default') {
        try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; }
    }
    const ok = perm === 'granted';
    safeStorage.setItem(NOTIFY_PREF_KEY, ok ? 'true' : 'false');
    syncNotifyUi(ok);
    if (ok && typeof window.showToast === 'function') {
        window.showToast('Notifications enabled — delivery wiring comes next', 'success');
    } else if (!ok && typeof window.showToast === 'function') {
        window.showToast('Permission needed for notifications', 'error');
    }
    return ok;
}

/**
 * Apply top vs bottom navigation chrome.
 * Bottom: Home · Plan · Community · More.
 * Top tabs are hidden in bottom mode to reclaim vertical space.
 */
export function applyNavChrome(style = getNavStyle()) {
    if (typeof document === 'undefined') return;
    const isBottom = style === NAV_STYLES.BOTTOM;
    document.documentElement.setAttribute('data-nav-style', style);
    document.body?.classList.toggle('nav-bottom', isBottom);
    document.body?.classList.toggle('nav-top', !isBottom);

    const topTabs = document.getElementById('app-top-tabs');
    const bottomNav = document.getElementById('bottom-nav');
    if (topTabs) {
        topTabs.classList.toggle('hidden', isBottom);
        topTabs.setAttribute('aria-hidden', isBottom ? 'true' : 'false');
    }
    if (bottomNav) {
        bottomNav.classList.toggle('hidden', !isBottom);
        bottomNav.setAttribute('aria-hidden', isBottom ? 'false' : 'true');
    }

    document.querySelectorAll('[data-nav-style-option]').forEach((btn) => {
        const opt = btn.getAttribute('data-nav-style-option');
        const active = opt === style;
        btn.classList.toggle('bg-blue-600', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('shadow-sm', active);
        btn.classList.toggle('bg-gray-100', !active);
        btn.classList.toggle('dark:bg-gray-800', !active);
        btn.classList.toggle('text-gray-700', !active);
        btn.classList.toggle('dark:text-gray-300', !active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const tab = safeStorage.getItem('activeTab') || 'next-train';
    if (typeof window !== 'undefined' && typeof window.syncBottomNavActive === 'function') {
        window.syncBottomNavActive(tab);
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('navstylechange', { detail: { style } }));
    }
}

/** Denser home chrome for returning (onboarded) users. */
export function applyReturningUserChrome() {
    if (typeof document === 'undefined') return;
    const seen = safeStorage.getItem('welcomeSeen') === 'true';
    document.body?.classList.toggle('chrome-compact', seen);
    const main = document.getElementById('main-content');
    main?.classList.toggle('chrome-compact', seen);
}
