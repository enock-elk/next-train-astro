/**
 * Zone Distance Audit — derive along-route km from station coordinates
 * and compare against assigned fare zones (admin diagnostics).
 *
 * Distances are crow-flies station-to-station sums along timetable order
 * (plus optional KM_MARK span). Prefer KM_MARK when present — closer to
 * official PRASA travel distance. Crow-flies path is an approximation.
 *
 * Zone bands default to PRASA Aug 2025:
 *   Z1 1–15 km · Z2 16–40 km · Z3 41–135 km · Z4 >135 km
 */
import { ROUTES, FARE_CONFIG } from './config.js';
import { normalizeStationName } from './utils.js';

/** Official PRASA max km (inclusive) for Z1–Z3; above Z3 → Z4. */
export const DEFAULT_ZONE_KM_BANDS = {
    Z1: FARE_CONFIG.zone_km_max?.Z1 ?? 15,
    Z2: FARE_CONFIG.zone_km_max?.Z2 ?? 40,
    Z3: FARE_CONFIG.zone_km_max?.Z3 ?? 135,
};

/** Human labels for the official distance table. */
export const ZONE_KM_RANGE_LABELS = {
    Z1: '1–15 km',
    Z2: '16–40 km',
    Z3: '41–135 km',
    Z4: '>135 km',
};

function stationShort(name) {
    return String(name || '').replace(/\s+STATION$/i, '').trim();
}

function deg2rad(deg) {
    return (deg * Math.PI) / 180;
}

/** Haversine distance in km (same formula as utils.getDistanceFromLatLonInKm). */
export function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function parseCoords(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s === '-' || s === '—' || s === '–') return null;
    const parts = s.split(',').map((p) => parseFloat(p.trim()));
    if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
    return { lat: parts[0], lon: parts[1] };
}

