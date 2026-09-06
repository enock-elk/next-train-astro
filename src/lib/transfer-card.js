/**
 * Live-board transfer (shuttle) card helpers.
 * Hub names come from the journey / route transfer station, never a hardcoded stop.
 * Dual onward options (short-turn + terminus) are Pienaarspoort only.
 */

/** Routes that may list a short-turn and a terminus train at the same hub. */
export const DUAL_HUB_OPTION_ROUTE_IDS = Object.freeze(['pta-pien']);

export function routeAllowsDualHubOptions(routeId) {
    return DUAL_HUB_OPTION_ROUTE_IDS.includes(String(routeId || ''));
}

/** Change station: configured hub on the journey, not a painted place name. */
export function resolveTransferHubName(journey) {
    const t1 = journey?.train1 || {};
    const conn = journey?.connection || {};
    return String(
        t1.terminationStation
        || conn.connectionStation
        || t1.headboardDestination
        || ''
    ).trim();
}

/**
 * Onward trains leaving the hub. Dual list only when the route is allow-listed
 * and a later train actually reaches the card destination.
 */
export function collectHubOnwardOptions(journey, routeId) {
    const conn = journey?.connection;
    if (!conn) return [];
    const options = [conn];
    const nextFull = journey?.nextFullJourney;
    if (
        routeAllowsDualHubOptions(routeId)
        && nextFull
        && String(nextFull.train || '') !== String(conn.train || '')
    ) {
        options.push(nextFull);
    }
    return options;
}
