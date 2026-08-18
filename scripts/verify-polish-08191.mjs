/**
 * V8_08.19.3 polish: merged What’s New, version lock, keep 18.2/18.3 regressions.
 * Run: node scripts/verify-polish-08191.mjs
 */
import { readFileSync } from 'node:fs';
import { APP_VERSION, CHANGELOG_DATA } from '../src/lib/config.js';
import { formatAppDate } from '../src/lib/utils.js';
import { encodeFeedbackAlertQuote, parseFeedbackAlertQuote } from '../src/lib/feedback-quote.js';

const failures = [];
const fail = (msg) => failures.push(msg);

if (APP_VERSION !== 'V8_08.19.3') fail(`APP_VERSION is ${APP_VERSION}`);
const latest = CHANGELOG_DATA[0];
if (latest?.id !== 'V8_08.19.3') fail(`CHANGELOG_DATA[0].id is ${latest?.id}`);
if (!Array.isArray(latest?.features) || latest.features.length < 4) {
    fail(`What's New must fold the 18/17 commuter cards, got ${latest?.features?.length}`);
}
const wn = latest.features.join(' ');
if (!/ads/i.test(wn)) fail(`What's New must mention ads: ${wn}`);
if (!/ease/i.test(wn)) fail(`What's New ads bullet must mention ease in/out: ${wn}`);
if (!/back where you were/i.test(wn)) fail(`What's New must mention overlay return: ${wn}`);
if (!/shared links/i.test(wn)) fail(`What's New must mention shared links: ${wn}`);
if (!/hold a photo/i.test(wn)) fail(`What's New must mention photo hold-to-react: ${wn}`);
if (!/route timetable/i.test(wn) || !/grid/i.test(wn)) {
    fail(`What's New bullet must mention route timetable grids: ${wn}`);
}
if (/admin|dev hub|telemetry|firebase|dump|seo|googlebot|analytics|clarity/i.test(wn)) {
    fail('Whats New must stay commuter-only');
}

const folded = new Set(CHANGELOG_DATA.map((e) => e.id));
for (const id of ['V8_08.19.2', 'V8_08.19.1', 'V8_08.18.3', 'V8_08.18.2', 'V8_08.18.1', 'V8_08.17.3', 'V8_08.17.1']) {
    if (folded.has(id)) fail(`${id} must be folded into V8_08.19.3, not kept as its own card`);
}
if (!folded.has('V8_08.16.5')) fail('Older V8_08.16.5 card must remain in history');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.version !== '8.8.19.3') fail(`package.json version is ${pkg.version}`);
const appVer = JSON.parse(readFileSync('public/app-version.json', 'utf8'));
if (appVer.version !== 'V8_08.19.3') fail(`app-version.json is ${appVer.version}`);

const liveBoard = readFileSync('src/components/LiveBoard.astro', 'utf8');
if (liveBoard.includes('SeoFeaturedRoutes')) fail('LiveBoard footer must not include SeoFeaturedRoutes');
if (/Route timetables/.test(liveBoard)) fail('LiveBoard still has Route timetables dump');

const featured = readFileSync('src/components/SeoFeaturedRoutes.astro', 'utf8');
if (/compact/.test(featured)) fail('SeoFeaturedRoutes compact mode must stay removed');

for (const page of [
    'src/pages/routes/[slug].astro',
    'src/pages/corridors/[slug].astro',
    'src/pages/regions/[slug].astro',
    'src/pages/routes.astro',
]) {
    const html = readFileSync(page, 'utf8');
    if (html.includes('SeoFeaturedRoutes')) fail(`${page} must not dump SeoFeaturedRoutes`);
}

const routePage = readFileSync('src/pages/routes/[slug].astro', 'utf8');
if (!routePage.includes('Open live timetable in Next Train')) {
    fail('Route landing missing live-grid CTA copy');
}
if (!routePage.includes('max-w-6xl')) fail('Route landing timetable block should widen past max-w-2xl');
if (!routePage.includes('buildRouteGridAppPath')) fail('Route landing must deep-link the in-app grid');

const gridCss = readFileSync('src/components/SeoTimetableGrid.astro', 'utf8');
if (gridCss.includes('22rem')) fail('SeoTimetableGrid still clips at 22rem');
if (!gridCss.includes('min-width: 70px')) fail('SeoTimetableGrid train columns should be ~70px');

