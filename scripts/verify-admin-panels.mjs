/**
 * Runtime checks for admin expiry defaults and saved alert sources.
 * Run: node scripts/verify-admin-panels.mjs
 */
import { readFileSync } from 'node:fs';
import {
    findingsFromPairDeltas,
    runScheduleQaReport,
    scanScheduleSheet,
    sortQaFindings,
    QA_ISSUE_TYPES,
} from '../src/lib/schedule-qa.js';

const admin = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const start = admin.indexOf('function ntAdminEndOfTodayLocalValue');
const end = admin.indexOf('\nconst Admin = {');
if (start < 0 || end < 0 || end <= start) {
    console.error('verify-admin-panels: could not extract helper functions');
    process.exit(1);
}

const helpers = {};
new Function(`${admin.slice(start, end)}
this.ntAdminEndOfTodayLocalValue = ntAdminEndOfTodayLocalValue;
this.ntAdminToLocalDatetimeValue = ntAdminToLocalDatetimeValue;
this.ntAdminNormalizeAlertSources = ntAdminNormalizeAlertSources;
this.ntAdminAlertSourcesToRtdb = ntAdminAlertSourcesToRtdb;
this.ntAdminUpsertAlertSource = ntAdminUpsertAlertSource;
this.ntAdminDeleteAlertSource = ntAdminDeleteAlertSource;
this.ntAdminMatchAlertSource = ntAdminMatchAlertSource;
this.ntAdminNormalizeRoadmapText = ntAdminNormalizeRoadmapText;
this.ntAdminParseRoadmapSource = ntAdminParseRoadmapSource;
this.ntAdminDevPanelIdFromHash = ntAdminDevPanelIdFromHash;
this.ntAdminCanonicalPanelId = ntAdminCanonicalPanelId;
this.ntAdminDrillPanelTitle = ntAdminDrillPanelTitle;
this.ntAdminPushDrillPanel = ntAdminPushDrillPanel;
this.ntAdminTrimDrillStackTo = ntAdminTrimDrillStackTo;
this.ntAdminDrillBackAction = ntAdminDrillBackAction;
this.ntAdminNormalizeWeekdays = ntAdminNormalizeWeekdays;
this.ntAdminOrdinal = ntAdminOrdinal;
this.ntAdminNextWeeklyRun = ntAdminNextWeeklyRun;
this.ntAdminNextMonthlyRun = ntAdminNextMonthlyRun;
this.ntAdminCapScheduleRun = ntAdminCapScheduleRun;
this.ntAdminComputeJobNextRun = ntAdminComputeJobNextRun;
this.ntAdminNoticeExpiresAt = ntAdminNoticeExpiresAt;
this.ntAdminEndOfLocalDayMs = ntAdminEndOfLocalDayMs;
this.ntAdminEndOfLocalMonthMs = ntAdminEndOfLocalMonthMs;
this.ntAdminBuildScheduleJobMeta = ntAdminBuildScheduleJobMeta;
this.ntAdminFormatScheduleSummary = ntAdminFormatScheduleSummary;
this.ntAdminSchedulePreviewText = ntAdminSchedulePreviewText;
this.ntAdminAddDaysDateValue = ntAdminAddDaysDateValue;
this.ntAdminTomorrowMorningLocalValue = ntAdminTomorrowMorningLocalValue;
`).call(helpers);

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        failed += 1;
        console.error(`FAIL: ${msg}`);
    }
}

const today = helpers.ntAdminEndOfTodayLocalValue(new Date(2026, 8, 6, 8, 15, 42));
assert(today === '2026-09-06T23:59', `end of today is 23:59, got ${today}`);

const later = helpers.ntAdminEndOfTodayLocalValue(new Date(2026, 8, 6, 23, 58, 0));
assert(later === '2026-09-06T23:59', `still that calendar day at 23:59, got ${later}`);

const nextDay = helpers.ntAdminEndOfTodayLocalValue(new Date(2026, 8, 7, 0, 5, 0));
assert(nextDay === '2026-09-07T23:59', `next calendar day rolls over, got ${nextDay}`);

const stamp = new Date(2026, 8, 6, 14, 30, 0).getTime();
const local = helpers.ntAdminToLocalDatetimeValue(stamp);
assert(local === '2026-09-06T14:30', `toLocalDatetimeValue kept local wall time, got ${local}`);
assert(helpers.ntAdminToLocalDatetimeValue(null) === '', 'null timestamp is empty');
assert(helpers.ntAdminToLocalDatetimeValue('nope') === '', 'invalid timestamp is empty');

const normalized = helpers.ntAdminNormalizeAlertSources([
    { id: 'src_1!', name: ' PRASA ', url: 'https://www.prasa.com' },
    { name: '', url: 'https://ignored.example' },
]);
assert(normalized.length === 1 && normalized[0].name === 'PRASA', 'normalize keeps named sources');
assert(normalized[0].id === 'src_1', 'unsafe source ids are stripped');

