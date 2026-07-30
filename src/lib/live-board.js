/**
 * METRORAIL NEXT TRAIN - LIVE BOARD ENGINE (Phase 2 port from SPA)
 * Auto-assembled — prefer editing SPA source then re-running assemble script,
 * or patch this file carefully.
 */
import {
    $userRegion, $currentRouteId, $userProfile, $fullDatabase, $schedules,
    $globalStationIndex, $masterStationList, $globalExclusions, $globalDisruptions,
    $isSimMode, $simTime
} from '../store.js';
import {
    ROUTES, SPECIAL_DATES, FARE_CONFIG, DEFAULT_EXCLUSIONS, REFRESH_CONFIG, DYNAMIC_BASE_URL
} from './config.js';
import {
    normalizeStationName, timeToSeconds, formatTimeDisplay, safeStorage,
    getDistanceFromLatLonInKm, escapeHTML
} from './utils.js';
import {
    parseJSONSchedule, currentTime, currentDayType, currentDayIndex,
    loadAllSchedules, guardianFetch
} from './logic.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';

// --- Store-backed globals (SPA parity shims) ---
let allStations = [];
let lastTrackedOD = null;
export let currentScheduleData = {};
let refreshTimer = null;

const getCurrentRouteId = () => $currentRouteId.get();
const getCurrentRegion = () => $userRegion.get() || 'GP';
const getFullDatabase = () => $fullDatabase.get();
const getSchedules = () => $schedules.get() || {};
const getGlobalStationIndex = () => $globalStationIndex.get() || {};
const getGlobalExclusions = () => $globalExclusions.get() || {};
const getGlobalDisruptions = () => $globalDisruptions.get() || {};
const getUserProfile = () => $userProfile.get() || 'Adult';
const getCurrentTime = () => (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : currentTime;
const getCurrentDayType = () => (typeof window !== 'undefined' && window.currentDayType) ? window.currentDayType : currentDayType;
const getCurrentDayIndex = () => (typeof window !== 'undefined' && window.currentDayIndex !== undefined) ? window.currentDayIndex : currentDayIndex;

function stationSelectEl() { return typeof document !== 'undefined' ? document.getElementById('station-select') : null; }
function pretoriaTimeEl() { return typeof document !== 'undefined' ? document.getElementById('pretoria-time') : null; }
function pienaarspoortTimeEl() { return typeof document !== 'undefined' ? document.getElementById('pienaarspoort-time') : null; }
function pretoriaHeaderEl() { return typeof document !== 'undefined' ? document.getElementById('pretoria-header') : null; }
function pienaarspoortHeaderEl() { return typeof document !== 'undefined' ? document.getElementById('pienaarspoort-header') : null; }
function lastUpdatedEl() { return typeof document !== 'undefined' ? document.getElementById('last-updated-date') : null; }
function locateBtnEl() { return typeof document !== 'undefined' ? document.getElementById('locate-btn') : null; }

function trackAnalyticsEvent(name, params) {
    try {
        if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
            window.gtag('event', name, params || {});
        }
    } catch (e) {}
}


export function getLookaheadDayInfo(daysAhead = 1) {
    let baseDate = new Date();
    
    // Respect Developer Sim Mode Base Date
    if ($isSimMode.get()) {
        const dateInput = document.getElementById('sim-date');
        if (dateInput && dateInput.value) {
            const parts = dateInput.value.split('-');
            if(parts.length === 3) {
                baseDate = new Date(parts[0], parts[1] - 1, parts[2]);
            }
        }
    }

    // Advance the physical date
    baseDate.setDate(baseDate.getDate() + daysAhead);

    const dayOfWeek = baseDate.getDay(); // 0 = Sunday, 6 = Saturday
    let dayType = (dayOfWeek === 0) ? 'sunday' : (dayOfWeek === 6 ? 'saturday' : 'weekday');
    
    // GUARDIAN BUGFIX: Do not overwrite physical day names with Holiday Titles.
    // Commuters need to read "First train on Monday is at", not "Public Holiday".
    let dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];
    if (daysAhead === 1) dayName = "Tomorrow";

    // Pad month and date for dictionary matching (e.g. "04-06")
    const m = String(baseDate.getMonth() + 1).padStart(2, '0');
    const d = String(baseDate.getDate()).padStart(2, '0');
    const dateKey = `${m}-${d}`;

    // Override the Schedule Type if it's a Special Date (Public Holiday)
    if (typeof SPECIAL_DATES !== 'undefined' && SPECIAL_DATES[dateKey]) {
        dayType = SPECIAL_DATES[dateKey];
    }

    return {
        type: dayType,
        name: dayName,
        idx: dayOfWeek,
        isHoliday: !!(typeof SPECIAL_DATES !== 'undefined' && SPECIAL_DATES[dateKey])
    };
};

// --- GUARDIAN PHASE 1 (Bug 4 Fix): The True Day Simulator ---
// Looks up to 7 days ahead to find the very next physical train that runs,
// securely bypassing Ghost Exclusions on Public Holidays and weekends.
export function simulateNextActiveService(selectedStation, destination) {
    if (!getCurrentRouteId() || !ROUTES[getCurrentRouteId()]) return null;
    const currentRoute = ROUTES[getCurrentRouteId()];
    
    let firstTrain = null;
    let daysAhead = 1;
    let nextDayInfo = null;

    const isDestA = (destination === currentRoute.destA);

    while (daysAhead <= 7 && !firstTrain) {
        nextDayInfo = window.getLookaheadDayInfo(daysAhead);
        
        // GUARDIAN BUGFIX: The Sunday Mirage Patch.
        if (nextDayInfo.type === 'sunday') {
            daysAhead++;
            continue;
        }

        const sheetKey = isDestA
            ? (nextDayInfo.type === 'weekday' ? 'weekday_to_a' : 'saturday_to_a')
            : (nextDayInfo.type === 'weekday' ? 'weekday_to_b' : 'saturday_to_b');

        const schedule = getSchedules()[sheetKey];
        
        if (schedule && schedule.rows && schedule.rows.length > 0) {
            const res = isDestA
                ? findNextJourneyToDestA(selectedStation, "00:00:00", schedule, currentRoute, nextDayInfo.idx)
                : findNextJourneyToDestB(selectedStation, "00:00:00", schedule, currentRoute, nextDayInfo.idx);
            
            const remainingJourneys = res.allJourneys.filter(j => timeToSeconds(j.departureTime || j.train1.departureTime) >= 0);
            if (remainingJourneys.length > 0) {
                firstTrain = remainingJourneys[0];
            }
        }
        
        if (!firstTrain) daysAhead++;
    }

    if (firstTrain) {
        return {
            train: firstTrain,
            dayInfo: nextDayInfo,
            daysAhead: daysAhead
        };
    }
    return null;
};

