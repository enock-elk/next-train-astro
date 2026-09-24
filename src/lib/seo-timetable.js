/**
 * Build-time weekday/Saturday grids for SEO route landings.
 * Reads public/data/full-database.json — never Firebase — so crawlers see durable times.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FARE_CONFIG, ROUTES } from './config.js';
import { getGridOrderManifest, orderGridTrainIds } from './grid-order.js';
import { isRealTime, isExpressSkip, isVariantStationName, timeToSeconds, flattenPublicHolidays } from './utils.js';
import { gridStationLabel, stationLabel } from './seo-routes.js';
import {
  extractStationChain,
  measureStationChain,
  primaryDistanceKm,
  bakedDestToDestKm,
  corridorNameList,
  mapCorridorsFromFeatures,
} from './zone-distance-audit.js';

const IGNORE_KEYS = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);
const REGION_NESTS = ['gauteng', 'westerncape', 'kzn', 'easterncape'];

let _dump = null;
let _gridOrderDump;

function dumpCandidates() {
    const here = dirname(fileURLToPath(import.meta.url));
    return [
        // astro build cwd is the repo root; compiled modules live under dist/
        join(process.cwd(), 'public/data/full-database.json'),
        join(here, '../../public/data/full-database.json'),
        join(here, '../../../public/data/full-database.json'),
    ];
}

export function loadScheduleDump() {
    if (_dump) return _dump;
    const path = dumpCandidates().find((p) => existsSync(p));
    if (!path) {
        throw new Error('public/data/full-database.json not found (SEO timetable SSG)');
    }
    _dump = JSON.parse(readFileSync(path, 'utf8'));
    if (_dump?.westerncape) {
        _dump = { ..._dump, westerncape: flattenPublicHolidays(_dump.westerncape) };
    }
    return _dump;
}

/** Optional checked-in/exported RTDB snapshot for static builds. */
export function loadGridOrderDump() {
    if (_gridOrderDump !== undefined) return _gridOrderDump;
    const paths = dumpCandidates().map((path) => path.replace(/full-database\.json$/, 'grid-order.json'));
    const path = paths.find((candidate) => existsSync(candidate));
    _gridOrderDump = path ? JSON.parse(readFileSync(path, 'utf8')) : null;
    return _gridOrderDump;
}

function sheetFromNode(node, key) {
    if (!key || !node || typeof node !== 'object') return null;
    const candidates = [node[key], node.public_holidays?.[key]];
    for (const nested of candidates) {
        if (Array.isArray(nested) && nested.length) return nested;
        if (Array.isArray(nested?.rows) && nested.rows.length) return nested.rows;
    }
    return null;
}

/**
 * Same overlay idea as live `unwrapDatabase`: region nest wins over a stale
 * top-level copy of the same sheet key (e.g. June root vs August `gauteng`).
 * WC `*_pub` sheets live under westerncape.public_holidays.
 */
export function getSheet(db, key) {
    if (!key || !db) return null;
    for (const nest of REGION_NESTS) {
        const hit = sheetFromNode(db[nest], key);
        if (hit) return hit;
    }
    return sheetFromNode(db, key);
}

function manifestForSheet(db, key) {
    const root = getGridOrderManifest(db, key);
    if (root) return root;
    for (const nest of REGION_NESTS) {
        const nested = getGridOrderManifest(db?.[nest], key);
        if (nested) return nested;
    }
    return null;
}

export function formatClock(val) {
    if (!isRealTime(val)) return '';
    const s = String(val).trim();
    const parts = s.split(':');
    return `${parts[0]}:${parts[1]}`;
}

function isMetaStation(name) {
    const s = String(name || '').trim();
    if (!s) return true;
    if (/^Last Updated/i.test(s)) return true;
    if (s.toUpperCase() === 'STATION') return true;
    if (isVariantStationName(s)) return true;
    return false;
}

function dataRowsFromSheet(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    return rows.filter((r) => r && r.STATION && !isMetaStation(r.STATION));
}

