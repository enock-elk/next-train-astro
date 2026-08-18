/**
 * CleverAds — contained top slot (SPA Guardian armor, Astro-safe).
 *
 * Why SPA ads look "tall then shrink": Clever's sticky creative ships its own
 * expand/collapse chrome (chevron). That is not Next Train UI. We contain the
 * host slot so it cannot cover onboarding or go fullscreen.
 *
 * Page-load inject schedule (after app stabilized):
 *   1/4 immediate · 2/4 +30s · 3/4 +1min · 4/4 +2min · then stop for this page load.
 * A refresh / new navigation starts a fresh 4-slot budget (in-memory only).
 */
import { safeStorage } from './utils.js';
import { isReloadPending, isStableForThirdParty } from './session-stability.js';

const LOADER_ID = 'CleverCoreLoader103008';
const SCRIPT_SRC = 'https://scripts.cleverwebserver.com/a399a0d9cfe9817e0ccd10f89b4e320a.js';
/** Soft wait for schedules / welcome; pending reloads always win until their until. */
const STABILITY_MAX_WAIT_MS = 15000;
/** Four timed inject attempts after stabilize, then stop until the next page load. */
const AD_INJECT_SCHEDULE_MS = [0, 30_000, 60_000, 120_000];
const AD_PAGE_INJECT_CAP = AD_INJECT_SCHEDULE_MS.length;
/** Legacy sticky key — cleared on boot so old tabs do not keep cancelling ads. */
const AD_LEGACY_SESSION_INJECT_KEY = 'nt_ad_session_injects';

let stabilityWaitStartedAt = 0;
/** Resets automatically on full page load (module re-eval). Not persisted. */
let pageInjectCount = 0;

function getPageInjectCount() {
    return pageInjectCount;
}

function bumpPageInjectCount() {
    pageInjectCount += 1;
    return pageInjectCount;
}

function pageInjectCapReached() {
    return pageInjectCount >= AD_PAGE_INJECT_CAP;
}

function clearLegacySessionInjectCap() {
    try { sessionStorage.removeItem(AD_LEGACY_SESSION_INJECT_KEY); } catch { /* ignore */ }
}

function isWelcomeActive() {
    const welcome = document.getElementById('welcome-modal');
    return welcome && !welcome.classList.contains('hidden');
}

function isSafeZone() {
    if (safeStorage.getItem('welcomeSeen') !== 'true') return false;
    if (isWelcomeActive()) return false;
    if (document.body.classList.contains('modal-active')) return false;

    const hash = location.hash || '';
    const mainOk = hash === '' || hash === '#home' || hash === '#planner' || hash === '#planner-results';
    if (!mainOk) return false;

    const blocked = ['map-modal', 'trip-map-modal', 'full-schedule-modal', 'about-modal', 'blackbox-modal'];
    for (const id of blocked) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) return false;
    }
    return true;
}

/** True when we should not treat the app as ready to start the ad schedule. */
function shouldDeferForSessionStability() {
    if (isReloadPending()) return true;

    if (isStableForThirdParty()) {
        stabilityWaitStartedAt = 0;
        return false;
    }

    if (!stabilityWaitStartedAt) stabilityWaitStartedAt = Date.now();
    if (Date.now() - stabilityWaitStartedAt >= STABILITY_MAX_WAIT_MS) {
        console.log('🛡️ Guardian: Ad stability wait capped — starting inject schedule after max wait.');
        return false;
    }
    return true;
}

function setAdPadding(_on) {
    // Ads overlay from the top. Never push the board or footer down.
    document.querySelectorAll('.view-section').forEach((el) => {
        el.classList.remove('ad-active-padding');
    });
    try {
        document.body.classList.remove('nt-ads-ready');
    } catch { /* ignore */ }
}

const APP_CHROME_IDS = new Set([
    'clever-core', 'offline-toast', 'sidenav', 'sidenav-overlay', 'welcome-modal',
    'global-dropdown-scrim', 'toast', 'settings-modal', 'map-modal', 'legal-modal',
    'help-modal', 'disruption-modal', 'route-modal', 'schedule-modal', 'profile-modal',
    'feedback-modal', 'delay-report-modal', 'about-modal', 'blackbox-modal',
    'account-modal', 'login-modal', 'dev-modal', 'developer-reply-modal',
    'network-struggle-modal', 'redirect-modal', 'region-confirm-modal', 'exit-modal',
    'schedule-override-modal', 'notice-modal', 'alerts-channel', 'loading-overlay',
    'main-content', LOADER_ID,
]);