const sample = formatAppDate(new Date(2026, 7, 18, 21, 28), { withTime: true });
if (sample !== '18 Aug 2026, 9:28 PM') fail(`formatAppDate got "${sample}"`);
if (formatAppDate(new Date(2026, 7, 18)) !== '18 Aug 2026') fail('formatAppDate date-only mismatch');

const encoded = encodeFeedbackAlertQuote({
    alertId: '12345',
    kind: 'disruption',
    snippet: 'Line Severed - Pretoria',
});
if (encoded !== '[ALERT:12345|disruption|Line Severed - Pretoria]') fail(`encode got ${encoded}`);
const parsed = parseFeedbackAlertQuote(`${encoded}\nTrain is stuck`);
if (!parsed || parsed.alertId !== '12345' || parsed.kind !== 'disruption' || parsed.body.trim() !== 'Train is stuck') {
    fail(`parse mismatch ${JSON.stringify(parsed)}`);
}

const ui = readFileSync('src/lib/ui.js', 'utf8');
if (!ui.includes("safeStorage.getItem('hapticsEnabled') === 'true'")) {
    fail('triggerHaptic must treat missing hapticsEnabled as off');
}
if (ui.includes("!== 'false'")) fail('ui.js still uses haptics opt-out');
const hub = readFileSync('src/lib/hub.js', 'utf8');
if (hub.includes("hapticsEnabled') !== 'false'")) fail('hub.js still uses haptics opt-out');
const welcome = readFileSync('src/components/WelcomeModal.astro', 'utf8');
if (!welcome.includes("hapticsEnabled') === 'true'")) fail('WelcomeModal haptics still default on');

const admin = readFileSync('public/js/admin.js', 'utf8');
if (!admin.includes('getSelectedAlertTargets')) fail('admin missing multi-target picker');
if (!admin.includes('buildSyntheticQuotedAlert')) fail('admin missing reconstructed quote preview');
if (!admin.includes('parseFeedbackAlertQuote')) fail('admin must parse [ALERT:id|kind|snippet]');
if (admin.includes("Original message not in this thread view") && !admin.includes('buildSyntheticQuotedAlert')) {
    fail('quoted alert still dead-ends on missing thread');
}
if (!admin.includes('data-nt-font-select')) fail('alert composer must use a font dropdown');
if (!admin.includes('id="cf-purge-header-btn"')) fail('Cloudflare Purge must be its own accordion');
const pubIdx = admin.indexOf('id="deploy-live-header-btn"');
const cfIdx = admin.indexOf('id="cf-purge-header-btn"');
const nukeIdx = admin.indexOf('id="nuke-header-btn"');
if (!(pubIdx > -1 && cfIdx > pubIdx && nukeIdx > cfIdx)) {
    fail('System Controls order must be Publish live, Cloudflare Purge, Nuclear wipe');
}
const nukeBodyIdx = admin.indexOf('id="nuke-body"');
const cfBtnIdx = admin.indexOf('id="cf-purge-everything-btn"');
if (!(cfBtnIdx > -1 && nukeBodyIdx > -1 && cfBtnIdx < nukeBodyIdx)) {
    fail('CF purge button must not live inside nuke-body');
}

const manifest = JSON.parse(readFileSync('public/images/alerts/manifest.json', 'utf8'));
const posterFiles = new Set((manifest.posters || []).map((p) => p.file));
for (const file of [
    'avoid_trouble_travel_ticket.jpg',
    'ger_leralla_ballast.jpg',
    'inflation_rising_train_isnt.jpg',
    'level_crossing_warning.jpg',
    'mind_the_gap.jpg',
    'phelophepa_health_train.jpg',
    'stand_behind_yellow.jpg',
    'stay_away_from_tracks.jpg',
    'stoning_train_crime.jpg',
    'train_rules.jpg',
]) {
    if (!posterFiles.has(file)) fail(`manifest missing ${file}`);
    if (!admin.includes(file)) fail(`admin fallback missing ${file}`);
}

const alerts = readFileSync('src/lib/alerts-channel.js', 'utf8');
if (!alerts.includes('formatAppDate')) fail('alerts-channel must use formatAppDate');
if (alerts.includes('toLocaleDateString()')) fail('alerts-channel still uses slash dates');

if (failures.length) {
    console.error(`\n✗ polish 08191 failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('✓ V8_08.19.3 polish (merged What’s New, version, 18.2/18.3 regressions)');
