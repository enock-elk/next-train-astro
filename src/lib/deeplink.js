/**
 * Cold-start / share deeplink intents (legal, fares, planner/route snapshot).
 * Defers until Welcome completes for first-time users.
 * Snapshots share query params early so Welcome/URL cleanup cannot drop legacy SPA links.
 */
import { safeStorage } from './utils.js';
import { withBase } from './config.js';
import { clearLiveTrainFollow, setLiveTrainFollow } from './live-train-follow.js';
import { whenSettledForAutoNotices } from './session-stability.js';
import {
    parsePlannerDeepLink,
    parseRouteDeepLinkParams,
    parseLiveTrainDeepLink,
    parseLiveSharePath,
    liveShareSearchFromUrl,
    parseMapDeepLink,
    parsePlannerShortcutDeepLink,
    parseShareTargetDeepLink,
    parseContentDeepLink,
    parseContentQuery,
    contentDeepLinkSearch,
    stripShareParamsFromUrl,
    isSeoAppHandoff,
} from './share-links.js';

const INTENT_KEY = 'nt_pending_deeplink';
const SHARE_SNAPSHOT_KEY = 'nt_share_deeplink_snapshot';
const LAUNCH_URL_KEY = 'nt_launch_target_url';

function parseShareFromSearch(search) {
    return parseLiveTrainDeepLink(search)
        || parseContentQuery(search)
        || parsePlannerDeepLink(search)
        || parseRouteDeepLinkParams(search)
        || parseMapDeepLink(search)
        || parsePlannerShortcutDeepLink(search)
        || parseShareTargetDeepLink(search)
        || null;
}

function shareFingerprint(snap) {
    if (!snap || !snap.kind) return '';
    if (snap.kind === 'route') return `route:${snap.routeId}:${snap.view || ''}:${snap.dir || ''}:${snap.day || ''}`;
    if (snap.kind === 'planner') return `planner:${snap.from}:${snap.to}:${snap.time || ''}:${snap.day || ''}:${snap.region || ''}`;
    if (snap.kind === 'live') return `live:${snap.trainId}:${snap.routeId || ''}:${snap.dest || ''}`;
    if (snap.kind === 'planner-shortcut') return 'planner-shortcut';
    if (snap.kind === 'map') return 'map';
    if (snap.kind === 'share-target') return `share-target:${snap.url || ''}:${snap.text || ''}`;
    if (snap.kind === 'alert') return `alert:${snap.id}:${snap.source || ''}`;
    if (snap.kind === 'community') return `community:${snap.routeId}:${snap.postId}`;
    return snap.kind;
}

export function isInAppBrowser(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
    return /FBAN|FBAV|Instagram|Line\//i.test(String(ua || ''));
}

function readStashedLaunchUrl() {
    try {
        const fromWin = typeof window !== 'undefined' ? window.__ntLaunchTargetUrl : '';
        const fromStore = sessionStorage.getItem(LAUNCH_URL_KEY);
        const url = fromWin || fromStore || '';
        if (fromStore) sessionStorage.removeItem(LAUNCH_URL_KEY);
        if (typeof window !== 'undefined') window.__ntLaunchTargetUrl = '';
        return url || null;
    } catch {
        return null;
    }
}

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

const DEEPLINK_SURFACE_KEY = 'nt_deeplink_surface';
const DEEPLINK_WELCOME_KEY = 'nt_deeplink_welcome';

/** A saved region and route. A link must not replace these. */
export function readSavedDefaults() {
    const region = safeStorage.getItem('userRegion') || '';
    if (!['GP', 'WC', 'KZN', 'EC'].includes(region)) return null;
    const routeId = safeStorage.getItem('defaultRoute_' + region) || '';
    if (!routeId) return null;
    return { region, routeId };
}

async function applySavedDefaultsToStore(saved = readSavedDefaults()) {
    if (!saved?.routeId) return false;
    const { ROUTES } = await import('./config.js');
    const route = ROUTES[saved.routeId];
    if (!route?.isActive || route.region !== saved.region) return false;
    const { $userRegion, $currentRouteId } = await import('../store.js');
    if ($userRegion.get() !== saved.region) $userRegion.set(saved.region);
    if ($currentRouteId.get() !== saved.routeId) $currentRouteId.set(saved.routeId);
    return true;
}

/**
 * Remember which surface the link opened.
 * A visitor with a saved route keeps that route.
 * A new visitor sees the link first. Welcome waits until they leave.
 */
