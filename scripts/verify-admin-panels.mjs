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
    'excl-grid-notice',
    'excl-grid-notice-expiry',
    'excl-grid-notice-export',
    'excl-expiry',
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
assert(admin.includes('Include banner on downloaded PNG'), 'banner PNG label is specific');
assert(admin.includes('Include NO SVC / SPL tag on downloaded PNG'), 'train-tag PNG label is specific');
assert(admin.includes('nt_admin_alert_sources'), 'saved sources use the localStorage key');
assert(admin.includes('sourceName: sourceNameInput ? sourceNameInput.value.trim()'), 'publish still sends sourceName');
assert(admin.includes('sourceUrl: sourceUrlInput ? sourceUrlInput.value.trim()'), 'publish still sends sourceUrl');
assert(admin.includes('openRoadmapOriginal'), 'roadmap can open the original item');
assert(admin.includes('data-fb-ids'), 'feedback threads expose ids for deep-link');
assert(admin.includes('data-crash-id='), 'crash rows expose ids for deep-link');
assert(admin.includes('roadmap-refine-v1'), 'roadmap panel rebuilds after the card redesign');
assert(admin.includes('roadmap-open-original'), 'ticket view has Open original');
assert(!/font-mono text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words min-h-\[150px\]/.test(admin), 'old centered mono description box is gone');

if (failed) {
    console.error(`\nverify-admin-panels failed: ${failed} check(s)`);
    process.exit(1);
}
console.log('verify-admin-panels: all checks passed');