const fromObject = helpers.ntAdminNormalizeAlertSources({
    0: { id: 'src_a', name: 'PRASA', url: 'https://www.prasa.com' },
    src_b: { id: 'src_b', name: 'MetroRail WC', url: 'https://www.metrorail.co.za' },
});
assert(fromObject.length === 2 && fromObject.some((s) => s.id === 'src_b'), 'Firebase object payloads become a source list');
const rtdbMap = helpers.ntAdminAlertSourcesToRtdb(fromObject);
assert(rtdbMap.src_b && rtdbMap.src_b.name === 'MetroRail WC', 'sources persist as an id-keyed Firebase map');

const empty = helpers.ntAdminUpsertAlertSource([], '  ', 'https://x.com');
assert(empty.ok === false && empty.list.length === 0, 'save without a name is rejected');

const first = helpers.ntAdminUpsertAlertSource([], 'PRASA', 'https://www.prasa.com');
assert(first.ok && first.list.length === 1 && first.source.url === 'https://www.prasa.com', 'new source is saved');

const renamed = helpers.ntAdminUpsertAlertSource(first.list, 'prasa', 'https://x.com/PRASA', first.source.id);
assert(renamed.list.length === 1 && renamed.list[0].url === 'https://x.com/PRASA', 'same id updates the link');
assert(renamed.list[0].name === 'prasa', 'same id can retitle');

const second = helpers.ntAdminUpsertAlertSource(renamed.list, 'MetroRail WC', 'https://www.metrorail.co.za');
assert(second.list.length === 2, 'a new name adds another source');

const matched = helpers.ntAdminMatchAlertSource(second.list, 'MetroRail WC', '');
assert(matched && matched.url === 'https://www.metrorail.co.za', 'match finds a saved name');

const removed = helpers.ntAdminDeleteAlertSource(second.list, second.source.id);
assert(removed.length === 1 && removed[0].name === 'prasa', 'delete removes only the selected source');

const wrapped = helpers.ntAdminNormalizeRoadmapText('The\n    southern line has trains that stop at\nFishhoek');
assert(wrapped === 'The southern line has trains that stop at Fishhoek', `unwraps hard wraps, got ${JSON.stringify(wrapped)}`);
const distressBlock = helpers.ntAdminNormalizeRoadmapText('DISTRESS:\nbroken_install · contact 0634876448');
assert(distressBlock.includes('DISTRESS:') && distressBlock.includes('broken_install'), 'keeps distress heading on its own line');
assert(helpers.ntAdminNormalizeRoadmapText('   We ween to inject fares and distances now   ') === 'We ween to inject fares and distances now', 'trims padded one-liners');

const fbSrc = helpers.ntAdminParseRoadmapSource({ source: 'Feedback abc123', title: 'Feedback from usr_z5wq', sourceKind: 'feedback', deviceId: 'usr_z5wq' });
assert(fbSrc.kind === 'feedback' && fbSrc.canOpen && fbSrc.sourceId === 'abc123', 'feedback source is openable');
const crashSrc = helpers.ntAdminParseRoadmapSource({ source: 'Crash crash_99', title: 'Crash on GP' });
assert(crashSrc.kind === 'crash' && crashSrc.canOpen && crashSrc.sourceId === 'crash_99', 'crash source is openable');
const distressSrc = helpers.ntAdminParseRoadmapSource({ title: 'Distress - 0634876448 - broken_install', source: 'Crash d1' });
assert(distressSrc.kind === 'distress' && distressSrc.canOpen, 'distress title maps to distress');
const telSrc = helpers.ntAdminParseRoadmapSource({ title: 'Routing Fail: A to B', source: 'Telemetry Data' });
assert(telSrc.kind === 'deadend' && telSrc.canOpen, 'planner telemetry is openable');
const manualSrc = helpers.ntAdminParseRoadmapSource({ title: 'Planner Fares and distance estimation', description: 'We ween to inject fares' });
assert(manualSrc.kind === 'none' && manualSrc.canOpen === false, 'manual tickets have no original link');

const requiredIds = [
    'alert-source-saved',
    'alert-source-name',
    'alert-source-url',
    'alert-source-save-btn',
    'alert-source-delete-btn',
    'alert-duration-custom',
    'alert-force-popup',
    'alert-poll-toggle',
    'alert-poll-question',
    'alert-schedule-first',
    'alert-weekly-days',
    'alert-weekly-time',
    'alert-weekly-until',
    'alert-monthly-day',
    'alert-monthly-time',
    'alert-monthly-until',
    'alert-when-modes',
    'excl-grid-notice',
    'excl-grid-notice-expiry',
    'excl-grid-notice-in-app',
    'excl-grid-notice-export',
    'excl-grid-notice-day-weekday',
    'excl-grid-notice-day-saturday',
    'excl-grid-notice-day-sunday',
    'excl-grid-notice-day-public_holiday',
    'excl-expiry',
    'excl-in-app-toggle',
    'excl-export-toggle',
    'excl-train-grid-a',
    'excl-train-grid-b',
    'disr-expiry',
    'disr-day-weekday',
    'disr-day-saturday',
    'disr-from',
    'disr-until',
    'disr-show-map',
    'maint-expires',
    'exp-features-header',
    'exp-features-save',
];
for (const id of requiredIds) {
    assert(admin.includes(`id="${id}"`), `admin still exposes #${id}`);
}
assert(admin.includes("'exp-map-enabled'") && admin.includes("'exp-community-enabled'"), 'experimental Map and Community toggles exist');

