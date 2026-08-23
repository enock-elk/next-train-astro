/**
 * Admin bridge — SHORT-TERM isolation (lazy unlock).
 *
 * Commuters never download public/js/admin.js. The classic Admin module is
 * fetched only after the 5-tap title unlock (or an explicit ensureAdminLoaded call).
 * See the ROADMAP block at the top of public/js/admin.js for medium/long-term plans.
 */
import {
    ROUTES, DYNAMIC_BASE_URL, APP_VERSION, DEFAULT_EXCLUSIONS, REGIONS, FARE_CONFIG, withBase,
    ADMIN_EMAILS, isAdminEmail,
    SPECIAL_DATES, HOLIDAY_NAMES
} from './config.js';
import { safeStorage, escapeHTML, formatAppDate } from './utils.js';
import { parseFeedbackAlertQuote } from './feedback-quote.js';
import {
    showToast, openSmoothModal, closeSmoothModal, triggerHaptic,
    lockBackgroundScroll, unlockBackgroundScroll
} from './ui.js';
import {
    loadAllSchedules, parseJSONSchedule, updateTime, executeRegionSwap, guardianFetch
} from './logic.js';
import { runScheduleQaReport, scanScheduleSheet, QA_ISSUE_TYPES } from './schedule-qa.js';
import {
    runZoneDistanceAudit,
    DEFAULT_ZONE_KM_BANDS,
    ZONE_KM_RANGE_LABELS,
} from './zone-distance-audit.js';
import { $currentRouteId, $userRegion, $fullDatabase, $globalStationIndex, $deviceId, $isSimMode, $simTime } from '../store.js';
import { bootFirebase } from './firebase-boot.js';
import {
    isShadowBanned,
    localBlockList,
    addToLocalBlockList,
    removeFromLocalBlockList,
    fetchUserFlags,
    fetchTrustScore,
    SHADOW_BAN_DURATIONS,
    computeBanUntil,
} from './trust.js';

function defineLive(name, getter, setter) {
    try {
        Object.defineProperty(window, name, {
            get: getter,
            set: setter || (() => {}),
            configurable: true
        });
    } catch (e) {
        window[name] = getter();
    }
}

export function exposeAdminGlobals() {
    if (typeof window === 'undefined') return;

    window.ROUTES = ROUTES;
    window.DYNAMIC_BASE_URL = DYNAMIC_BASE_URL;
    window.APP_VERSION = APP_VERSION;
    window.ADMIN_EMAILS = ADMIN_EMAILS;
    window.isAdminEmail = isAdminEmail;
    window.DEFAULT_EXCLUSIONS = DEFAULT_EXCLUSIONS;
    window.REGIONS = REGIONS;
    window.FARE_CONFIG = FARE_CONFIG;
    window.SPECIAL_DATES = SPECIAL_DATES;
    window.HOLIDAY_NAMES = HOLIDAY_NAMES;
    window.safeStorage = safeStorage;
    window.escapeHTML = escapeHTML;
    window.formatAppDate = formatAppDate;
    window.parseFeedbackAlertQuote = parseFeedbackAlertQuote;
    window.showToast = showToast;
    window.openSmoothModal = openSmoothModal;
    window.closeSmoothModal = closeSmoothModal;
    window.triggerHaptic = triggerHaptic;
    window.lockBackgroundScroll = lockBackgroundScroll;
    window.unlockBackgroundScroll = unlockBackgroundScroll;
    window.loadAllSchedules = loadAllSchedules;
    window.parseJSONSchedule = parseJSONSchedule;
    window.updateTime = updateTime;
    window.executeRegionSwap = executeRegionSwap;
    window.guardianFetch = guardianFetch;
    window.runScheduleQaReport = runScheduleQaReport;
    window.scanScheduleSheet = scanScheduleSheet;
    window.QA_ISSUE_TYPES = QA_ISSUE_TYPES;
    window.runZoneDistanceAudit = runZoneDistanceAudit;
    window.DEFAULT_ZONE_KM_BANDS = DEFAULT_ZONE_KM_BANDS;
    window.ZONE_KM_RANGE_LABELS = ZONE_KM_RANGE_LABELS;

    window.trustIsShadowBanned = isShadowBanned;
    window.trustLocalBlockList = localBlockList;
    window.trustAddToBlockList = addToLocalBlockList;
    window.trustRemoveFromBlockList = removeFromLocalBlockList;
    window.trustFetchUserFlags = fetchUserFlags;
    window.trustFetchTrustScore = fetchTrustScore;
    window.SHADOW_BAN_DURATIONS = SHADOW_BAN_DURATIONS;
    window.trustComputeBanUntil = computeBanUntil;

    defineLive('currentRouteId', () => $currentRouteId.get(), (v) => $currentRouteId.set(v));
    defineLive('currentRegion', () => $userRegion.get() || 'GP', (v) => $userRegion.set(v));
    defineLive('fullDatabase', () => $fullDatabase.get(), (v) => $fullDatabase.set(v));
    defineLive('globalStationIndex', () => $globalStationIndex.get() || {}, (v) => $globalStationIndex.set(v));
    defineLive('NEXT_TRAIN_DEVICE_ID', () => $deviceId.get() || safeStorage.getItem('next_train_device_id'));
    defineLive('isSimMode', () => $isSimMode.get(), (v) => $isSimMode.set(!!v));
    defineLive('simTimeStr', () => $simTime.get(), (v) => $simTime.set(v || null));
    defineLive('simDayIndex', () => (window.__ntSimDayIndex ?? null), (v) => {
        window.__ntSimDayIndex = (v === null || v === undefined || v === '') ? null : Number(v);
    });

    if (!window.trackAnalyticsEvent) {
        window.trackAnalyticsEvent = (name, params) => {
            try { window.gtag?.('event', name, params || {}); } catch (e) {}
        };
    }
}

