/**
 * METRORAIL NEXT TRAIN - PLANNER UI (V7_06.17 - Astro MPA Migration)
 * --------------------------------------------------------------
 * THE "HEAD CHEF" (Controller)
 * * This module handles user interaction, DOM updates, and event listeners.
 * It calls the pure logic functions from planner-core.js.
 * * PHASE 8: Astro ESM Migration & Iframe Sandbox Hardening (Removed fatal alert() calls).
 */

import { 
    $isSimMode, $userRegion, $currentRouteId, $globalStationIndex, 
    $globalDisruptions, $masterStationList, $ghostStationList, $userProfile, $fullDatabase, $simTime
} from '../store.js';
import { ROUTES, FARE_CONFIG, withBase, SPECIAL_DATES, HOLIDAY_NAMES } from './config.js';
import { resolveHolidayDayType } from './holiday-approvals.js';
import { smoothPathFromStops, nearestPathIndex } from './rail-tracks.js';
import { 
    normalizeStationName, timeToSeconds, formatTimeDisplay, 
    escapeHTML, getDistanceFromLatLonInKm, safeStorage, usesWeekdayScheduleSheet,
    resolveOperatingDayType
} from './utils.js';
import { planUnifiedTrip } from './planner-core.js';
import { buildPlannerShareUrl, parsePlannerDeepLink, stripShareParamsFromUrl } from './share-links.js';
import { consumeShareDeeplinkSnapshot, peekShareDeeplinkSnapshot } from './deeplink.js';
import { ensureRoutePinnedForRegion, loadAllSchedules } from './logic.js';
import { showToast, switchTab, triggerHaptic, openSmoothModal, closeSmoothModal, unlockBackgroundScroll } from './ui.js';
import { logRoutingFail, enqueueSuccessfulTripPlan } from './planner-telemetry.js';
import { enterFeedbackReplyMode, clearFeedbackReplyMode } from './hub.js';

/** Last planner results view — survive map modal / hash pops */
let lastPlannerSnapshot = null;

/** True when regional DB + station index are usable for routing. */
function plannerDatabaseReady() {
    const db = $fullDatabase.get();
    const idx = $globalStationIndex.get();
    return !!(db && idx && Object.keys(idx).length > 0);
}

/** SPA always planned against a hydrated regional DB. Wait / nudge load if cold. */
async function ensurePlannerDatabase(timeoutMs = 12000) {
    if (plannerDatabaseReady()) return true;
    ensureRoutePinnedForRegion($userRegion.get() || 'GP');
    try { await loadAllSchedules(true); } catch (e) { /* poll below */ }
    if (plannerDatabaseReady()) return true;
    const started = Date.now();
    return await new Promise((resolve) => {
        const id = setInterval(() => {
            if (plannerDatabaseReady()) {
                clearInterval(id);
                resolve(true);
            } else if (Date.now() - started >= timeoutMs) {
                clearInterval(id);
                resolve(false);
            }
        }, 200);
    });
}

/** Lucide-style icons for planner error cards / disruption chrome (replaces emoji). */
function plannerIcon(name, className = 'w-4 h-4') {
    const paths = {
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
        ban: '<circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/>',
        moon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
        alert: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
        xCircle: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
        stop: '<path d="M12 2l9 4.5v6.7c0 5.4-3.7 10.1-9 11.3-5.3-1.2-9-5.9-9-11.3V6.5L12 2z"/><path d="M9 12h6"/>',
        message: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
        circle: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
    };
    const body = paths[name];
    if (!body) return '';
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// --- Astro MPA Migration Shims ---
const getCurrentDayType = () => typeof window !== 'undefined' && window.currentDayType ? window.currentDayType : 'weekday';
const getCurrentTime = () => typeof window !== 'undefined' && window.currentTime ? window.currentTime : "12:00:00";
const resolveTripDisruptions = (routeId, stops) => {
    const fn = (typeof window !== 'undefined' && typeof window.getTripDisruptions === 'function')
        ? window.getTripDisruptions
        : null;
    return fn ? fn(routeId, stops) : [];
};
const bareStationName = (name) => String(name || '').replace(/ STATION/gi, '').trim();

/** Reject sheet header / "Last Updated" rows that leaked into station lists. */
const isSheetMetaStationName = (name) => {
    const bare = bareStationName(name).toUpperCase();
    if (!bare) return true;
    if (bare === 'STATION' || bare === 'COORDINATES' || bare === 'KM_MARK' || bare === 'KM MARK') return true;
    if (bare.startsWith('LAST U') || bare.startsWith('LAST UPDATED')) return true;
    if (bare.startsWith('UPDATED:') || bare === 'UPDATED') return true;
    return false;
};

const getMasterStationList = () => {
    let list = [];
    if (typeof window !== 'undefined' && window.MASTER_STATION_LIST && window.MASTER_STATION_LIST.length > 0) {
        list = window.MASTER_STATION_LIST;
    } else {
        list = $masterStationList.get() || [];
    }
    return (list || []).filter((s) => !isSheetMetaStationName(s));
};

const getGhostStationList = () => {
    let list = [];
    if (typeof window !== 'undefined' && Array.isArray(window.GHOST_STATION_LIST) && window.GHOST_STATION_LIST.length > 0) {
        list = window.GHOST_STATION_LIST;
    } else {
        list = $ghostStationList.get() || [];
    }
    return (list || []).filter((s) => !isSheetMetaStationName(s));
};

/** Small Levenshtein for short station names (Did you mean). */
function stationEditDistance(a, b) {
    const s = String(a || '');
    const t = String(b || '');
    const n = s.length;
    const m = t.length;
    if (!n) return m;
    if (!m) return n;
    const prev = new Array(m + 1);
    const cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
        cur[0] = i;
        for (let j = 1; j <= m; j++) {
            const cost = s.charCodeAt(i - 1) === t.charCodeAt(j - 1) ? 0 : 1;
            cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= m; j++) prev[j] = cur[j];
    }
    return prev[m];
}

/**
 * Fuzzy station suggestions when strict filter returns nothing.
 * Short queries: prefix/contains only. Edit-distance only for longer typos,
 * and only when the first letter matches (blocks QUEE → DUBE).
 * @param {string} query
 * @param {string[]} candidates
 * @param {number} [limit=3]
 */
function fuzzyStationSuggestions(query, candidates, limit = 3) {
    const q = bareStationName(query).toUpperCase();
    if (q.length < 3 || !Array.isArray(candidates) || !candidates.length) return [];
    // Pure edit-distance is too noisy under ~5 chars (QUEE↔DUBE).
    const allowEditDistance = q.length >= 5;
    const maxDist = q.length >= 8 ? 2 : 1;
    const scored = [];
    for (const raw of candidates) {
        const bare = bareStationName(raw).toUpperCase();
        if (!bare) continue;
        let rank = 99;
        let dist = stationEditDistance(q, bare);
        if (bare.startsWith(q)) {
            rank = 0;
            dist = 0;
        } else if (bare.includes(q)) {
            rank = 1;
            dist = 0;
        } else if (allowEditDistance) {
            const first = bare.split(/\s+/)[0] || bare;
            // Same initial letter required — avoids unrelated short anagrams/near-misses
            if (first.charAt(0) === q.charAt(0)) {
                const d2 = stationEditDistance(q, first);
                if (d2 <= maxDist && d2 / Math.max(q.length, 1) <= 0.34) {
                    rank = 2 + d2;
                    dist = d2;
                }
            }
        }
        if (rank < 99) scored.push({ raw, rank, dist });
    }
    scored.sort((a, b) => a.rank - b.rank || a.dist - b.dist || a.raw.localeCompare(b.raw));
    const out = [];
    const seen = new Set();
    for (const row of scored) {
        if (seen.has(row.raw)) continue;
        seen.add(row.raw);
        out.push(row.raw);
        if (out.length >= limit) break;
    }
    return out;
}

function notifyGhostStation(stationName) {
    const label = bareStationName(stationName) || 'This station';
    if (typeof showToast === 'function') {
        showToast(
            `${label} is inactive — PRASA does not currently operate service at this station.`,
            'info',
            4500
        );
    }
}

/** Clock used for off-peak fare window (sim-aware). */
function plannerFareClockParts() {
    try {
        if ($isSimMode.get() && ($simTime.get() || '')) {
            const parts = String($simTime.get()).split(':');
            return { h: parseInt(parts[0], 10) || 0, m: parseInt(parts[1], 10) || 0 };
        }
    } catch { /* ignore */ }
    try {
        if (typeof window !== 'undefined' && window.currentTime && String(window.currentTime).includes(':')) {
            const parts = String(window.currentTime).split(':');
            return { h: parseInt(parts[0], 10) || 0, m: parseInt(parts[1], 10) || 0 };
        }
    } catch { /* ignore */ }
    const now = new Date();
    return { h: now.getHours(), m: now.getMinutes() };
}

/** Resolve assigned fare zone for a corridor (same rules as live board). */
function resolvePlannerRouteZone(routeId) {
    const db = $fullDatabase.get();
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

function computeZoneFare(zoneCode) {
    if (!zoneCode || !FARE_CONFIG.zones[zoneCode]) return null;
    const profile = FARE_CONFIG.profiles[$userProfile.get()] || FARE_CONFIG.profiles.Adult;
    let useOffPeak = false;
    const dayType = selectedPlannerDay || getCurrentDayType();
    const dayAllowsOffPeak = FARE_CONFIG.offPeakEveryDay === true || usesWeekdayScheduleSheet(dayType);
    if (dayAllowsOffPeak) {
        const { h, m } = plannerFareClockParts();
        const decimalTime = h + (m / 60);
        if (decimalTime >= FARE_CONFIG.offPeakStart && decimalTime < FARE_CONFIG.offPeakEnd) {
            useOffPeak = true;
        }
    }
    const multiplier = useOffPeak ? profile.offPeak : profile.base;
    let finalPrice = FARE_CONFIG.zones[zoneCode] * multiplier;
    finalPrice = Math.ceil(finalPrice * 2) / 2;
    return {
        zone: zoneCode,
        price: finalPrice,
        priceLabel: finalPrice.toFixed(2),
        isOffPeak: useOffPeak,
    };
}

function collectTripRoutes(trip) {
    const routes = [];
    const push = (r) => {
        if (r && r.id && !routes.some((x) => x.id === r.id)) routes.push(r);
    };
    if (Array.isArray(trip?.legs)) trip.legs.forEach((leg) => push(leg?.route));
    push(trip?.leg1?.route);
    push(trip?.leg2?.route);
    push(trip?.leg3?.route);
    push(trip?.route);
    return routes;
}

function collectTripStops(trip) {
    const stops = [];
    const pushStop = (s) => {
        const name = normalizeStationName(s?.station || s?.name || s);
        if (!name) return;
        if (stops.length && normalizeStationName(stops[stops.length - 1].station) === name) return;
        stops.push({
            station: name,
            lat: s?.lat ?? null,
            lon: s?.lon ?? null,
        });
    };
    if (Array.isArray(trip?.stops) && trip.stops.length) {
        trip.stops.forEach(pushStop);
    } else if (Array.isArray(trip?.legs) && trip.legs.length) {
        trip.legs.forEach((leg) => (leg.stops || []).forEach(pushStop));
    } else {
        [trip?.leg1, trip?.leg2, trip?.leg3].forEach((leg) => {
            if (!leg) return;
            (leg.stops || []).forEach(pushStop);
        });
    }
    if (!stops.length && trip?.from && trip?.to) {
        pushStop(trip.from);
        pushStop(trip.to);
    }
    return stops;
}

/** Est. along-route km from stop coords (crow-flies hops); null if too thin. */
function getTripDistanceKm(trip) {
    const index = $globalStationIndex.get() || {};
    const stops = collectTripStops(trip);
    if (stops.length < 2) return null;
    let km = 0;
    let hops = 0;
    for (let i = 1; i < stops.length; i++) {
        let a = stops[i - 1];
        let b = stops[i];
        if (a.lat == null || a.lon == null) {
            const idx = index[normalizeStationName(a.station)];
            if (idx) { a = { ...a, lat: idx.lat, lon: idx.lon }; }
        }
        if (b.lat == null || b.lon == null) {
            const idx = index[normalizeStationName(b.station)];
            if (idx) { b = { ...b, lat: idx.lat, lon: idx.lon }; }
        }
        if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
        km += getDistanceFromLatLonInKm(a.lat, a.lon, b.lat, b.lon);
        hops++;
    }
    if (!hops || !Number.isFinite(km) || km <= 0) return null;
    return Math.round(km * 10) / 10;
}

/** Zone fare for planner trip (sums unique corridor routes on multi-leg). */
function getTripFareSummary(trip) {
    const routes = collectTripRoutes(trip);
    if (!routes.length) return null;
    let total = 0;
    let zones = [];
    let anyOffPeak = false;
    let any = false;
    for (const route of routes) {
        const zone = resolvePlannerRouteZone(route.id);
        const fare = computeZoneFare(zone);
        if (!fare) continue;
        any = true;
        total += fare.price;
        zones.push(fare.zone);
        if (fare.isOffPeak) anyOffPeak = true;
    }
    if (!any) return null;
    total = Math.ceil(total * 2) / 2;
    return {
        priceLabel: total.toFixed(2),
        zones,
        isOffPeak: anyOffPeak,
        multiRoute: routes.length > 1,
    };
}

function formatPlannerMetaLine(trip) {
    const km = getTripDistanceKm(trip);
    const fare = getTripFareSummary(trip);
    const bits = [];
    if (km != null) bits.push(`~${km} km`);
    if (fare) {
        bits.push(`R${fare.priceLabel}${fare.isOffPeak ? ' off-peak' : ''}`);
    }
    return bits.length ? bits.join(' · ') : '';
}

/** Phase 5 — inject recent crowd delay reports under an active trip card */
async function injectPlannerCrowdDelay(trip) {
    const slot = document.getElementById('planner-crowd-delay-slot');
    if (!slot || !trip) return;
    try {
        const routeIds = [];
        if (trip.route?.id) routeIds.push(trip.route.id);
        if (Array.isArray(trip.legs)) {
            trip.legs.forEach((leg) => {
                if (leg?.route?.id) routeIds.push(leg.route.id);
            });
        }
        if (Array.isArray(trip.mergedLegs)) {
            trip.mergedLegs.forEach((leg) => {
                if (leg?.route?.id) routeIds.push(leg.route.id);
            });
        }
        const { getPlannerCrowdDelayHtml } = await import('./delay-reports.js');
        const html = await getPlannerCrowdDelayHtml(routeIds);
        if (document.getElementById('planner-crowd-delay-slot') === slot) {
            slot.innerHTML = html || '';
        }
    } catch (e) {
        /* non-fatal */
    }
}

// --- CLIENT STATE ---
export let plannerOrigin = null;
export let plannerDest = null;
export let currentTripOptions = []; 
export let currentPlannerStatus = 'NO_PATH';
export let currentPlannerErrorPayload = null; 
export let selectedPlannerDay = null;
/** ISO date (YYYY-MM-DD) when user picks a specific calendar day */
export let selectedPlannerDate = null;

function resolveDayTypeFromIso(isoDate) {
    if (!isoDate || typeof isoDate !== 'string') return null;
    const parts = isoDate.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const day = d.getDay();
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const region = (typeof $userRegion?.get === 'function' ? $userRegion.get() : null) || 'GP';
    const holidayType = resolveHolidayDayType(key, region, parts[0]) || (SPECIAL_DATES && SPECIAL_DATES[key]) || null;
    // Calendar Sunday wins; WC remaps holiday saturday → public_holiday.
    const dayType = resolveOperatingDayType(day, holidayType, region);
    return { dayType, dayIndex: day, label: isoDate };
}

/** MM-DD key for the planner's active calendar day (picked date, sim date, or today). */
function plannerActiveDateKey() {
    if (selectedPlannerDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedPlannerDate)) {
        return selectedPlannerDate.slice(5);
    }
    try {
        if ($isSimMode.get()) {
            const dateInput = typeof document !== 'undefined' ? document.getElementById('sim-date') : null;
            if (dateInput instanceof HTMLInputElement && dateInput.value && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) {
                return dateInput.value.slice(5);
            }
        }
    } catch { /* ignore */ }
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * When the active planner day is a mapped public holiday, return name + schedule override.
 * Only surfaces when planning "that" calendar day (picked date, or today/sim — not a generic Sat/Sun override).
 */
function getPlannerHolidayContext() {
    const hasPickedDate = !!(selectedPlannerDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedPlannerDate));
    const planningGenericDayType = !hasPickedDate
        && selectedPlannerDay
        && selectedPlannerDay !== getCurrentDayType();
    // User explicitly picked Mon–Fri / Sat / Sun for a different day-type — don't claim a holiday.
    if (planningGenericDayType) return null;

    const dateKey = plannerActiveDateKey();
    if (!dateKey) return null;
    const region = $userRegion.get() || 'GP';
    const year = selectedPlannerDate && /^\d{4}/.test(selectedPlannerDate)
        ? Number(selectedPlannerDate.slice(0, 4))
        : new Date().getFullYear();
    const scheduleType = resolveHolidayDayType(dateKey, region, year) || SPECIAL_DATES?.[dateKey];
    if (!scheduleType) return null;
    return {
        dateKey,
        name: HOLIDAY_NAMES?.[dateKey] || 'Public Holiday',
        scheduleType,
    };
}

/**
 * Shared planner results notice — one layout, tone-driven colour.
 * Tones: schedule | critical | warning | layover
 */
/**
 * Attach 2+ planner notices into one stacked card (no inter-card gap).
 * A single notice is returned unchanged with its own chrome.
 */
function stackPlannerNotices(...chunks) {
    const parts = chunks.filter((h) => h && String(h).trim());
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    return `<div class="planner-notice-stack mb-3 rounded-xl overflow-hidden shadow-sm border border-gray-200/90 dark:border-gray-700 divide-y divide-gray-200/80 dark:divide-gray-700 [&>.planner-notice]:!mb-0 [&>.planner-notice]:!rounded-none [&>.planner-notice]:!border-0 [&>.planner-notice]:!shadow-none">${parts.join('')}</div>`;
}

function buildPlannerNotice({
    tone = 'schedule',
    title = '',
    bodyHtml = '',
    footerHtml = '',
    icon = 'alert',
    interactive = null, // { onclickAttr, detailsLabel }
}) {
    // Wash + accent bar sit on the right with the icon (gradient originates top-right).
    const tones = {
        schedule: {
            border: 'border-blue-200/90 dark:border-blue-900/60',
            bar: 'bg-blue-500',
            wash: 'bg-gradient-to-bl from-blue-50 via-white to-white dark:from-blue-950/40 dark:via-gray-900 dark:to-gray-900',
            title: 'text-blue-800 dark:text-blue-300',
            iconWrap: 'bg-blue-100 dark:bg-blue-900/50 border-blue-200/80 dark:border-blue-800/60',
            icon: 'text-blue-600 dark:text-blue-300',
            details: 'text-blue-500/80 dark:text-blue-400/80 group-hover:text-blue-600 dark:group-hover:text-blue-300',
            ring: 'focus-visible:ring-blue-400',
        },
        critical: {
            border: 'border-red-200/90 dark:border-red-900/60',
            bar: 'bg-red-500',
            wash: 'bg-gradient-to-bl from-red-50 via-white to-white dark:from-red-950/50 dark:via-gray-900 dark:to-gray-900',
            title: 'text-red-700 dark:text-red-300',
            iconWrap: 'bg-red-100 dark:bg-red-900/50 border-red-200/80 dark:border-red-800/60',
            icon: 'text-red-600 dark:text-red-300',
            details: 'text-red-500/80 dark:text-red-400/80 group-hover:text-red-600 dark:group-hover:text-red-300',
            ring: 'focus-visible:ring-red-400',
        },
        warning: {
            border: 'border-amber-200/90 dark:border-amber-900/60',
            bar: 'bg-amber-500',
            wash: 'bg-gradient-to-bl from-amber-50 via-white to-white dark:from-amber-950/40 dark:via-gray-900 dark:to-gray-900',
            title: 'text-amber-800 dark:text-amber-300',
            iconWrap: 'bg-amber-100 dark:bg-amber-900/50 border-amber-200/80 dark:border-amber-800/60',
            icon: 'text-amber-600 dark:text-amber-300',
            details: 'text-amber-600/80 dark:text-amber-400/80 group-hover:text-amber-700 dark:group-hover:text-amber-300',
            ring: 'focus-visible:ring-amber-400',
        },
        layover: {
            border: 'border-orange-200/90 dark:border-orange-900/60',
            bar: 'bg-orange-500',
            wash: 'bg-gradient-to-bl from-orange-50 via-white to-white dark:from-orange-950/40 dark:via-gray-900 dark:to-gray-900',
            title: 'text-orange-800 dark:text-orange-300',
            iconWrap: 'bg-orange-100 dark:bg-orange-900/50 border-orange-200/80 dark:border-orange-800/60',
            icon: 'text-orange-600 dark:text-orange-300',
            details: 'text-orange-600/80 dark:text-orange-400/80',
            ring: 'focus-visible:ring-orange-400',
        },
    };
    const t = tones[tone] || tones.schedule;
    const iconKey = icon === 'calendar' ? 'calendar'
        : icon === 'moon' ? 'moon'
        : icon === 'ban' ? 'ban'
        : icon === 'stop' ? 'stop'
        : 'alert';
    const iconSvg = plannerIcon(iconKey, `w-5 h-5 ${t.icon}`);
    const chevronSvg = `<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>`;
    const detailsLabel = interactive?.detailsLabel || 'Details';
    const detailsHtml = interactive?.onclickAttr
        ? `<span class="inline-flex items-center gap-0.5 text-[10px] font-bold ${t.details} whitespace-nowrap">${escapeHTML(detailsLabel)} ${chevronSvg}</span>`
        : '';

    // Accent bar + icon on the right; Details sits under the SVG (not in the title row).
    // No enter-animation — planner pulse re-renders and was replaying fade-in (glitch).
    const bodyPad = interactive?.onclickAttr ? 'pr-[4.75rem]' : 'pr-14';
    const inner = `
        <div class="flex items-stretch">
            <div class="planner-notice-body relative flex-1 min-w-0 p-3.5 ${bodyPad} text-left">
                <div class="absolute top-3.5 right-3.5 flex flex-col items-end gap-1">
                    <div class="planner-notice-icon w-9 h-9 rounded-full ${t.iconWrap} border flex items-center justify-center shadow-sm pointer-events-none" aria-hidden="true">
                        ${iconSvg}
                    </div>
                    ${detailsHtml}
                </div>
                <h4 class="text-[11px] font-black ${t.title} uppercase tracking-[0.14em] leading-tight mb-1.5 pr-1">${escapeHTML(title)}</h4>
                <div class="text-xs text-gray-600 dark:text-gray-400 leading-snug space-y-1 text-left">${bodyHtml}</div>
                ${footerHtml ? `<div class="mt-3">${footerHtml}</div>` : ''}
            </div>
            <div class="planner-notice-bar w-1.5 ${t.bar} shrink-0" aria-hidden="true"></div>
        </div>
    `;

    const shellClass = `planner-notice group w-full text-left mb-3 rounded-xl overflow-hidden border ${t.border} ${t.wash} shadow-sm`;
    if (interactive?.onclickAttr) {
        return `
            <button ${interactive.onclickAttr} class="${shellClass} focus:outline-none ${t.ring}">
                ${inner}
            </button>
        `;
    }
    return `<div class="${shellClass}">${inner}</div>`;
}

