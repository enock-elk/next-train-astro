/**
 * V8_08.18.2 polish: footer dump gone, 18 Aug 2026 dates, quote headers,
 * haptics opt-in, version lock.
 * Run: node scripts/verify-polish-08182.mjs
 */
import { readFileSync } from 'node:fs';
import { APP_VERSION, CHANGELOG_DATA } from '../src/lib/config.js';
import { formatAppDate } from '../src/lib/utils.js';
import { encodeFeedbackAlertQuote, parseFeedbackAlertQuote } from '../src/lib/feedback-quote.js';

const failures = [];
const fail = (msg) => failures.push(msg);

if (APP_VERSION !== 'V8_08.18.2') fail(`APP_VERSION is ${APP_VERSION}`);
const latest = CHANGELOG_DATA[0];
if (latest?.id !== 'V8_08.18.2') fail(`CHANGELOG_DATA[0].id is ${latest?.id}`);
if (!Array.isArray(latest?.features) || latest.features.length !== 1) {
    fail(`What's New must be exactly one bullet, got ${latest?.features?.length}`);
}
if (!/ads/i.test(latest.features[0]) || !/top/i.test(latest.features[0]) || !/bottom navigation/i.test(latest.features[0])) {
    fail(`What's New bullet must be ads-to-top for future bottom nav: ${latest.features[0]}`);
}
if (/admin|dev hub|telemetry|footer|haptic/i.test(latest.features.join(' '))) {
    fail('Whats New must stay commuter-only');
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.version !== '8.8.18.2') fail(`package.json version is ${pkg.version}`);
const appVer = JSON.parse(readFileSync('public/app-version.json', 'utf8'));
if (appVer.version !== 'V8_08.18.2') fail(`app-version.json is ${appVer.version}`);

const liveBoard = readFileSync('src/components/LiveBoard.astro', 'utf8');
if (liveBoard.includes('SeoFeaturedRoutes')) fail('LiveBoard footer must not include SeoFeaturedRoutes');
if (/Route timetables/.test(liveBoard)) fail('LiveBoard still has Route timetables dump');

const featured = readFileSync('src/components/SeoFeaturedRoutes.astro', 'utf8');
if (/compact/.test(featured)) fail('SeoFeaturedRoutes compact mode must stay removed');

for (const page of [
    'src/pages/routes/[slug].astro',
    'src/pages/corridors/[slug].astro',
    'src/pages/regions/[slug].astro',
    'src/pages/routes.astro',
]) {
    const html = readFileSync(page, 'utf8');
    if (html.includes('SeoFeaturedRoutes')) fail(`${page} must not dump SeoFeaturedRoutes`);
}

const sample = formatAppDate(new Date(2026, 7, 18, 21, 28), { withTime: true });
if (sample !== '18 Aug 2026, 9:28 PM') fail(`formatAppDate got "${sample}"`);
if (formatAppDate(new Date(2026, 7, 18)) !== '18 Aug 2026') fail('formatAppDate date-only mismatch');

const encoded = encodeFeedbackAlertQuote({
    alertId: '12345',
    kind: 'disruption',
    snippet: 'Line Severed - Pretoria',
});
if (encoded !== '[ALERT:12345|disruption|Line Severed - Pretoria]') fail(`encode got ${encoded}`);
const parsed = parseFeedbackAlertQuote(`${encoded}\nTrain is stuck`);
if (!parsed || parsed.alertId !== '12345' || parsed.kind !== 'disruption' || parsed.body.trim() !== 'Train is stuck') {
    fail(`parse mismatch ${JSON.stringify(parsed)}`);
}

const ui = readFileSync('src/lib/ui.js', 'utf8');
if (!ui.includes("safeStorage.getItem('hapticsEnabled') === 'true'")) {
    fail('triggerHaptic must treat missing hapticsEnabled as off');
}
if (ui.includes("!== 'false'")) fail('ui.js still uses haptics opt-out');
const hub = readFileSync('src/lib/hub.js', 'utf8');
if (hub.includes("hapticsEnabled') !== 'false'")) fail('hub.js still uses haptics opt-out');
const welcome = readFileSync('src/components/WelcomeModal.astro', 'utf8');
if (!welcome.includes("hapticsEnabled') === 'true'")) fail('WelcomeModal haptics still default on');

const admin = readFileSync('public/js/admin.js', 'utf8');
if (!admin.includes('getSelectedAlertTargets')) fail('admin missing multi-target picker');
if (!admin.includes('buildSyntheticQuotedAlert')) fail('admin missing reconstructed quote preview');
if (!admin.includes('parseFeedbackAlertQuote')) fail('admin must parse [ALERT:id|kind|snippet]');
if (admin.includes("Original message not in this thread view") && !admin.includes('buildSyntheticQuotedAlert')) {
    fail('quoted alert still dead-ends on missing thread');
}

const alerts = readFileSync('src/lib/alerts-channel.js', 'utf8');
if (!alerts.includes('formatAppDate')) fail('alerts-channel must use formatAppDate');
if (alerts.includes('toLocaleDateString()')) fail('alerts-channel still uses slash dates');

if (failures.length) {
    console.error(`\n✗ polish 08182 failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('✓ V8_08.18.2 polish (footer, dates, quotes, haptics, version)');
