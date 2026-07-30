/**
 * METRORAIL NEXT TRAIN - PLANNER UI (V7_06.17 - Astro MPA Migration)
 * --------------------------------------------------------------
 * THE "HEAD CHEF" (Controller)
 * * This module handles user interaction, DOM updates, and event listeners.
 * It calls the pure logic functions from planner-core.js.
 * * PHASE 8: Astro ESM Migration & Iframe Sandbox Hardening (Removed fatal alert() calls).
 */

import { 
    $isSimMode, $userRegion, $currentRouteId, $globalStationIndex, 
    $globalDisruptions, $masterStationList, $userProfile 
} from '../store.js';
import { ROUTES, FARE_CONFIG } from './config.js';
import { 
    normalizeStationName, timeToSeconds, formatTimeDisplay, 
    escapeHTML, getDistanceFromLatLonInKm, safeStorage 
} from './utils.js';
import { planUnifiedTrip } from './planner-core.js';

// --- Astro MPA Migration Shims ---
const getCurrentDayType = () => typeof window !== 'undefined' && window.currentDayType ? window.currentDayType : 'weekday';
const getCurrentTime = () => typeof window !== 'undefined' && window.currentTime ? window.currentTime : "12:00:00";
const resolveTripDisruptions = (routeId, stops) => {
    const fn = (typeof window !== 'undefined' && typeof window.getTripDisruptions === 'function')
        ? window.getTripDisruptions
        : null;
    return fn ? fn(routeId, stops) : [];
};
const getMasterStationList = () => {
    if (typeof window !== 'undefined' && window.MASTER_STATION_LIST && window.MASTER_STATION_LIST.length > 0) return window.MASTER_STATION_LIST;
    return $masterStationList.get() || [];
};

/** Phase 5 — inject recent crowd delay reports under an active trip card */
async function injectPlannerCrowdDelay(trip) {
    const slot = document.getElementById('planner-crowd-delay-slot');
    if (!slot || !trip) return;
    try {
        const routeIds = [];
        if (trip.route?.id) routeIds.push(trip.route.id);
        if (Array.isArray(trip.legs)) {
            trip.legs.forEach((leg) => {
                if (leg?.route?.id) routeIds.push(leg.route.id);
            });
        }
        if (Array.isArray(trip.mergedLegs)) {
            trip.mergedLegs.forEach((leg) => {
                if (leg?.route?.id) routeIds.push(leg.route.id);
            });
        }
        const { getPlannerCrowdDelayHtml } = await import('./delay-reports.js');
        const html = await getPlannerCrowdDelayHtml(routeIds);
        if (document.getElementById('planner-crowd-delay-slot') === slot) {
            slot.innerHTML = html || '';
        }
    } catch (e) {
        /* non-fatal */
    }
}

// --- CLIENT STATE ---
export let plannerOrigin = null;
export let plannerDest = null;
export let currentTripOptions = []; 
export let currentPlannerStatus = 'NO_PATH';
export let currentPlannerErrorPayload = null; 
export let selectedPlannerDay = null; 
export let plannerPulse = null; 
export let plannerExpandedState = new Set(); 
export let tripMapInstance = null;
export let tripMapRouteLine = null;
export let tripMapMarkers = [];

// --- GUARDIAN PHASE 1: ROUTER BLEED & GREY SCREEN INTERCEPTOR ---
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const tripMapCloseBtn = e.target.closest('#close-trip-map-btn, #close-trip-map-btn-2');
        if (tripMapCloseBtn) {
            if (tripMapCloseBtn.dataset.isClosing === "true") {
                e.preventDefault();
                e.stopPropagation();
                console.log("🛡️ Guardian: Suppressed double-tap on Map Close button (Router Bleed Prevented).");
                return;
            }
            tripMapCloseBtn.dataset.isClosing = "true";
            
            setTimeout(() => { delete tripMapCloseBtn.dataset.isClosing; }, 1000);

            const modal = document.getElementById('trip-map-modal');
            if (modal) {
                modal.classList.add('opacity-0');
                setTimeout(() => {
                    modal.classList.add('hidden');
                    if (typeof unlockBackgroundScroll === 'function') unlockBackgroundScroll();
                }, 300);
            }
        }
    }, true); 
}

// --- INTERACTIVE SELECTORS & ACTIONS ---

export function toggleCustomTimeDropdown(e) {
    if (e) e.stopPropagation();
    const list = document.getElementById('custom-time-list');
    if (!list) return;
    
    const isOpening = list.classList.contains('hidden');
    
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim('custom-time-list', 'custom-time-chevron');
    } else {
        const chevron = document.getElementById('custom-time-chevron');
        list.classList.toggle('hidden');
        if (!list.classList.contains('hidden')) {
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            if (chevron) chevron.classList.remove('rotate-180');
        }
    }
    
    if (isOpening) {
        setTimeout(() => {
            const selected = list.querySelector('.bg-blue-600');
            if (selected) selected.scrollIntoView({ block: 'nearest' });
        }, 10);
    }
}

export function selectCustomTrip(idx) {
    if (!currentTripOptions || idx >= currentTripOptions.length) return;
    
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim(); 
    } else {
        const list = document.getElementById('custom-time-list');
        const chevron = document.getElementById('custom-time-chevron');
        if (list) list.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }
    
    selectPlannerTrip(idx);
}

export function toggleMainDayDropdown(e) {
    if (e) e.stopPropagation();
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim('main-day-list', 'main-day-chevron');
    } else {
        const list = document.getElementById('main-day-list');
        const chevron = document.getElementById('main-day-chevron');
        if (!list) return;
        list.classList.toggle('hidden');
        if (!list.classList.contains('hidden')) {
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            if (chevron) chevron.classList.remove('rotate-180');
        }
    }
}

export function selectMainDay(e, value, text) {
    if (e) e.stopPropagation();
    
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim(); 
    } else {
        const list = document.getElementById('main-day-list');
        const chevron = document.getElementById('main-day-chevron');
        if (list) list.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }

    const display = document.getElementById('main-day-display');
    if (display) display.textContent = text;
    selectedPlannerDay = value;

    const list = document.getElementById('main-day-list');
    if (list) {
        list.querySelectorAll('li').forEach(li => {
            li.classList.remove('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
            if (li.textContent === text) {
                li.classList.add('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
            }
        });
    }
}

export function toggleHeaderDayDropdown(e) {
    if (e) e.stopPropagation();
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim('header-day-list', 'header-day-chevron');
    } else {
        const list = document.getElementById('header-day-list');
        const chevron = document.getElementById('header-day-chevron');
        if (!list) return;
        list.classList.toggle('hidden');
        if (!list.classList.contains('hidden')) {
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            if (chevron) chevron.classList.remove('rotate-180');
        }
    }
}

export function selectHeaderDay(e, value, text) {
    if (e) e.stopPropagation();
    
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim(); 
    } else {
        const list = document.getElementById('header-day-list');
        const chevron = document.getElementById('header-day-chevron');
        if (list) list.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }

    if (typeof triggerHaptic === 'function') triggerHaptic();
    selectedPlannerDay = value;
    
    const daySelectDisp = document.getElementById('main-day-display');
    if (daySelectDisp) {
        let mainTxt = value === 'weekday' ? 'Weekday (Mon-Fri)' : (value === 'saturday' ? 'Saturday / Public Holiday' : 'Sunday');
        daySelectDisp.textContent = mainTxt;
        
        const mList = document.getElementById('main-day-list');
        if (mList) {
            mList.querySelectorAll('li').forEach(li => {
                li.classList.remove('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
                if (li.textContent === mainTxt) {
                    li.classList.add('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
                }
            });
        }
    }
    
    if (typeof showToast === 'function') {
        showToast("Switched to " + text, "info", 1500);
    }
    
    let fromStation = "";
    let toStation = "";
    
    if (typeof currentTripOptions !== 'undefined' && currentTripOptions.length > 0) {
        fromStation = currentTripOptions[0].from;
        toStation = currentTripOptions[0].to;
    } else {
        const fromInput = document.getElementById('planner-from-search');
        const toInput = document.getElementById('planner-to-search');
        
        fromStation = (fromInput && fromInput.dataset.resolvedValue) ? fromInput.dataset.resolvedValue : "";
        toStation = (toInput && toInput.dataset.resolvedValue) ? toInput.dataset.resolvedValue : "";
    }

    if (fromStation && toStation) {
        executeTripPlan(fromStation, toStation);
    } else if (typeof showToast === 'function') {
        showToast("Could not resolve stations for new date.", "error");
    }
}

export function hidePlannerResults() {
    if (typeof plannerPulse !== 'undefined' && plannerPulse) { clearInterval(plannerPulse); plannerPulse = null; }
    const inputSection = document.getElementById('planner-input-section');
    const resultsSection = document.getElementById('planner-results-section');
    if (inputSection) inputSection.classList.remove('hidden');
    if (resultsSection) resultsSection.classList.add('hidden');
    plannerExpandedState.clear(); 
}

export function openDisruptionModal(id) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    
    let targetDisruption = null;
    const globalDisruptions = $globalDisruptions.get();
    if (globalDisruptions) {
        for (const routeId in globalDisruptions) {
            const found = globalDisruptions[routeId].find(d => d.id === id);
            if (found) {
                targetDisruption = found;
                break;
            }
        }
    }
    
    if (!targetDisruption) {
        if (typeof showToast === 'function') showToast("Disruption details not found.", "error");
        return;
    }
    
    const titleEl = document.getElementById('disruption-modal-stations');
    const bodyEl = document.getElementById('disruption-modal-body');
    const badgeEl = document.getElementById('disruption-modal-tier-badge');
    const timeEl = document.getElementById('disruption-modal-timestamp');
    const iconEl = document.getElementById('disruption-icon-svg');
    
    const cleanStr = (s) => s ? s.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
    
    let locationText = "Route-Wide Advisory";
    if (targetDisruption.stations && targetDisruption.stations.length >= 2) {
        locationText = `Between <span class="text-blue-600 dark:text-blue-400">${cleanStr(targetDisruption.stations[0]).replace(' STATION', '')}</span> & <span class="text-blue-600 dark:text-blue-400">${cleanStr(targetDisruption.stations[1]).replace(' STATION', '')}</span>`;
    } else if (targetDisruption.stations && targetDisruption.stations.length === 1) {
        locationText = `At <span class="text-blue-600 dark:text-blue-400">${cleanStr(targetDisruption.stations[0]).replace(' STATION', '')}</span>`;
    } else if (targetDisruption.routeId && ROUTES[targetDisruption.routeId]) {
        const r = ROUTES[targetDisruption.routeId];
        locationText = `Between <span class="text-blue-600 dark:text-blue-400">${cleanStr(r.destA).replace(' STATION', '')}</span> & <span class="text-blue-600 dark:text-blue-400">${cleanStr(r.destB).replace(' STATION', '')}</span>`;
    }
    if (titleEl) titleEl.innerHTML = locationText;
    
    if (bodyEl) bodyEl.innerHTML = targetDisruption.message || targetDisruption.longExplanation || "No additional details provided.";
    
    if (badgeEl) {
        if (targetDisruption.tier === 'CRITICAL') {
            badgeEl.className = "w-full text-center text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 py-2.5 rounded-lg border border-red-200 dark:border-red-800/50";
            badgeEl.innerHTML = "🔴 CRITICAL SERVICE DISRUPTION";
            if (iconEl) iconEl.className = "w-5 h-5 mr-2 text-red-500";
        } else {
            badgeEl.className = "w-full text-center text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 py-2.5 rounded-lg border border-yellow-200 dark:border-yellow-800/50";
            badgeEl.innerHTML = "🟡 EXPECT DELAYS / SINGLE TRACK";
            if (iconEl) iconEl.className = "w-5 h-5 mr-2 text-yellow-500";
        }
    }
    
    if (timeEl) {
        if (targetDisruption.postedAt) {
            const d = new Date(targetDisruption.postedAt);
            const dateStr = d.toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
            timeEl.textContent = `Posted: ${timeStr}, ${dateStr}`;
        } else {
            timeEl.textContent = "Posted: Recently";
        }
    }

    const modalCard = document.getElementById('disruption-modal-card');
    if (modalCard) {
        const replyBtn = Array.from(modalCard.querySelectorAll('button')).find(b => b.textContent.includes('Reply'));
        if (replyBtn) {
            replyBtn.onclick = (e) => {
                e.preventDefault();
                if (typeof triggerHaptic === 'function') triggerHaptic();

                let shortLocation = locationText.replace(/<[^>]*>?/gm, ''); 
                let advisoryTitle = targetDisruption.buttonText || (targetDisruption.tier === 'CRITICAL' ? 'Line Severed' : 'Expect Delays');
                let rawMsg = `${advisoryTitle} - ${shortLocation}`;

                const fText = document.getElementById('feedback-text');
                const fType = document.getElementById('feedback-type');

                if (fText) {
                    let contextBox = document.getElementById('feedback-reply-context');
                    if (!contextBox) {
                        contextBox = document.createElement('div');
                        contextBox.id = 'feedback-reply-context';
                        contextBox.className = 'mb-3 p-3 bg-gray-100 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 italic flex items-start hidden shadow-inner';
                        fText.parentNode.insertBefore(contextBox, fText);
                    }
                    contextBox.innerHTML = `<span class="mr-2 text-sm leading-none">💬</span><div><span class="block font-bold text-[10px] uppercase tracking-wider mb-0.5 text-gray-400">Replying to Advisory:</span><span class="line-clamp-2">"${rawMsg}"</span></div>`;
                    contextBox.dataset.rawMsg = rawMsg;
                    contextBox.classList.remove('hidden');
                    fText.value = ''; 
                }
                if (fType) fType.value = 'general';

                if (typeof closeSmoothModal === 'function') closeSmoothModal('disruption-modal');
                setTimeout(() => {
                    if (typeof trackAnalyticsEvent === 'function') trackAnalyticsEvent('open_feedback_modal', { location: 'planner_disruption_reply' });
                    history.pushState({ modal: 'feedback' }, '', '#feedback');
                    if (typeof openSmoothModal === 'function') openSmoothModal('feedback-modal');
                }, 350);
            };
        }
    }
    
    if (typeof openSmoothModal === 'function') openSmoothModal('disruption-modal');
}

