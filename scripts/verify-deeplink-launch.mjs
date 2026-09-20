/**
 * Facebook IAB / PWA launchQueue + share snapshot + OG human 302.
 * Run: node scripts/verify-deeplink-launch.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseShareIntent, isSocialCrawler, parseLiveTrainImagePath } from '../workers/nexttrain-og/src/parse.js';
import { buildAppDeepLink, buildOgShareLink } from '../workers/nexttrain-og/src/og-html.js';

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

const shareLinks = readFileSync(join(ROOT, 'src/lib/share-links.js'), 'utf8');
ok(shareLinks.includes('buildLiveTrainShareUrl'), 'client can mint live share URL');
ok(shareLinks.includes('/og/l/'), 'client mints /og/l/ path shares so WhatsApp cannot wrap ?live=');
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

const astroCfg = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
ok(astroCfg.includes("url.pathname === '/og/share'") && astroCfg.includes('NetworkOnly'), 'SW does not cache /og/share');
ok(astroCfg.includes('/og/l'), 'SW does not cache /og/l live shares');
ok(astroCfg.includes('privacy\\.html'), 'SW does not treat /privacy.html as the app shell');
ok(astroCfg.includes('account-delete\\.html'), 'SW does not treat /account-delete.html as the app shell');

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
ok(deeplink.includes('allowHiddenTabs: true'), 'live share opens Map even when the tab is hidden');
ok(deeplink.includes('viewed: true'), 'live share asks for the view-only tracking card');
const mapTab = readFileSync(join(ROOT, 'src/lib/map-tab.js'), 'utf8');
ok(mapTab.includes('allowHiddenTabs'), 'focusTrainOnMap can keep a hidden Map tab open');
ok(mapTab.includes('setTrackingOwnerChrome'), 'tracking card still hides owner chrome for viewers');
ok(mapTab.includes('getLiveTrainFollow'), 'map tab honors inbound live follow');
const chrome = readFileSync(join(ROOT, 'src/lib/admin-chrome.js'), 'utf8');
ok(chrome.includes('isLiveTrainFollowActive'), 'pilot chrome does not bounce a live-share viewer off Map');

const deletePage = readFileSync(join(ROOT, 'src/pages/account-delete.astro'), 'utf8');
ok(deletePage.includes('SUPPORT_EMAIL'), 'deletion page names the support email');
ok(deletePage.includes('Delete account'), 'deletion page tells commuters to use Account');
ok(!/operator/i.test(deletePage), 'deletion page does not mention operator accounts');

if (failures.length) {
    console.error('verify-deeplink-launch FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-deeplink-launch: ok');
