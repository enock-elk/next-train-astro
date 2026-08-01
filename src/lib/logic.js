/**
 * METRORAIL NEXT TRAIN LOGIC (V8_08.02 - Astro MPA Migration)
 * -----------------------------------------------------------
 * This module manages Data Fetching, Caching (IndexedDB), and Synchronization.
 * It has been migrated to use Nano Stores for global state persistence.
 */

import { 
    $userRegion, $currentRouteId, $userProfile, $fullDatabase, $schedules, 
    $globalStationIndex, $masterStationList, $globalExclusions, $globalDisruptions, 
    $isOffline, $isSimMode, $simTime 
} from '../store.js';

import { 
    ROUTES, SPECIAL_DATES, HOLIDAY_NAMES, PIPELINE_SOURCES, FIREBASE_BASE_URL, 
    DYNAMIC_BASE_URL, REGIONS, REFRESH_CONFIG, FARE_CONFIG, DEFAULT_EXCLUSIONS, withBase 
} from './config.js';

import { 
    normalizeStationName, timeToSeconds, formatTimeDisplay, safeStorage, 
    getDistanceFromLatLonInKm 
} from './utils.js';
import { showToast, showOfflineToast } from './ui.js';
import { markPendingReload } from './session-stability.js';

// --- MODULE STATE VARIABLES ---
export let regionCheckPromise = Promise.resolve();
export let allStations = []; 
export let currentTime = null;
export let currentDayType = 'weekday'; 
export let currentDayIndex = 0; 
export let currentScheduleData = {};
export let refreshTimer = null;
export let lastTrackedOD = null; 
export let memoryFallbackCache = {}; 
export let lastRenderedMinute = -1;
export let scheduleAbortController = null; 
export let regionSwapGeneration = 0;
export let isLieFi = false;
export let _networkStruggleCount = 0;
let _lastSlowNetworkToastTime = 0;

const REGION_DISPLAY_NAMES = { 'GP': 'Gauteng', 'WC': 'Western Cape', 'KZN': 'KwaZulu-Natal', 'EC': 'Eastern Cape' };

function syncRegionDisplayDom(region) {
    if (typeof document === 'undefined') return;
    const name = REGION_DISPLAY_NAMES[region] || 'Gauteng';
    const sideDisp = document.getElementById('sidenav-region-display');
    const modalDisp = document.getElementById('route-modal-region-display');
    const sideSel = document.getElementById('app-hub-region-select');
    const modalSel = document.getElementById('route-modal-region-select');
    if (sideDisp) sideDisp.textContent = name;
    if (modalDisp) modalDisp.textContent = 'Region: ' + name;
    if (sideSel) sideSel.value = region;
    if (modalSel) modalSel.value = region;
}

function getRoutesForCurrentRegion() {
    const regionalRoutes = {};
    const region = $userRegion.get() || 'GP';
    for (const key in ROUTES) {
        if (ROUTES[key].region === region) regionalRoutes[key] = ROUTES[key];
    }
    return regionalRoutes;
}

function applyMapImageForRegion(region) {
    if (typeof document === 'undefined') return;
    const mapImageEl = document.getElementById('map-image');
    if (!mapImageEl) return;
    if (region === 'WC') mapImageEl.src = withBase('/images/network-map_wc.png');
    else if (region === 'KZN') mapImageEl.src = withBase('/images/network-map_kzn.png');
    else if (region === 'EC') mapImageEl.src = withBase('/images/network-map_ec.png');
    else mapImageEl.src = withBase('/images/network-map.png');
}

// 🛡️ GUARDIAN PHASE 5: SILENT IP GEOLOCATION HOOK (Client-Side Only)
if (typeof window !== 'undefined') {
    if (!safeStorage.getItem('userRegion')) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            console.log("🛡️ Guardian: Offline state detected. IP Geolocation bypassed.");
        } else {
            const geoController = new AbortController();
            const geoTimerId = setTimeout(() => geoController.abort(), 1500); 

            regionCheckPromise = fetch('https://nexttrain-telemetry.enock.workers.dev/region', { signal: geoController.signal })
                .then(r => { clearTimeout(geoTimerId); return r.json(); })
                .then(data => {
                    if (data && data.region && ['GP', 'WC', 'KZN', 'EC'].includes(data.region)) {
                        $userRegion.set(data.region);
                        console.log(`🛡️ Guardian: Silent IP Geolocation successfully bound to ${data.region}`);
                        syncRegionDisplayDom(data.region);
                    }
                })
                .catch(() => console.log("🛡️ Guardian: IP Geolocation bypassed (AdBlocker, Timeout, or Offline)"));
        }
    }
}