assert(admin.includes('renderExpFeatureAccordions'), 'experimental features render as per-type accordions');
assert(admin.includes("I'm on it / live share") && admin.includes('Delay reports') && admin.includes('Community realtime') && admin.includes('Push notifications'), 'System Controls lists remaining experimental feature types');
assert(!/Trip price/.test(admin.split('grantableFeatures')[1] || admin), 'Trip price is not an experimental feature accordion');
assert(admin.includes('exp-feat-${key}-header') || admin.includes('expFeatureControlIds'), 'each feature type has an accordion header');

assert(admin.includes('showCancelledOnMap'), 'incidents persist the map cancelled-station toggle');
assert(!/id="disr-show-map"[^>]*checked/.test(admin), 'show cancelled station on map defaults off');
assert(admin.includes('applyDays'), 'incidents persist cancellation days');
assert(admin.includes('Admin.endOfTodayLocalValue()'), 'alert/exclusion/disruption defaults call the helper');
assert(!admin.includes('now.getHours() + 48'), 'disruption no longer defaults to +48 hours');
assert(!admin.includes('defaultExpiry.setHours(defaultExpiry.getHours() + 24)'), 'grid notice no longer defaults to +24 hours');
assert(!admin.includes('Show on download image'), 'old banner download label is gone');
assert(!admin.includes('Show NO SVC / SPL tag on export image'), 'old train-tag export label is gone');
assert(admin.includes('Show in app timetable') && admin.includes('Show on downloaded grid'), 'banner surface labels are specific');
assert(admin.includes('In-app board and planner') && admin.includes('Timetable grid and PNG'), 'train-tag surface labels are specific');
assert(admin.includes('nt_admin_alert_sources'), 'saved sources use the localStorage key');
assert(admin.includes('admin_state/alert_sources'), 'saved sources sync to Firebase');
assert(admin.includes('ntAdminAlertSourcesToRtdb'), 'sources write an id-keyed Firebase map');
assert(admin.includes("parsed && typeof parsed === 'object' ? Object.values(parsed)"), 'source hydrate accepts a Firebase object');
assert(admin.includes('refreshSavedAlertSources'), 'saved sources refresh from Firebase');
assert(!admin.includes('Saved on this device only.'), 'source helper copy is no longer device-only');
assert(admin.includes('Sources are shared for both operators on Firebase.'), 'source helper copy is shared for operators');
assert(admin.includes('ls-stop-share') && admin.includes('Stop share'), 'live cards have Stop share');
assert(admin.includes("source: 'admin_stop'"), 'admin stop writes source admin_stop');
assert(admin.includes('trackingState: \'stopped\''), 'admin stop expires the ping as stopped');
assert(admin.includes('cm-delete-message'), 'Community Monitor has Delete');
assert(admin.includes('deletePublishedCommunityMessage'), 'Delete removes the RTDB node and activity key');
assert(admin.includes('publishDueScheduledAlerts optional'), 'scheduled worker publish is optional');
assert(admin.includes('publish skipped'), 'scheduled publish failure is a note, not a blank Failed pane');
assert(admin.includes('_archiveFetchGen'), 'archive load uses a generation so sweep cannot leave Loading forever');
assert(admin.indexOf('const items = await Admin.loadUnifiedAlertArchive(secret);', admin.indexOf('fetchAlertArchive: async'))
    < admin.indexOf('Admin.sweepExpiredAlertsToArchive(secret)', admin.indexOf('fetchAlertArchive: async')), 'archive paints before the background sweep');
