    renderNoService: (element, destination, firstNextTrain, dayOffset, openModalCallback) => {
        let timeHTML = 'N/A';
        
        const nextDayInfo = typeof window.getLookaheadDayInfo === 'function' 
            ? window.getLookaheadDayInfo(dayOffset || 1) 
            : { name: 'Monday', type: 'weekday' };

        if (firstNextTrain) {
            const rawTime = firstNextTrain.departureTime || firstNextTrain.train1.departureTime;
            const departureTime = formatTimeDisplay(rawTime);
            let timeDiffStr = (typeof calculateTimeDiffString === 'function') 
                ? calculateTimeDiffString(rawTime, dayOffset) 
                : ""; 
            
            if (timeDiffStr) timeDiffStr = timeDiffStr.replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
            
            timeHTML = `<div class="text-xl font-bold text-gray-900 dark:text-white">${departureTime}</div><div class="text-xs text-gray-700 dark:text-gray-300 font-medium">${timeDiffStr}</div>`;
        } else {
            timeHTML = `<div class="text-lg font-bold text-gray-500">No Data</div>`;
        }
        
        const safeDestForClick = escapeHTML(destination).replace(/&#39;/g, "\\'");
        const buttonHTML = `<button onclick="openScheduleModal('${safeDestForClick}', '${nextDayInfo.type}')" class="mt-2 text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide border border-blue-200 dark:border-blue-800 px-3 py-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">Check ${nextDayInfo.name} Schedule</button>`;

        let dayText = nextDayInfo.name;
        if (dayText !== "Tomorrow") dayText = `on ${dayText}`;

        // --- GUARDIAN PHASE 4: CROSS-CORRIDOR LIVE BOARD DISRUPTION EVALUATOR ---
        let disruptionHtml = '';
        if (typeof window.getTripDisruptions === 'function' && typeof currentRouteId !== 'undefined') {
            let stopsArray = [];
            const origin = (typeof stationSelect !== 'undefined' && stationSelect) ? stationSelect.value : "";
            if (origin && typeof allStations !== 'undefined' && allStations.length > 0) {
                const oIdx = allStations.findIndex(s => normalizeStationName(s) === normalizeStationName(origin));
                const dIdx = allStations.findIndex(s => normalizeStationName(s) === normalizeStationName(destination));
                if (oIdx !== -1 && dIdx !== -1) {
                    const start = Math.min(oIdx, dIdx);
                    const end = Math.max(oIdx, dIdx);
                    for (let i = start; i <= end; i++) stopsArray.push({ station: allStations[i] });
                } else {
                    stopsArray = [{ station: origin }, { station: destination }];
                }
            } else {
                stopsArray = [{ station: origin || "" }, { station: destination }];
            }

            const activeDisruptions = window.getTripDisruptions(currentRouteId, stopsArray);
            if (activeDisruptions && activeDisruptions.length > 0) {
                const routeDisruption = activeDisruptions.find(d => d.tier === 'CRITICAL') || activeDisruptions[0];
                
                const isCritical = routeDisruption.tier === 'CRITICAL';
                const btnClass = isCritical
                    ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-800/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50' 
                    : 'bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-800/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50';

                const svgIcon = isCritical 
                    ? `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
                    : `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

                const labelText = routeDisruption.buttonText ? escapeHTML(routeDisruption.buttonText) : (isCritical ? 'Line Severed' : 'Expect Delays');
                
                disruptionHtml = `
                    <div class="mt-1 flex justify-center w-full px-2">
                        <button type="button" onclick="openDisruptionModal('${routeDisruption.id}')" class="${btnClass} px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border transition-colors shadow-sm flex items-center animate-pulse truncate max-w-full focus:outline-none">
                            ${svgIcon} <span class="truncate">${labelText}</span>
                        </button>
                    </div>
                `;
            }
        }

        element.innerHTML = `
            <div class="flex flex-col justify-center items-center w-full py-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in-up">
                <div class="text-sm font-bold text-gray-600 dark:text-gray-400">No service today</div>
                ${disruptionHtml}
                <p class="text-[10px] text-gray-400 dark:text-gray-50 mt-1">First train ${dayText} is at:</p>
                <div class="text-center p-2 bg-gray-50 dark:bg-gray-900/50 rounded-md transition-all mt-1 w-3/4 shadow-sm border border-gray-100 dark:border-gray-800">
                    ${timeHTML}
                </div>
                ${buttonHTML}
            </div>
        `;
    },

    renderNextAvailableTrain: (element, destination, firstTrain, dayName, dayType, dayOffset) => {
        const rawTime = firstTrain.departureTime || firstTrain.train1.departureTime;
        const departureTime = formatTimeDisplay(rawTime);
        let timeDiffStr = (typeof calculateTimeDiffString === 'function') 
            ? calculateTimeDiffString(rawTime, dayOffset) 
            : "";
        
        if (timeDiffStr) timeDiffStr = timeDiffStr.replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
        
        const safeDest = escapeHTML(destination);
        const safeDestForClick = safeDest.replace(/&#39;/g, "\\'"); 

        let dayText = dayName;
        if (dayText !== "Tomorrow") dayText = `on ${dayText}`;

        // --- GUARDIAN PHASE 4: CROSS-CORRIDOR LIVE BOARD DISRUPTION EVALUATOR ---
        let disruptionHtml = '';
        if (typeof window.getTripDisruptions === 'function' && typeof currentRouteId !== 'undefined') {
            let stopsArray = [];
            const origin = (typeof stationSelect !== 'undefined' && stationSelect) ? stationSelect.value : "";
            if (origin && typeof allStations !== 'undefined' && allStations.length > 0) {
                const oIdx = allStations.findIndex(s => normalizeStationName(s) === normalizeStationName(origin));
                const dIdx = allStations.findIndex(s => normalizeStationName(s) === normalizeStationName(destination));
                if (oIdx !== -1 && dIdx !== -1) {
                    const start = Math.min(oIdx, dIdx);
                    const end = Math.max(oIdx, dIdx);
                    for (let i = start; i <= end; i++) stopsArray.push({ station: allStations[i] });
                } else {
                    stopsArray = [{ station: origin }, { station: destination }];
                }
            } else {
                stopsArray = [{ station: origin || "" }, { station: destination }];
            }

            const activeDisruptions = window.getTripDisruptions(currentRouteId, stopsArray);
            if (activeDisruptions && activeDisruptions.length > 0) {
                const routeDisruption = activeDisruptions.find(d => d.tier === 'CRITICAL') || activeDisruptions[0];
                
                const isCritical = routeDisruption.tier === 'CRITICAL';
                const btnClass = isCritical
                    ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-800/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50' 
                    : 'bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-800/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50';

                const svgIcon = isCritical 
                    ? `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
                    : `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

                const labelText = routeDisruption.buttonText ? escapeHTML(routeDisruption.buttonText) : (isCritical ? 'Line Severed' : 'Expect Delays');
                
                disruptionHtml = `
                    <div class="mt-1 flex justify-center w-full px-2">
                        <button type="button" onclick="openDisruptionModal('${routeDisruption.id}')" class="${btnClass} px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border transition-colors shadow-sm flex items-center animate-pulse truncate max-w-full focus:outline-none">
                            ${svgIcon} <span class="truncate">${labelText}</span>
                        </button>
                    </div>
                `;
            }
        }

        element.innerHTML = `
            <div class="flex flex-col justify-center items-center w-full py-2 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in-up">
                <div class="text-sm font-bold text-gray-600 dark:text-gray-400">No more trains today</div>
                ${disruptionHtml}
                <p class="text-[10px] text-gray-400 dark:text-gray-50 mt-1">First train ${dayText} is at:</p>
                <div class="text-center p-2 bg-gray-50 dark:bg-gray-900/50 rounded-md transition-all mt-1 w-3/4 shadow-sm border border-gray-100 dark:border-gray-800">
                    <div class="text-xl font-bold text-gray-900 dark:text-white">${departureTime}</div>
                    <div class="text-xs text-gray-700 dark:text-gray-300 font-medium">${timeDiffStr}</div>
                </div>
                <button onclick="openScheduleModal('${safeDestForClick}', '${dayType}')" class="mt-2 text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide border border-blue-200 dark:border-blue-800 px-3 py-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">See ${dayName} Schedule</button>
            </div>
        `;
    },

    renderJourney: (element, journey, destination) => {
        element.innerHTML = "";
        
        let timeClass = "bg-gray-200 dark:bg-gray-900";
        if (journey.isLastTrain) {
            timeClass = "bg-red-100 dark:bg-red-900 border-2 border-red-500";
        } else if (journey.isFirstTrain) {
            timeClass = "bg-green-100 dark:bg-green-900 border-2 border-green-500";
        }
        
        const rawTime = journey.departureTime || journey.train1.departureTime;
        const safeDepTime = escapeHTML(formatTimeDisplay(rawTime));
        const safeTrainName = escapeHTML(journey.train || journey.train1.train);
        const safeDest = escapeHTML(destination);
        let timeDiffStr = (typeof calculateTimeDiffString === 'function') 
            ? calculateTimeDiffString(rawTime) 
            : "";
            
        if (timeDiffStr) timeDiffStr = timeDiffStr.replace(/(\d+)h\s(\d+)m/, '$1 hr $2 min').replace(/(\d+)m\)/, '$1 min)');
        
        const safeDestForClick = safeDest.replace(/&#39;/g, "\\'"); 
        const buttonHtml = `<button onclick="openScheduleModal('${safeDestForClick}')" class="absolute bottom-0 left-0 w-full text-[9px] uppercase tracking-wide font-bold py-1 bg-black bg-opacity-10 hover:bg-opacity-20 dark:bg-white dark:bg-opacity-10 dark:hover:bg-opacity-20 rounded-b-lg transition-colors truncate focus:outline-none">See Upcoming Trains</button>`;

        let sharedTag = "";
        if (journey.isShared && journey.sourceRoute) {
             let rawName = journey.sourceRoute.replace("Route", "").trim();
             let routeName = rawName;
             
             // GUARDIAN V6.04.14 FIX: Universal String Split for region-agnostic formatting
             if (rawName.includes('<->')) {
                 routeName = rawName.split('<->')[1].trim();
             } else if (rawName.includes('â€¢')) {
                 routeName = rawName.split('â€¢')[1].trim();
             } else if (rawName.includes('↔')) {
                 routeName = rawName.split('↔')[1].trim(); // Legacy fallback
             }

             if (journey.isDivergent) {
                 const divDest = Renderer._applyUIIntercepts(journey.actualDestName);
                 sharedTag = `<span class="block text-[9px] uppercase font-bold text-red-600 dark:text-red-400 mt-0.5 bg-red-100 dark:bg-red-900 px-1 rounded w-fit mx-auto border border-red-200 dark:border-red-700">âš ï¸ To ${divDest}</span>`;
             } else {
                 sharedTag = `<span class="block text-[9px] uppercase font-bold text-purple-600 dark:text-purple-400 mt-0.5 bg-purple-100 dark:bg-purple-900 px-1 rounded w-fit mx-auto">From ${routeName}</span>`;
             }
        }

        // --- GUARDIAN PHASE 4: CROSS-CORRIDOR LIVE BOARD DISRUPTION EVALUATOR ---
        let disruptionHtml = '';
        let isForceTerminated = false;
        let overrideActualDest = null;
        
        if (typeof window.getTripDisruptions === 'function' && typeof currentRouteId !== 'undefined') {
            let stopsArray = [];
            const origin = (typeof stationSelect !== 'undefined' && stationSelect) ? stationSelect.value : "";
            if (origin && typeof allStations !== 'undefined' && allStations.length > 0) {
                const oIdx = allStations.findIndex(s => normalizeStationName(s) === normalizeStationName(origin));
                const dIdx = allStations.findIndex(s => normalizeStationName(s) === normalizeStationName(destination));
                if (oIdx !== -1 && dIdx !== -1) {
                    const start = Math.min(oIdx, dIdx);
                    const end = Math.max(oIdx, dIdx);
                    for (let i = start; i <= end; i++) stopsArray.push({ station: allStations[i] });
                } else {
                    stopsArray = [{ station: origin }, { station: destination }];
                }
            } else {
                stopsArray = [{ station: origin || "" }, { station: destination }];
            }

            const activeDisruptions = window.getTripDisruptions(currentRouteId, stopsArray);
            if (activeDisruptions && activeDisruptions.length > 0) {
                // Priority: CRITICAL first, then WARNING
                const routeDisruption = activeDisruptions.find(d => d.tier === 'CRITICAL') || activeDisruptions[0];
                
                const isCritical = routeDisruption.tier === 'CRITICAL';
                const btnClass = isCritical
                    ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-800/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/50' 
                    : 'bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-800/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800/50';

                const svgIcon = isCritical 
                    ? `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
                    : `<svg class="w-3.5 h-3.5 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

                const labelText = routeDisruption.buttonText ? escapeHTML(routeDisruption.buttonText) : (isCritical ? 'Line Severed' : 'Expect Delays');
                
                disruptionHtml = `
                    <div class="mt-1.5 flex justify-center w-full px-1">
                        <button type="button" onclick="openDisruptionModal('${routeDisruption.id}')" class="${btnClass} px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border transition-colors shadow-sm flex items-center animate-pulse truncate max-w-full focus:outline-none">
                            ${svgIcon} <span class="truncate">${labelText}</span>
                        </button>
                    </div>
                `;

                // Terminal Truncation Logic for CRITICAL Severances
                if (routeDisruption.tier === 'CRITICAL' && routeDisruption.stations && routeDisruption.stations.length >= 2) {
                    if (origin && typeof allStations !== 'undefined' && allStations.length > 0) {
                        
                        const getNormalizedIdx = (station) => {
                            if (!station) return -1;
                            const normTarget = normalizeStationName(station);
                            return allStations.findIndex(s => normalizeStationName(s) === normTarget);
                        };

                        const originIdx = getNormalizedIdx(origin);
                        const cutAIdx = getNormalizedIdx(routeDisruption.stations[0]);
                        const cutBIdx = getNormalizedIdx(routeDisruption.stations[1]);
                        const destIdx = getNormalizedIdx(destination);

                        if (originIdx !== -1 && destIdx !== -1 && cutAIdx !== -1 && cutBIdx !== -1) {
                            const minCut = Math.min(cutAIdx, cutBIdx);
                            const maxCut = Math.max(cutAIdx, cutBIdx);
                            const minTrip = Math.min(originIdx, destIdx);
                            const maxTrip = Math.max(originIdx, destIdx);

                            // If trip originates on one side of the cut and destination is on the other
                            if (minTrip <= minCut && maxTrip >= maxCut) {
                                const distA = Math.abs(cutAIdx - originIdx);
                                const distB = Math.abs(cutBIdx - originIdx);
                                const terminalStation = distA < distB ? routeDisruption.stations[0] : routeDisruption.stations[1];
                                
                                overrideActualDest = terminalStation;
                                isForceTerminated = true;
                            }
                        }
                    }
                }
            }
        }
        // ---------------------------------------------------------

        if (journey.type === 'direct') {
            let actualDest = journey.actualDestination ? Renderer._applyUIIntercepts(normalizeStationName(journey.actualDestination)) : '';
            if (isForceTerminated && overrideActualDest) {
                actualDest = Renderer._applyUIIntercepts(normalizeStationName(overrideActualDest));
            }
            const normDest = Renderer._applyUIIntercepts(normalizeStationName(destination));
            
            let trainTitle = `Direct Train ${safeTrainName}`;
            let titleColor = "text-gray-900 dark:text-white";
            
            if (journey.isLastTrain) {
                trainTitle = `Direct Train ${safeTrainName}`;
                titleColor = "text-red-600 dark:text-red-400";
            }

            let detailLine = journey.arrivalTime ? `Arrives ${escapeHTML(formatTimeDisplay(journey.arrivalTime))}` : "Arrival time n/a.";
            let detailColor = "text-gray-700 dark:text-gray-300";

            if (actualDest && normDest && actualDest !== normDest) {
                detailLine = `Terminates at ${actualDest}`;
                detailColor = isForceTerminated ? "text-red-600 dark:text-red-400 font-black" : "text-orange-700 dark:text-orange-400 font-bold";
            }

            element.innerHTML = `
                <div class="flex flex-row items-stretch w-full space-x-3">
                    <!-- TIME BOX -->
                    <div class="relative w-1/2 h-auto min-h-[96px] flex flex-col justify-center items-center text-center p-1 pb-6 ${timeClass} rounded-lg shadow-sm flex-shrink-0 self-stretch">
                        <div class="text-2xl font-black text-gray-900 dark:text-white leading-tight">${safeDepTime}</div>
                        <div class="text-xs text-gray-700 dark:text-gray-300 font-bold">${timeDiffStr}</div>
                        ${sharedTag}
                        ${buttonHtml}
                    </div>
                    
                    <!-- DESCRIPTION BOX -->
                    <div class="w-1/2 h-auto min-h-[96px] flex flex-col justify-center items-center text-center p-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-hidden self-stretch">
                        <div class="text-[11px] font-bold ${titleColor} leading-tight mb-1 uppercase tracking-wide truncate w-full px-1 min-w-0" title="${trainTitle}">
                            ${trainTitle}
                        </div>
                        <div class="text-[10px] ${detailColor} leading-tight truncate w-full px-1 min-w-0" title="${detailLine}">
                            ${detailLine}
                        </div>
                        ${disruptionHtml}
                    </div>
                </div>
            `;
        } else if (journey.type === 'transfer') {
            const conn = journey.connection; 
            const nextFull = journey.nextFullJourney; 
            
            const rawDest = journey.train1.headboardDestination || journey.train1.terminationStation;
            const displayDest = Renderer._applyUIIntercepts(escapeHTML(rawDest));
            const arrivalAtTransfer = escapeHTML(formatTimeDisplay(journey.train1.arrivalAtTransfer));
            
            const connTrain = escapeHTML(conn.train);
            const connDest = Renderer._applyUIIntercepts(escapeHTML(conn.actualDestination));
            const connDep = escapeHTML(formatTimeDisplay(conn.departureTime));
            const finalDestTitle = Renderer._applyUIIntercepts(escapeHTML(destination));

            let train1Label = `Train ${safeTrainName}`;
            let titleColor = "text-gray-900 dark:text-white";
            if (journey.isLastTrain) titleColor = "text-red-600 dark:text-red-400";
            
            let bottomBlock = "";
            
            if (nextFull) {
                const nextTrain = escapeHTML(nextFull.train);
                const nextDep = escapeHTML(formatTimeDisplay(nextFull.departureTime));
                
                bottomBlock = `
                    <div class="text-[9px] leading-tight w-full space-y-1 min-w-0">
                        <div class="mb-1">
                             <div class="text-[11px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-0.5 truncate w-full">Connect Train ${connTrain}</div>
                             <div class="text-[9px] text-gray-600 dark:text-gray-400 font-bold truncate w-full">To ${connDest} <span class="font-normal opacity-80">(From ${connDep})</span></div>
                        </div>
                        <div class="italic text-gray-500 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700 pt-1 mt-1 truncate w-full" title="${finalDestTitle}: Train ${nextTrain} from ${nextDep}">
                            ${finalDestTitle}: Train ${nextTrain} from ${nextDep}
                        </div>
                    </div>
                `;
            } else {
                bottomBlock = `
                    <div class="text-[10px] leading-tight w-full min-w-0">
                        <div class="text-[11px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-0.5 truncate w-full">Connect Train ${connTrain}</div>
                        <div class="text-[9px] text-gray-600 dark:text-gray-400 font-bold truncate w-full">To ${connDest} <span class="font-normal opacity-80">(From ${connDep})</span></div>
                    </div>
                `;
            }
            
            element.innerHTML = `
                <div class="flex flex-row items-stretch w-full space-x-3">
                    <!-- TIME BOX -->
                    <div class="relative w-1/2 h-auto min-h-[110px] flex flex-col justify-center items-center text-center p-1 pb-6 ${timeClass} rounded-lg shadow-sm flex-shrink-0 self-stretch">
                        <div class="text-2xl font-black text-gray-900 dark:text-white leading-tight">${safeDepTime}</div>
                        <div class="text-xs text-gray-700 dark:text-gray-300 font-bold">${timeDiffStr}</div>
                        ${sharedTag}
                        ${buttonHtml}
                    </div>
                    
                    <!-- DESCRIPTION BOX -->
                    <div class="w-1/2 flex flex-col justify-center items-center text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg h-full min-h-[110px] overflow-hidden self-stretch">
                        <div class="border-b border-gray-200 dark:border-gray-700 pb-2 mb-2 w-full min-w-0">
                            <div class="text-[11px] font-black ${titleColor} uppercase tracking-wide mb-0.5 truncate w-full px-1" title="Shuttle ${train1Label}">Shuttle ${train1Label}</div>
                            <div class="text-[9px] text-gray-600 dark:text-gray-400 font-bold truncate w-full px-1" title="To ${displayDest} (Arr ${arrivalAtTransfer})">To ${displayDest} <span class="font-normal opacity-80">(Arr ${arrivalAtTransfer})</span></div>
                        </div>
                        ${bottomBlock}
                        ${disruptionHtml}
                    </div>
                </div>
            `;
        }
    },