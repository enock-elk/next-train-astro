/**
 * METRORAIL NEXT TRAIN 2.0 - UI CORE UTILITIES
 * -----------------------------------------------------------------------------
 * The "Waiter". This module provides globally accessible, pure UI functions 
 * (Modals, Toasts, Haptics, Scrims) designed for the Astro MPA architecture.
 * It is completely decoupled from business logic and routing engines.
 */

import { safeStorage } from './utils.js';
import { isAdminAuthed } from './admin-chrome.js';
import { trackAnalyticsEvent, sendAnalyticsNow } from './analytics.js';
import { DYNAMIC_BASE_URL, APP_VERSION, LEGAL_TEXTS, withBase } from './config.js';
import { $deviceId, $currentRouteId, $userRegion } from '../store.js';
import { markPendingReload, isReloadPending } from './session-stability.js';
import {
    helpUrl,
    mailtoSupportUrl,
    whatsappSupportUrl,
    stashLastCrash,
    SUPPORT_EMAIL,
    SUPPORT_WHATSAPP_DISPLAY,
} from './recovery.js';


/** Vibrations are opt-in. Missing key (new users) means off. */
export function hapticsAreEnabled() {
    try {
        return safeStorage.getItem('hapticsEnabled') === 'true';
    } catch {
        return false;
    }
}

// --- GLOBAL HAPTIC ENGINE ---
export function triggerHaptic() {
    try {
        if (hapticsAreEnabled() && navigator.vibrate) {
            navigator.vibrate(50);
        }
    } catch(e) {}
}

/**
 * Show/hide a password field. Bind after the input exists in the document
 * (admin login lives in a stamped <template>, so boot-time getElementById misses it).
 */
export function bindPasswordReveal({ inputId, buttonId, openIconId, closedIconId }) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(buttonId);
    if (!input || !btn || btn.dataset.revealBound === '1') return;
    btn.dataset.revealBound = '1';
    const openIcon = openIconId ? document.getElementById(openIconId) : null;
    const closedIcon = closedIconId ? document.getElementById(closedIconId) : null;
    const sync = () => {
        const hidden = input.type === 'password';
        btn.setAttribute('aria-label', hidden ? 'Show password' : 'Hide password');
        btn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
        openIcon?.classList.toggle('hidden', !hidden);
        closedIcon?.classList.toggle('hidden', hidden);
    };
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.type = input.type === 'password' ? 'text' : 'password';
        sync();
    });
    sync();
}

// --- GLOBAL SCROLL-LOCK PROTOCOL ---
export function lockBackgroundScroll() {
    if (typeof document !== 'undefined') document.body.classList.add('modal-active');
}

export function unlockBackgroundScroll() {
    if (typeof document !== 'undefined') document.body.classList.remove('modal-active');
}


// --- SPATIAL MODAL ENGINE ---
if (typeof window !== 'undefined') {
    window._isModalAnimating = false;
    window.__ntModalPopLockUntil = 0;
}

function armModalPopLock() {
    if (typeof window === 'undefined') return;
    window.__ntModalPopLockUntil = Date.now() + 500;
}

function isModalPopLocked() {
    if (typeof window === 'undefined') return false;
    return Date.now() < (window.__ntModalPopLockUntil || 0);
}

/** Modal id → history hash (SPA back-button stack). */
const MODAL_HASH = {
    'fare-modal': '#fare',
    'schedule-modal': '#schedule',
    'full-schedule-modal': '#grid',
    'route-modal': '#route',
    'profile-modal': '#profile',
    'feedback-modal': '#feedback',
    'messages-thread-modal': '#messages',
    'about-modal': '#about',
    'help-modal': '#help',
    // legal-modal uses #privacy / #terms (see openLegal); #legal is a legacy alias
    'map-modal': '#prasa-map',
    'notice-modal': '#notice',
    'alerts-channel': '#alerts',
    'developer-reply-modal': '#devreply',
    'delay-report-modal': '#delay-report',
    'disruption-modal': '#disruption',
    'planner-train-sheet-modal': '#train-sheet',
    'cache-clear-modal': '#cacheclear',
    'account-modal': '#account',
    'login-modal': '#login',
    'dev-modal': '#dev',
    'changelog-modal': '#changelog',
    'welcome-modal': '#welcome',
    'trip-map-modal': '#trip-map',
    'community-presence-info-modal': '#community-presence',
    'region-confirm-modal': '#regionconfirm',
    'blackbox-modal': '#blackbox',
    'bb-pin-modal': '#bb-pin',
    'network-struggle-modal': '#network-struggle',
    'redirect-modal': '#redirect',
    'exit-modal': '#exit-confirm',
};

function hashForModal(modalId) {
    return MODAL_HASH[modalId] || null;
}

function isLegalHash(hash) {
    return hash === '#privacy' || hash === '#terms' || hash === '#legal';
}

function legalHashForType(type) {
    return type === 'terms' ? '#terms' : '#privacy';
}

function anyFixedModalOpen() {
    const alerts = document.getElementById('alerts-channel');
    const alertsOpen = !!(alerts && !alerts.classList.contains('hidden'));
    return !!document.querySelector('div[id$="-modal"].fixed:not(.hidden)') || alertsOpen;
}

/** Instantly hide a fixed overlay (no animation). Used when history.back() must not leave it up. */
function hideFixedModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const inner = modal.firstElementChild;
    if (inner && inner.classList.contains('scale-100')) {
        inner.classList.remove('scale-100');
        inner.classList.add('scale-95');
    }
    modal.classList.add('hidden');
    modal.classList.remove('opacity-0');
    if (!anyFixedModalOpen() && !document.body.classList.contains('sidenav-open')) {
        unlockBackgroundScroll();
    }
}

export function closeSmoothModal(modalId, fromPopState = false) {
    if (typeof window === 'undefined') return;
    if (window._adminDrillBackLock && modalId === 'dev-modal') return;

    // Drilled Dev Mode: never close the whole modal — step back to the grid first
    if (modalId === 'dev-modal' && window.Admin && window.Admin.isGridMode === false) {
        if (typeof window.Admin.exitDrillToGrid === 'function') {
            window.Admin.exitDrillToGrid({ fromPopState });
            return;
        }
    }

    const hash = hashForModal(modalId);
    // Prefer popping history so Back stack stays consistent (popstate closes with fromPopState)
    // Dev Mode: skip history.back() when hash is #dev-* (panel) — that overshot to home
    if (!fromPopState) {
        const shouldPopLegal = modalId === 'legal-modal' && isLegalHash(location.hash);
        const isDevHash = modalId === 'dev-modal' && ((location.hash || '') === '#dev' || (location.hash || '').startsWith('#dev-'));
        if (shouldPopLegal || (hash && location.hash === hash && modalId !== 'dev-modal')) {
            // Hide first, then pop. Arm a short lock so the following popstate
            // does not close the next overlay or call history.back() again.
            armModalPopLock();
            hideFixedModal(modalId);
            try {
                history.back();
                return;
            } catch { /* fall through */ }
        }
        // Close Dev Mode visually + normalize hash (no history.back race)
        if (isDevHash) {
            fromPopState = true;
            try { history.replaceState({ view: 'home' }, '', '#home'); } catch { /* ignore */ }
        }
    }

    // After feedback closes (incl. popstate), restore any parked overlay (e.g. admin inbox reply)
    if (modalId === 'feedback-modal') {
        setTimeout(() => {
            try {
                if (typeof window.restoreFeedbackReturnOverlay === 'function') {
                    window.restoreFeedbackReturnOverlay();
                }
            } catch { /* ignore */ }
        }, fromPopState ? 40 : 320);
    }

    window._isModalAnimating = true;
    setTimeout(() => { window._isModalAnimating = false; }, 350);

    // Failsafe telemetry wipe for admin panel
    if (window.Admin && window.Admin.telemetryInterval) {
        clearInterval(window.Admin.telemetryInterval);
        window.Admin.telemetryInterval = null;
    }
    
    // Ensure cinematic scrim is released when ANY modal closes
    if (typeof toggleDropdownScrim === 'function') toggleDropdownScrim();
    
    const modal = document.getElementById(modalId);
    if (modal) {
        const inner = modal.firstElementChild;
        if (inner && inner.classList.contains('scale-100')) {
            inner.classList.remove('scale-100');
            inner.classList.add('scale-95');
        }
        modal.classList.add('opacity-0');
        setTimeout(() => {
            if (modal.classList.contains('opacity-0')) {
                modal.classList.add('hidden');
                modal.classList.remove('opacity-0');
            }
            if (!anyFixedModalOpen() && !document.body.classList.contains('sidenav-open')) {
                unlockBackgroundScroll();
            }
        }, 300);
    } else if (!anyFixedModalOpen() && !document.body.classList.contains('sidenav-open')) {
        unlockBackgroundScroll();
    }
}

export function openSmoothModal(modalId, customOrigin = null, opts = null) {
    if (typeof window === 'undefined') return;
    window._isModalAnimating = true;
    setTimeout(() => { window._isModalAnimating = false; }, 350);

    if (modalId === 'map-modal' && typeof window.ensureMapImageLoaded === 'function') {
        try { window.ensureMapImageLoaded(); } catch { /* ignore */ }
    }

    const modal = document.getElementById(modalId);
    const wasHidden = !modal || modal.classList.contains('hidden');
    const skipHash = !!(opts && opts.skipHash);

    if (modal && modal.firstElementChild) {
        const inner = modal.firstElementChild;
        // Clean previous origins
        inner.style.transformOrigin = '';
        inner.classList.remove('origin-top-right', 'origin-bottom-left', 'origin-center', 'origin-bottom');
        
        // Spatial Origin Mapping
        if (customOrigin === 'top-right' || modalId === 'notice-modal') {
            inner.classList.add('origin-top-right');
        } else if (customOrigin === 'dev-banner') {
            const banner = document.getElementById('developer-reply-banner');
            if (banner) {
                const rect = banner.getBoundingClientRect();
                inner.style.transformOrigin = `${rect.left + (rect.width / 2)}px ${rect.top + (rect.height / 2)}px`;
            } else {
                inner.classList.add('origin-top');
            }
        } else {
            inner.classList.add('origin-center'); // Default
        }
        
        modal.classList.remove('hidden');
        // Force reflow, then spring open (scale-95 → scale-100)
        void modal.offsetWidth;
        modal.classList.remove('opacity-0');
        if (inner.classList.contains('scale-95')) {
            requestAnimationFrame(() => {
                inner.classList.remove('scale-95');
                inner.classList.add('scale-100');
            });
        }
        lockBackgroundScroll();
    }

    // Push history so Android/iOS Back closes this overlay instead of leaving the tab.
    // skipHash: admin archive previews stay on #dev-* so close/X never pops drill-back.
    const hash = hashForModal(modalId);
    if (!skipHash && wasHidden && hash && location.hash !== hash) {
        try { history.pushState({ modal: modalId }, '', hash); } catch { /* ignore */ }
    }
}

