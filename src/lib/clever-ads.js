/**
 * CleverAds — vendor snippet (SPA Guardian timing, Astro-safe).
 *
 * Clever’s tag is SCRIPT#clever-core. The original IIFE insertBefore()s
 * CleverCoreLoader103008 next to the first page script. Guardian only decides
 * WHEN to call that IIFE (welcome / safe-zone / 4-slot schedule). Do not steal
 * #clever-core for a positioned DIV and do not set left/top/transform on their
 * overlays. Top units (Clever pushdown: wrapper + iframe + vendor Close.png)
 * dock into #nt-ad-scroll-host as one piece so they sit in the Next Train
 * frame and scroll away with the board. Keep the vendor X; do not disable
 * pointer-events on the unit. Scroll-away is not dismiss: a live
 * unit that has left the viewport must stay occupied. Never move a wrapper
 * that already has a loaded iframe (reparenting reloads the creative).
 * Already-painted units stay document-level and the whole wrapper follows
 * #app-scroll via CSS `translate` (not transform) plus a host spacer.
 * Do not transform #nt-shell itself (it wraps position:fixed overlays).
 *
 * A leftover top gap after the creative is gone is a bug: measure occupancy
 * (not just the wrapper box), reclaim idle leftovers, and re-sync on resume,
 * scroll-return, and while a shift or docked slot is still applied. Cloak
 * visibility must not count as “filled” for board shift. Off-screen due to
 * scroll must still count as occupied.
 *
 * Page-load inject schedule (after app stabilized):
 *   1/4 immediate · 2/4 +30s · 3/4 +1min · 4/4 +2min · then stop for this page load.
 */
import { safeStorage } from './utils.js';
import { isReloadPending, isStableForThirdParty } from './session-stability.js';
import { createIframeLoadGate, topLevelAdNodes } from './clever-ad-lifecycle.js';

const LOADER_ID = 'CleverCoreLoader103008';
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
/** True after the commuter has seen the board with no filled ad (uncloaked). */
let userSawEmptyBoard = false;
let prevOverlayH = 0;
let prevInFlowH = 0;
let adShellSyncRaf = 0;
/** True while we hide the unit, ease the shell, then reveal (entrance only). */
let adEntering = false;
let shellMotionLock = false;
let shellMotionUnlockTimer = 0;
/** Collapse leftover gap instantly after background/resume (no second ease). */
let adResumeInstant = false;
let adResumePassTimer = 0;
/** Same-session: vendor may empty a sticky unit without resize/visibilitychange. */
let adScrollSyncTimer = 0;
const AD_SCROLL_SYNC_MS = 200;
let adOccupancyWatchTimer = 0;
const AD_OCCUPANCY_WATCH_MS = 2000;
const observedOverlayNodes = new Set();
let overlayResizeObserver = null;
const AD_SHELL_EASE_MS = 420;

const iframeLoadGate = createIframeLoadGate((frame) => {
    let parent = frame?.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
        parent.removeAttribute('data-nt-ad-idle');
        parent = parent.parentElement;
    }
    afterPaint(requestAdShellSync);
});

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

    const blocked = ['map-modal', 'trip-map-modal', 'full-schedule-modal', 'about-modal', 'blackbox-modal', 'account-modal'];
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
    // Ads overlay. Never push the board or footer down.
    document.querySelectorAll('.view-section').forEach((el) => {
        el.classList.remove('ad-active-padding');
    });
    try {
        document.body.classList.remove('nt-ads-ready');
    } catch { /* ignore */ }
}