export function noteDeeplinkSurface(surface, { loadDefaults = true } = {}) {
    if (typeof window === 'undefined' || !surface) return;
    try { sessionStorage.setItem(DEEPLINK_SURFACE_KEY, surface); } catch { /* ignore */ }
    const saved = readSavedDefaults();
    if (saved) {
        try { sessionStorage.removeItem(DEEPLINK_WELCOME_KEY); } catch { /* ignore */ }
        if (loadDefaults) {
            applySavedDefaultsToStore(saved).then((ok) => {
                if (!ok) return;
                import('./logic.js').then((m) => m.loadAllSchedules?.(false)).catch(() => {});
            }).catch(() => {});
        }
    } else if (safeStorage.getItem('welcomeSeen') !== 'true') {
        try { sessionStorage.setItem(DEEPLINK_WELCOME_KEY, '1'); } catch { /* ignore */ }
        try { document.getElementById('welcome-modal')?.classList.add('hidden'); } catch { /* ignore */ }
    }
    import('./prefs.js').then((m) => m.syncInAppChrome?.()).catch(() => {});
}

/** Leave the linked surface. Restore a saved route, or open Welcome for a new visitor. */
export function finishDeeplinkVisit() {
    if (typeof window === 'undefined') return;
    let surface = '';
    let needsWelcome = false;
    try {
        surface = sessionStorage.getItem(DEEPLINK_SURFACE_KEY) || '';
        needsWelcome = sessionStorage.getItem(DEEPLINK_WELCOME_KEY) === '1';
        sessionStorage.removeItem(DEEPLINK_SURFACE_KEY);
        sessionStorage.removeItem(DEEPLINK_WELCOME_KEY);
    } catch { /* ignore */ }
    if (!surface) return;
    const saved = readSavedDefaults();
    if (saved) {
        applySavedDefaultsToStore(saved).then((ok) => {
            if (!ok) return;
            import('./logic.js').then((m) => m.loadAllSchedules?.(false)).catch(() => {});
        }).catch(() => {});
        import('./prefs.js').then((m) => m.syncInAppChrome?.()).catch(() => {});
        return;
    }
    const storedRegion = safeStorage.getItem('userRegion') || '';
    const showWelcome = () => {
        if (needsWelcome && safeStorage.getItem('welcomeSeen') !== 'true') {
            try { window.dispatchEvent(new CustomEvent('nt-show-welcome')); } catch { /* ignore */ }
        }
    };
    if (!['GP', 'WC', 'KZN', 'EC'].includes(storedRegion)) {
        showWelcome();
        return;
    }
    import('../store.js').then(({ $userRegion }) => {
        if ($userRegion.get() !== storedRegion) $userRegion.set(storedRegion);
    }).catch(() => {}).finally(showWelcome);
}

function stripHashKeepQuery() {
    try {
        history.replaceState(history.state || {}, '', location.pathname + location.search);
    } catch { /* ignore */ }
}

