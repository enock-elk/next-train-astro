/**
 * METRORAIL NEXT TRAIN - LIVE BOARD ENGINE (Phase 2 port from SPA)
 * Hand-maintained. Do NOT re-run assemble-live-board.mjs without FORCE_ASSEMBLE=1.
 */
import {
    $userRegion, $currentRouteId, $userProfile, $fullDatabase, $schedules,
    $globalStationIndex, $masterStationList, $globalExclusions, $globalDisruptions,
    $isSimMode, $simTime
} from '../store.js';
import {
    ROUTES, SPECIAL_DATES, HOLIDAY_NAMES, FARE_CONFIG, fareMultiplierForProfile, REFRESH_CONFIG, DYNAMIC_BASE_URL,
    MAX_RADIUS_KM
} from './config.js';
import {
    normalizeStationName, timeToSeconds, formatTimeDisplay, isRealTime, isVariantStationName, safeStorage,
    getDistanceFromLatLonInKm, escapeHTML, formatAppDate, usesWeekdayScheduleSheet, usesSaturdayScheduleSheet,
    usesPublicHolidayScheduleSheet, resolveOperatingDayType, scheduleCacheSlot, routeSheetKeyForDay,
    simUsesSpecificDate, exclusionAppliesToSurface, resolveStationLatLon, weekdaySheetsForRoute,
    schedulesBelongToRoute
} from './utils.js';
import {
    parseJSONSchedule, currentTime, currentDayType, currentDayIndex,
    loadAllSchedules, guardianFetch, paintHeaderDayLabel
} from './logic.js';
import { showToast, triggerHaptic, openSmoothModal, closeSmoothModal } from './ui.js';
import { routeAllowsDualHubOptions } from './transfer-card.js';
import { trackAnalyticsEvent } from './analytics.js';
import {
    shouldApplySilentLocate,
    rememberGeolocationGranted,
    disarmStartupLocateOverwrite,
    noteAutoLocateApplied,
    noteAutoLocateFailed,
} from './auto-locate.js';
import { peekLastGeoFix, reusableGeoFix } from './geo-watch.js';
import { resolveHolidayDayType } from './holiday-approvals.js';
import { liveBoardStaticKey, stampLiveBoardCard } from './live-board-paint.js';
import { isAdminAuthed } from './admin-chrome.js';
import {
    lastSafeStopBeforeDangerZone,
    collectDisruptionContactTimes,
    disruptionAppliesToDay,
    disruptionAppliesToAnyTime,
    disruptionAppliesToDayAndTime,
    disruptionShowsCancelledOnMap,
} from './disruption-zones.js';
export { stopsForTrain, expectedPosition, scoreTrainForFix } from './train-ghosts.js';
export {
    firstContactInDangerZone,
    lastSafeStopBeforeDangerZone,
    disruptionAppliesToDay,
    disruptionAppliesToAnyTime,
    disruptionAppliesToDayAndTime,
    disruptionShowsCancelledOnMap,
} from './disruption-zones.js';

// --- Store-backed globals (SPA parity shims) ---
let allStations = [];
let lastTrackedOD = null;
export let currentScheduleData = {};
let refreshTimer = null;

const getCurrentRouteId = () => $currentRouteId.get();
const getCurrentRegion = () => $userRegion.get() || 'GP';
const getFullDatabase = () => $fullDatabase.get();
const getSchedules = () => $schedules.get() || {};
const getGlobalStationIndex = () => $globalStationIndex.get() || {};
const getGlobalExclusions = () => $globalExclusions.get() || {};
const getGlobalDisruptions = () => $globalDisruptions.get() || {};
const getUserProfile = () => $userProfile.get() || 'Adult';
const getCurrentTime = () => (typeof window !== 'undefined' && window.currentTime) ? window.currentTime : currentTime;
const getCurrentDayType = () => (typeof window !== 'undefined' && window.currentDayType) ? window.currentDayType : currentDayType;
const getCurrentDayIndex = () => (typeof window !== 'undefined' && window.currentDayIndex !== undefined) ? window.currentDayIndex : currentDayIndex;

function stationSelectEl() { return typeof document !== 'undefined' ? document.getElementById('station-select') : null; }
function pretoriaTimeEl() { return typeof document !== 'undefined' ? document.getElementById('pretoria-time') : null; }
function pienaarspoortTimeEl() { return typeof document !== 'undefined' ? document.getElementById('pienaarspoort-time') : null; }
function pretoriaHeaderEl() { return typeof document !== 'undefined' ? document.getElementById('pretoria-header') : null; }
function pienaarspoortHeaderEl() { return typeof document !== 'undefined' ? document.getElementById('pienaarspoort-header') : null; }
function lastUpdatedEl() { return typeof document !== 'undefined' ? document.getElementById('last-updated-date') : null; }
function locateBtnEl() { return typeof document !== 'undefined' ? document.getElementById('locate-btn') : null; }

function setHeaderDest(el, destUpper) {
    if (!el) return;
    el.classList.add('flex', 'items-center', 'justify-center', 'gap-1.5', 'flex-wrap');
    let span = el.querySelector('[data-header-dest]');
    if (!span) {
        el.innerHTML = `Next train to <span data-header-dest class="text-blue-500 dark:text-blue-400">${destUpper}</span>`;
    } else {
        span.textContent = destUpper;
    }
}

/** True when loaded Saturday sheets contain at least one timed departure. */
export function scheduleHasService(schedule) {
    if (!schedule?.rows?.length || !Array.isArray(schedule.headers)) return false;
    const stationCol = schedule.stationColumnName || 'STATION';
    const trainCols = schedule.headers.filter((h) => h && h !== stationCol && h !== 'STATION' && h !== 'COORDINATES' && h !== 'KM_MARK' && h !== 'row_index');
    if (trainCols.length === 0) return false;
    return schedule.rows.some((row) => trainCols.some((col) => isRealTime(row[col])));
}

/** Journey has a usable clock departure (skips DB text notes like "Monte"). */
function journeyHasRealDeparture(j) {
    const dep = j?.departureTime || j?.train1?.departureTime;
    return isRealTime(dep);
}

/** Current route has usable Saturday timetable data in either direction. */
export function routeHasSaturdayService(schedules = getSchedules()) {
    return scheduleHasService(schedules?.saturday_to_a) || scheduleHasService(schedules?.saturday_to_b);
}

export function getLookaheadDayInfo(daysAhead = 1) {
    let baseDate = new Date();
    
    // Respect Developer Sim Mode only when the admin pinned a specific date.
    // Weekday/Sat/Sun sim must not inherit a leftover #sim-date (often "today").
    if ($isSimMode.get() && simUsesSpecificDate()) {
        const dateInput = document.getElementById('sim-date');
        if (dateInput && dateInput.value) {
            const parts = dateInput.value.split('-');
            if(parts.length === 3) {
                baseDate = new Date(parts[0], parts[1] - 1, parts[2]);
            }
        }
    }

    // Advance the physical date
    baseDate.setDate(baseDate.getDate() + daysAhead);

    const dayOfWeek = baseDate.getDay(); // 0 = Sunday, 6 = Saturday

    // Calendar weekday name for the physical date (e.g. Monday).
    let dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];
    if (daysAhead === 1) dayName = "Tomorrow";

    // Pad month and date for dictionary matching (e.g. "04-06")
    const m = String(baseDate.getMonth() + 1).padStart(2, '0');
    const d = String(baseDate.getDate()).padStart(2, '0');
    const dateKey = `${m}-${d}`;

    // Override the Schedule Type if it's a Special Date (Public Holiday).
    // Approved region overrides (when loaded) win over the static SPECIAL_DATES map.
    // Calendar Sunday always wins; WC remaps holiday saturday → public_holiday.
    const holidayName = (typeof HOLIDAY_NAMES !== 'undefined' && HOLIDAY_NAMES[dateKey]) || null;
    const region = (typeof $userRegion?.get === 'function' ? $userRegion.get() : null) || 'GP';
    const resolvedHoliday = resolveHolidayDayType(dateKey, region, baseDate.getFullYear())
        || (typeof SPECIAL_DATES !== 'undefined' ? SPECIAL_DATES[dateKey] : null)
        || null;
    const dayType = resolveOperatingDayType(dayOfWeek, resolvedHoliday, region);
    if (resolvedHoliday && holidayName) {
        // When the sheet is not the usual weekday (e.g. Women's Day Observed ->
        // Saturday/pub timetable on a Monday), surface the holiday so the UI does
        // not claim "Monday" while showing weekend trains.
        if (daysAhead === 1) {
            dayName = `Tomorrow (${holidayName})`;
        } else if ((dayType === 'saturday' || dayType === 'public_holiday') && dayOfWeek !== 6) {
            dayName = `${holidayName}`;
        } else if (dayType === 'sunday' && dayOfWeek !== 0) {
            dayName = holidayName;
        }
    }

    return {
        type: dayType,
        name: dayName,
        idx: dayOfWeek,
        isHoliday: !!(resolvedHoliday || (typeof SPECIAL_DATES !== 'undefined' && SPECIAL_DATES[dateKey])),
        holidayName: holidayName || null,
    };
};

// --- GUARDIAN PHASE 1 (Bug 4 Fix): The True Day Simulator ---
// Looks up to 7 days ahead to find the very next physical train that runs,
// securely bypassing Ghost Exclusions on Public Holidays and weekends.
export function simulateNextActiveService(selectedStation, destination) {
    if (!getCurrentRouteId() || !ROUTES[getCurrentRouteId()]) return null;
    const currentRoute = ROUTES[getCurrentRouteId()];
    
    let firstTrain = null;
    let daysAhead = 1;
    let nextDayInfo = null;

    const isDestA = (destination === currentRoute.destA);

    while (daysAhead <= 7 && !firstTrain) {
        nextDayInfo = window.getLookaheadDayInfo(daysAhead);
        
        // GUARDIAN BUGFIX: The Sunday Mirage Patch.
        if (nextDayInfo.type === 'sunday') {
            daysAhead++;
            continue;
        }

        // Skip Saturday/holiday sheets when this route has no weekend (or pub) timetable.
        const region = currentRoute.region || getCurrentRegion();
        const cacheSlot = scheduleCacheSlot(nextDayInfo.type, region, isDestA ? 'a' : 'b');
        if (nextDayInfo.type === 'saturday' && !routeHasSaturdayService()) {
            daysAhead++;
            continue;
        }
        if (nextDayInfo.type === 'public_holiday') {
            const pubSched = getSchedules()[cacheSlot];
            if (!scheduleHasService(pubSched) && !routeHasSaturdayService()) {
                daysAhead++;
                continue;
            }
        }

        const sheetKey = cacheSlot;
        const schedule = getSchedules()[sheetKey];
        
        if (schedule && schedule.rows && schedule.rows.length > 0) {
            const res = isDestA
                ? findNextJourneyToDestA(selectedStation, "00:00:00", schedule, currentRoute, nextDayInfo.idx)
                : findNextJourneyToDestB(selectedStation, "00:00:00", schedule, currentRoute, nextDayInfo.idx);
            
            const remainingJourneys = res.allJourneys.filter(j => timeToSeconds(j.departureTime || j.train1.departureTime) >= 0);
            if (remainingJourneys.length > 0) {
                firstTrain = remainingJourneys[0];
            }
        }
        
        if (!firstTrain) daysAhead++;
    }

    if (firstTrain) {
        return {
            train: firstTrain,
            dayInfo: nextDayInfo,
            daysAhead: daysAhead
        };
    }
    return null;
};