function cleverOverlayNodes() {
    const out = [];
    const seen = new Set();
    const add = (el) => {
        if (!el || seen.has(el) || el.id === 'clever-core' || el.id === LOADER_ID || el.tagName === 'SCRIPT') return;
        if (el.id === 'nt-shell' || el.id === 'offline-toast' || el.id === 'main-content') return;
        if (el.id === 'nt-ad-scroll-host' || el.id === 'app-scroll') return;
        seen.add(el);
        out.push(el);
    };
    document.querySelectorAll('[id*="lever" i], [class*="lever" i]').forEach(add);
    document.querySelectorAll('iframe').forEach((el) => {
        const src = el.getAttribute('src') || '';
        if (/clever/i.test(src) || el.closest('[id*="lever" i], [class*="lever" i]')) {
            iframeLoadGate.observe(el);
            add(el);
        }
    });
    return topLevelAdNodes(out);
}

function prefersReducedMotion() {
    try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
        return false;
    }
}

function isAdsCloaked() {
    return document.documentElement.classList.contains('nt-ads-cloaked');
}

function isOurAdHideActive() {
    const html = document.documentElement;
    return html.classList.contains('nt-ads-cloaked') || html.classList.contains('nt-ads-entering');
}

function markResumeInstant() {
    adResumeInstant = true;
}

function consumeResumeInstant() {
    const next = adResumeInstant;
    adResumeInstant = false;
    return next;
}

function adScrollHost() {
    return document.getElementById('nt-ad-scroll-host');
}

function isInAppAdHost(el) {
    return !!(el && el.closest && el.closest('#nt-ad-scroll-host'));
}

function outermostMovableAdNode(el) {
    let cur = el;
    while (cur.parentElement) {
        const p = cur.parentElement;
        if (p === document.body || p === document.documentElement) break;
        if (p.id === 'nt-ad-scroll-host' || p.id === 'app-scroll'
            || p.id === 'main-content' || p.id === 'nt-shell') break;
        cur = p;
    }
    return cur;
}

function isBottomOrSideOverlay(el) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    return el.getBoundingClientRect().top > 64;
}

function nodeHasLoadedCreative(el) {
    if (!el) return false;
    if (el.tagName === 'IFRAME') return iframeLoadGate.isLoaded(el);
    const frames = el.querySelectorAll ? el.querySelectorAll('iframe') : [];
    for (const frame of frames) {
        if (iframeLoadGate.isLoaded(frame)) return true;
    }
    return false;
}

/** Park a top unit in the phone frame before its iframe loads. Never move a live creative. */
function dockAdsIntoAppScroll() {
    const host = adScrollHost();
    if (!host) return false;
    let moved = false;
    cleverOverlayNodes().forEach((el) => {
        if (host.contains(el)) return;
        if (isBottomOrSideOverlay(el)) return;
        const move = outermostMovableAdNode(el);
        if (!move || host.contains(move) || move === host) return;
        if (move.id === 'nt-shell' || move.id === 'main-content' || move.id === 'app-scroll') return;
        if (nodeHasLoadedCreative(move)) return;
        host.appendChild(move);
        move.setAttribute('data-nt-ad-docked', '1');
        move.classList.remove('nt-ad-undocked');
        moved = true;
    });
    if (host.childElementCount) host.removeAttribute('aria-hidden');
    else host.setAttribute('aria-hidden', 'true');
    return moved;
}

function appScrollEl() {
    return document.getElementById('app-scroll');
}

function clearUndockedFollowers() {
    document.querySelectorAll('.nt-ad-undocked').forEach((el) => {
        el.classList.remove('nt-ad-undocked');
    });
}

function markUndockedFollowers(follow) {
    if (!follow) {
        clearUndockedFollowers();
        return;
    }
    const host = adScrollHost();
    cleverOverlayNodes().forEach((el) => {
        const move = outermostMovableAdNode(el);
        if (!move || (host && host.contains(move)) || isBottomOrSideOverlay(move)) {
            el.classList.remove('nt-ad-undocked');
            if (move && move !== el) move.classList.remove('nt-ad-undocked');
            return;
        }
        move.classList.add('nt-ad-undocked');
    });
}

