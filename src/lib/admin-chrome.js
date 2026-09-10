/**
 * Operator chrome (Map / Community tabs, Account, Notifications).
 * Hidden in HTML by default — reveal after allowlisted admin auth, or for
 * commuters whose pinned route is on an experimental map/community allow-list.
 * Never use five-tap unlock or the admin-ready / admin-session-active flags as the gate.
 */
import { safeStorage } from './utils.js';
import { $currentRouteId } from '../store.js';
import { FEATURE_KEYS, isFeatureEnabled, isFeatureGranted } from './features.js';

const PIN_REGIONS = ['GP', 'WC', 'KZN', 'EC'];

export function isAdminAuthed() {
    return typeof window !== 'undefined' && window.__ntAdminAuthed === true;
}

/** Pins are defaultRoute_{region}, not the corridor currently on the board. */
export function getPinnedRouteIds() {
    const ids = [];
    try {
        for (const region of PIN_REGIONS) {
            const id = safeStorage.getItem('defaultRoute_' + region);
            if (id) ids.push(String(id));
        }
        const legacy = safeStorage.getItem('defaultRoute');
        if (legacy && !ids.includes(String(legacy))) ids.push(String(legacy));
    } catch { /* ignore */ }
    return ids;
}

function setReveal(el, on) {
    if (!el) return;
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
}

/** Pin-gated testers: Map / Community / Account follow pinned routes, not the viewed corridor. */
export function canAccessPilotSurface(surface, routeId = '') {
    if (isAdminAuthed()) return true;
    if (surface === 'map' && isFeatureGranted(FEATURE_KEYS.MAP_TAB)) return true;
    if (surface === 'community' && isFeatureGranted(FEATURE_KEYS.COMMUNITY_TAB)) return true;
    if (surface === 'account' && (
        isFeatureGranted(FEATURE_KEYS.MAP_TAB)
        || isFeatureGranted(FEATURE_KEYS.COMMUNITY_TAB)
        || isFeatureGranted(FEATURE_KEYS.RIDE_CHECKIN)
    )) return true;
    const pins = routeId ? [String(routeId)] : getPinnedRouteIds();
    if (!pins.length) return false;
    const hit = (key) => pins.some((id) => isFeatureEnabled(key, id));
    if (surface === 'map') return hit(FEATURE_KEYS.MAP_TAB);
    if (surface === 'community') return hit(FEATURE_KEYS.COMMUNITY_TAB);
    if (surface === 'account') {
        return hit(FEATURE_KEYS.MAP_TAB) || hit(FEATURE_KEYS.COMMUNITY_TAB);
    }
    return false;
}

export function applyPilotChrome() {
    if (typeof document === 'undefined') return;
    const mapOn = canAccessPilotSurface('map');
    const communityOn = canAccessPilotSurface('community');
    const accountOn = canAccessPilotSurface('account');

    if (!isAdminAuthed()) {
        setReveal(document.getElementById('bottom-nav-map'), mapOn);
        setReveal(document.getElementById('bottom-nav-community'), communityOn);
        setReveal(document.getElementById('settings-account-btn'), accountOn);
    }

    const html = document.documentElement;
    html.setAttribute('data-pilot-map', !isAdminAuthed() && mapOn ? '1' : '0');
    html.setAttribute('data-pilot-community', !isAdminAuthed() && communityOn ? '1' : '0');

    const tab = safeStorage.getItem('activeTab');
    if (!isAdminAuthed() && ((tab === 'map' && !mapOn) || (tab === 'community' && !communityOn))) {
        if (typeof window.switchTab === 'function') window.switchTab('next-train');
        else safeStorage.setItem('activeTab', 'next-train');
    }

    if (typeof window.syncBottomNavActive === 'function') {
        window.syncBottomNavActive(safeStorage.getItem('activeTab') || 'next-train');
    }
}

export function applyAdminAuthedChrome(authed) {
    const on = !!authed;
    if (typeof window !== 'undefined') window.__ntAdminAuthed = on;
    if (typeof document === 'undefined') return;

    document.documentElement.setAttribute('data-admin-authed', on ? '1' : '0');

    document.querySelectorAll('[data-admin-authed-only]').forEach((el) => {
        setReveal(el, on);
    });

    applyPilotChrome();

    if (typeof window.renderRideSeenChip === 'function') {
        window.renderRideSeenChip();
    }
}

function bindPilotChromeListeners() {
    if (typeof window === 'undefined' || window.__ntPilotChromeBound) return;
    window.__ntPilotChromeBound = true;
    window.addEventListener('nt-features-updated', () => {
        try { applyPilotChrome(); } catch { /* ignore */ }
    });
    window.addEventListener('storage', (e) => {
        if (!e?.key || !String(e.key).startsWith('defaultRoute')) return;
        try { applyPilotChrome(); } catch { /* ignore */ }
    });
    if (typeof $currentRouteId?.subscribe === 'function') {
        $currentRouteId.subscribe(() => {
            try { applyPilotChrome(); } catch { /* ignore */ }
        });
    }
}

if (typeof window !== 'undefined') {
    window.isAdminAuthed = isAdminAuthed;
    window.applyAdminAuthedChrome = applyAdminAuthedChrome;
    window.applyPilotChrome = applyPilotChrome;
    window.canAccessPilotSurface = canAccessPilotSurface;
    window.getPinnedRouteIds = getPinnedRouteIds;
    bindPilotChromeListeners();
}