assert(admin.includes('const result = await Admin.upsertSavedAlertSource('), 'saved source writes are awaited');
assert(admin.includes('Source saved online for both operators.'), 'saved source confirms online availability');
assert(admin.includes('sourceName: sourceNameInput ? sourceNameInput.value.trim()'), 'publish still sends sourceName');
assert(admin.includes('sourceUrl: sourceUrlInput ? sourceUrlInput.value.trim()'), 'publish still sends sourceUrl');
assert(helpers.ntAdminDevPanelIdFromHash('#dev-feedback-panel') === 'feedback-panel', 'drill hash maps to the panel id');
assert(helpers.ntAdminDevPanelIdFromHash('#dev') === '', 'grid hash is not a panel');
assert(helpers.ntAdminDevPanelIdFromHash('#roadmap-ticket') === '', 'ticket overlay hash is not a panel');
assert(helpers.ntAdminCanonicalPanelId('alert-panel--inapp') === 'alert-panel', 'in-app hub hash still mounts Service Alerts');
assert(helpers.ntAdminCanonicalPanelId('feedback-panel') === 'feedback-panel', 'other panel ids stay unchanged');
assert(helpers.ntAdminDrillPanelTitle('push-notifications-panel') === 'Notifications', 'FCM drill title is Notifications, not the panel id');
assert(helpers.ntAdminDrillPanelTitle('alert-panel--inapp') === 'In-app alerts', 'in-app drill title is In-app alerts');
assert(helpers.ntAdminDrillPanelTitle('alert-panel', 'Service Alerts') === 'Service Alerts', 'hub drill title stays Service Alerts');
assert(admin.includes('id="push-notifications-header-btn"'), 'Notifications header uses -header-btn so the drill title can hide the tile chrome');
{
    const showAt = admin.indexOf('showDrilledPanel: (panelId, opts = {})');
    const hubAt = admin.indexOf("Admin.applyAlertHubView(skipHub ? 'inapp' : 'hub')", showAt);
    const quietAt = admin.indexOf('if (quiet) return true;', showAt);
    assert(showAt > -1 && hubAt > showAt && quietAt > hubAt, 'Back restores hub/inapp before the quiet return so tiles do not stack on compose');
}
assert(admin.includes('id="alert-hub"'), 'Service Alerts drill opens an inner hub');
assert(admin.includes('In-app alerts'), 'hub tile for channel posts');
assert(admin.includes('alert-hub-push'), 'hub tile for FCM notifications');
assert(admin.includes("data-admin-subview"), 'Notifications is a subview, not a home-grid tile');
assert(admin.includes('openAlertHubInapp'), 'in-app tile drills into the existing alerts manager');

const stacked = helpers.ntAdminPushDrillPanel(['roadmap-panel'], 'feedback-panel');
assert(stacked.join(',') === 'roadmap-panel,feedback-panel', 'opening original pushes onto the drill stack');
assert(helpers.ntAdminPushDrillPanel(stacked, 'feedback-panel').join(',') === 'roadmap-panel,feedback-panel', 'same panel is not pushed twice');

const trimmed = helpers.ntAdminTrimDrillStackTo(stacked, 'roadmap-panel');
assert(trimmed.join(',') === 'roadmap-panel', 'back to roadmap trims the stack');

const fromOrig = helpers.ntAdminDrillBackAction(['roadmap-panel', 'feedback-panel'], 'roadmap-panel', true);
assert(fromOrig.action === 'panel' && fromOrig.panelId === 'roadmap-panel', 'popstate from original feedback restores roadmap');
const fromGsm = helpers.ntAdminDrillBackAction(['action-required-panel', 'alert-panel'], 'action-required-panel', true);
assert(fromGsm.action === 'panel' && fromGsm.panelId === 'action-required-panel', 'popstate from a GSM review restores Global State Monitor');
const fromGrid = helpers.ntAdminDrillBackAction(['roadmap-panel'], '', true);
assert(fromGrid.action === 'grid', 'popstate to #dev returns to the Dev Mode grid');
const btnBack = helpers.ntAdminDrillBackAction(['action-required-panel', 'exclusion-panel'], 'exclusion-panel', false);
assert(btnBack.action === 'history-back' && btnBack.panelId === 'action-required-panel', '← pops history to the previous panel');
const btnGrid = helpers.ntAdminDrillBackAction(['roadmap-panel'], 'roadmap-panel', false);
assert(btnGrid.action === 'grid', '← on the first panel returns to the grid');

assert(admin.includes('stepDrillBack'), 'admin exposes stepDrillBack');
assert(admin.includes('syncDrillFromHash'), 'admin exposes syncDrillFromHash');
assert(admin.includes('history.pushState(state, \'\', url)'), 'panel-to-panel deep links push history');
assert(!admin.includes("history.replaceState({ adminPanel: targetPanel.id }, '', `#dev-${targetPanel.id}`)"), 'deep link no longer replaceStates over the previous panel');
assert(admin.includes("closeSmoothModal('admin-ticket-view-modal', true)"), 'opening original does not pop the roadmap ticket hash');
assert(admin.includes("window._actionRequiredWasOpen = true; Admin.deepLinkToPanel"), 'GSM cards mark the monitor as the return target');

const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(ui.includes("'admin-ticket-view-modal': '#roadmap-ticket'"), 'ticket view has its own history hash');
assert(ui.includes('Admin.syncDrillFromHash'), 'popstate restores the drilled panel from the hash');
assert(ui.includes('Admin.stepDrillBack'), 'drilled Back steps one panel, not always the grid');

assert(admin.includes('data-alert-when="weekly"'), 'compose exposes weekly when-mode');
assert(admin.includes('data-alert-when="monthly"'), 'compose exposes monthly when-mode');
assert(admin.includes('alerts-hub-v1'), 'alert panel rebuilds after composer and schedule UX');
assert(!admin.includes('Recurring schedule (optional)'), 'old recurrence accordion is gone');
assert(admin.includes('ntAdminComputeJobNextRun'), 'scheduled publish uses job-aware next-run');