function trainIdsFromRow(row) {
    if (!row || typeof row !== 'object') return [];
    return Object.keys(row).filter((k) => !IGNORE_KEYS.has(k));
}

function unionTrainIds(dataRows) {
    const ids = new Set();
    for (const row of dataRows) {
        for (const id of trainIdsFromRow(row)) ids.add(id);
    }
    return [...ids];
}

function rowHasClockInColumns(row, trainIds) {
    return (trainIds || []).some((id) => !!formatClock(row?.[id]));
}

function stationNameFromRow(row) {
    return gridStationLabel(String(row?.STATION || '').replace(/\s+/g, ' ').trim());
}

function findNamedClockedRow(dataRows, trainIds, name) {
    const want = String(name || '').trim().toLowerCase();
    if (!want) return null;
    const named = dataRows.find((r) => stationNameFromRow(r).toLowerCase() === want);
    if (named && rowHasClockInColumns(named, trainIds)) return named;
    return null;
}

function findOriginRow(dataRows, trainIds, originName) {
    return findNamedClockedRow(dataRows, trainIds, originName)
        || dataRows.find((r) => rowHasClockInColumns(r, trainIds))
        || dataRows[0];
}

function firstLastFromRow(row, trainIds) {
    let firstSec = Infinity;
    let lastSec = -1;
    let first = null;
    let last = null;
    for (const id of trainIds) {
        const clock = formatClock(row[id]);
        if (!clock) continue;
        const sec = timeToSeconds(String(row[id]).trim());
        if (sec < firstSec) {
            firstSec = sec;
            first = clock;
        }
        if (sec > lastSec) {
            lastSec = sec;
            last = clock;
        }
    }
    return { first, last };
}

/** Min/max of each train's first non-empty clock (joiners that never hit a named row). */
function firstLastFromTrainsFirstClock(keptRows, trainIds) {
    let firstSec = Infinity;
    let lastSec = -1;
    let first = null;
    let last = null;
    for (const id of trainIds) {
        for (const row of keptRows) {
            const clock = formatClock(row[id]);
            if (!clock) continue;
            const sec = timeToSeconds(String(row[id]).trim());
            if (sec < firstSec) {
                firstSec = sec;
                first = clock;
            }
            if (sec > lastSec) {
                lastSec = sec;
                last = clock;
            }
            break;
        }
    }
    return { first, last };
}

function departuresFromRow(row, trainIds) {
    const out = [];
    for (const id of trainIds) {
        const clock = formatClock(row[id]);
        if (clock) out.push(clock);
    }
    return out;
}

/**
 * @param {object} db
 * @param {string} sheetKey
 * @param {string} [originName]  Terminus we depart from (label, e.g. "Pretoria")
 * @param {{ destName?: string }} [options]
 * First/last are clocks on the origin row (the station named in "From … towards").
 * @returns {{
 *   sheetKey: string,
 *   stations: string[],
 *   trainIds: string[],
 *   cells: string[][],
 *   first: string|null,
 *   last: string|null,
 *   originStation: string,
 *   destStation: string,
 *   departures: string[],
 * } | null}
 */
export function extractSeoGrid(db, sheetKey, originName, options = {}) {
    const rows = getSheet(db, sheetKey);
    const dataRows = dataRowsFromSheet(rows);
    if (!dataRows.length) return null;

    const trainIds = orderGridTrainIds(sheetKey, unionTrainIds(dataRows), dataRows, {
        ...options,
        manifestOrder: options.manifestOrder || manifestForSheet(db, sheetKey),
    });
    if (!trainIds.length) return null;

    const stations = [];
    const cells = [];
    const keptRows = [];
    for (const row of dataRows) {
        if (!rowHasClockInColumns(row, trainIds)) continue;
        const name = stationNameFromRow(row);
        if (!name) continue;
        stations.push(name);
        cells.push(trainIds.map((id) => (isExpressSkip(row[id]) ? 'EXPR' : (formatClock(row[id]) || '-'))));
        keptRows.push(row);
    }
    if (!stations.length) return null;

    const originRow = findOriginRow(keptRows, trainIds, originName);
    const originStation = stationNameFromRow(originRow) || stations[0];
    const destRow = findNamedClockedRow(keptRows, trainIds, options.destName)
        || keptRows.filter((r) => rowHasClockInColumns(r, trainIds)).at(-1)
        || null;
    const destStation = destRow ? stationNameFromRow(destRow) : stations[stations.length - 1];
    const originClocks = originRow ? firstLastFromRow(originRow, trainIds) : { first: null, last: null };
    const { first, last } = originClocks.first
        ? originClocks
        : firstLastFromTrainsFirstClock(keptRows, trainIds);
    return {
        sheetKey,
        stations,
        trainIds,
        cells,
        first,
        last,
        originStation,
        destStation,
        departures: departuresFromRow(originRow, trainIds),
    };
}

