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
assert(css.includes('#0d2444'), 'Classic dark nav is navy family, not gray-800');
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
assert(logic.includes('${dayNames[day]} · <span'), 'logic.js day label uses middot');
assert(!logic.includes('ml-1'), 'logic.js day type span dropped ml-1');

const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
assert(header.includes("names[day] + ' · <span"), 'Header boot uses middot');
assert(!header.includes('ml-1'), 'Header boot dropped ml-1');

if (failures.length) {
    console.error('verify-appearance failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-appearance: ok');