/**
 * Central Back / popstate handler (Guardian-style): close top overlay, then planner results, then tabs.
 */
export function bindHistoryBackNavigation() {
    if (typeof window === 'undefined' || window.__ntHistoryBackBound) return;
    window.__ntHistoryBackBound = true;

    // PWA standalone: SPA exit-trap so Android Back can prompt before leaving
    try {
        let exitTrapSet = false;
        try { exitTrapSet = sessionStorage.getItem('exitTrapSet') === 'true'; } catch { /* ignore */ }
        if (!exitTrapSet) {
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
            if (isStandalone) {
                history.replaceState({ view: 'exit-trap' }, '', '#exit');
                history.pushState({ view: 'home' }, '', '#home');
            } else if (!location.hash) {
                history.replaceState({ view: 'home' }, '', '#home');
            }
            try { sessionStorage.setItem('exitTrapSet', 'true'); } catch { /* ignore */ }
        }
    } catch { /* ignore */ }

    window.addEventListener('popstate', () => {
        setTimeout(() => {
            if (!anyFixedModalOpen() && !document.body.classList.contains('sidenav-open')) {
                unlockBackgroundScroll();
            }
        }, 350);

        const hashNow = location.hash || '';
        if (hashNow === '#exit') {
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
            if (isStandalone) {
                const activeTab = safeStorage.getItem('activeTab');
                if (activeTab === 'trip-planner' || activeTab === 'community') {
                    history.pushState({ view: 'home' }, '', '#home');
                    switchTab('next-train');
                    return;
                }
                openSmoothModal('exit-modal');
                history.pushState({ view: 'home' }, '', '#home');
                return;
            }
        }

        if (isModalPopLocked()) {
            return;
        }

        if (window._isLightboxMode) {
            closeLightbox(true);
            return;
        }

        // Alerts channel parks the home board (same as sidenav #sheet). Closing
        // it must not switchTab / remount Next Train.
        const alertsEl = document.getElementById('alerts-channel');
        const alertsOpen = (alertsEl && !alertsEl.classList.contains('hidden')) || window.__ntAlertsOpen || window.__ntAlertsParkHome;
        if (alertsOpen && hashNow !== '#alerts' && hashNow !== '#lightbox' && hashNow !== '#feedback' && hashNow !== '#map') {
            closeSmoothModal('alerts-channel', true);
            window.__ntAlertsOpen = false;
            window.__ntAlertsParkHome = false;
            return;
        }

        const adminLightbox = document.getElementById('admin-lightbox-modal');
        if (adminLightbox && !adminLightbox.classList.contains('hidden')) {
            if (window.Admin?.closeLightbox) window.Admin.closeLightbox();
            else adminLightbox.classList.add('hidden');
            return;
        }

        if (window._isSidenavClosing) return;

        if (document.body.classList.contains('sidenav-open')) {
            if (typeof window.closeAppHub === 'function') window.closeAppHub(true);
            return;
        }

        // Close the top overlay first (e.g. archived alert preview over Dev Mode).
        // Never close Dev Mode while a panel is drilled in — that was jumping users to home.
        const openModals = Array.from(document.querySelectorAll('div[id$="-modal"].fixed:not(.hidden)'));
        if (openModals.length > 0) {
            let highestZ = -1;
            let modalToClose = null;
            openModals.forEach((modal) => {
                let zIndex = 0;
                const zMatch = modal.className.match(/z-\[?(\d+)\]?/);
                if (zMatch?.[1]) zIndex = parseInt(zMatch[1], 10);
                else {
                    const computedZ = window.getComputedStyle(modal).zIndex;
                    if (computedZ !== 'auto') zIndex = parseInt(computedZ, 10) || 0;
                }
                // Inline z-index (admin elevates notice/disruption previews to 260)
                const inlineZ = parseInt(modal.style?.zIndex, 10);
                if (Number.isFinite(inlineZ)) zIndex = Math.max(zIndex, inlineZ);
                if (zIndex >= highestZ) {
                    highestZ = zIndex;
                    modalToClose = modal.id;
                }
            });
            if (modalToClose && modalToClose !== 'dev-modal') {
                closeSmoothModal(modalToClose, true);
                return;
            }
        }

        // Drilled admin panel: Back/← returns to the Dev grid only (not home)
        if (window.Admin && window.Admin.isGridMode === false) {
            if (typeof window.Admin.exitDrillToGrid === 'function') {
                window.Admin.exitDrillToGrid({ fromPopState: true });
            }
            return;
        }

        // Grid Dev Mode: now safe to close the whole modal
        if (openModals.length > 0) {
            const onlyDev = openModals.length === 1 && openModals[0].id === 'dev-modal';
            const topIsDev = openModals.some((m) => m.id === 'dev-modal')
                && !openModals.some((m) => m.id !== 'dev-modal');
            if (onlyDev || topIsDev) {
                closeSmoothModal('dev-modal', true);
                return;
            }
        }

        const resultsSection = document.getElementById('planner-results-section');
        if (resultsSection && !resultsSection.classList.contains('hidden')) {
            const hashNow = location.hash || '';
            // Closing map/disruption/etc. restores #planner-results via history.back().
            // Modal hashes sit on top of results — never wipe the trip while they are open
            // or when we land back on #planner-results.
            const keepPlannerResults = hashNow === '#planner-results'
                || hashNow === '#map'
                || hashNow === '#prasa-map'
                || hashNow === '#train-sheet'
                || hashNow === '#fare'
                || hashNow === '#trip-map'
                || hashNow === '#sheet'
                || hashNow === '#sidenav'
                || hashNow === '#lightbox'
                || hashNow === '#feedback'
                || hashNow === '#notice'
                || hashNow === '#alerts'
                || hashNow.startsWith('#disruption');
            if (keepPlannerResults) {
                if (hashNow === '#planner-results' && typeof window.restorePlannerResultsView === 'function') {
                    try { window.restorePlannerResultsView(); } catch { /* ignore */ }
                }
                return;
            }
            if (typeof window.hidePlannerResults === 'function') window.hidePlannerResults();
            return;
        }

        const hash = location.hash;
        if (!hash || hash === '#home') {
            const activeTab = safeStorage.getItem('activeTab');
            if (activeTab === 'trip-planner' || activeTab === 'community') {
                switchTab('next-train');
            }
        } else if (hash === '#planner' || hash === '#planner-results') {
            if (safeStorage.getItem('activeTab') !== 'trip-planner') switchTab('trip-planner');
            if (hash === '#planner-results' && typeof window.restorePlannerResultsView === 'function') {
                try { window.restorePlannerResultsView(); } catch { /* ignore */ }
            }
        } else if (hash === '#community') {
            if (isAdminAuthed() && safeStorage.getItem('activeTab') !== 'community') switchTab('community');
            else if (!isAdminAuthed()) switchTab('next-train');
        } else if (hash === '#map') {
            if (isAdminAuthed() && safeStorage.getItem('activeTab') !== 'map') switchTab('map');
            else if (!isAdminAuthed()) switchTab('next-train');
        }
    });
}


