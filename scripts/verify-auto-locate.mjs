/**
 * Granted-only auto-locate + privacy/account ops checks.
 * Run: node scripts/verify-auto-locate.mjs
 */
import { readFileSync } from 'node:fs';
import { LEGAL_TEXTS } from '../src/lib/config.js';
import {
    boardIsReadyForAutoLocate,
    maybeAutoLocateBoard,
    resetAutoLocateDebounce,
    resetStartupLocateOverwrite,
    AUTO_LOCATE_DEBOUNCE_MS,
    GEO_GRANTED_KEY,
    stationPickerIsEngaged,
    fromStationIsClaimed,
    shouldApplySilentLocate,
    geolocationAlreadyGranted,
    isInstalledAppClient,
    rememberGeolocationGranted,
    hasRememberedGeoGrant,
} from '../src/lib/auto-locate.js';
import {
    coordsFromTimetableSheets,
    resolveStationLatLon,
} from '../src/lib/utils.js';
import { accountOpsFields } from '../src/lib/account.js';

const failures = [];
function assert(condition, message) {
    if (!condition) failures.push(message);
}

assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: 'pta-pien',
    nextTrainActive: true,
    visible: true,
}) === true, 'ready board can auto-locate');
assert(boardIsReadyForAutoLocate({
    welcomeActive: true,
    routeId: 'pta-pien',
    nextTrainActive: true,
    visible: true,
}) === false, 'Welcome blocks auto-locate');
assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: '',
    nextTrainActive: true,
    visible: true,
}) === false, 'missing route blocks auto-locate');
assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: 'pta-pien',
    nextTrainActive: false,
    visible: true,
}) === false, 'other tabs block auto-locate');
assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: 'pta-pien',
    nextTrainActive: false,
    plannerActive: true,
    visible: true,
}) === true, 'Trip Planner tab can auto-locate From');
assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: 'pta-pien',
    nextTrainActive: true,
    visible: true,
    pickerEngaged: true,
}) === false, 'open station dropdown blocks auto-locate');
assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: 'pta-pien',
    plannerActive: true,
    visible: true,
    fromAlreadySet: true,
}) === false, 'claimed From field blocks auto-locate');
assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: 'pta-pien',
    nextTrainActive: true,
    visible: false,
}) === false, 'hidden document blocks auto-locate');
assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: 'pta-pien',
    nextTrainActive: true,
    visible: true,
    fromAlreadySet: true,
}) === false, 'restored station blocks auto-locate in a browser tab');
assert(boardIsReadyForAutoLocate({
    welcomeActive: false,
    routeId: 'pta-pien',
    nextTrainActive: true,
    visible: true,
    fromAlreadySet: true,
    startupOverwrite: true,
}) === true, 'installed-app startup may refresh a restored station once');

resetAutoLocateDebounce();
let called = [];
const locate = (flag) => { called.push(flag); };
const readyOpts = {
    welcomeActive: false,
    routeId: 'pta-pien',
    nextTrainActive: true,
    visible: true,
    locate,
    now: 1_000_000,
};

assert(await maybeAutoLocateBoard({ ...readyOpts, granted: false }) === false, 'prompt/denied does not locate');
assert(called.length === 0, 'locate is not called without granted permission');
assert(await maybeAutoLocateBoard({ ...readyOpts, granted: true }) === true, 'granted permission locates');
assert(called.length === 1 && called[0] === true, 'findNearestStation(true) is used');
assert(await maybeAutoLocateBoard({ ...readyOpts, granted: true, now: 1_000_000 + AUTO_LOCATE_DEBOUNCE_MS - 1 }) === false, 'debounce skips a second locate');
resetAutoLocateDebounce();
called = [];
assert(await maybeAutoLocateBoard({
    ...readyOpts,
    nextTrainActive: false,
    plannerActive: true,
    granted: true,
    now: 3_000_000,
}) === true, 'planner tab locates From when untouched');
assert(called.length === 1 && called[0] === true, 'planner path uses findNearestStation(true)');
resetAutoLocateDebounce();
called = [];
assert(await maybeAutoLocateBoard({
    ...readyOpts,
    granted: true,
    pickerEngaged: true,
    now: 4_000_000,
}) === false, 'engaged dropdown does not locate');
assert(called.length === 0, 'locate is not called while the dropdown is open');
resetAutoLocateDebounce();
called = [];
assert(await maybeAutoLocateBoard({
    ...readyOpts,
    granted: true,
    fromAlreadySet: true,
    now: 5_000_000,
}) === false, 'already-set From does not locate');
assert(called.length === 0, 'locate is not called when From is already chosen');
resetAutoLocateDebounce();
resetStartupLocateOverwrite();
called = [];
assert(await maybeAutoLocateBoard({
    ...readyOpts,
    granted: true,
    fromAlreadySet: true,
    startupOverwrite: true,
    now: 6_000_000,
}) === true, 'installed-app startup locates over a restored station');
assert(called.length === 1 && called[0] === true, 'startup overwrite still uses findNearestStation(true)');