// --- GUARDIAN FETCH WRAPPER ---
export async function guardianFetch(url, options = {}, timeoutMs = 8000) {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && !navigator.onLine) {
        isLieFi = true;
        throw new Error("OS reports offline state.");
    }
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    
    if (options.signal) {
        if (options.signal.aborted) controller.abort();
        else options.signal.addEventListener('abort', () => controller.abort());
    }
    
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        isLieFi = false;
        _networkStruggleCount = 0;
        
        if (typeof document !== 'undefined') {
            const oi = document.getElementById('offline-indicator');
            if (oi) oi.style.display = 'none';

            const toastEl = document.getElementById('toast');
            if (toastEl && toastEl.classList.contains('show') && (toastEl.innerText || '').includes('Please wait while we load schedules')) {
                showToast("Connection stabilized. Schedules loading.", "success", 2000);
            }
        }
        return response;
    } catch (error) {
        clearTimeout(id);
        if (options.signal && options.signal.aborted) {
            isLieFi = false; 
            throw error;
        }

        if (error.name === 'AbortError' || (error.message && (error.message.includes('fetch') || error.message.includes('Network')))) {
            _networkStruggleCount++;
            if (typeof navigator !== 'undefined' && navigator.onLine) {
                console.warn(`🛡️ Guardian: Request to ${url} timed out. Very slow connection.`);
                if (_networkStruggleCount >= 3) {
                    const hasRamCache = !!$fullDatabase.get();
                    const hasDiskCache = !!safeStorage.getItem(`full_db_${$userRegion.get() || 'GP'}`);
                    if (hasRamCache || hasDiskCache) {
                        _networkStruggleCount = 0;
                    } else if (typeof window !== 'undefined' && typeof window.triggerNetworkStruggleModal === 'function') {
                        window.triggerNetworkStruggleModal();
                        _networkStruggleCount = 0;
                    }
                } else {
                    const now = Date.now();
                    if (now - _lastSlowNetworkToastTime > 6000) {
                        _lastSlowNetworkToastTime = now;
                        showToast("Connection is very slow. Still trying...", "warning", 3500);
                    }
                }
            } else {
                isLieFi = true;
                if (typeof document !== 'undefined') {
                    const maintBanner = document.getElementById('maintenance-banner');
                    if (maintBanner) maintBanner.style.display = 'none';
                    const oi = document.getElementById('offline-indicator');
                    if (oi) oi.style.display = 'flex';
                    showOfflineToast(60000);
                }
            }
        }
        throw error;
    }
}

/** Nuclear safety valve — wipe client caches when remote killswitch timestamp advances. */
export async function checkKillswitch(force = false) {
    if (typeof navigator !== 'undefined' && (!navigator.onLine || (isLieFi && !force))) return false;
    try {
        const timeBucket = Math.floor(Date.now() / 300000);
        const res = await guardianFetch(`${DYNAMIC_BASE_URL}config/killswitch.json?t=${timeBucket}`, {}, 3000);
        if (!res.ok) return false;
        const data = await res.json();
        if (!data || !data.timestamp) return false;

        const localTimestamp = safeStorage.getItem('last_killswitch_timestamp');
        if (localTimestamp && data.timestamp <= parseInt(localTimestamp, 10)) return false;

        console.log("☢️ GUARDIAN KILLSWITCH ACTIVATED. Wiping all local data...");
        safeStorage.setItem('last_killswitch_timestamp', String(data.timestamp));

        if (typeof window !== 'undefined' && typeof window.performHardCacheClear === 'function') {
            window.performHardCacheClear('system_killswitch');
        } else if (typeof window !== 'undefined') {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then((regs) => {
                    for (const reg of regs) reg.unregister();
                });
            }
            if ('caches' in window) {
                caches.keys().then((names) => {
                    for (const name of names) caches.delete(name);
                });
            }
            try {
                const region = $userRegion.get() || 'GP';
                safeStorage.removeItem(`full_db_${region}`);
                safeStorage.removeItem('app_installed_version');
                // Best-effort IndexedDB wipe
                if (window.indexedDB && indexedDB.deleteDatabase) {
                    indexedDB.deleteDatabase('NextTrainDB');
                }
            } catch (e) {}
            markPendingReload('killswitch', 500);
            setTimeout(() => { window.location.reload(); }, 500);
        }
        return true;
    } catch (e) {
        console.warn("Killswitch check failed:", e);
        return false;
    }
}

