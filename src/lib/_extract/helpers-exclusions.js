function formatEffectiveDate(rawDateStr) {
    if (!rawDateStr || String(rawDateStr).toLowerCase().includes("undefined") || rawDateStr === "null") return "Unknown";
    let cleanStr = String(rawDateStr).replace(/^last updated[:\s-]*/i, '').trim();
    try {
        if (cleanStr.includes(',')) cleanStr = cleanStr.split(',')[0].trim();
        const d = new Date(cleanStr);
        if (!isNaN(d.getTime())) {
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        }
    } catch(e) {}
    return cleanStr;
}

// NEW HELPER: Count shared stations between two routes
function getSharedStationCount(routeAId, routeBId) {
    let count = 0;
    for (const stationName in globalStationIndex) {
        const routes = globalStationIndex[stationName].routes;
        if (routes.has(routeAId) && routes.has(routeBId)) {
            count++;
        }
    }
    return count;
}

// NEW HELPER (V4.39): Get all future stations on the current route from a starting point
function getTargetStations(schedule, fromStation) {
    if (!schedule || !schedule.rows) return new Set();
    const rows = schedule.rows;
    const fromIdx = rows.findIndex(r => normalizeStationName(r.STATION) === normalizeStationName(fromStation));
    
    if (fromIdx === -1) return new Set();
    
    const targets = new Set();
    for (let i = fromIdx + 1; i < rows.length; i++) {
        targets.add(normalizeStationName(rows[i].STATION));
    }
    return targets;
}

// NEW HELPER (V4.39): Check if a shared train actually stops at any of our target future stations
function hasForwardOverlap(trainName, otherSchedule, fromStation, targetStations) {
    if (!otherSchedule || !otherSchedule.rows) return false;
    const rows = otherSchedule.rows;
    const fromIdx = rows.findIndex(r => normalizeStationName(r.STATION) === normalizeStationName(fromStation));
    
    if (fromIdx === -1) return false;

    for (let i = fromIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        // GUARDIAN BUGFIX: Safely cast to string to prevent .trim() crash on numeric cells
        const val = row[trainName] ? String(row[trainName]).trim() : "";
        if (val && val !== "-" && targetStations.has(normalizeStationName(row.STATION))) {
            return true;
        }
    }
    return false;
}

// GUARDIAN HELPER V4.60.70: Ghost Train Logic
function isTrainExcluded(trainNumber, routeId, dayIdx) {
    if (!trainNumber) return false;
    
    const rules = (globalExclusions && globalExclusions[routeId]) 
                  ? globalExclusions[routeId] 
                  : (typeof DEFAULT_EXCLUSIONS !== 'undefined' ? DEFAULT_EXCLUSIONS[routeId] : null);
    
    if (rules && rules[trainNumber]) {
        const rule = rules[trainNumber];
        
        // GUARDIAN PHASE C: Automatic Expiry Enforcement
        if (rule.expiresAt && Date.now() > rule.expiresAt) {
            return false; // The ban has expired, treat the train as active
        }
        
        if (rule.days && rule.days.includes(parseInt(dayIdx))) {
            // GUARDIAN PHASE 12: Return specific metadata string instead of generic boolean
            return rule.type || 'banned'; 
        }
    }
    return false;
}