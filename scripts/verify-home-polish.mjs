/**
 * Home polish: no reserved ad gap, corridor warning is SVG, poster catalog listed.
 * Run: node scripts/verify-home-polish.mjs
 */
import { readFileSync } from 'node:fs';
import { warningTriangleSvg } from '../src/lib/utils.js';
import { APP_VERSION, CHANGELOG_DATA, FARE_CONFIG } from '../src/lib/config.js';
import {
    collectHubOnwardOptions,
    fitStationLabel,
    resolveTransferHubName,
    routeAllowsDualHubOptions,
    shortenStationLabel,
} from '../src/lib/transfer-card.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

assert(APP_VERSION === 'V9_09.10.8', `APP_VERSION ${APP_VERSION}`);
assert(CHANGELOG_DATA[0].forceShow === false, 'What’s New does not auto-open');
assert(!CHANGELOG_DATA.some((e) => e.forceShow), 'no What’s New card opts into auto-open');
assert(CHANGELOG_DATA[0].id === 'V9_08.29.2' && CHANGELOG_DATA[0].features.length === 3, 'What’s New latest card is V9_08.29.2');
assert(CHANGELOG_DATA[1].id === 'V9_08.28.20', 'keep V9_08.28.20 as the previous What’s New card');
assert(CHANGELOG_DATA[2].id === 'V9_08.28.19', 'keep V9_08.28.19 as the previous What’s New card');
assert(CHANGELOG_DATA[3].id === 'V9_08.28.14', 'keep V9_08.28.14 as the previous What’s New card');
assert(CHANGELOG_DATA[4].id === 'V9_08.28.13', 'keep V9_08.28.13 as the previous What’s New card');
assert(CHANGELOG_DATA[5].id === 'V9_08.28.11', 'keep V9_08.28.11 as the previous What’s New card');
assert(CHANGELOG_DATA[6].id === 'V9_08.28.10', 'keep V9_08.28.10 as the previous What’s New card');
assert(CHANGELOG_DATA[7].id === 'V9_08.28.9', 'keep V9_08.28.9 as the previous What’s New card');
assert(CHANGELOG_DATA[8].id === 'V9_08.28.8', 'keep V9_08.28.8 as the previous What’s New card');
assert(CHANGELOG_DATA[9].id === 'V9_08.28.7', 'keep V9_08.28.7 as the previous What’s New card');
assert(CHANGELOG_DATA[10].id === 'V9_08.28.2', 'V9_08.28.6–28.3 folded into V9_08.28.2');
assert(CHANGELOG_DATA[11].id === 'V9_08.28.1', 'keep V9_08.28.1 as the previous production What’s New card');
assert(!CHANGELOG_DATA.some((e) => ['V9_08.28.6', 'V9_08.28.5', 'V9_08.28.4', 'V9_08.28.3'].includes(e.id)), 'folded 28.6–28.3 out of What’s New');
assert(CHANGELOG_DATA[0].features.some((f) => f.includes('smaller list')), 'V9_08.29.2 What’s New mentions Network Lines size');
assert(CHANGELOG_DATA[0].features.some((f) => f.includes('follows the rail in all four regions')), 'V9_08.29.2 What’s New mentions every region following rail');
assert(CHANGELOG_DATA[0].features.some((f) => f.includes('Cato Ridge')), 'V9_08.29.2 What’s New mentions Cato Ridge reaching its terminus');
assert(CHANGELOG_DATA[1].features.some((f) => f.includes('sits in the middle of its row')), 'V9_08.28.20 What’s New mentions planner title center');
assert(CHANGELOG_DATA[1].features.some((f) => f.includes('grow upward')), 'V9_08.28.20 What’s New mentions Feedback Hub growing up');
assert(CHANGELOG_DATA[2].features.some((f) => f.includes('Station choices open at the top')), 'V9_08.28.19 What’s New mentions planner list at the top');
assert(CHANGELOG_DATA[2].features.some((f) => f.includes('oval bar stays at the bottom')), 'V9_08.28.19 What’s New mentions pinned tabs');
assert(CHANGELOG_DATA[3].features.some((f) => f.includes('From sits in the same place')), 'V9_08.28.14 What’s New mentions From alignment');
assert(CHANGELOG_DATA[4].features.some((f) => f.includes('Check for Updates')), 'V9_08.28.13 What’s New still mentions Check for Updates');
assert(CHANGELOG_DATA[5].features.some((f) => f.includes('Station dots sit on the lines')), 'V9_08.28.11 What’s New mentions station dots');
assert(CHANGELOG_DATA[6].features.some((f) => f.includes('Park Station')), 'V9_08.28.10 What’s New mentions Park Station');
assert(CHANGELOG_DATA[7].features.some((f) => f.includes('oval bar stays at the bottom')), 'V9_08.28.9 What’s New mentions pinned tabs');
assert(CHANGELOG_DATA[8].features.some((f) => f.includes('Max. Single Fare')), 'V9_08.28.8 What’s New mentions train-sheet fares');
assert(CHANGELOG_DATA[8].features.some((f) => f.includes('Durban to Crossmoor')), 'V9_08.28.8 What’s New mentions Crossmoor train order');
assert(CHANGELOG_DATA[9].features.some((f) => f.includes('every corridor that stops there')), 'V9_08.28.7 What’s New mentions station corridors');
assert(CHANGELOG_DATA[9].features.some((f) => f.includes('Show all lines')), 'V9_08.28.7 What’s New mentions restoring the network');
assert(CHANGELOG_DATA[10].features.some((f) => f.includes('Network Lines')), 'folded 28.2 card still mentions Network Lines');
assert(CHANGELOG_DATA[10].features.some((f) => f.includes('oval bar')), 'folded 28.2 card still mentions floating tabs');
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
assert(hub.includes("from './feedback-contact.js'"), 'hub validates optional contact');
assert(hub.includes('paintContactField'), 'hub paints contact validity on input and submit');

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
assert(renderer.includes('data-nt-deptime'), 'departure clock is stamped for quiet paint');
assert(renderer.includes('liveBoardStaticKey'), 'empty and no-service cards use static board keys');
assert(renderer.includes('At ${hubLabel}'), 'transfer card names the hub from the journey');
assert(renderer.includes('collectHubOnwardOptions'), 'transfer card uses shared onward-option helper');
assert(renderer.includes('fitOnwardRowLabels'), 'onward dest names shrink only when the row wraps');
assert(renderer.includes('data-nt-onward-row'), 'onward trains are one nowrap row');
assert(renderer.includes('w-full min-w-0 whitespace-nowrap text-center'), 'onward rows are centered');
assert(/data-nt-onward-row class="[^"]*text-center/.test(renderer), 'onward rows use text-center');
assert(/data-nt-onward-row class="[^"]*justify-center/.test(renderer), 'onward rows grow from the middle');
assert(renderer.includes('text-center">At ${hubLabel}'), 'At-hub heading is centered');
assert(!renderer.includes('space-y-1 text-left'), 'hub bottom block is not globally left-aligned');
assert(!renderer.includes('whitespace-nowrap text-left text-[9px]'), 'onward rows are no longer left-aligned');
assert(renderer.includes('To ${hubLabel}'), 'shuttle line names the change station');
assert(!renderer.includes('Connect Train ${conn.train}'), 'old Connect Train heading is gone');
assert(!renderer.includes('italic text-gray-500 dark:text-gray-500 border-t'), 'terminus option is not an italic footnote');
assert(!renderer.includes('text-gray-400 font-bold truncate w-full">To ${connDest}'), 'connect line no longer uses truncate');
assert(renderer.includes('No more trains today · first'), 'empty board one-liner copy');
assert(renderer.includes('first ${dayBit}:'), 'empty board headline uses a trailing colon, not a duplicated time');
assert(!renderer.includes('timeBit'), 'empty board headline no longer appends the time');
assert(!renderer.includes('First train ${dayText} is at:'), 'two-line First train … is at: removed');
assert(!renderer.includes('>No more trains today</div>'), 'standalone No more trains today title removed');
assert(renderer.includes('Saved to gallery'), 'save toast has no emoji in the message');
assert(!renderer.includes('Image saved to gallery'), 'old emoji toast copy removed');

