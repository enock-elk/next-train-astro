/**
 * Home polish: no reserved ad gap, corridor warning is SVG, poster catalog listed.
 * Run: node scripts/verify-home-polish.mjs
 */
import { readFileSync } from 'node:fs';
import { warningTriangleSvg } from '../src/lib/utils.js';
import { APP_VERSION, CHANGELOG_DATA } from '../src/lib/config.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

assert(APP_VERSION === 'V8_08.28.2', `APP_VERSION ${APP_VERSION}`);
assert(CHANGELOG_DATA[0].id === 'V8_08.28.2' && CHANGELOG_DATA[0].features.length === 4, 'What’s New latest card is V8_08.28.2');
assert(!CHANGELOG_DATA.some((e) => e.id === 'V8_08.16.1' || e.id === 'V8_08.15.1'), 'folded 16.1–15.1 out of What’s New');

const layout = readFileSync(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8');
assert(!layout.includes('padding-bottom: 108px'), 'Layout must not reserve 108px for ads');
assert(!layout.includes('min-height: 100px'), 'clever-core must not reserve 100px height');
assert(layout.includes('Never reserve page space'), 'ad overlay comment present');

const ads = readFileSync(new URL('../src/lib/clever-ads.js', import.meta.url), 'utf8');
assert(ads.includes('Never push the board or footer down'), 'setAdPadding is a no-op');
assert(!ads.includes('setAdPadding(true)'), 'ad code must not request reserved padding');

const board = readFileSync(new URL('../src/lib/live-board-ui.js', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../src/lib/renderer.js', import.meta.url), 'utf8');
assert(!board.includes('⚠️'), 'upcoming modal has no warning emoji');
assert(!renderer.includes('⚠️'), 'home board has no warning emoji');
assert(board.includes('warningTriangleSvg()'), 'upcoming modal uses warning SVG');
assert(renderer.includes('warningTriangleSvg()'), 'home board uses warning SVG');
assert(warningTriangleSvg().includes('<svg'), 'warningTriangleSvg returns svg');
assert(renderer.includes('emptyBoardHeadline'), 'empty board uses condensed headline helper');
assert(renderer.includes('No more trains today · first'), 'empty board one-liner copy');
assert(renderer.includes('first ${dayBit}:'), 'empty board headline uses a trailing colon, not a duplicated time');
assert(!renderer.includes('timeBit'), 'empty board headline no longer appends the time');
assert(!renderer.includes('First train ${dayText} is at:'), 'two-line First train … is at: removed');
assert(!renderer.includes('>No more trains today</div>'), 'standalone No more trains today title removed');
assert(renderer.includes('Saved to gallery'), 'save toast has no emoji in the message');
assert(!renderer.includes('Image saved to gallery'), 'old emoji toast copy removed');

const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(ui.includes('OFFLINE_CHROME_HOLD_MS = 4000'), 'offline chrome waits 4s');
assert(ui.includes('OFFLINE_CHROME_AUTO_HIDE_MS = 7000'), 'offline dock auto-hides after 7s');
assert(ui.includes('document.visibilityState !== \'visible\''), 'offline chrome requires visible tab');
assert(ui.includes("offlineDock()"), 'offline chrome toggles #offline-wrapper');
assert(!ui.includes("oi.textContent = 'WORKING OFFLINE'"), 'offline dock keeps mockup copy');
assert(ui.includes("scheduleOfflineChrome();"), 'already-offline boot schedules the dock');
assert(ui.includes("hideOfflineChrome({ dismissed: true })"), 'Close / auto-hide marks the dock dismissed');
assert(ui.includes('PLANNER_INLINE_LISTS'), 'Travel Day scrim does not steal pointer events');
assert(ui.includes("mainAppNode.insertBefore(banner, scroll)"), 'maintenance tape sits above #app-scroll');

const manifest = JSON.parse(readFileSync(new URL('../public/images/alerts/manifest.json', import.meta.url), 'utf8'));
assert(manifest.posters.some((p) => p.file === 'pta-kempton-0618-0619.jpg'), 'manifest lists Kempton poster');
assert(manifest.posters.length >= 10, `manifest has ${manifest.posters.length} posters`);

const admin = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
assert(admin.includes('id="alert-poster-select"'), 'admin uses poster dropdown');
assert(!admin.includes('alert-poster-path'), 'admin path input removed');

if (failures.length) {
    console.error('verify-home-polish failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-home-polish: ok');