// --- CINEMATIC SCRIM ENGINE ---
export function toggleDropdownScrim(listId = null, chevronId = null) {
    if (typeof window === 'undefined') return;
    const scrim = document.getElementById('global-dropdown-scrim');
    if (!scrim) return;

    const allLists = ['sidenav-region-list', 'route-modal-region-list', 'custom-time-list', 'main-day-list', 'header-day-list', 'grid-day-list'];
    const allChevrons = ['sidenav-region-chevron', 'route-modal-region-chevron', 'custom-time-chevron', 'main-day-chevron', 'header-day-chevron', 'grid-day-chevron'];

    // Maps each dropdown list to the outer wrapper that owns the stacking context.
    // grid-day-list must elevate #grid-controls (not the inner chip) — a child z-index
    // cannot escape a parent stacking context, and the scrim sits at z-90 in the modal.
    const wrapperMap = {
        'sidenav-region-list': 'sidenav-region-wrapper',
        'route-modal-region-list': 'route-modal-region-container',
        'custom-time-list': 'custom-time-dropdown-container',
        'main-day-list': 'planner-day-select-container',
        'header-day-list': 'planner-header-badge',
        'grid-day-list': 'grid-controls'
    };

    const Z_ELEVATED = 'z-[160]';
    const Z_BASELINE = 'z-10';
    const Z_STALE = ['z-[160]', 'z-[60]', 'z-30', 'z-10'];

    const resetAllWrappers = () => {
        allLists.forEach((id) => {
            const wrapperId = wrapperMap[id];
            const wrapper = wrapperId ? document.getElementById(wrapperId) : null;
            const el = document.getElementById(id);
            const targetEl = wrapper || (el ? el.parentElement : null);
            if (targetEl) {
                Z_STALE.forEach((cls) => targetEl.classList.remove(cls));
                targetEl.classList.add(Z_BASELINE);
            }
        });
    };

    if (listId) {
        const list = document.getElementById(listId);
        const chevron = document.getElementById(chevronId);
        if (!list) return;

        const isOpening = list.classList.contains('hidden');

        // 1. Close all other dropdowns cleanly
        allLists.forEach((id, idx) => {
            const el = document.getElementById(id);
            const chev = document.getElementById(allChevrons[idx]);
            if (el && id !== listId) el.classList.add('hidden');
            if (chev && allChevrons[idx] !== chevronId) chev.classList.remove('rotate-180');
        });

        // 2. Toggle target and Scrim
        if (isOpening) {
            const isInlineDropdown = ['main-day-list', 'header-day-list', 'custom-time-list', 'grid-day-list'].includes(listId);

            const gridModal = list.closest('#full-schedule-modal');
            // For inline Travel Day menus inside the full timetable, the scrim MUST
            // live inside the modal's `.transform` shell (same stacking context as
            // #grid-controls). Appending it to #full-schedule-modal makes the scrim
            // a sibling ABOVE that shell, so elevating controls to z-160 cannot
            // escape and Saturday / Hol stays untappable.
            const gridShell = gridModal
                ? (list.closest('.transform') || gridModal.querySelector(':scope > .transform') || gridModal.firstElementChild)
                : null;
            const container = list.closest('#sidenav')
                || (isInlineDropdown && gridShell)
                || (!isInlineDropdown && gridModal)
                || list.closest('.transform')
                || list.closest('.view-section')
                || list.closest('#main-content')
                || document.body;

            // Let Travel Day / time menus paint below the trigger without being clipped by the shell
            document.querySelectorAll('.view-section.dropdown-escape').forEach((el) => el.classList.remove('dropdown-escape'));
            document.getElementById('main-content')?.classList.remove('dropdown-escape');
            if (isInlineDropdown && container?.classList?.contains('view-section')) {
                container.classList.add('dropdown-escape');
                document.getElementById('main-content')?.classList.add('dropdown-escape');
            }

            if (scrim.parentNode !== container) {
                container.appendChild(scrim);
            }

            scrim.classList.remove('bg-black/20', 'bg-black/40', 'bg-black/60', 'bg-transparent', 'z-[40]', 'z-[90]');

            if (container === document.body) {
                scrim.classList.remove('absolute', 'rounded-xl', 'rounded-2xl', 'rounded-lg', 'z-[40]', 'z-[90]');
                scrim.classList.add('fixed', 'z-[150]', isInlineDropdown ? 'bg-transparent' : 'bg-black/40');
            } else {
                scrim.classList.remove('fixed', 'z-[150]');
                scrim.classList.add('absolute');

                // Inline menus use a transparent dismiss layer BELOW the elevated
                // trigger (z-160). Opaque modal dims can sit higher.
                if (container.id === 'sidenav') scrim.classList.add('z-[40]', 'bg-transparent');
                else if (container.id === 'full-schedule-modal') scrim.classList.add(isInlineDropdown ? 'z-[40]' : 'z-[90]', isInlineDropdown ? 'bg-transparent' : 'bg-black/40');
                else if (container.classList.contains('view-section')) scrim.classList.add('z-[40]', isInlineDropdown ? 'bg-transparent' : 'bg-black/60');
                else if (container.id === 'main-content') scrim.classList.add(isInlineDropdown ? 'z-[40]' : 'z-[90]', isInlineDropdown ? 'bg-transparent' : 'bg-black/60');
                else scrim.classList.add(isInlineDropdown ? 'z-[40]' : 'z-[90]', isInlineDropdown ? 'bg-transparent' : 'bg-black/60');

                if (container.classList.contains('rounded-xl')) scrim.classList.add('rounded-xl');
                else if (container.classList.contains('rounded-2xl')) scrim.classList.add('rounded-2xl');
                else if (container.id === 'main-content') scrim.classList.add('rounded-lg');
            }

            resetAllWrappers();
            const activeWrapperId = wrapperMap[listId];
            const activeWrapper = activeWrapperId ? document.getElementById(activeWrapperId) : null;
            const targetActiveEl = activeWrapper || list.parentElement;
            
            if (targetActiveEl) {
                Z_STALE.forEach((cls) => targetActiveEl.classList.remove(cls));
                targetActiveEl.classList.add(Z_ELEVATED, 'relative');
            }

            list.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-180');
            
            scrim.classList.remove('hidden');
            void scrim.offsetWidth; 
            scrim.classList.remove('opacity-0');
        } else {
            list.classList.add('hidden');
            if (chevron) chevron.classList.remove('rotate-180');
            resetAllWrappers();
            document.querySelectorAll('.view-section.dropdown-escape').forEach((el) => el.classList.remove('dropdown-escape'));
            document.getElementById('main-content')?.classList.remove('dropdown-escape');
            
            scrim.classList.add('opacity-0');
            setTimeout(() => { if (scrim.classList.contains('opacity-0')) scrim.classList.add('hidden'); }, 300);
        }
    } else {
        // Force Close All
        allLists.forEach((id, idx) => {
            const el = document.getElementById(id);
            const chev = document.getElementById(allChevrons[idx]);
            if (el) el.classList.add('hidden');
            if (chev) chev.classList.remove('rotate-180');
        });
        resetAllWrappers();
        document.querySelectorAll('.view-section.dropdown-escape').forEach((el) => el.classList.remove('dropdown-escape'));
        document.getElementById('main-content')?.classList.remove('dropdown-escape');
        
        scrim.classList.add('opacity-0');
        setTimeout(() => { if (scrim.classList.contains('opacity-0')) scrim.classList.add('hidden'); }, 300);
    }
}


// --- GLOBAL TOAST NOTIFICATIONS ---
let toastTimeout = null;

