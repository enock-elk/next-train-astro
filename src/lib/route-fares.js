/**
 * Confirmed corridor long fares: a single-route ceiling.
 *
 * Gauteng dump `{sheet}_zone` is treated as confirmed until RTDB says otherwise.
 * Other regions stay km-estimated unless an operator confirms them in
 * config/route_fares/{routeId}. Direct and same-route shuttle/relay trips
 * quote min(km zone, confirmed zone). Transfers across two route IDs are not capped.
 */
import { ROUTES, FARE_CONFIG, DYNAMIC_BASE_URL } from './config.js';
import { $fullDatabase } from '../store.js';

export const ROUTE_FARES_PATH = 'config/route_fares';
export const ZONE_RANK = { Z1: 1, Z2: 2, Z3: 3, Z4: 4 };

let cachedRouteFares = null;
let cachedRouteFaresAt = 0;
const ROUTE_FARES_TTL_MS = 60 * 1000;

export function cheaperZone(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    const ra = ZONE_RANK[a] || 99;
    const rb = ZONE_RANK[b] || 99;
    return ra <= rb ? a : b;
}

export function dumpZoneForRoute(routeId, db = $fullDatabase.get()) {
    if (!db || !routeId || !ROUTES[routeId]) return null;
    const route = ROUTES[routeId];
    const keysToCheck = Object.values(route.sheetKeys || {});
    for (const key of keysToCheck) {
        const zoneVal = db[`${key}_zone`];
        if (zoneVal && FARE_CONFIG.zones[zoneVal]) return zoneVal;
    }
    for (const key of keysToCheck) {
        if (!key.includes('_to_')) continue;
        const parts = key.split('_to_');
        if (parts.length !== 2) continue;
        const prefix = parts[0];
        const rest = parts[1];
        let suffix = '';
        let dest = '';
        if (rest.endsWith('_weekday')) { suffix = '_weekday'; dest = rest.replace('_weekday', ''); }
        else if (rest.endsWith('_saturday')) { suffix = '_saturday'; dest = rest.replace('_saturday', ''); }
        else if (rest.endsWith('_sat')) { suffix = '_sat'; dest = rest.slice(0, -4); }
        if (dest && suffix) {
            const reverseZone = db[`${dest}_to_${prefix}${suffix}_zone`];
            if (reverseZone && FARE_CONFIG.zones[reverseZone]) return reverseZone;
        }
    }
    return null;
}

export function setRouteFaresCache(map) {
    cachedRouteFares = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    cachedRouteFaresAt = Date.now();
}

export async function ensureRouteFares(force = false) {
    if (!force && cachedRouteFares && (Date.now() - cachedRouteFaresAt) < ROUTE_FARES_TTL_MS) {
        return cachedRouteFares;
    }
    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}${ROUTE_FARES_PATH}.json`, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            setRouteFaresCache(data && typeof data === 'object' ? data : {});
        } else if (!cachedRouteFares) {
            setRouteFaresCache({});
        }
    } catch {
        if (!cachedRouteFares) setRouteFaresCache({});
    }
    return cachedRouteFares || {};
}

export function lookupRouteFareCap(routeId) {
    const route = ROUTES[routeId];
    if (!route) return null;
    const row = cachedRouteFares?.[routeId];
    if (row && row.confirmed === false) return null;
    if (row && row.confirmed) {
        const zone = (row.zone && FARE_CONFIG.zones[row.zone]) ? row.zone : dumpZoneForRoute(routeId);
        if (!zone) return null;
        const adultPeak = Number(row.adultPeak);
        return {
            zone,
            adultPeak: Number.isFinite(adultPeak) && adultPeak >= 1 ? adultPeak : FARE_CONFIG.zones[zone],
            confirmed: true,
            source: row.source || 'rtdb',
        };
    }
    const regions = FARE_CONFIG.confirmedFareRegions || ['GP'];
    if (!regions.includes(route.region)) return null;
    const zone = dumpZoneForRoute(routeId);
    if (!zone) return null;
    return {
        zone,
        adultPeak: FARE_CONFIG.zones[zone],
        confirmed: true,
        source: 'dump',
    };
}

/** Km zone, never higher than a confirmed corridor long zone. */
export function capZoneForSingleRoute(kmZone, routeId) {
    const cap = lookupRouteFareCap(routeId);
    if (!cap?.zone) return kmZone || null;
    return cheaperZone(kmZone, cap.zone);
}

export function singleRouteIdFromList(routes) {
    if (!Array.isArray(routes) || routes.length !== 1 || !routes[0]?.id) return null;
    return routes[0].id;
}

export function buildRouteFareRecord(routeId, { zone, confirmed, source, updatedBy, at } = {}) {
    const z = zone && FARE_CONFIG.zones[zone] ? zone : dumpZoneForRoute(routeId);
    return {
        routeId: String(routeId || '').slice(0, 40),
        zone: z || null,
        adultPeak: z ? FARE_CONFIG.zones[z] : null,
        confirmed: confirmed !== false,
        source: String(source || 'admin').slice(0, 40),
        updatedAt: Number(at) || Date.now(),
        updatedBy: String(updatedBy || '').slice(0, 80),
    };
}