/** Day-bridge line for rollover / sunday-mapped holiday plans. */
function showingTrainsForLine(trip) {
    const label = trip?.dayLabel || 'Tomorrow';
    return `Showing the next available option for <b>${escapeHTML(String(label))}</b>.`;
}

/** Compact day label for tight chrome (dropdown / Departure badge). Full name stays in notices. */
function compactPlannerDayLabel(label, trip = null) {
    if (!label) return label;
    const trimmed = String(label).trim();
    const shortDays = new Set([
        'Tomorrow', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    if (shortDays.has(trimmed)) return trimmed;
    if (trip?.isHoliday) return 'Holiday';
    if (/^Tomorrow\s*\(/i.test(trimmed)) return 'Holiday';
    const holidays = Object.values(HOLIDAY_NAMES || {});
    if (holidays.some((h) => trimmed === h || trimmed.includes(h))) return 'Holiday';
    // Any other long non-weekday label (observed holidays, etc.)
    if (trimmed.length > 9) return 'Holiday';
    return trimmed;
}

/**
 * Holiday schedule notice. Sunday-mapped holidays include the day being shown
 * when a trip is provided. Pass absorbSunday:true when a dedicated no-service
 * notice will carry the holiday copy (avoid double banners).
 */
function buildHolidayNoticeHtml(trip = null, { absorbSunday = false } = {}) {
    const holiday = getPlannerHolidayContext();
    if (!holiday) return '';
    if (absorbSunday && holiday.scheduleType === 'sunday') return '';

    let bodyHtml;
    if (holiday.scheduleType === 'sunday') {
        bodyHtml = `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Metrorail has <span class="text-blue-700 dark:text-blue-300">no service</span> on ${escapeHTML(holiday.name)}.</p>`;
        if (trip?.dayLabel || trip?.dayOffset) {
            bodyHtml += `<p>${showingTrainsForLine(trip)}</p>`;
        }
    } else if (holiday.scheduleType === 'saturday') {
        bodyHtml = `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Metrorail is running trains on the <span class="text-blue-700 dark:text-blue-300">Saturday schedule</span> for ${escapeHTML(holiday.name)}.</p>`;
    } else {
        bodyHtml = `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Metrorail is running the <span class="text-blue-700 dark:text-blue-300">weekday schedule</span> for ${escapeHTML(holiday.name)}.</p>`;
    }

    return buildPlannerNotice({
        tone: 'schedule',
        title: `Public Holiday · ${holiday.name}`,
        bodyHtml,
        icon: 'calendar',
    });
}

function buildLineSeveredNoticeHtml(payload, fallbackTo = '') {
    if (!payload) return '';
    const intended = payload.intendedDest || 'Destination';
    const partial = payload.partialDest || fallbackTo;
    const disrId = payload.disruptionId || '';
    const safeIntended = escapeHTML(String(intended).replace(/ STATION/gi, ''));
    const safePartial = escapeHTML(String(partial).replace(/ STATION/gi, ''));
    const onclickAttr = disrId
        ? `type="button" onclick="if(typeof window.openDisruptionModal === 'function') window.openDisruptionModal('${String(disrId).replace(/'/g, "\\'")}')"`
        : null;
    return buildPlannerNotice({
        tone: 'critical',
        title: 'Line Severed',
        bodyHtml: `
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Cannot reach <span class="text-red-700 dark:text-red-300">${safeIntended}</span>.</p>
            <p>Showing trains terminating at <span class="font-bold text-gray-800 dark:text-gray-200">${safePartial}</span>.</p>
        `,
        icon: 'alert',
        interactive: onclickAttr ? { onclickAttr, detailsLabel: 'Details' } : null,
    });
}

function plannerDayDisplayText(value, isoDate = selectedPlannerDate) {
    const region = (typeof $userRegion?.get === 'function' ? $userRegion.get() : null) || 'GP';
    const satLabel = region === 'WC' ? 'Saturday' : 'Saturday / Public Holiday';
    if (value === 'specific' || (isoDate && value !== 'weekday' && value !== 'saturday' && value !== 'sunday' && value !== 'public_holiday')) {
        return isoDate ? `Date · ${isoDate}` : 'Pick a date…';
    }
    if (isoDate && (value === 'weekday' || value === 'saturday' || value === 'sunday' || value === 'public_holiday')) {
        // Specific date was resolved into a day-type — still show the date
        if (selectedPlannerDate) return `Date · ${selectedPlannerDate}`;
    }
    if (value === 'weekday') return 'Weekday (Mon-Fri)';
    if (value === 'saturday') return satLabel;
    if (value === 'public_holiday') return 'Public Holiday';
    if (value === 'sunday') return 'Sunday';
    return 'Weekday (Mon-Fri)';
}
export let plannerPulse = null; 
export let plannerExpandedState = new Set(); 
export let tripMapInstance = null;
export let tripMapRouteLine = null;
export let tripMapMarkers = [];
let tripMapInitTimeout = null;
let tripMapDestroyTimeout = null;
/** When true, trip-map station labels include departure/arrival times. */
let tripMapShowStationTimes = false;

function destroyTripMapInstance() {
    if (tripMapInitTimeout) clearTimeout(tripMapInitTimeout);
    if (tripMapDestroyTimeout) clearTimeout(tripMapDestroyTimeout);
    tripMapInitTimeout = null;
    tripMapDestroyTimeout = null;
    if (tripMapInstance) {
        try {
            tripMapInstance.stopLocate();
            tripMapInstance.off();
            tripMapInstance.remove();
        } catch (e) { /* ignore */ }
        tripMapInstance = null;
    }
    tripMapRouteLine = null;
    tripMapMarkers = [];
    const mapCanvas = document.getElementById('trip-map-canvas');
    if (mapCanvas) mapCanvas.innerHTML = '';
    if (typeof window !== 'undefined') window._isMapInitializing = false;
}

/** Tear down Leaflet only after the modal has faded out — avoids a white flash. */
function scheduleTripMapDestroy(delayMs = 320) {
    if (tripMapDestroyTimeout) clearTimeout(tripMapDestroyTimeout);
    tripMapDestroyTimeout = setTimeout(() => {
        tripMapDestroyTimeout = null;
        destroyTripMapInstance();
    }, delayMs);
}

function closeTripMapModal() {
    if (typeof location !== 'undefined' && location.hash === '#trip-map') {
        try { history.back(); } catch (e) { closeSmoothModal('trip-map-modal'); }
    } else {
        closeSmoothModal('trip-map-modal');
    }
    scheduleTripMapDestroy();
}

if (typeof window !== 'undefined' && !window.__ntTripMapPopBound) {
    window.__ntTripMapPopBound = true;
    window.addEventListener('popstate', () => {
        if (location.hash !== '#trip-map' && (tripMapInstance || document.getElementById('trip-map-modal'))) {
            scheduleTripMapDestroy();
        }
    });
}

// --- GUARDIAN PHASE 1: ROUTER BLEED & GREY SCREEN INTERCEPTOR ---
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const tripMapCloseBtn = e.target.closest('#close-trip-map-btn, #close-trip-map-btn-2');
        if (tripMapCloseBtn) {
            if (tripMapCloseBtn.dataset.isClosing === "true") {
                e.preventDefault();
                e.stopPropagation();
                console.log("🛡️ Guardian: Suppressed double-tap on Map Close button (Router Bleed Prevented).");
                return;
            }
            tripMapCloseBtn.dataset.isClosing = "true";
            setTimeout(() => { delete tripMapCloseBtn.dataset.isClosing; }, 1000);
        }
    }, true);
}

// --- INTERACTIVE SELECTORS & ACTIONS ---

export function toggleCustomTimeDropdown(e) {
    if (e) e.stopPropagation();
    const list = document.getElementById('custom-time-list');
    if (!list) return;
    
    const isOpening = list.classList.contains('hidden');
    
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim('custom-time-list', 'custom-time-chevron');
    } else {
        const chevron = document.getElementById('custom-time-chevron');
        list.classList.toggle('hidden');
        if (!list.classList.contains('hidden')) {
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            if (chevron) chevron.classList.remove('rotate-180');
        }
    }
    
    if (isOpening) {
        setTimeout(() => {
            const selected = list.querySelector('.bg-blue-600');
            if (selected) selected.scrollIntoView({ block: 'nearest' });
        }, 10);
    }
}

export function selectCustomTrip(idx) {
    if (!currentTripOptions || idx >= currentTripOptions.length) return;
    
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim(); 
    } else {
        const list = document.getElementById('custom-time-list');
        const chevron = document.getElementById('custom-time-chevron');
        if (list) list.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }
    
    selectPlannerTrip(idx);
}

export function toggleMainDayDropdown(e) {
    if (e) e.stopPropagation();
    syncPlannerDayDropdownForRegion();
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim('main-day-list', 'main-day-chevron');
    } else {
        const list = document.getElementById('main-day-list');
        const chevron = document.getElementById('main-day-chevron');
        if (!list) return;
        list.classList.toggle('hidden');
        if (!list.classList.contains('hidden')) {
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            if (chevron) chevron.classList.remove('rotate-180');
        }
    }
}

/** Single-button travel-day date sheet (replaces the second native date field). */
function openPlannerDateSheet() {
    let modal = document.getElementById('planner-date-sheet');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'planner-date-sheet';
        modal.className = 'fixed inset-0 bg-black/70 z-[210] hidden flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 pb-8">
                <div class="flex items-center justify-between mb-3">
                    <div>
                        <p class="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400">Travel Day</p>
                        <h3 class="text-base font-black text-gray-900 dark:text-white">Pick a date</h3>
                    </div>
                    <button type="button" id="planner-date-sheet-cancel" class="text-gray-400 hover:text-gray-600 p-2 focus:outline-none" aria-label="Close">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <input type="date" id="planner-date-sheet-input" class="w-full p-3.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none mb-4" />
                <button type="button" id="planner-date-sheet-apply" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl text-sm shadow-sm focus:outline-none">Set travel day</button>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('planner-date-sheet-cancel')?.addEventListener('click', () => {
            if (typeof closeSmoothModal === 'function') closeSmoothModal('planner-date-sheet');
            else modal.classList.add('hidden');
        });
        document.getElementById('planner-date-sheet-apply')?.addEventListener('click', () => {
            const inp = document.getElementById('planner-date-sheet-input');
            const val = inp?.value;
            if (!val) {
                if (typeof showToast === 'function') showToast('Please pick a date.', 'error');
                return;
            }
            applyPlannerSpecificDate(val);
            if (typeof closeSmoothModal === 'function') closeSmoothModal('planner-date-sheet');
            else modal.classList.add('hidden');
        });
    }
    const inp = document.getElementById('planner-date-sheet-input');
    if (inp) {
        if (selectedPlannerDate) inp.value = selectedPlannerDate;
        else {
            const t = new Date();
            inp.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        }
    }
    if (typeof openSmoothModal === 'function') openSmoothModal('planner-date-sheet');
    else modal.classList.remove('hidden');
}

