function renderNoService(element, destination) {
    if (!element) return;
    const currentRoute = typeof ROUTES !== 'undefined' ? ROUTES[currentRouteId] : null;
    if (!currentRoute) return;

    const selectedStation = stationSelect ? stationSelect.value : "";
    const simResult = typeof window.simulateNextActiveService === 'function' 
        ? window.simulateNextActiveService(selectedStation, destination) 
        : null;

    let firstTrain = simResult ? simResult.train : null;
    let daysAhead = simResult ? simResult.daysAhead : 1;

    if (typeof Renderer !== 'undefined') Renderer.renderNoService(element, destination, firstTrain, daysAhead);
}

function processAndRenderJourney(allJourneys, element, header, destination) {
    if (!element) return;
    if (!allJourneys || !Array.isArray(allJourneys)) return;

    const nowInSeconds = timeToSeconds(currentTime);
    const remainingJourneys = allJourneys.filter(j => timeToSeconds(j.departureTime || j.train1.departureTime) >= nowInSeconds);
    const nextJourney = remainingJourneys.length > 0 ? remainingJourneys[0] : null;
    const firstTrainName = allJourneys.length > 0 ? (allJourneys[0].train || allJourneys[0].train1.train) : null;
    
    if (!currentScheduleData) currentScheduleData = {};
    currentScheduleData[destination] = allJourneys;

    if (nextJourney) {
        const journeyTrainName = nextJourney.train || nextJourney.train1.train;
        nextJourney.isFirstTrain = (journeyTrainName === firstTrainName);
        const allRemainingTrainNames = new Set(remainingJourneys.map(j => j.train || j.train1.train));
        nextJourney.isLastTrain = (allRemainingTrainNames.size === 1);
        if (typeof Renderer !== 'undefined') Renderer.renderJourney(element, nextJourney, destination);
    } else {
        if (allJourneys.length === 0) {
              element.innerHTML = `<div class="min-h-[96px] flex flex-col justify-center items-center text-lg font-bold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800/50 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">No scheduled trains.</div>`;
              return;
        }
        renderNextAvailableTrain(element, destination);
    }
}

function renderNextAvailableTrain(element, destination) {
    if (!element) return;
    const currentRoute = typeof ROUTES !== 'undefined' ? ROUTES[currentRouteId] : null;
    if (!currentRoute) return;

    const selectedStation = stationSelect ? stationSelect.value : "";
    const simResult = typeof window.simulateNextActiveService === 'function' 
        ? window.simulateNextActiveService(selectedStation, destination) 
        : null;

    if (!simResult) { 
        element.innerHTML = `<div class="min-h-[96px] flex flex-col justify-center items-center text-lg font-bold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800/50 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">No upcoming trains.</div>`; 
        return; 
    }
    
    if (typeof Renderer !== 'undefined') {
        Renderer.renderNextAvailableTrain(element, destination, simResult.train, simResult.dayInfo.name, simResult.dayInfo.type, simResult.daysAhead);
    }
}

function updateFareDisplay(sheetKey) {
    const localFareContainer = document.getElementById('fare-container');
    const localPassengerTypeLabel = document.getElementById('passenger-type-label');
    
    if (!localFareContainer || !localFareContainer.parentNode) return; 

    if (localPassengerTypeLabel) {
        localPassengerTypeLabel.textContent = currentUserProfile;
    }

    const newFareContainer = localFareContainer.cloneNode(true);
    localFareContainer.parentNode.replaceChild(newFareContainer, localFareContainer);
    
    const activeFareContainer = newFareContainer;
    const activeFareAmount = document.getElementById('fare-amount');
    const activeFareType = document.getElementById('fare-type');

    activeFareContainer.className = "mb-6 p-3.5 rounded-xl flex items-center justify-between shadow-sm min-h-[58px] pr-10 relative transition-colors group";

    const fareData = typeof getRouteFare === 'function' ? getRouteFare(sheetKey) : null; 
    const detailed = typeof getDetailedFare === 'function' ? getDetailedFare(sheetKey) : null;
    
    if (detailed && detailed.prices) {
        activeFareContainer.onclick = () => openFareModal(detailed);
        activeFareContainer.classList.add('cursor-pointer');
        
        if (!document.getElementById('fare-chevron')) {
            const chevron = document.createElement('div');
            chevron.id = 'fare-chevron';
            chevron.className = "absolute right-3 top-1/2 transform -translate-y-1/2 opacity-50 group-hover:opacity-100 transition-opacity flex items-center justify-center shrink-0";
            chevron.innerHTML = `<svg class="w-5 h-5 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>`;
            activeFareContainer.appendChild(chevron);
        }
    } else {
        const existingChevron = document.getElementById('fare-chevron');
        if(existingChevron) existingChevron.remove();
    }

    if (fareData) {
        if(activeFareAmount) activeFareAmount.textContent = `R${fareData.price}`;
        
        activeFareContainer.classList.add('bg-blue-50', 'dark:bg-gray-800', 'border', 'border-blue-100', 'dark:border-gray-700');
        if (detailed && detailed.prices) activeFareContainer.classList.add('hover:bg-blue-100', 'dark:hover:bg-gray-700');
        
        if(activeFareAmount) activeFareAmount.className = "text-2xl font-black text-gray-900 dark:text-white leading-none";

        if (fareData.isPromo) {
            if(activeFareType) {
                activeFareType.textContent = fareData.discountLabel || "Discounted";
                activeFareType.className = "text-[9px] font-bold text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/50 px-2 py-0.5 rounded uppercase tracking-wide whitespace-nowrap inline-block mt-1 shadow-sm border border-purple-200 dark:border-purple-800/50";
            }
        } else if (fareData.isOffPeak) {
            if(activeFareType) {
                activeFareType.textContent = "Off-Peak • 40% Off until 14:30"; 
                activeFareType.className = "text-[9px] font-bold text-green-600 dark:text-green-300 bg-green-100 dark:bg-green-900/50 px-2 py-0.5 rounded uppercase tracking-wider whitespace-nowrap inline-block mt-1 shadow-sm border border-green-200 dark:border-green-800/50";
            }
        } else {
            if(activeFareType) {
                activeFareType.textContent = "Standard Fare";
                activeFareType.className = "text-[9px] font-bold text-gray-600 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded uppercase tracking-wider whitespace-nowrap inline-block mt-1 shadow-sm border border-gray-300 dark:border-gray-600";
            }
        }
    } else {
        activeFareContainer.classList.add('bg-blue-50', 'dark:bg-gray-800', 'border', 'border-blue-100', 'dark:border-gray-700');
        if(activeFareAmount) {
            activeFareAmount.textContent = "R --.--";
            activeFareAmount.className = "text-2xl font-black text-gray-300 dark:text-gray-600 leading-none";
        }
        if (stationSelect && stationSelect.value) {
             if(activeFareType) {
                 activeFareType.textContent = "Rate Unavailable";
                 activeFareType.className = "text-[9px] font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded uppercase tracking-wide whitespace-nowrap inline-block mt-1 shadow-sm border border-yellow-200 dark:border-yellow-800/50";
             }
        } else {
             if(activeFareType) activeFareType.className = "hidden";
        }
    }
    
    activeFareContainer.classList.remove('hidden');
}

