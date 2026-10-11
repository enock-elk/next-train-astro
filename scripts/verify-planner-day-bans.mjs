/**
 * Picked travel dates keep their weekday index. A generic Weekday chip
 * does not treat a Mon/Fri ban as every weekday. Board locate does not
 * overwrite a planner From that is already set.
 * Run: node scripts/verify-planner-day-bans.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { weekdayPatternBanApplies } from '../src/lib/live-board.js';
import { isoToWeekdayIndex, resolvePlannerExclusionDay } from '../src/lib/planner-core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = (msg) => failures.push(msg);

const tuesday = resolvePlannerExclusionDay({
    dayType: 'weekday',
    specificDate: '2026-10-13',
    offset: 0,
    startOffset: 0,
    isExplicitOverride: true,
    currentDayIdx: 0,
});
if (isoToWeekdayIndex('2026-10-13') !== 2) fail('13 Oct 2026 is a Tuesday');
if (tuesday.targetDayIdx !== 2 || tuesday.weekdayPattern) {
    fail(`Tuesday date must use day index 2, got ${JSON.stringify(tuesday)}`);
}

const mondayDate = resolvePlannerExclusionDay({
    dayType: 'weekday',
    specificDate: '2026-10-12',
    isExplicitOverride: true,
    currentDayIdx: 0,
});
if (mondayDate.targetDayIdx !== 1 || mondayDate.weekdayPattern) {
    fail(`Monday date must use day index 1, got ${JSON.stringify(mondayDate)}`);
}

const genericWeekday = resolvePlannerExclusionDay({
    dayType: 'weekday',
    specificDate: null,
    isExplicitOverride: true,
    currentDayIdx: 0,
});
if (!genericWeekday.weekdayPattern || genericWeekday.targetDayIdx !== 1) {
    fail(`generic Weekday chip must use the weekday pattern, got ${JSON.stringify(genericWeekday)}`);
}

const todayMonday = resolvePlannerExclusionDay({
    dayType: 'weekday',
    isExplicitOverride: false,
    currentDayIdx: 1,
});
if (todayMonday.weekdayPattern || todayMonday.targetDayIdx !== 1) {
    fail(`today Monday keeps index 1, got ${JSON.stringify(todayMonday)}`);
}

if (weekdayPatternBanApplies([1, 5])) fail('Mon/Fri ban must not cover the whole weekday pattern');
if (!weekdayPatternBanApplies([1, 2, 3, 4, 5])) fail('a ban on every weekday still applies');
if (!weekdayPatternBanApplies(null)) fail('a ban with no day list still applies');
if (!weekdayPatternBanApplies([])) fail('an empty day list still applies');

const ui = readFileSync(join(ROOT, 'src/lib/planner-ui.js'), 'utf8');
const boardUi = readFileSync(join(ROOT, 'src/lib/live-board-ui.js'), 'utf8');
if (!ui.includes('extContext.specificDate = selectedPlannerDate')) fail('search passes the picked date');
if (!ui.includes('restoreLastPlannerStations()')) fail('closing results restores the searched stations');
if (!ui.includes('id="planner-date-sheet-row"')) fail('the date row is the picker hit target');
if (!ui.includes('formatPlannerDateLabel')) fail('picked dates use the 13 Oct 2026 label');
if (ui.includes('Date · ${')) fail('the form must not keep the ISO date label');
if (!boardUi.includes('if (plannerFromIsSet()) return')) fail('board locate must not replace a planner From that is already set');

if (failures.length) {
    console.error('verify-planner-day-bans failed:');
    failures.forEach((msg) => console.error(' - ' + msg));
    process.exit(1);
}
console.log('verify-planner-day-bans: ok');