export function selectMainDay(e, value, text) {
    if (e) {
        e.preventDefault?.();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
    }
    
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim(); 
    } else {
        const list = document.getElementById('main-day-list');
        const chevron = document.getElementById('main-day-chevron');
        if (list) list.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }

    const dateWrap = document.getElementById('planner-specific-date-wrap');
    if (dateWrap) dateWrap.classList.add('hidden');

    if (value === 'specific') {
        openPlannerDateSheet();
        return;
    }

    selectedPlannerDate = null;
    selectedPlannerDay = value;

    const display = document.getElementById('main-day-display');
    if (display) display.textContent = text || plannerDayDisplayText(value);

    const list = document.getElementById('main-day-list');
    if (list) {
        list.querySelectorAll('li[data-day]').forEach((li) => {
            li.classList.remove('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
            if (li.getAttribute('data-day') === value) {
                li.classList.add('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
            }
        });
    }
}

export function applyPlannerSpecificDate(isoDate) {
    const resolved = resolveDayTypeFromIso(isoDate);
    if (!resolved) {
        if (typeof showToast === 'function') showToast('Please pick a valid date.', 'error');
        return;
    }
    selectedPlannerDate = isoDate;
    selectedPlannerDay = resolved.dayType;
    const display = document.getElementById('main-day-display');
    if (display) display.textContent = plannerDayDisplayText('specific', isoDate);
    const list = document.getElementById('main-day-list');
    if (list) {
        list.querySelectorAll('li[data-day]').forEach((li) => {
            li.classList.remove('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
            if (li.getAttribute('data-day') === 'specific') {
                li.classList.add('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
            }
        });
    }
}

export function toggleHeaderDayDropdown(e) {
    if (e) e.stopPropagation();
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim('header-day-list', 'header-day-chevron');
    } else {
        const list = document.getElementById('header-day-list');
        const chevron = document.getElementById('header-day-chevron');
        if (!list) return;
        list.classList.toggle('hidden');
        if (!list.classList.contains('hidden')) {
            if (chevron) chevron.classList.add('rotate-180');
        } else {
            if (chevron) chevron.classList.remove('rotate-180');
        }
    }
}

export function selectHeaderDay(e, value, text) {
    if (e) e.stopPropagation();
    
    if (typeof window !== 'undefined' && window.toggleDropdownScrim) {
        window.toggleDropdownScrim(); 
    } else {
        const list = document.getElementById('header-day-list');
        const chevron = document.getElementById('header-day-chevron');
        if (list) list.classList.add('hidden');
        if (chevron) chevron.classList.remove('rotate-180');
    }

    if (typeof triggerHaptic === 'function') triggerHaptic();
    selectedPlannerDay = value;
    
    const daySelectDisp = document.getElementById('main-day-display');
    if (daySelectDisp) {
        let mainTxt = plannerDayDisplayText(value);
        daySelectDisp.textContent = mainTxt;
        
        const mList = document.getElementById('main-day-list');
        if (mList) {
            mList.querySelectorAll('li').forEach(li => {
                li.classList.remove('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
                if (li.textContent === mainTxt) {
                    li.classList.add('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
                }
            });
        }
    }
    
    if (typeof showToast === 'function') {
        showToast("Switched to " + text, "info", 1500);
    }
    
    let fromStation = "";
    let toStation = "";
    
    if (typeof currentTripOptions !== 'undefined' && currentTripOptions.length > 0) {
        fromStation = currentTripOptions[0].from;
        toStation = currentTripOptions[0].to;
    } else {
        const fromInput = document.getElementById('planner-from-search');
        const toInput = document.getElementById('planner-to-search');
        
        fromStation = (fromInput && fromInput.dataset.resolvedValue) ? fromInput.dataset.resolvedValue : "";
        toStation = (toInput && toInput.dataset.resolvedValue) ? toInput.dataset.resolvedValue : "";
    }

    if (fromStation && toStation) {
        executeTripPlan(fromStation, toStation);
    } else if (typeof showToast === 'function') {
        showToast("Could not resolve stations for new date.", "error");
    }
}

export function hidePlannerResults() {
    if (typeof plannerPulse !== 'undefined' && plannerPulse) { clearInterval(plannerPulse); plannerPulse = null; }
    const inputSection = document.getElementById('planner-input-section');
    const resultsSection = document.getElementById('planner-results-section');
    if (inputSection) inputSection.classList.remove('hidden');
    if (resultsSection) resultsSection.classList.add('hidden');
    plannerExpandedState.clear();
    // Recent trips live on the search screen — refresh after leaving results
    try { renderPlannerHistory(); } catch { /* ignore */ }
}

/** Open network map in-app (never hard-nav to /map.html) so Back restores planner results. */
export function openPlannerNetworkMap() {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    const resultsSection = document.getElementById('planner-results-section');
    if (resultsSection) resultsSection.classList.remove('hidden');
    // Ensure results hash is under the map entry
    if (typeof location !== 'undefined' && location.hash !== '#planner-results' && location.hash !== '#map') {
        try { history.pushState({ view: 'planner-results' }, '', '#planner-results'); } catch { /* ignore */ }
    }
    try {
        sessionStorage.setItem('nt_map_from_planner', '1');
    } catch { /* ignore */ }
    const closeBtn2 = document.getElementById('close-map-btn-2');
    if (closeBtn2 && !closeBtn2.dataset.plannerReturnLabel) {
        closeBtn2.dataset.plannerReturnLabel = closeBtn2.textContent || 'Close Map';
        closeBtn2.textContent = 'Back to trip';
    }
    if (typeof openSmoothModal === 'function') openSmoothModal('map-modal');
    else if (typeof window.setupMapLogic === 'function') {
        window.setupMapLogic();
        document.getElementById('view-map-btn')?.click();
    }
}

function capturePlannerSnapshot(extra = {}) {
    lastPlannerSnapshot = {
        origin: plannerOrigin,
        dest: plannerDest,
        status: currentPlannerStatus,
        errorPayload: currentPlannerErrorPayload,
        tripCount: (currentTripOptions || []).length,
        tripIndex: window._plannerCurrentTripIndex || 0,
        at: Date.now(),
        ...extra,
    };
    try {
        sessionStorage.setItem('nt_planner_snap', JSON.stringify({
            origin: lastPlannerSnapshot.origin,
            dest: lastPlannerSnapshot.dest,
            status: lastPlannerSnapshot.status,
            errorPayload: lastPlannerSnapshot.errorPayload,
            tripIndex: lastPlannerSnapshot.tripIndex,
        }));
    } catch { /* ignore */ }
}

/** Re-show results after map/modal back if the shell was cleared. */
export function restorePlannerResultsView() {
    const resultsSection = document.getElementById('planner-results-section');
    const inputSection = document.getElementById('planner-input-section');
    if (!resultsSection) return false;

    // Already showing with content — keep it
    const list = document.getElementById('planner-results-list');
    if (!resultsSection.classList.contains('hidden') && list && list.innerHTML.trim()) {
        return true;
    }

    const snap = lastPlannerSnapshot;
    if (!snap && (currentTripOptions?.length || currentPlannerErrorPayload || currentPlannerStatus)) {
        // In-memory state still present
        resultsSection.classList.remove('hidden');
        if (inputSection) inputSection.classList.add('hidden');
        if (currentTripOptions?.length) {
            renderSelectedTrip(list, window._plannerCurrentTripIndex || 0);
        }
        return true;
    }
    if (!snap) return false;

    plannerOrigin = snap.origin;
    plannerDest = snap.dest;
    currentPlannerStatus = snap.status;
    currentPlannerErrorPayload = snap.errorPayload;
    resultsSection.classList.remove('hidden');
    if (inputSection) inputSection.classList.add('hidden');

    if (currentTripOptions?.length) {
        renderSelectedTrip(list, snap.tripIndex || 0);
        return true;
    }
    // Error-only snapshot: re-run plan to rebuild the card (schedules still in memory)
    if (snap.origin && snap.dest) {
        executeTripPlan(snap.origin, snap.dest);
        return true;
    }
    return false;
}

export function openDisruptionModal(id) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    
    let targetDisruption = null;
    const globalDisruptions = $globalDisruptions.get();
    if (globalDisruptions) {
        for (const routeId in globalDisruptions) {
            const found = globalDisruptions[routeId].find(d => d.id === id);
            if (found) {
                targetDisruption = found;
                break;
            }
        }
    }
    
    if (!targetDisruption) {
        if (typeof showToast === 'function') showToast("Disruption details not found.", "error");
        return;
    }
    
    const titleEl = document.getElementById('disruption-modal-stations');
    const bodyEl = document.getElementById('disruption-modal-body');
    const badgeEl = document.getElementById('disruption-modal-tier-badge');
    const timeEl = document.getElementById('disruption-modal-timestamp');
    const iconEl = document.getElementById('disruption-icon-svg');
    
    const cleanStr = (s) => s ? s.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
    
    let locationText = "Route-Wide Advisory";
    if (targetDisruption.stations && targetDisruption.stations.length >= 2) {
        locationText = `Between <span class="text-blue-600 dark:text-blue-400">${cleanStr(targetDisruption.stations[0]).replace(' STATION', '')}</span> & <span class="text-blue-600 dark:text-blue-400">${cleanStr(targetDisruption.stations[1]).replace(' STATION', '')}</span>`;
    } else if (targetDisruption.stations && targetDisruption.stations.length === 1) {
        locationText = `At <span class="text-blue-600 dark:text-blue-400">${cleanStr(targetDisruption.stations[0]).replace(' STATION', '')}</span>`;
    } else if (targetDisruption.routeId && ROUTES[targetDisruption.routeId]) {
        const r = ROUTES[targetDisruption.routeId];
        locationText = `Between <span class="text-blue-600 dark:text-blue-400">${cleanStr(r.destA).replace(' STATION', '')}</span> & <span class="text-blue-600 dark:text-blue-400">${cleanStr(r.destB).replace(' STATION', '')}</span>`;
    }
    if (titleEl) titleEl.innerHTML = locationText;
    
    if (bodyEl) bodyEl.innerHTML = targetDisruption.message || targetDisruption.longExplanation || "No additional details provided.";
    
    if (badgeEl) {
        if (targetDisruption.tier === 'CRITICAL') {
            badgeEl.className = "w-full text-center text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 py-2.5 rounded-lg border border-red-200 dark:border-red-800/50";
            badgeEl.innerHTML = `${plannerIcon('circle', 'w-2.5 h-2.5 inline-block mr-1.5 align-[-1px] text-red-500')} CRITICAL SERVICE DISRUPTION`;
            // SVGElement.className is read-only (SVGAnimatedString) — use setAttribute
            if (iconEl) iconEl.setAttribute('class', 'w-5 h-5 mr-2 text-red-500');
        } else {
            badgeEl.className = "w-full text-center text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 py-2.5 rounded-lg border border-yellow-200 dark:border-yellow-800/50";
            badgeEl.innerHTML = `${plannerIcon('circle', 'w-2.5 h-2.5 inline-block mr-1.5 align-[-1px] text-yellow-500')} EXPECT DELAYS / SINGLE TRACK`;
            if (iconEl) iconEl.setAttribute('class', 'w-5 h-5 mr-2 text-yellow-500');
        }
    }
    
    if (timeEl) {
        if (targetDisruption.postedAt) {
            const d = new Date(targetDisruption.postedAt);
            const dateStr = d.toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
            timeEl.textContent = `Posted: ${timeStr}, ${dateStr}`;
        } else {
            timeEl.textContent = "Posted: Recently";
        }
    }

    const modalCard = document.getElementById('disruption-modal-card');
    if (modalCard) {
        const replyBtn = Array.from(modalCard.querySelectorAll('button')).find(b => b.textContent.includes('Reply'));
        if (replyBtn) {
            replyBtn.onclick = (e) => {
                e.preventDefault();
                if (typeof triggerHaptic === 'function') triggerHaptic();

                let shortLocation = locationText.replace(/<[^>]*>?/gm, ''); 
                let advisoryTitle = targetDisruption.buttonText || (targetDisruption.tier === 'CRITICAL' ? 'Line Severed' : 'Expect Delays');
                let rawMsg = `${advisoryTitle} - ${shortLocation}`;

                enterFeedbackReplyMode({
                    label: 'Replying to Advisory:',
                    snippet: rawMsg,
                    rawMsg,
                });

                if (typeof closeSmoothModal === 'function') closeSmoothModal('disruption-modal');
                setTimeout(() => {
                    if (typeof trackAnalyticsEvent === 'function') trackAnalyticsEvent('open_feedback_modal', { location: 'planner_disruption_reply' });
                    history.pushState({ modal: 'feedback' }, '', '#feedback');
                    if (typeof openSmoothModal === 'function') openSmoothModal('feedback-modal');
                }, 350);
            };
        }
    }
    
    if (typeof openSmoothModal === 'function') openSmoothModal('disruption-modal');
}

export function extractTripCoordinates(tripIndex) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    if (!currentTripOptions || !currentTripOptions[tripIndex]) return;
    
    const trip = currentTripOptions[tripIndex];
    const coordinates = [];
    const stationNames = [];
    const validStops = []; 
    const globalStationIndex = $globalStationIndex.get();

    const addStops = (stopsArray) => {
        if (!stopsArray) return;
        stopsArray.forEach(stop => {
            if (stop.time === "---") return;

            const name = normalizeStationName(stop.station);
            // Transfer station: same name as previous stop → keep arrive, attach depart
            if (stationNames.length > 0 && stationNames[stationNames.length - 1] === name) {
                const last = validStops[validStops.length - 1];
                if (last && stop.time) last.timeOut = stop.time;
                return;
            }

            stationNames.push(name);

            if (globalStationIndex && globalStationIndex[name] && globalStationIndex[name].lat) {
                const coord = [globalStationIndex[name].lat, globalStationIndex[name].lon];
                coordinates.push(coord);

                validStops.push({
                    name: name,
                    lat: coord[0],
                    lon: coord[1],
                    time: stop.time || null,
                    timeOut: null
                });
            }
        });
    };

    if (trip.type === 'DIRECT') {
        addStops(trip.stops);
    } else if (trip.type === 'TRANSFER') {
        addStops(trip.leg1.stops);
        addStops(trip.leg2.stops);
    } else if (trip.type === 'DOUBLE_TRANSFER') {
        addStops(trip.leg1.stops);
        addStops(trip.leg2.stops);
        addStops(trip.leg3.stops);
    } else if (trip.type === 'MULTI_TRANSFER' || trip.legs) {
        trip.legs.forEach(leg => addStops(leg.stops));
    }

    if (coordinates.length === 0) {
        if (typeof showToast === 'function') showToast("Coordinate data unavailable for this route.", "error");
        return;
    }

    const routeData = {
        origin: normalizeStationName(trip.from),
        destination: normalizeStationName(trip.to),
        path: coordinates,        
        stationNames: stationNames, 
        validStops: validStops,   
        globalDisruptions: $globalDisruptions.get() || {} 
    };

    if (typeof trackAnalyticsEvent === 'function') {
        trackAnalyticsEvent('open_live_map', {
            origin: trip.from.replace(' STATION', ''),
            destination: trip.to.replace(' STATION', ''),
            trip_type: trip.type
        });
    }

    if (typeof window !== 'undefined' && typeof window.openTripMapRenderer === 'function') {
        window.openTripMapRenderer(routeData);
    } else {
        openTripMapRenderer(routeData);
    }
}

// --- CLIENT-SIDE LAZY-LOADED LEAFLET MAP (parity with map.html chrome) ---
export async function openTripMapRenderer(routeData) {
    if (typeof window === 'undefined') return;
    triggerHaptic();

    if (window._isMapInitializing || window._isRenderingHeavy) {
        console.warn('🛡️ Guardian: Suppressed rapid map initialization (Mutex Lock or Canvas Render active).');
        return;
    }
    window._isMapInitializing = true;

    if (!navigator.onLine && !window.L) {
        showToast('Internet connection required to load live map.', 'error');
        window._isMapInitializing = false;
        return;
    }

    showToast('Loading live map...', 'info', 1500);

    if (!document.getElementById('live-map-custom-styles')) {
        const style = document.createElement('style');
        style.id = 'live-map-custom-styles';
        style.textContent = `
            .gps-pulse { width: 16px; height: 16px; background: #3b82f6; border-radius: 50%; box-shadow: 0 0 0 rgba(59, 130, 246, 0.4); animation: ntGpsPulse 2s infinite; border: 3px solid white; }
            @keyframes ntGpsPulse { 0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); } 70% { box-shadow: 0 0 0 15px rgba(59, 130, 246, 0); } 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); } }
            .custom-div-icon { background: transparent; border: none; }
            .dark .leaflet-tile-pane { filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%); }
            .tooltip-dynamic { transition: opacity 0.3s ease, font-size 0.2s ease; font-family: inherit; opacity: 0; }
            .leaflet-tooltip.tooltip-halo { background: transparent !important; border: none !important; box-shadow: none !important; white-space: nowrap; color: #1f2937; text-shadow: -1.5px -1.5px 0 #ffffff, 1.5px -1.5px 0 #ffffff, -1.5px 1.5px 0 #ffffff, 1.5px 1.5px 0 #ffffff; }
            .dark .leaflet-tooltip.tooltip-halo { color: #ffffff !important; text-shadow: -1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8), -1px 1px 0 rgba(0,0,0,0.8), 1px 1px 0 rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.9) !important; }
            .leaflet-tooltip.tooltip-halo::before { display: none !important; }
            .disruption-line-overlay { animation: ntDashPulse 1.5s linear infinite; }
            @keyframes ntDashPulse { to { stroke-dashoffset: -22; } }
        `;
        document.head.appendChild(style);
    }

    if (!window.L) {
        try {
            await new Promise((resolve, reject) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
                document.head.appendChild(link);
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch (e) {
            showToast('Failed to load map engine.', 'error');
            window._isMapInitializing = false;
            return;
        }
    }

    let modal = document.getElementById('trip-map-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'trip-map-modal';
        modal.className = 'fixed inset-0 bg-black bg-opacity-90 z-[120] hidden flex items-center justify-center p-0 full-screen backdrop-blur-md transition-opacity duration-300';
        modal.innerHTML = `
            <div class="bg-gray-100 dark:bg-gray-900 rounded-none shadow-2xl w-full h-full flex flex-col transform transition-transform duration-300 scale-100 overflow-hidden relative">
                <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-100 dark:bg-gray-800 z-20 relative shrink-0 shadow-sm">
                    <div class="flex items-center space-x-3 min-w-0 pr-2">
                        <div class="flex flex-col min-w-0">
                            <h3 class="text-base font-black text-gray-900 dark:text-white truncate tracking-tight mb-0.5" id="trip-map-title">Route Map</h3>
                            <p class="text-xs text-blue-600 dark:text-blue-400 font-bold truncate" id="trip-map-subtitle">Loading...</p>
                        </div>
                    </div>
                    <button type="button" id="close-trip-map-btn" class="p-2 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition focus:outline-none shrink-0" aria-label="Close Map">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div class="flex-grow w-full bg-gray-200 dark:bg-gray-800 relative z-10 min-h-0">
                    <div id="trip-map-canvas" class="absolute inset-0 bg-gray-200 dark:bg-gray-800"></div>

                    <div id="trip-map-top-controls" class="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2 pointer-events-none">
                        <button type="button" id="custom-theme-btn" class="pointer-events-auto w-11 h-11 flex items-center justify-center bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600 text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none" aria-label="Toggle theme">${plannerIcon('sun', 'w-5 h-5')}</button>
                        <button type="button" id="trip-map-times-toggle" class="pointer-events-auto w-11 h-11 flex items-center justify-center bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none" aria-label="Show station times" aria-pressed="false" title="Show station times">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </button>
                    </div>

                    <div class="absolute bottom-6 right-4 z-[1000] pointer-events-none">
                        <button type="button" id="custom-locate-btn" class="w-14 h-14 flex items-center justify-center bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-300 dark:border-gray-600 hover:scale-105 transition-transform pointer-events-auto text-gray-400 focus:outline-none" aria-label="Locate me">
                            <svg class="w-6 h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>
                        </button>
                    </div>
                </div>

                <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 z-20 relative shrink-0">
                    <button type="button" id="close-trip-map-btn-2" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-colors focus:outline-none">Close Map</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('close-trip-map-btn')?.addEventListener('click', closeTripMapModal);
        document.getElementById('close-trip-map-btn-2')?.addEventListener('click', closeTripMapModal);
    } else {
        // Migrate older trip-map chrome (zoom / footer times text button)
        modal.querySelector('#custom-zoom-in')?.closest('.flex.flex-col')?.remove();
        const footerTimes = modal.querySelector('#close-trip-map-btn-2')?.parentElement?.querySelector('#trip-map-times-toggle');
        if (footerTimes && !footerTimes.closest('#trip-map-top-controls')) footerTimes.remove();
        const canvasWrap = modal.querySelector('#trip-map-canvas')?.parentElement;
        if (canvasWrap && !modal.querySelector('#trip-map-top-controls')) {
            const stack = document.createElement('div');
            stack.id = 'trip-map-top-controls';
            stack.className = 'absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2 pointer-events-none';
            stack.innerHTML = `
                <button type="button" id="custom-theme-btn" class="pointer-events-auto w-11 h-11 flex items-center justify-center bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600 text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none" aria-label="Toggle theme">${plannerIcon('sun', 'w-5 h-5')}</button>
                <button type="button" id="trip-map-times-toggle" class="pointer-events-auto w-11 h-11 flex items-center justify-center bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-300 dark:border-gray-600 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none" aria-label="Show station times" aria-pressed="false" title="Show station times">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </button>`;
            canvasWrap.appendChild(stack);
            modal.querySelector('#custom-theme-btn:not(#trip-map-top-controls #custom-theme-btn)')?.remove();
        }
    }

    // Reset times toggle each open (off by default)
    tripMapShowStationTimes = false;
    const timesToggleBtn = document.getElementById('trip-map-times-toggle');
    if (timesToggleBtn) {
        timesToggleBtn.setAttribute('aria-pressed', 'false');
        timesToggleBtn.setAttribute('aria-label', 'Show station times');
        timesToggleBtn.title = 'Show station times';
        timesToggleBtn.classList.remove('text-blue-600', 'dark:text-blue-400', 'bg-blue-50', 'dark:bg-blue-900/40', 'border-blue-300', 'dark:border-blue-700');
        timesToggleBtn.classList.add('text-gray-400');
    }

    try {
        if (location.hash !== '#trip-map') history.pushState({ modal: 'trip-map' }, '', '#trip-map');
    } catch (e) { /* ignore */ }
    openSmoothModal('trip-map-modal');

    if (tripMapInitTimeout) clearTimeout(tripMapInitTimeout);
    if (tripMapDestroyTimeout) clearTimeout(tripMapDestroyTimeout);
    tripMapDestroyTimeout = null;

    tripMapInitTimeout = setTimeout(async () => {
        if (tripMapInstance) {
            try {
                tripMapInstance.stopLocate();
                tripMapInstance.off();
                tripMapInstance.remove();
            } catch (e) { /* ignore */ }
            tripMapInstance = null;
            const mapCanvas = document.getElementById('trip-map-canvas');
            if (mapCanvas) mapCanvas.innerHTML = '';
        }
        tripMapRouteLine = null;
        tripMapMarkers = [];

        try {
            const L = window.L;
            const mapCanvasEl = document.getElementById('trip-map-canvas');
            if (mapCanvasEl) {
                mapCanvasEl.classList.add('bg-gray-200', 'dark:bg-gray-800');
                mapCanvasEl.style.backgroundColor = '';
            }
            tripMapInstance = L.map('trip-map-canvas', {
                zoomControl: false,
                attributionControl: true
            });
            try { tripMapInstance.getContainer().style.background = 'transparent'; } catch (e) { /* ignore */ }

            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap'
            }).addTo(tripMapInstance);

            const routeLayerGroup = L.layerGroup().addTo(tripMapInstance);
            const createDot = (bgColor, size) => L.divIcon({
                className: 'custom-div-icon',
                html: `<div style="background-color:${bgColor}; width: ${size}px; height: ${size}px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
                iconSize: [size, size],
                iconAnchor: [size / 2, size / 2]
            });

            // Prefer OSM rail geometry for the blue journey line (station dots stay on coords)
            const stationPath = (routeData.path || []).filter((p) => p && p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]));
            const region = $userRegion.get() || 'GP';
            let drawPath = stationPath;
            try {
                const stops = routeData.validStops || [];
                const smoothed = await smoothPathFromStops(stops, region);
                if (smoothed && smoothed.length > 1) {
                    drawPath = smoothed;
                } else if (stops.length > 1) {
                    // Retry once with a slightly looser mental model: already handled in rail-tracks snap.
                    console.warn('Guardian: trip map rail snap returned null — drawing station chords.');
                }
            } catch (e) {
                console.warn('Guardian: trip map rail snap failed, using station chords.', e);
            }

            const drawRouteElements = () => {
                routeLayerGroup.clearLayers();
                const currentPath = drawPath;
                const currentOrigin = routeData.origin || '';
                const currentDest = routeData.destination || '';
                const currentValidStops = routeData.validStops || [];

                const titleEl = document.getElementById('trip-map-title');
                if (titleEl) {
                    const titleCase = (s) => String(s || '')
                        .replace(/ STATION/gi, '')
                        .trim()
                        .toLowerCase()
                        .replace(/\b\w/g, (c) => c.toUpperCase());
                    titleEl.textContent = `${titleCase(currentOrigin)} To ${titleCase(currentDest)}`;
                }
                const subTitleEl = document.getElementById('trip-map-subtitle');
                if (subTitleEl) {
                    const stopCount = currentValidStops.length || stationPath.length;
                    subTitleEl.textContent = `${stopCount} stops along route`;
                }

                if (currentPath.length === 0) return null;

                const polyline = L.polyline(currentPath, {
                    color: '#3b82f6',
                    weight: 6,
                    opacity: 0.8,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(routeLayerGroup);
                tripMapRouteLine = polyline;

                const majorLabelClass = 'font-bold text-[11px] text-gray-900 dark:text-white z-50 tooltip-dynamic tooltip-halo';
                const minorLabelClass = 'font-medium text-[9.5px] text-gray-700 dark:text-gray-300 tooltip-dynamic tooltip-halo minor-station-tooltip';
                const stationLabel = (name, time, timeOut = null) => {
                    const clean = String(name || '').replace(/ STATION/gi, '');
                    if (!tripMapShowStationTimes) return clean;
                    const tIn = time && time !== '---' ? formatTimeDisplay(time) : '';
                    const tOut = timeOut && timeOut !== '---' ? formatTimeDisplay(timeOut) : '';
                    if (tIn && tOut && tIn !== tOut) return `${clean} · ${tIn} → ${tOut}`;
                    if (tIn) return `${clean} · ${tIn}`;
                    if (tOut) return `${clean} · ${tOut}`;
                    return clean;
                };

                tripMapMarkers = [];
                if (currentValidStops.length > 0) {
                    currentValidStops.forEach((stop, idx) => {
                        if (idx !== 0 && idx !== currentValidStops.length - 1) {
                            const m = L.circleMarker([stop.lat, stop.lon], {
                                radius: 2.5, color: '#3b82f6', weight: 1, fillColor: '#ffffff', fillOpacity: 1
                            }).bindTooltip(stationLabel(stop.name, stop.time, stop.timeOut), {
                                permanent: true, direction: 'top', offset: [0, -5], className: minorLabelClass
                            }).addTo(routeLayerGroup);
                            tripMapMarkers.push(m);
                        }
                    });
                }

                const startLatLng = currentValidStops[0]
                    ? [currentValidStops[0].lat, currentValidStops[0].lon]
                    : currentPath[0];
                const endLatLng = currentValidStops.length
                    ? [currentValidStops[currentValidStops.length - 1].lat, currentValidStops[currentValidStops.length - 1].lon]
                    : currentPath[currentPath.length - 1];
                const startStop = currentValidStops[0];
                const endStop = currentValidStops.length
                    ? currentValidStops[currentValidStops.length - 1]
                    : null;

                L.marker(startLatLng, { icon: createDot('#22c55e', 14) })
                    .bindTooltip(`<b>Start:</b> ${stationLabel(currentOrigin, startStop?.time, startStop?.timeOut)}`, {
                        permanent: true, direction: 'top', offset: [0, -10], className: majorLabelClass
                    }).addTo(routeLayerGroup);

                L.marker(endLatLng, { icon: createDot('#ef4444', 14) })
                    .bindTooltip(`<b>End:</b> ${stationLabel(currentDest, endStop?.time, endStop?.timeOut)}`, {
                        permanent: true, direction: 'top', offset: [0, -10], className: majorLabelClass
                    }).addTo(routeLayerGroup);

                const activeDisruptions = routeData.globalDisruptions || {};
                if (currentValidStops.length > 0) {
                    const drawnIds = new Set();
                    Object.values(activeDisruptions).flat().forEach((d) => {
                        if (!d || drawnIds.has(d.id) || !d.stations || d.stations.length === 0) return;
                        const normStations = d.stations.map((s) => normalizeStationName(s));
                        const isCritical = d.tier === 'CRITICAL';
                        const color = isCritical ? '#ef4444' : '#eab308';

                        if (normStations.length >= 2) {
                            const s1 = currentValidStops.find((vs) => normalizeStationName(vs.name) === normStations[0]);
                            const s2 = currentValidStops.find((vs) => normalizeStationName(vs.name) === normStations[1]);
                            if (!s1 || !s2) return;
                            drawnIds.add(d.id);
                            const i1 = nearestPathIndex(currentPath, s1.lat, s1.lon);
                            const i2 = nearestPathIndex(currentPath, s2.lat, s2.lon);
                            if (i1 < 0 || i2 < 0) return;
                            const start = Math.min(i1, i2);
                            const end = Math.max(i1, i2);
                            const segment = currentPath.slice(start, end + 1);
                            if (segment.length < 2) return;
                            L.polyline(segment, {
                                color, weight: 10, opacity: 0.8, dashArray: '10, 12',
                                lineCap: 'round', lineJoin: 'round', className: 'disruption-line-overlay'
                            }).addTo(routeLayerGroup);
                            const midPoint = currentPath[Math.floor((start + end) / 2)];
                            if (midPoint) {
                                L.marker(midPoint, {
                                    icon: L.divIcon({
                                        className: 'custom-div-icon',
                                        html: `<div class="flex items-center justify-center rounded-full shadow-lg border-2 border-white" style="width:22px;height:22px;background-color:${color};"><span class="text-[11px] text-white font-black">${isCritical ? '✕' : '!'}</span></div>`,
                                        iconSize: [22, 22], iconAnchor: [11, 11]
                                    })
                                }).bindTooltip(`<b>${isCritical ? 'LINE SEVERED' : 'EXPECT DELAYS'}</b>`, {
                                    permanent: true, direction: 'top', offset: [0, -10],
                                    className: 'font-bold text-[10px] text-gray-900 z-50 tooltip-dynamic tooltip-halo'
                                }).addTo(routeLayerGroup);
                            }
                        } else if (normStations.length === 1) {
                            const idx1 = currentValidStops.findIndex((vs) => normalizeStationName(vs.name) === normStations[0]);
                            if (idx1 === -1) return;
                            drawnIds.add(d.id);
                            const s1 = currentValidStops[idx1];
                            L.marker([s1.lat, s1.lon], {
                                icon: L.divIcon({
                                    className: 'custom-div-icon',
                                    html: `<div class="flex items-center justify-center rounded-full shadow-lg border-2 border-white" style="width:24px;height:24px;background-color:${color};"><span class="text-xs text-white font-black">${isCritical ? '✕' : '!'}</span></div>`,
                                    iconSize: [24, 24], iconAnchor: [12, 12]
                                })
                            }).bindTooltip(`<b>${isCritical ? 'STATION INCIDENT' : 'STATION DELAYS'}</b>`, {
                                permanent: true, direction: 'top', offset: [0, -12],
                                className: 'font-bold text-[10px] text-gray-900 z-50 tooltip-dynamic tooltip-halo'
                            }).addTo(routeLayerGroup);
                        }
                    });
                }

                return polyline;
            };

            const initialPolyline = drawRouteElements();
            if (initialPolyline) {
                tripMapInstance.fitBounds(initialPolyline.getBounds(), { padding: [50, 50] });
            }

            const themeBtn = document.getElementById('custom-theme-btn');
            let isDarkNow = document.documentElement.classList.contains('dark');
            const paintThemeBtn = () => {
                if (!themeBtn) return;
                themeBtn.innerHTML = isDarkNow ? plannerIcon('moon', 'w-5 h-5') : plannerIcon('sun', 'w-5 h-5');
                themeBtn.classList.toggle('text-indigo-400', isDarkNow);
                themeBtn.classList.toggle('text-amber-500', !isDarkNow);
            };
            if (themeBtn) {
                paintThemeBtn();
                themeBtn.onclick = () => {
                    isDarkNow = !isDarkNow;
                    document.documentElement.classList.toggle('dark', isDarkNow);
                    try { localStorage.setItem('theme', isDarkNow ? 'dark' : 'light'); } catch (e) { /* ignore */ }
                    paintThemeBtn();
                };
            }

            const paintTimesBtn = (btn) => {
                if (!btn) return;
                const on = tripMapShowStationTimes;
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.setAttribute('aria-label', on ? 'Hide station times' : 'Show station times');
                btn.title = on ? 'Hide station times' : 'Show station times';
                btn.classList.toggle('text-blue-600', on);
                btn.classList.toggle('dark:text-blue-400', on);
                btn.classList.toggle('bg-blue-50', on);
                btn.classList.toggle('dark:bg-blue-900/40', on);
                btn.classList.toggle('border-blue-300', on);
                btn.classList.toggle('dark:border-blue-700', on);
                btn.classList.toggle('text-gray-400', !on);
            };

            let lastKnownLatLng = null;
            let userMarker = null;
            let userRadius = null;
            let isManualLocate = false;
            const pulsingIcon = L.divIcon({
                className: 'custom-div-icon',
                html: '<div class="gps-pulse"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            const locateBtn = document.getElementById('custom-locate-btn');
            const locateIcon = locateBtn ? locateBtn.querySelector('svg') : null;

            tripMapInstance.on('locationfound', (e) => {
                lastKnownLatLng = e.latlng;
                const radius = e.accuracy / 2;
                if (!userMarker) {
                    userMarker = L.marker(e.latlng, { icon: pulsingIcon, zIndexOffset: 1000 }).addTo(tripMapInstance)
                        .bindPopup(`<div class="text-xs font-bold text-center text-gray-900">You are here<br><span class="text-[10px] text-gray-500 font-normal">Within ${Math.round(radius)} meters</span></div>`);
                    userRadius = L.circle(e.latlng, radius, {
                        color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 1
                    }).addTo(tripMapInstance);
                } else {
                    userMarker.setLatLng(e.latlng);
                    userRadius.setLatLng(e.latlng);
                    userRadius.setRadius(radius);
                }
                if (locateIcon) {
                    locateIcon.classList.remove('animate-spin', 'text-gray-400');
                    locateIcon.classList.add('text-blue-600', 'dark:text-blue-400');
                }
                if (isManualLocate) {
                    tripMapInstance.flyTo(e.latlng, 15, { duration: 1.5 });
                    isManualLocate = false;
                }
            });

            tripMapInstance.on('locationerror', (e) => {
                if (locateIcon) {
                    locateIcon.classList.remove('animate-spin', 'text-blue-600', 'dark:text-blue-400');
                    locateIcon.classList.add('text-gray-400');
                }
                if (e.code !== 1) console.warn('Location error:', e.message);
            });

            tripMapInstance.locate({ setView: false, watch: true, enableHighAccuracy: true });

            if (locateBtn) {
                locateBtn.onclick = () => {
                    triggerHaptic();
                    if (lastKnownLatLng) {
                        tripMapInstance.flyTo(lastKnownLatLng, 15, { duration: 1.5 });
                    } else {
                        if (locateIcon) {
                            locateIcon.classList.remove('text-gray-400');
                            locateIcon.classList.add('animate-spin', 'text-blue-600', 'dark:text-blue-400');
                        }
                        isManualLocate = true;
                        tripMapInstance.locate({ setView: false, enableHighAccuracy: true, maxZoom: 15 });
                    }
                };
            }

            const updateTooltipSize = () => {
                const zoom = tripMapInstance.getZoom();
                document.querySelectorAll('.tooltip-dynamic').forEach((t) => {
                    t.style.opacity = zoom < 11 ? '0' : '1';
                });
                if (zoom >= 11 && zoom < 13) {
                    document.querySelectorAll('.minor-station-tooltip').forEach((t) => { t.style.opacity = '0'; });
                }
            };
            tripMapInstance.on('zoomend', updateTooltipSize);
            updateTooltipSize();

            const timesBtn = document.getElementById('trip-map-times-toggle');
            if (timesBtn) {
                paintTimesBtn(timesBtn);
                timesBtn.onclick = () => {
                    if (typeof triggerHaptic === 'function') triggerHaptic();
                    tripMapShowStationTimes = !tripMapShowStationTimes;
                    paintTimesBtn(timesBtn);
                    drawRouteElements();
                    updateTooltipSize();
                };
            }
        } catch (e) {
            console.error('Map Init Error:', e);
            showToast('Could not open live map.', 'error');
        } finally {
            window._isMapInitializing = false;
        }
    }, 350);
}

// --- TIMELINE BUILDER VIEW ENGINE ---

export const PlannerRenderer = {
    isMidnightRollover: () => {
        if (typeof currentPlannerStatus !== 'undefined' && currentPlannerStatus === 'ALL_DEPARTED') return false;

        const isToday = (!selectedPlannerDay || selectedPlannerDay === getCurrentDayType());
        if (!isToday || currentTripOptions.length === 0) return false;
        
        const nowSec = timeToSeconds(getCurrentTime());
        let latestDep = 0;
        currentTripOptions.forEach(t => {
            const sec = timeToSeconds(t.depTime);
            if (sec > latestDep) latestDep = sec;
        });
        
        return nowSec > latestDep;
    },

    format12h: (timeStr) => {
        if (!timeStr) return "--:--";
        const [h, m] = timeStr.split(':');
        let hour = parseInt(h, 10);
        const suffix = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12 || 12;
        return `${hour}:${m} ${suffix}`;
    },

    formatDuration: (totalMinutes) => {
        if (totalMinutes < 60) return `${totalMinutes} min`;
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
    },

    applyUIIntercepts: (stationName) => {
        if (!stationName) return "";
        let name = stationName.replace(' STATION', '').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
        const upper = name.toUpperCase();
        if (upper === 'ELANDSFONTEIN' || upper === 'RHODESFIELD') {
            return 'Kempton Park';
        }
        return name;
    },

    buildTransferBadge: ({ opacity = '', title, waitStr, connectLabel = 'Connect To', connectValue, variant = 'transfer' }) => {
        let iconBg = 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400';
        let titleColor = 'text-blue-600 dark:text-blue-400';
        let waitColor = 'text-gray-900 dark:text-white';
        let leftBorder = 'border-l-blue-500';
        let centerSvg = `<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        if (variant === 'extended') {
            iconBg = 'bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400';
            titleColor = 'text-orange-600 dark:text-orange-400';
            waitColor = 'text-orange-600 dark:text-orange-400';
            leftBorder = 'border-l-orange-500';
            centerSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
        } else if (variant === 'instant') {
            iconBg = 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400';
            titleColor = 'text-emerald-600 dark:text-emerald-400';
            waitColor = 'text-emerald-600 dark:text-emerald-400';
            leftBorder = 'border-l-emerald-500';
            centerSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
        }
        const rightCol = connectValue ? `
        <div class="flex flex-col items-end text-right min-w-0 flex-1 pl-2">
            <span class="text-[8px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider leading-none mb-1">${connectLabel}</span>
            <span class="font-bold text-[10px] text-blue-600 dark:text-blue-400 leading-tight truncate w-full" title="${connectValue}">${connectValue}</span>
        </div>` : '';
        return `
        <div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2 ${opacity}">
            <div class="relative py-2 z-20 w-full">
                <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 ${leftBorder} p-2.5 flex items-center justify-between w-[calc(100%+2px)] -ml-[2px] shadow-md">
                    <div class="flex items-center min-w-0 pr-3">
                        <div class="w-8 h-8 rounded-full ${iconBg} flex items-center justify-center shrink-0 mr-2.5 shadow-sm">${centerSvg}</div>
                        <div class="flex flex-col items-start min-w-0">
                            <span class="flex items-center text-[8px] font-black ${titleColor} uppercase tracking-widest leading-none mb-1 truncate w-full" title="${title}">${title}</span>
                            <span class="font-bold text-[11px] ${waitColor} leading-none truncate">${waitStr} Wait</span>
                        </div>
                    </div>
                    ${rightCol}
                </div>
            </div>
        </div>`;
    },

    renderLegTimeline: (leg, fromStation, toStation, legId, isFinalDest = false, renderedAlerts = new Set(), initialSevered = false) => {
        const formatStation = (s) => PlannerRenderer.applyUIIntercepts(s);
        let trainDest = formatStation(leg.actualDestination || leg.route.destB);
        
        // --- THE UNIFIED SUB-LEG RENDERER ---
        const renderSubLeg = (stops, subFrom, subTo, subLegId, subIsFinalDest, subTrain, subTrainDest, subInitialSevered) => {
            const fullValidStops = stops.filter(s => s.time !== "---");
            const disruptions = resolveTripDisruptions(leg.route.id, fullValidStops);
            let isSevered = subInitialSevered;
            let html = '';

            const getInjectionHtml = (idx) => {
                let inj = '';
                disruptions.filter(d => d.triggerStopIndex === idx).forEach(d => {
                    if (renderedAlerts.has(d.id)) return;
                    renderedAlerts.add(d.id);
                    
                    const cleanStr = (s) => s ? s.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
                    const safeBtnText = d.buttonText ? cleanStr(d.buttonText) : (d.tier === 'CRITICAL' ? 'Advisory' : 'Read Advisory');
                    
                    let locationText = "Route-Wide Advisory";
                    if (d.stations && d.stations.length >= 2) {
                        locationText = `Between ${cleanStr(d.stations[0].replace(' STATION', ''))} & ${cleanStr(d.stations[1].replace(' STATION', ''))}`;
                    } else if (d.stations && d.stations.length === 1) {
                        locationText = `At ${cleanStr(d.stations[0].replace(' STATION', ''))}`;
                    } else if (d.routeId && typeof ROUTES !== 'undefined' && ROUTES[d.routeId]) {
                        const r = ROUTES[d.routeId];
                        locationText = `Between ${cleanStr(r.destA.replace(' STATION', ''))} & ${cleanStr(r.destB.replace(' STATION', ''))}`;
                    }

                    if (d.tier === 'CRITICAL') {
                        const justSevered = !isSevered;
                        isSevered = true; 
                        
                        window._trackedSeverances = window._trackedSeverances || new Set();
                        if (justSevered && !window._trackedSeverances.has(d.id)) {
                            window._trackedSeverances.add(d.id);
                            if (typeof trackAnalyticsEvent === 'function') {
                                trackAnalyticsEvent('planner_trip_severed', { 
                                    origin: fromStation.replace(/ STATION/gi, ''),
                                    destination: toStation.replace(/ STATION/gi, ''),
                                    disruption_id: d.id, 
                                    route_id: leg.route.id 
                                });
                            }
                        }

                        // Compact terminus marker only — LINE SEVERED details live in the top warning.
                        if (!justSevered) return;
                        const termStationName = cleanStr(fullValidStops[idx].station.replace(' STATION', '')).toUpperCase();
                        inj += `
                            <div class="relative my-3 z-20 w-full flex items-center gap-2 pointer-events-none select-none" aria-hidden="false" role="status">
                                <div class="flex-1 border-t border-red-200 dark:border-red-900/60" aria-hidden="true"></div>
                                <span class="font-black uppercase tracking-widest text-[10px] text-red-700 dark:text-red-400 inline-flex items-center gap-1.5 shrink-0">
                                    ${plannerIcon('stop', 'w-3.5 h-3.5')} TRAIN TERMINATES @ ${termStationName}
                                </span>
                                <div class="flex-1 border-t border-red-200 dark:border-red-900/60" aria-hidden="true"></div>
                            </div>
                        `;
                    } else {
                        const linkSvg = `<svg class="w-3 h-3 mr-1 text-gray-400 dark:text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
                        
                        // Existing WARNING mid-timeline advisory only — thinner sibling of shared warning notice.
                        inj += `
                            <div class="relative py-2 z-20 w-full">
                                <button type="button" onclick="if(typeof window.openDisruptionModal === 'function') window.openDisruptionModal('${d.id}')" class="w-full text-left rounded-lg border border-amber-200/90 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/30 px-2.5 py-2 flex items-center justify-between gap-2 shadow-sm hover:border-amber-300 dark:hover:border-amber-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
                                    <div class="flex flex-col items-start min-w-0 pr-1">
                                        <span class="text-amber-800 dark:text-amber-300 font-black uppercase tracking-wide text-[10px] leading-none mb-1 flex items-center gap-1">
                                            ${plannerIcon('alert', 'w-3.5 h-3.5')} Expect Delays
                                        </span>
                                        <div class="text-gray-500 dark:text-gray-400 leading-snug flex items-center min-w-0 w-full">
                                            ${linkSvg} <span class="font-medium text-[9px] truncate">${locationText}</span>
                                        </div>
                                    </div>
                                    <span class="bg-gray-800 dark:bg-gray-700 text-gray-100 dark:text-white px-2.5 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider shrink-0 truncate max-w-[110px]">${safeBtnText}</span>
                                </button>
                            </div>
                        `;
                    }
                });
                return inj;
            };

            const isFirstOrigin = subLegId.includes('direct') || subLegId.includes('leg1') || subLegId.includes('l1-');
            const depDotClass = isSevered ? "bg-gray-400 opacity-70 w-3 h-3 -left-[7px] top-1.5" : 
                                (isFirstOrigin ? "bg-green-500 ring-4 ring-green-100 dark:ring-green-900 w-4 h-4 -left-[9px] top-0" : "bg-blue-500 w-3 h-3 -left-[7px] top-1.5");
            const depTextClass = isSevered ? "text-gray-400 dark:text-gray-600 opacity-70" : "text-gray-900 dark:text-white";
            const depTrainClass = isSevered ? "text-gray-400 opacity-70" : "text-blue-500";
            
            html += `
                <div class="relative pl-6 pb-2 border-l-2 border-gray-300 dark:border-gray-600 ml-2">
                    <div class="absolute rounded-full ${depDotClass}"></div>
                    <div class="flex flex-col">
                        <div class="flex justify-between items-center mb-1">
                            <span class="font-bold ${depTextClass} text-sm">Depart ${subFrom.replace(' STATION', '')}</span>
                            <span class="font-mono font-bold ${depTextClass} text-sm">${formatTimeDisplay(stops[0].time)}</span>
                        </div>
                        <div class="text-xs ${depTrainClass} font-medium mb-1">
                            ${subTrainDest} Train ${subTrain}
                        </div>
                    </div>
                </div>
            `;
                    
            html += getInjectionHtml(0) ? `<div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2">${getInjectionHtml(0)}</div>` : '';

            const intermediateStops = fullValidStops.slice(1, -1);
            if (intermediateStops.length > 0) {
                let innerHtml = '';
                for (let idx = 0; idx < intermediateStops.length; idx++) {
                    const stop = intermediateStops[idx];
                    const globalIdx = idx + 1; 
                    
                    // GUARDIAN FIX: Dynamic CSS variables for greyed-out state flow
                    let textClass = isSevered ? "text-gray-400 dark:text-gray-500 opacity-50 grayscale" : "text-gray-700 dark:text-gray-300 font-medium";
                    let dotClass = isSevered ? "bg-gray-300 dark:bg-gray-700 opacity-50 grayscale" : "bg-blue-500 border-2 border-white dark:border-gray-800";
                    
                    innerHtml += `
                        <div class="flex justify-between text-xs py-1.5 relative pl-5">
                            <div class="absolute -left-[5px] top-2 w-3 h-3 rounded-full ${dotClass}"></div>
                            <span class="${textClass}">${stop.station.replace(' STATION', '')}</span>
                            <span class="font-mono ${textClass}">${formatTimeDisplay(stop.time)}</span>
                        </div>
                    `;
                    
                    const injHtml = getInjectionHtml(globalIdx);
                    if (injHtml) innerHtml += injHtml;
                    
                    // GUARDIAN FIX: Removed timeline truncation (break;) to allow visual fracture flow
                }
                
                const hasCritical = disruptions.some(d => d.tier === 'CRITICAL');
                const isExpanded = plannerExpandedState.has(subLegId) || hasCritical;
                
                // Keep the border intact, let individual stops handle their own greyness
                html += `
                    <div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2">
                        <button id="btn-${subLegId}" onclick="if(typeof window.togglePlannerStops === 'function') window.togglePlannerStops('${subLegId}')" class="text-[10px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 px-3 py-1 rounded-full transition-colors mb-2 w-fit ml-5 -mt-1 relative top-[-5px] focus:outline-none">
                            ${isExpanded ? 'Hide Stops' : 'Show All Stops'}
                        </button>
                        <div id="${subLegId}" class="${isExpanded ? "" : "hidden"} space-y-1 pb-2">${innerHtml}</div>
                    </div>
                `;
            } else {
                html += `<div class="border-l-2 border-gray-300 dark:border-gray-600 ml-2 h-4"></div>`;
            }

            // GUARDIAN FIX: Removed `if (!isSevered)` wrapper so the final destination always renders
            const arrGlobalIdx = fullValidStops.length - 1;
            const isEndDot = subIsFinalDest && !isSevered;
            const arrDotClass = isSevered ? "bg-gray-300 dark:bg-gray-700 w-3 h-3 -left-[7px] top-1.5 opacity-50 grayscale" : 
                                (isEndDot ? "bg-red-500 ring-4 ring-red-100 dark:ring-red-900 w-4 h-4 -left-[9px] top-0" : "bg-blue-500 w-3 h-3 -left-[7px] top-1.5");
            const arrTextClass = isSevered ? "text-gray-400 dark:text-gray-500 opacity-50 grayscale font-bold" : "text-gray-900 dark:text-white font-bold";
            const arrBorderClass = subIsFinalDest ? "border-l-2 border-transparent" : "border-l-2 border-gray-300 dark:border-gray-600";
            
            let arrLabel = subIsFinalDest ? subTo.replace(' STATION', '') : 'Arrive ' + subTo.replace(' STATION', '');
            if (isSevered) {
                arrLabel = `${subTo.replace(' STATION', '')}`;
            }

            html += `
                <div class="relative pl-6 ${arrBorderClass} ml-2 pb-2">
                    <div class="absolute rounded-full ${arrDotClass}"></div>
                    <div class="flex justify-between items-center mb-1">
                        <span class="${arrTextClass} text-sm">${arrLabel}</span>
                        <span class="font-mono ${arrTextClass} text-sm">${formatTimeDisplay(fullValidStops[arrGlobalIdx].time)}</span>
                    </div>
                </div>
            `;
            
            const finalInj = getInjectionHtml(arrGlobalIdx);
            if (finalInj) html += `<div class="${subIsFinalDest ? 'border-l-2 border-transparent' : 'border-l-2 border-gray-300 dark:border-gray-600'} ml-2">${finalInj}</div>`;

            // Partial journeys alight at the disruption boundary — isTripSevered treats that
            // as "safe", so the mid-timeline CRITICAL injection never fires. Force the
            // TRAIN TERMINATES block so users still see the hard stop at the partial dest.
            const forcePartialTerminus = subIsFinalDest
                && !isSevered
                && (
                    currentPlannerStatus === 'PARTIAL_JOURNEY'
                    || !!(typeof window !== 'undefined' && window._plannerForcePartialTerminus)
                );
            if (forcePartialTerminus) {
                const termStationName = String(
                    (currentPlannerErrorPayload && currentPlannerErrorPayload.partialDest) || subTo || ''
                ).replace(/ STATION/gi, '').replace(/</g, '&lt;').replace(/>/g, '&gt;').toUpperCase();
                html += `
                    <div class="relative my-3 z-20 w-full flex items-center gap-2 pointer-events-none select-none" role="status">
                        <div class="flex-1 border-t border-red-200 dark:border-red-900/60" aria-hidden="true"></div>
                        <span class="font-black uppercase tracking-widest text-[10px] text-red-700 dark:text-red-400 inline-flex items-center gap-1.5 shrink-0">
                            ${plannerIcon('stop', 'w-3.5 h-3.5')} TRAIN TERMINATES @ ${termStationName}
                        </span>
                        <div class="flex-1 border-t border-red-200 dark:border-red-900/60" aria-hidden="true"></div>
                    </div>
                `;
            }

            return { html, isSevered };
        };

        if (leg.isRelayComposite && leg.internalTransfer) {
            const it = leg.internalTransfer;
            const sName = formatStation(it.station.replace(' STATION', ''));
            const waitStr = PlannerRenderer.formatDuration(Math.floor(it.wait / 60));
            
            const transferIndex = leg.stops.findIndex(s => normalizeStationName(s.station) === normalizeStationName(it.station));
            const stopsBefore = transferIndex !== -1 ? leg.stops.slice(0, transferIndex + 1) : [];
            const stopsAfter = transferIndex !== -1 ? leg.stops.slice(transferIndex + 1) : leg.stops;

            let train1Dest = `To ${sName}`;
            let train2Dest = trainDest;

            const leg1 = renderSubLeg(stopsBefore, fromStation, sName, `${legId}-A`, false, it.train1, train1Dest, initialSevered);
            let combinedHtml = leg1.html;

            const transferOpacity = leg1.isSevered ? "opacity-50 grayscale" : "";
            const waitMins = Math.floor(it.wait / 60);
            const isExtended = waitMins >= 240;
            const isInstant = waitMins === 0;

            let bridgeTitle = 'INTERNAL TRANSFER';
            const transferVariant = isExtended ? 'extended' : (isInstant ? 'instant' : 'transfer');
            if (isExtended) bridgeTitle = 'EXTENDED LAYOVER';
            else if (isInstant) bridgeTitle = 'INSTANT TRANSFER';

            combinedHtml += PlannerRenderer.buildTransferBadge({
                opacity: transferOpacity,
                title: `${bridgeTitle} @ ${sName}`,
                waitStr,
                connectLabel: 'Switch To',
                connectValue: `${train2Dest} Train ${it.train2}`,
                variant: transferVariant
            });

            const leg2 = renderSubLeg(stopsAfter, sName, toStation, `${legId}-B`, isFinalDest, it.train2, train2Dest, leg1.isSevered);
            combinedHtml += leg2.html;
            
            return { html: combinedHtml, isSevered: leg2.isSevered };
        } else {
            return renderSubLeg(leg.stops, fromStation, toStation, legId, isFinalDest, leg.train, trainDest, initialSevered);
        }
    },

    /** Line Severed / Expect Delays / Long Layover — attached when multiple. */
    buildTripAdvisoryStack: (step, leadingNotices = []) => {
        let activeDisr = null;

        if (typeof window !== 'undefined' && typeof window.getTripDisruptions === 'function') {
            const checkStops = (stops, routeId) => {
                const disr = window.getTripDisruptions(routeId, stops);
                if (disr.some(d => d.tier === 'CRITICAL')) activeDisr = disr.find(d => d.tier === 'CRITICAL');
                else if (disr.some(d => d.tier === 'WARNING') && !activeDisr) activeDisr = disr.find(d => d.tier === 'WARNING');
            };

            if (step.type === 'DIRECT') checkStops(step.stops, step.route.id);
            else if (step.type === 'TRANSFER') { checkStops(step.leg1.stops, step.leg1.route.id); checkStops(step.leg2.stops, step.leg2.route.id); }
            else if (step.type === 'DOUBLE_TRANSFER') { checkStops(step.leg1.stops, step.leg1.route.id); checkStops(step.leg2.stops, step.leg2.route.id); checkStops(step.leg3.stops, step.leg3.route.id); }
            else if (step.type === 'MULTI_TRANSFER' && step.legs) { step.legs.forEach(l => checkStops(l.stops, l.route.id)); }
        }

        if (typeof currentPlannerStatus !== 'undefined' && currentPlannerStatus === 'PARTIAL_JOURNEY' && currentPlannerErrorPayload) {
            const partialTerminus = currentPlannerErrorPayload.partialDest;
            if (partialTerminus) {
                try {
                    const normTerminus = normalizeStationName(partialTerminus);
                    const globalList = Object.values($globalDisruptions.get() || {}).flat();
                    const criticalSeverance = globalList.find(d =>
                        d.tier === 'CRITICAL'
                        && d.stations
                        && d.stations.map(s => normalizeStationName(s)).includes(normTerminus)
                    );
                    if (criticalSeverance) activeDisr = criticalSeverance;
                } catch { /* ignore */ }
            }
        }

        let lineSeveredNotice = '';
        if (currentPlannerStatus === 'PARTIAL_JOURNEY' && currentPlannerErrorPayload) {
            lineSeveredNotice = buildLineSeveredNoticeHtml(currentPlannerErrorPayload, step.to);
        }

        let alertBanner = '';
        if (activeDisr && activeDisr.tier !== 'CRITICAL') {
            const disrId = activeDisr.id || '';
            const onclickAttr = disrId
                ? `type="button" onclick="if(typeof window.openDisruptionModal === 'function') window.openDisruptionModal('${String(disrId).replace(/'/g, "\\'")}')"`
                : null;
            alertBanner = buildPlannerNotice({
                tone: 'warning',
                title: 'Expect Delays',
                bodyHtml: `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Minor service delays on this corridor.</p>`,
                icon: 'alert',
                interactive: onclickAttr ? { onclickAttr, detailsLabel: 'Details' } : null,
            });
        }

        let layoverBanner = '';
        let maxWaitMins = 0;
        let hubName = '';
        const checkLayover = (arr, dep, hub) => {
            let wait = Math.floor((timeToSeconds(dep) - timeToSeconds(arr)) / 60);
            if (wait < 0) wait += 14400;
            if (wait > maxWaitMins) { maxWaitMins = wait; hubName = hub; }
        };
        if (step.type === 'TRANSFER') checkLayover(step.leg1.arrTime, step.leg2.depTime, step.transferStation);
        if (step.type === 'DOUBLE_TRANSFER') { checkLayover(step.leg1.arrTime, step.leg2.depTime, step.hub1); checkLayover(step.leg2.arrTime, step.leg3.depTime, step.hub2); }
        if (step.type === 'MULTI_TRANSFER' && step.legs) {
            for (let i = 0; i < step.legs.length - 1; i++) checkLayover(step.legs[i].arrTime, step.legs[i + 1].depTime, step.legs[i].to);
        }
        if (maxWaitMins >= 240) {
            const waitStr = PlannerRenderer.formatDuration(maxWaitMins);
            const hubLabel = escapeHTML(PlannerRenderer.applyUIIntercepts(hubName));
            layoverBanner = buildPlannerNotice({
                tone: 'layover',
                title: 'Long Layover',
                bodyHtml: `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">This trip includes a <span class="text-orange-700 dark:text-orange-300">${escapeHTML(waitStr)}</span> wait at <span class="font-bold text-gray-800 dark:text-gray-200">${hubLabel}</span>.</p>`,
                icon: 'alert',
            });
        }

        return stackPlannerNotices(...leadingNotices, lineSeveredNotice, alertBanner, layoverBanner);
    },

    buildCard: (step, isNextDay, allOptions, selectedIndex, leadingNotices = []) => {
        return `
            <div class="bg-transparent overflow-visible flex flex-col">
                ${PlannerRenderer.buildTripAdvisoryStack(step, leadingNotices)}
                ${PlannerRenderer.renderHeader(step, isNextDay)}
                ${PlannerRenderer.renderOptionsSelector(allOptions, selectedIndex, isNextDay)}
                <div class="py-3 flex-grow overflow-visible">
                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 pl-1 border-b border-gray-100 dark:border-gray-800 pb-1">Journey Timeline</p>
                    ${PlannerRenderer.renderTimeline(step)}
                </div>
                <button onclick="if(typeof window.extractTripCoordinates === 'function') window.extractTripCoordinates(${selectedIndex})" class="w-full bg-blue-50/50 hover:bg-blue-100 hover:shadow-md active:scale-[0.99] dark:bg-gray-800 dark:hover:bg-gray-700 text-blue-600 dark:text-blue-400 font-bold py-3 text-xs rounded-lg transition-colors flex items-center justify-center focus:outline-none mt-2 uppercase tracking-wide border border-blue-200 dark:border-gray-600 shadow-sm">
                    <svg class="w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg>
                    View Trip Plan on Map
                </button>
            </div>
        `;
    },

    renderHeader: (step, isNextDay) => {
        let transferCount = 0;
        if (step.type === 'MULTI_TRANSFER') {
            transferCount = step.legs ? step.legs.length - 1 : (step.transferCount || 3);
            if (step.legs) {
                step.legs.forEach(leg => { if (leg.isRelayComposite) transferCount += 1; });
            }
        } else {
            transferCount = step.type === 'DOUBLE_TRANSFER' ? 2 : (step.type === 'TRANSFER' ? 1 : 0);
            if (step.leg1 && step.leg1.isRelayComposite) transferCount += 1;
            if (step.leg2 && step.leg2.isRelayComposite) transferCount += 1;
            if (step.leg3 && step.leg3.isRelayComposite) transferCount += 1;
        }

        const colorClass = transferCount > 0 ? 'text-yellow-600 dark:text-yellow-400' : (isNextDay ? 'text-orange-600 dark:text-orange-400' : 'text-blue-600 dark:text-blue-400');
        
        let headerLabel = 'Direct Trip';
        if (transferCount === 1) headerLabel = 'Transfer Trip';
        else if (transferCount >= 2) headerLabel = `Bridge Trip (${transferCount} Transfers)`;
        if (isNextDay) headerLabel = 'Future Trip';

        const { countdown, duration, isDeparted } = PlannerRenderer.calculateTimes(step, isNextDay);

        let stateBadge = "";
        
        if (isNextDay) {
             const dayShown = step.dayLabel ? compactPlannerDayLabel(step.dayLabel, step) : 'Tomorrow';
             const dynamicDayText = `Departure: ${escapeHTML(String(dayShown))}`;
             stateBadge = `<div class="flex items-center text-sm font-bold text-orange-600 dark:text-orange-400">
                            <svg class="w-4 h-4 mr-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            ${dynamicDayText}
                          </div>`;
        } else if (isDeparted) {
            // 🛡️ GUARDIAN UX FIX: Removed w-full, shrunk button, and added whitespace-nowrap to stop text squishing
            stateBadge = `
                <div class="flex flex-col items-start mt-1 sm:mt-0 pr-2 min-w-0">
                    <div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                        ${countdown}
                    </div>
                    <button onclick="if(typeof window._plannerCurrentTripIndex !== 'undefined' && typeof window._selectCustomTrip === 'function') window._selectCustomTrip(window._plannerCurrentTripIndex + 1);" class="bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 font-bold py-1.5 px-3 rounded-lg shadow-sm transition-colors focus:outline-none flex justify-center items-center text-[9px] uppercase tracking-wider whitespace-nowrap">
                        Show Next Train <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"></path></svg>
                    </button>
                </div>
            `;
        } else {
            stateBadge = `<div class="flex items-center text-sm font-bold text-blue-600 dark:text-blue-400">
                            <svg class="w-4 h-4 mr-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            <span>${countdown}</span>
                          </div>`;
        }

        return `
            <div class="pb-4 mb-2 border-b border-gray-100 dark:border-gray-800 bg-transparent">
                <div class="flex items-center justify-start mb-3">
                    <span class="text-[10px] font-black ${colorClass} uppercase tracking-widest">${headerLabel}</span>
                </div>
                <div class="flex justify-between items-center">
                    <div class="text-left flex-1 w-0 pr-2">
                        <p class="text-[9px] text-gray-500 uppercase font-black tracking-widest">Depart</p>
                        <p class="text-base sm:text-lg font-black text-gray-900 dark:text-white leading-tight tracking-tight mt-0.5 break-words" title="${step.from}">${step.from}</p>
                        <p class="text-lg font-black ${colorClass} mt-1">${PlannerRenderer.format12h(step.depTime)}</p>
                    </div>
                    
                    <button onclick="if(typeof window.swapPlannerResults === 'function') window.swapPlannerResults()" class="flex-none p-1.5 bg-gray-50 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 transition focus:outline-none shrink-0 border border-gray-200 dark:border-gray-700" title="Reverse Trip">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
                    </button>

                    <div class="text-right flex-1 w-0 pl-2">
                        <p class="text-[9px] text-gray-500 uppercase font-black tracking-widest">Arrive</p>
                        <p class="text-base sm:text-lg font-black text-gray-900 dark:text-white leading-tight tracking-tight mt-0.5 break-words" title="${step.to}">${step.to}</p>
                        <p class="text-lg font-black ${colorClass} mt-1">${PlannerRenderer.format12h(step.arrTime)}</p>
                    </div>
                </div>
                <div class="flex justify-between items-start mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                     ${stateBadge}
                     <div class="flex flex-col items-end text-right shrink-0 pl-2">
                        <div class="flex items-center text-xs font-bold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            <svg class="w-3.5 h-3.5 mr-1 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3h14M5 21h14M7 3v2.5c0 .8.4 1.6 1.1 2.1L12 10.5l3.9-2.9c.7-.5 1.1-1.3 1.1-2.1V3M7 21v-2.5c0-.8.4-1.6 1.1-2.1l3.9-2.9 3.9 2.9c.7.5 1.1 1.3 1.1 2.1V21"/></svg>
                            ${duration}
                        </div>
                        <div class="text-[9px] text-gray-400 uppercase tracking-widest mt-0.5">Total Time</div>
                     </div>
                </div>
            </div>
        `;
    },

    renderOptionsSelector: (allOptions, selectedIndex, isNextDay) => {
        if (!allOptions || allOptions.length === 0) return '';
        const nowSec = timeToSeconds(getCurrentTime());
        const isToday = (!selectedPlannerDay || selectedPlannerDay === getCurrentDayType());
        const midnightRollover = PlannerRenderer.isMidnightRollover();

        let selectedText = "";

        const optionsHtml = allOptions.map((opt, idx) => {
            const depSec = timeToSeconds(opt.depTime);
            // GUARDIAN PHASE 14: If it's a future day, it's never "past" compared to today's clock
            let isPast = isToday && !midnightRollover && !opt.dayLabel && (depSec < nowSec);
            let label = "";
            
            // GUARDIAN V7: Accurately count composite relays and Dijkstra legs
            let transferCount = 0;
            if (opt.type === 'MULTI_TRANSFER') {
                transferCount = opt.legs ? opt.legs.length - 1 : (opt.transferCount || 3);
                if (opt.legs) {
                    opt.legs.forEach(leg => { if (leg.isRelayComposite) transferCount += 1; });
                }
            } else {
                transferCount = opt.type === 'DOUBLE_TRANSFER' ? 2 : (opt.type === 'TRANSFER' ? 1 : 0);
                if (opt.leg1 && opt.leg1.isRelayComposite) transferCount += 1;
                if (opt.leg2 && opt.leg2.isRelayComposite) transferCount += 1;
                if (opt.leg3 && opt.leg3.isRelayComposite) transferCount += 1;
            }

            let typeLabel = transferCount === 0 ? "Direct" : `${transferCount} Transfer${transferCount > 1 ? 's' : ''}`;
            
            // GUARDIAN PHASE 14: Dynamic future label injection (compact on narrow screens)
            if (opt.dayLabel) {
                label = ` (${compactPlannerDayLabel(opt.dayLabel, opt)})`;
            } else if (midnightRollover) {
                label = " (Tomorrow)";
            }
            
            // Formatted explicitly as "08:59 ➔ 10:30 [1 Transfer]"
            const text = `${formatTimeDisplay(opt.depTime)} ➔ ${formatTimeDisplay(opt.arrTime)} [${typeLabel}]${label}`;
            const isSelected = (idx === selectedIndex);
            
            if (isSelected) {
                selectedText = text;
            }

            // GUARDIAN PHASE 6: Dynamic legibility inversion for active trip
            return `
                <li onclick="if(typeof window._selectCustomTrip === 'function') window._selectCustomTrip(${idx})" class="p-3.5 border-b border-gray-100 dark:border-gray-700 cursor-pointer text-sm sm:text-base font-medium transition-colors ${isSelected ? 'bg-blue-600 text-white hover:bg-blue-700 border-transparent' : 'hover:bg-blue-50 dark:hover:bg-gray-700 ' + (isPast ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200')}">
                    ${text}
                </li>
            `;
        }).join('');

        return `
            <div class="pb-3 relative border-b border-gray-100 dark:border-gray-800 mb-2" id="custom-time-dropdown-container">
                <style>
                    @keyframes gentleRingPulse {
                        0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
                        50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25); }
                    }
                    .planner-gentle-pulse {
                        animation: gentleRingPulse 1.5s ease-in-out 4; /* Stops gracefully after 6 seconds */
                    }
                </style>
                <label class="text-[9px] uppercase font-black text-gray-400 mb-1.5 block tracking-widest pl-1">Departure Time</label>
                <div onclick="this.classList.remove('planner-gentle-pulse'); if(typeof window._toggleCustomTimeDropdown === 'function') window._toggleCustomTimeDropdown(event)" class="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm rounded-lg p-3 focus:outline-none font-bold shadow-sm cursor-pointer flex justify-between items-center transition-colors hover:border-blue-400 group planner-gentle-pulse">
                    <span id="custom-time-display" class="truncate pr-2">${selectedText}</span>
                    <svg class="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0 transform transition-transform" id="custom-time-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
                <ul id="custom-time-list" class="absolute z-[200] w-full left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-h-64 overflow-y-auto hidden mt-1 custom-scrollbar flex flex-col text-left">
                    ${optionsHtml}
                </ul>
            </div>
        `;
    },

    renderInstruction: (step) => `
        <div class="py-2 mb-2 border-b border-gray-100 dark:border-gray-800">
            <div class="flex items-start bg-blue-50/50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-800/50">
                <svg class="w-4 h-4 mr-2 mt-0.5 text-blue-500 dark:text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                <p class="text-xs text-gray-700 dark:text-gray-300 leading-snug">
                    <b>Instruction:</b><br> 
                    Take train <b>${step.train}</b> on the <b>${step.route.name}</b> line.
                </p>
            </div>
        </div>
    `,

    renderTimeline: (step) => {
        const renderedAlerts = new Set();
        
        if (step.type === 'TRANSFER') return PlannerRenderer.renderTransferTimeline(step, renderedAlerts);
        if (step.type === 'DOUBLE_TRANSFER') return PlannerRenderer.renderDoubleTransferTimeline(step, renderedAlerts);
        if (step.type === 'MULTI_TRANSFER') return PlannerRenderer.renderMultiTransferTimeline(step, renderedAlerts);
        
        return `
            <div class="mt-4 ml-0 space-y-0">
                ${PlannerRenderer.renderLegTimeline(step, step.from, step.to, `stops-direct-${step.train}`, true, renderedAlerts, false).html}
            </div>
        `;
    },

    renderMultiTransferTimeline: (step, renderedAlerts) => {
        if (!step.legs || step.legs.length === 0) return '';
        let html = '<div class="mt-4 ml-0 space-y-0">';

        let currentSevered = false;

        for (let i = 0; i < step.legs.length; i++) {
            const leg = step.legs[i];
            const isFinalDest = (i === step.legs.length - 1);
            const legId = `l${i+1}-${step.train}`;
            
            const legResult = PlannerRenderer.renderLegTimeline(leg, leg.from, leg.to, legId, isFinalDest, renderedAlerts, currentSevered);
            html += legResult.html;
            currentSevered = legResult.isSevered;

            if (!isFinalDest) {
                const nextLeg = step.legs[i+1];
                const arr = timeToSeconds(leg.arrTime);
                const dep = timeToSeconds(nextLeg.depTime);
                const waitMins = Math.floor((dep - arr) / 60);
                const waitStr = PlannerRenderer.formatDuration(waitMins);
                const hubName = PlannerRenderer.applyUIIntercepts(leg.to);
                const trainDest = PlannerRenderer.applyUIIntercepts(nextLeg.actualDestination || nextLeg.route.destB);

                const isExtended = waitMins >= 240; 
                if (isExtended && !renderedAlerts.has('excessive_layover')) {
                    renderedAlerts.add('excessive_layover');
                    if (typeof trackAnalyticsEvent === 'function') {
                        trackAnalyticsEvent('planner_excessive_layover', {
                            origin: step.from.replace(/ STATION/gi, ''),
                            destination: step.to.replace(/ STATION/gi, ''),
                            hub: hubName,
                            wait_mins: waitMins
                        });
                    }
                }

                const transferOpacity = currentSevered ? "opacity-50 grayscale" : "";
                const isInstant = waitMins === 0;
                let bridgeTitle = `TRANSFER ${i+1}`;
                if (isExtended) bridgeTitle = 'EXTENDED LAYOVER';
                else if (isInstant) bridgeTitle = `INSTANT TRANSFER ${i+1}`;

                html += PlannerRenderer.buildTransferBadge({
                    opacity: transferOpacity,
                    title: bridgeTitle,
                    waitStr,
                    connectLabel: 'Connect To',
                    connectValue: `${trainDest} Train ${nextLeg.train}`,
                    variant: isExtended ? 'extended' : (isInstant ? 'instant' : 'transfer')
                });
            }
        }

        html += '</div>';
        return html;
    },

    renderTransferTimeline: (step, renderedAlerts) => {
        const hubArr = timeToSeconds(step.leg1.arrTime);
        const hubDep = timeToSeconds(step.leg2.depTime);
        const waitMins = Math.floor((hubDep - hubArr) / 60);
        const waitStr = PlannerRenderer.formatDuration(waitMins);
        
        let train2Dest = PlannerRenderer.applyUIIntercepts(step.leg2.actualDestination || step.leg2.route.destB);

        const leg1Result = PlannerRenderer.renderLegTimeline(step.leg1, step.from, step.transferStation, `stops-leg1-${step.train}`, false, renderedAlerts, false);
        const transferOpacity = leg1Result.isSevered ? "opacity-50 grayscale" : "";

        const isExtended = waitMins >= 240; 
        if (isExtended && !renderedAlerts.has('excessive_layover')) {
            renderedAlerts.add('excessive_layover');
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_excessive_layover', {
                    origin: step.from.replace(/ STATION/gi, ''),
                    destination: step.to.replace(/ STATION/gi, ''),
                    hub: PlannerRenderer.applyUIIntercepts(step.transferStation),
                    wait_mins: waitMins
                });
            }
        }

        const isInstant = waitMins === 0;
        let bridgeTitle = 'TRANSFER REQUIRED';
        if (isExtended) bridgeTitle = 'EXTENDED LAYOVER';
        else if (isInstant) bridgeTitle = 'INSTANT TRANSFER';

        const standardTransferBlock = PlannerRenderer.buildTransferBadge({
            opacity: transferOpacity,
            title: bridgeTitle,
            waitStr,
            connectLabel: 'Connect To',
            connectValue: `${train2Dest} Train ${step.leg2.train}`,
            variant: isExtended ? 'extended' : (isInstant ? 'instant' : 'transfer')
        });

        const leg2Result = PlannerRenderer.renderLegTimeline(step.leg2, step.transferStation, step.to, `stops-leg2-${step.train}`, true, renderedAlerts, leg1Result.isSevered);

        return `
            <div class="mt-4 ml-0 space-y-0">
                ${leg1Result.html}
                ${standardTransferBlock}
                ${leg2Result.html}
            </div>
        `;
    },

    renderDoubleTransferTimeline: (step, renderedAlerts) => {
        const arr1 = timeToSeconds(step.leg1.arrTime);
        const dep2 = timeToSeconds(step.leg2.depTime);
        const wait1Mins = Math.floor((dep2 - arr1) / 60);
        const wait1Str = PlannerRenderer.formatDuration(wait1Mins);

        const arr2 = timeToSeconds(step.leg2.arrTime);
        const dep3 = timeToSeconds(step.leg3.depTime);
        const wait2Mins = Math.floor((dep3 - arr2) / 60);
        const wait2Str = PlannerRenderer.formatDuration(wait2Mins);

        const formatStation = (s) => PlannerRenderer.applyUIIntercepts(s);
        const hub1Name = formatStation(step.hub1);
        
        let train2Dest = formatStation(step.leg2.actualDestination || step.leg2.route.destB);
        let train3Dest = formatStation(step.leg3.actualDestination || step.leg3.route.destB);

        const leg1Result = PlannerRenderer.renderLegTimeline(step.leg1, step.from, step.hub1, `l1-${step.train}`, false, renderedAlerts, false);
        const transferOpacity1 = leg1Result.isSevered ? "opacity-50 grayscale" : "";

        const isExtended1 = wait1Mins >= 240; 
        if (isExtended1 && !renderedAlerts.has('excessive_layover')) {
            renderedAlerts.add('excessive_layover');
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_excessive_layover', {
                    origin: step.from.replace(/ STATION/gi, ''),
                    destination: step.to.replace(/ STATION/gi, ''),
                    hub: hub1Name,
                    wait_mins: wait1Mins
                });
            }
        }

        const isInstant1 = wait1Mins === 0;
        let bridgeTitle1 = 'TRANSFER 1';
        if (isExtended1) bridgeTitle1 = 'EXTENDED LAYOVER';
        else if (isInstant1) bridgeTitle1 = 'INSTANT TRANSFER 1';

        // FIX: transfer1 connects to train2 (not train3)
        const transferBlock1 = PlannerRenderer.buildTransferBadge({
            opacity: transferOpacity1,
            title: bridgeTitle1,
            waitStr: wait1Str,
            connectLabel: 'Connect To',
            connectValue: `${train2Dest} Train ${step.leg2.train}`,
            variant: isExtended1 ? 'extended' : (isInstant1 ? 'instant' : 'transfer')
        });

        const leg2Result = PlannerRenderer.renderLegTimeline(step.leg2, step.hub1, step.hub2, `l2-${step.train}`, false, renderedAlerts, leg1Result.isSevered);
        const transferOpacity2 = leg2Result.isSevered ? "opacity-50 grayscale" : "";

        const isExtended2 = wait2Mins >= 240; 
        if (isExtended2 && !renderedAlerts.has('excessive_layover')) {
            renderedAlerts.add('excessive_layover');
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_excessive_layover', {
                    origin: step.from.replace(/ STATION/gi, ''),
                    destination: step.to.replace(/ STATION/gi, ''),
                    hub: formatStation(step.hub2),
                    wait_mins: wait2Mins
                });
            }
        }

        const isInstant2 = wait2Mins === 0;
        let bridgeTitle2 = 'TRANSFER 2';
        if (isExtended2) bridgeTitle2 = 'EXTENDED LAYOVER';
        else if (isInstant2) bridgeTitle2 = 'INSTANT TRANSFER 2';

        const transferBlock2 = PlannerRenderer.buildTransferBadge({
            opacity: transferOpacity2,
            title: bridgeTitle2,
            waitStr: wait2Str,
            connectLabel: 'Connect To',
            connectValue: `${train3Dest} Train ${step.leg3.train}`,
            variant: isExtended2 ? 'extended' : (isInstant2 ? 'instant' : 'transfer')
        });

        const leg3Result = PlannerRenderer.renderLegTimeline(step.leg3, step.hub2, step.to, `l3-${step.train}`, true, renderedAlerts, leg2Result.isSevered);

        return `
            <div class="mt-4 ml-0 space-y-0">
                ${leg1Result.html}
                ${transferBlock1}
                ${leg2Result.html}
                ${transferBlock2}
                ${leg3Result.html}
            </div>
        `;
    },

    calculateTimes: (step, isNextDay) => {
        const nowSec = timeToSeconds(getCurrentTime());
        const depSec = timeToSeconds(step.depTime);
        const arrSec = timeToSeconds(step.arrTime);
        const isToday = (!selectedPlannerDay || selectedPlannerDay === getCurrentDayType());
        let countdown = "Scheduled";
        let isDeparted = false;
        
        const midnightRollover = PlannerRenderer.isMidnightRollover();
        
        let effectiveDepSec = depSec;
        let isTomorrowOverride = false;
        
        if (midnightRollover || step.dayLabel) { 
            const offsetMultiplier = step.dayOffset ? step.dayOffset : 1;
            effectiveDepSec += (86400 * offsetMultiplier); 
            isTomorrowOverride = true; 
        }

        if (isToday && !isTomorrowOverride) {
            if (effectiveDepSec > nowSec) {
                const diff = effectiveDepSec - nowSec;
                const h = Math.floor(diff / 3600);
                const m = Math.floor((diff % 3600) / 60);
                // Use &lt; so innerHTML never treats "< 1" as a broken tag (garbled/CJK glyphs)
                countdown = h > 0 ? `Departs in ${h}h ${m}m` : (m === 0 ? "Departs in &lt; 1 min" : `Departs in ${m} min`);
            } else { countdown = "Departed"; isDeparted = true; }
        }
        
        const durSec = arrSec - depSec;
        const durMins = Math.floor(durSec / 60);
        return { countdown, duration: PlannerRenderer.formatDuration(durMins), isDeparted };
    }
};