export function formatEffectiveDate(rawDateStr) {
    if (!rawDateStr || String(rawDateStr).toLowerCase().includes("undefined") || rawDateStr === "null") return "Unknown";
    let cleanStr = String(rawDateStr).replace(/^last updated[:\s-]*/i, '').trim();
    try {
        if (cleanStr.includes(',')) cleanStr = cleanStr.split(',')[0].trim();
        const d = new Date(cleanStr);
        if (!isNaN(d.getTime())) {
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        }
    } catch(e) {}
    return cleanStr;
}

// NEW HELPER: Count shared stations between two routes
export function getSharedStationCount(routeAId, routeBId) {
    let count = 0;
    for (const stationName in getGlobalStationIndex()) {
        const routes = getGlobalStationIndex()[stationName].routes;
        if (routes.has(routeAId) && routes.has(routeBId)) {
            count++;
        }
    }
    return count;
}

// NEW HELPER (V4.39): Get all future stations on the current route from a starting point
export function getTargetStations(schedule, fromStation) {
    if (!schedule || !schedule.rows) return new Set();
    const rows = schedule.rows;
    const fromIdx = rows.findIndex(r => normalizeStationName(r.STATION) === normalizeStationName(fromStation));
    
    if (fromIdx === -1) return new Set();
    
    const targets = new Set();
    for (let i = fromIdx + 1; i < rows.length; i++) {
        targets.add(normalizeStationName(rows[i].STATION));
    }
    return targets;
}

// NEW HELPER (V4.39): Check if a shared train actually stops at any of our target future stations
export function hasForwardOverlap(trainName, otherSchedule, fromStation, targetStations) {
    if (!otherSchedule || !otherSchedule.rows) return false;
    const rows = otherSchedule.rows;
    const fromIdx = rows.findIndex(r => normalizeStationName(r.STATION) === normalizeStationName(fromStation));
    
    if (fromIdx === -1) return false;

    for (let i = fromIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        // GUARDIAN BUGFIX: Safely cast to string to prevent .trim() crash on numeric cells
        const val = row[trainName] ? String(row[trainName]).trim() : "";
        if (val && val !== "-" && targetStations.has(normalizeStationName(row.STATION))) {
            return true;
        }
    }
    return false;
}

// GUARDIAN HELPER V4.60.70: Ghost Train Logic
export function isTrainExcluded(trainNumber, routeId, dayIdx) {
    if (!trainNumber) return false;
    
    const rules = (getGlobalExclusions() && getGlobalExclusions()[routeId]) 
                  ? getGlobalExclusions()[routeId] 
                  : (typeof DEFAULT_EXCLUSIONS !== 'undefined' ? DEFAULT_EXCLUSIONS[routeId] : null);
    
    if (rules && rules[trainNumber]) {
        const rule = rules[trainNumber];
        
        // GUARDIAN PHASE C: Automatic Expiry Enforcement
        if (rule.expiresAt && Date.now() > rule.expiresAt) {
            return false; // The ban has expired, treat the train as active
        }
        
        if (rule.days && rule.days.includes(parseInt(dayIdx))) {
            // GUARDIAN PHASE 12: Return specific metadata string instead of generic boolean
            return rule.type || 'banned'; 
        }
    }
    return false;
}

// --- GUARDIAN PHASE 3: CROSS-CORRIDOR TIERED INCIDENT MANAGEMENT HELPERS ---
export function checkDisruption(routeId, stationA, stationB) {
    if (!getGlobalDisruptions()) return null;
    
    let highestDisruption = null;
    const normA = normalizeStationName(stationA);
    const normB = normalizeStationName(stationB);

    const prioritizeDisruption = (current, incoming) => {
        if (!current) return incoming;
        if (incoming.tier === 'CRITICAL' && current.tier !== 'CRITICAL') return incoming;
        return current;
    };

    // GUARDIAN PHASE 3: Cross-Corridor Geometry Scan
    // We scan ALL disruptions across the entire network. If a disruption's coordinates
    // match the current commuter's route geometry, we apply it, regardless of the routeId it was filed under.
    for (const dRouteId in getGlobalDisruptions()) {
        const activeDisruptions = getGlobalDisruptions()[dRouteId];
        
        for (const d of activeDisruptions) {
            // If no specific stations are defined, it's a route-wide suspension.
            // This MUST strictly apply only to its parent route to avoid shutting down the whole app.
            if (!d.stations || d.stations.length === 0) {
                if (dRouteId === routeId) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
                continue;
            }

            const normDisruptedStations = d.stations.map(s => normalizeStationName(s));

            // Segment block (e.g., Centurion to Irene) - APPLIES UNIVERSALLY to any route crossing it
            if (normDisruptedStations.length >= 2) {
                if (normDisruptedStations.includes(normA) && normDisruptedStations.includes(normB)) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
            } 
            // Single station block - APPLIES UNIVERSALLY to any route touching it
            else if (normDisruptedStations.length === 1) {
                if (normDisruptedStations.includes(normA) || normDisruptedStations.includes(normB)) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
            }
        }
    }
    return highestDisruption;
};