/**
 * Weekday (open) + Saturday (details) grids for one ROUTES entry.
 * Direction A = toward destA; B = toward destB. Weekday-A is first.
 */
export function buildRouteSeoTimetable(route) {
    const db = loadScheduleDump();
    const exportedOrders = loadGridOrderDump();
    const keys = route?.sheetKeys || {};
    const origin = stationLabel(route.destA);
    const dest = stationLabel(route.destB);
    const orderOptions = {
        region: route?.region,
        runtimeConfig: exportedOrders?.[route?.region] || exportedOrders?.config?.grid_order?.[route?.region],
    };

    const weekdayA = extractSeoGrid(db, keys.weekday_to_a, dest, { ...orderOptions, destName: origin });
    const weekdayB = extractSeoGrid(db, keys.weekday_to_b, origin, { ...orderOptions, destName: dest });
    const saturdayA = extractSeoGrid(db, keys.saturday_to_a, dest, { ...orderOptions, destName: origin });
    const saturdayB = extractSeoGrid(db, keys.saturday_to_b, origin, { ...orderOptions, destName: dest });

    const labelGrid = (grid, fromName, toward) => {
        if (!grid) return null;
        return {
            ...grid,
            heading: directionGridHeading(fromName, toward),
            destName: toward,
        };
    };

    return {
        origin,
        dest,
        weekday: {
            a: labelGrid(weekdayA, dest, origin),
            b: labelGrid(weekdayB, origin, dest),
        },
        saturday: {
            a: labelGrid(saturdayA, dest, origin),
            b: labelGrid(saturdayB, origin, dest),
        },
        hasWeekday: !!(weekdayA || weekdayB),
        hasSaturday: !!(saturdayA || saturdayB),
    };
}

function faqAnswer(text) {
    return { '@type': 'Answer', text };
}

function faqQuestion(name, text) {
    return { '@type': 'Question', name, acceptedAnswer: faqAnswer(text) };
}

function itemListForGrid(grid, name) {
    if (!grid?.departures?.length) return null;
    return {
        '@type': 'ItemList',
        name,
        numberOfItems: grid.departures.length,
        itemListElement: grid.departures.map((clock, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: clock,
        })),
    };
}

/**
 * WebPage + FAQPage + terminus departure lists + Table stubs.
 */
