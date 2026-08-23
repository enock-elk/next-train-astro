/**
 * Current polish gate (V8_08.23.9 train sheet, ticket FAQ, Recent Trips merge).
 * Run: node scripts/verify-polish-08191.mjs
 */
import { readFileSync } from 'node:fs';
import { APP_VERSION, CHANGELOG_DATA } from '../src/lib/config.js';
import { formatAppDate } from '../src/lib/utils.js';
import { encodeFeedbackAlertQuote, parseFeedbackAlertQuote } from '../src/lib/feedback-quote.js';
import { inboxReplyStillVisible, ADMIN_REPLY_HIDE_AFTER_MS } from '../src/lib/inbox-replies.js';

const failures = [];
const fail = (msg) => failures.push(msg);

if (APP_VERSION !== 'V8_08.23.9') fail(`APP_VERSION is ${APP_VERSION}`);
const latest = CHANGELOG_DATA[0];
if (latest?.id !== 'V8_08.23.9') fail(`CHANGELOG_DATA[0].id is ${latest?.id}`);
if (!Array.isArray(latest?.features) || latest.features.length < 2 || latest.features.length > 4) {
    fail(`What's New must be 2–4 concise bullets, got ${latest?.features?.length}`);
}
const wn = latest.features.join(' ');
if (!/max\.?\s*single fare/i.test(wn) && !/fare chip/i.test(wn)) {
    fail(`What's New must mention the Max. Single Fare chip: ${wn}`);
}
if (!/recent trips/i.test(wn) || !/province/i.test(wn)) {
    fail(`What's New must mention Recent Trips across provinces: ${wn}`);
}
if (!/ticket/i.test(wn) || !/valid/i.test(wn)) {
    fail(`What's New must mention ticket validity: ${wn}`);
}
if (/admin|dev hub|telemetry|firebase|dump|seo|google|index|route pages|logo|analytics|clarity|clever|deploy|worker|nuke/i.test(wn)) {
    fail('Whats New must stay obvious in-app behaviour only');
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
for (const id of ['V8_08.23.4', 'V8_08.23.3', 'V8_08.23.2', 'V8_08.21.1']) {
    if (folded.has(id)) fail(`${id} must be folded into V8_08.23.5, not kept as its own card`);
}
if (!folded.has('V8_08.23.8')) fail('V8_08.23.8 card must remain in history');
if (!folded.has('V8_08.23.7')) fail('V8_08.23.7 card must remain in history');
if (!folded.has('V8_08.23.6')) fail('V8_08.23.6 card must remain in history');
if (!folded.has('V8_08.23.5')) fail('V8_08.23.5 card must remain in history');
const card238 = CHANGELOG_DATA.find((e) => e.id === 'V8_08.23.8');
const wn238 = (card238?.features || []).join(' ');
if (!/notice/i.test(wn238) || !/version/i.test(wn238)) {
    fail('V8_08.23.8 card must keep the incoming-version notice');
}
if (!/download/i.test(wn238) && !/ready/i.test(wn238)) {
    fail('V8_08.23.8 card must keep the download-ready bullet');
}
const card237 = CHANGELOG_DATA.find((e) => e.id === 'V8_08.23.7');
const wn237 = (card237?.features || []).join(' ');
if (!/saturday/i.test(wn237) || !/station/i.test(wn237)) {
    fail('V8_08.23.7 card must keep Saturday details + selected station');
}
const card235 = CHANGELOG_DATA.find((e) => e.id === 'V8_08.23.5');
const wn235 = (card235?.features || []).join(' ');
if (!/saturday/i.test(wn235) || !/no service/i.test(wn235)) {
    fail('V8_08.23.5 card must keep Saturday No Service');
}
if (!/advert|blank strip/i.test(wn235)) {
    fail('V8_08.23.5 card must keep the leftover ad strip');
}
if (!folded.has('V8_08.20.1')) fail('V8_08.20.1 card must remain in history');
if (!folded.has('V8_08.19.6')) fail('V8_08.19.6 card must remain in history');
if (!folded.has('V8_08.16.5')) fail('Older V8_08.16.5 card must remain in history');
const wn196 = (CHANGELOG_DATA.find((e) => e.id === 'V8_08.19.6')?.features || []).join(' ');
if (/corridor pages|seo|google/i.test(wn196)) fail('V8_08.19.6 must not discuss SEO / corridor pages');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.version !== '8.8.23.9') fail(`package.json version is ${pkg.version}`);
const appVer = JSON.parse(readFileSync('public/app-version.json', 'utf8'));
if (appVer.version !== 'V8_08.23.9') fail(`app-version.json is ${appVer.version}`);

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
if (!plannerModals.includes('id="planner-train-sheet-modal"')) fail('planner must ship the train-sheet modal');
if (plannerModals.includes('id="planner-train-sheet-route"')) fail('sheet must not duplicate the corridor ↔ line');
if (plannerModals.includes('id="planner-train-sheet-id"')) fail('sheet must not show a redundant Train id subtitle');
if (plannerModals.includes('aria-label="Close train sheet"')) fail('sheet must not have a top X');
if (!plannerModals.includes('id="planner-train-sheet-direction"')) fail('sheet must keep one Origin → Terminus line');
if (!plannerModals.includes('max-h-[96dvh]')) fail('sheet must be near-full height');
if (!plannerModals.includes('id="planner-train-sheet-fare"')) fail('sheet must have a fare chip in the header');
if (!plannerModals.includes('<button type="button" id="planner-train-sheet-fare"')) {
    fail('fare chip must be a button that can open the fare table');
}
if (!plannerModals.includes('id="disruption-modal-reply-btn"')) fail('advisory Reply must have a stable id');