// GUARDIAN PHASE 3 (ZONE ENGINE): Cross-Corridor "First Point of Contact" Calculation
export function getTripDisruptions(routeId, stopsArray) {
    if (!getGlobalDisruptions() || !stopsArray || stopsArray.length === 0) return [];
    
    const hits = [];
    const seenIds = new Set();
    
    // Helper: Extract the physical geometry (Master Station List) for this specific route.
    const getRouteMasterStations = (rId) => {
        if (!rId || !getFullDatabase() || !ROUTES[rId]) return [];
        const route = ROUTES[rId];
        // Prefer B-direction (outbound) to establish a consistent geographical array
        const key = route.sheetKeys.weekday_to_b || route.sheetKeys.weekday_to_a;
        if (!getFullDatabase()[key]) return [];
        return getFullDatabase()[key]
            .filter(r => r.STATION && !r.STATION.toLowerCase().includes('updated'))
            .map(r => normalizeStationName(r.STATION));
    };

    // The Master Geography for the current route being evaluated
    const currentRouteMasterStations = getRouteMasterStations(routeId);

    // Scan ALL active disruptions across the network (Cross-Corridor Scan)
    for (const dRouteId in getGlobalDisruptions()) {
        const activeDisruptions = getGlobalDisruptions()[dRouteId];
        
        for (const d of activeDisruptions) {
            if (seenIds.has(d.id)) continue;

            // 1. Route-Wide Advisory (0 Stations)
            // Strict limitation: Only applies if the commuter is actually ON the severed route
            if (!d.stations || d.stations.length === 0) {
                if (dRouteId === routeId) {
                    seenIds.add(d.id);
                    hits.push({
                        ...d,
                        triggerStopIndex: 0,
                        triggerStationA: stopsArray[0].station,
                        triggerStationB: stopsArray[stopsArray.length - 1].station
                    });
                }
                continue;
            }

            const normDisrupted = d.stations.map(s => normalizeStationName(s));

            // 2. Single Station Incident (Universal Match)
            if (normDisrupted.length === 1) {
                const targetNorm = normDisrupted[0];
                const contactIdx = stopsArray.findIndex(s => normalizeStationName(s.station) === targetNorm);
                
                if (contactIdx !== -1) {
                    seenIds.add(d.id);
                    hits.push({
                        ...d,
                        triggerStopIndex: contactIdx,
                        triggerStationA: d.stations[0],
                        triggerStationB: d.stations[0]
                    });
                }
                continue;
            }

            // 3. Multi-Station / Non-Adjacent "Danger Zone" Incident (Cross-Corridor Match)
            if (normDisrupted.length >= 2) {
                // We check the disruption geometry against the CURRENT ROUTE's master list
                const idxA = currentRouteMasterStations.indexOf(normDisrupted[0]);
                const idxB = currentRouteMasterStations.indexOf(normDisrupted[1]);

                // If BOTH stations exist on the current route, the Danger Zone intersects!
                if (idxA !== -1 && idxB !== -1) {
                    const minZone = Math.min(idxA, idxB);
                    const maxZone = Math.max(idxA, idxB);

                    let firstContactIdx = -1;
                    
                    // ðŸ›¡ï¸ GUARDIAN PHASE 1 (VECTOR MATH): Trace the commuter's physical trip 
                    // to see if the directional vector CROSSES the Danger Zone, granting 
                    // immunity to trains moving away from the segment.
                    for (let i = 0; i < stopsArray.length - 1; i++) {
                        const stop1Idx = currentRouteMasterStations.indexOf(normalizeStationName(stopsArray[i].station));
                        const stop2Idx = currentRouteMasterStations.indexOf(normalizeStationName(stopsArray[i+1].station));
                        
                        if (stop1Idx !== -1 && stop2Idx !== -1) {
                            // Forward Traversal Check
                            if (stop1Idx <= minZone && stop2Idx >= maxZone) {
                                firstContactIdx = i;
                                break;
                            }
                            // Backward Traversal Check
                            if (stop1Idx >= maxZone && stop2Idx <= minZone) {
                                firstContactIdx = i;
                                break;
                            }
                        }
                    }

                    if (firstContactIdx !== -1) {
                        seenIds.add(d.id);
                        hits.push({
                            ...d,
                            triggerStopIndex: firstContactIdx,
                            triggerStationA: d.stations[0], 
                            triggerStationB: d.stations[1]  
                        });
                    }
                }
            }
        }
    }
    
    // Priority: CRITICAL events float to the top. Then sort by earliest contact index in the journey.
    hits.sort((a, b) => {
        if (a.tier === 'CRITICAL' && b.tier !== 'CRITICAL') return -1;
        if (a.tier !== 'CRITICAL' && b.tier === 'CRITICAL') return 1;
        return a.triggerStopIndex - b.triggerStopIndex;
    });
    
    return hits;
};

export function buildMasterStationList() {
    window.MASTER_STATION_LIST = Object.keys(getGlobalStationIndex()).sort();
    if (typeof renderPlannerHistory === 'function') renderPlannerHistory();
}

export function calculateTimeDiffString(departureTimeStr, dayOffset = 0) {
    try {
        if (!departureTimeStr || typeof departureTimeStr !== 'string') return "";
        const [nowH, nowM, nowS] = getCurrentTime().split(':').map(Number);
        const depParts = departureTimeStr.split(':').map(Number);
        if (depParts.length < 2) return ""; 
        const depH = depParts[0]; const depM = depParts[1]; const depS = depParts[2] || 0;
        let nowTotalSeconds = (nowH * 3600) + (nowM * 60) + nowS;
        let depTotalSeconds = (depH * 3600) + (depM * 60) + depS;
        let diffInSeconds = (depTotalSeconds - nowTotalSeconds) + (dayOffset * 86400);
        if (diffInSeconds < -30) return ""; 
        if (diffInSeconds < 60) return "(Departing now)";
        let diffInMinutes = Math.ceil(diffInSeconds / 60);
        const hours = Math.floor(diffInMinutes / 60);
        const minutes = diffInMinutes % 60;
        return (hours > 0) ? `(in ${hours} hr ${minutes} min)` : `(in ${minutes} min)`;
    } catch (e) { return ""; }
}

export function resolveZoneForRoute(routeId) {
    if (!getFullDatabase() || !routeId || !ROUTES[routeId]) return null;
    const route = ROUTES[routeId];
    const keysToCheck = Object.values(route.sheetKeys);
    for (const key of keysToCheck) {
        const zoneVal = getFullDatabase()[key + "_zone"];
        if (zoneVal && FARE_CONFIG.zones[zoneVal]) return zoneVal; 
    }
    for (const key of keysToCheck) {
        if (key.includes('_to_')) {
            const parts = key.split('_to_');
            if (parts.length === 2) {
                const prefix = parts[0]; 
                const rest = parts[1];
                let suffix = "";
                let dest = "";
                if (rest.endsWith('_weekday')) { suffix = '_weekday'; dest = rest.replace('_weekday', ''); }
                else if (rest.endsWith('_saturday')) { suffix = '_saturday'; dest = rest.replace('_saturday', ''); }
                if (dest && suffix) {
                    const reverseKey = `${dest}_to_${prefix}${suffix}_zone`;
                    const reverseZone = getFullDatabase()[reverseKey];
                    if (reverseZone && FARE_CONFIG.zones[reverseZone]) return reverseZone;
                }
            }
        }
    }
    return null;
}