export function buildRouteJsonLd({
    title,
    description,
    pageUrl,
    name,
    origin,
    dest,
    operatingNote,
    timetable,
}) {
    const wdA = timetable?.weekday?.a;
    const wdB = timetable?.weekday?.b;
    const faqs = [];

    if (wdB?.first) {
        faqs.push(
            faqQuestion(
                `What time is the first weekday train from ${origin} to ${dest}?`,
                `The first weekday train toward ${dest} arrives at ${wdB.first}${wdB.last ? `. The last arrives at ${wdB.last}` : ''}. Times include trains that join along the line, not only those that start at ${origin}. They are the published Metrorail weekday timetable, not a live countdown.`
            )
        );
    }
    if (wdA?.first) {
        faqs.push(
            faqQuestion(
                `What time is the first weekday train from ${dest} to ${origin}?`,
                `The first weekday train toward ${origin} arrives at ${wdA.first}${wdA.last ? `. The last arrives at ${wdA.last}` : ''}. Times include trains that join along the line, not only those that start at ${dest}. They are the published Metrorail weekday timetable, not a live countdown.`
            )
        );
    }
    faqs.push(
        faqQuestion(
            `Do Metrorail trains run on Sunday on ${origin} to ${dest}?`,
            operatingNote ||
                'Metrorail generally does not run on Sundays. Public holidays vary: some follow a Saturday/holiday timetable; others have no service. Confirm the day type in Next Train before you travel.'
        )
    );
    if (timetable?.hasSaturday) {
        faqs.push(
            faqQuestion(
                `Is there a Saturday timetable for ${origin} to ${dest}?`,
                `Yes. A Saturday sheet is published for this corridor. Open the Saturday section on this page, or the live board in Next Train.`
            )
        );
    }

    const lists = [
        itemListForGrid(wdB, `Weekday departures from ${origin} to ${dest}`),
        itemListForGrid(wdA, `Weekday departures from ${dest} to ${origin}`),
    ].filter(Boolean);

    const tables = [];
    for (const grid of [wdB, wdA]) {
        if (!grid) continue;
        tables.push({
            '@type': 'Table',
            name: `Weekday ${grid.heading}`,
            about: `${grid.originStation} → ${grid.destName} weekday Metrorail times`,
            description: `${grid.stations.length} stations, ${grid.trainIds.length} trains. First ${grid.first || '-'}, last ${grid.last || '-'}.`,
        });
    }

    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebPage',
                name: title,
                description,
                url: pageUrl,
                about: name,
                isPartOf: {
                    '@type': 'WebSite',
                    name: 'Metrorail Next Train',
                    url: 'https://nexttrain.co.za/',
                },
            },
            {
                '@type': 'FAQPage',
                mainEntity: faqs,
            },
            ...lists,
            ...tables,
        ],
    };
}

/** Corridor ends in in-app order (destA then destB) — used in H1, <title>, and metadata. */
export const SEO_SCHEDULE_YEAR = 2026;

export function corridorPairLabel(origin, dest) {
    return `${origin} to ${dest}`;
}

/** `{A} to {B} 2026 Train Times` — destA-first, same order as ROUTES.name. */
export function bidirectionalTitle(origin, dest) {
    return `${origin} to ${dest} ${SEO_SCHEDULE_YEAR} Train Times`;
}

/** SEO timetable heading: trains traveling from the far end toward this terminus. */
export function directionGridHeading(fromName, towardName) {
    return `From ${fromName} towards ${towardName}`;
}

/** Weekday train ids for SERP copy (route-name direction first). */
export function seoTrainIdSample(timetable, limit = 4) {
    const primary = timetable?.weekday?.b?.trainIds || [];
    const secondary = timetable?.weekday?.a?.trainIds || [];
    const seen = new Set();
    const out = [];
    for (const id of [...primary, ...secondary]) {
        const token = String(id || '').trim();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        out.push(token);
        if (out.length >= limit) break;
    }
    return out;
}

/** Exact directional phrase for body headings and meta copy. */
export function directionPhrase(from, to) {
    return `${from} to ${to}`;
}

/** @deprecated Use bidirectionalTitle — kept so older verify scripts fail closed if they still import this name. */
export function bothDirectionTitle(origin, dest) {
    return bidirectionalTitle(origin, dest);
}

export function routeDocumentTitle(origin, dest) {
    return `${bidirectionalTitle(origin, dest)} | Metrorail Next Train`;
}

export function routeMetaDescription(origin, dest, province, opts = {}) {
    const pair = `${origin} to ${dest}`;
    const trains = (opts.trainIds || []).map((id) => String(id || '').trim()).filter(Boolean).slice(0, 4);
    const trainBit = trains.length ? ` Current trains ${trains.join(', ')}.` : '';
    const fareBit = (opts.maxSingle && !opts.inferredZone)
        ? ` Max adult single ${opts.maxSingle}.`
        : ' Ticket prices in Next Train.';
    let satBit = '';
    if (opts.hasSaturday === true) satBit = ' Saturday schedule listed. No Sunday service.';
    else if (opts.hasSaturday === false) satBit = ' No Sunday service.';
    const nearby = opts.nearby ? ` ${String(opts.nearby).trim()}` : '';
    const provinceBit = province ? ` (${province})` : '';
    return `View and download the ${pair} Metrorail (PRASA) train schedule${provinceBit}. Updated ${SEO_SCHEDULE_YEAR} timetable.${trainBit}${fareBit} Works offline in Next Train, with next train, ticket prices, and trip planner.${satBit}${nearby}`;
}