export function showToast(message, type = 'info', duration = 2500, actionHTML = '') { 
    if (typeof document === 'undefined') return;
    const toastEl = document.getElementById('toast');
    
    // Debounce spamming. Ignore if the exact same message is already visible.
    if (toastEl && toastEl.classList.contains('show') && toastEl.innerText.includes(message.replace(/<[^>]*>?/gm, '').trim())) {
        return;
    }

    if (toastTimeout) clearTimeout(toastTimeout); 
    const safeDuration = Math.min(duration, 5000);

    // Inject Toast CSS dynamically if not present
    if (!document.getElementById('toast-guardian-style')) {
        const style = document.createElement('style');
        style.id = 'toast-guardian-style';
        style.innerHTML = `
            #toast { 
                position: fixed; 
                bottom: 24px; 
                left: 50%; 
                transform: translateX(-50%) translateY(150%); 
                opacity: 0; 
                transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease; 
                pointer-events: none; 
                z-index: 9999;
                width: max-content;
                max-width: 90vw;
            }
            #toast.show { 
                transform: translateX(-50%) translateY(0); 
                opacity: 1; 
                pointer-events: auto; 
            }
        `;
        document.head.appendChild(style);
    }

    if (!toastEl) return;

    let bgClass = "bg-gray-900/90 dark:bg-gray-800/95";
    let textClass = "text-white";
    let borderClass = "border-gray-700 dark:border-gray-600";
    let iconHTML = '';

    if (type === 'success') {
        bgClass = "bg-green-900/95 dark:bg-green-800/95";
        borderClass = "border-green-700 dark:border-green-600";
        iconHTML = `<svg class="w-4 h-4 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
    } else if (type === 'error') {
        bgClass = "bg-red-900/95 dark:bg-red-800/95";
        borderClass = "border-red-700 dark:border-red-600";
        iconHTML = `<svg class="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    } else if (type === 'warning') {
        bgClass = "bg-yellow-900/95 dark:bg-yellow-800/95";
        borderClass = "border-yellow-700 dark:border-yellow-600";
        iconHTML = `<svg class="w-4 h-4 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
    }

    toastEl.className = `flex items-center justify-between gap-2 px-3 py-2 rounded-full shadow-2xl backdrop-blur-md border ${bgClass} ${borderClass} ${textClass} w-[min(22rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)]`; 

    toastEl.innerHTML = `
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
            ${iconHTML}
            <span class="text-xs font-semibold tracking-wide leading-snug truncate">${message}</span>
        </div>
        ${actionHTML ? `<div class="pl-2 border-l border-white/20 shrink-0">${actionHTML}</div>` : ''}
    `;
    
    // Prevent pull-to-refresh ghost triggers
    toastEl.ontouchmove = (e) => e.stopPropagation();
    
    toastEl.classList.add('show'); 
    toastTimeout = setTimeout(() => { toastEl.classList.remove('show'); }, safeDuration); 
}

const CHECK_TOAST_ID = 'nt-check-toast';

function ensureCheckToastEl() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById(CHECK_TOAST_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = CHECK_TOAST_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.className = 'nt-check-toast hidden';
    el.innerHTML = `
        <p class="nt-check-toast-text text-sm font-medium tracking-wide leading-snug pr-2"></p>
        <button type="button" class="nt-check-toast-close shrink-0 p-1 rounded-full hover:bg-white/10 focus:outline-none" aria-label="Dismiss">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>`;
    if (!document.getElementById('nt-check-toast-style')) {
        const style = document.createElement('style');
        style.id = 'nt-check-toast-style';
        style.textContent = `
            .nt-check-toast {
                position: fixed;
                left: 50%;
                bottom: calc(4.75rem + env(safe-area-inset-bottom, 0px));
                transform: translateX(-50%);
                z-index: 160;
                width: max-content;
                max-width: min(92vw, 26rem);
                display: flex;
                align-items: flex-start;
                gap: 0.5rem;
                padding: 0.7rem 0.85rem;
                border-radius: 1rem;
                background: rgba(17, 24, 39, 0.94);
                color: #f9fafb;
                border: 1px solid rgba(55, 65, 81, 0.9);
                box-shadow: 0 12px 32px rgba(0,0,0,0.28);
                backdrop-filter: blur(10px);
            }
            .nt-check-toast.hidden { display: none !important; }
            html.dark .nt-check-toast { background: rgba(17, 24, 39, 0.96); }
        `;
        document.head.appendChild(style);
    }
    document.body.appendChild(el);
    el.querySelector('.nt-check-toast-close')?.addEventListener('click', () => hideCheckToast());
    return el;
}

/** Non-intrusive, dismissable status chip above the bottom nav (GPS / I’m on it checks). */
export function showCheckToast(message) {
    if (typeof document === 'undefined') return;
    const el = ensureCheckToastEl();
    if (!el) return;
    const text = el.querySelector('.nt-check-toast-text');
    if (text) text.textContent = String(message || '');
    el.classList.remove('hidden');
}

export function hideCheckToast() {
    document.getElementById(CHECK_TOAST_ID)?.classList.add('hidden');
}


// --- LIGHTBOX ENGINE ---
function resetMapImageVisibility(mapImg) {
    if (!mapImg) return;
    // Empty src / prior failed loads set display:none via onerror — clear before swap
    mapImg.style.display = '';
    const fallback = mapImg.nextElementSibling;
    if (fallback instanceof HTMLElement) {
        fallback.style.display = 'none';
        fallback.classList.add('hidden');
    }
}

export function openLightbox(url) {
    if (typeof window === 'undefined') return;
    const src = typeof url === 'string' ? url.trim() : '';
    if (!src) return;
    triggerHaptic();
    history.pushState({ modal: 'lightbox' }, '', '#lightbox');
    lockBackgroundScroll();
    
    const mapModal = document.getElementById('map-modal');
    const mapImg = document.getElementById('map-image');
    const mapTitle = document.getElementById('map-modal-title');
    
    if (mapModal && mapImg) {
        window._isLightboxMode = true;
        mapModal.classList.add('!z-[160]');
        
        // Save original map states for the Teardown Hook (once per lightbox session)
        if (window._originalMapSrc == null) {
            const attrSrc = mapImg.getAttribute('src') || '';
            window._originalMapSrc = attrSrc || mapImg.dataset.mapSrc || '';
        }
        if (mapTitle && window._originalMapTitle == null) {
            window._originalMapTitle = mapTitle.textContent;
        }
        
        if (mapTitle) mapTitle.textContent = "Image Preview";
        // Un-hide before assigning — sticky onerror display:none was blanking previews
        resetMapImageVisibility(mapImg);
        mapImg.alt = 'Image Preview';
        mapImg.src = src;
        if (typeof window.resetMap === 'function') window.resetMap();
        else mapImg.style.transform = 'translate(0px, 0px) scale(1)';
        
        // Temporarily hijack the map modal close buttons
        const closeBtn1 = document.getElementById('close-map-btn');
        const closeBtn2 = document.getElementById('close-map-btn-2');
        
        if (!window._originalMapClose1 && closeBtn1) window._originalMapClose1 = closeBtn1.onclick;
        if (!window._originalMapClose2 && closeBtn2) window._originalMapClose2 = closeBtn2.onclick;
        
        if (closeBtn2) {
            if (!window._originalMapCloseText) window._originalMapCloseText = closeBtn2.textContent;
            closeBtn2.textContent = "Close Preview";
        }

        const lightboxCloseHandler = (e) => {
            if (e) e.preventDefault();
            closeLightbox();
        };
        
        if (closeBtn1) closeBtn1.onclick = lightboxCloseHandler;
        if (closeBtn2) closeBtn2.onclick = lightboxCloseHandler;

        // Show map-modal visually WITHOUT openSmoothModal — that would push a second
        // #prasa-map history entry and break Close Preview back to the alert (#notice).
        window._isModalAnimating = true;
        setTimeout(() => { window._isModalAnimating = false; }, 350);
        mapModal.classList.remove('hidden');
        void mapModal.offsetWidth;
        mapModal.classList.remove('opacity-0');
        const inner = mapModal.firstElementChild;
        if (inner) {
            inner.classList.remove('scale-95', 'origin-top-right', 'origin-bottom-left', 'origin-bottom');
            if (!inner.classList.contains('scale-100')) {
                inner.classList.add('scale-100', 'origin-center');
            }
        }
        lockBackgroundScroll();
        // Ensure pinch/pan/zoom bindings are live for alert images too
        if (typeof window.setupMapLogic === 'function') window.setupMapLogic();
        if (typeof window.resetMap === 'function') window.resetMap();
    }
}

export function closeLightbox(fromPopState = false) {
    if (typeof window === 'undefined') return;
    // Cover #lightbox and legacy static-map hashes from older builds (#map / #prasa-map)
    if (!fromPopState && (location.hash === '#lightbox' || location.hash === '#prasa-map')) {
        history.back();
        return;
    }
    
    // Visual teardown only (no history.back here — that would skip past #notice)
    const mapModal = document.getElementById('map-modal');
    if (mapModal && !mapModal.classList.contains('hidden')) {
        window._isModalAnimating = true;
        setTimeout(() => { window._isModalAnimating = false; }, 350);
        const inner = mapModal.firstElementChild;
        if (inner?.classList.contains('scale-100')) {
            inner.classList.remove('scale-100');
            inner.classList.add('scale-95');
        }
        mapModal.classList.add('opacity-0');
        setTimeout(() => {
            mapModal.classList.add('hidden');
            // Keep scroll locked if notice / another overlay is still open
            if (!anyFixedModalOpen() && !document.body.classList.contains('sidenav-open')) {
                unlockBackgroundScroll();
            } else {
                lockBackgroundScroll();
            }
        }, 300);
    } else if (!anyFixedModalOpen() && !document.body.classList.contains('sidenav-open')) {
        unlockBackgroundScroll();
    }
    
    // Teardown Hook: Restore the regional map image and bindings AFTER the fade out
    setTimeout(() => {
        if (window._isLightboxMode) {
            const mapModal = document.getElementById('map-modal');
            const mapImg = document.getElementById('map-image');
            const mapTitle = document.getElementById('map-modal-title');
            
            if (mapModal) mapModal.classList.remove('!z-[160]');
            if (mapImg) {
                const restoreSrc = window._originalMapSrc || mapImg.dataset.mapSrc || '';
                // Prefer lazy empty until Network Map opens again (avoid empty-src onerror hide)
                if (restoreSrc) mapImg.setAttribute('src', restoreSrc);
                else mapImg.removeAttribute('src');
                resetMapImageVisibility(mapImg);
                mapImg.alt = 'Metrorail Network Map';
                mapImg.style.transform = 'translate(0px, 0px) scale(1)';
            }
            if (mapTitle && window._originalMapTitle != null) {
                mapTitle.textContent = window._originalMapTitle;
            }
            
            const closeBtn1 = document.getElementById('close-map-btn');
            const closeBtn2 = document.getElementById('close-map-btn-2');
            
            if (closeBtn1 && window._originalMapClose1) closeBtn1.onclick = window._originalMapClose1;
            if (closeBtn2 && window._originalMapClose2) closeBtn2.onclick = window._originalMapClose2;
            
            if (closeBtn2 && window._originalMapCloseText) {
                closeBtn2.textContent = window._originalMapCloseText;
            }
            if (typeof window.resetMap === 'function') window.resetMap();
            // Re-bind map viewer close handlers after lightbox hijack
            if (typeof window.setupMapLogic === 'function') window.setupMapLogic();
            window._isLightboxMode = false;
            window._originalMapSrc = null;
            window._originalMapTitle = null;
        }
    }, 350);
}

// --- GLOBAL ERROR SHIELD (Safe Mode Protocol) ---
export function initGlobalErrorHandler() {
    if (typeof window === 'undefined') return;

    window.onerror = function(msg, url, line, col, error) {
        // Sentry ErrorEvent Unwrap
        if (typeof msg === 'object') {
            msg = (msg.message) ? msg.message : ((error && error.message) ? error.message : "Unknown Error Object");
        }

        const IGNORED_ERRORS = [
            "Script error.", "_AutofillCallbackHandler", "ResizeObserver loop limit exceeded",
            "Unexpected end of input", "Unexpected token", "Unexpected token '<'", 
            "Unexpected end of JSON input", "JSON.parse: unexpected end of data",
            "chrome-extension", "ethereum", "__firefox__", "DarkReader"
        ];

        if (typeof msg === 'string' && IGNORED_ERRORS.some(err => msg.indexOf(err) > -1)) {
            console.warn("Global Error Suppressed (Ignored Keyword):", msg);
            return false;
        }

        // Admin island quarantine: ops will see/fix these; never crash-report or
        // Safe-Mode the commuter shell because an admin panel threw.
        {
            const adminStack = error && error.stack ? String(error.stack) : '';
            const urlText = String(url || '');
            const hash = (typeof location !== 'undefined' && location.hash) ? location.hash : '';
            const adminNoise =
                window.__ntAdminSessionActive === true ||
                /admin\.js/i.test(urlText) ||
                /admin\.js/i.test(adminStack) ||
                hash === '#dev' ||
                hash === '#login' ||
                hash.startsWith('#dev-');
            if (adminNoise) {
                console.warn('🛡️ Guardian: Admin-island error quarantined (not reported):', msg);
                return false;
            }
        }

        // Blind-Spot Shield: Ignore invisible eval() scripts (Ad blockers/Extensions)
        if (!url || String(url) === 'undefined' || String(url) === 'null' || String(url).trim() === '') {
            return false;
        }

        // Cross-Origin Error Firewall (Third-Party Ad Immunity)
        try {
            const errHost = new URL(String(url), location.href).hostname;
            if (errHost && errHost !== location.hostname) {
                return false;
            }
        } catch (parseErr) {
            return false;
        }

        console.error("Global Error Caught:", msg);
        
        const overlay = document.getElementById('loading-overlay');
        const content = document.getElementById('main-content');
        
        if (overlay) overlay.style.display = 'none';
        if (content) content.style.display = 'block';
        
        // Strike 1: Silent Recovery
        let hasReloaded = false;
        try { hasReloaded = sessionStorage.getItem('error_reloaded'); } catch(e) {}

        if (!hasReloaded) {
            try { sessionStorage.setItem('error_reloaded', 'true'); } catch(e) {}
            markPendingReload('error_recovery', 1000);
            setTimeout(() => window.location.reload(), 1000);
            return false;
        }

        // Strike 2: Safe Mode → lifeboat (inline CSS so Tailwind breakage still reads)
        console.log("🛡️ Guardian: Strike 2 Error intercepted. Deploying Safe Mode.");
        
        const crashId = Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const stackText = error && error.stack ? String(error.stack) : 'N/A';
        const errorDetails = `Error: ${msg}\nLine: ${line}:${col}\nURL: ${url}\nStack: ${stackText}`;
        stashLastCrash(errorDetails);

        const crashPayload = {
            error: String(msg),
            line: `${line}:${col}`,
            url: String(url),
            stack: stackText,
            raw: JSON.stringify({
                message: String(msg),
                line,
                col,
                url: String(url),
                stack: stackText,
                name: error && error.name ? error.name : undefined,
            }, null, 2),
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            routeId: $currentRouteId.get() || 'none',
            appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown',
            deviceId: $deviceId.get() || 'unknown',
            kind: 'runtime_error',
        };
        
        try {
            fetch(`${DYNAMIC_BASE_URL}sys_logs/crashes/${crashId}.json`, {
                method: 'PUT',
                body: JSON.stringify(crashPayload)
            }).catch(()=>{});
        } catch(e) {}

        const recoveryHref = helpUrl('crash');
        const waHref = whatsappSupportUrl(`Hi Next Train — the app crashed. ${String(msg).slice(0, 160)}`);
        const mailHref = mailtoSupportUrl('Next Train crash report', errorDetails.slice(0, 1800));
        const homeHref = withBase('/');

        // Prefer full lifeboat when possible (reset + contact form + Firebase distress)
        try {
            const preferLifeboat = sessionStorage.getItem('nt_safe_mode_inline') !== '1';
            if (preferLifeboat) {
                sessionStorage.setItem('nt_safe_mode_inline', '1');
                markPendingReload('safe_mode_lifeboat', 400);
                setTimeout(() => { window.location.replace(recoveryHref); }, 350);
                return false;
            }
        } catch (e) { /* fall through to inline */ }

        document.body.innerHTML = `
            <div style="position:fixed;inset:0;background:#0f172a;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f1f5f9">
                <div style="width:64px;height:64px;border-radius:999px;background:rgba(239,68,68,0.15);display:flex;align-items:center;justify-content:center;margin-bottom:20px;font-size:28px">⚠️</div>
                <h2 style="font-size:1.4rem;font-weight:800;margin:0 0 8px">App crashed</h2>
                <p style="color:#94a3b8;font-size:0.9rem;margin:0 0 22px;max-width:20rem;line-height:1.45">
                    A fatal error stopped Next Train. Reset the saved copy on this device, or contact us — WhatsApp ${SUPPORT_WHATSAPP_DISPLAY} · ${SUPPORT_EMAIL}
                </p>
                <div style="width:100%;max-width:20rem;display:flex;flex-direction:column;gap:10px">
                    <a href="${recoveryHref}" style="display:block;background:#2563eb;color:#fff;font-weight:700;padding:14px 16px;border-radius:12px;text-decoration:none">Open recovery help</a>
                    <button type="button" id="safe-mode-clear-btn" style="background:#c2410c;color:#fff;font-weight:700;padding:14px 16px;border-radius:12px;border:0;cursor:pointer">Reset saved data &amp; restart</button>
                    <a href="${waHref}" target="_blank" rel="noopener" style="display:block;background:#128c7e;color:#fff;font-weight:700;padding:14px 16px;border-radius:12px;text-decoration:none">WhatsApp us</a>
                    <a href="${mailHref}" style="display:block;background:transparent;color:#e2e8f0;font-weight:700;padding:14px 16px;border-radius:12px;text-decoration:none;border:1px solid rgba(148,163,184,0.35)">Email ${SUPPORT_EMAIL}</a>
                    <a href="${homeHref}" style="display:block;color:#94a3b8;font-size:0.85rem;font-weight:600;padding:8px;text-decoration:underline">Try home again</a>
                </div>
            </div>
        `;

        document.getElementById('safe-mode-clear-btn')?.addEventListener('click', async () => {
            try {
                const keep = localStorage.getItem('next_train_device_id');
                localStorage.clear();
                sessionStorage.clear();
                if (keep) localStorage.setItem('next_train_device_id', keep);
            } catch (ex) {}
            try {
                if (window.indexedDB) indexedDB.deleteDatabase('NextTrainDB');
            } catch (ex) {}
            try {
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    for (const reg of regs) await reg.unregister();
                }
            } catch (ex) {}
            markPendingReload('safe_mode_cache_clear', 800);
            const go = () => { window.location.href = withBase('/') + '?v=' + Date.now(); };
            if (window.caches) {
                caches.keys().then((k) => Promise.all(k.map((n) => caches.delete(n)))).finally(go);
            } else {
                go();
            }
        });
        
        return false;
    };
}

// --- TAB SHELL (ported from old SPA ui.js for Phase 1) ---
export function moveTabIndicator(element) {
    const indicator = document.getElementById('tab-sliding-indicator');
    if (!indicator || !element) return;
    requestAnimationFrame(() => {
        indicator.style.width = `${element.offsetWidth}px`;
        indicator.style.transform = `translateX(${element.offsetLeft}px)`;
        indicator.style.left = '0px';
    });
}

/** Sync Home · Plan · Map · Community · Options on the bottom bar. */
export function syncBottomNavActive(tab = safeStorage.getItem('activeTab') || 'next-train') {
    if (typeof document === 'undefined') return;
    const home = document.getElementById('bottom-nav-home');
    const plan = document.getElementById('bottom-nav-plan');
    const map = document.getElementById('bottom-nav-map');
    const community = document.getElementById('bottom-nav-community');
    const options = document.getElementById('bottom-nav-options');
    if (!home && !plan && !map && !community && !options) return;

    const mode = tab === 'community'
        ? 'community'
        : (tab === 'map' ? 'map' : (tab === 'trip-planner' ? 'plan' : 'home'));
    const hubOpen = document.body.classList.contains('sidenav-open');
    const paint = (el, on) => {
        if (!el) return;
        el.classList.toggle('is-active', on);
        el.classList.toggle('text-gray-400', !on);
        el.classList.toggle('dark:text-gray-500', !on);
        el.setAttribute('aria-current', on ? 'page' : 'false');
    };
    paint(home, !hubOpen && mode === 'home');
    paint(plan, !hubOpen && mode === 'plan');
    paint(map, !hubOpen && mode === 'map');
    paint(community, !hubOpen && mode === 'community');
    paint(options, hubOpen);
}

/**
 * Auto-open service alerts / public-holiday notices only on the home board:
 * app stabilized, a route already selected, Next Train or Trip Planner tab,
 * and no blocking overlay (welcome, route picker, map sheet, community, Dev Mode, …).
 */
export function canAutoOpenHomeNotices() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (!window._appStabilized || isReloadPending()) return false;

    const routeId = typeof $currentRouteId?.get === 'function' ? $currentRouteId.get() : null;
    if (!routeId) return false;

    if (safeStorage.getItem('welcomeSeen') !== 'true') return false;
    const welcome = document.getElementById('welcome-modal');
    if (welcome && !welcome.classList.contains('hidden')) return false;

    const tab = safeStorage.getItem('activeTab') || 'next-train';
    if (tab !== 'next-train' && tab !== 'trip-planner') return false;

    const hash = (location.hash || '').toLowerCase();
    const homeHashes = new Set(['', '#home', '#planner', '#planner-results']);
    if (hash && !homeHashes.has(hash)) return false;

    const sheet = document.getElementById('nt-inapp-sheet');
    if (sheet && !sheet.classList.contains('hidden') && sheet.classList.contains('flex')) return false;

    const alerts = document.getElementById('alerts-channel');
    if (alerts && !alerts.classList.contains('hidden')) return false;

    // Sidenav / any modal already owns the screen — don't stack auto-popups.
    if (document.body.classList.contains('sidenav-open')) return false;
    if (document.body.classList.contains('modal-active')) return false;

    return true;
}

/** Debounced nudge so deferred auto-notices fire once the user lands on a home tab. */
let _homeNoticeNudgeTimer = 0;
export function nudgeHomeAutoNotices() {
    if (typeof window === 'undefined') return;
    if (_homeNoticeNudgeTimer) clearTimeout(_homeNoticeNudgeTimer);
    _homeNoticeNudgeTimer = setTimeout(() => {
        _homeNoticeNudgeTimer = 0;
        if (!canAutoOpenHomeNotices()) return;
        try { window.checkServiceAlerts?.(); } catch { /* ignore */ }
        try { window.maybeShowHolidayNotice?.(); } catch { /* ignore */ }
    }, 450);
}

/** Hide the bottom bar in full-screen sheets (sidenav Network Map). */
export function setImmersiveChrome(on) {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('nt-immersive', !!on);
    const bottomNav = document.getElementById('bottom-nav');
    if (!bottomNav) return;
    if (on) {
        bottomNav.classList.add('hidden');
        bottomNav.setAttribute('aria-hidden', 'true');
        return;
    }
    bottomNav.classList.remove('hidden');
    bottomNav.setAttribute('aria-hidden', 'false');
}

export function switchTab(tab) {
    if (typeof document === 'undefined') return;

    if ((tab === 'map' || tab === 'community') && !isAdminAuthed()) {
        tab = 'next-train';
    }

    if (document.body.classList.contains('sidenav-open') && typeof window.closeAppHub === 'function') {
        window.closeAppHub(true);
    }

    const prev = safeStorage.getItem('activeTab') || 'next-train';

    if (tab === 'trip-planner') {
        if (location.hash !== '#planner' && location.hash !== '#planner-results') {
            history.pushState({ tab: 'planner' }, '', '#planner');
        }
    } else if (tab === 'map') {
        if (location.hash !== '#map') {
            history.pushState({ tab: 'map' }, '', '#map');
        }
    } else if (tab === 'community') {
        if (location.hash !== '#community') {
            history.pushState({ tab: 'community' }, '', '#community');
        }
    } else if (location.hash !== '#home' && location.hash !== '') {
        history.replaceState({ tab: 'next-train' }, '', '#home');
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

    let targetBtn;
    if (tab === 'next-train') {
        targetBtn = document.getElementById('tab-next-train');
        document.getElementById('view-next-train')?.classList.add('active');
    } else if (tab === 'map') {
        targetBtn = document.getElementById('tab-map');
        document.getElementById('view-map')?.classList.add('active');
    } else if (tab === 'community') {
        targetBtn = document.getElementById('tab-community');
        document.getElementById('view-community')?.classList.add('active');
    } else {
        targetBtn = document.getElementById('tab-trip-planner');
        document.getElementById('view-trip-planner')?.classList.add('active');
    }

    if (targetBtn) {
        targetBtn.classList.add('active');
        setTimeout(() => moveTabIndicator(targetBtn), 50);
    }
    document.getElementById('tab-next-train')?.setAttribute('aria-selected', tab === 'next-train' ? 'true' : 'false');
    document.getElementById('tab-trip-planner')?.setAttribute('aria-selected', tab === 'trip-planner' ? 'true' : 'false');
    document.getElementById('tab-map')?.setAttribute('aria-selected', tab === 'map' ? 'true' : 'false');
    document.getElementById('tab-community')?.setAttribute('aria-selected', tab === 'community' ? 'true' : 'false');
    safeStorage.setItem('activeTab', tab);
    syncBottomNavActive(tab);

    // Presence only while Community is visible. Bind first so a cold Community
    // tab (before hub idle-import) still has click handlers.
    if (tab === 'community') {
        import('./community.js').then((m) => {
            m.bindCommunityUi?.();
            m.openRouteCommunity?.();
        }).catch(() => {});
    } else if (prev === 'community') {
        import('./community.js').then((m) => m.leaveCommunityRoom?.()).catch(() => {});
    }

    // Map tab: load iframe + handshake
    if (tab === 'map') {
        import('./map-tab.js').then((m) => m.activateMapTab?.()).catch(() => {});
    } else if (prev === 'map') {
        import('./map-tab.js').then((m) => m.deactivateMapTab?.()).catch(() => {});
    }

    // Alerts / holiday notices deferred while off home tabs should fire on return.
    if (tab === 'next-train' || tab === 'trip-planner') {
        nudgeHomeAutoNotices();
    }
}

export function initTabIndicator() {
    if (typeof document === 'undefined') return;
    const tabNext = document.getElementById('tab-next-train');
    if (!tabNext) return;
    const container = tabNext.parentElement;
    if (!container) return;
    container.classList.add('relative');

    const updateIndicator = () => {
        const currentActive = document.querySelector('.tab-btn.active') || document.getElementById('tab-next-train');
        if (currentActive) moveTabIndicator(currentActive);
    };

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => requestAnimationFrame(updateIndicator));
        ro.observe(container);
    } else {
        requestAnimationFrame(() => setTimeout(updateIndicator, 150));
    }
    window.addEventListener('resize', updateIndicator);
    requestAnimationFrame(updateIndicator);
}

export function setupSwipeNavigation() {
    if (typeof document === 'undefined') return;
    let touchStartX = 0;
    let touchStartY = 0;
    const contentArea = document.getElementById('main-content');
    if (!contentArea) return;

    contentArea.addEventListener('touchstart', (e) => {
        const mapModal = document.getElementById('map-modal');
        const tripMapModal = document.getElementById('trip-map-modal');
        if (document.body.classList.contains('sidenav-open') ||
            (mapModal && !mapModal.classList.contains('hidden')) ||
            (tripMapModal && !tripMapModal.classList.contains('hidden'))) return;
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    contentArea.addEventListener('touchend', (e) => {
        const mapModal = document.getElementById('map-modal');
        const tripMapModal = document.getElementById('trip-map-modal');
        if (document.body.classList.contains('sidenav-open') ||
            (mapModal && !mapModal.classList.contains('hidden')) ||
            (tripMapModal && !tripMapModal.classList.contains('hidden'))) return;

        const endX = e.changedTouches[0].screenX;
        const endY = e.changedTouches[0].screenY;
        const diffX = endX - touchStartX;
        const diffY = endY - touchStartY;
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            // Include Map; Community when the top tab is visible (lab).
            const communityTab = document.getElementById('tab-community');
            const communityVisible = !!(communityTab && !communityTab.classList.contains('hidden'));
            const operator = isAdminAuthed();
            const order = operator
                ? (communityVisible
                    ? ['next-train', 'trip-planner', 'map', 'community']
                    : ['next-train', 'trip-planner', 'map'])
                : ['next-train', 'trip-planner'];
            const cur = safeStorage.getItem('activeTab') || 'next-train';
            const safeCur = order.includes(cur) ? cur : 'next-train';
            const idx = Math.max(0, order.indexOf(safeCur));
            if (diffX > 0) switchTab(order[Math.max(0, idx - 1)]);
            else switchTab(order[Math.min(order.length - 1, idx + 1)]);
        }
    }, { passive: true });
}

/**
 * @param {'privacy'|'terms'} type
 * @param {{ fromHash?: boolean }} [opts] fromHash: hash already set (cold link / alias normalize)
 */
export function openLegal(type, opts = {}) {
    if (typeof document === 'undefined') return;
    const titleEl = document.getElementById('legal-modal-title');
    const contentEl = document.getElementById('legal-modal-content');
    if (!contentEl) return;

    const resolved = type === 'terms' ? 'terms' : 'privacy';
    if (resolved === 'privacy') {
        if (titleEl) titleEl.textContent = 'Privacy Policy';
        contentEl.innerHTML = LEGAL_TEXTS.privacy;
    } else {
        if (titleEl) titleEl.textContent = 'Terms of Use';
        contentEl.innerHTML = LEGAL_TEXTS.terms;
    }

    const targetHash = legalHashForType(resolved);
    try {
        if (location.hash === '#legal') {
            history.replaceState({ modal: 'legal-modal', legal: resolved }, '', targetHash);
        } else if (!opts.fromHash && location.hash !== targetHash) {
            history.pushState({ modal: 'legal-modal', legal: resolved }, '', targetHash);
        }
    } catch { /* ignore */ }

    openSmoothModal('legal-modal');
    trackAnalyticsEvent('view_legal_doc', { doc: resolved });
}

export function bindPlannerShellModals() {
    if (typeof document === 'undefined') return;

    const closeHelp = () => closeSmoothModal('help-modal');
    document.getElementById('close-help-btn')?.addEventListener('click', closeHelp);
    document.getElementById('close-help-btn-2')?.addEventListener('click', closeHelp);

    const closeLegal = () => closeSmoothModal('legal-modal');
    document.getElementById('close-legal-btn')?.addEventListener('click', closeLegal);
    document.getElementById('close-legal-btn-2')?.addEventListener('click', closeLegal);

    document.querySelectorAll('.planner-legal-link').forEach((btn) => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-legal') || 'terms';
            openLegal(type);
        });
    });
}

/**
 * Show the bottom offline toast with auto-dismiss.
 * @param {number} minIntervalMs
 * @param {'offline'|'liefi'|'weak'} [mode]
 */
export function showOfflineToast(minIntervalMs = 0, mode = 'offline') {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    // Product: only true-offline toast chrome (no liefi / weak variants)
    if (mode !== 'offline') return;
    const offlineToast = document.getElementById('offline-toast');
    if (!offlineToast) return;

    const now = Date.now();
    if (minIntervalMs > 0) {
        const last = window._lastOfflineToastTime || 0;
        if (now - last < minIntervalMs) return;
        window._lastOfflineToastTime = now;
    }

    offlineToast.classList.remove('pointer-events-none');
    offlineToast.classList.add('pointer-events-auto');
    const col = offlineToast.querySelector('.flex.flex-col') || offlineToast.lastElementChild;
    if (col) {
        // Offline-only chrome (no liefi/weak alternate banners/toasts)
        col.innerHTML = `
            <span class="text-sm font-bold tracking-wide">You are offline.</span>
            <span class="text-[10px] text-gray-300 leading-snug">Pull down to refresh when signal returns.</span>
        `;
    }

    offlineToast.classList.remove('translate-y-[150%]', 'opacity-0');
    if (window._lieFiToastTimeout) clearTimeout(window._lieFiToastTimeout);
    window._lieFiToastTimeout = setTimeout(() => {
        offlineToast.classList.add('translate-y-[150%]', 'opacity-0');
    }, 7000);
}

export function hideOfflineToast() {
    if (typeof document === 'undefined') return;
    const offlineToast = document.getElementById('offline-toast');
    if (offlineToast) offlineToast.classList.add('translate-y-[150%]', 'opacity-0');
}

/** Only paint offline chrome after the app is visible and still offline. */
const OFFLINE_CHROME_HOLD_MS = 4000;
let _offlineChromeTimer = null;
let _offlineChromeBound = false;

export function hideOfflineChrome() {
    if (_offlineChromeTimer) {
        clearTimeout(_offlineChromeTimer);
        _offlineChromeTimer = null;
    }
    hideOfflineToast();
    const oi = typeof document !== 'undefined' ? document.getElementById('offline-indicator') : null;
    if (oi) oi.style.display = 'none';
}

export function scheduleOfflineChrome() {
    if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
    if (document.visibilityState !== 'visible' || navigator.onLine) {
        hideOfflineChrome();
        return;
    }
    if (_offlineChromeTimer) return;
    _offlineChromeTimer = setTimeout(() => {
        _offlineChromeTimer = null;
        if (document.visibilityState !== 'visible' || navigator.onLine) return;
        const oi = document.getElementById('offline-indicator');
        if (oi) {
            oi.style.display = 'flex';
            oi.textContent = 'WORKING OFFLINE';
        }
        if (!window._hasShownOfflineToast) {
            window._hasShownOfflineToast = true;
            showOfflineToast(0, 'offline');
        }
    }, OFFLINE_CHROME_HOLD_MS);
}

export function bindOfflineChrome() {
    if (_offlineChromeBound || typeof window === 'undefined') return;
    _offlineChromeBound = true;
    window.addEventListener('offline', () => scheduleOfflineChrome());
    window.addEventListener('online', () => {
        window._hasShownOfflineToast = false;
        hideOfflineChrome();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') hideOfflineChrome();
        else scheduleOfflineChrome();
    });
}

/**
 * Yellow hazard strip from Firebase config/maintenance.json.
 *
 * Supported shapes:
 * - Legacy boolean: true
 * - Legacy flat: { active, message, regions?, routes?, expiresAt? }
 * - Multi-item: { active, items: { id: { active, message, regions?, routes?, expiresAt? } } }
 *
 * Client shows at most one strip: most specific match wins (route > region > network).
 * Root active: false pauses all items.
 */
function clearMaintenanceBanner() {
    const banner = document.getElementById('maintenance-banner');
    if (banner) banner.remove();
    document.getElementById('app-header')?.classList.remove('nt-maint-active');
}

function normalizeMaintScopeList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => String(v || '').trim()).filter(Boolean);
}

/** Expand payload into a flat list of banner items (legacy → one synthetic item). */
export function listMaintenanceItems(maintData) {
    if (maintData === true) {
        return [{ id: '_legacy', active: true, message: 'MAINTENANCE IN PROGRESS', regions: [], routes: [], expiresAt: null }];
    }
    if (!maintData || typeof maintData !== 'object') return [];

    const itemsObj = maintData.items;
    if (itemsObj && typeof itemsObj === 'object' && !Array.isArray(itemsObj)) {
        return Object.keys(itemsObj).map((key) => {
            const it = itemsObj[key] || {};
            return {
                id: String(it.id || key),
                active: it.active !== false,
                message: String(it.message || '').trim(),
                regions: normalizeMaintScopeList(it.regions).map((r) => r.toUpperCase()),
                routes: normalizeMaintScopeList(it.routes),
                expiresAt: it.expiresAt ? Number(it.expiresAt) : null,
                createdAt: it.createdAt || null,
                updatedAt: it.updatedAt || null,
                updatedBy: it.updatedBy || null,
            };
        });
    }

    // Flat legacy object
    return [{
        id: '_legacy',
        active: !!maintData.active,
        message: String(maintData.message || '').trim() || 'MAINTENANCE IN PROGRESS',
        regions: normalizeMaintScopeList(maintData.regions).map((r) => r.toUpperCase()),
        routes: normalizeMaintScopeList(maintData.routes),
        expiresAt: maintData.expiresAt ? Number(maintData.expiresAt) : null,
        createdAt: maintData.createdAt || null,
        updatedAt: maintData.updatedAt || null,
        updatedBy: maintData.updatedBy || null,
    }];
}

export function isMaintenanceItemLive(item, now = Date.now()) {
    if (!item || item.active === false) return false;
    const exp = item.expiresAt ? Number(item.expiresAt) : 0;
    if (exp > 0 && exp <= now) return false;
    return true;
}

/** Scope match for a single item (same rules as legacy flat payload). */
export function isMaintenanceItemInScope(item) {
    if (!item) return false;
    const regions = Array.isArray(item.regions) ? item.regions.map((r) => String(r).toUpperCase()) : [];
    const routes = Array.isArray(item.routes) ? item.routes.map(String) : [];
    if (!regions.length && !routes.length) return true;

    let userRegion = '';
    try { userRegion = String($userRegion.get() || '').toUpperCase(); } catch { /* ignore */ }
    if (!userRegion) {
        try { userRegion = String(safeStorage.getItem('userRegion') || '').toUpperCase(); } catch { /* ignore */ }
    }

    let userRoute = '';
    try { userRoute = String($currentRouteId.get() || '').trim(); } catch { /* ignore */ }

    const regionOk = !regions.length || (!!userRegion && regions.includes(userRegion));

    if (routes.length) {
        if (userRoute) return routes.includes(userRoute) && regionOk;
        return regions.length ? regionOk : false;
    }
    return regionOk;
}

function maintenanceSpecificityScore(item) {
    if (item?.routes?.length) return 2;
    if (item?.regions?.length) return 1;
    return 0;
}

/** Pick the single banner this device should show (or null). */
export function pickMaintenanceBanner(maintData, now = Date.now()) {
    if (maintData === true) {
        return { id: '_legacy', active: true, message: 'MAINTENANCE IN PROGRESS', regions: [], routes: [], expiresAt: null };
    }
    if (!maintData || typeof maintData !== 'object') return null;

    // Root pause (multi-item + flat)
    if (maintData.active === false) return null;

    // Flat legacy without items: require active === true
    if (!maintData.items && maintData.active !== true) return null;

    const candidates = listMaintenanceItems(maintData)
        .filter((it) => isMaintenanceItemLive(it, now) && isMaintenanceItemInScope(it));
    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        const ds = maintenanceSpecificityScore(b) - maintenanceSpecificityScore(a);
        if (ds) return ds;
        const ae = a.expiresAt || Number.POSITIVE_INFINITY;
        const be = b.expiresAt || Number.POSITIVE_INFINITY;
        return ae - be;
    });
    return candidates[0];
}

/** Whether this device should see the maintenance banner for the given payload. */
export function isMaintenanceVisibleToUser(maintData) {
    return !!pickMaintenanceBanner(maintData);
}

export async function checkMaintenanceStatus() {
    // Maintenance is an online ops signal. Never show it while offline / Lie-Fi / captive.
    if (typeof navigator === 'undefined' || !navigator.onLine) {
        clearMaintenanceBanner();
        return;
    }
    if (typeof window !== 'undefined' && window.isLieFi) {
        clearMaintenanceBanner();
        return;
    }

    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}config/maintenance.json?t=${Date.now()}`, {
            cache: 'no-store',
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) throw new Error('Captive Portal Detected');

        const maintData = await res.json();
        const existingBanner = document.getElementById('maintenance-banner');
        const picked = pickMaintenanceBanner(maintData);
        const customMessage = (picked && picked.message) ? picked.message : 'MAINTENANCE IN PROGRESS';

        if (picked) {
            // Still offline-looking? Prefer the offline badge over maintenance.
            if (!navigator.onLine || (typeof window !== 'undefined' && window.isLieFi)) {
                clearMaintenanceBanner();
                return;
            }
            const placeBanner = (banner) => {
                // Pin to the top of the header chrome (same visual as SPA top strip).
                // Inside #app-header so the alerts control (z-[70]) stays above the strip.
                banner.style.background = 'repeating-linear-gradient(45deg, #f59e0b, #f59e0b 10px, #d97706 10px, #d97706 20px)';
                banner.className = 'absolute top-0 left-0 w-full z-[55] text-gray-900 text-[11px] font-black uppercase tracking-widest text-center py-1 shadow-lg pointer-events-none';
                banner.innerHTML = String(customMessage).toUpperCase();
                const header = document.getElementById('app-header');
                const mainAppNode = document.getElementById('main-content');
                if (header) {
                    if (banner.parentNode !== header) header.prepend(banner);
                    header.classList.add('nt-maint-active');
                } else if (mainAppNode) {
                    mainAppNode.prepend(banner);
                } else if (!banner.parentNode) {
                    document.body.prepend(banner);
                }
            };

            if (!existingBanner) {
                const banner = document.createElement('div');
                banner.id = 'maintenance-banner';
                placeBanner(banner);
            } else {
                placeBanner(existingBanner);
                existingBanner.style.display = '';
            }
        } else if (existingBanner) {
            clearMaintenanceBanner();
        }
    } catch (_) {
        // Fetch failed (offline / captive / blip) — do not keep a stale maintenance strip
        clearMaintenanceBanner();
    }
}