// ðŸ›¡ï¸ GUARDIAN PHASE 1: REFACTORED FARE ENGINE (Train-Time Dependency Purged)
export function getRouteFare(sheetKey) {
    // ðŸ›¡ï¸ GUARDIAN BUGFIX: Race condition patch to prevent null access during initial load
    if (!getFullDatabase()) return null;
    
    let zoneCode = null;
    if (sheetKey) {
        const zoneKey = sheetKey + "_zone";
        zoneCode = getFullDatabase()[zoneKey];
    }
    if (!zoneCode && getCurrentRouteId()) {
        zoneCode = resolveZoneForRoute(getCurrentRouteId());
    }
    if (!zoneCode || !FARE_CONFIG.zones[zoneCode]) return null; 

    let basePrice = FARE_CONFIG.zones[zoneCode];
    let discountLabel = null;
    let isPromo = false; 
    let isOffPeak = false; 

    const profile = FARE_CONFIG.profiles[getUserProfile()] || FARE_CONFIG.profiles["Adult"];
    let useOffPeakRate = false;
    
    // GUARDIAN BUGFIX 1: Tie Off-Peak explicitly to the Sheet Type (No discounts on Sat/Sun/Holidays)
    let isWeekdaySheet = (getCurrentDayType() === 'weekday');
    if (sheetKey) {
        isWeekdaySheet = sheetKey.includes('weekday');
    }
    
    if (isWeekdaySheet) {
        let checkH, checkM;
        
        // GUARDIAN PHASE 2A: Decouple Off-Peak pricing from individual train departures.
        // Strict adherence to global physical/simulated clock.
        if ($isSimMode.get() && ($simTime.get() || "")) {
            const parts = ($simTime.get() || "").split(':');
            checkH = parseInt(parts[0], 10);
            checkM = parseInt(parts[1], 10);
        } else if (typeof getCurrentTime() !== 'undefined' && getCurrentTime() && getCurrentTime().includes(':')) {
            const parts = getCurrentTime().split(':');
            checkH = parseInt(parts[0], 10);
            checkM = parseInt(parts[1], 10);
        } else {
            const now = new Date();
            checkH = now.getHours();
            checkM = now.getMinutes();
        }
        
        const decimalTime = checkH + (checkM / 60);
        if (decimalTime >= FARE_CONFIG.offPeakStart && decimalTime < FARE_CONFIG.offPeakEnd) {
            useOffPeakRate = true;
        }
    }

    const multiplier = useOffPeakRate ? profile.offPeak : profile.base;
    let finalPrice = basePrice * multiplier;
    finalPrice = Math.ceil(finalPrice * 2) / 2;

    // GUARDIAN FIX: Mutually exclusive Promo vs OffPeak flags to prevent UI collisions
    if (getUserProfile() === "Adult") {
        isPromo = false; // Adults only get the time-based green Off-Peak badge
        if (useOffPeakRate) {
            discountLabel = "40% Off-Peak";
        }
    } else if (multiplier < 1.0) {
        isPromo = true; // Special profiles get the purple Promo badge
        if (getUserProfile() === "Pensioner") discountLabel = "50% Off-Peak";
        else if (getUserProfile() === "Military") discountLabel = "50% Off-Peak";
        else if (getUserProfile() === "Scholar") discountLabel = "50% Discount";
        else discountLabel = "Discounted"; 
    }

    return {
        price: finalPrice.toFixed(2),
        isOffPeak: useOffPeakRate, 
        isPromo: isPromo,
        discountLabel: discountLabel 
    };
}

export function getDetailedFare(sheetKey) {
    if (!getFullDatabase()) return null;
    let zoneCode = null;
    if (sheetKey) {
        const zoneKey = sheetKey + "_zone";
        zoneCode = getFullDatabase()[zoneKey];
    }
    if (!zoneCode && getCurrentRouteId()) {
        zoneCode = resolveZoneForRoute(getCurrentRouteId());
    }
    if (!zoneCode) return null; 

    if (FARE_CONFIG.zones_detailed && FARE_CONFIG.zones_detailed[zoneCode]) {
        return { code: zoneCode, prices: FARE_CONFIG.zones_detailed[zoneCode] };
    }
    return null;
}

