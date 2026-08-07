/**
 * CleverAds — contained bottom slot (SPA Guardian armor, Astro-safe).
 *
 * Why SPA ads look "tall then shrink": Clever's sticky creative ships its own
 * expand/collapse chrome (chevron). That is not Next Train UI. We contain the
 * host slot so it cannot cover onboarding or go fullscreen.
 *
 * Session inject schedule (after app stabilized):
 *   1/4 immediate · 2/4 +30s · 3/4 +1min · 4/4 +2min · then stop for the session.
 */
import { safeStorage } from './utils.js';
import { isReloadPending, isStableForThirdParty } from './session-stability.js';

const LOADER_ID = 'CleverCoreLoader103008';
const SCRIPT_SRC = 'https://scripts.cleverwebserver.com/a399a0d9cfe9817e0ccd10f89b4e320a.js';
/** Soft wait for schedules / welcome; pending reloads always win until their until. */
const STABILITY_MAX_WAIT_MS = 15000;
/** Four timed inject attempts after stabilize, then hard stop for the tab session. */
const AD_INJECT_SCHEDULE_MS = [0, 30_000, 60_000, 120_000];
const AD_SESSION_INJECT_CAP = AD_INJECT_SCHEDULE_MS.length;
const AD_SESSION_INJECT_KEY = 'nt_ad_session_injects';

let stabilityWaitStartedAt = 0;

function getSessionInjectCount() {
    try {
        return Math.max(0, parseInt(sessionStorage.getItem(AD_SESSION_INJECT_KEY) || '0', 10) || 0);
    } catch {
        return 0;
    }
}

function bumpSessionInjectCount() {
    try {
        sessionStorage.setItem(AD_SESSION_INJECT_KEY, String(getSessionInjectCount() + 1));
    } catch { /* ignore */ }
}

function sessionInjectCapReached() {
    return getSessionInjectCount() >= AD_SESSION_INJECT_CAP;
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

function setAdPadding(on) {
    document.querySelectorAll('.view-section').forEach((el) => {
        el.classList.toggle('ad-active-padding', !!on);
    });
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
    if (!adContainer || adContainer.childElementCount === 0) return false;
    const iframe = adContainer.querySelector('iframe');
    if (iframe) return iframe.getBoundingClientRect().height > 20;
    return adContainer.offsetHeight > 20;
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
    if (sessionInjectCapReached()) {
        console.log('🛡️ Guardian: Ad session inject cap reached — skipping further injects.');
        window._adNetworkDestroyed = true;
        cloak(adContainer, true);
        return false;
    }
    bumpSessionInjectCount();
    const attempt = getSessionInjectCount();
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
            console.log(`🛡️ Guardian: Ad script initialized (${attempt}/${AD_SESSION_INJECT_CAP}).`);
            if (adContainer.classList.contains('ad-cloaked') && !window._adNetworkDestroyed && isSafeZone()) {
                uncloak(adContainer);
                setAdPadding(isAdFilled(adContainer));
            }
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
    const filled = isAdFilled(adContainer);
    if (filled) {
        adContainer.style.pointerEvents = 'auto';
        setAdPadding(true);
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
                    if (style.includes('height: 100vh') || style.includes('height: 100%') || style.includes('position: fixed; top: 0')) {
                        if (!window._rogueAdCheckPending) {
                            window._rogueAdCheckPending = true;
                            setTimeout(() => {
                                window._rogueAdCheckPending = false;
                                const cur = adContainer.getAttribute('style') || '';
                                if (cur.includes('height: 100vh') || cur.includes('height: 100%') || cur.includes('position: fixed; top: 0')) {
                                    adObserver.disconnect();
                                    handleAdFailure(adContainer, 'ROGUE_FULLSCREEN_TAKEOVER', true);
                                }
                            }, 500);
                        }
                        break;
                    }
                }
                if (!window._adTelemetryFired && m.type === 'childList' && isAdFilled(adContainer) && isSafeZone()) {
                    window._adTelemetryFired = true;
                    uncloak(adContainer);
                    setAdPadding(true);
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
        if (sessionInjectCapReached()) {
            window._adNetworkDestroyed = true;
            cloak(adContainer, true);
            stopSchedule('session cap');
            onComplete();
            return;
        }
        if (window._adTelemetryFired || isAdFilled(adContainer)) {
            refreshAdVisibility(adContainer);
            stopSchedule(`filled after ${Math.max(0, attemptNo - 1)}/${AD_SESSION_INJECT_CAP}`);
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

        console.log(`🛡️ Guardian: Ad inject ${attemptNo}/${AD_SESSION_INJECT_CAP} (T+${AD_INJECT_SCHEDULE_MS[attemptNo - 1] / 1000}s after stabilize)`);
        injectAdScript(adContainer);
        refreshAdVisibility(adContainer);
        onComplete();
    };

    const armNextScheduleSlot = () => {
        if (window._adNetworkDestroyed || scheduleExhausted) return;
        if (sessionInjectCapReached()) {
            stopSchedule('session cap');
            return;
        }
        if (window._adTelemetryFired || isAdFilled(adContainer)) {
            stopSchedule('already filled');
            return;
        }
        if (nextScheduleIndex >= AD_INJECT_SCHEDULE_MS.length) {
            stopSchedule('4/4 complete');
            return;
        }

        const delayFromStabilize = AD_INJECT_SCHEDULE_MS[nextScheduleIndex];
        const attemptNo = nextScheduleIndex + 1;
        const waitMs = Math.max(0, (stabilizedAt + delayFromStabilize) - Date.now());
        nextScheduleIndex += 1;

        scheduleTimer = setTimeout(() => {
            scheduleTimer = null;
            runScheduledInject(attemptNo, () => {
                if (!scheduleExhausted && !window._adNetworkDestroyed) armNextScheduleSlot();
            });
        }, waitMs);
    };

    const startInjectSchedule = () => {
        if (scheduleStarted || window._adNetworkDestroyed || scheduleExhausted) return;
        if (shouldDeferForSessionStability()) return;
        scheduleStarted = true;
        stabilizedAt = Date.now();
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