window.openFareModal = function(fareDetails) {
    triggerHaptic();
    
    if (!fareDetails) return;
    
    // GROWTH MODE: Track Fare Modal Interactions (Monetization Hook)
    trackAnalyticsEvent('view_fare_modal', { 
        zone: fareDetails.code,
        route_id: typeof currentRouteId !== 'undefined' ? currentRouteId : 'none'
    });

    let modal = document.getElementById('fare-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'fare-modal';
        modal.className = 'fixed inset-0 bg-black/80 z-[140] hidden flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm flex flex-col transform transition-transform duration-300 scale-95 max-h-[85vh]">
                <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900 rounded-t-2xl shrink-0">
                    <h3 class="text-lg font-bold text-gray-900 dark:text-white flex flex-col items-start justify-center" id="fare-zone-badge">Ticket Prices</h3>
                    <button onclick="closeSmoothModal('fare-modal')" class="p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition focus:outline-none">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-6 overflow-y-auto flex-grow text-gray-700 dark:text-gray-300">
                    <div id="fare-table-content" class="space-y-0"></div>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 text-center mt-6">Prices are subject to change. Confirm at station.</p>
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 text-center mt-1">Off-Peak Fares apply weekdays between 09:30 and 14:30.</p>
                </div>
                <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-2xl shrink-0">
                    <button onclick="closeSmoothModal('fare-modal')" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors focus:outline-none">
                        Close
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const zoneEl = document.getElementById('fare-zone-badge');
    const tableEl = document.getElementById('fare-table-content');
    
    const routeName = typeof ROUTES !== 'undefined' && currentRouteId && ROUTES[currentRouteId] ? ROUTES[currentRouteId].name.replace('<->', '↔') : '';
    if (zoneEl) {
        zoneEl.innerHTML = `
            <div class="flex items-center">
                Ticket Prices <span class="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 ml-2 px-2 py-0.5 rounded-full uppercase tracking-widest">Zone ${fareDetails.code}</span>
            </div>
            ${routeName ? `<span class="text-xs text-gray-500 dark:text-gray-400 font-medium mt-0.5">${routeName}</span>` : ''}
        `;
    }

    if (tableEl) {
        const profile = FARE_CONFIG.profiles[currentUserProfile] || FARE_CONFIG.profiles["Adult"];
        const prices = fareDetails.prices;
        
        const calc = (basePrice) => (Math.ceil((basePrice * profile.base) * 2) / 2).toFixed(2);
        
        tableEl.innerHTML = `
            <div class="flex justify-between items-center py-3 border-b border-dashed border-gray-300 dark:border-gray-600">
                <span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Single Trip</span>
                <span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.single)}</span>
            </div>
            <div class="flex justify-between items-center py-3 border-b border-dashed border-gray-300 dark:border-gray-600">
                <span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Return Trip</span>
                <span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.return)}</span>
            </div>
            <div class="flex justify-between items-center py-3 border-b border-dashed border-gray-300 dark:border-gray-600">
                <span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Weekly <span class="opacity-70 font-normal">(Mon-Fri)</span></span>
                <span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.weekly_mon_fri)}</span>
            </div>
            <div class="flex justify-between items-center py-3 border-b border-dashed border-gray-300 dark:border-gray-600">
                <span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Weekly <span class="opacity-70 font-normal">(Mon-Sat)</span></span>
                <span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.weekly_mon_sat)}</span>
            </div>
            <div class="flex justify-between items-center py-3">
                <span class="text-gray-600 dark:text-gray-400 text-sm font-bold">Monthly Pass</span>
                <span class="font-black text-gray-900 dark:text-white text-lg">R${calc(prices.monthly)}</span>
            </div>
        `;
    }

    openSmoothModal('fare-modal');
};