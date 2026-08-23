/**
 * Current polish gate (V8_08.23.3 SEO chrome) plus leftover ad-gap / 20.1 history.
 * Run: node scripts/verify-polish-08191.mjs
 */
import { readFileSync } from 'node:fs';
import { APP_VERSION, CHANGELOG_DATA } from '../src/lib/config.js';
import { formatAppDate } from '../src/lib/utils.js';
import { encodeFeedbackAlertQuote, parseFeedbackAlertQuote } from '../src/lib/feedback-quote.js';
import { inboxReplyStillVisible, ADMIN_REPLY_HIDE_AFTER_MS } from '../src/lib/inbox-replies.js';

const failures = [];
const fail = (msg) => failures.push(msg);

if (APP_VERSION !== 'V8_08.23.3') fail(`APP_VERSION is ${APP_VERSION}`);
const latest = CHANGELOG_DATA[0];
if (latest?.id !== 'V8_08.23.3') fail(`CHANGELOG_DATA[0].id is ${latest?.id}`);
if (!Array.isArray(latest?.features) || latest.features.length < 2) {
    fail(`What's New must have commuter bullets, got ${latest?.features?.length}`);
}
const wn = latest.features.join(' ');
if (!/route pages/i.test(wn) || !/fare/i.test(wn) || !/timetable/i.test(wn)) {
    fail(`What's New must mention route pages and fares: ${wn}`);
}
if (!/logo/i.test(wn) || !/province|region/i.test(wn)) {
    fail(`What's New must mention the logo home jump: ${wn}`);
}
if (/admin|dev hub|telemetry|firebase|dump|seo|googlebot|analytics|clarity|clever/i.test(wn)) {
    fail('Whats New must stay commuter-only');
}

const card211 = CHANGELOG_DATA.find((e) => e.id === 'V8_08.21.1');
const wn211 = (card211?.features || []).join(' ');
if (!/ads/i.test(wn211) || !/blank strip|gap/i.test(wn211)) {
    fail('V8_08.21.1 card must keep the leftover ad-space bullet');
}

const card201 = CHANGELOG_DATA.find((e) => e.id === 'V8_08.20.1');
const wn201 = (card201?.features || []).join(' ');
if (!/offline/i.test(wn201)) fail('V8_08.20.1 card must keep the offline bullet');
if (!/back/i.test(wn201)) fail('V8_08.20.1 card must keep the Back bullet');
if (!/verdana/i.test(wn201) || !/times/i.test(wn201)) fail('V8_08.20.1 card must keep Verdana/Times');

const folded = new Set(CHANGELOG_DATA.map((e) => e.id));
for (const id of ['V8_08.19.5', 'V8_08.19.4', 'V8_08.19.3', 'V8_08.19.2', 'V8_08.19.1', 'V8_08.18.3', 'V8_08.18.2', 'V8_08.18.1', 'V8_08.17.3', 'V8_08.17.1']) {
    if (folded.has(id)) fail(`${id} must be folded into V8_08.19.6, not kept as its own card`);
}
if (!folded.has('V8_08.21.1')) fail('V8_08.21.1 card must remain in history');
if (!folded.has('V8_08.20.1')) fail('V8_08.20.1 card must remain in history');
if (!folded.has('V8_08.19.6')) fail('V8_08.19.6 card must remain in history');
if (!folded.has('V8_08.16.5')) fail('Older V8_08.16.5 card must remain in history');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.version !== '8.8.23.3') fail(`package.json version is ${pkg.version}`);
const appVer = JSON.parse(readFileSync('public/app-version.json', 'utf8'));
if (appVer.version !== 'V8_08.23.3') fail(`app-version.json is ${appVer.version}`);

const layout = readFileSync('src/layouts/Layout.astro', 'utf8');
if (/body\.modal-active\s*\{[^}]*touch-action:\s*none/.test(layout)) {
    fail('body.modal-active must not set touch-action:none');
}
if (!layout.includes('#nt-shell.nt-ad-shifted #main-content.app-shell')) {
    fail('ad ease must transform #main-content, not #nt-shell');
}
if (/#nt-shell\.nt-ad-shifted\s*,\s*html\.nt-ads-entering #nt-shell\s*\{/.test(layout)) {
    fail('do not transform #nt-shell (traps commuter overlays)');
}
if (!layout.includes('touch-action: pan-y')) fail('fixed overlays must allow pan-y');
if (!layout.includes('#nt-shell [id$="-modal"].fixed')) fail('overlays inside #nt-shell must be viewport-pinned');
if (!layout.includes('#about-modal.full-screen > *') || !layout.includes('flex-shrink: 0')) {
    fail('About children must not shrink (that clips Built & Maintained)');
}

const plannerModals = readFileSync('src/components/PlannerModals.astro', 'utf8');
if (!plannerModals.includes('id="close-map-btn-2"')) fail('map modal must keep the bottom Close Map button');
if (!plannerModals.includes('id="legal-modal-content"') || !plannerModals.includes('min-h-0 flex-1')) {
    fail('legal body must flex-1 min-h-0 so Privacy scrolls');
}

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
if (!routePage.includes('SeoPageHeader')) fail('Route landing must use SeoPageHeader');
if (!routePage.includes('bidirectionalTitle')) fail('Route landing must use the calm bidirectional title');
if (!routePage.includes('SeoFareTable')) fail('Route landing must include the max fare table');
if (routePage.includes('<dt') && routePage.includes('Origin')) {
    fail('Route landing metadata must not list exclusive Origin');
}

