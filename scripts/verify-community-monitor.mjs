import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const admin = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles/appearance.css', import.meta.url), 'utf8');
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
assert.match(admin, /cm-options-toggle/, 'message actions sit behind Options');
assert.match(admin, /cm-hide-message/);
assert.match(admin, /cm-delete-message/);
assert.match(admin, /deletePublishedCommunityMessage/);
assert.match(admin, /cm-shadow-ban/);
assert.match(admin, /community_activity\.json/);
assert.match(admin, /params\.set\('shallow', 'true'\)/, 'community activity index is a shallow key list');
assert.doesNotMatch(admin, /community_activity\.json\$\{authQ\}/, 'Community Monitor does not download the whole activity tree');
assert.match(admin, /ntPendingScheduleLoad/, 'badge sync can see an in-flight schedule load');
assert.match(admin, /_afterScheduleWaterfall/, 'badge reads wait until that schedule load finishes');
assert.match(admin, /COMMUNITY_ACTIVITY_CONCURRENCY = 4/, 'route activity pages stay at four at a time');
assert.match(admin, /windowFloor > 0 && \(Number\(ts\) \|\| 0\) < windowFloor/, 'a full activity page does not backfill older messages');
assert.match(admin, /moderation_queue\.json/);
assert.match(admin, /\['closed', 'resolved', 'approved', 'rejected', 'dismissed'\]/, 'resolved holds do not count as unread');
assert.match(admin, /admin_state\/\$\{encodeURIComponent\(Admin\.currentUser\.uid\)\}\/community_seen/);
assert.match(admin, /Admin\._communityLoadRoute/, 'route messages load on demand');
assert.match(admin, /const missingActivity = \{\}/, 'lazy route load derives missing index entries from stored messages');
assert.match(admin, /Activity backfill failed/, 'backfill is best effort and does not replace source messages');
assert.match(admin, /Object\.entries\(postsData\)/, 'monitor uses Firebase keys when postId is missing from the payload');
assert.match(admin, /encodeURIComponent\(token\)/, 'monitor delete uses a fresh encoded ID token');
assert.match(admin, /method: 'DELETE'/, 'published posts are deleted at their RTDB path, not via a root PATCH');
assert.match(admin, /list\.onclick =/, 'monitor click handler is replaced on each refresh');
assert.match(admin, /ntBindAdminTabSwipe\(body/, 'Community Monitor swipes between its tabs');
assert.match(admin, /ntBindAdminTabSwipe\(document\.getElementById\('ut-body'\)/, 'User trust swipes between its tabs');
assert.match(admin, /class="ut-devices"/, 'linked device ids sit in a collapsed row');
assert.match(css, /#mq-body\.mq-showing-thread #mq-chats-pane/, 'an open monitor chat fills the panel');
assert.match(css, /#mq-body\.mq-showing-thread \.cm-thread-bar/, 'the second route title is hidden');
assert.doesNotMatch(
    admin.slice(admin.indexOf('Admin.deletePublishedCommunityMessage'), admin.indexOf('list.onclick')),
    /method: 'PATCH'/,
    'delete no longer PATCHes the database root'
);
assert.doesNotMatch(admin, /route_community\.json[^]*onValue/, 'monitor does not attach a root route listener');
assert.doesNotMatch(admin, /status !== 'closed' && i\.status !== 'resolved'/, 'legacy approved-status overcount is gone');

const communityView = await readFile(new URL('../src/components/CommunityView.astro', import.meta.url), 'utf8');
assert.match(communityView, /class="community-chrome relative z-20/, 'route chrome sits above the feed stacking context');
assert.match(communityView, /#view-community \.community-chrome \{\s*z-index: 20;/, 'chrome z-index is pinned in CSS, not only Tailwind');
assert.match(communityView, /#view-community \.community-route-row \{\s*z-index: 10;/, 'picker row sits above the guest hint');
assert.match(communityView, /#community-route-dropdown\.is-open \{\s*z-index: 40;/, 'open picker sits above later chrome siblings');
assert.match(communityView, /community-feed-scroll relative z-\[1\]/, 'feed stays below the route list');
assert.ok(
    communityView.indexOf('id="community-error"') < communityView.indexOf('id="community-composer"'),
    'community error sits above the composer input'
);
assert.match(community, /wrap\?\.classList\.toggle\('is-open', open\)/, 'open list marks the dropdown wrapper');
assert.match(community, /hint\.style\.visibility = open \? 'hidden' : ''/, 'open list hides the guest hint so its dismiss X cannot steal taps');
assert.match(community, /e\.key === 'Escape'/, 'Escape closes the route list');

assert.match(community, /community_activity\/\$\{encodeURIComponent\(routeId\)\}\/\$\{encodeURIComponent\(messageId\)\}/);
assert.match(community, /writeCommunityActivity\(routeId, postId, payload, 'post'/);
assert.match(community, /writeCommunityActivity\(routeId, replyId, payload, 'reply'/);
const activityPayloadSource = community.slice(
    community.indexOf('function communityActivityPayload'),
    community.indexOf('async function writeCommunityActivity')
);
assert.doesNotMatch(activityPayloadSource, /body/, 'activity index does not duplicate message bodies');
assert.match(community, /admin_state\/\$\{encodeURIComponent\(acct\.uid\)\}\/community_seen/);
assert.match(community, /users\/\$\{encodeURIComponent\(acct\.uid\)\}\/community_seen/, 'a signed-in account keeps its own seen cursor');
assert.doesNotMatch(community, /setItem\(unreadSeenKey\(routeId\), String\(Date\.now\(\)\)\);\s*return 0/, 'a first visit does not stamp every room as seen');
{
    const start = community.indexOf('function communityUnreadCursor');
    const end = community.indexOf('let accountSeenCache');
    assert.ok(start > 0 && end > start, 'unread cursor helpers are extractable');
    const unread = {};
    new Function(`${community.slice(start, end).replace(/^export /gm, '')}
this.cursor = communityUnreadCursor;
this.count = countCommunityUnreadPosts;
`).call(unread);
    assert.equal(unread.cursor(null, null).established, false, 'no cursor means the room is still unseen');
    assert.equal(unread.cursor('100', null).lastSeen, 100);
    assert.equal(unread.cursor(null, 250).established, true, 'another signed-in session can clear the room');
    assert.equal(unread.cursor('100', 250).lastSeen, 250);
    const posts = [
        { timestamp: 10, body: 'old', uid: 'a' },
        {
            timestamp: 30,
            body: 'new',
            uid: 'b',
            replies: { r1: { timestamp: 40, body: 'reply', uid: 'c' } },
        },
        { timestamp: 50, body: 'mine', uid: 'me' },
    ];
    assert.equal(unread.count(posts, '', 0), 4, 'an unseen room counts posts and nested replies');
    assert.equal(unread.count(posts, 'me', 20), 2, 'messages after the cursor stay unread, including a reply');
}
assert.match(rules.rules.users.$uid.community_seen.$routeId['.validate'], /newData\.isNumber/, 'account seen cursors are timestamps');
assert.match(community, /\.\.\.replyToPayload/, 'quote-reply top-level posts keep their quote when held or published');
assert.match(worker, /rtdbUpdate\(env, \{/);
assert.match(worker, /community_activity\/\$\{routeId\}\/\$\{postId\}/);
assert.match(worker, /handleAlertImageUpload/, 'operators can upload an alert photo');
assert.match(worker, /ADMIN_EMAILS\.has/, 'alert photo upload stays on the operator allowlist');
assert.match(worker, /env\.ALERT_IMAGES/, 'alert photos use the R2 binding');
const wrangler = await readFile(new URL('../workers/nexttrain-community/wrangler.jsonc', import.meta.url), 'utf8');
assert.match(wrangler, /nexttrain-alert-images/, 'alert photos use the named R2 bucket');
assert.match(worker, /isSafeRtdbKey\(routeId\)/);
assert.match(worker, /isSafeRtdbKey\(postId\)/);
assert.match(admin, /\[`community_activity\/\$\{routeId\}\//, 'admin approval indexes approved messages');

const rootRules = rules.rules;
assert.ok(rootRules.community_activity, 'community activity rules exist');
assert.match(rootRules.community_activity.$routeId.$messageId['.write'], /root\.child\('route_community'\)/);
assert.match(rootRules.community_activity.$routeId.$messageId['.write'], /newData\.child\('uid'\)\.val\(\) === auth\.uid/);
assert.match(rootRules.admin_state.$adminUid['.write'], /auth\.uid === \$adminUid/);
assert.match(rootRules.admin_state.$adminUid['.write'], /thandeka05nxumalo@gmail\.com/);
assert.equal(rootRules.route_community.$routeId.post_reactions['.read'], true, 'post_reactions parent is public-read so other users can load reactions');
assert.equal(rootRules.route_community.$routeId.post_reactions.$postId['.read'], true);

assert.match(community, /communityLastRoom_/, 'last community room is remembered per region');
assert.match(community, /syncReplyDraftForRoute/, 'quote draft is dropped when the room does not match');
assert.match(community, /getLastCommunityRoom\(\)/, 'reopening Community restores the last room, not only the pinned route');
assert.match(community, /post_reactions\/\$\{encodeURIComponent\(postId\)\}\.json/, 'reaction fetch falls back to per-post reads');
assert.doesNotMatch(community, /post_reactions\.json/, 'reactions are not downloaded as one growing node');
assert.match(community, /startRealtimeReactions/, 'reactions listen live so other users see them');
assert.match(community, /syncVisibleReactionListeners/, 'reactions listen per visible post');
assert.match(community, /applyFittedLabel\(/, 'community route names expand only when the line fits');
assert.match(communityView, /id="community-route-display" class="min-w-0 flex-1/, 'route name is measured against the pill width');
assert.match(community, /community-room-unread/, 'route list marks which room has unread');
assert.match(community, /unread on \$\{roomNames/, 'Community badge names the unread room');
assert.match(community, /paintCommunityQuotaHint/, 'remaining send quota is painted above the composer');
assert.match(community, /uid === prevUid/, 'consecutive community messages from the same person are grouped');
assert.match(community, /community-avatar-spacer/, 'grouped messages keep the avatar column');
assert.match(communityView, /community-avatar-spacer/, 'Community CSS keeps WhatsApp-style grouped rows');
assert.match(community, /\$\{left\} left/, 'quota hint is a remaining-messages countdown');
assert.match(community, /left > 3/, 'quota hint stays hidden until 3 messages remain');
assert.match(community, /viewing\) cachedUnreadByRoute\[viewing\] = 0/, 'the open room is cleared before a slower unread count returns');
assert.match(community, /orderBy=%22timestamp%22&startAt=/, 'unread counts only posts newer than the last visit');
assert.match(community, /public_profile\/\$\{encodeURIComponent\(uid\)\}/, 'community bubbles read the latest public points');
assert.ok(rules.rules.public_profile, 'public profile rules exist');
assert.ok(rules.rules.users.$uid.communityAllowance, 'an operator can store a higher community limit');
assert.match(worker, /communityAllowance/, 'a raised community limit is read by the worker');
assert.match(community, /Community is still being tried out/, 'quota hint explains that Community is still being tried out');
assert.match(communityView, /decoration-dotted/, 'quota hint uses a dotted underline');
assert.match(communityView, /<button type="button" id="community-quota-hint"/, 'quota hint is a button');
assert.match(communityView, /id="community-route-unread"/, 'route picker shows unread that is not on the open room');
assert.ok(
    communityView.indexOf('id="community-quota-hint"') < communityView.indexOf('id="community-composer"'),
    'quota hint sits above the composer input'
);
assert.ok(
    communityView.indexOf('id="community-error"') < communityView.indexOf('id="community-quota-hint"'),
    'wait error stays above the quota hint'
);

const ui = await readFile(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert.match(ui, /community-post-row/, 'tab swipe ignores message rows so swipe-to-reply does not open Map');
assert.match(ui, /is-tab-swiping/, 'tab swipe follows the finger and can rest mid-way');
assert.match(ui, /placePeer\(0, true\)/, 'a short swipe snaps back instead of changing tabs');
assert.match(admin, /id="mq-thread"/, 'a community route opens as its own thread');
assert.match(admin, /mq-showing-thread/, 'the monitor thread hides the route list');
assert.match(admin, /limitToLast=80/, 'the monitor pages messages instead of downloading a whole room at once');
assert.match(admin, /id="mq-load-earlier"/, 'the monitor can load earlier messages');
assert.match(admin, /id="mq-tab-reports"/, 'reports sit in Community Monitor');
assert.match(admin, /class="mq-safe"/, 'a safe report can be dismissed');
assert.match(community, /reportedByName/, 'a report stores the reporter name');
const mqTabbar = admin.slice(admin.indexOf('id="mq-tabbar"'), admin.indexOf('id="mq-tabbar"') + 280);
assert.doesNotMatch(mqTabbar, /sticky/, 'the community monitor tabs scroll away with the introduction');

const trust = await readFile(new URL('../src/lib/trust.js', import.meta.url), 'utf8');
assert.match(trust, /remaining: 0/, 'exhausted quota reports remaining 0');
assert.match(trust, /return \{ ok: true, remaining \}/, 'rate check reports remaining sends');

const { communityRouteOnEntry } = await import('../src/lib/features.js');
const pienOnly = { enabled: true, routeIds: ['pta-pien'], regionIds: ['GP'] };
assert.equal(communityRouteOnEntry(pienOnly, 'pta-pien'), true, 'PTA-Pien stays open when it is the listed room');
assert.equal(communityRouteOnEntry(pienOnly, 'pta-mabopane'), false, 'another Gauteng room stays closed when only PTA-Pien is listed');
const regionOnly = { enabled: true, routeIds: [], regionIds: ['GP'] };
assert.equal(communityRouteOnEntry(regionOnly, 'pta-mabopane'), true, 'an empty route list still opens the region');
assert.equal(communityRouteOnEntry(regionOnly, 'ct-bellv'), false, 'another region stays closed');
assert.equal(communityRouteOnEntry({ enabled: true, routeIds: ['*'], regionIds: [] }, 'ct-bellv'), true, 'a star list opens every room');
assert.equal(communityRouteOnEntry({ enabled: false, routeIds: ['pta-pien'], regionIds: ['GP'] }, 'pta-pien'), false, 'a switched-off community opens nothing');
assert.match(community, /isListedCommunityRoute/, 'the picker uses the community room list');
assert.doesNotMatch(community, /keep foreign route/, 'a deep link cannot add a room that is off');
assert.match(community, /communityRoomAllowed/, 'opening a feed checks the room');

console.log('Community Monitor verified: grouping, activity order, per-operator unread, seen paths, write hooks, held actions, and rules.');
