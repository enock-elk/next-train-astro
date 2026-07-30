/**
 * METRORAIL NEXT TRAIN 2.0 - UI CORE UTILITIES
 * -----------------------------------------------------------------------------
 * The "Waiter". This module provides globally accessible, pure UI functions 
 * (Modals, Toasts, Haptics, Scrims) designed for the Astro MPA architecture.
 * It is completely decoupled from business logic and routing engines.
 */

import { safeStorage } from './utils.js';
import { DYNAMIC_BASE_URL, APP_VERSION, LEGAL_TEXTS } from './config.js';
import { $deviceId, $currentRouteId } from '../store.js';


// --- GLOBAL HAPTIC ENGINE ---
export function triggerHaptic() {
    try {
        if (safeStorage.getItem('hapticsEnabled') !== 'false' && navigator.vibrate) {
            navigator.vibrate(50);
        }
    } catch(e) {}
}

// --- GLOBAL SCROLL-LOCK PROTOCOL ---
export function lockBackgroundScroll() {
    if (typeof document !== 'undefined') document.body.classList.add('modal-active');
}

export function unlockBackgroundScroll() {
    if (typeof document !== 'undefined') document.body.classList.remove('modal-active');
}


// --- SPATIAL MODAL ENGINE ---
if (typeof window !== 'undefined') window._isModalAnimating = false;

export function closeSmoothModal(modalId) {
    if (typeof window === 'undefined') return;
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
        modal.classList.add('opacity-0');
        setTimeout(() => {
            if (modal.classList.contains('opacity-0')) {
                modal.classList.add('hidden');
                modal.classList.remove('opacity-0');
            }
        }, 300);
    }
}

export function openSmoothModal(modalId, customOrigin = null) {
    if (typeof window === 'undefined') return;
    window._isModalAnimating = true;
    setTimeout(() => { window._isModalAnimating = false; }, 350);

    const modal = document.getElementById(modalId);
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
        // Force reflow
        void modal.offsetWidth;
        modal.classList.remove('opacity-0');
    }
}


