/**
 * Zone Distance Audit — derive along-route km from station coordinates
 * and compare against assigned fare zones (admin diagnostics).
 *
 * WC (and other) timetable sheets print several branches on one grid.
 * Unique-row order concatenates those forks (Cape Town → Strand → Stellenbosch
 * → Stikland → Wellington ≈ 144 km). Real Cape Town–Wellington is ~72 km.
 *
 * Station-to-station hops come from the static PRASA network maps
 * (`public/images/network-map.png`, `network-map_wc.png`, `_kzn`, `_ec`)
 * as encoded by painted GeoJSON `stationNames` and `STATIC_ROUTE_PATHS`.
 * Those maps show separate forks: Century City vs Mutual, Strand vs
 * Stellenbosch vs Northern Line. A sheet union is not a path.
 *
 * Distance order:
 *   1. Painted network-map / baked rail destA→destB (gold GeoJSON)
 *   2. Map corridor destA→destB (static-map / bake station list)
 *   3. Timed train columns sliced destA→destB (stations with a clock)
 *   4. KM_MARK span
 *   5. Crow-flies destA to destB
 *
 * Zone bands default to PRASA Aug 2025:
 *   Z1 1–15 km · Z2 16–40 km · Z3 41–135 km · Z4 >135 km
 */
import { ROUTES, FARE_CONFIG } from './config.js';
import { normalizeStationName, flattenPublicHolidays } from './utils.js';

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

const NON_TRAIN_KEYS = new Set([
    'STATION', 'COORDINATES', 'KM_MARK', 'row_index', 'coordinates', 'KM',
]);

function isTrainTime(value) {
    const s = String(value ?? '').trim();
    if (!s || s === '-' || s === '—' || s === '–') return false;
    return /\d/.test(s);
}