/** Capture legacy + short share links before any UI mutates location.search. */
export function snapshotShareDeeplink(searchOverride, opts = {}) {
    if (typeof window === 'undefined') return null;
    try {
        if (searchOverride == null && typeof location !== 'undefined') {
            const located = parseContentDeepLink({
                search: location.search,
                hash: location.hash,
                pathname: location.pathname,
            });
            const hashLink = location.hash.startsWith('#alerts/') || location.hash.startsWith('#community/');
            const pathLink = /\/og\/[ac]\//i.test(location.pathname);
            if (located && (hashLink || pathLink)) {
                const destSearch = contentDeepLinkSearch(located);
                try {
                    const next = withBase('/') + destSearch;
                    if ((location.pathname + location.search + location.hash) !== next) {
                        history.replaceState(history.state || {}, '', next);
                    }
                } catch { /* ignore */ }
                searchOverride = destSearch;
            }
        }
        const search = searchOverride != null
            ? searchOverride
            : (typeof location !== 'undefined' ? location.search : '');
        const snap = parseShareFromSearch(search);
        if (snap && opts.prefer) snap.prefer = true;
        const existing = peekShareDeeplinkSnapshot();
        if (snap) {
            // A chip click always wins, even when an older snapshot has the same link.
            // A later launch URL still replaces an empty Facebook hop.
            if (opts.prefer || shareFingerprint(existing) !== shareFingerprint(snap)) {
                sessionStorage.setItem(SHARE_SNAPSHOT_KEY, JSON.stringify(snap));
            }
            return snap;
        }
        return existing;
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

/** Tell a late pin-restore not to replace the corridor this share just opened. */
export function lockShareBoot() {
    if (typeof window === 'undefined') return;
    window.__ntShareBootLock = true;
}

const SLOW_DEEPLINK_MS = 700;

/**
 * Dismissable "still working" toast, only if the handoff is still going after a short wait.
 * Fast cache opens cancel before it appears.
 */
export function armSlowDeeplinkToast(message = 'Still opening this link') {
    const text = String(message || 'Still opening this link');
    let cancelled = false;
    const timer = setTimeout(() => {
        if (cancelled || typeof window === 'undefined') return;
        if (typeof window.showToast === 'function') {
            window.showToast(text, 'info', 10000, '', { dismissible: true, force: true });
        }
    }, SLOW_DEEPLINK_MS);
    return {
        cancel() {
            cancelled = true;
            clearTimeout(timer);
            try { window.hideToastIfMessage?.(text); } catch { /* ignore */ }
        },
    };
}

/**
 * Installed PWA uses launch_handler: focus-existing. Chrome delivers the
 * clicked URL via launchQueue — not location.search — on the first open.
 * Convert /og/share?… to /?… so Welcome + ignite see the same params.
 */
export function ingestLaunchTargetUrl(targetURL) {
    if (!targetURL || typeof window === 'undefined') return null;
    let url;
    try {
        url = new URL(targetURL, location.origin);
    } catch {
        return null;
    }
    if (url.origin !== location.origin) return null;

    const content = parseContentDeepLink({ search: url.search, hash: url.hash, pathname: url.pathname });
    if (content && (content.kind === 'alert' || content.kind === 'community')) {
        const destSearch = contentDeepLinkSearch(content);
        snapshotShareDeeplink(destSearch, { prefer: true });
        try {
            const next = withBase('/') + destSearch;
            const cur = location.pathname + location.search + location.hash;
            if (next !== cur) history.replaceState(history.state || {}, '', next);
        } catch { /* ignore */ }
        return content;
    }

    const search = liveShareSearchFromUrl(url) || url.search;
    const pathLive = parseLiveSharePath(url.pathname);
    const snap = snapshotShareDeeplink(search);
    if (!snap && !pathLive) return null;

    try {
        const destPath = (/\/og\/share\/?$/.test(url.pathname) || parseLiveSharePath(url.pathname))
            ? withBase('/')
            : (url.pathname || withBase('/'));
        const destSearch = pathLive ? search : url.search;
        const next = destPath + destSearch + (url.hash || '');
        const cur = location.pathname + location.search + location.hash;
        if (next !== cur) history.replaceState(history.state || {}, '', next);
    } catch { /* ignore */ }
    return snap || pathLive;
}

export function hasInboundShareIntent(search = typeof location !== 'undefined' ? location.search : '') {
    if (parseShareFromSearch(search)) return true;
    const snap = peekShareDeeplinkSnapshot();
    return !!(snap && (
        snap.kind === 'route'
        || snap.kind === 'planner'
        || snap.kind === 'live'
        || snap.kind === 'planner-shortcut'
        || snap.kind === 'map'
        || snap.kind === 'share-target'
        || snap.kind === 'alert'
        || snap.kind === 'community'
    ));
}

/**
 * Head script stashes launchQueue targetURL. Bind here to apply it and
 * re-run boot when a late Facebook/PWA launch arrives.
 */
export function bindLaunchQueueDeeplinks(onLaunch) {
    if (typeof window === 'undefined' || window.__ntLaunchQueueModuleBound) return;
    window.__ntLaunchQueueModuleBound = true;

    const apply = (raw) => {
        if (!raw) return;
        if (raw === window.__ntLastLaunchApplied) return;
        const snap = ingestLaunchTargetUrl(raw);
        if (!snap) return;
        window.__ntLastLaunchApplied = raw;
        if (typeof onLaunch === 'function') onLaunch(raw);
    };

    apply(readStashedLaunchUrl());
    window.addEventListener('nt-launch-url', (e) => apply(e?.detail));
}

/** Facebook IAB often paints hidden, then reveals — re-apply if the URL arrived late. */
export function bindWebViewDeeplinkResume(onResume) {
    if (typeof window === 'undefined' || window.__ntDeeplinkResumeBound) return;
    window.__ntDeeplinkResumeBound = true;

    const resume = () => {
        snapshotShareDeeplink();
        if (!hasInboundShareIntent()) return;
        if (typeof onResume === 'function') onResume();
    };

    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resume();
    });
}

