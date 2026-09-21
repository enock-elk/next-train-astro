/**
 * Appearance chrome tokens + weekday middot.
 * Run: node scripts/verify-appearance.mjs
 */
import { readFileSync } from 'node:fs';

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

const css = readFileSync(new URL('../src/styles/appearance.css', import.meta.url), 'utf8');
assert(css.includes('--nt-chrome-header'), 'appearance defines --nt-chrome-header');
assert(css.includes('--nt-text-faint'), 'appearance splits faint text from muted');
assert(css.includes('--nt-text-muted: #2c2822'), 'Earthy light muted ink matches body text');
assert(css.includes('--nt-text-faint: #3a3530'), 'Earthy light faint stays readable on cream');
assert(css.includes('html[data-colour-pack="earthy"]:not(.dark) .text-blue-600'), 'Earthy maps label blue to dark ink');
assert(css.includes('html[data-colour-pack="earthy"].dark .text-blue-400'), 'Earthy dark maps pale blue labels to light ink');
assert(css.includes('html[data-colour-pack="earthy"].dark #planner-back-btn'), 'Earthy dark planner toolbar uses light ink');
assert(css.includes('.nt-fare-zone-chip'), 'fare Zone chip has a pack-aware class');
assert(/html\[data-colour-pack="earthy"\] #view-full-timetable-btn/.test(css), 'Earthy weakens the timetable CTA halo');
assert(!css.includes('data-colour-pack="ember"'), 'Ember pack CSS is gone');
assert(/\.text-gray-400,[\s\S]*?--nt-text-faint/.test(css), 'gray-400 maps to faint, not muted');
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
assert(css.includes('--nt-chrome-nav: #0e0d0c'), 'Earthy dark nav is near-black, distinct from header');
assert(!/html\.dark #app-header\.nt-maint-active \{\s*background-color: rgb\(31 41 55\)/.test(css), 'maint header must not hardcode gray-800');
assert(css.includes('#grid-trigger-container'), 'timetable CTA has extra canvas gap');
assert(css.includes('.nt-board-footer.mt-auto'), 'board footer padding stays on nt-board-footer mt-auto');
assert(css.includes('0 6px 18px') || css.includes('0 -10px 28px') || css.includes('0 -8px'), 'nav has a drop shadow');
assert(css.includes('border-radius: 999px'), 'bottom nav is a floating pill');
assert(css.includes('#current-day'), 'day label letter-spacing rule present');

['midnight', 'contrast', 'signal', 'earthy'].forEach((pack) => {
    const block = css.split(`html[data-colour-pack="${pack}"]`)[1] || '';
    assert(block.includes('--nt-chrome-nav'), `${pack} light defines --nt-chrome-nav`);
    assert(block.includes('--nt-canvas'), `${pack} light defines --nt-canvas`);
});

const logic = readFileSync(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
assert(logic.includes(' · <span class="${typeClass}">'), 'logic.js day label uses middot');
assert(!logic.includes('ml-1'), 'logic.js day type span dropped ml-1');
assert(logic.includes('export function fitHeaderDayLabel'), 'day line scales to the Next Train title width');
assert(logic.includes('title.scrollWidth'), 'day line measures the Next Train title width');
assert(logic.includes('sm ? 12 : 11'), 'day line stays the old 11px / 12px subtitle size');
assert(!logic.includes('titlePx * 0.55'), 'day line is not scaled as a second headline');
assert(!/#current-day,[\s\S]{0,220}font-size: 2\.55rem/.test(css), 'day line no longer defaults to the title size');
assert(!css.includes('#current-day span {\n  font-weight: inherit'), 'day line span no longer inherits the title color');
assert(!css.includes('color: #fecaca !important'), 'Classic No Service is not peach-red');
assert(css.includes('#current-day span.text-red-600'), 'No Service targets the red-600 span');
assert(css.includes('color: #f87171 !important;'), 'No Service uses dark-mode red-400 in light and dark');
assert(!/#current-day span\.text-red-600[\s\S]{0,180}color:\s*#dc2626 !important;/.test(css), 'No Service no longer uses red-600 on Classic light');
assert(css.includes('html.dark #current-day span.text-red-600'), 'dark No Service uses one red-400');
assert(css.includes('color: var(--nt-chrome-muted) !important'), 'Classic Sunday stays muted chrome, not white');
assert(css.includes('#notice-bell.nt-bell-info {\n  background-color: #ffffff !important;'), 'info bell is a white disc on every pack');
assert(css.includes('html.dark #notice-bell.nt-bell-info {\n  background-color: #ffffff !important;'), 'dark info bell keeps a white disc');
assert(!css.includes('background-color: var(--nt-surface) !important;\n  color: var(--nt-chrome-fg) !important;'), 'Earthy no longer wash the bell into the header');
assert(css.includes('html[data-colour-pack="earthy"] #notice-bell.nt-bell-info'), 'paper packs keep a stronger bell ring');

const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
assert(header.includes("names[day] + ' · <span"), 'Header boot uses middot');
assert(!header.includes('ml-1'), 'Header boot dropped ml-1');
assert(header.includes('translate-x-1/4 -translate-y-1/4'), 'unread dot sits on the outer corner of the bell');
assert(header.includes('w-6 h-6'), 'header bell icon is 24px');
assert(header.includes('text-[11px] sm:text-xs font-medium'), 'Header day line uses the original subtitle face');
assert(!header.includes('header-day-label'), 'Header day line is not a second bold title');
assert(header.includes('fitHeaderDayLabel') || logic.includes('fitHeaderDayLabel'), 'day line fit helper is present');

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
assert(/id="main-content"[^>]*style="visibility:\s*hidden;?"/.test(indexPage), '14.1 home shell starts inline-hidden until the two-frame drop');
assert(indexPage.includes('id="loading-overlay"'), '14.1 boot cover lives on the home page');
assert(indexPage.includes('loading-logo-splash.webp'), '14.1 boot shows the 64px train logo');
assert(indexPage.includes('Starting Next Train…'), '14.1 Starting copy is visible on the gray overlay');
assert(indexPage.includes('setTimeout(revealAppShell, 700)'), '14.1 boot drops the logo at 700ms');
assert(indexPage.includes('requestAnimationFrame(() => {\n        requestAnimationFrame(() => {\n            revealAppShell();'), '14.1 boot drops after two frames');
assert(!indexPage.includes('boardChromeReady'), '14.1 boot does not wait for dest names');
assert(!indexPage.includes('INSTALLED_SPLASH_MS'), '14.1 boot has no 8s installed splash hold');
assert(!indexPage.includes('nt-boot-browser'), '14.1 boot does not classify TWA vs browser for the overlay');

const sidenav = readFileSync(new URL('../src/components/Sidenav.astro', import.meta.url), 'utf8');
assert(sidenav.includes('id="settings-account-btn"'), 'Account row exists in Options');
assert(!/id="settings-account-btn"[^>]*data-admin-authed-only/.test(sidenav), 'Account row is not admin-only; signed-in commuters keep it');
assert(sidenav.includes('id="sidenav-legacy-settings"'), 'Passenger Type can stay in Options for guests');
assert(sidenav.includes('id="sidenav-prefs-block"'), 'Theme block can move into Account');
assert(sidenav.includes('data-colour-pack-option="classic"'), 'Classic pack is in Options');
assert(sidenav.includes('data-colour-pack-option="earthy"'), 'Earthy pack is in Options');
assert(!sidenav.includes('data-colour-pack-option="ember"'), 'Ember pack is not in Options');

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
assert(layout.includes('font-size: clamp(13.12px, calc(100vw * 16 / 390), 16px)'), 'Layout first-paint scales html rem on phones');
assert(layout.includes('font-size: max(16px, 1em) !important'), 'Layout first-paint floors focused fields at 16px');
assert(layout.includes('font-size: max(16px, 1.125rem) !important'), 'Layout keeps text-lg station fields at 1.125rem when that is larger');
assert(layout.includes('maximum-scale=5.0'), 'Layout still allows pinch zoom');
assert(!layout.includes('user-scalable=no'), 'Layout does not disable zoom to dodge iOS input focus');
const contentLayout = readFileSync(new URL('../src/layouts/ContentLayout.astro', import.meta.url), 'utf8');
assert(contentLayout.includes('font-size: clamp(13.12px, calc(100vw * 16 / 390), 16px)'), 'map layout first-paint scales html rem on phones');
assert(contentLayout.includes('font-size: max(16px, 1em) !important'), 'map layout floors focused fields at 16px');
assert(layout.includes('max-width: 28rem'), 'phone shell keeps the 28rem max stretch');
assert(!/max-width:\s*639px[\s\S]{0,180}max-width:\s*none/.test(layout), 'phone shell no longer drops max-width');

assert(css.includes('#app-header .seo-open-app'), 'SEO header Open link uses chrome foreground');
assert(css.includes('.nt-maint-wrench'), 'maintenance strip has a wrench icon');
assert(css.includes('.nt-maint-label'), 'maintenance strip has a label');
assert(!css.includes('repeating-linear-gradient'), 'maintenance strip is not hazard tape');
assert(!css.includes('#app-header.nt-maint-active #app-title'), 'maintenance bar does not restyle the title overlay');

const prefs = readFileSync(new URL('../src/lib/prefs.js', import.meta.url), 'utf8');
assert(prefs.includes('syncInAppChrome'), 'prefs exports syncInAppChrome after Welcome');
assert(prefs.includes("getItem('welcomeSeen') === 'true' && !welcomeOpen"), 'bottom bar waits until Welcome is done');
assert(prefs.includes('ntProdClassicPackV1'), 'production pack FLAG still exists');
assert(!prefs.includes('if (pack && pack !== COLOUR_PACKS.CLASSIC)'), 'missing FLAG does not remap Earthy to Classic');
assert(prefs.includes('syncPrefsAccordionSummary'), 'theme accordion subtitle follows the live pack');
assert(prefs.includes('restoreLookPrefs'), 'look prefs restore from IndexedDB after a purge');
assert(prefs.includes('resetLookToClassicLight'), 'Check for Updates can force Classic light');
assert(prefs.includes('setResilientItem'), 'colour pack writes mirror to IndexedDB');
assert(prefs.includes('restoreHolidaySeenPrefs'), 'holiday dismiss map restores after a purge');
assert(layout.includes('ntProdClassicPackV1'), 'Layout boot still stamps the production pack FLAG');
assert(!layout.includes("if (storedPack && storedPack !== 'classic')"), 'Layout boot does not remap a saved colour pack');
assert(!layout.includes("localStorage.setItem('theme', 'light')"), 'Layout boot does not persist a missing theme before IndexedDB restore');

const welcome = readFileSync(new URL('../src/components/WelcomeModal.astro', import.meta.url), 'utf8');
assert(welcome.includes('later in Options'), 'Welcome copy points at Options, not side menu');
assert(welcome.includes('syncInAppChrome'), 'Welcome calls syncInAppChrome after a route pick');

const plannerUi = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
assert(css.includes('height: 2rem') && css.includes('#planner-header-badge > div'), 'planner Back, day, and Share share the old 2rem box');
assert(!/#planner-back-btn,[\s\S]{0,400}min-height: 2.5rem/.test(css), 'planner toolbar is not the taller 2.5rem lock');
assert(!/#planner-back-btn,[\s\S]{0,360}font-size: calc\(0.8rem \* var\(--nt-ui-scale/.test(css), 'planner toolbar is not scaled down on phones');
assert(css.includes('font-size: clamp(13.12px, calc(100vw * 16 / 390), 16px)'), 'phones scale html rem from viewport width');
assert(css.includes('font-size: max(16px, 1em) !important'), 'hashed CSS floors typed fields at 16px so iOS does not zoom');
assert(css.includes('input.text-lg'), 'hashed CSS preserves Home/Planner text-lg fields');
assert(css.includes('font-size: max(16px, 1.125rem) !important'), 'text-lg fields stay 1.125rem when that is ≥16px');
assert(css.includes('--nt-ui-scale: clamp(0.82, 100vw / 390px, 1)'), 'phone scale floor is 320/390');
assert(!css.includes('clamp(0.90, calc(100vw / 390), 1.06)'), 'phone scale no longer floors at 0.90');
assert(!plannerUi.includes('PLANNER_VIEWPORT_NO_ZOOM'), 'planner no longer rewrites the viewport to suppress input zoom');
assert(
    /input\.addEventListener\('focus', \(\) => \{\s*try \{ input\.select\(\); \}/.test(plannerUi),
    'station focus unconditionally selects existing text for immediate replacement'
);
assert(
    !/input\.addEventListener\('focus'[\s\S]{0,220}pointer:\s*coarse/.test(plannerUi),
    'touch devices keep the one-tap station replacement behavior'
);
assert(plannerUi.includes('positionDropdownAroundTrigger'), 'planner dropdowns stay inside the visible viewport');
assert(!plannerUi.includes('keepPlannerFieldVisible') && plannerUi.includes('Do not scroll #app-scroll'), 'planner fields stay put while dropdowns fit the visible viewport');
assert(plannerUi.includes('holdPlannerScroll'), 'From station still pins #app-scroll');
assert(plannerUi.includes("input.id === 'planner-to-search'"), 'Select To Station does not pin #app-scroll');
assert(plannerUi.includes('FIRST_PAINT'), 'full station browse paints a first chunk so the tap stays responsive');
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
assert(planner.includes('min-h-[2.875rem]'), 'planner info pill matches board route pill min-height');
assert(planner.includes('flex items-center justify-center w-full h-full min-w-0'), 'Advanced Multi-Transfer Routing is vertically centered');
assert(planner.includes('id="planner-back-btn"') && planner.includes('h-8'), 'planner Back uses the old 2rem pill');
assert(planner.includes('min-h-[32px]'), 'planner results toolbar row is the old 32px line');
assert(plannerUi.includes('h-8') && plannerUi.includes('text-xs font-bold'), 'planner weekday and Share use the same 2rem text-xs pill');

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
const chrisPath = mapApp.match(/'ct-chrishani': \[([^\]]+)\]/);
assert(!!chrisPath && !chrisPath[1].includes('ESPLANADE'), 'Chris Hani path no longer jumps Ysterplaat to Mutual');
assert(
    /'ct-nolu': \[[^\]]*ESPLANADE[^\]]*YSTERPLAAT[^\]]*MUTUAL/.test(mapApp),
    'Nolungile static path runs Esplanade then Ysterplaat then Mutual'
);
assert(mapApp.includes('function applyCanonicalStationOrder'), 'map paints from official station order');
assert(mapApp.includes('function railHopSkipsRouteStop'), 'OSM hops cannot skip another stop on the route');
assert(mapApp.includes('function pathVisitsStopsInOrder'), 'baked tracks must visit stations in list order');
assert(mapApp.includes('function bindMapLegendToggle'), 'Network Lines binds as a button');
assert(mapApp.includes('function applySelectedLine'), 'legend tap isolates one corridor');
assert(mapApp.includes('"AVOCA", "DUFF\'S ROAD"'), 'KZN north line paints Avoca then Duff\'s Road');
assert(!mapApp.includes('"AVOCA", "TEMPLE", "KENVILLE", "EFFINGHAM", "DUFF\'S ROAD"'), 'Bridge City path no longer loops Avoca via Effingham');
assert(!mapApp.includes('if (baked && baked.length > 1) return baked;'), 'map does not paint unordered baked tracks');

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
assert(css.includes('#alerts-channel-wallpaper'), 'alerts wallpaper uses the colour pack');
assert(css.includes('.nt-pack-wallpaper'), 'Alerts, Community, and Feedback Hub share .nt-pack-wallpaper');
assert(
    /\.nt-pack-surface\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*hidden;/.test(css),
    'interactive wallpaper surfaces establish a clipped positioning context'
);
assert(
    /\.nt-pack-surface\s*>\s*\*\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/.test(css),
    'interactive wallpaper surfaces keep their controls above the decoration'
);
assert(
    /\.nt-pack-surface::before\s*\{[^}]*pointer-events:\s*none;/.test(css),
    'interactive wallpaper decoration cannot intercept control input'
);
assert(
    !/\.nt-pack-surface\s*\{[^}]*pointer-events:\s*none;/.test(css),
    'interactive wallpaper surface remains a hit-test target'
);
assert(css.includes('mask-image'), 'alerts wallpaper tiles via mask-image so pack tokens colour it');
assert(css.includes('color-mix(in srgb, var(--nt-chrome-header) 16%, var(--nt-canvas))'), 'alerts wallpaper wash follows chrome + canvas');
assert(/nt-alert-strip-info \{\s*background-color: color-mix\(in srgb, var\(--nt-primary\)/.test(css), 'info strip is a quiet primary wash');
assert(!/nt-alert-strip-info \{\s*background-color: #2563eb/.test(css), 'info strip is no longer a solid blue banner');
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
assert(css.includes('color-mix(in srgb, var(--nt-chrome-fg) 16%, var(--nt-chrome-nav))'), 'Earthy light tab chip is an ink wash');
assert(css.includes('--nt-primary: #d8d6ce'), 'Earthy light CTA is desaturated paper sage');
assert(css.includes('--nt-chrome-header: #efeee9'), 'Earthy header is a quiet paper, not a sage wash');
assert(css.includes('#planner-search-btn'), 'Plan Trip uses pack primary tokens');
assert(css.includes('#planner-locate-btn'), 'planner locate uses pack primary tokens');
assert(css.includes('html, body, #nt-shell'), 'shell paints canvas so the Options gap is not raw white');

const ridePings = readFileSync(new URL('../src/lib/ride-pings.js', import.meta.url), 'utf8');
assert(ridePings.includes('isAdminAuthed()'), 'nearby chip requires admin auth');
assert(ridePings.includes("if (!isAdminAuthed()) return;"), 'nearby click is admin-gated');
assert(ridePings.includes('syncRidePresenceRow'), 'presence row hides when nearby and chip are empty');
assert(ridePings.includes('canSeeLiveShareChrome'), 'live-share chip is pin/admin gated');
assert(!ridePings.includes('data-live-share-stop'), 'Next Train board has no legacy sharing stop chip');
assert(ridePings.includes('findConflictingShare') && ridePings.includes('Already sharing elsewhere'), 'second-device share is blocked');
assert(ridePings.includes('shareReachedTerminus'), 'share ends at the last station');
assert(ridePings.includes('RIDE_SHARE_IDLE_MS = 30 * 60 * 1000'), 'ride ping idle TTL is 30 minutes');

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
assert(mapTab.includes("type: 'nt-map-focus-route'"), 'Map tab focuses the pinned corridor, not GPS');
assert(mapTab.includes('Map isn’t available offline'), 'Map tab has an offline saved-copy fallback');
assert(mapTab.includes('&region='), 'Map tab iframe boots with the selected region');
assert(mapApp.includes('if (!isMapTabEmbed())'), 'Map tab ignores the GPS map session region');
assert(mapApp.includes("data.type === 'nt-map-focus-route'"), 'embedded map accepts a pinned-route focus message');

const mapView = readFileSync(new URL('../src/components/MapView.astro', import.meta.url), 'utf8');
assert(mapView.includes("withBase('/map.html')"), 'Map tab iframe loads map.html not the SPA');
assert(!mapView.includes("withBase('/map')?embed"), 'Map tab does not use extensionless /map');

const astroCfg = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
assert(astroCfg.includes('/\\/map(?:\\.html)?(?:$|[/?#])/'), 'SW navigateFallback denylists /map');
assert(astroCfg.includes('ignoreURLParametersMatching'), 'SW matches map.html even with embed/v query params');

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
assert(hubModals.includes('align-items: stretch'), 'Feedback Hub fills the screen');
assert(hubModals.includes('padding-bottom: 0'), 'Feedback Hub has no gap above the keyboard');
assert(/#messages-thread-modal \{\s*position: absolute;\s*inset: 0;/.test(hubModals), 'Feedback Hub fills #nt-shell like the Community tab');
assert(!/#messages-thread-modal \{[^}]*height: var\(--nt-feedback-vv-height/.test(hubModals), 'Feedback Hub CSS does not freeze a copied visualViewport height');
assert(!/#messages-thread-modal \{[^}]*var\(--nt-shell-h/.test(hubModals), 'Feedback Hub CSS does not copy a measured shell height');
assert(hubModals.includes('height: 100%'), 'Feedback Hub card height matches the keyboard-safe overlay');
assert(!hubModals.includes('h-[min(90dvh,40rem)]'), 'Feedback Hub is not a centered 40rem card');
assert(hubModals.includes('items-stretch justify-center p-0'), 'Feedback Hub overlay has no inset gap');
assert(hubModals.includes('items-center justify-center p-4'), 'Send Feedback overlay is centered in the visible viewport');
assert(!hubModals.includes('items-end justify-center p-4 pb-0'), 'Send Feedback is not docked to the keyboard like Hub');
assert(hubModals.includes('display: flow-root'), 'inbox message text contains floated timestamps');
assert(/#feedback-modal \{\s*align-items: center;/.test(hubModals), 'Send Feedback CSS keeps align-items center');
assert(/#messages-thread-modal \{\s*align-items: stretch;/.test(hubModals), 'Feedback Hub CSS stretches full screen');
assert(/#messages-thread-modal \{\s*align-items: stretch;\s*justify-content: center;/.test(hubModals), 'Feedback Hub CSS centers the sheet horizontally');
assert(!/#messages-thread-modal \{\s*align-items: flex-end;/.test(hubModals), 'Feedback Hub CSS no longer docks with flex-end');
assert(hubModals.includes('id="cache-clear-modal"'), 'Check for Updates has a confirm modal');
assert(hubModals.includes('id="cache-clear-confirm-btn"'), 'Check for Updates confirm has Update');
assert(hubModals.includes('This downloads the latest app onto this phone, then restarts Next Train.'), 'Check for Updates confirm explains the restart');
assert(hubModals.includes('Your pinned route stays, but the look goes back to Classic light.'), 'Check for Updates confirm mentions Classic light');
assert(!hubModals.includes('stuck copy'), 'Check for Updates does not mention stuck copy');
assert(hubModals.includes('id="messages-thread-contact-hint"'), 'Feedback Hub contact hint is present');
assert(hubModals.includes('#messages-thread-contact.nt-contact-invalid'), 'invalid contact uses a red border');
assert(hubModals.includes('Unofficial & Independent'), 'About unofficial pill present');
assert(hubModals.includes('bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100'), 'About unofficial pill uses readable surface contrast');
assert(hubModals.includes('#feedback-panel .inbox-bubble-own'), 'admin inbox shares WhatsApp own-bubble tokens');
assert(hubModals.includes('#feedback-panel .inbox-bubble-other'), 'admin inbox shares WhatsApp other-bubble tokens');
assert(hubModals.includes('#feedback-panel .feedback-thread-chat'), 'admin thread wallpaper selector');
assert(hubModals.includes('nt-pack-wallpaper'), 'Feedback Hub uses the shared pack wallpaper');
assert(hubModals.includes('#roadmap-body.nt-pack-surface'), 'Roadmap wallpaper styling follows the interactive surface class');
assert(!hubModals.includes('#roadmap-body.nt-pack-wallpaper'), 'Roadmap has no stale decorative-only wallpaper selector');
assert(!hubModals.includes('background: #efeae2'), 'Feedback Hub dropped the #efeae2 wallpaper wash');
assert(hubModals.includes('#d9fdd3'), 'own bubble is WhatsApp green');
assert(hubModals.includes('#005c4b'), 'dark own bubble is WhatsApp teal');

const mapPage = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
assert(mapPage.includes('aria-label="Network Lines"'), 'Network Lines is a labelled SVG button');
assert(!mapPage.includes('map-lines-label'), 'Network Lines dropped the wide text label');
assert(mapPage.includes('id="map-back-wrap"') && mapPage.includes('id="map-top-controls"'), 'Back sits in the map top chrome row');
assert(mapPage.includes('max-height: min(38vh, 280px)'), 'Network Lines panel is compact');
assert(mapPage.includes('rgba(255, 255, 255, 0.78)'), 'Network Lines panel is see-through');
assert(mapPage.includes('top: max(0.5rem, env(safe-area-inset-top, 0px))'), 'standalone map chrome clears the status bar');
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
assert(board.includes('min-h-[2.875rem]'), 'route pill min-height follows rem scale');
assert(board.includes('id="route-corridor-label"'), 'route pill has a corridor row');
assert(!/id="route-corridor-label" class="hidden /.test(board), 'corridor row is not display:none');
assert(board.includes('min-h-[0.75rem]'), 'corridor row reserves height');
assert(css.includes('#route-corridor-label'), 'appearance reserves corridor label height');
assert(board.includes('h-[3.375rem]'), 'station field height follows rem scale');
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
assert(uiJs.includes('safeCur === lastTab'), 'last content tab swipe-left opens Options');
assert(uiJs.includes('canAccessPilotSurface'), 'swipe and hash restore respect pin-gated Map/Community');
assert(uiJs.includes("m.openAppHub"), 'planner swipe-left calls openAppHub');
assert(uiJs.includes("modalId === 'route-modal' && !$currentRouteId.get()"), 'Select Route cannot close onto an empty board');

const hubJs = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
assert(hubJs.includes('collapsePrefsAccordion'), 'opening Options collapses Theme & Preferences');
assert(hubJs.includes('autosizeMessagesThreadInput'), 'Feedback Hub composer grows before scrolling');
assert(hubJs.includes('syncFeedbackModalViewport'), 'feedback overlays resize when the keyboard opens');
assert(hubJs.includes('clearHubInlineGeometry'), 'Feedback Hub clears inline geometry from older builds');
assert(
    /if \(id === 'messages-thread-modal'\) \{\s*clearHubInlineGeometry\(modal, card\);\s*return;\s*\}/.test(hubJs),
    'Feedback Hub geometry is CSS only, never a measured pixel height'
);
assert(hubJs.includes("field.closest?.('#messages-thread-form')"), 'Hub composer does not scroll the sheet while typing');
assert(!hubJs.includes('const coverH = Math.max(height, height + top)'), 'Feedback Hub does not stretch past the visual hole');
assert(hubJs.includes("id === 'messages-thread-modal'"), 'Feedback Hub is sized separately from Send Feedback');
assert(!hubJs.includes("id === 'messages-thread-modal' || id === 'account-modal'"), 'Account is not keyboard-shrunk with Feedback Hub');
assert(hubJs.includes('keepFeedbackFieldVisible'), 'focused feedback fields scroll inside the modal');
assert(hubJs.includes('editing && vv?.height'), 'Feedback Hub uses live visualViewport height while typing');
assert(hubJs.includes('modal.style.maxHeight'), 'Feedback Hub maxHeight follows the keyboard');
assert(hubJs.includes('fieldRect.height > availableHeight'), 'tall feedback fields align their first line inside a short scroller');
assert(hubJs.includes('window.visualViewport?.height || window.innerHeight'), 'feedback composer growth uses visible height');
assert(hubJs.includes('Always show contact + privacy lock'), 'Feedback Hub contact row stays visible when signed in');
assert(!/if \(signedIn\) \{[\s\S]{0,80}row\.classList\.add\('hidden'\)/.test(hubJs), 'signed-in contact row is not hidden');
assert(hubJs.includes('resetLookToClassicLight'), 'Check for Updates resets look to Classic light');
assert(hubJs.includes('openCacheClearConfirm'), 'Check for Updates asks before downloading');
assert(hubJs.includes('window.__ntOpenNetworkMapSheet'), 'sidenav Network Map still opens the in-app sheet');
assert(hubJs.includes('window.__ntFullscreenMapTab'), 'Map tab fullscreen stays on the tracking map');
assert(hubJs.includes('window.__ntInAppSheetOpen = true'), 'in-app sheet open flag is set');
assert(hubJs.includes('min-h-[2.25rem]'), 'sheet Back uses the same 2.25rem box as map chrome');
assert(!hubJs.includes('py-2.5 px-4 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none'), 'sheet Back dropped the taller py-2.5 padding');

const delayReports = readFileSync(new URL('../src/lib/delay-reports.js', import.meta.url), 'utf8');
assert(delayReports.includes('isAdminAuthed'), 'train title flags require admin auth');
assert(delayReports.includes('!isDelayReportsUiEnabled(routeId) || !isAdminAuthed()'), 'flags skipped unless admin authed');
assert(delayReports.includes('openReportsFeedSheet'), 'banner VIEW opens the reports list');
assert(delayReports.includes('function reportStationLabel'), 'report surfaces sentence-case station names');
assert(!delayReports.includes('Pending:'), 'board cards do not show Pending chips');
assert(!delayReports.includes('Verify delay'), 'board cards do not show Verify delay');

assert(layout.includes('html.nt-in-app body.nav-bottom:not(.nt-immersive) #bottom-nav.bottom-nav-bar'), 'in-app bottom nav floats over the board');
assert(layout.includes('html.nt-in-app body.nav-bottom:not(.nt-immersive) #app-scroll'), 'scroll canvas shows around the floating pill');
assert(layout.includes('window.ntFitAppViewport'), 'Layout exposes ntFitAppViewport for PWA/TWA inset');
assert(layout.includes('--nt-sys-bottom'), 'Layout still measures --nt-sys-bottom for the pill offset');
assert(!layout.includes('pinBottomNav'), 'bottom nav has no synthetic geometry pin');
assert(!layout.includes('--nt-nav-lift'), 'bottom nav has no synthetic lift token');
assert(layout.includes('html.nt-standalone.nt-in-app body.nav-bottom:not(.nt-immersive) #bottom-nav.bottom-nav-bar'), 'standalone oval clears the home indicator');
assert(layout.includes('bottom: var(--nt-sys-bottom, env(safe-area-inset-bottom, 0px));'), 'oval uses only the measured system inset on standalone');
assert(layout.includes('if (!markStandalone()) sys = 0'), 'Safari does not lift the oval by the home-indicator inset');
assert(layout.includes('100svh'), 'shell first-paint height falls back to 100svh');
assert(layout.includes('Never use Math.max(inner, client)'), 'shell height never grows past the visible frame');
assert(layout.includes('--nt-vv-h'), 'layout exposes visual viewport height for keyboard overlays');
assert(layout.includes('#nt-shell #messages-thread-modal.fixed'), 'Feedback Hub is not locked to --nt-app-h');
assert(/#nt-shell #messages-thread-modal\.fixed \{\s*position: absolute !important;\s*inset: 0 !important;/.test(layout), 'Feedback Hub fills #nt-shell like the Community tab');
assert(!/#nt-shell #messages-thread-modal\.fixed \{[^}]*var\(--nt-(app-h|shell-h|vv-h|feedback-vv)/.test(layout), 'Feedback Hub is not sized from a measured viewport token');
assert(layout.includes('hubOn'), 'keyboard keeps Feedback Hub shell height like Community');
assert(
    css.includes(':not(#blackbox-modal):not(#messages-thread-modal):not(#account-modal) > div'),
    'Feedback Hub and Account cards are not capped by the bottom-nav clearance that left the slab'
);
assert(
    css.includes(':not(#blackbox-modal):not(#messages-thread-modal):not(#account-modal),'),
    'Feedback Hub and Account do not get the bottom-nav padding meant for centred cards'
);
assert(layout.includes('#nt-shell #account-modal.fixed'), 'Account overlay is a full-screen page');
assert(/#nt-shell #account-modal\.fixed \{\s*\/\*[\s\S]*?\*\/\s*position: absolute !important;\s*inset: 0 !important;/.test(layout), 'Account fills #nt-shell without measured viewport height');
assert(!/#nt-shell #account-modal\.fixed \{[^}]*var\(--nt-(app-h|shell-h|vv-h)/.test(layout), 'Account is not sized from a stale viewport token');
assert(layout.includes('html.nt-full-overlay #nt-shell'), 'full-screen overlays cover the blue chrome strip');
assert(layout.includes('html.nt-full-overlay::before'), 'full-screen overlays paint only the URL-bar strip');
assert(!/html\.nt-full-overlay #nt-shell,[\s\S]{0,80}top:\s*0/.test(layout), 'full overlay does not zero #nt-shell top');
assert(!/html\.nt-full-overlay,[\s\S]{0,80}html\.nt-full-overlay body \{[\s\S]{0,80}background-color:\s*#fff/.test(layout), 'full overlay does not paint html/body white');
assert(!layout.includes('header-meta #current-day') || !/header-meta #current-day[\s\S]{0,80}0\.65rem/.test(layout), 'compact chrome does not force the day line to 0.65rem');
assert(!layout.includes('interactive-widget=overlays-content'), 'layout viewport meta does not overlay-lock the IME');
assert(layout.includes('lastLayoutH'), 'keyboard keeps full-screen layout height so the oval stays put');
assert(layout.includes('lastFullLayoutH'), 'keyboard does not overwrite the full-screen layout height');
assert(layout.includes('lastShellH'), 'keyboard keeps a last-visible shell fallback');
assert(layout.includes('function atLeastFull'), 'shell height ignores sub-240 first readings');
assert(layout.includes("localStorage.getItem('welcomeSeen') === 'true'"), 'returning users skip the 14.1 overlay before first paint');
assert(layout.includes("sessionStorage.getItem('nt_shell_warm') === '1'"), 'warm same-session navigations skip the 14.1 overlay');
assert(layout.includes('if (seen || warm) document.documentElement.classList.add(\'nt-shell-ready\')'), 'welcomeSeen or warm stamps nt-shell-ready');
assert(layout.includes('html.nt-shell-ready #loading-overlay { display: none !important; }'), 'ready sessions hide the gray overlay');
assert(layout.includes('loading-logo-splash.webp'), 'layout preloads the 14.1 64px splash logo');
assert(!layout.includes('id="loading-overlay"'), '14.1 boot cover is not in the layout body');
assert(!layout.includes('isDefiniteBrowser'), '14.1 boot does not classify TWA vs browser');
assert(!layout.includes('nt-boot-installed'), '14.1 boot does not stamp a splash-hold class');
assert(!layout.includes("style={unlockShellEarly ? 'background-color:#1d4ed8' : undefined}"), '14.1 html first bytes are not forced OS-splash blue');
assert(/<body[^>]*>\s*<RecoveryLifeline \/>/.test(layout), 'lifeline stays the first app body node');
assert(layout.includes('--nt-shell-top'), 'shell is pinned below overlay chrome');
assert(layout.includes('--nt-shell-h'), 'shell height follows the visible hole');
assert(layout.includes('missing < 180'), 'URL-bar overlay uses the missing layout strip, not an invented tray');
assert(layout.includes('Pin #nt-shell to the LIVE visual hole'), 'keyboard sizes the shell to the live visual hole');
assert(layout.includes('#app-scroll:has(#view-map.active)'), 'Map still locks #app-scroll');
assert(layout.includes('#view-community.view-section.active'), 'Community composer sits above the IME');
assert(/#view-community \.community-pane \{\s*flex: 1 1 auto;/.test(layout), 'Community pane fills leftover height like Feedback Hub');
assert(/html\.nt-keyboard\.nt-in-app body\.nav-bottom:not\(\.nt-immersive\) #view-community\.view-section\.active \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?height:\s*auto;/.test(layout), 'Community keyboard keeps the stable lab flex-height logic');
assert(!/html\.nt-keyboard\.nt-in-app body\.nav-bottom:not\(\.nt-immersive\) #view-community\.view-section\.active \{[\s\S]*?height:\s*var\(--nt-vv-h/.test(layout), 'Community view is not double-positioned by visualViewport height');
assert(/html\.nt-keyboard\.nt-in-app body\.nav-bottom:not\(\.nt-immersive\) #view-community \.community-pane \{\s*flex: 1 1 auto;/.test(layout), 'Community keyboard pane does not shrink to fit the Next Train header');
assert(!/#view-community \.community-feed-scroll \{\s*padding-bottom:\s*6\.5rem/.test(layout), 'Community feed does not reserve a second composer gap');
assert(layout.includes('#community-composer-dock'), 'Community composer docks above the IME');
assert(layout.includes('html.nt-keyboard #messages-thread-form'), 'Feedback Hub composer docks above the IME like Community');
assert(layout.includes('--nt-kb-h'), 'keyboard exposes IME height for the composer dock');
assert(layout.includes('Community must not: leave the shell at full size'), 'Community keyboard leaves Next Train free to scroll away');
assert(!/html\.nt-keyboard[\s\S]{0,500}#app-scroll:has\(#view-community\.active\) \{\s*overflow:\s*hidden/.test(layout), 'Community keyboard does not freeze #app-scroll');
assert(!/html\.nt-keyboard[\s\S]{0,220}calc\(var\(--nt-shell-h/.test(layout), 'Community keyboard does not pad by frozen shell minus visual');
assert(layout.includes('border-width: 0 !important'), 'phone in-app drops the card hairline');
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
assert(!recovery.includes('LOADER_ESCAPE_MS'), '14.1 App stuck link is on the overlay immediately');
assert(!recovery.includes('INSTALLED_SPLASH_MS'), '14.1 recovery has no 8s splash-color hold');
assert(!recovery.includes('BROWSER_SLOW_BOOT_MS'), '14.1 recovery has no browser slow-boot clock');
assert(!recovery.includes('onStartingCoverElapsed'), '14.1 App stuck is not gated on Starting copy');

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

assert(!css.includes('th.nt-excl-head'), 'NO SVC header does not shift the train number with extra padding');

const rendererGrid = readFileSync(new URL('../src/lib/renderer.js', import.meta.url), 'utf8');
assert(rendererGrid.includes("isExport ? 'border-gray-200' : 'border-gray-300 dark:border-gray-700'"), 'export grid lines are softer; in-app borders stay');
assert(rendererGrid.includes('isExport ? " font-mono font-bold" : " font-mono font-medium"'), 'export times are bold; in-app grid times stay medium');
assert(rendererGrid.includes("isExport ? '21px' : '14px'") && rendererGrid.includes('headerContent = stack(`${banIcon} NO SVC`'), 'in-app NO SVC occupies the status row above the train number');
assert(rendererGrid.includes('font-size:18px') && rendererGrid.includes('font-weight:400') && rendererGrid.includes('line-height:14px;'), 'export train IDs are larger and regular weight; in-app IDs stay 14px');
assert(!rendererGrid.includes('nt-station-col, th:first-child'), 'export snapshot does not restyle the station column beyond the old renderer');
assert(css.includes('data-pilot-map'), 'bottom nav grows when Map is pin-gated on');
assert(css.includes('data-pilot-community'), 'bottom nav grows when Community is pin-gated on');

const adminChrome = readFileSync(new URL('../src/lib/admin-chrome.js', import.meta.url), 'utf8');
assert(adminChrome.includes('getPinnedRouteIds'), 'pilot chrome reads pinned routes');
assert(adminChrome.includes("safeStorage.getItem('defaultRoute_' + region)"), 'pilot access uses pin keys, not the viewed corridor');
assert(adminChrome.includes('FEATURE_KEYS.MAP_TAB'), 'Map tab is a pin-gated feature');
assert(adminChrome.includes('FEATURE_KEYS.COMMUNITY_TAB'), 'Community tab is a pin-gated feature');
assert(adminChrome.includes('isSignedInAccount()'), 'signed-in commuters keep Account when extra features are off');
assert(adminChrome.includes("addEventListener('accountchange'"), 'Account row reappears when someone signs in');
assert(adminChrome.includes('placeAccountSettings'), 'Passenger Type and Theme move into Account when that row is visible');

const liveBoard = readFileSync(new URL('../src/lib/live-board.js', import.meta.url), 'utf8');
assert(liveBoard.includes('isAdminAuthed() && rule && rule.expiresAt'), 'exclusion Until line is admin-only');
assert(liveBoard.includes("timeEl.classList.add('hidden')"), 'commuters do not see exclusion expiry');

const adminJs = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
assert(adminJs.includes('id="exp-features-header"'), 'System Controls has Experimental features');
assert(adminJs.includes("'exp-map-enabled'") && adminJs.includes("'exp-community-enabled'"), 'experimental Map and Community toggles exist');
assert(adminJs.includes("I'm on it / live share") && adminJs.includes('Delay reports') && adminJs.includes('Community realtime') && adminJs.includes('Push notifications'), 'experimental accordion lists remaining grantable features');
assert(!adminJs.includes("{ key: 'tripPrice', label: 'Trip price' }"), 'Trip price is not a grantable experimental feature');
assert(adminJs.includes('exp-feat-header') && adminJs.includes('exp-feat-body'), 'feature types are nested accordions');
assert(adminJs.includes('config/features.json'), 'experimental save writes config/features');
assert(adminJs.includes('config/feature_grants/'), 'feedback beta grants write config/feature_grants');
assert(adminJs.includes('grantableFeatures()') && adminJs.includes("routeIds: state.allRoutes ? ['*']"), 'save writes every grantable feature and keeps * for all-routes');
assert(css.includes('.nt-alert-reply'), 'alert Reply is styled separately from Close');
assert(css.includes('.nt-alert-source'), 'alert source has a quiet citation class');
assert(/\.nt-alert-source\s*\{[\s\S]*?font-size:\s*0\.6875rem/.test(css), 'alert source is smaller than body copy');
assert(/\.nt-alert-source\s*\{[\s\S]*?background:\s*transparent/.test(css), 'alert source is not a chip');
assert(/\.nt-alert-source\s*\{[\s\S]*?text-decoration-style:\s*dotted/.test(css), 'alert source link uses a dotted underline');
assert(css.includes('.nt-alert-card-footer'), 'alert footer is styled as two rows');
assert(css.includes('.nt-alert-meta-row'), 'alert source/time row is styled');
assert(css.includes('.nt-alert-action-row'), 'alert reactions/Reply row is styled');
assert(adminJs.includes("APP_MONTHS_SHORT") || readFileSync(new URL('../src/lib/utils.js', import.meta.url), 'utf8').includes("'Sept'"), 'app dates use Sept');
assert(/font\[size="4"\][^{]*\{[^}]*1\.05rem/.test(css), 'composer size 4 is the in-between tier');
assert(/font\[size="5"\][^{]*\{[^}]*font-weight:\s*inherit/.test(css), 'size 5 is not auto-bold');
assert(!/font\[size="5"\][^{]*\{[^}]*font-weight:\s*700/.test(css), 'size 5 dropped automatic 700 weight');
assert(/#alert-msg h3[\s\S]{0,80}font-weight:\s*800/.test(css), 'Title heading stays heavy');
assert(/#alert-msg \{\s*white-space:\s*pre-wrap;/.test(css), 'alert editor wraps with pre-wrap');
assert(css.includes('overflow-x: hidden'), 'rich text blocks hide horizontal overflow');
assert(adminJs.includes("currentSize === 4") && adminJs.includes('newSize = 4'), 'A+ cycles through size 4');
assert(adminJs.includes('border-b border-gray-300 dark:border-gray-600'), 'toolbar has a gap/border above the editor');

const richText = readFileSync(new URL('../src/lib/rich-text.js', import.meta.url), 'utf8');
assert(richText.includes('font[size="4"]'), 'shared rich-text CSS includes size 4');
assert(/font\[size="5"\][^{]*\{[^}]*font-weight: inherit/.test(richText), 'shared rich-text size 5 is not auto-bold');

if (failures.length) {
    console.error('verify-appearance failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-appearance: ok');
