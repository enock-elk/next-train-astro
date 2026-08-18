/**
 * Build-time weekday/Saturday grids for SEO route landings.
 * Reads public/data/full-database.json — never Firebase — so crawlers see durable times.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderGridTrainIds } from './grid-order.js';
import { isRealTime, timeToSeconds } from './utils.js';
import { stationLabel } from './seo-routes.js';

const IGNORE_KEYS = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);
const REGION_NESTS = ['gauteng', 'westerncape', 'kzn', 'easterncape'];

let _dump = null;

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
    return _dump;
}

/**
 * Same overlay idea as live `unwrapDatabase`: region nest wins over a stale
 * top-level copy of the same sheet key (e.g. June root vs August `gauteng`).
 */
export function getSheet(db, key) {
    if (!key || !db) return null;
    for (const nest of REGION_NESTS) {
        const nested = db[nest]?.[key];
        if (Array.isArray(nested) && nested.length) return nested;
    }
    if (Array.isArray(db[key]) && db[key].length) return db[key];
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
    return stationLabel(String(row?.STATION || '').replace(/\s+/g, ' ').trim());
}

function findOriginRow(dataRows, trainIds, originName) {
    const want = String(originName || '').trim().toLowerCase();
    if (want) {
        const named = dataRows.find((r) => stationNameFromRow(r).toLowerCase() === want);
        if (named && rowHasClockInColumns(named, trainIds)) return named;
    }
    return dataRows.find((r) => rowHasClockInColumns(r, trainIds)) || dataRows[0];
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
 * @returns {{
 *   sheetKey: string,
 *   stations: string[],
 *   trainIds: string[],
 *   cells: string[][],
 *   first: string|null,
 *   last: string|null,
 *   originStation: string,
 *   departures: string[],
 * } | null}
 */
export function extractSeoGrid(db, sheetKey, originName) {
    const rows = getSheet(db, sheetKey);
    const dataRows = dataRowsFromSheet(rows);
    if (!dataRows.length) return null;

    const trainIds = orderGridTrainIds(sheetKey, unionTrainIds(dataRows));
    if (!trainIds.length) return null;

    const stations = [];
    const cells = [];
    const keptRows = [];
    for (const row of dataRows) {
        if (!rowHasClockInColumns(row, trainIds)) continue;
        const name = stationNameFromRow(row);
        if (!name) continue;
        stations.push(name);
        cells.push(trainIds.map((id) => formatClock(row[id]) || '-'));
        keptRows.push(row);
    }
    if (!stations.length) return null;

    const originRow = findOriginRow(keptRows, trainIds, originName);
    const originStation = stationNameFromRow(originRow) || stations[0];
    const { first, last } = firstLastFromRow(originRow, trainIds);
    return {
        sheetKey,
        stations,
        trainIds,
        cells,
        first,
        last,
        originStation,
        departures: departuresFromRow(originRow, trainIds),
    };
}

/**
 * Weekday (open) + Saturday (details) grids for one ROUTES entry.
 * Direction A = toward destA; B = toward destB. Weekday-A is first.
 */
export function buildRouteSeoTimetable(route) {
    const db = loadScheduleDump();
    const keys = route?.sheetKeys || {};
    const origin = stationLabel(route.destA);
    const dest = stationLabel(route.destB);

    const weekdayA = extractSeoGrid(db, keys.weekday_to_a, dest);
    const weekdayB = extractSeoGrid(db, keys.weekday_to_b, origin);
    const saturdayA = extractSeoGrid(db, keys.saturday_to_a, dest);
    const saturdayB = extractSeoGrid(db, keys.saturday_to_b, origin);

    const labelGrid = (grid, toward) => {
        if (!grid) return null;
        return {
            ...grid,
            heading: `Showing trains to ${toward}`,
            destName: toward,
        };
    };

    return {
        origin,
        dest,
        weekday: {
            a: labelGrid(weekdayA, origin),
            b: labelGrid(weekdayB, dest),
        },
        saturday: {
            a: labelGrid(saturdayA, origin),
            b: labelGrid(saturdayB, dest),
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
                `The first weekday train from ${origin} toward ${dest} is ${wdB.first}${wdB.last ? `. The last is ${wdB.last}` : ''}. Times are the published Metrorail weekday timetable, not a live countdown.`
            )
        );
    }
    if (wdA?.first) {
        faqs.push(
            faqQuestion(
                `What time is the first weekday train from ${dest} to ${origin}?`,
                `The first weekday train from ${dest} toward ${origin} is ${wdA.first}${wdA.last ? `. The last is ${wdA.last}` : ''}. Times are the published Metrorail weekday timetable, not a live countdown.`
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
            description: `${grid.stations.length} stations, ${grid.trainIds.length} trains. First ${grid.first || '—'}, last ${grid.last || '—'}.`,
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

export function bothDirectionTitle(origin, dest) {
    return `${origin} to ${dest} & ${dest} to ${origin} train schedule`;
}

export function firstLastSummaryLine(grid) {
    if (!grid) return null;
    const bits = [];
    if (grid.first) bits.push(`first ${grid.first}`);
    if (grid.last) bits.push(`last ${grid.last}`);
    if (!bits.length) return null;
    return `${grid.heading}: ${bits.join(', ')}`;
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
    return `/?${params.toString()}`;
}
