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
if (/if \(region && typeof window\.clarity/.test(analytics)) {
    fail('Clarity must not be gated on region');
}

for (const file of ['src/lib/live-board.js', 'src/lib/live-board-ui.js']) {
    const text = src(file);
    if (/function trackAnalyticsEvent\s*\(/.test(text)) {
        fail(`${file} still has a local gtag-only tracker`);
    }
    if (!text.includes("from './analytics.js'")) fail(`${file} must import analytics.js`);
}

const ui = src('src/lib/ui.js');
if (!ui.includes('addEventListener(\'appinstalled\'')) fail('PWA binder must listen for appinstalled');
const acceptedIdx = ui.indexOf("trackAnalyticsEvent('install_app_accepted'");
const appinstalledIdx = ui.indexOf("addEventListener('appinstalled'");
if (acceptedIdx < 0 || appinstalledIdx < 0 || acceptedIdx < appinstalledIdx) {
    fail('install_app_accepted must fire from the appinstalled handler');
}
if (/outcome === 'accepted'\s*\?\s*'install_app_accepted'/.test(ui)) {
    fail('install_app_accepted must not come from userChoice === accepted');
}
if (!ui.includes("install_app_webview_click")) fail('WebView install must ping install_app_webview_click');
if (!ui.includes("install_app_dismissed")) fail('Prompt-no must ping install_app_dismissed');
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
if (!hub.includes("click_submit_feedback_btn")) fail('submit must ping click_submit_feedback_btn');
if (!hub.includes("submit_feedback_success")) fail('submit must ping submit_feedback_success');
if (!hub.includes("submit_feedback_error")) fail('submit must ping submit_feedback_error');
if (!hub.includes("execute_hard_cache_clear")) fail('cache clear must ping execute_hard_cache_clear');
if (!hub.includes("check_updates_click")) fail('Check for Updates must ping check_updates_click');
if (!hub.includes("view_about_page")) fail('About open must ping view_about_page');
if (!hub.includes("view_user_guide")) fail('Guide sheet must ping view_user_guide');
if (!hub.includes("click_interactive_map")) fail('GPS map button must ping click_interactive_map');
if (!hub.includes("click_network_map")) fail('GPS map button must ping click_network_map');
if (!hub.includes("open_interactive_map")) fail('Map sheet show must ping open_interactive_map');

const planner = src('src/lib/planner-ui.js');
if (!planner.includes("planner_disruption_reply")) fail('planner disruption reply location missing');
if (!planner.includes("planner_missing_route")) fail('missing-route feedback location missing');
if (!planner.includes("complex_route_rendered")) fail('planner must ping complex_route_rendered');
if (!planner.includes("location: 'grid_link'")) fail('grid share must ping click_share with grid_link');

const liveUi = src('src/lib/live-board-ui.js');
if (!liveUi.includes("select_station")) fail('station change must ping select_station');
if (!liveUi.includes("click_auto_locate")) fail('locate button must ping click_auto_locate');
if (!liveUi.includes("select_route")) fail('route pick must ping select_route');
if (!liveUi.includes("select_inactive_route")) fail('inactive route pick must ping select_inactive_route');
if (!liveUi.includes("click_share")) fail('share-app must ping click_share');

const live = src('src/lib/live-board.js');
if (!live.includes("click_auto_locate")) fail('FIND_NEAREST must ping click_auto_locate');

const renderer = src('src/lib/renderer.js');
if (!renderer.includes("grid_share_image")) fail('notice share must ping grid_share_image');
if (!renderer.includes("open_google_form_feedback")) fail('coming-soon form must ping open_google_form_feedback');
if (!renderer.includes('data-coming-soon-form')) fail('coming-soon form needs a bindable hook');

const mapViewer = src('src/lib/map-viewer.js');
if (!mapViewer.includes("click_static_map")) fail('PRASA PNG map must ping click_static_map');

if (!ui.includes("view_legal_doc")) fail('openLegal must ping view_legal_doc');

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
trackAnalyticsEvent('select_station', { station: 'Pretoria' });
await new Promise((r) => queueMicrotask(r));
await new Promise((r) => setTimeout(r, 0));

if (!gtagCalls.some((c) => c[0] === 'event' && c[1] === 'select_station')) {
    fail('runtime: gtag did not receive select_station');
}
if (!clarityCalls.some((c) => c[0] === 'event' && c[1] === 'select_station')) {
    fail('runtime: Clarity did not receive select_station without region');
}

if (failures.length) {
    console.error(`\n✗ verify:analytics failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('✓ analytics restore (unified tracker, Clarity, PWA funnel, restored events)');