/** Boot + online + light poll so admin toggles appear without a full reload. */
export function bindMaintenanceBanner() {
    if (typeof window === 'undefined' || window.__ntMaintBound) return;
    window.__ntMaintBound = true;
    window.checkMaintenanceStatus = checkMaintenanceStatus;
    window.clearMaintenanceBanner = clearMaintenanceBanner;
    window.isMaintenanceVisibleToUser = isMaintenanceVisibleToUser;
    window.listMaintenanceItems = listMaintenanceItems;
    window.pickMaintenanceBanner = pickMaintenanceBanner;

    checkMaintenanceStatus();
    window.addEventListener('online', () => { checkMaintenanceStatus(); });
    window.addEventListener('offline', () => { clearMaintenanceBanner(); });
    setInterval(() => { checkMaintenanceStatus(); }, 5 * 60 * 1000);

    // Re-evaluate when the user switches region/route (scoped banners)
    try {
        $userRegion.subscribe(() => { checkMaintenanceStatus(); });
        $currentRouteId.subscribe(() => { checkMaintenanceStatus(); });
    } catch { /* store unavailable */ }
}

/** Chrome/Edge installability + WebView fallback — strict SPA ui.js parity. */
export function bindPwaInstallPrompt() {
    if (typeof window === 'undefined' || window.__ntPwaInstallBound) return;
    window.__ntPwaInstallBound = true;

    const installBtn = document.getElementById('install-app-btn');
    const installBtnPlanner = document.getElementById('install-app-btn-planner');

    const ua = navigator.userAgent || navigator.vendor || window.opera || '';
    const isWebView = (ua.indexOf('FBAN') > -1) || (ua.indexOf('FBAV') > -1) || (ua.indexOf('Instagram') > -1) || (ua.indexOf('Line') > -1);
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /android/i.test(ua);

    const showInstallButton = () => {
        // SPA: hide entirely for iOS WebViews
        if (isWebView && isIOS) {
            if (installBtn) installBtn.classList.add('hidden');
            if (installBtnPlanner) installBtnPlanner.classList.add('hidden');
            return;
        }

        if (installBtn) installBtn.classList.remove('hidden');
        if (installBtnPlanner) installBtnPlanner.classList.remove('hidden');

        if (isWebView) {
            const escapeIcon = `<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>`;
            if (installBtn) {
                installBtn.innerHTML = `${escapeIcon} Open in Browser to Install`;
                installBtn.classList.replace('bg-green-500', 'bg-blue-600');
                installBtn.classList.replace('hover:bg-green-600', 'hover:bg-blue-700');
            }
            if (installBtnPlanner) {
                installBtnPlanner.innerHTML = `${escapeIcon} Open in Browser to Install`;
                installBtnPlanner.classList.replace('bg-green-500', 'bg-blue-600');
                installBtnPlanner.classList.replace('hover:bg-green-600', 'hover:bg-blue-700');
            }
        }
    };

    // Already-installed standalone session — never offer install again
    const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (isStandalone) {
        if (installBtn) installBtn.classList.add('hidden');
        if (installBtnPlanner) installBtnPlanner.classList.add('hidden');
        return;
    }

    if (window.deferredInstallPrompt || window.__ntDeferredInstallPrompt || isWebView) {
        showInstallButton();
    } else {
        window.addEventListener('pwa-install-ready', () => { showInstallButton(); });
    }

    // Late prompt (SW ready after binder) — keep parity with head capture
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.deferredInstallPrompt = e;
        window.__ntDeferredInstallPrompt = e;
        showInstallButton();
    });

    window.addEventListener('appinstalled', () => {
        window.deferredInstallPrompt = null;
        window.__ntDeferredInstallPrompt = null;
        if (installBtn) installBtn.classList.add('hidden');
        if (installBtnPlanner) installBtnPlanner.classList.add('hidden');
        trackAnalyticsEvent('install_app_accepted', { location: 'main_view' });
    });

    const handleInstallClick = () => {
        triggerHaptic();
        trackAnalyticsEvent('install_app_click', { location: 'main_view', is_webview: isWebView });

        if (isWebView) {
            trackAnalyticsEvent('install_app_webview_click', { location: 'main_view' });
            if (isAndroid) {
                const deviceId = (() => {
                    try { return localStorage.getItem('next_train_device_id') || ''; } catch { return ''; }
                })();
                const host = location.host || 'nexttrain.co.za';
                window.location.href = `intent://${host}/?uid=${deviceId}#Intent;scheme=https;package=com.android.chrome;end;`;
            }
            return;
        }

        if (installBtn) installBtn.classList.add('hidden');
        if (installBtnPlanner) installBtnPlanner.classList.add('hidden');

        const promptEvent = window.deferredInstallPrompt || window.__ntDeferredInstallPrompt;
        if (promptEvent) {
            promptEvent.prompt();
            Promise.resolve(promptEvent.userChoice).then((choiceResult) => {
                if (choiceResult?.outcome !== 'accepted') {
                    trackAnalyticsEvent('install_app_dismissed', { location: 'main_view' });
                }
                window.deferredInstallPrompt = null;
                window.__ntDeferredInstallPrompt = null;
            }).catch(() => {
                window.deferredInstallPrompt = null;
                window.__ntDeferredInstallPrompt = null;
            });
        }
    };

    if (installBtn) installBtn.addEventListener('click', handleInstallClick);
    if (installBtnPlanner) installBtnPlanner.addEventListener('click', handleInstallClick);
}

