/**
 * Cold-start / share deeplink intents (legal, fares).
 * Defers until Welcome completes for first-time users.
 */
import { safeStorage } from './utils.js';

const INTENT_KEY = 'nt_pending_deeplink';

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

/**
 * Call as early as possible on boot. For first-time users, stash modal intents
 * and clear the hash so Welcome can own the first screen.
 */
export function prepareDeeplinkIntents() {
    if (typeof window === 'undefined' || window.__ntDeeplinkPrepared) return;
    window.__ntDeeplinkPrepared = true;

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

        if (sameDoc && (isLegalHash(hash) || hash === '#fare' || hash === '#planner' || hash === '#planner-results' || hash === '#community' || hash === '#map')) {
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
                if (location.hash !== '#map') history.pushState({ modal: 'map' }, '', '#map');
                if (typeof window.openSmoothModal === 'function') window.openSmoothModal('map-modal');
                return;
            }
        }

        location.assign(url.href);
    }, true);
}
