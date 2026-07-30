/**
 * LIVE BOARD UI ORCHESTRATION (Phase 2)
 * Thin controller bridging DOM ↔ live-board.js engine ↔ Renderer
 */
import { ROUTES, FARE_CONFIG } from './config.js';
import { normalizeStationName, timeToSeconds, safeStorage, escapeHTML } from './utils.js';
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
    startSmartRefresh
} from './live-board.js';

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
        document.addEventListener('click', (e) => {
            if (!list || list.classList.contains('hidden')) return;
            if (!input.contains(e.target) && !list.contains(e.target) && (!chevron || !chevron.contains(e.target))) {
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
    const detailed = getDetailedFare(sheetKey);

    fareContainer.className = "mb-6 p-3.5 rounded-xl flex items-center justify-between shadow-sm min-h-[58px] pr-10 relative transition-colors group bg-blue-50 dark:bg-gray-800 border border-blue-100 dark:border-gray-700";

    if (detailed?.prices) {
        fareContainer.onclick = () => openFareModal(detailed);
        fareContainer.classList.add('cursor-pointer', 'hover:bg-blue-100', 'dark:hover:bg-gray-700');
        if (!document.getElementById('fare-chevron')) {
            const chevron = document.createElement('div');
            chevron.id = 'fare-chevron';
            chevron.className = "absolute right-3 top-1/2 transform -translate-y-1/2 opacity-50 group-hover:opacity-100 transition-opacity flex items-center justify-center shrink-0";
            chevron.innerHTML = `<svg class="w-5 h-5 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>`;
            fareContainer.appendChild(chevron);
        }
    } else {
        document.getElementById('fare-chevron')?.remove();
        fareContainer.onclick = null;
        fareContainer.classList.remove('cursor-pointer');
    }

    if (fareData) {
        if (fareAmount) {
            fareAmount.textContent = `R${fareData.price}`;
            fareAmount.className = "text-2xl font-black text-gray-900 dark:text-white leading-none";
        }
        if (fareType) {
            if (fareData.isPromo) {
                fareType.textContent = fareData.discountLabel || "Discounted";
                fareType.className = "text-[9px] font-bold text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/50 px-2 py-0.5 rounded uppercase tracking-wide whitespace-nowrap inline-block mt-1 shadow-sm border border-purple-200 dark:border-purple-800/50";
            } else if (fareData.isOffPeak) {
                fareType.textContent = "Off-Peak • 40% Off until 14:30";
                fareType.className = "text-[9px] font-bold text-green-600 dark:text-green-300 bg-green-100 dark:bg-green-900/50 px-2 py-0.5 rounded uppercase tracking-wider whitespace-nowrap inline-block mt-1 shadow-sm border border-green-200 dark:border-green-800/50";
            } else {
                fareType.textContent = "Standard Fare";
                fareType.className = "text-[9px] font-bold text-gray-600 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded uppercase tracking-wider whitespace-nowrap inline-block mt-1 shadow-sm border border-gray-300 dark:border-gray-600";
            }
        }
    } else {
        if (fareAmount) {
            fareAmount.textContent = "R --.--";
            fareAmount.className = "text-2xl font-black text-gray-300 dark:text-gray-600 leading-none";
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

export function updateNextTrainView() {
    let container = document.getElementById('grid-trigger-container');
    const liveView = document.getElementById('view-next-train');
    if (!container && liveView) {
        container = document.createElement('div');
        container.id = 'grid-trigger-container';
        container.className = 'mb-4 mt-2 px-1';
        const fare = document.getElementById('fare-container');
        if (fare?.parentNode) fare.parentNode.insertBefore(container, fare);
        else liveView.appendChild(container);
    }
    if (!container) return;

    const routeId = $currentRouteId.get();
    const route = routeId ? ROUTES[routeId] : null;
    if (!route || !route.isActive) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = `
        <button type="button" id="view-full-timetable-btn" class="w-full flex items-center justify-center space-x-3 bg-blue-600 hover:bg-blue-700 text-white font-black py-3.5 rounded-xl shadow-lg ring-4 ring-blue-100 dark:ring-blue-900 transition-all transform active:scale-95 group focus:outline-none">
            <span class="text-xl">📅</span>
            <span class="tracking-wide">VIEW FULL TIMETABLE</span>
        </button>`;
    document.getElementById('view-full-timetable-btn')?.addEventListener('click', () => {
        triggerHaptic();
        renderFullScheduleGrid('A');
    });
}

export function openScheduleModal(destination, dayOverride = null) {
    triggerHaptic();
    const modalList = document.getElementById('modal-list');
    const modalTitle = document.getElementById('modal-title');
    if (!modalList) return;

    const routeId = $currentRouteId.get();
    const route = ROUTES[routeId];
    if (!route) return;

    const destLabel = window.Renderer?._applyUIIntercepts(destination) || destination.replace(/ STATION/gi, '');
    if (modalTitle) modalTitle.textContent = `Upcoming to ${destLabel}`;

    // Prefer journeys already computed by findNextTrains via processAndRenderJourney storage
    // Fallback: list from station board cards' "See Upcoming" uses Renderer-built list if available
    modalList.innerHTML = `<div class="p-4 text-sm text-gray-500 text-center">Loading schedule…</div>`;
    openSmoothModal('schedule-modal');

    // Build simple upcoming list from current schedule sheets
    try {
        const scheds = $schedules.get() || {};
        const dayType = dayOverride || (typeof window !== 'undefined' && window.currentDayType) || 'weekday';
        const isDestA = normalizeStationName(destination) === normalizeStationName(route.destA);
        const sheet = dayType === 'weekday'
            ? (isDestA ? scheds.weekday_to_a : scheds.weekday_to_b)
            : (isDestA ? scheds.saturday_to_a : scheds.saturday_to_b);

        const station = document.getElementById('station-select')?.value;
        if (!sheet?.rows || !station) {
            modalList.innerHTML = `<div class="p-4 text-sm text-gray-500 text-center">No schedule data available.</div>`;
            return;
        }

        const stationCol = sheet.stationColumnName || 'STATION';
        const fromRow = sheet.rows.find(r => normalizeStationName(r[stationCol] || r.STATION) === normalizeStationName(station));
        if (!fromRow) {
            modalList.innerHTML = `<div class="p-4 text-sm text-gray-500 text-center">Station not found on this sheet.</div>`;
            return;
        }

        const nowSec = timeToSeconds(getCurrentTime() || '00:00:00');
        const trains = sheet.headers.slice(1).filter(Boolean);
        const upcoming = [];
        for (const train of trains) {
            if (typeof window.isTrainExcluded === 'function' && window.isTrainExcluded(train, routeId, window.currentDayIndex || 0)) continue;
            const t = fromRow[train];
            if (!t || String(t).trim() === '-' || String(t).trim() === '') continue;
            const sec = timeToSeconds(t);
            if (dayOverride || sec >= nowSec) upcoming.push({ train, time: t, sec });
        }
        upcoming.sort((a, b) => a.sec - b.sec);

        if (upcoming.length === 0) {
            modalList.innerHTML = `<div class="p-4 text-sm text-gray-500 text-center">No more trains today.</div>`;
            return;
        }

        modalList.innerHTML = upcoming.map((u, idx) => `
            <div class="flex justify-between items-center p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 ${idx === 0 ? 'ring-2 ring-blue-500' : ''}">
                <div>
                    <div class="text-xs font-bold text-gray-500 uppercase">Train ${escapeHTML(u.train)}</div>
                    <div class="text-lg font-black text-gray-900 dark:text-white">${escapeHTML(String(u.time).slice(0, 5))}</div>
                </div>
                ${idx === 0 ? '<span class="text-[10px] font-black text-blue-600 uppercase">Next</span>' : ''}
            </div>`).join('');
    } catch (e) {
        console.error(e);
        modalList.innerHTML = `<div class="p-4 text-sm text-red-500 text-center">Could not load schedule.</div>`;
    }
}

export function renderFullScheduleGrid(direction = 'A', dayOverride = null) {
    triggerHaptic();
    const routeId = $currentRouteId.get();
    const route = ROUTES[routeId];
    if (!route || !window.Renderer?._buildGridHTML) {
        showToast('Timetable not ready yet.', 'error');
        return;
    }

    const dayType = dayOverride || (typeof window !== 'undefined' && window.currentDayType === 'saturday' ? 'saturday' : 'weekday');
    const scheds = $schedules.get() || {};
    const schedule = direction === 'A'
        ? (dayType === 'weekday' ? scheds.weekday_to_a : scheds.saturday_to_a)
        : (dayType === 'weekday' ? scheds.weekday_to_b : scheds.saturday_to_b);

    if (!schedule) {
        showToast('No timetable for this day.', 'error');
        return;
    }

    let modal = document.getElementById('full-schedule-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'full-schedule-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-[90] hidden flex items-center justify-center p-0 full-screen backdrop-blur-md transition-opacity duration-300';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-900 rounded-none shadow-2xl w-full h-full flex flex-col overflow-hidden relative">
                <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-100 dark:bg-gray-800 z-20 shrink-0">
                    <h3 class="text-lg font-bold text-gray-900 dark:text-white">Full Timetable</h3>
                    <div class="flex items-center gap-2">
                        <button type="button" id="grid-export-btn" class="px-3 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg">Export</button>
                        <button type="button" id="close-full-grid-btn" class="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500" aria-label="Close">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                </div>
                <div id="grid-controls" class="px-4 py-2 flex gap-2 shrink-0 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700"></div>
                <div id="grid-container" class="flex-grow overflow-auto p-2 bg-white dark:bg-gray-900"></div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('close-full-grid-btn')?.addEventListener('click', () => closeSmoothModal('full-schedule-modal'));
        document.getElementById('grid-export-btn')?.addEventListener('click', () => {
            if (typeof window.takeGridSnapshot === 'function') window.takeGridSnapshot(direction, dayType);
        });
    }

    const controls = document.getElementById('grid-controls');
    if (controls) {
        controls.innerHTML = `
            <button type="button" data-dir="A" class="px-3 py-1.5 text-xs font-bold rounded-lg ${direction === 'A' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}">To ${window.Renderer._applyUIIntercepts(route.destA)}</button>
            <button type="button" data-dir="B" class="px-3 py-1.5 text-xs font-bold rounded-lg ${direction === 'B' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700'}">To ${window.Renderer._applyUIIntercepts(route.destB)}</button>`;
        controls.querySelectorAll('button[data-dir]').forEach(btn => {
            btn.addEventListener('click', () => renderFullScheduleGrid(btn.getAttribute('data-dir'), dayType));
        });
    }

    const sheetKey = direction === 'A'
        ? (dayType === 'weekday' ? route.sheetKeys.weekday_to_a : route.sheetKeys.saturday_to_a)
        : (dayType === 'weekday' ? route.sheetKeys.weekday_to_b : route.sheetKeys.saturday_to_b);

    const html = window.Renderer._buildGridHTML(schedule, sheetKey, routeId, window.currentDayIndex || 0, true, false);
    const grid = document.getElementById('grid-container');
    if (grid) grid.innerHTML = html;
    openSmoothModal('full-schedule-modal');
}

export function attachLiveBoardUiGlobals() {
    if (typeof window === 'undefined') return;
    window._renderNextTrainList = _renderNextTrainList;
    window.processAndRenderJourney = processAndRenderJourney;
    window.renderNoService = renderNoService;
    window.renderNextAvailableTrain = renderNextAvailableTrain;
    window.updateFareDisplay = updateFareDisplay;
    window.openFareModal = openFareModal;
    window.openScheduleModal = openScheduleModal;
    window.renderFullScheduleGrid = renderFullScheduleGrid;
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
        const title = document.getElementById('route-subtitle-text');
        if (title && ROUTES[routeId]) {
            title.textContent = ROUTES[routeId].name;
            const color = ROUTES[routeId].colorClass || 'text-gray-700 dark:text-gray-200';
            title.className = `text-base sm:text-lg font-medium ${color} group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate w-full text-center px-1 min-w-0`;
        }
        // Reload route-specific schedules when route changes after initial boot
        if ($fullDatabase.get()) {
            loadAllSchedules(true).then(() => {
                populateStationList();
                findNextTrains();
                updateNextTrainView();
            });
        }
    });

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