export function findNextTrains() {
    if(!getCurrentRouteId()) return;

    const selectedStation = (stationSelectEl() && stationSelectEl().value);
    const currentRoute = ROUTES[getCurrentRouteId()];
    
    const isAtStation = (s1, s2) => normalizeStationName(s1) === normalizeStationName(s2);

    if (!currentRoute) return;
    
    // GUARDIAN V6.1: The Hoist - Strict Inactive Route Nuke
    // If the route is inactive, we destroy the UI and halt immediately.
    // This stops the R9.50 state bleed and removes ghost buttons.
    if (!currentRoute.isActive) { 
        const targetEl = typeof pretoriaTimeEl() !== 'undefined' && pretoriaTimeEl() ? pretoriaTimeEl() : document.getElementById('pretoria-time');
        if(typeof window.Renderer !== 'undefined') window.Renderer.renderComingSoon(targetEl, currentRoute.name); 
        
        const fContainer = document.getElementById('fare-container');
        if (fContainer) fContainer.classList.add('hidden');
        
        const gContainer = document.getElementById('grid-trigger-container');
        if (gContainer) gContainer.classList.add('hidden');
        
        const sBtn = document.getElementById('share-app-btn');
        if (sBtn && sBtn.closest('.border-t')) sBtn.closest('.border-t').classList.add('hidden');
        
        return; // HALT EXECUTION
    } else {
        const sBtn = document.getElementById('share-app-btn');
        if (sBtn && sBtn.closest('.border-t')) sBtn.closest('.border-t').classList.remove('hidden');
    }

    if (selectedStation === "FIND_NEAREST") { findNearestStation(false); return; }
    
    const uiDestA = typeof window.Renderer !== 'undefined' ? window.Renderer._applyUIIntercepts(currentRoute.destA).toUpperCase() : currentRoute.destA.replace(' STATION', '').toUpperCase();
    const uiDestB = typeof window.Renderer !== 'undefined' ? window.Renderer._applyUIIntercepts(currentRoute.destB).toUpperCase() : currentRoute.destB.replace(' STATION', '').toUpperCase();

    if (pretoriaTimeEl()) pretoriaTimeEl().innerHTML = ""; if (pienaarspoortTimeEl()) pienaarspoortTimeEl().innerHTML = "";
    if (pretoriaHeaderEl()) pretoriaHeaderEl().innerHTML = `Next train to <span class="text-blue-500 dark:text-blue-400">${uiDestA}</span>`;
    if (pienaarspoortHeaderEl()) pienaarspoortHeaderEl().innerHTML = `Next train to <span class="text-blue-500 dark:text-blue-400">${uiDestB}</span>`;
    
    if (!selectedStation) {
        if (typeof window.Renderer !== 'undefined') window.Renderer.renderPlaceholder(pretoriaTimeEl(), pienaarspoortTimeEl());
        const fallbackSheetKey = (getCurrentDayType() === 'weekday')
            ? currentRoute.sheetKeys.weekday_to_a
            : currentRoute.sheetKeys.saturday_to_a;
        if (typeof window.updateFareDisplay === 'function') window.updateFareDisplay(fallbackSheetKey);
        return;
    }
    
    if (!(stationSelectEl() && stationSelectEl().options)[stationSelectEl().selectedIndex]) return;

    if ((stationSelectEl() && stationSelectEl().options)[stationSelectEl().selectedIndex].textContent.includes("(No Service)")) {
        const msg = `<div class="h-32 flex flex-col justify-center items-center text-xl font-bold text-gray-600 dark:text-gray-400">No trains stop here.</div>`;
        if (pretoriaTimeEl()) pretoriaTimeEl().innerHTML = msg; if (pienaarspoortTimeEl()) pienaarspoortTimeEl().innerHTML = msg; return;
    }

    const currentODKey = `${getCurrentRouteId()}_${selectedStation}`;
    if (lastTrackedOD !== currentODKey && typeof trackAnalyticsEvent === 'function') {
        lastTrackedOD = currentODKey;
        trackAnalyticsEvent('od_matrix_view', {
            origin: selectedStation.replace(' STATION', ''),
            dest_a: currentRoute.destA.replace(' STATION', ''),
            dest_b: currentRoute.destB.replace(' STATION', ''),
            route_id: getCurrentRouteId(),
            time_of_search: getCurrentTime(),
            day_type: getCurrentDayType(),
            trip_type: 'live_board_view',
            region: getCurrentRegion()
        });
    }
    
    if (getCurrentDayType() === 'sunday') {
        if(typeof window.renderNoService === 'function') {
            if (isAtStation(selectedStation, currentRoute.destA)) {
                if(typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pretoriaTimeEl());
            } else {
                window.renderNoService(pretoriaTimeEl(), currentRoute.destA); 
            }
            if (isAtStation(selectedStation, currentRoute.destB)) {
                if(typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pienaarspoortTimeEl());
            } else {
                window.renderNoService(pienaarspoortTimeEl(), currentRoute.destB); 
            }
        }
        return;
    }

    let sharedRoutes = [];
    Object.values(ROUTES).forEach(r => {
        if (r.region === getCurrentRegion() && r.id !== getCurrentRouteId() && r.isActive && r.corridorId === currentRoute.corridorId) {
            sharedRoutes.push(r.id);
        }
    });

    if (getFullDatabase() && getGlobalStationIndex()[normalizeStationName(selectedStation)]) {
        const stationData = getGlobalStationIndex()[normalizeStationName(selectedStation)];
        stationData.routes.forEach(rId => {
            if (rId !== getCurrentRouteId() && ROUTES[rId].isActive && !sharedRoutes.includes(rId)) {
                sharedRoutes.push(rId);
            }
        });
    }

    sharedRoutes = sharedRoutes.filter(rId => getSharedStationCount(getCurrentRouteId(), rId) > 1);
    let primarySheetKey = (getCurrentDayType() === 'weekday') ? currentRoute.sheetKeys.weekday_to_a : currentRoute.sheetKeys.saturday_to_a;

    // --- DESTINATION A ---
    if (isAtStation(selectedStation, currentRoute.destA)) {
        if(typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pretoriaTimeEl());
    } else {
        const schedule = (getCurrentDayType() === 'weekday') ? getSchedules().weekday_to_a : getSchedules().saturday_to_a;
        const currentSheetKey = (getCurrentDayType() === 'weekday') ? currentRoute.sheetKeys.weekday_to_a : currentRoute.sheetKeys.saturday_to_a;
        const { allJourneys: currentJourneys } = findNextJourneyToDestA(selectedStation, "00:00:00", schedule, currentRoute, getCurrentDayIndex());
        
        let mergedJourneys = currentJourneys.map(j => ({...j, sourceRoute: currentRoute.name, sheetKey: currentSheetKey}));
        const seenTrainsA = new Set(mergedJourneys.map(j => j.train || j.train1.train));
        const targetStationsA = getTargetStations(schedule, selectedStation);

        sharedRoutes.forEach(rId => {
            const otherRoute = ROUTES[rId];
            if (normalizeStationName(otherRoute.destA) === normalizeStationName(currentRoute.destA)) {
                const key = (getCurrentDayType() === 'weekday') ? otherRoute.sheetKeys.weekday_to_a : otherRoute.sheetKeys.saturday_to_a;
                const otherRows = getFullDatabase()[key];
                const otherMeta = getFullDatabase()[key + "_meta"];
                const otherSchedule = parseJSONSchedule(otherRows, otherMeta);
                const { allJourneys: otherJourneys } = findNextJourneyToDestA(selectedStation, "00:00:00", otherSchedule, otherRoute, getCurrentDayIndex());
                
                const uniqueOther = otherJourneys.filter(j => {
                    const tNum = j.train || j.train1.train;
                    return hasForwardOverlap(tNum, otherSchedule, selectedStation, targetStationsA);
                });

                const tagged = uniqueOther.map(j => ({
                    ...j, 
                    sourceRoute: otherRoute.name, 
                    isShared: true, 
                    isDivergent: false,
                    sheetKey: key
                }));
                
                tagged.forEach(sharedJ => {
                    const tNum = sharedJ.train || sharedJ.train1.train;
                    // GUARDIAN BUGFIX: Safely replace native train with rich shared train without dynamic filter collision
                    mergedJourneys = mergedJourneys.filter(mj => (mj.train || mj.train1.train) !== tNum);
                    seenTrainsA.add(tNum);
                    mergedJourneys.push(sharedJ);
                });
            }
        });
        
        mergedJourneys.sort((a, b) => {
             const timeA = timeToSeconds(a.departureTime || a.train1.departureTime);
             const timeB = timeToSeconds(b.departureTime || b.train1.departureTime);
             return timeA - timeB;
        });

        const nowInSeconds = timeToSeconds(getCurrentTime());
        const upcoming = mergedJourneys.find(j => timeToSeconds(j.departureTime || j.train1.departureTime) >= nowInSeconds);
        // GUARDIAN PHASE 1: Replaced Train-Time Dependency with Current Time hook
        if (upcoming) {
             if(typeof window.updateFareDisplay === 'function') window.updateFareDisplay(currentSheetKey, getCurrentTime());
        } else {
             if(typeof window.updateFareDisplay === 'function') window.updateFareDisplay(primarySheetKey, getCurrentTime());
        }

        if(typeof window.processAndRenderJourney === 'function') window.processAndRenderJourney(mergedJourneys, pretoriaTimeEl(), pretoriaHeaderEl(), currentRoute.destA);
    }

    // --- DESTINATION B ---
    if (isAtStation(selectedStation, currentRoute.destB)) {
        if(typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pienaarspoortTimeEl());
    } else {
        const schedule = (getCurrentDayType() === 'weekday') ? getSchedules().weekday_to_b : getSchedules().saturday_to_b;
        const currentSheetKey = (getCurrentDayType() === 'weekday') ? currentRoute.sheetKeys.weekday_to_b : currentRoute.sheetKeys.saturday_to_b;
        const { allJourneys: currentJourneys } = findNextJourneyToDestB(selectedStation, "00:00:00", schedule, currentRoute, getCurrentDayIndex());

        let mergedJourneys = currentJourneys.map(j => ({...j, sourceRoute: currentRoute.name, sheetKey: currentSheetKey}));
        const seenTrainsB = new Set(mergedJourneys.map(j => j.train || j.train1.train));
        const targetStationsB = getTargetStations(schedule, selectedStation);

        sharedRoutes.forEach(rId => {
            const otherRoute = ROUTES[rId];
            
                 const key = (getCurrentDayType() === 'weekday') ? otherRoute.sheetKeys.weekday_to_b : otherRoute.sheetKeys.saturday_to_b;
                 const otherRows = getFullDatabase()[key];
                 const otherMeta = getFullDatabase()[key + "_meta"];
                 const otherSchedule = parseJSONSchedule(otherRows, otherMeta);
                 const { allJourneys: otherJourneys } = findNextJourneyToDestB(selectedStation, "00:00:00", otherSchedule, otherRoute, getCurrentDayIndex());
                 
                 const uniqueOther = otherJourneys.filter(j => {
                     const tNum = j.train || j.train1.train;
                     return hasForwardOverlap(tNum, otherSchedule, selectedStation, targetStationsB);
                 });
 
                 const isDivergent = normalizeStationName(otherRoute.destB) !== normalizeStationName(currentRoute.destB);
                 
                 const tagged = uniqueOther.map(j => ({
                     ...j, 
                     sourceRoute: otherRoute.name, 
                     isShared: true,
                     isDivergent: isDivergent, 
                     actualDestName: otherRoute.destB.replace(' STATION', ''),
                     sheetKey: key
                 }));
                 
                 tagged.forEach(sharedJ => {
                     const tNum = sharedJ.train || sharedJ.train1.train;
                     // GUARDIAN BUGFIX: Safely replace native train with rich shared train without dynamic filter collision
                     mergedJourneys = mergedJourneys.filter(mj => (mj.train || mj.train1.train) !== tNum);
                     seenTrainsB.add(tNum);
                     mergedJourneys.push(sharedJ);
                 });
        });

        mergedJourneys.sort((a, b) => {
             const timeA = timeToSeconds(a.departureTime || a.train1.departureTime);
             const timeB = timeToSeconds(b.departureTime || b.train1.departureTime);
             return timeA - timeB;
        });

        if(typeof window.processAndRenderJourney === 'function') window.processAndRenderJourney(mergedJourneys, pienaarspoortTimeEl(), pienaarspoortHeaderEl(), currentRoute.destB);
    }
}