/** Remote special-event route activation without a deploy. */
export async function fetchSpecialEventConfig(force = false) {
    if (typeof navigator !== 'undefined' && (!navigator.onLine || (isLieFi && !force))) return;
    try {
        const timeBucket = Math.floor(Date.now() / 300000);
        const eventResp = await guardianFetch(`${DYNAMIC_BASE_URL}config/special_event.json?t=${timeBucket}`, {}, 4000);
        if (!eventResp.ok) return;
        const eventData = await eventResp.json();
        if (!eventData || !ROUTES['special_event']) return;

        ROUTES['special_event'].isActive = eventData.isActive === true;
        if (eventData.name) ROUTES['special_event'].name = eventData.name;
        if (eventData.destA) ROUTES['special_event'].destA = eventData.destA;
        if (eventData.destB) ROUTES['special_event'].destB = eventData.destB;
        if (eventData.region && ['GP', 'WC', 'KZN', 'EC'].includes(eventData.region)) {
            ROUTES['special_event'].region = eventData.region;
        }

        if (typeof window !== 'undefined' && window.Renderer?.renderRouteMenu) {
            window.Renderer.renderRouteMenu('route-list', getRoutesForCurrentRegion(), $currentRouteId.get());
        }
    } catch (e) {
        console.warn("Failed to fetch special event config", e);
    }
}

// --- DATABASE ENGINE (IndexedDB / Async Storage) ---
const DB_NAME = 'NextTrainDB';
const STORE_NAME = 'SchedulesStore';
const DB_VERSION = 1;

export function initDB(retryCount = 0) {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
            reject(new Error("IndexedDB not supported"));
            return;
        }
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (e) => {
                if (retryCount === 0) {
                    const deleteReq = indexedDB.deleteDatabase(DB_NAME);
                    deleteReq.onsuccess = () => initDB(1).then(resolve).catch(reject);
                    deleteReq.onerror = () => reject(new Error("Fatal IDB Deletion Failure"));
                } else reject(e.target.error || new Error("IDB Open Error"));
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
        } catch(err) { reject(err); }
    });
}