/** Keep Travel Day options in sync with region (WC gets standalone Public Holiday). */
function syncPlannerDayDropdownForRegion() {
    const list = document.getElementById('main-day-list');
    if (!list) return;
    const region = $userRegion.get() || 'GP';
    const satLabel = region === 'WC' ? 'Saturday' : 'Saturday / Public Holiday';
    const satLi = list.querySelector('li[data-day="saturday"]');
    if (satLi) {
        satLi.textContent = satLabel;
        satLi.setAttribute('onclick', `if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'saturday', '${satLabel}')`);
    }
    let pubLi = list.querySelector('li[data-day="public_holiday"]');
    if (region === 'WC') {
        if (!pubLi) {
            pubLi = document.createElement('li');
            pubLi.setAttribute('data-day', 'public_holiday');
            pubLi.className = 'p-4 text-sm font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700';
            pubLi.textContent = 'Public Holiday';
            pubLi.setAttribute('onclick', "if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'public_holiday', 'Public Holiday')");
            const sundayLi = list.querySelector('li[data-day="sunday"]');
            if (sundayLi) list.insertBefore(pubLi, sundayLi);
            else list.appendChild(pubLi);
        }
    } else if (pubLi) {
        pubLi.remove();
        if (selectedPlannerDay === 'public_holiday') {
            selectedPlannerDay = 'saturday';
            const display = document.getElementById('main-day-display');
            if (display && !selectedPlannerDate) display.textContent = plannerDayDisplayText('saturday');
        }
    }
    const display = document.getElementById('main-day-display');
    if (display && !selectedPlannerDate && selectedPlannerDay) {
        display.textContent = plannerDayDisplayText(selectedPlannerDay);
    }
}