function parseKmMark(raw) {
    if (raw == null) return null;
    const n = parseFloat(String(raw).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {number} km
 * @param {{ Z1?: number, Z2?: number, Z3?: number }} bands
 * Maps continuous km onto PRASA bands (Z1 ≤15, Z2 ≤40, Z3 ≤135, else Z4).
 * Distances under 1 km still map to Z1 (minimum fare zone).
 */
export function suggestZoneFromKm(km, bands = DEFAULT_ZONE_KM_BANDS) {
    if (km == null || !Number.isFinite(km) || km < 0) return null;
    const z1 = Number(bands.Z1) || DEFAULT_ZONE_KM_BANDS.Z1;
    const z2 = Number(bands.Z2) || DEFAULT_ZONE_KM_BANDS.Z2;
    const z3 = Number(bands.Z3) || DEFAULT_ZONE_KM_BANDS.Z3;
    if (km <= z1) return 'Z1';
    if (km <= z2) return 'Z2';
    if (km <= z3) return 'Z3';
    return 'Z4';
}

export function resolveSheetZone(db, sheetKey) {
    if (!db || !sheetKey) return null;
    const direct = db[`${sheetKey}_zone`];
    if (direct && FARE_CONFIG.zones[direct]) return direct;

    if (sheetKey.includes('_to_')) {
        const parts = sheetKey.split('_to_');
        if (parts.length === 2) {
            const prefix = parts[0];
            const rest = parts[1];
            let suffix = '';
            let dest = '';
            if (rest.endsWith('_weekday')) {
                suffix = '_weekday';
                dest = rest.replace('_weekday', '');
            } else if (rest.endsWith('_saturday') || rest.endsWith('_sat')) {
                suffix = rest.endsWith('_saturday') ? '_saturday' : '_sat';
                dest = rest.slice(0, -suffix.length);
            }
            if (dest && suffix) {
                const reverseKey = `${dest}_to_${prefix}${suffix}_zone`;
                const reverseZone = db[reverseKey];
                if (reverseZone && FARE_CONFIG.zones[reverseZone]) return reverseZone;
            }
        }
    }
    return null;
}

function normalizeSheet(sheet, meta, parseJSONSchedule) {
    if (!sheet) return null;
    if (sheet.headers && sheet.rows) return sheet;
    if (Array.isArray(sheet) && typeof parseJSONSchedule === 'function') {
        return parseJSONSchedule(sheet, meta);
    }
    if (Array.isArray(sheet) && sheet.length) {
        const headers = Object.keys(sheet[0] || {}).filter((k) => k !== 'row_index');
        return { headers, rows: sheet, stationColumnName: 'STATION' };
    }
    return null;
}

/**
 * Build ordered station list with coords / km marks from a schedule sheet.
 */
export function extractStationChain(schedule) {
    if (!schedule?.rows?.length) return [];
    const stationCol = schedule.stationColumnName || 'STATION';
    const chain = [];
    const seen = new Set();

    for (const row of schedule.rows) {
        const rawName = row[stationCol] ?? row.STATION;
        if (rawName == null) continue;
        const name = normalizeStationName(String(rawName));
        if (!name || name === '-' || /inter-station|trip/i.test(name)) continue;
        const key = name.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const coords =
            parseCoords(row.COORDINATES ?? row.coordinates) ||
            parseCoords(row[Object.keys(row).find((k) => /coord/i.test(k))]);
        const kmMark = parseKmMark(row.KM_MARK ?? row.km_mark ?? row.KM);

        chain.push({
            name,
            short: stationShort(name),
            lat: coords?.lat ?? null,
            lon: coords?.lon ?? null,
            kmMark,
        });
    }
    return chain;
}

/**
 * Measure path along ordered stations (crow-flies segments).
 */
export function measureStationChain(chain) {
    const segments = [];
    let pathKm = 0;
    let missingCoords = 0;
    let withCoords = 0;

    for (const s of chain) {
        if (s.lat != null && s.lon != null) withCoords++;
        else missingCoords++;
    }

    for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1];
        const b = chain[i];
        let km = null;
        if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
            km = haversineKm(a.lat, a.lon, b.lat, b.lon);
            pathKm += km;
        }
        segments.push({
            from: a.short,
            to: b.short,
            km: km == null ? null : Math.round(km * 100) / 100,
        });
    }

    let crowKm = null;
    const first = chain.find((s) => s.lat != null && s.lon != null);
    const last = [...chain].reverse().find((s) => s.lat != null && s.lon != null);
    if (first && last && first !== last) {
        crowKm = Math.round(haversineKm(first.lat, first.lon, last.lat, last.lon) * 100) / 100;
    }

    let kmMarkDelta = null;
    const marks = chain.map((s) => s.kmMark).filter((m) => m != null);
    if (marks.length >= 2) {
        kmMarkDelta = Math.round(Math.abs(marks[marks.length - 1] - marks[0]) * 100) / 100;
    }

    pathKm = Math.round(pathKm * 100) / 100;

    return {
        stationCount: chain.length,
        withCoords,
        missingCoords,
        pathKm: withCoords >= 2 ? pathKm : null,
        crowKm,
        kmMarkDelta,
        segments,
        first: chain[0]?.short || null,
        last: chain[chain.length - 1]?.short || null,
    };
}

/**
 * Primary distance for zone suggestion: prefer KM_MARK span, else path sum.
 */
export function primaryDistanceKm(measure) {
    if (!measure) return null;
    if (measure.kmMarkDelta != null && measure.kmMarkDelta > 0) return measure.kmMarkDelta;
    if (measure.pathKm != null && measure.pathKm > 0) return measure.pathKm;
    return measure.crowKm;
}

/**
 * Audit all active routes in a regional DB.
 * @returns {{ routes: object[], summary: object, bands: object }}
 */
