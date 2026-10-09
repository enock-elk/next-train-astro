/**
 * Operator chrome (Map / Community tabs, Account, Notifications).
 * Hidden in HTML by default — reveal after allowlisted admin auth, or for
 * commuters whose pinned route is on an experimental map/community allow-list.
 * Never use five-tap unlock or the admin-ready / admin-session-active flags as the gate.
 */
import { safeStorage } from './utils.js';
import { $currentRouteId, $userRegion } from '../store.js';
import { $account } from './account.js';
import { FEATURE_KEYS, fetchFeatures, getGrantedFeatures, isFeatureEnabled, isFeatureGranted, isRideCheckInPinned } from './features.js';
import { isLiveTrainFollowActive } from './live-train-follow.js';

function isSignedInAccount() {
    return $account.get()?.status === 'signed-in';
}

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

/** Map / Community follow a region, the board route, a pin, or a device grant. */
export function canAccessPilotSurface(surface, routeId = '') {
    if (isAdminAuthed()) return true;
    if (surface === 'map' && isFeatureGranted(FEATURE_KEYS.MAP_TAB)) return true;
    if (surface === 'community' && isFeatureGranted(FEATURE_KEYS.COMMUNITY_TAB)) return true;
    // A signed-in commuter must always reach Account, even if extra features
    // (Map / Community / ride check-in) are switched off in Dev Hub.
    if (surface === 'account' && isSignedInAccount()) return true;
    if (surface === 'account' && (
        isFeatureGranted(FEATURE_KEYS.MAP_TAB)
        || isFeatureGranted(FEATURE_KEYS.COMMUNITY_TAB)
        || isFeatureGranted(FEATURE_KEYS.RIDE_CHECKIN)
    )) return true;
    const hit = (key) => experimentalFeatureMatches(key, routeId);
    if (surface === 'map') return hit(FEATURE_KEYS.MAP_TAB);
    if (surface === 'community') return hit(FEATURE_KEYS.COMMUNITY_TAB);
    if (surface === 'account') {
        return hit(FEATURE_KEYS.MAP_TAB) || hit(FEATURE_KEYS.COMMUNITY_TAB);
    }
    return false;
}

/**
 * Region, the route on the board, a pinned route, or an explicit route argument.
 * A device grant is handled before this runs.
 */
function experimentalFeatureMatches(key, routeId = '') {
    const region = String($userRegion.get() || '').toUpperCase();
    if (region && isFeatureEnabled(key, '', region)) return true;
    const ids = new Set(routeId ? [String(routeId)] : getPinnedRouteIds());
    if (!routeId) {
        const current = String($currentRouteId.get() || '');
        if (current) ids.add(current);
    }
    return [...ids].some((id) => isFeatureEnabled(key, id));
}

/**
 * Interactive tracking Map: authenticated admins, experimental Map pins/grants,
 * or a live-share follow for this browser session only.
 */
export function canOpenTrackingMap() {
    return canAccessPilotSurface('map') || isLiveTrainFollowActive();
}

/** Passenger Type + Theme live in Account when that row is visible. */
export function placeAccountSettings(accountOn) {
    if (typeof document === 'undefined') return;
    const profile = document.getElementById('settings-profile-btn');
    const cluster = document.getElementById('settings-profile-cluster') || profile;
    const prefs = document.getElementById('sidenav-prefs-block');
    const sidenavSlot = document.getElementById('sidenav-legacy-settings');
    const accountSlot = document.getElementById('account-settings-host');
    const mapsBlock = document.getElementById('sidenav-maps-block');
    const themeToggle = document.getElementById('settings-theme-toggle');
    const notifyToggle = document.getElementById('settings-notify-toggle');
    const paxNote = document.getElementById('settings-profile-community-note');
    if (accountOn && accountSlot) {
        if (cluster && themeToggle?.parentElement) {
            themeToggle.parentElement.insertBefore(cluster, themeToggle);
        }
        if (prefs) accountSlot.appendChild(prefs);
        prefs?.classList.add('nt-prefs-flat');
        document.getElementById('prefs-accordion-toggle')?.classList.add('hidden');
        const panel = document.getElementById('prefs-accordion-panel');
        panel?.classList.remove('hidden');
        panel?.classList.add('flex');
        document.getElementById('prefs-accordion-toggle')?.setAttribute('aria-expanded', 'true');
        if (notifyToggle) {
            notifyToggle.hidden = false;
            notifyToggle.removeAttribute('hidden');
            notifyToggle.classList.remove('hidden');
            notifyToggle.removeAttribute('inert');
            notifyToggle.setAttribute('aria-hidden', 'false');
        }
        paxNote?.classList.remove('hidden');
    } else {
        prefs?.classList.remove('nt-prefs-flat');
        document.getElementById('prefs-accordion-toggle')?.classList.remove('hidden');
        document.getElementById('prefs-accordion-toggle')?.setAttribute('aria-expanded', 'false');
        const panel = document.getElementById('prefs-accordion-panel');
        panel?.classList.add('hidden');
        panel?.classList.remove('flex');
        if (cluster && sidenavSlot) sidenavSlot.appendChild(cluster);
        if (prefs && mapsBlock?.parentElement) mapsBlock.parentElement.insertBefore(prefs, mapsBlock);
        paxNote?.classList.add('hidden');
        if (notifyToggle && !isAdminAuthed()) {
            notifyToggle.hidden = true;
            notifyToggle.setAttribute('hidden', '');
            notifyToggle.classList.add('hidden');
            notifyToggle.setAttribute('inert', '');
            notifyToggle.setAttribute('aria-hidden', 'true');
        }
    }
    document.documentElement.setAttribute('data-account-settings', accountOn ? '1' : '0');
    if (typeof window.syncNotifyUi === 'function') {
        try { window.syncNotifyUi(); } catch { /* ignore */ }
    }
}