assert(await geolocationAlreadyGranted({ state: 'granted', remembered: false, installed: false }) === true, 'Permissions granted locates');
assert(await geolocationAlreadyGranted({ state: 'denied', remembered: true, installed: true }) === false, 'denied never locates');
assert(await geolocationAlreadyGranted({ state: 'prompt', remembered: false, installed: false }) === false, 'browser prompt does not locate');
assert(await geolocationAlreadyGranted({ state: 'prompt', remembered: false, installed: true }) === false, 'installed prompt does not locate (would open a sheet)');
assert(await geolocationAlreadyGranted({ state: 'prompt', remembered: true, installed: false }) === true, 'remembered grant locates when query is prompt');
assert(await geolocationAlreadyGranted({ state: 'unknown', remembered: false, installed: true }) === true, 'installed PWA/TWA with unknown Permissions API may locate');
assert(await geolocationAlreadyGranted({ state: 'unknown', remembered: false, installed: false }) === false, 'browser tab with unknown permission does not locate');
assert(isInstalledAppClient({ standalone: true }) === true, 'standalone display-mode is an installed client');
assert(isInstalledAppClient({ twa: true }) === true, 'Play Store TWA is an installed client');
assert(isInstalledAppClient({ standalone: false, twa: false }) === false, 'plain browser tab is not installed');
const memory = new Map();
const fakeStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, String(v)); },
};
assert(hasRememberedGeoGrant(fakeStorage) === false, 'geo grant starts unset');
rememberGeolocationGranted(fakeStorage);
assert(fakeStorage.getItem(GEO_GRANTED_KEY) === '1', 'successful GPS remembers geolocation grant');
assert(hasRememberedGeoGrant(fakeStorage) === true, 'remembered grant is readable');

const privacy = LEGAL_TEXTS.privacy;
assert(!/cookie consent banner/i.test(privacy), 'privacy does not promise a cookie banner');
assert(/already allowed location|If you allow location/i.test(privacy), 'privacy mentions already-allowed locate');
assert(/Coordinates stay on your device/i.test(privacy), 'privacy keeps GPS on device');
assert(/Trip Planner From/i.test(privacy), 'privacy mentions Trip Planner From locate');
assert(!/Anonymous Telemetry/i.test(privacy), 'privacy does not title diagnostics as anonymous telemetry');
assert(!/highly anonymized/i.test(privacy), 'privacy does not call Clarity/GA4 highly anonymized');
assert(/Trip Planner/i.test(privacy) && /device id/i.test(privacy), 'privacy describes trip-plan device id');
assert(/last time the app was open/i.test(privacy), 'privacy mentions last-open ops fields');
assert(/do not store GPS on the account/i.test(privacy), 'privacy forbids GPS on the account');

const terms = LEGAL_TEXTS.terms;
assert(!/anonymous service diagnostics/i.test(terms), 'terms do not label trip diagnostics as anonymous');
assert(/device id/i.test(terms), 'terms mention trip-plan device id');

const ops = accountOpsFields(1_800_000_000_000);
assert(ops.lastSeenAt === 1_800_000_000_000, 'ops patch has lastSeenAt');
assert('region' in ops && 'lastRouteId' in ops && 'appVersion' in ops, 'ops patch has region, lastRouteId, appVersion');
assert(!('lat' in ops) && !('lon' in ops) && !('latitude' in ops) && !('longitude' in ops), 'ops patch has no GPS keys');