export function extractTripCoordinates(tripIndex) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    if (!currentTripOptions || !currentTripOptions[tripIndex]) return;
    
    const trip = currentTripOptions[tripIndex];
    const coordinates = [];
    const stationNames = [];
    const validStops = []; 
    const globalStationIndex = $globalStationIndex.get();

    const addStops = (stopsArray) => {
        if (!stopsArray) return;
        stopsArray.forEach(stop => {
            if (stop.time === "---") return;

            const name = normalizeStationName(stop.station);
            if (stationNames.length > 0 && stationNames[stationNames.length - 1] === name) return;
            
            stationNames.push(name);
            
            if (globalStationIndex && globalStationIndex[name] && globalStationIndex[name].lat) {
                const coord = [globalStationIndex[name].lat, globalStationIndex[name].lon];
                coordinates.push(coord); 
                
                validStops.push({
                    name: name,
                    lat: coord[0],
                    lon: coord[1]
                });
            }
        });
    };

    if (trip.type === 'DIRECT') {
        addStops(trip.stops);
    } else if (trip.type === 'TRANSFER') {
        addStops(trip.leg1.stops);
        addStops(trip.leg2.stops);
    } else if (trip.type === 'DOUBLE_TRANSFER') {
        addStops(trip.leg1.stops);
        addStops(trip.leg2.stops);
        addStops(trip.leg3.stops);
    } else if (trip.type === 'MULTI_TRANSFER' || trip.legs) {
        trip.legs.forEach(leg => addStops(leg.stops));
    }

    if (coordinates.length === 0) {
        if (typeof showToast === 'function') showToast("Coordinate data unavailable for this route.", "error");
        return;
    }

    const routeData = {
        origin: normalizeStationName(trip.from),
        destination: normalizeStationName(trip.to),
        path: coordinates,        
        stationNames: stationNames, 
        validStops: validStops,   
        globalDisruptions: $globalDisruptions.get() || {} 
    };

    if (typeof trackAnalyticsEvent === 'function') {
        trackAnalyticsEvent('open_live_map', {
            origin: trip.from.replace(' STATION', ''),
            destination: trip.to.replace(' STATION', ''),
            trip_type: trip.type
        });
    }

    if (typeof window !== 'undefined' && typeof window.openTripMapRenderer === 'function') {
        window.openTripMapRenderer(routeData);
    } else {
        openTripMapRenderer(routeData);
    }
}

// --- CLIENT-SIDE LAZY-LOADED LEAFLET MAP DRAWING ISLAND ---
export async function openTripMapRenderer(routeData) {
    if (typeof window === 'undefined') return;

    // Mutex Lock
    if (window._isMapInitializing) return;
    window._isMapInitializing = true;

    const modal = document.getElementById('trip-map-modal');
    if (!modal) {
        const mapModalDiv = document.createElement('div');
        mapModalDiv.id = 'trip-map-modal';
        mapModalDiv.className = 'fixed inset-0 bg-black/80 z-[120] hidden flex items-center justify-center p-0 backdrop-blur-sm transition-opacity duration-300';
        mapModalDiv.innerHTML = `
            <div class="bg-white dark:bg-gray-900 rounded-none shadow-2xl w-full h-full flex flex-col transform transition-all scale-100 overflow-hidden relative">
                <div class="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-100 dark:bg-gray-800 z-20 relative shrink-0">
                    <div>
                        <h3 class="text-sm font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest" id="trip-map-title-primary">Live Journey Map</h3>
                        <p class="text-[10px] text-gray-400 font-mono mt-0.5" id="trip-map-title-sub">GPS CORRIDOR TRACE</p>
                    </div>
                    <button id="close-trip-map-btn" class="p-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition focus:outline-none shrink-0 border border-gray-200 dark:border-gray-700">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                
                <div id="trip-leaflet-container" class="flex-grow bg-gray-100 dark:bg-gray-900 relative"></div>
                
                <div class="absolute bottom-20 left-4 flex flex-col space-y-2 z-30">
                    <button id="trip-map-locate-btn" class="bg-white dark:bg-gray-700 text-gray-800 dark:text-white p-3 rounded-full shadow-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition" aria-label="Center GPS">
                        <svg class="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    </button>
                </div>

                <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 rounded-b-none z-20 relative shrink-0">
                    <button id="close-trip-map-btn-2" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors text-sm uppercase tracking-wide">Close Map</button>
                </div>
            </div>
        `;
        document.body.appendChild(mapModalDiv);
    }

    const loadLeaflet = () => {
        return new Promise((resolve, reject) => {
            if (window.L) return resolve();
            
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    };

    try {
        await loadLeaflet();
        
        const titlePrimary = document.getElementById('trip-map-title-primary');
        const titleSub = document.getElementById('trip-map-title-sub');
        if (titlePrimary) titlePrimary.textContent = `${routeData.origin.replace(' STATION','')} ➔ ${routeData.destination.replace(' STATION','')}`;
        if (titleSub) titleSub.textContent = `TRAIN TRACK: ${routeData.stationNames.length} STATIONS`;

        if (typeof openSmoothModal === 'function') openSmoothModal('trip-map-modal');
        else document.getElementById('trip-map-modal').classList.remove('hidden');

        // Allow DOM layout container transition to finish before Leaflet sizes coordinates
        setTimeout(() => {
            if (tripMapInstance) {
                tripMapInstance.remove();
                tripMapInstance = null;
            }

            tripMapInstance = window.L.map('trip-leaflet-container', {
                zoomControl: false,
                attributionControl: false
            });

            // Mapbox or CartoDB Tiles (Dark mode aware)
            const isDark = document.documentElement.classList.contains('dark');
            const tileUrl = isDark 
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' 
                : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
            
            window.L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(tripMapInstance);

            const cleanPath = routeData.path.filter(p => p && p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]));

            if (cleanPath.length > 0) {
                // Vector Track Line
                tripMapRouteLine = window.L.polyline(cleanPath, {
                    color: '#2563eb',
                    weight: 5,
                    opacity: 0.8,
                    dashArray: '10, 10',
                    lineJoin: 'round'
                }).addTo(tripMapInstance);

                // Add Markers for each station node
                tripMapMarkers = [];
                routeData.validStops.forEach((stop, idx) => {
                    const isOrigin = idx === 0;
                    const isDest = idx === routeData.validStops.length - 1;
                    
                    let pinColor = '#3b82f6'; // standard blue
                    if (isOrigin) pinColor = '#22c55e'; // green origin
                    if (isDest) pinColor = '#ef4444'; // red destination

                    const customSvgIcon = window.L.divIcon({
                        className: 'custom-map-icon',
                        html: `<div style="background-color: ${pinColor}; width: 14px; height: 14px; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.4);"></div>`,
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    });

                    const marker = window.L.marker([stop.lat, stop.lon], { icon: customSvgIcon }).addTo(tripMapInstance);
                    
                    const tooltipClass = isOrigin || isDest ? 'tooltip-dynamic font-bold' : 'tooltip-dynamic minor-station-tooltip';
                    marker.bindTooltip(stop.name.replace(' STATION',''), {
                        permanent: true,
                        direction: 'top',
                        offset: [0, -8],
                        className: `bg-white dark:bg-gray-800 text-gray-900 dark:text-white border-0 shadow-md text-[9px] px-1.5 py-0.5 rounded ${tooltipClass}`
                    });
                    
                    tripMapMarkers.push(marker);
                });

                // Auto-fit screen bounds
                tripMapInstance.fitBounds(tripMapRouteLine.getBounds(), { padding: [40, 40] });
            }

            // Bind Center GPS Button
            const locateBtn = document.getElementById('trip-map-locate-btn');
            locateBtn.onclick = () => {
                tripMapInstance.locate({ setView: true, maxZoom: 15 });
            };

            window._isMapInitializing = false;
        }, 350);

    } catch (e) {
        console.error("Leaflet Initialization Failed", e);
        window._isMapInitializing = false;
    }
}

// --- TIMELINE BUILDER VIEW ENGINE ---