export function formatEffectiveDate(rawDateStr) {
    if (!rawDateStr || String(rawDateStr).toLowerCase().includes("undefined") || rawDateStr === "null") return "Unknown";
    let cleanStr = String(rawDateStr).replace(/^last updated[:\s-]*/i, '').trim();
    try {
        if (cleanStr.includes(',')) cleanStr = cleanStr.split(',')[0].trim();
        const d = new Date(cleanStr);
        if (!isNaN(d.getTime())) {
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        }
    } catch(e) {}
    return cleanStr;
}

// NEW HELPER: Count shared stations between two routes
export function getSharedStationCount(routeAId, routeBId) {
    let count = 0;
    for (const stationName in getGlobalStationIndex()) {
        const routes = getGlobalStationIndex()[stationName].routes;
        if (routes.has(routeAId) && routes.has(routeBId)) {
            count++;
        }
    }
    return count;
}

// NEW HELPER (V4.39): Get all future stations on the current route from a starting point
export function getTargetStations(schedule, fromStation) {
    if (!schedule || !schedule.rows) return new Set();
    const rows = schedule.rows;
    const fromIdx = rows.findIndex(r => normalizeStationName(r.STATION) === normalizeStationName(fromStation));
    
    if (fromIdx === -1) return new Set();
    
    const targets = new Set();
    for (let i = fromIdx + 1; i < rows.length; i++) {
        targets.add(normalizeStationName(rows[i].STATION));
    }
    return targets;
}

// NEW HELPER (V4.39): Check if a shared train actually stops at any of our target future stations
export function hasForwardOverlap(trainName, otherSchedule, fromStation, targetStations) {
    if (!otherSchedule || !otherSchedule.rows) return false;
    const rows = otherSchedule.rows;
    const fromIdx = rows.findIndex(r => normalizeStationName(r.STATION) === normalizeStationName(fromStation));
    
    if (fromIdx === -1) return false;

    for (let i = fromIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        // GUARDIAN BUGFIX: Safely cast to string to prevent .trim() crash on numeric cells
        const val = row[trainName] ? String(row[trainName]).trim() : "";
        if (val && val !== "-" && targetStations.has(normalizeStationName(row.STATION))) {
            return true;
        }
    }
    return false;
}

function sheetStationCol(schedule) {
    return schedule?.stationColumnName || 'STATION';
}

/** Last clock time on this column. Notes, dashes, and the VARIANT row are not a terminus. */
export function lastTimedStation(schedule, trainId) {
    const id = String(trainId || '').trim();
    const rows = schedule?.rows;
    if (!id || !rows?.length) return '';
    const col = sheetStationCol(schedule);
    for (let i = rows.length - 1; i >= 0; i--) {
        if (!isRealTime(rows[i]?.[id])) continue;
        const name = String(rows[i]?.[col] || '').trim();
        if (!name || /^last updated/i.test(name) || isVariantStationName(name)) continue;
        return name;
    }
    return '';
}

function stationRowIndex(schedule, station) {
    const target = normalizeStationName(station);
    if (!target || !schedule?.rows) return -1;
    const col = sheetStationCol(schedule);
    for (let i = 0; i < schedule.rows.length; i++) {
        if (normalizeStationName(schedule.rows[i]?.[col]) === target) return i;
    }
    return -1;
}

function timedStopCount(schedule, trainId) {
    const rows = schedule?.rows || [];
    let count = 0;
    for (const row of rows) {
        if (isRealTime(row?.[trainId])) count += 1;
    }
    return count;
}

/**
 * Real terminus for one train on the sheets already chosen for this day type.
 * A shared sheet that stops at Irene does not beat the same day's column that
 * continues to Kempton Park. Two sheets that both end at Irene stay at Irene.
 */
export function realTrainTerminus(trainId, schedules) {
    const id = String(trainId || '').trim();
    const hits = [];
    for (const schedule of schedules || []) {
        const stop = lastTimedStation(schedule, id);
        if (stop) hits.push({ schedule, stop });
    }
    if (!hits.length) return '';
    const isAfter = (later, earlier) => hits.some((row) => {
        const a = stationRowIndex(row.schedule, earlier);
        const b = stationRowIndex(row.schedule, later);
        return a >= 0 && b > a;
    });
    let best = hits[0];
    for (const hit of hits.slice(1)) {
        if (normalizeStationName(hit.stop) === normalizeStationName(best.stop)) {
            if (timedStopCount(hit.schedule, id) > timedStopCount(best.schedule, id)) best = hit;
            continue;
        }
        const hitLater = isAfter(hit.stop, best.stop);
        const bestLater = isAfter(best.stop, hit.stop);
        if (hitLater && !bestLater) best = hit;
        else if (!hitLater && !bestLater && timedStopCount(hit.schedule, id) > timedStopCount(best.schedule, id)) best = hit;
    }
    return best.stop;
}

function stripStationWord(name) {
    return String(name || '').replace(/\s+STATION$/i, '').trim();
}

const IRENE_KEMP_PAIR = Object.freeze({
    'pta-irene': 'pta-kempton',
    'pta-kempton': 'pta-irene',
});

/** The other South line sheet. Empty for every other route. */
export function siblingCorridorRouteId(routeId) {
    return IRENE_KEMP_PAIR[routeId] || '';
}

/** Same day and direction on the sibling route. Weekday never borrows Saturday. */
export function siblingSheetKey(routeId, sheetKey) {
    const siblingId = siblingCorridorRouteId(routeId);
    const route = ROUTES[routeId];
    const sibling = ROUTES[siblingId];
    const key = String(sheetKey || '');
    if (!route || !sibling || !key) return '';
    const field = Object.keys(route.sheetKeys || {}).find((name) => route.sheetKeys[name] === key);
    if (!field) return '';
    return sibling.sheetKeys?.[field] || '';
}

/** Elandsfontein and Rhodesfield are shown to commuters as Kempton Park. */
export function displaysAsKemptonPark(station) {
    const upper = normalizeStationName(station);
    return upper === 'KEMPTON PARK' || upper === 'ELANDSFONTEIN' || upper === 'RHODESFIELD';
}

/**
 * End the commuter is looking at. Durban Yard is Durban.
 * Elandsfontein and Rhodesfield stay Kempton Park.
 */
export function commuterEndKey(station) {
    const upper = normalizeStationName(station);
    if (displaysAsKemptonPark(upper)) return 'KEMPTON PARK';
    if (upper === 'DURBAN YARD' || upper === 'DURBAN') return 'DURBAN';
    return upper;
}

/**
 * Irene columns whose same-day terminus is Kempton Park.
 * A train that ends at Irene is not in the list.
 */
export function kempTrainIds(routeId, ownSchedule, siblingSchedule) {
    if (routeId !== 'pta-irene' || !ownSchedule?.headers || !siblingSchedule?.rows?.length) return [];
    const ids = [];
    for (const raw of ownSchedule.headers) {
        const id = String(raw || '').trim();
        if (!/^\d{4}[a-zA-Z]*$/.test(id)) continue;
        const terminus = realTrainTerminus(id, [ownSchedule, siblingSchedule]);
        if (displaysAsKemptonPark(terminus)) ids.push(id);
    }
    return ids;
}

function sheetStopNames(schedule) {
    const col = schedule?.stationColumnName || 'STATION';
    const names = new Set();
    for (const row of schedule?.rows || []) {
        const name = normalizeStationName(row?.[col] || row?.STATION);
        if (!name || name.startsWith('LAST UPDATED') || name === 'VARIANT') continue;
        names.add(name);
    }
    return names;
}

/**
 * Kempton Park columns that call on the Irene sheet but are not printed there.
 * A train that only ends at Irene is not included.
 */
export function extraKempTrainIds(ownSchedule, siblingSchedule) {
    if (!ownSchedule?.rows?.length || !siblingSchedule?.headers?.length) return [];
    const ownIds = new Set((ownSchedule.headers || []).map((id) => String(id)));
    const ownStops = sheetStopNames(ownSchedule);
    const col = siblingSchedule.stationColumnName || 'STATION';
    const ids = [];
    for (const raw of siblingSchedule.headers) {
        const id = String(raw || '').trim();
        if (!/^\d{4}[a-zA-Z]*$/.test(id) || ownIds.has(id)) continue;
        let serves = false;
        let kemp = false;
        for (const row of siblingSchedule.rows || []) {
            if (!isRealTime(row?.[id])) continue;
            const name = normalizeStationName(row?.[col] || row?.STATION);
            if (ownStops.has(name)) serves = true;
            if (displaysAsKemptonPark(name)) kemp = true;
        }
        if (serves && kemp) ids.push(id);
    }
    return ids;
}

/** Copy sibling times onto the stations this sheet already lists. Does not add stations. */
export function withExtraTrainColumns(schedule, siblingSchedule, ids) {
    const list = (ids || []).map((id) => String(id)).filter(Boolean);
    if (!schedule || !list.length) return schedule;
    const col = schedule.stationColumnName || 'STATION';
    const sibCol = siblingSchedule?.stationColumnName || 'STATION';
    const byName = new Map();
    for (const row of siblingSchedule?.rows || []) {
        const name = normalizeStationName(row?.[sibCol] || row?.STATION);
        if (name) byName.set(name, row);
    }
    const rows = (schedule.rows || []).map((row) => {
        const name = normalizeStationName(row?.[col] || row?.STATION);
        const src = byName.get(name);
        if (!src) return row;
        const next = { ...row };
        for (const id of list) {
            if (src[id] != null && String(src[id]).trim() !== '') next[id] = src[id];
        }
        return next;
    });
    const headers = [...(schedule.headers || [])];
    for (const id of list) {
        if (!headers.includes(id)) headers.push(id);
    }
    return { ...schedule, headers, rows };
}

/**
 * Shared-corridor pill. "To Kempton Park" only when this train, on this day
 * type, really ends somewhere other than the board's destination.
 * Same-end corridors still say "From …". A short working that ends here does not.
 */
export function sharedDestTag(currentDest, otherDest, terminus) {
    const board = commuterEndKey(currentDest);
    const other = commuterEndKey(otherDest);
    const raw = stripStationWord(terminus || otherDest || '');
    const actual = commuterEndKey(raw);
    const leaves = !!(actual && board && actual !== board);
    const sameEnd = !!(other && board && other === board);
    return {
        isShared: sameEnd || leaves,
        isDivergent: leaves,
        actualDestName: raw,
    };
}

/** Same expiry + days[] rules as isTrainExcluded; returns the RTDB rule or null. DEFAULT_EXCLUSIONS stays {}. */
export function getTrainExclusionRule(trainNumber, routeId, dayIdx, now = Date.now(), opts = null) {
    if (!trainNumber) return null;

    // Source of truth is `$globalExclusions` (Firebase tree, or DEFAULT only
    // when the exclusions fetch failed). Never silently fall back to hardcoded
    // corridor bans — those never appear in Global State Monitor.
    const rules = getGlobalExclusions()?.[routeId] || null;
    if (!rules || !rules[trainNumber]) return null;
    const rule = rules[trainNumber];
    if (rule.expiresAt && now > rule.expiresAt) return null;
    const days = Array.isArray(rule.days) ? rule.days : null;
    if (!(opts && opts.ignoreDays) && days && days.length) {
        const idx = Number(dayIdx);
        const hit = days.some((d) => Number(d) === idx);
        if (!hit) return null;
    }
    return rule;
}

/** True when a ban covers every Mon–Fri index, or has no day list (every day). */
export function weekdayPatternBanApplies(days) {
    if (!Array.isArray(days) || days.length === 0) return true;
    const set = days.map((d) => Number(d));
    return [1, 2, 3, 4, 5].every((d) => set.includes(d));
}