/** Height of a top unit that is still outside #nt-ad-scroll-host (body pushdown). */
function undockedTopUnitHeight() {
    const host = adScrollHost();
    let h = 0;
    cleverOverlayNodes().forEach((el) => {
        const move = outermostMovableAdNode(el);
        if (!move || (host && host.contains(move)) || isBottomOrSideOverlay(move)) return;
        if (!unitOccupiesSpace(move, { ignoreOffscreen: true })) return;
        h = Math.max(h, move.getBoundingClientRect().height);
    });
    return h;
}

/** Already-painted units stay put; the whole wrapper (creative + vendor X) follows #app-scroll. */
function syncUndockedOverlayScroll() {
    const html = document.documentElement;
    const scroller = appScrollEl();
    const host = adScrollHost();
    const outsideH = undockedTopUnitHeight();
    const follow = outsideH > 20 && !isAdsCloaked();
    if (!follow || !scroller) {
        html.classList.remove('nt-ad-scroll-sync');
        html.style.removeProperty('--nt-ad-scroll');
        markUndockedFollowers(false);
        if (host) {
            host.classList.remove('nt-ad-slot-open');
            if (!host.childElementCount) host.style.height = '';
        }
        return;
    }
    const y = Math.max(0, scroller.scrollTop || 0);
    html.classList.add('nt-ad-scroll-sync');
    html.style.setProperty('--nt-ad-scroll', `${Math.round(-y)}px`);
    markUndockedFollowers(true);
    if (host && !host.childElementCount) {
        host.classList.add('nt-ad-slot-open');
        host.style.height = `${Math.round(outsideH)}px`;
        host.removeAttribute('aria-hidden');
    }
}

/**
 * True when the box is actually showing. Skip visibility/opacity/off-screen
 * unless `ignoreOurHide` — our cloak uses visibility:hidden and must still
 * count as an injected unit so we do not fire another schedule slot.
 * `ignoreOffscreen` is for docked / scroll-synced units: scrolled out of view
 * is not dismiss, and must not collapse the slot.
 */
function isPaintedBox(el, { ignoreOurHide = false, ignoreOffscreen = false } = {}) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return false;
    const skipHideChecks = ignoreOurHide && isOurAdHideActive();
    if (!skipHideChecks) {
        if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
        if (parseFloat(cs.opacity) < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    if (r.height <= 20 || r.width <= 20) return false;
    const skipOffscreen = ignoreOffscreen || isInAppAdHost(el);
    if (!skipHideChecks && !skipOffscreen) {
        if (r.bottom <= 1 || r.top >= window.innerHeight - 1) return false;
        if (r.right <= 1 || r.left >= window.innerWidth - 1) return false;
    }
    return true;
}

function iframeLooksAlive(iframe, paintedOpts) {
    if (!iframe || iframe.tagName !== 'IFRAME') return false;
    iframeLoadGate.observe(iframe);
    const src = String(iframe.getAttribute('src') || iframe.src || '').trim();
    if (!src || /^about:(blank|srcdoc)$/i.test(src)) return false;
    if (!iframe.isConnected) return false;
    if (!iframeLoadGate.isLoaded(iframe)) return false;
    return isPaintedBox(iframe, paintedOpts);
}

/** Wrapper with no creative (expired/discarded) must not keep a top gap. */
function unitOccupiesSpace(el, paintedOpts = {}) {
    const opts = isInAppAdHost(el)
        ? { ...paintedOpts, ignoreOffscreen: true }
        : paintedOpts;
    if (!isPaintedBox(el, opts)) return false;
    if (el.tagName === 'IFRAME') return iframeLooksAlive(el, opts);
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'CANVAS'
        || el.tagName === 'OBJECT' || el.tagName === 'EMBED') {
        return true;
    }
    const roots = [el];
    if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const root of roots) {
        const iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
        for (const frame of iframes) {
            if (iframeLooksAlive(frame, opts)) return true;
        }
        const media = root.querySelectorAll ? root.querySelectorAll('img, video, canvas, object, embed') : [];
        for (const node of media) {
            if (isPaintedBox(node, opts)) return true;
        }
    }
    for (const child of el.children) {
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE'
            || child.tagName === 'LINK' || child.tagName === 'NOSCRIPT') continue;
        if (unitOccupiesSpace(child, opts)) return true;
    }
    const cs = getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if ((el.textContent || '').trim().length > 8) return true;
    return false;
}