// --- INITIALIZATION ---
export function initPlanner() {
    // Vite HMR / re-entry used to stack duplicate click listeners on the swap
    // button (on top of the old inline onclick) → even swaps looked like a no-op.
    if (typeof window !== 'undefined' && window.__ntPlannerInitBound) {
        syncPlannerDayDropdownForRegion();
        return;
    }
    if (typeof window !== 'undefined') window.__ntPlannerInitBound = true;

    const fromSelect = document.getElementById('planner-from');
    const toSelect = document.getElementById('planner-to');
    const swapBtn = document.getElementById('planner-swap-btn');
    const searchBtn = document.getElementById('planner-search-btn');
    const resetBtn = document.getElementById('planner-reset-btn');
    const locateBtn = document.getElementById('planner-locate-btn');
    const backBtn = document.getElementById('planner-back-btn');

    const inputSection = document.getElementById('planner-input-section');
    if (inputSection && !document.getElementById('planner-day-select-container')) {
        const daySelectDiv = document.createElement('div');
        daySelectDiv.id = "planner-day-select-container";
        // z-10 baseline — toggleDropdownScrim elevates to z-[160] while open.
        // Do not use z-30 here; a leftover scale class can fight the elevate pass.
        daySelectDiv.className = "mb-4 relative z-10"; 
        
        let selDay = (typeof selectedPlannerDay !== 'undefined' && selectedPlannerDay) ? selectedPlannerDay : getCurrentDayType();
        let selText = plannerDayDisplayText(selDay, selectedPlannerDate);
        const region = $userRegion.get() || 'GP';
        const satLabel = region === 'WC' ? 'Saturday' : 'Saturday / Public Holiday';
        const pubLi = region === 'WC'
            ? `<li data-day="public_holiday" onclick="if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'public_holiday', 'Public Holiday')" class="p-4 text-sm font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 ${selDay === 'public_holiday' && !selectedPlannerDate ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Public Holiday</li>`
            : '';

        daySelectDiv.innerHTML = `
            <label class="block text-xs font-bold text-gray-500 uppercase ml-1 mb-1">Travel Day</label>
            <div onclick="if(typeof window._toggleMainDayDropdown === 'function') window._toggleMainDayDropdown(event)" class="w-full p-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-900 dark:text-white focus:outline-none cursor-pointer flex justify-between items-center shadow-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                <span id="main-day-display">${selText}</span>
                <svg id="main-day-chevron" class="w-5 h-5 text-gray-500 shrink-0 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            <ul id="main-day-list" class="absolute z-[200] top-full mt-2 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl hidden flex-col overflow-hidden text-left max-h-[min(40vh,16rem)] overflow-y-auto custom-scrollbar">
                <li data-day="weekday" onclick="if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'weekday', 'Weekday (Mon-Fri)')" class="p-4 text-sm font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 ${selDay === 'weekday' && !selectedPlannerDate ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Weekday (Mon-Fri)</li>
                <li data-day="saturday" onclick="if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'saturday', '${satLabel}')" class="p-4 text-sm font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 ${selDay === 'saturday' && !selectedPlannerDate ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">${satLabel}</li>
                ${pubLi}
                <li data-day="sunday" onclick="if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'sunday', 'Sunday')" class="p-4 text-sm font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors border-b border-gray-100 dark:border-gray-700 ${selDay === 'sunday' && !selectedPlannerDate ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Sunday</li>
                <li data-day="specific" onclick="if(typeof window._selectMainDay === 'function') window._selectMainDay(event, 'specific', 'Pick a date…')" class="p-4 text-sm font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selectedPlannerDate ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Pick a date…</li>
            </ul>
            <!-- Legacy wrap kept hidden for any external refs; date picking uses the sheet modal -->
            <div id="planner-specific-date-wrap" class="hidden" aria-hidden="true">
                <input type="date" id="planner-specific-date" value="${selectedPlannerDate || ''}" tabindex="-1" />
            </div>
        `;
        inputSection.insertBefore(daySelectDiv, searchBtn);
        // Keep space under the day picker so the downward menu isn't clipped by the shell
        inputSection.classList.add('pb-8');
    }

    if (inputSection && !document.getElementById('planner-history-container')) {
        const historyContainer = document.createElement('div');
        historyContainer.id = 'planner-history-container';
        historyContainer.className = "mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 hidden";
        inputSection.appendChild(historyContainer);
        
        historyContainer.addEventListener('click', (e) => {
            const clearBtn = e.target.closest('#planner-history-clear-btn');
            const historyItem = e.target.closest('.planner-history-item-btn');
            
            if (clearBtn) {
                const historyKey = 'plannerHistory_' + $userRegion.get();
                try { safeStorage.removeItem(historyKey); } catch(ex) {}
                renderPlannerHistory();
            } else if (historyItem) {
                const fullFrom = historyItem.getAttribute('data-full-from');
                const fullTo = historyItem.getAttribute('data-full-to');
                if (fullFrom && fullTo && typeof window.restorePlannerSearch === 'function') {
                    window.restorePlannerSearch(fullFrom, fullTo);
                }
            }
        });
        
        renderPlannerHistory();
    }

    const infoBtn = document.getElementById('planner-info-btn');
    if (infoBtn) {
        infoBtn.addEventListener('click', () => {
            if (typeof triggerHaptic === 'function') triggerHaptic();
            if (typeof openSmoothModal === 'function') {
                openSmoothModal('help-modal');
            } else {
                const helpModal = document.getElementById('help-modal');
                if (helpModal) helpModal.classList.remove('hidden');
            }
        });
    }

    const plannerTab = document.getElementById('tab-trip-planner');
    if (plannerTab) {
        let pClickCount = 0;
        let pClickTimer = null;
        plannerTab.addEventListener('click', () => {
            pClickCount++;
            if (pClickTimer) clearTimeout(pClickTimer);
            pClickTimer = setTimeout(() => { pClickCount = 0; }, 1000);
            
            if (pClickCount >= 5) {
                pClickCount = 0;
                const appTitle = document.getElementById('app-title');
                if (appTitle) appTitle.click(); 
            }
        });
    }

    if (!fromSelect || !toSelect) return;

    setupAutocomplete('planner-from-search', 'planner-from');
    setupAutocomplete('planner-to-search', 'planner-to');

    if (locateBtn) {
        locateBtn.addEventListener('click', () => {
            const icon = locateBtn.querySelector('svg');
            if (icon) icon.classList.add('animate-spin'); 
            
            if (!navigator.geolocation) {
                if (typeof showToast === 'function') showToast("Geolocation is not supported.", "error");
                if (icon) icon.classList.remove('animate-spin');
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude: userLat, longitude: userLon } = position.coords;
                    let candidates = [];
                    const globalIndex = $globalStationIndex.get();
                    if (globalIndex) {
                        for (const [stationName, coords] of Object.entries(globalIndex)) {
                            const dist = getDistanceFromLatLonInKm(userLat, userLon, coords.lat, coords.lon);
                            candidates.push({ stationName, dist });
                        }
                        candidates.sort((a, b) => a.dist - b.dist);
                    }

                    if (candidates.length > 0 && candidates[0].dist <= 6) { 
                        const nearest = candidates[0];
                        fromSelect.value = nearest.stationName;
                        const fromInputSearch = document.getElementById('planner-from-search');
                        if (fromInputSearch) {
                            fromInputSearch.value = nearest.stationName.replace(' STATION', '');
                            fromInputSearch.dataset.resolvedValue = nearest.stationName;
                        }
                        
                        filterToOptions();
                        if (typeof showToast === 'function') showToast(`Located: ${nearest.stationName.replace(' STATION', '')} (${nearest.dist.toFixed(1)}km)`, "success");
                        
                        if (typeof trackAnalyticsEvent === 'function') {
                            trackAnalyticsEvent('planner_auto_locate', { station: nearest.stationName });
                        }
                    } else {
                        if (typeof showToast === 'function') showToast("No stations found nearby.", "error");
                    }
                    if (icon) icon.classList.remove('animate-spin');
                },
                () => {
                    if (typeof showToast === 'function') showToast("Could not retrieve location.", "error");
                    if (icon) icon.classList.remove('animate-spin');
                }
            );
        });
    }

    const filterToOptions = () => {
        const fromInputEl = document.getElementById('planner-from-search');
        const toInputEl = document.getElementById('planner-to-search');
        
        const selectedFrom = (fromInputEl && fromInputEl.dataset.resolvedValue) ? fromInputEl.dataset.resolvedValue : fromSelect.value;
        const selectedTo = (toInputEl && toInputEl.dataset.resolvedValue) ? toInputEl.dataset.resolvedValue : toSelect.value;

        Array.from(toSelect.options).forEach(opt => {
            if (opt.value === selectedFrom && opt.value !== "") {
                opt.disabled = true;
                opt.hidden = true; 
            } else {
                opt.disabled = false;
                opt.hidden = false;
            }
        });
        
        if (selectedFrom && selectedFrom !== "" && selectedTo === selectedFrom) {
            toSelect.value = "";
            if (toInputEl) {
                toInputEl.value = "";
                delete toInputEl.dataset.resolvedValue;
            }
        }
    };
    
    fromSelect.addEventListener('change', filterToOptions);
    const fromInput = document.getElementById('planner-from-search');
    if(fromInput) fromInput.addEventListener('change', filterToOptions);

    if (swapBtn) {
        swapBtn.addEventListener('click', () => {
            if (typeof window.swapPlannerResults === 'function') {
                window.swapPlannerResults();
            }
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            if (typeof triggerHaptic === 'function') triggerHaptic(); 

            const fromInputSearch = document.getElementById('planner-from-search');
            const toInputSearch = document.getElementById('planner-to-search');

            const resolveStation = (inputEl) => {
                if (!inputEl) return "";
                if (inputEl.dataset.resolvedValue) return inputEl.dataset.resolvedValue;
                
                const inputVal = inputEl.value;
                const masterList = getMasterStationList();
                if (!inputVal || !masterList || masterList.length === 0) return "";

                const cleanInput = inputVal.trim().replace(/\s+/g, ' ').toUpperCase();
                const exact = masterList.find(s => s.replace(' STATION', '').trim().toUpperCase() === cleanInput);
                if (exact) {
                    inputEl.dataset.resolvedValue = exact;
                    return exact;
                }

                const matches = masterList.filter(s => s.replace(' STATION', '').trim().toUpperCase().includes(cleanInput));
                if (matches.length === 1) {
                    inputEl.dataset.resolvedValue = matches[0];
                    return matches[0];
                }
                return "";
            };

            const from = resolveStation(fromInputSearch);
            const to = resolveStation(toInputSearch);

            if (from && fromInputSearch) fromInputSearch.value = from.replace(' STATION', '');
            if (to && toInputSearch) toInputSearch.value = to.replace(' STATION', '');

            const fromSelect = document.getElementById('planner-from');
            const toSelect = document.getElementById('planner-to');
            if (fromSelect && from) {
                if (!fromSelect.querySelector(`option[value="${from}"]`)) {
                    fromSelect.appendChild(new Option(from, from));
                }
                fromSelect.value = from;
            }
            if (toSelect && to) {
                if (!toSelect.querySelector(`option[value="${to}"]`)) {
                    toSelect.appendChild(new Option(to, to));
                }
                toSelect.value = to;
            }

            if (!from || !to) {
                if (typeof showToast === 'function') showToast("Please select valid stations from the list.", "error");
                return;
            }
            if (from === to) {
                if (typeof showToast === 'function') showToast("Origin and Destination cannot be the same.", "error");
                return;
            }

            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_search', {
                    origin: from,
                    destination: to,
                    day: typeof selectedPlannerDay !== 'undefined' && selectedPlannerDay ? selectedPlannerDay : 'unknown'
                });
            }

            executeTripPlan(from, to);
        });
    }

    const resetAction = () => {
        if (typeof triggerHaptic === 'function') triggerHaptic();
        hidePlannerResults();
        
        if (typeof location !== 'undefined' && location.hash === '#planner-results') {
            history.replaceState({ view: 'planner' }, '', '#planner');
        }
    };

    if (resetBtn) resetBtn.addEventListener('click', resetAction);
    if (backBtn) backBtn.addEventListener('click', resetAction);

    const tabNextTrain = document.getElementById('tab-next-train');
    if (tabNextTrain) {
        tabNextTrain.addEventListener('click', () => {
            if (typeof location !== 'undefined' && location.hash === '#planner-results') {
                history.replaceState({ view: 'home' }, '', '#home');
                hidePlannerResults();
            }
        });
    }

    syncPlannerDayDropdownForRegion();
    if (typeof window !== 'undefined' && !window.__ntPlannerDayRegionSub) {
        window.__ntPlannerDayRegionSub = true;
        $userRegion.subscribe(() => {
            syncPlannerDayDropdownForRegion();
        });
    }
}

