function findNearestStation(isAuto = false) {
    if (!navigator.geolocation) {
        if (!isAuto) showToast("Geolocation is not supported by your browser.", "error");
        if (!isAuto) stationSelect.value = "";
        return;
    }
    
    if (!isAuto) {
        showToast("Locating nearest station...", "info", 4000);
        const icon = locateBtn.querySelector('svg');
        if(icon) icon.classList.add('spinning');
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;
            
            let candidates = [];
            for (const [stationName, coords] of Object.entries(globalStationIndex)) {
                if (coords.routes.has(currentRouteId)) {
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
                const options = stationSelect.options;
                
                for (let i = 0; i < options.length; i++) {
                    if (normalizeStationName(options[i].value) === normalizeStationName(stationName)) {
                        stationSelect.selectedIndex = i;
                        stationSelect.value = options[i].value; 
                        matched = true;
                        break;
                    }
                }

                if (matched) {
                    if (typeof syncPlannerFromMain === 'function') {
                        syncPlannerFromMain(stationSelect.value);
                    }
                    
                    // GUARDIAN V6.21: Unified Dataset Sync logic absorbed from UI
                    const searchInput = document.getElementById('station-search-input');
                    if (searchInput) {
                        searchInput.value = stationSelect.value.replace(/ STATION/g, '');
                        searchInput.dataset.resolvedValue = stationSelect.value;
                    }
                    
                    findNextTrains(); 
                    if (!isAuto) {
                        showToast(`Found: ${stationName.replace(' STATION', '')} (${distStr}km)`, "success");
                    }

                    // GUARDIAN PHASE 1 (ANALYTICS): Inject 'auto_locate_success' event tracking
                    if (typeof trackAnalyticsEvent === 'function') {
                        trackAnalyticsEvent('auto_locate_success', {
                            station: stationName.replace(' STATION', ''),
                            route_id: currentRouteId,
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
                const icon = locateBtn.querySelector('svg');
                if(icon) icon.classList.remove('spinning');
            }
        },
        (error) => {
            if (!isAuto) {
                let msg = "Unable to retrieve location.";
                if (error.code === 1) msg = "Location permission denied.";
                // 🛡️ GUARDIAN UX FIX: Handle timeout specifically
                if (error.code === 3) msg = "Location request timed out."; 
                showToast(msg, "error");
                stationSelect.value = "";
                const icon = locateBtn.querySelector('svg');
                if(icon) icon.classList.remove('spinning');
            }
        },
        { timeout: 8000, enableHighAccuracy: true } // 🛡️ GUARDIAN UX FIX: 8s timeout to stop infinite underground hangs
    );
}

function populateStationList() {
    const stationSet = new Set();
    const hasTimes = (row) => { const keys = Object.keys(row); return keys.some(key => key !== 'STATION' && key !== 'COORDINATES' && key !== 'KM_MARK' && row[key] && row[key].trim() !== ""); };
    
    if (schedules.weekday_to_a && schedules.weekday_to_a.rows) schedules.weekday_to_a.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (schedules.weekday_to_b && schedules.weekday_to_b.rows) schedules.weekday_to_b.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (schedules.saturday_to_a && schedules.saturday_to_a.rows) schedules.saturday_to_a.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (schedules.saturday_to_b && schedules.saturday_to_b.rows) schedules.saturday_to_b.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });

    allStations = Array.from(stationSet);
    
    // GUARDIAN UX FIX: Sort by outbound (weekday_to_b) so Hubs (Dest A) appear naturally at the top
    if (schedules.weekday_to_b && schedules.weekday_to_b.rows) { 
        const orderMap = schedules.weekday_to_b.rows.map(r => r.STATION); 
        allStations.sort((a, b) => orderMap.indexOf(a) - orderMap.indexOf(b)); 
    } else if (schedules.weekday_to_a && schedules.weekday_to_a.rows) {
        // Safe fallback: If B is missing, sort by A but in reverse to maintain the Hub-Top flow
        const orderMap = schedules.weekday_to_a.rows.map(r => r.STATION); 
        allStations.sort((a, b) => orderMap.indexOf(b) - orderMap.indexOf(a));
    }
    
    const currentSelectedStation = stationSelect.value;
    
    stationSelect.innerHTML = '<option value="">Select a station...</option>';
    stationSelect.disabled = false; // GUARDIAN V6.1: Ensure enabled on populate
    
    allStations.forEach(station => {
        if (station && !station.toLowerCase().includes('last updated')) {
            const option = document.createElement('option');
            option.value = station;
            option.textContent = station.replace(/ STATION/g, '');
            stationSelect.appendChild(option);
        }
    });

    // GUARDIAN V6.21: Unified Dataset Sync logic absorbed from UI
    const searchInput = document.getElementById('station-search-input');
    if (allStations.includes(currentSelectedStation)) {
        stationSelect.value = currentSelectedStation; 
        if (searchInput) {
            searchInput.value = currentSelectedStation.replace(/ STATION/g, '');
            searchInput.dataset.resolvedValue = currentSelectedStation;
        }
    } else { 
        stationSelect.value = ""; 
        if (searchInput) {
            searchInput.value = "";
            delete searchInput.dataset.resolvedValue;
        }
    }
    
    // 🛡️ GUARDIAN UX FIX: Reactive Dropdown Engine
    // If the user already opened the dropdown while it was "Loading...", refresh it instantly now that data is here.
    const autocompleteList = document.getElementById('next-train-autocomplete-list');
    if (autocompleteList && !autocompleteList.classList.contains('hidden')) {
        if (typeof window._renderNextTrainList === 'function') {
            window._renderNextTrainList();
        }
    }
}