/** Reclaim leftover in-flow/fixed boxes without display:none or left/top/transform. */
function syncIdleAdNodes() {
    const hideActive = isOurAdHideActive();
    cleverOverlayNodes().forEach((el) => {
        // Scroll-away is not dismiss. Empty leftovers (no creative) still collapse.
        if (hideActive || unitOccupiesSpace(el, { ignoreOffscreen: true })) {
            el.removeAttribute('data-nt-ad-idle');
            return;
        }
        const cs = getComputedStyle(el);
        if (cs.display === 'none') {
            el.removeAttribute('data-nt-ad-idle');
            return;
        }
        el.setAttribute('data-nt-ad-idle', '1');
    });
}

function ntShell() {
    return document.getElementById('nt-shell');
}

function afterPaint(fn) {
    requestAnimationFrame(() => {
        requestAnimationFrame(fn);
    });
}

function lockShellMotion(ms = AD_SHELL_EASE_MS + 80) {
    shellMotionLock = true;
    if (shellMotionUnlockTimer) clearTimeout(shellMotionUnlockTimer);
    shellMotionUnlockTimer = setTimeout(() => {
        shellMotionLock = false;
        adEntering = false;
        document.documentElement.classList.remove('nt-ads-entering');
        shellMotionUnlockTimer = 0;
        requestAdShellSync();
    }, ms);
}

function currentShellShift() {
    const shell = ntShell();
    if (!shell) return 0;
    const raw = getComputedStyle(shell).getPropertyValue('--nt-ad-shift');
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
}

function readShellShiftVars(shell) {
    const shift = parseFloat(shell.style.getPropertyValue('--nt-ad-shift')) || 0;
    const flip = parseFloat(shell.style.getPropertyValue('--nt-ad-flip')) || 0;
    return { shift, flip };
}

/** Drop the transform containing-block once both shift vars are 0. */
function syncNtAdShiftedClass(shell = ntShell()) {
    if (!shell) return;
    const { shift, flip } = readShellShiftVars(shell);
    shell.classList.toggle('nt-ad-shifted', Math.abs(shift) > 0.5 || Math.abs(flip) > 0.5);
}

let ntAdShiftedClearTimer = 0;
function scheduleNtAdShiftedSync(shell) {
    if (ntAdShiftedClearTimer) clearTimeout(ntAdShiftedClearTimer);
    ntAdShiftedClearTimer = window.setTimeout(() => {
        ntAdShiftedClearTimer = 0;
        syncNtAdShiftedClass(shell);
    }, AD_SHELL_EASE_MS + 40);
}

function setShellVar(name, px, animate) {
    const shell = ntShell();
    if (!shell) return;
    const numeric = Math.round(Number(px) || 0);
    const next = `${numeric}px`;
    if (numeric !== 0) shell.classList.add('nt-ad-shifted');
    if (!animate) shell.classList.add('nt-ad-no-motion');
    shell.style.setProperty(name, next);
    if (!animate) {
        void shell.offsetHeight;
        shell.classList.remove('nt-ad-no-motion');
        syncNtAdShiftedClass(shell);
        return;
    }
    scheduleNtAdShiftedSync(shell);
}