/**
 * Call as early as possible on boot. For first-time users, stash modal intents
 * and clear the hash so Welcome can own the first screen.
 */
export function prepareDeeplinkIntents() {
    if (typeof window === 'undefined' || window.__ntDeeplinkPrepared) return;
    window.__ntDeeplinkPrepared = true;

    // SPA parity: freeze share params first (Welcome used to strip region= before planner ran)
    const launchUrl = readStashedLaunchUrl();
    if (launchUrl) ingestLaunchTargetUrl(launchUrl);
    else snapshotShareDeeplink();

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
        return;
    }

    if (hash === '#account' && !welcomeSeen) {
        writeIntent({ kind: 'account' });
        stripHashKeepQuery();
    }
}

/**
 * Returning users (or after Welcome): open whatever the current hash asks for.
 */
export async function consumeHashDeeplinks(hashOverride) {
    if (typeof window === 'undefined') return;
    if (safeStorage.getItem('welcomeSeen') !== 'true') return;

    const hash = hashOverride || location.hash || '';
    const legalDoc = legalDocFromHash(hash);
    if (legalDoc) {
        const { openLegal } = await import('./ui.js');
        openLegal(legalDoc, { fromHash: true });
        return;
    }
    if (hash === '#fare') {
        const { openFareModalForCurrentRoute } = await import('./live-board-ui.js');
        openFareModalForCurrentRoute();
        return;
    }
    if (hash === '#account') {
        const { openAccountModal } = await import('./account.js');
        openAccountModal();
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
        return;
    }
    if (intent.kind === 'account') {
        const { openAccountModal } = await import('./account.js');
        openAccountModal();
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

    stripShareParamsFromUrl();
    if (typeof window.switchTab === 'function') window.switchTab('trip-planner');
    noteDeeplinkSurface('planner');
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
    if (snap && (snap.kind === 'planner' || snap.kind === 'route' || snap.kind === 'live')) return false;

    const link = (snap && snap.kind === 'share-target')
        ? snap
        : parseShareTargetDeepLink(location.search);
    if (!link || link.kind !== 'share-target') return false;
    if (snap && snap.kind === 'share-target') consumeShareDeeplinkSnapshot();

    stripShareParamsFromUrl();
    if (typeof window.switchTab === 'function') window.switchTab('trip-planner');
    noteDeeplinkSurface('planner');

    const hint = [link.text, link.title, link.url].filter(Boolean).join(' — ').slice(0, 120);
    if (hint && typeof window.showToast === 'function') {
        window.showToast(`Shared to Trip Planner${hint ? `: ${hint}` : ''}`, 'info', 4000);
    }
    return true;
}

/**
 * Live train share `?live=0823&rt=pta-mabopane&to=Mabopane` — open Map on that train.
 */
export async function applyLiveTrainDeepLink() {
    if (typeof window === 'undefined') return false;
    const snap = peekShareDeeplinkSnapshot();
    const link = (snap && snap.kind === 'live')
        ? snap
        : parseLiveTrainDeepLink(location.search);
    if (!link || link.kind !== 'live' || !link.trainId) return false;
    if (snap && snap.kind === 'live') consumeShareDeeplinkSnapshot();
    lockShareBoot();
    const slowToast = armSlowDeeplinkToast('Still opening this link');

    const { ROUTES } = await import('./config.js');
    const { $currentRouteId, $userRegion } = await import('../store.js');
    const route = link.routeId ? ROUTES[link.routeId] : null;
    const saved = readSavedDefaults();
    if (saved) {
        await applySavedDefaultsToStore(saved);
    } else if (route?.isActive) {
        const nextRegion = route.region || $userRegion.get() || 'GP';
        if ($userRegion.get() !== nextRegion) {
            let previousRegion = '';
            try { previousRegion = safeStorage.getItem('userRegion') || ''; } catch { /* ignore */ }
            $userRegion.set(nextRegion);
            try {
                if (previousRegion) safeStorage.setItem('userRegion', previousRegion);
                else safeStorage.removeItem('userRegion');
            } catch { /* ignore */ }
        }
        $currentRouteId.set(route.id);
    }

    stripShareParamsFromUrl();

    let share = { status: 'stopped' };
    try {
        const ride = await import('./ride-pings.js');
        share = await ride.findLiveTrainShare(link.trainId, link.routeId || '');
    } catch { /* treat as stopped */ }
    slowToast.cancel();

    if (share.status !== 'live') {
        clearLiveTrainFollow();
        if (typeof window.showToast === 'function') {
            window.showToast(
                share.status === 'offline'
                    ? `Could not check Train ${link.trainId} right now`
                    : `Train ${link.trainId} is no longer being shared`,
                'info',
                5000
            );
        }
        if (typeof window.trackAnalyticsEvent === 'function' && !isSeoAppHandoff(link)) {
            window.trackAnalyticsEvent('deep_link_open', {
                type: 'live',
                train_id: link.trainId,
                route_id: link.routeId || '',
                live_state: share.status,
                region_id: route?.region || '',
            });
        }
        noteDeeplinkSurface('home', { loadDefaults: false });
        return true;
    }

    setLiveTrainFollow({
        trainId: link.trainId,
        routeId: link.routeId || '',
        dest: link.dest || '',
    });
    if (typeof window.switchTab === 'function') {
        window.switchTab('map');
    }
    noteDeeplinkSurface('map', { loadDefaults: false });
    try {
        const map = await import('./map-tab.js');
        await map.focusTrainOnMap?.(link.trainId, {
            routeId: link.routeId || '',
            dest: link.dest || '',
            viewed: true,
        });
    } catch { /* map optional */ }
    if (typeof window.trackAnalyticsEvent === 'function' && !isSeoAppHandoff(link)) {
        window.trackAnalyticsEvent('deep_link_open', {
            type: 'live',
            train_id: link.trainId,
            route_id: link.routeId || '',
            live_state: 'live',
            region_id: route?.region || '',
        });
    }
    if (typeof window.showToast === 'function') {
        const dest = String(link.dest || '').replace(/\s+STATION$/i, '').trim();
        window.showToast(dest
            ? `Following Train ${link.trainId} toward ${dest}`
            : `Following Train ${link.trainId}`, 'success', 2800);
    }
    return true;
}

function contentLinkFromPage() {
    const snap = peekShareDeeplinkSnapshot();
    if (snap && (snap.kind === 'alert' || snap.kind === 'community')) return snap;
    if (typeof location === 'undefined') return null;
    return parseContentDeepLink({ search: location.search, hash: location.hash, pathname: location.pathname });
}

function armContentEntry(surface) {
    lockShareBoot();
    const slowToast = armSlowDeeplinkToast('Still opening this link');
    stripShareParamsFromUrl();
    noteDeeplinkSurface(surface);
    return slowToast;
}

/** Open the notice a shared alert link points at, and say so. */
export async function applyAlertDeepLink() {
    if (typeof window === 'undefined') return false;
    const link = contentLinkFromPage();
    if (!link || link.kind !== 'alert') return false;
    const snap = peekShareDeeplinkSnapshot();
    if (snap && snap.kind === 'alert') consumeShareDeeplinkSnapshot();
    if (typeof window.switchTab === 'function') window.switchTab('next-train');
    const slowToast = armContentEntry('alerts');
    let state = 'gone';
    try {
        const alerts = await import('./alerts-channel.js');
        state = await alerts.focusSharedAlert?.(link.id, link.source || '');
    } catch { /* gone */ }
    slowToast.cancel();
    if (state !== 'opened') noteDeeplinkSurface('home', { loadDefaults: false });
    if (typeof window.showToast === 'function') {
        window.showToast(
            state === 'opened' ? 'Opened service update' : 'This update is no longer available',
            state === 'opened' ? 'success' : 'info',
            state === 'opened' ? 2500 : 4000
        );
    }
    return true;
}

/** Open the community message a shared link points at. The room toasts if it is gone. */
export async function applyCommunityDeepLink() {
    if (typeof window === 'undefined') return false;
    const link = contentLinkFromPage();
    if (!link || link.kind !== 'community') return false;
    const snap = peekShareDeeplinkSnapshot();
    if (snap && snap.kind === 'community') consumeShareDeeplinkSnapshot();
    const slowToast = armContentEntry('community');
    let allowed = false;
    try {
        const chrome = await import('./admin-chrome.js');
        allowed = chrome.canAccessPilotSurface?.('community') !== false;
    } catch { allowed = true; }
    if (!allowed) {
        slowToast.cancel();
        noteDeeplinkSurface('home', { loadDefaults: false });
        if (typeof window.switchTab === 'function') window.switchTab('next-train');
        if (typeof window.showToast === 'function') {
            window.showToast('Community is not available', 'info', 4000);
        }
        return true;
    }
    try {
        const community = await import('./community.js');
        community.queueCommunityFocus?.(link.routeId, link.postId, { announce: true });
        if (typeof window.switchTab === 'function') window.switchTab('community');
        else community.openRouteCommunity?.({ routeId: link.routeId });
    } catch {
        if (typeof window.showToast === 'function') {
            window.showToast('This message is no longer available', 'info', 4000);
        }
    }
    slowToast.cancel();
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

    const slowToast = armSlowDeeplinkToast('Still opening this link');

    stripShareParamsFromUrl();

    const openTab = () => {
        if (typeof window.switchTab !== 'function' || !document.getElementById('view-map')) return false;
        window.switchTab('map');
        if (typeof window.trackAnalyticsEvent === 'function' && !isSeoAppHandoff()) {
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
        if (typeof window.trackAnalyticsEvent === 'function' && !isSeoAppHandoff()) {
            window.trackAnalyticsEvent('deep_link_open', { type: 'map' });
        }
        if (typeof window.showToast === 'function') {
            window.showToast('Opened shared network map', 'success', 2000);
        }
        return true;
    };

    if (openTab() || openModal()) {
        noteDeeplinkSurface('map', { loadDefaults: false });
        slowToast.cancel();
        return true;
    }
    await new Promise((r) => setTimeout(r, 120));
    const opened = openTab() || openModal();
    if (opened) noteDeeplinkSurface('map', { loadDefaults: false });
    slowToast.cancel();
    return opened;
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

        const communityHash = hash === '#community' || hash.startsWith('#community/');
        const alertsHash = hash === '#alerts' || hash.startsWith('#alerts/');
        if (sameDoc && (isLegalHash(hash) || hash === '#fare' || hash === '#planner' || hash === '#planner-results' || communityHash || hash === '#map' || hash === '#prasa-map' || alertsHash)) {
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
            if (hash === '#community' || hash.startsWith('#community/')) {
                const parts = hash.slice('#community'.length).split('/').filter(Boolean).map((part) => {
                    try { return decodeURIComponent(part); } catch { return part; }
                });
                import('./community.js').then((m) => {
                    if (parts[0] && parts[1]) m.queueCommunityFocus?.(parts[0], parts[1], { announce: true });
                    else if (parts[0]) m.queueCommunityFocus?.(parts[0], '');
                    if (typeof window.switchTab === 'function') window.switchTab('community');
                }).catch(() => {
                    if (typeof window.switchTab === 'function') window.switchTab('community');
                });
                if (location.hash !== hash) history.pushState({ tab: 'community' }, '', hash);
                return;
            }
            if (hash === '#map') {
                if (typeof window.switchTab === 'function') window.switchTab('map');
                return;
            }
            if (hash === '#prasa-map') {
                if (location.hash !== '#prasa-map') history.pushState({ modal: 'map' }, '', '#prasa-map');
                if (typeof window.openSmoothModal === 'function') window.openSmoothModal('map-modal');
                return;
            }
            if (hash === '#alerts' || hash.startsWith('#alerts/')) {
                const noticeId = hash.startsWith('#alerts/')
                    ? (() => { try { return decodeURIComponent(hash.slice('#alerts/'.length)); } catch { return hash.slice('#alerts/'.length); } })()
                    : '';
                if (noticeId) {
                    import('./alerts-channel.js').then(async (m) => {
                        const state = await m.focusSharedAlert?.(noticeId, '');
                        if (typeof window.showToast === 'function') {
                            window.showToast(
                                state === 'opened' ? 'Opened service update' : 'This update is no longer available',
                                state === 'opened' ? 'success' : 'info',
                                state === 'opened' ? 2500 : 4000
                            );
                        }
                    }).catch(() => {
                        if (typeof window.showToast === 'function') {
                            window.showToast('This update is no longer available', 'info', 4000);
                        }
                    });
                    return;
                }
                whenSettledForAutoNotices(() => {
                    if (typeof window.openAlertsChannel === 'function') {
                        window.openAlertsChannel({ highlightId: null, focusTop: false });
                    }
                });
                return;
            }
        }

        location.assign(url.href);
    }, true);
}