export const PlannerRenderer = {
    isMidnightRollover: () => {
        if (typeof currentPlannerStatus !== 'undefined' && currentPlannerStatus === 'ALL_DEPARTED') return false;

        const isToday = (!selectedPlannerDay || selectedPlannerDay === getCurrentDayType());
        if (!isToday || currentTripOptions.length === 0) return false;
        
        const nowSec = timeToSeconds(getCurrentTime());
        let latestDep = 0;
        currentTripOptions.forEach(t => {
            const sec = timeToSeconds(t.depTime);
            if (sec > latestDep) latestDep = sec;
        });
        
        return nowSec > latestDep;
    },

    format12h: (timeStr) => {
        if (!timeStr) return "--:--";
        const [h, m] = timeStr.split(':');
        let hour = parseInt(h, 10);
        const suffix = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12 || 12;
        return `${hour}:${m} ${suffix}`;
    },

    formatDuration: (totalMinutes) => {
        if (totalMinutes < 60) return `${totalMinutes} min`;
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
    },

    applyUIIntercepts: (stationName) => {
        if (!stationName) return "";
        let name = stationName.replace(' STATION', '').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
        const upper = name.toUpperCase();
        if (upper === 'ELANDSFONTEIN' || upper === 'RHODESFIELD') {
            return 'Kempton Park';
        }
        return name;
    },

    buildTransferBadge: ({ opacity = '', title, waitStr, connectLabel = 'Connect To', connectValue, variant = 'transfer' }) => {
        let iconBg = 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400';
        let titleColor = 'text-blue-600 dark:text-blue-400';
        let waitColor = 'text-gray-900 dark:text-white';
        let leftBorder = 'border-l-blue-500';
        let centerSvg = `<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        if (variant === 'extended') {
            iconBg = 'bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400';
            titleColor = 'text-orange-600 dark:text-orange-400';
            waitColor = 'text-orange-600 dark:text-orange-400';
            leftBorder = 'border-l-orange-500';
            centerSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
        } else if (variant === 'instant') {
            iconBg = 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400';
            titleColor = 'text-emerald-600 dark:text-emerald-400';
            waitColor = 'text-emerald-600 dark:text-emerald-400';
            leftBorder = 'border-l-emerald-500';
            centerSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
        }
        const rightCol = connectValue ? `
        <div class="flex flex-col items-end text-right min-w-0 flex-1 pl-2">
            <span class="text-[8px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider leading-none mb-1">${connectLabel}</span>
            <span class="font-bold text-[10px] text-blue-600 dark:text-blue-400 leading-tight truncate w-full" title="${connectValue}">${connectValue}</span>
        </div>` : '';
        return `
        <div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2 ${opacity}">
            <div class="relative py-2 z-20 w-full">
                <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 ${leftBorder} p-2.5 flex items-center justify-between w-[calc(100%+2px)] -ml-[2px] shadow-md">
                    <div class="flex items-center min-w-0 pr-3">
                        <div class="w-8 h-8 rounded-full ${iconBg} flex items-center justify-center shrink-0 mr-2.5 shadow-sm">${centerSvg}</div>
                        <div class="flex flex-col items-start min-w-0">
                            <span class="flex items-center text-[8px] font-black ${titleColor} uppercase tracking-widest leading-none mb-1 truncate w-full" title="${title}">${title}</span>
                            <span class="font-bold text-[11px] ${waitColor} leading-none truncate">${waitStr} Wait</span>
                        </div>
                    </div>
                    ${rightCol}
                </div>
            </div>
        </div>`;
    },

    renderLegTimeline: (leg, fromStation, toStation, legId, isFinalDest = false, renderedAlerts = new Set(), initialSevered = false) => {
        const formatStation = (s) => PlannerRenderer.applyUIIntercepts(s);
        let trainDest = formatStation(leg.actualDestination || leg.route.destB);
        
        // --- THE UNIFIED SUB-LEG RENDERER ---
        const renderSubLeg = (stops, subFrom, subTo, subLegId, subIsFinalDest, subTrain, subTrainDest, subInitialSevered) => {
            const fullValidStops = stops.filter(s => s.time !== "---");
            const disruptions = resolveTripDisruptions(leg.route.id, fullValidStops);
            let isSevered = subInitialSevered;
            let html = '';

            const getInjectionHtml = (idx) => {
                let inj = '';
                disruptions.filter(d => d.triggerStopIndex === idx).forEach(d => {
                    if (renderedAlerts.has(d.id)) return;
                    renderedAlerts.add(d.id);
                    
                    const cleanStr = (s) => s ? s.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
                    const safeBtnText = d.buttonText ? cleanStr(d.buttonText) : (d.tier === 'CRITICAL' ? 'Advisory' : 'Read Advisory');
                    
                    let locationText = "Route-Wide Advisory";
                    if (d.stations && d.stations.length >= 2) {
                        locationText = `Between ${cleanStr(d.stations[0].replace(' STATION', ''))} & ${cleanStr(d.stations[1].replace(' STATION', ''))}`;
                    } else if (d.stations && d.stations.length === 1) {
                        locationText = `At ${cleanStr(d.stations[0].replace(' STATION', ''))}`;
                    } else if (d.routeId && typeof ROUTES !== 'undefined' && ROUTES[d.routeId]) {
                        const r = ROUTES[d.routeId];
                        locationText = `Between ${cleanStr(r.destA.replace(' STATION', ''))} & ${cleanStr(r.destB.replace(' STATION', ''))}`;
                    }

                    if (d.tier === 'CRITICAL') {
                        const justSevered = !isSevered;
                        isSevered = true; 
                        
                        window._trackedSeverances = window._trackedSeverances || new Set();
                        if (justSevered && !window._trackedSeverances.has(d.id)) {
                            window._trackedSeverances.add(d.id);
                            if (typeof trackAnalyticsEvent === 'function') {
                                trackAnalyticsEvent('planner_trip_severed', { 
                                    origin: fromStation.replace(/ STATION/gi, ''),
                                    destination: toStation.replace(/ STATION/gi, ''),
                                    disruption_id: d.id, 
                                    route_id: leg.route.id 
                                });
                            }
                        }

                        const termStationName = cleanStr(fullValidStops[idx].station.replace(' STATION', '')).toUpperCase();
                        
                        let terminationTag = justSevered 
                            ? `<div class="bg-red-50 dark:bg-red-900/20 px-3 py-2 border-b border-red-100 dark:border-red-900/50 flex justify-between items-center rounded-t-xl"><span class="font-black uppercase tracking-widest text-[10px] text-red-700 dark:text-red-400">🛑 TRAIN TERMINATES @ ${termStationName}</span></div>` 
                            : ``;

                        const linkSvg = `<svg class="w-3 h-3 mr-1 text-gray-400 dark:text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;

                        // 🛡️ GUARDIAN UX FIX: The Breakout Disruption
                        // -ml-[10px] exactly counteracts the parent's ml-2 (8px) + border-l-2 (2px), snapping the card flush left.
                        inj += `
                            <div class="relative -ml-[10px] my-4 z-20 w-[calc(100%+10px)]">
                                <div class="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-900/50 shadow-md flex flex-col w-full overflow-hidden">
                                    ${terminationTag}
                                    <div class="p-3 flex justify-between items-end w-full">
                                        <div class="flex flex-col items-start min-w-0 pr-2">
                                            <span class="text-red-600 dark:text-red-500 font-bold uppercase tracking-wide text-[11px] leading-none mb-1 flex items-center">
                                                ❌ LINE SEVERED
                                            </span>
                                            <div class="text-gray-500 dark:text-gray-400 leading-snug flex items-center min-w-0 w-full mt-1">
                                                ${linkSvg} <span class="font-medium text-[10px] truncate">${locationText}</span>
                                            </div>
                                        </div>
                                        <button type="button" onclick="if(typeof window.openDisruptionModal === 'function') window.openDisruptionModal('${d.id}')" class="bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-100 dark:text-white px-2.5 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-colors focus:outline-none shadow-sm flex items-center shrink-0">
                                            <span class="truncate max-w-[110px]">${safeBtnText}</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        const linkSvg = `<svg class="w-3 h-3 mr-1 text-gray-400 dark:text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
                        
                        inj += `
                            <div class="relative py-2 z-20 w-full">
                                <div class="bg-slate-50 dark:bg-slate-800/40 rounded-r-lg border-l-4 border-yellow-500 p-2.5 flex items-center justify-between w-[calc(100%+2px)] -ml-[2px] shadow-sm">
                                    <div class="flex flex-col items-start min-w-0 pr-2">
                                        <span class="text-yellow-600 dark:text-yellow-500 font-bold uppercase tracking-wide text-[10px] leading-none mb-1 flex items-center">
                                            ⚠️ EXPECT DELAYS
                                        </span>
                                        <div class="text-gray-500 dark:text-gray-400 leading-snug flex items-center min-w-0 w-full mt-0.5">
                                            ${linkSvg} <span class="font-medium text-[9px] truncate">${locationText}</span>
                                        </div>
                                    </div>
                                    <button type="button" onclick="if(typeof window.openDisruptionModal === 'function') window.openDisruptionModal('${d.id}')" class="bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-100 dark:text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors focus:outline-none shadow-sm flex items-center shrink-0">
                                        <span class="truncate max-w-[110px]">${safeBtnText}</span>
                                    </button>
                                </div>
                            </div>
                        `;
                    }
                });
                return inj;
            };

            const isFirstOrigin = subLegId.includes('direct') || subLegId.includes('leg1') || subLegId.includes('l1-');
            const depDotClass = isSevered ? "bg-gray-400 opacity-70 w-3 h-3 -left-[7px] top-1.5" : 
                                (isFirstOrigin ? "bg-green-500 ring-4 ring-green-100 dark:ring-green-900 w-4 h-4 -left-[9px] top-0" : "bg-blue-500 w-3 h-3 -left-[7px] top-1.5");
            const depTextClass = isSevered ? "text-gray-400 dark:text-gray-600 opacity-70" : "text-gray-900 dark:text-white";
            const depTrainClass = isSevered ? "text-gray-400 opacity-70" : "text-blue-500";
            
            html += `
                <div class="relative pl-6 pb-2 border-l-2 border-gray-300 dark:border-gray-600 ml-2">
                    <div class="absolute rounded-full ${depDotClass}"></div>
                    <div class="flex flex-col">
                        <div class="flex justify-between items-center mb-1">
                            <span class="font-bold ${depTextClass} text-sm">Depart ${subFrom.replace(' STATION', '')}</span>
                            <span class="font-mono font-bold ${depTextClass} text-sm">${formatTimeDisplay(stops[0].time)}</span>
                        </div>
                        <div class="text-xs ${depTrainClass} font-medium mb-1">
                            ${subTrainDest} Train ${subTrain}
                        </div>
                    </div>
                </div>
            `;
                    
            html += getInjectionHtml(0) ? `<div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2">${getInjectionHtml(0)}</div>` : '';

            const intermediateStops = fullValidStops.slice(1, -1);
            if (intermediateStops.length > 0) {
                let innerHtml = '';
                for (let idx = 0; idx < intermediateStops.length; idx++) {
                    const stop = intermediateStops[idx];
                    const globalIdx = idx + 1; 
                    
                    // GUARDIAN FIX: Dynamic CSS variables for greyed-out state flow
                    let textClass = isSevered ? "text-gray-400 dark:text-gray-500 opacity-50 grayscale" : "text-gray-700 dark:text-gray-300 font-medium";
                    let dotClass = isSevered ? "bg-gray-300 dark:bg-gray-700 opacity-50 grayscale" : "bg-blue-500 border-2 border-white dark:border-gray-800";
                    
                    innerHtml += `
                        <div class="flex justify-between text-xs py-1.5 relative pl-5">
                            <div class="absolute -left-[5px] top-2 w-3 h-3 rounded-full ${dotClass}"></div>
                            <span class="${textClass}">${stop.station.replace(' STATION', '')}</span>
                            <span class="font-mono ${textClass}">${formatTimeDisplay(stop.time)}</span>
                        </div>
                    `;
                    
                    const injHtml = getInjectionHtml(globalIdx);
                    if (injHtml) innerHtml += injHtml;
                    
                    // GUARDIAN FIX: Removed timeline truncation (break;) to allow visual fracture flow
                }
                
                const hasCritical = disruptions.some(d => d.tier === 'CRITICAL');
                const isExpanded = plannerExpandedState.has(subLegId) || hasCritical;
                
                // Keep the border intact, let individual stops handle their own greyness
                html += `
                    <div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2">
                        <button id="btn-${subLegId}" onclick="if(typeof window.togglePlannerStops === 'function') window.togglePlannerStops('${subLegId}')" class="text-[10px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 px-3 py-1 rounded-full transition-colors mb-2 w-fit ml-5 -mt-1 relative top-[-5px] focus:outline-none">
                            ${isExpanded ? "Hide Stops" : "Show All Stops"}
                        </button>
                        <div id="${subLegId}" class="${isExpanded ? "" : "hidden"} space-y-1 pb-2">${innerHtml}</div>
                    </div>
                `;
            } else {
                html += `<div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2 h-4"></div>`;
            }

            // GUARDIAN FIX: Removed `if (!isSevered)` wrapper so the final destination always renders
            const arrGlobalIdx = fullValidStops.length - 1;
            const isEndDot = subIsFinalDest && !isSevered;
            const arrDotClass = isSevered ? "bg-gray-300 dark:bg-gray-700 w-3 h-3 -left-[7px] top-1.5 opacity-50 grayscale" : 
                                (isEndDot ? "bg-red-500 ring-4 ring-red-100 dark:ring-red-900 w-4 h-4 -left-[9px] top-0" : "bg-blue-500 w-3 h-3 -left-[7px] top-1.5");
            const arrTextClass = isSevered ? "text-gray-400 dark:text-gray-500 opacity-50 grayscale font-bold" : "text-gray-900 dark:text-white font-bold";
            const arrBorderClass = subIsFinalDest ? "border-l-2 border-transparent" : "border-l-2 border-gray-300 dark:border-gray-600";
            
            let arrLabel = subIsFinalDest ? subTo.replace(' STATION', '') : 'Arrive ' + subTo.replace(' STATION', '');
            if (isSevered) {
                arrLabel = `${subTo.replace(' STATION', '')}`;
            }

            html += `
                <div class="relative pl-6 ${arrBorderClass} ml-2 pb-2">
                    <div class="absolute rounded-full ${arrDotClass}"></div>
                    <div class="flex justify-between items-center mb-1">
                        <span class="${arrTextClass} text-sm">${arrLabel}</span>
                        <span class="font-mono ${arrTextClass} text-sm">${formatTimeDisplay(fullValidStops[arrGlobalIdx].time)}</span>
                    </div>
                </div>
            `;
            
            const finalInj = getInjectionHtml(arrGlobalIdx);
            if (finalInj) html += `<div class="${subIsFinalDest ? 'border-l-2 border-transparent' : 'border-l-2 border-gray-300 dark:border-gray-600'} ml-2">${finalInj}</div>`;
            return { html, isSevered };
        };

        if (leg.isRelayComposite && leg.internalTransfer) {
            const it = leg.internalTransfer;
            const sName = formatStation(it.station.replace(' STATION', ''));
            const waitStr = PlannerRenderer.formatDuration(Math.floor(it.wait / 60));
            
            const transferIndex = leg.stops.findIndex(s => normalizeStationName(s.station) === normalizeStationName(it.station));
            const stopsBefore = transferIndex !== -1 ? leg.stops.slice(0, transferIndex + 1) : [];
            const stopsAfter = transferIndex !== -1 ? leg.stops.slice(transferIndex + 1) : leg.stops;

            let train1Dest = `To ${sName}`;
            let train2Dest = trainDest;

            const leg1 = renderSubLeg(stopsBefore, fromStation, sName, `${legId}-A`, false, it.train1, train1Dest, initialSevered);
            let combinedHtml = leg1.html;

            const transferOpacity = leg1.isSevered ? "opacity-50 grayscale" : "";
            const waitMins = Math.floor(it.wait / 60);
            const isExtended = waitMins >= 240;
            const isInstant = waitMins === 0;

            let bridgeTitle = 'INTERNAL TRANSFER';
            const transferVariant = isExtended ? 'extended' : (isInstant ? 'instant' : 'transfer');
            if (isExtended) bridgeTitle = 'EXTENDED LAYOVER';
            else if (isInstant) bridgeTitle = 'INSTANT TRANSFER';

            combinedHtml += PlannerRenderer.buildTransferBadge({
                opacity: transferOpacity,
                title: `${bridgeTitle} @ ${sName}`,
                waitStr,
                connectLabel: 'Switch To',
                connectValue: `${train2Dest} Train ${it.train2}`,
                variant: transferVariant
            });

            const leg2 = renderSubLeg(stopsAfter, sName, toStation, `${legId}-B`, isFinalDest, it.train2, train2Dest, leg1.isSevered);
            combinedHtml += leg2.html;
            
            return { html: combinedHtml, isSevered: leg2.isSevered };
        } else {
            return renderSubLeg(leg.stops, fromStation, toStation, legId, isFinalDest, leg.train, trainDest, initialSevered);
        }
    },

    buildCard: (step, isNextDay, allOptions, selectedIndex) => {
        return `
            <div class="bg-transparent overflow-hidden flex flex-col">
                ${PlannerRenderer.renderHeader(step, isNextDay)}
                ${PlannerRenderer.renderOptionsSelector(allOptions, selectedIndex, isNextDay)}
                ${step.type !== 'TRANSFER' && step.type !== 'DOUBLE_TRANSFER' && step.type !== 'MULTI_TRANSFER' ? PlannerRenderer.renderInstruction(step) : ''}
                <div class="py-3 flex-grow">
                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 pl-1 border-b border-gray-100 dark:border-gray-800 pb-1">Journey Timeline</p>
                    ${PlannerRenderer.renderTimeline(step)}
                </div>
                <button onclick="if(typeof window.extractTripCoordinates === 'function') window.extractTripCoordinates(${selectedIndex})" class="w-full bg-blue-50/50 hover:bg-blue-100 hover:shadow-md active:scale-[0.99] dark:bg-gray-800 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400 font-bold py-3 text-xs rounded-lg transition-colors flex items-center justify-center focus:outline-none mt-2 uppercase tracking-wide border border-blue-200 dark:border-gray-600 shadow-sm">
                    <svg class="w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg>
                    View Trip Plan on Map
                </button>
            </div>
        `;
    },

    renderHeader: (step, isNextDay) => {
        let activeDisr = null;
        
        if (typeof window !== 'undefined' && typeof window.getTripDisruptions === 'function') {
            const checkStops = (stops, routeId) => {
                const disr = window.getTripDisruptions(routeId, stops);
                if (disr.some(d => d.tier === 'CRITICAL')) activeDisr = disr.find(d => d.tier === 'CRITICAL');
                else if (disr.some(d => d.tier === 'WARNING') && !activeDisr) activeDisr = disr.find(d => d.tier === 'WARNING');
            };
            
            if (step.type === 'DIRECT') checkStops(step.stops, step.route.id);
            else if (step.type === 'TRANSFER') { checkStops(step.leg1.stops, step.leg1.route.id); checkStops(step.leg2.stops, step.leg2.route.id); }
            else if (step.type === 'DOUBLE_TRANSFER') { checkStops(step.leg1.stops, step.leg1.route.id); checkStops(step.leg2.stops, step.leg2.route.id); checkStops(step.leg3.stops, step.leg3.route.id); }
            else if (step.type === 'MULTI_TRANSFER' && step.legs) { step.legs.forEach(l => checkStops(l.stops, l.route.id)); }
        }

        // 🛡️ GUARDIAN PHASE 4: The Header Banner Restoration (Partial Journey Bypass)
        // Mathematically chopped journeys hide the danger zone from the Vector Engine.
        // We forcefully scan the global registry cross-corridor to resurrect the top banner.
        if (typeof currentPlannerStatus !== 'undefined' && currentPlannerStatus === 'PARTIAL_JOURNEY' && typeof currentPlannerErrorPayload !== 'undefined' && currentPlannerErrorPayload) {
            const partialTerminus = currentPlannerErrorPayload.partialDest;
            if (partialTerminus && typeof $globalDisruptions !== 'undefined') {
                const normTerminus = normalizeStationName(partialTerminus);
                const globalList = Object.values($globalDisruptions.get()).flat();
                const criticalSeverance = globalList.find(d => 
                    d.tier === 'CRITICAL' && 
                    d.stations && 
                    d.stations.map(s => normalizeStationName(s)).includes(normTerminus)
                );
                
                if (criticalSeverance) {
                    activeDisr = criticalSeverance;
                }
            }
        }

        let alertBanner = '';
        if (activeDisr) {
            const isCrit = activeDisr.tier === 'CRITICAL';
            const colorClass = isCrit ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-yellow-500 text-yellow-900 hover:bg-yellow-600';
            
            // 🛡️ GUARDIAN UX FIX: Replaced vibe-coded emojis with premium Lucide-style SVGs
            const criticalIcon = `<svg class="w-4 h-4 shrink-0 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
            const warningIcon = `<svg class="w-4 h-4 shrink-0 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
            
            const icon = isCrit ? criticalIcon : warningIcon;
            const text = isCrit ? 'CRITICAL SERVICE DISRUPTION' : 'MINOR SERVICE DELAYS';
            
            alertBanner = `<button type="button" onclick="if(typeof window.openDisruptionModal === 'function') window.openDisruptionModal('${activeDisr.id}')" class="w-full flex items-center justify-center ${colorClass} text-[10px] font-black uppercase tracking-wider text-center py-1.5 shadow-sm mb-3 rounded transition-colors focus:outline-none">${icon} <span class="ml-1.5">${text}</span></button>`;
        }

        let transferCount = 0;
        if (step.type === 'MULTI_TRANSFER') {
            transferCount = step.legs ? step.legs.length - 1 : (step.transferCount || 3);
            if (step.legs) {
                step.legs.forEach(leg => { if (leg.isRelayComposite) transferCount += 1; });
            }
        } else {
            transferCount = step.type === 'DOUBLE_TRANSFER' ? 2 : (step.type === 'TRANSFER' ? 1 : 0);
            if (step.leg1 && step.leg1.isRelayComposite) transferCount += 1;
            if (step.leg2 && step.leg2.isRelayComposite) transferCount += 1;
            if (step.leg3 && step.leg3.isRelayComposite) transferCount += 1;
        }

        const colorClass = transferCount > 0 ? 'text-yellow-600 dark:text-yellow-400' : (isNextDay ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400');
        
        let headerLabel = 'Direct Trip';
        if (transferCount === 1) headerLabel = 'Transfer Trip';
        else if (transferCount >= 2) headerLabel = `Bridge Trip (${transferCount} Transfers)`;
        if (isNextDay) headerLabel = 'Future Trip';

        const { countdown, duration, isDeparted } = PlannerRenderer.calculateTimes(step, isNextDay);

        let layoverBanner = '';
        let maxWaitMins = 0;
        let hubName = '';
        
        const checkLayover = (arr, dep, hub) => {
            let wait = Math.floor((timeToSeconds(dep) - timeToSeconds(arr)) / 60);
            if (wait < 0) wait += 14400; // Rollover safe
            if (wait > maxWaitMins) { maxWaitMins = wait; hubName = hub; }
        };

        if (step.type === 'TRANSFER') checkLayover(step.leg1.arrTime, step.leg2.depTime, step.transferStation);
        if (step.type === 'DOUBLE_TRANSFER') { checkLayover(step.leg1.arrTime, step.leg2.depTime, step.hub1); checkLayover(step.leg2.arrTime, step.leg3.depTime, step.hub2); }
        if (step.type === 'MULTI_TRANSFER' && step.legs) {
            for (let i = 0; i < step.legs.length - 1; i++) checkLayover(step.legs[i].arrTime, step.legs[i+1].depTime, step.legs[i].to);
        }
        
        if (maxWaitMins >= 240) {
            const waitStr = PlannerRenderer.formatDuration(maxWaitMins);
            const alertSvg = `<svg class="w-4 h-4 text-orange-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
            layoverBanner = `<div class="bg-orange-50 dark:bg-orange-900/30 border-l-4 border-orange-500 text-orange-800 dark:text-orange-300 text-[10px] font-bold p-2.5 mb-3 rounded-r shadow-sm flex justify-between items-start w-full"><div class="flex-1 min-w-0 pr-3"><span>Please be advised that your trip includes a wait time of <b>${waitStr}</b> @ ${PlannerRenderer.applyUIIntercepts(hubName)}.</span></div><div class="shrink-0 scale-125 origin-top-right">${alertSvg}</div></div>`;
        }

        let stateBadge = "";
        
        if (isNextDay) {
             const dynamicDayText = step.dayLabel ? `Departure: ${step.dayLabel}` : "Departure: Tomorrow";
             stateBadge = `<div class="flex items-center text-sm font-bold text-orange-600 dark:text-orange-400">
                            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            ${dynamicDayText}
                          </div>`;
        } else if (isDeparted) {
            // 🛡️ GUARDIAN UX FIX: Removed w-full, shrunk button, and added whitespace-nowrap to stop text squishing
            stateBadge = `
                <div class="flex flex-col items-start mt-1 sm:mt-0 pr-2 min-w-0">
                    <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                        ${countdown}
                    </div>
                    <button onclick="if(typeof window._plannerCurrentTripIndex !== 'undefined' && typeof window._selectCustomTrip === 'function') window._selectCustomTrip(window._plannerCurrentTripIndex + 1);" class="bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 font-bold py-1.5 px-3 rounded-lg shadow-sm transition-colors focus:outline-none flex justify-center items-center text-[9px] uppercase tracking-wider whitespace-nowrap">
                        Show Next Train <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"></path></svg>
                    </button>
                </div>
            `;
        } else {
            stateBadge = `<div class="flex items-center text-sm font-bold text-blue-600 dark:text-blue-400">
                            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            ${countdown}
                          </div>`;
        }

        return `
            ${alertBanner}
            ${layoverBanner}
            <div class="pb-4 mb-2 border-b border-gray-100 dark:border-gray-800 bg-transparent">
                <div class="flex items-center justify-start mb-3">
                    <span class="text-[10px] font-black ${colorClass} uppercase tracking-widest">${headerLabel}</span>
                </div>
                <div class="flex justify-between items-center">
                    <div class="text-left flex-1 w-0 pr-2">
                        <p class="text-[9px] text-gray-500 uppercase font-black tracking-widest">Depart</p>
                        <p class="text-base sm:text-lg font-black text-gray-900 dark:text-white leading-tight tracking-tight mt-0.5 break-words" title="${step.from}">${step.from}</p>
                        <p class="text-lg font-black ${colorClass} mt-1">${PlannerRenderer.format12h(step.depTime)}</p>
                    </div>
                    
                    <button onclick="if(typeof window.swapPlannerResults === 'function') window.swapPlannerResults()" class="flex-none p-1.5 bg-gray-50 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 transition focus:outline-none shrink-0 border border-gray-200 dark:border-gray-700" title="Reverse Trip">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
                    </button>

                    <div class="text-right flex-1 w-0 pl-2">
                        <p class="text-[9px] text-gray-500 uppercase font-black tracking-widest">Arrive</p>
                        <p class="text-base sm:text-lg font-black text-gray-900 dark:text-white leading-tight tracking-tight mt-0.5 break-words" title="${step.to}">${step.to}</p>
                        <p class="text-lg font-black ${colorClass} mt-1">${PlannerRenderer.format12h(step.arrTime)}</p>
                    </div>
                </div>
                <div class="flex justify-between items-start mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                     ${stateBadge}
                     <div class="flex flex-col items-end text-right shrink-0 pl-2">
                        <div class="flex items-center text-xs font-bold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            ${duration}
                        </div>
                        <div class="text-[9px] text-gray-400 uppercase tracking-widest mt-0.5">Total Time</div>
                     </div>
                </div>
            </div>
        `;
    },

    renderOptionsSelector: (allOptions, selectedIndex, isNextDay) => {
        if (!allOptions || allOptions.length === 0) return '';
        const nowSec = timeToSeconds(getCurrentTime());
        const isToday = (!selectedPlannerDay || selectedPlannerDay === getCurrentDayType());
        const midnightRollover = PlannerRenderer.isMidnightRollover();

        let selectedText = "";

        const optionsHtml = allOptions.map((opt, idx) => {
            const depSec = timeToSeconds(opt.depTime);
            // GUARDIAN PHASE 14: If it's a future day, it's never "past" compared to today's clock
            let isPast = isToday && !midnightRollover && !opt.dayLabel && (depSec < nowSec);
            let label = "";
            
            // GUARDIAN V7: Accurately count composite relays and Dijkstra legs
            let transferCount = 0;
            if (opt.type === 'MULTI_TRANSFER') {
                transferCount = opt.legs ? opt.legs.length - 1 : (opt.transferCount || 3);
                if (opt.legs) {
                    opt.legs.forEach(leg => { if (leg.isRelayComposite) transferCount += 1; });
                }
            } else {
                transferCount = opt.type === 'DOUBLE_TRANSFER' ? 2 : (opt.type === 'TRANSFER' ? 1 : 0);
                if (opt.leg1 && opt.leg1.isRelayComposite) transferCount += 1;
                if (opt.leg2 && opt.leg2.isRelayComposite) transferCount += 1;
                if (opt.leg3 && opt.leg3.isRelayComposite) transferCount += 1;
            }

            let typeLabel = transferCount === 0 ? "Direct" : `${transferCount} Transfer${transferCount > 1 ? 's' : ''}`;
            
            // GUARDIAN PHASE 14: Dynamic future label injection
            if (opt.dayLabel) {
                label = ` (${opt.dayLabel})`;
            } else if (midnightRollover) {
                label = " (Tomorrow)";
            }
            
            // Formatted explicitly as "08:59 ➔ 10:30 [1 Transfer]"
            const text = `${formatTimeDisplay(opt.depTime)} ➔ ${formatTimeDisplay(opt.arrTime)} [${typeLabel}]${label}`;
            const isSelected = (idx === selectedIndex);
            
            if (isSelected) {
                selectedText = text;
            }

            // GUARDIAN PHASE 6: Dynamic legibility inversion for active trip
            return `
                <li onclick="if(typeof window._selectCustomTrip === 'function') window._selectCustomTrip(${idx})" class="p-3.5 border-b border-gray-100 dark:border-gray-700 cursor-pointer text-sm sm:text-base font-medium transition-colors ${isSelected ? 'bg-blue-600 text-white hover:bg-blue-700 border-transparent' : 'hover:bg-blue-50 dark:hover:bg-gray-700 ' + (isPast ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200')}">
                    ${text}
                </li>
            `;
        }).join('');

        return `
            <div class="pb-3 relative border-b border-gray-100 dark:border-gray-800 mb-2" id="custom-time-dropdown-container">
                <style>
                    @keyframes gentleRingPulse {
                        0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
                        50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25); }
                    }
                    .planner-gentle-pulse {
                        animation: gentleRingPulse 1.5s ease-in-out 4; /* Stops gracefully after 6 seconds */
                    }
                </style>
                <label class="text-[9px] uppercase font-black text-gray-400 mb-1.5 block tracking-widest pl-1">Departure Time</label>
                <div onclick="this.classList.remove('planner-gentle-pulse'); if(typeof window._toggleCustomTimeDropdown === 'function') window._toggleCustomTimeDropdown(event)" class="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm rounded-lg p-3 focus:outline-none font-bold shadow-sm cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400 group planner-gentle-pulse">
                    <span id="custom-time-display" class="truncate pr-2">${selectedText}</span>
                    <svg class="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0 transform transition-transform" id="custom-time-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
                <ul id="custom-time-list" class="absolute z-[200] w-full left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-h-64 overflow-y-auto hidden mt-1 custom-scrollbar flex flex-col text-left">
                    ${optionsHtml}
                </ul>
            </div>
        `;
    },

    renderInstruction: (step) => `
        <div class="py-2 mb-2 border-b border-gray-100 dark:border-gray-800">
            <div class="flex items-start bg-blue-50/50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-800/50">
                <svg class="w-4 h-4 mr-2 mt-0.5 text-blue-500 dark:text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                <p class="text-xs text-gray-700 dark:text-gray-300 leading-snug">
                    <b>Instruction:</b><br> 
                    Take train <b>${step.train}</b> on the <b>${step.route.name}</b> line.
                </p>
            </div>
        </div>
    `,

    renderTimeline: (step) => {
        const renderedAlerts = new Set();
        
        if (step.type === 'TRANSFER') return PlannerRenderer.renderTransferTimeline(step, renderedAlerts);
        if (step.type === 'DOUBLE_TRANSFER') return PlannerRenderer.renderDoubleTransferTimeline(step, renderedAlerts);
        if (step.type === 'MULTI_TRANSFER') return PlannerRenderer.renderMultiTransferTimeline(step, renderedAlerts);
        
        return `
            <div class="mt-4 ml-0 space-y-0">
                ${PlannerRenderer.renderLegTimeline(step, step.from, step.to, `stops-direct-${step.train}`, true, renderedAlerts, false).html}
            </div>
        `;
    },

    renderMultiTransferTimeline: (step, renderedAlerts) => {
        if (!step.legs || step.legs.length === 0) return '';
        let html = '<div class="mt-4 ml-0 space-y-0">';

        let currentSevered = false;

        for (let i = 0; i < step.legs.length; i++) {
            const leg = step.legs[i];
            const isFinalDest = (i === step.legs.length - 1);
            const legId = `l${i+1}-${step.train}`;
            
            const legResult = PlannerRenderer.renderLegTimeline(leg, leg.from, leg.to, legId, isFinalDest, renderedAlerts, currentSevered);
            html += legResult.html;
            currentSevered = legResult.isSevered;

            if (!isFinalDest) {
                const nextLeg = step.legs[i+1];
                const arr = timeToSeconds(leg.arrTime);
                const dep = timeToSeconds(nextLeg.depTime);
                const waitMins = Math.floor((dep - arr) / 60);
                const waitStr = PlannerRenderer.formatDuration(waitMins);
                const hubName = PlannerRenderer.applyUIIntercepts(leg.to);
                const trainDest = PlannerRenderer.applyUIIntercepts(nextLeg.actualDestination || nextLeg.route.destB);

                const isExtended = waitMins >= 240; 
                if (isExtended && !renderedAlerts.has('excessive_layover')) {
                    renderedAlerts.add('excessive_layover');
                    if (typeof trackAnalyticsEvent === 'function') {
                        trackAnalyticsEvent('planner_excessive_layover', {
                            origin: step.from.replace(/ STATION/gi, ''),
                            destination: step.to.replace(/ STATION/gi, ''),
                            hub: hubName,
                            wait_mins: waitMins
                        });
                    }
                }

                const transferOpacity = currentSevered ? "opacity-50 grayscale" : "";
                const isInstant = waitMins === 0;
                let bridgeTitle = `TRANSFER ${i+1}`;
                if (isExtended) bridgeTitle = 'EXTENDED LAYOVER';
                else if (isInstant) bridgeTitle = `INSTANT TRANSFER ${i+1}`;

                html += PlannerRenderer.buildTransferBadge({
                    opacity: transferOpacity,
                    title: bridgeTitle,
                    waitStr,
                    connectLabel: 'Connect To',
                    connectValue: `${trainDest} Train ${nextLeg.train}`,
                    variant: isExtended ? 'extended' : (isInstant ? 'instant' : 'transfer')
                });
            }
        }

        html += '</div>';
        return html;
    },

    renderTransferTimeline: (step, renderedAlerts) => {
        const hubArr = timeToSeconds(step.leg1.arrTime);
        const hubDep = timeToSeconds(step.leg2.depTime);
        const waitMins = Math.floor((hubDep - hubArr) / 60);
        const waitStr = PlannerRenderer.formatDuration(waitMins);
        
        let train2Dest = PlannerRenderer.applyUIIntercepts(step.leg2.actualDestination || step.leg2.route.destB);

        const leg1Result = PlannerRenderer.renderLegTimeline(step.leg1, step.from, step.transferStation, `stops-leg1-${step.train}`, false, renderedAlerts, false);
        const transferOpacity = leg1Result.isSevered ? "opacity-50 grayscale" : "";

        const isExtended = waitMins >= 240; 
        if (isExtended && !renderedAlerts.has('excessive_layover')) {
            renderedAlerts.add('excessive_layover');
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_excessive_layover', {
                    origin: step.from.replace(/ STATION/gi, ''),
                    destination: step.to.replace(/ STATION/gi, ''),
                    hub: PlannerRenderer.applyUIIntercepts(step.transferStation),
                    wait_mins: waitMins
                });
            }
        }

        const isInstant = waitMins === 0;
        let bridgeTitle = 'TRANSFER REQUIRED';
        if (isExtended) bridgeTitle = 'EXTENDED LAYOVER';
        else if (isInstant) bridgeTitle = 'INSTANT TRANSFER';

        const standardTransferBlock = PlannerRenderer.buildTransferBadge({
            opacity: transferOpacity,
            title: bridgeTitle,
            waitStr,
            connectLabel: 'Connect To',
            connectValue: `${train2Dest} Train ${step.leg2.train}`,
            variant: isExtended ? 'extended' : (isInstant ? 'instant' : 'transfer')
        });

        const leg2Result = PlannerRenderer.renderLegTimeline(step.leg2, step.transferStation, step.to, `stops-leg2-${step.train}`, true, renderedAlerts, leg1Result.isSevered);

        return `
            <div class="mt-4 ml-0 space-y-0">
                ${leg1Result.html}
                ${standardTransferBlock}
                ${leg2Result.html}
            </div>
        `;
    },

    renderDoubleTransferTimeline: (step, renderedAlerts) => {
        const arr1 = timeToSeconds(step.leg1.arrTime);
        const dep2 = timeToSeconds(step.leg2.depTime);
        const wait1Mins = Math.floor((dep2 - arr1) / 60);
        const wait1Str = PlannerRenderer.formatDuration(wait1Mins);

        const arr2 = timeToSeconds(step.leg2.arrTime);
        const dep3 = timeToSeconds(step.leg3.depTime);
        const wait2Mins = Math.floor((dep3 - arr2) / 60);
        const wait2Str = PlannerRenderer.formatDuration(wait2Mins);

        const formatStation = (s) => PlannerRenderer.applyUIIntercepts(s);
        const hub1Name = formatStation(step.hub1);
        
        let train2Dest = formatStation(step.leg2.actualDestination || step.leg2.route.destB);
        let train3Dest = formatStation(step.leg3.actualDestination || step.leg3.route.destB);

        const leg1Result = PlannerRenderer.renderLegTimeline(step.leg1, step.from, step.hub1, `l1-${step.train}`, false, renderedAlerts, false);
        const transferOpacity1 = leg1Result.isSevered ? "opacity-50 grayscale" : "";

        const isExtended1 = wait1Mins >= 240; 
        if (isExtended1 && !renderedAlerts.has('excessive_layover')) {
            renderedAlerts.add('excessive_layover');
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_excessive_layover', {
                    origin: step.from.replace(/ STATION/gi, ''),
                    destination: step.to.replace(/ STATION/gi, ''),
                    hub: hub1Name,
                    wait_mins: wait1Mins
                });
            }
        }

        const isInstant1 = wait1Mins === 0;
        let bridgeTitle1 = 'TRANSFER 1';
        if (isExtended1) bridgeTitle1 = 'EXTENDED LAYOVER';
        else if (isInstant1) bridgeTitle1 = 'INSTANT TRANSFER 1';

        // FIX: transfer1 connects to train2 (not train3)
        const transferBlock1 = PlannerRenderer.buildTransferBadge({
            opacity: transferOpacity1,
            title: bridgeTitle1,
            waitStr: wait1Str,
            connectLabel: 'Connect To',
            connectValue: `${train2Dest} Train ${step.leg2.train}`,
            variant: isExtended1 ? 'extended' : (isInstant1 ? 'instant' : 'transfer')
        });

        const leg2Result = PlannerRenderer.renderLegTimeline(step.leg2, step.hub1, step.hub2, `l2-${step.train}`, false, renderedAlerts, leg1Result.isSevered);
        const transferOpacity2 = leg2Result.isSevered ? "opacity-50 grayscale" : "";

        const isExtended2 = wait2Mins >= 240; 
        if (isExtended2 && !renderedAlerts.has('excessive_layover')) {
            renderedAlerts.add('excessive_layover');
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_excessive_layover', {
                    origin: step.from.replace(/ STATION/gi, ''),
                    destination: step.to.replace(/ STATION/gi, ''),
                    hub: formatStation(step.hub2),
                    wait_mins: wait2Mins
                });
            }
        }

        const isInstant2 = wait2Mins === 0;
        let bridgeTitle2 = 'TRANSFER 2';
        if (isExtended2) bridgeTitle2 = 'EXTENDED LAYOVER';
        else if (isInstant2) bridgeTitle2 = 'INSTANT TRANSFER 2';

        const transferBlock2 = PlannerRenderer.buildTransferBadge({
            opacity: transferOpacity2,
            title: bridgeTitle2,
            waitStr: wait2Str,
            connectLabel: 'Connect To',
            connectValue: `${train3Dest} Train ${step.leg3.train}`,
            variant: isExtended2 ? 'extended' : (isInstant2 ? 'instant' : 'transfer')
        });

        const leg3Result = PlannerRenderer.renderLegTimeline(step.leg3, step.hub2, step.to, `l3-${step.train}`, true, renderedAlerts, leg2Result.isSevered);

        return `
            <div class="mt-4 ml-0 space-y-0">
                ${leg1Result.html}
                ${transferBlock1}
                ${leg2Result.html}
                ${transferBlock2}
                ${leg3Result.html}
            </div>
        `;
    },

    calculateTimes: (step, isNextDay) => {
        const nowSec = timeToSeconds(getCurrentTime());
        const depSec = timeToSeconds(step.depTime);
        const arrSec = timeToSeconds(step.arrTime);
        const isToday = (!selectedPlannerDay || selectedPlannerDay === getCurrentDayType());
        let countdown = "Scheduled";
        let isDeparted = false;
        
        const midnightRollover = PlannerRenderer.isMidnightRollover();
        
        let effectiveDepSec = depSec;
        let isTomorrowOverride = false;
        
        if (midnightRollover || step.dayLabel) { 
            const offsetMultiplier = step.dayOffset ? step.dayOffset : 1;
            effectiveDepSec += (86400 * offsetMultiplier); 
            isTomorrowOverride = true; 
        }

        if (isToday && !isTomorrowOverride) {
            if (effectiveDepSec > nowSec) {
                const diff = effectiveDepSec - nowSec;
                const h = Math.floor(diff / 3600);
                const m = Math.floor((diff % 3600) / 60);
                countdown = h > 0 ? `Departs in ${h}h ${m}m` : (m === 0 ? "Departs in < 1 min" : `Departs in ${m} min`);
            } else { countdown = "Departed"; isDeparted = true; }
        }
        
        const durSec = arrSec - depSec;
        const durMins = Math.floor(durSec / 60);
        return { countdown, duration: PlannerRenderer.formatDuration(durMins), isDeparted };
    }
};

// --- INITIALIZATION ---
export function initPlanner() {
    const fromSelect = document.getElementById('planner-from');
    const toSelect = document.getElementById('planner-to');
    const swapBtn = document.getElementById('planner-swap-btn');
    const searchBtn = document.getElementById('planner-search-btn');
    const resetBtn = document.getElementById('planner-reset-btn');
    const locateBtn = document.getElementById('planner-locate-btn');
    const backBtn = document.getElementById('planner-back-btn');

    const inputSection = document.getElementById('planner-input-section');
    if (inputSection && !document.getElementById('planner-day-select-container')) {
        const daySelectDiv = document.createElement('div');
        daySelectDiv.id = "planner-day-select-container";
        daySelectDiv.className = "mb-4 relative"; 
        
        let selDay = (typeof selectedPlannerDay !== 'undefined' && selectedPlannerDay) ? selectedPlannerDay : getCurrentDayType();
        let selText = selDay === 'weekday' ? 'Weekday (Mon-Fri)' : (selDay === 'saturday' ? 'Saturday / Public Holiday' : 'Sunday');

        daySelectDiv.innerHTML = `
            <label class="block text-xs font-bold text-gray-500 uppercase ml-1 mb-1">Travel Day</label>
            <div onclick="if(typeof window._toggleMainDayDropdown === 'function') window._toggleMainDayDropdown(event)" class="w-full p-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-900 dark:text-white focus:outline-none cursor-pointer flex justify-between items-center shadow-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                <span id="main-day-display">${selText}</span>
                <svg id="main-day-chevron" class="w-5 h-5 text-gray-500 shrink-0 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <ul id="main-day-list" class="absolute z-[200] w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl hidden mt-2 flex-col overflow-hidden text-left">
                <li onclick="if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'weekday', 'Weekday (Mon-Fri)')" class="p-4 text-sm font-bold hover:bg-blue-50 dark:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 ${selDay === 'weekday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Weekday (Mon-Fri)</li>
                <li onclick="if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'saturday', 'Saturday / Public Holiday')" class="p-4 text-sm font-bold border-t border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 ${selDay === 'saturday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Saturday / Public Holiday</li>
                <li onclick="if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'sunday', 'Sunday')" class="p-4 text-sm font-bold hover:bg-blue-50 dark:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selDay === 'sunday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Sunday</li>
            </ul>
        `;
        inputSection.insertBefore(daySelectDiv, searchBtn);
    }

    if (inputSection && !document.getElementById('planner-history-container')) {
        const historyContainer = document.createElement('div');
        historyContainer.id = 'planner-history-container';
        historyContainer.className = "mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 hidden";
        inputSection.appendChild(historyContainer);
        
        historyContainer.addEventListener('click', (e) => {
            const clearBtn = e.target.closest('#planner-history-clear-btn');
            const historyItem = e.target.closest('.planner-history-item-btn');
            
            if (clearBtn) {
                const historyKey = 'plannerHistory_' + $userRegion.get();
                try { safeStorage.removeItem(historyKey); } catch(ex) {}
                renderPlannerHistory();
            } else if (historyItem) {
                const fullFrom = historyItem.getAttribute('data-full-from');
                const fullTo = historyItem.getAttribute('data-full-to');
                if (fullFrom && fullTo && typeof window.restorePlannerSearch === 'function') {
                    window.restorePlannerSearch(fullFrom, fullTo);
                }
            }
        });
        
        renderPlannerHistory();
    }

    const infoBtn = document.getElementById('planner-info-btn');
    if (infoBtn) {
        infoBtn.addEventListener('click', () => {
            if (typeof triggerHaptic === 'function') triggerHaptic();
            if (typeof openSmoothModal === 'function') {
                openSmoothModal('help-modal');
            } else {
                const helpModal = document.getElementById('help-modal');
                if (helpModal) helpModal.classList.remove('hidden');
            }
        });
    }

    const plannerTab = document.getElementById('tab-trip-planner');
    if (plannerTab) {
        let pClickCount = 0;
        let pClickTimer = null;
        plannerTab.addEventListener('click', () => {
            pClickCount++;
            if (pClickTimer) clearTimeout(pClickTimer);
            pClickTimer = setTimeout(() => { pClickCount = 0; }, 1000);
            
            if (pClickCount >= 5) {
                pClickCount = 0;
                const appTitle = document.getElementById('app-title');
                if (appTitle) appTitle.click(); 
            }
        });
    }

    if (!fromSelect || !toSelect) return;

    setupAutocomplete('planner-from-search', 'planner-from');
    setupAutocomplete('planner-to-search', 'planner-to');

    if (locateBtn) {
        locateBtn.addEventListener('click', () => {
            const icon = locateBtn.querySelector('svg');
            if (icon) icon.classList.add('animate-spin'); 
            
            if (!navigator.geolocation) {
                if (typeof showToast === 'function') showToast("Geolocation is not supported.", "error");
                if (icon) icon.classList.remove('animate-spin');
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude: userLat, longitude: userLon } = position.coords;
                    let candidates = [];
                    const globalIndex = $globalStationIndex.get();
                    if (globalIndex) {
                        for (const [stationName, coords] of Object.entries(globalIndex)) {
                            const dist = getDistanceFromLatLonInKm(userLat, userLon, coords.lat, coords.lon);
                            candidates.push({ stationName, dist });
                        }
                        candidates.sort((a, b) => a.dist - b.dist);
                    }

                    if (candidates.length > 0 && candidates[0].dist <= 6) { 
                        const nearest = candidates[0];
                        fromSelect.value = nearest.stationName;
                        const fromInputSearch = document.getElementById('planner-from-search');
                        if (fromInputSearch) {
                            fromInputSearch.value = nearest.stationName.replace(' STATION', '');
                            fromInputSearch.dataset.resolvedValue = nearest.stationName;
                        }
                        
                        filterToOptions();
                        if (typeof showToast === 'function') showToast(`Located: ${nearest.stationName.replace(' STATION', '')} (${nearest.dist.toFixed(1)}km)`, "success");
                        
                        if (typeof trackAnalyticsEvent === 'function') {
                            trackAnalyticsEvent('planner_auto_locate', { station: nearest.stationName });
                        }
                    } else {
                        if (typeof showToast === 'function') showToast("No stations found nearby.", "error");
                    }
                    if (icon) icon.classList.remove('animate-spin');
                },
                () => {
                    if (typeof showToast === 'function') showToast("Could not retrieve location.", "error");
                    if (icon) icon.classList.remove('animate-spin');
                }
            );
        });
    }

    const filterToOptions = () => {
        const fromInputEl = document.getElementById('planner-from-search');
        const toInputEl = document.getElementById('planner-to-search');
        
        const selectedFrom = (fromInputEl && fromInputEl.dataset.resolvedValue) ? fromInputEl.dataset.resolvedValue : fromSelect.value;
        const selectedTo = (toInputEl && toInputEl.dataset.resolvedValue) ? toInputEl.dataset.resolvedValue : toSelect.value;

        Array.from(toSelect.options).forEach(opt => {
            if (opt.value === selectedFrom && opt.value !== "") {
                opt.disabled = true;
                opt.hidden = true; 
            } else {
                opt.disabled = false;
                opt.hidden = false;
            }
        });
        
        if (selectedFrom && selectedFrom !== "" && selectedTo === selectedFrom) {
            toSelect.value = "";
            if (toInputEl) {
                toInputEl.value = "";
                delete toInputEl.dataset.resolvedValue;
            }
        }
    };
    
    fromSelect.addEventListener('change', filterToOptions);
    const fromInput = document.getElementById('planner-from-search');
    if(fromInput) fromInput.addEventListener('change', filterToOptions);

    if (swapBtn) {
        swapBtn.addEventListener('click', () => {
            if (typeof window.swapPlannerResults === 'function') {
                window.swapPlannerResults();
            }
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            if (typeof triggerHaptic === 'function') triggerHaptic(); 

            const fromInputSearch = document.getElementById('planner-from-search');
            const toInputSearch = document.getElementById('planner-to-search');

            const resolveStation = (inputEl) => {
                if (!inputEl) return "";
                if (inputEl.dataset.resolvedValue) return inputEl.dataset.resolvedValue;
                
                const inputVal = inputEl.value;
                const masterList = getMasterStationList();
                if (!inputVal || !masterList || masterList.length === 0) return "";

                const cleanInput = inputVal.trim().replace(/\s+/g, ' ').toUpperCase();
                const exact = masterList.find(s => s.replace(' STATION', '').trim().toUpperCase() === cleanInput);
                if (exact) {
                    inputEl.dataset.resolvedValue = exact;
                    return exact;
                }

                const matches = masterList.filter(s => s.replace(' STATION', '').trim().toUpperCase().includes(cleanInput));
                if (matches.length === 1) {
                    inputEl.dataset.resolvedValue = matches[0];
                    return matches[0];
                }
                return "";
            };

            const from = resolveStation(fromInputSearch);
            const to = resolveStation(toInputSearch);

            if (from && fromInputSearch) fromInputSearch.value = from.replace(' STATION', '');
            if (to && toInputSearch) toInputSearch.value = to.replace(' STATION', '');

            const fromSelect = document.getElementById('planner-from');
            const toSelect = document.getElementById('planner-to');
            if (fromSelect && from) {
                if (!fromSelect.querySelector(`option[value="${from}"]`)) {
                    fromSelect.appendChild(new Option(from, from));
                }
                fromSelect.value = from;
            }
            if (toSelect && to) {
                if (!toSelect.querySelector(`option[value="${to}"]`)) {
                    toSelect.appendChild(new Option(to, to));
                }
                toSelect.value = to;
            }

            if (!from || !to) {
                if (typeof showToast === 'function') showToast("Please select valid stations from the list.", "error");
                return;
            }
            if (from === to) {
                if (typeof showToast === 'function') showToast("Origin and Destination cannot be the same.", "error");
                return;
            }

            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_search', {
                    origin: from,
                    destination: to,
                    day: typeof selectedPlannerDay !== 'undefined' && selectedPlannerDay ? selectedPlannerDay : 'unknown'
                });
            }

            if (typeof savePlannerHistory === 'function') savePlannerHistory(from, to);
            executeTripPlan(from, to);
        });
    }

    const resetAction = () => {
        if (typeof triggerHaptic === 'function') triggerHaptic();
        hidePlannerResults();
        
        if (typeof location !== 'undefined' && location.hash === '#planner-results') {
            history.replaceState({ view: 'planner' }, '', '#planner');
        }
    };

    if (resetBtn) resetBtn.addEventListener('click', resetAction);
    if (backBtn) backBtn.addEventListener('click', resetAction);

    const tabNextTrain = document.getElementById('tab-next-train');
    if (tabNextTrain) {
        tabNextTrain.addEventListener('click', () => {
            if (typeof location !== 'undefined' && location.hash === '#planner-results') {
                history.replaceState({ view: 'home' }, '', '#home');
                hidePlannerResults();
            }
        });
    }
}

export function savePlannerHistory(from, to) {
    if (!from || !to || typeof from !== 'string' || typeof to !== 'string') return;
    const cleanFrom = from.replace(/ STATION/gi, '');
    const cleanTo = to.replace(/ STATION/gi, '');
    const routeKey = `${cleanFrom}|${cleanTo}`;
    
    const historyKey = 'plannerHistory_' + $userRegion.get();
    
    let history = JSON.parse(safeStorage.getItem(historyKey) || "[]");
    history = history.filter(item => `${item.from}|${item.to}` !== routeKey);
    history.unshift({ from: cleanFrom, to: cleanTo, fullFrom: from, fullTo: to });
    if (history.length > 4) history = history.slice(0, 4);
    
    safeStorage.setItem(historyKey, JSON.stringify(history));
    renderPlannerHistory();
}

export function renderPlannerHistory() {
    const container = document.getElementById('planner-history-container');
    if (!container) return;
    
    const historyKey = 'plannerHistory_' + $userRegion.get();
    let rawHistory = JSON.parse(safeStorage.getItem(historyKey) || "[]");

    let validHistory = rawHistory;
    const masterList = getMasterStationList();
    
    if (masterList && masterList.length > 0) {
        validHistory = rawHistory.filter(item =>
            masterList.includes(item.from ? item.from.toUpperCase() : '') &&
            masterList.includes(item.to ? item.to.toUpperCase() : '')
        );
    } else if (masterList && masterList.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    if (validHistory.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="flex items-center justify-between mb-2 px-1">
             <p class="text-xs font-bold text-gray-400 uppercase">Recent Trips</p>
             <button id="planner-history-clear-btn" class="text-[10px] text-gray-400 hover:text-red-500 focus:outline-none">Clear</button>
        </div>
        <div class="flex flex-col gap-2">
            ${validHistory.map(item => `
                <button class="planner-history-item-btn w-full flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 shadow-sm hover:border-blue-50 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors group text-left focus:outline-none"
                    data-full-from="${escapeHTML(item.fullFrom)}" data-full-to="${escapeHTML(item.fullTo)}">
                    <span class="text-xs font-bold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 flex items-center">
                        ${item.from} <svg class="w-3 h-3 mx-1.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg> ${item.to}
                    </span>
                    <svg class="w-3 h-3 text-gray-300 group-hover:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
            `).join('')}
        </div>
    `;
}

