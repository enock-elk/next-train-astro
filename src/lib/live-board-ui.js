/**
 * LIVE BOARD UI ORCHESTRATION (Phase 2)
 * Thin controller bridging DOM ↔ live-board.js engine ↔ Renderer
 */
import { ROUTES, FARE_CONFIG } from './config.js';
import { normalizeStationName, timeToSeconds, safeStorage, escapeHTML, formatTimeDisplay } from './utils.js';
import { $currentRouteId, $userRegion, $userProfile, $fullDatabase, $schedules } from '../store.js';
import { currentTime, loadAllSchedules } from './logic.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';
import {
    simulateNextActiveService,
    getAllStations,
    getRouteFare,
    getDetailedFare,
    populateStationList,
    findNextTrains,
    updateLastUpdatedText,
    attachLiveBoardGlobals,
    startSmartRefresh,
    findNextJourneyToDestA,
    findNextJourneyToDestB,
    currentScheduleData
} from './live-board.js';
import {
    renderFullScheduleGrid,
    applyRouteDeepLink,
    parseRouteDeepLink,
    attachTimetableGridGlobals
} from './timetable-grid.js';

export { renderFullScheduleGrid, applyRouteDeepLink, parseRouteDeepLink };

const getCurrentTime = () => (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : currentTime;

export function getRoutesForCurrentRegion() {
    const regionalRoutes = {};
    const region = $userRegion.get() || 'GP';
    for (const key in ROUTES) {
        if (ROUTES[key].region === region) regionalRoutes[key] = ROUTES[key];
    }
    return regionalRoutes;
}

export function _renderNextTrainList() {
    const input = document.getElementById('station-search-input');
    const select = document.getElementById('station-select');
    const list = document.getElementById('next-train-autocomplete-list');
    if (!input || !select || !list) return;

    list.innerHTML = '';
    const matches = getAllStations();

    if (matches.length === 0) {
        const li = document.createElement('li');
        if (!$fullDatabase.get()) {
            li.className = "p-4 text-sm text-blue-600 dark:text-blue-400 font-bold flex items-center justify-center bg-blue-50 dark:bg-blue-900/20";
            li.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Loading stations... please wait`;
        } else {
            li.className = "p-4 text-sm text-gray-400 italic text-center";
            li.textContent = "No stations on this route";
        }
        list.appendChild(li);
    } else {
        matches.forEach(station => {
            const li = document.createElement('li');
            li.className = "p-3.5 border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-base sm:text-lg font-medium text-gray-700 dark:text-gray-200 transition-colors";
            li.textContent = station.replace(' STATION', '');
            li.onclick = () => {
                input.value = station.replace(' STATION', '');
                select.value = station;
                select.dispatchEvent(new Event('change'));
                list.classList.add('hidden');
            };
            list.appendChild(li);
        });
    }
    list.classList.remove('hidden');
}

export function setupNextTrainAutocomplete() {
    const input = document.getElementById('station-search-input');
    const select = document.getElementById('station-select');
    if (!input || !select) return;

    select.classList.add('hidden');
    input.classList.remove('hidden');
    if (input.parentNode && getComputedStyle(input.parentNode).position === 'static') {
        input.parentNode.style.position = 'relative';
    }

    let list = document.getElementById('next-train-autocomplete-list');
    if (!list && input.parentNode) {
        list = document.createElement('ul');
        list.id = 'next-train-autocomplete-list';
        list.className = "absolute z-50 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-b-lg shadow-xl max-h-60 overflow-y-auto hidden mt-1 left-0 custom-scrollbar text-left";
        input.parentNode.appendChild(list);
    }

    const chevron = document.getElementById('next-train-chevron');
    const fieldWrap = document.getElementById('station-field-wrap') || input.closest('.relative') || input.parentElement;
    const toggle = (e) => {
        if (e) e.stopPropagation();
        if (!list) return;
        if (list.classList.contains('hidden')) _renderNextTrainList();
        else list.classList.add('hidden');
    };

    if (!input.dataset.acBound) {
        input.dataset.acBound = '1';
        input.addEventListener('click', toggle);
        if (chevron) chevron.addEventListener('click', toggle);
        // Wider hit target: empty padding / wrapper around the field also opens the list.
        // The list is rendered *inside* this wrapper, so clicks on an option must be
        // ignored here — otherwise selecting a station closes the list and this
        // handler immediately toggles it back open.
        fieldWrap?.addEventListener('click', (e) => {
            if (list?.contains(e.target)) return;
            if (e.target.closest('#locate-btn')) return;
            if (e.target === input || e.target === chevron || chevron?.contains(e.target)) return;
            toggle(e);
        });
        document.addEventListener('click', (e) => {
            if (!list || list.classList.contains('hidden')) return;
            if (!fieldWrap?.contains(e.target) && !list.contains(e.target)) {
                list.classList.add('hidden');
            }
        });
    }
}

export function renderNoService(element, destination) {
    if (!element || !window.Renderer) return;
    const routeId = $currentRouteId.get();
    if (!routeId || !ROUTES[routeId]) return;
    const selectedStation = document.getElementById('station-select')?.value || "";
    const simResult = simulateNextActiveService(selectedStation, destination);
    window.Renderer.renderNoService(element, destination, simResult?.train || null, simResult?.daysAhead || 1);
}

export function renderNextAvailableTrain(element, destination) {
    if (!element || !window.Renderer) return;
    const selectedStation = document.getElementById('station-select')?.value || "";
    const simResult = simulateNextActiveService(selectedStation, destination);
    if (!simResult) {
        element.innerHTML = `<div class="min-h-[96px] flex flex-col justify-center items-center text-lg font-bold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800/50 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">No upcoming trains.</div>`;
        return;
    }
    window.Renderer.renderNextAvailableTrain(element, destination, simResult.train, simResult.dayInfo.name, simResult.dayInfo.type, simResult.daysAhead);
}

export function processAndRenderJourney(allJourneys, element, _header, destination) {
    if (!element || !Array.isArray(allJourneys)) return;
    if (destination) currentScheduleData[destination] = allJourneys;
    const nowInSeconds = timeToSeconds(getCurrentTime() || '00:00:00');
    const remaining = allJourneys.filter(j => timeToSeconds(j.departureTime || j.train1.departureTime) >= nowInSeconds);
    const nextJourney = remaining[0] || null;
    const firstTrainName = allJourneys.length > 0 ? (allJourneys[0].train || allJourneys[0].train1.train) : null;

    if (nextJourney && window.Renderer) {
        const journeyTrainName = nextJourney.train || nextJourney.train1.train;
        nextJourney.isFirstTrain = (journeyTrainName === firstTrainName);
        const remainingNames = new Set(remaining.map(j => j.train || j.train1.train));
        nextJourney.isLastTrain = (remainingNames.size === 1);
        window.Renderer.renderJourney(element, nextJourney, destination);
        import('./delay-reports.js').then((m) => m.hydrateTrainReportSlots(element)).catch(() => {});
    } else if (allJourneys.length === 0) {
        element.innerHTML = `<div class="min-h-[96px] flex flex-col justify-center items-center text-lg font-bold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800/50 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">No scheduled trains.</div>`;
    } else {
        renderNextAvailableTrain(element, destination);
    }
}

export function updateFareDisplay(sheetKey) {
    const fareContainer = document.getElementById('fare-container');
    const passengerLabel = document.getElementById('passenger-type-label');
    const fareAmount = document.getElementById('fare-amount');
    const fareType = document.getElementById('fare-type');
    if (!fareContainer) return;

    const profile = $userProfile.get() || 'Adult';
    if (passengerLabel) passengerLabel.textContent = profile;

    const fareData = getRouteFare(sheetKey);

    fareContainer.className = "w-full text-left px-3.5 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm flex items-center gap-3 focus:outline-none transition-colors group min-h-[52px]";

    const chevron = document.getElementById('fare-chevron');
    fareContainer.onclick = () => {
        const live = getDetailedFare(sheetKey) || getDetailedFare(null);
        if (live?.prices) openFareModal(live);
    };
    fareContainer.classList.add('cursor-pointer', 'hover:border-blue-300', 'dark:hover:border-blue-700');
    fareContainer.setAttribute('aria-label', `${profile} fare details`);
    if (chevron) chevron.classList.remove('opacity-0');

    if (fareData) {
        fareContainer.classList.remove('hidden');
        if (fareAmount) {
            fareAmount.textContent = `R${fareData.price}`;
            fareAmount.className = "text-xl font-black text-gray-900 dark:text-white tabular-nums leading-none";
        }
        if (fareType) {
            fareType.classList.remove('hidden');
            if (fareData.isPromo) {
                fareType.textContent = fareData.discountLabel || 'Discounted';
                fareType.className = "text-[11px] font-medium text-purple-600 dark:text-purple-300 truncate mt-0.5";
            } else if (fareData.isOffPeak) {
                fareType.textContent = 'Off-peak until 14:30';
                fareType.className = "text-[11px] font-medium text-green-600 dark:text-green-300 truncate mt-0.5";
            } else {
                fareType.textContent = 'Standard · may vary';
                fareType.className = "text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate mt-0.5";
            }
        }
    } else {
        if (fareAmount) {
            fareAmount.textContent = "R--.--";
            fareAmount.className = "text-xl font-black text-gray-300 dark:text-gray-600 tabular-nums leading-none";
        }
        if (fareType) fareType.className = "hidden";
    }

    fareContainer.classList.remove('hidden');
}

export function openFareModal(fareDetails) {
    triggerHaptic();
    if (!fareDetails) return;

    let modal = document.getElementById('fare-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fare-modal';
        modal.className = 'fixed inset-0 bg-black/80 z-[140] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col transform transition-transform duration-300 scale-95 max-h-[85vh]">
                <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900 rounded-t-2xl shrink-0">
                    <h3 class="text-lg font-bold text-gray-900 dark:text-white flex flex-col items-start justify-center" id="fare-zone-badge">Ticket Prices</h3>
                    <button onclick="closeSmoothModal('fare-modal')" class="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition focus:outline-none" aria-label="Close">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-6 overflow-y-auto flex-grow text-gray-700 dark:text-gray-300">
                    <div id="fare-table-content" class="space-y-0"></div>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 text-center mt-6">Prices are subject to change. Confirm at station.</p>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 text-center mt-1">Off-Peak Fares apply weekdays between 09:30 and 14:30.</p>
                </div>
                <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-2xl shrink-0">
                    <button onclick="closeSmoothModal('fare-modal')" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors focus:outline-none">Close</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    const routeId = $currentRouteId.get();
    const routeName = routeId && ROUTES[routeId] ? ROUTES[routeId].name.replace('<->', '↔') : '';
    const zoneEl = document.getElementById('fare-zone-badge');
    if (zoneEl) {
        zoneEl.innerHTML = `
            <div class="flex items-center">Ticket Prices <span class="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 ml-2 px-2 py-0.5 rounded-full uppercase tracking-widest">Zone ${fareDetails.code}</span></div>
            ${routeName ? `<span class="text-xs text-gray-500 dark:text-gray-400 font-medium mt-0.5">${routeName}</span>` : ''}`;
    }

    const tableEl = document.getElementById('fare-table-content');
    if (tableEl && fareDetails.prices) {
        const profile = FARE_CONFIG.profiles[$userProfile.get() || 'Adult'] || FARE_CONFIG.profiles.Adult;
        const prices = fareDetails.prices;
        const calc = (base) => (Math.ceil((base * profile.base) * 2) / 2).toFixed(2);
        tableEl.innerHTML = `
            <div class="flex justify-between items-center py-3 border-b border-dashed border-gray-300 dark:border-gray-600"><span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Single Trip</span><span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.single)}</span></div>
            <div class="flex justify-between items-center py-3 border-b border-dashed border-gray-300 dark:border-gray-600"><span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Return Trip</span><span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.return)}</span></div>
            <div class="flex justify-between items-center py-3 border-b border-dashed border-gray-300 dark:border-gray-600"><span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Weekly <span class="opacity-70 font-normal">(Mon-Fri)</span></span><span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.weekly_mon_fri)}</span></div>
            <div class="flex justify-between items-center py-3 border-b border-dashed border-gray-300 dark:border-gray-600"><span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Weekly <span class="opacity-70 font-normal">(Mon-Sat)</span></span><span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.weekly_mon_sat)}</span></div>
            <div class="flex justify-between items-center py-3"><span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Monthly Pass</span><span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.monthly)}</span></div>`;
    }

    openSmoothModal('fare-modal');
}

export function updatePinUI() {
    const routeId = $currentRouteId.get();
    const region = $userRegion.get() || 'GP';
    const pinned = safeStorage.getItem('defaultRoute_' + region) === routeId;
    document.getElementById('pin-outline')?.classList.toggle('hidden', pinned);
    document.getElementById('pin-filled')?.classList.toggle('hidden', !pinned);
}

export function selectProfile(profileType) {
    $userProfile.set(profileType);
    safeStorage.setItem('userProfile', profileType);
    closeSmoothModal('profile-modal');
    findNextTrains();
    showToast(`Profile set to ${profileType}`, 'success', 1500);
}

export function loadUserProfile() {
    const saved = safeStorage.getItem('userProfile');
    if (saved) $userProfile.set(saved);
}

function formatRouteLabel(raw) {
    if (typeof raw !== 'string') return 'Select a route';
    return raw.replace(/\s*<->\s*/g, ' – ').replace(/\s*↔\s*/g, ' – ').trim();
}

export function updateNextTrainView() {
    const routeId = $currentRouteId.get();
    const route = routeId ? ROUTES[routeId] : null;
    const label = formatRouteLabel(route?.name || 'Select a route');

    const title = document.getElementById('route-subtitle-text');
    if (title) {
        title.textContent = label;
        title.title = label;
        if (route?.colorClass) {
            title.className = `text-base sm:text-lg font-medium ${route.colorClass} group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate w-full text-center`;
        } else {
            title.className = 'text-base sm:text-lg font-medium text-gray-700 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate w-full text-center';
        }
    }

    const btn = document.getElementById('view-full-timetable-btn');
    if (btn) {
        const active = !!(route && route.isActive);
        btn.disabled = !active;
        btn.classList.toggle('opacity-60', !active);
        btn.classList.toggle('pointer-events-none', !active);
    }
}

export function openScheduleModal(destination, dayOverride = null) {
    triggerHaptic();
    const modalList = document.getElementById('modal-list');
    const modalTitle = document.getElementById('modal-title');
    if (!modalList) return;

    const routeId = $currentRouteId.get();
    const route = routeId ? ROUTES[routeId] : null;
    if (!route) return;

    const stationSelect = document.getElementById('station-select');
    const selectedStation = stationSelect?.value || '';
    let journeys = [];
    let titleSuffix = '';
    let targetDayIdx = (typeof window !== 'undefined' && window.currentDayIndex !== undefined)
        ? window.currentDayIndex
        : new Date().getDay();

    if (dayOverride) {
        let sheetKey = null;
        const simResult = typeof window.simulateNextActiveService === 'function'
            ? window.simulateNextActiveService(selectedStation, destination)
            : null;

        if (simResult && simResult.dayInfo?.type === dayOverride) {
            targetDayIdx = simResult.dayInfo.idx;
            titleSuffix = ` (${simResult.dayInfo.name})`;
        } else if (dayOverride === 'weekday') {
            targetDayIdx = 1;
            titleSuffix = ' (Weekday)';
        } else if (dayOverride === 'saturday') {
            targetDayIdx = 6;
            titleSuffix = ' (Weekend/Holiday)';
        }

        if (dayOverride === 'weekday' || dayOverride === 'sunday') {
            sheetKey = normalizeStationName(destination) === normalizeStationName(route.destA) ? 'weekday_to_a' : 'weekday_to_b';
        } else if (dayOverride === 'saturday') {
            sheetKey = normalizeStationName(destination) === normalizeStationName(route.destA) ? 'saturday_to_a' : 'saturday_to_b';
        }

        const schedule = ($schedules.get() || {})[sheetKey];
        if (schedule && selectedStation) {
            journeys = normalizeStationName(destination) === normalizeStationName(route.destA)
                ? findNextJourneyToDestA(selectedStation, '00:00:00', schedule, route, targetDayIdx).allJourneys
                : findNextJourneyToDestB(selectedStation, '00:00:00', schedule, route, targetDayIdx).allJourneys;
        }
    } else {
        journeys = currentScheduleData?.[destination] || [];
        if ((!journeys || journeys.length === 0) && selectedStation) {
            const dayType = (typeof window !== 'undefined' && window.currentDayType) || 'weekday';
            const sheetKey = dayType === 'weekday'
                ? (normalizeStationName(destination) === normalizeStationName(route.destA) ? 'weekday_to_a' : 'weekday_to_b')
                : (normalizeStationName(destination) === normalizeStationName(route.destA) ? 'saturday_to_a' : 'saturday_to_b');
            const schedule = ($schedules.get() || {})[sheetKey];
            if (schedule) {
                journeys = normalizeStationName(destination) === normalizeStationName(route.destA)
                    ? findNextJourneyToDestA(selectedStation, '00:00:00', schedule, route, targetDayIdx).allJourneys
                    : findNextJourneyToDestB(selectedStation, '00:00:00', schedule, route, targetDayIdx).allJourneys;
            }
        }
    }

    if (!journeys || journeys.length === 0) {
        showToast('No trains found for this schedule.', 'error');
        return;
    }

    const fromStationName = selectedStation
        ? (window.Renderer?._applyUIIntercepts(selectedStation) || selectedStation.replace(/ STATION/gi, ''))
        : 'Upcoming Trains';
    const destLabel = window.Renderer?._applyUIIntercepts(destination) || destination.replace(/ STATION/gi, '');
    if (modalTitle) modalTitle.textContent = `${fromStationName} → ${destLabel}${titleSuffix}`;

    const toTitleCase = (str) => {
        if (!str) return '';
        return String(str).replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    };

    modalList.innerHTML = '';
    const nowSeconds = timeToSeconds(getCurrentTime() || '00:00:00');
    let firstNextTrainFound = false;

    journeys.forEach((j) => {
        const dep = j.departureTime || j.train1?.departureTime;
        const trainName = j.train || j.train1?.train;
        const type = j.type === 'transfer' ? 'Transfer' : 'Direct';
        const depSeconds = timeToSeconds(dep);
        let isPassed = false;
        if (!dayOverride) isPassed = depSeconds < nowSeconds;

        let divClass = 'p-3 rounded shadow-sm flex justify-between items-center transition-opacity duration-300';
        divClass += isPassed
            ? ' bg-gray-50 dark:bg-gray-800 opacity-50 grayscale'
            : ' bg-white dark:bg-gray-700';

        const div = document.createElement('div');
        div.className = divClass;
        if (!isPassed && !firstNextTrainFound && !dayOverride) {
            div.id = 'next-train-marker';
            firstNextTrainFound = true;
        }

        let sharedTag = '';
        if (j.isShared && j.sourceRoute) {
            let rawName = String(j.sourceRoute).replace('Route', '').trim();
            let routeName = rawName;
            if (rawName.includes('<->')) routeName = rawName.split('<->')[1].trim();
            else if (rawName.includes('↔')) routeName = rawName.split('↔')[1].trim();

            if (j.isDivergent) {
                const divDest = window.Renderer?._applyUIIntercepts(j.actualDestName) || j.actualDestName;
                sharedTag = `<span class="text-[9px] font-bold text-red-600 bg-red-100 dark:text-red-300 dark:bg-red-900 px-1.5 py-0.5 rounded uppercase ml-2 border border-red-200 dark:border-red-800">⚠️ To ${escapeHTML(toTitleCase(divDest))}</span>`;
            } else {
                sharedTag = `<span class="text-[9px] font-bold text-purple-600 bg-purple-100 dark:text-purple-300 dark:bg-purple-900 px-1.5 py-0.5 rounded uppercase ml-2">From ${escapeHTML(toTitleCase(routeName))}</span>`;
            }
        }

        const formattedDep = formatTimeDisplay(dep);
        let rightPillHTML = '';
        let isShortTrip = false;
        let shortDestName = '';

        if (j.type === 'direct' && j.actualDestination) {
            const actual = normalizeStationName(j.actualDestination);
            const target = normalizeStationName(destination);
            if (actual !== target) {
                isShortTrip = true;
                shortDestName = toTitleCase(String(j.actualDestination).replace(/ STATION/gi, ''));
            }
        }

        if (sharedTag) {
            rightPillHTML = sharedTag;
        } else if (type === 'Direct') {
            rightPillHTML = isShortTrip
                ? `<span class="text-[10px] font-bold text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-900 px-2 py-0.5 rounded-full uppercase whitespace-nowrap">To ${escapeHTML(shortDestName)}</span>`
                : '<span class="text-[10px] font-bold text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900 px-2 py-0.5 rounded-full uppercase">Direct</span>';
        } else {
            let transferLabel = '';
            if (j.train1?.headboardDestination) {
                transferLabel = `To ${toTitleCase(String(j.train1.headboardDestination).replace(/ STATION/gi, ''))}`;
            } else if (j.train1?.terminationStation) {
                transferLabel = `Transfer @ ${toTitleCase(String(j.train1.terminationStation).replace(/ STATION/gi, ''))}`;
            } else {
                transferLabel = 'Transfer';
            }
            rightPillHTML = `<span class="text-[10px] font-bold text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-900 px-2 py-0.5 rounded-full uppercase text-right leading-tight whitespace-nowrap">${escapeHTML(transferLabel)}</span>`;
        }

        if (j.isLastTrain) {
            rightPillHTML += ' <span class="text-[10px] font-bold text-red-600 bg-red-100 dark:text-red-300 dark:bg-red-900 px-2 py-0.5 rounded-full uppercase border border-red-200 dark:border-red-800 ml-1">LAST TRAIN</span>';
        }

        div.innerHTML = `
            <div>
                <span class="text-lg font-bold text-gray-900 dark:text-white">${escapeHTML(formattedDep)}</span>
                <div class="text-xs text-gray-500 dark:text-gray-400">Train ${escapeHTML(String(trainName || ''))}</div>
            </div>
            <div class="flex flex-col items-end gap-1 text-right shrink-0">
                ${rightPillHTML}
            </div>
        `;
        modalList.appendChild(div);
    });

    openSmoothModal('schedule-modal');

    if (!dayOverride) {
        setTimeout(() => {
            document.getElementById('next-train-marker')?.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 10);
    } else {
        modalList.scrollTop = 0;
    }
}

export function attachLiveBoardUiGlobals() {
    if (typeof window === 'undefined') return;
    attachTimetableGridGlobals();
    window._renderNextTrainList = _renderNextTrainList;
    window.processAndRenderJourney = processAndRenderJourney;
    window.renderNoService = renderNoService;
    window.renderNextAvailableTrain = renderNextAvailableTrain;
    window.updateFareDisplay = updateFareDisplay;
    window.openFareModal = openFareModal;
    window.openScheduleModal = openScheduleModal;
    window.selectProfile = selectProfile;
    window.updatePinUI = updatePinUI;
    window.updateNextTrainView = updateNextTrainView;
}

export function initLiveBoardUi() {
    attachLiveBoardGlobals();
    attachLiveBoardUiGlobals();
    setupNextTrainAutocomplete();
    loadUserProfile();
    updatePinUI();
    updateNextTrainView();

    if (typeof window !== 'undefined' && !window._gridPopstateBound) {
        window._gridPopstateBound = true;
        window.addEventListener('popstate', () => {
            if (location.hash !== '#grid') {
                const modal = document.getElementById('full-schedule-modal');
                if (modal && !modal.classList.contains('hidden')) {
                    closeSmoothModal('full-schedule-modal');
                }
            }
        });
    }

    // Reactive: schedules load → populate stations + refresh board
    $schedules.subscribe((scheds) => {
        if (scheds && Object.keys(scheds).length > 0) {
            populateStationList();
            updateLastUpdatedText();
            findNextTrains();
            updateNextTrainView();
            updatePinUI();
        }
    });

    $currentRouteId.subscribe((routeId) => {
        if (!routeId) return;
        updatePinUI();
        updateNextTrainView();
        // Reload route-specific schedules when route changes after initial boot
        if ($fullDatabase.get()) {
            loadAllSchedules(true).then(() => {
                populateStationList();
                findNextTrains();
                updateNextTrainView();
            });
        }
    });

    const timetableBtn = document.getElementById('view-full-timetable-btn');
    if (timetableBtn && !timetableBtn.dataset.bound) {
        timetableBtn.dataset.bound = '1';
        timetableBtn.addEventListener('click', () => {
            triggerHaptic();
            renderFullScheduleGrid('A');
        });
    }

    const pinBtn = document.getElementById('pin-route-btn');
    if (pinBtn && !pinBtn.dataset.bound) {
        pinBtn.dataset.bound = '1';
        pinBtn.addEventListener('click', () => {
            triggerHaptic();
            const routeId = $currentRouteId.get();
            const region = $userRegion.get() || 'GP';
            if (!routeId) return;
            const key = 'defaultRoute_' + region;
            if (safeStorage.getItem(key) === routeId) {
                safeStorage.removeItem(key);
                showToast('Pin removed', 'success', 1500);
            } else {
                safeStorage.setItem(key, routeId);
                showToast('Route pinned', 'success', 1500);
            }
            updatePinUI();
        });
    }

    const routeBtn = document.getElementById('route-selector-btn');
    const routeChevron = document.getElementById('route-selector-chevron');
    const openRouteModal = () => {
        triggerHaptic();
        if (window.Renderer?.renderRouteMenu) {
            window.Renderer.renderRouteMenu('route-list', getRoutesForCurrentRegion(), $currentRouteId.get());
        }
        openSmoothModal('route-modal');
    };
    if (routeBtn && !routeBtn.dataset.bound) {
        routeBtn.dataset.bound = '1';
        routeBtn.addEventListener('click', openRouteModal);
    }
    if (routeChevron && !routeChevron.dataset.bound) {
        routeChevron.dataset.bound = '1';
        routeChevron.addEventListener('click', openRouteModal);
    }

    const termsBtn = document.getElementById('terms-btn');
    if (termsBtn && !termsBtn.dataset.bound) {
        termsBtn.dataset.bound = '1';
        termsBtn.addEventListener('click', () => window.openLegal?.('terms'));
    }
    const privacyBtn = document.getElementById('privacy-btn');
    if (privacyBtn && !privacyBtn.dataset.bound) {
        privacyBtn.dataset.bound = '1';
        privacyBtn.addEventListener('click', () => window.openLegal?.('privacy'));
    }

    const stationSelect = document.getElementById('station-select');
    if (stationSelect && !stationSelect.dataset.bound) {
        stationSelect.dataset.bound = '1';
        stationSelect.addEventListener('change', () => {
            const searchInput = document.getElementById('station-search-input');
            if (searchInput && stationSelect.value) {
                searchInput.value = stationSelect.value.replace(/ STATION/g, '');
                searchInput.dataset.resolvedValue = stationSelect.value;
            }
            findNextTrains();
            updateNextTrainView();
        });
    }

    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn && !locateBtn.dataset.bound) {
        locateBtn.dataset.bound = '1';
        locateBtn.addEventListener('click', () => {
            if (typeof window.findNearestStation === 'function') window.findNearestStation(false);
        });
    }

    const shareBtn = document.getElementById('share-app-btn');
    if (shareBtn && !shareBtn.dataset.bound) {
        shareBtn.dataset.bound = '1';
        shareBtn.addEventListener('click', async () => {
            triggerHaptic();
            const shareData = { title: 'Metrorail Next Train', text: 'Check live Metrorail schedules', url: location.origin + location.pathname };
            try {
                if (navigator.share) await navigator.share(shareData);
                else {
                    await navigator.clipboard.writeText(shareData.url);
                    showToast('Link copied to clipboard!', 'success');
                }
            } catch {
                try {
                    await navigator.clipboard.writeText(shareData.url);
                    showToast('Link copied to clipboard!', 'success');
                } catch {
                    showToast('Could not share', 'error');
                }
            }
        });
    }

    document.getElementById('close-modal-btn')?.addEventListener('click', () => closeSmoothModal('schedule-modal'));
    document.getElementById('close-modal-btn-2')?.addEventListener('click', () => closeSmoothModal('schedule-modal'));

    document.querySelectorAll('#view-next-train button').forEach((btn) => {
        const t = (btn.textContent || '').trim();
        if (t === 'Terms of Use' && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => window.openLegal?.('terms'));
        }
        if (t === 'Privacy Policy' && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => window.openLegal?.('privacy'));
        }
    });

    // Route modal region picker + route selection
    document.getElementById('route-list')?.addEventListener('click', (e) => {
        const item = e.target.closest('[data-route-id]');
        if (!item) return;
        const id = item.getAttribute('data-route-id');
        if (!id || !ROUTES[id]) return;
        triggerHaptic();
        $currentRouteId.set(id);
        safeStorage.setItem('defaultRoute_' + ($userRegion.get() || 'GP'), id);
        closeSmoothModal('route-modal');
    });

    document.querySelectorAll('#route-modal-region-list [data-region-target]').forEach((li) => {
        li.addEventListener('click', async () => {
            const region = li.getAttribute('data-region-target');
            if (!region) return;
            triggerHaptic();
            const { executeRegionSwap } = await import('./logic.js');
            // Full wipe + default route + loadAllSchedules lives inside executeRegionSwap
            executeRegionSwap(region);
            const disp = document.getElementById('route-modal-region-display');
            if (disp) disp.textContent = li.getAttribute('data-region-name') || ('Region: ' + region);
        });
    });

    try { startSmartRefresh(); } catch (e) { console.warn('Smart refresh unavailable', e); }

    // Phase 5 — delay report CTA + crowd banner (also bound from hub; safe to double-guard)
    import('./delay-reports.js').then((m) => m.bindDelayReportUi()).catch(() => {});
}
