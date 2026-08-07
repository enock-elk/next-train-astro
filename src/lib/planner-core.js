/**
 * METRORAIL NEXT TRAIN - PLANNER CORE (V7_06.17 - Astro MPA Migration)
 * ----------------------------------------------------------------
 * THE "SOUS-CHEF" (Brain)
 * * This module contains PURE LOGIC for route calculation.
 * * It has been migrated to an ESM Module utilizing Nano Stores for global state.
 */

import { $isSimMode, $userRegion, $fullDatabase, $globalStationIndex, $globalDisruptions } from '../store.js';
import { ROUTES, SPECIAL_DATES } from './config.js';
import { resolveHolidayDayType } from './holiday-approvals.js';
import { normalizeStationName, timeToSeconds, normalizeScheduleSheetDay } from './utils.js';
import {
    getScheduleFromDb,
    currentTime as logicCurrentTime,
    currentDayType as logicCurrentDayType,
    currentDayIndex as logicCurrentDayIndex,
} from './logic.js';
import { getLookaheadDayInfo, isTrainExcluded } from './live-board.js';

/** Sheet day used for timetable lookups — Sunday has no sheets; public holidays use Saturday. */
function scheduleDayType(dayType) {
    return normalizeScheduleSheetDay(dayType);
}

// SPA used script-scope globals. Prefer live window clock when the boot clock
// has written it; otherwise fall back to the logic.js module exports — never a
// hard-coded weekday/noon stub that invents "no service" on a real Monday.
const getCurrentDayType = () =>
    (typeof window !== 'undefined' && window.currentDayType) ? window.currentDayType : (logicCurrentDayType || 'weekday');
const getCurrentDayIndex = () =>
    (typeof window !== 'undefined' && window.currentDayIndex !== undefined)
        ? window.currentDayIndex
        : (logicCurrentDayIndex ?? 1);
