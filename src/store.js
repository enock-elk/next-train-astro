import { atom } from 'nanostores';

/**
 * METRORAIL NEXT TRAIN 2.0 - GLOBAL STATE (NANO STORES)
 * ----------------------------------------------------
 * This replaces the mutable global variables from logic.js.
 * These "atoms" can be imported into any Astro component, React island, 
 * or Vanilla JS file to instantly access or update global state.
 */

// ==========================================
// 1. USER PREFERENCES & IDENTITY
// ==========================================
export const $userRegion = atom('GP');           // Defaults to Gauteng
export const $currentRouteId = atom(null);       // Currently selected route
export const $userProfile = atom('Adult');       // For Fare Calculations
export const $deviceId = atom(null);             // Analytics & Commuter Inbox ID

// ==========================================
// 2. HEAVY DATA CACHES (RAM)
// ==========================================
export const $fullDatabase = atom(null);         // The raw downloaded timetable JSON
export const $schedules = atom({});              // Parsed schedule arrays
export const $globalStationIndex = atom({});     // Dijkstra node graph
export const $masterStationList = atom([]);      // For Trip Planner Autocomplete

// ==========================================
// 3. DYNAMIC FIREBASE STATE
// ==========================================
export const $globalExclusions = atom({});       // Ghost train bans
export const $globalDisruptions = atom({});      // Live service alerts/severances

// ==========================================
// 4. SYSTEM HEALTH & DIAGNOSTICS
// ==========================================
export const $isOffline = atom(false);           // Lie-Fi / Offline Tracker
export const $isSimMode = atom(false);           // Admin Time Travel Mode
export const $simTime = atom(null);

// ==========================================
// 5. HYDRATION ENGINE (CLIENT-SIDE ONLY)
// ==========================================
/**
 * Astro renders HTML on the server first. The server doesn't have `localStorage`.
 * We must call this function ONLY on the client to safely hydrate our stores 
 * from the browser's persistent memory.
 */
export function hydrateStores() {
    // Failsafe: Ensure we are in the browser, not the Astro build server
    if (typeof window === 'undefined') return;

    // 1. Hydrate Region (selected app region is the telemetry source of truth)
    const savedRegion = localStorage.getItem('userRegion');
    if (savedRegion) $userRegion.set(savedRegion);
    
    // Auto-save Region changes + keep GA/Clarity crm_region aligned
    $userRegion.listen((newRegion) => {
        localStorage.setItem('userRegion', newRegion);
        try {
            if (typeof window.syncCrmRegionAnalytics === 'function') {
                window.syncCrmRegionAnalytics(newRegion);
            }
        } catch { /* ignore */ }
    });
    try {
        if (typeof window.syncCrmRegionAnalytics === 'function') {
            window.syncCrmRegionAnalytics($userRegion.get() || savedRegion || 'GP');
        }
    } catch { /* ignore */ }

    // 2. Hydrate Profile
    const savedProfile = localStorage.getItem('userProfile');
    if (savedProfile) $userProfile.set(savedProfile);
    
    $userProfile.listen((newProfile) => {
        localStorage.setItem('userProfile', newProfile);
    });

    // 3. Network Listeners
    window.addEventListener('offline', () => $isOffline.set(true));
    window.addEventListener('online', () => $isOffline.set(false));
    $isOffline.set(!navigator.onLine);

    // 4. Device Identity — reuse SPA key/format; never mint a second ID if head boot already set one
    let uid = (typeof window !== 'undefined' && window.NEXT_TRAIN_DEVICE_ID)
        || localStorage.getItem('next_train_device_id');
    if (!uid) {
        uid = 'usr_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        localStorage.setItem('next_train_device_id', uid);
    }
    if (typeof window !== 'undefined') window.NEXT_TRAIN_DEVICE_ID = uid;
    $deviceId.set(uid);

    console.log("🛡️ Guardian: Metrorail Next Train state hydrated successfully.");
}