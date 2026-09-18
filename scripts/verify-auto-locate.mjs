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
    AUTO_LOCATE_DEBOUNCE_MS,
} from '../src/lib/auto-locate.js';
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
    nextTrainActive: true,
    visible: false,
}) === false, 'hidden document blocks auto-locate');

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
assert(await maybeAutoLocateBoard({ ...readyOpts, granted: true, now: 2_000_000 }) === true, 'debounce resets');

const privacy = LEGAL_TEXTS.privacy;
assert(!/cookie consent banner/i.test(privacy), 'privacy does not promise a cookie banner');
assert(/already allowed location|If you allow location/i.test(privacy), 'privacy mentions already-allowed locate');
assert(/Coordinates stay on your device/i.test(privacy), 'privacy keeps GPS on device');
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
assert(locateSrc.includes("state === 'granted'"), 'only granted permission locates');
assert(!locateSrc.includes('getCurrentPosition'), 'auto-locate helper never calls getCurrentPosition itself');

if (failures.length) {
    console.error('verify-auto-locate failed:');
    failures.forEach((failure) => console.error(' -', failure));
    process.exit(1);
}

console.log('verify-auto-locate: ok');