export function findNextJourneyToDestA(fromStation, timeNow, schedule, routeConfig, targetDayIdx = getCurrentDayIndex()) {
    const { allJourneys: allDirectJourneys } = findNextDirectTrain(fromStation, schedule, routeConfig.destA, targetDayIdx, routeConfig.id);
    let allTransferJourneys = [];
    
    const transferHub = routeConfig.transferStation || routeConfig.relayStation;
    if (transferHub) {
        const { allJourneys: allTransfers } = findTransfers(fromStation, schedule, transferHub, routeConfig.destA, targetDayIdx, routeConfig.id);
        allTransferJourneys = allTransfers;
    }
    
    const transferTrainNames = new Set(allTransferJourneys.map(j => j.train1.train));
    const uniqueDirects = allDirectJourneys.filter(j => !transferTrainNames.has(j.train));
    
    const allJourneys = [...uniqueDirects, ...allTransferJourneys];
    
    allJourneys.sort((a, b) => {
        const timeA = timeToSeconds(a.departureTime || a.train1.departureTime);
        const timeB = timeToSeconds(b.departureTime || b.train1.departureTime);
        if (timeA !== timeB) return timeA - timeB; 
        if (a.type === 'transfer' && b.type === 'direct') return -1;
        if (a.type === 'direct' && b.type === 'transfer') return 1;
        return 0;
    });
    return { allJourneys };
}

export function findNextJourneyToDestB(fromStation, timeNow, schedule, routeConfig, targetDayIdx = getCurrentDayIndex()) {
    const { allJourneys: allDirectJourneys } = findNextDirectTrain(fromStation, schedule, routeConfig.destB, targetDayIdx, routeConfig.id);
    let allTransferJourneys = [];
    
    const transferHub = routeConfig.transferStation || routeConfig.relayStation;
    if (transferHub) {
        const { allJourneys: allTransfers } = findTransfers(fromStation, schedule, transferHub, routeConfig.destB, targetDayIdx, routeConfig.id);
        allTransferJourneys = allTransfers;
    }

    const transferTrainNames = new Set(allTransferJourneys.map(j => j.train1.train));
    const uniqueDirects = allDirectJourneys.filter(j => !transferTrainNames.has(j.train));
    
    const allJourneys = [...uniqueDirects, ...allTransferJourneys];
    
    allJourneys.sort((a, b) => {
        const timeA = timeToSeconds(a.departureTime || a.train1.departureTime);
        const timeB = timeToSeconds(b.departureTime || b.train1.departureTime);
        if (timeA !== timeB) return timeA - timeB; 
        if (a.type === 'transfer' && b.type === 'direct') return -1;
        if (a.type === 'direct' && b.type === 'transfer') return 1;
        return 0; 
    });
    return { allJourneys };
}

export function findNextDirectTrain(fromStation, schedule, destinationStation, targetDayIdx = getCurrentDayIndex(), routeId = getCurrentRouteId()) {
    if (!schedule || !schedule.rows || schedule.rows.length === 0) return { allJourneys: [] };
    const stationCol = schedule.stationColumnName;
    const trainHeaders = schedule.headers.slice(1);
    let allJourneys = [];

    const cleanTargetStation = normalizeStationName(fromStation);

    for (const train of trainHeaders) {
        if (!train || train === "") continue;
        if (isTrainExcluded(train, routeId, targetDayIdx)) continue; 

        const fromRow = schedule.rows.find(row => {
            const val = row[stationCol];
            return val && normalizeStationName(val) === cleanTargetStation;
        });

        const departureTime = fromRow ? fromRow[train] : null;

        // GUARDIAN BUGFIX: Ignore cells that contain generic dashes indicating no stop
        if (!departureTime || departureTime.trim() === "-" || departureTime.trim() === "") continue;

        let actualLastStop = null;
        let actualArrivalTime = null;
        let destRow = null; 
        
        for (let i = schedule.rows.length - 1; i >= 0; i--) {
            const time = schedule.rows[i][train];
            if (time && time.trim() !== "-" && time.trim() !== "") {
                actualLastStop = schedule.rows[i][stationCol];
                actualArrivalTime = time;
                destRow = schedule.rows[i]; 
                break; 
            }
        }
        
        if (fromRow && destRow) {
            const fromIndex = schedule.rows.indexOf(fromRow);
            const destIndex = schedule.rows.indexOf(destRow);
            if (fromIndex < destIndex) { 
                allJourneys.push({
                    type: 'direct',
                    train: train,
                    departureTime: departureTime,
                    arrivalTime: actualArrivalTime,
                    actualDestination: actualLastStop,
                });
            }
        }
    }
    allJourneys.sort((a, b) => timeToSeconds(a.departureTime) - timeToSeconds(b.departureTime));
    return { allJourneys };
}

