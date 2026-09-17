import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import communityWorker, {
    buildFcmMessage,
    deliverPushNotifications,
    normalizePushRequest,
    pushSubscriptionMatches,
} from '../workers/nexttrain-community/worker.js';

const request = normalizePushRequest({
    title: '<b>Service update</b>',
    body: '<p>Trains are moving again.</p>',
    audience: 'route',
    target: 'pta-pien',
    environment: 'production',
    urgency: 'high',
    ttlSec: 30,
    link: 'https://nexttrain.co.za/?rt=pta-pien&r=GP',
});
assert.equal(request.title, 'Service update');
assert.equal(request.body, 'Trains are moving again.');
assert.equal(request.ttlSec, 60, 'FCM TTL has a one-minute floor');
assert.equal(request.lab, false);
assert.throws(
    () => normalizePushRequest({ title: 'x', body: 'y', link: 'https://evil.example/' }),
    /must open Next Train/
);

const baseSub = {
    token: 'token-1234567890',
    enabled: true,
    lab: false,
    region: 'GP',
    routeIds: ['pta-pien'],
};
assert.equal(pushSubscriptionMatches(baseSub, request), true);
assert.equal(pushSubscriptionMatches({ ...baseSub, enabled: false }, request), false);
assert.equal(pushSubscriptionMatches({ ...baseSub, lab: true }, request), false);
assert.equal(pushSubscriptionMatches({ ...baseSub, routeIds: ['pta-mabopane'] }, request), false);
assert.equal(
    pushSubscriptionMatches(baseSub, { ...request, audience: 'region', target: 'GP' }),
    true
);

const message = buildFcmMessage(baseSub.token, request, 'test-tag');
assert.equal(message.token, baseSub.token);
assert.equal(message.webpush.fcm_options.link, request.link);
assert.equal(message.webpush.headers.Urgency, 'high');
assert.equal(message.webpush.notification.tag, 'test-tag');
assert.match(message.webpush.notification.icon, /icon-192\.png$/);
const fidMessage = buildFcmMessage('firebase-installation-id', request, 'fid-tag', 'fid');
assert.equal(fidMessage.fid, 'firebase-installation-id');
assert.equal('token' in fidMessage, false, 'new registrations use the current FID target');

class FakeRtdb {
    constructor(tree) {
        this.tree = structuredClone(tree);
        this.deleted = [];
    }
    async get(path) {
        assert.equal(path, 'push_subscriptions');
        return { value: structuredClone(this.tree) };
    }
    async put(path, value) {
        assert.equal(value, null);
        this.deleted.push(path);
        return { matched: true };
    }
}

const tree = {
    good: { ...baseSub, token: 'good-token-12345' },
    bad: { ...baseSub, token: 'bad-token-123456' },
    disabled: { ...baseSub, token: 'off-token-123456', enabled: false },
    lab: { ...baseSub, token: 'lab-token-123456', lab: true },
};
const previewDb = new FakeRtdb(tree);
const preview = await deliverPushNotifications({}, { ...request, dryRun: true }, { rtdb: previewDb });
assert.deepEqual(
    { matched: preview.matched, attempted: preview.attempted, sent: preview.sent },
    { matched: 2, attempted: 0, sent: 0 }
);

const sendDb = new FakeRtdb(tree);
const sent = await deliverPushNotifications({}, request, {
    rtdb: sendDb,
    sendOne: async (token) => token.startsWith('bad-')
        ? { ok: false, status: 404, invalid: true }
        : { ok: true, status: 200, invalid: false },
});
assert.deepEqual(
    { matched: sent.matched, attempted: sent.attempted, sent: sent.sent, failed: sent.failed, invalid: sent.invalid },
    { matched: 2, attempted: 2, sent: 1, failed: 1, invalid: 1 }
);
assert.deepEqual(sendDb.deleted, ['push_subscriptions/bad']);

const missingAuth = await communityWorker.fetch(
    new Request('https://worker.example/admin/notifications/send', {
        method: 'POST',
        body: JSON.stringify(request),
    }),
    {}
);
assert.equal(missingAuth.status, 401, 'notification sender requires Firebase admin auth');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
    assert.match(String(url), /accounts:lookup/);
    return new Response(JSON.stringify({
        users: [{ localId: 'commuter', email: 'commuter@example.com' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
try {
    const forbidden = await communityWorker.fetch(
        new Request('https://worker.example/admin/notifications/send', {
            method: 'POST',
            headers: { Authorization: 'Bearer commuter-token' },
            body: JSON.stringify(request),
        }),
        { FIREBASE_WEB_API_KEY: 'test-key' }
    );
    assert.equal(forbidden.status, 403, 'non-admin cannot send notifications');
} finally {
    globalThis.fetch = realFetch;
}

const [
    admin,
    client,
    bridge,
    rules,
    workerConfig,
    productionDeploy,
    productionBuild,
    githubPreview,
    labDeploy,
] = await Promise.all([
    readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/push-notify.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/firebase-messaging-sw-bridge.js', import.meta.url), 'utf8'),
    readFile(new URL('../firebase-database.rules.json', import.meta.url), 'utf8'),
    readFile(new URL('../workers/nexttrain-community/wrangler.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/production-build.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/deploy-lab.yml', import.meta.url), 'utf8'),
]);

assert.match(admin, /setupPushNotificationsManager/);
assert.match(admin, /id = 'push-notifications-panel'/);
assert.match(admin, /\/admin\/notifications\/send/);
assert.match(admin, /Count devices/);
assert.match(client, /region:\s*\$userRegion\.get\(\)/);
assert.match(client, /enabled:\s*!!enabled/);
assert.match(client, /persistToken\(token,\s*\{[\s\S]{0,120}enabled:\s*false[\s\S]{0,120}registrationType:/);
assert.match(client, /firebaseSignInAnonymously/);
assert.match(client, /!isOperatorSession\(\)\s*&&\s*!isFeatureEnabled/, 'operators can register before commuter push is enabled');
assert.match(client, /firebaseRegisterMessaging/);
assert.match(client, /firebaseOnRegistered/);
assert.match(client, /registrationType:\s*'fid'/);
assert.match(bridge, /firebase-messaging-compat\.js/);
assert.match(rules, /"push_subscriptions"/);
assert.match(rules, /newData\.child\('uid'\)\.val\(\) === auth\.uid/);
assert.match(rules, /newData\.child\('registrationType'\)\.val\(\) === 'fid'/);
assert.match(workerConfig, /"FIREBASE_PROJECT_ID":\s*"metrorail-next-train"/);
for (const workflow of [productionDeploy, productionBuild, githubPreview, labDeploy]) {
    assert.match(workflow, /PUBLIC_FIREBASE_VAPID_KEY:\s*\$\{\{\s*secrets\.PUBLIC_FIREBASE_VAPID_KEY\s*\}\}/);
}

console.log('Push notifications verified: scoped subscriptions, disable state, admin-only sender, FCM payload, invalid-token cleanup, VAPID build wiring, and admin panel.');
