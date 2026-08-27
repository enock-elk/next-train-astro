/**
 * Saturday / public-holiday no-service corridors.
 *
 * Route IDs in SATURDAY_PLACEHOLDER_ROUTES are hardcoded, but the special
 * planner path only runs when those Saturday sheets have no timed trains.
 * The moment live data appears, Dijkstra / direct planning take over.
 */
import { ROUTES, SATURDAY_PLACEHOLDER_ROUTES, HERC_KOED_JUNCTIONS } from './config.js';
import { $fullDatabase, $globalStationIndex } from '../store.js';
import { getScheduleFromDb } from './logic.js';
import { isRealTime, normalizeStationName, usesSaturdayScheduleSheet } from './utils.js';

/** Same occupancy rule as live-board scheduleHasService (avoid importing live-board). */
export function sheetHasTimedService(schedule) {
    if (!schedule?.rows?.length || !Array.isArray(schedule.headers)) return false;
    const stationCol = schedule.stationColumnName || 'STATION';
    const trainCols = schedule.headers.filter((h) => h && h !== stationCol && h !== 'STATION' && h !== 'COORDINATES' && h !== 'KM_MARK' && h !== 'row_index');
    if (trainCols.length === 0) return false;
    return schedule.rows.some((row) => trainCols.some((col) => isRealTime(row[col])));
}

export function routeHasSaturdayTrains(routeId, db = $fullDatabase.get()) {
    const route = ROUTES[routeId];
    if (!route?.sheetKeys || !db) return false;
    const keys = [route.sheetKeys.saturday_to_a, route.sheetKeys.saturday_to_b].filter(Boolean);
    return keys.some((key) => sheetHasTimedService(getScheduleFromDb(db, key)));
}

export function isPlaceholderRouteClosed(routeId, dayType, db = $fullDatabase.get()) {
    if (!SATURDAY_PLACEHOLDER_ROUTES.includes(routeId)) return false;
    const region = ROUTES[routeId]?.region;
    if (!usesSaturdayScheduleSheet(dayType, region)) return false;
    return !routeHasSaturdayTrains(routeId, db);
}

export function stationRouteSet(name) {
    const index = $globalStationIndex.get() || {};
    const norm = normalizeStationName(name);
    if (!norm) return new Set();
    if (index[norm]?.routes) return index[norm].routes;
    const withSuffix = `${norm} STATION`;
    if (index[withSuffix]?.routes) return index[withSuffix].routes;
    for (const key of Object.keys(index)) {
        if (normalizeStationName(key) === norm && index[key]?.routes) return index[key].routes;
    }
    return new Set();
}

export function isHercKoedJunction(name) {
    const n = normalizeStationName(name);
    return HERC_KOED_JUNCTIONS.some((j) => normalizeStationName(j) === n);
}

/** stub | junction | outside */
export function classifyHercKoedStation(name) {
    if (isHercKoedJunction(name)) return 'junction';
    if (stationRouteSet(name).has('herc-koed')) return 'stub';
    return 'outside';
}

function sharedRouteCount(stationA, stationB) {
    const a = stationRouteSet(stationA);
    const b = stationRouteSet(stationB);
    let n = 0;
    for (const id of a) {
        if (b.has(id)) n += 1;
    }
    return n;
}

export function orderJunctionsForOrigin(origin, junctions = HERC_KOED_JUNCTIONS) {
    return [...junctions].sort((a, b) => sharedRouteCount(origin, b) - sharedRouteCount(origin, a));
}

export function tripNeedsHercKoedBridge(origin, dest) {
    const oRoutes = stationRouteSet(origin);
    const dRoutes = stationRouteSet(dest);
    if (oRoutes.has('herc-koed') || dRoutes.has('herc-koed')) return false;
    const east = ['EAST_LINE'];
    const north = ['NORTH_LINE'];
    const hasLine = (routes, lines) => {
        for (const rId of routes) {
            if (ROUTES[rId] && lines.includes(ROUTES[rId].corridorId)) return true;
        }
        return false;
    };
    return (hasLine(oRoutes, east) && hasLine(dRoutes, north))
        || (hasLine(oRoutes, north) && hasLine(dRoutes, east));
}