/** Max recent trips shown in the planner UI (telemetry flush size is separate). */
const PLANNER_HISTORY_DISPLAY_CAP = 5;

/** Persist every successful Plan Trip for the on-device Recent Trips list (max 5). */
export function savePlannerHistory(from, to, opts = {}) {
    if (!from || !to || typeof from !== 'string' || typeof to !== 'string') return;
    const cleanFrom = from.replace(/ STATION/gi, '');
    const cleanTo = to.replace(/ STATION/gi, '');
    const routeKey = `${cleanFrom}|${cleanTo}`;
    
    const historyKey = 'plannerHistory_' + ($userRegion.get() || 'GP');
    
    let history = [];
    try { history = JSON.parse(safeStorage.getItem(historyKey) || '[]'); } catch { history = []; }
    if (!Array.isArray(history)) history = [];
    history = history.filter((item) => `${item.from}|${item.to}` !== routeKey);
    history.unshift({
        from: cleanFrom,
        to: cleanTo,
        fullFrom: from,
        fullTo: to,
        at: Date.now(),
    });
    if (history.length > PLANNER_HISTORY_DISPLAY_CAP) {
        history = history.slice(0, PLANNER_HISTORY_DISPLAY_CAP);
    }
    
    safeStorage.setItem(historyKey, JSON.stringify(history));
    renderPlannerHistory();
}

export function renderPlannerHistory() {
    const container = document.getElementById('planner-history-container');
    if (!container) return;
    
    const historyKey = 'plannerHistory_' + ($userRegion.get() || 'GP');
    let rawHistory = [];
    try { rawHistory = JSON.parse(safeStorage.getItem(historyKey) || '[]'); } catch { rawHistory = []; }

    let validHistory = rawHistory;
    const masterList = getMasterStationList();
    // History stores cleaned names (no " STATION"); master list usually includes the suffix.
    const stationKey = (s) => String(s || '').replace(/ STATION/gi, '').toUpperCase().trim();
    
    if (masterList && masterList.length > 0) {
        const masterKeys = new Set(masterList.map(stationKey));
        validHistory = rawHistory.filter((item) =>
            masterKeys.has(stationKey(item.fullFrom || item.from)) &&
            masterKeys.has(stationKey(item.fullTo || item.to))
        );
    } else if (masterList && masterList.length === 0) {
        container.classList.add('hidden');
        return;
    }

    if (validHistory.length > PLANNER_HISTORY_DISPLAY_CAP) {
        validHistory = validHistory.slice(0, PLANNER_HISTORY_DISPLAY_CAP);
    }
    // Persist cleaned / capped list so dead or oversize entries don't linger
    if (JSON.stringify(validHistory) !== JSON.stringify(rawHistory)) {
        safeStorage.setItem(historyKey, JSON.stringify(validHistory));
    }
    
    if (validHistory.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="flex items-center justify-between mb-2 px-1">
             <p class="text-xs font-bold text-gray-400 uppercase">Recent Trips</p>
             <button id="planner-history-clear-btn" class="text-[10px] text-gray-400 hover:text-red-500 focus:outline-none">Clear</button>
        </div>
        <div class="flex flex-col gap-2">
            ${validHistory.map((item) => `
                <button class="planner-history-item-btn w-full flex items-center justify-between gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 shadow-sm hover:border-blue-50 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors group text-left focus:outline-none"
                    data-full-from="${escapeHTML(item.fullFrom)}" data-full-to="${escapeHTML(item.fullTo)}">
                    <span class="text-xs font-bold text-gray-700 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 flex items-center min-w-0">
                        <span class="truncate">${escapeHTML(item.from)}</span>
                        <svg class="w-3 h-3 mx-1.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        <span class="truncate">${escapeHTML(item.to)}</span>
                    </span>
                    <svg class="w-3 h-3 text-gray-300 group-hover:text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>`).join('')}
        </div>
    `;
}

export function setupAutocomplete(inputId, selectId) {
    const input = document.getElementById(inputId);
    const select = document.getElementById(selectId);
    if (!input || !select) return;

    select.classList.add('hidden');
    if (input.parentNode && input.parentNode instanceof HTMLElement) input.parentNode.style.position = 'relative';

    const chevron = document.createElement('div');
    chevron.className = "absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 cursor-pointer p-2 hover:text-blue-500 z-10";
    chevron.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>`;
    input.parentNode.appendChild(chevron);

    const list = document.createElement('ul');
    list.className = "absolute z-50 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-b-lg shadow-xl max-h-60 overflow-y-auto hidden mt-1 left-0 custom-scrollbar text-left";
    input.parentNode.appendChild(list);

    const pickActiveStation = (station) => {
        input.value = bareStationName(station);
        input.dataset.resolvedValue = station;
        if (select) {
            if (!select.querySelector(`option[value="${station}"]`)) {
                const opt = document.createElement('option');
                opt.value = station;
                opt.textContent = station;
                select.appendChild(opt);
            }
            select.value = station;
            select.dispatchEvent(new Event('change'));
        }
        list.classList.add('hidden');
    };

    const renderList = (filterText = '') => {
        list.innerHTML = '';
        const rawFilter = filterText.trim();
        const val = rawFilter.toUpperCase();
        const masterList = getMasterStationList();
        const ghostList = getGhostStationList();

        let oppositeValue = "";
        if (inputId === 'planner-from-search') {
            const toInput = document.getElementById('planner-to-search');
            oppositeValue = (toInput && toInput.dataset.resolvedValue) ? toInput.dataset.resolvedValue : "";
        } else if (inputId === 'planner-to-search') {
            const fromInput = document.getElementById('planner-from-search');
            oppositeValue = (fromInput && fromInput.dataset.resolvedValue) ? fromInput.dataset.resolvedValue : "";
        }

        let matches = val.length === 0 ? masterList : masterList.filter((s) => s.includes(val));
        if (oppositeValue) matches = matches.filter((s) => s !== oppositeValue);

        // Ghosts only when the user is typing a name (not in the full browse list)
        let ghostMatches = [];
        if (val.length > 0) {
            ghostMatches = ghostList.filter((s) => s.includes(val) && s !== oppositeValue);
            // Prefer prefix hits (QUEE → Queenswood) over weaker contains-only ghosts
            ghostMatches.sort((a, b) => {
                const ba = bareStationName(a).toUpperCase();
                const bb = bareStationName(b).toUpperCase();
                const pa = ba.startsWith(val) ? 0 : 1;
                const pb = bb.startsWith(val) ? 0 : 1;
                return pa - pb || ba.localeCompare(bb);
            });
        }

        const hasStrongGhostHit = ghostMatches.some((s) =>
            bareStationName(s).toUpperCase().startsWith(val)
        );

        // Did-you-mean only when there is no active hit AND no clear inactive prefix hit
        let didYouMean = [];
        if (val.length >= 3 && matches.length === 0 && !hasStrongGhostHit) {
            didYouMean = fuzzyStationSuggestions(rawFilter, masterList, 3)
                .filter((s) => s !== oppositeValue);
        }

        let ghostSuggest = [];
        if (val.length >= 3 && matches.length === 0 && ghostMatches.length === 0) {
            ghostSuggest = fuzzyStationSuggestions(rawFilter, ghostList, 3)
                .filter((s) => s !== oppositeValue);
        }

        const appendActive = (station) => {
            const li = document.createElement('li');
            li.className = "p-3 border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors";
            li.textContent = bareStationName(station);
            li.onclick = () => pickActiveStation(station);
            list.appendChild(li);
        };

        const appendGhost = (station) => {
            const li = document.createElement('li');
            li.className = "p-3 border-b border-gray-100 dark:border-gray-700 cursor-pointer text-sm font-medium text-gray-400 dark:text-gray-500 transition-colors opacity-70";
            li.innerHTML = `<span class="line-through decoration-gray-300 dark:decoration-gray-600">${escapeHTML(bareStationName(station))}</span>
                <span class="ml-2 text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Inactive</span>`;
            li.onclick = () => {
                notifyGhostStation(station);
                // Do not resolve ghost as origin/destination
            };
            list.appendChild(li);
        };

        if (matches.length) {
            matches.forEach(appendActive);
        }

        if (didYouMean.length) {
            const header = document.createElement('li');
            header.className = "px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-gray-400";
            header.textContent = "Did you mean";
            list.appendChild(header);
            didYouMean.forEach(appendActive);
        }

        const allGhosts = [...ghostMatches, ...ghostSuggest];
        if (allGhosts.length) {
            const header = document.createElement('li');
            header.className = "px-3 pt-2 pb-1 text-[10px] font-black uppercase tracking-widest text-gray-400";
            header.textContent = "Inactive stations";
            list.appendChild(header);
            allGhosts.forEach(appendGhost);
        }

        if (!matches.length && !didYouMean.length && !allGhosts.length) {
            const li = document.createElement('li');
            li.className = "p-3 text-sm text-gray-400 italic";
            li.textContent = val.length ? "No stations found" : "No stations loaded";
            list.appendChild(li);
        }

        list.classList.remove('hidden');
    };

    input.addEventListener('input', () => { 
        delete input.dataset.resolvedValue;
        if (select) select.value = ""; 
        renderList(input.value); 
    });
    
    input.addEventListener('focus', () => {
        input.select();
        renderList('');
    });
    
    chevron.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        if (list.classList.contains('hidden')) {
            renderList('');
            input.focus();
        } else {
            list.classList.add('hidden');
        }
    });
    
    if (typeof document !== 'undefined') {
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target && target instanceof Node && !input.contains(target) && !list.contains(target) && !chevron.contains(target)) {
                list.classList.add('hidden');
            }
        });
    }
}

/**
 * Cold-start / shared planner links (short `plan=` + legacy SPA `action=planner`).
 * SPA parity: honor link `region`, pin a route first (schedules need it), then poll stations.
 */