export function setupAutocomplete(inputId, selectId) {
    const input = document.getElementById(inputId);
    const select = document.getElementById(selectId);
    if (!input || !select) return;

    select.classList.add('hidden');
    if (input.parentNode && input.parentNode instanceof HTMLElement) input.parentNode.style.position = 'relative';

    const chevron = document.createElement('div');
    chevron.className = "absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 cursor-pointer p-2 hover:text-blue-500 z-10";
    chevron.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>`;
    input.parentNode.appendChild(chevron);

    const list = document.createElement('ul');
    list.className = "absolute z-50 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-b-lg shadow-xl max-h-60 overflow-y-auto hidden mt-1 left-0 custom-scrollbar text-left";
    input.parentNode.appendChild(list);

    const renderList = (filterText = '') => {
        list.innerHTML = '';
        const val = filterText.trim().toUpperCase();
        const masterList = getMasterStationList();
        let matches = val.length === 0 ? masterList : masterList.filter(s => s.includes(val));

        let oppositeValue = "";
        if (inputId === 'planner-from-search') {
            const toInput = document.getElementById('planner-to-search');
            oppositeValue = (toInput && toInput.dataset.resolvedValue) ? toInput.dataset.resolvedValue : "";
        } else if (inputId === 'planner-to-search') {
            const fromInput = document.getElementById('planner-from-search');
            oppositeValue = (fromInput && fromInput.dataset.resolvedValue) ? fromInput.dataset.resolvedValue : "";
        }
        
        if (oppositeValue) {
            matches = matches.filter(s => s !== oppositeValue);
        }

        if (matches.length === 0) {
            const li = document.createElement('li');
            li.className = "p-3 text-sm text-gray-400 italic";
            li.textContent = "No stations found";
            list.appendChild(li);
        } else {
            matches.forEach(station => {
                const li = document.createElement('li');
                li.className = "p-3 border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors";
                li.textContent = station.replace(' STATION', '');
                li.onclick = () => {
                    input.value = station.replace(' STATION', '');
                    input.dataset.resolvedValue = station;
                    if (select) {
                        if (!select.querySelector(`option[value="${station}"]`)) {
                            const opt = document.createElement('option');
                            opt.value = station;
                            opt.textContent = station;
                            select.appendChild(opt);
                        }
                        select.value = station;
                        const event = new Event('change');
                        select.dispatchEvent(event);
                    }
                    list.classList.add('hidden');
                };
                list.appendChild(li);
            });
        }
        list.classList.remove('hidden');
    };

    input.addEventListener('input', () => { 
        delete input.dataset.resolvedValue;
        if (select) select.value = ""; 
        renderList(input.value); 
    });
    
    input.addEventListener('focus', () => {
        input.select();
        renderList('');
    });
    
    chevron.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        if (list.classList.contains('hidden')) {
            renderList('');
            input.focus();
        } else {
            list.classList.add('hidden');
        }
    });
    
    if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target && target instanceof Node && !input.contains(target) && !list.contains(target) && !chevron.contains(target)) {
                list.classList.add('hidden');
            }
        });
    }
}

// --- ORCHESTRATION ---
export function executeTripPlan(origin, dest, preferredTime = null) {
    const resultsContainer = document.getElementById('planner-results-list');
    if (resultsContainer) {
        resultsContainer.innerHTML = `
        <div class="min-h-[400px] flex flex-col justify-center items-center text-center p-4">
            <svg class="w-10 h-10 animate-spin mx-auto text-blue-500 mb-4" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <div id="planner-spinner-text" class="text-sm font-bold text-gray-600 dark:text-gray-400 animate-pulse">Searching all possible routes...</div>
        </div>
    `;
    }

    let isSearching = true;
    const updateSpinnerText = (text) => {
        const el = document.getElementById('planner-spinner-text');
        if (el && isSearching) el.textContent = text;
    };
    const spinnerTimers = [
        setTimeout(() => updateSpinnerText("Evaluating alternative corridors..."), 3500),
        setTimeout(() => updateSpinnerText("Line Severance detected. Rerouting..."), 7000),
        setTimeout(() => updateSpinnerText("Calculating partial journeys..."), 10500)
    ];
    
    const inputSecEl = document.getElementById('planner-input-section');
    if (inputSecEl) inputSecEl.classList.add('hidden');
    
    const resultsSecEl = document.getElementById('planner-results-section');
    if (resultsSecEl) resultsSecEl.classList.remove('hidden');
    
    plannerExpandedState.clear();

    if (typeof location !== 'undefined' && location.hash !== '#planner-results') {
        history.pushState({ view: 'planner-results' }, '', '#planner-results');
    }

    if (!selectedPlannerDay) selectedPlannerDay = getCurrentDayType();

    setTimeout(() => {
        spinnerTimers.forEach(t => clearTimeout(t));
        isSearching = false;
        let plannerResponse = { status: 'NO_PATH', trips: [] };
        if (typeof planUnifiedTrip === 'function') {
            const extContext = {};
            if ($isSimMode.get()) {
                const dateInput = document.getElementById('sim-date');
                if (dateInput instanceof HTMLInputElement && dateInput.value) {
                    extContext.simBaseDate = dateInput.value;
                }
            }
            plannerResponse = planUnifiedTrip(origin, dest, selectedPlannerDay, extContext);
        }

        currentTripOptions = plannerResponse.trips || [];
        currentPlannerStatus = plannerResponse.status;
        currentPlannerErrorPayload = plannerResponse.errorPayload || null; 
        const errorPayload = plannerResponse.errorPayload; 
        
        if (currentTripOptions.length > 0) {
            let nextTripIndex = 0;
            
            if (preferredTime) {
                const targetSec = timeToSeconds(preferredTime);
                let closestDist = Infinity;
                
                currentTripOptions.forEach((trip, index) => {
                    const tripSec = timeToSeconds(trip.depTime);
                    const dist = Math.abs(tripSec - targetSec);
                    if (dist < closestDist) {
                        closestDist = dist;
                        nextTripIndex = index;
                    }
                });
            } else {
                const nowSec = timeToSeconds(getCurrentTime());
                const isToday = (!selectedPlannerDay || selectedPlannerDay === getCurrentDayType());
                
                let isMidnightRollover = false;
                if (isToday && currentTripOptions.length > 0) {
                    const latestDep = Math.max(...currentTripOptions.map(t => timeToSeconds(t.depTime)));
                    if (nowSec > latestDep) isMidnightRollover = true;
                }
                
                if (currentPlannerStatus === 'SUNDAY_ROLLOVER' || currentPlannerStatus === 'IMPOSSIBLE_TODAY' || currentPlannerStatus === 'NO_MORE_TODAY') {
                    nextTripIndex = 0;
                } else if (currentTripOptions.length > 0 && currentTripOptions[0].dayLabel) {
                    nextTripIndex = 0;
                } else if (isMidnightRollover) {
                    nextTripIndex = 0;
                } else {
                    const idx = currentTripOptions.findIndex(t => timeToSeconds(t.depTime) >= nowSec);
                    if (idx !== -1) nextTripIndex = idx;
                    else nextTripIndex = currentTripOptions.length - 1;
                }
            }

            renderSelectedTrip(resultsContainer, nextTripIndex);
            startPlannerPulse(nextTripIndex);

        } else {
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_no_result', { 
                    origin: origin, 
                    destination: dest,
                    failure_reason: currentPlannerStatus
                });
            }
            
            updatePlannerHeader("No Route Found", false);

            let errorTitle = "No Valid Route";
            let errorMsg = "";
            let showFeedbackBtn = false;

            switch (currentPlannerStatus) {
                case 'SAME_STATION':
                    errorTitle = "Same Station Selected";
                    errorMsg = `
                        <div class="text-left space-y-2 mt-2">
                            <p>You are already at your destination.</p>
                            <ul class="list-disc pl-5 space-y-1 text-xs">
                                <li>Your Origin and Destination stations are exactly the same.</li>
                                <li>Please select a different destination to plan a trip.</li>
                            </ul>
                        </div>
                    `;
                    showFeedbackBtn = false;
                    break;
                case 'ERR_CROSS_REGION':
                    errorTitle = "Cross-Region Travel Not Supported";
                    errorMsg = `
                        <div class="text-left space-y-2 mt-2">
                            <p>You are attempting to route between two different province networks.</p>
                            <ul class="list-disc pl-5 space-y-1 text-xs">
                                <li>Metrorail Next Train currently only supports routing within a single region.</li>
                                <li>Please check your selected Origin and Destination stations.</li>
                            </ul>
                        </div>
                    `;
                    break;
                case 'ERR_ACTIVE_SUSPENSION':
                    errorTitle = "Route Suspended";
                    
                    let suspensionAlertHtml = '';
                    if (errorPayload && errorPayload.disruptionId) {
                        const btnText = errorPayload.buttonText || "Line Severed";
                        suspensionAlertHtml = `
                            <div class="mt-4 flex justify-center w-full">
                                <button type="button" onclick="if(typeof window.openDisruptionModal === 'function') window.openDisruptionModal('${errorPayload.disruptionId}')" class="bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-800 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors shadow-sm flex items-center animate-pulse focus:outline-none">
                                    <span class="mr-1.5 text-sm">🔴</span> <span>${escapeHTML(btnText)}</span>
                                </button>
                            </div>
                        `;
                    }
                    
                    errorMsg = `
                        <div class="text-left space-y-2 mt-2">
                            <p>A physical connection exists, but service is currently halted due to an active incident.</p>
                            <ul class="list-disc pl-5 space-y-1 text-xs">
                                <li>Check the <strong>Network Map</strong> to visualize active lines and severed segments.</li>
                                <li>Refer to the Service Alerts tab for more details.</li>
                            </ul>
                        </div>
                        ${suspensionAlertHtml}
                    `;
                    break;
                case 'ERR_TIMETABLE_MISMATCH':
                    errorTitle = "Extreme Schedule Gaps";
                    
                    let incidentNoteHtml = '';
                    if (errorPayload && errorPayload.hasIncident) {
                        const btnText = errorPayload.buttonText || "Line Severed";
                        incidentNoteHtml = `
                            <div class="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 text-left text-[11px] text-red-800 dark:text-red-300 rounded-r shadow-sm">
                                <b>Note:</b> There is also an active incident on this line:<br>
                                <button type="button" onclick="if(typeof window.openDisruptionModal === 'function') window.openDisruptionModal('${errorPayload.disruptionId}')" class="mt-2 w-full bg-white dark:bg-gray-800 hover:bg-red-100 dark:hover:bg-gray-700 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors shadow-sm focus:outline-none flex justify-center items-center">
                                    <span class="mr-1">🔴</span> ${escapeHTML(btnText)}
                                </button>
                            </div>
                        `;
                    }
                    
                    errorMsg = `
                        <div class="text-left space-y-2 mt-2">
                            <p>A physical path exists, but the connecting trains have layovers exceeding 4 hours.</p>
                            <ul class="list-disc pl-5 space-y-1 text-xs">
                                <li>We couldn't find a viable connection on today's schedule (Max 4-hour layover limit reached).</li>
                                <li>If you know a better way to make this trip, please report it below.</li>
                            </ul>
                        </div>
                        ${incidentNoteHtml}
                    `;
                    showFeedbackBtn = true;
                    break;
                case 'ERR_DISCONNECTED_GRAPH':
                default:
                    errorTitle = "No Physical Connection";
                    errorMsg = `
                        <div class="text-left space-y-2 mt-2">
                            <p>We couldn't find a viable connection on today's schedule.</p>
                            <ul class="list-disc pl-5 space-y-1 text-xs">
                                <li>The stations might be on disconnected corridors or require a layover exceeding 4 hours.</li>
                                <li>Check the <strong>Network Map</strong> to visualize active lines.</li>
                                <li>If a connection does exist, please report it to us below.</li>
                            </ul>
                        </div>
                    `;
                    showFeedbackBtn = true;
                    break;
            }

            let actionBtn = `
                <button onclick="if(navigator.onLine) { window.location.href='/map'; } else { history.pushState({ modal: 'map' }, '', '#map'); if(typeof window.openSmoothModal === 'function') window.openSmoothModal('map-modal'); }" class="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors w-full flex items-center justify-center focus:outline-none">
                    <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
                    Open Network Map
                </button>
            `;

            if (showFeedbackBtn) {
                const cleanO = origin.replace(/ STATION/gi, '').trim();
                const cleanD = dest.replace(/ STATION/gi, '').trim();
                actionBtn += `
                    <button onclick="if(typeof window.openFeedbackForMissingRoute === 'function') window.openFeedbackForMissingRoute('${cleanO.replace(/'/g, "\\'")}', '${cleanD.replace(/'/g, "\\'")}')" class="mt-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-bold py-2 px-4 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors w-full flex items-center justify-center focus:outline-none text-sm">
                        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>
                        Report Missing Route
                    </button>
                `;
            }

            if (resultsContainer) {
                resultsContainer.innerHTML = renderErrorCard(errorTitle, errorMsg, actionBtn);
            }
        }
    }, 100); 
}

export function renderSelectedTrip(container, index) {
    window._plannerCurrentTripIndex = index; // GUARDIAN: Synchronize global state for Custom Dropdowns
    const selectedTrip = currentTripOptions[index];
    if (!selectedTrip) return; 

    const isTomorrow = selectedTrip.dayLabel !== undefined;
    const midnightRollover = PlannerRenderer.isMidnightRollover();

    const effectivelyTomorrow = isTomorrow || midnightRollover;

    if (currentPlannerStatus === 'ALL_DEPARTED') {
        renderAllDepartedResult(container, currentTripOptions, index);
    } else if (currentPlannerStatus === 'PARTIAL_JOURNEY') {
        renderTripResult(container, currentTripOptions, index, true);
    } else if (effectivelyTomorrow) {
        // GUARDIAN PHASE 13: Distinct handling for Mathematically Impossible routes vs simply missing the last train
        if (currentPlannerStatus === 'SUNDAY_ROLLOVER') {
            renderSundayRolloverResult(container, currentTripOptions, index);
        } else if (currentPlannerStatus === 'IMPOSSIBLE_TODAY') {
            renderImpossibleTodayResult(container, currentTripOptions, index);
        } else {
            renderNoMoreTrainsResult(container, currentTripOptions, index, "No more trains today");
        }
    } else {
        renderTripResult(container, currentTripOptions, index);
    }
}

export function startPlannerPulse(currentIndex) {
    if (plannerPulse) clearInterval(plannerPulse);
    if (selectedPlannerDay && selectedPlannerDay !== getCurrentDayType()) return;

    let trackedIndex = currentIndex;
    plannerPulse = setInterval(() => {
        const trip = currentTripOptions[trackedIndex];
        if (!trip) return;
        if (typeof window !== 'undefined' && typeof window._plannerCurrentTripIndex !== 'undefined') trackedIndex = window._plannerCurrentTripIndex;
        renderSelectedTrip(document.getElementById('planner-results-list'), trackedIndex);
    }, 30000); 
}

if (typeof window !== 'undefined') {
    window.selectPlannerTrip = selectPlannerTrip;
    window.togglePlannerStops = togglePlannerStops;
    window.shareCurrentGrid = shareCurrentGrid;
    window.executeManualRollover = executeManualRollover;
    window.swapPlannerResults = swapPlannerResults;
    window.openFeedbackForMissingRoute = openFeedbackForMissingRoute;
    window.restorePlannerSearch = restorePlannerSearch;
    window.openDisruptionModal = openDisruptionModal;
    window.extractTripCoordinates = extractTripCoordinates;
    window.hidePlannerResults = hidePlannerResults;
    window._toggleCustomTimeDropdown = toggleCustomTimeDropdown;
    window._selectCustomTrip = selectCustomTrip;
    window._toggleMainDayDropdown = toggleMainDayDropdown;
    window._selectMainDay = selectMainDay;
    window._toggleHeaderDayDropdown = toggleHeaderDayDropdown;
    window._selectHeaderDay = selectHeaderDay;
    window.openTripMapRenderer = openTripMapRenderer;
}

export function selectPlannerTrip(index) {
    const idx = parseInt(index, 10);
    if (!currentTripOptions || !currentTripOptions[idx]) return;
    
    if (typeof trackAnalyticsEvent === 'function') {
        const trip = currentTripOptions[idx];
        trackAnalyticsEvent('planner_trip_select', { 
            train: trip.train, 
            time: trip.depTime,
            type: trip.type
        });
    }

    plannerExpandedState.clear();
    renderSelectedTrip(document.getElementById('planner-results-list'), idx);
    startPlannerPulse(idx);
}

export function togglePlannerStops(id) {
    const el = document.getElementById(id);
    const btn = document.getElementById(`btn-${id}`);
    if (!el) return;

    el.classList.toggle('hidden');
    const isHidden = el.classList.contains('hidden');

    if (isHidden) plannerExpandedState.delete(id);
    else plannerExpandedState.add(id);

    if (btn) btn.textContent = isHidden ? "Show All Stops" : "Hide Stops";
}

export async function shareCurrentGrid() {
    if (typeof triggerHaptic === 'function') triggerHaptic(); 
    
    const handleCopySuccess = () => {
        if (typeof window !== 'undefined' && window.showToast) {
            window.showToast('Schedule link copied to clipboard!', 'success');
        } else {
            console.log('Schedule link copied to clipboard!');
        }
    };

    const shareUrl = `https://nexttrain.co.za/?action=route&route=${$currentRouteId.get()}&view=grid`;
    const shareText = `Check out the schedule!`;
    const data = { title: 'Next Train Schedule', text: shareText, url: shareUrl };
    
    try {
        if (navigator.share) await navigator.share(data);
        else {
            const textArea = document.createElement('textarea');
            textArea.value = shareUrl;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            handleCopySuccess();
        }
    } catch (e) {}
}