/**
 * @returns {null | { kind: 'NO_SERVICE'|'DEST_CUT'|'ORIGIN_CUT', routeId: string, junctions?: string[] }}
 */
export function classifySaturdayPlaceholderTrip(origin, dest, dayType, db = $fullDatabase.get()) {
    if (isPlaceholderRouteClosed('ec-berlin', dayType, db)) {
        const oOn = stationRouteSet(origin).has('ec-berlin');
        const dOn = stationRouteSet(dest).has('ec-berlin');
        if (oOn && dOn) return { kind: 'NO_SERVICE', routeId: 'ec-berlin' };
    }

    if (!isPlaceholderRouteClosed('herc-koed', dayType, db)) return null;

    const o = classifyHercKoedStation(origin);
    const d = classifyHercKoedStation(dest);
    if (o !== 'outside' && d !== 'outside') {
        return { kind: 'NO_SERVICE', routeId: 'herc-koed' };
    }
    if (d === 'stub' && o === 'outside') {
        return { kind: 'DEST_CUT', routeId: 'herc-koed', junctions: orderJunctionsForOrigin(origin) };
    }
    if (o === 'stub' && d === 'outside') {
        return { kind: 'ORIGIN_CUT', routeId: 'herc-koed', junctions: orderJunctionsForOrigin(dest) };
    }
    return null;
}

export function saturdayNoServiceCopy(routeId) {
    if (routeId === 'ec-berlin') {
        return {
            regionLabel: 'Eastern Cape',
            lineLabel: 'East London to Berlin',
            body: 'Metrorail Eastern Cape does not have Saturday train service on the East London to Berlin line.',
        };
    }
    return {
        regionLabel: 'Gauteng',
        lineLabel: 'Hercules to Koedoespoort',
        body: 'Metrorail Gauteng does not have Saturday train service on the Hercules to Koedoespoort line.',
    };
}

export function stationDisplayName(raw) {
    return String(raw || '').replace(/ STATION/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Dynamic Saturday advisory (banner + modal + Reply quote).
 * Boarding blocked vs dest-cut vs generic no-weekend-service.
 */
export function buildSaturdayAdvisoryCopy(payload = {}) {
    const routeId = payload.routeId || 'herc-koed';
    const copy = saturdayNoServiceCopy(routeId);
    const route = ROUTES[routeId];
    const endA = stationDisplayName(route?.destA).toUpperCase();
    const endB = stationDisplayName(route?.destB).toUpperCase();
    const between = endA && endB ? `Lies Between ${endA} & ${endB}` : '';
    const lead = copy.body;

    if (payload.boardingBlocked) {
        const station = stationDisplayName(payload.blockedOrigin);
        return {
            kind: 'boarding',
            badge: 'BOARDING BLOCKED',
            title: station ? `Your selected station: ${station}.` : 'Your selected station.',
            lines: [between].filter(Boolean),
            lead,
            quote: [`Boarding blocked.`, station ? `Your selected station: ${station}.` : '', between, lead]
                .filter(Boolean)
                .join(' '),
        };
    }

    if (payload.saturdayNoService && payload.partialDest) {
        const dest = stationDisplayName(payload.intendedDest);
        return {
            kind: 'severed',
            badge: 'LINE SEVERED',
            title: dest ? `Your selected station: ${dest}.` : 'Your selected station.',
            lines: [between].filter(Boolean),
            lead,
            quote: ['Line Severed.', dest ? `Your selected station: ${dest}.` : '', between, lead]
                .filter(Boolean)
                .join(' '),
        };
    }

    const title = endA && endB
        ? `Between ${stationDisplayName(route?.destA)} & ${stationDisplayName(route?.destB)}`
        : copy.lineLabel;
    return {
        kind: 'none',
        badge: 'NO WEEKEND SERVICE',
        title,
        lines: [],
        lead,
        quote: lead,
    };
}

export function saturdayNoServicePayload(routeId, origin, dest) {
    const copy = saturdayNoServiceCopy(routeId);
    const route = ROUTES[routeId];
    return {
        code: 'ERR_NO_SATURDAY_SERVICE',
        saturdayNoService: true,
        routeId,
        intendedDest: dest,
        blockedOrigin: origin,
        buttonText: 'No weekend service',
        stations: route ? [route.destA, route.destB] : [],
        ...copy,
    };
}