export async function applyPlannerDeepLink() {
    if (typeof location === 'undefined') return false;

    const snap = peekShareDeeplinkSnapshot();
    const link = (snap && snap.kind === 'planner')
        ? parsePlannerDeepLink(snap)
        : parsePlannerDeepLink(location.search);
    if (!link || link.kind !== 'planner') return false;
    // Only clear snapshot when it was ours (leave route snaps for applyRouteDeepLink)
    if (snap && snap.kind === 'planner') consumeShareDeeplinkSnapshot();

    showToast('Opening shared link...', 'info', 5000);

    if (safeStorage.getItem('welcomeSeen') !== 'true') {
        safeStorage.setItem('welcomeSeen', 'true');
    }

    // SPA boot pins a route before handleShortcutActions — without it loadAllSchedules returns early
    // and MASTER_STATION_LIST never fills → "Connection timeout".
    const targetRegion = (link.region && ['GP', 'WC', 'KZN', 'EC'].includes(link.region))
        ? link.region
        : ($userRegion.get() || 'GP');
    const pinned = ensureRoutePinnedForRegion(targetRegion);
    if (!pinned) {
        showToast('Could not load trip data for this region.', 'error');
        stripShareParamsFromUrl();
        return false;
    }

    try {
        await loadAllSchedules(true);
    } catch (e) { /* continue; poll may still resolve */ }

    if (typeof switchTab === 'function') switchTab('trip-planner');
    else if (typeof window.switchTab === 'function') window.switchTab('trip-planner');

    stripShareParamsFromUrl();

    return await new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 30; // SPA: 20 × 500ms; allow a bit more for cold cache
        const checkReady = setInterval(() => {
            attempts += 1;
            // Re-pin + reload if a race cleared the route / station list
            if (attempts === 1 || attempts % 4 === 0) {
                ensureRoutePinnedForRegion(targetRegion);
                if (!getMasterStationList()?.length) {
                    loadAllSchedules(true).catch(() => {});
                }
            }
            const list = getMasterStationList();
            if (list && list.length > 0) {
                clearInterval(checkReady);
                const resolveStation = (txt) => {
                    if (!txt) return '';
                    let clean = String(txt).trim();
                    try { clean = decodeURIComponent(clean); } catch { /* already decoded */ }
                    clean = clean.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
                    const bare = (s) => String(s || '').replace(/ STATION$/i, '').toUpperCase();
                    const exact = list.find((s) => bare(s) === clean || String(s).toUpperCase() === clean);
                    if (exact) return exact;
                    const partial = list.find((s) => bare(s).includes(clean) || clean.includes(bare(s)));
                    return partial || '';
                };
                const fromId = resolveStation(link.from);
                const toId = resolveStation(link.to);
                if (!fromId || !toId) {
                    showToast('Could not resolve stations for shared trip.', 'error');
                    resolve(false);
                    return;
                }

                const fromSelect = document.getElementById('planner-from');
                const toSelect = document.getElementById('planner-to');
                const fromInput = document.getElementById('planner-from-search');
                const toInput = document.getElementById('planner-to-search');
                if (fromSelect) fromSelect.value = fromId;
                if (toSelect) toSelect.value = toId;
                if (fromInput) {
                    fromInput.value = fromId.replace(/ STATION$/i, '');
                    fromInput.dataset.resolvedValue = fromId;
                }
                if (toInput) {
                    toInput.value = toId.replace(/ STATION$/i, '');
                    toInput.dataset.resolvedValue = toId;
                }

                if (link.day) {
                    selectedPlannerDay = link.day;
                    const mainDayDisplay = document.getElementById('main-day-display');
                    const headerDayDisplay = document.getElementById('header-day-display');
                    const mainTxt = link.day === 'weekday' ? 'Weekday (Mon-Fri)'
                        : (link.day === 'saturday' ? 'Saturday / Public Holiday' : 'Sunday');
                    const headerTxt = link.day === 'weekday' ? 'Weekday'
                        : (link.day === 'saturday' ? 'Saturday' : 'Sunday');
                    if (mainDayDisplay) mainDayDisplay.textContent = mainTxt;
                    if (headerDayDisplay) headerDayDisplay.textContent = headerTxt;
                    const mList = document.getElementById('main-day-list');
                    if (mList) {
                        mList.querySelectorAll('li').forEach((li) => {
                            li.classList.remove('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
                            if (li.textContent?.trim() === mainTxt) {
                                li.classList.add('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
                            }
                        });
                    }
                }

                let timeParam = link.time || null;
                if (timeParam && /^\d{1,2}:\d{2}$/.test(timeParam)) timeParam = `${timeParam}:00`;

                executeTripPlan(fromId, toId, timeParam);
                showToast('Loaded shared trip plan', 'success');
                if (typeof window.trackAnalyticsEvent === 'function') {
                    window.trackAnalyticsEvent('deep_link_open', {
                        type: 'planner',
                        from: fromId,
                        to: toId,
                        legacy: !!link.legacy,
                    });
                }
                resolve(true);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkReady);
                console.warn('[DeepLink] Timed out waiting for station list.');
                showToast('Connection timeout: Could not load trip data.', 'error');
                resolve(false);
            }
        }, 500);
    });
}

// --- ORCHESTRATION ---
export function executeTripPlan(origin, dest, preferredTime = null) {
    const resultsContainer = document.getElementById('planner-results-list');
    if (resultsContainer) {
        resultsContainer.innerHTML = `
        <div class="min-h-[400px] flex flex-col justify-center items-center text-center p-4">
            <svg class="w-10 h-10 animate-spin mx-auto text-blue-500 mb-4" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <div id="planner-spinner-text" class="text-sm font-bold text-gray-600 dark:text-gray-400 animate-pulse">Searching all possible routes...</div>
        </div>
    `;
    }
    // Keep loading header as centred "Your Journey" (not the day/share toolbar)
    const headerTitle = document.querySelector('#planner-results-section h4');
    if (headerTitle) {
        headerTitle.className = 'text-lg font-bold text-gray-900 dark:text-white text-center justify-self-center px-1 m-0';
        headerTitle.textContent = 'Your Journey';
    }
    const shareSlot = document.querySelector('#planner-results-section .planner-share-slot');
    if (shareSlot) {
        shareSlot.className = 'planner-share-slot justify-self-end min-h-[32px] flex items-center justify-end';
        shareSlot.innerHTML = '';
    }

    let isSearching = true;
    const updateSpinnerText = (text) => {
        const el = document.getElementById('planner-spinner-text');
        if (el && isSearching) el.textContent = text;
    };
    const spinnerTimers = [
        setTimeout(() => updateSpinnerText("Evaluating alternative corridors..."), 3500),
        setTimeout(() => updateSpinnerText("Line Severance detected. Rerouting..."), 7000),
        setTimeout(() => updateSpinnerText("Calculating partial journeys..."), 10500)
    ];
    
    const inputSecEl = document.getElementById('planner-input-section');
    if (inputSecEl) inputSecEl.classList.add('hidden');
    
    const resultsSecEl = document.getElementById('planner-results-section');
    if (resultsSecEl) resultsSecEl.classList.remove('hidden');
    
    plannerExpandedState.clear();

    if (typeof location !== 'undefined' && location.hash !== '#planner-results') {
        history.pushState({ view: 'planner-results' }, '', '#planner-results');
    }

    if (!selectedPlannerDay) selectedPlannerDay = getCurrentDayType();

    setTimeout(async () => {
        let plannerResponse = { status: 'NO_PATH', trips: [] };
        const dbReady = await ensurePlannerDatabase();
        if (!dbReady) {
            spinnerTimers.forEach(t => clearTimeout(t));
            isSearching = false;
            showToast('Schedules still loading — try again in a moment.', 'error', 3500);
            if (resultsContainer) {
                resultsContainer.innerHTML = `
                    <div class="min-h-[400px] flex flex-col justify-center items-center text-center p-6">
                        <p class="text-base font-bold text-gray-800 dark:text-gray-100 mb-2">Schedules still loading</p>
                        <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">The regional timetable has not finished downloading yet. Please try your search again.</p>
                        <button type="button" id="planner-retry-after-load" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 rounded-xl text-sm">Try again</button>
                    </div>`;
                document.getElementById('planner-retry-after-load')?.addEventListener('click', () => {
                    executeTripPlan(origin, dest, preferredTime);
                });
            }
            return;
        }

        spinnerTimers.forEach(t => clearTimeout(t));
        isSearching = false;
        if (typeof planUnifiedTrip === 'function') {
            const extContext = {};
            if ($isSimMode.get()) {
                const dateInput = document.getElementById('sim-date');
                if (dateInput instanceof HTMLInputElement && dateInput.value) {
                    extContext.simBaseDate = dateInput.value;
                }
            }
            try {
                plannerResponse = await planUnifiedTrip(origin, dest, selectedPlannerDay, extContext);
            } catch (e) {
                console.error('🛡️ Guardian: planUnifiedTrip failed', e);
                plannerResponse = { status: 'NO_PATH', trips: [], errorPayload: null };
            }
        }

        currentTripOptions = plannerResponse.trips || [];
        currentPlannerStatus = plannerResponse.status;
        currentPlannerErrorPayload = plannerResponse.errorPayload || null; 
        const errorPayload = plannerResponse.errorPayload; 
        
        if (currentTripOptions.length > 0) {
            let nextTripIndex = 0;
            
            if (preferredTime) {
                const targetSec = timeToSeconds(preferredTime);
                let closestDist = Infinity;
                
                currentTripOptions.forEach((trip, index) => {
                    const tripSec = timeToSeconds(trip.depTime);
                    const dist = Math.abs(tripSec - targetSec);
                    if (dist < closestDist) {
                        closestDist = dist;
                        nextTripIndex = index;
                    }
                });
            } else {
                const nowSec = timeToSeconds(getCurrentTime());
                const isToday = (!selectedPlannerDay || selectedPlannerDay === getCurrentDayType());
                
                let isMidnightRollover = false;
                if (isToday && currentTripOptions.length > 0) {
                    const latestDep = Math.max(...currentTripOptions.map(t => timeToSeconds(t.depTime)));
                    if (nowSec > latestDep) isMidnightRollover = true;
                }
                
                if (currentPlannerStatus === 'SUNDAY_ROLLOVER' || currentPlannerStatus === 'IMPOSSIBLE_TODAY' || currentPlannerStatus === 'NO_MORE_TODAY') {
                    nextTripIndex = 0;
                } else if (currentTripOptions.length > 0 && currentTripOptions[0].dayLabel) {
                    nextTripIndex = 0;
                } else if (isMidnightRollover) {
                    nextTripIndex = 0;
                } else {
                    const idx = currentTripOptions.findIndex(t => timeToSeconds(t.depTime) >= nowSec);
                    if (idx !== -1) nextTripIndex = idx;
                    else nextTripIndex = currentTripOptions.length - 1;
                }
            }

            plannerOrigin = origin;
            plannerDest = dest;
            renderSelectedTrip(resultsContainer, nextTripIndex);
            startPlannerPulse(nextTripIndex);
            capturePlannerSnapshot({ kind: 'trips' });
            try { savePlannerHistory(origin, dest, { status: currentPlannerStatus }); } catch { /* ignore */ }
            try {
                const sample = currentTripOptions[nextTripIndex] || currentTripOptions[0];
                enqueueSuccessfulTripPlan({
                    origin,
                    destination: dest,
                    dayType: selectedPlannerDay || getCurrentDayType(),
                    specificDate: selectedPlannerDate || null,
                    depTime: sample?.depTime || null,
                    arrTime: sample?.arrTime || null,
                    transfers: Array.isArray(sample?.legs) ? Math.max(0, sample.legs.length - 1) : null,
                });
            } catch { /* ignore telemetry */ }

        } else {
            if (typeof trackAnalyticsEvent === 'function') {
                trackAnalyticsEvent('planner_no_result', { 
                    origin: origin, 
                    destination: dest,
                    failure_reason: currentPlannerStatus,
                    day_type: selectedPlannerDay || null,
                });
            }
            logRoutingFail({
                origin,
                destination: dest,
                reason: currentPlannerStatus,
                dayType: selectedPlannerDay || getCurrentDayType(),
                timeOfDay: (getCurrentTime() || '').slice(0, 5),
            });
            
            updatePlannerHeader("No Route Found", false);
            plannerOrigin = origin;
            plannerDest = dest;

            let errorTitle = "No Valid Route";
            let errorMsg = "";
            let showFeedbackBtn = false;
            let errorTone = 'warn';
            const cleanO = origin.replace(/ STATION/gi, '').trim();
            const cleanD = dest.replace(/ STATION/gi, '').trim();
            const safeO = cleanO.replace(/'/g, "\\'");
            const safeD = cleanD.replace(/'/g, "\\'");

            switch (currentPlannerStatus) {
                case 'SAME_STATION':
                    errorTitle = "Same station";
                    errorTone = 'info';
                    errorMsg = `<p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">Origin and destination are the same. Pick a different stop to plan a trip.</p>`;
                    break;
                case 'ERR_CROSS_REGION':
                    errorTitle = "Cross-region trip";
                    errorTone = 'info';
                    errorMsg = `<p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">Next Train routes within one province network at a time. Choose stations in the same region.</p>`;
                    break;
                case 'ERR_NO_SERVICE_TODAY':
                    errorTitle = "No service today";
                    errorMsg = `<p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">These stations connect on the map, but no trains run on this corridor for the selected day. Try Saturday / Holiday or the next weekday.</p>`;
                    break;
                case 'ERR_ACTIVE_SUSPENSION': {
                    errorTitle = errorPayload?.boardingBlocked ? "Boarding blocked" : "Route suspended";
                    errorTone = 'danger';
                    const btnText = errorPayload?.buttonText || 'Line Severed';
                    const disrId = errorPayload?.disruptionId || '';
                    const stationHint = (errorPayload?.stations || [])
                        .map((s) => String(s).replace(/ STATION/gi, ''))
                        .filter(Boolean)
                        .slice(0, 2);
                    const between = stationHint.length >= 2
                        ? ` between <b>${escapeHTML(stationHint[0])}</b> and <b>${escapeHTML(stationHint[1])}</b>`
                        : '';
                    const blockedOrigin = errorPayload?.blockedOrigin || cleanO;
                    const intended = errorPayload?.intendedDest || cleanD;

                    let primaryCard = '';
                    if (disrId) {
                        primaryCard = `
                            <button type="button" onclick="if(typeof window.openDisruptionModal==='function') window.openDisruptionModal('${String(disrId).replace(/'/g, "\\'")}')"
                                class="w-full text-left mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/25 border border-red-200 dark:border-red-800/60 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
                                <div class="flex items-center justify-between gap-2">
                                    <span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-700 dark:text-red-300">
                                        ${plannerIcon('circle', 'w-2.5 h-2.5 text-red-500')} ${escapeHTML(btnText)}
                                    </span>
                                    <svg class="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                                </div>
                                <p class="text-[11px] text-red-700/90 dark:text-red-300/90 mt-1.5 leading-snug">Tap for incident details</p>
                            </button>`;
                    }

                    let altHtml = '';
                    const alts = errorPayload?.alternateOrigins || [];
                    if (alts.length) {
                        altHtml = `
                            <div class="mt-4 space-y-2">
                                <p class="text-[10px] font-black uppercase tracking-widest text-gray-400">Board beyond the cut</p>
                                ${alts.map((a) => {
                                    const st = String(a.station || '').replace(/'/g, "\\'");
                                    const destSt = String(dest).replace(/'/g, "\\'");
                                    return `<button type="button" onclick="if(typeof window.planFromAlternateOrigin==='function') window.planFromAlternateOrigin('${st}','${destSt}')"
                                        class="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 transition-colors focus:outline-none text-left">
                                        <span class="text-xs font-bold text-gray-800 dark:text-gray-100">Plan from <span class="text-blue-600 dark:text-blue-400">${escapeHTML(a.label || a.station)}</span> → ${escapeHTML(intended)}</span>
                                        <svg class="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                                    </button>`;
                                }).join('')}
                                <p class="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">You may need other transport to reach the alternate station first.</p>
                            </div>`;
                    }

                    const lead = errorPayload?.boardingBlocked
                        ? `You can’t depart from <b>${escapeHTML(blockedOrigin)}</b> toward <b>${escapeHTML(intended)}</b>${between} while this segment is cut.`
                        : `Service is halted${between}. A physical path exists, but trains can’t complete this journey right now.`;

                    errorMsg = `
                        <p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">${lead}</p>
                        ${primaryCard}
                        ${altHtml}
                    `;
                    break;
                }
                case 'ERR_TIMETABLE_MISMATCH':
                    errorTitle = "Connection too long";
                    errorMsg = `<p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">A path exists, but transfers need more than a 4-hour wait on today’s schedule. If you know a better connection, report it below.</p>`;
                    showFeedbackBtn = true;
                    if (errorPayload?.hasIncident && errorPayload?.disruptionId) {
                        const btnText = errorPayload.buttonText || 'Line Severed';
                        errorMsg += `
                            <button type="button" onclick="if(typeof window.openDisruptionModal==='function') window.openDisruptionModal('${String(errorPayload.disruptionId).replace(/'/g, "\\'")}')"
                                class="mt-3 w-full text-left px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs font-bold text-red-700 dark:text-red-300 focus:outline-none">
                                Active incident: ${escapeHTML(btnText)}
                            </button>`;
                    }
                    break;
                case 'ERR_DISCONNECTED_GRAPH':
                default:
                    errorTitle = "No connection found";
                    errorMsg = `<p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">We couldn’t find a viable path on the current schedules. Check the network map, or report the route if you believe it should exist.</p>`;
                    showFeedbackBtn = true;
                    break;
            }

            let actionBtn = `
                <button type="button" onclick="if(typeof window.openPlannerNetworkMap==='function') window.openPlannerNetworkMap()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-colors flex items-center justify-center focus:outline-none text-sm">
                    <svg class="w-5 h-5 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"></path></svg>
                    Open Network Map
                </button>
            `;

            if (showFeedbackBtn) {
                actionBtn += `
                    <button type="button" onclick="if(typeof window.openFeedbackForMissingRoute==='function') window.openFeedbackForMissingRoute('${safeO}', '${safeD}')" class="mt-2 w-full bg-transparent border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 font-bold py-2.5 px-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center focus:outline-none text-sm">
                        Report Missing Route
                    </button>
                `;
            }

            if (resultsContainer) {
                resultsContainer.innerHTML = renderErrorCard(errorTitle, errorMsg, actionBtn, errorTone);
            }
            capturePlannerSnapshot({ kind: 'error' });
            try { savePlannerHistory(origin, dest, { status: currentPlannerStatus }); } catch { /* ignore */ }
        }
    }, 100); 
}

/** Re-plan using an alternate origin beyond a line cut. */
export function planFromAlternateOrigin(newOrigin, dest) {
    if (!newOrigin || !dest) return;
    if (typeof triggerHaptic === 'function') triggerHaptic();
    const fromSelect = document.getElementById('planner-from');
    const toSelect = document.getElementById('planner-to');
    const fromInput = document.getElementById('planner-from-search');
    const toInput = document.getElementById('planner-to-search');
    const fullFrom = String(newOrigin);
    const fullTo = String(dest);
    if (fromSelect) fromSelect.value = fullFrom;
    if (toSelect) toSelect.value = fullTo;
    if (fromInput) {
        fromInput.value = fullFrom.replace(/ STATION/gi, '');
        fromInput.dataset.resolvedValue = fullFrom;
    }
    if (toInput) {
        toInput.value = fullTo.replace(/ STATION/gi, '');
        toInput.dataset.resolvedValue = fullTo;
    }
    executeTripPlan(fullFrom, fullTo);
}

export function renderSelectedTrip(container, index) {
    window._plannerCurrentTripIndex = index; // GUARDIAN: Synchronize global state for Custom Dropdowns
    const selectedTrip = currentTripOptions[index];
    if (!selectedTrip) return; 

    const isTomorrow = selectedTrip.dayLabel !== undefined;
    const midnightRollover = PlannerRenderer.isMidnightRollover();

    const effectivelyTomorrow = isTomorrow || midnightRollover;

    if (currentPlannerStatus === 'ALL_DEPARTED') {
        renderAllDepartedResult(container, currentTripOptions, index);
    } else if (currentPlannerStatus === 'PARTIAL_JOURNEY') {
        renderTripResult(container, currentTripOptions, index, true);
    } else if (effectivelyTomorrow) {
        // GUARDIAN PHASE 13: Distinct handling for Mathematically Impossible routes vs simply missing the last train
        if (currentPlannerStatus === 'SUNDAY_ROLLOVER') {
            renderSundayRolloverResult(container, currentTripOptions, index);
        } else if (currentPlannerStatus === 'IMPOSSIBLE_TODAY') {
            renderImpossibleTodayResult(container, currentTripOptions, index);
        } else {
            // After "See Next Available Day" (or any next-day FOUND), show a
            // forward-looking bridge — not another "no more trains today" wall.
            renderNextDayResult(container, currentTripOptions, index);
        }
    } else {
        renderTripResult(container, currentTripOptions, index);
    }
}

export function startPlannerPulse(currentIndex) {
    if (plannerPulse) clearInterval(plannerPulse);
    if (selectedPlannerDay && selectedPlannerDay !== getCurrentDayType()) return;

    let trackedIndex = currentIndex;
    plannerPulse = setInterval(() => {
        const trip = currentTripOptions[trackedIndex];
        if (!trip) return;
        if (typeof window !== 'undefined' && typeof window._plannerCurrentTripIndex !== 'undefined') trackedIndex = window._plannerCurrentTripIndex;
        renderSelectedTrip(document.getElementById('planner-results-list'), trackedIndex);
    }, 30000); 
}

if (typeof window !== 'undefined') {
    window.selectPlannerTrip = selectPlannerTrip;
    window.togglePlannerStops = togglePlannerStops;
    window.shareCurrentGrid = shareCurrentGrid;
    window.executeManualRollover = executeManualRollover;
    window.swapPlannerResults = swapPlannerResults;
    window.openFeedbackForMissingRoute = openFeedbackForMissingRoute;
    window.restorePlannerSearch = restorePlannerSearch;
    window.openDisruptionModal = openDisruptionModal;
    window.extractTripCoordinates = extractTripCoordinates;
    window.hidePlannerResults = hidePlannerResults;
    window.openPlannerNetworkMap = openPlannerNetworkMap;
    window.restorePlannerResultsView = restorePlannerResultsView;
    window.planFromAlternateOrigin = planFromAlternateOrigin;
    window._toggleCustomTimeDropdown = toggleCustomTimeDropdown;
    window._selectCustomTrip = selectCustomTrip;
    window._toggleMainDayDropdown = toggleMainDayDropdown;
    window._selectMainDay = selectMainDay;
    window._applyPlannerSpecificDate = applyPlannerSpecificDate;
    window._toggleHeaderDayDropdown = toggleHeaderDayDropdown;
    window._selectHeaderDay = selectHeaderDay;
    window.openTripMapRenderer = openTripMapRenderer;
}

export function selectPlannerTrip(index) {
    const idx = parseInt(index, 10);
    if (!currentTripOptions || !currentTripOptions[idx]) return;
    
    if (typeof trackAnalyticsEvent === 'function') {
        const trip = currentTripOptions[idx];
        trackAnalyticsEvent('planner_trip_select', { 
            train: trip.train, 
            time: trip.depTime,
            type: trip.type
        });
    }

    plannerExpandedState.clear();
    renderSelectedTrip(document.getElementById('planner-results-list'), idx);
    startPlannerPulse(idx);
}

export function togglePlannerStops(id) {
    const el = document.getElementById(id);
    const btn = document.getElementById(`btn-${id}`);
    if (!el) return;

    el.classList.toggle('hidden');
    const isHidden = el.classList.contains('hidden');

    if (isHidden) plannerExpandedState.delete(id);
    else plannerExpandedState.add(id);

    if (btn) btn.textContent = isHidden ? 'Show All Stops' : 'Hide Stops';
}

export async function shareCurrentGrid() {
    if (typeof triggerHaptic === 'function') triggerHaptic(); 
    
    const handleCopySuccess = () => {
        if (typeof window !== 'undefined' && window.showToast) {
            window.showToast('Schedule link copied to clipboard!', 'success');
        } else {
            console.log('Schedule link copied to clipboard!');
        }
    };

    const state = window._gridShareState || {};
    const routeId = state.routeId || $currentRouteId.get();
    const dir = state.dir || 'A';
    const day = state.day || 'weekday';
    const shareUrl = `${location.origin}${location.pathname}?action=route&route=${routeId}&view=grid&dir=${dir}&day=${day}`;
    const destName = state.destName || (dir === 'B' ? 'destination B' : 'destination A');
    const shareText = `Check out the ${day} schedule to ${destName}`;
    const data = { title: 'Next Train Schedule', text: shareText, url: shareUrl };
    
    try {
        if (navigator.share) await navigator.share(data);
        else {
            try {
                await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
                handleCopySuccess();
            } catch {
                const textArea = document.createElement('textarea');
                textArea.value = `${shareText}\n${shareUrl}`;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                handleCopySuccess();
            }
        }
    } catch (e) {
        if (typeof window.showToast === 'function') {
            window.showToast('Could not share link.', 'error');
        }
    }
}

export function executeManualRollover(origin, dest) {
    if (typeof triggerHaptic === 'function') triggerHaptic();

    // GUARDIAN PHASE 2: Silent DOM Sync for Dropdown (SPA parity)
    if (typeof window.getLookaheadDayInfo === 'function') {
        const nextDayInfo = window.getLookaheadDayInfo(1);
        if (nextDayInfo) {
            selectedPlannerDay = nextDayInfo.type;
            const display = document.getElementById('main-day-display');
            const mainTxt = nextDayInfo.type === 'weekday'
                ? 'Weekday (Mon-Fri)'
                : (nextDayInfo.type === 'saturday' ? 'Saturday / Public Holiday' : 'Sunday');
            if (display) display.textContent = mainTxt;

            const mList = document.getElementById('main-day-list');
            if (mList) {
                mList.querySelectorAll('li').forEach((li) => {
                    li.classList.remove('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
                    if (li.textContent === mainTxt) {
                        li.classList.add('bg-blue-50', 'dark:bg-gray-700', 'text-blue-600', 'dark:text-blue-400');
                    }
                });
            }
        }
    }

    window._forceManualRollover = true;
    executeTripPlan(origin, dest);
}

export function openFeedbackForMissingRoute(origin, dest) {
    if (typeof triggerHaptic === 'function') triggerHaptic();
    clearFeedbackReplyMode();
    
    if (typeof openSmoothModal === 'function') {
        openSmoothModal('feedback-modal');
    } else {
        const modal = document.getElementById('feedback-modal');
        if (modal) modal.classList.remove('hidden');
    }

    setTimeout(() => {
        const msgBox = document.getElementById('feedback-text') || document.querySelector('#feedback-modal textarea');
        if (msgBox instanceof HTMLTextAreaElement) {
            const contextStr = `[Failed Route Attempt: ${origin} to ${dest}]\n\nHello, I usually make this trip by...`;
            msgBox.value = contextStr;
            msgBox.focus();
        }
    }, 350); 
}

export function restorePlannerSearch(fullFrom, fullTo) {
    const fromSelect = document.getElementById('planner-from');
    const toSelect = document.getElementById('planner-to');
    const fromInput = document.getElementById('planner-from-search');
    const toInput = document.getElementById('planner-to-search');
    
    if (fromSelect && toSelect) {
        fromSelect.value = fullFrom;
        toSelect.value = fullTo;
        if (fromInput) {
            fromInput.value = fullFrom.replace(' STATION', '');
            fromInput.dataset.resolvedValue = fullFrom;
        }
        if (toInput) {
            toInput.value = fullTo.replace(' STATION', '');
            toInput.dataset.resolvedValue = fullTo;
        }
        
        if (!selectedPlannerDay) {
            selectedPlannerDay = getCurrentDayType();
        }

        if (typeof showToast === 'function') showToast("Restored recent search", "info", 1000);
        
        if (typeof trackAnalyticsEvent === 'function') {
            trackAnalyticsEvent('planner_history_restore', { origin: fullFrom, destination: fullTo });
        }

        // History is recorded when executeTripPlan finishes (with status)
        executeTripPlan(fullFrom, fullTo);
    }
}

export function swapPlannerResults() {
    if (typeof window !== 'undefined') {
        if (window.__ntPlannerSwapBusy) return;
        window.__ntPlannerSwapBusy = true;
        setTimeout(() => { window.__ntPlannerSwapBusy = false; }, 0);
    }

    if (typeof triggerHaptic === 'function') triggerHaptic();

    const fromInput = document.getElementById('planner-from-search');
    const toInput = document.getElementById('planner-to-search');
    const fromSelect = document.getElementById('planner-from');
    const toSelect = document.getElementById('planner-to');

    if (!fromInput || !toInput) return;

    let preferredTime = null;
    if (typeof window._plannerCurrentTripIndex !== 'undefined' && typeof currentTripOptions !== 'undefined' && currentTripOptions.length > 0) {
        const selectedIdx = window._plannerCurrentTripIndex;
        if (currentTripOptions[selectedIdx]) {
            preferredTime = currentTripOptions[selectedIdx].depTime;
        }
    }

    // Snapshot both sides before any writes (avoids resolved-value amnesia).
    const tempFromText = fromInput.value;
    const tempToText = toInput.value;
    const tempFromResolved = fromInput.dataset.resolvedValue || '';
    const tempToResolved = toInput.dataset.resolvedValue || '';

    fromInput.value = tempToText;
    toInput.value = tempFromText;

    if (tempToResolved) fromInput.dataset.resolvedValue = tempToResolved;
    else delete fromInput.dataset.resolvedValue;

    if (tempFromResolved) toInput.dataset.resolvedValue = tempFromResolved;
    else delete toInput.dataset.resolvedValue;

    const resolveStation = (inputEl) => {
        if (!inputEl) return "";
        if (inputEl.dataset.resolvedValue) return inputEl.dataset.resolvedValue; 
        
        const inputVal = inputEl.value;
        const masterList = getMasterStationList();
        if (!inputVal || !masterList || masterList.length === 0) return "";

        const cleanInput = inputVal.trim().replace(/\s+/g, ' ').toUpperCase();
        const exact = masterList.find(s => s.replace(' STATION', '').trim().toUpperCase() === cleanInput);
        if (exact) {
            inputEl.dataset.resolvedValue = exact;
            return exact;
        }

        const matches = masterList.filter(s => s.replace(' STATION', '').trim().toUpperCase().includes(cleanInput));
        if (matches.length === 1) {
            inputEl.dataset.resolvedValue = matches[0];
            return matches[0];
        }
        
        return "";
    };

    const resolvedFrom = resolveStation(fromInput);
    const resolvedTo = resolveStation(toInput);

    if (resolvedFrom) {
        fromInput.dataset.resolvedValue = resolvedFrom;
        if (fromSelect) {
            if (!fromSelect.querySelector(`option[value="${resolvedFrom}"]`)) fromSelect.appendChild(new Option(resolvedFrom, resolvedFrom));
            fromSelect.value = resolvedFrom;
        }
    } else {
        if (fromSelect) fromSelect.value = "";
    }

    if (resolvedTo) {
        toInput.dataset.resolvedValue = resolvedTo;
        if (toSelect) {
            if (!toSelect.querySelector(`option[value="${resolvedTo}"]`)) toSelect.appendChild(new Option(resolvedTo, resolvedTo));
            toSelect.value = resolvedTo;
        }
    } else {
        if (toSelect) toSelect.value = "";
    }

    const resultsSection = document.getElementById('planner-results-section');
    const isOnResultsScreen = resultsSection && !resultsSection.classList.contains('hidden');

    if (!resolvedFrom || !resolvedTo) {
        if (typeof showToast === 'function') showToast("Stations swapped. Please clarify names.", "warning");
        if (isOnResultsScreen) {
            hidePlannerResults();
        } else {
            if (fromSelect) fromSelect.dispatchEvent(new Event('change'));
            if (fromInput) fromInput.dispatchEvent(new Event('change'));
        }
        return; 
    }

    if (isOnResultsScreen) {
        if (typeof showToast === 'function') showToast("Reversing Direction...", "info", 1000);
        executeTripPlan(resolvedFrom, resolvedTo, preferredTime);
    } else {
        if (fromSelect) fromSelect.dispatchEvent(new Event('change'));
        if (fromInput) fromInput.dispatchEvent(new Event('change'));
    }
}

export function getPlanningDayLabel() {
    const region = $userRegion.get() || 'GP';
    const holiday = getPlannerHolidayContext();
    if (holiday) {
        if (holiday.scheduleType === 'sunday') return `${holiday.name} · No Service`;
        if (region === 'WC' && (holiday.scheduleType === 'saturday' || holiday.scheduleType === 'public_holiday')) {
            return `${holiday.name} · Public Holiday Schedule`;
        }
        if (holiday.scheduleType === 'saturday' || holiday.scheduleType === 'public_holiday') {
            return `${holiday.name} · Saturday Schedule`;
        }
        return `${holiday.name} Schedule`;
    }
    const day = selectedPlannerDay || getCurrentDayType();
    if (day === 'sunday') return "Sunday";
    if (day === 'public_holiday') return "Public Holiday Schedule";
    if (day === 'saturday') return region === 'WC' ? "Saturday Schedule" : "Saturday / Public Holiday Schedule";
    return "Weekday Schedule";
}

export function updatePlannerHeader(dayLabel, showShare = true) {
    const headerTitle = document.querySelector('#planner-results-section h4');
    const spacer = document.querySelector('#planner-results-section .planner-share-slot'); 
    
    if (headerTitle) {
        headerTitle.innerHTML = "";
        headerTitle.className = "m-0 justify-self-center flex items-center justify-center"; 
        
        const badge = document.createElement("div");
        badge.id = "planner-header-badge";
        badge.className = "relative bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-800 dark:text-blue-300 text-xs font-bold rounded-lg border border-blue-100 dark:border-blue-800 shadow-sm flex items-center transition-colors cursor-pointer group h-8"; 
        
        let selDay = selectedPlannerDay || getCurrentDayType();
        const holiday = getPlannerHolidayContext();
        const headerRegion = $userRegion.get() || 'GP';
        let selText = selDay === 'weekday' ? 'Weekday'
            : (selDay === 'public_holiday' ? 'Pub Hol'
            : (selDay === 'saturday' ? 'Saturday' : 'Sunday'));
        if (holiday) {
            selText = holiday.scheduleType === 'sunday'
                ? 'Holiday · None'
                : (headerRegion === 'WC' ? 'Holiday · Pub' : 'Holiday · Sat');
        }
        const headerPubLi = headerRegion === 'WC'
            ? `<li onclick="if(typeof window._selectHeaderDay === 'function') window._selectHeaderDay(event, 'public_holiday', 'Public Holiday')" class="px-4 py-3 text-xs font-bold border-t border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selDay === 'public_holiday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Public Holiday</li>`
            : '';

        badge.innerHTML = `
            <div onclick="if(typeof window._toggleHeaderDayDropdown === 'function') window._toggleHeaderDayDropdown(event)" class="w-full h-full flex items-center justify-center px-3 relative min-w-[5.5rem]">
                <span id="header-day-display" class="truncate font-bold text-[12px] pr-1">${selText}</span>
                <svg id="header-day-chevron" class="w-3.5 h-3.5 shrink-0 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                
                <ul id="header-day-list" class="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl hidden flex-col overflow-hidden z-[200] text-left">
                    <li onclick="if(typeof window._selectHeaderDay === 'function') window._selectHeaderDay(event, 'weekday', 'Weekday')" class="px-4 py-3 text-xs font-bold hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selDay === 'weekday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Weekday</li>
                    <li onclick="if(typeof window._selectHeaderDay === 'function') window._selectHeaderDay(event, 'saturday', 'Saturday')" class="px-4 py-3 text-xs font-bold border-t border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selDay === 'saturday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Saturday</li>
                    ${headerPubLi}
                    <li onclick="if(typeof window._selectHeaderDay === 'function') window._selectHeaderDay(event, 'sunday', 'Sunday')" class="px-4 py-3 text-xs font-bold border-t border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 transition-colors ${selDay === 'sunday' ? 'bg-blue-50 dark:bg-gray-700 text-blue-600 dark:text-blue-400' : ''}">Sunday</li>
                </ul>
            </div>
        `;
        
        headerTitle.appendChild(badge);
        headerTitle.classList.remove('hidden');
    }

    if (spacer) {
        spacer.innerHTML = ""; 
        if (spacer instanceof HTMLElement) spacer.style.display = 'flex'; 
        
        if (showShare) {
            spacer.className = "planner-share-slot justify-self-end min-h-[32px] flex items-center justify-end"; 
            const shareBtn = document.createElement("button");
            shareBtn.type = "button";
            shareBtn.className = "inline-flex items-center text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors group flex-none whitespace-nowrap shadow-sm border border-blue-100 dark:border-blue-800 focus:outline-none h-8";
            shareBtn.title = "Share Trip Plan";
            
            shareBtn.onclick = async () => {
                if (typeof triggerHaptic === 'function') triggerHaptic(); 
                
                const idx = typeof window !== 'undefined' && typeof window._plannerCurrentTripIndex !== 'undefined' ? window._plannerCurrentTripIndex : 0;
                const selectedTrip = currentTripOptions[idx] || currentTripOptions[0];
                let selectedTime = null;
                let fromStation = "";
                let toStation = "";
                
                if (selectedTrip) {
                     selectedTime = selectedTrip.depTime;
                     fromStation = (selectedTrip.from || "").replace(/ STATION/gi, '').trim();
                     toStation = (selectedTrip.to || "").replace(/ STATION/gi, '').trim();
                } else {
                     const fromSearchInput = document.getElementById('planner-from-search');
                     const toSearchInput = document.getElementById('planner-to-search');
                     fromStation = fromSearchInput ? fromSearchInput.value : "";
                     toStation = toSearchInput ? toSearchInput.value : "";
                }
                
                const safeTime = (selectedTime || "").trim();
                const safeDay = (selectedPlannerDay || "").trim();
                const safeRegion = $userRegion.get() || 'GP';
                
                const shareLink = buildPlannerShareUrl({
                    from: fromStation,
                    to: toStation,
                    time: safeTime,
                    day: safeDay,
                    region: safeRegion,
                    origin: 'https://nexttrain.co.za',
                    pathname: '/',
                });
                const shareText = `Trip Plan: ${fromStation} to ${toStation}.`;

                const data = { title: 'Next Train Trip Plan', text: shareText, url: shareLink };
                
                const handleCopySuccess = () => {
                    if (typeof window !== 'undefined' && window.showToast) {
                        window.showToast('Link copied to clipboard!', 'success');
                    } else {
                        console.log('Link copied to clipboard!');
                    }
                };

                try { 
                    if (navigator.share) await navigator.share(data); 
                    else {
                        const textArea = document.createElement('textarea');
                        textArea.value = `${shareText} Check details here: ${shareLink}`;
                        document.body.appendChild(textArea);
                        textArea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textArea);
                        handleCopySuccess();
                    }
                } catch(e) {}
            };
            
            shareBtn.innerHTML = `
                Share
                <svg class="w-3.5 h-3.5 ml-1 transform transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
            `;
            
            spacer.appendChild(shareBtn);
        } else {
            spacer.className = "planner-share-slot justify-self-end min-h-[32px] flex items-center justify-end invisible";
            spacer.innerHTML = `<div class="w-14" aria-hidden="true"></div>`;
        }
    }
}

export function renderTripResult(container, trips, selectedIndex = 0, isPartial = false) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return; 

    const dayLabel = getPlanningDayLabel();
    
    updatePlannerHeader(dayLabel, true);

    // Advisories attach in one stack: holiday → line severed → expect delays → long layover
    const leading = [buildHolidayNoticeHtml(selectedTrip)].filter(Boolean);
    container.innerHTML = PlannerRenderer.buildCard(selectedTrip, false, trips, selectedIndex, leading)
        + '<div id="planner-crowd-delay-slot"></div>';
    injectPlannerCrowdDelay(selectedTrip);
}

