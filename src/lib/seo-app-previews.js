/**
 * Route-landing phone previews of the Next Train tab.
 * Images are weekday 10:00 captures in public/images/seo/{routeId}-live-board.webp.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSeoRoutes, displayRouteName, stationLabel } from './seo-routes.js';
import { getSheet, loadScheduleDump } from './seo-timetable.js';
import { isRealTime, timeToSeconds } from './utils.js';

export const SEO_PREVIEW_SIM_TIME = '10:00:00';
export const SEO_PREVIEW_SIM_DAY_INDEX = 1;
export const SEO_PREVIEW_IMAGE_WIDTH = 435;
export const SEO_PREVIEW_IMAGE_HEIGHT = 807;

/** Owner-chosen station for the first landing screenshot — keep it. */
const PREFERRED_STATIONS = {
    'pta-pien': 'DEVENISH STREET',
};

const IGNORE_KEYS = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);

function normStation(raw) {
    return String(raw || '')
        .replace(/\s+STATION$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function isMetaStation(name) {
    const s = String(name || '').trim();
    if (!s) return true;
    if (/^Last Updated/i.test(s)) return true;
    if (s.toUpperCase() === 'STATION') return true;
    return false;
}

function sheetRows(route, ab) {
    const dump = loadScheduleDump();
    const key = route?.sheetKeys?.[`weekday_to_${ab}`];
    const rows = getSheet(dump, key) || [];
    return rows.filter((row) => row && row.STATION && !isMetaStation(row.STATION));
}

function rowHasUpcoming(row, afterSec) {
    if (!row) return false;
    for (const [key, value] of Object.entries(row)) {
        if (IGNORE_KEYS.has(key)) continue;
        if (!isRealTime(value)) continue;
        const sec = timeToSeconds(String(value).trim());
        if (Number.isFinite(sec) && sec >= afterSec) return true;
    }
    return false;
}

function findRow(rows, name) {
    const want = normStation(name);
    return rows.find((row) => normStation(row.STATION) === want) || null;
}

/**
 * Mid-corridor station with weekday trains still running at 10:00 both ways
 * when possible. Pretoria–Pienaarspoort stays on Devenish Street.
 * @param {object} route
 * @returns {string} sheet STATION value
 */
export function pickPreviewStation(route) {
    const afterSec = 10 * 3600;
    const rowsB = sheetRows(route, 'b');
    const rowsA = sheetRows(route, 'a');
    const names = [];
    const seen = new Set();
    for (const row of (rowsB.length ? rowsB : rowsA)) {
        const raw = String(row.STATION || '').trim();
        const key = normStation(raw);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(raw);
    }
    if (!names.length) return String(route?.destA || '').trim();

    const termini = new Set([normStation(route.destA), normStation(route.destB)]);
    const avoidHubs = new Set(['DURBAN', 'DURBAN YARD', 'CAPE TOWN', 'PRETORIA', 'JOHANNESBURG', 'JOHANNESBURG PARK']);
    const intermediates = names.filter((name) => !termini.has(normStation(name)));
    const awayFromHubs = intermediates.filter((name) => !avoidHubs.has(normStation(name)));
    const pool = awayFromHubs.length ? awayFromHubs : (intermediates.length ? intermediates : names);

    const score = (raw) => {
        const rowB = findRow(rowsB, raw);
        const rowA = findRow(rowsA, raw);
        const both = rowHasUpcoming(rowB, afterSec) && rowHasUpcoming(rowA, afterSec);
        const one = rowHasUpcoming(rowB, afterSec) || rowHasUpcoming(rowA, afterSec);
        return (both ? 2 : 0) + (one ? 1 : 0);
    };

    const preferred = PREFERRED_STATIONS[route.id];
    if (preferred) {
        const hit = names.find((name) => {
            const key = normStation(name);
            const want = normStation(preferred);
            return key === want || key.includes(want) || want.includes(key);
        });
        if (hit) return hit;
    }

    let best = -1;
    const top = [];
    for (const name of pool) {
        const value = score(name);
        if (value > best) {
            best = value;
            top.length = 0;
            top.push(name);
        } else if (value === best) {
            top.push(name);
        }
    }
    return top[0] || pool[0] || names[0];
}

export function seoPreviewImageRelPath(routeId) {
    return `images/seo/${routeId}-live-board.webp`;
}

export function seoPreviewImageAbsPath(routeId, root = process.cwd()) {
    return join(root, 'public', seoPreviewImageRelPath(routeId));
}

function previewImageExists(routeId) {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        seoPreviewImageAbsPath(routeId, process.cwd()),
        join(here, '../../public', seoPreviewImageRelPath(routeId)),
        join(process.cwd(), 'dist', seoPreviewImageRelPath(routeId)),
    ];
    return candidates.some((path) => existsSync(path));
}

export function getSeoAppPreview(routeId) {
    const entry = listSeoRoutes().find((item) => item.route.id === routeId);
    if (!entry) return null;
    const { route, seed } = entry;
    const name = displayRouteName(route);
    const stationRaw = pickPreviewStation(route);
    const station = stationLabel(stationRaw);
    return {
        routeId: route.id,
        slug: seed.slug,
        region: route.region,
        stationRaw,
        station,
        title: `See ${name} at a glance`,
        body: 'This route opens as a live board for your saved station. The timetable works offline, so you do not need data to check times, and you can download the latest sheet.',
        bullets: [
            'Upcoming departures and connections',
            'Full timetable and estimated fare',
            'Trip Planner and network map',
            'Works offline. Download the latest timetable',
        ],
        image: seoPreviewImageRelPath(route.id),
        alt: `Next Train live board for ${name} showing upcoming trains at ${station}, the full timetable, estimated fare, and app navigation`,
        linkLabel: `Open ${name} in Next Train`,
        hasImage: previewImageExists(route.id),
    };
}

export function listSeoAppPreviews() {
    return listSeoRoutes().map(({ route }) => getSeoAppPreview(route.id)).filter(Boolean);
}

/** Pretoria-JHB corridor phone preview of Trip Planner at weekday 10:00. */
export const SEO_PLANNER_PREVIEW_ID = 'pretoria-johannesburg';

export function seoPlannerPreviewImageRelPath() {
    return 'images/seo/pretoria-johannesburg-trip-plan.webp';
}

export function seoPlannerPreviewImageAbsPath(root = process.cwd()) {
    return join(root, 'public', seoPlannerPreviewImageRelPath());
}

function plannerPreviewImageExists() {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        seoPlannerPreviewImageAbsPath(process.cwd()),
        join(here, '../../public', seoPlannerPreviewImageRelPath()),
        join(process.cwd(), 'dist', seoPlannerPreviewImageRelPath()),
    ];
    return candidates.some((path) => existsSync(path));
}

export function getSeoPlannerPreview() {
    return {
        id: SEO_PLANNER_PREVIEW_ID,
        from: 'PRETORIA',
        to: 'JOHANNESBURG',
        region: 'GP',
        time: '10:00',
        day: 'weekday',
        title: 'See Pretoria to Johannesburg at a glance',
        body: 'Trip Planner builds the three-train journey from the published sheets.',
        image: seoPlannerPreviewImageRelPath(),
        alt: 'Next Train trip plan from Pretoria to Johannesburg on a weekday, showing the three-train journey via Kempton Park and Germiston',
        linkLabel: 'Plan Pretoria to Johannesburg in Next Train',
        bullets: [
            'Three-train Pretoria to Johannesburg plan',
            'Weekday midday connections',
            'Estimated fare and full journey',
        ],
        hasImage: plannerPreviewImageExists(),
    };
}