const SHEET_DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Train-sheet pill. A special is labeled Special. A partial weekday ban names
 * the days the train still runs (Mon+Fri off → Tue, Wed, Thu). A full weekday
 * ban, or no rule, stays on the sheet's day type.
 */
export function trainSheetOperatingLabel(dayType, routeId, trainId, now = Date.now()) {
    if (dayType === 'saturday') return 'Saturdays';
    if (dayType === 'sunday') return 'Sundays';
    if (dayType === 'public_holiday') return 'Public Holidays';
    const rule = getTrainExclusionRule(trainId, routeId, 1, now, { ignoreDays: true });
    if (!exclusionAppliesToSurface(rule, 'in_app')) return 'Weekdays';
    const type = rule.type || 'banned';
    if (type === 'special') return 'Special';
    const days = Array.isArray(rule.days) ? rule.days.map((d) => Number(d)) : [];
    if (!days.length || weekdayPatternBanApplies(days)) return 'Weekdays';
    const banned = new Set(days);
    const runs = [1, 2, 3, 4, 5].filter((d) => !banned.has(d));
    if (!runs.length) return 'Weekdays';
    return runs.map((d) => SHEET_DAY_SHORT[d]).join(', ');
}

const SHEET_DAY_FULL = {
    Mon: 'Monday',
    Tue: 'Tuesday',
    Wed: 'Wednesday',
    Thu: 'Thursday',
    Fri: 'Friday',
    Sat: 'Saturday',
    Sun: 'Sunday',
};

/** Same day modal as the header chip, for the train on this sheet. */
export function describeTrainSheetDayNote(dayType, routeId, trainId, now = Date.now()) {
    const label = trainSheetOperatingLabel(dayType, routeId, trainId, now);
    if (label === 'Saturdays') {
        return { title: 'Saturday Schedule', body: 'This train runs on Saturdays.' };
    }
    if (label === 'Sundays') {
        return { title: 'Sunday Schedule', body: 'This train is listed on the Sunday sheet.' };
    }
    if (label === 'Public Holidays') {
        return { title: 'Public Holiday', body: 'This train runs on the public holiday sheet.' };
    }
    if (label === 'Special') {
        return { title: 'Special Train', body: 'This train is a special working. It is not on the ordinary weekday pattern.' };
    }
    if (label === 'Weekdays') {
        return { title: 'Weekday Schedule', body: 'This train runs on weekdays, Monday to Friday.' };
    }
    const names = String(label).split(',').map((part) => SHEET_DAY_FULL[part.trim()] || part.trim()).filter(Boolean);
    const list = names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
        : (names[0] || 'weekdays');
    return { title: 'Weekday Schedule', body: `This train runs on ${list}.` };
}

/**
 * Generic Weekday chip (no picked date). A Mon/Fri-only ban does not remove
 * the train, because it still runs Tue–Thu. A ban with no days, or all of
 * Mon–Fri, still removes it. Special trains stay.
 */
export function isWeekdayPatternExcluded(trainNumber, routeId, surface = 'in_app', now = Date.now()) {
    const rule = getTrainExclusionRule(trainNumber, routeId, 1, now, { ignoreDays: true });
    if (!exclusionAppliesToSurface(rule, surface)) return false;
    const type = rule.type || 'banned';
    if (type === 'special') return false;
    if (!weekdayPatternBanApplies(rule.days)) return false;
    return type;
}

/** Omitted surface keeps legacy exclusions visible in both the app and timetable grid. */
export { exclusionAppliesToSurface };

// GUARDIAN HELPER V4.60.70: Ghost Train Logic
export function isTrainExcluded(trainNumber, routeId, dayIdx, surface = 'in_app') {
    const rule = getTrainExclusionRule(trainNumber, routeId, dayIdx);
    return exclusionAppliesToSurface(rule, surface) ? (rule.type || 'banned') : false;
}

const ADVISORY_WARN_PATH = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
const ADVISORY_INFO_PATH = 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';

/** critical stays red. caution is a delay. info is a timetable note, not a cancellation. */
export function paintAdvisoryFrame(tone = 'critical') {
    if (typeof document === 'undefined') return;
    const card = document.getElementById('disruption-modal-card');
    const icon = document.getElementById('disruption-icon-svg');
    const reply = document.getElementById('disruption-modal-reply-btn');
    const critical = tone === 'critical';
    const caution = tone === 'caution';
    if (card) {
        card.classList.remove('border-red-500', 'border-yellow-500', 'border-blue-500');
        card.classList.add(critical ? 'border-red-500' : caution ? 'border-yellow-500' : 'border-blue-500');
    }
    if (icon) {
        icon.setAttribute('class', critical
            ? 'w-5 h-5 mr-2 text-red-500'
            : caution
                ? 'w-5 h-5 mr-2 text-yellow-500'
                : 'w-5 h-5 mr-2 text-blue-500');
        const path = icon.querySelector('path');
        if (path) path.setAttribute('d', tone === 'info' ? ADVISORY_INFO_PATH : ADVISORY_WARN_PATH);
    }
    if (reply) {
        reply.classList.remove('bg-red-600', 'hover:bg-red-700', 'bg-blue-600', 'hover:bg-blue-700');
        if (critical) reply.classList.add('bg-red-600', 'hover:bg-red-700');
        else reply.classList.add('bg-blue-600', 'hover:bg-blue-700');
    }
}

export function openTrainExclusionSheet(routeId, trainNumber, dayIdx) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    paintAdvisoryFrame('critical');
    const rule = getTrainExclusionRule(trainNumber, routeId, dayIdx);
    const titleEl = typeof document !== 'undefined' ? document.getElementById('disruption-modal-stations') : null;
    const bodyEl = typeof document !== 'undefined' ? document.getElementById('disruption-modal-body') : null;
    const badgeEl = typeof document !== 'undefined' ? document.getElementById('disruption-modal-tier-badge') : null;
    const timeEl = typeof document !== 'undefined' ? document.getElementById('disruption-modal-timestamp') : null;
    const iconEl = typeof document !== 'undefined' ? document.getElementById('disruption-icon-svg') : null;
    const trainLabel = String(trainNumber || '').trim() || 'This train';
    if (titleEl) titleEl.textContent = `Train ${trainLabel}`;
    if (bodyEl) bodyEl.textContent = (rule && rule.reason) ? String(rule.reason) : 'No service on this day';
    if (badgeEl) {
        badgeEl.className = 'w-full text-center text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 py-2.5 rounded-lg border border-red-200 dark:border-red-800/50';
        badgeEl.textContent = 'NO SERVICE';
    }
    if (iconEl) iconEl.setAttribute('class', 'w-5 h-5 mr-2 text-red-500');
    if (timeEl) {
        if (isAdminAuthed() && rule && rule.expiresAt) {
            timeEl.textContent = `Until: ${formatAppDate(rule.expiresAt, { withTime: true })}`;
            timeEl.classList.remove('hidden');
        } else {
            timeEl.textContent = '';
            timeEl.classList.add('hidden');
        }
    }
    const replyBtn = typeof document !== 'undefined' ? document.getElementById('disruption-modal-reply-btn') : null;
    if (replyBtn) {
        replyBtn.onclick = async (e) => {
            e.preventDefault();
            const reason = (rule && rule.reason) ? String(rule.reason) : 'No service on this day';
            const snippet = `Train ${trainLabel}: ${reason}`;
            const replyOptions = {
                label: 'Replying to Advisory:',
                snippet,
                rawMsg: snippet,
                alertId: `exclusion-${String(routeId || 'route')}-${trainLabel}`,
                alertKind: 'disruption',
            };
            try {
                const { openFeedbackReplyFromOverlay } = await import('./hub.js');
                openFeedbackReplyFromOverlay('disruption-modal', replyOptions);
            } catch {
                if (typeof closeSmoothModal === 'function') closeSmoothModal('disruption-modal');
                if (typeof window.openFeedbackModal === 'function') {
                    window.openFeedbackModal({ location: 'grid_exclusion_reply' });
                }
            }
        };
    }
    if (typeof openSmoothModal === 'function') openSmoothModal('disruption-modal');
}

/** Timetable note. Same advisory sheet as no service, without the critical treatment. */
export function openTrainMarkSheet({ train, body, badge } = {}) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    paintAdvisoryFrame('info');
    const titleEl = typeof document !== 'undefined' ? document.getElementById('disruption-modal-stations') : null;
    const bodyEl = typeof document !== 'undefined' ? document.getElementById('disruption-modal-body') : null;
    const badgeEl = typeof document !== 'undefined' ? document.getElementById('disruption-modal-tier-badge') : null;
    const timeEl = typeof document !== 'undefined' ? document.getElementById('disruption-modal-timestamp') : null;
    const trainLabel = String(train || '').trim() || 'This train';
    const note = String(body || '').trim() || 'This train has a timetable note.';
    const badgeText = String(badge || 'NOTE').trim();
    if (titleEl) titleEl.textContent = `Train ${trainLabel}`;
    if (bodyEl) bodyEl.textContent = note;
    if (badgeEl) {
        badgeEl.className = 'w-full text-center text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 py-2.5 rounded-lg border border-blue-200 dark:border-blue-800/50';
        badgeEl.textContent = badgeText;
    }
    if (timeEl) {
        timeEl.textContent = '';
        timeEl.classList.add('hidden');
    }
    const replyBtn = typeof document !== 'undefined' ? document.getElementById('disruption-modal-reply-btn') : null;
    if (replyBtn) {
        replyBtn.onclick = async (e) => {
            e.preventDefault();
            const snippet = `Train ${trainLabel}: ${note}`;
            const replyOptions = {
                label: 'Replying to Advisory:',
                snippet,
                rawMsg: snippet,
                alertId: `mark-${trainLabel}`,
                alertKind: 'disruption',
            };
            try {
                const { openFeedbackReplyFromOverlay } = await import('./hub.js');
                openFeedbackReplyFromOverlay('disruption-modal', replyOptions);
            } catch {
                if (typeof closeSmoothModal === 'function') closeSmoothModal('disruption-modal');
                if (typeof window.openFeedbackModal === 'function') {
                    window.openFeedbackModal({ location: 'grid_mark_reply' });
                }
            }
        };
    }
    if (typeof openSmoothModal === 'function') openSmoothModal('disruption-modal');
}

function unwrapSheetRows(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'object') {
        if (Array.isArray(raw.rows)) return raw.rows;
        return Object.keys(raw)
            .filter((k) => k !== 'lastUpdated' && k !== 'headers' && k !== 'rows')
            .sort((a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b)))
            .map((k) => raw[k])
            .filter((r) => r && typeof r === 'object');
    }
    return [];
}

/**
 * Geographic station order for a corridor, including inactive / ghost rows.
 * Ghosts are geometry only (map path + shared-corridor cuts), never boarding.
 */
export function routeGeometryStations(rId) {
    if (!rId || !getFullDatabase() || !ROUTES[rId]) return [];
    const route = ROUTES[rId];
    const keys = [
        route.sheetKeys?.weekday_to_b,
        route.sheetKeys?.weekday_to_a,
        route.sheetKeys?.saturday_to_b,
        route.sheetKeys?.saturday_to_a,
    ].filter(Boolean);
    const names = [];
    const seen = new Set();
    const pushName = (raw) => {
        if (!raw) return;
        const lower = String(raw).toLowerCase();
        if (lower.includes('updated') || lower.includes('inter-station')) return;
        const norm = normalizeStationName(raw);
        if (!norm || seen.has(norm)) return;
        seen.add(norm);
        names.push(norm);
    };
    for (const key of keys) {
        const rows = unwrapSheetRows(getFullDatabase()[key]);
        const before = names.length;
        rows.forEach((r) => pushName(r.STATION));
        if (names.length > before) break;
    }
    return names;
}