function playInFlowFlip(invertPx) {
    const shell = ntShell();
    if (!shell || !invertPx) return;
    lockShellMotion();
    shell.classList.add('nt-ad-shifted', 'nt-ad-no-motion');
    shell.style.setProperty('--nt-ad-flip', `${Math.round(invertPx)}px`);
    void shell.offsetHeight;
    afterPaint(() => {
        shell.classList.remove('nt-ad-no-motion');
        shell.style.setProperty('--nt-ad-flip', '0px');
        scheduleNtAdShiftedSync(shell);
    });
}

/** Hide the unit, paint shift 0, ease the board down, then reveal the unit. */
function beginOverlayEntrance(toH) {
    const shell = ntShell();
    if (!shell) return;
    if (prefersReducedMotion()) {
        setShellVar('--nt-ad-shift', toH, false);
        return;
    }
    adEntering = true;
    lockShellMotion();
    document.documentElement.classList.add('nt-ads-entering');
    setShellVar('--nt-ad-shift', 0, false);
    afterPaint(() => {
        setShellVar('--nt-ad-shift', toH, true);
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            document.documentElement.classList.remove('nt-ads-entering');
            adEntering = false;
            shellMotionLock = false;
            if (shellMotionUnlockTimer) {
                clearTimeout(shellMotionUnlockTimer);
                shellMotionUnlockTimer = 0;
            }
            shell.removeEventListener('transitionend', onEnd);
            requestAdShellSync();
        };
        const onEnd = (e) => {
            if (e.target !== shell) return;
            if (e.propertyName && e.propertyName !== 'transform') return;
            finish();
        };
        shell.addEventListener('transitionend', onEnd);
        setTimeout(finish, AD_SHELL_EASE_MS + 80);
    });
}

function animateOverlayTo(toH) {
    if (prefersReducedMotion()) {
        setShellVar('--nt-ad-shift', toH, false);
        return;
    }
    const fromH = currentShellShift();
    if (Math.abs(fromH - toH) < 1) {
        setShellVar('--nt-ad-shift', toH, false);
        return;
    }
    lockShellMotion();
    setShellVar('--nt-ad-shift', fromH, false);
    afterPaint(() => setShellVar('--nt-ad-shift', toH, true));
}

/** Out-of-flow (fixed/absolute) vs in-flow (static/relative/sticky occupying space). */
function measureAdLayout(paintedOpts = {}) {
    let overlayH = 0;
    let inFlowH = 0;
    cleverOverlayNodes().forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none') return;
        if (el.getAttribute('data-nt-ad-idle') === '1') return;
        if (!unitOccupiesSpace(el, paintedOpts)) return;
        const r = el.getBoundingClientRect();
        if (cs.position === 'fixed' || cs.position === 'absolute') {
            overlayH = Math.max(overlayH, r.height);
        } else {
            inFlowH = Math.max(inFlowH, r.height);
        }
    });
    return { overlayH, inFlowH };
}

function syncAdShellMotion() {
    const shell = ntShell();
    if (!shell) return;

    if (window._adNetworkDestroyed) {
        const host = adScrollHost();
        document.documentElement.classList.remove('nt-ads-entering', 'nt-ad-scroll-sync');
        document.documentElement.style.removeProperty('--nt-ad-scroll');
        adEntering = false;
        shellMotionLock = false;
        cleverOverlayNodes().forEach((el) => el.removeAttribute('data-nt-ad-idle'));
        clearUndockedFollowers();
        if (host) {
            host.classList.remove('nt-ad-slot-open');
            if (!host.childElementCount) host.style.height = '';
        }
        setShellVar('--nt-ad-shift', 0, false);
        setShellVar('--nt-ad-flip', 0, false);
        prevOverlayH = 0;
        prevInFlowH = 0;
        stopOccupancyWatch();
        return;
    }

    if (adEntering || shellMotionLock) return;

    dockAdsIntoAppScroll();
    const { overlayH, inFlowH } = measureAdLayout({ ignoreOffscreen: true });
    const filled = overlayH > 0 || inFlowH > 0;

    if (isAdsCloaked()) {
        syncUndockedOverlayScroll();
        if (inFlowH > 0) prevInFlowH = inFlowH;
        return;
    }

    consumeResumeInstant();
    syncIdleAdNodes();

    if (!filled) userSawEmptyBoard = true;

    setShellVar('--nt-ad-shift', 0, false);
    setShellVar('--nt-ad-flip', 0, false);

    if (!filled) {
        syncUndockedOverlayScroll();
        prevOverlayH = 0;
        prevInFlowH = 0;
        stopOccupancyWatch();
        return;
    }

    syncUndockedOverlayScroll();
    prevOverlayH = overlayH;
    prevInFlowH = inFlowH;
    if (overlayH > 0 || inFlowH > 0) maybeStartOccupancyWatch();
}