const getCurrentTime = () =>
    (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : (logicCurrentTime || '12:00:00');

// --- 1. LEGACY CORE ALGORITHMS (Preserved for Safety & Exhaustive Fallbacks) ---

export function planDirectTrip(origin, dest, dayType, isRollover = false, context = {}) {
    const index = $globalStationIndex.get();
    const originRoutes = index[normalizeStationName(origin)]?.routes || new Set();
    const destRoutes = index[normalizeStationName(dest)]?.routes || new Set();
    const commonRoutes = [...originRoutes].filter(x => destRoutes.has(x));

    if (commonRoutes.length === 0) return { status: 'NO_PATH', trips: [] };

    let bestTrips = [];
    let pathFoundToday = false;
    let pathExistsGenerally = false;
    const db = $fullDatabase.get();

    for (const routeId of commonRoutes) {
        const routeConfig = ROUTES[routeId];
        const directions = getDirectionsForRoute(routeConfig, dayType);
        
        for (let dir of directions) {
            if (!db || !db[dir.key]) continue;
            const schedule = getScheduleFromDb(db, dir.key);
            const originRow = schedule.rows.find(r => normalizeStationName(r.STATION) === normalizeStationName(origin));
            const destRow = schedule.rows.find(r => normalizeStationName(r.STATION) === normalizeStationName(dest));

            if (originRow && destRow) {
                const originIdx = schedule.rows.indexOf(originRow);
                const destIdx = schedule.rows.indexOf(destRow);
                if (originIdx < destIdx) {
                    pathFoundToday = true; 
                    pathExistsGenerally = true;
                    const upcomingTrains = findUpcomingTrainsForLeg(schedule, originRow, destRow, dayType, true, routeId, context); 
                    if (upcomingTrains.length > 0) {
                        bestTrips = [...bestTrips, ...upcomingTrains.map(info => 
                            createTripObject(routeConfig, info, schedule, originIdx, destIdx, origin, dest)
                        )];
                    }
                }
            }
        }
    }

    if (bestTrips.length > 0) return { status: 'FOUND', trips: bestTrips.sort((a,b) => timeToSeconds(a.depTime) - timeToSeconds(b.depTime)) };
    return { status: (pathExistsGenerally || pathFoundToday) ? 'NO_SERVICE' : 'NO_PATH', trips: [] };
}

export function planHubTransferTrip(origin, dest, dayType, isRollover = false, context = {}) {
    const index = $globalStationIndex.get();
    const originRoutes = index[normalizeStationName(origin)]?.routes || new Set();
    const destRoutes = index[normalizeStationName(dest)]?.routes || new Set();
    const allKnownHubs = getDynamicHubs(); 
    
    const potentialHubs = allKnownHubs.filter(hub => {
        const hubData = index[normalizeStationName(hub)];
        if (!hubData) return false;
        const toHub = [...originRoutes].some(rId => hubData.routes.has(rId));
        const fromHub = [...destRoutes].some(rId => hubData.routes.has(rId));
        const isTrivial = (normalizeStationName(hub) === normalizeStationName(origin)) || (normalizeStationName(hub) === normalizeStationName(dest));
        if (!toHub || !fromHub || isTrivial) return false;
        return true;
    });

    if (potentialHubs.length === 0) return { status: 'NO_PATH', trips: [] };

    let allTransferOptions = [];
    
    for (const hub of potentialHubs) {
        const leg1Options = findAllLegsWithRelayExpansion(origin, hub, originRoutes, dayType, context);
        if (leg1Options.length === 0) continue;
        const leg2Options = findAllLegsWithRelayExpansion(hub, dest, destRoutes, dayType, context); 
        if (leg2Options.length === 0) continue;

        const TRANSFER_BUFFER_SEC = 0; 
        const MAX_HUB_WAIT_SEC = 1080 * 60; 

        leg1Options.forEach(leg1 => {
            const arrivalSec = timeToSeconds(leg1.arrTime);
            leg2Options.forEach(leg2 => {
                if (leg1.route.id === leg2.route.id && !leg2.isRelayComposite && !leg1.isRelayComposite) return; 
                if (isTrainFasterDirect(leg1.route, leg1.train, dest, dayType, leg2.arrTime)) return; 
                if (!isPathLogical(leg1, leg2, dest)) return;

                const departSec = timeToSeconds(leg2.depTime);
                const waitTime = departSec - arrivalSec;

                if (waitTime >= TRANSFER_BUFFER_SEC && waitTime <= MAX_HUB_WAIT_SEC) {
                    allTransferOptions.push({
                        type: 'TRANSFER',
                        route: leg1.route, 
                        from: origin, to: dest,
                        transferStation: hub,
                        depTime: leg1.depTime, arrTime: leg2.arrTime,
                        train: leg1.train, leg1: leg1, leg2: leg2,
                        totalDuration: (timeToSeconds(leg2.arrTime) - timeToSeconds(leg1.depTime))
                    });
                }
            });
        });
    }

    let unique = [];
    if (allTransferOptions.length > 0) {
        allTransferOptions.sort((a,b) => {
            const depDiff = timeToSeconds(a.depTime) - timeToSeconds(b.depTime);
            return depDiff !== 0 ? depDiff : a.totalDuration - b.totalDuration;
        });
        const seenKeys = new Set();
        allTransferOptions.forEach(opt => {
            const key = `${opt.depTime}|${normalizeStationName(opt.transferStation)}`;
            if (!seenKeys.has(key)) { seenKeys.add(key); unique.push(opt); }
        });
    }

    if (unique.length > 0) return { status: 'FOUND', trips: unique };
    return { status: 'NO_PATH', trips: [] };
}

export function planRelayTransferTrip(origin, dest, dayType, isRollover = false, context = {}) {
    const index = $globalStationIndex.get();
    const originRoutes = index[normalizeStationName(origin)]?.routes || new Set();
    const destRoutes = index[normalizeStationName(dest)]?.routes || new Set();
    const commonRoutes = [...originRoutes].filter(x => destRoutes.has(x));
    let allRelayTrips = [];

    if (commonRoutes.length > 0) {
        commonRoutes.forEach(routeId => {
            const routeConfig = ROUTES[routeId];
            if (!routeConfig.relayStation) return;

            const relayStationName = normalizeStationName(routeConfig.relayStation);
            const legs1 = findAllLegsBetween(origin, relayStationName, new Set([routeId]), dayType, context);
            if (legs1.length === 0) return;

            const legs2 = findAllLegsBetween(relayStationName, dest, new Set([routeId]), dayType, context);
            if (legs2.length === 0) return;

            const TRANSFER_BUFFER_SEC = 0; 
            const MAX_WAIT_SEC = 240 * 60; 

            legs1.forEach(l1 => {
                const arr1 = timeToSeconds(l1.arrTime);
                legs2.forEach(l2 => {
                    const dep2 = timeToSeconds(l2.depTime);
                    const wait = dep2 - arr1;

                    if (wait >= TRANSFER_BUFFER_SEC && wait <= MAX_WAIT_SEC) {
                        if (l1.train === l2.train) {
                            allRelayTrips.push({
                                type: 'DIRECT', route: routeConfig, from: origin, to: dest,
                                depTime: l1.depTime, arrTime: l2.arrTime, train: l1.train,
                                stops: [...(l1.stops || []), ...(l2.stops || []).slice(1)],
                                totalDuration: (timeToSeconds(l2.arrTime) - timeToSeconds(l1.depTime))
                            });
                        } else {
                            allRelayTrips.push({
                                type: 'TRANSFER', route: routeConfig, from: origin, to: dest,
                                transferStation: routeConfig.relayStation,
                                depTime: l1.depTime, arrTime: l2.arrTime, train: l1.train, leg1: l1, leg2: l2,
                                totalDuration: (timeToSeconds(l2.arrTime) - timeToSeconds(l1.depTime))
                            });
                        }
                    }
                });
            });
        });
    }

    return { trips: allRelayTrips };
}

export function planMacroCorridorTrip(origin, dest, dayType, isRollover = false, context = {}) {
    if ($userRegion.get() !== 'GP') return { trips: [] };

    const index = $globalStationIndex.get();
    const originRoutes = index[normalizeStationName(origin)]?.routes || new Set();
    const destRoutes = index[normalizeStationName(dest)]?.routes || new Set();
    
    const jhbLines = ['JHB_CORE', 'JHB_EAST', 'JHB_WEST', 'JHB_SOUTH'];
    const ptaLines = ['SOUTH_LINE', 'NORTH_LINE', 'EAST_LINE', 'SAUL_LINE', 'SPECIAL'];
    const eastLines = ['EAST_LINE'];
    const northLines = ['NORTH_LINE'];

    const hasLine = (routes, linesArray) => {
        for (const rId of routes) {
            if (ROUTES[rId] && linesArray.includes(ROUTES[rId].corridorId)) return true;
        }
        return false;
    };

    let trips = [];

    const macros = [
        { condition: hasLine(originRoutes, jhbLines) && hasLine(destRoutes, ptaLines), h1: 'GERMISTON', h2: 'KEMPTON PARK', bridgeId: 'germ-leralla' },
        { condition: hasLine(originRoutes, ptaLines) && hasLine(destRoutes, jhbLines), h1: 'KEMPTON PARK', h2: 'GERMISTON', bridgeId: 'germ-leralla' },
        { condition: hasLine(originRoutes, eastLines) && hasLine(destRoutes, northLines) && !originRoutes.has('herc-koed') && !destRoutes.has('herc-koed'), h1: 'KOEDOESPOORT', h2: 'HERCULES', bridgeId: 'herc-koed' },
        { condition: hasLine(originRoutes, northLines) && hasLine(destRoutes, eastLines) && !originRoutes.has('herc-koed') && !destRoutes.has('herc-koed'), h1: 'HERCULES', h2: 'KOEDOESPOORT', bridgeId: 'herc-koed' }
    ];

    let matchedAny = false;

    for (const macro of macros) {
        if (macro.condition) {
            matchedAny = true;
            const bridgeRoute = ROUTES[macro.bridgeId];
            if (!bridgeRoute || !bridgeRoute.isActive) continue;

            for (const r1 of originRoutes) {
                if (!index[macro.h1]?.routes.has(r1)) continue;
                for (const r3 of destRoutes) {
                    if (!index[macro.h2]?.routes.has(r3)) continue;
                    const newTrips = calculateThreeLegTrip(origin, macro.h1, macro.h2, dest, ROUTES[r1], bridgeRoute, ROUTES[r3], dayType, context);
                    trips = [...trips, ...newTrips];
                }
            }
        }
    }
    
    if (!matchedAny || trips.length === 0) return { trips: [] };
    if (trips.length > 0) trips.sort((a,b) => timeToSeconds(a.arrTime) - timeToSeconds(b.arrTime));
    return { trips };
}

export function planDoubleTransferTrip(origin, dest, dayType, isRollover = false, context = {}) {
    if ($userRegion.get() !== 'GP') return { status: 'NO_PATH', trips: [] };

    const index = $globalStationIndex.get();
    const originRoutes = index[normalizeStationName(origin)]?.routes || new Set();
    const destRoutes = index[normalizeStationName(dest)]?.routes || new Set();
    const allRouteIds = Object.keys(ROUTES).filter(id => ROUTES[id].isActive);
    let potentialTrips = [];

    for (const startRouteId of originRoutes) {
        for (const endRouteId of destRoutes) {
            if (startRouteId === endRouteId) continue;
            for (const bridgeRouteId of allRouteIds) {
                if (bridgeRouteId === startRouteId || bridgeRouteId === endRouteId) continue;
                const hubs1 = findIntersections(startRouteId, bridgeRouteId);
                if (hubs1.length === 0) continue;
                const hubs2 = findIntersections(bridgeRouteId, endRouteId);
                if (hubs2.length === 0) continue;

                for (const hub1 of hubs1) {
                    for (const hub2 of hubs2) {
                        if (normalizeStationName(hub1) === normalizeStationName(hub2)) continue;
                        const trips = calculateThreeLegTrip(origin, hub1, hub2, dest, ROUTES[startRouteId], ROUTES[bridgeRouteId], ROUTES[endRouteId], dayType, context);
                        potentialTrips = [...potentialTrips, ...trips];
                    }
                }
            }
        }
    }

    if (potentialTrips.length > 0) potentialTrips.sort((a,b) => timeToSeconds(a.arrTime) - timeToSeconds(b.arrTime));
    if (potentialTrips.length > 0) return { status: 'FOUND', trips: potentialTrips };
    return { status: 'NO_PATH', trips: [] };
}

// --- 2. LOGIC HELPERS ---

export function getDynamicHubs() {
    const index = $globalStationIndex.get();
    if (!index) return [];
    
    const explicitHubs = new Set();
    Object.values(ROUTES).forEach(r => {
        if(r.isActive && r.transferStation) explicitHubs.add(normalizeStationName(r.transferStation));
    });

    const dynamicHubs = [];
    Object.entries(index).forEach(([stationName, data]) => {
        if (data.routes && data.routes.size > 1) dynamicHubs.push(stationName);
        else if (explicitHubs.has(stationName)) dynamicHubs.push(stationName);
    });

    return dynamicHubs;
}

export function isTrainFasterDirect(route, trainName, targetStation, dayType, limitTime) {
    if (!route || !trainName || !targetStation) return false;
    const directions = getDirectionsForRoute(route, dayType);
    const db = $fullDatabase.get();
    
    for (let dir of directions) {
        if (!db || !db[dir.key]) continue;
        const schedule = getScheduleFromDb(db, dir.key);
        const targetRow = schedule.rows.find(r => normalizeStationName(r.STATION) === normalizeStationName(targetStation));
        
        if (targetRow && targetRow[trainName]) {
            if (limitTime === null) return true;
            const directArr = timeToSeconds(targetRow[trainName]);
            const limitArr = timeToSeconds(limitTime);
            if (directArr <= limitArr) return true; 
        }
    }
    return false;
}

export function isPathLogical(leg1, leg2, finalDest) {
    if (!leg1.stops || !leg2.stops) return true; 
    const normDest = normalizeStationName(finalDest);
    const hubName = normalizeStationName(leg1.to); 

    const leg1Stations = new Set();
    for (const stop of leg1.stops) {
        const sName = normalizeStationName(stop.station);
        if (sName === normDest && sName !== hubName) return false; 
        leg1Stations.add(sName);
    }

    for (const stop of leg2.stops) {
        const sName = normalizeStationName(stop.station);
        if (sName !== hubName && leg1Stations.has(sName)) return false; 
    }

    return true;
}

export function findAllLegsWithRelayExpansion(stationA, stationB, routeSet, dayType, context = {}) {
    let allLegs = [];
    const routesToCheck = routeSet ? [...routeSet] : Object.keys(ROUTES);

    for (const rId of routesToCheck) {
        const routeConfig = ROUTES[rId];
        let directLegs = findAllLegsBetween(stationA, stationB, new Set([rId]), dayType, context);
        allLegs = [...allLegs, ...directLegs];

        if (routeConfig.relayStation) {
            const relay = normalizeStationName(routeConfig.relayStation);
            if (normalizeStationName(stationA) === relay || normalizeStationName(stationB) === relay) continue;

            const legsToRelay = findAllLegsBetween(stationA, relay, new Set([rId]), dayType, context);
            if (legsToRelay.length > 0) {
                const legsFromRelay = findAllLegsBetween(relay, stationB, new Set([rId]), dayType, context);
                if (legsFromRelay.length > 0) {
                    const TRANSFER_BUFFER_SEC = 0; 
                    const MAX_RELAY_WAIT = 1080 * 60; 

                    legsToRelay.forEach(l1 => {
                        const arr1 = timeToSeconds(l1.arrTime);
                        legsFromRelay.forEach(l2 => {
                            const dep2 = timeToSeconds(l2.depTime);
                            const wait = dep2 - arr1;
                            
                            if (wait >= TRANSFER_BUFFER_SEC && wait <= MAX_RELAY_WAIT) {
                                if (l1.train === l2.train) {
                                    allLegs.push({
                                        ...l1, to: stationB, arrTime: l2.arrTime, actualDestination: l2.actualDestination,
                                        stops: [...l1.stops, ...l2.stops.slice(1)]
                                    });
                                } else {
                                    allLegs.push({
                                        ...l1, to: stationB, arrTime: l2.arrTime, actualDestination: l2.actualDestination,
                                        isRelayComposite: true, stops: [...l1.stops, ...l2.stops],
                                        internalTransfer: { station: relay, train1: l1.train, train2: l2.train, wait: wait }
                                    });
                                }
                            }
                        });
                    });
                }
            }
        }
    }
    return allLegs;
}

export function findIntersections(routeAId, routeBId) {
    const intersections = [];
    const index = $globalStationIndex.get();
    for (const [stationName, data] of Object.entries(index)) {
        if (data.routes.has(routeAId) && data.routes.has(routeBId)) {
            intersections.push(stationName);
        }
    }
    return intersections;
}

export function calculateThreeLegTrip(origin, hub1, hub2, dest, route1, route2, route3, dayType, context = {}) {
    const TRANSFER_BUFFER_SEC = 0; 
    const MAX_WAIT_SEC = 1080 * 60; 

    const legs1 = findAllLegsBetween(origin, hub1, new Set([route1.id]), dayType, context);
    if (legs1.length === 0) return [];
    const legs2 = findAllLegsBetween(hub1, hub2, new Set([route2.id]), dayType, context);
    if (legs2.length === 0) return [];
    const legs3 = findAllLegsBetween(hub2, dest, new Set([route3.id]), dayType, context);
    if (legs3.length === 0) return [];

    const trips = [];

    for (const l1 of legs1) {
        const earliestLeg2Dep = legs2.length > 0 ? legs2.reduce((min, l) => Math.min(min, timeToSeconds(l.depTime)), Infinity) : Infinity;
        const leg2DepTimeStr = earliestLeg2Dep !== Infinity ? legs2.find(l => timeToSeconds(l.depTime) === earliestLeg2Dep)?.depTime : null;

        if (leg2DepTimeStr && isTrainFasterDirect(l1.route, l1.train, hub2, dayType, leg2DepTimeStr)) continue; 

        const arr1 = timeToSeconds(l1.arrTime);
        const validLegs2 = legs2.filter(l2 => {
            const dep2 = timeToSeconds(l2.depTime);
            return dep2 >= arr1 + TRANSFER_BUFFER_SEC && dep2 <= arr1 + MAX_WAIT_SEC;
        });

        for (const l2 of validLegs2) {
            const earliestLeg3Dep = legs3.length > 0 ? legs3.reduce((min, l) => Math.min(min, timeToSeconds(l.depTime)), Infinity) : Infinity;
            const leg3DepTimeStr = earliestLeg3Dep !== Infinity ? legs3.find(l => timeToSeconds(l.depTime) === earliestLeg3Dep)?.depTime : null;

            if (leg3DepTimeStr && isTrainFasterDirect(l2.route, l2.train, dest, dayType, leg3DepTimeStr)) continue;

            const arr2 = timeToSeconds(l2.arrTime);
            const validLegs3 = legs3.filter(l3 => {
                const dep3 = timeToSeconds(l3.depTime);
                return dep3 >= arr2 + TRANSFER_BUFFER_SEC && dep3 <= arr2 + MAX_WAIT_SEC;
            });

            for (const l3 of validLegs3) {
                trips.push({
                    type: 'DOUBLE_TRANSFER',
                    from: origin, to: dest,
                    depTime: l1.depTime, arrTime: l3.arrTime,
                    totalDuration: timeToSeconds(l3.arrTime) - timeToSeconds(l1.depTime),
                    train: l1.train, 
                    leg1: l1, hub1: hub1, leg2: l2, hub2: hub2, leg3: l3,
                    routePath: [route1.name, route2.name, route3.name]
                });
            }
        }
    }
    return trips;
}

export function findAllLegsBetween(stationA, stationB, routeSet, dayType, context = {}) {
    let legs = [];
    const routesToCheck = routeSet ? [...routeSet] : Object.keys(ROUTES);
    const db = $fullDatabase.get();

    for (const rId of routesToCheck) {
        const routeConfig = ROUTES[rId];
        let directions = getDirectionsForRoute(routeConfig, dayType);
        for (let dir of directions) {
            if (!db || !db[dir.key]) continue;
            const schedule = getScheduleFromDb(db, dir.key);
            const rowA = schedule.rows.find(r => normalizeStationName(r.STATION) === normalizeStationName(stationA));
            const rowB = schedule.rows.find(r => normalizeStationName(r.STATION) === normalizeStationName(stationB));
            if (rowA && rowB) {
                const idxA = schedule.rows.indexOf(rowA);
                const idxB = schedule.rows.indexOf(rowB);
                if (idxA < idxB) {
                    findUpcomingTrainsForLeg(schedule, rowA, rowB, dayType, true, rId, context).forEach(t => {
                        legs.push(createTripObject(routeConfig, t, schedule, idxA, idxB, stationA, stationB));
                    });
                }
            }
        }
    }
    return legs;
}

export function getDirectionsForRoute(route, dayType) {
    if (!route?.sheetKeys) return [];
    // Sunday has no dedicated sheets — connectivity / graph builds use weekday.
    // planUnifiedTrip still short-circuits real Sunday planning via SUNDAY_SKIP.
    const sheetDay = scheduleDayType(dayType);
    if (sheetDay === 'saturday') {
        return [
            { key: route.sheetKeys.saturday_to_a },
            { key: route.sheetKeys.saturday_to_b },
        ].filter((d) => !!d.key);
    }
    return [
        { key: route.sheetKeys.weekday_to_a },
        { key: route.sheetKeys.weekday_to_b },
    ].filter((d) => !!d.key);
}

export function createTripObject(route, trainInfo, schedule, startIdx, endIdx, origin, dest) {
    let actualDest = dest;
    if (schedule && schedule.rows && schedule.rows.length > 0) {
        const lastRow = schedule.rows[schedule.rows.length - 1];
        if (lastRow && lastRow.STATION) actualDest = lastRow.STATION;
    }

    return {
        type: 'DIRECT', route: route, from: origin, to: dest,
        train: trainInfo.trainName, depTime: trainInfo.depTime, arrTime: trainInfo.arrTime,
        actualDestination: actualDest,
        stops: (schedule && startIdx !== undefined) ? getIntermediateStops(schedule, startIdx, endIdx, trainInfo.trainName) : []
    };
}

export function findUpcomingTrainsForLeg(schedule, originRow, destRow, dayType, allowPast = false, routeId = null, context = {}) {
    const isToday = (dayType === getCurrentDayType());
    const nowSeconds = (isToday && !allowPast && !context.zeroHourProbeActive) ? timeToSeconds(getCurrentTime()) : 0; 
    
    let exclusionDayIdx = 1; 
    if (context.targetDayIdx !== undefined) {
        exclusionDayIdx = context.targetDayIdx;
    } else if (isToday) {
        exclusionDayIdx = getCurrentDayIndex();
    } else {
        if (dayType === 'saturday' || dayType === 'public_holiday') exclusionDayIdx = 6;
        if (dayType === 'sunday') exclusionDayIdx = 0;
    }

    let upcomingTrains = [];
    schedule.headers.slice(1).forEach(trainName => {
        if (routeId && isTrainExcluded(trainName, routeId, exclusionDayIdx)) return;
        const depTime = originRow[trainName], arrTime = destRow[trainName];
        if (depTime && arrTime) {
            const depSeconds = timeToSeconds(depTime);
            if (depSeconds >= nowSeconds) upcomingTrains.push({ trainName, depTime, arrTime, seconds: depSeconds });
        }
    });
    return upcomingTrains.sort((a, b) => a.seconds - b.seconds);
}

export function getIntermediateStops(schedule, startIndex, endIndex, trainName) {
    let stops = [];
    for (let i = startIndex; i <= endIndex; i++) {
        const row = schedule.rows[i];
        let t = row[trainName];
        if (!t || String(t).trim() === "" || String(t).trim() === "-") t = "---";
        stops.push({ station: row.STATION, time: t });
    }
    return stops;
}


// -----------------------------------------------------------------------------
// SECTION 3: TRUE TIME-DEPENDENT DIJKSTRA ENGINE (WITH TRAIN-BOUND STATE)
// -----------------------------------------------------------------------------

export class TransitMinHeap {
    constructor() { this._h = []; }
    push(p, v) { this._h.push([p, v]); this._up(this._h.length - 1); }
    pop() {
        if (this._h.length === 0) return null;
        const top  = this._h[0];
        const last = this._h.pop();
        if (this._h.length > 0) { this._h[0] = last; this._down(0); }
        return top;
    }
    get size() { return this._h.length; }
    _up(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this._h[p][0] <= this._h[i][0]) break;
            [this._h[p], this._h[i]] = [this._h[i], this._h[p]];
            i = p;
        }
    }
    _down(i) {
        const n = this._h.length;
        for (;;) {
            let s = i, l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this._h[l][0] < this._h[s][0]) s = l;
            if (r < n && this._h[r][0] < this._h[s][0]) s = r;
            if (s === i) break;
            [this._h[s], this._h[i]] = [this._h[i], this._h[s]];
            i = s;
        }
    }
}

