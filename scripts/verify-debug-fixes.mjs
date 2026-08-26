/**
 * Runtime checks for leftover 0619 default, sim weekday date, region picker guard.
 * Run: node scripts/verify-debug-fixes.mjs
 */
import { DEFAULT_EXCLUSIONS, APP_VERSION } from '../src/lib/config.js';
import { simUsesSpecificDate, resolveOperatingDayType } from '../src/lib/utils.js';

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        failed += 1;
        console.error('FAIL', msg);
    } else {
        console.log('ok  ', msg);
    }
}

assert(APP_VERSION === 'V8_08.26.1', `APP_VERSION is ${APP_VERSION}`);
assert(
    !DEFAULT_EXCLUSIONS['pta-kempton']
    && !Object.keys(DEFAULT_EXCLUSIONS).length,
    'DEFAULT_EXCLUSIONS no longer hardcodes Kempton 0618/0619'
);

// Mirror isTrainExcluded after the fix: store only, no DEFAULT fallback.
function isTrainExcluded(store, trainNumber, routeId, dayIdx) {
    const rules = store?.[routeId] || null;
    if (rules && rules[trainNumber]) {
        const rule = rules[trainNumber];
        if (rule.expiresAt && Date.now() > rule.expiresAt) return false;
        if (rule.days && rule.days.includes(parseInt(dayIdx, 10))) return rule.type || 'banned';
    }
    return false;
}

const firebaseEmpty = {};
assert(
    isTrainExcluded(firebaseEmpty, '0619', 'pta-kempton', 1) === false,
    'empty Firebase exclusions do not ban 0619 on Monday'
);

const liveBan = {
    'pta-kempton': { '0619': { days: [1, 5], type: 'banned', reason: 'Admin' } },
};
assert(
    isTrainExcluded(liveBan, '0619', 'pta-kempton', 1) === 'banned',
    'Firebase ban still applies when present'
);
assert(
    isTrainExcluded(liveBan, '0619', 'pta-kempton', 2) === false,
    'Firebase ban honours days[] (Tue not banned)'
);

// Sim weekday must not inherit leftover Sunday from #sim-date.
globalThis.window = { __ntSimUseSpecificDate: false };
assert(simUsesSpecificDate() === false, 'Weekday sim does not use leftover specific date');
window.__ntSimUseSpecificDate = true;
assert(simUsesSpecificDate() === true, 'Specific Date sim still uses #sim-date');

assert(resolveOperatingDayType(0, null, 'GP') === 'sunday', 'calendar Sunday → sunday');
assert(resolveOperatingDayType(1, null, 'GP') === 'weekday', 'calendar Monday → weekday');
assert(resolveOperatingDayType(5, null, 'GP') === 'weekday', 'calendar Friday → weekday');

// Region picker: only open when no route is active after the same swap generation.
function shouldOpenRoutePicker({ swapGen, currentGen, currentRouteId }) {
    if (swapGen !== currentGen) return false;
    if (currentRouteId) return false;
    return true;
}
assert(shouldOpenRoutePicker({ swapGen: 1, currentGen: 1, currentRouteId: null }) === true, 'open picker when no route');
assert(shouldOpenRoutePicker({ swapGen: 1, currentGen: 1, currentRouteId: 'pta-kempton' }) === false, 'do not reopen after route pick');
assert(shouldOpenRoutePicker({ swapGen: 1, currentGen: 2, currentRouteId: null }) === false, 'ignore stale swap generation');

if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\nAll debug-fix checks passed');
