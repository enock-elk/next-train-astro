/**
 * Alert impression / view counting must stay gone.
 * Views POSTed to nexttrain-community on every dwell and burned Worker invocations.
 * Run: node scripts/verify-alert-impressions.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (condition, message) => {
    if (condition) console.log('ok  ', message);
    else failures.push(message);
};

const channelJs = readFileSync(join(ROOT, 'src/lib/alerts-channel.js'), 'utf8');
const workerJs = readFileSync(join(ROOT, 'workers/nexttrain-community/worker.js'), 'utf8');
const workerReadme = readFileSync(join(ROOT, 'workers/nexttrain-community/README.md'), 'utf8');

ok(!channelJs.includes('/alerts/impression'), 'Alerts overlay does not POST /alerts/impression');
ok(!channelJs.includes('/admin/alert-impressions'), 'Alerts overlay does not POST /admin/alert-impressions');
ok(!channelJs.includes('0 views'), 'alert cards do not show a views counter');
ok(!channelJs.includes('data-alert-impression-count'), 'alert cards have no impression count node');
ok(!channelJs.includes('observeRenderedAlertImpressions'), 'Alerts overlay does not observe cards for views');
ok(!channelJs.includes('postAlertImpression'), 'Alerts overlay does not post impressions');
ok(!channelJs.includes('hydrateAdminAlertImpressionCounts'), 'admin does not batch-fetch impression counts');
ok(!channelJs.includes('notice_impressions/'), 'admin does not fall back to RTDB notice_impressions');
ok(!channelJs.includes('ALERT_IMPRESSION_WORKER'), 'no community-worker impression host');
ok(!workerJs.includes("url.pathname === '/alerts/impression'"), 'worker no longer serves /alerts/impression');
ok(!workerJs.includes("url.pathname === '/admin/alert-impressions'"), 'worker no longer serves /admin/alert-impressions');
ok(!workerJs.includes('cleanupAlertImpressionDedupe'), 'hourly cron no longer walks notice_impressions');
ok(!workerJs.includes('recordAlertImpression'), 'worker no longer writes impression transactions');
ok(!workerJs.includes('handleAlertImpression'), 'worker impression handlers are gone');
ok(!workerReadme.includes('/alerts/impression'), 'community worker README dropped impression routes');

if (failures.length) {
    console.error('verify-alert-impressions failed:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-alert-impressions: ok');
