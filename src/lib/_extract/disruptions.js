// --- GUARDIAN PHASE 3: CROSS-CORRIDOR TIERED INCIDENT MANAGEMENT HELPERS ---
window.checkDisruption = function(routeId, stationA, stationB) {
    if (!globalDisruptions) return null;
    
    let highestDisruption = null;
    const normA = normalizeStationName(stationA);
    const normB = normalizeStationName(stationB);

    const prioritizeDisruption = (current, incoming) => {
        if (!current) return incoming;
        if (incoming.tier === 'CRITICAL' && current.tier !== 'CRITICAL') return incoming;
        return current;
    };

    // GUARDIAN PHASE 3: Cross-Corridor Geometry Scan
    // We scan ALL disruptions across the entire network. If a disruption's coordinates
    // match the current commuter's route geometry, we apply it, regardless of the routeId it was filed under.
    for (const dRouteId in globalDisruptions) {
        const activeDisruptions = globalDisruptions[dRouteId];
        
        for (const d of activeDisruptions) {
            // If no specific stations are defined, it's a route-wide suspension.
            // This MUST strictly apply only to its parent route to avoid shutting down the whole app.
            if (!d.stations || d.stations.length === 0) {
                if (dRouteId === routeId) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
                continue;
            }

            const normDisruptedStations = d.stations.map(s => normalizeStationName(s));

            // Segment block (e.g., Centurion to Irene) - APPLIES UNIVERSALLY to any route crossing it
            if (normDisruptedStations.length >= 2) {
                if (normDisruptedStations.includes(normA) && normDisruptedStations.includes(normB)) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
            } 
            // Single station block - APPLIES UNIVERSALLY to any route touching it
            else if (normDisruptedStations.length === 1) {
                if (normDisruptedStations.includes(normA) || normDisruptedStations.includes(normB)) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
            }
        }
    }
    return highestDisruption;
};

// GUARDIAN PHASE 3 (ZONE ENGINE): Cross-Corridor "First Point of Contact" Calculation
window.getTripDisruptions = function(routeId, stopsArray) {
    if (!globalDisruptions || !stopsArray || stopsArray.length === 0) return [];
    
    const hits = [];
    const seenIds = new Set();
    
    // Helper: Extract the physical geometry (Master Station List) for this specific route.
    const getRouteMasterStations = (rId) => {
        if (!rId || !fullDatabase || !ROUTES[rId]) return [];
        const route = ROUTES[rId];
        // Prefer B-direction (outbound) to establish a consistent geographical array
        const key = route.sheetKeys.weekday_to_b || route.sheetKeys.weekday_to_a;
        if (!fullDatabase[key]) return [];
        return fullDatabase[key]
            .filter(r => r.STATION && !r.STATION.toLowerCase().includes('updated'))
            .map(r => normalizeStationName(r.STATION));
    };

    // The Master Geography for the current route being evaluated
    const currentRouteMasterStations = getRouteMasterStations(routeId);

    // Scan ALL active disruptions across the network (Cross-Corridor Scan)
    for (const dRouteId in globalDisruptions) {
        const activeDisruptions = globalDisruptions[dRouteId];
        
        for (const d of activeDisruptions) {
            if (seenIds.has(d.id)) continue;

            // 1. Route-Wide Advisory (0 Stations)
            // Strict limitation: Only applies if the commuter is actually ON the severed route
            if (!d.stations || d.stations.length === 0) {
                if (dRouteId === routeId) {
                    seenIds.add(d.id);
                    hits.push({
                        ...d,
                        triggerStopIndex: 0,
                        triggerStationA: stopsArray[0].station,
                        triggerStationB: stopsArray[stopsArray.length - 1].station
                    });
                }
                continue;
            }

            const normDisrupted = d.stations.map(s => normalizeStationName(s));

            // 2. Single Station Incident (Universal Match)
            if (normDisrupted.length === 1) {
                const targetNorm = normDisrupted[0];
                const contactIdx = stopsArray.findIndex(s => normalizeStationName(s.station) === targetNorm);
                
                if (contactIdx !== -1) {
                    seenIds.add(d.id);
                    hits.push({
                        ...d,
                        triggerStopIndex: contactIdx,
                        triggerStationA: d.stations[0],
                        triggerStationB: d.stations[0]
                    });
                }
                continue;
            }

            // 3. Multi-Station / Non-Adjacent "Danger Zone" Incident (Cross-Corridor Match)
            if (normDisrupted.length >= 2) {
                // We check the disruption geometry against the CURRENT ROUTE's master list
                const idxA = currentRouteMasterStations.indexOf(normDisrupted[0]);
                const idxB = currentRouteMasterStations.indexOf(normDisrupted[1]);

                // If BOTH stations exist on the current route, the Danger Zone intersects!
                if (idxA !== -1 && idxB !== -1) {
                    const minZone = Math.min(idxA, idxB);
                    const maxZone = Math.max(idxA, idxB);

                    let firstContactIdx = -1;
                    
                    // 🛡️ GUARDIAN PHASE 1 (VECTOR MATH): Trace the commuter's physical trip 
                    // to see if the directional vector CROSSES the Danger Zone, granting 
                    // immunity to trains moving away from the segment.
                    for (let i = 0; i < stopsArray.length - 1; i++) {
                        const stop1Idx = currentRouteMasterStations.indexOf(normalizeStationName(stopsArray[i].station));
                        const stop2Idx = currentRouteMasterStations.indexOf(normalizeStationName(stopsArray[i+1].station));
                        
                        if (stop1Idx !== -1 && stop2Idx !== -1) {
                            // Forward Traversal Check
                            if (stop1Idx <= minZone && stop2Idx >= maxZone) {
                                firstContactIdx = i;
                                break;
                            }
                            // Backward Traversal Check
                            if (stop1Idx >= maxZone && stop2Idx <= minZone) {
                                firstContactIdx = i;
                                break;
                            }
                        }
                    }

                    if (firstContactIdx !== -1) {
                        seenIds.add(d.id);
                        hits.push({
                            ...d,
                            triggerStopIndex: firstContactIdx,
                            triggerStationA: d.stations[0], 
                            triggerStationB: d.stations[1]  
                        });
                    }
                }
            }
        }
    }
    
    // Priority: CRITICAL events float to the top. Then sort by earliest contact index in the journey.
    hits.sort((a, b) => {
        if (a.tier === 'CRITICAL' && b.tier !== 'CRITICAL') return -1;
        if (a.tier !== 'CRITICAL' && b.tier === 'CRITICAL') return 1;
        return a.triggerStopIndex - b.triggerStopIndex;
    });
    
    return hits;
};