export function buildTransitGraph(dayType, dayIdx) {
    const graph = new Map();
    const db = $fullDatabase.get();

    for (const [routeId, routeConfig] of Object.entries(ROUTES)) {
        if (!routeConfig.isActive) continue;
        const directions = getDirectionsForRoute(routeConfig, dayType);

        for (const dir of directions) {
            if (!db || !db[dir.key]) continue;
            const schedule = getScheduleFromDb(db, dir.key);
            const rows     = schedule.rows;

            for (const trainName of schedule.headers.slice(1)) {
                if (isTrainExcluded(trainName, routeId, dayIdx)) continue;

                for (let i = 0; i < rows.length - 1; i++) {
                    const rawDep = rows[i][trainName];
                    if (!rawDep || String(rawDep).trim() === '' || String(rawDep).trim() === '-') continue;

                    const fromStation = normalizeStationName(rows[i].STATION);
                    const depTime     = String(rawDep).trim();
                    const depSec      = timeToSeconds(depTime);

                    for (let j = i + 1; j < rows.length; j++) {
                        const rawArr = rows[j][trainName];
                        if (!rawArr || String(rawArr).trim() === '' || String(rawArr).trim() === '-') continue;

                        const toStation = normalizeStationName(rows[j].STATION);
                        const arrTime   = String(rawArr).trim();
                        const arrSec    = timeToSeconds(arrTime);

                        if (!graph.has(fromStation)) graph.set(fromStation, []);
                        graph.get(fromStation).push({
                            to: toStation,
                            depSec, arrSec, depTime, arrTime,
                            train: trainName, routeId, routeConfig, schedule,
                            fromIdx: i, toIdx: j
                        });

                        break; 
                    }
                }
            }
        }
    }
    return graph;
}