function tripOverlapsSegment(master, tripA, tripB, zoneA, zoneB) {
    const iA = master.indexOf(normalizeStationName(tripA));
    const iB = master.indexOf(normalizeStationName(tripB));
    const zA = master.indexOf(normalizeStationName(zoneA));
    const zB = master.indexOf(normalizeStationName(zoneB));
    if (iA < 0 || iB < 0 || zA < 0 || zB < 0) return false;
    const tMin = Math.min(iA, iB);
    const tMax = Math.max(iA, iB);
    const zMin = Math.min(zA, zB);
    const zMax = Math.max(zA, zB);
    return tMax >= zMin && tMin <= zMax;
}

// --- GUARDIAN PHASE 3: CROSS-CORRIDOR TIERED INCIDENT MANAGEMENT HELPERS ---
export function checkDisruption(routeId, stationA, stationB) {
    if (!getGlobalDisruptions()) return null;
    
    let highestDisruption = null;
    const normA = normalizeStationName(stationA);
    const normB = normalizeStationName(stationB);
    const master = routeGeometryStations(routeId);

    const prioritizeDisruption = (current, incoming) => {
        if (!current) return incoming;
        if (incoming.tier === 'CRITICAL' && current.tier !== 'CRITICAL') return incoming;
        return current;
    };

    // GUARDIAN PHASE 3: Cross-Corridor Geometry Scan
    // We scan ALL disruptions across the entire network. If a disruption's coordinates
    // match the current commuter's route geometry, we apply it, regardless of the routeId it was filed under.
    for (const dRouteId in getGlobalDisruptions()) {
        const activeDisruptions = getGlobalDisruptions()[dRouteId];
        
        for (const d of activeDisruptions) {
            const dayType = (typeof window !== 'undefined' && window.currentDayType) || currentDayType || 'weekday';
            const nowStr = (typeof window !== 'undefined' && window.currentTime) || currentTime || '';
            if (!disruptionAppliesToDayAndTime(d, dayType, nowStr)) continue;

            // If no specific stations are defined, it's a route-wide suspension.
            // This MUST strictly apply only to its parent route to avoid shutting down the whole app.
            if (!d.stations || d.stations.length === 0) {
                if (dRouteId === routeId) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
                continue;
            }

            const normDisruptedStations = d.stations.map(s => normalizeStationName(s));

            // Segment block (e.g., Pretoria to Sportpark) — any corridor that shares that stretch
            if (normDisruptedStations.length >= 2) {
                if (tripOverlapsSegment(master, normA, normB, normDisruptedStations[0], normDisruptedStations[1])) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
            } 
            // Single station block — any corridor whose geometry includes that stop
            else if (normDisruptedStations.length === 1) {
                const target = normDisruptedStations[0];
                if (master.includes(target)
                    && (normA === target || normB === target
                        || tripOverlapsSegment(master, normA, normB, target, target))) {
                    highestDisruption = prioritizeDisruption(highestDisruption, d);
                }
            }
        }
    }
    return highestDisruption;
};

// GUARDIAN PHASE 3 (ZONE ENGINE): Cross-Corridor "First Point of Contact" Calculation
export function getTripDisruptions(routeId, stopsArray, dayType) {
    if (!getGlobalDisruptions() || !stopsArray || stopsArray.length === 0) return [];
    
    const hits = [];
    const seenIds = new Set();
    const resolvedDay = dayType
        || (typeof window !== 'undefined' && window.selectedPlannerDay)
        || (typeof window !== 'undefined' && window.currentDayType)
        || currentDayType
        || 'weekday';

    // Master geography includes inactive / ghost rows so shared-corridor cuts
    // (Pretoria–Sportpark on Irene) also hit Kempton Park.
    const currentRouteMasterStations = routeGeometryStations(routeId);

    // Scan ALL active disruptions across the network (Cross-Corridor Scan)
    for (const dRouteId in getGlobalDisruptions()) {
        const activeDisruptions = getGlobalDisruptions()[dRouteId];
        
        for (const d of activeDisruptions) {
            if (seenIds.has(d.id)) continue;
            if (!disruptionAppliesToDay(d, resolvedDay)) continue;
            if (!disruptionAppliesToAnyTime(d, collectDisruptionContactTimes(stopsArray, d, currentRouteMasterStations))) continue;

            // 1. Route-Wide Advisory (0 Stations)
            // Strict limitation: Only applies if the commuter is actually ON the severed route
            if (!d.stations || d.stations.length === 0) {
                if (dRouteId === routeId) {
                    seenIds.add(d.id);
                    hits.push({
                        ...d,
                        triggerStopIndex: 0,
                        triggerStationA: stopsArray[0].station,
                        triggerStationB: stopsArray[stopsArray.length - 1].station
                    });
                }
                continue;
            }

            const normDisrupted = d.stations.map(s => normalizeStationName(s));

            // 2. Single Station Incident (Universal Match)
            if (normDisrupted.length === 1) {
                const targetNorm = normDisrupted[0];
                const contactIdx = stopsArray.findIndex(s => normalizeStationName(s.station) === targetNorm);
                
                if (contactIdx !== -1) {
                    seenIds.add(d.id);
                    hits.push({
                        ...d,
                        triggerStopIndex: contactIdx,
                        triggerStationA: d.stations[0],
                        triggerStationB: d.stations[0]
                    });
                }
                continue;
            }

            // 3. Multi-Station "Danger Zone" — interval overlap (not a single hop
            // that spans the whole zone; real trips stop at every station).
            if (normDisrupted.length >= 2) {
                const triggerStopIndex = lastSafeStopBeforeDangerZone(
                    currentRouteMasterStations,
                    stopsArray,
                    normDisrupted[0],
                    normDisrupted[1]
                );

                if (triggerStopIndex !== -1) {
                    seenIds.add(d.id);
                    hits.push({
                        ...d,
                        triggerStopIndex,
                        triggerStationA: d.stations[0],
                        triggerStationB: d.stations[1]
                    });
                }
            }
        }
    }
    
    // Priority: CRITICAL events float to the top. Then sort by earliest contact index in the journey.
    hits.sort((a, b) => {
        if (a.tier === 'CRITICAL' && b.tier !== 'CRITICAL') return -1;
        if (a.tier !== 'CRITICAL' && b.tier === 'CRITICAL') return 1;
        return a.triggerStopIndex - b.triggerStopIndex;
    });
    
    return hits;
};

export function buildMasterStationList() {
    window.MASTER_STATION_LIST = Object.keys(getGlobalStationIndex()).sort();
    // Dynamic import: planner-ui pulls in logic.js, so a static edge here would cycle.
    import('./planner-ui.js').then((m) => m.renderPlannerHistory?.()).catch(() => {});
}

export function calculateTimeDiffString(departureTimeStr, dayOffset = 0) {
    try {
        if (!departureTimeStr || typeof departureTimeStr !== 'string') return "";
        const [nowH, nowM, nowS] = getCurrentTime().split(':').map(Number);
        const depParts = departureTimeStr.split(':').map(Number);
        if (depParts.length < 2) return ""; 
        const depH = depParts[0]; const depM = depParts[1]; const depS = depParts[2] || 0;
        let nowTotalSeconds = (nowH * 3600) + (nowM * 60) + nowS;
        let depTotalSeconds = (depH * 3600) + (depM * 60) + depS;
        let diffInSeconds = (depTotalSeconds - nowTotalSeconds) + (dayOffset * 86400);
        if (diffInSeconds < -30) return ""; 
        if (diffInSeconds < 60) return "(Departing now)";
        let diffInMinutes = Math.ceil(diffInSeconds / 60);
        const hours = Math.floor(diffInMinutes / 60);
        const minutes = diffInMinutes % 60;
        return (hours > 0) ? `(in ${hours} hr ${minutes} min)` : `(in ${minutes} min)`;
    } catch (e) { return ""; }
}

export function resolveZoneForRoute(routeId) {
    if (!getFullDatabase() || !routeId || !ROUTES[routeId]) return null;
    const route = ROUTES[routeId];
    const keysToCheck = Object.values(route.sheetKeys);
    for (const key of keysToCheck) {
        const zoneVal = getFullDatabase()[key + "_zone"];
        if (zoneVal && FARE_CONFIG.zones[zoneVal]) return zoneVal; 
    }
    for (const key of keysToCheck) {
        if (key.includes('_to_')) {
            const parts = key.split('_to_');
            if (parts.length === 2) {
                const prefix = parts[0]; 
                const rest = parts[1];
                let suffix = "";
                let dest = "";
                if (rest.endsWith('_weekday')) { suffix = '_weekday'; dest = rest.replace('_weekday', ''); }
                else if (rest.endsWith('_saturday')) { suffix = '_saturday'; dest = rest.replace('_saturday', ''); }
                else if (rest.endsWith('_sat')) { suffix = '_sat'; dest = rest.slice(0, -4); }
                if (dest && suffix) {
                    const reverseKey = `${dest}_to_${prefix}${suffix}_zone`;
                    const reverseZone = getFullDatabase()[reverseKey];
                    if (reverseZone && FARE_CONFIG.zones[reverseZone]) return reverseZone;
                }
            }
        }
    }
    return null;
}

// 🛡️ GUARDIAN PHASE 1: REFACTORED FARE ENGINE (Train-Time Dependency Purged)
export function getRouteFare(sheetKey) {
    // 🛡️ GUARDIAN BUGFIX: Race condition patch to prevent null access during initial load
    if (!getFullDatabase()) return null;
    
    let zoneCode = null;
    if (sheetKey) {
        const zoneKey = sheetKey + "_zone";
        zoneCode = getFullDatabase()[zoneKey];
    }
    if (!zoneCode && getCurrentRouteId()) {
        zoneCode = resolveZoneForRoute(getCurrentRouteId());
    }
    if (!zoneCode || !FARE_CONFIG.zones[zoneCode]) return null; 

    let basePrice = FARE_CONFIG.zones[zoneCode];
    let discountLabel = null;
    let isPromo = false; 
    let isOffPeak = false; 

    const profile = FARE_CONFIG.profiles[getUserProfile()] || FARE_CONFIG.profiles["Adult"];
    let useOffPeakRate = false;

    // Off-peak 09:30–14:30 on weekdays only (unless FARE_CONFIG.offPeakEveryDay).
    // Scholar 50% is profile.base — not gated on this window.
    // Calendar day wins: Sunday / Saturday must never inherit weekday off-peak
    // just because the fare table sheetKey contains "weekday".
    const applyOffPeakEveryDay = FARE_CONFIG.offPeakEveryDay === true;
    const dayAllowsOffPeak = applyOffPeakEveryDay || usesWeekdayScheduleSheet(getCurrentDayType());

    if (dayAllowsOffPeak) {
        let checkH, checkM;

        // GUARDIAN PHASE 2A: Decouple Off-Peak pricing from individual train departures.
        // Strict adherence to global physical/simulated clock.
        if ($isSimMode.get() && ($simTime.get() || "")) {
            const parts = ($simTime.get() || "").split(':');
            checkH = parseInt(parts[0], 10);
            checkM = parseInt(parts[1], 10);
        } else if (typeof getCurrentTime() !== 'undefined' && getCurrentTime() && getCurrentTime().includes(':')) {
            const parts = getCurrentTime().split(':');
            checkH = parseInt(parts[0], 10);
            checkM = parseInt(parts[1], 10);
        } else {
            const now = new Date();
            checkH = now.getHours();
            checkM = now.getMinutes();
        }

        const decimalTime = checkH + (checkM / 60);
        if (decimalTime >= FARE_CONFIG.offPeakStart && decimalTime < FARE_CONFIG.offPeakEnd) {
            useOffPeakRate = true;
        }
    }

    const multiplier = fareMultiplierForProfile(getUserProfile(), useOffPeakRate);
    let finalPrice = basePrice * multiplier;
    finalPrice = Math.ceil(finalPrice * 2) / 2;
    finalPrice = Math.floor(finalPrice);

    // GUARDIAN FIX: Mutually exclusive Promo vs OffPeak flags to prevent UI collisions
    if (getUserProfile() === "Adult") {
        isPromo = false; // Adults only get the time-based green Off-Peak badge
        if (useOffPeakRate) {
            discountLabel = "40% Off-Peak";
        }
    } else if (multiplier < 1.0) {
        isPromo = true; // Special profiles get the purple Promo badge
        if (getUserProfile() === "Pensioner") discountLabel = "50% Off-Peak";
        else if (getUserProfile() === "Military") discountLabel = "50% Off-Peak";
        else if (getUserProfile() === "Scholar") discountLabel = "50% Discount";
        else discountLabel = "Discounted"; 
    }

    return {
        price: String(finalPrice),
        isOffPeak: useOffPeakRate, 
        isPromo: isPromo,
        discountLabel: discountLabel 
    };
}

