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

const sidenav = readFileSync(new URL('../src/components/Sidenav.astro', import.meta.url), 'utf8');
assert(sidenav.includes('id="settings-account-btn"') && sidenav.includes('data-admin-authed-only'), 'Account row is admin-gated');

const chrome = readFileSync(new URL('../src/lib/admin-chrome.js', import.meta.url), 'utf8');
assert(chrome.includes('applyAdminAuthedChrome'), 'admin-chrome reveal helper exists');
assert(chrome.includes('Never use five-tap unlock'), 'admin chrome is not five-tap gated');

const layout = readFileSync(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8');
assert(layout.includes('window.ntCartoVoyagerUrl'), 'Layout exposes optional CARTO Voyager URL helper');
assert(layout.includes('PUBLIC_CARTO_API_KEY'), 'Layout reads PUBLIC_CARTO_API_KEY');

const plannerUi = readFileSync(new URL('../src/lib/planner-ui.js', import.meta.url), 'utf8');
assert(plannerUi.includes('ntCartoVoyagerUrl'), 'planner map uses ntCartoVoyagerUrl');

const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
assert(mapApp.includes('ntCartoVoyagerUrl'), 'network map uses ntCartoVoyagerUrl');

if (failures.length) {
    console.error('verify-appearance failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-appearance: ok');