/** SPA OfflineTracker — queue analytics while offline, flush on reconnect. */
export const OfflineTracker = {
    queueKey: 'analytics_queue',
    _flushTimer: null,
    _flushWaitStarted: 0,
    gaReady() {
        return typeof window !== 'undefined' && window.__ntGaReady === true && typeof window.gtag === 'function';
    },
    enqueue(eventName, params) {
        try {
            const queue = JSON.parse(safeStorage.getItem(OfflineTracker.queueKey) || '[]');
            queue.push({ event: eventName, params: params || {}, timestamp: Date.now() });
            if (queue.length > 50) queue.shift();
            safeStorage.setItem(OfflineTracker.queueKey, JSON.stringify(queue));
        } catch (e) {
            console.warn('OfflineTracker Error:', e);
        }
    },
    flush() {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        if (!OfflineTracker.gaReady()) {
            if (!OfflineTracker._flushWaitStarted) OfflineTracker._flushWaitStarted = Date.now();
            if (Date.now() - OfflineTracker._flushWaitStarted > 25000) {
                OfflineTracker._flushWaitStarted = 0;
                return;
            }
            if (OfflineTracker._flushTimer) return;
            OfflineTracker._flushTimer = setTimeout(() => {
                OfflineTracker._flushTimer = null;
                OfflineTracker.flush();
            }, 400);
            return;
        }
        OfflineTracker._flushWaitStarted = 0;
        try {
            const queue = JSON.parse(safeStorage.getItem(OfflineTracker.queueKey) || '[]');
            if (queue.length === 0) return;
            const processNext = () => {
                if ((typeof navigator !== 'undefined' && !navigator.onLine) || queue.length === 0) {
                    if (queue.length > 0) safeStorage.setItem(OfflineTracker.queueKey, JSON.stringify(queue));
                    else safeStorage.removeItem(OfflineTracker.queueKey);
                    return;
                }
                if (!OfflineTracker.gaReady()) {
                    safeStorage.setItem(OfflineTracker.queueKey, JSON.stringify(queue));
                    OfflineTracker.flush();
                    return;
                }
                const item = queue[0];
                const enriched = { ...(item.params || {}), offline_captured: true, original_ts: item.timestamp };
                try {
                    sendAnalyticsNow(item.event, enriched);
                    queue.shift();
                    if (queue.length > 0) safeStorage.setItem(OfflineTracker.queueKey, JSON.stringify(queue));
                    else safeStorage.removeItem(OfflineTracker.queueKey);
                } catch {
                    safeStorage.setItem(OfflineTracker.queueKey, JSON.stringify(queue));
                    return;
                }
                if (queue.length > 0) setTimeout(processNext, 300);
            };
            processNext();
        } catch (e) {
            console.warn('OfflineTracker Flush Error:', e);
        }
    },
};