export function getDetailedFare(sheetKey) {
    if (!getFullDatabase()) return null;
    let zoneCode = null;
    if (sheetKey) {
        const zoneKey = sheetKey + "_zone";
        zoneCode = getFullDatabase()[zoneKey];
    }
    if (!zoneCode && getCurrentRouteId()) {
        zoneCode = resolveZoneForRoute(getCurrentRouteId());
    }
    if (!zoneCode) return null; 

    if (FARE_CONFIG.zones_detailed && FARE_CONFIG.zones_detailed[zoneCode]) {
        return { code: zoneCode, prices: FARE_CONFIG.zones_detailed[zoneCode] };
    }
    return null;
}

/** Ticket table for a corridor id (planner train sheet, not the live-board pin). */
export function getDetailedFareForRoute(routeId) {
    if (!getFullDatabase() || !routeId) return null;
    const zoneCode = resolveZoneForRoute(routeId);
    if (!zoneCode || !FARE_CONFIG.zones_detailed?.[zoneCode]) return null;
    return { code: zoneCode, prices: FARE_CONFIG.zones_detailed[zoneCode] };
}

/** What one direction card is allowed to show for this station and sheet state. */
export function boardDirectionState(selectedStation, destination, sheetsReady) {
    if (!String(selectedStation || '').trim()) return 'placeholder';
    if (normalizeStationName(selectedStation) === normalizeStationName(destination)) return 'here';
    if (!sheetsReady) return 'await';
    return 'ready';
}

/** True once this route's day sheets have been sliced. An empty wipe is not a timetable. */
export function sheetsReadyForBoard(schedules = getSchedules(), routeId = getCurrentRouteId(), dayType = getCurrentDayType()) {
    const route = routeId ? ROUTES[routeId] : null;
    if (!route || !routeId) return false;
    if (!schedulesBelongToRoute(schedules, routeId)) return false;
    if (dayType === 'sunday') return true;
    const region = route.region || getCurrentRegion();
    const slotA = schedules?.[scheduleCacheSlot(dayType, region, 'a')];
    const slotB = schedules?.[scheduleCacheSlot(dayType, region, 'b')];
    const parsed = (sheet) => !!(sheet && Array.isArray(sheet.rows));
    return parsed(slotA) || parsed(slotB);
}

let boardCtx = { routeId: '', station: '' };

export function clearBoardJourneyLists() {
    for (const key of Object.keys(currentScheduleData)) delete currentScheduleData[key];
}

/** Drop cached journeys when the route or station changes so a later paint cannot replay them. */
export function syncBoardContext(routeId, station) {
    const nextRoute = routeId || '';
    const nextStation = station || '';
    if (boardCtx.routeId === nextRoute && boardCtx.station === nextStation) return;
    clearBoardJourneyLists();
    boardCtx = { routeId: nextRoute, station: nextStation };
}

export function boardJourneysAreCurrent(routeId = getCurrentRouteId(), station = selectedBoardStation()) {
    return !!station && boardCtx.routeId === (routeId || '') && boardCtx.station === station;
}

export function boardContextKey() {
    return `${getCurrentRouteId() || ''}|${selectedBoardStation()}`;
}

/**
 * Hidden select is what the board computes. The visible field is what the commuter sees.
 * If they disagree, treat it as no station so a cleared field cannot keep the previous train.
 */
export function selectedBoardStation() {
    const select = stationSelectEl();
    const value = select?.value || '';
    if (value === 'FIND_NEAREST') return value;
    const input = typeof document !== 'undefined' ? document.getElementById('station-search-input') : null;
    const inputVisible = !!(input && !input.classList.contains('hidden'));
    if (!inputVisible) return value;
    const shown = String(input.value || '').trim();
    const expected = value.replace(/ STATION/gi, '').trim();
    if (value && shown && normalizeStationName(shown) === normalizeStationName(expected)) return value;
    if (select && value) select.value = '';
    if (shown) input.value = '';
    delete input.dataset.resolvedValue;
    return '';
}

function paintSelectStation() {
    const key = liveBoardStaticKey('placeholder');
    const a = pretoriaTimeEl();
    const b = pienaarspoortTimeEl();
    if (a?.getAttribute('data-nt-board-key') === key && b?.getAttribute('data-nt-board-key') === key
        && String(a.textContent || '').includes('Select station above')
        && String(b.textContent || '').includes('Select station above')) return;
    if (typeof window !== 'undefined' && window.Renderer) window.Renderer.renderPlaceholder(a, b);
}

function paintAwaitingCard(el) {
    if (!el || typeof window === 'undefined' || !window.Renderer?.renderSkeletonLoader) return;
    const key = liveBoardStaticKey('await');
    if (el.getAttribute('data-nt-board-key') === key) return;
    window.Renderer.renderSkeletonLoader(el);
    stampLiveBoardCard(el, key);
}

function paintHeldDirection(el, station, destination) {
    const state = boardDirectionState(station, destination, false);
    if (state === 'here') {
        if (typeof window !== 'undefined' && window.Renderer) window.Renderer.renderAtDestination(el);
        if (destination) delete currentScheduleData[destination];
        return;
    }
    paintAwaitingCard(el);
}

/** Route just changed and its sheets are not sliced yet. Do not call that "no trains". */
export function holdBoardForSheets() {
    const route = ROUTES[getCurrentRouteId()];
    const station = selectedBoardStation();
    syncBoardContext(getCurrentRouteId(), station === 'FIND_NEAREST' ? '' : station);
    clearBoardJourneyLists();
    if (!route) return;
    if (!station) {
        paintSelectStation();
        return;
    }
    paintHeldDirection(pretoriaTimeEl(), station, route.destA);
    paintHeldDirection(pienaarspoortTimeEl(), station, route.destB);
}

