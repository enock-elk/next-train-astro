import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const admin = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles/appearance.css', import.meta.url), 'utf8');
const community = await readFile(new URL('../src/lib/community.js', import.meta.url), 'utf8');
const communityView = await readFile(new URL('../src/components/CommunityView.astro', import.meta.url), 'utf8');
const worker = await readFile(new URL('../workers/nexttrain-community/worker.js', import.meta.url), 'utf8');
const rules = JSON.parse(await readFile(new URL('../firebase-database.rules.json', import.meta.url), 'utf8'));

const start = admin.indexOf('function ntAdminCommunityOwnActivity');
const end = admin.indexOf('const NT_ADMIN_WEEKDAY_LABELS', start);
assert.ok(start >= 0 && end > start, 'community monitor helpers are extractable');
const helpers = {};
new Function(`${admin.slice(start, end)}
this.rows = ntAdminCommunityActivityRows;
this.path = ntAdminCommunityActivityPath;
this.seenPatch = ntAdminCommunitySeenPatch;
this.preview = ntAdminCommunityPostPreview;
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
const ownReply = helpers.rows(activity, { routeA: 150 }, held, routes, 'u2');
assert.equal(ownReply.find((row) => row.routeId === 'routeA').unread, 0, 'the viewing operator does not get a badge for their own reply');
const otherOperator = helpers.rows(activity, { routeA: 150 }, held, routes, 'u1');
assert.equal(otherOperator.find((row) => row.routeId === 'routeA').unread, 1, 'another operator still raises the badge');
const answered = helpers.rows({
    routeA: {
        post1: { kind: 'post', postId: 'post1', uid: 'commuter', timestamp: 200 },
        reply1: { kind: 'reply', postId: 'post1', replyId: 'reply1', uid: 'admin', timestamp: 400 },
    },
}, { routeA: 100 }, [], routes, 'admin');
assert.equal(answered.find((row) => row.routeId === 'routeA').unread, 0, 'a chat is clear when this admin posted last');
const stillOpen = helpers.rows({
    routeA: {
        post1: { kind: 'post', postId: 'post1', uid: 'admin', timestamp: 200 },
        reply1: { kind: 'reply', postId: 'post1', replyId: 'reply1', uid: 'commuter', timestamp: 400 },
    },
}, { routeA: 100 }, [], routes, 'admin');
assert.equal(stillOpen.find((row) => row.routeId === 'routeA').unread, 1, 'a later commuter message stays unread for this admin');
assert.equal(operatorOne.find((row) => row.routeId === 'routeC').held.length, 1);
assert.ok(operatorOne.some((row) => row.routeId === 'routeD'), 'routes without activity remain accessible');

const operatorTwo = helpers.rows(activity, { routeA: 350 }, held, routes);
assert.equal(operatorTwo.find((row) => row.routeId === 'routeA').unread, 0);
assert.equal(operatorTwo.find((row) => row.routeId === 'routeB').unread, 1);
assert.deepEqual(helpers.seenPatch('operator1', 'routeA', 500), {
    'admin_state/operator1/community_seen/routeA': 500,
});
assert.equal(helpers.path('routeA', activity.routeA.reply1), 'route_community/routeA/posts/post1/replies/reply1');
const hercules = helpers.preview('post-old', {
    postId: 'post-old',
    body: 'Hello Hercules, testing.',
    uid: 'enock',
    timestamp: 1757196300000,
});
assert.equal(hercules.body, 'Hello Hercules, testing.');
assert.equal(hercules.activity.kind, 'post');
assert.equal(hercules.activity.postId, 'post-old');
const replied = helpers.preview('post1', {
    postId: 'post1',
    body: 'older post',
    uid: 'u1',
    timestamp: 100,
    replies: { r1: { replyId: 'r1', body: 'newer reply', uid: 'u2', timestamp: 500 } },
});
assert.equal(replied.body, 'newer reply');
assert.equal(replied.activity.kind, 'reply');
assert.equal(replied.activity.replyId, 'r1');
assert.match(admin, /quietRows/, 'routes with no activity index still load their newest post');
assert.match(admin, /route_community\/\$\{encodeURIComponent\(row\.routeId\)\}\/posts\.json/);
assert.match(admin, /class="community-monitor-route admin-sheet-card/);
assert.match(css, /\.admin-sheet-list \{\s*display: flex;/, 'admin lists are not capped by an inner scroll box');
assert.doesNotMatch(admin, /id="ls-log-list" class="[^"]*max-h-/, 'live share sessions are not clipped by a max height');
{
    const emailDecl = admin.indexOf("const accountEmailRaw = String(user.email || '').trim();");
    const emailUse = admin.indexOf('accountEmailRaw.includes');
    assert.ok(emailDecl > 0 && emailUse > emailDecl, 'account email is declared before lookup reads it');
    assert.equal(admin.split('const accountEmailRaw').length - 1, 1, 'account email is declared once');
}

assert.match(admin, />Community Monitor</);
assert.match(admin, /data-community-held=/, 'held cards have a distinct marker');
assert.match(admin, /border-2 border-dashed border-amber-400/, 'held cards are visually distinct');
assert.match(admin, /mq-approve-community/);
assert.match(admin, /mq-reject-community/);
assert.match(admin, /mq-hide-post/);
assert.match(admin, /mq-shadow-ban/);
assert.match(admin, /cm-options-toggle/, 'message actions sit behind Options');
assert.match(admin, /mq-options-portal/, 'message options open above the composer');
assert.match(admin, /id="mq-plus"/, 'suggestions, attachments, and the https field sit behind plus');
assert.match(admin, /community-bubble-name-row/, 'monitor bubbles use the commuter name row');
assert.match(admin, /fb-version-chip/, 'a monitor bubble can show the version');
assert.doesNotMatch(admin, /\$\{name\} - \$\{choice\}/, 'a monitor bubble does not put the station on the name');
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
assert.match(admin, /_communityRouteUnread\(data, seenAt, Admin\.currentUser\?\.uid\)/, 'the Dev Hub badge uses this admin as the viewer');
assert.match(admin, /ntAdminCommunityOwnActivity\(newest, viewerUid\)/, 'a route is clear when this admin posted last');
assert.match(admin, /await setRouteSeen\(card\.dataset\.communityRoute, Date\.now\(\)\)/, 'a monitor send marks that route seen for this admin');
assert.match(community, /if \(isAdminAuthed\(\)\) markCommunityRouteSeen\(routeId\)/, 'an in-app admin send marks that route seen');
assert.match(admin, /ntAdminCommunityOwnActivity\(preview\.activity, viewerUid\)/, 'a peeked own message does not count as unread');
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
this.may = communityUnreadMayCount;
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
    assert.equal(unread.may('signed-in', { seenLoaded: false }), false, 'a signed-in badge waits for the account seen cursors');
    assert.equal(unread.may('guest', { authSettled: false }), false, 'a restoring session does not count every message as unread');
    assert.equal(unread.may('guest', { authSettled: true }), true, 'a settled guest uses this phone cursor');
    assert.equal(unread.may('signed-in', { seenLoaded: true }), true, 'a loaded account cursor can count');
}
assert.match(community, /UNREAD_AWAY_MS = 20 \* 1000/, 'other tabs check for new community messages about every 20 seconds');
assert.doesNotMatch(community, /UNREAD_AWAY_MS = 3 \* 60 \* 1000/, 'the away unread check is not a 3 minute wait');
assert.match(community, /scheduleUnreadRetry\(\)/, 'a skipped unread count tries again');
assert.doesNotMatch(community, /Date\.now\(\) - unreadPolledAt < 45000/, 'returning to the app does not wait 45 seconds to count');
{
    const paintAt = community.indexOf('function paintUnreadFromCache');
    const paintEnd = community.indexOf('function paintCommunityUnreadBadge');
    const paintSrc = community.slice(paintAt, paintEnd);
    assert.match(paintSrc, /activeTab'\) !== 'community'\) return/, 'an away unread poll does not rebuild the hidden room list');
    assert.ok(
        paintSrc.indexOf('syncCommunityRoutePicker') > paintSrc.indexOf("!== 'community'"),
        'room list sync stays behind the other-tab return'
    );
}
{
    const start = community.indexOf('function mergeUnreadCounts');
    const end = community.indexOf('function communityUnreadPollWait');
    assert.ok(start > 0 && end > start, 'unread merge helper is extractable');
    const merged = {};
    new Function(`${community.slice(start, end).replace(/^export /gm, '')}
this.merge = mergeUnreadCounts;
this.wait = null;
`).call(merged);
    const kept = merged.merge({ a: 2, b: 1 }, ['a', 'b', 'c'], [null, 0, 3], '');
    assert.deepEqual(kept, { a: 2, b: 0, c: 3 }, 'a failed room read keeps its last count and a finished zero clears');
    const viewing = merged.merge({ a: 4 }, ['a'], [4], 'a');
    assert.deepEqual(viewing, { a: 0 }, 'the open room does not stay on the badge');
    const waitStart = community.indexOf('function communityUnreadPollWait');
    const waitEnd = community.indexOf('async function countUnreadOnRoute');
    const waits = {};
    new Function(`${community.slice(waitStart, waitEnd).replace(/^export /gm, '')}
const UNREAD_POLL_MS = 45000;
const UNREAD_AWAY_MS = 20000;
this.wait = communityUnreadPollWait;
`).call(waits);
    assert.equal(waits.wait(false), 20000, 'another tab polls on the short wait');
    assert.equal(waits.wait(true), 45000, 'the open tab can wait longer because the room is live');
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
assert.match(wrangler, /nexttrain-community-images/, 'community photos use their own R2 bucket');
assert.match(worker, /env\.COMMUNITY_IMAGES/, 'community photos use the community R2 binding');
assert.match(worker, /isSafeRtdbKey\(routeId\)/);
assert.match(worker, /isSafeRtdbKey\(postId\)/);
assert.match(admin, /\[`community_activity\/\$\{routeId\}\//, 'admin approval indexes approved messages');

const rootRules = rules.rules;
assert.ok(rootRules.community_deleted, 'a deleted community message is kept off the public post');
assert.match(rootRules.community_deleted['.read'], /enockelk@gmail\.com/);
assert.match(rootRules.community_deleted['.read'], /thandeka05nxumalo@gmail\.com/);
assert.doesNotMatch(rootRules.community_deleted['.read'], /\btrue\b/);
assert.match(worker, /community_deleted\/\$\{routeId\}\/\$\{archiveKey\}/);
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
assert.match(community, /chats with new messages/, 'Community badge counts chats, not messages');
assert.match(community, /paintCommunityQuotaHint/, 'remaining send quota is painted above the composer');
assert.match(community, /uid === prevUid/, 'consecutive community messages from the same person are grouped');
assert.match(community, /community-avatar-spacer/, 'grouped messages keep the avatar column');
assert.match(community, /community-avatar-letter/, 'a community avatar uses the first letter');
assert.match(community, /syncedDisplayName/, 'older messages use the current display name');
assert.match(community, /publishOwnCommunityName/, 'opening Community writes the current display name');
assert.match(communityView, /community-avatar-spacer/, 'Community CSS keeps WhatsApp-style grouped rows');
assert.match(community, /\$\{left\} left/, 'quota hint is a remaining-messages countdown');
assert.match(community, /left > 3/, 'quota hint stays hidden until 3 messages remain');
assert.match(community, /viewing\) cachedUnreadByRoute\[viewing\] = 0/, 'the open room is cleared before a slower unread count returns');
assert.match(community, /ntCommunityRoomV1:/, 'a community room is kept on this phone');
assert.match(community, /readRoomCache\(routeId\)/, 'opening a room paints the saved messages first');
assert.match(community, /function paintCachedRoomNow/, 'a saved room is shown before the live sync');
assert.match(community, /View deleted message/, 'an admin can open a deleted message');
assert.match(communityView, /id="community-deleted-sheet"/, 'the deleted message opens in its own sheet');
assert.match(community, /UNREAD_DIVIDER_MS = 45000/, 'the unread count leaves after 45 seconds');
assert.match(community, /unread messages/, 'the room shows how many messages are unread');
assert.match(community, /data-community-unread-divider/, 'unread messages start under a divider');
assert.match(community, /unreadSpan > height \+ 8/, 'a tall unread block opens on the divider');
assert.match(community, /mode: 'both'/, 'a short unread block opens with the latest messages');
assert.match(community, /mode: 'short'/, 'a room that does not fill the screen stays at the top');
assert.match(community, /function preloadCommunityRoom/, 'the current route is preloaded before Community opens');
assert.match(community, /is-parking/, 'the feed stays hidden until the open position is set');
assert.match(community, /setCommunityRoomLoading\(true\)/, 'a room switch shows the spinner while the feed is parked');
assert.match(community, /This phone doesn't have this line's messages yet/, 'an offline room does not claim it has no posts');
assert.match(community, /!slim\.length && communityIsOffline\(\)\) return/, 'an offline miss does not wipe the saved room');
assert.match(community, /anchor\.placed && !anchor\.taken/, 'an open view stays until the person scrolls or sends');
const logic = await readFile(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
assert.match(logic, /__ntCommunityStablePoll/, 'community unread is checked once after the board is stable');
assert.match(logic, /5000/, 'the stable community check waits about 5 seconds');
assert.match(logic, /preloadCommunityRoom/, 'the stable board preloads the community room');
assert.match(communityView, /is-parking/, 'Community markup hides the feed until it is parked');
assert.match(communityView, /id="community-feed-loading"/, 'the room spinner sits outside the parked feed');
assert.match(communityView, /Opening this room\.\.\./, 'the room spinner uses a short line');
{
    const copyStart = community.indexOf('export function communityEmptyCopy');
    const copyEnd = community.indexOf('function communityEmptyHtml', copyStart);
    const communityEmptyCopy = new Function(`${community.slice(copyStart, copyEnd).replace('export function', 'function')}\nreturn communityEmptyCopy;`)();
    const offlineMiss = communityEmptyCopy({ offline: true, confirmedEmpty: false, loaded: false });
    assert.equal(offlineMiss.title, "You're offline");
    assert.match(offlineMiss.body, /doesn't have this line's messages yet/);
    assert.doesNotMatch(offlineMiss.body, /Be the first/);
    const offlineKnownEmpty = communityEmptyCopy({ offline: true, confirmedEmpty: true, loaded: true });
    assert.match(offlineKnownEmpty.body, /no messages last time you were online/);
    assert.doesNotMatch(offlineKnownEmpty.body, /Be the first/);
    const failed = communityEmptyCopy({ offline: false, confirmedEmpty: false, loaded: false });
    assert.equal(failed.title, "Couldn't load this line");
    assert.doesNotMatch(failed.body, /Be the first/);
    const empty = communityEmptyCopy({ offline: false, confirmedEmpty: false, loaded: true });
    assert.equal(empty.title, 'No posts on this line yet');
    assert.match(empty.body, /Be the first to share a heads-up/);
}
{
    const start = community.indexOf('export function communityOpenTarget');
    const end = community.indexOf('function pinCommunityFeedToLatest', start);
    const communityOpenTarget = new Function(`${community.slice(start, end).replace('export function', 'function')}\nreturn communityOpenTarget;`)();
    const short = communityOpenTarget({ scrollHeight: 400, clientHeight: 700, dividerTop: 0, hasDivider: false, hasRows: true });
    assert.equal(short.mode, 'short');
    assert.equal(short.top, 0);
    const latest = communityOpenTarget({ scrollHeight: 2000, clientHeight: 700, dividerTop: 0, hasDivider: false, hasRows: true });
    assert.equal(latest.mode, 'latest');
    assert.equal(latest.top, 1300);
    const unread = communityOpenTarget({ scrollHeight: 3000, clientHeight: 700, dividerTop: 400, hasDivider: true, hasRows: true });
    assert.equal(unread.mode, 'unread');
    assert.equal(unread.top, 388);
    const both = communityOpenTarget({ scrollHeight: 2000, clientHeight: 700, dividerTop: 1500, hasDivider: true, hasRows: true });
    assert.equal(both.mode, 'both');
    assert.equal(both.top, 1300);
    assert.equal(communityOpenTarget({ scrollHeight: 2000, clientHeight: 0, dividerTop: 0, hasDivider: false, hasRows: true }), null);
}
assert.match(community, /communitySendHoldId/, 'a send stays on screen until the request settles');
assert.match(community, /settleCommunityRoomSeen\(paintedCommunityRouteId\)/, 'leaving the room clears the unread count');
assert.doesNotMatch(community, /markCommunityRouteSeen\(routeId, \{ silent: true \}\)/, 'a live update does not stamp the room seen');
assert.match(community, /paintedCommunityRouteId/, 'only a painted room is treated as open');
assert.match(community, /pendingSend: true/, 'a send appears in the room before the server answers');
assert.match(community, /community-msg-receipt/, 'a sending message shows a clock, then a tick');
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
assert.match(admin, /_mqThreadPushed/, 'opening a monitor route pushes a history entry');
assert.match(ui, /mq-showing-thread/, 'back from a monitor route closes the thread before Dev Mode');
assert.match(community, /bestKnownPoints/, 'an older 0 snapshot uses a higher points total already seen');
assert.match(community, /PRIORITY:/, 'suggest reply marks the held message');
assert.match(community, /community-sheet-suggest/, 'suggest reply is on the hold menu');
assert.match(community, /communityScheduleFact/, 'a community draft can include the timetable fact');
const playAt = communityView.indexOf('id="community-composer-speak"');
const guideAt = communityView.indexOf('id="community-guide-open"');
assert.ok(playAt >= 0 && guideAt > playAt, 'Play sits above Guide');
assert.match(communityView, /id="community-composer-speak"[^>]*aria-label="Play"/, 'the community composer control is labelled Play');
assert.match(communityView, /community-composer-plus/, 'the admin attach control sits inside the composer');
assert.match(community, /AUTHOR_DELETE_MS = 10 \* 60 \* 60 \* 1000/, 'an author can delete their own message for 10 hours');
assert.match(community, /community-sheet-unread/, 'an operator can mark a message unread');
assert.match(community, /unreadHoldRoute/, 'mark unread is not stamped read while that room stays open');
assert.match(community, /dismissCommunitySuggest/, 'the suggestion card closes when the room is left');
assert.match(communityView, /community-suggest-dismiss/, 'the suggestion card has a close control');
assert.match(worker, /\/community\/points-seen/, 'a higher points total can be saved for older messages');
assert.match(worker, /\/admin\/account-name/, 'an admin can read the Google name');
assert.match(admin, /ut-feedback-plus/, 'Feedback None can start a message');
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