export async function saveToLocalCache(key, data, signal = null) {
    if (signal && signal.aborted) return false;
    const cacheEntry = { timestamp: Date.now(), data: data };
    memoryFallbackCache[key] = cacheEntry;

    try {
        const db = await initDB();
        if (signal && signal.aborted) return false;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(cacheEntry, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        try { safeStorage.setItem(key, JSON.stringify(cacheEntry)); } catch(ex) {}
        return false;
    }
}

export async function loadFromLocalCache(key, signal = null) {
    if (signal && signal.aborted) return null;
    if (memoryFallbackCache[key]) return memoryFallbackCache[key];

    try {
        const db = await initDB();
        if (signal && signal.aborted) return null;
        
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(key);
            request.onsuccess = () => {
                if (signal && signal.aborted) return resolve(null);
                if (request.result) {
                    memoryFallbackCache[key] = request.result; 
                    resolve(request.result);
                } else resolve(null);
            }
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        try { 
            const item = safeStorage.getItem(key); 
            if (item) {
                const parsed = JSON.parse(item);
                memoryFallbackCache[key] = parsed;
                return parsed;
            }
            return null;
        } catch (ex) { return null; }
    }
}

// --- PARSERS & HELPERS ---

export function parseJSONSchedule(jsonRows, externalMetaDate = null) {
    try {
        if (!jsonRows || !Array.isArray(jsonRows) || jsonRows.length === 0) 
            return { headers: [], rows: [], stationColumnName: 'STATION', lastUpdated: externalMetaDate };

        let extractedLastUpdated = externalMetaDate;
        
        if (jsonRows.length > 0) {
            const firstRow = jsonRows[0];
            const values = Object.values(firstRow).map(String);
            const dateValueIndex = values.findIndex(v => /last updated/i.test(v));
            if (dateValueIndex !== -1) {
                 let val = values[dateValueIndex];
                 if (val.length > 15) extractedLastUpdated = val;
                 else if (values[dateValueIndex+1]) extractedLastUpdated = values[dateValueIndex+1];
            }
        }

        const cleanRows = jsonRows.filter(row => {
            const s = row['STATION'];
            if (!s || typeof s !== 'string') return false;
            const lower = s.toLowerCase().trim();
            if (lower.startsWith('last updated') || lower.startsWith('updated:')) return false; 
            if (lower.includes('inter-station') || lower.includes('trip')) return false; 
            return true;
        });

        if (cleanRows.length === 0) return { headers: [], rows: [], stationColumnName: 'STATION', lastUpdated: extractedLastUpdated };

        const allHeaders = new Set();
        cleanRows.forEach(row => { 
            Object.keys(row).forEach(key => { 
                if (key !== 'STATION' && key !== 'COORDINATES' && key !== 'row_index' && key !== 'KM_MARK') allHeaders.add(key); 
            }); 
        });
        const trainNumbers = Array.from(allHeaders).sort();
        
        return { stationColumnName: 'STATION', headers: ['STATION', ...trainNumbers], rows: cleanRows, lastUpdated: extractedLastUpdated };
    } catch (e) {
        return { headers: [], rows: [], stationColumnName: 'STATION', lastUpdated: externalMetaDate };
    }
}

export async function processRouteDataFromDBAsync(route, targetDB) {
    if (!targetDB) return {};
    const getSched = async (key) => {
        await new Promise(resolve => setTimeout(resolve, 0));
        const rows = targetDB[key];
        const metaKey = key + "_meta"; 
        const metaDate = targetDB[metaKey]; 
        return parseJSONSchedule(rows, metaDate); 
    };

    return {
        weekday_to_a: await getSched(route.sheetKeys.weekday_to_a),
        weekday_to_b: await getSched(route.sheetKeys.weekday_to_b),
        saturday_to_a: await getSched(route.sheetKeys.saturday_to_a),
        saturday_to_b: await getSched(route.sheetKeys.saturday_to_b)
    };
}

export async function buildGlobalStationIndexAsync(targetDB) {
    let tempIndex = {}; 
    if (!targetDB) return tempIndex;

    const hasActiveService = (row, sKey, cKey) => {
        const ignored = new Set([sKey, cKey, 'KM_MARK', 'row_index']);
        return Object.keys(row).some(k => !ignored.has(k) && row[k] && String(row[k]).trim() !== "");
    };

    const routeList = Object.values(ROUTES);
    for (let i = 0; i < routeList.length; i++) {
        const route = routeList[i];
        if (route.region !== $userRegion.get()) continue;
        if (!route.sheetKeys) continue;

        await new Promise(resolve => setTimeout(resolve, 0));

        Object.values(route.sheetKeys).forEach(dbKey => {
            const sheetData = targetDB[dbKey];
            if (!sheetData || !Array.isArray(sheetData)) return;
            
            let headerIndex = -1;
            for (let j = 0; j < Math.min(sheetData.length, 5); j++) {
                 if (Object.values(sheetData[j]).some(val => val && String(val).toUpperCase().includes('STATION'))) {
                     headerIndex = j; break;
                 }
            }
            
            if (headerIndex > -1) {
                 for (let j = headerIndex + 1; j < sheetData.length; j++) {
                      const row = sheetData[j];
                      const headerRow = sheetData[headerIndex];
                      let stationKey = null; let coordKey = null;
                      
                      Object.keys(headerRow).forEach(key => {
                          const valUpper = String(headerRow[key]).toUpperCase();
                          if (valUpper.includes('STATION')) stationKey = key;
                          if (valUpper.includes('COORDINATES')) coordKey = key;
                      });

                      if (!stationKey && row[stationKey]) stationKey = 'STATION';
                      if (!coordKey && row['COORDINATES']) coordKey = 'COORDINATES';

                      if (stationKey && row[stationKey]) {
                           if (!hasActiveService(row, stationKey, coordKey)) continue;
                           const stationName = normalizeStationName(row[stationKey]);
                           const coordVal = coordKey ? row[coordKey] : null;
                           let coords = { lat: null, lon: null };
                           
                           try {
                               if (coordVal) {
                                   const parts = String(coordVal).split(',').map(s => parseFloat(s.trim()));
                                   if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) coords = { lat: parts[0], lon: parts[1] };
                               }
                           } catch (e) { }

                           if (!tempIndex[stationName]) {
                               tempIndex[stationName] = { lat: coords.lat, lon: coords.lon, routes: new Set() };
                           } else if (tempIndex[stationName].lat === null && coords.lat !== null) {
                               tempIndex[stationName].lat = coords.lat;
                               tempIndex[stationName].lon = coords.lon;
                           }
                           if (tempIndex[stationName]) tempIndex[stationName].routes.add(route.id);
                      }
                 }
            } else {
                 sheetData.forEach(row => {
                    let stationKey = row['STATION'] !== undefined ? 'STATION' : null;
                    let coordKey = row['COORDINATES'] !== undefined ? 'COORDINATES' : null;

                    if (stationKey && row[stationKey]) {
                        if (!hasActiveService(row, stationKey, coordKey)) return;
                        const stationName = normalizeStationName(row[stationKey]);
                        let coords = { lat: null, lon: null };
                        
                        try {
                            if (coordKey && row[coordKey]) {
                                const parts = String(row[coordKey]).split(',').map(s => parseFloat(s.trim()));
                                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) coords = { lat: parts[0], lon: parts[1] };
                            }
                        } catch (e) { }

                        if (!tempIndex[stationName]) {
                            tempIndex[stationName] = { lat: coords.lat, lon: coords.lon, routes: new Set() };
                        } else if (tempIndex[stationName].lat === null && coords.lat !== null) {
                            tempIndex[stationName].lat = coords.lat;
                            tempIndex[stationName].lon = coords.lon;
                        }
                        if (tempIndex[stationName]) tempIndex[stationName].routes.add(route.id);
                    }
                });
            }
        });
    }
    return tempIndex;
}