export function runZoneDistanceAudit(db, region, opts = {}) {
    const bands = {
        Z1: Number(opts.bands?.Z1) || DEFAULT_ZONE_KM_BANDS.Z1,
        Z2: Number(opts.bands?.Z2) || DEFAULT_ZONE_KM_BANDS.Z2,
        Z3: Number(opts.bands?.Z3) || DEFAULT_ZONE_KM_BANDS.Z3,
    };
    const parseJSONSchedule = opts.parseJSONSchedule || null;
    const routes = [];
    let mismatchCount = 0;
    let missingZoneCount = 0;
    let thinCoordsCount = 0;

    if (!db || typeof db !== 'object') {
        return {
            routes: [],
            summary: {
                routesScanned: 0,
                mismatches: 0,
                missingZones: 0,
                thinCoords: 0,
                error: 'No database payload to scan',
            },
            bands,
        };
    }

    Object.values(ROUTES).forEach((route) => {
        if (!route?.isActive || route.id === 'special_event') return;
        if (region && route.region !== region) return;

        const keys = route.sheetKeys || {};
        /** Prefer weekday directions for the primary chain; fall back to any available. */
        const preferredOrder = ['weekday_to_b', 'weekday_to_a', 'saturday_to_b', 'saturday_to_a'];
        const dayDirs = [
            ...preferredOrder.filter((k) => keys[k]),
            ...Object.keys(keys).filter((k) => !preferredOrder.includes(k)),
        ];

        const directions = [];
        const zonesSeen = new Set();

        for (const dayDir of dayDirs) {
            const sheetKey = keys[dayDir];
            if (!sheetKey) continue;
            const parsed = normalizeSheet(db[sheetKey], db[`${sheetKey}_meta`], parseJSONSchedule);
            if (!parsed) continue;

            const chain = extractStationChain(parsed);
            const measure = measureStationChain(chain);
            const assignedZone = resolveSheetZone(db, sheetKey);
            if (assignedZone) zonesSeen.add(assignedZone);

            const distKm = primaryDistanceKm(measure);
            const suggestedZone = suggestZoneFromKm(distKm, bands);
            const mismatch =
                assignedZone &&
                suggestedZone &&
                assignedZone !== suggestedZone;

            if (mismatch) mismatchCount++;
            if (!assignedZone) missingZoneCount++;
            if ((measure.withCoords || 0) < 2) thinCoordsCount++;

            directions.push({
                dayDir,
                sheetKey,
                assignedZone,
                suggestedZone,
                mismatch: !!mismatch,
                distanceKm: distKm,
                distanceSource:
                    measure.kmMarkDelta != null && measure.kmMarkDelta > 0
                        ? 'km_mark'
                        : measure.pathKm != null
                          ? 'path'
                          : measure.crowKm != null
                            ? 'crow'
                            : null,
                measure,
                fare: assignedZone && FARE_CONFIG.zones[assignedZone]
                    ? FARE_CONFIG.zones[assignedZone]
                    : null,
            });
        }

        if (!directions.length) {
            routes.push({
                routeId: route.id,
                routeName: route.name,
                region: route.region,
                destA: stationShort(route.destA),
                destB: stationShort(route.destB),
                zones: [],
                directions: [],
                primary: null,
                status: 'no_sheets',
            });
            return;
        }

        // Primary = first preferred direction with a usable distance, else first
        const primary =
            directions.find((d) => d.distanceKm != null) || directions[0];

        const anyMismatch = directions.some((d) => d.mismatch);
        const anyMissingZone = directions.some((d) => !d.assignedZone);

        routes.push({
            routeId: route.id,
            routeName: route.name,
            region: route.region,
            destA: stationShort(route.destA),
            destB: stationShort(route.destB),
            zones: [...zonesSeen],
            directions,
            primary,
            status: anyMismatch
                ? 'mismatch'
                : anyMissingZone
                  ? 'missing_zone'
                  : (primary?.measure?.withCoords || 0) < 2
                    ? 'thin_coords'
                    : 'ok',
        });
    });

    routes.sort((a, b) => {
        const rank = { mismatch: 0, missing_zone: 1, thin_coords: 2, no_sheets: 3, ok: 4 };
        return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
            String(a.routeName).localeCompare(String(b.routeName));
    });

    // Recalculate summary from unique routes (mismatch counted per direction above — use route-level)
    const routeMismatches = routes.filter((r) => r.status === 'mismatch').length;
    const routeMissingZones = routes.filter((r) => r.status === 'missing_zone').length;
    const routeThin = routes.filter((r) => r.status === 'thin_coords' || r.status === 'no_sheets').length;

    return {
        routes,
        summary: {
            routesScanned: routes.length,
            mismatches: routeMismatches,
            missingZones: routeMissingZones,
            thinCoords: routeThin,
            ok: routes.filter((r) => r.status === 'ok').length,
            // keep direction-level tallies for export detail
            directionMismatches: mismatchCount,
            directionMissingZones: missingZoneCount,
            directionThinCoords: thinCoordsCount,
        },
        bands,
    };
}