export function findNextTrains(opts) {
    const includeShared = !opts || opts.includeShared !== false;
    const keepCards = !!(opts && opts.keepCards);
    const quietPaint = typeof window !== 'undefined' && !!window.__ntQuietBoardPaint;
    if (!quietPaint && typeof paintHeaderDayLabel === 'function') paintHeaderDayLabel();
    if(!getCurrentRouteId()) return;

    const currentRoute = ROUTES[getCurrentRouteId()];
    
    const isAtStation = (s1, s2) => normalizeStationName(s1) === normalizeStationName(s2);

    if (!currentRoute) return;
    
    // GUARDIAN V6.1: The Hoist - Strict Inactive Route Nuke
    // If the route is inactive, we destroy the UI and halt immediately.
    // This stops the R9.50 state bleed and removes ghost buttons.
    if (!currentRoute.isActive) { 
        const targetEl = typeof pretoriaTimeEl() !== 'undefined' && pretoriaTimeEl() ? pretoriaTimeEl() : document.getElementById('pretoria-time');
        if(typeof window.Renderer !== 'undefined') window.Renderer.renderComingSoon(targetEl, currentRoute.name); 
        
        const fContainer = document.getElementById('fare-container');
        if (fContainer) fContainer.classList.add('hidden');
        
        const gContainer = document.getElementById('grid-trigger-container');
        if (gContainer) gContainer.classList.add('hidden');
        
        const footer = document.querySelector('#view-next-train .nt-board-footer');
        if (footer) footer.classList.add('hidden');
        
        return; // HALT EXECUTION
    } else {
        const footer = document.querySelector('#view-next-train .nt-board-footer');
        if (footer) footer.classList.remove('hidden');
    }

    const rawStation = (stationSelectEl() && stationSelectEl().value) || '';
    if (rawStation === "FIND_NEAREST") {
        trackAnalyticsEvent('click_auto_locate', { source: 'find_nearest', route_id: getCurrentRouteId() });
        findNearestStation(false);
        return;
    }
    const selectedStation = selectedBoardStation();
    syncBoardContext(getCurrentRouteId(), selectedStation);
    
    const uiDestA = typeof window.Renderer !== 'undefined' ? window.Renderer._applyUIIntercepts(currentRoute.destA).toUpperCase() : currentRoute.destA.replace(' STATION', '').toUpperCase();
    const uiDestB = typeof window.Renderer !== 'undefined' ? window.Renderer._applyUIIntercepts(currentRoute.destB).toUpperCase() : currentRoute.destB.replace(' STATION', '').toUpperCase();

    setHeaderDest(pretoriaHeaderEl(), uiDestA);
    setHeaderDest(pienaarspoortHeaderEl(), uiDestB);
    import('./ride-pings.js').then((m) => m.paintLiveDirectionHeaders?.()).catch(() => {});
    
    if (!selectedStation) {
        clearBoardJourneyLists();
        paintSelectStation();
        const fallbackSheetKey = routeSheetKeyForDay(currentRoute, getCurrentDayType(), 'a');
        if (typeof window.updateFareDisplay === 'function') window.updateFareDisplay(fallbackSheetKey);
        return;
    }
    
    if (!(stationSelectEl() && stationSelectEl().options)[stationSelectEl().selectedIndex]) return;

    if ((stationSelectEl() && stationSelectEl().options)[stationSelectEl().selectedIndex].textContent.includes("(No Service)")) {
        const msg = `<div class="h-32 flex flex-col justify-center items-center text-xl font-bold text-gray-600 dark:text-gray-400">No trains stop here.</div>`;
        if (pretoriaTimeEl()) pretoriaTimeEl().innerHTML = msg; if (pienaarspoortTimeEl()) pienaarspoortTimeEl().innerHTML = msg; return;
    }

    const currentODKey = `${getCurrentRouteId()}_${selectedStation}`;
    if (lastTrackedOD !== currentODKey && typeof trackAnalyticsEvent === 'function') {
        lastTrackedOD = currentODKey;
        trackAnalyticsEvent('od_matrix_view', {
            origin: selectedStation.replace(' STATION', ''),
            dest_a: currentRoute.destA.replace(' STATION', ''),
            dest_b: currentRoute.destB.replace(' STATION', ''),
            route_id: getCurrentRouteId(),
            time_of_search: getCurrentTime(),
            day_type: getCurrentDayType(),
            trip_type: 'live_board_view',
            region: getCurrentRegion()
        });
    }
    
    if (getCurrentDayType() === 'sunday') {
        if(typeof window.renderNoService === 'function') {
            if (isAtStation(selectedStation, currentRoute.destA)) {
                if(typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pretoriaTimeEl());
            } else {
                window.renderNoService(pretoriaTimeEl(), currentRoute.destA); 
            }
            if (isAtStation(selectedStation, currentRoute.destB)) {
                if(typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pienaarspoortTimeEl());
            } else {
                window.renderNoService(pienaarspoortTimeEl(), currentRoute.destB); 
            }
        }
        return;
    }

    // Sheets wiped on a corridor change are not an empty timetable.
    if (!sheetsReadyForBoard()) {
        clearBoardJourneyLists();
        paintHeldDirection(pretoriaTimeEl(), selectedStation, currentRoute.destA);
        paintHeldDirection(pienaarspoortTimeEl(), selectedStation, currentRoute.destB);
        return;
    }

    if (!quietPaint && !keepCards) {
        [pretoriaTimeEl(), pienaarspoortTimeEl()].forEach((el) => {
            if (!el) return;
            el.innerHTML = "";
            el.removeAttribute?.('data-nt-board-key');
        });
    }

    // Routes with empty Saturday sheets (e.g. Hercules–Koedoespoort, Eastern Cape).
    // WC public_holiday uses pub sheets (already saturday-fallbacked when missing).
    const boardRegion = currentRoute.region || getCurrentRegion();
    const boardDayType = getCurrentDayType();
    if (usesSaturdayScheduleSheet(boardDayType, boardRegion) && !routeHasSaturdayService()) {
        if (typeof window.renderNoWeekendService === 'function') {
            if (isAtStation(selectedStation, currentRoute.destA)) {
                if (typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pretoriaTimeEl());
            } else {
                window.renderNoWeekendService(pretoriaTimeEl(), currentRoute.destA);
            }
            if (isAtStation(selectedStation, currentRoute.destB)) {
                if (typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pienaarspoortTimeEl());
            } else {
                window.renderNoWeekendService(pienaarspoortTimeEl(), currentRoute.destB);
            }
        }
        return;
    }
    if (usesPublicHolidayScheduleSheet(boardDayType, boardRegion)) {
        const pubA = getSchedules()?.pub_to_a;
        const pubB = getSchedules()?.pub_to_b;
        if (!scheduleHasService(pubA) && !scheduleHasService(pubB) && !routeHasSaturdayService()) {
            if (typeof window.renderNoWeekendService === 'function') {
                if (isAtStation(selectedStation, currentRoute.destA)) {
                    if (typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pretoriaTimeEl());
                } else {
                    window.renderNoWeekendService(pretoriaTimeEl(), currentRoute.destA);
                }
                if (isAtStation(selectedStation, currentRoute.destB)) {
                    if (typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pienaarspoortTimeEl());
                } else {
                    window.renderNoWeekendService(pienaarspoortTimeEl(), currentRoute.destB);
                }
            }
            return;
        }
    }

    let sharedRoutes = [];
    Object.values(ROUTES).forEach(r => {
        if (r.region === getCurrentRegion() && r.id !== getCurrentRouteId() && r.isActive && r.corridorId === currentRoute.corridorId) {
            sharedRoutes.push(r.id);
        }
    });

    if (getFullDatabase() && getGlobalStationIndex()[normalizeStationName(selectedStation)]) {
        const stationData = getGlobalStationIndex()[normalizeStationName(selectedStation)];
        stationData.routes.forEach(rId => {
            if (rId !== getCurrentRouteId() && ROUTES[rId].isActive && !sharedRoutes.includes(rId)) {
                sharedRoutes.push(rId);
            }
        });
    }

    sharedRoutes = sharedRoutes.filter(rId => getSharedStationCount(getCurrentRouteId(), rId) > 1);
    const routesForMerge = includeShared ? sharedRoutes : [];
    let primarySheetKey = routeSheetKeyForDay(currentRoute, boardDayType, 'a');

    // --- DESTINATION A ---
    if (isAtStation(selectedStation, currentRoute.destA)) {
        delete currentScheduleData[currentRoute.destA];
        if(typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pretoriaTimeEl());
    } else {
        const schedule = getSchedules()[scheduleCacheSlot(boardDayType, boardRegion, 'a')];
        const currentSheetKey = routeSheetKeyForDay(currentRoute, boardDayType, 'a');
        const { allJourneys: currentJourneys } = findNextJourneyToDestA(selectedStation, "00:00:00", schedule, currentRoute, getCurrentDayIndex());
        
        let mergedJourneys = currentJourneys.map(j => ({...j, sourceRoute: currentRoute.name, sheetKey: currentSheetKey}));
        const seenTrainsA = new Set(mergedJourneys.map(j => j.train || j.train1.train));
        const targetStationsA = getTargetStations(schedule, selectedStation);

        routesForMerge.forEach(rId => {
            const otherRoute = ROUTES[rId];
            if (normalizeStationName(otherRoute.destA) === normalizeStationName(currentRoute.destA)) {
                const key = routeSheetKeyForDay(otherRoute, boardDayType, 'a');
                const otherRows = getFullDatabase()[key];
                const otherMeta = getFullDatabase()[key + "_meta"];
                const otherSchedule = parseJSONSchedule(otherRows, otherMeta);
                const { allJourneys: otherJourneys } = findNextJourneyToDestA(selectedStation, "00:00:00", otherSchedule, otherRoute, getCurrentDayIndex());
                
                const uniqueOther = otherJourneys.filter(j => {
                    const tNum = j.train || j.train1.train;
                    return hasForwardOverlap(tNum, otherSchedule, selectedStation, targetStationsA);
                });

                const tagged = uniqueOther.map(j => ({
                    ...j, 
                    sourceRoute: otherRoute.name, 
                    isShared: true, 
                    isDivergent: false,
                    sheetKey: key
                }));
                
                tagged.forEach(sharedJ => {
                    const tNum = sharedJ.train || sharedJ.train1.train;
                    // GUARDIAN BUGFIX: Safely replace native train with rich shared train without dynamic filter collision
                    mergedJourneys = mergedJourneys.filter(mj => (mj.train || mj.train1.train) !== tNum);
                    seenTrainsA.add(tNum);
                    mergedJourneys.push(sharedJ);
                });
            }
        });
        
        mergedJourneys.sort((a, b) => {
             const timeA = timeToSeconds(a.departureTime || a.train1.departureTime);
             const timeB = timeToSeconds(b.departureTime || b.train1.departureTime);
             return timeA - timeB;
        });

        // Drop text-note cells; look ahead to the next real clock departure
        mergedJourneys = mergedJourneys.filter(journeyHasRealDeparture);

        const nowInSeconds = timeToSeconds(getCurrentTime());
        const upcoming = mergedJourneys.find(j => timeToSeconds(j.departureTime || j.train1.departureTime) >= nowInSeconds);
        // GUARDIAN PHASE 1: Replaced Train-Time Dependency with Current Time hook
        if (upcoming) {
             if(typeof window.updateFareDisplay === 'function') window.updateFareDisplay(currentSheetKey, getCurrentTime());
        } else {
             if(typeof window.updateFareDisplay === 'function') window.updateFareDisplay(primarySheetKey, getCurrentTime());
        }

        if(typeof window.processAndRenderJourney === 'function') window.processAndRenderJourney(mergedJourneys, pretoriaTimeEl(), pretoriaHeaderEl(), currentRoute.destA);
    }

    // --- DESTINATION B ---
    if (isAtStation(selectedStation, currentRoute.destB)) {
        delete currentScheduleData[currentRoute.destB];
        if(typeof window.Renderer !== 'undefined') window.Renderer.renderAtDestination(pienaarspoortTimeEl());
    } else {
        const schedule = getSchedules()[scheduleCacheSlot(boardDayType, boardRegion, 'b')];
        const currentSheetKey = routeSheetKeyForDay(currentRoute, boardDayType, 'b');
        const { allJourneys: currentJourneys } = findNextJourneyToDestB(selectedStation, "00:00:00", schedule, currentRoute, getCurrentDayIndex());

        let mergedJourneys = currentJourneys.map(j => ({...j, sourceRoute: currentRoute.name, sheetKey: currentSheetKey}));
        const seenTrainsB = new Set(mergedJourneys.map(j => j.train || j.train1.train));
        const targetStationsB = getTargetStations(schedule, selectedStation);

        routesForMerge.forEach(rId => {
            const otherRoute = ROUTES[rId];
            
                 const key = routeSheetKeyForDay(otherRoute, boardDayType, 'b');
                 const otherRows = getFullDatabase()[key];
                 const otherMeta = getFullDatabase()[key + "_meta"];
                 const otherSchedule = parseJSONSchedule(otherRows, otherMeta);
                 const { allJourneys: otherJourneys } = findNextJourneyToDestB(selectedStation, "00:00:00", otherSchedule, otherRoute, getCurrentDayIndex());
                 
                 const uniqueOther = otherJourneys.filter(j => {
                     const tNum = j.train || j.train1.train;
                     return hasForwardOverlap(tNum, otherSchedule, selectedStation, targetStationsB);
                 });

                 const daySheets = [schedule, otherSchedule].filter((sheet) => sheet?.rows?.length);
                 const tagged = uniqueOther.map(j => {
                     const tNum = j.train || j.train1?.train;
                     const terminus = realTrainTerminus(tNum, daySheets);
                     const tag = sharedDestTag(currentRoute.destB, otherRoute.destB, terminus || otherRoute.destB);
                     const native = mergedJourneys.find((mj) => (mj.train || mj.train1?.train) === tNum);
                     const termNorm = normalizeStationName(terminus);
                     const nativeEnd = normalizeStationName(native?.actualDestination);
                     const otherEnd = normalizeStationName(j.actualDestination);
                     const keepNative = !!(native && termNorm && nativeEnd === termNorm && otherEnd !== termNorm);
                     const chosen = keepNative ? native : j;
                     const chosenEnd = normalizeStationName(chosen.actualDestination);
                     return {
                         ...chosen,
                         actualDestination: termNorm && chosenEnd !== termNorm ? terminus : chosen.actualDestination,
                         sourceRoute: otherRoute.name,
                         sheetKey: keepNative ? (chosen.sheetKey || currentSheetKey) : key,
                         ...tag,
                     };
                 });
                 
                 tagged.forEach(sharedJ => {
                     const tNum = sharedJ.train || sharedJ.train1.train;
                     // GUARDIAN BUGFIX: Safely replace native train with rich shared train without dynamic filter collision
                     mergedJourneys = mergedJourneys.filter(mj => (mj.train || mj.train1.train) !== tNum);
                     seenTrainsB.add(tNum);
                     mergedJourneys.push(sharedJ);
                 });
        });

        mergedJourneys.sort((a, b) => {
             const timeA = timeToSeconds(a.departureTime || a.train1.departureTime);
             const timeB = timeToSeconds(b.departureTime || b.train1.departureTime);
             return timeA - timeB;
        });

        mergedJourneys = mergedJourneys.filter(journeyHasRealDeparture);

        if(typeof window.processAndRenderJourney === 'function') window.processAndRenderJourney(mergedJourneys, pienaarspoortTimeEl(), pienaarspoortHeaderEl(), currentRoute.destB);
    }
    import('./ride-pings.js').then((m) => m.paintLiveDirectionHeaders?.()).catch(() => {});
    return { pendingShared: !includeShared && sharedRoutes.length > 0 };
}