function getDumpValue(db, key) {
    if (!key || !db) return null;
    for (const nest of REGION_NESTS) {
        const node = db[nest];
        const nested = node?.[key] ?? node?.public_holidays?.[key];
        if (nested != null && nested !== '') return nested;
    }
    const root = db[key] ?? db.public_holidays?.[key];
    if (root != null && root !== '') return root;
    return null;
}

function splitSheetKey(key) {
    const m = String(key || '').match(/^(.*)_to_(.*)_(weekday|sat|saturday)$/);
    if (!m) return null;
    return { prefix: m[1], dest: m[2], suffix: `_${m[3]}` };
}

/**
 * Build-time zone for a route. Reads `{sheetKey}_zone` from the dump (region nest
 * first, same overlay as getSheet). Missing zone → Z4 maximum + inferred flag.
 */
export function resolveRouteZone(route, dump = loadScheduleDump()) {
    const keys = Object.values(route?.sheetKeys || {});
    for (const key of keys) {
        const zone = getDumpValue(dump, `${key}_zone`);
        if (zone && FARE_CONFIG.zones[zone]) {
            return { code: zone, inferred: false };
        }
    }
    for (const key of keys) {
        const parts = splitSheetKey(key);
        if (!parts) continue;
        const reverseKey = `${parts.dest}_to_${parts.prefix}${parts.suffix}_zone`;
        const reverseZone = getDumpValue(dump, reverseKey);
        if (reverseZone && FARE_CONFIG.zones[reverseZone]) {
            return { code: reverseZone, inferred: false };
        }
    }
    return { code: 'Z4', inferred: true };
}

function zar(n) {
    return `R${Number(n).toFixed(2)}`;
}

/** Five maximum adult tickets for the route page fare table. */
export function buildRouteFareTable(route, dump = loadScheduleDump()) {
    const { code, inferred } = resolveRouteZone(route, dump);
    const prices = FARE_CONFIG.zones_detailed[code] || FARE_CONFIG.zones_detailed.Z4;
    return {
        zoneCode: code,
        inferred,
        tickets: [
            { label: 'Single', value: zar(prices.single) },
            { label: 'Return', value: zar(prices.return) },
            { label: 'Weekly Mon–Fri', value: zar(prices.weekly_mon_fri) },
            { label: 'Weekly Mon–Sat', value: zar(prices.weekly_mon_sat) },
            { label: 'Monthly', value: zar(prices.monthly) },
        ],
    };
}

export function firstLastSummaryLine(grid) {
    if (!grid) return null;
    const bits = [];
    if (grid.first) bits.push(`first ${grid.first}`);
    if (grid.last) bits.push(`last ${grid.last}`);
    if (!bits.length) return null;
    const at = grid.originStation
        || String(grid.heading || '').replace(/^From\s+/i, '').replace(/\s+towards\s+.+$/i, '')
        || '';
    return `${grid.heading}: ${bits.join(', ')} at ${at}`;
}