// --- GUARDIAN PHASE B: EAGER RENDERING PROTOCOL ---
export async function loadAllSchedules(force = false) {
    if (typeof window !== 'undefined' && window._suppressReloads && !force) return;

    let usedCache = false; 
    const currentGen = regionSwapGeneration; 
    
    await regionCheckPromise;
    
    if (scheduleAbortController) scheduleAbortController.abort();
    scheduleAbortController = new AbortController();
    const fetchSignal = scheduleAbortController.signal;
    const requestedRouteId = $currentRouteId.get();
    
    try {
        if (!requestedRouteId) return; 
        const currentRoute = ROUTES[requestedRouteId];
        if (!currentRoute) return;

        const unwrapDatabase = (db, region) => {
            if (!db) return null;
            let regionalData = {};
            if (region === 'GP' && db.gauteng) regionalData = db.gauteng;
            else if (region === 'WC' && db.westerncape) regionalData = db.westerncape;
            else if (region === 'KZN' && db.kzn) regionalData = db.kzn;
            else if (region === 'EC' && db.easterncape) regionalData = db.easterncape;
            else if (region === 'GP' && db.schedules && !db.gauteng) regionalData = db.schedules;
            
            const mergedDb = { ...db, ...regionalData };
            delete mergedDb.gauteng; delete mergedDb.westerncape; delete mergedDb.kzn; delete mergedDb.easterncape; delete mergedDb.schedules;
            return mergedDb;
        };

        if (!currentRoute.isActive) return; 

        // 1. EAGER RENDER CACHE LOAD
        const cacheKey = `full_db_${$userRegion.get()}`;
        const cachedDB = await loadFromLocalCache(cacheKey, fetchSignal);

        if (fetchSignal.aborted || $currentRouteId.get() !== requestedRouteId) return;

        if (cachedDB) {
            try {
                const proposedDB = unwrapDatabase(cachedDB.data, $userRegion.get());
                const proposedSchedules = await processRouteDataFromDBAsync(currentRoute, proposedDB);
                const proposedStationIndex = await buildGlobalStationIndexAsync(proposedDB);
                
                if (currentGen !== regionSwapGeneration) return;

                $fullDatabase.set(proposedDB);
                $schedules.set(proposedSchedules);
                $globalStationIndex.set(proposedStationIndex);
                
                const mList = Object.keys(proposedStationIndex).sort();
                $masterStationList.set(mList);
                if (typeof window !== 'undefined') window.MASTER_STATION_LIST = mList;
                
                usedCache = true;
            } catch(err) { console.error("🛡️ Guardian: Cached DB shadow-clone parsing failed.", err); }
        }

        // 2. BACKGROUND NETWORK SYNC (LIE-FI PROTECTED)
        if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && (!navigator.onLine || (isLieFi && !force))) {
            console.log("🛡️ Guardian: Offline/Lie-Fi detected. Halting background network sync.");
            return;
        }

        // Captive portal pre-flight (HTML injected instead of JSON)
        try {
            const preFlightController = new AbortController();
            const preFlightTimeout = setTimeout(() => preFlightController.abort(), 2000);
            const pingRes = await fetch(`https://nexttrain-cache.enock.workers.dev/config/maintenance.json?t=${Date.now()}`, {
                signal: preFlightController.signal,
                cache: 'no-store'
            });
            clearTimeout(preFlightTimeout);
            const contentType = pingRes.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                console.warn("🛡️ Guardian: Captive Portal detected. Engaging Lie-Fi Offline Mode.");
                isLieFi = true;
                if (typeof document !== 'undefined') {
                    const oi = document.getElementById('offline-indicator');
                    if (oi) oi.style.display = 'flex';
                    showOfflineToast(0);
                }
                return;
            }
        } catch (e) {
            console.log("🛡️ Guardian: Pre-flight check complete or timed out. Proceeding to waterfall.");
        }

        const wasKilled = await checkKillswitch(force);
        if (wasKilled || fetchSignal.aborted || $currentRouteId.get() !== requestedRouteId) return;

        await fetchSpecialEventConfig(force);
        if (fetchSignal.aborted || $currentRouteId.get() !== requestedRouteId) return;

        // Ops overlays (ghost trains / disruption badges)
        const edgeCacheBucket = Math.floor(Date.now() / 300000);
        try {
            const exclResp = await guardianFetch(`${DYNAMIC_BASE_URL}exclusions.json?t=${edgeCacheBucket}`, { signal: fetchSignal }, 4000);
            if (exclResp.ok) {
                const exclData = await exclResp.json();
                if (exclData) {
                    const now = Date.now();
                    const nextExclusions = {};
                    Object.keys(exclData).forEach((routeKey) => {
                        const routeExclusions = exclData[routeKey];
                        if (routeExclusions && typeof routeExclusions === 'object') {
                            nextExclusions[routeKey] = {};
                            Object.keys(routeExclusions).forEach((itemKey) => {
                                const item = routeExclusions[itemKey];
                                if (!item.expiresAt || item.expiresAt > now) {
                                    nextExclusions[routeKey][itemKey] = item;
                                }
                            });
                            if (Object.keys(nextExclusions[routeKey]).length === 0) {
                                delete nextExclusions[routeKey];
                            }
                        }
                    });
                    $globalExclusions.set(nextExclusions);
                }
            }
        } catch (e) {
            console.warn('Exclusions fetch failed, using defaults.');
        }

        try {
            const disrResp = await guardianFetch(`${DYNAMIC_BASE_URL}disruptions.json?t=${edgeCacheBucket}`, { signal: fetchSignal }, 4000);
            if (disrResp.ok) {
                const disrData = await disrResp.json();
                if (disrData) {
                    const now = Date.now();
                    const nextDisruptions = {};
                    Object.keys(disrData).forEach((routeKey) => {
                        const routeObj = disrData[routeKey];
                        if (routeObj && typeof routeObj === 'object') {
                            Object.values(routeObj).forEach((d) => {
                                if (d && d.routeId && (!d.expiresAt || d.expiresAt > now)) {
                                    if (!nextDisruptions[d.routeId]) nextDisruptions[d.routeId] = [];
                                    nextDisruptions[d.routeId].push(d);
                                }
                            });
                        }
                    });
                    $globalDisruptions.set(nextDisruptions);
                }
            }
        } catch (e) {
            console.warn('Disruptions fetch failed.');
        }

        let needsDownload = true;

        if (needsDownload) {
            let newDatabase = null;
            let fetchSuccess = false;
            let sourcesToTry = ['FIREBASE', 'CLOUDFLARE', 'GITHUB'];

            for (const sourceKey of sourcesToTry) {
                if (fetchSignal.aborted || $currentRouteId.get() !== requestedRouteId) return;

                let regionDbUrl = "";
                if (PIPELINE_SOURCES[sourceKey]) {
                    const sourceConfig = PIPELINE_SOURCES[sourceKey];
                    const nodePath = sourceConfig.useRootNode ? REGIONS[$userRegion.get()].rootNode : REGIONS[$userRegion.get()].dbNode;
                    regionDbUrl = sourceConfig.url + nodePath;
                }
                const separator = regionDbUrl.includes('?') ? '&' : '?';
                regionDbUrl += `${separator}t=${Date.now()}`;

                try {
                    const timeoutMs = sourceKey === 'CLOUDFLARE' ? 8000 : 12000;
                    const response = await guardianFetch(regionDbUrl, { signal: fetchSignal }, timeoutMs);
                    if (fetchSignal.aborted || $currentRouteId.get() !== requestedRouteId) return; 
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    newDatabase = await response.json();
                    if (!newDatabase) throw new Error("Empty database payload");
                    fetchSuccess = true;
                    break; 
                } catch (e) {
                    if (e.name === 'AbortError') throw e; 
                }
            }

            if (!fetchSuccess || !newDatabase) throw new Error("All data pipeline endpoints failed");

            const newStr = JSON.stringify(newDatabase);
            const oldStr = cachedDB ? JSON.stringify(cachedDB.data) : "";

            if (newStr !== oldStr) {
                if (fetchSignal.aborted || $currentRouteId.get() !== requestedRouteId) return; 
                
                try {
                    const proposedDB = unwrapDatabase(newDatabase, $userRegion.get());
                    const proposedSchedules = await processRouteDataFromDBAsync(currentRoute, proposedDB);
                    const proposedStationIndex = await buildGlobalStationIndexAsync(proposedDB);
                    
                    if (currentGen !== regionSwapGeneration) return;

                    $fullDatabase.set(proposedDB);
                    $schedules.set(proposedSchedules);
                    $globalStationIndex.set(proposedStationIndex);
                    
                    const mList = Object.keys(proposedStationIndex).sort();
                    $masterStationList.set(mList);
                    if (typeof window !== 'undefined') window.MASTER_STATION_LIST = mList;

                    await saveToLocalCache(cacheKey, newDatabase, fetchSignal); 
                } catch(e) { throw e; }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error("Fetch Error:", error);
        const hasUsableData = !!$fullDatabase.get();
        if (!usedCache && !hasUsableData && typeof document !== 'undefined') {
            const oi = document.getElementById('offline-indicator');
            if (oi) oi.style.display = 'flex';
        }
    } finally {
        if (fetchSignal && fetchSignal.aborted) return;

        const forceReloadBtn = typeof document !== 'undefined' ? document.getElementById('force-reload-btn') : null;
        if (forceReloadBtn) {
            forceReloadBtn.disabled = false;
            const reloadIcon = forceReloadBtn.querySelector('svg');
            if (reloadIcon) reloadIcon.classList.remove('spinning');
        }

        const mainContent = typeof document !== 'undefined' ? document.getElementById('main-content') : null;
        if ($currentRouteId.get() && mainContent) mainContent.style.display = '';

        const welcomeModal = typeof document !== 'undefined' ? document.getElementById('welcome-modal') : null;
        const isWelcomeActive = welcomeModal && !welcomeModal.classList.contains('hidden');
        if (typeof window !== 'undefined' && $currentRouteId.get() && !isWelcomeActive) {
            window._appStabilized = true;
            if (typeof window.checkAndUnhide === 'function') window.checkAndUnhide();
        }
    }
}