const accountSrc = readFileSync(new URL('../src/lib/account.js', import.meta.url), 'utf8');
assert(accountSrc.includes('lastSeenAt') && accountSrc.includes('lastRouteId'), 'account writes ops fields');
assert(accountSrc.includes('GPS is never written'), 'account documents no GPS');
assert(!/latitude:|longitude:|coarseLat:/.test(accountSrc), 'account.js does not write coordinates');

const board = readFileSync(new URL('../src/lib/live-board-ui.js', import.meta.url), 'utf8');
assert(board.includes('maybeAutoLocateBoard'), 'live board kicks granted-only auto-locate');
assert(board.includes('bindAutoLocateTriggers'), 'live board binds visibility and tab triggers');

const locateSrc = readFileSync(new URL('../src/lib/auto-locate.js', import.meta.url), 'utf8');
assert(locateSrc.includes("name: 'geolocation'"), 'permission query is geolocation');
assert(locateSrc.includes("state === 'granted'"), 'granted permission locates');
assert(locateSrc.includes("state === 'denied'"), 'denied permission never locates');
assert(locateSrc.includes("installed && state === 'unknown'"), 'installed apps may locate when Permissions API is missing');
assert(locateSrc.includes("addEventListener('pageshow'"), 'pageshow retriggers auto-locate after PWA restore');
assert(!/navigator\.geolocation\.getCurrentPosition/.test(locateSrc), 'auto-locate helper never calls getCurrentPosition itself');
assert(locateSrc.includes("tab === 'next-train' || tab === 'trip-planner'"), 'tab trigger includes Trip Planner');

function fakeDoc({
    ntListHidden = true,
    fromListHidden = true,
    activeId = '',
    stationValue = '',
    stationSearch = '',
    plannerFrom = '',
    plannerFromSearch = '',
    plannerFromResolved = '',
} = {}) {
    const els = {
        'next-train-autocomplete-list': {
            classList: { contains: (name) => name === 'hidden' && ntListHidden },
            contains: () => false,
        },
        'planner-from-autocomplete-list': {
            classList: { contains: (name) => name === 'hidden' && fromListHidden },
            contains: () => false,
        },
        'station-select': { value: stationValue, dataset: {} },
        'station-search-input': { value: stationSearch, dataset: {} },
        'planner-from': { value: plannerFrom, dataset: {} },
        'planner-from-search': { value: plannerFromSearch, dataset: { resolvedValue: plannerFromResolved } },
    };
    const active = activeId ? { id: activeId, closest: () => null } : null;
    return {
        getElementById: (id) => els[id] || null,
        activeElement: active,
    };
}

assert(stationPickerIsEngaged(fakeDoc()) === false, 'idle pickers are not engaged');
assert(stationPickerIsEngaged(fakeDoc({ ntListHidden: false })) === true, 'open Next Train list is engaged');
assert(stationPickerIsEngaged(fakeDoc({ fromListHidden: false })) === true, 'open Trip Planner From list is engaged');
assert(stationPickerIsEngaged(fakeDoc({ activeId: 'planner-from-search' })) === true, 'focused From field is engaged');
assert(fromStationIsClaimed(fakeDoc()) === false, 'empty From fields are unclaimed');
assert(fromStationIsClaimed(fakeDoc({ stationValue: 'PRETORIA' })) === true, 'Next Train station is claimed');
assert(fromStationIsClaimed(fakeDoc({ plannerFromResolved: 'PRETORIA' })) === true, 'planner From resolved value is claimed');
assert(fromStationIsClaimed(fakeDoc({ plannerFromSearch: 'pret' })) === true, 'typed From text is claimed');
assert(shouldApplySilentLocate(fakeDoc()) === true, 'silent locate may apply to empty idle fields');
assert(shouldApplySilentLocate(fakeDoc({ ntListHidden: false })) === false, 'silent locate does not apply while the list is open');
assert(shouldApplySilentLocate(fakeDoc({ stationValue: 'PRETORIA' })) === false, 'silent locate does not apply over a chosen station');
assert(shouldApplySilentLocate(fakeDoc({ stationValue: 'PRETORIA' }), { startupOverwrite: true, installed: true }) === true, 'installed startup may overwrite a restored station');