export function findTransfers(fromStation, schedule, terminalStation, finalDestination, targetDayIdx = getCurrentDayIndex(), routeId = getCurrentRouteId()) {
    if (!schedule || !schedule.rows || schedule.rows.length === 0) return { allJourneys: [] };
    const stationCol = schedule.stationColumnName;
    const trainHeaders = schedule.headers.slice(1);
    let allJourneys = [];
    const findRowFuzzy = (name) => schedule.rows.find(row => normalizeStationName(row[stationCol]) === normalizeStationName(name));
    
    const fromRow = findRowFuzzy(fromStation);
    const termRow = findRowFuzzy(terminalStation); 
    if (!fromRow || !termRow) return { allJourneys: [] };
    
    const fromIndex = schedule.rows.indexOf(fromRow); 
    const termIndex = schedule.rows.indexOf(termRow);
    if (fromIndex >= termIndex) return { allJourneys: [] }; 

    for (const train1 of trainHeaders) {
        if (!train1 || train1 === "") continue;
        if (isTrainExcluded(train1, routeId, targetDayIdx)) continue; 

        const departureTime = fromRow[train1]; 
        const terminationTime = termRow[train1];
        if (!departureTime || !terminationTime || departureTime.trim() === "-" || terminationTime.trim() === "-") continue;
        
        const finalDestRow = findRowFuzzy(finalDestination);
        const destinationTime = finalDestRow ? finalDestRow[train1] : null;

        if (!destinationTime || destinationTime.trim() === "-") {
            const connectionData = findConnections(terminationTime, schedule, terminalStation, finalDestination, train1, targetDayIdx, routeId);
            if (connectionData && connectionData.earliest) {
                let realHeadboardDest = terminalStation;
                for (let k = termIndex + 1; k < schedule.rows.length; k++) {
                    const nextRow = schedule.rows[k];
                    if (nextRow[train1] && nextRow[train1] !== '-' && nextRow[train1].trim() !== '') {
                        realHeadboardDest = nextRow[stationCol];
                    }
                }

                allJourneys.push({ 
                    type: 'transfer', 
                    train1: { 
                        train: train1, 
                        departureTime: departureTime, 
                        arrivalAtTransfer: terminationTime, 
                        terminationStation: terminalStation,
                        headboardDestination: realHeadboardDest
                    }, 
                    connection: connectionData.earliest, 
                    nextFullJourney: connectionData.fullJourney 
                });
            }
        }
    }
    return { allJourneys };
}

export function findConnections(arrivalTimeAtTransfer, schedule, connectionStation, finalDestination, incomingTrainName, targetDayIdx = getCurrentDayIndex(), routeId = getCurrentRouteId()) {
    if (!schedule || !schedule.rows) return null;
    const stationCol = schedule.stationColumnName;
    const trainHeaders = schedule.headers.slice(1);
    let possibleConnections = [];
    
    const findRowFuzzy = (name) => schedule.rows.find(row => normalizeStationName(row[stationCol]) === normalizeStationName(name));
    const connRow = findRowFuzzy(connectionStation);
    if (!connRow) return null;
    const connIndex = schedule.rows.indexOf(connRow);
    const arrivalSeconds = timeToSeconds(arrivalTimeAtTransfer);

    for (const train of trainHeaders) {
        if (!train || train === "") continue;
        if (train === incomingTrainName) continue; 
        if (isTrainExcluded(train, routeId, targetDayIdx)) continue; 

        const connectionTime = connRow[train];
        if (!connectionTime || connectionTime.trim() === "-" || connectionTime.trim() === "") continue;
        if (timeToSeconds(connectionTime) < arrivalSeconds) continue;

        let goesFurther = false;
        let actualLastStop = connectionStation;
        let actualArrivalTime = connectionTime;
        
        for (let i = connIndex + 1; i < schedule.rows.length; i++) {
            const time = schedule.rows[i][train];
            if (time && time.trim() !== "-" && time.trim() !== "") { 
                goesFurther = true;
                actualLastStop = schedule.rows[i][stationCol]; 
                actualArrivalTime = time; 
            }
        }

        if (goesFurther) {
            possibleConnections.push({ 
                train: train, 
                departureTime: connectionTime, 
                arrivalTime: actualArrivalTime, 
                actualDestination: actualLastStop, 
                connectionStation: connectionStation 
            });
        }
    }
    
    if (possibleConnections.length === 0) return null; 
    possibleConnections.sort((a, b) => timeToSeconds(a.departureTime) - timeToSeconds(b.departureTime));
    const earliestConnection = possibleConnections[0];
    let earliestFullJourneyConnection = null;
    if (normalizeStationName(earliestConnection.actualDestination) !== normalizeStationName(finalDestination)) {
        earliestFullJourneyConnection = possibleConnections.find(conn => normalizeStationName(conn.actualDestination) === normalizeStationName(finalDestination)) || null; 
    }
    return { earliest: earliestConnection, fullJourney: earliestFullJourneyConnection };
}

export function findNearestStation(isAuto = false) {
    if (!navigator.geolocation) {
        if (!isAuto) showToast("Geolocation is not supported by your browser.", "error");
        if (!isAuto) if (stationSelectEl()) stationSelectEl().value = "";
        return;
    }
    
    if (!isAuto) {
        showToast("Locating nearest station...", "info", 4000);
        const icon = locateBtnEl().querySelector('svg');
        if(icon) icon.classList.add('spinning');
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;
            
            let candidates = [];
            for (const [stationName, coords] of Object.entries(getGlobalStationIndex())) {
                if (coords.routes.has(getCurrentRouteId())) {
                    const dist = getDistanceFromLatLonInKm(userLat, userLon, coords.lat, coords.lon);
                    candidates.push({ stationName, dist });
                }
            }
            
            candidates.sort((a, b) => a.dist - b.dist);

            if (candidates.length === 0) {
                 if(!isAuto) showToast("No stations on this route found in database.", "error");
                 return;
            }

            const nearest = candidates[0];
            
            if (nearest.dist <= MAX_RADIUS_KM) {
                const stationName = nearest.stationName;
                const distStr = nearest.dist.toFixed(1);

                let matched = false;
                const options = (stationSelectEl() && stationSelectEl().options);
                
                for (let i = 0; i < options.length; i++) {
                    if (normalizeStationName(options[i].value) === normalizeStationName(stationName)) {
                        if (stationSelectEl()) {
                            stationSelectEl().selectedIndex = i;
                            stationSelectEl().value = options[i].value;
                        }
                        matched = true;
                        break;
                    }
                }

                if (matched) {
                    /* syncPlannerFromMain deferred */
                    
                    // GUARDIAN V6.21: Unified Dataset Sync logic absorbed from UI
                    const searchInput = document.getElementById('station-search-input');
                    if (searchInput) {
                        searchInput.value = (stationSelectEl() && stationSelectEl().value).replace(/ STATION/g, '');
                        searchInput.dataset.resolvedValue = (stationSelectEl() && stationSelectEl().value);
                    }
                    
                    findNextTrains(); 
                    if (!isAuto) {
                        showToast(`Found: ${stationName.replace(' STATION', '')} (${distStr}km)`, "success");
                    }

                    // GUARDIAN PHASE 1 (ANALYTICS): Inject 'auto_locate_success' event tracking
                    if (typeof trackAnalyticsEvent === 'function') {
                        trackAnalyticsEvent('auto_locate_success', {
                            station: stationName.replace(' STATION', ''),
                            route_id: getCurrentRouteId(),
                            distance_km: parseFloat(distStr),
                            is_background_check: isAuto
                        });
                    }
                    
                } else {
                     if (!isAuto) showToast("Station found nearby, but not available in dropdown.", "error");
                }
            } else {
                if (!isAuto) showToast(`No stations on this route within ${MAX_RADIUS_KM}km.`, "error");
            }
            
            if (!isAuto) {
                const icon = locateBtnEl().querySelector('svg');
                if(icon) icon.classList.remove('spinning');
            }
        },
        (error) => {
            if (!isAuto) {
                let msg = "Unable to retrieve location.";
                if (error.code === 1) msg = "Location permission denied.";
                // ðŸ›¡ï¸ GUARDIAN UX FIX: Handle timeout specifically
                if (error.code === 3) msg = "Location request timed out."; 
                showToast(msg, "error");
                if (stationSelectEl()) stationSelectEl().value = "";
                const icon = locateBtnEl().querySelector('svg');
                if(icon) icon.classList.remove('spinning');
            }
        },
        { timeout: 8000, enableHighAccuracy: true } // ðŸ›¡ï¸ GUARDIAN UX FIX: 8s timeout to stop infinite underground hangs
    );
}