const hubModals = readFileSync('src/components/HubModals.astro', 'utf8');
if (!hubModals.includes('id="nt-admin-chrome-template"')) {
    fail('Dev Hub / Admin Gateway must live in nt-admin-chrome-template');
}
const crawlableHub = hubModals.replace(/<template\b[\s\S]*?<\/template>/gi, '');
if (/30 Days \(MAU\)|Last 30 Mins|Admin Gateway|Developer Mode|Live Telemetry/i.test(crawlableHub)) {
    fail('Dev Hub labels must not sit in crawlable homepage HTML');
}
{
    const struggleStart = hubModals.indexOf('id="network-struggle-modal"');
    const struggleEnd = hubModals.indexOf('id="redirect-modal"');
    const struggle = struggleStart >= 0
        ? hubModals.slice(struggleStart, struggleEnd > struggleStart ? struggleEnd : struggleStart + 8000)
        : '';
    if (!struggle.includes('id="network-struggle-dismiss"') || !struggle.includes('id="network-struggle-retry"')) {
        fail('Weak Signal must keep Dismiss and Try Again');
    }
    if (!struggle.includes('flex-row')) {
        fail('Weak Signal Dismiss | Try Again must sit on one row');
    }
    const dismissAt = struggle.indexOf('id="network-struggle-dismiss"');
    const retryAt = struggle.indexOf('id="network-struggle-retry"');
    const portalAt = struggle.indexOf('id="network-struggle-open-portal"');
    if (dismissAt < 0 || retryAt < 0 || dismissAt > retryAt) {
        fail('Weak Signal row must be Dismiss left, Try Again right');
    }
    if (portalAt < 0 || portalAt > dismissAt) {
        fail('captive Open browser to sign in must stay above the Dismiss | Try Again row');
    }
}
const adminBridge = readFileSync('src/lib/admin-bridge.js', 'utf8');
if (!adminBridge.includes('stampAdminChrome') || !adminBridge.includes('nt-admin-chrome-template')) {
    fail('admin-bridge must stamp operator chrome only after unlock');
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
if (!routePage.includes('buildRouteBoardAppPath')) fail('Route landing hero/header must deep-link the live board');
if (!routePage.includes('ctaHref={liveBoardHref}')) fail('SeoPageHeader CTA must open this corridor, not ?region= only');
if (!routePage.includes('When trains run')) fail('Route landing must structure operating hours');
if (!routePage.includes('For more info:')) fail('Route landing must say For more info:');
if (routePage.includes('Need holiday rules')) fail('Route landing must not say Need holiday rules');
if (routePage.includes('firstLastBlurb')) fail('intro must not dump first/last times (they live in the weekday card)');
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
if (!admin.includes('See ${Admin._deTripWindowStep') && !admin.includes('See ${Admin._deTripWindowStep || 80} more batches')) {
    fail('planner telemetry must keep See more batches');
}
if (!admin.includes('Admin._deTripWindowSize = Admin._deTripWindowSize || 80')) {
    fail('planner telemetry first window must be 80 batches');
}
if (!admin.includes('bindTripScrollLoadMore') || !admin.includes('loadMoreTripCorridors')) {
    fail('planner telemetry must load more trips on scroll');
}
if (!admin.includes('Admin._deTripPageSize = 40')) fail('planner telemetry must paint 40 cards first');
if (!admin.includes('Users ever') || !admin.includes('de-users-collected')) {
    fail('planner telemetry must show all-time Users ever');
}
if (!admin.includes('unique trip combinations')) {
    fail('planner telemetry must show unique trip combinations');
}
if (!admin.includes('text-indigo-600 dark:text-indigo-400 uppercase')) {
    fail('planner telemetry cards must restore the day-type chip');
}
if (admin.includes('<div class="hidden">\n                            <label class="block text-[9px] font-bold text-gray-400 uppercase mb-0.5">Day type</label>')) {
    fail('day-type filter must be visible again');
}
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
if (!ads.includes('scheduleScrollOccupancyCheck')) fail('must remasure leftover ads on scroll-return');
if (!layout.includes('[data-nt-ad-idle="1"]')) fail('Layout must collapse idle leftover ad boxes');
if (!readFileSync('src/lib/saturday-service.js', 'utf8').includes('SATURDAY_PLACEHOLDER_ROUTES')) {
    fail('Saturday planner must gate on SATURDAY_PLACEHOLDER_ROUTES + live times');
}
const logicJs = readFileSync('src/lib/logic.js', 'utf8');
if (!logicJs.includes('paintHeaderDayLabel')) fail('header must paint No Service when Saturday sheets are empty');
if (!logicJs.includes('currentRouteSaturdayClosed')) fail('header No Service must use both Saturday directions');

const plannerUi = readFileSync('src/lib/planner-ui.js', 'utf8');
if (!plannerUi.includes('openPlannerTrainSheet')) fail('planner-ui must open the train-sheet modal');
if (!plannerUi.includes('planner-train-name-btn')) fail('planner results must underline the train name');
if (!plannerUi.includes('planner-train-name-btn') || !plannerUi.includes('font-medium') || !plannerUi.includes('decoration-1')) {
    fail('Depart train name must stay a calm underlined control');
}
if (/planner-train-name-btn[^"]*font-semibold/.test(plannerUi) || /planner-train-name-btn[^"]*decoration-2/.test(plannerUi)) {
    fail('Depart train name must not use the heavy underline / semibold treatment');
}
if (plannerUi.includes('connectHtml: plannerTrainNameButton')) {
    fail('Connect To must be plain text, not a second sheet opener');
}
if (!plannerUi.includes('openFareModalForRoute')) fail('fare chip must open fare for this train route');
if (plannerUi.includes("openFareModalForCurrentRoute")) {
    fail('planner fare must not use the live-board pin');
}
if (!plannerUi.includes('Max. Single Fare')) fail('fare chip must read Max. Single Fare · price');
if (!plannerUi.includes("view_planner_train_sheet")) {
    fail('opening the populated train sheet must ping view_planner_train_sheet');
}
if (!plannerUi.includes('plannerHistory_all') || !plannerUi.includes('unionPlannerHistory')) {
    fail('Recent Trips must merge plannerHistory_* plus plannerHistory_all');
}
if (!plannerUi.includes('ensureRoutePinnedForRegion(target)')) {
    fail('restorePlannerSearch must soft-pin the trip region');
}
const historyFn = plannerUi.slice(plannerUi.indexOf('export function renderPlannerHistory'), plannerUi.indexOf('export function setupAutocomplete'));
if (!historyFn.includes('listReady')) {
    fail('history must wait for a ready station list before filtering');
}
if (/masterList && masterList\.length === 0[\s\S]{0,80}hidden/.test(historyFn)) {
    fail('empty master list must not force Recent Trips hidden');
}
if (!historyFn.includes('itemRegion !== currentRegion')) {
    fail('filter-wipe must keep other-province trips even when this region index is ready');
}
if (plannerUi.includes('$masterStationList.subscribe') === false) {
    fail('station-list ready must re-render planner history');
}
if (!ui.includes('m.renderPlannerHistory')) {
    fail('switchTab trip-planner must re-render planner history');
}
if (!plannerUi.includes('planner-notice-details-row')) fail('Details must sit on its own row, not share a squeezed flex');
if (plannerUi.includes('pr-14')) fail('planner notice body must not reserve pr-14 (boxes Details on phones)');
const appearance = readFileSync('src/styles/appearance.css', 'utf8');
if (!appearance.includes('planner-notice-details-row')) fail('appearance.css must drop the blocking notice-body pad');
if (!plannerUi.includes('paintSaturdayBetweenLine') || !plannerUi.includes('text-blue-600 dark:text-blue-400')) {
    fail('Saturday advisory must restore blue corridor ends');
}
if (!plannerUi.includes('planner-notice-details')) fail('terminating banners must keep a Details control');
if (!plannerUi.includes('on Saturdays')) fail('dest-cut banner must say on Saturdays');
if (!plannerUi.includes('planner_saturday_reply')) fail('Saturday Reply must quote the advisory');
if (!plannerUi.includes('enterFeedbackReplyMode')) fail('advisory Reply must enter feedback reply mode');
if (!ui.includes("'planner-train-sheet-modal': '#train-sheet'")) {
    fail('train-sheet modal must have a history hash');
}
if (!ui.includes("'fare-modal': '#fare'")) fail('fare modal must have a history hash');
const liveBoardUi = readFileSync('src/lib/live-board-ui.js', 'utf8');
if (!liveBoardUi.includes('export function openFareModalForRoute')) {
    fail('must expose openFareModalForRoute without retargeting the board pin');
}
if (!/openFareModal\(detailed,\s*routeId\)/.test(liveBoardUi)) {
    fail('planner fare modal must pass the train route id, not $currentRouteId');
}

const appUpdate = readFileSync('src/lib/app-update.js', 'utf8');
if (!appUpdate.includes('INCOMING_UPDATE_FALLBACK_MS = 30000')) {
    fail('incoming update must fall back to the cached shell after 30s');
}
{
    const onNeed = appUpdate.slice(appUpdate.indexOf('async onNeedRefresh'), appUpdate.indexOf('onRegisteredSW'));
    if (!onNeed.includes('showCrucialUpdateToast(incomingVersion)')) {
        fail('onNeedRefresh must always toast the incoming version');
    }
    if (/if\s*\(\s*FORCE_UPDATE_REQUIRED\s*\)/.test(onNeed)) {
        fail('incoming-version toast must not be gated on FORCE_UPDATE_REQUIRED');
    }
    if (!onNeed.includes('keeping cached version')) {
        fail('onNeedRefresh must keep the cached shell if the incoming worker is not ready');
    }
    if (onNeed.includes('hardReloadWithCacheBust')) {
        fail('onNeedRefresh must not hard-reload a half-downloaded build');
    }
}
if (!appUpdate.includes('keeping cached version')) {
    fail('manual update timeout must keep the cached shell');
}

const indexPage = readFileSync('src/pages/index.astro', 'utf8');
if (!indexPage.includes('shareRouteOpened')) {
    fail('ignite must remember a successful ?rt= open');
}
if (!indexPage.includes('skip the pinned-default fallthrough')) {
    fail('re-ignite after ?rt= must not restore the pinned default');
}

const gridJs = readFileSync('src/lib/timetable-grid.js', 'utf8');
if (!gridJs.includes('URL wins over a leftover share snapshot')) {
    fail('parseRouteDeepLink must prefer the URL over a leftover snapshot');
}
if (!gridJs.includes('$currentRouteId.set(link.routeId)')) {
    fail('applyRouteDeepLink must pin the linked corridor');
}

const guidePage = readFileSync('src/pages/guide.astro', 'utf8');
if (!guidePage.includes('How long is a Metrorail ticket valid?')) {
    fail('guide must include the ticket-validity FAQ');
}
if (!guidePage.includes('Valid for one unbroken journey') || !guidePage.includes('Valid for 3 hours')) {
    fail('ticket FAQ must quote the printed validity rules');
}
if (!guidePage.includes('Ticket not transferable') || !guidePage.includes('Valid for the day of purchase')) {
    fail('ticket FAQ must quote not transferable + day of purchase');
}
if (!guidePage.includes('NO CONCESSION') || !guidePage.includes('40% Off Peak')) {
    fail('ticket FAQ must mention peak NO CONCESSION and off-peak 40%');
}

if (failures.length) {
    console.error(`\n✗ polish 08191 failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('✓ V8_08.23.9 polish (fare chip, ticket FAQ, Recent Trips merge)');
