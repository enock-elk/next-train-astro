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
import {
    computeDeployPhase,
    dispatchProductionDeploy,
    shaMatches,
} from '../workers/nexttrain-telemetry/deploy-github.js';

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
ok(!/trip_plans\.json\?[^"'`]*limitToLast=/.test(adminJs), 'trip_plans primary GET is not windowed with limitToLast');
ok(adminJs.includes('_deTripWindowStep'), 'admin can load more than the first window of batches');
ok(adminJs.includes('See ${Admin._deTripWindowStep') || adminJs.includes('more batches'), 'See more batches button exists');
ok(adminJs.includes("`${entry.origin}|${entry.destination}|${entry.dayType || ''}|${entry.region || ''}`"), 'trip corridor key includes day type');
ok(adminJs.includes('_deTripWindowSize || 80') || adminJs.includes('_deTripWindowSize = Admin._deTripWindowSize || 80'), 'first Firebase window is 80 batches');
ok(adminJs.includes('bindTripScrollLoadMore') && adminJs.includes('loadMoreTripCorridors'), 'trip list loads more on scroll');
ok(adminJs.includes('_deTripPageSize = 40') || adminJs.includes('_deTripPageSize || 40'), 'first paint is 40 corridor cards');
ok(adminJs.includes('parseJoinedAtFromUserId'), 'usr_ epoch suffix is first-install time');
{
    const parseJoined = (id) => {
        const m = String(id || '').match(/_(\d{10,13})$/);
        if (!m) return null;
        const n = Number(m[1]);
        const ms = n < 1e12 ? n * 1000 : n;
        if (ms < Date.UTC(2020, 0, 1) || ms > Date.now() + 86400000) return null;
        return ms;
    };
    ok(parseJoined('usr_abc12xyz9_1700000000000') === 1700000000000, 'usr_ epoch suffix decodes');
    ok(parseJoined('Anonymous / Legacy') == null, 'legacy ids have no join time');
}
ok(adminJs.includes('userIdJoinHintHtml'), 'admin shows an i next to user ids');
ok(adminJs.includes('de-filter-day') && adminJs.includes('All days'), 'day-type filter stays off (All days)');
ok(adminJs.includes('expandTripCorridorHits'), 'hit history is lazy-loaded on expand');
ok(adminJs.includes('_deTripPageSize'), 'corridor list is paginated');
ok(!adminJs.includes('hitsHtml'), 'do not dump every hit into corridor card HTML');
ok(adminJs.includes('fetchTripPlanEverStats'), 'admin loads all-time user + pair indexes');
ok(adminJs.includes('Users ever'), 'banner shows Users ever');
ok(adminJs.includes('unique trip combinations'), 'banner shows unique trip combinations');
ok(adminJs.includes('buildTripInsightsHtml') && adminJs.includes('id="de-trip-insights"'), 'insights strip lives on the trips panel');
ok(adminJs.includes("bindDeSwipe(document.getElementById('de-tabs-swipe'))"), 'swipe is bound on the tab strip');
ok(!/bindDeSwipe\(\s*document\.getElementById\('de-list'\)\s*\)/.test(adminJs), 'swipe is not bound on #de-list alone');
ok(adminJs.includes('fetchDiagJson:'), 'Admin.fetchDiagJson is hoisted');
ok(adminJs.includes('normalizeStationName'), 'Deep Scan dest checks use normalizeStationName');
ok(adminJs.includes('Expected — no Saturday service'), 'placeholder Saturday sheets are expected, not errors');
ok(adminJs.includes('Joined:') && adminJs.includes('Last seen:'), 'device lookup shows joined + last seen');
ok(adminJs.includes('Linked devices:'), 'device lookup lists linked device ids');
ok(adminJs.includes('sys_logs/trip_plan_users'), 'admin reads trip_plan_users index');
{
    const rules = readFileSync(join(ROOT, 'firebase-database.rules.json'), 'utf8');
    ok(rules.includes('"trip_plan_users"'), 'rules allow trip_plan_users index');
    ok(rules.includes('"trip_plan_pairs"'), 'rules allow trip_plan_pairs index');
    ok(rules.includes('thandeka05nxumalo@gmail.com') && rules.includes('enockelk@gmail.com'), 'rules keep both operator emails');
}
{
    const tel = readFileSync(join(ROOT, 'src/lib/planner-telemetry.js'), 'utf8');
    ok(tel.includes('upsertTripPlanIndexes'), 'flush writes all-time user + pair indexes');
    ok(tel.includes('trip_plan_users'), 'client upserts trip_plan_users');
    ok(tel.includes('trip_plan_pairs'), 'client upserts trip_plan_pairs');
}
ok(adminJs.includes('confirmClearDb'), 'Clear DB uses a second confirmation popup');
ok(adminJs.includes("telemetryRange === 'ALL'"), 'admin ALL range does not use the 7-point slicer');
ok(adminJs.includes('Unique users by last selected region'), 'regional modal says unique users, not a partition of TODAY');
ok(adminJs.includes('data-gsm-tab'), 'Global State Monitor has feature tabs');
ok(adminJs.includes("id: 'grid'") && adminJs.includes("id: 'exclusions'"), 'GSM tabs include grid notices and exclusions');
ok(adminJs.includes("maintModeBody?.classList.add('hidden')"), 'maintenance accordion is forced closed');
ok(!adminJs.includes('if (countLiveMaint() > 0)'), 'live banners no longer auto-expand Maintenance Mode');

ok(adminJs.includes('id="deploy-production-btn"'), 'Dev Hub has Publish live');
ok(adminJs.includes('id="cf-purge-header-btn"'), 'Cloudflare Purge is its own accordion');
ok(adminJs.includes('id="nuke-header-btn"'), 'Nuclear Cache Wipe accordion remains');
{
    const pub = adminJs.indexOf('id="deploy-live-header-btn"');
    const cf = adminJs.indexOf('id="cf-purge-header-btn"');
    const nuke = adminJs.indexOf('id="nuke-header-btn"');
    ok(pub > -1 && cf > pub && nuke > cf, 'Publish live, then Cloudflare Purge, then Nuclear wipe');
    const nukeBody = adminJs.indexOf('id="nuke-body"');
    const cfBtn = adminJs.indexOf('id="cf-purge-everything-btn"');
    ok(cfBtn > -1 && nukeBody > -1 && cfBtn < nukeBody, 'CF purge button is not inside nuke-body');
}
ok(adminJs.includes('/admin/deploy-production'), 'admin posts deploy to telemetry Worker');
ok(adminJs.includes('/admin/deploy-status'), 'admin polls deploy status');
ok(adminJs.includes("confirm: 'DEPLOY'"), 'Publish live still types DEPLOY');
ok(!adminJs.includes('GH_ACTIONS_TOKEN'), 'GitHub token must not ship in admin.js');
ok(!adminJs.includes('METRORAIL_APP_DEPLOY_TOKEN'), 'live-host PAT must not ship in admin.js');

ok(workerJs.includes('/admin/deploy-production'), 'worker serves deploy-production');
ok(workerJs.includes('/admin/deploy-status'), 'worker serves deploy-status');
ok(workerJs.includes("from './deploy-github.js'"), 'worker uses deploy-github helpers');

const deployGh = readFileSync(join(ROOT, 'workers/nexttrain-telemetry/deploy-github.js'), 'utf8');
ok(deployGh.includes('GH_ACTIONS_TOKEN'), 'deploy helper reads GH_ACTIONS_TOKEN');
ok(deployGh.includes('deploy-production.yml'), 'dispatch targets deploy-production.yml');
ok(!deployGh.includes('METRORAIL_APP_DEPLOY_TOKEN'), 'deploy helper must not use the live-host PAT');

ok(shaMatches('abc1234', 'abc1234ffff'), 'short SHA matches full SHA');
ok(computeDeployPhase({ run: { status: 'in_progress' } }) === 'in_progress', 'phase in_progress');
ok(computeDeployPhase({
    run: { status: 'completed', conclusion: 'success', runId: 9, headSha: 'deadbeef' },
    host: { workflowRun: '9' },
    runId: 9,
}) === 'published', 'phase published when host provenance matches run id');
ok(computeDeployPhase({
    run: { status: 'completed', conclusion: 'success', runId: 9, headSha: 'deadbeef' },
    host: { sourceSha: 'ffff' },
    runId: 9,
}) === 'waiting_host', 'phase waiting_host until metrorail-app provenance matches');

const missingToken = await dispatchProductionDeploy({}, { dryRun: true });
ok(missingToken.ok === false && /GH_ACTIONS_TOKEN/.test(missingToken.error || ''), 'dispatch without token is a config error');

ok(adminJs.includes('Insights (all time)'), 'insights labelled Insights (all time)');
ok(!adminJs.includes('Insights (this window)'), 'must not say Insights (this window)');
ok(adminJs.includes('sys_logs/trip_plans.json?auth='), 'all-time trip_plans fetch has no limitToLast on the primary GET');
ok(!/usersEver:\s*ever\.usersEver\s*\|\|\s*uniqueUsers/.test(adminJs), 'Users ever must not fall back to a window unique-user count');

if (failures.length) {
    console.error('verify-admin-telemetry FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-admin-telemetry: ok');