export function dijkstraPlanCore(normOrigin, normDest, graph, startSec, bannedEdges = new Set(), isRolloverLoop = false) {
    const INF = Infinity;
    const dist = new Map(); 
    const prev = new Map();

    const pq = new TransitMinHeap();
    pq.push(startSec, { station: normOrigin, train: null, transfers: 0, curSec: startSec, visited: new Set([normOrigin]) });
    dist.set(`${normOrigin}|null`, startSec);

    let bestDestScore = INF;
    let bestDestState = null;

    while (pq.size > 0) {
        const [score, state] = pq.pop();
        const { station, train, transfers, curSec, visited } = state;

        if (station === normDest) {
            if (score < bestDestScore) {
                bestDestScore = score;
                bestDestState = state;
            }
            continue; 
        }

        if (score > bestDestScore) break;

        const edges = graph.get(station);
        if (!edges) continue;

        for (const edge of edges) {
            if (bannedEdges.has(`ROUTE:${edge.routeId}`)) continue;
            if (station !== normOrigin && edge.to !== normDest && bannedEdges.has(`HUB:${edge.to}`)) continue;
            if (edge.depSec < curSec) continue;

            const isTransfer = (train !== null && train !== edge.train);
            const TRANSFER_BUFFER_SEC = 0; 
            if (isTransfer && (edge.depSec - curSec) < TRANSFER_BUFFER_SEC) continue;
            if (isTransfer && visited.has(edge.to)) continue;

            const newTransfers = transfers + (isTransfer ? 1 : 0);
            const penalty = newTransfers * 60; 
            const newScore = edge.arrSec + penalty;
            const stateKey = `${edge.to}|${edge.train}`;

            if (newScore < (dist.get(stateKey) ?? INF)) {
                dist.set(stateKey, newScore);
                prev.set(stateKey, { edge, fromStation: station, fromTrain: train });
                
                const newVisited = new Set(visited);
                newVisited.add(edge.to);
                
                pq.push(newScore, { 
                    station: edge.to, train: edge.train, transfers: newTransfers, curSec: edge.arrSec, visited: newVisited
                });
            }
        }
    }

    if (!bestDestState) return null;

    const legs = [];
    let curKey = `${normDest}|${bestDestState.train}`;
    while (prev.has(curKey)) {
        const { edge, fromStation, fromTrain } = prev.get(curKey);
        legs.unshift({
            type: 'DIRECT', route: edge.routeConfig, from: fromStation, to: edge.to, train: edge.train,
            depTime: edge.depTime, arrTime: edge.arrTime, stops: getIntermediateStops(edge.schedule, edge.fromIdx, edge.toIdx, edge.train)
        });
        curKey = `${fromStation}|${fromTrain}`;
    }
    return legs;
}

export function mergeConsecutiveLegs(legs) {
    if (!legs || legs.length === 0) return [];
    const out = [{ ...legs[0], stops: [...(legs[0].stops || [])] }];
    for (let i = 1; i < legs.length; i++) {
        const prev = out[out.length - 1];
        const curr = legs[i];
        
        const prevEndTrain = (prev.isRelayComposite && prev.internalTransfer) ? prev.internalTransfer.train2 : prev.train;
        const currStartTrain = curr.train;
        
        let waitSec = timeToSeconds(curr.depTime) - timeToSeconds(prev.arrTime);
        if (waitSec < 0) waitSec += 86400; 
        
        if (prevEndTrain === currStartTrain && waitSec >= 0 && waitSec <= 7200) {
            out[out.length - 1] = {
                ...prev, to: curr.to, arrTime: curr.arrTime,
                stops: [...(prev.stops || []), ...(curr.stops || []).slice(1)],
                routePath: prev.routePath ? [...prev.routePath, curr.route?.name] : [prev.route?.name, curr.route?.name]
            };
        } else {
            out.push({ ...curr, stops: [...(curr.stops || [])] });
        }
    }
    return out;
}

export function legsToTripObject(legs, origin, dest) {
    if (!legs || legs.length === 0) return null;
    const n             = legs.length - 1; 
    const depTime       = legs[0].depTime;
    const arrTime       = legs[legs.length - 1].arrTime;
    const totalDuration = timeToSeconds(arrTime) - timeToSeconds(depTime);

    const base = { from: origin, to: dest, depTime, arrTime, totalDuration, train: legs[0].train, legs };

    if (n === 0) {
        return {
            ...base, type: 'DIRECT', route: legs[0].route, stops: legs[0].stops,
            actualDestination: legs[0].stops?.[legs[0].stops.length - 1]?.station || dest
        };
    }
    if (n === 1) {
        return {
            ...base, type: 'TRANSFER', route: legs[0].route,
            transferStation: legs[0].to, leg1: legs[0], leg2: legs[1]
        };
    }
    if (n === 2) {
        return {
            ...base, type: 'DOUBLE_TRANSFER', route: legs[0].route,
            hub1: legs[0].to, hub2: legs[1].to,
            leg1: legs[0], leg2: legs[1], leg3: legs[2],
            routePath: legs.map(l => l.route?.name || 'Unknown Route')
        };
    }
    return {
        ...base, type: 'MULTI_TRANSFER', route: legs[0].route,
        hub1: legs[0].to, hub2: legs[1].to, hub3: legs[2]?.to || null,
        leg1: legs[0], leg2: legs[1], leg3: legs[2] || null,
        routePath: legs.map(l => l.route?.name || 'Unknown Route'),
        transferCount: n
    };
}