export function executeManualRollover(origin, dest) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    window._forceManualRollover = true;
    executeTripPlan(origin, dest);
}

export function openFeedbackForMissingRoute(origin, dest) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    
    if (typeof openSmoothModal === 'function') {
        openSmoothModal('feedback-modal');
    } else {
        const modal = document.getElementById('feedback-modal');
        if (modal) modal.classList.remove('hidden');
    }

    setTimeout(() => {
        const msgBox = document.getElementById('feedback-text') || document.querySelector('#feedback-modal textarea');
        if (msgBox instanceof HTMLTextAreaElement) {
            const contextStr = `[Failed Route Attempt: ${origin} to ${dest}]\n\nHello, I usually make this trip by...`;
            msgBox.value = contextStr;
            msgBox.focus();
        }
    }, 350); 
}

export function restorePlannerSearch(fullFrom, fullTo) {
    const fromSelect = document.getElementById('planner-from');
    const toSelect = document.getElementById('planner-to');
    const fromInput = document.getElementById('planner-from-search');
    const toInput = document.getElementById('planner-to-search');
    
    if (fromSelect && toSelect) {
        fromSelect.value = fullFrom;
        toSelect.value = fullTo;
        if (fromInput) {
            fromInput.value = fullFrom.replace(' STATION', '');
            fromInput.dataset.resolvedValue = fullFrom;
        }
        if (toInput) {
            toInput.value = fullTo.replace(' STATION', '');
            toInput.dataset.resolvedValue = fullTo;
        }
        
        if (!selectedPlannerDay) {
            selectedPlannerDay = getCurrentDayType();
        }

        if (typeof showToast === 'function') showToast("Restored recent search", "info", 1000);
        
        if (typeof trackAnalyticsEvent === 'function') {
            trackAnalyticsEvent('planner_history_restore', { origin: fullFrom, destination: fullTo });
        }

        savePlannerHistory(fullFrom, fullTo);
        executeTripPlan(fullFrom, fullTo);
    }
}

