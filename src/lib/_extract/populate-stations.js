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

// GUARDIAN V6.1: Helper added to strictly handle Coming Soon visual state without bleeding into logic
function renderComingSoon(element, routeName) {
    if (typeof Renderer !== 'undefined') {
        if(element) Renderer.renderComingSoon(element, routeName);
    }
    if(stationSelect) {
        stationSelect.innerHTML = '<option>Coming Soon</option>';
        stationSelect.disabled = true;
    }
}

// GUARDIAN V6.1: Formatter applied here as final fallback
function updateLastUpdatedText() {
    if (!fullDatabase) return;
    let displayDate = fullDatabase.lastUpdated || "Unknown";
    const isValidDate = (d) => d && d !== "undefined" && d !== "null" && String(d).length > 5;
    
    if (currentDayType === 'weekday' || currentDayType === 'monday') { 
        if (schedules.weekday_to_a && isValidDate(schedules.weekday_to_a.lastUpdated)) displayDate = schedules.weekday_to_a.lastUpdated;
    } else if (currentDayType === 'saturday') {
        if (schedules.saturday_to_a && isValidDate(schedules.saturday_to_a.lastUpdated)) displayDate = schedules.saturday_to_a.lastUpdated;
    } else if (currentDayType === 'sunday') {
         if (schedules.weekday_to_a && isValidDate(schedules.weekday_to_a.lastUpdated)) displayDate = schedules.weekday_to_a.lastUpdated;
    }
    
    displayDate = formatEffectiveDate(displayDate);
    
    if (displayDate && lastUpdatedEl) lastUpdatedEl.textContent = `Schedule effective from: ${displayDate}`;
}

// Update the global clock
function updateTime() {
    try {
        let day, timeString;
        let dateToCheck = null; 
        const simActive = (typeof window.isSimMode !== 'undefined') ? window.isSimMode : false;
        
        if (simActive) {
            day = parseInt(window.simDayIndex || 1);
            timeString = window.simTimeStr || "12:00:00"; 
            const dateInput = document.getElementById('sim-date');
            if (dateInput && dateInput.value) {
                const parts = dateInput.value.split('-');
                if(parts.length === 3) dateToCheck = new Date(parts[0], parts[1] - 1, parts[2]);
            } 
        } else {
            const now = new Date();
            day = now.getDay(); 
            // Manual padding inside updateTime since pad() was historically used here
            const p = n => (n < 10 ? '0' + n : n);
