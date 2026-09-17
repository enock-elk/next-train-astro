/**
 * Facebook IAB / PWA launchQueue + share snapshot + OG human 302.
 * Run: node scripts/verify-deeplink-launch.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseShareIntent, isSocialCrawler } from '../workers/nexttrain-og/src/parse.js';
import { buildAppDeepLink } from '../workers/nexttrain-og/src/og-html.js';

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

const deletePage = readFileSync(join(ROOT, 'src/pages/account-delete.astro'), 'utf8');
ok(deletePage.includes('SUPPORT_EMAIL'), 'deletion page names the support email');
ok(deletePage.includes('Delete account'), 'deletion page tells commuters to use Account');
ok(!/operator/i.test(deletePage), 'deletion page does not mention operator accounts');

if (failures.length) {
    console.error('verify-deeplink-launch FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-deeplink-launch: ok');
