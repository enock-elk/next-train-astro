function findNextTrains() {
    if(!currentRouteId) return;

    const selectedStation = stationSelect.value;
    const currentRoute = ROUTES[currentRouteId];
    
    const isAtStation = (s1, s2) => normalizeStationName(s1) === normalizeStationName(s2);

    if (!currentRoute) return;
    
    // GUARDIAN V6.1: The Hoist - Strict Inactive Route Nuke
    // If the route is inactive, we destroy the UI and halt immediately.
    // This stops the R9.50 state bleed and removes ghost buttons.
    if (!currentRoute.isActive) { 
        const targetEl = typeof pretoriaTimeEl !== 'undefined' && pretoriaTimeEl ? pretoriaTimeEl : document.getElementById('pretoria-time');
        if(typeof renderComingSoon === 'function') renderComingSoon(targetEl, currentRoute.name); 
        
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
    
    const uiDestA = typeof Renderer !== 'undefined' ? Renderer._applyUIIntercepts(currentRoute.destA).toUpperCase() : currentRoute.destA.replace(' STATION', '').toUpperCase();
    const uiDestB = typeof Renderer !== 'undefined' ? Renderer._applyUIIntercepts(currentRoute.destB).toUpperCase() : currentRoute.destB.replace(' STATION', '').toUpperCase();

    pretoriaTimeEl.innerHTML = ""; pienaarspoortTimeEl.innerHTML = "";
    pretoriaHeader.innerHTML = `Next train to <span class="text-blue-500 dark:text-blue-400">${uiDestA}</span>`;
    pienaarspoortHeader.innerHTML = `Next train to <span class="text-blue-500 dark:text-blue-400">${uiDestB}</span>`;
    
    if (!selectedStation) { if(typeof renderPlaceholder === 'function') renderPlaceholder(); return; }
    
    if (!stationSelect.options[stationSelect.selectedIndex]) return;

    if (stationSelect.options[stationSelect.selectedIndex].textContent.includes("(No Service)")) {
        const msg = `<div class="h-32 flex flex-col justify-center items-center text-xl font-bold text-gray-600 dark:text-gray-400">No trains stop here.</div>`;
        pretoriaTimeEl.innerHTML = msg; pienaarspoortTimeEl.innerHTML = msg; return;
    }

    const currentODKey = `${currentRouteId}_${selectedStation}`;
    if (lastTrackedOD !== currentODKey && typeof trackAnalyticsEvent === 'function') {
        lastTrackedOD = currentODKey;
        trackAnalyticsEvent('od_matrix_view', {
            origin: selectedStation.replace(' STATION', ''),
            dest_a: currentRoute.destA.replace(' STATION', ''),
            dest_b: currentRoute.destB.replace(' STATION', ''),
            route_id: currentRouteId,
            time_of_search: currentTime,
            day_type: currentDayType,
            trip_type: 'live_board_view',
            region: currentRegion
        });
    }
    
    if (currentDayType === 'sunday') {
        if(typeof renderNoService === 'function') {
            if (isAtStation(selectedStation, currentRoute.destA)) {
                if(typeof renderAtDestination === 'function') renderAtDestination(pretoriaTimeEl);
            } else {
                renderNoService(pretoriaTimeEl, currentRoute.destA); 
            }
            if (isAtStation(selectedStation, currentRoute.destB)) {
                if(typeof renderAtDestination === 'function') renderAtDestination(pienaarspoortTimeEl);
            } else {
                renderNoService(pienaarspoortTimeEl, currentRoute.destB); 
            }
        }
        return;
    }

    let sharedRoutes = [];
    Object.values(ROUTES).forEach(r => {
        if (r.region === currentRegion && r.id !== currentRouteId && r.isActive && r.corridorId === currentRoute.corridorId) {
            sharedRoutes.push(r.id);
        }
    });

    if (fullDatabase && globalStationIndex[normalizeStationName(selectedStation)]) {
        const stationData = globalStationIndex[normalizeStationName(selectedStation)];
        stationData.routes.forEach(rId => {
            if (rId !== currentRouteId && ROUTES[rId].isActive && !sharedRoutes.includes(rId)) {
                sharedRoutes.push(rId);
            }
        });
    }

    sharedRoutes = sharedRoutes.filter(rId => getSharedStationCount(currentRouteId, rId) > 1);
    const sheetFamily = (currentDayType === 'weekday') ? 'weekday' : (currentDayType === 'public_holiday' && currentRoute.region === 'WC' ? 'pub' : 'saturday');
    let primarySheetKey = sheetFamily === 'weekday' ? currentRoute.sheetKeys.weekday_to_a : (sheetFamily === 'pub' ? (currentRoute.sheetKeys.pub_to_a || currentRoute.sheetKeys.saturday_to_a) : currentRoute.sheetKeys.saturday_to_a);

    // --- DESTINATION A ---
    if (isAtStation(selectedStation, currentRoute.destA)) {
        if(typeof renderAtDestination === 'function') renderAtDestination(pretoriaTimeEl);
    } else {
        const schedule = sheetFamily === 'weekday' ? schedules.weekday_to_a : (sheetFamily === 'pub' ? (schedules.pub_to_a || schedules.saturday_to_a) : schedules.saturday_to_a);
        const currentSheetKey = sheetFamily === 'weekday' ? currentRoute.sheetKeys.weekday_to_a : (sheetFamily === 'pub' ? (currentRoute.sheetKeys.pub_to_a || currentRoute.sheetKeys.saturday_to_a) : currentRoute.sheetKeys.saturday_to_a);
        const { allJourneys: currentJourneys } = findNextJourneyToDestA(selectedStation, "00:00:00", schedule, currentRoute, currentDayIndex);
        
        let mergedJourneys = currentJourneys.map(j => ({...j, sourceRoute: currentRoute.name, sheetKey: currentSheetKey}));
        const seenTrainsA = new Set(mergedJourneys.map(j => j.train || j.train1.train));
        const targetStationsA = getTargetStations(schedule, selectedStation);

        sharedRoutes.forEach(rId => {
            const otherRoute = ROUTES[rId];
            if (normalizeStationName(otherRoute.destA) === normalizeStationName(currentRoute.destA)) {
                const key = sheetFamily === 'weekday' ? otherRoute.sheetKeys.weekday_to_a : (sheetFamily === 'pub' ? (otherRoute.sheetKeys.pub_to_a || otherRoute.sheetKeys.saturday_to_a) : otherRoute.sheetKeys.saturday_to_a);
                const otherRows = fullDatabase[key];
                const otherMeta = fullDatabase[key + "_meta"];
                const otherSchedule = parseJSONSchedule(otherRows, otherMeta);
                const { allJourneys: otherJourneys } = findNextJourneyToDestA(selectedStation, "00:00:00", otherSchedule, otherRoute, currentDayIndex);
                
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

        const nowInSeconds = timeToSeconds(currentTime);
        const upcoming = mergedJourneys.find(j => timeToSeconds(j.departureTime || j.train1.departureTime) >= nowInSeconds);
        // GUARDIAN PHASE 1: Replaced Train-Time Dependency with Current Time hook
        if (upcoming) {
             if(typeof updateFareDisplay === 'function') updateFareDisplay(currentSheetKey, currentTime);
        } else {
             if(typeof updateFareDisplay === 'function') updateFareDisplay(primarySheetKey, currentTime);
        }

        if(typeof processAndRenderJourney === 'function') processAndRenderJourney(mergedJourneys, pretoriaTimeEl, pretoriaHeader, currentRoute.destA);
    }

    // --- DESTINATION B ---
    if (isAtStation(selectedStation, currentRoute.destB)) {
        if(typeof renderAtDestination === 'function') renderAtDestination(pienaarspoortTimeEl);
    } else {
        const schedule = sheetFamily === 'weekday' ? schedules.weekday_to_b : (sheetFamily === 'pub' ? (schedules.pub_to_b || schedules.saturday_to_b) : schedules.saturday_to_b);
        const currentSheetKey = sheetFamily === 'weekday' ? currentRoute.sheetKeys.weekday_to_b : (sheetFamily === 'pub' ? (currentRoute.sheetKeys.pub_to_b || currentRoute.sheetKeys.saturday_to_b) : currentRoute.sheetKeys.saturday_to_b);
        const { allJourneys: currentJourneys } = findNextJourneyToDestB(selectedStation, "00:00:00", schedule, currentRoute, currentDayIndex);

        let mergedJourneys = currentJourneys.map(j => ({...j, sourceRoute: currentRoute.name, sheetKey: currentSheetKey}));
        const seenTrainsB = new Set(mergedJourneys.map(j => j.train || j.train1.train));
        const targetStationsB = getTargetStations(schedule, selectedStation);

        sharedRoutes.forEach(rId => {
            const otherRoute = ROUTES[rId];
            
                 const key = sheetFamily === 'weekday' ? otherRoute.sheetKeys.weekday_to_b : (sheetFamily === 'pub' ? (otherRoute.sheetKeys.pub_to_b || otherRoute.sheetKeys.saturday_to_b) : otherRoute.sheetKeys.saturday_to_b);
                 const otherRows = fullDatabase[key];
                 const otherMeta = fullDatabase[key + "_meta"];
                 const otherSchedule = parseJSONSchedule(otherRows, otherMeta);
                 const { allJourneys: otherJourneys } = findNextJourneyToDestB(selectedStation, "00:00:00", otherSchedule, otherRoute, currentDayIndex);
                 
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

        if(typeof processAndRenderJourney === 'function') processAndRenderJourney(mergedJourneys, pienaarspoortTimeEl, pienaarspoortHeader, currentRoute.destB);
    }
}

function findNextJourneyToDestA(fromStation, timeNow, schedule, routeConfig, targetDayIdx = currentDayIndex) {
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

function findNextJourneyToDestB(fromStation, timeNow, schedule, routeConfig, targetDayIdx = currentDayIndex) {
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

function findNextDirectTrain(fromStation, schedule, destinationStation, targetDayIdx = currentDayIndex, routeId = currentRouteId) {
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

function findTransfers(fromStation, schedule, terminalStation, finalDestination, targetDayIdx = currentDayIndex, routeId = currentRouteId) {
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

function findConnections(arrivalTimeAtTransfer, schedule, connectionStation, finalDestination, incomingTrainName, targetDayIdx = currentDayIndex, routeId = currentRouteId) {
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