function requestAdShellSync() {
    if (adShellSyncRaf) return;
    adShellSyncRaf = requestAnimationFrame(() => {
        adShellSyncRaf = 0;
        syncAdShellMotion();
    });
}

function scheduleScrollOccupancyCheck() {
    if (adScrollSyncTimer) return;
    adScrollSyncTimer = window.setTimeout(() => {
        adScrollSyncTimer = 0;
        requestAdShellSync();
    }, AD_SCROLL_SYNC_MS);
}

function stopOccupancyWatch() {
    if (!adOccupancyWatchTimer) return;
    clearInterval(adOccupancyWatchTimer);
    adOccupancyWatchTimer = 0;
}

/** Poll occupancy only while the board is still shifted by a leftover unit. */
function maybeStartOccupancyWatch() {
    if (adOccupancyWatchTimer) return;
    adOccupancyWatchTimer = window.setInterval(() => {
        const shifted = Math.abs(currentShellShift()) >= 1 || prevOverlayH > 8 || prevInFlowH > 8;
        if (!shifted) {
            stopOccupancyWatch();
            return;
        }
        const { overlayH, inFlowH } = measureAdLayout({ ignoreOffscreen: true });
        if (overlayH < 8 && inFlowH < 8) requestAdShellSync();
    }, AD_OCCUPANCY_WATCH_MS);
}

function refreshOverlayObservations() {
    if (!overlayResizeObserver) return;
    const nodes = cleverOverlayNodes();
    const next = new Set(nodes);
    observedOverlayNodes.forEach((el) => {
        if (!next.has(el)) {
            try { overlayResizeObserver.unobserve(el); } catch { /* ignore */ }
            observedOverlayNodes.delete(el);
        }
    });
    nodes.forEach((el) => {
        if (observedOverlayNodes.has(el)) return;
        try { overlayResizeObserver.observe(el); } catch { /* ignore */ }
        observedOverlayNodes.add(el);
    });
}

function cloak(_adContainer, fatal = false) {
    document.documentElement.classList.add('nt-ads-cloaked');
    if (fatal) {
        document.getElementById(LOADER_ID)?.remove();
        document.documentElement.classList.add('nt-ads-cloaked');
    }
    setAdPadding(false);
    syncAdShellMotion();
}

function uncloak() {
    if (window._adNetworkDestroyed) return;
    if (adEntering) return;
    const wasCloaked = isAdsCloaked();
    const animateIn = wasCloaked && userSawEmptyBoard && !prefersReducedMotion();
    if (animateIn) {
        setShellVar('--nt-ad-shift', 0, false);
        setShellVar('--nt-ad-flip', 0, false);
    }
    document.documentElement.classList.remove('nt-ads-cloaked');
    if (animateIn) requestAdShellSync();
    else syncAdShellMotion();
}

