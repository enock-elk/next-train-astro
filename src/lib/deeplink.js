/**
 * Cold-start / share deeplink intents (legal, fares, planner/route snapshot).
 * Defers until Welcome completes for first-time users.
 * Snapshots share query params early so Welcome/URL cleanup cannot drop legacy SPA links.
 */
import { safeStorage } from './utils.js';
import {
    parsePlannerDeepLink,
    parseRouteDeepLinkParams,
    parseMapDeepLink,
    parsePlannerShortcutDeepLink,
    parseShareTargetDeepLink,
    stripShareParamsFromUrl,
} from './share-links.js';

const INTENT_KEY = 'nt_pending_deeplink';
const SHARE_SNAPSHOT_KEY = 'nt_share_deeplink_snapshot';

function isLegalHash(hash) {
    return hash === '#privacy' || hash === '#terms' || hash === '#legal';
}

function legalDocFromHash(hash) {
    if (hash === '#terms') return 'terms';
    if (hash === '#privacy' || hash === '#legal') return 'privacy';
    return null;
}

function readIntent() {
    try {
        const raw = sessionStorage.getItem(INTENT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeIntent(intent) {
    try {
        sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
    } catch { /* ignore */ }
}

function clearIntent() {
    try {
        sessionStorage.removeItem(INTENT_KEY);
    } catch { /* ignore */ }
}

function stripHashKeepQuery() {
    try {
        history.replaceState(history.state || {}, '', location.pathname + location.search);
    } catch { /* ignore */ }
}

/** Capture legacy + short share links before any UI mutates location.search. */
export function snapshotShareDeeplink() {
    if (typeof window === 'undefined') return null;
    try {
        const existing = sessionStorage.getItem(SHARE_SNAPSHOT_KEY);
        if (existing) {
            try { return JSON.parse(existing); } catch { /* fall through */ }
        }
        const planner = parsePlannerDeepLink(location.search);
        const route = parseRouteDeepLinkParams(location.search);
        const map = parseMapDeepLink(location.search);
        const plannerShortcut = parsePlannerShortcutDeepLink(location.search);
        const shareTarget = parseShareTargetDeepLink(location.search);
        const snap = planner || route || map || plannerShortcut || shareTarget || null;
        if (snap) sessionStorage.setItem(SHARE_SNAPSHOT_KEY, JSON.stringify(snap));
        return snap;
    } catch {
        return null;
    }
}

export function consumeShareDeeplinkSnapshot() {
    try {
        const raw = sessionStorage.getItem(SHARE_SNAPSHOT_KEY);
        sessionStorage.removeItem(SHARE_SNAPSHOT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function peekShareDeeplinkSnapshot() {
    try {
        const raw = sessionStorage.getItem(SHARE_SNAPSHOT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * Call as early as possible on boot. For first-time users, stash modal intents
 * and clear the hash so Welcome can own the first screen.
 */
export function prepareDeeplinkIntents() {
    if (typeof window === 'undefined' || window.__ntDeeplinkPrepared) return;
    window.__ntDeeplinkPrepared = true;

    // SPA parity: freeze share params first (Welcome used to strip region= before planner ran)
    snapshotShareDeeplink();

    const welcomeSeen = safeStorage.getItem('welcomeSeen') === 'true';
    const hash = location.hash || '';
    const legalDoc = legalDocFromHash(hash);

    if (legalDoc && !welcomeSeen) {
        writeIntent({ kind: 'legal', doc: legalDoc });
        stripHashKeepQuery();
        return;
    }

    if (hash === '#fare' && !welcomeSeen) {
        writeIntent({ kind: 'fares' });
        stripHashKeepQuery();
    }
}

/**
 * Returning users (or after Welcome): open whatever the current hash asks for.
 */
export async function consumeHashDeeplinks() {
    if (typeof window === 'undefined') return;
    if (safeStorage.getItem('welcomeSeen') !== 'true') return;

    const hash = location.hash || '';
    const legalDoc = legalDocFromHash(hash);
    if (legalDoc) {
        const { openLegal } = await import('./ui.js');
        openLegal(legalDoc, { fromHash: true });
        return;
    }
    if (hash === '#fare') {
        const { openFareModalForCurrentRoute } = await import('./live-board-ui.js');
        openFareModalForCurrentRoute();
    }
}

/** After Welcome route pick (or any deferred path). */
export async function flushPendingDeeplinkIntents() {
    const intent = readIntent();
    if (!intent) return;
    clearIntent();

    if (intent.kind === 'legal') {
        const { openLegal } = await import('./ui.js');
        openLegal(intent.doc === 'terms' ? 'terms' : 'privacy');
        return;
    }
    if (intent.kind === 'fares') {
        const { openFareModalForCurrentRoute } = await import('./live-board-ui.js');
        openFareModalForCurrentRoute();
    }
}

/**
 * Home-screen shortcut `?action=planner` with no stations — open the planner tab.
 */
export async function applyPlannerShortcutDeepLink() {
    if (typeof window === 'undefined') return false;
    const snap = peekShareDeeplinkSnapshot();
    const link = (snap && snap.kind === 'planner-shortcut')
        ? snap
        : parsePlannerShortcutDeepLink(location.search);
    if (!link || link.kind !== 'planner-shortcut') return false;
    if (snap && snap.kind === 'planner-shortcut') consumeShareDeeplinkSnapshot();

    if (safeStorage.getItem('welcomeSeen') !== 'true') {
        safeStorage.setItem('welcomeSeen', 'true');
    }
    stripShareParamsFromUrl();
    if (typeof window.switchTab === 'function') window.switchTab('trip-planner');
    return true;
}

/**
 * Web Share Target — open planner; full trips reuse applyPlannerDeepLink via snapshot.
 * Unresolved shares still land on the planner with a toast of the shared text.
 */
export async function applyShareTargetDeepLink() {
    if (typeof window === 'undefined') return false;
    const snap = peekShareDeeplinkSnapshot();
    // Share-target parser may upgrade to planner/route — those are handled elsewhere.
    if (snap && (snap.kind === 'planner' || snap.kind === 'route')) return false;

    const link = (snap && snap.kind === 'share-target')
        ? snap
        : parseShareTargetDeepLink(location.search);
    if (!link || link.kind !== 'share-target') return false;
    if (snap && snap.kind === 'share-target') consumeShareDeeplinkSnapshot();

    if (safeStorage.getItem('welcomeSeen') !== 'true') {
        safeStorage.setItem('welcomeSeen', 'true');
    }

    stripShareParamsFromUrl();
    if (typeof window.switchTab === 'function') window.switchTab('trip-planner');

    const hint = [link.text, link.title, link.url].filter(Boolean).join(' — ').slice(0, 120);
    if (hint && typeof window.showToast === 'function') {
        window.showToast(`Shared to Trip Planner${hint ? `: ${hint}` : ''}`, 'info', 4000);
    }
    return true;
}

/**
 * Legacy SPA `?action=map` — open the interactive Map tab (fallback: static PRASA modal).
 */
export async function applyMapDeepLink() {
    if (typeof window === 'undefined') return false;
    const snap = peekShareDeeplinkSnapshot();
    const link = (snap && snap.kind === 'map')
        ? snap
        : parseMapDeepLink(location.search);
    if (!link || link.kind !== 'map') return false;
    if (snap && snap.kind === 'map') consumeShareDeeplinkSnapshot();

    if (typeof window.showToast === 'function') {
        window.showToast('Opening shared link...', 'info', 5000);
    }

    if (safeStorage.getItem('welcomeSeen') !== 'true') {
        safeStorage.setItem('welcomeSeen', 'true');
    }

    stripShareParamsFromUrl();

    const openTab = () => {
        if (typeof window.switchTab !== 'function' || !document.getElementById('view-map')) return false;
        window.switchTab('map');
        if (typeof window.trackAnalyticsEvent === 'function') {
            window.trackAnalyticsEvent('deep_link_open', { type: 'map' });
        }
        if (typeof window.showToast === 'function') {
            window.showToast('Opened network map', 'success', 2000);
        }
        return true;
    };

    const openModal = () => {
        const mapModal = document.getElementById('map-modal');
        if (!mapModal) return false;
        if (typeof window.setupMapLogic === 'function') {
            try { window.setupMapLogic(); } catch { /* ignore */ }
        }
        if (typeof window.openSmoothModal === 'function') {
            window.openSmoothModal('map-modal');
        } else {
            mapModal.classList.remove('hidden');
        }
        try {
            if (location.hash !== '#prasa-map') history.pushState({ modal: 'map' }, '', '#prasa-map');
        } catch { /* ignore */ }
        const mapImage = document.getElementById('map-image');
        if (mapImage) mapImage.style.transform = 'translate(0px, 0px) scale(1)';
        if (typeof window.trackAnalyticsEvent === 'function') {
            window.trackAnalyticsEvent('deep_link_open', { type: 'map' });
        }
        if (typeof window.showToast === 'function') {
            window.showToast('Opened shared network map', 'success', 2000);
        }
        return true;
    };

    if (openTab()) return true;
    // Modal markup may still be mounting on cold start
    if (openModal()) return true;
    await new Promise((r) => setTimeout(r, 120));
    return openTab() || openModal();
}

export function bindDeeplinkHashChange() {
    if (typeof window === 'undefined' || window.__ntDeeplinkHashBound) return;
    window.__ntDeeplinkHashBound = true;

    window.addEventListener('hashchange', () => {
        if (safeStorage.getItem('welcomeSeen') !== 'true') return;
        const hash = location.hash || '';
        if (!isLegalHash(hash) && hash !== '#fare') return;
        consumeHashDeeplinks().catch(() => {});
    });
}

/**
 * In installed PWA, same-origin links must not open a browser tab via target=_blank.
 */
export function bindPwaSameOriginLinks() {
    if (typeof window === 'undefined' || window.__ntPwaSameOriginBound) return;
    window.__ntPwaSameOriginBound = true;

    const isStandalone = () =>
        window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone;

    document.addEventListener('click', (e) => {
        if (!isStandalone()) return;
        const anchor = e.target?.closest?.('a[href]');
        if (!anchor) return;

        let url;
        try {
            url = new URL(anchor.getAttribute('href'), location.href);
        } catch {
            return;
        }
        if (url.origin !== location.origin) return;

        e.preventDefault();
        e.stopPropagation();

        const norm = (p) => (p || '/').replace(/\/+$/, '') || '/';
        const sameDoc = norm(url.pathname) === norm(location.pathname) && url.search === location.search;
        const hash = url.hash || '';

        if (sameDoc && (isLegalHash(hash) || hash === '#fare' || hash === '#planner' || hash === '#planner-results' || hash === '#community' || hash === '#map' || hash === '#prasa-map')) {
            if (isLegalHash(hash) || hash === '#fare') {
                if (location.hash !== hash) {
                    history.pushState({ deeplink: hash }, '', hash);
                }
                consumeHashDeeplinks().catch(() => {});
                return;
            }
            if (hash === '#planner' || hash === '#planner-results') {
                if (typeof window.switchTab === 'function') window.switchTab('trip-planner');
                if (location.hash !== hash) history.pushState({ tab: 'planner' }, '', hash);
                return;
            }
            if (hash === '#community') {
                if (typeof window.switchTab === 'function') window.switchTab('community');
                if (location.hash !== hash) history.pushState({ tab: 'community' }, '', hash);
                return;
            }
            if (hash === '#map') {
                if (typeof window.switchTab === 'function') window.switchTab('map');
                if (location.hash !== '#map') history.pushState({ tab: 'map' }, '', '#map');
                return;
            }
            if (hash === '#prasa-map') {
                if (location.hash !== '#prasa-map') history.pushState({ modal: 'map' }, '', '#prasa-map');
                if (typeof window.openSmoothModal === 'function') window.openSmoothModal('map-modal');
                return;
            }
        }

        location.assign(url.href);
    }, true);
}