export function compactTrip(trip) {
    if (trip.type === 'DIRECT') return trip;
    
    let legs = [];
    if (trip.type === 'TRANSFER' && trip.leg1 && trip.leg2) {
        legs = [trip.leg1, trip.leg2];
    } else if (trip.type === 'DOUBLE_TRANSFER' && trip.leg1 && trip.leg2 && trip.leg3) {
        legs = [trip.leg1, trip.leg2, trip.leg3];
    } else if (trip.type === 'MULTI_TRANSFER' && trip.legs) {
        legs = trip.legs;
    } else {
        return trip;
    }

    const mergedLegs = mergeConsecutiveLegs(legs);
    if (mergedLegs.length === legs.length) return trip;
    
    const newTrip = legsToTripObject(mergedLegs, trip.from, trip.to);
    if (newTrip) {
        if (trip.dayLabel) newTrip.dayLabel = trip.dayLabel;
        if (trip.dayOffset) newTrip.dayOffset = trip.dayOffset; 
    }
    return newTrip || trip;
}

export function enumerateTripsByTemplate(mergedLegs, origin, dest, dayType, startSec, context = {}) {
    if (!mergedLegs || mergedLegs.length === 0) return [];
    const TRANSFER_BUFFER_SEC = 0;
    const MAX_WAIT_SEC        = 64800; 

    const waypoints = [origin, ...mergedLegs.map(l => l.to)];
    const routeIds  = mergedLegs.map(l => l.route.id);

    const legOptionSets = routeIds.map((routeId, idx) =>
        findAllLegsWithRelayExpansion(waypoints[idx], waypoints[idx + 1], new Set([routeId]), dayType, context)
            .filter(l => idx === 0 ? timeToSeconds(l.depTime) >= startSec : true)
    );

    if (legOptionSets.some(opts => opts.length === 0)) return [];

    let validPaths = legOptionSets[0].map(l => [l]);

    for (let idx = 1; idx < legOptionSets.length; idx++) {
        const nextOptions = legOptionSets[idx];
        const nextPaths   = [];
        for (const path of validPaths) {
            const prevArrSec = timeToSeconds(path[path.length - 1].arrTime);
            const bestNext = nextOptions.find(l => {
                const depSec = timeToSeconds(l.depTime);
                return depSec >= prevArrSec + TRANSFER_BUFFER_SEC && depSec <= prevArrSec + MAX_WAIT_SEC;
            });
            if (bestNext) nextPaths.push([...path, bestNext]);
        }
        validPaths = nextPaths;
        if (validPaths.length === 0) break;
    }

    return validPaths.map(path => legsToTripObject(path, origin, dest)).filter(Boolean);
}

const _DIJKSTRA_MAX_RUNS = 3;

export function planDijkstraTrip(origin, dest, dayType, isRolloverLoop = false, context = {}) {
    const normOrigin = normalizeStationName(origin);
    const normDest   = normalizeStationName(dest);

    if (normOrigin === normDest || !$fullDatabase.get()) return { status: 'NO_PATH', trips: [] };

    const dayIdx = context.targetDayIdx !== undefined ? context.targetDayIdx
                 : (dayType === getCurrentDayType() ? getCurrentDayIndex()
                 : (dayType === 'saturday' || dayType === 'public_holiday' ? 6 : 1));

    const startSec = 0;

    // GUARDIAN PHASE 16: Transit Graph Memoization — avoid rebuilding the heavy
    // graph on every Dijkstra run within one unified plan lifecycle.
    const cacheKey = `graph_${dayType}_${dayIdx}`;
    if (!context.graphCache) context.graphCache = {};
    if (!context.graphCache[cacheKey]) {
        context.graphCache[cacheKey] = buildTransitGraph(dayType, dayIdx);
    }
    const baseGraph = context.graphCache[cacheKey];
    const bannedEdges     = new Set();
    const seenTemplates   = new Set();
    const allTrips        = [];

    for (let run = 0; run < _DIJKSTRA_MAX_RUNS; run++) {
        const rawLegs = dijkstraPlanCore(normOrigin, normDest, baseGraph, startSec, bannedEdges, isRolloverLoop);
        if (!rawLegs || rawLegs.length === 0) break;

        const mergedLegs = mergeConsecutiveLegs(rawLegs);
        if (!mergedLegs || mergedLegs.length === 0) break;

        const templateSig = mergedLegs.map(
            l => `${l.route.id}:${normalizeStationName(l.from)}->${normalizeStationName(l.to)}`
        ).join('|');
        if (seenTemplates.has(templateSig)) break;
        seenTemplates.add(templateSig);

        const templatedTrips = enumerateTripsByTemplate(mergedLegs, origin, dest, dayType, 0, context);
        allTrips.push(...templatedTrips);

        if (mergedLegs.length === 1) {
            bannedEdges.add(`ROUTE:${mergedLegs[0].route.id}`);
        } else {
            for (let i = 0; i < mergedLegs.length - 1; i++) {
                bannedEdges.add(`HUB:${normalizeStationName(mergedLegs[i].to)}`);
            }
        }
    }

    if (allTrips.length > 0) return { status: 'FOUND', trips: allTrips };
    return { status: 'NO_PATH', trips: [] };
}

// -----------------------------------------------------------------------------
// SECTION 4: DOMINANCE FILTER AND UNIFIED ORCHESTRATOR
// -----------------------------------------------------------------------------

export function filterDominatedTrips(trips) {
    if (!trips || trips.length === 0) return [];
    const optimalTrips = [];
    const getDep = t => timeToSeconds(t.depTime || (t.leg1 ? t.leg1.depTime : "00:00"));
    const getArr = t => timeToSeconds(t.arrTime || (t.leg3 ? t.leg3.arrTime : (t.leg2 ? t.leg2.arrTime : "00:00")));
    const getTrans = t => {
        if (t.type === 'MULTI_TRANSFER') return t.transferCount ?? (t.legs ? t.legs.length - 1 : 3);
        let base = t.type === 'DOUBLE_TRANSFER' ? 2 : (t.type === 'TRANSFER' ? 1 : 0);
        if (t.leg1 && t.leg1.isRelayComposite) base += 1;
        if (t.leg2 && t.leg2.isRelayComposite) base += 1;
        if (t.leg3 && t.leg3.isRelayComposite) base += 1;
        return base;
    };

    const getPathSig = t => {
        if (t.type === 'MULTI_TRANSFER') {
            const hubs   = t.legs ? t.legs.slice(0, -1).map(l => normalizeStationName(l.to)).join('_') : '';
            const routes = t.routePath ? t.routePath.join(',') : '';
            return `MULTI_${hubs}_[${routes}]`;
        }
        let sig = t.type;
        if (t.type === 'TRANSFER') sig += `_${t.transferStation}`;
        if (t.type === 'DOUBLE_TRANSFER') sig += `_${t.hub1}_${t.hub2}`;
        if (t.routePath) sig += `_[${t.routePath.join(',')}]`;
        else if (t.route) sig += `_[${t.route.id}]`;
        return sig;
    };
    
    for (let i = 0; i < trips.length; i++) {
        const tripX = trips[i];
        let isDominated = false;
        
        const xDep = getDep(tripX);
        const xArr = getArr(tripX);
        const xTransfers = getTrans(tripX);
        const xSig = getPathSig(tripX);
        
        for (let j = 0; j < trips.length; j++) {
            if (i === j) continue;
            const tripY = trips[j];
            
            const yDep = getDep(tripY);
            const yArr = getArr(tripY);
            const yTransfers = getTrans(tripY);
            const ySig = getPathSig(tripY);
            
            const samePath = (xSig === ySig);

            if (samePath) {
                const isStrictlyBetterTime = (yDep > xDep && yArr <= xArr) || (yDep >= xDep && yArr < xArr);
                const isDuplicate = (yDep === xDep && yArr === xArr && yTransfers === xTransfers && j < i);
                if (isStrictlyBetterTime || isDuplicate) {
                    isDominated = true;
                    break;
                }
            } else {
                const departsLaterOrSame = (yDep >= xDep);
                const arrivesEarlierOrSame = (yArr <= xArr);
                const strictlyFewerTransfers = (yTransfers < xTransfers);
                const sameTransfers = (yTransfers === xTransfers);
                const isStrictlyBetterTime = (yDep > xDep && yArr <= xArr) || (yDep >= xDep && yArr < xArr);

                if (departsLaterOrSame && arrivesEarlierOrSame) {
                    if (strictlyFewerTransfers) {
                        isDominated = true;
                        break;
                    }
                    if (sameTransfers && isStrictlyBetterTime) {
                        isDominated = true;
                        break;
                    }
                }
            }
        }
        if (!isDominated) optimalTrips.push(tripX);
    }
    return optimalTrips;
}

