/**
 * Expose SPA globals for public/js/admin.js (classic script), then load + init Admin.
 */
import {
    ROUTES, DYNAMIC_BASE_URL, APP_VERSION, DEFAULT_EXCLUSIONS, REGIONS, FARE_CONFIG
} from './config.js';
import { safeStorage, escapeHTML } from './utils.js';
import {
    showToast, openSmoothModal, closeSmoothModal, triggerHaptic,
    lockBackgroundScroll, unlockBackgroundScroll
} from './ui.js';
import {
    loadAllSchedules, parseJSONSchedule, updateTime, executeRegionSwap, guardianFetch
} from './logic.js';
import { $currentRouteId, $userRegion, $fullDatabase, $globalStationIndex, $deviceId, $isSimMode } from '../store.js';
import { bootFirebase } from './firebase-boot.js';

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
    window.DEFAULT_EXCLUSIONS = DEFAULT_EXCLUSIONS;
    window.REGIONS = REGIONS;
    window.FARE_CONFIG = FARE_CONFIG;
    window.safeStorage = safeStorage;
    window.escapeHTML = escapeHTML;
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

    defineLive('currentRouteId', () => $currentRouteId.get(), (v) => $currentRouteId.set(v));
    defineLive('currentRegion', () => $userRegion.get() || 'GP', (v) => $userRegion.set(v));
    defineLive('fullDatabase', () => $fullDatabase.get(), (v) => $fullDatabase.set(v));
    defineLive('globalStationIndex', () => $globalStationIndex.get() || {}, (v) => $globalStationIndex.set(v));
    defineLive('NEXT_TRAIN_DEVICE_ID', () => $deviceId.get() || safeStorage.getItem('next_train_device_id'));
    defineLive('isSimMode', () => $isSimMode.get(), (v) => $isSimMode.set(!!v));

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
        script.src = '/js/admin.js';
        script.async = true;
        script.dataset.adminClassic = '1';
        script.onload = () => resolve(window.Admin);
        script.onerror = () => reject(new Error('Failed to load admin.js'));
        document.head.appendChild(script);
    });
}

export async function initAdminBridge() {
    if (typeof window === 'undefined') return;
    exposeAdminGlobals();
    await bootFirebase();

    const startAdmin = async () => {
        try {
            await loadClassicAdminScript();
            if (window.Admin?.init) window.Admin.init();
            console.log('🛡️ Guardian: Admin bridge ready');
        } catch (e) {
            console.warn('Admin script failed to load', e);
        }
    };

    if (window.firebaseAuth) {
        await startAdmin();
    } else {
        window.addEventListener('firebase-auth-ready', () => { startAdmin(); }, { once: true });
        // firebase-boot already dispatched; if offline, still start
        setTimeout(startAdmin, 50);
    }
}
