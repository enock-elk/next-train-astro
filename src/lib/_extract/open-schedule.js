window.openScheduleModal = function(destination, dayOverride = null) {
    history.pushState({ modal: 'schedule' }, '', '#schedule');
    let journeys = [];
    let titleSuffix = "";
    let targetDayIdx = typeof currentDayIndex !== 'undefined' ? currentDayIndex : new Date().getDay();

    if (dayOverride) {
        const currentRoute = typeof ROUTES !== 'undefined' && typeof currentRouteId !== 'undefined' ? ROUTES[currentRouteId] : null;
        if (!currentRoute) return;
        
        let sheetKey = null;

        const selectedStation = stationSelect ? stationSelect.value : "";
        const simResult = typeof window.simulateNextActiveService === 'function'
            ? window.simulateNextActiveService(selectedStation, destination)
            : null;
        
        if (simResult && simResult.dayInfo.type === dayOverride) {
            targetDayIdx = simResult.dayInfo.idx;
            titleSuffix = ` (${simResult.dayInfo.name})`;
        } else {
            if (dayOverride === 'weekday') { targetDayIdx = 1; titleSuffix = " (Weekday)"; } 
            else if (dayOverride === 'saturday') { targetDayIdx = 6; titleSuffix = " (Weekend/Holiday)"; } 
        }

        if (dayOverride === 'weekday') { sheetKey = (destination === currentRoute.destA) ? 'weekday_to_a' : 'weekday_to_b'; } 
        else if (dayOverride === 'saturday') { sheetKey = (destination === currentRoute.destA) ? 'saturday_to_a' : 'saturday_to_b'; } 
        else if (dayOverride === 'sunday') { sheetKey = (destination === currentRoute.destA) ? 'weekday_to_a' : 'weekday_to_b'; }

        const schedule = schedules[sheetKey];
        if (schedule) {
            if (destination === currentRoute.destA) { 
                journeys = findNextJourneyToDestA(selectedStation, "00:00:00", schedule, currentRoute, targetDayIdx).allJourneys; 
            } else { 
                journeys = findNextJourneyToDestB(selectedStation, "00:00:00", schedule, currentRoute, targetDayIdx).allJourneys; 
            }
        }
    } else {
        if (!currentScheduleData || !currentScheduleData[destination]) { showToast("No full schedule data available.", "error"); return; }
        journeys = currentScheduleData[destination]; 
    }

    if (!journeys || journeys.length === 0) { showToast("No trains found for this schedule.", "error"); return; }
    
    let fromStationName = "Upcoming Trains";
    if (stationSelect && stationSelect.value) {
        fromStationName = stationSelect.value.replace(' STATION', '');
    }
    if (modalTitle) modalTitle.textContent = `${fromStationName} -> ${destination.replace(' STATION', '')}${titleSuffix}`; 
    
    const toTitleCase = (str) => {
        if (!str) return '';
        return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    };

    if (modalList) modalList.innerHTML = '';
    const nowSeconds = typeof currentTime !== 'undefined' ? timeToSeconds(currentTime) : 0;
    let firstNextTrainFound = false;
    
    journeys.forEach(j => {
        const dep = j.departureTime || j.train1.departureTime; 
        const trainName = j.train || j.train1.train; 
        const type = j.type === 'transfer' ? 'Transfer' : 'Direct';
        const depSeconds = timeToSeconds(dep);
        let isPassed = false;
        if (!dayOverride) isPassed = depSeconds < nowSeconds;
        let divClass = "p-3 rounded shadow-sm flex justify-between items-center transition-opacity duration-300";
        if (isPassed) divClass += " bg-gray-50 dark:bg-gray-800 opacity-50 grayscale"; else divClass += " bg-white dark:bg-gray-700"; 
        const div = document.createElement('div'); div.className = divClass;
        if (!isPassed && !firstNextTrainFound && !dayOverride) { div.id = "next-train-marker"; firstNextTrainFound = true; }
        
        let sharedTag = "";
        if (j.isShared && j.sourceRoute) {
             let rawName = j.sourceRoute.replace("Route", "").trim();
             let routeName = rawName;
             
             if (rawName.includes('<->')) {
                 routeName = rawName.split('<->')[1].trim();
             } else if (rawName.includes('â†”')) {
                 routeName = rawName.split('â†”')[1].trim();
             }

             if (j.isDivergent) {
                 const divDest = typeof Renderer !== 'undefined' ? Renderer._applyUIIntercepts(j.actualDestName) : j.actualDestName;
                 sharedTag = `<span class="text-[9px] font-bold text-red-600 bg-red-100 dark:text-red-300 dark:bg-red-900 px-1.5 py-0.5 rounded uppercase ml-2 border border-red-200 dark:border-red-800">âš ï¸ To ${toTitleCase(divDest)}</span>`;
             } else {
                 sharedTag = `<span class="text-[9px] font-bold text-purple-600 bg-purple-100 dark:text-purple-300 dark:bg-purple-900 px-1.5 py-0.5 rounded uppercase ml-2">From ${toTitleCase(routeName)}</span>`;
             }
        }
        
        const formattedDep = formatTimeDisplay(dep);
        let rightPillHTML = "";
        
        let terminationBadge = ""; 
        let isShortTrip = false;
        let shortDestName = "";

        if (j.type === 'direct' && j.actualDestination) {
            const actual = normalizeStationName(j.actualDestination);
            const target = normalizeStationName(destination);
            if (actual !== target) {
                isShortTrip = true;
                shortDestName = toTitleCase(j.actualDestination.replace(' STATION', ''));
                terminationBadge = ""; 
            }
        }

        if (sharedTag && sharedTag !== "") { 
            rightPillHTML = sharedTag; 
            sharedTag = ""; 
        } else {
            if (type === 'Direct') {
                if (isShortTrip) {
                    rightPillHTML = `<span class="text-[10px] font-bold text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-900 px-2 py-0.5 rounded-full uppercase whitespace-nowrap">To ${shortDestName}</span>`;
                } else {
                    rightPillHTML = '<span class="text-[10px] font-bold text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900 px-2 py-0.5 rounded-full uppercase">Direct</span>';
                }
            } else {
                let transferLabel = "";
                let transferSubtext = "";
                
                if (j.train1 && j.train1.headboardDestination) {
                    const hbDest = toTitleCase(j.train1.headboardDestination.replace(/ STATION/g, ''));
                    transferLabel = `To ${hbDest}`;
                    transferSubtext = " ";
                } else {
                    const transferHub = toTitleCase(j.train1.terminationStation.replace(' STATION',''));
                    transferLabel = `Transfer @ ${transferHub}`;
                }

                rightPillHTML = `
                    <div class="flex flex-col items-end">
                        <span class="text-[10px] font-bold text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-900 px-2 py-0.5 rounded-full uppercase text-right leading-tight mb-0.5">
                            ${transferLabel}
                        </span>
                        ${transferSubtext ? `<span class="text-[8px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-tight">${transferSubtext}</span>` : ''}
                    </div>
                `;
            }
        }
        
        if (j.isLastTrain) rightPillHTML += ' <span class="text-[10px] font-bold text-red-600 bg-red-100 dark:text-red-300 dark:bg-red-900 px-2 py-0.5 rounded-full uppercase border border-red-200 dark:border-red-800 ml-1">LAST TRAIN</span>';
        
        div.innerHTML = `
            <div>
                <span class="text-lg font-bold text-gray-900 dark:text-white">${formattedDep}</span>
                <div class="text-xs text-gray-500 dark:text-gray-400">Train ${trainName}</div>
                ${terminationBadge}
            </div>
            <div class="flex flex-col items-end gap-1 text-right">
                ${rightPillHTML}
            </div>
        `;
        if (modalList) modalList.appendChild(div);
    });
    
    openSmoothModal('schedule-modal');
    
    if (!dayOverride) { setTimeout(() => { const target = document.getElementById('next-train-marker'); if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' }); }, 10); } 
    else { const container = document.getElementById('modal-list'); if(container) container.scrollTop = 0; }
};