// --- CINEMATIC SCRIM ENGINE ---
export function toggleDropdownScrim(listId = null, chevronId = null) {
    if (typeof window === 'undefined') return;
    const scrim = document.getElementById('global-dropdown-scrim');
    if (!scrim) return;

    const allLists = ['sidenav-region-list', 'route-modal-region-list', 'custom-time-list', 'main-day-list', 'header-day-list', 'grid-day-list'];
    const allChevrons = ['sidenav-region-chevron', 'route-modal-region-chevron', 'custom-time-chevron', 'main-day-chevron', 'header-day-chevron', 'grid-day-chevron'];

    // Maps each dropdown list to the specific outer wrapper that controls its CSS stacking context
    const wrapperMap = {
        'sidenav-region-list': 'sidenav-region-wrapper',
        'route-modal-region-list': 'route-modal-region-container',
        'custom-time-list': 'custom-time-dropdown-container',
        'main-day-list': 'planner-day-select-container',
        'header-day-list': 'planner-header-badge',
        'grid-day-list': 'grid-day-dropdown-container'
    };

    const resetAllWrappers = () => {
        allLists.forEach((id) => {
            const wrapperId = wrapperMap[id];
            const wrapper = wrapperId ? document.getElementById(wrapperId) : null;
            const el = document.getElementById(id);
            const targetEl = wrapper || (el ? el.parentElement : null);
            if (targetEl) {
                targetEl.classList.remove('z-[160]');
                targetEl.classList.add('z-10');
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
            const container = list.closest('#sidenav') || list.closest('.transform') || list.closest('.view-section') || list.closest('#main-content') || document.body;
            
            if (scrim.parentNode !== container) {
                container.appendChild(scrim);
            }

            scrim.classList.remove('bg-black/20', 'bg-black/40', 'bg-black/60', 'bg-transparent');
            const isInlineDropdown = ['main-day-list', 'header-day-list', 'custom-time-list'].includes(listId);

            if (container === document.body) {
                scrim.classList.remove('absolute', 'rounded-xl', 'rounded-2xl', 'rounded-lg', 'z-[40]', 'z-[90]');
                scrim.classList.add('fixed', 'z-[150]', isInlineDropdown ? 'bg-transparent' : 'bg-black/40');
            } else {
                scrim.classList.remove('fixed', 'z-[150]');
                scrim.classList.add('absolute');
                
                if (container.id === 'sidenav') scrim.classList.add('z-[40]', 'bg-transparent');
                else if (container.classList.contains('view-section')) scrim.classList.add('z-[40]', isInlineDropdown ? 'bg-transparent' : 'bg-black/60');
                else if (container.id === 'main-content') scrim.classList.add('z-[90]', isInlineDropdown ? 'bg-transparent' : 'bg-black/60');
                else scrim.classList.add('z-[90]', isInlineDropdown ? 'bg-transparent' : 'bg-black/60');
                
                if (container.classList.contains('rounded-xl')) scrim.classList.add('rounded-xl');
                else if (container.classList.contains('rounded-2xl')) scrim.classList.add('rounded-2xl');
                else if (container.id === 'main-content') scrim.classList.add('rounded-lg');
            }

            resetAllWrappers();
            const activeWrapperId = wrapperMap[listId];
            const activeWrapper = activeWrapperId ? document.getElementById(activeWrapperId) : null;
            const targetActiveEl = activeWrapper || list.parentElement;
            
            if (targetActiveEl) {
                targetActiveEl.classList.remove('z-10');
                targetActiveEl.classList.add('z-[160]', 'relative');
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

    toastEl.className = `flex items-center justify-between px-4 py-3 rounded-full shadow-2xl backdrop-blur-md border ${bgClass} ${borderClass} ${textClass} max-w-[90vw]`; 

    toastEl.innerHTML = `
        <div class="flex items-center gap-2 overflow-hidden">
            ${iconHTML}
            <span class="text-sm font-medium tracking-wide break-words line-clamp-2">${message}</span>
        </div>
        ${actionHTML ? `<div class="ml-3 pl-3 border-l border-white/20 shrink-0">${actionHTML}</div>` : ''}
    `;
    
    // Prevent pull-to-refresh ghost triggers
    toastEl.ontouchmove = (e) => e.stopPropagation();
    
    toastEl.classList.add('show'); 
    toastTimeout = setTimeout(() => { toastEl.classList.remove('show'); }, safeDuration); 
}


// --- LIGHTBOX ENGINE ---
export function openLightbox(url) {
    if (typeof window === 'undefined') return;
    triggerHaptic();
    history.pushState({ modal: 'lightbox' }, '', '#lightbox');
    lockBackgroundScroll();
    
    const mapModal = document.getElementById('map-modal');
    const mapImg = document.getElementById('map-image');
    const mapTitle = document.getElementById('map-modal-title');
    
    if (mapModal && mapImg) {
        window._isLightboxMode = true;
        mapModal.classList.add('!z-[160]');
        
        // Save original map states for the Teardown Hook
        if (!window._originalMapSrc) window._originalMapSrc = mapImg.getAttribute('src');
        if (mapTitle && !window._originalMapTitle) window._originalMapTitle = mapTitle.textContent;
        
        if (mapTitle) mapTitle.textContent = "Image Preview";
        mapImg.setAttribute('src', url);
        mapImg.style.transform = 'translate(0px, 0px) scale(1)';
        
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
        
        openSmoothModal('map-modal');
    }
}

export function closeLightbox(fromPopState = false) {
    if (typeof window === 'undefined') return;
    if (!fromPopState && location.hash === '#lightbox') {
        history.back();
        return;
    }
    
    unlockBackgroundScroll();
    closeSmoothModal('map-modal');
    
    // Teardown Hook: Restore the regional map image and bindings AFTER the fade out
    setTimeout(() => {
        if (window._isLightboxMode) {
            const mapModal = document.getElementById('map-modal');
            const mapImg = document.getElementById('map-image');
            const mapTitle = document.getElementById('map-modal-title');
            
            if (mapModal) mapModal.classList.remove('!z-[160]');
            if (mapImg && window._originalMapSrc) mapImg.setAttribute('src', window._originalMapSrc);
            if (mapTitle && window._originalMapTitle) mapTitle.textContent = window._originalMapTitle;
            if (mapImg) mapImg.style.transform = 'translate(0px, 0px) scale(1)';
            
            const closeBtn1 = document.getElementById('close-map-btn');
            const closeBtn2 = document.getElementById('close-map-btn-2');
            
            if (closeBtn1 && window._originalMapClose1) closeBtn1.onclick = window._originalMapClose1;
            if (closeBtn2 && window._originalMapClose2) closeBtn2.onclick = window._originalMapClose2;
            
            if (closeBtn2 && window._originalMapCloseText) {
                closeBtn2.textContent = window._originalMapCloseText;
            }
            window._isLightboxMode = false;
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
            setTimeout(() => window.location.reload(), 1000);
            return false;
        }

        // Strike 2: Safe Mode Fallback
        console.log("🛡️ Guardian: Strike 2 Error intercepted. Deploying Safe Mode.");
        
        // Secure Firebase PUT Bypass to /sys_logs/
        const crashId = Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const crashPayload = {
            error: String(msg),
            line: `${line}:${col}`,
            url: String(url),
            stack: error && error.stack ? error.stack : 'N/A',
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            routeId: $currentRouteId.get() || 'none',
            appVersion: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'unknown',
            deviceId: $deviceId.get() || 'unknown'
        };
        
        try {
            fetch(`${DYNAMIC_BASE_URL}sys_logs/crashes/${crashId}.json`, {
                method: 'PUT',
                body: JSON.stringify(crashPayload)
            }).catch(()=>{}); // Silent fire and forget
        } catch(e) {}

        const errorDetails = `Error: ${msg}\nLine: ${line}:${col}\nURL: ${url}\nStack: ${error && error.stack ? error.stack : 'N/A'}`;
        const encodedError = encodeURIComponent(errorDetails);
        const feedbackUrl = `https://docs.google.com/forms/d/e/1FAIpQLSe7lhoUNKQFOiW1d6_7ezCHJvyOL5GkHNH1Oetmvdqgee16jw/viewform?entry.1546175845=${encodedError}`;
        
        document.body.innerHTML = `
            <div class="fixed inset-0 bg-gray-900 z-[9999] flex flex-col items-center justify-center p-6 text-center">
                <div class="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mb-6 shadow-inner ring-4 ring-red-500/20">
                    <span class="text-3xl">⚠️</span>
                </div>
                <h2 class="text-2xl font-black text-white mb-2 tracking-tight">App Crashed (Safe Mode)</h2>
                <p class="text-gray-400 text-sm mb-8 max-w-xs leading-relaxed">A fatal data error occurred. Please clear your offline cache to resync the latest schedules.</p>
                <div class="w-full max-w-xs space-y-3">
                    <button id="safe-mode-clear-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-6 rounded-xl shadow-lg transition-colors w-full focus:outline-none">
                        Clear Cache & Restart
                    </button>
                    <a href="${feedbackUrl}" target="_blank" class="flex items-center justify-center bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-3.5 px-6 rounded-xl shadow-lg transition-colors w-full border border-gray-700 focus:outline-none text-sm">
                        <span class="mr-2">✉️</span> Report Crash to Developer
                    </a>
                </div>
            </div>
        `;

        document.body.addEventListener('click', function(e) {
            if (e.target.closest('#safe-mode-clear-btn')) {
                try { 
                    localStorage.clear(); 
                    sessionStorage.clear(); 
                } catch(ex) {} 
                
                if (window.indexedDB) indexedDB.deleteDatabase('NextTrainDB'); 
                
                if (window.caches) { 
                    caches.keys().then(k => Promise.all(k.map(n => caches.delete(n)))).finally(() => window.location.href = window.location.pathname + '?v=' + Date.now());
                } else { 
                    window.location.href = window.location.pathname + '?v=' + Date.now(); 
                }
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

/** Sync Home · Plan · Community active state on the bottom bar (Phase 8). More is hub-only. */
export function syncBottomNavActive(tab = safeStorage.getItem('activeTab') || 'next-train') {
    if (typeof document === 'undefined') return;
    const home = document.getElementById('bottom-nav-home');
    const plan = document.getElementById('bottom-nav-plan');
    const community = document.getElementById('bottom-nav-community');
    if (!home && !plan && !community) return;

    const mode = tab === 'community' ? 'community' : (tab === 'trip-planner' ? 'plan' : 'home');
    const paint = (el, on) => {
        if (!el) return;
        el.classList.toggle('is-active', on);
        el.classList.toggle('text-blue-600', on);
        el.classList.toggle('dark:text-blue-400', on);
        el.classList.toggle('text-gray-400', !on);
        el.classList.toggle('dark:text-gray-500', !on);
        el.setAttribute('aria-current', on ? 'page' : 'false');
    };
    paint(home, mode === 'home');
    paint(plan, mode === 'plan');
    paint(community, mode === 'community');
}

export function switchTab(tab) {
    if (typeof document === 'undefined') return;

    if (tab === 'trip-planner') {
        if (location.hash !== '#planner' && location.hash !== '#planner-results') {
            history.pushState({ tab: 'planner' }, '', '#planner');
        }
    } else if (location.hash !== '#home' && location.hash !== '') {
        history.replaceState({ tab: 'next-train' }, '', '#home');
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));

    let targetBtn;
    if (tab === 'next-train') {
        targetBtn = document.getElementById('tab-next-train');
        const view = document.getElementById('view-next-train');
        if (view) view.classList.add('active');
    } else {
        targetBtn = document.getElementById('tab-trip-planner');
        const view = document.getElementById('view-trip-planner');
        if (view) view.classList.add('active');
    }

    if (targetBtn) {
        targetBtn.classList.add('active');
        setTimeout(() => moveTabIndicator(targetBtn), 50);
    }
    document.getElementById('tab-next-train')?.setAttribute('aria-selected', tab === 'next-train' ? 'true' : 'false');
    document.getElementById('tab-trip-planner')?.setAttribute('aria-selected', tab === 'trip-planner' ? 'true' : 'false');
    safeStorage.setItem('activeTab', tab);
    syncBottomNavActive(tab);
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
            if (diffX > 0) switchTab('next-train');
            else switchTab('trip-planner');
        }
    }, { passive: true });
}

export function openLegal(type) {
    if (typeof document === 'undefined') return;
    const titleEl = document.getElementById('legal-modal-title');
    const contentEl = document.getElementById('legal-modal-content');
    if (!contentEl) return;

    if (type === 'privacy') {
        if (titleEl) titleEl.textContent = 'Privacy Policy';
        contentEl.innerHTML = LEGAL_TEXTS.privacy;
    } else {
        if (titleEl) titleEl.textContent = 'Terms of Use';
        contentEl.innerHTML = LEGAL_TEXTS.terms;
    }
    openSmoothModal('legal-modal');
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

/** Show the bottom offline toast with auto-dismiss (Lie-Fi / offline transitions). */
export function showOfflineToast(minIntervalMs = 0) {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const offlineToast = document.getElementById('offline-toast');
    if (!offlineToast) return;

    const now = Date.now();
    if (minIntervalMs > 0) {
        const last = window._lastOfflineToastTime || 0;
        if (now - last < minIntervalMs) return;
        window._lastOfflineToastTime = now;
    }

    offlineToast.classList.remove('translate-y-[150%]', 'opacity-0');
    if (window._lieFiToastTimeout) clearTimeout(window._lieFiToastTimeout);
    window._lieFiToastTimeout = setTimeout(() => {
        offlineToast.classList.add('translate-y-[150%]', 'opacity-0');
    }, 4000);
}

export function hideOfflineToast() {
    if (typeof document === 'undefined') return;
    const offlineToast = document.getElementById('offline-toast');
    if (offlineToast) offlineToast.classList.add('translate-y-[150%]', 'opacity-0');
}

// --- ATTACH EXPORTS TO WINDOW FOR GLOBAL HTML ACCESS ---
if (typeof window !== 'undefined') {
    window.triggerHaptic = triggerHaptic;
    window.openSmoothModal = openSmoothModal;
    window.closeSmoothModal = closeSmoothModal;
    window.toggleDropdownScrim = toggleDropdownScrim;
    window.showToast = showToast;
    window.showOfflineToast = showOfflineToast;
    window.hideOfflineToast = hideOfflineToast;
    window.openLightbox = openLightbox;
    window.closeLightbox = closeLightbox;
    window.lockBackgroundScroll = lockBackgroundScroll;
    window.unlockBackgroundScroll = unlockBackgroundScroll;
    window.switchTab = switchTab;
    window.syncBottomNavActive = syncBottomNavActive;
    window.openLegal = openLegal;

    // Boot the Error Handler immediately
    initGlobalErrorHandler();

    // Offline transition toast (once per offline episode; indicator stays via $isOffline)
    window.addEventListener('online', () => {
        window._hasShownOfflineToast = false;
        hideOfflineToast();
        const oi = document.getElementById('offline-indicator');
        if (oi) oi.style.display = 'none';
    });
    window.addEventListener('offline', () => {
        const oi = document.getElementById('offline-indicator');
        if (oi) oi.style.display = 'flex';
        if (!window._hasShownOfflineToast) {
            window._hasShownOfflineToast = true;
            showOfflineToast(0);
        }
    });
}