export function runHeuristicFailureProbe(origin, dest, dayType = null) {
    const normOrigin = normalizeStationName(origin);
    const normDest = normalizeStationName(dest);
    const index = $globalStationIndex.get();
    const disr = $globalDisruptions.get();
    const fullDatabase = $fullDatabase.get();
    
    if (!index || !index[normOrigin] || !index[normDest]) {
        return 'ERR_DISCONNECTED_GRAPH';
    }

    const oData = index[normOrigin];
    const dData = index[normDest];

    let regO = null, regD = null;
    for (const r of oData.routes) { if (ROUTES[r]) { regO = ROUTES[r].region; break; } }
    for (const r of dData.routes) { if (ROUTES[r]) { regD = ROUTES[r].region; break; } }
    
    if (regO && regD && regO !== regD) return 'ERR_CROSS_REGION';

    let blockingDisruption = null;

    const getRouteSuspension = (rId) => {
        if (disr && disr[rId]) {
            return disr[rId].find(d => d.tier === 'CRITICAL');
        }
        return null;
    };

    const routeHasTrainsToday = (rId) => {
        if (!ROUTES[rId] || !fullDatabase) return true;
        // Always probe real timetable sheets (weekday on Sundays) — empty
        // getDirectionsForRoute('sunday') previously made every corridor look dead
        // and falsely returned ERR_NO_SERVICE_TODAY.
        const directions = getDirectionsForRoute(ROUTES[rId], scheduleDayType(dayType));
        if (directions.length === 0) return false;
        return directions.some((dir) => {
            if (!fullDatabase[dir.key]) return false;
            const sched = getScheduleFromDb(fullDatabase, dir.key);
            return (sched.headers || []).slice(1).length > 0;
        });
    };

    const checkConnectivity = (ignoreSuspended, checkSchedule = false) => {
        const queue = [];
        const visited = new Set();
        
        const startRoutes = Array.from(oData.routes).filter(r => ROUTES[r] && ROUTES[r].isActive);
        const endRoutes = new Set(Array.from(dData.routes).filter(r => ROUTES[r] && ROUTES[r].isActive));
        
        for (const r of startRoutes) {
            if (checkSchedule && !routeHasTrainsToday(r)) continue;
            if (ignoreSuspended) {
                const susp = getRouteSuspension(r);
                if (susp) {
                    if (!blockingDisruption) blockingDisruption = susp;
                    continue; 
                }
            }
            queue.push({ route: r, depth: 0 });
            visited.add(r);
        }

        while (queue.length > 0) {
            const curr = queue.shift();
            if (endRoutes.has(curr.route)) return true;
            if (curr.depth >= 4) continue; 

            for (const otherRoute of Object.keys(ROUTES)) {
                if (otherRoute !== curr.route && ROUTES[otherRoute].isActive) {
                    if (!visited.has(otherRoute)) {
                        if (findIntersections(curr.route, otherRoute).length > 0) {
                            if (checkSchedule && !routeHasTrainsToday(otherRoute)) continue;
                            if (ignoreSuspended) {
                                const susp = getRouteSuspension(otherRoute);
                                if (susp) {
                                    if (!blockingDisruption) blockingDisruption = susp;
                                    continue; 
                                }
                            }
                            visited.add(otherRoute);
                            queue.push({ route: otherRoute, depth: curr.depth + 1 });
                        }
                    }
                }
            }
        }
        return false;
    };

    // Physical path ignoring schedule
    if (!checkConnectivity(false, false)) return 'ERR_DISCONNECTED_GRAPH';

    // Physical path exists but no trains today on connecting routes
    if (!checkConnectivity(false, true)) return 'ERR_NO_SERVICE_TODAY';

    // CRITICAL suspension blocking today's path
    const isSevered = !checkConnectivity(true, true);

    if (isSevered && blockingDisruption) {
        return {
            code: 'ERR_ACTIVE_SUSPENSION',
            disruptionId: blockingDisruption.id,
            buttonText: blockingDisruption.buttonText || 'Line Severed',
            hasIncident: true,
            stations: blockingDisruption.stations || [],
        };
    }

    return 'ERR_TIMETABLE_MISMATCH';
}

