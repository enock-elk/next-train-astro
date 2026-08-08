function buildMasterStationList() {
    MASTER_STATION_LIST = Object.keys(globalStationIndex).sort();
    if (typeof renderPlannerHistory === 'function') renderPlannerHistory();
}

function calculateTimeDiffString(departureTimeStr, dayOffset = 0) {
    try {
        if (!departureTimeStr || typeof departureTimeStr !== 'string') return "";
        const [nowH, nowM, nowS] = currentTime.split(':').map(Number);
        const depParts = departureTimeStr.split(':').map(Number);
        if (depParts.length < 2) return ""; 
        const depH = depParts[0]; const depM = depParts[1]; const depS = depParts[2] || 0;
        let nowTotalSeconds = (nowH * 3600) + (nowM * 60) + nowS;
        let depTotalSeconds = (depH * 3600) + (depM * 60) + depS;
        let diffInSeconds = (depTotalSeconds - nowTotalSeconds) + (dayOffset * 86400);
        if (diffInSeconds < -30) return ""; 
        if (diffInSeconds < 60) return "(Departing now)";
        let diffInMinutes = Math.ceil(diffInSeconds / 60);
        const hours = Math.floor(diffInMinutes / 60);
        const minutes = diffInMinutes % 60;
        return (hours > 0) ? `(in ${hours} hr ${minutes} min)` : `(in ${minutes} min)`;
    } catch (e) { return ""; }
}

function resolveZoneForRoute(routeId) {
    if (!fullDatabase || !routeId || !ROUTES[routeId]) return null;
    const route = ROUTES[routeId];
    const keysToCheck = Object.values(route.sheetKeys);
    for (const key of keysToCheck) {
        const zoneVal = fullDatabase[key + "_zone"];
        if (zoneVal && FARE_CONFIG.zones[zoneVal]) return zoneVal; 
    }
    for (const key of keysToCheck) {
        if (key.includes('_to_')) {
            const parts = key.split('_to_');
            if (parts.length === 2) {
                const prefix = parts[0]; 
                const rest = parts[1];
                let suffix = "";
                let dest = "";
                if (rest.endsWith('_weekday')) { suffix = '_weekday'; dest = rest.replace('_weekday', ''); }
                else if (rest.endsWith('_saturday')) { suffix = '_saturday'; dest = rest.replace('_saturday', ''); }
                if (dest && suffix) {
                    const reverseKey = `${dest}_to_${prefix}${suffix}_zone`;
                    const reverseZone = fullDatabase[reverseKey];
                    if (reverseZone && FARE_CONFIG.zones[reverseZone]) return reverseZone;
                }
            }
        }
    }
    return null;
}

// 🛡️ GUARDIAN PHASE 1: REFACTORED FARE ENGINE (Train-Time Dependency Purged)
function getRouteFare(sheetKey) {
    // 🛡️ GUARDIAN BUGFIX: Race condition patch to prevent null access during initial load
    if (!fullDatabase) return null;
    
    let zoneCode = null;
    if (sheetKey) {
        const zoneKey = sheetKey + "_zone";
        zoneCode = fullDatabase[zoneKey];
    }
    if (!zoneCode && currentRouteId) {
        zoneCode = resolveZoneForRoute(currentRouteId);
    }
    if (!zoneCode || !FARE_CONFIG.zones[zoneCode]) return null; 

    let basePrice = FARE_CONFIG.zones[zoneCode];
    let discountLabel = null;
    let isPromo = false; 
    let isOffPeak = false; 

    const profile = FARE_CONFIG.profiles[currentUserProfile] || FARE_CONFIG.profiles["Adult"];
    let useOffPeakRate = false;

    // Off-peak 09:30–14:30 on weekdays only (unless FARE_CONFIG.offPeakEveryDay).
    const applyOffPeakEveryDay = FARE_CONFIG.offPeakEveryDay === true;
    let isWeekdaySheet = (currentDayType === 'weekday' || currentDayType === 'monday');
    if (sheetKey) {
        isWeekdaySheet = sheetKey.includes('weekday');
    }

    if (applyOffPeakEveryDay || isWeekdaySheet) {
        let checkH, checkM;

        // GUARDIAN PHASE 2A: Decouple Off-Peak pricing from individual train departures.
        // Strict adherence to global physical/simulated clock.
        if (typeof window.isSimMode !== 'undefined' && window.isSimMode && window.simTimeStr) {
            const parts = window.simTimeStr.split(':');
            checkH = parseInt(parts[0], 10);
            checkM = parseInt(parts[1], 10);
        } else if (typeof currentTime !== 'undefined' && currentTime && currentTime.includes(':')) {
            const parts = currentTime.split(':');
            checkH = parseInt(parts[0], 10);
            checkM = parseInt(parts[1], 10);
        } else {
            const now = new Date();
            checkH = now.getHours();
            checkM = now.getMinutes();
        }

        const decimalTime = checkH + (checkM / 60);
        if (decimalTime >= FARE_CONFIG.offPeakStart && decimalTime < FARE_CONFIG.offPeakEnd) {
            useOffPeakRate = true;
        }
    }

    const multiplier = useOffPeakRate ? profile.offPeak : profile.base;
    let finalPrice = basePrice * multiplier;
    finalPrice = Math.ceil(finalPrice * 2) / 2;

    // GUARDIAN FIX: Mutually exclusive Promo vs OffPeak flags to prevent UI collisions
    if (currentUserProfile === "Adult") {
        isPromo = false; // Adults only get the time-based green Off-Peak badge
        if (useOffPeakRate) {
            discountLabel = "40% Off-Peak";
        }
    } else if (multiplier < 1.0) {
        isPromo = true; // Special profiles get the purple Promo badge
        if (currentUserProfile === "Pensioner") discountLabel = "50% Off-Peak";
        else if (currentUserProfile === "Military") discountLabel = "50% Off-Peak";
        else if (currentUserProfile === "Scholar") discountLabel = "50% Discount";
        else discountLabel = "Discounted"; 
    }

    return {
        price: finalPrice.toFixed(2),
        isOffPeak: useOffPeakRate, 
        isPromo: isPromo,
        discountLabel: discountLabel 
    };
}

function getDetailedFare(sheetKey) {
    if (!fullDatabase) return null;
    let zoneCode = null;
    if (sheetKey) {
        const zoneKey = sheetKey + "_zone";
        zoneCode = fullDatabase[zoneKey];
    }
    if (!zoneCode && currentRouteId) {
        zoneCode = resolveZoneForRoute(currentRouteId);
    }
    if (!zoneCode) return null; 

    if (FARE_CONFIG.zones_detailed && FARE_CONFIG.zones_detailed[zoneCode]) {
        return { code: zoneCode, prices: FARE_CONFIG.zones_detailed[zoneCode] };
    }
    return null;
}