export function executeRegionSwap(newRegion, isFromWelcomeScreen = false) {
    console.log(`🛡️ Guardian: Executing seamless SPA region swap to ${newRegion}...`);
    regionSwapGeneration++;
    
    $userRegion.set(newRegion);
    syncRegionDisplayDom(newRegion);

    memoryFallbackCache = {}; 
    $fullDatabase.set(null); 
    $schedules.set({});
    $globalStationIndex.set({}); 
    $masterStationList.set([]);
    currentScheduleData = {};
    lastTrackedOD = null;
    $currentRouteId.set(null);

    if (typeof document !== 'undefined') {
        const mainContent = document.getElementById('main-content');
        if (mainContent) mainContent.style.display = 'none';

        const stationSelect = document.getElementById('station-select');
        if (stationSelect) {
            stationSelect.innerHTML = '<option value="">Loading stations...</option>';
            stationSelect.value = '';
        }

        const searchInput = document.getElementById('station-search-input');
        if (searchInput) {
            searchInput.value = '';
            delete searchInput.dataset.resolvedValue;
        }

        const plannerFrom = document.getElementById('planner-from-search');
        const plannerTo = document.getElementById('planner-to-search');
        const plannerFromSelect = document.getElementById('planner-from');
        const plannerToSelect = document.getElementById('planner-to');
        if (plannerFrom) { plannerFrom.value = ''; delete plannerFrom.dataset.resolvedValue; }
        if (plannerTo) { plannerTo.value = ''; delete plannerTo.dataset.resolvedValue; }
        if (plannerFromSelect) {
            plannerFromSelect.innerHTML = '<option value="">Loading stations...</option>';
            plannerFromSelect.value = '';
        }
        if (plannerToSelect) {
            plannerToSelect.innerHTML = '<option value="">Loading stations...</option>';
            plannerToSelect.value = '';
        }

        if (typeof window !== 'undefined' && typeof window.hidePlannerResults === 'function') {
            window.hidePlannerResults();
        }
    }

    if (typeof window !== 'undefined' && window.Renderer?.renderRouteMenu) {
        window.Renderer.renderRouteMenu('route-list', getRoutesForCurrentRegion(), null);
    }

    applyMapImageForRegion(newRegion);

    // Welcome-screen swaps must not auto-assign / download (race with route pick)
    if (isFromWelcomeScreen) {
        console.log("🛡️ Guardian: Region swapped from Welcome Screen. Skipping auto-assign to prevent race condition.");
        return;
    }

    let savedDefault = null;
    try { savedDefault = safeStorage.getItem('defaultRoute_' + newRegion); } catch (e) {}

    let nextRouteId = null;
    if (savedDefault && ROUTES[savedDefault] && ROUTES[savedDefault].region === newRegion) {
        nextRouteId = savedDefault;
    } else {
        const regionRoutes = Object.values(ROUTES).filter(r => r.region === newRegion && r.isActive && r.id !== 'special_event');
        if (regionRoutes.length > 0) nextRouteId = regionRoutes[0].id;
    }

    if (nextRouteId) {
        if (!savedDefault || ROUTES[savedDefault]?.region !== newRegion) {
            try { safeStorage.setItem('defaultRoute_' + newRegion, nextRouteId); } catch (e) {}
        }
        $currentRouteId.set(nextRouteId);
        if (typeof window !== 'undefined' && typeof window.updatePinUI === 'function') window.updatePinUI();

        const pret = typeof document !== 'undefined' ? document.getElementById('pretoria-time') : null;
        const pien = typeof document !== 'undefined' ? document.getElementById('pienaarspoort-time') : null;
        if (window.Renderer?.renderSkeletonLoader) {
            if (pret) window.Renderer.renderSkeletonLoader(pret);
            if (pien) window.Renderer.renderSkeletonLoader(pien);
        }

        loadAllSchedules(true).then(() => {
            if (typeof window !== 'undefined' && typeof window.checkServiceAlerts === 'function') {
                window.checkServiceAlerts();
            }
            const mainContent = typeof document !== 'undefined' ? document.getElementById('main-content') : null;
            if (mainContent) mainContent.style.display = '';
        });
    } else if (typeof window !== 'undefined' && typeof window.showWelcomeScreen === 'function') {
        window.showWelcomeScreen();
    }
}

