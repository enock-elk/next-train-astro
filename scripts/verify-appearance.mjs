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
assert(css.includes('0 6px 18px') || css.includes('0 -10px 28px') || css.includes('0 -8px'), 'nav has a drop shadow');
assert(css.includes('border-radius: 999px'), 'bottom nav is a floating pill');
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
assert(indexPage.includes('id="offline-refresh-btn"'), 'offline dock has Refresh');
assert(indexPage.includes('id="offline-dismiss-btn"'), 'offline dock has Close');
assert(!indexPage.includes('id="bottom-nav" class="hidden shrink-0 border-t'), 'bottom nav dropped the boxy top border');

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
assert(layout.includes('#main-content.app-shell.dropdown-escape #app-scroll'), 'Travel Day keeps a dedicated #app-scroll overflow rule');
assert(/dropdown-escape #app-scroll \{\s*overflow-x:\s*hidden !important;\s*overflow-y:\s*auto !important;/.test(layout), 'Travel Day does not freeze #app-scroll');
assert(!/#main-content\.app-shell\.dropdown-escape #app-scroll \{\s*overflow:\s*visible/.test(layout), 'Travel Day no longer sets #app-scroll to overflow visible');
assert(layout.includes('body.sidenav-open #app-scroll'), 'Options open freezes #app-scroll');
assert(/#sidenav-overlay \{\s*touch-action:\s*none;/.test(layout), 'Options scrim does not scroll-chain on iOS');

assert(css.includes('#app-header .seo-open-app'), 'SEO header Open link uses chrome foreground');
assert(css.includes('.nt-maint-wrench'), 'maintenance strip has a wrench icon');
assert(css.includes('.nt-maint-label'), 'maintenance strip has a label');
assert(!css.includes('repeating-linear-gradient'), 'maintenance strip is not hazard tape');
assert(!css.includes('#app-header.nt-maint-active #app-title'), 'maintenance bar does not restyle the title overlay');

const prefs = readFileSync(new URL('../src/lib/prefs.js', import.meta.url), 'utf8');
assert(prefs.includes('syncInAppChrome'), 'prefs exports syncInAppChrome after Welcome');
assert(prefs.includes("getItem('welcomeSeen') === 'true' && !welcomeOpen"), 'bottom bar waits until Welcome is done');
assert(prefs.includes('ntProdClassicPackV1'), 'production one-shot remaps non-classic packs');
assert(prefs.includes('syncPrefsAccordionSummary'), 'theme accordion subtitle follows the live pack');
assert(prefs.includes('restoreLookPrefs'), 'look prefs restore from IndexedDB after a purge');
assert(prefs.includes('resetLookToClassicLight'), 'Check for Updates can force Classic light');
assert(prefs.includes('setResilientItem'), 'colour pack writes mirror to IndexedDB');
assert(layout.includes('ntProdClassicPackV1'), 'Layout boot remaps production packs before first paint');

const welcome = readFileSync(new URL('../src/components/WelcomeModal.astro', import.meta.url), 'utf8');
assert(welcome.includes('later in Options'), 'Welcome copy points at Options, not side menu');
assert(welcome.includes('syncInAppChrome'), 'Welcome calls syncInAppChrome after a route pick');

const plannerUi = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
assert(!plannerUi.includes('PLANNER_VIEWPORT_NO_ZOOM'), 'planner no longer rewrites the viewport to suppress input zoom');
assert(plannerUi.includes("input.addEventListener('focus'") && plannerUi.includes('input.select();'), 'station focus selects existing text for immediate replacement');
assert(plannerUi.includes('positionDropdownAroundTrigger'), 'planner dropdowns stay inside the visible viewport');
assert(plannerUi.includes('keepPlannerFieldVisible'), 'planner fields scroll to the top of the visible viewport');
assert(plannerUi.includes('vis.height * 0.7'), 'planner list can fill the space above the keyboard');
assert(!plannerUi.includes('openAbove'), 'planner list opens downward from the field');
assert(plannerUi.includes('ntCartoVoyagerUrl'), 'planner map uses ntCartoVoyagerUrl');
assert(plannerUi.includes('savePlannerHistory(origin, dest)'), 'recents persist when a plan starts');
assert(plannerUi.includes('resolvePlannerStationInput'), 'planner uses shared station alias resolver');
assert(plannerUi.includes('plannerHistoryStationLabel'), 'recents labels resolve aliases then keep caps');
assert(plannerUi.includes('plannerHistoryDedupeKey'), 'recents dedupe unique station pairs');
assert(!plannerUi.includes('Johannesburg Park Station'), 'recents do not show Johannesburg Park Station');
assert(!plannerUi.includes('top-[-5px]'), 'Show All Stops is not pulled up into the train name');
assert(plannerUi.includes('mb-2'), 'train name row has extra space before Show All Stops');
assert(plannerUi.includes('right-2 top-1/2'), 'planner From/To chevron matches board right-2');
assert(plannerUi.includes('text-gray-700 dark:text-gray-200 uppercase ml-1 mb-1">Travel Day'), 'Travel Day label uses primary text contrast');

const planner = readFileSync(new URL('../src/components/TripPlanner.astro', import.meta.url), 'utf8');
assert(planner.includes('planner-title-block text-center mb-3'), 'planner title block uses the same mb-3 as the board route pill');
assert(planner.includes('id="planner-from-chevron"'), 'planner From has a matching chevron');
assert(planner.includes('id="planner-from-chevron"') && planner.includes('absolute right-2 top-1/2'), 'planner From chevron is right-2 like the board');
assert(!planner.includes('planner-schedule-phantom'), 'planner dropped the phantom Schedule updated spacer');
assert(planner.includes('min-h-[46px]'), 'planner info pill matches board route pill min-height');
assert(planner.includes('flex items-center justify-center w-full h-full min-w-0'), 'Advanced Multi-Transfer Routing is vertically centered');

const plannerModals = readFileSync(new URL('../src/components/PlannerModals.astro', import.meta.url), 'utf8');
assert(plannerModals.includes('id="close-help-btn"') && plannerModals.includes('text-gray-700 dark:text-gray-200'), 'Tips close uses ink on a chip');
assert(!plannerModals.includes('text-gray-50 hover:text-gray-700'), 'Tips close is not white-on-white');

const fareUi = readFileSync(new URL('../src/lib/live-board-ui.js', import.meta.url), 'utf8');
assert(!fareUi.includes('text-gray-50 hover:text-gray-900'), 'fare close is not white-on-white');
assert(fareUi.includes('text-gray-700 dark:text-gray-200 hover:bg-gray-300'), 'fare close uses ink on a chip');

const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
assert(mapApp.includes('ntCartoVoyagerUrl'), 'network map uses ntCartoVoyagerUrl');
assert(mapApp.includes('ensureMaitlandMutualAdjacency'), 'WC graph inserts Maitland next to Mutual');
assert(/"MAITLAND", "MUTUAL"/.test(mapApp), 'static WC paths list Maitland then Mutual');
assert(!mapApp.includes('"ESPLANADE", "YSTERPLAAT", "MUTUAL"'), 'Chris Hani path no longer jumps Ysterplaat to Mutual');
assert(mapApp.includes('function applyCanonicalStationOrder'), 'map paints from official station order');
assert(mapApp.includes('function railHopSkipsRouteStop'), 'OSM hops cannot skip another stop on the route');
assert(mapApp.includes('function pathVisitsStopsInOrder'), 'baked tracks must visit stations in list order');
assert(mapApp.includes('function bindMapLegendToggle'), 'Network Lines binds as a button');
assert(mapApp.includes('function applySelectedLine'), 'legend tap isolates one corridor');
assert(mapApp.includes('"AVOCA", "DUFF\'S ROAD"'), 'KZN north line paints Avoca then Duff\'s Road');
assert(!mapApp.includes('"AVOCA", "TEMPLE", "KENVILLE", "EFFINGHAM", "DUFF\'S ROAD"'), 'Bridge City path no longer loops Avoca via Effingham');
assert(!mapApp.includes('if (baked && baked.length > 1) return baked;'), 'map does not paint unordered baked tracks');

const contentLayout = readFileSync(new URL('../src/layouts/ContentLayout.astro', import.meta.url), 'utf8');
assert(contentLayout.includes('window.ntCartoVoyagerUrl'), 'map layout exposes CARTO Voyager URL helper');
assert(contentLayout.includes('PUBLIC_CARTO_API_KEY'), 'map layout reads PUBLIC_CARTO_API_KEY');

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
assert(css.includes('padding-bottom: calc(4.5rem + var(--nt-sys-bottom, env(safe-area-inset-bottom, 0px)))'), 'non-fullscreen modals clear the bottom nav');
assert(css.includes('--nt-sys-bottom'), 'appearance defines --nt-sys-bottom');
assert(css.includes('max-height: 740px'), 'short screens compact the bottom nav');
assert(css.includes('--nt-chrome-nav-active'), 'active tab uses --nt-chrome-nav-active');
assert(css.includes('color-mix(in srgb, #fff 10%, var(--nt-chrome-nav))'), 'Classic light tab chip is a quiet white mix');
assert(css.includes('color-mix(in srgb, #fff 12%, var(--nt-chrome-nav))'), 'dark active tab uses a quieter mix, not a loud ring');
assert(css.includes('color-mix(in srgb, var(--nt-chrome-fg) 16%, var(--nt-chrome-nav))'), 'Earthy/Ember light tab chip is an ink wash');
assert(css.includes('--nt-primary: #c5cbb8'), 'Earthy light CTA is pale sage, not chocolate');
assert(css.includes('--nt-primary: #e4c4a4'), 'Ember light CTA is pale clay, not chocolate');
assert(css.includes('#planner-search-btn'), 'Plan Trip uses pack primary tokens');
assert(css.includes('#planner-locate-btn'), 'planner locate uses pack primary tokens');
assert(css.includes('html, body, #nt-shell'), 'shell paints canvas so the Options gap is not raw white');

const ridePings = readFileSync(new URL('../src/lib/ride-pings.js', import.meta.url), 'utf8');
assert(ridePings.includes('isAdminAuthed()'), 'nearby chip requires admin auth');
assert(ridePings.includes("if (!isAdminAuthed()) return;"), 'nearby click is admin-gated');
assert(ridePings.includes('syncRidePresenceRow'), 'presence row hides when nearby and chip are empty');

const liveBoardModals = readFileSync(new URL('../src/components/LiveBoardModals.astro', import.meta.url), 'utf8');
assert(liveBoardModals.includes('id="schedule-modal"') && liveBoardModals.includes('z-[125]'), 'upcoming trains modal sits above bottom nav z-110');
assert(!liveBoardModals.includes('id="schedule-modal" class="fixed inset-0 bg-black bg-opacity-70 z-[90]'), 'upcoming trains no longer z-90 under the nav');
assert(liveBoardModals.includes('id="modal-title-route"'), 'upcoming title has a shrink-to-fit route line');
assert(liveBoardModals.includes('id="modal-title-day"'), 'upcoming title has a day row for Tomorrow');
assert(liveBoardModals.includes('id="route-modal-close-btn"'), 'Select Route Close has an id');

const liveBoardUi = readFileSync(new URL('../src/lib/live-board-ui.js', import.meta.url), 'utf8');
assert(liveBoardUi.includes('fitScheduleModalRouteTitle'), 'upcoming route title shrinks to one line');
assert(liveBoardUi.includes('pinRouteIfRegionHasNoDefault'), 'first route pick in a new region is pinned');
assert(liveBoardUi.includes('syncRouteModalCloseBtn'), 'Select Route Close syncs to current route');

const mapTab = readFileSync(new URL('../src/lib/map-tab.js', import.meta.url), 'utf8');
assert(!mapTab.includes('window.__ntCloseInAppSheet ='), 'Map tab does not stub in-app sheet Close');

const mapView = readFileSync(new URL('../src/components/MapView.astro', import.meta.url), 'utf8');
assert(mapView.includes("withBase('/map.html')"), 'Map tab iframe loads map.html not the SPA');
assert(!mapView.includes("withBase('/map')?embed"), 'Map tab does not use extensionless /map');

const astroCfg = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
assert(astroCfg.includes('/\\/map(?:\\.html)?(?:$|[/?#])/'), 'SW navigateFallback denylists /map');

assert(layout.includes('nt-map-iframe-escape'), 'SPA in a map iframe hides nested chrome');

const hubModals = readFileSync(new URL('../src/components/HubModals.astro', import.meta.url), 'utf8');
assert(hubModals.includes('id="messages-thread-file"'), 'messages thread has attachment input');
assert(hubModals.includes('id="messages-thread-contact"'), 'messages thread has optional contact field');
assert(hubModals.includes('id="messages-thread-privacy"'), 'Feedback Hub contact row has Privacy Policy');
assert(hubModals.includes('aria-label="Privacy Policy"'), 'privacy control is the lock button');
{
    const threadPrivacy = hubModals.match(/id="messages-thread-privacy"[\s\S]*?<\/button>/);
    assert(!!threadPrivacy && !/>\s*Privacy Policy\s*</.test(threadPrivacy[0]), 'privacy lock has no PRIVACY POLICY text');
}
assert(hubModals.includes('Feedback Hub'), 'thread modal is titled Feedback Hub');
assert(hubModals.includes('id="messages-thread-send"') && hubModals.includes('rounded-full bg-blue-600'), 'Feedback Hub send is a circular button');
assert(hubModals.includes('data-feedback-scroll'), 'long feedback form has its own keyboard-safe scroller');
assert(hubModals.includes('--nt-feedback-vv-height'), 'feedback overlays use visible viewport height');
assert(hubModals.includes('align-items: flex-end'), 'Feedback Hub docks to the bottom of the visible viewport');
assert(hubModals.includes('padding-bottom: 0'), 'Feedback Hub has no gap above the keyboard');
assert(hubModals.includes('#messages-thread-modal > div'), 'Feedback Hub card fills the visible viewport');
assert(hubModals.includes('height: 100%'), 'Feedback Hub card height matches the keyboard-safe overlay');
assert(!hubModals.includes('h-[min(90dvh,40rem)]'), 'Feedback Hub is not a centered 40rem card');
assert(hubModals.includes('items-end justify-center p-0'), 'Feedback Hub overlay has no inset gap');
assert(hubModals.includes('items-center justify-center p-4'), 'Send Feedback overlay is centered in the visible viewport');
assert(!hubModals.includes('items-end justify-center p-4 pb-0'), 'Send Feedback is not docked to the keyboard like Hub');
assert(hubModals.includes('display: flow-root'), 'inbox message text contains floated timestamps');
assert(/#feedback-modal \{\s*align-items: center;/.test(hubModals), 'Send Feedback CSS keeps align-items center');
assert(/#messages-thread-modal \{\s*align-items: flex-end;/.test(hubModals), 'Feedback Hub CSS still docks with flex-end');
assert(hubModals.includes('Unofficial & Independent'), 'About unofficial pill present');
assert(hubModals.includes('bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100'), 'About unofficial pill uses readable surface contrast');
assert(hubModals.includes('#feedback-panel .inbox-bubble-own'), 'admin inbox shares WhatsApp own-bubble tokens');
assert(hubModals.includes('#feedback-panel .inbox-bubble-other'), 'admin inbox shares WhatsApp other-bubble tokens');
assert(hubModals.includes('#feedback-panel .feedback-thread-chat'), 'admin thread wallpaper selector');
assert(hubModals.includes('background: #efeae2'), 'WhatsApp wallpaper token is #efeae2');
assert(hubModals.includes('#d9fdd3'), 'own bubble is WhatsApp green');
assert(hubModals.includes('#005c4b'), 'dark own bubble is WhatsApp teal');

const mapPage = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
assert(mapPage.includes('aria-label="Network Lines"'), 'Network Lines is a labelled SVG button');
assert(!mapPage.includes('map-lines-label'), 'Network Lines dropped the wide text label');
assert(mapPage.includes('id="map-back-wrap"') && mapPage.includes('id="map-top-controls"'), 'Back sits in the map top chrome row');
assert(mapPage.includes('--map-chrome-h'), 'map chrome shares one height token');
assert(mapPage.includes('<button type="button" id="map-back-link"'), 'Back is a button like WC / sun / Network Lines');
assert(!mapPage.includes('<a id="map-back-link"'), 'Back is not an <a> (links stay taller than the square chrome)');
assert(mapPage.includes('id="map-back-link"') && mapPage.includes('class="map-chrome-btn map-chrome-btn-wide"'), 'Back uses the same chrome button height as WC');
assert(!mapPage.includes('id="map-reset-line-btn"'), 'Show all lines is not a second top-bar button');
assert(mapPage.includes('#map-back-link'), 'Back height is locked on the button id');
assert(!mapPage.includes('onclick="toggleLegend()"'), 'Network Lines is a button without inline onclick');
assert(mapPage.includes('id="legend-toggle-btn"') && mapPage.includes('aria-haspopup="true"'), 'Network Lines is a disclosure button');
assert(mapPage.includes('.legend-container { display: block; }'), 'Network Lines button is visible before map data loads');
assert(mapPage.includes('var(--nt-surface'), 'map chrome follows colour-pack surface');
assert(!mapPage.includes('text-blue-700 dark:text-blue-300'), 'GP button dropped hardcoded blue');
assert(!mapPage.includes('map-chrome-btn text-amber-500'), 'theme toggle dropped hardcoded amber');
assert(mapPage.includes('id="map-fullscreen-btn"'), 'Map tab has a full screen control under the theme toggle');
assert(mapPage.includes('function inMapTab()'), 'map embed detects the Map tab');
assert(mapPage.includes('if (inMapTab()) return false;'), 'Map tab iframe is not treated as the sidenav sheet');
assert(!mapPage.includes("typeof window.parent.__ntCloseInAppSheet === 'function'"), 'map embed does not treat CloseInAppSheet as the sheet');

const board = readFileSync(new URL('../src/components/LiveBoard.astro', import.meta.url), 'utf8');
assert(board.includes('id="view-full-timetable-btn"'), 'timetable CTA present');
assert(board.includes('grid-cols-[3rem_1fr_3rem]'), 'timetable CTA is calendar | centred copy | chevron');
assert(board.includes('items-center justify-center leading-tight text-center'), 'timetable copy is centred');
assert(!board.includes('items-start leading-tight text-left'), 'timetable copy is no longer left-aligned');
assert(!board.includes('absolute right-3 top-1/2'), 'timetable chevron is in the grid, not absolutely pinned');
assert(board.includes('w-8 h-8'), 'timetable calendar spans both CTA lines');
assert(board.includes('rect x="3" y="4" width="18" height="18"'), 'timetable CTA has calendar SVG');
assert(board.includes('M8 14h.01M12 14h.01'), 'timetable calendar has day dots');
assert(board.includes('VIEW FULL TIMETABLE'), 'timetable label is the production all-caps row');
assert(board.includes('id="last-updated-date"'), 'effective date element exists');
assert(/id="view-full-timetable-btn"[\s\S]{0,1200}id="last-updated-date"/.test(board), 'effective date sits inside the timetable button');
assert(!board.includes('id="share-app-btn"'), 'board footer no longer has Share App');
assert(!board.includes('id="feedback-btn"'), 'board footer no longer has Feedback');

const sidenavShare = readFileSync(new URL('../src/components/Sidenav.astro', import.meta.url), 'utf8');
assert(sidenavShare.includes('id="settings-share-btn"'), 'Share App lives in Options');
assert(sidenavShare.includes('id="settings-feedback-btn"'), 'Feedback Hub stays in Options');
assert(sidenavShare.includes('Feedback Hub'), 'Options row is labelled Feedback Hub');
assert(!sidenavShare.includes('Earthy is cream paper'), 'Earthy blurb removed from Theme accordion');
assert(sidenavShare.includes('setPrefsOpen(false, false)'), 'Theme accordion starts collapsed');

const uiJs = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(uiJs.includes("safeCur === 'trip-planner'"), 'commuter swipe-left from planner opens Options');
assert(uiJs.includes("m.openAppHub"), 'planner swipe-left calls openAppHub');
assert(uiJs.includes("modalId === 'route-modal' && !$currentRouteId.get()"), 'Select Route cannot close onto an empty board');

const hubJs = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
assert(hubJs.includes('collapsePrefsAccordion'), 'opening Options collapses Theme & Preferences');
assert(hubJs.includes('autosizeMessagesThreadInput'), 'Feedback Hub composer grows before scrolling');
assert(hubJs.includes('syncFeedbackModalViewport'), 'feedback overlays resize when the keyboard opens');
assert(hubJs.includes("modal.style.top = `${top}px`"), 'feedback overlay is pinned to visualViewport.top');
assert(hubJs.includes("card.style.height = '100%'"), 'Feedback Hub card stretches to the keyboard');
assert(hubJs.includes("if (id === 'messages-thread-modal')"), 'only Feedback Hub card is stretched to 100%');
assert(hubJs.includes('keepFeedbackFieldVisible'), 'focused feedback fields scroll inside the modal');
assert(hubJs.includes('fieldRect.height > availableHeight'), 'tall feedback fields align their first line inside a short scroller');
assert(hubJs.includes('window.visualViewport?.height || window.innerHeight'), 'feedback composer growth uses visible height');
assert(hubJs.includes('Always show contact + privacy lock'), 'Feedback Hub contact row stays visible when signed in');
assert(!/if \(signedIn\) \{[\s\S]{0,80}row\.classList\.add\('hidden'\)/.test(hubJs), 'signed-in contact row is not hidden');
assert(hubJs.includes('resetLookToClassicLight'), 'Check for Updates resets look to Classic light');
assert(hubJs.includes('window.__ntOpenNetworkMapSheet'), 'Map tab fullscreen opens the in-app sheet');
assert(hubJs.includes('window.__ntInAppSheetOpen = true'), 'in-app sheet open flag is set');
assert(hubJs.includes('min-h-[2.25rem]'), 'sheet Back uses the same 2.25rem box as map chrome');
assert(!hubJs.includes('py-2.5 px-4 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none'), 'sheet Back dropped the taller py-2.5 padding');

const delayReports = readFileSync(new URL('../src/lib/delay-reports.js', import.meta.url), 'utf8');
assert(delayReports.includes('isAdminAuthed'), 'train title flags require admin auth');
assert(delayReports.includes('!isDelayReportsUiEnabled(routeId) || !isAdminAuthed()'), 'flags skipped unless admin authed');

assert(layout.includes('html.nt-in-app body.nav-bottom:not(.nt-immersive) #bottom-nav.bottom-nav-bar'), 'in-app bottom nav floats over the board');
assert(layout.includes('html.nt-in-app body.nav-bottom:not(.nt-immersive) #app-scroll'), 'scroll canvas shows around the floating pill');
assert(layout.includes('window.ntFitAppViewport'), 'Layout exposes ntFitAppViewport for PWA/TWA inset');
assert(layout.includes('--nt-sys-bottom'), 'Layout still measures --nt-sys-bottom for the pill offset');
assert(!layout.includes('interactive-widget=overlays-content'), 'layout viewport meta does not overlay-lock the IME');
assert(layout.includes('lastLayoutH'), 'keyboard keeps full-screen layout height so the oval stays put');
assert(layout.includes('Layout height never follows visualViewport'), 'keyboard does not shrink --nt-app-h');
assert(layout.includes('body.modal-active #dev-modal > div'), 'admin canvas grows with its lists');
assert(layout.includes('background-color: #f9fafb'), 'admin overlay canvas is gray-50, not black');
assert(layout.includes('classList.toggle(\'nt-keyboard\''), 'keyboard class is stamped on html');
assert(layout.includes('padding-bottom: 0 !important'), 'in-app shell has no tray pad under the pill');
assert(!layout.includes('sys = 48'), 'no invented 48px Android tray under the pill');
assert(layout.includes('android-app://'), 'TWA referrer is treated as standalone');
assert(layout.includes('nt-standalone'), 'standalone class is stamped on html');
assert(css.includes('#bottom-nav .bottom-nav-item.is-active'), 'active tab has a highlight rule');
assert(css.includes('--nt-chrome-nav-active'), 'active tab highlight uses the pack token');
assert(!css.includes("color-mix(in srgb, #fff 16%, var(--nt-chrome-nav))"), 'active tab dropped the loud 16% mix');
assert(css.includes('border-bottom-left-radius: 1.25rem'), 'sidenav bottom-left is rounded above the oval');
assert(layout.includes('body.nav-bottom:not(.nt-immersive) #sidenav-overlay'), 'Options overlay has a dedicated rule');
assert(/#sidenav-overlay \{\s*inset:\s*0;/.test(layout), 'Options scrim covers the full viewport including under the oval');

const recovery = readFileSync(new URL('../src/lib/recovery.js', import.meta.url), 'utf8');
assert(recovery.includes('visibilityState'), 'recovery counts visible time only');
assert(recovery.includes('overlayStillBlocking'), 'auto-lifeboat requires the loading overlay');
assert(!recovery.includes("if (!board || !tabs) return true"), 'recovery does not treat hidden top tabs as a crash');
assert(recovery.includes('view-trip-planner'), 'planner tab is a healthy shell');

const bootLogic = readFileSync(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
assert(bootLogic.includes('markSchedulesCoreReady'), 'cached schedules stabilize the shell immediately');
assert(bootLogic.includes('loadBundledScheduleDump'), 'empty IDB falls back to the host dump');
assert(bootLogic.includes('data/full-database.json'), 'bundled dump path is this repo public/data');

const appUpdate = readFileSync(new URL('../src/lib/app-update.js', import.meta.url), 'utf8');
assert(!appUpdate.includes('await caches.delete(name)'), 'force-update does not wipe Cache Storage');
assert(!appUpdate.includes('await registration.unregister()'), 'force-update does not unregister every worker');
assert(appUpdate.includes('You are offline. Using saved times'), 'offline force-update keeps the cached shell');
assert(appUpdate.includes("New SW active — applying on next launch"), 'controllerchange keeps the session without a pending token');

assert(plannerModals.includes('Germiston or Bellville'), 'planner instructions use Bellville as the WC hub example');
assert(!plannerModals.includes('Germiston or Koedoespoort'), 'planner instructions dropped Koedoespoort example');

if (failures.length) {
    console.error('verify-appearance failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-appearance: ok');
