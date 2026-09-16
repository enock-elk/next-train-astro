/**
 * Shared geometry clean-up for baked corridor LineStrings.
 *
 * Two artefacts made the painted map zig-zag instead of following the rail:
 *
 * 1. Station pins. The bake used to push the raw station coordinate on both
 *    ends of every hop to "bridge the snap gap". Metrorail station coordinates
 *    sit beside the track, so each stop left a sideways kick off the rail.
 *
 * 2. Siding detours. A station near a yard throat (Rissik, Mzimhlope, Mayfair,
 *    Kliptown, Saulsville) snaps to a node on a siding rather than the through
 *    line, so the hop into it and the hop out of it both run up that siding.
 *    The line leaves the corridor, reaches the station, and comes straight back
 *    to where it left -- an out-and-back that adds no progress along the route.
 *
 * Smooth rail geometry is worth more than touching the station pin: stations
 * decide which rail to follow and in what order, never where a vertex goes.
 *
 * `MAX_EXCURSION_M` keeps this honest. A real branch is long -- the KZN Berea
 * Road corridor forks at Duff's Road and runs 3.3 km out to kwaMashu before the
 * Bridge City branch -- so anything that far out is treated as geometry, not
 * damage. Only short out-and-backs are removed.
 */

/** Longest out-and-back treated as an artefact rather than a real branch. */
export const MAX_EXCURSION_M = 2000;
/** How close the line must come back to its departure point to count. */
export const RETURN_TOLERANCE_M = 35;
/** Vertices to look ahead for the return. */
const LOOKAHEAD = 600;

export function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Longest gap a removed pin may leave between its neighbours. A pin sitting
 * between two rail segments is bracketed by nodes a few hundred metres apart at
 * most. A pin that carries a chord hop, where OSM simply has no rail, brackets
 * kilometres -- De Wildt is 4.8 km out -- and removing it would leave the
 * corridor stopping short of its terminus. Those pins stay.
 */
export const MAX_PIN_BRIDGE_M = 600;

/**
 * Drop vertices that are exactly a station pin from this feature's own list.
 * The match is exact because the old generator pushed those very coordinates,
 * so this never guesses at real OSM vertices.
 *
 * @param {Array<[number, number]>} coords [lon, lat][]
 * @param {Array<[number, number]>} stationCoords [lat, lon][]
 */
/** A terminus pin this close to the rail is a hook, not the end of the line. */
export const MAX_TERMINUS_REACH_M = 150;

export function stripStationPins(coords, stationCoords, {
    maxBridgeM = MAX_PIN_BRIDGE_M,
    maxTerminusReachM = MAX_TERMINUS_REACH_M,
} = {}) {
    if (!Array.isArray(coords) || !Array.isArray(stationCoords)) return { coords, removed: 0 };
    const pins = new Set(
        stationCoords
            .filter((c) => Array.isArray(c) && c.length === 2)
            .map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`)
    );
    const kept = [];
    let removed = 0;
    for (let i = 0; i < coords.length; i++) {
        const pair = coords[i];
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const [lon, lat] = pair;
        if (pins.has(`${lat.toFixed(6)},${lon.toFixed(6)}`)) {
            const prev = kept[kept.length - 1];
            const next = coords[i + 1];
            if (prev && next) {
                const prevD = haversineM(prev[1], prev[0], lat, lon);
                const nextD = haversineM(lat, lon, next[1], next[0]);
                // Hook: the pin sits a few metres off a rail vertex on one
                // side and a long chord on the other (Loftus 11 m, Rissik 34 m).
                // Dropping it removes the kick into the marker. The long chord
                // stays until tracks:fill-chords can drape it onto OSM.
                if (Math.min(prevD, nextD) <= maxTerminusReachM) {
                    removed++;
                    continue;
                }
                // Interior pin: drop it when the rail either side is close
                // enough that the pin is a sideways kick. A pin that carries a
                // chord hop, where OSM simply has no rail, brackets kilometres
                // and has to stay or the corridor stops short.
                if (haversineM(prev[1], prev[0], next[1], next[0]) <= maxBridgeM) {
                    removed++;
                    continue;
                }
            } else {
                // Terminus pin. Keep it only when it is genuinely holding the
                // line out to the end of the corridor: De Wildt sits 2.9 km
                // past the last OSM rail. Where the rail already reaches the
                // station, as at Pretoria, the pin only adds a hook back on
                // itself, which is the reversal seen at four Pretoria routes.
                const neighbour = prev || next;
                if (neighbour && haversineM(neighbour[1], neighbour[0], lat, lon) <= maxTerminusReachM) {
                    removed++;
                    continue;
                }
            }
        }
        const last = kept[kept.length - 1];
        if (last && last[0] === lon && last[1] === lat) continue;
        kept.push([lon, lat]);
    }
    return kept.length > 1 ? { coords: kept, removed } : { coords, removed: 0 };
}

/**
 * Remove short out-and-back excursions. The line is spliced at the point it
 * left, so it stays continuous and never loses length along the corridor.
 *
 * @param {Array<[number, number]>} coords [lon, lat][]
 */
export function despikeRailLine(coords, {
    maxExcursionM = MAX_EXCURSION_M,
    returnToleranceM = RETURN_TOLERANCE_M,
} = {}) {
    if (!Array.isArray(coords) || coords.length < 4) return { coords, removed: 0, excursions: [] };
    const excursions = [];
    let current = coords;
    // Removing one excursion can expose another that shared its departure
    // point, so run until the line stops changing.
    for (let pass = 0; pass < 6; pass++) {
        const out = [];
        let i = 0;
        while (i < current.length) {
            const [lonA, latA] = current[i];
            let jump = -1;
            let reach = 0;
            for (let j = i + 3; j < Math.min(current.length, i + LOOKAHEAD); j++) {
                const [lonB, latB] = current[j];
                if (haversineM(latA, lonA, latB, lonB) > returnToleranceM) continue;
                let far = 0;
                for (let k = i; k <= j; k++) {
                    const d = haversineM(latA, lonA, current[k][1], current[k][0]);
                    if (d > far) far = d;
                }
                if (far > returnToleranceM && far <= maxExcursionM) {
                    jump = j;
                    reach = far;
                }
                break;
            }
            out.push(current[i]);
            if (jump > i) {
                excursions.push(Math.round(reach));
                i = jump + 1;
            } else {
                i++;
            }
        }
        if (out.length < 2 || out.length === current.length) {
            current = out.length > 1 ? out : current;
            break;
        }
        current = out;
    }
    return {
        coords: current,
        removed: coords.length - current.length,
        excursions,
    };
}
