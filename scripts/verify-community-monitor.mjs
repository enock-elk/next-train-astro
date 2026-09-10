import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const admin = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const community = await readFile(new URL('../src/lib/community.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../workers/nexttrain-community/worker.js', import.meta.url), 'utf8');
const rules = JSON.parse(await readFile(new URL('../firebase-database.rules.json', import.meta.url), 'utf8'));

const start = admin.indexOf('function ntAdminCommunityActivityRows');
const end = admin.indexOf('const NT_ADMIN_WEEKDAY_LABELS', start);
assert.ok(start >= 0 && end > start, 'community monitor helpers are extractable');
const helpers = {};
new Function(`${admin.slice(start, end)}
this.rows = ntAdminCommunityActivityRows;
this.path = ntAdminCommunityActivityPath;
this.seenPatch = ntAdminCommunitySeenPatch;
`).call(helpers);

const activity = {
    routeA: {
        post1: { kind: 'post', postId: 'post1', uid: 'u1', timestamp: 100 },
        reply1: { kind: 'reply', postId: 'post1', replyId: 'reply1', uid: 'u2', timestamp: 300 },
    },
    routeB: {
        post2: { kind: 'post', postId: 'post2', uid: 'u3', timestamp: 200 },
    },
};
const held = [{
    reportId: 'hold1',
    routeId: 'routeC',
    type: 'auto_hold',
    status: 'open',
    timestamp: 400,
    publish: { kind: 'community_post' },
}];
const routes = {
    routeA: { name: 'Alpha' },
    routeB: { name: 'Beta' },
    routeC: { name: 'Charlie' },
    routeD: { name: 'Delta' },
};

const operatorOne = helpers.rows(activity, { routeA: 150, routeB: 250 }, held, routes);
assert.deepEqual(operatorOne.map((row) => row.routeId), ['routeC', 'routeA', 'routeB', 'routeD']);
assert.equal(operatorOne.find((row) => row.routeId === 'routeA').unread, 1);
assert.equal(operatorOne.find((row) => row.routeId === 'routeB').unread, 0);
assert.equal(operatorOne.find((row) => row.routeId === 'routeC').held.length, 1);
assert.ok(operatorOne.some((row) => row.routeId === 'routeD'), 'routes without activity remain accessible');

const operatorTwo = helpers.rows(activity, { routeA: 350 }, held, routes);
assert.equal(operatorTwo.find((row) => row.routeId === 'routeA').unread, 0);
assert.equal(operatorTwo.find((row) => row.routeId === 'routeB').unread, 1);
assert.deepEqual(helpers.seenPatch('operator1', 'routeA', 500), {
    'admin_state/operator1/community_seen/routeA': 500,
});
assert.equal(helpers.path('routeA', activity.routeA.reply1), 'route_community/routeA/posts/post1/replies/reply1');

assert.match(admin, />Community Monitor</);
assert.match(admin, /data-community-held=/, 'held cards have a distinct marker');
assert.match(admin, /border-2 border-dashed border-amber-400/, 'held cards are visually distinct');
assert.match(admin, /mq-approve-community/);
assert.match(admin, /mq-reject-community/);
assert.match(admin, /mq-hide-post/);
assert.match(admin, /mq-shadow-ban/);
assert.match(admin, /cm-hide-message/);
assert.match(admin, /cm-shadow-ban/);
assert.match(admin, /community_activity\.json/);
assert.match(admin, /moderation_queue\.json/);
assert.match(admin, /\['closed', 'resolved', 'approved', 'rejected'\]/, 'resolved holds do not count as unread');
assert.match(admin, /admin_state\/\$\{encodeURIComponent\(Admin\.currentUser\.uid\)\}\/community_seen/);
assert.match(admin, /Admin\._communityLoadRoute/, 'route messages load on demand');
assert.match(admin, /const missingActivity = \{\}/, 'lazy route load derives missing index entries from stored messages');
assert.match(admin, /Activity backfill failed/, 'backfill is best effort and does not replace source messages');
assert.doesNotMatch(admin, /route_community\.json[^]*onValue/, 'monitor does not attach a root route listener');
assert.doesNotMatch(admin, /status !== 'closed' && i\.status !== 'resolved'/, 'legacy approved-status overcount is gone');

assert.match(community, /community_activity\/\$\{encodeURIComponent\(routeId\)\}\/\$\{encodeURIComponent\(messageId\)\}/);
assert.match(community, /writeCommunityActivity\(routeId, postId, payload, 'post'/);
assert.match(community, /writeCommunityActivity\(routeId, replyId, payload, 'reply'/);
const activityPayloadSource = community.slice(
    community.indexOf('function communityActivityPayload'),
    community.indexOf('async function writeCommunityActivity')
);
assert.doesNotMatch(activityPayloadSource, /body/, 'activity index does not duplicate message bodies');
assert.match(community, /admin_state\/\$\{encodeURIComponent\(acct\.uid\)\}\/community_seen/);
assert.match(community, /\.\.\.replyToPayload/, 'quote-reply top-level posts keep their quote when held or published');
assert.match(worker, /rtdbUpdate\(env, \{/);
assert.match(worker, /community_activity\/\$\{routeId\}\/\$\{postId\}/);
assert.match(worker, /isSafeRtdbKey\(routeId\)/);
assert.match(worker, /isSafeRtdbKey\(postId\)/);
assert.match(admin, /\[`community_activity\/\$\{routeId\}\//, 'admin approval indexes approved messages');

const rootRules = rules.rules;
assert.ok(rootRules.community_activity, 'community activity rules exist');
assert.match(rootRules.community_activity.$routeId.$messageId['.write'], /root\.child\('route_community'\)/);
assert.match(rootRules.community_activity.$routeId.$messageId['.write'], /newData\.child\('uid'\)\.val\(\) === auth\.uid/);
assert.match(rootRules.admin_state.$adminUid['.write'], /auth\.uid === \$adminUid/);
assert.match(rootRules.admin_state.$adminUid['.write'], /thandeka05nxumalo@gmail\.com/);

console.log('Community Monitor verified: grouping, activity order, per-operator unread, seen paths, write hooks, held actions, and rules.');
