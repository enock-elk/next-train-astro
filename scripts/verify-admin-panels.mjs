/**
 * Runtime checks for admin expiry defaults and saved alert sources.
 * Run: node scripts/verify-admin-panels.mjs
 */
import { readFileSync } from 'node:fs';

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
this.ntAdminUpsertAlertSource = ntAdminUpsertAlertSource;
this.ntAdminDeleteAlertSource = ntAdminDeleteAlertSource;
this.ntAdminMatchAlertSource = ntAdminMatchAlertSource;
this.ntAdminNormalizeRoadmapText = ntAdminNormalizeRoadmapText;
this.ntAdminParseRoadmapSource = ntAdminParseRoadmapSource;
this.ntAdminDevPanelIdFromHash = ntAdminDevPanelIdFromHash;
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
    'excl-expiry',
    'excl-in-app-toggle',
    'excl-export-toggle',
    'excl-train-grid-a',
    'excl-train-grid-b',
    'disr-expiry',
    'maint-expires',
    'exp-features-header',
    'exp-map-enabled',
    'exp-community-enabled',
    'exp-features-save',
];
for (const id of requiredIds) {
    assert(admin.includes(`id="${id}"`), `admin still exposes #${id}`);
}

assert(admin.includes('Admin.endOfTodayLocalValue()'), 'alert/exclusion/disruption defaults call the helper');
assert(!admin.includes('now.getHours() + 48'), 'disruption no longer defaults to +48 hours');
assert(!admin.includes('defaultExpiry.setHours(defaultExpiry.getHours() + 24)'), 'grid notice no longer defaults to +24 hours');
assert(!admin.includes('Show on download image'), 'old banner download label is gone');
assert(!admin.includes('Show NO SVC / SPL tag on export image'), 'old train-tag export label is gone');
assert(admin.includes('Show in app timetable') && admin.includes('Show on downloaded grid'), 'banner surface labels are specific');
assert(admin.includes('In-app board and planner') && admin.includes('Timetable grid and PNG'), 'train-tag surface labels are specific');
assert(admin.includes('nt_admin_alert_sources'), 'saved sources use the localStorage key');
assert(admin.includes('sourceName: sourceNameInput ? sourceNameInput.value.trim()'), 'publish still sends sourceName');
assert(admin.includes('sourceUrl: sourceUrlInput ? sourceUrlInput.value.trim()'), 'publish still sends sourceUrl');
assert(helpers.ntAdminDevPanelIdFromHash('#dev-feedback-panel') === 'feedback-panel', 'drill hash maps to the panel id');
assert(helpers.ntAdminDevPanelIdFromHash('#dev') === '', 'grid hash is not a panel');
assert(helpers.ntAdminDevPanelIdFromHash('#roadmap-ticket') === '', 'ticket overlay hash is not a panel');

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
assert(admin.includes('alerts-sched-v3'), 'alert panel rebuilds after schedule UX');
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

assert(admin.includes('openRoadmapOriginal'), 'roadmap can open the original item');
assert(admin.includes('data-fb-ids'), 'feedback threads expose ids for deep-link');
assert(admin.includes('data-crash-id='), 'crash rows expose ids for deep-link');
assert(admin.includes('roadmap-refine-v1'), 'roadmap panel rebuilds after the card redesign');
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
assert(admin.includes('openFeedbackBetaGrant'), 'feedback Options opens Add to beta');
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

if (failed) {
    console.error(`\nverify-admin-panels failed: ${failed} check(s)`);
    process.exit(1);
}
console.log('verify-admin-panels: all checks passed');