function looksLikeStickyAd(el) {
    if (!(el instanceof Element)) return false;
    if (APP_CHROME_IDS.has(el.id) || el.id === LOADER_ID) return false;
    if (el.tagName === 'SCRIPT') return false;
    const blob = `${el.id} ${el.className}`;
    if (/clever/i.test(blob) && el.id !== 'clever-core') return true;
    if (el.tagName === 'IFRAME') return true;
    if (el.querySelector?.('iframe')) return true;
    if (el.closest?.('#clever-core')) {
        const s = getComputedStyle(el);
        return s.position === 'fixed' || s.position === 'absolute';
    }
    try {
        const s = getComputedStyle(el);
        if (s.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        const atTop = r.y <= 16;
        const notFullscreen = r.width < window.innerWidth * 0.95 && r.height < window.innerHeight * 0.65;
        const hasSize = r.width >= 120 && r.height >= 50;
        return atTop && notFullscreen && hasSize && el.parentElement === document.body;
    } catch {
        return false;
    }
}

function centerStickyNode(el) {
    if (!el || el.getAttribute('data-nt-centered') === '1') return false;
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'absolute') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return false;
    el.style.setProperty('left', '50%', 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('top', '0px', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
    el.style.setProperty('transform', 'translateX(-50%)', 'important');
    el.setAttribute('data-nt-centered', '1');
    return true;
}

function forceCenterStickyAds(adContainer) {
    if (adContainer) {
        adContainer.style.setProperty('top', '0px', 'important');
        adContainer.style.setProperty('bottom', 'auto', 'important');
        adContainer.classList.add('top-0', 'items-start');
        adContainer.classList.remove('bottom-0', 'items-end');
    }
    const centered = [];
    const consider = (el) => {
        if (!looksLikeStickyAd(el)) return;
        if (centerStickyNode(el)) centered.push(`${el.tagName}#${el.id || ''}`);
    };
    adContainer?.querySelectorAll('*').forEach(consider);
    document.querySelectorAll('iframe').forEach(consider);
    [...(document.body ? document.body.children : [])].forEach(consider);
    return centered;
}

function cloak(adContainer, fatal = false) {
    if (!adContainer) return;
    adContainer.classList.add('hidden', 'ad-cloaked');
    if (fatal) {
        adContainer.innerHTML = '';
        adContainer.style.setProperty('display', 'none', 'important');
    }
    setAdPadding(false);
}

function uncloak(adContainer) {
    if (!adContainer || window._adNetworkDestroyed) return;
    adContainer.style.display = '';
    adContainer.classList.remove('hidden', 'ad-cloaked');
}

function isAdFilled(adContainer) {
    if (adContainer && adContainer.childElementCount > 0) {
        const iframe = adContainer.querySelector('iframe');
        if (iframe) return iframe.getBoundingClientRect().height > 20;
        if (adContainer.offsetHeight > 20) return true;
    }
    const escaped = document.querySelector('[data-nt-centered="1"]');
    return !!(escaped && escaped.getBoundingClientRect().height > 20);
}

function handleAdFailure(adContainer, reason, isFatal = false) {
    console.warn(`🛡️ Guardian Ad Shield: ${reason}. Fatal: ${isFatal}`);
    if (isFatal) window._adNetworkDestroyed = true;
    window._adScriptInjected = false;
    window._adScriptLoaded = false;
    document.getElementById(LOADER_ID)?.remove();
    cloak(adContainer, isFatal);
    if (typeof window.trackAnalyticsEvent === 'function') {
        window.trackAnalyticsEvent('ad_shield_triggered', { reason, fatal: isFatal });
    }
}

function injectAdScript(adContainer) {
    if (window._adNetworkDestroyed || window._adScriptInjected || !adContainer) return false;
    if (pageInjectCapReached()) {
        console.log('🛡️ Guardian: Ad page inject cap reached — skipping further injects until next load.');
        cloak(adContainer, true);
        return false;
    }
    const attempt = bumpPageInjectCount();
    window._adScriptInjected = true;

    const adTimeout = setTimeout(() => {
        if (!window._adScriptLoaded) handleAdFailure(adContainer, 'TIMEOUT_15S_EXCEEDED', false);
    }, 15000);

    try {
        const c = document.createElement('script');
        c.id = LOADER_ID;
        c.src = SCRIPT_SRC;
        c.async = true;
        c.type = 'text/javascript';
        try {
            const f = window.frameElement;
            c.setAttribute('data-target', window.name || (f && f.getAttribute('id')) || '');
        } catch {
            c.setAttribute('data-target', window.name || '');
        }
        c.onerror = () => {
            clearTimeout(adTimeout);
            handleAdFailure(adContainer, 'SCRIPT_LOAD_ERROR', false);
        };
        c.onload = () => {
            clearTimeout(adTimeout);
            window._adScriptLoaded = true;
            console.log(`🛡️ Guardian: Ad script initialized (${attempt}/${AD_PAGE_INJECT_CAP}).`);
            if (adContainer.classList.contains('ad-cloaked') && !window._adNetworkDestroyed && isSafeZone()) {
                uncloak(adContainer);
                setAdPadding(isAdFilled(adContainer));
            }
            forceCenterStickyAds(adContainer);
        };
        adContainer.appendChild(c);
        return true;
    } catch (e) {
        console.warn('🛡️ Guardian: Ad inject suppressed', e);
        handleAdFailure(adContainer, 'EVAL_EXCEPTION', false);
        return false;
    }
}

function refreshAdVisibility(adContainer) {
    if (window._adNetworkDestroyed || !adContainer) return;

    if (!isSafeZone()) {
        cloak(adContainer, false);
        return;
    }

    if (shouldDeferForSessionStability()) {
        cloak(adContainer, false);
        return;
    }

    uncloak(adContainer);
    forceCenterStickyAds(adContainer);
    const filled = isAdFilled(adContainer);
    if (filled) {
        adContainer.style.pointerEvents = 'auto';
        setAdPadding(false);
        if (!window._adTelemetryFired) {
            window._adTelemetryFired = true;
            if (typeof window.trackAnalyticsEvent === 'function') {
                window.trackAnalyticsEvent('view_clever_ad', { location: 'main_dashboard', verified: 'filled' });
            }
        }
    } else {
        adContainer.style.pointerEvents = 'none';
        setAdPadding(false);
    }
}

export function initCleverAds() {
    if (typeof window === 'undefined' || window.__ntCleverAdsBound) return;
    window.__ntCleverAdsBound = true;

    const adContainer = document.getElementById('clever-core');
    if (!adContainer) return;

    forceCenterStickyAds(adContainer);
    if (window.MutationObserver) {
        const escapedObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node.id === 'clever-core' || APP_CHROME_IDS.has(node.id)) continue;
                    if (!looksLikeStickyAd(node) && node.tagName !== 'IFRAME' && !node.querySelector?.('iframe')) continue;
                    forceCenterStickyAds(adContainer);
                    return;
                }
            }
        });
        escapedObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Drop sticky tab budget from older builds so refresh always gets a clean 4/4
    clearLegacySessionInjectCap();
    pageInjectCount = 0;

    window._adNetworkDestroyed = false;
    window._adScriptInjected = false;
    window._adScriptLoaded = false;
    window._adTelemetryFired = false;

    let stabilizedAt = 0;
    let nextScheduleIndex = 0;
    let scheduleTimer = null;
    let scheduleStarted = false;
    let scheduleExhausted = false;

    if (window.MutationObserver) {
        const adObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'style') {
                    const style = adContainer.getAttribute('style') || '';
                    if (style.includes('height: 100vh')) {
                        if (!window._rogueAdCheckPending) {
                            window._rogueAdCheckPending = true;
                            setTimeout(() => {
                                window._rogueAdCheckPending = false;
                                const cur = adContainer.getAttribute('style') || '';
                                if (cur.includes('height: 100vh')) {
                                    adObserver.disconnect();
                                    handleAdFailure(adContainer, 'ROGUE_FULLSCREEN_TAKEOVER', true);
                                }
                            }, 500);
                        }
                        break;
                    }
                }
                if (m.type === 'childList') {
                    forceCenterStickyAds(adContainer);
                }
                if (!window._adTelemetryFired && m.type === 'childList' && isAdFilled(adContainer) && isSafeZone()) {
                    window._adTelemetryFired = true;
                    uncloak(adContainer);
                    setAdPadding(false);
                    if (typeof window.trackAnalyticsEvent === 'function') {
                        window.trackAnalyticsEvent('view_clever_ad', { location: 'main_dashboard', verified: 'instant_tripwire' });
                    }
                }
            }
        });
        adObserver.observe(adContainer, { attributes: true, childList: true, subtree: true });
    }

    const stopSchedule = (reason) => {
        scheduleExhausted = true;
        if (scheduleTimer) {
            clearTimeout(scheduleTimer);
            scheduleTimer = null;
        }
        if (reason) console.log(`🛡️ Guardian: Ad inject schedule stopped (${reason}).`);
    };

    /** Run one schedule slot; only then advance. Retries same slot while unsafe. */
    const runScheduledInject = (attemptNo, onComplete) => {
        if (window._adNetworkDestroyed || scheduleExhausted) {
            onComplete();
            return;
        }
        if (pageInjectCapReached()) {
            cloak(adContainer, true);
            stopSchedule('page cap');
            onComplete();
            return;
        }
        if (window._adTelemetryFired || isAdFilled(adContainer)) {
            refreshAdVisibility(adContainer);
            stopSchedule(`filled after ${Math.max(0, attemptNo - 1)}/${AD_PAGE_INJECT_CAP}`);
            onComplete();
            return;
        }
        if (!isSafeZone() || shouldDeferForSessionStability()) {
            scheduleTimer = setTimeout(() => runScheduledInject(attemptNo, onComplete), 1500);
            return;
        }

        window._adScriptInjected = false;
        window._adScriptLoaded = false;
        document.getElementById(LOADER_ID)?.remove();

        console.log(`🛡️ Guardian: Ad inject ${attemptNo}/${AD_PAGE_INJECT_CAP} (T+${AD_INJECT_SCHEDULE_MS[attemptNo - 1] / 1000}s after stabilize)`);
        injectAdScript(adContainer);
        refreshAdVisibility(adContainer);
        onComplete();
    };

    const armNextScheduleSlot = () => {
        if (window._adNetworkDestroyed || scheduleExhausted) return;
        if (window._adTelemetryFired || isAdFilled(adContainer)) {
            stopSchedule('already filled');
            return;
        }
        // Prefer "4/4 complete" over "page cap" — cap after the last slot is expected, not a 5th try
        if (nextScheduleIndex >= AD_INJECT_SCHEDULE_MS.length || pageInjectCapReached()) {
            stopSchedule(pageInjectCapReached() && nextScheduleIndex < AD_INJECT_SCHEDULE_MS.length
                ? 'page cap'
                : '4/4 complete');
            return;
        }

        const delayFromStabilize = AD_INJECT_SCHEDULE_MS[nextScheduleIndex];
        const attemptNo = nextScheduleIndex + 1;
        const waitMs = Math.max(0, (stabilizedAt + delayFromStabilize) - Date.now());
        nextScheduleIndex += 1;

        scheduleTimer = setTimeout(() => {
            scheduleTimer = null;
            runScheduledInject(attemptNo, () => {
                if (scheduleExhausted || window._adNetworkDestroyed) return;
                // Last slot: stop here. Do not arm a 5th slot (async SCRIPT_LOAD_ERROR
                // from this attempt may still log after "stopped" — that is not a new inject).
                if (attemptNo >= AD_PAGE_INJECT_CAP) {
                    stopSchedule('4/4 complete');
                    return;
                }
                armNextScheduleSlot();
            });
        }, waitMs);
    };

    const startInjectSchedule = () => {
        if (scheduleStarted || window._adNetworkDestroyed || scheduleExhausted) return;
        if (shouldDeferForSessionStability()) return;
        scheduleStarted = true;
        stabilizedAt = Date.now();
        setAdPadding(false);
        console.log('🛡️ Guardian: Ad inject schedule armed (1/4 now, 2/4 +30s, 3/4 +1m, 4/4 +2m).');
        armNextScheduleSlot();
    };

    window.checkAndUnhide = () => {
        refreshAdVisibility(adContainer);
        startInjectSchedule();
    };

    // Poll until stabilized, then the schedule owns further injects.
    let ticks = 0;
    const waitForStabilize = () => {
        ticks += 1;
        refreshAdVisibility(adContainer);
        if (!scheduleStarted) startInjectSchedule();
        if (scheduleStarted || window._adNetworkDestroyed || scheduleExhausted) return;
        if (ticks < 80) setTimeout(waitForStabilize, shouldDeferForSessionStability() ? 500 : 1000);
    };
    setTimeout(waitForStabilize, 1500);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        refreshAdVisibility(adContainer);
        if (!scheduleStarted) startInjectSchedule();
    });
}
