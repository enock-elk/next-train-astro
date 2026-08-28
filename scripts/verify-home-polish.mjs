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

assert(APP_VERSION === 'V9_08.28.18', `APP_VERSION ${APP_VERSION}`);
assert(CHANGELOG_DATA[0].forceShow === false, 'What’s New does not auto-open');
assert(!CHANGELOG_DATA.some((e) => e.forceShow), 'no What’s New card opts into auto-open');
assert(CHANGELOG_DATA[0].id === 'V9_08.28.14' && CHANGELOG_DATA[0].features.length === 2, 'What’s New latest card stays V9_08.28.14 (15 has no commuter notes)');
assert(CHANGELOG_DATA[1].id === 'V9_08.28.13', 'keep V9_08.28.13 as the previous What’s New card');
assert(CHANGELOG_DATA[2].id === 'V9_08.28.11', 'keep V9_08.28.11 as the previous What’s New card');
assert(CHANGELOG_DATA[3].id === 'V9_08.28.10', 'keep V9_08.28.10 as the previous What’s New card');
assert(CHANGELOG_DATA[4].id === 'V9_08.28.9', 'keep V9_08.28.9 as the previous What’s New card');
assert(CHANGELOG_DATA[5].id === 'V9_08.28.8', 'keep V9_08.28.8 as the previous What’s New card');
assert(CHANGELOG_DATA[6].id === 'V9_08.28.7', 'keep V9_08.28.7 as the previous What’s New card');
assert(CHANGELOG_DATA[7].id === 'V9_08.28.2', 'V9_08.28.6–28.3 folded into V9_08.28.2');
assert(CHANGELOG_DATA[8].id === 'V9_08.28.1', 'keep V9_08.28.1 as the previous production What’s New card');
assert(!CHANGELOG_DATA.some((e) => ['V9_08.28.6', 'V9_08.28.5', 'V9_08.28.4', 'V9_08.28.3'].includes(e.id)), 'folded 28.6–28.3 out of What’s New');
assert(CHANGELOG_DATA[0].features.some((f) => f.includes('From sits in the same place')), 'V9_08.28.14 What’s New mentions From alignment');
assert(CHANGELOG_DATA[1].features.some((f) => f.includes('Check for Updates')), 'V9_08.28.13 What’s New still mentions Check for Updates');
assert(CHANGELOG_DATA[2].features.some((f) => f.includes('Station dots sit on the lines')), 'V9_08.28.11 What’s New mentions station dots');
assert(CHANGELOG_DATA[3].features.some((f) => f.includes('Park Station')), 'V9_08.28.10 What’s New mentions Park Station');
assert(CHANGELOG_DATA[4].features.some((f) => f.includes('oval bar stays at the bottom')), 'V9_08.28.9 What’s New mentions pinned tabs');
assert(CHANGELOG_DATA[5].features.some((f) => f.includes('Max. Single Fare')), 'V9_08.28.8 What’s New mentions train-sheet fares');
assert(CHANGELOG_DATA[5].features.some((f) => f.includes('Durban to Crossmoor')), 'V9_08.28.8 What’s New mentions Crossmoor train order');
assert(CHANGELOG_DATA[6].features.some((f) => f.includes('every corridor that stops there')), 'V9_08.28.7 What’s New mentions station corridors');
assert(CHANGELOG_DATA[6].features.some((f) => f.includes('Show all lines')), 'V9_08.28.7 What’s New mentions restoring the network');
assert(CHANGELOG_DATA[7].features.some((f) => f.includes('Network Lines')), 'folded 28.2 card still mentions Network Lines');
assert(CHANGELOG_DATA[7].features.some((f) => f.includes('oval bar')), 'folded 28.2 card still mentions floating tabs');
assert(!/admin|account|password|sign-in|face id|dev hub|deploy|worker|firebase|nuke|analytics|seo|google/i.test(CHANGELOG_DATA[0].features.join(' ')), 'What’s New latest card is commuter-only');
assert(!CHANGELOG_DATA.some((e) => e.id === 'V8_08.16.1' || e.id === 'V8_08.15.1'), 'folded 16.1–15.1 out of What’s New');
assert(!CHANGELOG_DATA.some((e) => ['V8_08.28.5', 'V8_08.28.4', 'V8_08.28.3', 'V8_08.28.2', 'V8_08.28.1', 'V8_08.27.9', 'V8_08.27.8', 'V8_08.27.7', 'V8_08.27.6', 'V8_08.27.5', 'V8_08.27.4', 'V8_08.27.3', 'V8_08.26.2', 'V8_08.26.1'].includes(e.id)), 'folded 28.5–26.1 into V9_08.28.1');
assert(!CHANGELOG_DATA.some((e) => e.id === 'V8_08.18.1'), 'Alerts channel card is gone from What’s New');
{
    const hidden = /alert|the bell|hold to react|trains near|i['’]m on it|community chat|route chat|live location|ride sharing|firebase|global state/i;
    const dash = /[\u2014\u2013]/;
    const emoji = /\p{Extended_Pictographic}/u;
    for (const entry of CHANGELOG_DATA) {
        const blob = [entry.title, ...(entry.features || [])].join('\n');
        assert(!hidden.test(blob), `What’s New ${entry.id} has no hidden-test copy`);
        assert(!dash.test(blob), `What’s New ${entry.id} has no em/en dashes`);
        assert(!emoji.test(blob), `What’s New ${entry.id} has no emoji`);
    }
}
assert(readFileSync(new URL('../src/lib/renderer.js', import.meta.url), 'utf8').includes('sanitizeWhatsNewText'), 'What’s New renderer strips em dashes');
const hub = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
assert(hub.includes("welcomeSeen") && hub.includes('maybeForceShowChangelog'), 'What’s New auto-open waits until welcome is done');
assert(hub.includes("if (!latest?.forceShow) return"), 'What’s New auto-open is opt-in via forceShow');

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
assert(renderer.includes('tryPatchLiveBoardCountdown'), 'minute tick patches countdown text instead of remounting');
assert(renderer.includes('data-nt-countdown'), 'countdown node is stamped for quiet paint');
assert(renderer.includes('stampLiveBoardCard'), 'board cards carry a stable key');
assert(renderer.includes('No more trains today · first'), 'empty board one-liner copy');
assert(renderer.includes('first ${dayBit}:'), 'empty board headline uses a trailing colon, not a duplicated time');
assert(!renderer.includes('timeBit'), 'empty board headline no longer appends the time');
assert(!renderer.includes('First train ${dayText} is at:'), 'two-line First train … is at: removed');
assert(!renderer.includes('>No more trains today</div>'), 'standalone No more trains today title removed');
assert(renderer.includes('Saved to gallery'), 'save toast has no emoji in the message');
assert(!renderer.includes('Image saved to gallery'), 'old emoji toast copy removed');

const logic = readFileSync(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
assert(logic.includes('window.__ntQuietBoardPaint = true'), 'minute tick sets quiet board paint before findNextTrains');

const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(ui.includes('OFFLINE_CHROME_HOLD_MS = 4000'), 'offline chrome waits 4s');
assert(ui.includes('OFFLINE_CHROME_AUTO_HIDE_MS = 7000'), 'offline dock auto-hides after 7s');
assert(ui.includes('document.visibilityState !== \'visible\''), 'offline chrome requires visible tab');
assert(ui.includes("offlineDock()"), 'offline chrome toggles #offline-wrapper');
assert(!ui.includes("oi.textContent = 'WORKING OFFLINE'"), 'offline dock keeps mockup copy');
assert(ui.includes("scheduleOfflineChrome();"), 'already-offline boot schedules the dock');
assert(ui.includes("hideOfflineChrome({ dismissed: true })"), 'Close / auto-hide marks the dock dismissed');
assert(ui.includes('PLANNER_INLINE_LISTS'), 'Travel Day scrim does not steal pointer events');
assert(ui.includes('header.parentNode.insertBefore(banner, header)'), 'maintenance bar sits above #app-header inside the scroller');
assert(ui.includes('nt-maint-wrench'), 'maintenance bar uses the wrench SVG');
assert(!ui.includes('repeating-linear-gradient'), 'maintenance bar is not hazard tape');

const manifest = JSON.parse(readFileSync(new URL('../public/images/alerts/manifest.json', import.meta.url), 'utf8'));
assert(manifest.posters.some((p) => p.file === 'pta-kempton-0618-0619.jpg'), 'manifest lists Kempton poster');
assert(manifest.posters.length >= 10, `manifest has ${manifest.posters.length} posters`);

const admin = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
assert(admin.includes('id="alert-poster-select"'), 'admin uses poster dropdown');
assert(!admin.includes('alert-poster-path'), 'admin path input removed');
assert(admin.includes('openAliasModal'), 'alias uses a real modal');
assert(admin.includes("modal.id = 'admin-alias-modal'"), 'alias modal id is admin-alias-modal');
assert(admin.includes('aria-label="Set alias"'), 'Set alias is an SVG control');
assert(admin.includes("icon('pencil'"), 'alias control includes a pencil icon');
assert(!admin.includes('>Set alias</button>'), 'Set alias text button removed');
assert(!/setCommuterAlias[\s\S]{0,500}prompt\(/.test(admin), 'setCommuterAlias no longer uses prompt');
assert(admin.includes('data-fb-more-toggle'), 'Options toggle remains');
assert(!admin.includes("icon('more'"), 'Options dropped the more icon');
assert(admin.includes('feedback-thread-chat'), 'thread wallpaper lives on feedback-thread-chat');
assert(admin.includes('bg-[#efeae2]'), 'admin thread wallpaper is #efeae2');
assert(admin.includes('id="fb-list" class="space-y-3 pr-1"'), 'fb-list grows with its messages');
assert(!admin.includes('admin-feedback-styles'), 'feedback panel has no fixed-height sizing override');
assert(!admin.includes('min-height: min(72dvh, 40rem)'), 'feedback panel reserves no blank minimum height');
assert(!admin.includes('max-height: calc(100dvh - 6.5rem)'), 'feedback panel is not capped to an inner scroller');
assert(admin.includes('feedback-thread-chat space-y-3 p-2 sm:p-3 bg-[#efeae2]'), 'open chat uses natural content height');
assert(!admin.includes('feedback-thread-chat space-y-3 p-2 sm:p-3 flex-1'), 'open chat does not create a nested scrollbar');
assert(!admin.includes("header.scrollIntoView({ behavior: 'smooth', block: 'start' })"), 'opening an admin feedback thread does not auto-scroll to the top');
assert(admin.includes("formatAlertText('link'") && admin.includes("URL ${Admin.icon('globe'"), 'WYSIWYG link control is URL + globe');
assert(/Archived Thread[\s\S]{0,800}openReplyModal/.test(admin), 'archived feedback threads have Reply');
assert(admin.includes('openAdminReplyEditor'), 'admin replies open the editor');
assert(admin.includes('editedAt: Date.now()'), 'edit writes editedAt');
assert(admin.includes('inbox/${encodeURIComponent(replyDeviceId)}/${encodeURIComponent(editingKey)}.json'), 'edit PATCHes inbox/{deviceId}/{msgKey}');
assert(admin.includes("Does not post a new message or archive the thread."), 'edit path does not POST or archive');

const presence = readFileSync(new URL('../src/lib/community-presence.js', import.meta.url), 'utf8');
assert(presence.includes("el.textContent = 'Just you here'"), 'presence fallback is Just you here');
assert(!presence.includes('Room online'), 'Room online presence copy is gone');
assert(presence.includes("count <= 1 ? 'Just you here'"), 'solo room still says Just you here');
const communityView = readFileSync(new URL('../src/components/CommunityView.astro', import.meta.url), 'utf8');
assert(communityView.includes('>Just you here</button>'), 'Community tab placeholder is Just you here');
const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
assert(agents.includes('No unsolicited changes'), 'agent instructions forbid unsolicited changes');
assert(agents.includes('Changelog is optional'), 'agent instructions allow shipping without changelog');
assert(agents.includes('no release notes'), 'agent instructions allow no release notes');

if (failures.length) {
    console.error('verify-home-polish failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-home-polish: ok');
