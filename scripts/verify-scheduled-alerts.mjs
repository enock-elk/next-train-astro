import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    computeScheduledAlertNextRun,
    planScheduledAlertRun,
    runScheduledAlerts,
    scheduledAlertExpiresAt,
    scheduledNoticeId,
} from '../workers/nexttrain-community/worker.js';
import communityWorker from '../workers/nexttrain-community/worker.js';

const clone = (value) => value == null ? value : structuredClone(value);

class FakeRtdb {
    constructor(tree) {
        this.tree = clone(tree);
        this.versions = new Map();
        this.failOnce = new Set();
    }

    parts(path) {
        return String(path).split('/').filter(Boolean);
    }

    read(path) {
        let node = this.tree;
        for (const part of this.parts(path)) node = node?.[part];
        return clone(node ?? null);
    }

    version(path) {
        return this.versions.get(path) || 1;
    }

    async get(path, withEtag = false) {
        return { value: this.read(path), etag: withEtag ? `"${this.version(path)}"` : null };
    }

    async put(path, value, ifMatch = null) {
        if (this.failOnce.delete(path)) throw new Error(`Injected failure at ${path}`);
        if (ifMatch && ifMatch !== `"${this.version(path)}"`) return { matched: false };
        const parts = this.parts(path);
        let parent = this.tree;
        for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
        if (value == null) delete parent[parts.at(-1)];
        else parent[parts.at(-1)] = clone(value);
        this.versions.set(path, this.version(path) + 1);
        return { matched: true };
    }
}

const jhb = (isoLocal) => Date.parse(`${isoLocal}+02:00`);
const mondaySix = jhb('2026-09-07T06:00:00');
assert.equal(
    computeScheduledAlertNextRun({
        frequency: 'weekly',
        weekdays: [3],
        timeOfDay: '06:00',
    }, mondaySix),
    jhb('2026-09-09T06:00:00'),
    'weekly recurrence uses Johannesburg weekday/time'
);
assert.equal(
    computeScheduledAlertNextRun({
        frequency: 'monthly',
        monthDay: 31,
        timeOfDay: '08:30',
    }, jhb('2027-01-31T08:30:00')),
    jhb('2027-02-28T08:30:00'),
    'monthly recurrence clamps to Johannesburg month end'
);
assert.equal(
    scheduledAlertExpiresAt(jhb('2026-09-10T18:00:00'), { expireMode: 'end_of_day', notice: {} }),
    jhb('2026-09-10T23:59:59.999'),
    'end-of-day expiry is Johannesburg-local'
);

const now = jhb('2026-09-10T12:00:00');
const oldDaily = {
    frequency: 'daily',
    nextRunAt: jhb('2026-09-07T06:00:00'),
    expireMode: 'duration',
    notice: { expiresInMs: 60 * 60 * 1000 },
};
assert.deepEqual(planScheduledAlertRun(oldDaily, now), {
    due: true,
    occurrenceAt: 0,
    nextRunAt: jhb('2026-09-11T06:00:00'),
    staleSkipped: 4,
    finished: false,
}, 'all expired occurrences advance without flooding');

const occurrenceAt = now - 60_000;
const onceJob = {
    id: 'sched_test',
    target: 'all',
    targets: ['all', 'all_GP'],
    frequency: 'once',
    nextRunAt: occurrenceAt,
    enabled: true,
    expireMode: 'duration',
    notice: {
        message: 'Deterministic test',
        severity: 'critical',
        expiresInMs: 60 * 60 * 1000,
    },
};
const db = new FakeRtdb({ notices_scheduled: { sched_test: onceJob } });
db.failOnce.add('notices/all_GP');
const first = await runScheduledAlerts({ ALERT_CLAIM_LEASE_MS: '120000' }, { now, rtdb: db });
assert.equal(first.failed, 1, 'partial multi-target failure leaves occurrence retryable');
const expectedId = scheduledNoticeId('sched_test', occurrenceAt);
assert.equal(db.read(`notices/all/${expectedId}`).id, expectedId);
assert.ok(db.read('notices_scheduled/sched_test').processing, 'failed run retains its claim');

const retry = await runScheduledAlerts(
    { ALERT_CLAIM_LEASE_MS: '120000' },
    { now: now + 120_001, rtdb: db }
);
assert.equal(retry.published, 1);
assert.equal(db.read('notices_scheduled/sched_test'), null, 'successful once schedule is removed');
assert.deepEqual(Object.keys(db.read('notices/all')), [expectedId], 'retry overwrites deterministic notice');
assert.deepEqual(Object.keys(db.read('notices/all_GP')), [expectedId], 'failed target receives same occurrence ID');

const overlapDb = new FakeRtdb({ notices_scheduled: { sched_test: onceJob } });
const [overlapA, overlapB] = await Promise.all([
    runScheduledAlerts({}, { now, rtdb: overlapDb }),
    runScheduledAlerts({}, { now, rtdb: overlapDb }),
]);
assert.equal(overlapA.published + overlapB.published, 1, 'ETag claim permits one overlapping publisher');
assert.deepEqual(Object.keys(overlapDb.read('notices/all')), [expectedId]);

const staleDb = new FakeRtdb({
    notices_scheduled: {
        stale_once: {
            ...onceJob,
            id: 'stale_once',
            nextRunAt: now - 4 * 60 * 60 * 1000,
            notice: { ...onceJob.notice, expiresInMs: 30 * 60 * 1000 },
        },
    },
});
const stale = await runScheduledAlerts({}, { now, rtdb: staleDb });
assert.equal(stale.published, 0);
assert.equal(stale.staleSkipped, 1);
assert.equal(staleDb.read('notices'), null, 'expired occurrence does not publish');
assert.equal(staleDb.read('notices_scheduled/stale_once'), null);

const missingAuth = await communityWorker.fetch(
    new Request('https://worker.example/admin/scheduled-alerts'),
    {}
);
assert.equal(missingAuth.status, 401, 'status endpoint requires authentication');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
    assert.match(String(url), /accounts:lookup/);
    return new Response(JSON.stringify({
        users: [{ localId: 'commuter', email: 'commuter@example.com' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
try {
    const forbidden = await communityWorker.fetch(
        new Request('https://worker.example/admin/scheduled-alerts', {
            headers: { Authorization: 'Bearer commuter-token' },
        }),
        { FIREBASE_WEB_API_KEY: 'test-key' }
    );
    assert.equal(forbidden.status, 403, 'authenticated non-admin cannot read scheduler status');
} finally {
    globalThis.fetch = realFetch;
}

const [adminSource, workerSource, wranglerSource] = await Promise.all([
    readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../workers/nexttrain-community/worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../workers/nexttrain-community/wrangler.jsonc', import.meta.url), 'utf8'),
]);
const browserRunner = adminSource.slice(
    adminSource.indexOf('publishDueScheduledAlerts: async'),
    adminSource.indexOf('fetchScheduledAlerts: async')
);
assert.match(browserRunner, /\/admin\/scheduled-alerts/);
assert.match(browserRunner, /Authorization:\s*`Bearer \$\{secret\}`/);
assert.doesNotMatch(browserRunner, /notices_scheduled\.json/);
assert.match(workerSource, /enockelk@gmail\.com/);
assert.match(workerSource, /thandeka05nxumalo@gmail\.com/);
assert.match(wranglerSource, /"\*\/5 \* \* \* \*"/);
assert.match(wranglerSource, /"0 \* \* \* \*"/);

console.log('Scheduled alerts verified: Johannesburg recurrence, stale skipping, ETag overlap, deterministic partial-failure retry, admin Worker handoff, and split cron triggers.');