function isAdFilled() {
    if (adEntering) return true;
    const { overlayH, inFlowH } = measureAdLayout({ ignoreOurHide: true });
    return overlayH > 0 || inFlowH > 0;
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
    if (window._adNetworkDestroyed || window._adScriptInjected) return false;
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
        if (typeof window.__ntCleverVendorInject !== 'function') {
            clearTimeout(adTimeout);
            handleAdFailure(adContainer, 'VENDOR_SNIPPET_MISSING', false);
            return false;
        }
        window.__ntCleverVendorInject();
        const c = document.getElementById(LOADER_ID);
        if (!c) {
            clearTimeout(adTimeout);
            handleAdFailure(adContainer, 'LOADER_NOT_INSERTED', false);
            return false;
        }
        c.addEventListener('error', () => {
            clearTimeout(adTimeout);
            handleAdFailure(adContainer, 'SCRIPT_LOAD_ERROR', false);
        });
        c.addEventListener('load', () => {
            clearTimeout(adTimeout);
            window._adScriptLoaded = true;
            console.log(`🛡️ Guardian: Ad script initialized (${attempt}/${AD_PAGE_INJECT_CAP}).`);
            if (!window._adNetworkDestroyed && isSafeZone()) uncloak();
        });
        return true;
    } catch (e) {
        console.warn('🛡️ Guardian: Ad inject suppressed', e);
        handleAdFailure(adContainer, 'EVAL_EXCEPTION', false);
        return false;
    }
}

function refreshAdVisibility(adContainer) {
    if (window._adNetworkDestroyed) {
        syncAdShellMotion();
        return;
    }

    if (!isSafeZone() || shouldDeferForSessionStability()) {
        cloak(adContainer, false);
        return;
    }

    uncloak();
    refreshOverlayObservations();
    const filled = isAdFilled();
    if (filled) {
        setAdPadding(false);
        if (!window._adTelemetryFired) {
            window._adTelemetryFired = true;
            if (typeof window.trackAnalyticsEvent === 'function') {
                window.trackAnalyticsEvent('view_clever_ad', { location: 'main_dashboard', verified: 'filled' });
            }
        }
    } else {
        setAdPadding(false);
    }
    requestAdShellSync();
}