const sun = new Date(2026, 8, 6, 10, 0, 0); // Sunday 6 Sep 2026
const monFri = helpers.ntAdminNextWeeklyRun(sun.getTime(), [1, 5], '06:00');
const monFriDate = new Date(monFri);
assert(monFriDate.getDay() === 1 && monFriDate.getHours() === 6, `Kempton Mon+Fri next from Sunday is Monday 06:00, got ${monFriDate}`);

const tueMorning = new Date(2026, 8, 8, 7, 0, 0); // Tuesday after Monday 06:00
const nextFri = helpers.ntAdminNextWeeklyRun(tueMorning.getTime(), [1, 5], '06:00');
assert(new Date(nextFri).getDay() === 5, `next after Tuesday is Friday, got ${new Date(nextFri)}`);

const afterUntil = helpers.ntAdminCapScheduleRun(nextFri, '2026-09-07');
assert(afterUntil === 0, 'weekly run after the until date is dropped');

const sep7 = new Date(2026, 8, 7, 12, 0, 0);
const monthStart = helpers.ntAdminNextMonthlyRun(sep7.getTime(), 25, '08:00');
const monthStartD = new Date(monthStart);
assert(monthStartD.getDate() === 25 && monthStartD.getMonth() === 8 && monthStartD.getHours() === 8, `next monthly from 7 Sep is 25 Sep 08:00, got ${monthStartD}`);

const sep26 = new Date(2026, 8, 26, 9, 0, 0);
const oct25 = helpers.ntAdminNextMonthlyRun(sep26.getTime(), 25, '08:00');
assert(new Date(oct25).getMonth() === 9 && new Date(oct25).getDate() === 25, 'after the 25th, monthly rolls to next month');

const febFrom = new Date(2026, 1, 1, 9, 0, 0);
const feb31 = helpers.ntAdminNextMonthlyRun(febFrom.getTime(), 31, '08:00');
assert(new Date(feb31).getMonth() === 1 && new Date(feb31).getDate() === 28, `31st clamps to Feb 28 2026, got ${new Date(feb31)}`);

const monthEnd = helpers.ntAdminEndOfLocalMonthMs(new Date(2026, 8, 25, 8, 0, 0).getTime());
const monthEndD = new Date(monthEnd);
assert(monthEndD.getDate() === 30 && monthEndD.getHours() === 23 && monthEndD.getMinutes() === 59, `Sep month-end is 30 Sep 23:59, got ${monthEndD}`);

const weeklyJob = {
    frequency: 'weekly',
    weekdays: [1, 5],
    timeOfDay: '06:00',
    untilAt: '2026-12-31',
    expireMode: 'end_of_day',
};
const afterMon = helpers.ntAdminComputeJobNextRun(weeklyJob, new Date(2026, 8, 7, 6, 1, 0).getTime());
assert(new Date(afterMon).getDay() === 5, 'after a Monday run, weekly job lands on Friday');

const monthlyJob = {
    frequency: 'monthly',
    monthDay: 25,
    timeOfDay: '08:00',
    untilAt: '2026-10-20',
    expireMode: 'month_end',
};
const afterSep25 = helpers.ntAdminComputeJobNextRun(monthlyJob, new Date(2026, 8, 25, 8, 1, 0).getTime());
assert(afterSep25 === 0, 'monthly job stops when the next 25th is after until');

const expires = helpers.ntAdminNoticeExpiresAt(new Date(2026, 8, 25, 8, 0, 0).getTime(), monthlyJob);
assert(new Date(expires).getDate() === 30, 'monthly ticket reminder expires at month end');

const weeklyMeta = helpers.ntAdminBuildScheduleJobMeta({
    mode: 'weekly',
    weekdays: [1, 5],
    timeOfDay: '06:00',
    untilAt: '2026-12-31',
    expireMode: 'end_of_day',
}, new Date(2026, 8, 6, 10, 0, 0).getTime());
assert(weeklyMeta.ok && weeklyMeta.frequency === 'weekly' && weeklyMeta.weekdays.join(',') === '1,5', 'weekly meta keeps Mon+Fri');
assert(helpers.ntAdminFormatScheduleSummary(weeklyMeta).includes('Mon, Fri'), `weekly summary names days, got ${helpers.ntAdminFormatScheduleSummary(weeklyMeta)}`);

const laterBad = helpers.ntAdminBuildScheduleJobMeta({
    mode: 'later',
    firstMs: new Date(2026, 8, 8, 6, 0, 0).getTime(),
    expiresAt: new Date(2026, 8, 8, 5, 0, 0).getTime(),
}, Date.now());
assert(!laterBad.ok, 'later rejects expiry before post time');