/** Leave-app confirm (SPA showRedirectModal). */
export function showRedirectModal(url, message) {
    const msgEl = document.getElementById('redirect-message');
    if (msgEl && message) msgEl.textContent = message;
    const confirmBtn = document.getElementById('redirect-confirm-btn');
    const cancelBtn = document.getElementById('redirect-cancel-btn');
    history.pushState({ modal: 'redirect' }, '', '#redirect');
    openSmoothModal('redirect-modal');

    const cleanup = () => {
        confirmBtn?.removeEventListener('click', confirmHandler);
        cancelBtn?.removeEventListener('click', cancelHandler);
    };
    const confirmHandler = () => {
        triggerHaptic();
        window.open(url, '_blank', 'noopener,noreferrer');
        if (location.hash === '#redirect') history.back();
        else closeSmoothModal('redirect-modal');
        cleanup();
    };
    const cancelHandler = () => {
        if (location.hash === '#redirect') history.back();
        else closeSmoothModal('redirect-modal');
        cleanup();
    };
    confirmBtn?.addEventListener('click', confirmHandler);
    cancelBtn?.addEventListener('click', cancelHandler);
}

export function bindExitAndRedirectModals() {
    if (typeof window === 'undefined' || window.__ntExitRedirectBound) return;
    window.__ntExitRedirectBound = true;

    document.getElementById('exit-cancel-btn')?.addEventListener('click', () => {
        closeSmoothModal('exit-modal');
    });
    document.getElementById('exit-confirm-btn')?.addEventListener('click', () => {
        if (navigator.app && typeof navigator.app.exitApp === 'function') {
            navigator.app.exitApp();
            return;
        }
        closeSmoothModal('exit-modal');
        setTimeout(() => {
            document.body.innerHTML = `
                <div class="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center p-6 text-center z-[9999]">
                    <div class="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-6 shadow-inner">
                        <svg class="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                    <h2 class="text-2xl font-black text-white mb-2 tracking-tight">Session Closed</h2>
                    <p class="text-gray-400 text-sm">It is now safe to swipe this app away or close the tab.</p>
                </div>`;
            try { window.close(); } catch { /* ignore */ }
        }, 300);
    });
}