export function initCleverAds() {
    if (typeof window === 'undefined' || window.__ntCleverAdsBound) return;
    window.__ntCleverAdsBound = true;

    const adContainer = document.getElementById('clever-core');
    if (!adContainer) return;

    clearLegacySessionInjectCap();
    pageInjectCount = 0;

    window._adNetworkDestroyed = false;
    window._adScriptInjected = false;
    window._adScriptLoaded = false;
    window._adTelemetryFired = false;
    userSawEmptyBoard = false;
    prevOverlayH = 0;
    prevInFlowH = 0;
    adEntering = false;
    shellMotionLock = false;
    if (shellMotionUnlockTimer) {
        clearTimeout(shellMotionUnlockTimer);
        shellMotionUnlockTimer = 0;
    }
    adResumeInstant = false;
    if (adResumePassTimer) {
        clearTimeout(adResumePassTimer);
        adResumePassTimer = 0;
    }
    if (adScrollSyncTimer) {
        clearTimeout(adScrollSyncTimer);
        adScrollSyncTimer = 0;
    }
    stopOccupancyWatch();
    document.documentElement.classList.remove('nt-ads-entering');

    let stabilizedAt = 0;
    let nextScheduleIndex = 0;
    let scheduleTimer = null;
    let scheduleStarted = false;
    let scheduleExhausted = false;

    if (typeof ResizeObserver === 'function') {
        overlayResizeObserver = new ResizeObserver(() => {
            refreshOverlayObservations();
            requestAdShellSync();
        });
        refreshOverlayObservations();
    }

    if (window.MutationObserver && document.body) {
        const adObserver = new MutationObserver((mutations) => {
            let sawChildList = false;
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'style') {
                    const el = m.target;
                    if (!(el instanceof Element)) continue;
                    const style = el.getAttribute('style') || '';
                    if (style.includes('height: 100vh') && /clever/i.test(`${el.id} ${el.className}`)) {
                        if (!window._rogueAdCheckPending) {
                            window._rogueAdCheckPending = true;
                            setTimeout(() => {
                                window._rogueAdCheckPending = false;
                                const cur = el.getAttribute('style') || '';
                                if (cur.includes('height: 100vh')) {
                                    adObserver.disconnect();
                                    handleAdFailure(adContainer, 'ROGUE_FULLSCREEN_TAKEOVER', true);
                                }
                            }, 500);
                        }
                        break;
                    }
                    if (/lever/i.test(`${el.id} ${el.className}`) || el.tagName === 'IFRAME') {
                        requestAdShellSync();
                    }
                }
                if (m.type === 'attributes' && m.attributeName === 'src' && m.target instanceof HTMLIFrameElement) {
                    iframeLoadGate.invalidate(m.target);
                    iframeLoadGate.observe(m.target);
                    requestAdShellSync();
                }
                if (m.type === 'childList') sawChildList = true;
                if (!window._adTelemetryFired && m.type === 'childList' && isAdFilled() && isSafeZone()) {
                    window._adTelemetryFired = true;
                    uncloak();
                    setAdPadding(false);
                    if (typeof window.trackAnalyticsEvent === 'function') {
                        window.trackAnalyticsEvent('view_clever_ad', { location: 'main_dashboard', verified: 'instant_tripwire' });
                    }
                }
            }
            if (sawChildList) {
                dockAdsIntoAppScroll();
                refreshOverlayObservations();
                requestAdShellSync();
            }
        });
        adObserver.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
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
        if (window._adTelemetryFired || isAdFilled()) {
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
        if (window._adTelemetryFired || isAdFilled()) {
            stopSchedule('already filled');
            return;
        }
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

    let ticks = 0;
    const waitForStabilize = () => {
        ticks += 1;
        refreshAdVisibility(adContainer);
        if (!scheduleStarted) startInjectSchedule();
        if (scheduleStarted || window._adNetworkDestroyed || scheduleExhausted) return;
        if (ticks < 80) setTimeout(waitForStabilize, shouldDeferForSessionStability() ? 500 : 1000);
    };
    setTimeout(waitForStabilize, 1500);

    const onAppResume = (e) => {
        const initialPageshow = !!(e && e.type === 'pageshow' && !e.persisted);
        if (initialPageshow) {
            refreshAdVisibility(adContainer);
            if (!scheduleStarted) startInjectSchedule();
            return;
        }
        markResumeInstant();
        refreshAdVisibility(adContainer);
        if (!scheduleStarted) startInjectSchedule();
        if (adResumePassTimer) clearTimeout(adResumePassTimer);
        adResumePassTimer = setTimeout(() => {
            markResumeInstant();
            refreshAdVisibility(adContainer);
            adResumePassTimer = setTimeout(() => {
                markResumeInstant();
                refreshAdVisibility(adContainer);
                adResumePassTimer = 0;
            }, 750);
        }, 250);
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        onAppResume();
    });
    window.addEventListener('pageshow', onAppResume);
    document.addEventListener('resume', onAppResume);

    // Same-session: vendor may discard a sticky unit while the tab stays visible.
    // Scroll back to top will not fire visibilitychange/pageshow/resume.
    const onAppScroll = () => {
        const html = document.documentElement;
        if (html.classList.contains('nt-ad-scroll-sync')) {
            const y = Math.max(0, appScrollEl()?.scrollTop || 0);
            html.style.setProperty('--nt-ad-scroll', `${Math.round(-y)}px`);
        }
        scheduleScrollOccupancyCheck();
    };
    window.addEventListener('scroll', onAppScroll, { passive: true });
    document.getElementById('app-scroll')?.addEventListener('scroll', onAppScroll, { passive: true });
    if ('onscrollend' in window) {
        window.addEventListener('scrollend', () => requestAdShellSync(), { passive: true });
        document.getElementById('app-scroll')?.addEventListener('scrollend', () => requestAdShellSync(), { passive: true });
    }
}