const laterOk = helpers.ntAdminBuildScheduleJobMeta({
    mode: 'later',
    firstMs: new Date(2026, 8, 8, 6, 0, 0).getTime(),
    expiresAt: new Date(2026, 8, 8, 23, 59, 0).getTime(),
}, Date.now());
assert(laterOk.ok && laterOk.frequency === 'once' && laterOk.expiresInMs > 0, 'later one-shot stores duration from post to expiry');

assert(helpers.ntAdminNormalizeWeekdays([1, 5, 1, 'x', 9]).join(',') === '1,5', 'weekday list is unique and 0-6');
assert(helpers.ntAdminOrdinal(25) === '25th' && helpers.ntAdminOrdinal(1) === '1st', 'ordinals for month day');
assert(helpers.ntAdminAddDaysDateValue(new Date(2026, 8, 7), 84) === '2026-11-30', 'weekly default until is +12 weeks');
assert(helpers.ntAdminTomorrowMorningLocalValue(new Date(2026, 8, 7, 22, 0, 0)) === '2026-09-08T06:00', 'later default is tomorrow 06:00');

const legacyHourly = helpers.ntAdminComputeJobNextRun({ frequency: 'hourly' }, new Date(2026, 8, 7, 6, 0, 0).getTime());
assert(legacyHourly === new Date(2026, 8, 7, 7, 0, 0).getTime(), 'legacy hourly jobs still advance one hour');

assert(admin.includes('zone-audit-monthly-legend'), 'zone audit shows a monthly ticket legend');
assert(admin.includes('formatZoneMonthlyLegend'), 'zone audit legend reads FARE_CONFIG monthlies');
assert(admin.includes('monthly R${Number(d.monthly)}'), 'zone audit direction rows show monthly');
assert(admin.includes('tracks/rail-tracks-${targetRegion}.geojson'), 'zone audit loads painted rail corridors');
assert(admin.includes('m.chainSource'), 'zone audit shows whether the stop list is the static map');

assert(admin.includes('openRoadmapOriginal'), 'roadmap can open the original item');
assert(admin.includes('data-fb-ids'), 'feedback threads expose ids for deep-link');
assert(admin.includes('data-crash-id='), 'crash rows expose ids for deep-link');
assert(admin.includes('roadmap-refine-v2'), 'roadmap panel rebuilds after the wallpaper pass');
assert(admin.includes('id="roadmap-body" class="nt-pack-surface'), 'roadmap body uses the interactive operations wallpaper surface');
assert(admin.includes('roadmap-open-original'), 'ticket view has Open original');
assert(!/font-mono text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words min-h-\[150px\]/.test(admin), 'old centered mono description box is gone');

assert(admin.includes('listIncidentStations'), 'incident picker lists sheet stations including inactive');
assert(admin.includes('Inactive stops are listed'), 'incident picker still includes inactive geometry stops');
assert(admin.includes('alert-active-delete'), 'active alerts have a Delete action');
assert(admin.includes('alert-sched-edit'), 'scheduled alerts have Edit');
assert(/alert-sched-delete[^>]*>Delete</.test(admin), 'scheduled delete label is Delete');
assert(!/alert-sched-delete[^>]*>Clear</.test(admin), 'scheduled Clear label is gone');

