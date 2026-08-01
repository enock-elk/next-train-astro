/**
 * CleverAds — contained bottom slot (SPA Guardian armor, Astro-safe).
 *
 * Why SPA ads look "tall then shrink": Clever's sticky creative ships its own
 * expand/collapse chrome (chevron). That is not Next Train UI. We contain the
 * host slot so it cannot cover onboarding or go fullscreen.
 *
 * Startup reloads: defer inject while a queued refresh is pending or the app
 * has not stabilized — with a hard max wait so ads are never held forever.
 */
import { safeStorage } from './utils.js';
import { isReloadPending, isStableForThirdParty } from './session-stability.js';

const LOADER_ID = 'CleverCoreLoader103008';
const SCRIPT_SRC = 'https://scripts.cleverwebserver.com/a399a0d9cfe9817e0ccd10f89b4e320a.js';
/** Soft wait for schedules / welcome; pending reloads always win until their until. */
const STABILITY_MAX_WAIT_MS = 15000;

let stabilityWaitStartedAt = 0;

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

/** True when we should not inject yet (queued reload or not stabilized). */
function shouldDeferForSessionStability() {
    // Imminent navigation: always defer until the mark expires (never forever).
    if (isReloadPending()) return true;

    if (isStableForThirdParty()) {
        stabilityWaitStartedAt = 0;
        return false;
    }

    if (!stabilityWaitStartedAt) stabilityWaitStartedAt = Date.now();
    if (Date.now() - stabilityWaitStartedAt >= STABILITY_MAX_WAIT_MS) {
        console.log('🛡️ Guardian: Ad stability wait capped — injecting after max wait.');
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
    if (isFatal) document.getElementById(LOADER_ID)?.remove();
    cloak(adContainer, isFatal);
    if (typeof window.trackAnalyticsEvent === 'function') {
        window.trackAnalyticsEvent('ad_shield_triggered', { reason, fatal: isFatal });
    }
}

function injectAdScript(adContainer) {
    if (window._adNetworkDestroyed || window._adScriptInjected || !adContainer) return;
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
            console.log('🛡️ Guardian: Ad script initialized.');
            if (adContainer.classList.contains('ad-cloaked') && !window._adNetworkDestroyed && isSafeZone()) {
                uncloak(adContainer);
                setAdPadding(isAdFilled(adContainer));
            }
        };
        // Mount inside container so the network anchors here, not <head>
        adContainer.appendChild(c);
    } catch (e) {
        console.warn('🛡️ Guardian: Ad inject suppressed', e);
        handleAdFailure(adContainer, 'EVAL_EXCEPTION', false);
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

    if (!window._adScriptInjected && !window._adScriptLoaded) {
        injectAdScript(adContainer);
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

    window.checkAndUnhide = () => refreshAdVisibility(adContainer);

    // Poll until welcome completes / route ready / pending reload clears, then settle.
    // While deferring for stability, retry faster so we inject soon after stabilize.
    let ticks = 0;
    const tick = () => {
        ticks += 1;
        const wasDeferring = shouldDeferForSessionStability();
        refreshAdVisibility(adContainer);
        if (window._adTelemetryFired || window._adNetworkDestroyed) return;
        if (window._adScriptInjected && window._adScriptLoaded) return;
        if (ticks < 60) setTimeout(tick, wasDeferring || shouldDeferForSessionStability() ? 500 : 3000);
    };
    setTimeout(tick, 1500);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshAdVisibility(adContainer);
    });
}
