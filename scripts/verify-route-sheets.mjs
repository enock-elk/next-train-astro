/**
 * Per-route Sunday and Special sheets stay off the weekday and Saturday keys
 * until that route is enabled and the tab has times.
 */
import { ROUTES } from '../src/lib/config.js';
import {
    configuredRouteSheetMode,
    effectiveRouteSheetMode,
    extraSheetKey,
    normalizeRouteSheetDates,
    routeSheetEntryApplies,
    setCachedRouteSheets,
    setRouteSheetDatabaseReader,
    suggestedSheetTab,
} from '../src/lib/route-sheets.js';
import { routeSheetKeyForDay, scheduleCacheSlot } from '../src/lib/utils.js';

let failed = 0;
function assert(cond, msg) {
    if (cond) return;
    failed += 1;
    console.error(`FAIL ${msg}`);
}

const pien = ROUTES['pta-pien'];
const mab = ROUTES['pta-mabopane'];
const kap = ROUTES['ct-kapteinsklip'];
const berlin = ROUTES['ec-berlin'];

assert(extraSheetKey(pien, 'sunday', 'a') === 'pien_to_pta_sun', 'Pienaarspoort Sunday toward Pretoria');
assert(extraSheetKey(pien, 'sunday', 'b') === 'pta_to_pien_sun', 'Pretoria Sunday toward Pienaarspoort');
assert(extraSheetKey(pien, 'special', 'b') === 'pta_to_pien_special', 'Pretoria Special toward Pienaarspoort');
assert(suggestedSheetTab(pien, 'sunday', 'a') === 'PIEN-to-PTA_Sun', 'Sunday tab name');
assert(suggestedSheetTab(pien, 'special', 'b') === 'PTA-to-PIEN_Special', 'Special tab name');
assert(extraSheetKey(berlin, 'sunday', 'b') === 'eastl_to_berln_sun', 'Eastern Cape Sunday key');
assert(!Object.values(ROUTES['kzn-crossmoor'].sheetKeys).some((key) => /_sun$|_special$/.test(key)), 'existing sheetKeys stay weekday and Saturday');

setCachedRouteSheets(null);
setRouteSheetDatabaseReader(() => null);
assert(routeSheetKeyForDay(pien, 'weekday', 'b') === 'pta_to_pien_weekday', 'weekday key unchanged');
assert(routeSheetKeyForDay(pien, 'saturday', 'a') === 'pien_to_pta_sat', 'Saturday key unchanged');
assert(routeSheetKeyForDay(pien, 'sunday', 'a') === null, 'bare Sunday does not borrow weekday');
assert(scheduleCacheSlot('sunday', 'GP', 'a') === 'weekday_to_a', 'untargeted Sunday cache slot stays weekday');
assert(routeSheetKeyForDay(kap, 'public_holiday', 'a') === kap.sheetKeys.pub_to_a, 'WC public holiday key unchanged');

setCachedRouteSheets({
    routes: {
        'pta-pien': {
            sunday: { active: true, dates: [] },
            special: { active: true, dates: ['2026-11-08'], title: 'Special service' },
        },
        'pta-mabopane': {
            special: { active: true, dates: ['2026-11-09'] },
        },
    },
});

assert(configuredRouteSheetMode('pta-pien', 'sunday', '2026-11-08') === 'special', 'special wins over Sunday on that date');
assert(configuredRouteSheetMode('pta-mabopane', 'sunday', '2026-11-08') === null, 'Mabopane is not pulled in');
assert(configuredRouteSheetMode('pta-mabopane', 'weekday', '2026-11-09') === 'special', 'another route can be special on another day');
assert(configuredRouteSheetMode('pta-pien', 'sunday', '2026-11-15') === 'sunday', 'later Sunday uses the Sunday sheet');
assert(configuredRouteSheetMode('pta-pien', 'weekday', '2026-11-09') === null, 'a one-day special does not change Monday');
assert(routeSheetEntryApplies({ active: true, dates: [] }, '2026-11-08') === true, 'empty dates stay on');
assert(normalizeRouteSheetDates('2026-11-08, 2026-11-08\n2026-11-15').join(',') === '2026-11-08,2026-11-15', 'dates are unique and sorted');

setRouteSheetDatabaseReader(() => null);
assert(effectiveRouteSheetMode(pien, 'sunday', '2026-11-08') === 'special', 'switch is trusted before the timetable download');

setRouteSheetDatabaseReader(() => ({
    pta_to_pien_special: [{ STATION: 'PRETORIA', '0601': '08:00' }],
}));
assert(effectiveRouteSheetMode(pien, 'sunday', '2026-11-08') === 'special', 'a timed special column swaps that route');
assert(routeSheetKeyForDay(pien, 'sunday', 'b', '2026-11-08') === 'pta_to_pien_special', 'board reads the special key');
assert(scheduleCacheSlot('sunday', 'GP', 'b', pien, '2026-11-08') === 'special_to_b', 'parsed slot is special_to_b');
assert(routeSheetKeyForDay(mab, 'sunday', 'a', '2026-11-08') === null, 'Mabopane Sunday stays no service');

setRouteSheetDatabaseReader(() => ({
    pien_to_pta_weekday: [{ STATION: 'PRETORIA', '0601': '05:00' }],
}));
assert(effectiveRouteSheetMode(pien, 'sunday', '2026-11-08') === null, 'special with no times does not replace the board');
assert(routeSheetKeyForDay(pien, 'weekday', 'a', '2026-11-09') === 'pien_to_pta_weekday', 'Monday stays on the weekday sheet');

setCachedRouteSheets(null);
setRouteSheetDatabaseReader(() => null);

if (failed) {
    console.error(`${failed} route-sheet check(s) failed`);
    process.exit(1);
}
console.log('route sheets ok');