assert(admin.includes('setupRideShareManager'), 'live sharing admin panel exists');
assert(admin.includes('live-share-panel'), 'live sharing panel id');
assert(admin.includes('data-ls-region'), 'live sharing has region tabs');
assert(admin.includes('groupRideShareLogs'), 'live sharing groups start/stop into sessions');
assert(admin.includes('data-ls-session'), 'share sessions are expandable');
assert(admin.includes('openAdminChangelogLookup'), 'admin can look up operator build notes');
assert(admin.includes('admin-changelog-header-btn'), 'System Health has a build notes accordion');
assert(admin.includes('data-admin-changelog'), 'feedback version opens build notes');
assert(
    admin.includes('rawAdminVer') && admin.includes('data-admin-changelog="${adminVer}"'),
    'admin bubble version opens build notes'
);
assert(admin.includes("addEventListener('click', openFromEvent, true)"), 'build-notes clicks bind in capture');
assert(admin.includes('stopImmediatePropagation'), 'version chip capture stops Dev Hub handlers');
assert(admin.includes("openSmoothModal('admin-changelog-modal', null, { skipHash: true })"), 'build notes skip #admin-build so they stay above Feedback');
assert(admin.includes("e.target.closest?.('#admin-changelog-notes')"), 'build notes keep background from stealing the pan');
assert(admin.includes('overflow-y-auto custom-scrollbar overscroll-contain'), 'build notes scroll inside the card');
assert(admin.includes("addEventListener('touchmove', stopBgScroll, { passive: false })"), 'build notes swallow backdrop touchmove');
assert(admin.includes('fb-version-chip'), 'feedback version chips are dedicated buttons');
assert(admin.includes('data-admin-changelog="${safeAppVersion}"'), 'crash app version opens build notes');
assert(admin.includes('App: ${appVersionHtml}'), 'crash app version is a clickable field');
assert(admin.includes('holiday-region-save'), 'approved holiday notices can be re-saved');
assert(admin.includes('holiday-region-unapprove'), 'approved holiday notices can return to pending');
assert(admin.includes('layoutInboxMedia'), 'feedback bubbles hoist unique images');
assert(admin.includes('id="alert-poster-preview"'), 'compose has a catalog poster preview');
assert(
    admin.indexOf('id="alert-msg"') < admin.indexOf('id="alert-poster-preview"')
        && admin.indexOf('id="alert-poster-preview"') < admin.indexOf('id="alert-poster-selected"'),
    'poster preview sits in the message field, not only under the picker'
);
assert(admin.includes('window.withBase === \'function\' ? window.withBase(path)'), 'poster preview uses withBase so github.io still loads the jpg');
assert(admin.includes("style.zIndex = '260'"), 'build notes sit above Dev Hub');
assert(admin.includes("if (e.target.closest?.('[data-admin-changelog]')) return;"), 'hold-to-react ignores the version chip');
{
    const holdStart = admin.indexOf("dataset.fbHoldBound");
    const holdBlock = holdStart >= 0 ? admin.slice(holdStart, holdStart + 900) : '';
    assert(holdBlock.includes("if (e.target.closest?.('[data-admin-changelog]')) return;"), 'hold-to-edit ignores the version chip');
}
assert(admin.includes("data-fb-lazy=\"1\""), 'archive threads defer chat HTML');
assert(admin.includes('hydrateFeedbackThreadBody'), 'archive hydrates a thread on first expand');
assert(admin.includes('buildFeedbackThreadInnerHtml'), 'inbox and archive share the same thread renderer');
assert(admin.includes('document.createDocumentFragment()'), 'feedback list paints into a fragment');
assert(admin.includes('id="zone-audit-bands-acc"'), 'zone max km sits in a closed accordion');
assert(admin.includes(".join('<br>')"), 'zone hops render one segment per line');
assert(admin.includes('openScheduleQaDeltaModal'), 'delta variance opens a train table');
assert(admin.includes('id="sched-qa-delta-modal"') || admin.includes("id = 'sched-qa-delta-modal'"), 'delta modal id is stable');
assert(admin.includes('data-qa-delta-idx'), 'delta cards are clickable');
assert(admin.includes('${deltaSpread} min'), 'delta cards show their minute spread at top right');
assert(!admin.includes('id="sched-qa-region"'), 'Schedule QA has no private region selector');
assert(admin.includes("getElementById('diag-region-select')"), 'Schedule QA uses Target Region (Matrix & Scan)');
assert(admin.includes('Uses the Target Region (Matrix &amp; Scan) control above.'), 'Schedule QA points at the shared region control');

const qa = readFileSync(new URL('../src/lib/schedule-qa.js', import.meta.url), 'utf8');
assert(qa.includes('flattenPublicHolidays'), 'QA flattens WC public_holidays before sheetKeys lookup');
assert(admin.includes('ntAdminUnwrapRegionScheduleDb'), 'admin unwraps region files then flattens WC pub sheets');
assert(admin.includes('ntAdminFlattenPublicHolidays'), 'admin Deep Scan / QA / zone audit flatten public_holidays');
assert(admin.includes('route.sheetKeys.pub_to_a'), 'admin station walk includes WC pub sheets');
assert(QA_ISSUE_TYPES.some((t) => t.code === 'GHOST_STATION'), 'QA lists junk station rows');
{
    const ghost = scanScheduleSheet({
        headers: ['STATION', '0700'],
        stationColumnName: 'STATION',
        rows: [
            { STATION: 'DURBAN', COORDINATES: '-29.85,31.02', '0700': '05:00' },
            { STATION: 'WINKLESPRUIT', COORDINATES: '-30.09,30.85', '0700': '05:40' },
            { STATION: '12' },
            { STATION: '7.20' },
        ],
    });
    const codes = ghost.findings.map((f) => `${f.code}:${f.station}`);
    assert(codes.includes('GHOST_STATION:12'), 'numeric leftover 12 is GHOST_STATION not a missing-coord stop');
    assert(codes.includes('GHOST_STATION:7.20'), '7.20 leftover is GHOST_STATION');
    assert(!ghost.findings.some((f) => f.code === 'MISSING_COORDS' && (f.station === '12' || f.station === '7.20')), 'junk rows do not also fire MISSING_COORDS');
    assert(!ghost.stationNames.some((s) => /^(12|7.20)$/.test(s)), 'junk names are kept out of weekday↔Saturday compare');
}
{
    const pairDeltas = new Map([
        ['A→B', [
            { train: '1', deltaMin: 4, from: 'A', to: 'B' },
            { train: '2', deltaMin: 5, from: 'A', to: 'B' },
        ]],
        ['C→D', [
            { train: '1', deltaMin: 3, from: 'C', to: 'D' },
            { train: '2', deltaMin: 9, from: 'C', to: 'D' },
        ]],
    ]);
    const deltaFindings = findingsFromPairDeltas(pairDeltas);
    assert(deltaFindings[0]?.spreadMin === 1, '4–5 minute deltas record a 1 minute spread');
    sortQaFindings(deltaFindings);
    assert(deltaFindings.map((f) => f.spreadMin).join(',') === '6,1', 'delta variance sorts largest spread first');
}