export function swapPlannerResults() {
    if (typeof triggerHaptic === 'function') triggerHaptic();

    const fromInput = document.getElementById('planner-from-search');
    const toInput = document.getElementById('planner-to-search');
    const fromSelect = document.getElementById('planner-from');
    const toSelect = document.getElementById('planner-to');

    if (!fromInput || !toInput) return;

    let preferredTime = null;
    if (typeof window._plannerCurrentTripIndex !== 'undefined' && typeof currentTripOptions !== 'undefined' && currentTripOptions.length > 0) {
        const selectedIdx = window._plannerCurrentTripIndex;
        if (currentTripOptions[selectedIdx]) {
            preferredTime = currentTripOptions[selectedIdx].depTime;
        }
    }

    const tempFromText = fromInput.value;
    const tempFromResolved = fromInput.dataset.resolvedValue;
    
    fromInput.value = toInput.value;
    toInput.value = tempFromText;

    if (toInput.dataset.resolvedValue) {
        fromInput.dataset.resolvedValue = toInput.dataset.resolvedValue;
    } else {
        delete fromInput.dataset.resolvedValue;
    }
    
    if (tempFromResolved) {
        toInput.dataset.resolvedValue = tempFromResolved;
    } else {
        delete toInput.dataset.resolvedValue;
    }

    const resolveStation = (inputEl) => {
        if (!inputEl) return "";
        if (inputEl.dataset.resolvedValue) return inputEl.dataset.resolvedValue; 
        
        const inputVal = inputEl.value;
        const masterList = getMasterStationList();
        if (!inputVal || !masterList || masterList.length === 0) return "";

        const cleanInput = inputVal.trim().replace(/\s+/g, ' ').toUpperCase();
        const exact = masterList.find(s => s.replace(' STATION', '').trim().toUpperCase() === cleanInput);
        if (exact) {
            inputEl.dataset.resolvedValue = exact;
            return exact;
        }

        const matches = masterList.filter(s => s.replace(' STATION', '').trim().toUpperCase().includes(cleanInput));
        if (matches.length === 1) {
            inputEl.dataset.resolvedValue = matches[0];
            return matches[0];
        }
        
        return "";
    };

    const resolvedFrom = resolveStation(fromInput);
    const resolvedTo = resolveStation(toInput);

    if (resolvedFrom) {
        fromInput.dataset.resolvedValue = resolvedFrom;
        if (fromSelect) {
            if (!fromSelect.querySelector(`option[value="${resolvedFrom}"]`)) fromSelect.appendChild(new Option(resolvedFrom, resolvedFrom));
            fromSelect.value = resolvedFrom;
        }
    } else {
        if (fromSelect) fromSelect.value = "";
    }

    if (resolvedTo) {
        toInput.dataset.resolvedValue = resolvedTo;
        if (toSelect) {
            if (!toSelect.querySelector(`option[value="${resolvedTo}"]`)) toSelect.appendChild(new Option(resolvedTo, resolvedTo));
            toSelect.value = resolvedTo;
        }
    } else {
        if (toSelect) toSelect.value = "";
    }

    const resultsSection = document.getElementById('planner-results-section');
    const isOnResultsScreen = resultsSection && !resultsSection.classList.contains('hidden');

    if (!resolvedFrom || !resolvedTo) {
        if (typeof showToast === 'function') showToast("Stations swapped. Please clarify names.", "warning");
        if (isOnResultsScreen) {
            hidePlannerResults();
        } else {
            if (fromSelect) fromSelect.dispatchEvent(new Event('change'));
            if (fromInput) fromInput.dispatchEvent(new Event('change'));
        }
        return; 
    }

    if (isOnResultsScreen) {
        if (typeof showToast === 'function') showToast("Reversing Direction...", "info", 1000);
        executeTripPlan(resolvedFrom, resolvedTo, preferredTime);
    } else {
        if (fromSelect) fromSelect.dispatchEvent(new Event('change'));
        if (fromInput) fromInput.dispatchEvent(new Event('change'));
    }
}