export function populateStationList() {
    const stationSet = new Set();
    const hasTimes = (row) => { const keys = Object.keys(row); return keys.some(key => key !== 'STATION' && key !== 'COORDINATES' && key !== 'KM_MARK' && row[key] && row[key].trim() !== ""); };
    
    if (getSchedules().weekday_to_a && getSchedules().weekday_to_a.rows) getSchedules().weekday_to_a.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (getSchedules().weekday_to_b && getSchedules().weekday_to_b.rows) getSchedules().weekday_to_b.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (getSchedules().saturday_to_a && getSchedules().saturday_to_a.rows) getSchedules().saturday_to_a.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (getSchedules().saturday_to_b && getSchedules().saturday_to_b.rows) getSchedules().saturday_to_b.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });

    allStations = Array.from(stationSet);
    
    // GUARDIAN UX FIX: Sort by outbound (weekday_to_b) so Hubs (Dest A) appear naturally at the top
    if (getSchedules().weekday_to_b && getSchedules().weekday_to_b.rows) { 
        const orderMap = getSchedules().weekday_to_b.rows.map(r => r.STATION); 
        allStations.sort((a, b) => orderMap.indexOf(a) - orderMap.indexOf(b)); 
    } else if (getSchedules().weekday_to_a && getSchedules().weekday_to_a.rows) {
        // Safe fallback: If B is missing, sort by A but in reverse to maintain the Hub-Top flow
        const orderMap = getSchedules().weekday_to_a.rows.map(r => r.STATION); 
        allStations.sort((a, b) => orderMap.indexOf(b) - orderMap.indexOf(a));
    }
    
    const currentSelectedStation = (stationSelectEl() && stationSelectEl().value);
    
    if (stationSelectEl()) stationSelectEl().innerHTML = '<option value="">Select a station...</option>';
    if (stationSelectEl()) stationSelectEl().disabled = false; // GUARDIAN V6.1: Ensure enabled on populate
    
    allStations.forEach(station => {
        if (station && !station.toLowerCase().includes('last updated')) {
            const option = document.createElement('option');
            option.value = station;
            option.textContent = station.replace(/ STATION/g, '');
            stationSelectEl() && stationSelectEl().appendChild(option);
        }
    });

    // GUARDIAN V6.21: Unified Dataset Sync logic absorbed from UI
    const searchInput = document.getElementById('station-search-input');
    if (allStations.includes(currentSelectedStation)) {
        if (stationSelectEl()) stationSelectEl().value = currentSelectedStation; 
        if (searchInput) {
            searchInput.value = currentSelectedStation.replace(/ STATION/g, '');
            searchInput.dataset.resolvedValue = currentSelectedStation;
        }
    } else { 
        if (stationSelectEl()) stationSelectEl().value = ""; 
        if (searchInput) {
            searchInput.value = "";
            delete searchInput.dataset.resolvedValue;
        }
    }
    
    // ðŸ›¡ï¸ GUARDIAN UX FIX: Reactive Dropdown Engine
    // If the user already opened the dropdown while it was "Loading...", refresh it instantly now that data is here.
    const autocompleteList = document.getElementById('next-train-autocomplete-list');
    if (autocompleteList && !autocompleteList.classList.contains('hidden')) {
        if (typeof window._renderNextTrainList === 'function') {
            window._renderNextTrainList();
        }
    }
}

export function updateLastUpdatedText() {
    if (!getFullDatabase()) return;
    let displayDate = getFullDatabase().lastUpdated || "Unknown";
    const isValidDate = (d) => d && d !== "undefined" && d !== "null" && String(d).length > 5;
    
    if (getCurrentDayType() === 'weekday' || getCurrentDayType() === 'monday') { 
        if (getSchedules().weekday_to_a && isValidDate(getSchedules().weekday_to_a.lastUpdated)) displayDate = getSchedules().weekday_to_a.lastUpdated;
    } else if (getCurrentDayType() === 'saturday') {
        if (getSchedules().saturday_to_a && isValidDate(getSchedules().saturday_to_a.lastUpdated)) displayDate = getSchedules().saturday_to_a.lastUpdated;
    } else if (getCurrentDayType() === 'sunday') {
         if (getSchedules().weekday_to_a && isValidDate(getSchedules().weekday_to_a.lastUpdated)) displayDate = getSchedules().weekday_to_a.lastUpdated;
    }
    
    displayDate = formatEffectiveDate(displayDate);
    
    if (displayDate && lastUpdatedEl()) lastUpdatedEl().textContent = `Effective from: ${displayDate}`;
}

export function startSmartRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    scheduleNextRefresh();
}

export function scheduleNextRefresh() {
    if (document.hidden) return; 
    const hour = new Date().getHours();
    if (hour >= REFRESH_CONFIG.nightModeStart || hour < REFRESH_CONFIG.nightModeEnd) {
        refreshTimer = setTimeout(scheduleNextRefresh, 60 * 60 * 1000);
        return;
    }
    let nextInterval = REFRESH_CONFIG.standardInterval;
    refreshTimer = setTimeout(async () => { await loadAllSchedules(); scheduleNextRefresh(); }, nextInterval);
}


// Sync window shims used by renderer / planner
export function attachLiveBoardGlobals() {
    if (typeof window === 'undefined') return;
    window.getLookaheadDayInfo = getLookaheadDayInfo;
    window.simulateNextActiveService = simulateNextActiveService;
    window.checkDisruption = checkDisruption;
    window.getTripDisruptions = getTripDisruptions;
    window.isTrainExcluded = isTrainExcluded;
    window.findNextTrains = findNextTrains;
    window.populateStationList = populateStationList;
    window.findNearestStation = findNearestStation;
    window.calculateTimeDiffString = calculateTimeDiffString;
    window.getRouteFare = getRouteFare;
    window.getDetailedFare = getDetailedFare;
    window.startSmartRefresh = startSmartRefresh;
    window.updateLastUpdatedText = updateLastUpdatedText;
    window.allStations = allStations;
    // Keep renderer disruption badges in sync with active route
    const syncRoute = () => {
        window._liveRouteId = getCurrentRouteId();
        window.currentRouteId = getCurrentRouteId();
        window.allStations = allStations;
    };
    syncRoute();
    $currentRouteId.subscribe(syncRoute);
}

export function getAllStations() { return allStations; }
export { allStations };
