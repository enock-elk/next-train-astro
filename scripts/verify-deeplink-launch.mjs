/**
 * Facebook IAB / PWA launchQueue + share snapshot + OG human 302.
 * Run: node scripts/verify-deeplink-launch.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseShareIntent, isSocialCrawler, parseLiveTrainImagePath } from '../workers/nexttrain-og/src/parse.js';
import { buildAppDeepLink, buildOgShareLink, buildPlannerOgMeta } from '../workers/nexttrain-og/src/og-html.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

const store = new Map();
const memoryStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
};

let loc = new URL('https://nexttrain.co.za/');
globalThis.sessionStorage = memoryStorage;
globalThis.localStorage = memoryStorage;
globalThis.document = {
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    visibilityState: 'visible',
};
globalThis.window = globalThis;
globalThis.location = loc;
globalThis.history = {
    replaceState(_s, _t, url) {
        loc = new URL(String(url), 'https://nexttrain.co.za');
        globalThis.location = loc;
    },
    state: {},
};

const {
    snapshotShareDeeplink,
    peekShareDeeplinkSnapshot,
    consumeShareDeeplinkSnapshot,
    ingestLaunchTargetUrl,
    hasInboundShareIntent,
    isInAppBrowser,
    adoptShareHome,
    inboundShareKind,
    holdLeaveForWelcome,
    readSavedDefaults,
} = await import('../src/lib/deeplink.js');

ok(isInAppBrowser('Mozilla/5.0 FBAN/FB4A FBAV/1.0'), 'FBAN is in-app browser');
ok(isInAppBrowser('Instagram 192.0.0'), 'Instagram is in-app browser');
ok(!isInAppBrowser('Mozilla/5.0 Chrome/120'), 'Chrome is not IAB');

ok(!peekShareDeeplinkSnapshot(), 'snapshot starts empty');
ok(!hasInboundShareIntent(''), 'empty search is not inbound');

loc = new URL('https://nexttrain.co.za/');
globalThis.location = loc;
snapshotShareDeeplink();
ok(!peekShareDeeplinkSnapshot(), 'bare / does not freeze an empty snapshot');

const first = ingestLaunchTargetUrl('https://nexttrain.co.za/og/share?rt=pta-pien&v=g&d=wd');
ok(first && first.kind === 'route' && first.routeId === 'pta-pien', 'launch /og/share snapshots route');
ok(hasInboundShareIntent(), 'snapshot counts as inbound share');
ok(String(globalThis.location.pathname) === '/' && String(globalThis.location.search).includes('rt=pta-pien'), 'launch rewrites /og/share → /?rt=');

const second = ingestLaunchTargetUrl('https://nexttrain.co.za/og/share?plan=PRETORIA~GERMISTON&r=GP');
ok(second && second.kind === 'planner' && second.from === 'PRETORIA', 'later launch overwrites stale route snapshot');
ok(peekShareDeeplinkSnapshot()?.kind === 'planner', 'snapshot is the new planner share');

consumeShareDeeplinkSnapshot();
ok(!peekShareDeeplinkSnapshot(), 'consume clears snapshot');

const intent = parseShareIntent(new URL('https://nexttrain.co.za/og/share?rt=germ-leralla&v=g&d=wd'));
ok(intent && intent.kind === 'route' && intent.routeId === 'germ-leralla', 'worker parseShareIntent reads rt=');
const appUrl = buildAppDeepLink(intent, 'https://nexttrain.co.za');
ok(appUrl.startsWith('https://nexttrain.co.za/?') && appUrl.includes('rt=germ-leralla'), 'human 302 target is /?rt=');

const liveIntent = parseShareIntent(new URL('https://nexttrain.co.za/og/share?live=9115&rt=pta-pien&to=PIENAARSPOORT'));
ok(liveIntent && liveIntent.kind === 'live' && liveIntent.trainId === '9115', 'worker parseShareIntent prefers live= over rt=');
ok(liveIntent.routeId === 'pta-pien', 'live share still carries the corridor');
const livePathIntent = parseShareIntent(new URL('https://nexttrain.co.za/og/l/9115/pta-pien/PIENAARSPOORT'));
ok(livePathIntent && livePathIntent.kind === 'live' && livePathIntent.trainId === '9115', 'path /og/l/train/route/dest is a live share');
const liveApp = buildAppDeepLink(liveIntent, 'https://nexttrain.co.za');
ok(liveApp.includes('live=9115') && liveApp.includes('to=Pienaarspoort'), 'human 302 target is /?live=');
const liveOg = buildOgShareLink(liveIntent, 'https://nexttrain.co.za');
ok(liveOg.includes('/og/l/9115/pta-pien'), 'canonical live OG URL is the short path, not a timetable share');
ok(!liveOg.includes('v=g'), 'live OG canonical is not a grid share');
const liveImg = parseLiveTrainImagePath('/og/train/9115/pta-pien/Pienaarspoort.png');
ok(liveImg && liveImg.trainId === '9115' && liveImg.dest === 'Pienaarspoort', 'live OG PNG path carries train and dest');

consumeShareDeeplinkSnapshot();
const pathLaunch = ingestLaunchTargetUrl('https://nexttrain.co.za/og/l/9115/pta-pien/PIENAARSPOORT');
ok(pathLaunch && pathLaunch.kind === 'live' && pathLaunch.trainId === '9115', 'launch /og/l snapshots live');
ok(String(globalThis.location.pathname) === '/' && String(globalThis.location.search).includes('live=9115'), 'path launch rewrites to /?live=');

consumeShareDeeplinkSnapshot();
const alertLaunch = ingestLaunchTargetUrl('https://nexttrain.co.za/og/a/all/1794297920885');
ok(alertLaunch && alertLaunch.kind === 'alert' && alertLaunch.id === '1794297920885' && alertLaunch.source === 'all', 'launch /og/a snapshots the notice');
ok(String(globalThis.location.pathname) === '/' && String(globalThis.location.search).includes('alert=1794297920885'), 'alert launch rewrites to /?alert=');
ok(hasInboundShareIntent(), 'alert snapshot counts as an inbound share');
const alertIntent = parseShareIntent(new URL('https://nexttrain.co.za/og/a/all_GP/1794297920885'));
ok(alertIntent && alertIntent.kind === 'alert' && alertIntent.source === 'all_GP', 'worker reads /og/a/{source}/{id}');
const alertApp = buildAppDeepLink(alertIntent, 'https://nexttrain.co.za');
ok(alertApp.includes('alert=1794297920885') && alertApp.includes('src=all_GP'), 'alert human target is /?alert=');
const alertOg = buildOgShareLink(alertIntent, 'https://nexttrain.co.za');
ok(alertOg.includes('/og/a/all_GP/1794297920885'), 'alert OG URL stays on /og/a/');
const photoIntent = parseShareIntent(new URL('https://nexttrain.co.za/og/a/all_GP/1794297920885/2'));
ok(photoIntent && photoIntent.kind === 'alert' && photoIntent.photo === 2 && photoIntent.id === '1794297920885', 'worker reads /og/a/{source}/{id}/{photo}');
const photoApp = buildAppDeepLink(photoIntent, 'https://nexttrain.co.za');
ok(photoApp.includes('photo=2') && photoApp.includes('alert=1794297920885'), 'photo link lands on /?alert=&photo=');
const photoOg = buildOgShareLink(photoIntent, 'https://nexttrain.co.za');
ok(photoOg.endsWith('/og/a/all_GP/1794297920885/2'), 'photo OG URL keeps the image index');
consumeShareDeeplinkSnapshot();
const photoLaunch = ingestLaunchTargetUrl('https://nexttrain.co.za/og/a/all/1794297920885/2');
ok(photoLaunch && photoLaunch.photo === 2 && photoLaunch.id === '1794297920885', 'launch /og/a/.../2 snapshots that photo');
ok(String(globalThis.location.search).includes('photo=2'), 'photo launch rewrites to /?photo=');

consumeShareDeeplinkSnapshot();
const roomLaunch = ingestLaunchTargetUrl('https://nexttrain.co.za/#community/pta-mabopane/cp123');
ok(roomLaunch && roomLaunch.kind === 'community' && roomLaunch.routeId === 'pta-mabopane' && roomLaunch.postId === 'cp123', 'community hash launch opens that message');
ok(String(globalThis.location.search).includes('room=pta-mabopane') && String(globalThis.location.search).includes('post=cp123'), 'community hash rewrites to /?room=');
ok(!String(globalThis.location.hash || '').includes('#community/'), 'community hash is not left on the app URL');

const shareLinks = readFileSync(join(ROOT, 'src/lib/share-links.js'), 'utf8');
ok(shareLinks.includes('buildLiveTrainShareUrl'), 'client can mint live share URL');
ok(shareLinks.includes('/og/l/'), 'client mints /og/l/ path shares so WhatsApp cannot wrap ?live=');
ok(shareLinks.includes('liveShareBasePrefix'), 'preview live share URLs keep the app base');
ok(shareLinks.includes('/og\\/(?:l|live)\\/'), 'live path parse allows a base prefix before /og/l/');
const notFound = readFileSync(join(ROOT, 'src/pages/404.astro'), 'utf8');
ok(notFound.includes('/og\\/(?:l|live)\\/'), 'GitHub 404 sends /og/l/ humans into ?live=');
ok(notFound.includes('/og\\/a\\/') && notFound.includes('alert'), 'GitHub 404 sends /og/a/ humans into ?alert=');
ok(notFound.includes('/og\\/c\\/') && notFound.includes('room'), 'GitHub 404 sends /og/c/ humans into ?room=');
ok(shareLinks.includes("params.get('live')"), 'route parser ignores live shares');

const ogHtml = readFileSync(join(ROOT, 'workers/nexttrain-og/src/og-html.js'), 'utf8');
ok(ogHtml.includes('A rider is sharing Train'), 'live OG describes a rider sharing the train');
ok(ogHtml.includes('/og/train/'), 'live OG image is a path PNG, not a query string WhatsApp can wrap');
ok(ogHtml.includes('rel="image_src"'), 'OG HTML includes image_src for crawlers');

const ogIndex = readFileSync(join(ROOT, 'workers/nexttrain-og/src/index.js'), 'utf8');
ok(ogIndex.includes("/og/live.png"), 'worker still serves /og/live.png');
ok(ogIndex.includes('parseLiveTrainImagePath'), 'worker serves /og/train/*.png');
ok(ogIndex.includes('buildLiveTrainOgMeta'), 'worker emits live OG HTML');
ok(ogIndex.includes('isOgSharePath') && ogIndex.includes('parseLiveSharePath'), 'worker treats /og/l/ as a share path');
ok(ogIndex.includes('private, no-store'), 'OG HTML is not CDN-cached (live vs timetable UA mix)');
ok(ogIndex.includes('node.displayName'), 'community OG title uses who posted');
ok(ogIndex.includes('pickedImage'), 'alert OG can pick one attached photo');

const ghosts = readFileSync(join(ROOT, 'src/lib/train-ghosts.js'), 'utf8');
const termFn = ghosts.slice(ghosts.indexOf('export function trainTerminusName'), ghosts.indexOf('export function trainGoingLabel'));
ok(termFn.indexOf('findStopsForTrain') < termFn.indexOf('shortStation(fallback)'), 'terminus prefers timetable last stop over corridor fallback');

ok(isSocialCrawler('facebookexternalhit/1.1'), 'facebookexternalhit is a crawler');
ok(!isSocialCrawler('Mozilla/5.0 FBAN/FB4A FBAV/50.0'), 'Facebook IAB is not a crawler (must 302)');
ok(!isSocialCrawler('Mozilla/5.0 Instagram 192.0.0.0'), 'Instagram IAB is not a crawler');

const grid = readFileSync(join(ROOT, 'src/lib/grid-order.js'), 'utf8');
ok(/^export const MANUAL_GRID_ORDER = \{/m.test(grid), 'grid-order.js exports MANUAL_GRID_ORDER');
const extractor = readFileSync(join(ROOT, 'tools/grid-extractor/extract-grid.js'), 'utf8');
ok(extractor.includes('export const MANUAL_GRID_ORDER'), 'extractor template writes export const');
ok(extractor.includes('aliasSheetKeys'), 'extractor writes hyphen and underscore sheet-key aliases');
ok(/Next\)\?Train\[_\\s-\]/.test(extractor) || extractor.includes('[_\s-]'), 'extractor accepts underscore schedule filenames');
ok(extractor.includes('inferMissingTabs'), 'extractor auto-discovers XXX-to-YYY tabs missing from Config_GridOrder');
ok(extractor.includes('writeGridOrderFile'), 'extractor merges without clobbering orderGridTrainIds');
ok(extractor.includes('durbn_to_cross_weekday'), 'extractor asserts Crossmoor ROUTES.sheetKeys');
ok(grid.includes('"0513"') && grid.includes('"0516"'), 'August GP sheet still has 0513 / 0516 columns');

const layout = readFileSync(join(ROOT, 'src/layouts/Layout.astro'), 'utf8');
ok(layout.includes('launchQueue') && layout.includes('nt_launch_target_url'), 'head captures launchQueue before modules');
ok(layout.includes('function hostWebView()'), 'viewport script knows a host webview');
ok(layout.includes('var keyboard = !embedded && gap > 140'), 'a host toolbar is not treated as the keyboard');
ok(layout.includes('if (!embedded)'), 'a host webview does not extend the shell under its toolbar');
ok(layout.includes('if (editing && baseline - vh > 140) keyboard = true'), 'focusing a field in a host webview hides the nav only when the frame actually shrinks');
ok(layout.includes('animation: nt-nav-rise'), 'bottom nav fade ends visible if frames are dropped');
ok(!layout.includes('#bottom-nav.nt-nav-enter {\n        opacity: 0;'), 'nav enter class does not stick at opacity 0');
const prefs = readFileSync(join(ROOT, 'src/lib/prefs.js'), 'utf8');
ok(prefs.includes('setTimeout(clearEnter, 400)'), 'nav enter class is cleared even if animation frames do not run');

const astroCfg = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
ok(astroCfg.includes("url.pathname === '/og/share'") && astroCfg.includes('NetworkOnly'), 'SW does not cache /og/share');
ok(astroCfg.includes('/og/l'), 'SW does not cache /og/l live shares');
ok(astroCfg.includes('/og\\/[ac]'), 'SW does not cache /og/a or /og/c shares');
ok(astroCfg.includes('privacy\\.html'), 'SW does not treat /privacy.html as the app shell');
ok(astroCfg.includes('account-delete\\.html'), 'SW does not treat /account-delete.html as the app shell');
ok(astroCfg.includes('sitemap\\.xml'), 'SW does not treat /sitemap.xml as the app shell');
ok(astroCfg.includes('robots\\.txt'), 'SW does not treat /robots.txt as the app shell');
const welcomeDeeplink = readFileSync(join(ROOT, 'src/components/WelcomeModal.astro'), 'utf8');
ok(welcomeDeeplink.includes('hasInboundShareIntent()'), 'Welcome skips inbound planner/route snapshots');
const plannerDeeplink = readFileSync(join(ROOT, 'src/lib/planner-ui.js'), 'utf8');
ok(plannerDeeplink.includes('attempts < maxAttempts'), 'planner deep link retries station resolve');

const ui = readFileSync(join(ROOT, 'src/lib/ui.js'), 'utf8');
ok(ui.includes("location.hash === '#privacy'"), 'home tab paint keeps #privacy');
ok(ui.includes("location.hash === '#terms'"), 'home tab paint keeps #terms');

const privacyPage = readFileSync(join(ROOT, 'src/pages/privacy.astro'), 'utf8');
ok(privacyPage.includes('LEGAL_TEXTS.privacy'), 'privacy.html is the public policy, not a hash');
ok(privacyPage.includes('canonicalPath="/privacy.html"'), 'privacy.html has a stable canonical');
ok(privacyPage.includes('LegalArticle'), 'privacy.html uses the Account-styled legal shell');

const legalShell = readFileSync(join(ROOT, 'src/components/LegalArticle.astro'), 'utf8');
ok(legalShell.includes('#account'), 'legal pages can return to Account');
ok(legalShell.includes("get('from') === 'account'"), 'legal pages detect an Account return');

const deeplink = readFileSync(join(ROOT, 'src/lib/deeplink.js'), 'utf8');
ok(deeplink.includes("hash === '#account'"), ' /#account opens Account');
ok(deeplink.includes('setLiveTrainFollow'), 'live share starts view-only follow');
ok(deeplink.includes('findLiveTrainShare'), 'live share checks ride_pings before opening Map');
ok(deeplink.includes('is no longer being shared'), 'stopped live share tells the commuter');
ok(deeplink.includes('clearLiveTrainFollow'), 'stopped live share does not leave a Map permit');
ok(deeplink.includes('viewed: true'), 'live share asks for the view-only tracking card');
ok(!deeplink.includes('allowHiddenTabs'), 'live share does not use a generic hidden-tab bypass');
const ridePings = readFileSync(join(ROOT, 'src/lib/ride-pings.js'), 'utf8');
ok(ridePings.includes('export async function findLiveTrainShare'), 'ride-pings can look up a live share');
ok(ridePings.includes('TRACKING_STATE.STOPPED'), 'stopped pings do not count as live');
const mapTab = readFileSync(join(ROOT, 'src/lib/map-tab.js'), 'utf8');
ok(mapTab.includes('setTrackingOwnerChrome'), 'tracking card still hides owner chrome for viewers');
ok(mapTab.includes('getLiveTrainFollow'), 'map tab honors inbound live follow');
ok(!mapTab.includes('allowHiddenTabs'), 'focusTrainOnMap does not bypass Map gating');
const chrome = readFileSync(join(ROOT, 'src/lib/admin-chrome.js'), 'utf8');
ok(chrome.includes('canOpenTrackingMap'), 'Map open is a single gate');
ok(chrome.includes("canAccessPilotSurface('map') || isLiveTrainFollowActive()"), 'Map is admin/pin or this-session live follow');
const follow = readFileSync(join(ROOT, 'src/lib/live-train-follow.js'), 'utf8');
ok(follow.includes('sessionStorage'), 'live follow is session-only');
ok(!follow.includes('localStorage'), 'live follow is not written to localStorage');
ok(ui.includes('canOpenTrackingMap()'), 'switchTab refuses Map without admin, pin, or live follow');
ok(!ui.includes('allowHiddenTabs'), 'switchTab has no hidden-tab bypass');
ok(deeplink.includes('opts.prefer') && deeplink.includes('snap.prefer = true'), 'a chip click marks its snapshot preferred');
const timetableGrid = readFileSync(join(ROOT, 'src/lib/timetable-grid.js'), 'utf8');
ok(timetableGrid.includes("snap.prefer"), 'a preferred timetable chip wins over the page URL');
const chips = readFileSync(join(ROOT, 'src/lib/share-chips.js'), 'utf8');
ok(chips.includes('setLiveTrainFollow') === false && chips.includes('applyLiveTrainDeepLink'), 'a live chip uses the existing live-share open');
ok(!chips.includes('allowHiddenTabs'), 'share chips do not bypass Map with a hidden-tab flag');
const { describeShareUrl, renderTextWithShareChips, alertShareImageUrl } = await import('../src/lib/share-chips.js');
const plannerChip = describeShareUrl('https://nexttrain.co.za/og/share?plan=KEMPTON+PARK%7EGERMISTON&t=15%3A26&d=wd&r=GP');
ok(plannerChip?.label === 'Kempton Park → Germiston • 15:26', 'a planner share becomes the stations and time');
const routeChip = describeShareUrl('https://nexttrain.co.za/og/share?rt=pta-pien&v=g&d=wd');
ok(routeChip?.label === 'Pretoria ↔ Pienaarspoort', 'a timetable share becomes the route name');
const liveChip = describeShareUrl('https://nexttrain.co.za/og/l/9115/pta-pien/Pienaarspoort');
ok(liveChip?.label === 'Train 9115 → Pienaarspoort' && liveChip.kind === 'live', 'a live share becomes the train and destination');
const rendered = renderTextWithShareChips('See https://nexttrain.co.za/og/share?rt=jhb-rand&v=g&d=sa today');
const visible = rendered.replace(/<[^>]+>/g, '');
ok(rendered.includes('JHB ↔ Randfontein') && rendered.includes('Saturday') && !visible.includes('https://'), 'the pasted timetable URL is replaced by the route chip');
ok(rendered.includes('data-share-url='), 'the route chip stays clickable');
const seoShare = renderTextWithShareChips('https://nexttrain.co.za/og/share?plan=AKASIABOOM%7EWALTOO&t=16%3A05&d=wd&r=GP', { asLink: true });
ok(seoShare.startsWith('<a class="community-share-chip"') && seoShare.includes('Akasiaboom → Waltoo • 16:05') && !seoShare.replace(/<[^>]+>/g, '').includes('https://'), 'an SEO community preview uses the same trip chip as the app');
const communityLink = renderTextWithShareChips('See https://nexttrain.co.za/og/c/jhb-germiston/cp_mwn84zjm_4cze9f');
ok(communityLink.includes('nt-community-share-card'), 'a community message link becomes a text card');
ok(communityLink.includes('data-community-share-route="jhb-germiston"'), 'the card keeps the room');
ok(communityLink.includes('data-community-share-post="cp_mwn84zjm_4cze9f"'), 'the card keeps the message');
ok(!communityLink.includes('<img'), 'a community message card does not embed a picture');
ok(!communityLink.replace(/<[^>]+>/g, '').includes('https://'), 'the pasted community address is replaced by the card');
const posters = [
    'https://nexttrain.co.za/a.jpg',
    'https://nexttrain.co.za/b.jpg',
    'https://nexttrain.co.za/c.jpg',
    'https://nexttrain.co.za/d.jpg',
];
ok(alertShareImageUrl(posters, 4) === posters[3], 'a /4 notice link uses the fourth poster');
ok(alertShareImageUrl(posters, 0) === posters[0], 'a notice link with no photo uses the first poster');
const photoCard = renderTextWithShareChips('https://nexttrain.co.za/og/a/all_GP/1795168748314/4');
ok(photoCard.includes('data-alert-share-photo="4"'), 'the community card keeps the photo index');

const deletePage = readFileSync(join(ROOT, 'src/pages/account-delete.astro'), 'utf8');
ok(deletePage.includes('SUPPORT_EMAIL'), 'deletion page names the support email');
ok(deletePage.includes('Delete account'), 'deletion page tells commuters to use Account');
ok(!/operator/i.test(deletePage), 'deletion page does not mention operator accounts');

ok(adoptShareHome('pta-pien') === true, 'a timetable link can be saved as home');
ok(readSavedDefaults()?.routeId === 'pta-pien', 'the saved home is the timetable route');
ok(memoryStorage.getItem('welcomeSeen') === 'true', 'saving a link home finishes Welcome');
ok(holdLeaveForWelcome('next-train') === false, 'a saved home is not asked again');
consumeShareDeeplinkSnapshot();
memoryStorage.removeItem('welcomeSeen');
memoryStorage.setItem('nt_deeplink_surface', 'planner');
memoryStorage.setItem('nt_deeplink_welcome', '1');
loc = new URL('https://nexttrain.co.za/?plan=PRETORIA~GERMISTON&r=GP');
globalThis.location = loc;
ok(inboundShareKind() === 'planner', 'a trip URL is a planner share');
ok(holdLeaveForWelcome('trip-planner') === false, 'staying on the shared trip does not open Welcome');
ok(holdLeaveForWelcome('next-train') === true, 'leaving the shared trip opens Welcome');
ok(memoryStorage.getItem('nt_welcome_then_tab') === 'next-train', 'Welcome remembers the tab they wanted');
ok(!memoryStorage.getItem('nt_deeplink_surface'), 'Welcome can show once the shared tab is released');
loc = new URL('https://nexttrain.co.za/?alert=notice1&src=all');
globalThis.location = loc;
ok(inboundShareKind() === 'alert', 'a network notice is an alert share');
loc = new URL('https://nexttrain.co.za/?room=pta-pien&post=samplepost');
globalThis.location = loc;
ok(inboundShareKind() === 'community', 'a community URL is a community share');
loc = new URL('https://nexttrain.co.za/?rt=pta-pien&v=g&d=su');
globalThis.location = loc;
ok(inboundShareKind() === 'route', 'a timetable URL is a route share');
const timetable = readFileSync(join(ROOT, 'src/lib/timetable-grid.js'), 'utf8');
ok(timetable.includes('adoptShareHome(link.routeId)'), 'a shared timetable writes the default route');
ok(timetable.includes('persistRegion: false'), 'SEO Open in Next Train still does not write userRegion');
ok(timetable.includes('A new visitor is not pinned by the link'), 'SEO handoff still does not pin a new visitor');
const planner = readFileSync(join(ROOT, 'src/lib/planner-ui.js'), 'utf8');
ok(!planner.includes('adoptTripHomeIfNew'), 'a trip link does not pin a route');
ok(!deeplink.includes('homeRouteForNoticeSource'), 'an alert link does not invent a home route');
ok(!deeplink.includes('adoptShareHome(link.routeId)'), 'a community link does not pin the room');
ok(!deeplink.includes('welcomeBeforeShare'), 'boot does not stop a link on Welcome');
const welcome = readFileSync(join(ROOT, 'src/components/WelcomeModal.astro'), 'utf8');
ok(welcome.includes('!hasInboundShare'), 'an inbound link does not open Welcome first');
ok(welcome.includes('nt_welcome_then_tab'), 'picking a route continues to the tab they wanted');
const indexPage = readFileSync(join(ROOT, 'src/pages/index.astro'), 'utf8');
ok(!indexPage.includes('welcomeBeforeShare'), 'boot opens the link before Welcome');
ok(indexPage.includes("holdLeaveForWelcome('options')"), 'Options waits for Welcome when they leave a shared tab');
ok(ui.includes('holdLeaveForWelcome(tab)'), 'another tab waits for Welcome when they leave a shared tab');
const planMeta = buildPlannerOgMeta({
    kind: 'planner', from: 'MOUNTAIN VIEW', to: 'MAMELODI GARDENS', time: '4:32', day: 'weekday', region: 'GP',
}, 'https://nexttrain.co.za');
ok(planMeta.image.includes('from=MOUNTAIN%20VIEW') && !planMeta.image.includes('+'), 'a two-word trip preview does not use plus signs Facebook drops');

if (failures.length) {
    console.error('verify-deeplink-launch FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-deeplink-launch: ok');
