/**
 * Appearance chrome tokens + weekday middot.
 * Run: node scripts/verify-appearance.mjs
 */
import { readFileSync } from 'node:fs';

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

const css = readFileSync(new URL('../src/styles/appearance.css', import.meta.url), 'utf8');
assert(css.includes('--nt-chrome-header'), 'appearance defines --nt-chrome-header');
assert(css.includes('--nt-chrome-nav'), 'appearance defines --nt-chrome-nav');
assert(css.includes('--nt-canvas'), 'appearance defines --nt-canvas');
assert(css.includes('--nt-chrome-header-border'), 'appearance defines --nt-chrome-header-border');
assert(css.includes('--nt-chrome-nav-border'), 'appearance defines --nt-chrome-nav-border');
assert(css.includes('#0b1f3a'), 'Classic dark header is navy ~#0b1f3a');
assert(css.includes('#061428') || css.includes('#0d2444'), 'Classic dark nav is navy family, not gray-800');
assert(css.includes('--nt-canvas: #07090d'), 'Classic dark canvas is near-black, not the same navy as cards');
assert(!css.includes('--nt-canvas: #071526'), 'Classic dark no longer uses #071526 canvas');
assert(css.includes('--nt-surface: #1a2d4a'), 'Classic dark cards are lifted navy, distinct from canvas');
assert(css.includes('--nt-chrome-header: #1d4ed8'), 'Classic light header is blue #1d4ed8');
assert(css.includes('--nt-chrome-nav: #163d96'), 'Classic light nav is darker blue #163d96');
assert(css.includes('color: var(--nt-chrome-fg) !important'), 'title uses --nt-chrome-fg (white on Classic light)');
assert(css.includes('html[data-colour-pack="classic"] #bottom-nav'), 'Classic bottom-nav items use chrome tokens');
assert(css.includes('--nt-chrome-nav: #0c0b0a'), 'Ember dark nav is near-black, distinct from header');
assert(css.includes('--nt-chrome-header: #352e28'), 'Ember dark header is lifted off the canvas');
assert(css.includes('--nt-chrome-nav: #0e0d0c'), 'Earthy dark nav is near-black, distinct from header');
assert(!/html\.dark #app-header\.nt-maint-active \{\s*background-color: rgb\(31 41 55\)/.test(css), 'maint header must not hardcode gray-800');
assert(css.includes('#grid-trigger-container'), 'timetable CTA has extra canvas gap');
assert(css.includes('.nt-board-footer.mt-auto'), 'board footer padding stays on nt-board-footer mt-auto');
assert(css.includes('0 -10px 28px') || css.includes('0 -8px'), 'nav has upward shadow');
assert(css.includes('#current-day'), 'day label letter-spacing rule present');

['midnight', 'contrast', 'signal', 'ember', 'earthy'].forEach((pack) => {
    const block = css.split(`html[data-colour-pack="${pack}"]`)[1] || '';
    assert(block.includes('--nt-chrome-nav'), `${pack} light defines --nt-chrome-nav`);
    assert(block.includes('--nt-canvas'), `${pack} light defines --nt-canvas`);
});

const logic = readFileSync(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
assert(logic.includes(' · <span class="${typeClass}">'), 'logic.js day label uses middot');
assert(!logic.includes('ml-1'), 'logic.js day type span dropped ml-1');

const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
assert(header.includes("names[day] + ' · <span"), 'Header boot uses middot');
assert(!header.includes('ml-1'), 'Header boot dropped ml-1');
assert(header.includes('translate-x-1/4 -translate-y-1/4'), 'unread dot sits on the outer corner of the bell');
assert(header.includes('w-6 h-6'), 'header bell icon is 24px');

assert(css.includes('#bottom-nav-grid'), 'bottom nav uses #bottom-nav-grid');
assert(css.includes('html[data-admin-authed="1"] #bottom-nav-grid'), 'admin auth expands bottom nav to 5 columns');

const indexPage = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
assert(indexPage.includes('lucide lucide-route'), 'Plan tab uses Lucide route icon');
assert(indexPage.includes('data-admin-authed-only'), 'Map/Community are admin-gated');
assert(indexPage.includes('id="bottom-nav-grid"'), 'bottom-nav-grid id present');
assert(/<\/div>\s*<div id="offline-wrapper"/.test(indexPage), 'offline dock sits outside #app-scroll');
assert(indexPage.includes('You are offline.'), 'offline dock copy matches the mockup');

const sidenav = readFileSync(new URL('../src/components/Sidenav.astro', import.meta.url), 'utf8');
assert(sidenav.includes('id="settings-account-btn"') && sidenav.includes('data-admin-authed-only'), 'Account row is admin-gated');

const chrome = readFileSync(new URL('../src/lib/admin-chrome.js', import.meta.url), 'utf8');
assert(chrome.includes('applyAdminAuthedChrome'), 'admin-chrome reveal helper exists');
assert(chrome.includes('Never use five-tap unlock'), 'admin chrome is not five-tap gated');

const layout = readFileSync(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8');
assert(layout.includes('window.ntCartoVoyagerUrl'), 'Layout exposes optional CARTO Voyager URL helper');
assert(layout.includes('PUBLIC_CARTO_API_KEY'), 'Layout reads PUBLIC_CARTO_API_KEY');
assert(layout.includes('html.nt-onboarding #bottom-nav'), 'Welcome hides the bottom bar');
assert(layout.includes("classList.toggle('nt-onboarding'"), 'Layout stamps nt-onboarding before first paint');

assert(css.includes('#app-header.nt-maint-active #app-title'), 'maintenance strip keeps header title readable');

const prefs = readFileSync(new URL('../src/lib/prefs.js', import.meta.url), 'utf8');
assert(prefs.includes('syncInAppChrome'), 'prefs exports syncInAppChrome after Welcome');
assert(prefs.includes("getItem('welcomeSeen') === 'true' && !welcomeOpen"), 'bottom bar waits until Welcome is done');

const welcome = readFileSync(new URL('../src/components/WelcomeModal.astro', import.meta.url), 'utf8');
assert(welcome.includes('later in Options'), 'Welcome copy points at Options, not side menu');
assert(welcome.includes('syncInAppChrome'), 'Welcome calls syncInAppChrome after a route pick');

const plannerUi = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
assert(plannerUi.includes('ntCartoVoyagerUrl'), 'planner map uses ntCartoVoyagerUrl');

const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
assert(mapApp.includes('ntCartoVoyagerUrl'), 'network map uses ntCartoVoyagerUrl');

const labWf = readFileSync(new URL('../.github/workflows/deploy-lab.yml', import.meta.url), 'utf8');
assert(labWf.includes('PUBLIC_CARTO_API_KEY: ${{ secrets.PUBLIC_CARTO_API_KEY }}'), 'lab build passes CARTO key from secrets');
const prodWf = readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');
assert(prodWf.includes('PUBLIC_CARTO_API_KEY: ${{ secrets.PUBLIC_CARTO_API_KEY }}'), 'production build passes CARTO key from secrets');
const exampleEnv = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
assert(exampleEnv.includes('PUBLIC_CARTO_API_KEY='), '.env.example documents PUBLIC_CARTO_API_KEY');
assert(!exampleEnv.includes('cb1_'), '.env.example must not contain a real CARTO key');

assert(css.includes('html.dark .dark\\:bg-gray-900'), 'dark gray-900 remaps as its own rule');
assert(css.includes('html.dark .dark\\:bg-gray-800'), 'dark gray-800 remap is present');
assert(/html\.dark \.dark\\:bg-gray-800,[\s\S]{0,220}var\(--nt-surface\)/.test(css), 'dark gray-800 maps to surface');
assert(/html\.dark \.dark\\:bg-gray-900,[\s\S]{0,220}var\(--nt-canvas\)/.test(css), 'dark gray-900 maps to canvas, not surface');
assert(!/html\.dark \.dark\\:bg-gray-800,[\s\S]{0,80}html\.dark \.dark\\:bg-gray-900/.test(css), 'gray-800 and gray-900 remaps are split');
assert(css.includes('#alerts-channel-card'), 'alerts sheet card uses canvas');
assert(css.includes('.nt-alert-card'), 'alert posts have a distinct card rule');
assert(css.includes('.nt-train-flag'), 'train flags are CSS-gated');
assert(css.includes('html[data-admin-authed="1"] .nt-train-flag'), 'train flags only show after admin auth');
assert(css.includes('html:not([data-admin-authed="1"]) #ride-nearby-btn'), 'Trains near you hidden unless admin authed');
assert(css.includes('padding-bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px))'), 'non-fullscreen modals clear the bottom nav');

const ridePings = readFileSync(new URL('../src/lib/ride-pings.js', import.meta.url), 'utf8');
assert(ridePings.includes('isAdminAuthed()'), 'nearby chip requires admin auth');
assert(ridePings.includes("if (!isAdminAuthed()) return;"), 'nearby click is admin-gated');
assert(ridePings.includes('syncRidePresenceRow'), 'presence row hides when nearby and chip are empty');

const liveBoardModals = readFileSync(new URL('../src/components/LiveBoardModals.astro', import.meta.url), 'utf8');
assert(liveBoardModals.includes('id="schedule-modal"') && liveBoardModals.includes('z-[125]'), 'upcoming trains modal sits above bottom nav z-110');
assert(!liveBoardModals.includes('id="schedule-modal" class="fixed inset-0 bg-black bg-opacity-70 z-[90]'), 'upcoming trains no longer z-90 under the nav');

const hubModals = readFileSync(new URL('../src/components/HubModals.astro', import.meta.url), 'utf8');
assert(hubModals.includes('id="messages-thread-file"'), 'messages thread has attachment input');
assert(hubModals.includes('id="messages-thread-contact"'), 'messages thread has optional contact field');
assert(hubModals.includes('id="messages-thread-privacy"'), 'Feedback Hub contact row has Privacy Policy');
assert(hubModals.includes('Feedback Hub'), 'thread modal is titled Feedback Hub');
assert(hubModals.includes('id="messages-thread-send"') && hubModals.includes('rounded-full bg-blue-600'), 'Feedback Hub send is a circular button');
assert(hubModals.includes('Unofficial & Independent'), 'About unofficial pill present');
assert(hubModals.includes('bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100'), 'About unofficial pill uses readable surface contrast');
assert(!hubModals.includes('bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'), 'About unofficial pill dropped low-contrast blue');

const mapPage = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
assert(mapPage.includes('map-chrome-btn-wide'), 'Network Lines uses map-chrome-btn');
assert(mapPage.includes('var(--nt-surface'), 'map chrome follows colour-pack surface');
assert(!mapPage.includes('text-blue-700 dark:text-blue-300'), 'GP button dropped hardcoded blue');
assert(!mapPage.includes('map-chrome-btn text-amber-500'), 'theme toggle dropped hardcoded amber');

const board = readFileSync(new URL('../src/components/LiveBoard.astro', import.meta.url), 'utf8');
assert(board.includes('id="view-full-timetable-btn"'), 'timetable CTA present');
assert(board.includes('flex items-center justify-center space-x-2.5'), 'timetable CTA label is a centered row');
assert(board.includes('rect x="3" y="4" width="18" height="18"'), 'timetable CTA has calendar SVG');
assert(board.includes('M8 14h.01M12 14h.01'), 'timetable calendar has day dots');
assert(board.includes('VIEW FULL TIMETABLE'), 'timetable label is the production all-caps row');
assert(board.includes('id="last-updated-date"'), 'effective date element exists');
assert(/#view-full-timetable-btn[\s\S]{0,800}id="last-updated-date"/.test(board), 'effective date sits inside the timetable button');
assert(!board.includes('id="share-app-btn"'), 'board footer no longer has Share App');
assert(!board.includes('id="feedback-btn"'), 'board footer no longer has Feedback');

const sidenavShare = readFileSync(new URL('../src/components/Sidenav.astro', import.meta.url), 'utf8');
assert(sidenavShare.includes('id="settings-share-btn"'), 'Share App lives in Options');
assert(sidenavShare.includes('id="settings-feedback-btn"'), 'Feedback Hub stays in Options');
assert(sidenavShare.includes('Feedback Hub'), 'Options row is labelled Feedback Hub');

const delayReports = readFileSync(new URL('../src/lib/delay-reports.js', import.meta.url), 'utf8');
assert(delayReports.includes('isAdminAuthed'), 'train title flags require admin auth');
assert(delayReports.includes('!isDelayReportsUiEnabled(routeId) || !isAdminAuthed()'), 'flags skipped unless admin authed');

if (failures.length) {
    console.error('verify-appearance failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-appearance: ok');