export function getPlanningDayLabel() {
    const day = selectedPlannerDay || getCurrentDayType();
    if (day === 'sunday') return "Sunday";
    if (day === 'saturday') return "Saturday / Public Holiday Schedule";
    return "Weekday Schedule";
}

export function updatePlannerHeader(dayLabel, showShare = true) {
    const headerTitle = document.querySelector('#planner-results-section h4');
    const spacer = document.querySelector('#planner-results-section .w-8, #planner-results-section .planner-share-slot'); 
    
    if (headerTitle) {
        headerTitle.innerHTML = "";
        headerTitle.className = "flex-1 w-0 flex justify-center mx-1"; 
        
        const badge = document.createElement("div");
        badge.id = "planner-header-badge";
        badge.className = "relative bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-800 dark:text-blue-300 text-xs font-bold rounded-lg border border-blue-100 dark:border-blue-800 shadow-sm flex items-center transition-colors w-full max-w-[150px] cursor-pointer group h-[38px]"; 
        
        let selDay = selectedPlannerDay || getCurrentDayType();
        let selText = selDay === 'weekday' ? 'Mon - Fri' : (selDay === 'saturday' ? 'Saturday / Hol' : 'Sunday');

        badge.innerHTML = `
            <div onclick="if(typeof window._toggleHeaderDayDropdown === 'function') window._toggleHeaderDayDropdown(event)" class="w-full h-full flex items-center justify-center px-3 relative">
                <span id="header-day-display" class="truncate font-bold text-[12px] pr-1.5">${selText}</span>
                <svg id="header-day-chevron" class="w-4 h-4 shrink-0 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                
                <ul id="header-day-list" class="absolute top-full left-0 mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl hidden flex-col overflow-hidden z-[200] text-left">
                    <li onclick="if(typeof window._selectHeaderDay === 'function') window._selectHeaderDay(event, 'weekday', 'Mon - Fri')" class="px-4 py-3 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selDay === 'weekday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Mon - Fri</li>
                    <li onclick="if(typeof window._selectHeaderDay === 'function') window._selectHeaderDay(event, 'saturday', 'Saturday / Hol')" class="px-4 py-3 text-xs font-bold border-t border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selDay === 'saturday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Saturday / Hol</li>
                    <li onclick="if(typeof window._selectHeaderDay === 'function') window._selectHeaderDay(event, 'sunday', 'Sunday')" class="px-4 py-3 text-xs font-bold border-t border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selDay === 'sunday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Sunday</li>
                </ul>
            </div>
        `;
        
        headerTitle.appendChild(badge);
        headerTitle.classList.remove('hidden');
    }

    if (spacer) {
        spacer.innerHTML = ""; 
        if (spacer instanceof HTMLElement) spacer.style.display = 'block'; 
        
        if (showShare) {
            spacer.className = "flex-none planner-share-slot"; 
            const shareBtn = document.createElement("button");
            shareBtn.className = "flex items-center text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors group flex-none whitespace-nowrap shadow-sm border border-blue-100 dark:border-blue-800 focus:outline-none";
            shareBtn.title = "Share Trip Plan";
            
            shareBtn.onclick = async () => {
                if (typeof triggerHaptic === 'function') triggerHaptic(); 
                
                const idx = typeof window !== 'undefined' && typeof window._plannerCurrentTripIndex !== 'undefined' ? window._plannerCurrentTripIndex : 0;
                const selectedTrip = currentTripOptions[idx] || currentTripOptions[0];
                let selectedTime = null;
                let fromStation = "";
                let toStation = "";
                
                if (selectedTrip) {
                     selectedTime = selectedTrip.depTime;
                     fromStation = (selectedTrip.from || "").replace(/ STATION/gi, '').trim();
                     toStation = (selectedTrip.to || "").replace(/ STATION/gi, '').trim();
                } else {
                     const fromSearchInput = document.getElementById('planner-from-search');
                     const toSearchInput = document.getElementById('planner-to-search');
                     fromStation = fromSearchInput ? fromSearchInput.value : "";
                     toStation = toSearchInput ? toSearchInput.value : "";
                }
                
                const safeTime = (selectedTime || "").trim();
                const safeDay = (selectedPlannerDay || "").trim();
                const safeRegion = $userRegion.get() || 'GP';
                
                const params = new URLSearchParams({
                    action: 'planner',
                    from: fromStation,
                    to: toStation,
                    time: safeTime,
                    day: safeDay,
                    region: safeRegion 
                });
                
                const shareLink = `https://nexttrain.co.za/?${params.toString()}`;
                const shareText = `Trip Plan: ${fromStation} to ${toStation}.`;

                const data = { title: 'Next Train Trip Plan', text: shareText, url: shareLink };
                
                const handleCopySuccess = () => {
                    if (typeof window !== 'undefined' && window.showToast) {
                        window.showToast('Link copied to clipboard!', 'success');
                    } else {
                        console.log('Link copied to clipboard!');
                    }
                };

                try { 
                    if (navigator.share) await navigator.share(data); 
                    else {
                        const textArea = document.createElement('textarea');
                        textArea.value = `${shareText} Check details here: ${shareLink}`;
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                        handleCopySuccess();
                    }
                } catch(e) {}
            };
            
            shareBtn.innerHTML = `
                Share Trip
                <svg class="w-4 h-4 ml-1.5 transform transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
            `;
            
            spacer.appendChild(shareBtn);
        } else {
            spacer.className = "flex-none planner-share-slot invisible w-24";
            spacer.innerHTML = `<div></div>`;
        }
    }
}