/** Ordered stop names for one corridor (weekday B, else weekday A). */
export function corridorStationList(timetable) {
    const grid = timetable?.weekday?.b || timetable?.weekday?.a;
    const seen = new Set();
    const out = [];
    for (const name of grid?.stations || []) {
        const key = String(name || '').trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

export function ogTimetableImageUrl(routeId, dir = 'A') {
    const id = encodeURIComponent(routeId || '');
    return `https://nexttrain.co.za/og/timetable.png?rt=${id}&dir=${dir === 'B' ? 'B' : 'A'}&d=wd`;
}

/**
 * Same-origin path into the in-app grid (Download / Share live there).
 * Pass through `withBase()` on GitHub Pages preview.
 */
export function buildRouteGridAppPath(routeId, dir = 'A', day = 'weekday') {
    const params = new URLSearchParams();
    params.set('rt', routeId || '');
    params.set('v', 'g');
    if (dir === 'B') params.set('dir', 'B');
    params.set('d', day === 'saturday' ? 'sa' : 'wd');
    const region = ROUTES[routeId]?.region;
    if (region) params.set('r', region);
    return `/?${params.toString()}`;
}

/** Live board for this corridor (no grid) — header / “open the app” CTAs. */
export function buildRouteBoardAppPath(routeId) {
    const params = new URLSearchParams();
    params.set('rt', routeId || '');
    const region = ROUTES[routeId]?.region;
    if (region) params.set('r', region);
    return `/?${params.toString()}`;
}

const DISTANCE_SHEET_ORDER = ['weekday_to_b', 'weekday_to_a', 'saturday_to_b', 'saturday_to_a'];
const TRACK_FILE = {
    GP: 'rail-tracks-GP.geojson',
    WC: 'rail-tracks-WC.geojson',
    KZN: 'rail-tracks-KZN.geojson',
    EC: 'rail-tracks-EC.geojson',
};
const bakedCache = new Map();

function loadBakedFeature(route) {
    const region = String(route?.region || '').toUpperCase();
    const file = TRACK_FILE[region];
    if (!file) return null;
    if (!bakedCache.has(region)) {
        const here = dirname(fileURLToPath(import.meta.url));
        const candidates = [
            join(process.cwd(), 'public/tracks', file),
            join(here, '../../public/tracks', file),
        ];
        const path = candidates.find((p) => existsSync(p));
        if (!path) {
            bakedCache.set(region, null);
        } else {
            try {
                bakedCache.set(region, JSON.parse(readFileSync(path, 'utf8')));
            } catch {
                bakedCache.set(region, null);
            }
        }
    }
    const fc = bakedCache.get(region);
    return (fc?.features || []).find((f) => f?.properties?.routeId === route?.id) || null;
}

/**
 * destA→destB km: painted rail when present, else timed published stops.
 * Same primary figure as the zone-distance audit.
 */
export function seoRouteDistanceKm(route, dump = loadScheduleDump()) {
    const keys = route?.sheetKeys || {};
    const dayDirs = [
        ...DISTANCE_SHEET_ORDER.filter((k) => keys[k]),
        ...Object.keys(keys).filter((k) => !DISTANCE_SHEET_ORDER.includes(k)),
    ];
    for (const dayDir of dayDirs) {
        const sheet = getSheet(dump, keys[dayDir]);
        if (!sheet) continue;
        const rows = Array.isArray(sheet) ? sheet : sheet.rows;
        if (!rows?.length) continue;
        const baked = loadBakedFeature(route);
        const regionFc = bakedCache.get(String(route?.region || '').toUpperCase());
        const chain = extractStationChain({
            rows,
            stationColumnName: 'STATION',
        }, {
            destA: route.destA,
            destB: route.destB,
            mapCorridor: corridorNameList(baked).length >= 2 ? corridorNameList(baked) : undefined,
            mapCorridors: mapCorridorsFromFeatures(regionFc?.features || []),
            bakedFeature: baked,
            bakedFeatures: regionFc?.features || [],
        });
        const measure = measureStationChain(chain);
        const ends = chain.filter((s) => s.lat != null && s.lon != null);
        if (baked && ends.length >= 2) {
            measure.bakedKm = bakedDestToDestKm(baked, ends[0], ends[ends.length - 1]);
        }
        const km = primaryDistanceKm(measure);
        if (km != null && Number.isFinite(km) && km > 0) {
            return Math.round(km * 10) / 10;
        }
    }
    return null;
}

/** Constants-row label. Null when the dump has no measurable chain. */
export function seoRouteDistanceLabel(km) {
    if (km == null || !Number.isFinite(km) || km <= 0) return null;
    return `${km.toFixed(1)} km along published stops`;
}