function installAnalyticsOfflineBridge() {
    if (typeof window === 'undefined' || window.__ntAnalyticsOfflineBound) return;
    window.__ntAnalyticsOfflineBound = true;
    window.OfflineTracker = OfflineTracker;
    window.trackAnalyticsEvent = trackAnalyticsEvent;

    window.addEventListener('online', () => OfflineTracker.flush());
    window.addEventListener('nt-ga-ready', () => OfflineTracker.flush());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        OfflineTracker.flush();
        try {
            const id = window.NEXT_TRAIN_DEVICE_ID || safeStorage.getItem('next_train_device_id');
            if (id && typeof window.clarity === 'function') {
                window.clarity('identify', id);
                window.clarity('set', 'custom_id', id);
            }
        } catch { /* ignore */ }
    });
}

// --- ATTACH EXPORTS TO WINDOW FOR GLOBAL HTML ACCESS ---
if (typeof window !== 'undefined') {
    window.triggerHaptic = triggerHaptic;
    window.hapticsAreEnabled = hapticsAreEnabled;
    window.bindPasswordReveal = bindPasswordReveal;
    window.openSmoothModal = openSmoothModal;
    window.closeSmoothModal = closeSmoothModal;
    window.toggleDropdownScrim = toggleDropdownScrim;
    window.showToast = showToast;
    window.showCheckToast = showCheckToast;
    window.hideCheckToast = hideCheckToast;
    window.showOfflineToast = showOfflineToast;
    window.hideOfflineToast = hideOfflineToast;
    window.hideOfflineChrome = hideOfflineChrome;
    window.scheduleOfflineChrome = scheduleOfflineChrome;
    window.openLightbox = openLightbox;
    window.closeLightbox = closeLightbox;
    window.lockBackgroundScroll = lockBackgroundScroll;
    window.unlockBackgroundScroll = unlockBackgroundScroll;
    window.switchTab = switchTab;
    window.syncBottomNavActive = syncBottomNavActive;
    window.setImmersiveChrome = setImmersiveChrome;
    window.openLegal = openLegal;
    window.bindPwaInstallPrompt = bindPwaInstallPrompt;
    window.bindHistoryBackNavigation = bindHistoryBackNavigation;
    window.checkMaintenanceStatus = checkMaintenanceStatus;
    window.isMaintenanceVisibleToUser = isMaintenanceVisibleToUser;
    window.listMaintenanceItems = listMaintenanceItems;
    window.pickMaintenanceBanner = pickMaintenanceBanner;
    window.bindMaintenanceBanner = bindMaintenanceBanner;
    window.showRedirectModal = showRedirectModal;
    window.OfflineTracker = OfflineTracker;

    // Boot the Error Handler immediately
    initGlobalErrorHandler();
    bindHistoryBackNavigation();
    installAnalyticsOfflineBridge();
    // Defer until #main-content exists (this module can load before the shell)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            bindMaintenanceBanner();
            bindExitAndRedirectModals();
        });
    } else {
        bindMaintenanceBanner();
        bindExitAndRedirectModals();
    }

    import('./deeplink.js').then((m) => {
        m.bindPwaSameOriginLinks();
        m.bindDeeplinkHashChange();
    }).catch(() => {});

    bindOfflineChrome();
    window.addEventListener('online', () => {
        window._hasShownOfflineToast = false;
        hideOfflineChrome();
        OfflineTracker.flush();
        try { window.isLieFi = false; } catch { /* ignore */ }
        try { window.resetReachabilityProbe?.(); } catch { /* ignore */ }
        setTimeout(() => {
            try { window.ensureReachabilityProbed?.(); } catch { /* ignore */ }
            OfflineTracker.flush();
        }, 400);
    });
    window.addEventListener('offline', () => {
        clearMaintenanceBanner();
        scheduleOfflineChrome();
    });
}