export function updateTime() {
    try {
        let day, timeString;
        let dateToCheck = null; 
        const simActive = $isSimMode.get();
        
        if (simActive) {
            day = currentDayIndex; // Need specific admin linking later
            timeString = $simTime.get() || "12:00:00"; 
        } else {
            const now = new Date();
            day = now.getDay(); 
            const p = n => (n < 10 ? '0' + n : n);
            timeString = p(now.getHours()) + ":" + p(now.getMinutes()) + ":" + p(now.getSeconds());
            dateToCheck = now;
        }
        
        currentTime = timeString;
        
        // DOM Updates are safe if we check window
        if (typeof document !== 'undefined') {
            const currentTimeEl = document.getElementById('current-time');
            if (currentTimeEl) currentTimeEl.textContent = `${timeString} ${simActive ? '(SIM)' : ''}`;
        }
        
        let newDayType = (day === 0) ? 'sunday' : (day === 6 ? 'saturday' : 'weekday');
        let dateKey = null;
        
        if (dateToCheck) {
            var m = String(dateToCheck.getMonth() + 1).padStart(2, '0');
            var d = String(dateToCheck.getDate()).padStart(2, '0');
            dateKey = m + "-" + d;
            if (SPECIAL_DATES[dateKey]) { 
                newDayType = SPECIAL_DATES[dateKey]; 
            }
        }
        
        if (newDayType !== currentDayType) { 
            currentDayType = newDayType; 
            currentDayIndex = day; 
        } else { 
            currentDayIndex = day; 
        }

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        let displayType = newDayType === 'sunday' ? 'No Service'
            : (newDayType === 'saturday' ? 'Saturday Schedule' : 'Weekday Schedule');
        if (dateKey && HOLIDAY_NAMES[dateKey]) {
            displayType = newDayType === 'sunday'
                ? `${HOLIDAY_NAMES[dateKey]} · No Service`
                : `${HOLIDAY_NAMES[dateKey]} Schedule`;
        }
        if (typeof document !== 'undefined') {
            const currentDayEl = document.getElementById('current-day');
            if (currentDayEl) {
                const typeClass = newDayType === 'sunday'
                    ? 'font-bold text-red-600 dark:text-red-400 ml-1'
                    : 'font-bold text-blue-600 dark:text-blue-400 ml-1';
                currentDayEl.innerHTML = `${dayNames[day]} <span class="${typeClass}">${displayType}</span>`;
            }
        }

        // Planner / legacy shims read these from window (after dayType settles)
        if (typeof window !== 'undefined') {
            window.currentTime = currentTime;
            window.currentDayType = currentDayType;
            window.currentDayIndex = currentDayIndex;
        }

        // --- MINUTE CHANGE THROTTLED RECALCULATION & LIVE REACTION ---
        let currentMinute = -1;
        if (simActive) {
            const simTimeStr = $simTime.get() || "12:00:00";
            const parts = simTimeStr.split(':');
            if (parts.length > 1) currentMinute = parseInt(parts[1], 10);
        } else {
            currentMinute = new Date().getMinutes();
        }

        // Recalculate once per minute or instantly if simulating
        if (lastRenderedMinute !== currentMinute || simActive) {
            lastRenderedMinute = currentMinute;
            
            // Securely look for globally bound view controllers (LiveBoard bridges)
            if (typeof window !== 'undefined') {
                if (typeof window.findNextTrains === 'function') {
                    window.findNextTrains();
                }
                
                if (typeof window.updateFareDisplay === 'function') {
                    const activeRoute = $currentRouteId.get();
                    let sKey = null;
                    if (activeRoute && ROUTES[activeRoute]) {
                        sKey = currentDayType === 'weekday' ? ROUTES[activeRoute].sheetKeys.weekday_to_a : ROUTES[activeRoute].sheetKeys.saturday_to_a;
                    }
                    window.updateFareDisplay(sKey, currentTime);
                }
            }
        }

    } catch(e) { console.error("Error in updateTime", e); }
}

export function startClock() { 
    updateTime(); 
    if (typeof window !== 'undefined') {
        setInterval(updateTime, 1000);
    }
}

// Attach to window namespace for backward-compatible triggers & third-party shims
if (typeof window !== 'undefined') {
    window.startClock = startClock;
    window.currentTime = currentTime;
    window.currentDayType = currentDayType;
    window.currentDayIndex = currentDayIndex;
    window.guardianFetch = guardianFetch;
    window.executeRegionSwap = executeRegionSwap;
    window.checkKillswitch = checkKillswitch;
    window.fetchSpecialEventConfig = fetchSpecialEventConfig;
    Object.defineProperty(window, 'isLieFi', {
        get: () => isLieFi,
        set: (v) => { isLieFi = v; },
        configurable: true
    });
}