export function renderAllDepartedResult(container, trips, selectedIndex = 0) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return;

    const dayLabel = getPlanningDayLabel();
    updatePlannerHeader(dayLabel, true);

    const origin = (selectedTrip.from || "").replace(/ STATION/gi, '').trim();
    const dest = (selectedTrip.to || "").replace(/ STATION/gi, '').trim();
    const safeO = origin.replace(/'/g, "\\'");
    const safeD = dest.replace(/'/g, "\\'");

    // Notice only — CTA must stay a sibling outside the notice card chrome.
    const departedNotice = buildPlannerNotice({
        tone: 'schedule',
        title: 'All Trains Departed',
        bodyHtml: `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">There are no more scheduled trains for today.</p>
            <p>Review past trips below, or check the next available schedule.</p>`,
        icon: 'moon',
        footerHtml: '',
    });

    const nextDayCta = `
        <button type="button" onclick="executeManualRollover('${safeO}', '${safeD}')" class="planner-next-day-cta w-full mb-3 bg-blue-600 hover:bg-blue-700 text-white font-black py-3 px-4 rounded-xl shadow-md transition-colors focus:outline-none flex items-center justify-center uppercase tracking-wide text-xs">
            See Next Available Day
            <svg class="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
        </button>
    `;

    container.innerHTML = `
        <div class="planner-departed-notice mb-3 [&>.planner-notice]:!mb-0 [&>.planner-notice-stack]:!mb-0">
            ${stackPlannerNotices(buildHolidayNoticeHtml(selectedTrip), departedNotice)}
        </div>
        ${nextDayCta}
        ${PlannerRenderer.buildCard(selectedTrip, false, trips, selectedIndex)}
        <div id="planner-crowd-delay-slot"></div>
    `;
    injectPlannerCrowdDelay(selectedTrip);
}

/** Next-day trips after rollover — positive bridge, not a second "all departed" notice. */
export function renderNextDayResult(container, trips, selectedIndex = 0) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return;

    const dayLabel = getPlanningDayLabel();
    updatePlannerHeader(dayLabel, true);

    let bodyHtml = `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">${showingTrainsForLine(selectedTrip)}</p>`;
    if (selectedTrip.dayOffset > 1) {
        bodyHtml = `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">No valid connections found for tomorrow.</p>
            <p>${showingTrainsForLine(selectedTrip)}</p>`;
    }

    const scheduleNotice = buildPlannerNotice({
        tone: 'schedule',
        title: 'Next Available Day',
        bodyHtml,
        icon: 'calendar',
    });

    container.innerHTML = `
        ${stackPlannerNotices(buildHolidayNoticeHtml(selectedTrip), scheduleNotice)}
        ${PlannerRenderer.buildCard(selectedTrip, true, trips, selectedIndex)}
        <div id="planner-crowd-delay-slot"></div>
    `;
    injectPlannerCrowdDelay(selectedTrip);
}

/** @deprecated Use renderNextDayResult — kept for any external callers. */
export function renderNoMoreTrainsResult(container, trips, selectedIndex = 0, _title = 'No more trains today') {
    return renderNextDayResult(container, trips, selectedIndex);
}

export function renderSundayRolloverResult(container, trips, selectedIndex = 0) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return;

    const dayLabel = getPlanningDayLabel();
    updatePlannerHeader(dayLabel, true);

    // Merge sunday-mapped holiday into this notice (no separate holiday banner).
    const holiday = getPlannerHolidayContext();
    const isHolidaySunday = !!(holiday && holiday.scheduleType === 'sunday');
    const rolloverTitle = isHolidaySunday
        ? `No Service · ${holiday.name}`
        : 'No Sunday Service';

    // No "tomorrow" line here — Sunday has no service by definition; the next
    // operating day is usually Monday (dayOffset can be >1 when Sunday is selected mid-week).
    let bodyHtml = isHolidaySunday
        ? `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Metrorail has <span class="text-blue-700 dark:text-blue-300">no service</span> on ${escapeHTML(holiday.name)}.</p>`
        : `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Metrorail does not operate on Sundays.</p>`;
    bodyHtml += `<p>${showingTrainsForLine(selectedTrip)}</p>`;

    const sundayNotice = buildPlannerNotice({
        tone: 'schedule',
        title: rolloverTitle,
        bodyHtml,
        icon: 'calendar',
    });

    container.innerHTML = `
        ${sundayNotice}
        ${PlannerRenderer.buildCard(selectedTrip, true, trips, selectedIndex)}
        <div id="planner-crowd-delay-slot"></div>
    `;
    injectPlannerCrowdDelay(selectedTrip);
}

export function renderImpossibleTodayResult(container, trips, selectedIndex = 0) {
    const selectedTrip = trips[selectedIndex];
    if (!selectedTrip) return;

    const dayLabel = getPlanningDayLabel();
    updatePlannerHeader(dayLabel, true);
    
    let bodyHtml = `<p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">Today's limited schedule does not support this exact route.</p>`;
    if (selectedTrip.dayOffset > 1) {
        bodyHtml += `<p>No valid connections were found for tomorrow.</p>`;
    }
    bodyHtml += `<p>${showingTrainsForLine(selectedTrip)}</p>`;

    const unavailableNotice = buildPlannerNotice({
        tone: 'schedule',
        title: 'Route Unavailable Today',
        bodyHtml,
        icon: 'calendar',
    });

    container.innerHTML = `
        ${stackPlannerNotices(buildHolidayNoticeHtml(selectedTrip, { absorbSunday: true }), unavailableNotice)}
        ${PlannerRenderer.buildCard(selectedTrip, true, trips, selectedIndex)}
        <div id="planner-crowd-delay-slot"></div>
    `;
    injectPlannerCrowdDelay(selectedTrip);
}

export function renderErrorCard(title, message, actionHtml = "", tone = 'warn') {
    const tones = {
        danger: {
            bar: 'border-red-500',
            title: 'text-red-800 dark:text-red-400',
            icon: 'text-red-500',
            wash: 'bg-gradient-to-b from-red-50/80 to-transparent dark:from-red-950/40 dark:to-transparent',
        },
        warn: {
            bar: 'border-amber-500',
            title: 'text-amber-900 dark:text-amber-400',
            icon: 'text-amber-500',
            wash: 'bg-gradient-to-b from-amber-50/70 to-transparent dark:from-amber-950/30 dark:to-transparent',
        },
        info: {
            bar: 'border-blue-500',
            title: 'text-blue-900 dark:text-blue-400',
            icon: 'text-blue-500',
            wash: 'bg-gradient-to-b from-blue-50/70 to-transparent dark:from-blue-950/30 dark:to-transparent',
        },
    };
    const t = tones[tone] || tones.warn;
    const iconSvg = `<svg class="w-6 h-6 ${t.icon}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    return `
        <div class="rounded-2xl border-l-4 ${t.bar} ${t.wash} p-4 mb-3 text-left">
            <div class="flex items-start justify-between gap-3 mb-2">
                <h3 class="font-black tracking-tight text-lg leading-tight ${t.title}">${title}</h3>
                <div class="shrink-0 mt-0.5">${iconSvg}</div>
            </div>
            <div class="pt-1">
                ${message}
            </div>
            <div class="mt-4 space-y-0">
                ${actionHtml}
            </div>
        </div>
    `;
}