export function applyPilotChrome() {
    if (typeof document === 'undefined') return;
    const mapOn = canAccessPilotSurface('map');
    const communityOn = canAccessPilotSurface('community');
    const accountOn = isAdminAuthed() || canAccessPilotSurface('account');

    setReveal(document.getElementById('settings-account-btn'), accountOn);
    placeAccountSettings(accountOn);
    if (!isAdminAuthed()) {
        setReveal(document.getElementById('bottom-nav-map'), mapOn);
        setReveal(document.getElementById('bottom-nav-community'), communityOn);
    }

    const html = document.documentElement;
    html.setAttribute('data-pilot-map', !isAdminAuthed() && mapOn ? '1' : '0');
    html.setAttribute('data-pilot-community', !isAdminAuthed() && communityOn ? '1' : '0');

    const tab = safeStorage.getItem('activeTab');
    if (!isAdminAuthed() && ((tab === 'map' && !canOpenTrackingMap()) || (tab === 'community' && !communityOn))) {
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
    try {
        if (on) localStorage.setItem('ntOperatorAuthed', '1');
        else localStorage.removeItem('ntOperatorAuthed');
    } catch { /* ignore */ }
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

function experimentalAccessSnapshot() {
    const routeId = String($currentRouteId.get() || '');
    const region = String($userRegion.get() || '');
    return {
        map: !isAdminAuthed() && canAccessPilotSurface('map'),
        community: !isAdminAuthed() && canAccessPilotSurface('community'),
        ride: isRideCheckInPinned(routeId) || isFeatureEnabled(FEATURE_KEYS.RIDE_CHECKIN, routeId, region),
    };
}

/** Fresh RTDB read soon after open. Revoke hides the surface; a live one refreshes after a toast. */
export function scheduleExperimentalFeatureRecheck() {
    if (typeof window === 'undefined' || window.__ntExpRecheck) return;
    window.__ntExpRecheck = true;
    const started = Date.now();
    const run = async () => {
        try {
            await fetchFeatures();
            const before = experimentalAccessSnapshot();
            const grants = getGrantedFeatures();
            const enabled = before.map || before.community || before.ride
                || Object.values(grants).some((on) => on === true);
            if (!enabled || isAdminAuthed()) return;
            await fetchFeatures(true);
            applyPilotChrome();
            if (typeof window.renderRideSeenChip === 'function') {
                try { window.renderRideSeenChip(); } catch { /* ignore */ }
            }
            const after = experimentalAccessSnapshot();
            const lostMap = before.map && !after.map;
            const lostCommunity = before.community && !after.community;
            const lostRide = before.ride && !after.ride;
            if (!lostMap && !lostCommunity && !lostRide) return;
            const tab = safeStorage.getItem('activeTab') || '';
            const mapOpen = lostMap && (
                tab === 'map' || !!document.getElementById('view-map')?.classList.contains('active')
            );
            const communityOpen = lostCommunity && (
                tab === 'community' || !!document.getElementById('view-community')?.classList.contains('active')
            );
            let sharing = false;
            if (lostRide) {
                try {
                    sharing = !!JSON.parse(safeStorage.getItem('ridePingActiveV1') || 'null')?.routeId;
                } catch { /* ignore */ }
            }
            if (!mapOpen && !communityOpen && !sharing) return;
            if (typeof window.showToast === 'function') {
                window.showToast('An experimental feature was turned off. Refreshing.', 'info', 2500);
            }
            window.setTimeout(() => { window.location.reload(); }, 700);
        } catch { /* ignore */ }
    };
    const delay = Math.max(0, Math.min(1500, 5000 - (Date.now() - started)));
    window.setTimeout(() => { run(); }, delay);
}

function bindPilotChromeListeners() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || window.__ntPilotChromeBound) return;
    window.__ntPilotChromeBound = true;
    window.addEventListener('nt-features-updated', () => {
        try { applyPilotChrome(); } catch { /* ignore */ }
    });
    window.addEventListener('accountchange', () => {
        try { applyPilotChrome(); } catch { /* ignore */ }
    });
    if (typeof $account?.subscribe === 'function') {
        $account.subscribe(() => {
            try { applyPilotChrome(); } catch { /* ignore */ }
        });
    }
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
    window.canOpenTrackingMap = canOpenTrackingMap;
    window.getPinnedRouteIds = getPinnedRouteIds;
    window.placeAccountSettings = placeAccountSettings;
    bindPilotChromeListeners();
    scheduleExperimentalFeatureRecheck();
}