export function findNextJourneyToDestA(fromStation, timeNow, schedule, routeConfig, targetDayIdx = getCurrentDayIndex()) {
    const { allJourneys: allDirectJourneys } = findNextDirectTrain(fromStation, schedule, routeConfig.destA, targetDayIdx, routeConfig.id);
    let allTransferJourneys = [];
    
    const transferHub = routeConfig.transferStation || routeConfig.relayStation;
    if (transferHub) {
        const { allJourneys: allTransfers } = findTransfers(fromStation, schedule, transferHub, routeConfig.destA, targetDayIdx, routeConfig.id);
        allTransferJourneys = allTransfers;
    }
    
    const transferTrainNames = new Set(allTransferJourneys.map(j => j.train1.train));
    const uniqueDirects = allDirectJourneys.filter(j => !transferTrainNames.has(j.train));
    
    const allJourneys = [...uniqueDirects, ...allTransferJourneys];
    
    allJourneys.sort((a, b) => {
        const timeA = timeToSeconds(a.departureTime || a.train1.departureTime);
        const timeB = timeToSeconds(b.departureTime || b.train1.departureTime);
        if (timeA !== timeB) return timeA - timeB; 
        if (a.type === 'transfer' && b.type === 'direct') return -1;
        if (a.type === 'direct' && b.type === 'transfer') return 1;
        return 0;
    });
    return { allJourneys };
}

export function findNextJourneyToDestB(fromStation, timeNow, schedule, routeConfig, targetDayIdx = getCurrentDayIndex()) {
    const { allJourneys: allDirectJourneys } = findNextDirectTrain(fromStation, schedule, routeConfig.destB, targetDayIdx, routeConfig.id);
    let allTransferJourneys = [];
    
    const transferHub = routeConfig.transferStation || routeConfig.relayStation;
    if (transferHub) {
        const { allJourneys: allTransfers } = findTransfers(fromStation, schedule, transferHub, routeConfig.destB, targetDayIdx, routeConfig.id);
        allTransferJourneys = allTransfers;
    }

    const transferTrainNames = new Set(allTransferJourneys.map(j => j.train1.train));
    const uniqueDirects = allDirectJourneys.filter(j => !transferTrainNames.has(j.train));
    
    const allJourneys = [...uniqueDirects, ...allTransferJourneys];
    
    allJourneys.sort((a, b) => {
        const timeA = timeToSeconds(a.departureTime || a.train1.departureTime);
        const timeB = timeToSeconds(b.departureTime || b.train1.departureTime);
        if (timeA !== timeB) return timeA - timeB; 
        if (a.type === 'transfer' && b.type === 'direct') return -1;
        if (a.type === 'direct' && b.type === 'transfer') return 1;
        return 0; 
    });
    return { allJourneys };
}

export function findNextDirectTrain(fromStation, schedule, destinationStation, targetDayIdx = getCurrentDayIndex(), routeId = getCurrentRouteId()) {
    if (!schedule || !schedule.rows || schedule.rows.length === 0) return { allJourneys: [] };
    const stationCol = schedule.stationColumnName;
    const trainHeaders = schedule.headers.slice(1);
    let allJourneys = [];

    const cleanTargetStation = normalizeStationName(fromStation);

    for (const train of trainHeaders) {
        if (!train || train === "") continue;
        const exclusionType = isTrainExcluded(train, routeId, targetDayIdx);

        const fromRow = schedule.rows.find(row => {
            const val = row[stationCol];
            return val && normalizeStationName(val) === cleanTargetStation;
        });

        const departureTime = fromRow ? fromRow[train] : null;

        // Skip dashes and non-clock cells (e.g. "Monte" terminus notes)
        if (!isRealTime(departureTime)) continue;

        let actualLastStop = null;
        let actualArrivalTime = null;
        let destRow = null; 
        
        for (let i = schedule.rows.length - 1; i >= 0; i--) {
            const time = schedule.rows[i][train];
            if (isRealTime(time)) {
                actualLastStop = schedule.rows[i][stationCol];
                actualArrivalTime = time;
                destRow = schedule.rows[i]; 
                break; 
            }
        }
        
        if (fromRow && destRow) {
            const fromIndex = schedule.rows.indexOf(fromRow);
            const destIndex = schedule.rows.indexOf(destRow);
            if (fromIndex < destIndex) { 
                allJourneys.push({
                    type: 'direct',
                    train: train,
                    departureTime: departureTime,
                    arrivalTime: actualArrivalTime,
                    actualDestination: actualLastStop,
                    ...(exclusionType ? { exclusionType, isExcluded: true } : {}),
                });
            }
        }
    }
    allJourneys.sort((a, b) => timeToSeconds(a.departureTime) - timeToSeconds(b.departureTime));
    return { allJourneys };
}

export function findTransfers(fromStation, schedule, terminalStation, finalDestination, targetDayIdx = getCurrentDayIndex(), routeId = getCurrentRouteId()) {
    if (!schedule || !schedule.rows || schedule.rows.length === 0) return { allJourneys: [] };
    const stationCol = schedule.stationColumnName;
    const trainHeaders = schedule.headers.slice(1);
    let allJourneys = [];
    const findRowFuzzy = (name) => schedule.rows.find(row => normalizeStationName(row[stationCol]) === normalizeStationName(name));
    
    const fromRow = findRowFuzzy(fromStation);
    const termRow = findRowFuzzy(terminalStation); 
    if (!fromRow || !termRow) return { allJourneys: [] };
    
    const fromIndex = schedule.rows.indexOf(fromRow); 
    const termIndex = schedule.rows.indexOf(termRow);
    if (fromIndex >= termIndex) return { allJourneys: [] }; 

    for (const train1 of trainHeaders) {
        if (!train1 || train1 === "") continue;
        const train1Exclusion = isTrainExcluded(train1, routeId, targetDayIdx);
        if (train1Exclusion && train1Exclusion !== 'special') continue;

        const departureTime = fromRow[train1]; 
        const terminationTime = termRow[train1];
        if (!isRealTime(departureTime) || !isRealTime(terminationTime)) continue;
        
        const finalDestRow = findRowFuzzy(finalDestination);
        const destinationTime = finalDestRow ? finalDestRow[train1] : null;

        if (!isRealTime(destinationTime)) {
            const connectionData = findConnections(terminationTime, schedule, terminalStation, finalDestination, train1, targetDayIdx, routeId);
            if (connectionData && connectionData.earliest) {
                let realHeadboardDest = terminalStation;
                for (let k = termIndex + 1; k < schedule.rows.length; k++) {
                    const nextRow = schedule.rows[k];
                    if (isRealTime(nextRow[train1])) {
                        realHeadboardDest = nextRow[stationCol];
                    }
                }

                allJourneys.push({ 
                    type: 'transfer', 
                    train1: { 
                        train: train1, 
                        departureTime: departureTime, 
                        arrivalAtTransfer: terminationTime, 
                        terminationStation: terminalStation,
                        headboardDestination: realHeadboardDest
                    }, 
                    connection: connectionData.earliest, 
                    nextFullJourney: connectionData.fullJourney 
                });
            }
        }
    }
    return { allJourneys };
}

export function findConnections(arrivalTimeAtTransfer, schedule, connectionStation, finalDestination, incomingTrainName, targetDayIdx = getCurrentDayIndex(), routeId = getCurrentRouteId()) {
    if (!schedule || !schedule.rows) return null;
    const stationCol = schedule.stationColumnName;
    const trainHeaders = schedule.headers.slice(1);
    let possibleConnections = [];
    
    const findRowFuzzy = (name) => schedule.rows.find(row => normalizeStationName(row[stationCol]) === normalizeStationName(name));
    const connRow = findRowFuzzy(connectionStation);
    if (!connRow) return null;
    const connIndex = schedule.rows.indexOf(connRow);
    const arrivalSeconds = timeToSeconds(arrivalTimeAtTransfer);

    for (const train of trainHeaders) {
        if (!train || train === "") continue;
        if (train === incomingTrainName) continue; 
        const connExclusion = isTrainExcluded(train, routeId, targetDayIdx);
        if (connExclusion && connExclusion !== 'special') continue;

        const connectionTime = connRow[train];
        if (!isRealTime(connectionTime)) continue;
        if (timeToSeconds(connectionTime) < arrivalSeconds) continue;

        let goesFurther = false;
        let actualLastStop = connectionStation;
        let actualArrivalTime = connectionTime;
        
        for (let i = connIndex + 1; i < schedule.rows.length; i++) {
            const time = schedule.rows[i][train];
            if (isRealTime(time)) { 
                goesFurther = true;
                actualLastStop = schedule.rows[i][stationCol]; 
                actualArrivalTime = time; 
            }
        }

        if (goesFurther) {
            possibleConnections.push({ 
                train: train, 
                departureTime: connectionTime, 
                arrivalTime: actualArrivalTime, 
                actualDestination: actualLastStop, 
                connectionStation: connectionStation 
            });
        }
    }
    
    if (possibleConnections.length === 0) return null; 
    possibleConnections.sort((a, b) => timeToSeconds(a.departureTime) - timeToSeconds(b.departureTime));
    const earliestConnection = possibleConnections[0];
    let earliestFullJourneyConnection = null;
    if (
        routeAllowsDualHubOptions(routeId)
        && normalizeStationName(earliestConnection.actualDestination) !== normalizeStationName(finalDestination)
    ) {
        earliestFullJourneyConnection = possibleConnections.find(conn => normalizeStationName(conn.actualDestination) === normalizeStationName(finalDestination)) || null; 
    }
    return { earliest: earliestConnection, fullJourney: earliestFullJourneyConnection };
}

