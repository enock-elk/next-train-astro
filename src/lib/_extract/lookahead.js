window.getLookaheadDayInfo = function(daysAhead = 1) {
    let baseDate = new Date();
    
    // Respect Developer Sim Mode Base Date
    if (typeof window.isSimMode !== 'undefined' && window.isSimMode) {
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
window.simulateNextActiveService = function(selectedStation, destination) {
    if (!currentRouteId || !ROUTES[currentRouteId]) return null;
    const currentRoute = ROUTES[currentRouteId];
    
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

        const schedule = schedules[sheetKey];
        
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