const regionPage = readFileSync('src/pages/regions/[slug].astro', 'utf8');
if (!regionPage.includes('SeoPageHeader')) fail('Region hub must use SeoPageHeader');
{
    const figStart = regionPage.indexOf('id="region-seo-map"');
    const figEnd = regionPage.indexOf('</figure>', figStart);
    const figure = figStart >= 0 && figEnd > figStart ? regionPage.slice(figStart, figEnd) : '';
    if (!figure) fail('Region hub missing #region-seo-map figure');
    if (figure.includes('<a')) fail('Region network map figure must not wrap the PNG in a Leaflet link');
}
if (!regionPage.includes('Interactive map')) fail('Region hub missing Interactive map control');

const header = readFileSync('src/components/SeoPageHeader.astro', 'utf8');
if (!header.includes('icons/icon-48.png')) fail('SeoPageHeader must use the 48px mark');
if (!header.includes('variant="inline"')) fail('SeoPageHeader theme toggle must sit in-flow');

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
if (!admin.includes('pickWysiwygFont')) fail('font picker must be a premium menu, not a native select');
if (!admin.includes('justify-evenly')) fail('composer toolbar rows must spread across the width');
if (!admin.includes('id="alert-poster-toggle"')) fail('channel poster must use the premium dropdown trigger');
if (!admin.includes('id="alert-poster-list"')) fail('channel poster must use the premium dropdown list');
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

if (!admin.includes('applyWysiwygFont')) fail('composer must apply font face + class, not only execCommand');
if (!admin.includes('limitToLast=')) fail('planner telemetry must window the RTDB fetch');
if (!admin.includes('expandTripCorridorHits')) fail('planner telemetry must lazy-load hit history');
if (!admin.includes('_deTripPageSize')) fail('planner telemetry must paginate corridor cards');
if (admin.includes('hitsHtml')) fail('planner telemetry must not dump every hit into card HTML');

const rich = readFileSync('src/lib/rich-text.js', 'utf8');
if (!rich.includes('nt-font-verdana') || !rich.includes('nt-font-times')) {
    fail('rich-text CSS must include nt-font-verdana / nt-font-times');
}

const astro = readFileSync('astro.config.mjs', 'utf8');
if (!astro.includes("navigateFallback: 'index.html'")) fail('SW must fall back to the cached index.html shell');
if (/urlPattern: \(\{ request \}\) => request\.mode === 'navigate'/.test(astro)) {
    fail('do not intercept navigations with a runtime pages cache (captive wifi hang)');
}

const now = 1_700_000_000_000;
if (!inboxReplyStillVisible({ message: 'hi', timestamp: 1 }, now)) fail('unopened admin reply must stay visible');
if (inboxReplyStillVisible({ read: true, message: 'hi', timestamp: 1 }, now)) fail('acknowledged reply must hide');
if (!inboxReplyStillVisible({ viewedAt: now - 1000, message: 'hi', timestamp: 1 }, now)) {
    fail('just-opened reply must stay visible');
}
if (inboxReplyStillVisible({ viewedAt: now - ADMIN_REPLY_HIDE_AFTER_MS, message: 'hi', timestamp: 1 }, now)) {
    fail('reply viewed 3 days ago must hide');
}
if (!hub.includes('inboxReplyStillVisible')) fail('checkServiceAlerts must filter inbox with inboxReplyStillVisible');
if (!hub.includes('viewedAt')) fail('opening Read must stamp viewedAt');
if (!hub.includes("closeSmoothModal('developer-reply-modal', true)")) {
    fail('hub popstate must close inbox with fromPopState');
}

if (!ui.includes('__ntModalPopLockUntil')) fail('on-screen Close must arm a modal pop lock');
const popFn = ui.slice(ui.indexOf('export function bindHistoryBackNavigation'), ui.indexOf('// --- CINEMATIC SCRIM ENGINE'));
if (/if \(window\._isModalAnimating\)/.test(popFn)) {
    fail('popstate must not swallow native Back while a modal is animating');
}

const logic = readFileSync('src/lib/logic.js', 'utf8');
const loadFn = logic.slice(logic.indexOf('export async function loadAllSchedules'), logic.indexOf('BACKGROUND NETWORK SYNC'));
if (loadFn.includes('await regionCheckPromise')) {
    fail('loadAllSchedules must not wait on IP region guess before IndexedDB paint');
}

const ads = readFileSync('src/lib/clever-ads.js', 'utf8');
if (!ads.includes('unitOccupiesSpace')) fail('clever-ads must measure occupancy, not leftover wrapper height');
if (!ads.includes('data-nt-ad-idle')) fail('empty leftovers must be marked data-nt-ad-idle');
if (!ads.includes('markResumeInstant')) fail('resume must collapse leftover gap without a second ease');
if (!ads.includes('visibilitychange')) fail('must remeasure ads when the app becomes visible');
if (!layout.includes('[data-nt-ad-idle="1"]')) fail('Layout must collapse idle leftover ad boxes');

if (failures.length) {
    console.error(`\n✗ polish 08191 failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('✓ V8_08.23.3 polish (SEO chrome; 21.1 ad-gap + 20.1 history kept)');