export function findNearestStation(isAuto = false) {
    const stopLocateSpin = () => {
        if (isAuto) return;
        const icon = locateBtnEl()?.querySelector('svg');
        if (icon) icon.classList.remove('spinning', 'animate-spin');
    };

    const applyFromCoords = (userLat, userLon) => {
        let candidates = [];
        const routeId = getCurrentRouteId();
        const weekdaySheets = weekdaySheetsForRoute(
            ROUTES[routeId],
            getSchedules(),
            getFullDatabase(),
        );
        for (const [stationName, coords] of Object.entries(getGlobalStationIndex())) {
            const onRoute = coords?.routes instanceof Set
                ? coords.routes.has(routeId)
                : Array.isArray(coords?.routes) && coords.routes.includes(routeId);
            if (!onRoute) continue;
            const ll = resolveStationLatLon(stationName, coords, weekdaySheets);
            if (!ll) continue;
            const dist = getDistanceFromLatLonInKm(userLat, userLon, ll.lat, ll.lon);
            if (!Number.isFinite(dist)) continue;
            candidates.push({ stationName, dist });
        }

        candidates.sort((a, b) => a.dist - b.dist);

        if (candidates.length === 0) {
            if (isAuto) noteAutoLocateFailed();
            else {
                showToast("No stations on this route found in database.", "error");
                stopLocateSpin();
            }
            return;
        }

        const nearest = candidates[0];

        if (isAuto && !shouldApplySilentLocate()) return;
        rememberGeolocationGranted();

        if (nearest.dist <= MAX_RADIUS_KM) {
            const stationName = nearest.stationName;
            const distStr = nearest.dist.toFixed(1);

            let matched = false;
            const options = (stationSelectEl() && stationSelectEl().options) || [];

            for (let i = 0; i < options.length; i++) {
                if (normalizeStationName(options[i].value) === normalizeStationName(stationName)) {
                    if (stationSelectEl()) {
                        stationSelectEl().selectedIndex = i;
                        stationSelectEl().value = options[i].value;
                    }
                    matched = true;
                    break;
                }
            }

            if (matched) {
                const selectedVal = stationSelectEl()?.value || '';
                if (typeof window.syncPlannerFromMain === 'function') {
                    window.syncPlannerFromMain(selectedVal);
                }

                const searchInput = document.getElementById('station-search-input');
                if (searchInput) {
                    searchInput.value = selectedVal.replace(/ STATION/g, '');
                    searchInput.dataset.resolvedValue = selectedVal;
                }

                findNextTrains();
                disarmStartupLocateOverwrite();
                noteAutoLocateApplied();
                // force: Locating toast (1.2s global gap) must not swallow Found on the board.
                showToast(`Found: ${stationName.replace(' STATION', '')} (${distStr}km)`, "success", 2500, '', { force: true });

                try {
                    window.dispatchEvent(new CustomEvent('nt-locate-fix', {
                        detail: {
                            lat: userLat,
                            lon: userLon,
                            station: stationName,
                            isAuto: !!isAuto,
                        },
                    }));
                } catch { /* ignore */ }

                if (typeof trackAnalyticsEvent === 'function') {
                    trackAnalyticsEvent('auto_locate_success', {
                        station: stationName.replace(' STATION', ''),
                        route_id: getCurrentRouteId(),
                        distance_km: parseFloat(distStr),
                        is_background_check: isAuto
                    });
                }
            } else if (isAuto) {
                noteAutoLocateFailed();
            } else {
                showToast("Station found nearby, but not available in dropdown.", "error");
            }
        } else if (isAuto) {
            noteAutoLocateFailed();
        } else {
            showToast(`No stations on this route within ${MAX_RADIUS_KM}km.`, "error");
        }

        stopLocateSpin();
    };

    if (!navigator.geolocation) {
        if (!isAuto) showToast("Geolocation is not supported by your browser.", "error");
        if (!isAuto) if (stationSelectEl()) stationSelectEl().value = "";
        if (isAuto) noteAutoLocateFailed();
        return;
    }

    if (!isAuto) {
        showToast("Locating nearest station...", "info", 4000);
        const icon = locateBtnEl()?.querySelector('svg');
        if (icon) icon.classList.add('spinning', 'animate-spin');
    }

    if (isAuto) {
        try {
            const kept = reusableGeoFix(peekLastGeoFix(), Date.now(), 60_000);
            if (kept && Number.isFinite(kept.lat) && Number.isFinite(kept.lng)) {
                applyFromCoords(kept.lat, kept.lng);
                return;
            }
        } catch { /* still ask the OS */ }
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            applyFromCoords(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
            if (isAuto) {
                noteAutoLocateFailed();
                return;
            }
            let msg = "Unable to retrieve location.";
            if (error.code === 1) msg = "Location permission denied.";
            if (error.code === 3) msg = "Location request timed out.";
            showToast(msg, "error");
            if (stationSelectEl()) stationSelectEl().value = "";
            stopLocateSpin();
        },
        { timeout: isAuto ? 15000 : 8000, enableHighAccuracy: !isAuto, maximumAge: isAuto ? 60000 : 0 }
    );
}

export function populateStationList() {
    const stationSet = new Set();
    const hasTimes = (row) => { const keys = Object.keys(row); return keys.some(key => key !== 'STATION' && key !== 'COORDINATES' && key !== 'KM_MARK' && row[key] && row[key].trim() !== ""); };
    
    if (getSchedules().weekday_to_a && getSchedules().weekday_to_a.rows) getSchedules().weekday_to_a.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (getSchedules().weekday_to_b && getSchedules().weekday_to_b.rows) getSchedules().weekday_to_b.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (getSchedules().saturday_to_a && getSchedules().saturday_to_a.rows) getSchedules().saturday_to_a.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });
    if (getSchedules().saturday_to_b && getSchedules().saturday_to_b.rows) getSchedules().saturday_to_b.rows.forEach(row => { if (hasTimes(row)) stationSet.add(row.STATION); });

    allStations = Array.from(stationSet);
    // Renderer reads window.allStations to slice the stops between origin and
    // destination for disruption banners. This is a fresh array every call, so
    // the global has to be re-pointed here or it keeps the boot-time empty one.
    if (typeof window !== 'undefined') window.allStations = allStations;
    
    // GUARDIAN UX FIX: Sort by outbound (weekday_to_b) so Hubs (Dest A) appear naturally at the top
    if (getSchedules().weekday_to_b && getSchedules().weekday_to_b.rows) { 
        const orderMap = getSchedules().weekday_to_b.rows.map(r => r.STATION); 
        allStations.sort((a, b) => orderMap.indexOf(a) - orderMap.indexOf(b)); 
    } else if (getSchedules().weekday_to_a && getSchedules().weekday_to_a.rows) {
        // Safe fallback: If B is missing, sort by A but in reverse to maintain the Hub-Top flow
        const orderMap = getSchedules().weekday_to_a.rows.map(r => r.STATION); 
        allStations.sort((a, b) => orderMap.indexOf(b) - orderMap.indexOf(a));
    }
    
    const currentSelectedStation = (stationSelectEl() && stationSelectEl().value);
    
    if (stationSelectEl()) stationSelectEl().innerHTML = '<option value="">Select a station...</option>';
    if (stationSelectEl()) stationSelectEl().disabled = false; // GUARDIAN V6.1: Ensure enabled on populate
    
    allStations.forEach(station => {
        if (station && !station.toLowerCase().includes('last updated')) {
            const option = document.createElement('option');
            option.value = station;
            option.textContent = station.replace(/ STATION/g, '');
            stationSelectEl() && stationSelectEl().appendChild(option);
        }
    });

    // GUARDIAN V6.21: Unified Dataset Sync logic absorbed from UI
    const searchInput = document.getElementById('station-search-input');
    if (allStations.includes(currentSelectedStation)) {
        if (stationSelectEl()) stationSelectEl().value = currentSelectedStation; 
        if (searchInput) {
            searchInput.value = currentSelectedStation.replace(/ STATION/g, '');
            searchInput.dataset.resolvedValue = currentSelectedStation;
        }
    } else { 
        if (stationSelectEl()) stationSelectEl().value = ""; 
        if (searchInput) {
            searchInput.value = "";
            delete searchInput.dataset.resolvedValue;
        }
    }
    
    // 🛡️ GUARDIAN UX FIX: Reactive Dropdown Engine
    // If the user already opened the dropdown while it was "Loading...", refresh it instantly now that data is here.
    const autocompleteList = document.getElementById('next-train-autocomplete-list');
    if (autocompleteList && !autocompleteList.classList.contains('hidden')) {
        if (typeof window._renderNextTrainList === 'function') {
            window._renderNextTrainList();
        }
    }
}

export function updateLastUpdatedText() {
    if (!getFullDatabase()) return;
    let displayDate = getFullDatabase().lastUpdated || "Unknown";
    const isValidDate = (d) => d && d !== "undefined" && d !== "null" && String(d).length > 5;
    
    const region = getCurrentRegion();
    const dayType = getCurrentDayType();
    const slot = scheduleCacheSlot(dayType, region, 'a');
    const activeSched = getSchedules()?.[slot];
    if (activeSched && isValidDate(activeSched.lastUpdated)) {
        displayDate = activeSched.lastUpdated;
    } else if (dayType === 'sunday' || usesWeekdayScheduleSheet(dayType, region)) {
        if (getSchedules().weekday_to_a && isValidDate(getSchedules().weekday_to_a.lastUpdated)) displayDate = getSchedules().weekday_to_a.lastUpdated;
    }
    
    displayDate = formatEffectiveDate(displayDate);
    
    if (displayDate && lastUpdatedEl()) lastUpdatedEl().textContent = `Effective from: ${displayDate}`;
}

export function startSmartRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    scheduleNextRefresh();
}

export function scheduleNextRefresh() {
    if (document.hidden) return; 
    const hour = new Date().getHours();
    if (hour >= REFRESH_CONFIG.nightModeStart || hour < REFRESH_CONFIG.nightModeEnd) {
        refreshTimer = setTimeout(scheduleNextRefresh, 60 * 60 * 1000);
        return;
    }
    let nextInterval = REFRESH_CONFIG.standardInterval;
    refreshTimer = setTimeout(async () => { await loadAllSchedules(); scheduleNextRefresh(); }, nextInterval);
}


// Sync window shims used by renderer / planner
export function attachLiveBoardGlobals() {
    if (typeof window === 'undefined') return;
    window.getLookaheadDayInfo = getLookaheadDayInfo;
    window.simulateNextActiveService = simulateNextActiveService;
    window.checkDisruption = checkDisruption;
    window.getTripDisruptions = getTripDisruptions;
    window.disruptionAppliesToDayAndTime = disruptionAppliesToDayAndTime;
    window.disruptionShowsCancelledOnMap = disruptionShowsCancelledOnMap;
    window.routeGeometryStations = routeGeometryStations;
    window.isTrainExcluded = isTrainExcluded;
    window.getTrainExclusionRule = getTrainExclusionRule;
    window.openTrainExclusionSheet = openTrainExclusionSheet;
    window.openTrainMarkSheet = openTrainMarkSheet;
    if (!window.__ntExclGridBound) {
        window.__ntExclGridBound = true;
        const openFromGrid = (el) => {
            if (!el || typeof window.openTrainExclusionSheet !== 'function') return;
            window.openTrainExclusionSheet(el.getAttribute('data-excl-route'), el.getAttribute('data-excl-train'), Number(el.getAttribute('data-excl-day')));
        };
        document.addEventListener('click', (e) => {
            const hit = e.target?.closest?.('[data-excl-open="1"]');
            if (!hit || !hit.closest('#grid-container')) return;
            e.preventDefault();
            openFromGrid(hit);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const hit = e.target?.closest?.('[data-excl-open="1"]');
            if (!hit || !hit.closest('#grid-container')) return;
            e.preventDefault();
            openFromGrid(hit);
        });
    }
    if (!window.__ntDisrGridBound) {
        window.__ntDisrGridBound = true;
        const openDisrFromGrid = (el) => {
            const id = el?.getAttribute?.('data-disr-id');
            if (!id || typeof window.openDisruptionModal !== 'function') return;
            window.openDisruptionModal(id);
        };
        document.addEventListener('click', (e) => {
            const hit = e.target?.closest?.('[data-disr-open="1"]');
            if (!hit || !hit.closest('#grid-container')) return;
            e.preventDefault();
            openDisrFromGrid(hit);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const hit = e.target?.closest?.('[data-disr-open="1"]');
            if (!hit || !hit.closest('#grid-container')) return;
            e.preventDefault();
            openDisrFromGrid(hit);
        });
    }
    window.findNextTrains = findNextTrains;
    window.currentScheduleData = currentScheduleData;
    window.populateStationList = populateStationList;
    window.findNearestStation = findNearestStation;
    window.calculateTimeDiffString = calculateTimeDiffString;
    window.getRouteFare = getRouteFare;
    window.getDetailedFare = getDetailedFare;
    window.getDetailedFareForRoute = getDetailedFareForRoute;
    window.startSmartRefresh = startSmartRefresh;
    window.updateLastUpdatedText = updateLastUpdatedText;
    window.allStations = allStations;
    import('./train-ghosts.js').then((m) => {
        window.stopsForTrain = m.stopsForTrain;
        window.expectedPosition = m.expectedPosition;
        window.scoreTrainForFix = m.scoreTrainForFix;
    }).catch(() => {});
    // Keep renderer disruption badges in sync with active route
    const syncRoute = () => {
        window._liveRouteId = getCurrentRouteId();
        window.currentRouteId = getCurrentRouteId();
        window.allStations = allStations;
    };
    syncRoute();
    $currentRouteId.subscribe(syncRoute);
}

export function getAllStations() { return allStations; }
export { allStations };
