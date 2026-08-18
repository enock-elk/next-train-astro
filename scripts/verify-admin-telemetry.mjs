/**
 * Admin telemetry / GSM / Clear DB behaviour.
 * Run: node scripts/verify-admin-telemetry.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    classifyCrmRegion,
    clipIntradayCutoff,
    currentIntradayBucket,
    fillYearMonthSeries,
    sliceChartWindow,
    enumerateYearMonths,
} from '../workers/nexttrain-telemetry/chart-math.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (cond, msg) => {
    if (!cond) failures.push(msg);
    else console.log('ok  ', msg);
};

const adminJs = readFileSync(join(ROOT, 'public/js/admin.js'), 'utf8');
const workerJs = readFileSync(join(ROOT, 'workers/nexttrain-telemetry/worker.js'), 'utf8');

ok(classifyCrmRegion('GP') === 'GP', 'crm_region GP');
ok(classifyCrmRegion('gauteng') === 'GP', 'crm_region Gauteng alias');
ok(classifyCrmRegion('(not set)') === 'UNSET', 'crm_region (not set)');
ok(classifyCrmRegion('all') === 'OTHER', 'crm_region all → OTHER');

ok(currentIntradayBucket(21, 33) === 91, '21:33 SAST is today bucket 91 (21:30)');
ok(clipIntradayCutoff(84, 21, 33) === 84, 'latest GA4 row at 18:00 is kept (no 3h hide)');
ok(clipIntradayCutoff(90, 21, 33) === 90, 'latest GA4 row at 21:00 is plotted');
ok(clipIntradayCutoff(95, 21, 33) === 91, 'never plot past the current 30-min bucket');
ok(clipIntradayCutoff(-1, 21, 33) === 47, 'no today rows → yesterday only');

const months = enumerateYearMonths('202601', '202608');
ok(months[0] === '202601' && months[months.length - 1] === '202608' && months.length === 8, 'Jan–Aug 2026 is 8 months');

const filled = fillYearMonthSeries(new Map([['202603', 100], ['202608', 200]]), '202601', '202608');
ok(filled.labels[0] === '202601' && filled.counts[0] === 0, 'ALL series starts Jan 2026 even if GA has no Jan row');
ok(filled.counts[2] === 100 && filled.counts[7] === 200, 'ALL series keeps March and August values');

const allWindow = sliceChartWindow({
    range: 'ALL',
    offset: 0,
    counts: [1, 2, 3, 4, 5, 6, 7, 8],
    labels: months,
});
ok(allWindow.counts.length === 8, 'ALL chart is not sliced to 7 points like MAU');
ok(allWindow.labels[0] === '202601', 'ALL chart starts at Jan 2026');

const mauLike = sliceChartWindow({
    range: 'MAU',
    offset: 0,
    counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    labels: enumerateYearMonths('202509', '202608'),
});
ok(mauLike.counts.length === 7 && mauLike.counts[0] === 6, 'MAU still shows the last 7 months');

const intraCounts = Array.from({ length: 85 }, (_, i) => (i >= 48 ? 10 : 1));
const intraView = sliceChartWindow({
    range: 'INTRADAY',
    offset: 0,
    counts: intraCounts,
    labels: intraCounts.map(() => ''),
});
ok(intraView.counts.length === 48, 'intraday today view is 48 buckets');
ok(intraView.counts[36] === 10, '18:00 today (idx 36) is the last known value');
ok(intraView.counts[37] === null, 'hours after latest available stay unplotted (null, not a fake zero cliff)');

ok(!workerJs.includes('lagBuffer'), 'worker no longer applies a 3h lagBuffer');
ok(workerJs.includes('clipIntradayCutoff'), 'worker clips INTRADAY to latest GA4 bucket');
ok(workerJs.includes("fillYearMonthSeries(rowMap, '202601'"), 'worker fills ALL months from Jan 2026');
ok(workerJs.includes("{ name: \"sessions\" }"), 'worker fetches sessions alongside unique users');

ok(adminJs.includes("Admin._deActiveTab = 'trips'"), 'planner telemetry defaults to trip plans');
ok(adminJs.includes('id="de-tab-trips"') && adminJs.indexOf('id="de-tab-trips"') < adminJs.indexOf('id="de-tab-fails"'), 'Trip Plans tab is listed before Fails');
ok(adminJs.includes('confirmClearDb'), 'Clear DB uses a second confirmation popup');
ok(adminJs.includes("telemetryRange === 'ALL'"), 'admin ALL range does not use the 7-point slicer');
ok(adminJs.includes('Unique users by last selected region'), 'regional modal says unique users, not a partition of TODAY');
ok(adminJs.includes('data-gsm-tab'), 'Global State Monitor has feature tabs');
ok(adminJs.includes("id: 'grid'") && adminJs.includes("id: 'exclusions'"), 'GSM tabs include grid notices and exclusions');
ok(adminJs.includes("maintModeBody?.classList.add('hidden')"), 'maintenance accordion is forced closed');
ok(!adminJs.includes('if (countLiveMaint() > 0)'), 'live banners no longer auto-expand Maintenance Mode');

if (failures.length) {
    console.error('verify-admin-telemetry FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-admin-telemetry: ok');