const liveBoard = readFileSync(new URL('../src/lib/live-board.js', import.meta.url), 'utf8');
assert(liveBoard.includes('shouldApplySilentLocate'), 'GPS callback re-checks picker engagement before writing');
assert(liveBoard.includes('rememberGeolocationGranted'), 'successful GPS remembers the OS grant');
assert(liveBoard.includes('disarmStartupLocateOverwrite'), 'a successful apply spends the one-shot startup overwrite');
assert(liveBoard.includes('enableHighAccuracy: !isAuto'), 'startup auto-locate uses a fused GPS fix');
assert(liveBoard.includes("showToast(`Found: ${stationName.replace(' STATION', '')} (${distStr}km)`, \"success\")"), 'Found toast uses the green success style with station and distance');
assert(!/if\s*\(\s*!isAuto\s*\)\s*\{\s*showToast\(`Found:/.test(liveBoard), 'startup auto-locate shows the same Found toast as the locate button');
assert(/if\s*\(\s*!isAuto\s*\)\s*\{\s*showToast\("Locating nearest station/.test(liveBoard), 'Locating toast stays tap-only');
assert(liveBoard.includes('resolveStationLatLon'), 'live-board locate uses weekday coord fallback');
assert(liveBoard.includes('weekdaySheetsForRoute'), 'live-board locate reads weekday sheets');

const plannerUi = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
assert(plannerUi.includes("list.id = 'planner-from-autocomplete-list'"), 'planner From list has a stable id');
assert(plannerUi.includes('resolveStationLatLon'), 'planner locate uses weekday coord fallback');

const logicSrc = readFileSync(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
assert(logicSrc.includes('coordsFromTimetableSheets'), 'station index fills missing coords from weekday sheets');

assert(resolveStationLatLon('CAPE TOWN', { lat: null, lon: null }, []) === null, 'blank index without weekday sheets stays empty');
assert(resolveStationLatLon('CAPE TOWN', { lat: -33.92, lon: 18.42 }, [{
    STATION: 'CAPE TOWN',
    COORDINATES: '-1, 1',
}]).lat === -33.92, 'finite index coords win over weekday');

const dump = JSON.parse(readFileSync(new URL('../public/data/full-database.json', import.meta.url), 'utf8'));
const wc = dump.westerncape || {};
const pubBellv = wc.public_holidays?.ct_to_bellv_pub;
const weekBellv = wc.ct_to_bellv_weekday;
assert(Array.isArray(pubBellv) && Array.isArray(weekBellv), 'WC Bellville pub and weekday sheets are in the dump');
assert(coordsFromTimetableSheets('CAPE TOWN', [pubBellv]) === null, 'WC pub Bellville sheet has no Cape Town coordinates');
const weekCape = coordsFromTimetableSheets('CAPE TOWN', [weekBellv]);
assert(weekCape && weekCape.lat < 0 && weekCape.lon > 18, 'WC weekday Bellville sheet has Cape Town coordinates');
const fallbackCape = resolveStationLatLon('CAPE TOWN', { lat: null, lon: null }, [pubBellv, weekBellv]);
assert(fallbackCape && Math.abs(fallbackCape.lat - weekCape.lat) < 1e-9, 'locate falls back to weekday coords when pub omitted them');
const woodstockWeek = coordsFromTimetableSheets('WOODSTOCK', [wc.ct_to_hani_weekday]);
const woodstockFromPubBellv = resolveStationLatLon('WOODSTOCK', { lat: null }, [pubBellv, wc.ct_to_hani_weekday]);
assert(woodstockWeek && woodstockFromPubBellv && Math.abs(woodstockFromPubBellv.lat - woodstockWeek.lat) < 1e-9, 'weekday coords from another WC sheet fill a pub row that omitted them');

if (failures.length) {
    console.error('verify-auto-locate failed:');
    failures.forEach((failure) => console.error(' -', failure));
    process.exit(1);
}

console.log('verify-auto-locate: ok');
