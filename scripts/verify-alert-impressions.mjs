import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.crypto ??= webcrypto;

const {
    cleanupAlertImpressionDedupe,
    hashInstallationId,
    isValidImpressionNoticeId,
    isValidImpressionScope,
    recordAlertImpression,
} = await import('../workers/nexttrain-community/worker.js');
const {
    alertImpressionStorageKey,
    createAlertImpressionInstallationId,
    shouldCountAlertIntersection,
} = await import('../src/lib/alerts-channel.js');
const { isProtectedVolatileKey } = await import('../src/lib/utils.js');

const failures = [];
const ok = (condition, message) => {
    if (condition) console.log('ok  ', message);
    else failures.push(message);
};
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

class FakeRtdb {
    constructor() {
        this.nodes = new Map([
            ['notices/all_GP/n1', { id: 'n1', message: 'Live notice' }],
        ]);
        this.versions = new Map();
    }

    tree(prefix) {
        const out = {};
        for (const [path, value] of this.nodes) {
            if (!path.startsWith(`${prefix}/`)) continue;
            const parts = path.slice(prefix.length + 1).split('/');
            let node = out;
            parts.forEach((part, index) => {
                if (index === parts.length - 1) node[part] = clone(value);
                else node = node[part] ||= {};
            });
        }
        return Object.keys(out).length ? out : null;
    }

    async get(path, withEtag = false) {
        const value = this.nodes.has(path) ? this.nodes.get(path) : this.tree(path);
        return {
            value: clone(value),
            etag: withEtag ? `"${this.versions.get(path) || 0}"` : null,
        };
    }

    async put(path, value, ifMatch = null) {
        const version = this.versions.get(path) || 0;
        if (ifMatch && ifMatch !== `"${version}"`) return { matched: false };
        this.nodes.set(path, clone(value));
        this.versions.set(path, version + 1);
        return { matched: true };
    }
}

ok(isValidImpressionScope('all') && isValidImpressionScope('all_GP'), 'network and region scopes are valid');
ok(isValidImpressionScope('pta-mabopane') && !isValidImpressionScope('../bad'), 'route scope validation blocks unsafe paths');
ok(isValidImpressionNoticeId('sched_abc_123') && !isValidImpressionNoticeId('bad/id'), 'notice id validation blocks path injection');
ok(shouldCountAlertIntersection({ isIntersecting: true, intersectionRatio: 0.5, pageVisible: true, channelVisible: true }), '50% visible qualifies');
ok(!shouldCountAlertIntersection({ isIntersecting: true, intersectionRatio: 0.49, pageVisible: true, channelVisible: true }), 'less than 50% does not qualify');
ok(!shouldCountAlertIntersection({ isIntersecting: true, intersectionRatio: 1, pageVisible: false, channelVisible: true }), 'hidden page never qualifies');
ok(alertImpressionStorageKey('all_GP', 'n1') === 'nt_alert_impression_v1:all_GP:n1', 'persistent dedupe key includes scope and notice');

const deterministicCrypto = {
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
};
ok(
    createAlertImpressionInstallationId(deterministicCrypto) === 'nti_11111111-2222-4333-8444-555555555555',
    'installation id uses random UUID source'
);
ok(isProtectedVolatileKey('nt_alert_impression_installation_v1'), 'installation identity survives manual cache refresh');
ok(isProtectedVolatileKey('nt_alert_impression_v1:all_GP:n1'), 'per-notice dedupe survives manual cache refresh');
const hashA = await hashInstallationId('nti_11111111-2222-4333-8444-555555555555', 'secret');
const hashB = await hashInstallationId('nti_11111111-2222-4333-8444-555555555555', 'secret');
ok(hashA === hashB && hashA.length === 64 && !hashA.includes('11111111'), 'worker stores a stable one-way installation hash');

const rtdb = new FakeRtdb();
const request = {
    rtdb,
    scope: 'all_GP',
    noticeId: 'n1',
    installationId: 'nti_11111111-2222-4333-8444-555555555555',
    hashSecret: 'secret',
    now: 1_700_000_000_000,
    retentionMs: 1_000,
};
const [first, concurrentDuplicate] = await Promise.all([
    recordAlertImpression(request),
    recordAlertImpression(request),
]);
ok([first, concurrentDuplicate].filter((row) => row.counted).length === 1, 'concurrent duplicate increments exactly once');
ok(first.count === 1 && concurrentDuplicate.count === 1, 'both concurrent callers observe count one');

const secondInstall = await recordAlertImpression({
    ...request,
    installationId: 'nti_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
});
ok(secondInstall.counted && secondInstall.count === 2, 'a second installation increments the notice count');

const missing = await recordAlertImpression({ ...request, noticeId: 'missing' });
ok(!missing.found && !missing.counted, 'nonexistent notice is rejected without a count');

const cleanup = await cleanupAlertImpressionDedupe({}, {
    rtdb,
    now: request.now + request.retentionMs + 1,
});
const afterCleanup = (await rtdb.get('notice_impressions/all_GP/n1')).value;
ok(cleanup.deleted === 2, 'hourly cleanup removes expired dedupe records');
ok(afterCleanup.count === 2 && Object.keys(afterCleanup.dedupe).length === 0, 'cleanup preserves aggregate count');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const channelJs = readFileSync(join(ROOT, 'src/lib/alerts-channel.js'), 'utf8');
const workerJs = readFileSync(join(ROOT, 'workers/nexttrain-community/worker.js'), 'utf8');
ok(channelJs.includes('ALERT_IMPRESSION_DWELL_MS = 900'), 'client requires a short visibility dwell');
ok(channelJs.includes("threshold: [0, 0.5, 1]"), 'observer uses a 50% threshold');
ok(channelJs.includes('safeStorage.setItem(alertImpressionStorageKey'), 'client persists per-install notice dedupe');
ok(channelJs.includes('/admin/alert-impressions'), 'admin cards request authenticated counts');
ok(workerJs.includes("url.pathname === '/alerts/impression'"), 'worker exposes the impression POST endpoint');
ok(workerJs.includes('cleanupAlertImpressionDedupe(env)'), 'hourly cron includes impression dedupe cleanup');

if (failures.length) {
    console.error('verify-alert-impressions failed:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('verify-alert-impressions: ok');
