/**
 * Analytics restore: unified tracker, Clarity always, restored UI events, PWA funnel.
 * Run: node scripts/verify-analytics.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const failures = [];
const fail = (msg) => failures.push(msg);
const src = (file) => readFileSync(file, 'utf8');

const analytics = src('src/lib/analytics.js');
if (!analytics.includes('export function trackAnalyticsEvent')) fail('analytics.js must export trackAnalyticsEvent');
if (!analytics.includes('export function sendAnalyticsNow')) fail('analytics.js must export sendAnalyticsNow');
if (!analytics.includes('queueMicrotask')) fail('tracker must defer with queueMicrotask');
if (!analytics.includes("window.clarity('event', name)")) fail('Clarity must always receive the event name');
if (!analytics.includes('region_id')) fail('tracker must attach region_id');
if (!analytics.includes('withAnalyticsRegion')) fail('tracker must enrich payloads with region');
if (analytics.includes('if (region && typeof window.clarity')) {
    fail('Clarity must not be gated on region');
}

for (const file of ['src/lib/live-board.js', 'src/lib/live-board-ui.js']) {
    const text = src(file);
    if (text.includes('function trackAnalyticsEvent(') && !text.includes("from './analytics.js'")) {
        fail(`${file} still has a local gtag-only tracker`);
    }
    if (!text.includes("from './analytics.js'")) fail(`${file} must import analytics.js`);
}

const ui = src('src/lib/ui.js');
if (!ui.includes("addEventListener('appinstalled'")) fail('PWA binder must listen for appinstalled');
const acceptedIdx = ui.indexOf("trackAnalyticsEvent('install_app_accepted'");
const appinstalledIdx = ui.indexOf("addEventListener('appinstalled'");
if (acceptedIdx < 0 || appinstalledIdx < 0 || acceptedIdx < appinstalledIdx) {
    fail('install_app_accepted must fire from the appinstalled handler');
}
if (ui.includes("outcome === 'accepted' ? 'install_app_accepted'")) {
    fail('install_app_accepted must not come from userChoice === accepted');
}
if (!ui.includes('install_app_webview_click')) fail('WebView install must ping install_app_webview_click');
if (!ui.includes('install_app_dismissed')) fail('Prompt-no must ping install_app_dismissed');
if (!ui.includes('sendAnalyticsNow(item.event, enriched)')) {
    fail('OfflineTracker.flush must send through sendAnalyticsNow (gtag + Clarity)');
}

const hub = src('src/lib/hub.js');
if (!hub.includes('export function openFeedbackModal')) fail('hub must export openFeedbackModal');
for (const loc of [
    "'board'",
    "'planner'",
    "'settings'",
    "location: 'about'",
    "'admin_inbox_reply'",
    "'alert_reply'",
]) {
    if (!hub.includes(loc)) fail(`open_feedback_modal location missing in hub: ${loc}`);
}
if (!hub.includes('feedback-btn-planner') || !hub.includes('settings-feedback-btn')) {
    fail('board/planner/settings feedback buttons must stay wired');
}
if (!hub.includes('click_submit_feedback_btn')) fail('submit must ping click_submit_feedback_btn');
if (!hub.includes('submit_feedback_success')) fail('submit must ping submit_feedback_success');
if (!hub.includes('submit_feedback_error')) fail('submit must ping submit_feedback_error');
if (!hub.includes('execute_hard_cache_clear')) fail('cache clear must ping execute_hard_cache_clear');
if (!hub.includes('check_updates_click')) fail('Check for Updates must ping check_updates_click');
if (!hub.includes('view_about_page')) fail('About open must ping view_about_page');
if (!hub.includes('view_user_guide')) fail('Guide sheet must ping view_user_guide');
if (!hub.includes('open_interactive_map')) fail('Map sheet show must ping open_interactive_map');
{
    const idx = hub.indexOf('sidenav-interactive-map-btn');
    const sidenavMapBlock = idx < 0 ? '' : hub.slice(idx, idx + 500);
    if (sidenavMapBlock.includes('click_interactive_map') || sidenavMapBlock.includes('click_network_map')) {
        fail('sidenav Network Map must fire one open_interactive_map only');
    }
}

const account = src('src/lib/account.js');
if (!account.includes('signInWithFacebook')) fail('account must expose Facebook sign-in');
if (!account.includes('deletionRequestedAt')) fail('account delete must flag users/{uid}');
if (!account.includes("location: 'account_delete'")) fail('account delete must open feedback with account_delete');
if (account.includes('deleteUser(')) fail('account delete must not call deleteUser');
const firebaseBoot = src('src/lib/firebase-boot.js');
if (!firebaseBoot.includes('FacebookAuthProvider')) fail('firebase-boot must expose FacebookAuthProvider');
if (!firebaseBoot.includes('firebaseFacebookProvider')) fail('firebase-boot must set window.firebaseFacebookProvider');

const planner = src('src/lib/planner-ui.js');
if (!planner.includes('planner_disruption_reply')) fail('planner disruption reply location missing');
if (!planner.includes('planner_missing_route')) fail('missing-route feedback location missing');
if (!planner.includes('complex_route_rendered')) fail('planner must ping complex_route_rendered');
if (!planner.includes("location: 'grid_link'")) fail('grid share must ping click_share with grid_link');
if (!planner.includes('view_planner_train_sheet')) fail('train sheet must ping view_planner_train_sheet');

const liveUi = src('src/lib/live-board-ui.js');
if (!liveUi.includes('select_station')) fail('station change must ping select_station');
if (!liveUi.includes('click_auto_locate')) fail('locate button must ping click_auto_locate');
if (!liveUi.includes('select_route')) fail('route pick must ping select_route');
if (!liveUi.includes('select_inactive_route')) fail('inactive route pick must ping select_inactive_route');
if (!liveUi.includes('click_share')) fail('share-app must ping click_share');

const live = src('src/lib/live-board.js');
if (!live.includes('click_auto_locate')) fail('FIND_NEAREST must ping click_auto_locate');

const renderer = src('src/lib/renderer.js');
if (!renderer.includes('grid_share_image')) fail('notice share must ping grid_share_image');
if (!renderer.includes('open_google_form_feedback')) fail('coming-soon form must ping open_google_form_feedback');
if (!renderer.includes('data-coming-soon-form')) fail('coming-soon form needs a bindable hook');

const mapViewer = src('src/lib/map-viewer.js');
if (!mapViewer.includes('click_static_map')) fail('PRASA PNG map must ping click_static_map');

if (!ui.includes('view_legal_doc')) fail('openLegal must ping view_legal_doc');

const contentLayout = src('src/layouts/ContentLayout.astro');
const seoGtagEvents = [];
{
    const re = /gtag\('event', '([^']+)'/g;
    let m;
    while ((m = re.exec(contentLayout))) seoGtagEvents.push(m[1]);
}
if (seoGtagEvents.filter((name) => name === 'seo_page_view').length !== 1) {
    fail('ContentLayout must fire exactly one seo_page_view gtag event');
}
if (seoGtagEvents.some((name) => name !== 'seo_page_view')) {
    fail(`ContentLayout must not fire extra gtag page events (${seoGtagEvents.join(', ')})`);
}
if (contentLayout.includes('View_astro_pages')) {
    fail('ContentLayout must not fire View_astro_pages as a second SEO event');
}
if (!contentLayout.includes('route_id:') || !contentLayout.includes('region:')) {
    fail('seo_page_view must send route_id and region');
}
if (!contentLayout.includes('region_id:')) {
    fail('seo_page_view must send region_id');
}
const mapPage = src('src/pages/map.astro');
if (!mapPage.includes('trackSeo={false}')) fail('map.html must skip the SEO page event');
if (mapPage.includes('seoPageType=')) fail('map.html must not pass seoPageType');
const guidePage = src('src/pages/guide.astro');
if (!guidePage.includes('trackSeo={false}')) fail('guide.html must skip the SEO page event');
if (!contentLayout.includes('za.co.nexttrain.app') || !contentLayout.includes('app_source')) {
    fail('SEO analytics must tag Play Store TWA (za.co.nexttrain.app)');
}
const appLayout = src('src/layouts/Layout.astro');
if (!appLayout.includes('app_client: appSource') || !appLayout.includes('nt_twa_package')) {
    fail('App Layout must set app_client / twa_package user properties');
}
if (!appLayout.includes("gtag('event', 'twa_open'")) {
    fail('App Layout must fire twa_open when the Play TWA is detected');
}
if (!appLayout.includes('getInstalledRelatedApps') || !appLayout.includes("localStorage.setItem('nt_twa'")) {
    fail('App Layout must persist TWA and confirm via getInstalledRelatedApps');
}
const astroConfig = src('astro.config.mjs');
if (!astroConfig.includes("id: 'za.co.nexttrain.app'") || !astroConfig.includes('related_applications')) {
    fail('web manifest must list Play package za.co.nexttrain.app in related_applications');
}

const adminBridge = src('src/lib/admin-bridge.js');
if (!adminBridge.includes('if (!window.trackAnalyticsEvent)')) {
    fail('admin-bridge must not overwrite the real tracker');
}

// Runtime: gtag + Clarity after a microtask; Clarity fires with empty region.
const gtagCalls = [];
const clarityCalls = [];
const store = {};
globalThis.window = globalThis;
window.__ntGaReady = true;
window.gtag = (...args) => { gtagCalls.push(args); };
window.clarity = (...args) => { clarityCalls.push(args); };
window.OfflineTracker = {
    gaReady: () => true,
    enqueue() { fail('online send should not enqueue'); },
    flush() {},
};
if (typeof globalThis.localStorage === 'undefined') {
    globalThis.localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
    };
}

const { trackAnalyticsEvent } = await import(pathToFileURL('src/lib/analytics.js').href);
try { localStorage.setItem('userRegion', 'WC'); } catch { store.userRegion = 'WC'; }
gtagCalls.length = 0;
clarityCalls.length = 0;
trackAnalyticsEvent('select_station', { station: 'Cape Town' });
await new Promise((r) => queueMicrotask(r));
await new Promise((r) => setTimeout(r, 0));

if (!gtagCalls.some((c) => c[0] === 'event' && c[1] === 'select_station')) {
    fail('runtime: gtag did not receive select_station');
}
const selectPayload = gtagCalls.find((c) => c[0] === 'event' && c[1] === 'select_station')?.[2] || {};
if (selectPayload.region_id !== 'WC' || selectPayload.region !== 'WC') {
    fail(`runtime: select_station must carry region_id=WC, got ${JSON.stringify(selectPayload)}`);
}
if (!clarityCalls.some((c) => c[0] === 'event' && c[1] === 'select_station')) {
    fail('runtime: Clarity did not receive select_station without region');
}

const shareLinks = src('src/lib/share-links.js');
if (!shareLinks.includes('export function isSeoAppHandoff')) fail('share-links must export isSeoAppHandoff');
if (!shareLinks.includes("src === 'seo'")) fail('share-links must recognize src=seo');
const seoTimetable = src('src/lib/seo-timetable.js');
if (!seoTimetable.includes("params.set('src', 'seo')")) fail('SEO Open paths must tag src=seo');
const grid = src('src/lib/timetable-grid.js');
if (!grid.includes('isSeoAppHandoff')) fail('route deep links must skip SEO deep_link_open');
if (!grid.includes('gridViewEventOpen')) fail('view_full_grid must use a once-per-open session flag');
if (!grid.includes('markFullGridClosed')) fail('closing the grid must clear the view_full_grid session');
if (!planner.includes('isSeoAppHandoff(link)')) fail('planner deep links must skip SEO deep_link_open');

{
    const { isSeoAppHandoff } = await import(pathToFileURL('src/lib/share-links.js').href);
    if (!isSeoAppHandoff({ src: 'seo', kind: 'route', routeId: 'ct-simon' })) {
        fail('runtime: src=seo must count as SEO handoff');
    }
    if (isSeoAppHandoff({ kind: 'route', routeId: 'ct-simon' })) {
        fail('runtime: shared route without src=seo must stay a deep link');
    }
    if (!isSeoAppHandoff('?rt=ct-simon&r=WC&src=seo')) {
        fail('runtime: search string src=seo must count as SEO handoff');
    }
}

if (failures.length) {
    console.error(`\nverify:analytics failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('verify:analytics ok (unified tracker, Clarity, PWA funnel, region_id, SEO deep-link skip)');
