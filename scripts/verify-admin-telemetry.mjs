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
    isoWeekKey,
    adSpanForLabels,
    alignAdSeries,
    equivalentPeriodTrend,
    equivalentViewability,
    seriesTrend,
    viewabilityTrend,
} from '../workers/nexttrain-telemetry/chart-math.js';
import {
    assignReportingDevice,
    countsForDay,
    hashDeviceId,
    johannesburgDay,
    parsePresenceBody,
    presenceOriginAllowed,
    retentionFloorDay,
    sentryStatusFromResult,
} from '../workers/nexttrain-telemetry/region-presence.js';
import { handleRegionPresence, readRegionalSplit, resolveRegionalDay } from '../workers/nexttrain-telemetry/region-store.js';
import { formatFeedbackDiagLine, stationChoiceLabel } from '../src/lib/feedback-diag-line.js';
import {
    computeDeployPhase,
    dispatchProductionDeploy,
    shaMatches,
} from '../workers/nexttrain-telemetry/deploy-github.js';
import { cleverWindows, mergeCleverParts } from '../workers/nexttrain-telemetry/clever-ads.js';

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
ok(workerJs.includes('AbortSignal.timeout(6000)'), 'a slow GA4 report cannot hold Live Telemetry');
ok(workerJs.includes('minuteRanges'), '5-minute GA4 tile uses a realtime minute range');
ok(workerJs.includes('gaParts'), 'one rejected GA4 query does not blank the other tiles');
ok(workerJs.includes('metricAggregations: ["TOTAL"]'), '7-day, 30-day, and all-time read the deduplicated total');
ok(!workerJs.includes('int64Value'), 'the minutesAgo numeric filter is gone');
ok(readFileSync(join(ROOT, 'public/js/admin.js'), 'utf8').includes('telemetry-ga-detail'), 'Live Telemetry shows the GA4 error');
ok(readFileSync(join(ROOT, 'src/components/HubModals.astro'), 'utf8').includes('id="telemetry-ga-detail"'), 'telemetry panel has a GA4 error line');
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
ok(adminJs.includes("if (Admin._deActiveTab !== 'trips') return") && adminJs.includes('appendTripCorridorCards'), 'trip infinite-scroll does not paint onto Fares');
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
ok(adminJs.includes('openCommuterPeek'), 'i opens a user sheet modal');
ok(adminJs.includes("modal.id = 'admin-commuter-peek'"), 'user sheet modal id is admin-commuter-peek');
ok(adminJs.includes('collectCommuterPeek'), 'user sheet uses cheap per-id reads');
{
    const peekAt = adminJs.indexOf('collectCommuterPeek: async');
    const peekSlice = adminJs.slice(peekAt, peekAt + 12000);
    ok(peekSlice.includes('sys_logs/fare_votes.json'), 'user sheet loads fare votes when the cache is cold');
    ok(peekSlice.includes('sys_logs/routing_fails.json'), 'user sheet loads routing fails when the cache is cold');
    ok(peekSlice.includes('sys_logs/fare_ticket_photos.json'), 'user sheet loads ticket photos when the cache is cold');
    ok(peekSlice.includes('fareLine') && peekSlice.includes('Fares'), 'user sheet always names fares');
    ok(adminJs.includes("tile('Fares'") && adminJs.includes("tile('Crashes'"), 'user sheet always prints fares and crashes');
}
{
    const exportAt = adminJs.indexOf('Admin.exportCrashesTxt = () => {');
    const exportEnd = adminJs.indexOf('if (exportBtn) exportBtn.onclick', exportAt);
    const exportSlice = adminJs.slice(exportAt, exportEnd);
    ok(exportSlice.includes('Line:') && exportSlice.includes('Script:') && exportSlice.includes('Stack:'), 'crash export always prints line, script, and stack');
    ok(exportSlice.includes('(not recorded)'), 'crash export marks a missing script address');
}
{
    const uiJs = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
    ok(!uiJs.includes('Invalid or unexpected token'), 'Invalid or unexpected token is still reported');
    ok(uiJs.includes("card.style.transition = 'none'"), 'a dismissed bottom sheet does not animate back into the fade');
}
ok(adminJs.includes('Look up more'), 'user sheet can hand off to User Trust search');
ok(adminJs.includes('commuter-peek-feedback'), 'feedback tile opens the thread');
ok(adminJs.includes('Last activity:'), 'user sheet shows latest activity');
ok(adminJs.includes("Admin.startFeedbackChat(did, '')"), 'grey feedback tile can start a chat');
ok(adminJs.includes('commuter-peek-trips'), 'trip plans tile opens plans');
ok(!adminJs.includes('commuter-peek-chat'), 'user sheet has no Open chat button');
ok(adminJs.includes('ut-tab-deletions') && adminJs.includes('ut-pane-deletions'), 'deletion requests live in User Trust');
ok(!adminJs.includes("panel.id = 'account-deletions-panel'"), 'deletion requests are not a separate grid tile');
ok(adminJs.includes('ut-unread-badge'), 'User Trust tile has a deletion badge');
ok(adminJs.includes('purgeAccountDeletion'), 'User Trust deletions purge RTDB user data');
ok(adminJs.includes('reclassifyPlannerFare'), 'fare votes can be reclassified by admin');
ok(adminJs.includes('admin-changelog-meta') || adminJs.includes("id=\"admin-changelog-meta\""), 'version modal shows route/station meta');
ok(!/showJoinedHint:[\s\S]{0,180}showToast\(label/.test(adminJs), 'i no longer only toasts the join date');
ok(adminJs.includes('de-filter-day') && adminJs.includes('All days'), 'day-type filter stays off (All days)');
ok(adminJs.includes('expandTripCorridorHits'), 'hit history is lazy-loaded on expand');
ok(adminJs.includes('_deTripPageSize'), 'corridor list is paginated');
ok(!adminJs.includes('hitsHtml'), 'do not dump every hit into corridor card HTML');
ok(adminJs.includes('fetchTripPlanEverStats'), 'admin loads all-time user + pair indexes');
ok(adminJs.includes('Users ever'), 'banner shows Users ever');
ok(adminJs.includes('unique trip combinations'), 'banner shows unique trip combinations');
ok(adminJs.includes('buildTripInsightsHtml') && adminJs.includes('id="de-trip-insights"'), 'insights strip lives on the trips panel');
ok(adminJs.includes('rollupTopCorridors') && adminJs.includes('corridorStopKey'), 'top corridors roll one row per origin and destination');
ok(!adminJs.includes('const top = (sorted || []).slice(0, 5)'), 'top corridors are not the raw day-split list');
ok(adminJs.includes("bindDeSwipe(document.getElementById('de-tabs-swipe'))"), 'swipe is bound on the tab strip');
ok(!/bindDeSwipe\(\s*document\.getElementById\('de-list'\)\s*\)/.test(adminJs), 'swipe is not bound on #de-list alone');
ok(adminJs.includes('fetchDiagJson:'), 'Admin.fetchDiagJson is hoisted');
ok(adminJs.includes('normalizeStationName'), 'Deep Scan dest checks use normalizeStationName');
ok(adminJs.includes('Expected — no Saturday service'), 'placeholder Saturday sheets are expected, not errors');
ok(adminJs.includes("infoRow('Joined'") && adminJs.includes("infoRow('Last activity'") && adminJs.includes('joinedLabel'), 'device lookup splits joined and last activity');
ok(adminJs.includes("'Linked devices'"), 'device lookup lists linked device ids');
ok(adminJs.includes('sys_logs/trip_plan_users'), 'admin reads trip_plan_users index');
ok(adminJs.includes('feedbackDeviceHasTripPlans'), 'feedback list can mark devices that have trip plans');
ok(adminJs.includes("title=\"Has trip plans\""), 'trip-plans presence uses the same scan-icon row as email and phone');
ok(adminJs.includes("Admin.icon('map', 'w-3 h-3')"), 'trip-plans indicator is the map SVG at mail/phone size');
{
    const rules = readFileSync(join(ROOT, 'firebase-database.rules.json'), 'utf8');
    ok(rules.includes('"trip_plan_users"'), 'rules allow trip_plan_users index');
    ok(rules.includes('"trip_plan_pairs"'), 'rules allow trip_plan_pairs index');
    ok(rules.includes('"fare_votes"'), 'rules allow fare_votes create-once log');
    ok(rules.includes('"planner_fares"'), 'rules allow public-read planner_fares');
    ok(rules.includes('"route_fares"'), 'rules allow public-read route_fares');
    ok(rules.includes('"fare_ticket_photos"'), 'rules allow fare_ticket_photos create-once sidecar');
    ok(rules.includes('thandeka05nxumalo@gmail.com') && rules.includes('enockelk@gmail.com'), 'rules keep both operator emails');
}
{
    const tel = readFileSync(join(ROOT, 'src/lib/planner-telemetry.js'), 'utf8');
    ok(tel.includes('upsertTripPlanIndexes'), 'flush writes all-time user + pair indexes');
    ok(tel.includes('trip_plan_users'), 'client upserts trip_plan_users');
    ok(tel.includes('trip_plan_pairs'), 'client upserts trip_plan_pairs');
    ok(tel.includes('sys_logs/fare_votes'), 'client writes fare_votes immediately');
    ok(tel.includes('fare_ticket_photos'), 'client can write fare_ticket_photos sidecar');
}
ok(adminJs.includes('confirmClearDb'), 'Clear DB uses a second confirmation popup');
ok(adminJs.includes("telemetryRange === 'ALL'"), 'admin ALL range does not use the 7-point slicer');
ok(adminJs.includes('Reporting devices by selected region'), 'regional modal names reporting devices');
ok(adminJs.includes('Reporting devices today:'), 'regional modal total is reporting devices');
ok(adminJs.includes('id="region-day-prev"') && adminJs.includes('/admin/region-split'), 'regional modal can open a previous Johannesburg day');
ok(adminJs.includes('id="ut-accounts-region"') && adminJs.includes('break-words'), 'account list filters by region and keeps the full name');
ok(adminJs.includes('id="event-tab-sheets"') && !adminJs.includes('id="route-sheet-panel"'), 'route sheets live inside the special event panel');
ok(adminJs.includes('People today (Analytics):'), 'Analytics people stay beside the exact split');
ok(!adminJs.includes('No region on the hit'), 'regional modal no longer shows an overlapping unset bucket');
ok(adminJs.includes('hideRegionNote'), 'an exact Worker split clears the overlapping-region warning');
ok(adminJs.includes('previous overlapping region report'), 'a legacy Worker payload still explains the old cards');
ok(adminJs.includes("stationChoiceLabel") || adminJs.includes("(${autoFlag ? 'Auto' : 'man'})"), 'build notes name the station as (man) or (auto)');
{
    const hubJs = readFileSync(join(ROOT, 'src/lib/hub.js'), 'utf8');
    const stationSpreads = hubJs.split('...await messagePlaceFields()').length - 1;
    ok(stationSpreads >= 5, 'feedback form, Feedback Hub, and the inbox copy store the closest station');
    ok(hubJs.includes('captureSenderStation') && hubJs.includes('getBoardStationContext'), 'a missing GPS fix still stores the home-board station');
    ok(adminJs.includes('item.station = hit.msg.station'), 'an inbox copy can fill a feedback row that has no station');
    ok(adminJs.includes('station: msg.station'), 'an inbox-only message keeps the home-board station');
}
ok(adminJs.includes("data.metric !== 'reportingDevices'"), 'old overlapping Worker payloads are not labelled as an exact split');
ok(workerJs.includes('readRegionalSplit'), 'worker reads the exact regional split');
ok(workerJs.includes("pathname === '/region-presence'"), 'worker accepts the region presence beacon');
ok(workerJs.includes('sentryStatusFromResult'), 'worker separates Sentry status from the count');
ok(!/dimensions:\s*\[\{\s*name:\s*"customUser:crm_region"/.test(workerJs), 'regional cards no longer come from overlapping GA rows');
ok(adminJs.includes('SENTRY TODAY'), 'error tile is Sentry today');
ok(adminJs.includes('App diagnostics, last 24h'), 'Firebase diagnostics stay a separate 24h list');
ok(!adminJs.includes('est. @ sample'), 'Firebase rows are not presented as a Sentry sample estimate');
ok(adminJs.includes('id="admin-changelog-diag"'), 'build notes modal has a diagnostics line');
ok(adminJs.includes('data-cl-diag='), 'version chip carries the diagnostics line');
ok(!adminJs.includes('diagHtml'), 'feedback card no longer repeats the diagnostics line');
ok(adminJs.includes("chartPanel.id = 'telemetry-chart-panel'"), 'telemetry chart is an admin drill subview');
ok(adminJs.includes("Admin.deepLinkToPanel('telemetry-chart-panel')"), 'chart enters through history-aware admin navigation');
ok(adminJs.includes("chartPanel.dataset.adminSubview = 'true'"), 'analytics subview is excluded from the admin tile grid');
ok(adminJs.includes("chartPanel = document.createElement('div')"), 'analytics subview is a grid-compatible div, not a section');
ok(!adminJs.includes("document.createElement('section')"), 'admin home no longer creates a section that bypasses tile-hide CSS');
ok(adminJs.includes('restoreGridChildLayout'), 'packing the tile grid restores layout through one helper');
ok(adminJs.includes('.admin-grid-view > [data-admin-subview="true"]'), 'hide CSS matches any admin subview child, not only divs');
ok(!adminJs.includes("chartModal.id = 'telemetry-chart-modal'"), 'telemetry chart overlay modal is removed');
ok(adminJs.includes('100dvh') && adminJs.includes('landscape:'), 'analytics drill responds to portrait and landscape viewports');
{
    const astroConfig = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
    ok(!astroConfig.includes("orientation: 'portrait'"), 'PWA manifest no longer locks portrait orientation');
}
ok(adminJs.includes('data-gsm-tab'), 'State Monitor has feature tabs');
ok(adminJs.includes('State Monitor'), 'State Monitor title is State Monitor');
ok(adminJs.includes('gsm-sort'), 'State Monitor has a sort control');
ok(adminJs.includes("id: 'grid'") && adminJs.includes("id: 'exclusions'"), 'GSM tabs include grid notices and exclusions');
ok(adminJs.includes("maintModeBody?.classList.add('hidden')"), 'maintenance accordion is forced closed');
ok(adminJs.includes('collapseSystemControlAccordions'), 'System Control reopens with every accordion closed');
ok(adminJs.includes("'exp-features-body'"), 'experimental features accordion is included in the collapse set');
ok(adminJs.includes("'community-body'") && adminJs.includes('id="community-body" class="hidden'), 'Community in System Controls opens collapsed');
ok(adminJs.includes(".exp-feat-body") || adminJs.includes('.exp-feat-body'), 'nested feature accordions collapse with System Control');
ok(adminJs.includes('bindGsmSwipe'), 'Global State Monitor binds swipe between tabs');
ok(adminJs.includes("bindGsmSwipe(document.getElementById('gsm-list'))"), 'GSM swipe works on the item list');
ok(adminJs.includes('Snapshot generated: ${Admin.formatDate(Date.now())}'), 'DAU export uses 12 Sept dates');
ok(adminJs.includes('_telemetryExportFrame'), 'snapshot and chart share one export frame');
ok(adminJs.includes("background:#F2F2F7"), 'export cards sit on a grouped gray canvas');
ok(adminJs.includes('border-radius:22px'), 'export card uses a large continuous corner');
ok(adminJs.includes('_telemetryExportFooterHtml'), 'snapshot and chart share the same footer');
ok(!adminJs.includes('Verified by Google Analytics'), 'export footer no longer uses the verified pill');
ok(adminJs.includes('>Live Telemetry<'), 'snapshot title is title case, not all caps');
ok(adminJs.includes('nt-export-heading'), 'chart title sits on the grouped canvas above the card');
ok(adminJs.includes("'height:auto'") && adminJs.includes("'overflow:hidden'"), 'export frame clips to content');
ok(adminJs.includes('id="de-tab-fares"'), 'planner telemetry has a Fares tab');
ok(adminJs.includes('id="de-tab-trips"') && adminJs.indexOf('id="de-tab-fails"') < adminJs.indexOf('id="de-tab-fares"'), 'Fails tab is listed before Fares');
ok(adminJs.includes('sys_logs/fare_votes'), 'admin reads fare_votes');
ok(adminJs.includes('smoothKm') && adminJs.includes('abKm'), 'Fares tab exports smooth and A-B km');
ok(!adminJs.includes('· A-B '), 'Fares list does not show straight-line A-B');
ok(adminJs.includes('Saved corrections'), 'Fares tab keeps a saved corrections section');
ok(adminJs.includes('>Refuted ('), 'Fares tab has a refuted accordion');
ok(adminJs.includes("row.review !== 'refuted'"), 'refuted fare votes stay out of the accuracy percentage');
ok(adminJs.includes('User Accounts &amp; Bans'), 'the accounts panel is titled User Accounts & Bans');
ok(adminJs.indexOf('id="ut-tab-accounts"') < adminJs.indexOf('id="ut-tab-lookup"') && adminJs.indexOf('id="ut-tab-lookup"') < adminJs.indexOf('id="ut-tab-bans"') && adminJs.indexOf('id="ut-tab-bans"') < adminJs.indexOf('id="ut-tab-deletions"'), 'account tabs run Account, Lookup, Bans, Deletions');
ok(adminJs.indexOf('id="ut-pane-bans"') < adminJs.indexOf('id="shadow-ban-default-body"') && adminJs.indexOf('id="shadow-ban-default-body"') < adminJs.indexOf('id="ut-pane-deletions"'), 'default ban mode sits on the Bans tab');
ok(adminJs.includes('id="ut-accounts-count"'), 'account list shows a total');
ok(adminJs.includes('ut-community-max'), 'lookup can raise a community send limit');
ok(adminJs.indexOf('id="holiday-approvals-body"') < adminJs.indexOf('id="sched-override-header"') && adminJs.indexOf('id="sched-override-header"') < adminJs.indexOf('id="holiday-approvals-list"') + 2500, 'force schedule type sits in Holiday Notices');
ok(adminJs.includes("review: 'saved'"), 'saving a fare correction files it as saved');
ok(adminJs.includes('Admin.approvePlannerFare'), 'Fares tab can approve a correction');
ok(adminJs.includes('config/planner_fares/'), 'Approve writes config/planner_fares/$key');
ok(adminJs.includes('de-fare-approve'), 'correction cards have an Approve button');
ok(adminJs.includes('Live R'), 'already-approved corrections show Live');
ok(adminJs.includes('Confirmed corridor fares'), 'Fares tab lists confirmed corridor long fares');
ok(adminJs.includes('Admin.saveRouteFare'), 'Fares tab can confirm a corridor long fare');
ok(adminJs.includes('config/route_fares/'), 'Confirm writes config/route_fares/$routeId');
ok(adminJs.includes('de-fare-ticket'), 'vote cards can show a ticket thumb');
ok(adminJs.includes('fare_ticket_photos'), 'Fares tab reads ticket photo sidecars');
ok(adminJs.includes("Admin._deSortMode = Admin._deSortMode || 'recent'"), 'planner telemetry starts on recent sort');
ok(!adminJs.includes("Admin._deSortMode = 'count';"), 'opening planner telemetry does not reset sort to count');
ok(adminJs.includes('expandFailCorridorHits'), 'Fails expand contributor user ids on click');
ok(adminJs.includes('stackedContributorRowHtml'), 'planner contributor rows stack id above date');
ok(!adminJs.includes("(h.userId || '').slice(0, 14)"), 'trip hit history does not slice user ids');
ok(!/font-mono text-gray-500 truncate inline-flex[\s\S]{0,80}esc\(h\.userId\)/.test(adminJs), 'fail contributors no longer truncate user id against the date');
ok(adminJs.includes('inferCommuterDefaultRoute'), 'fares infer a default/saved route');
ok(adminJs.includes('Route: ${secureEscape(defaultRouteLabel)}'), 'Fares cards paint default route');
ok(adminJs.includes('commuterLabelHtml'), 'admin paints feedback alias instead of raw user id');
ok(adminJs.includes('ensureAliasesLoaded'), 'aliases load without opening Feedback first');
ok(adminJs.includes('openFeedbackForDevice'), 'user lookup can jump to the feedback thread');
ok(adminJs.includes('startFeedbackChat'), 'user lookup can start a feedback chat');
ok(adminJs.includes('collectCommuterProfile'), 'user lookup builds a profile from known user data');
ok(adminJs.includes('ut-open-chat-btn'), 'user lookup has Open chat');
ok(adminJs.includes('ut-open-trips-btn'), 'user lookup has Open trip plans');
ok(adminJs.includes('ut-open-fares-btn'), 'user lookup has Open fare votes');
ok(adminJs.includes('ut-open-fails-btn'), 'user lookup has Open fails');
ok(adminJs.includes('ut-open-crashes-btn'), 'user lookup has Open crashes');
ok(adminJs.includes('ut-open-bans-btn'), 'user lookup has Open bans');
ok(adminJs.includes('ut-start-chat-btn'), 'user lookup has Start chat / Reply');
ok(adminJs.includes('openPlannerTelemetryForDevice'), 'user lookup can jump to planner telemetry for a device');
ok(adminJs.includes('fareTicketUrls'), 'user lookup counts ticket photos on the profile');
ok(adminJs.includes('mailto:'), 'user lookup makes emails clickable');
ok(adminJs.includes('Open ticket'), 'fare cards link out to the uploaded ticket image');
ok(adminJs.includes('Quoted Single'), 'fare cards spell that the board quote is Single');
ok(adminJs.includes("'ticketType', 'quotedTicketType'"), 'CSV export includes ticketType and quotedTicketType');
ok(adminJs.includes('Collect-only for now'), 'weekly/monthly corrections are collect-only in admin');
ok(adminJs.includes('_alertLiveCountGen'), 'alert composer live-count fetch uses a generation guard');
ok(adminJs.includes('Checking live posts on'), 'alert composer paints audience labels before the live-count fetch returns');
ok(adminJs.includes('expandFareContributor'), 'Fares expand contributor user ids on click');
ok(adminJs.includes('de-fail-contributors'), 'fail cards have a contributor panel');
ok(adminJs.includes('de-fare-contributors'), 'fare cards have a contributor panel');
ok(adminJs.includes('failCorridorKey'), 'fail corridor key matches origin dest reason day');
ok(adminJs.includes('item.versions') && adminJs.includes('No version'), 'fail cards show the app version');
ok(adminJs.includes('h.appVersion'), 'fail contributors show the app version');
ok(/class="hidden divide-y[\s\S]{0,180}\$\{resolveAllHtml\}/.test(adminJs), 'Resolve All sits inside the opened crash log');
ok(!/flex items-center shrink-0">\s*\$\{resolveAllHtml\}/.test(adminJs), 'Resolve All is not on the collapsed crash header');
ok(adminJs.includes('App: ${appVersionHtml}'), 'crash app version is a dedicated chip field');
ok(adminJs.includes('data-admin-changelog="${safeAppVersion}"'), 'crash app version opens build notes');
{
    const bridge = readFileSync(join(ROOT, 'src/lib/admin-bridge.js'), 'utf8');
    ok(bridge.includes('window.plannerFareOverrideKey'), 'admin bridge exposes override keys');
    ok(bridge.includes('window.buildPlannerFareOverrideRecord'), 'admin bridge exposes override records');
    ok(bridge.includes('window.buildRouteFareRecord'), 'admin bridge exposes corridor fare records');
    ok(bridge.includes('window.dumpZoneForRoute'), 'admin bridge exposes dump corridor zones');
}
ok(adminJs.includes("['trips', 'fails', 'fares']"), 'swipe walks three planner telemetry tabs');
ok(adminJs.includes('de-trip-hour-bars') && adminJs.includes('de-trip-od-heat'), 'planner insights include hour bars and an OD heatmap');
ok(adminJs.includes('de-trip-dep-bars') && adminJs.includes('de-trip-xfer'), 'planner insights include departure-hour and transfer charts');
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

ok(adminJs.includes('openAliasModal'), 'commuter alias opens a modal');
ok(adminJs.includes('editedAt: Date.now()'), 'admin reply edit writes editedAt');
ok(adminJs.includes('inbox/${encodeURIComponent(replyDeviceId)}/${encodeURIComponent(editingKey)}.json'), 'edit PATCHes inbox/{deviceId}/{msgKey}');
ok(adminJs.includes("from: 'admin'"), 'admin send tags from admin');
ok(adminJs.includes("String(msg.from || '') !== 'commuter'"), 'inbox fold does not swallow untagged admin replies');
ok(!adminJs.includes("icon('more'"), 'feedback Options dropped the more icon');

ok(johannesburgDay(Date.UTC(2026, 10, 6, 21, 59)) === '2026-11-06', '21:59 UTC is still 6 Nov in Johannesburg');
ok(johannesburgDay(Date.UTC(2026, 10, 6, 22, 0)) === '2026-11-07', '22:00 UTC rolls to 7 Nov in Johannesburg');
ok(retentionFloorDay(Date.UTC(2026, 10, 7, 10, 0), 35) === '2026-10-03', 'presence rows older than 35 Johannesburg days are eligible for deletion');
ok(parsePresenceBody(JSON.stringify({ deviceId: 'usr_abc12xyz9_1700000000000', region: 'gp' })).region === 'GP', 'presence region is canonical');
ok(parsePresenceBody('{"region":"ALL","deviceId":"usr_abc12xyz9_1700000000000"}').ok === false, 'unknown region is rejected');
ok(parsePresenceBody('{"region":"GP","deviceId":"K"}').ok === false, 'short device id is rejected');
ok(presenceOriginAllowed('https://nexttrain.co.za') === true, 'production origin can report');
ok(presenceOriginAllowed('https://preview-1.next-train-lab.pages.dev') === true, 'lab preview origin can report');
ok(presenceOriginAllowed('https://evil.example') === false, 'foreign origin cannot report');
{
    const hashA = await hashDeviceId('usr_abc12xyz9_1700000000000', 'pepper-a');
    const hashB = await hashDeviceId('usr_abc12xyz9_1700000000000', 'pepper-b');
    ok(hashA.length === 64 && hashA !== hashB, 'device hash is a peppered digest');
    ok(!hashA.includes('usr_abc12xyz9_1700000000000'), 'device hash does not keep the browser id');
}
{
    const now = Date.UTC(2026, 10, 7, 8, 0);
    const day = johannesburgDay(now);
    let rows = assignReportingDevice(new Map(), {
        day, deviceHash: 'h1', region: 'GP', now, retentionFloor: '2026-10-03',
    });
    rows = assignReportingDevice(rows, {
        day, deviceHash: 'h1', region: 'WC', now: now + 1000, retentionFloor: '2026-10-03',
    });
    rows = assignReportingDevice(rows, {
        day: '2026-09-01', deviceHash: 'old', region: 'EC', now, retentionFloor: '2026-10-03',
    });
    const counts = countsForDay(rows, day);
    ok(counts.GP === 0 && counts.WC === 1 && counts.total === 1, 'a region change moves the device instead of double counting');
    ok(!rows.has('2026-09-01\0old'), 'assignment helper drops rows before the retention floor');
}
{
    const zero = sentryStatusFromResult({ configured: true, ok: true, count: 0 });
    const missing = sentryStatusFromResult({ configured: false });
    const failed = sentryStatusFromResult({ configured: true, ok: false, detail: 'Bearer secret-token rejected' });
    ok(zero.sentryStatus === 'zero' && zero.todayErrors === '0', 'a real Sentry zero stays zero');
    ok(missing.sentryStatus === 'unconfigured' && missing.todayErrors === '--', 'missing Sentry config is not a zero');
    ok(failed.sentryStatus === 'error' && !failed.sentryErrorDetail.includes('secret-token'), 'Sentry error detail redacts bearer tokens');
}
ok(stationChoiceLabel('PRETORIA', false) === 'Pretoria (man)', 'a manual station is Pretoria (man)');
ok(stationChoiceLabel('LENZ', true) === 'Lenz (Auto)', 'an auto-located station is Lenz (Auto)');
ok(stationChoiceLabel('', false) === '', 'a missing station is not called Manual station');
ok(formatFeedbackDiagLine({
    phone: 'K', network: 'mobile', signal: 'weak', viewport: '384x748',
}) === 'Mobile network · Weak signal · 384 × 748', 'one-letter handset token is left off and the rest is readable');
ok(formatFeedbackDiagLine({
    phone: 'iPhone', network: 'wifi', signal: 'excellent', viewport: '390x844',
}) === 'iPhone · Wi-Fi · Excellent signal · 390 × 844', 'a real handset name stays on the diagnostics line');
{
    function memoryPresenceDb() {
        const rows = new Map();
        return {
            prepare(sql) {
                let args = [];
                const stmt = {
                    bind(...bound) { args = bound; return stmt; },
                    async run() {
                        if (sql.startsWith('INSERT')) {
                            const [day, deviceHash, region, firstSeen, lastSeen] = args;
                            const key = `${day}\0${deviceHash}`;
                            const prev = rows.get(key);
                            rows.set(key, prev ? { ...prev, region, lastSeen } : { day, deviceHash, region, firstSeen, lastSeen });
                        } else if (sql.startsWith('DELETE')) {
                            const floor = args[0];
                            for (const [key, row] of rows) if (row.day < floor) rows.delete(key);
                        }
                        return { success: true };
                    },
                    async all() {
                        const day = args[0];
                        const counts = new Map();
                        for (const row of rows.values()) {
                            if (row.day !== day) continue;
                            counts.set(row.region, (counts.get(row.region) || 0) + 1);
                        }
                        return { results: [...counts].map(([region, n]) => ({ region, n })) };
                    },
                };
                return stmt;
            },
            batch(statements) { return Promise.all(statements.map((s) => s.run())); },
        };
    }
    const now = Date.UTC(2026, 10, 7, 8, 0);
    const db = memoryPresenceDb();
    const env = { REGION_PRESENCE_DB: db, REGION_PRESENCE_PEPPER: 'test-pepper' };
    const post = (body, origin = 'https://nexttrain.co.za') => handleRegionPresence(new Request('https://nexttrain-telemetry.enock.workers.dev/region-presence', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }), env, now);
    const first = await post({ deviceId: 'usr_abc12xyz9_1700000000000', region: 'GP' });
    const moved = await post({ deviceId: 'usr_abc12xyz9_1700000000000', region: 'WC' });
    const other = await post({ deviceId: 'usr_otherdevice_1700000000001', region: 'KZN' });
    const blocked = await post({ deviceId: 'usr_abc12xyz9_1700000000000', region: 'GP' }, 'https://evil.example');
    const invalid = await post({ deviceId: 'nope', region: 'GP' });
    const split = await readRegionalSplit(db, now);
    const yesterday = resolveRegionalDay(now, '2026-11-06');
    const future = resolveRegionalDay(now, '2026-11-08');
    const pastSplit = await readRegionalSplit(db, now, '2026-11-06');
    ok(yesterday.ok === true && yesterday.day === '2026-11-06', 'a stored Johannesburg day can be read');
    ok(future.ok === false, 'a future day is refused');
    ok(pastSplit.day === '2026-11-06' && pastSplit.reportingDevices === 0 && pastSplit.exact === true, 'an earlier day does not reuse today\'s cards');
    ok(first.status === 200 && moved.status === 200 && other.status === 200, 'valid presence reports are stored');
    ok(blocked.status === 403, 'presence route rejects a foreign origin');
    ok(invalid.status === 400, 'presence route rejects a bad device id');
    ok(split.GP === 0 && split.WC === 1 && split.KZN === 1 && split.EC === 0 && split.reportingDevices === 2, 'stored cards are a partition of reporting devices');
    const body = await moved.json();
    ok(body.ok === true && !JSON.stringify(body).includes('usr_abc'), 'presence response does not echo the device id');
    const unconfigured = await readRegionalSplit(null, now);
    ok(unconfigured.status === 'unconfigured' && unconfigured.exact === false, 'missing D1 binding is not shown as an exact zero split');
}
const storeJs = readFileSync(join(ROOT, 'workers/nexttrain-telemetry/region-store.js'), 'utf8');
ok(storeJs.includes('ON CONFLICT(day, device_hash)'), 'daily region upsert moves a device instead of inserting another row');
const prefsJs = readFileSync(join(ROOT, 'src/lib/prefs.js'), 'utf8');
ok(prefsJs.includes('region-presence-client.js'), 'selected region changes report the exact daily assignment');

const adWindows = cleverWindows('2026-04-30', '2026-11-10');
ok(adWindows.length >= 3, 'ad history from the first hit is more than one Clever window');
ok(adWindows.every((w) => w.start <= w.end), 'each ad window has a start and end');
ok(adWindows[0].start === '2026-04-30' && adWindows[adWindows.length - 1].end === '2026-11-10', 'stitched ad windows cover the whole search');
const spanDays = (w) => (Date.parse(`${w.end}T00:00:00Z`) - Date.parse(`${w.start}T00:00:00Z`)) / 86400000;
ok(adWindows.every((w) => spanDays(w) < 92), 'each ad window stays inside the 3 month cap');
function adPart(hits, value, day, desktop, mobile) {
    return {
        payload: {
            globalPerformance: { hits, value, coin: 'USD', dealType: 'CPM', firstHit: '2026-04-30' },
            browsers: { dataset: { label: ['Desktop', 'Mobile'], series: [{ data: [desktop, mobile] }] } },
            visitors: { dataset: { label: [day], series: { hits: [hits] } } },
            countries: { dataset: { label: ['ZA'], series: { value: [hits] } } },
        },
    };
}
const mergedAds = mergeCleverParts([
    adPart(100, 1.5, '2026-04-30', 10, 90),
    adPart(50, 0.25, '2026-08-01', 0, 100),
]);
ok(mergedAds.hits === 150 && mergedAds.revenue === 1.75, 'stitched ad windows add hits and revenue');
ok(mergedAds.series.length === 2 && mergedAds.geos[0].hits === 150, 'stitched ad windows keep daily hits and geos');
ok(!workerJs.includes('ZmI0MWI3') && !workerJs.includes('cleverwebserver.com/dashboard'), 'the Clever dashboard token is not in the worker');
ok(workerJs.includes("url.pathname === '/admin/ads'") && workerJs.includes('CLEVER_SCRIPT_ID'), 'ad stats are an admin route that reads the worker secret');
ok(adminJs.includes("adPanel.id = 'ad-revenue-panel'") && adminJs.includes('loadAdRevenue'), 'live telemetry draws its own ad revenue search');
ok(adminJs.includes('$4 CPM') && adminJs.includes('api.frankfurter.dev') && adminJs.includes('open.er-api.com'), 'revenue and the $4 CPM deal convert with an open dollar rate');
ok(adminJs.includes('trend-ads-btn') && adminJs.includes('alignAdSeries') && adminJs.includes('showAdOverlay'), 'the user graph can draw ad counts for the same buckets');
ok(adminJs.includes('openGraphStats') && adminJs.includes('equivalentViewability') && adminJs.includes('telemetry-stats-export'), 'graph statistics compare equal finished periods and can export');
ok(adminJs.includes('offerChartExport') && adminJs.includes("label: 'Excel (.csv)'") && adminJs.includes('exportAdRevenueSheet'), 'ad revenue and telemetry graphs export a graph or a spreadsheet');
ok(adminJs.includes('openGraphLandscape') && adminJs.includes('_telemetryExportFrame(1100') && adminJs.includes('wide: true'), 'telemetry graphs open landscape and export that wide frame');
ok(adminJs.includes("adChart.id = 'ad-impressions-panel'") && adminJs.includes('openAdImpressions'), 'the impressions graph opens full screen');
ok(adminJs.includes("showToast(Admin._telemetryLoadToast") && adminJs.includes('untilDismiss: true') && adminJs.includes('hideToastIfMessage(Admin._telemetryLoadToast)'), 'telemetry load shows a dismissible toast and clears it on success');
const bridgeJs = readFileSync(join(ROOT, 'src/lib/admin-bridge.js'), 'utf8');
const toastJs = readFileSync(join(ROOT, 'src/lib/ui.js'), 'utf8');
ok(bridgeJs.includes('window.ntAdChartAlign'), 'the chart align helpers are on the admin bridge');
ok(toastJs.includes('options.untilDismiss') && toastJs.includes('untilDismiss'), 'a loading toast can stay until it is dismissed');
ok(isoWeekKey('2026-01-01') === '202601', '1 Jan 2026 is ISO week 202601');
const week = isoWeekKey('2026-11-10');
const dailyAds = new Map([['2026-11-09', 10], ['2026-11-10', 5], ['2026-11-11', 7], ['2026-11-16', 100]]);
ok(alignAdSeries([week], 'WAU', dailyAds)[0] === 22, 'a week of ad counts is the sum of those days');
ok(alignAdSeries(['20261110', ''], 'DAU', dailyAds)[0] === 5 && alignAdSeries(['20261110', ''], 'DAU', dailyAds)[1] === null, 'a day uses that day and a pad stays empty');
ok(alignAdSeries(['202611'], 'MAU', dailyAds)[0] === 122, 'a month sums every daily ad count in it');
const dauSpan = adSpanForLabels(['20261104', '20261110'], 'DAU');
ok(dauSpan.start === '2026-11-04' && dauSpan.end === '2026-11-10', 'the ad search covers the days on the DAU graph');
const down = seriesTrend([100, 80]);
ok(down.trend === 'Down' && down.pct === -20, 'the user trend is the change from the first point to the last');
const rate = viewabilityTrend([100, 50], [10, 20]);
ok(rate.avg === 0.25 && rate.trend === 'Growing', 'viewability is viewable impressions per active user');
const dauLabels = [];
const dauValues = [];
for (let day = 28; day <= 31; day += 1) dauLabels.push(`202610${String(day).padStart(2, '0')}`);
for (let day = 1; day <= 11; day += 1) dauLabels.push(`202611${String(day).padStart(2, '0')}`);
dauLabels.forEach(() => dauValues.push(10));
dauValues[dauValues.length - 1] = 1;
const fair = equivalentPeriodTrend(dauLabels, dauValues, 'DAU', { openKey: '20261111', endLabel: '20261111' });
ok(fair && fair.trend === 'Flat' && fair.width === 7 && fair.current.label.includes('4 Nov') && fair.previous.label.includes('28 Oct'), 'DAU stats compare the last 7 finished days with the 7 before them');
ok(fair.current.sum === 70 && fair.previous.sum === 70, 'today is left out of both DAU periods');
const growingDays = dauValues.slice();
for (let i = growingDays.length - 8; i < growingDays.length - 1; i += 1) growingDays[i] = 20;
const grew = equivalentPeriodTrend(dauLabels, growingDays, 'DAU', { openKey: '20261111', endLabel: '20261111' });
ok(grew && grew.trend === 'Growing' && grew.current.sum === 140 && grew.previous.sum === 70, 'a stronger finished week is Growing even when today is small');
const weeks = equivalentPeriodTrend(['202642', '202643', '202644'], [80, 120, 5], 'WAU', { openKey: '202644', endLabel: '202644' });
ok(weeks && weeks.trend === 'Growing' && weeks.current.sum === 120 && weeks.previous.sum === 80, 'WAU compares the last full week with the full week before it');
const seen = equivalentViewability(
    { current: { sum: 100 }, previous: { sum: 50 }, versus: 'versus the previous 7 days' },
    { current: { sum: 50 }, previous: { sum: 50 } },
);
ok(seen && seen.current === 0.5 && seen.previous === 1 && seen.trend === 'Down', 'viewability compares the two finished periods');

if (failures.length) {
    console.error('verify-admin-telemetry FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-admin-telemetry: ok');