export function renderTripResult(container, trips, selectedIndex = 0, isPartial = false) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return; 

    const dayLabel = getPlanningDayLabel();
    
    updatePlannerHeader(dayLabel, true);

    let partialWarningHtml = "";
        if (isPartial && currentPlannerErrorPayload) {
            const intended = currentPlannerErrorPayload.intendedDest || "Destination";
            const partial = currentPlannerErrorPayload.partialDest || selectedTrip.to;
            // 🛡️ GUARDIAN UX FIX: Replaced vibe-coded emoji with premium SVG and stripped right-margin
            const alertSvg = `<svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
            partialWarningHtml = `
                <div class="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 p-3 mb-4 rounded-r shadow-sm animate-fade-in-up">
                    <div class="flex justify-between items-start w-full">
                        <div class="flex-1 min-w-0 pr-3">
                            <h4 class="text-xs font-black text-red-800 dark:text-red-400 uppercase tracking-widest mb-0.5">Line Severed</h4>
                            <p class="text-xs text-red-700 dark:text-red-300 leading-snug">
                                Cannot reach <b>${intended}</b>.<br>Showing trains terminating at <b>${partial}</b>.
                            </p>
                        </div>
                        <div class="shrink-0 scale-125 origin-top-right">
                            ${alertSvg}
                        </div>
                    </div>
                </div>
            `;
        }

    container.innerHTML = partialWarningHtml + PlannerRenderer.buildCard(selectedTrip, false, trips, selectedIndex)
        + '<div id="planner-crowd-delay-slot"></div>';
    injectPlannerCrowdDelay(selectedTrip);
}

export function renderAllDepartedResult(container, trips, selectedIndex = 0) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return;

    const dayLabel = getPlanningDayLabel();
    updatePlannerHeader(dayLabel, true);

    const origin = (selectedTrip.from || "").replace(/ STATION/gi, '').trim();
    const dest = (selectedTrip.to || "").replace(/ STATION/gi, '').trim();

    container.innerHTML = `
        <div class="bg-transparent border-b-4 border-gray-200 dark:border-gray-800 pb-6 mb-6 text-left animate-fade-in-up">
            <div class="flex justify-between items-start w-full mb-3">
                <div class="flex-1 min-w-0 pr-3">
                    <h3 class="font-black text-gray-800 dark:text-gray-200 text-lg tracking-tight">All Trains Departed</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-snug">There are no more scheduled trains for today. You can review past trips below, or check the next available schedule.</p>
                </div>
                <div class="shrink-0">
                    <span class="text-3xl">🌙</span>
                </div>
            </div>
            <button onclick="executeManualRollover('${origin.replace(/'/g, "\\'")}', '${dest.replace(/'/g, "\\'")}')" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3.5 px-4 rounded-xl shadow-md transition-colors focus:outline-none flex items-center justify-center uppercase tracking-wide text-xs mt-4">
                See Next Available Day
                <svg class="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
            </button>
        </div>
        ${PlannerRenderer.buildCard(selectedTrip, false, trips, selectedIndex)}
        <div id="planner-crowd-delay-slot"></div>
    `;
    injectPlannerCrowdDelay(selectedTrip);
}

export function renderNoMoreTrainsResult(container, trips, selectedIndex = 0, title = "No more trains today") {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return; 

    const dayLabel = getPlanningDayLabel();
    
    updatePlannerHeader(dayLabel, true);
    
    // GUARDIAN Phase 5: Typography Line Breaks Injected
    let explanationText = `Showing trains for <b>${selectedTrip.dayLabel || 'Tomorrow'}</b>.`;
    if (selectedTrip.dayOffset > 1) {
        explanationText = `No valid connections found for tomorrow.<br>Showing trains for <b>${selectedTrip.dayLabel}</b>.`;
    }

    container.innerHTML = `
        <div class="bg-transparent border-b-4 border-orange-200 dark:border-orange-800/50 pb-6 mb-6 text-left">
            <div class="flex justify-between items-start w-full mb-3">
                <div class="flex-1 min-w-0 pr-3">
                    <h3 class="font-bold text-orange-800 dark:text-orange-200 text-lg">${title}</h3>
                    <p class="text-xs text-orange-700 dark:text-orange-300 mt-1 leading-snug">${explanationText}</p>
                </div>
                <div class="shrink-0">
                    <span class="text-2xl">🚫</span>
                </div>
            </div>
        </div>
        ${PlannerRenderer.buildCard(selectedTrip, true, trips, selectedIndex)}
        <div id="planner-crowd-delay-slot"></div>
    `;
    injectPlannerCrowdDelay(selectedTrip);
}

export function renderSundayRolloverResult(container, trips, selectedIndex = 0) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return;

    const dayLabel = getPlanningDayLabel();
    updatePlannerHeader(dayLabel, true);
    
    // GUARDIAN Phase 5: Typography Line Breaks Injected
    let explanationText = `Metrorail does not operate on Sundays.<br>`;
    if (selectedTrip.dayOffset > 1) {
        explanationText += `No valid connections were found for tomorrow.<br>`;
    }
    explanationText += `Showing the next available option for <b>${selectedTrip.dayLabel || 'Tomorrow'}</b>.`;

    container.innerHTML = `
        <div class="bg-transparent border-b-4 border-indigo-200 dark:border-indigo-800/50 pb-6 mb-6 text-left">
            <div class="flex justify-between items-start w-full mb-3">
                <div class="flex-1 min-w-0 pr-3">
                    <h3 class="font-bold text-indigo-900 dark:text-indigo-300 text-lg">No Sunday Service</h3>
                    <p class="text-xs text-indigo-700 dark:text-indigo-400 mt-1 leading-snug">${explanationText}</p>
                </div>
                <div class="shrink-0 w-8 h-8 bg-indigo-100 dark:bg-indigo-800/50 rounded-full flex items-center justify-center mt-0.5">
                    <span class="text-base">📅</span>
                </div>
            </div>
        </div>
        ${PlannerRenderer.buildCard(selectedTrip, true, trips, selectedIndex)}
        <div id="planner-crowd-delay-slot"></div>
    `;
    injectPlannerCrowdDelay(selectedTrip);
}

export function renderImpossibleTodayResult(container, trips, selectedIndex = 0) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return;

    const dayLabel = getPlanningDayLabel();
    updatePlannerHeader(dayLabel, true);
    
    // GUARDIAN Phase 5: Typography Line Breaks Injected
    let explanationText = `Today's limited schedule does not support this exact route.<br>`;
    if (selectedTrip.dayOffset > 1) {
        explanationText += `No valid connections were found for tomorrow.<br>`;
    }
    explanationText += `Showing the next available option for <b>${selectedTrip.dayLabel || 'Tomorrow'}</b>.`;

    container.innerHTML = `
        <div class="bg-transparent border-b-4 border-gray-200 dark:border-gray-800 pb-6 mb-6 text-left">
            <div class="flex justify-between items-start w-full mb-3">
                <div class="flex-1 min-w-0 pr-3">
                    <h3 class="font-bold text-gray-900 dark:text-white text-lg">Route Unavailable Today</h3>
                    <p class="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-snug">${explanationText}</p>
                </div>
                <div class="shrink-0 w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mt-0.5 shadow-sm border border-gray-200 dark:border-gray-700">
                    <span class="text-base">📅</span>
                </div>
            </div>
        </div>
        ${PlannerRenderer.buildCard(selectedTrip, true, trips, selectedIndex)}
        <div id="planner-crowd-delay-slot"></div>
    `;
    injectPlannerCrowdDelay(selectedTrip);
}

export function renderErrorCard(title, message, actionHtml = "") {
    const errorAlertSvg = `<svg class="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    return `
        <div class="bg-transparent border-b-4 border-yellow-200 dark:border-yellow-800/50 pb-6 mb-4 text-left">
            <div class="flex justify-between items-start w-full mb-3">
                <div class="flex-1 min-w-0 pr-3">
                    <h3 class="font-black text-yellow-800 dark:text-yellow-400 text-xl">${title}</h3>
                </div>
                <div class="shrink-0">
                    ${errorAlertSvg}
                </div>
            </div>
            <div class="text-sm text-gray-700 dark:text-gray-300 pt-2">
                ${message}
            </div>
            <div class="mt-5">
                ${actionHtml}
            </div>
        </div>
    `;
}