function titleCaseStation(s) {
    if (!s) return '';
    return String(s).replace(/ STATION/gi, '').replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/** Resolve a display/index station name to a key present in the station index. */
function resolveIndexedStation(name) {
    const index = $globalStationIndex.get() || {};
    const norm = normalizeStationName(name);
    if (index[norm]) return Object.keys(index).find((k) => normalizeStationName(k) === norm) || norm;
    const withSuffix = `${norm} STATION`;
    if (index[withSuffix] || index[normalizeStationName(withSuffix)]) return withSuffix;
    // Fuzzy: match cleaned keys
    for (const key of Object.keys(index)) {
        if (normalizeStationName(key) === norm) return key;
    }
    return name;
}

/**
 * When origin sits on the disrupted side of a cut, find stations beyond the
 * severance that can still reach the destination (alternate boarding).
 */
export function findAlternateBoardOrigins(origin, dest, dayType = null) {
    const sheetDay = scheduleDayType(dayType || getCurrentDayType());
    const normOrigin = normalizeStationName(origin);
    const normDest = normalizeStationName(dest);
    const candidates = [];
    const seen = new Set();

    const pushCand = (raw) => {
        if (!raw) return;
        const resolved = resolveIndexedStation(raw);
        const n = normalizeStationName(resolved);
        if (!n || n === normOrigin || n === normDest || seen.has(n)) return;
        seen.add(n);
        candidates.push(resolved);
    };

    try {
        const disr = $globalDisruptions.get() || {};
        Object.values(disr).flat().forEach((d) => {
            if (d?.tier !== 'CRITICAL') return;
            (d.stations || []).forEach(pushCand);
        });
    } catch { /* ignore */ }

    const viable = [];
    for (const cand of candidates.slice(0, 8)) {
        try {
            const probe = runHeuristicFailureProbe(cand, dest, sheetDay);
            const blocked = probe === 'ERR_ACTIVE_SUSPENSION'
                || (probe && typeof probe === 'object' && probe.code === 'ERR_ACTIVE_SUSPENSION');
            if (blocked) continue;
            if (probe === 'ERR_DISCONNECTED_GRAPH' || probe === 'ERR_CROSS_REGION') continue;

            let raw = [];
            try {
                const dijkstraResult = planDijkstraTrip(cand, dest, sheetDay, false, {});
                raw = [...(dijkstraResult.trips || [])];
            } catch { /* ignore */ }
            if (raw.length === 0) {
                try {
                    const directResult = planDirectTrip(cand, dest, sheetDay, false, {});
                    raw = [...(directResult.trips || [])];
                } catch { /* ignore */ }
            }

            // Accept if we found any itinerary, or connectivity exists without an active cut
            if (raw.length === 0 && probe === 'ERR_NO_SERVICE_TODAY') continue;

            viable.push({
                station: cand,
                label: titleCaseStation(cand),
                hasTrips: raw.length > 0,
            });
            if (viable.length >= 2) break;
        } catch { /* try next */ }
    }

    // Prefer candidates that actually produced trips
    viable.sort((a, b) => Number(b.hasTrips) - Number(a.hasTrips));
    return viable;
}

export async function planUnifiedTrip(origin, dest, dayType, externalContext = {}) {
    console.log(`[GUARDIAN] Running Unified Trip Planner for ${origin} -> ${dest} (Requested: ${dayType})`);

    const normOrigin = normalizeStationName(origin);
    const normDest = normalizeStationName(dest);
    
    if (normOrigin === normDest) {
        console.warn("[GUARDIAN] Boomerang trip detected. Aborting unified calculation.");
        return { status: 'SAME_STATION', errorPayload: null, trips: [] };
    }

    const context = { zeroHourProbeActive: false, targetDayIdx: undefined, ...externalContext };

    const fetchRawTrips = (o, d, dt, isRolloverLoop, ctx) => {
        const dijkstraResult = planDijkstraTrip(o, d, dt, isRolloverLoop, ctx);
        let raw = [...(dijkstraResult.trips || [])];

        if (raw.length === 0) {
            const directResult = planDirectTrip(o, d, dt, isRolloverLoop, ctx);
            const macroResult = planMacroCorridorTrip(o, d, dt, isRolloverLoop, ctx);
            const relayResult = planRelayTransferTrip(o, d, dt, isRolloverLoop, ctx);
            const hubResult   = planHubTransferTrip(o, d, dt, isRolloverLoop, ctx);
            
            raw = [
                ...(directResult.trips || []),
                ...(macroResult.trips || []),
                ...(relayResult.trips || []),
                ...(hubResult.trips || [])
            ];

            const todayCount = raw.filter(t => !t.dayLabel).length;
            if (todayCount < 3 && (macroResult.trips || []).length === 0) {
                const doubleResult = planDoubleTransferTrip(o, d, dt, isRolloverLoop, ctx);
                raw = [...raw, ...(doubleResult.trips || [])];
            }
        }
        return raw.map(compactTrip).filter(Boolean);
    };
    
    let startOffset = 0;

    if (typeof window !== 'undefined' && window._forceManualRollover) {
        console.log("[GUARDIAN] Manual Rollover Intercepted. Pushing startOffset to 1.");
        startOffset = 1;
        window._forceManualRollover = false; 
    }

    const isExplicitOverride = (dayType === 'weekday' || dayType === 'saturday' || dayType === 'public_holiday') && dayType !== getCurrentDayType();

    if (!isExplicitOverride && dayType !== getCurrentDayType()) {
        let baseDate = new Date();
        if ($isSimMode.get() && context.simBaseDate) {
            const parts = context.simBaseDate.split('-');
            if (parts.length === 3) baseDate = new Date(parts[0], parts[1] - 1, parts[2]);
        }
        
        for (let i = 1; i <= 7; i++) {
            let checkDate = new Date(baseDate);
            checkDate.setDate(checkDate.getDate() + i);
            let dayOfWeek = checkDate.getDay();
            let type = (dayOfWeek === 0) ? 'sunday' : (dayOfWeek === 6 ? 'saturday' : 'weekday');
            
            const m = String(checkDate.getMonth() + 1).padStart(2, '0');
            const d = String(checkDate.getDate()).padStart(2, '0');
            const dateKey = `${m}-${d}`;
            const region = $userRegion.get() || 'GP';
            const holidayType = resolveHolidayDayType(dateKey, region, checkDate.getFullYear()) || SPECIAL_DATES[dateKey];
            if (holidayType) type = holidayType;
            
            if (type === dayType || (dayType === 'sunday' && dayOfWeek === 0)) {
                startOffset = i;
                break;
            }
        }
    }

    /** @param {number} offset @param {string} [evalDest] alternate destination for partial journeys */
    const evaluateDay = (offset, evalDest = dest) => {
        let targetDayType = dayType;
        let targetDayLabel = null;
        let targetDayIdx = getCurrentDayIndex();
        let isFutureOffset = offset > startOffset; 
        
        if (isExplicitOverride) {
            targetDayType = dayType;
            targetDayLabel = null; 
            targetDayIdx = (dayType === 'saturday' || dayType === 'public_holiday') ? 6 : (dayType === 'sunday' ? 0 : 1);
        } else if (offset > 0) {
            const info = getLookaheadDayInfo(offset);
            targetDayType = info.type;
            targetDayLabel = info.name;
            targetDayIdx = info.idx;
            context._targetIsHoliday = !!info.isHoliday;
        }

        if (targetDayType === 'sunday' && !isExplicitOverride) {
            return { status: 'SUNDAY_SKIP', trips: [], severedTerminus: null };
        }

        context.targetDayIdx = targetDayIdx; 

        let allRawTrips = fetchRawTrips(origin, evalDest, targetDayType, isFutureOffset, context);

        let capturedTerminus = null;

        const isTripSevered = (trip) => {
            const getDisr = (typeof window !== 'undefined' && typeof window.getTripDisruptions === 'function')
                ? window.getTripDisruptions
                : null;
            if (!getDisr) return false;

            const checkLeg = (routeId, stops) => {
                if (!stops || stops.length === 0) return false;
                const disrList = getDisr(routeId, stops);
                const crit = disrList.find((d) => d.tier === 'CRITICAL');
                if (!crit) return false;

                // Alighting exactly at the disruption boundary is safe for this leg
                if (crit.triggerStopIndex !== undefined) {
                    if (crit.triggerStopIndex === stops.length - 1) return false;
                    if (!capturedTerminus && stops[crit.triggerStopIndex]) {
                        capturedTerminus = normalizeStationName(stops[crit.triggerStopIndex].station);
                    }
                    return true;
                }
                return true;
            };

            if (trip.type === 'DIRECT') return checkLeg(trip.route.id, trip.stops);
            if (trip.type === 'TRANSFER') {
                return checkLeg(trip.leg1.route.id, trip.leg1.stops)
                    || checkLeg(trip.leg2.route.id, trip.leg2.stops);
            }
            if (trip.type === 'DOUBLE_TRANSFER') {
                return checkLeg(trip.leg1.route.id, trip.leg1.stops)
                    || checkLeg(trip.leg2.route.id, trip.leg2.stops)
                    || checkLeg(trip.leg3.route.id, trip.leg3.stops);
            }
            if (trip.type === 'MULTI_TRANSFER' && trip.legs) {
                for (const leg of trip.legs) {
                    if (checkLeg(leg.route.id, leg.stops)) return true;
                }
            }
            return false;
        };

        const hasValidLayovers = (trip) => {
            if (trip.type === 'DIRECT') return true;

            const checkLayover = (arrTime, depTime) => {
                let layover = timeToSeconds(depTime) - timeToSeconds(arrTime);
                // SPA parity: block midnight-crossing layovers; allow long same-day waits
                if (layover < 0) return false;
                return true;
            };

            if (trip.type === 'TRANSFER')
                return checkLayover(trip.leg1.arrTime, trip.leg2.depTime);

            if (trip.type === 'DOUBLE_TRANSFER')
                return checkLayover(trip.leg1.arrTime, trip.leg2.depTime) &&
                       checkLayover(trip.leg2.arrTime, trip.leg3.depTime);

            if (trip.type === 'MULTI_TRANSFER') {
                const legs = trip.legs || [trip.leg1, trip.leg2, trip.leg3].filter(Boolean);
                for (let i = 0; i < legs.length - 1; i++) {
                    if (!checkLayover(legs[i].arrTime, legs[i + 1].depTime)) return false;
                }
                return true;
            }
            return true;
        };

        const validTrips = allRawTrips.filter((t) => hasValidLayovers(t) && !isTripSevered(t));
        const optimalTrips = filterDominatedTrips(validTrips);

        const masterSort = (a, b) => {
            const getDep   = t => timeToSeconds(t.depTime || (t.leg1?.depTime  || "00:00"));
            const getArr   = t => timeToSeconds(t.arrTime || (t.leg3?.arrTime  || (t.leg2?.arrTime || "00:00")));
            const getTrans = t => t.type === 'MULTI_TRANSFER' ? (t.transferCount ?? (t.legs ? t.legs.length - 1 : 3))
                                : t.type === 'DOUBLE_TRANSFER' ? 2
                                : t.type === 'TRANSFER' ? 1 : 0;
            const depDiff = getDep(a) - getDep(b); if (depDiff !== 0) return depDiff;
            const arrDiff = getArr(a) - getArr(b); if (arrDiff !== 0) return arrDiff;
            return getTrans(a) - getTrans(b);
        };

        optimalTrips.sort(masterSort);

        let finalStatus = optimalTrips.length > 0 ? 'FOUND' : 'NO_PATH';

        if (finalStatus === 'FOUND' && offset === 0 && !isExplicitOverride && !context.zeroHourProbeActive) {
            const nowSec = timeToSeconds(getCurrentTime());
            const hasUpcoming = optimalTrips.some(t => {
                const dep = timeToSeconds(t.depTime || (t.leg1 ? t.leg1.depTime : "00:00"));
                return dep >= nowSec;
            });
            
            if (!hasUpcoming) {
                console.log("[GUARDIAN] All trips today have departed. Flagging as ALL_DEPARTED to await user instruction.");
                finalStatus = 'ALL_DEPARTED';
            }
        }

        if (finalStatus === 'NO_PATH' && !isFutureOffset && !isExplicitOverride) {
            console.log("[GUARDIAN] Commencing Zero-Hour Probe...");
            
            if (context.zeroHourProbeActive) {
                console.warn("🛡️ Guardian: Zero-Hour Probe already active! Aborting recursive call.");
                return { status: 'IMPOSSIBLE_TODAY', trips: [], targetDayLabel, severedTerminus: capturedTerminus };
            }

            context.zeroHourProbeActive = true;
            try {
                const probeTripsRaw = fetchRawTrips(origin, evalDest, targetDayType, false, context);
                // SPA parity: Zero-Hour Probe only checks layover validity. Filtering
                // severed trips here mislabels disrupted-but-possible routes as IMPOSSIBLE.
                const validProbeTrips = probeTripsRaw.filter(hasValidLayovers);
                if (validProbeTrips.length === 0) {
                    console.log("[GUARDIAN] Zero-Hour Probe verified 0 valid trips exist from 00:00. Route is IMPOSSIBLE today.");
                    finalStatus = 'IMPOSSIBLE_TODAY';
                }
            } finally {
                context.zeroHourProbeActive = false;
            }
        }

        if (offset > 0 && optimalTrips.length > 0) {
            optimalTrips.forEach(t => {
                if (!t.dayLabel) t.dayLabel = targetDayLabel;
                if (!t.dayOffset) t.dayOffset = offset;
                if (context._targetIsHoliday) t.isHoliday = true;
            });
        }

        return { status: finalStatus, trips: optimalTrips, targetDayLabel, severedTerminus: capturedTerminus };
    };

    let loopStatus = 'NO_PATH';
    let loopTrips = [];
    let initialStatus = null;
    let errorPayload = null; 
    
    const MAX_SAFE_ROLLOVER_DAYS = 7;
    let maxOffset = isExplicitOverride ? startOffset : startOffset + MAX_SAFE_ROLLOVER_DAYS;
    
    let executionCounter = 0;
    const MAX_EXECUTION_LIMIT = 14;

    const formatTitle = (s) => {
        if (!s) return '';
        return String(s).replace(/ STATION/gi, '').replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    };

    // Eager Partial Journey Evaluator — precompute backward station sequence once
    const getBackwardStationSequence = (dst, targetDay) => {
        const dNorm = normalizeStationName(dst);
        const fullDatabase = $fullDatabase.get();
        const possibleStations = [];
        for (const route of Object.values(ROUTES)) {
            if (!route.isActive || route.id === 'special_event') continue;
            for (const dir of getDirectionsForRoute(route, targetDay)) {
                if (!fullDatabase || !fullDatabase[dir.key]) continue;
                const sched = getScheduleFromDb(fullDatabase, dir.key);
                if ((sched.headers || []).slice(1).length === 0) continue;
                const rows = sched.rows;
                if (!rows) continue;
                const stationsNorm = rows.map((r) => normalizeStationName(r.STATION));
                const idxD = stationsNorm.indexOf(dNorm);
                if (idxD > 0) {
                    possibleStations.push(...rows.slice(0, idxD).map((r) => r.STATION).reverse());
                }
            }
        }
        return [...new Set(possibleStations)];
    };
    const testStations = getBackwardStationSequence(dest, dayType);

    for (let offset = startOffset; offset <= maxOffset; offset++) {
        if (executionCounter++ > MAX_EXECUTION_LIMIT) {
            console.error("🛡️ Guardian: Unified Trip loop threshold critically exceeded. Triggering failsafe abort.");
            loopStatus = 'ERR_TIMETABLE_MISMATCH'; 
            break;
        }

        // Yield so the spinner can paint during partial-station scans
        await new Promise((resolve) => setTimeout(resolve, 0));

        try {
            const evalResult = evaluateDay(offset, dest);
            
            if (offset === startOffset) {
                initialStatus = evalResult.status;
                if (dayType === 'sunday' || evalResult.status === 'SUNDAY_SKIP') {
                    initialStatus = 'SUNDAY_ROLLOVER';
                }

                // Hard physical block on day 1 → skip pointless 7-day scan (still allow today's partials).
                // Do NOT short-circuit on ERR_NO_SERVICE_TODAY when the request day is Sunday —
                // that status is about today's sheets; rollover must still search weekdays.
                if (evalResult.status === 'NO_PATH' && !isExplicitOverride) {
                    const earlyProbe = runHeuristicFailureProbe(origin, dest, dayType);
                    const hardBlock = typeof earlyProbe === 'object'
                        || earlyProbe === 'ERR_CROSS_REGION'
                        || earlyProbe === 'ERR_DISCONNECTED_GRAPH'
                        || (earlyProbe === 'ERR_NO_SERVICE_TODAY' && dayType !== 'sunday');
                    if (hardBlock) {
                        console.log("🛡️ Guardian: Hard physical block detected on Day 1. Short-circuiting 7-day loop.");
                        maxOffset = offset;
                    }
                }
            }

            if (evalResult.status === 'FOUND' || evalResult.status === 'ALL_DEPARTED') {
                loopStatus = (offset > startOffset) ? 'NO_MORE_TODAY' : evalResult.status;
                loopTrips = evalResult.trips;
                break; 
            }

            // Eager partial evaluation before rolling to tomorrow
            let targetsToTest = [...testStations];
            if (evalResult.severedTerminus && !targetsToTest.includes(evalResult.severedTerminus)) {
                targetsToTest.unshift(evalResult.severedTerminus);
            }

            if ((evalResult.status === 'NO_PATH' || evalResult.status === 'IMPOSSIBLE_TODAY') && targetsToTest.length > 0) {
                let partialSuccess = false;

                for (const testDest of targetsToTest) {
                    if (normalizeStationName(testDest) === normalizeStationName(origin)) continue;
                    await new Promise((resolve) => setTimeout(resolve, 0));

                    const partialResult = evaluateDay(offset, testDest);
                    if (partialResult.status === 'FOUND' || partialResult.status === 'ALL_DEPARTED') {
                        console.log(`[GUARDIAN] Partial Journey Found to ${testDest} on offset ${offset}!`);
                        loopTrips = (partialResult.trips || []).map((t) => ({
                            ...t,
                            _isPartialJourney: true,
                            _partialDest: testDest,
                            _intendedDest: dest,
                        }));
                        loopStatus = 'PARTIAL_JOURNEY';
                        let disruptionId = null;
                        let buttonText = 'Line Severed';
                        try {
                            const normTerm = normalizeStationName(testDest);
                            const globalList = Object.values($globalDisruptions.get() || {}).flat();
                            const crit = globalList.find((d) =>
                                d.tier === 'CRITICAL'
                                && d.stations
                                && d.stations.map((s) => normalizeStationName(s)).includes(normTerm)
                            );
                            if (crit) {
                                disruptionId = crit.id;
                                buttonText = crit.buttonText || buttonText;
                            }
                        } catch { /* ignore */ }
                        errorPayload = {
                            intendedDest: formatTitle(dest),
                            partialDest: formatTitle(testDest),
                            disruptionId,
                            buttonText,
                            hasIncident: !!disruptionId,
                        };
                        partialSuccess = true;
                        break;
                    }
                }

                if (partialSuccess) break;
            }
        } catch (e) {
            console.error("🛡️ Guardian: Fatal execution error during rollover evaluation. Aborting loop.", e);
            loopStatus = 'ERR_TIMETABLE_MISMATCH';
            break;
        }
    }

    if (loopTrips.length === 0) {
        console.log("[GUARDIAN] Zero trips found after 7-day scan (including partials). Initiating Heuristic Failure Probe...");
        const probeResult = runHeuristicFailureProbe(origin, dest, dayType);
        
        if (typeof probeResult === 'object' && probeResult !== null) {
            loopStatus = probeResult.code;
            errorPayload = probeResult;
        } else {
            loopStatus = probeResult;
        }

        // Origin on the disrupted side: suggest boarding beyond the cut
        if (loopStatus === 'ERR_ACTIVE_SUSPENSION') {
            try {
                const alts = findAlternateBoardOrigins(origin, dest, dayType);
                if (alts.length > 0) {
                    errorPayload = {
                        ...(typeof errorPayload === 'object' && errorPayload ? errorPayload : {}),
                        code: 'ERR_ACTIVE_SUSPENSION',
                        boardingBlocked: true,
                        alternateOrigins: alts,
                        intendedDest: formatTitle(dest),
                        blockedOrigin: formatTitle(origin),
                    };
                }
            } catch (e) {
                console.warn('[GUARDIAN] Alternate boarding probe failed', e);
            }
        }
    } else if (loopStatus !== 'PARTIAL_JOURNEY') {
        if (initialStatus === 'IMPOSSIBLE_TODAY') {
            loopStatus = 'IMPOSSIBLE_TODAY'; 
        } else if (initialStatus === 'SUNDAY_ROLLOVER') {
            loopStatus = 'SUNDAY_ROLLOVER';
        }
    }

    return {
        status: loopStatus,
        errorPayload: errorPayload, 
        trips: loopTrips
    };
}