assert(ui.includes("'admin-changelog-modal': '#admin-build'"), 'build notes modal has its own hash');
assert(ui.includes("'sched-qa-delta-modal': '#qa-delta'"), 'delta table modal has its own hash');
assert(admin.includes('junk leftover rows'), 'Schedule QA mentions junk leftover rows');
assert(admin.includes('openFeedbackTripPlans'), 'feedback Options opens trip plan search');
assert(admin.includes('config/feature_grants/'), 'beta grants write config/feature_grants');

{
    const start = admin.indexOf('const groupRideShareLogs = (items) => {');
    assert(start >= 0, 'groupRideShareLogs function body is present');
    let depth = 0;
    let end = -1;
    for (let i = start; i < admin.length; i++) {
        if (admin[i] === '{') depth += 1;
        else if (admin[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    const fn = admin.slice(start, end);
    const groupRideShareLogs = eval('(' + fn.replace(/^const groupRideShareLogs = /, '') + ')');
    const grouped = groupRideShareLogs([
        { _key: 'stop1', action: 'stop', uid: 'u', deviceId: 'd', trainId: '1173', routeId: 'pta-pienaarspoort', at: 200, source: 'stop' },
        { _key: 'start1', action: 'start', uid: 'u', deviceId: 'd', trainId: '1173', routeId: 'pta-pienaarspoort', at: 100, source: 'nearby_modal' },
    ]);
    assert(grouped.length === 1 && grouped[0].status === 'stopped' && grouped[0].startedAt === 100 && grouped[0].stoppedAt === 200, 'start and stop pair into one session');
}

assert(admin.includes('closedTargetRoutePreviewHtml'), 'Target Route has a name-only closed preview helper');
assert(admin.includes('closedTargetRoutePreviewFromRow'), 'Target Route closed preview reads the name span');
assert(admin.includes('disr-route-chevron') && admin.includes('closedTargetRoutePreviewFromRow(li)'), 'Target Route click writes the name-only preview');

const emptySatSheet = { headers: ['STATION'], rows: [{ STATION: 'HERCULES STATION' }] };
const liveSatSheet = {
    headers: ['STATION', '1220'],
    rows: [
        { STATION: 'HERCULES STATION', '1220': '06:00' },
        { STATION: 'KOEDOESPOORT STATION', '1220': '06:10' },
    ],
};
const placeholderQa = runScheduleQaReport({
    koed_to_herc_sat: emptySatSheet,
    herc_to_koed_sat: emptySatSheet,
}, 'GP', null);
const hercSatFindings = (report) => (report.findings || []).filter((f) => (
    f.routeId === 'herc-koed' && /sat/i.test(String(f.dayDir || f.sheetKey || ''))
));
assert(
    hercSatFindings(placeholderQa).length === 0,
    'expected empty herc-koed Saturday sheets are not NO_TRAINS errors'
);
const liveSatQa = runScheduleQaReport({
    koed_to_herc_sat: liveSatSheet,
    herc_to_koed_sat: liveSatSheet,
}, 'GP', null);
assert(
    hercSatFindings(liveSatQa).length > 0 && !hercSatFindings(liveSatQa).some((f) => f.code === 'NO_TRAINS'),
    'placeholder Saturday sheets with live trains are still scanned'
);

{
    const pubRows = [
        { STATION: 'CAPE TOWN STATION', COORDINATES: '-33.92,18.42', '3500': '06:00' },
        { STATION: 'KAPTEINSKLIP STATION', COORDINATES: '-34.04,18.68', '3500': '06:40' },
    ];
    const nestedPubQa = runScheduleQaReport({
        kap_to_ct_weekday: pubRows,
        ct_to_kap_weekday: pubRows,
        kap_to_ct_sat: pubRows,
        ct_to_kap_sat: pubRows,
        public_holidays: {
            kap_to_ct_pub: pubRows,
            ct_to_kap_pub: pubRows,
        },
    }, 'WC', null);
    const kapPubMissing = (nestedPubQa.findings || []).filter((f) => (
        f.routeId === 'ct-kapteinsklip' && f.code === 'MISSING_SHEET' && /_pub$/.test(String(f.sheetKey || ''))
    ));
    assert(kapPubMissing.length === 0, 'QA finds WC pub sheets nested under public_holidays');
    assert(nestedPubQa.summary.sheetsScanned >= 6, 'QA scans weekday, Saturday, and pub sheets for Kapteinsklip');
}

if (failed) {
    console.error(`\nverify-admin-panels failed: ${failed} check(s)`);
    process.exit(1);
}
console.log('verify-admin-panels: all checks passed');
