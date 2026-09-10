/**
 * Report freshness, tracking window, nearby ranking.
 * Run: node scripts/verify-reports-tracking.mjs
 */
import {
    TRACKING_WINDOW_SEC,
    compareNearbyTrainLikelihood,
    isGhostTrackable,
} from '../src/lib/train-ghosts.js';
import {
    WEEKDAY_REPORT_MAX_AGE_MS,
    WEEKEND_REPORT_MAX_AGE_MS,
    reportSurfaceWindowMs,
    isReportStillLive,
    isAfterReportCurfew,
    isSameLocalDay,
    expiredReportsFromToday,
    routeHasNoScheduledTrains,
} from '../src/lib/delay-reports.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

assert(TRACKING_WINDOW_SEC === 45 * 60, 'tracking window is 45 minutes');
assert(WEEKDAY_REPORT_MAX_AGE_MS === 60 * 60 * 1000, 'weekday reports last one hour');
assert(WEEKEND_REPORT_MAX_AGE_MS === 3 * 60 * 60 * 1000, 'weekend reports keep a 3-hour window');
assert(reportSurfaceWindowMs('weekday') === WEEKDAY_REPORT_MAX_AGE_MS, 'weekday surface window');
assert(reportSurfaceWindowMs('saturday') === WEEKEND_REPORT_MAX_AGE_MS, 'saturday surface window');
assert(reportSurfaceWindowMs('sunday') === WEEKEND_REPORT_MAX_AGE_MS, 'sunday surface window');

const nowMs = Date.parse('2026-09-10T11:00:00+02:00');
const nowSec = 11 * 3600;
const fresh = {
    timestamp: nowMs - 20 * 60 * 1000,
    scheduledTime: '10:30:00',
    trainStatus: 'late',
    lateBucket: '11-20',
    statusOpen: 'open',
};
assert(isReportStillLive(fresh, { nowMs, nowSec, dayType: 'weekday' }), 'fresh weekday late report stays');

const hourOld = { ...fresh, timestamp: nowMs - 61 * 60 * 1000 };
assert(!isReportStillLive(hourOld, { nowMs, nowSec, dayType: 'weekday' }), 'weekday reports older than an hour hide');
assert(isReportStillLive(hourOld, { nowMs, nowSec, dayType: 'saturday' }), 'weekend reports can stay past one hour');

const wayPast = {
    timestamp: nowMs - 10 * 60 * 1000,
    scheduledTime: '08:00:00',
    trainStatus: 'early',
    statusOpen: 'open',
};
assert(!isReportStillLive(wayPast, { nowMs, nowSec, dayType: 'weekday' }), 'trains well past their time hide');

const finished = {
    finished: true,
    started: true,
    nowSec,
    stops: [{ seconds: nowSec - 2 * 3600 }, { seconds: nowSec - 2 * 3600 }],
};
assert(!isGhostTrackable(finished, nowSec), 'ghost two hours after last stop is not trackable');

const justArrived = {
    finished: true,
    started: true,
    nowSec,
    stops: [{ seconds: nowSec - 600 }, { seconds: nowSec - 600 }],
};
assert(isGhostTrackable(justArrived, nowSec), 'ghost 10 minutes after last stop stays trackable');

const ranked = [
    { trainId: 'far', metres: 4000, plausible: false, ghost: { finished: false } },
    { trainId: 'done', metres: 80, plausible: true, ghost: { finished: true } },
    { trainId: 'near', metres: 120, plausible: true, ghost: { finished: false } },
].sort(compareNearbyTrainLikelihood);
assert(ranked[0].trainId === 'near', 'most likely nearby train is first');
assert(ranked[1].trainId === 'done', 'just-finished trains rank after live ones');
assert(ranked[2].trainId === 'far', 'implausible trains rank last');

assert(routeHasNoScheduledTrains('sunday'), 'Sunday has no trains to report');
assert(!routeHasNoScheduledTrains('weekday', 'GP', {
    weekday_to_a: {
        headers: ['STATION', '0600'],
        rows: [{ STATION: 'PRETORIA', '0600': '06:00:00' }],
    },
}), 'weekday sheet with a clock is service');

const curfewMs = new Date(2026, 8, 10, 23, 59, 0).getTime();
assert(isAfterReportCurfew(curfewMs), '23:59 is report curfew');
assert(!isAfterReportCurfew(new Date(2026, 8, 10, 23, 58, 0).getTime()), '23:58 is still before curfew');
assert(!isReportStillLive(fresh, { nowMs: curfewMs, nowSec: 23 * 3600 + 59 * 60, dayType: 'weekday' }), 'live reports hide at 23:59');

const morning = new Date(2026, 8, 10, 11, 0, 0).getTime();
const staleToday = {
    timestamp: new Date(2026, 8, 10, 7, 0, 0).getTime(),
    scheduledTime: '06:30:00',
    trainStatus: 'late',
    lateBucket: '1-5',
    statusOpen: 'open',
};
assert(isSameLocalDay(staleToday.timestamp, morning), 'stale report is still today');
assert(!isReportStillLive(staleToday, { nowMs: morning, nowSec: 11 * 3600, dayType: 'weekday' }), 'hour-plus morning report is not live');
const expired = expiredReportsFromToday([staleToday], { nowMs: morning, nowSec: 11 * 3600, dayType: 'weekday' });
assert(expired.length === 1, 'expired accordion keeps today’s stale reports');
assert(expiredReportsFromToday([fresh], { nowMs, nowSec, dayType: 'weekday' }).length === 0, 'live reports stay out of expired');
assert(expiredReportsFromToday([staleToday], { nowMs: curfewMs }).length === 0, 'expired accordion also hides at 23:59');

if (failures.length) {
    console.error('verify-reports-tracking failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-reports-tracking: ok');