const liveBoard = readFileSync(new URL('../src/lib/live-board.js', import.meta.url), 'utf8');
assert(liveBoard.includes('finalPrice = Math.floor(finalPrice)'), 'fare button floors to the lower rand');
assert(FARE_CONFIG.zones_detailed.Z1.monthly === 180, 'Z1 monthly is the V5 R180');
assert(FARE_CONFIG.zones_detailed.Z2.monthly === 220, 'Z2 monthly is the V5 R220');
assert(FARE_CONFIG.zones_detailed.Z3.monthly === 250, 'Z3 monthly is the V5 R250');
assert(FARE_CONFIG.zones_detailed.Z4.monthly === 280, 'Z4 monthly is the V5 R280');
assert(FARE_CONFIG.zones.Z1 === 10 && FARE_CONFIG.zones.Z2 === 12 && FARE_CONFIG.zones.Z3 === 14 && FARE_CONFIG.zones.Z4 === 15, 'peak singles are unchanged');
assert(liveBoard.includes('!quietPaint && typeof paintHeaderDayLabel'), 'quiet minute tick skips rewriting the day label');

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
assert(admin.includes('Admin.loadAlertForReview'), 'GSM Review hydrates the notice into Compose');
assert(admin.includes("sendBtn.textContent = 'Update Alert'"), 'Review sets Update Alert');
assert(admin.includes('pickExpiryExtension'), 'Extend uses a picker, not a fixed +24h');
assert(admin.includes("label: '+4 hours'") && admin.includes("label: '+7 days'"), 'Extend presets include +4h and +7d');
assert(admin.includes('id="excl-train-grid-a"') && admin.includes('id="excl-train-grid-b"'), 'exclusions show both directions');
assert(!admin.includes('id="excl-direction"'), 'exclusion direction dropdown removed');
assert(admin.includes('Include NO SVC / SPL tag on downloaded PNG'), 'export-only NO SVC toggle present');
assert(admin.includes('Include banner on downloaded PNG'), 'grid notice banner export toggle is distinct');
assert(!admin.includes('Show on download image'), 'old confusing download-image label removed');
assert(!admin.includes('Show NO SVC / SPL tag on export image'), 'old export-image label removed');
assert(admin.includes('id="alert-source-saved"'), 'saved alert sources dropdown');
assert(admin.includes('id="alert-source-name"') && admin.includes('id="alert-source-url"'), 'source name and url fields remain');
assert(admin.includes('id="alert-source-save-btn"'), 'save source control');
assert(admin.includes('nt_admin_alert_sources'), 'sources persist in localStorage');
assert(admin.includes('endOfTodayLocalValue'), 'shared end-of-day expiry helper');
assert(admin.includes('alerts-sched-v3'), 'alert panel rebuild key');
assert(admin.includes('alert-tab-active'), 'Active alerts tab exists');
assert(admin.includes('Active Alerts'), 'Active alerts tab label');
assert(admin.includes('fetchActiveAlerts'), 'Active alerts list loader');
assert(admin.includes('Admin._reviewPostedAt'), 'alert edit keeps the original postedAt');
assert(admin.includes('excl-refine-v3'), 'exclusion panel rebuild key');
assert(admin.includes('Admin.loadExclusionForEdit'), 'admins can open a banned train into the editor');
assert(admin.includes('data-excl-edit'), 'active exception rows are clickable for edit');
assert(admin.includes('id="alert-force-popup"') && admin.includes('id="alert-poll-toggle"'), 'force popup and poll toggles remain');
assert(admin.includes('id="excl-grid-notice-export"') && admin.includes('id="excl-export-toggle"'), 'banner and train-tag export checkboxes remain');
assert(admin.includes('openRoadmapOriginal'), 'roadmap opens original feedback or crash');
assert(admin.includes('roadmap-refine-v1'), 'roadmap card redesign is loaded');
assert(admin.includes("label: 'Public Holiday sheets'") && admin.includes("label: 'Saturday sheets (holiday default)'"), 'holiday dropdowns split WC vs other regions');
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
assert(admin.includes('nt-pack-wallpaper'), 'admin thread wallpaper uses the shared pack');
assert(admin.includes('id="fb-list" class="space-y-3 pr-1"'), 'fb-list grows with its messages');
assert(admin.includes('min-h-full'), 'admin canvas grows with list content');
assert(!admin.includes('min-h-screen'), 'admin canvas is not capped to 100vh');
assert(admin.includes("'!mb-0', 'bg-gray-50', 'dark:bg-gray-900', 'overflow-visible'"), 'drill-down keeps the gray canvas behind lists');
assert(!admin.includes("'!mb-0', 'bg-transparent'"), 'drill-down no longer punches through to the black overlay');
assert(!admin.includes('admin-feedback-styles'), 'feedback panel has no fixed-height sizing override');
assert(!admin.includes('min-height: min(72dvh, 40rem)'), 'feedback panel reserves no blank minimum height');
assert(!admin.includes('max-height: calc(100dvh - 6.5rem)'), 'feedback panel is not capped to an inner scroller');
assert(admin.includes('feedback-thread-chat nt-pack-wallpaper relative space-y-3 p-2 sm:p-3'), 'open chat uses natural content height');
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
assert(communityView.indexOf('Community</p>') < communityView.indexOf('id="community-presence"'), 'presence sits on the Community label row');
assert(communityView.indexOf('id="community-presence"') < communityView.indexOf('community-route-select'), 'presence sits above the route dropdown');
assert(!communityView.includes('mt-6 p-2 rounded-full'), 'refresh button is not padded down to the dropdown');
assert(!communityView.includes('min-h-[1rem]'), 'composer error does not reserve a blank line');
assert(communityView.includes('min-h-[2.75rem]'), 'composer field is compact');
const hubModals = readFileSync(new URL('../src/components/HubModals.astro', import.meta.url), 'utf8');
const accountJs = readFileSync(new URL('../src/lib/account.js', import.meta.url), 'utf8');
const delayReports = readFileSync(new URL('../src/lib/delay-reports.js', import.meta.url), 'utf8');
const trainGhosts = readFileSync(new URL('../src/lib/train-ghosts.js', import.meta.url), 'utf8');
assert(hubModals.includes('completely free, and you can cancel anytime'), 'account guest copy is free and cancellable');
assert(!hubModals.includes('Schedules and trip planning work fully as a guest'), 'account no longer uses schedule/trip-planning pitch');
assert(hubModals.includes('Show my photo on commuter alerts'), 'photo on alerts is an opt-in');
assert(hubModals.includes('id="account-photo-alerts"'), 'photo opt-in checkbox exists');
assert(hubModals.includes('Continue with Facebook'), 'guest Facebook sign-in');
assert(hubModals.includes('id="account-facebook-btn"'), 'Facebook button id');
assert(hubModals.includes('Delete account'), 'signed-in delete row');
assert(hubModals.includes('id="account-delete-confirm"'), 'delete confirm sheet');
assert(hubModals.includes('account-points-panel'), 'points details live inside Account');
assert(hubModals.indexOf('id="account-points-btn"') < hubModals.indexOf('id="account-points-panel"'), 'points panel sits under the Points row');
assert(hubModals.indexOf('id="account-points-panel"') < hubModals.indexOf('id="account-photo-alerts"'), 'points breakdown opens before the photo row, not at the page footer');
assert(accountJs.includes("insertAdjacentElement('afterend'") && accountJs.includes('account-points-panel'), 'Points toggle docks the breakdown next to the accordion button');
assert(hubModals.includes('id="reports-feed-modal"'), 'VIEW opens a commuter reports list');
assert(hubModals.includes('id="reports-feed-list"'), 'reports list has a feed host');
assert(hubModals.includes('items-end justify-center p-0'), 'reports sheet docks to the bottom');
assert(hubModals.includes('h-[min(88dvh,100%)]'), 'reports sheet occupies viewport height');
assert(!/id="reports-feed-modal"[\s\S]{0,400}scale-95/.test(hubModals), 'reports sheet does not scale-float off the bottom');
assert(delayReports.includes('<details class="group'), 'commuter reports list is an accordion');
assert(delayReports.includes('Expired Reports'), 'stale same-day reports sit under Expired Reports');
assert(delayReports.includes('isAfterReportCurfew'), 'reports hide at 23:59');
assert(delayReports.includes('routeHasNoScheduledTrains'), 'reporting is blocked when there is no timetable');
assert(delayReports.includes('WEEKDAY_REPORT_MAX_AGE_MS = 60 * 60 * 1000'), 'weekday reports expire after one hour');
assert(delayReports.includes('isReportStillLive'), 'stale and past-time reports are filtered');
assert(trainGhosts.includes('TRACKING_WINDOW_SEC = 45 * 60'), 'tracking window is 45 minutes');
assert(hubModals.includes('No trains in the next 45 minutes'), 'nearby empty copy matches the 45-minute window');
{
    const mapTab = readFileSync(new URL('../src/lib/map-tab.js', import.meta.url), 'utf8');
    const mapView = readFileSync(new URL('../src/components/MapView.astro', import.meta.url), 'utf8');
    const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
    const mapPage = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
    const ridePings = readFileSync(new URL('../src/lib/ride-pings.js', import.meta.url), 'utf8');
    const adminJs = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
    assert(mapView.includes('id="map-tab-stop-btn"'), 'Map tab has Stop sharing');
    assert(mapTab.includes('ENFORCE_LIVE_SHARE_VET = true'), 'live-share GPS vet is enforced');
    assert(mapTab.includes("'nearby_modal'"), 'Trains near you still starts a share');
    assert(mapTab.includes('skipVolunteer: true'), 'nearby / map join skip the volunteer sheet');
    assert(mapApp.includes('nt-live-train-glyph--mine'), 'map train glyph has a mine state');
    assert(mapApp.includes('nt-live-train-glyph--stale'), 'map train glyph has a stale GPS state');
    assert(mapApp.includes('nt-live-train-glyph--compact'), 'map train glyph shrinks when zoomed out');
    assert(mapApp.includes('applyShareHidesUserDot'), 'sharing a train hides the GPS pulse');
    assert(!mapApp.includes('liveTrainShareLine'), 'map glyph does not print You’re sharing');
    assert(mapApp.includes('nt-map-open-timetable'), 'map popup can open the train timetable');
    assert(mapApp.includes("z < 11"), 'map train glyph is compact below zoom 11');
    assert(mapPage.includes('0 0 0 1px rgba(255,255,255,0.9)'), 'map train glyph ring is 1px');
    assert(mapPage.includes('height: 12px'), 'map train oval is hub-dot sized');
    assert(ridePings.includes('RIDE_SHARE_IDLE_MS = 30 * 60 * 1000'), 'share stops after 30 minutes idle');
    assert(ridePings.includes('RIDE_GPS_STALE_MS = 90 * 1000'), 'GPS stale window is 90 seconds');
    assert(ridePings.includes('compactPingsForMap'), 'map pings are compacted per train');
    assert(ridePings.includes('snapToRail'), 'compact pings snap to rails before averaging');
    assert(ridePings.includes('Still on this train?'), 'off-path onboard loop asks once');
    assert(ridePings.includes('paintLiveTrainDots'), 'live red dots paint on the board');
    const timetableGrid = readFileSync(new URL('../src/lib/timetable-grid.js', import.meta.url), 'utf8');
    assert(timetableGrid.includes('paintLiveTrainDots'), 'full timetable grid paints live dots');
    assert(ridePings.includes('openPlannerTrainSheet'), 'live dots open the train sheet');
    assert(mapTab.includes('hasRidePingsListener'), 'map prefers the live listener over REST');
    assert(mapTab.includes('PINGS_POLL_WITH_LISTENER_MS'), 'map REST poll backs off when the listener is live');
    assert(mapApp.includes('Stop sharing'), 'map popup can stop sharing');
    assert(ridePings.includes('Stop the other share'), 'second device is offered a stop');
    assert(ridePings.includes('appendRideShareLog'), 'share start/stop writes a log');
    assert(adminJs.includes('setupRideShareManager'), 'admin has a live sharing panel');
    assert(adminJs.includes('live-share-panel'), 'live sharing panel id');
    assert(adminJs.includes('data-ls-region'), 'live sharing panel has region tabs');
    assert(adminJs.includes('openAdminChangelogLookup'), 'admin can look up build notes');
    assert(adminJs.includes('admin-changelog-header-btn'), 'System Health has a build notes accordion');
    const featuresJs = readFileSync(new URL('../src/lib/features.js', import.meta.url), 'utf8');
    assert(/export function relaxLiveShareGuards\(\) \{\s*return false;\s*\}/.test(featuresJs), 'lab does not skip live-share GPS guards');
    const ghostsJs = readFileSync(new URL('../src/lib/train-ghosts.js', import.meta.url), 'utf8');
    assert(ghostsJs.includes('journeyHeadingDeg'), 'vet compares heading to the journey');
    assert(ghostsJs.includes('if (!Number.isFinite(userHeading) || !Number.isFinite(ghostHeading)) return false'), 'missing heading is not a match');
    const hubJs = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
    assert(hubJs.includes("performHardCacheClear('check_updates')"), 'Check for Updates restarts when online');
    const liveBoard = readFileSync(new URL('../src/components/LiveBoard.astro', import.meta.url), 'utf8');
    assert(liveBoard.includes('id="nt-timetable-live-dot"'), 'VIEW FULL TIMETABLE has a live dot');
    const marksJs = readFileSync(new URL('../src/lib/rider-marks.js', import.meta.url), 'utf8');
    assert(marksJs.includes('hydrateRemoteMarks({ persist = false }'), 'sign-in can force-upload merged marks');
    const accountJs = readFileSync(new URL('../src/lib/account.js', import.meta.url), 'utf8');
    assert(accountJs.includes("hydrateRemoteMarks({ persist: true })"), 'sign-in merges local marks onto the uid');
    const adminCl = readFileSync(new URL('../src/lib/admin-changelog.js', import.meta.url), 'utf8');
    assert(adminCl.includes('ADMIN_CHANGELOG'), 'operator build notes exist');
    assert(adminCl.includes('V9_09.10.8'), 'current build has operator notes');
}
assert(hubModals.includes('account-legal-link') && hubModals.includes('Privacy Policy') && hubModals.includes('Terms of Use'), 'account footer is Privacy Policy and Terms of Use');
assert(!hubModals.includes('Bronze · 0 marks'), 'account uses points, not marks');
const riderMarks = readFileSync(new URL('../src/lib/rider-marks.js', import.meta.url), 'utf8');
assert(riderMarks.includes('PHOTO_PREF_KEY') && riderMarks.includes('showPhotoInAlerts'), 'photo pref defaults off');
assert(riderMarks.includes('isServiceDay') && riderMarks.includes('streak_5day'), 'service-day streaks include 3 and 5');
assert(riderMarks.includes("return `${tier.label} · ${state.points} ${pointsWord(state.points)}`"), 'rider label says points');
const layoutAds = readFileSync(new URL('../src/layouts/Layout.astro', import.meta.url), 'utf8');
assert(/#nt-ad-scroll-host \{\s*flex: 0 0 auto/.test(layoutAds), 'ad host does not flex-grow under filled tabs');

const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
assert(agents.includes('No unsolicited changes'), 'agent instructions forbid unsolicited changes');
assert(agents.includes('Changelog is optional'), 'agent instructions allow shipping without changelog');
assert(agents.includes('no release notes'), 'agent instructions allow no release notes');

assert(routeAllowsDualHubOptions('pta-pien'), 'Pienaarspoort may list two hub options');
assert(!routeAllowsDualHubOptions('jhb-rand'), 'Randfontein does not get a dual hub list');
assert(!routeAllowsDualHubOptions('pta-kempton'), 'direct corridors do not get a dual hub list');
{
    const journey = {
        train1: { terminationStation: 'NEW HUB STATION' },
        connection: {
            train: '1103',
            departureTime: '05:05:00',
            actualDestination: 'MAMELODI GARDENS STATION',
            connectionStation: 'NEW HUB STATION',
        },
        nextFullJourney: {
            train: '1105',
            departureTime: '05:45:00',
            actualDestination: 'PIENAARSPOORT STATION',
        },
    };
    assert(resolveTransferHubName(journey) === 'NEW HUB STATION', 'hub label follows the journey station, not a painted name');
    const pien = collectHubOnwardOptions(journey, 'pta-pien');
    assert(pien.length === 2 && pien[0].train === '1103' && pien[1].train === '1105', 'pta-pien keeps short-turn and terminus options');
    const rand = collectHubOnwardOptions(journey, 'jhb-rand');
    assert(rand.length === 1 && rand[0].train === '1103', 'other shuttle routes keep only the earliest onward train');
}
assert(shortenStationLabel('Mamelodi Gardens') === 'Mamelodi Gard', 'multi-word dest clips the last word first');
assert(shortenStationLabel('Pienaarspoort') === 'Pienaarsp', 'one-word dest drops the last four letters');
assert(fitStationLabel('Mamelodi Gardens', () => false) === 'Mamelodi Gardens', 'full dest stays when the row fits');
assert(fitStationLabel('Mamelodi Gardens', (s) => s === 'Mamelodi Gardens') === 'Mamelodi Gard', 'dest shortens only after a wrap');
assert(fitStationLabel('Pienaarspoort', (s) => s === 'Pienaarspoort') === 'Pienaarsp', 'one-word dest shortens only after a wrap');
assert(liveBoard.includes('routeAllowsDualHubOptions(routeId)'), 'findConnections only builds a second hub option on the allow-list');

const mapView = readFileSync(new URL('../src/components/MapView.astro', import.meta.url), 'utf8');
const mapPage = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
const mapTab = readFileSync(new URL('../src/lib/map-tab.js', import.meta.url), 'utf8');
assert(!mapView.includes('Loading network map'), 'Map tab overlay does not duplicate the iframe loader');
assert(mapPage.includes('Loading network…'), 'iframe keeps one loading heading');
assert(!mapPage.includes('Loading Network...'), 'iframe heading is not Title Case Loading Network');
assert(mapTab.includes("map-tab-placeholder')?.classList.add('hidden')"), 'Map tab does not unhide a second loader');
assert(!mapTab.includes("map-tab-placeholder')?.classList.remove('hidden')"), 'Map tab never shows the outer loader');
assert(mapTab.includes('compareNearbyTrainLikelihood'), 'nearby modal ranks likely trains first');

if (failures.length) {
    console.error('verify-home-polish failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-home-polish: ok');