function loadClassicAdminScript() {
    return new Promise((resolve, reject) => {
        if (window.Admin) {
            resolve(window.Admin);
            return;
        }
        const existing = document.querySelector('script[data-admin-classic]');
        if (existing) {
            existing.addEventListener('load', () => resolve(window.Admin));
            existing.addEventListener('error', reject);
            return;
        }
        const script = document.createElement('script');
        // Cache-bust so Dev Mode picks up admin.js fixes (SW/HTTP cache otherwise sticks)
        script.src = `${withBase('/js/admin.js')}?v=${encodeURIComponent(APP_VERSION)}`;
        script.async = true;
        script.dataset.adminClassic = '1';
        script.onload = () => resolve(window.Admin);
        script.onerror = () => reject(new Error('Failed to load admin.js'));
        document.head.appendChild(script);
    });
}

function stampAdminChrome() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('dev-modal') || document.getElementById('login-modal')) return;
    const tpl = document.getElementById('nt-admin-chrome-template');
    if (!tpl?.content) return;
    document.body.appendChild(tpl.content.cloneNode(true));
}

let _adminLoadPromise = null;

/**
 * Lazy-load + init Admin once. Safe to call repeatedly.
 * Sets window.__ntAdminSessionActive so global crash reporting can quarantine admin noise.
 */
export function ensureAdminLoaded() {
    if (typeof window === 'undefined') return Promise.resolve(null);
    if (window.__ntAdminReady && window.Admin) return Promise.resolve(window.Admin);
    if (_adminLoadPromise) return _adminLoadPromise;

    _adminLoadPromise = (async () => {
        try {
            window.__ntAdminSessionActive = true;
            stampAdminChrome();
            exposeAdminGlobals();
            await bootFirebase();
            await loadClassicAdminScript();
            if (window.Admin?.init && !window.__ntAdminInited) {
                window.Admin.init();
                window.__ntAdminInited = true;
            }
            window.__ntAdminReady = true;
            console.log('🛡️ Guardian: Admin island loaded (lazy unlock)');
            return window.Admin;
        } catch (e) {
            console.warn('🛡️ Guardian: Admin island failed to load — commuter app unaffected.', e);
            _adminLoadPromise = null;
            return null;
        }
    })();

    return _adminLoadPromise;
}

function openAdminEntryUi() {
    const loginModal = document.getElementById('login-modal');
    const devModal = document.getElementById('dev-modal');
    const emailInput = document.getElementById('admin-email');

    if ((typeof window.isAdminEmail === 'function' && window.isAdminEmail(window.Admin?.currentUser?.email)) || window.isSimMode) {
        if (devModal) {
            try {
                if (location.hash !== '#dev') history.pushState({ modal: 'dev' }, '', '#dev');
            } catch (e) { /* ignore */ }
            openSmoothModal('dev-modal');
            try { window.Admin.renderAdminModules?.(); } catch (e) { console.warn(e); }
            try { window.Admin.initAutoSim?.(); } catch (e) { console.warn(e); }
        }
        showToast('Developer Session Active', 'info');
        return;
    }

    if (loginModal) {
        try {
            if (location.hash !== '#login') history.pushState({ modal: 'login' }, '', '#login');
        } catch (e) { /* ignore */ }
        openSmoothModal('login-modal');
        const loginBtn = document.getElementById('admin-login-btn');
        const spinner = document.getElementById('admin-login-spinner');
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        if (spinner) spinner.classList.add('hidden');
        if (emailInput) setTimeout(() => emailInput.focus(), 150);
    }
}

/**
 * Arms the 5-tap title unlock. Does NOT fetch admin.js until unlocked.
 */
function armAdminUnlock() {
    const appTitle = document.getElementById('app-title');
    if (!appTitle || appTitle.dataset.adminUnlockArmed === '1') return;
    appTitle.dataset.adminUnlockArmed = '1';
    appTitle.style.cursor = 'pointer';
    if (!appTitle.title) appTitle.title = 'Metrorail Next Train';

    let clickCount = 0;
    let clickTimer = null;

    const onUnlockTap = async (e) => {
        // After Admin.init, its own setupLoginAccess owns subsequent unlocks.
        if (window.__ntAdminInited) return;

        e.preventDefault();
        clickCount++;
        if (clickTimer) clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { clickCount = 0; }, 2000);

        if (clickCount < 5) return;
        clickCount = 0;

        triggerHaptic?.();
        showToast('Loading admin tools…', 'info', 1500);
        const admin = await ensureAdminLoaded();
        if (!admin) {
            showToast('Admin tools unavailable', 'error', 2500);
            return;
        }
        // Hand off to Admin's own title listener for future taps.
        appTitle.removeEventListener('click', onUnlockTap);
        openAdminEntryUi();
    };

    appTitle.addEventListener('click', onUnlockTap);
}

/**
 * Boot hook for the commuter app: arm unlock only — zero admin payload.
 */
export function initAdminBridge() {
    if (typeof window === 'undefined') return;
    window.ensureAdminLoaded = ensureAdminLoaded;
    armAdminUnlock();
    // Silent until the 5-tap title backdoor loads admin.js
}