export function stationAuditKey(name) {
    return stationShort(normalizeStationName(String(name || '')))
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function keysMatchStation(name, want) {
    const a = stationAuditKey(name);
    const b = stationAuditKey(want);
    if (!a || !b) return false;
    return a === b || a.startsWith(b) || b.startsWith(a);
}

function rowToStop(row, stationCol) {
    const rawName = row[stationCol] ?? row.STATION;
    if (rawName == null) return null;
    const name = normalizeStationName(String(rawName));
    if (!name || name === '-' || /inter-station|trip/i.test(name)) return null;
    const coords =
        parseCoords(row.COORDINATES ?? row.coordinates) ||
        parseCoords(row[Object.keys(row).find((k) => /coord/i.test(k))]);
    const kmMark = parseKmMark(row.KM_MARK ?? row.km_mark ?? row.KM);
    return {
        name,
        short: stationShort(name),
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        kmMark,
    };
}

function uniqueRowChain(schedule) {
    if (!schedule?.rows?.length) return [];
    const stationCol = schedule.stationColumnName || 'STATION';
    const chain = [];
    const seen = new Set();
    for (const row of schedule.rows) {
        const stop = rowToStop(row, stationCol);
        if (!stop) continue;
        const key = stop.name.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        chain.push(stop);
    }
    return chain;
}

/** One ordered stop list per train column (stations that have a clock). */
export function extractTimedTrainChains(schedule) {
    if (!schedule?.rows?.length) return [];
    const stationCol = schedule.stationColumnName || 'STATION';
    const trainCols = new Set();
    for (const row of schedule.rows) {
        if (!row || typeof row !== 'object') continue;
        for (const key of Object.keys(row)) {
            if (!NON_TRAIN_KEYS.has(key)) trainCols.add(key);
        }
    }
    const chains = [];
    for (const col of trainCols) {
        const chain = [];
        const seen = new Set();
        for (const row of schedule.rows) {
            if (!isTrainTime(row?.[col])) continue;
            const stop = rowToStop(row, stationCol);
            if (!stop) continue;
            const key = stop.name.toUpperCase();
            if (seen.has(key)) continue;
            seen.add(key);
            chain.push(stop);
        }
        if (chain.length >= 2) chains.push({ trainId: col, chain });
    }
    return chains;
}

export function sliceChainBetween(chain, destA, destB) {
    if (!chain?.length || !destA || !destB) return null;
    let iA = -1;
    let iB = -1;
    for (let i = 0; i < chain.length; i++) {
        if (iA < 0 && keysMatchStation(chain[i].name, destA)) iA = i;
        if (keysMatchStation(chain[i].name, destB)) iB = i;
    }
    if (iA < 0 || iB < 0) return null;
    if (iA === iB) return null;
    return iA < iB ? chain.slice(iA, iB + 1) : chain.slice(iB, iA + 1).reverse();
}

/**
 * destA→destB stop list: static-map / painted corridor first, then timed
 * trains, never the union of every printed branch on the sheet.
 */
export function extractStationChain(schedule, opts = {}) {
    return resolveStationChain(schedule, opts).chain;
}

export function extractSheetUnionChain(schedule) {
    return uniqueRowChain(schedule);
}

function coordLookupFromSchedule(schedule) {
    const lookup = new Map();
    for (const stop of uniqueRowChain(schedule)) {
        lookup.set(stationAuditKey(stop.name), stop);
    }
    return lookup;
}

/** stationNames on a baked corridor — the painted/static-map stop order. */
export function corridorNameList(featureOrNames) {
    const names = Array.isArray(featureOrNames)
        ? featureOrNames
        : featureOrNames?.properties?.stationNames;
    if (!Array.isArray(names) || names.length < 2) return [];
    return names
        .map((n) => String(n || '').replace(/\s+STATION$/i, '').trim())
        .filter(Boolean);
}

export function mapCorridorsFromFeatures(features = []) {
    return (features || []).map((f) => corridorNameList(f)).filter((n) => n.length >= 2);
}

export function mergeBakedCoordLookup(lookup, feature) {
    if (!lookup || !feature) return lookup;
    const names = feature?.properties?.stationNames || [];
    const coords = feature?.properties?.stationCoords || [];
    names.forEach((name, i) => {
        const key = stationAuditKey(name);
        const existing = lookup.get(key);
        if (existing?.lat != null && existing?.lon != null) return;
        const c = coords[i];
        if (!c || c.length < 2) return;
        const lat = Number(c[0]);
        const lon = Number(c[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        lookup.set(key, {
            name: existing?.name || String(name),
            short: existing?.short || stationShort(name),
            lat,
            lon,
            kmMark: existing?.kmMark ?? null,
        });
    });
    return lookup;
}

export function sliceNameList(names, destA, destB) {
    if (!names?.length || !destA || !destB) return null;
    let iA = -1;
    let iB = -1;
    for (let i = 0; i < names.length; i++) {
        if (iA < 0 && keysMatchStation(names[i], destA)) iA = i;
        if (keysMatchStation(names[i], destB)) iB = i;
    }
    if (iA < 0 || iB < 0) return null;
    if (iA === iB) return null;
    return iA < iB ? names.slice(iA, iB + 1) : names.slice(iB, iA + 1).reverse();
}

function stopsFromNames(names, lookup) {
    return (names || []).map((name) => {
        const hit = lookup?.get(stationAuditKey(name));
        if (hit) {
            return {
                name: hit.name || name,
                short: hit.short || stationShort(hit.name || name),
                lat: hit.lat ?? null,
                lon: hit.lon ?? null,
                kmMark: hit.kmMark ?? null,
            };
        }
        return {
            name,
            short: stationShort(name),
            lat: null,
            lon: null,
            kmMark: null,
        };
    });
}

/**
 * Undirected station adjacency from static-map / painted corridors.
 * Consecutive names on a corridor are a possible hop; forks are not joined.
 */
export function buildMapAdjacency(mapCorridors = []) {
    const adj = new Map();
    const add = (a, b) => {
        const ka = stationAuditKey(a);
        const kb = stationAuditKey(b);
        if (!ka || !kb || ka === kb) return;
        if (!adj.has(ka)) adj.set(ka, new Set());
        if (!adj.has(kb)) adj.set(kb, new Set());
        adj.get(ka).add(kb);
        adj.get(kb).add(ka);
    };
    for (const names of mapCorridors) {
        for (let i = 1; i < (names || []).length; i++) add(names[i - 1], names[i]);
    }
    return adj;
}

export function areMapAdjacent(adj, a, b) {
    if (!adj) return false;
    const ka = stationAuditKey(a);
    const kb = stationAuditKey(b);
    return !!(ka && kb && adj.get(ka)?.has(kb));
}

/**
 * destA→destB along a painted/static-map corridor, never a sheet-union of forks.
 * Prefers this route's own stop list, then the shortest covering corridor.
 */
export function extractMapStationChain(mapCorridors, destA, destB, lookup, preferredCorridor) {
    if (!destA || !destB) return null;
    const preferred = corridorNameList(preferredCorridor);
    if (preferred.length >= 2) {
        const slice = sliceNameList(preferred, destA, destB);
        if (slice?.length >= 2) return stopsFromNames(slice, lookup);
    }
    const slices = [];
    for (const names of mapCorridors || []) {
        const slice = sliceNameList(names, destA, destB);
        if (slice?.length >= 2) slices.push(slice);
    }
    if (!slices.length) return null;
    slices.sort((a, b) => a.length - b.length);
    return stopsFromNames(slices[0], lookup);
}

export function resolveStationChain(schedule, opts = {}) {
    const destA = opts.destA || '';
    const destB = opts.destB || '';
    const lookup = coordLookupFromSchedule(schedule);
    for (const feature of opts.bakedFeatures || []) mergeBakedCoordLookup(lookup, feature);
    if (opts.bakedFeature) mergeBakedCoordLookup(lookup, opts.bakedFeature);

    const mapCorridors = [];
    if (Array.isArray(opts.mapCorridors)) {
        for (const c of opts.mapCorridors) {
            const names = corridorNameList(c);
            if (names.length >= 2) mapCorridors.push(names);
        }
    }
    if (opts.staticPaths && typeof opts.staticPaths === 'object') {
        for (const names of Object.values(opts.staticPaths)) {
            const list = corridorNameList(names);
            if (list.length >= 2) mapCorridors.push(list);
        }
    }

    const mapChain = extractMapStationChain(
        mapCorridors,
        destA,
        destB,
        lookup,
        opts.mapCorridor,
    );
    if (mapChain?.length >= 2) return { chain: mapChain, source: 'map' };

    const timed = extractTimedTrainChains(schedule);
    const slices = [];
    for (const { chain } of timed) {
        const slice = destA && destB ? sliceChainBetween(chain, destA, destB) : chain;
        if (slice && slice.length >= 2) slices.push(slice);
    }
    if (slices.length) {
        const adj = mapCorridors.length ? buildMapAdjacency(mapCorridors) : null;
        const scored = slices.map((s) => {
            let jumps = 0;
            if (adj) {
                for (let i = 1; i < s.length; i++) {
                    if (!areMapAdjacent(adj, s[i - 1].name, s[i].name)) jumps++;
                }
            }
            return { s, km: measureStationChain(s).pathKm, jumps };
        }).filter((x) => x.km != null && x.km > 0);
        scored.sort((a, b) => (a.jumps - b.jumps) || (a.km - b.km));
        if (scored.length) return { chain: scored[Math.floor(scored.length / 2)].s, source: 'stops' };
        return { chain: slices[0], source: 'stops' };
    }
    if (destA && destB) {
        const sliced = sliceChainBetween(uniqueRowChain(schedule), destA, destB);
        if (sliced?.length >= 2) return { chain: sliced, source: 'sheet' };
    }
    return { chain: uniqueRowChain(schedule), source: 'sheet' };
}

function flattenBakedLatLngs(feature) {
    const geom = feature?.geometry;
    const lines =
        geom?.type === 'LineString'
            ? [geom.coordinates]
            : geom?.type === 'MultiLineString'
              ? geom.coordinates
              : [];
    const out = [];
    for (const line of lines || []) {
        for (const pair of line || []) {
            if (!pair || pair.length < 2) continue;
            const lon = Number(pair[0]);
            const lat = Number(pair[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            out.push([lat, lon]);
        }
    }
    return out;
}

function nearestBakedIndex(latlngs, lat, lon) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < latlngs.length; i++) {
        const d = haversineKm(lat, lon, latlngs[i][0], latlngs[i][1]);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

/** Along-rail km on the painted corridor between two station coords. */
export function bakedDestToDestKm(feature, a, b) {
    if (!feature || !a || !b) return null;
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
    const latlngs = flattenBakedLatLngs(feature);
    if (latlngs.length < 2) return null;
    const i1 = nearestBakedIndex(latlngs, a.lat, a.lon);
    const i2 = nearestBakedIndex(latlngs, b.lat, b.lon);
    if (i1 < 0 || i2 < 0 || i1 === i2) return null;
    const lo = Math.min(i1, i2);
    const hi = Math.max(i1, i2);
    let km = 0;
    for (let i = lo + 1; i <= hi; i++) {
        km += haversineKm(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1]);
    }
    return Math.round(km * 100) / 100;
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
        bakedKm: null,
        chainSource: null,
    };
}

/**
 * Primary distance: painted rail destA→destB, then timed-stop path, then KM_MARK, then crow.
 */
export function primaryDistanceKm(measure) {
    if (!measure) return null;
    if (measure.bakedKm != null && measure.bakedKm > 0) return measure.bakedKm;
    if (measure.pathKm != null && measure.pathKm > 0) return measure.pathKm;
    if (measure.kmMarkDelta != null && measure.kmMarkDelta > 0) return measure.kmMarkDelta;
    return measure.crowKm;
}

export function primaryDistanceSource(measure) {
    if (!measure) return null;
    if (measure.bakedKm != null && measure.bakedKm > 0) return 'rail';
    if (measure.pathKm != null && measure.pathKm > 0) return 'stops';
    if (measure.kmMarkDelta != null && measure.kmMarkDelta > 0) return 'km_mark';
    if (measure.crowKm != null) return 'crow';
    return null;
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
    const bakedById = new Map();
    for (const feature of opts.bakedFeatures || []) {
        const id = feature?.properties?.routeId;
        if (id) bakedById.set(id, feature);
    }
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

    db = flattenPublicHolidays(db);

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

            const baked = bakedById.get(route.id);
            const preferredNames = corridorNameList(baked);
            const resolved = resolveStationChain(parsed, {
                destA: route.destA,
                destB: route.destB,
                mapCorridor: preferredNames.length >= 2 ? preferredNames : opts.staticPaths?.[route.id],
                mapCorridors: [
                    ...mapCorridorsFromFeatures(opts.bakedFeatures || []),
                    ...Object.values(opts.staticPaths || {}),
                ],
                bakedFeature: baked,
                bakedFeatures: opts.bakedFeatures || [],
                staticPaths: opts.staticPaths,
            });
            const chain = resolved.chain;
            const measure = measureStationChain(chain);
            measure.chainSource = resolved.source;
            const ends = chain.filter((s) => s.lat != null && s.lon != null);
            if (baked && ends.length >= 2) {
                measure.bakedKm = bakedDestToDestKm(baked, ends[0], ends[ends.length - 1]);
            }
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
                distanceSource: primaryDistanceSource(measure),
                measure,
                fare: assignedZone && FARE_CONFIG.zones[assignedZone]
                    ? FARE_CONFIG.zones[assignedZone]
                    : null,
                monthly: assignedZone && FARE_CONFIG.zones_detailed?.[assignedZone]?.monthly != null
                    ? FARE_CONFIG.zones_detailed[assignedZone].monthly
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
        ticketTable: FARE_CONFIG.zones_detailed || {},
    };
}
