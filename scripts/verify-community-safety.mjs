import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { checkContentSafety } from '../src/lib/content-safety.js';
import { routeBlockedByCommunity } from '../src/lib/features.js';
import { sanitizeBody, hasFirebaseAdminEnv, communityPublicPointsNext } from '../workers/nexttrain-community/worker.js';

const cases = [
    // English.
    ['fuck', 'block'],
    ['f.u.c.k', 'block'],
    ['f u c k', 'block'],
    ['fuuuck', 'block'],
    ['sh1t', 'block'],
    ['kill yourself', 'block'],
    ['I’ll kill you', 'block'],
    ['suck-my-dick', 'block'],
    ['retard', 'block'],
    ['fag', 'block'],
    // Afrikaans and South African slang.
    ['jou ma se poes', 'block'],
    ['jou-ma-se-p0es', 'block'],
    ['jou ma se póés', 'block'],
    ['fok jou', 'block'],
    ['ek sal jou doodmaak', 'block'],
    ['kaffer', 'block'],
    ['kaffir', 'block'],
    ['moffie', 'block'],
    ['varkpoes', 'block'],
    ['jou fokken poesneus', 'block'],
    ['jou ma se stink poes', 'block'],
    ['loop naai jou ma', 'block'],
    ['gaan fok jouself', 'block'],
    // isiZulu.
    ['hamba uyofa', 'block'],
    ['ngizokubulala', 'block'],
    ['unondindwa', 'block'],
    // Sesotho.
    ['ke   tla-o-bolaya', 'block'],
    ['tsamaya o shwe', 'block'],
    ['letekatse', 'block'],
    // Mild or ambiguous language is held.
    ['That was stupid', 'review'],
    ['voetsek', 'review'],
    ['v0et-sek', 'review'],
    ['uyisilima', 'review'],
    ['leqai', 'review'],
    ['bolaya', 'review'],
    ['domkop', 'review'],
    ['vol kak', 'review'],
    // Generic components and innocent substrings are allowed.
    ['your train is here', 'allow'],
    ['jou trein is laat', 'allow'],
    ['ma is by die stasie', 'allow'],
    ['my higher platform', 'allow'],
    ['die hoër platform', 'allow'],
    ['classic train service', 'allow'],
    ['the shift starts now', 'allow'],
    ['visit nexttrain.co.za/help', 'allow'],
    ['visit www.nexttrain .co.za/help', 'allow'],
    ['join me at Pretoria', 'allow'],
    ['platform 2 is packed', 'allow'],
    ['salary late this month', 'allow'],
    ['trust the process, the 0618 will come', 'allow'],
    ['weed on the tracks near Mears', 'allow'],
    ['the lights have no electricity', 'allow'],
    ['I need to invest time waiting', 'allow'],
    ['chat . whatsapp . com/LNhd6dQTXXE5b2hI2xa9rE', 'block'],
    ['https://chat.whatsapp.com/LNhd6dQTXXE5b2hI2xa9rE', 'block'],
    ['BITCOIN INVESTMENT / MINING !!! The biggest secret of earning without labour, 100% legit and safe. Stay at home and invest with us. Your monthly salary won\'t make you Rich, join, trust the process invest your money here', 'block'],
    ['INVEST $200 GET $2,000 forex trading', 'block'],
    ['prepaid electricity units for sale', 'block'],
    ['selling dagga at Koedoespoort', 'block'],
    ['nyaope cheap', 'block'],
    ['tik for sale tonight', 'block'],
];

for (const [text, expected] of cases) {
    const client = checkContentSafety(text).verdict;
    const workerResult = sanitizeBody(text);
    const worker = workerResult.ok ? 'allow' : workerResult.verdict;
    assert.equal(client, expected, `client verdict for ${JSON.stringify(text)}`);
    assert.equal(worker, expected, `worker verdict for ${JSON.stringify(text)}`);
    assert.equal(worker, client, `worker/client parity for ${JSON.stringify(text)}`);
}

const admin = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const community = await readFile(new URL('../src/lib/community.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../workers/nexttrain-community/worker.js', import.meta.url), 'utf8');

assert.match(admin, /Admin\.approveHeldCommunity\s*=\s*async/);
assert.match(admin, /Admin\.rejectHeldCommunity\s*=\s*async/);
assert.match(admin, /\[kind === 'community_post' \? routePath : `\$\{routePath\}\/replies\/\$\{replyId\}`\]: payload/, 'approval writes the validated payload unchanged');
assert.match(admin, /community_activity\/\$\{routeId\}/);
assert.match(admin, /moderation_queue\/\$\{reportId\}/);
assert.match(admin, /method:\s*'PATCH'/);
assert.match(admin, /status:\s*'approved'/);
assert.match(admin, /status:\s*'rejected'[\s\S]{0,80}resolution:\s*'rejected'/);
assert.match(admin, /Admin\.approveHeldFeedback\s*=\s*async/, 'feedback approval remains available');

const heldPostBranch = community.slice(
    community.indexOf("safety.verdict === 'review'", community.indexOf('export async function submitCommunityPost')),
    community.indexOf('const postId = options.postId || newId', community.indexOf('export async function submitCommunityPost'))
);
const heldReplyBranch = community.slice(
    community.indexOf("safety.verdict === 'review'", community.indexOf('export async function submitCommunityReply')),
    community.indexOf("const replyId = newId", community.indexOf('export async function submitCommunityReply'))
);
assert.match(heldPostBranch, /queueAutoModeration/);
assert.doesNotMatch(heldPostBranch, /route_community/);
assert.match(heldReplyBranch, /queueAutoModeration/);
assert.doesNotMatch(heldReplyBranch, /route_community/);
const workerHoldBranch = workerSource.slice(
    workerSource.indexOf('if (heldForReview)'),
    workerSource.indexOf('const activity =', workerSource.indexOf('if (heldForReview)'))
);
assert.match(workerHoldBranch, /moderation_queue\/\$\{reportId\}/);
assert.match(workerHoldBranch, /publish:\s*\{\s*kind:\s*'community_post',\s*routeId,\s*payload\s*\}/);
assert.match(workerHoldBranch, /held:\s*true/);
assert.match(workerHoldBranch, /rtdbWritePreferred/);
assert.equal(hasFirebaseAdminEnv({
    FIREBASE_CLIENT_EMAIL: 'a@b',
    FIREBASE_PRIVATE_KEY: 'k',
    FIREBASE_DATABASE_URL: 'https://example.firebaseio.com',
}), true, 'admin env is complete when email, key, and URL are set');
assert.equal(hasFirebaseAdminEnv({
    FIREBASE_CLIENT_EMAIL: 'a@b',
    FIREBASE_DATABASE_URL: 'https://example.firebaseio.com',
}), false, 'admin env is incomplete without the private key');
assert.match(workerSource, /rtdbWriteWithUserToken/, 'posts can use the signed-in ID token when Admin is unset');
assert.match(community, /shouldFallbackCommunityWrite/, 'client falls back to a direct RTDB write if the worker Admin env is incomplete');

const handlePostSrc = workerSource.slice(
    workerSource.indexOf('async function handlePost'),
    workerSource.indexOf('async function trimRouteBuckets')
);
assert.match(handlePostSrc, /ADMIN_EMAILS\.has\(String\(user\.email/, 'worker post cooldown checks ADMIN_EMAILS');
assert.match(handlePostSrc, /isAdminPoster/, 'admins skip the community post cooldown');
assert.match(workerSource, /thandeka05nxumalo@gmail\.com/, 'Thandeka stays on the worker admin allowlist');
assert.match(workerSource, /enockelk@gmail\.com/, 'Enock stays on the worker admin allowlist');
assert.match(community, /const operator = isAdminAuthed\(\)/, 'client cooldown knows the signed-in operator');
assert.match(community, /if \(!operator\) \{[\s\S]{0,180}checkCommunityRateLimit\(\)/, 'client cooldown skips signed-in operators');
assert.match(community, /awardCommunityMarks\(/, 'a published community message awards points');
assert.match(workerSource, /sanitizeCommunityPhotoUrl/, 'worker allowlists community avatar URLs');
assert.match(workerSource, /next-train-lab\.pages\.dev/, 'worker CORS is limited to Next Train lab previews');
assert.doesNotMatch(workerSource, /host\.endsWith\('\.pages\.dev'\)/, 'worker CORS does not allow every pages.dev host');
assert.match(community, /community-sheet-delete/, 'a message can be deleted from the community tab');
assert.match(community, /askCommunityDelete\(/, 'author and admin deletes ask before they remove a message');
assert.match(community, /title: 'Delete this message\?'/, 'a passenger delete asks before it changes the bubble');
assert.match(community, /title: 'Deleted by an Admin\?'/, 'an admin tombstone asks first');
assert.match(community, /title: 'Remove this message\?'/, 'an admin remove asks first');
assert.match(community, /id="community-delete-modal"|community-delete-modal/, 'delete confirmation is an in-app dialog');
assert.doesNotMatch(community, /window\.confirm\([^)]*\) : true/, 'a missing confirm does not delete');
assert.match(community, /navigator\.share\(\{ url \}\)/, 'community share sends the link alone');
assert.doesNotMatch(community, /text: text \|\| shareTitle/, 'community share does not attach the message');
assert.match(community, /communityInlineControl\(e\.target\)/, 'a share chip touch does not press the whole message');
assert.match(readFileSync(new URL('../src/components/CommunityView.astro', import.meta.url), 'utf8'), /data-delete-as="author"/, 'the poster can delete their own message');
assert.match(community, /as === 'author'[\s\S]{0,280}if \(!ownMessage\) return/, 'a rider can delete only their own message');
assert.match(community, /Remove completely/, 'an operator can still remove a message with no bubble left');
assert.match(admin, /ntAdminDeletePublishedCommunityMessage/, 'community tab delete uses the same RTDB delete as Community Monitor');
assert.match(handlePostSrc, /applyCommunityPublicPoints/, 'an accepted post writes the public points total');
assert.match(workerSource, /pathname === '\/community\/points'/, 'replies can ask for the same public points write');
assert.match(community, /publishAcceptedCommunityPoints/, 'a direct write still asks the worker for the public total');
assert.match(community, /authorColorKey\(replyTo\.uid/, 'a quote uses the same person colour as that person\'s bubble');
assert.doesNotMatch(community.slice(community.indexOf('const payload = {'), community.indexOf('const banned = await isShadowBanned')), /marks:/, 'a new post does not freeze the pre-award total');

const first = communityPublicPointsNext(null, { eventId: 'cp_1', snapshotPoints: 0, dayKey: '2026-11-10' });
assert.equal(first.points, 7, 'the first accepted message is 5 plus the daily 2');
assert.equal(first.tier, 'bronze');
const retry = communityPublicPointsNext({ ...first, points: 7, lastCommunityPostId: 'cp_1' }, { eventId: 'cp_1', snapshotPoints: 0, dayKey: '2026-11-10' });
assert.equal(retry.changed, false, 'the same accepted message does not add twice');
const already = communityPublicPointsNext({ points: 9 }, { eventId: 'cp_2', snapshotPoints: 0, dayKey: '2026-11-10' });
assert.equal(already.points, 9, 'a higher total already on the profile is kept');
const later = communityPublicPointsNext(
    { points: 7, communityFirst: true, communityDay: '2026-11-10', lastCommunityPostId: 'cp_1' },
    { eventId: 'cp_3', snapshotPoints: 7, dayKey: '2026-11-10' }
);
assert.equal(later.points, 7, 'a second message on the same day adds nothing');
const nextDay = communityPublicPointsNext(
    { points: 7, communityFirst: true, communityDay: '2026-11-10', lastCommunityPostId: 'cp_1' },
    { eventId: 'cp_4', snapshotPoints: 7, dayKey: '2026-11-11' }
);
assert.equal(nextDay.points, 9, 'the next day adds 2');

const communityJs = readFileSync(new URL('../src/lib/community.js', import.meta.url), 'utf8');
const communityView = readFileSync(new URL('../src/components/CommunityView.astro', import.meta.url), 'utf8');
assert.match(communityJs, /community-reaction-who/, 'a reaction pill opens who reacted');
assert.match(communityJs, /data-community-react-list/, 'community reactions list the people');
assert.match(communityJs, /renderAvatarHtml\(reactorPhoto/, 'each reaction row shows an avatar');
assert.match(readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8'), /community-reactions-modal/, 'the community reactions sheet closes like the fare sheet');
assert.doesNotMatch(readFileSync(new URL('../src/lib/alerts-channel.js', import.meta.url), 'utf8'), /data-community-react-list/, 'alert reactions do not reuse the community people list');
assert.match(readFileSync(new URL('../src/lib/alerts-channel.js', import.meta.url), 'utf8'), /data-alert-react-people/, 'admins can see who reacted on an alert');
assert.match(readFileSync(new URL('../src/lib/alerts-channel.js', import.meta.url), 'utf8'), /if \(isAdminAuthed\(\)\) void paintAlertReactionPeople/, 'only an admin session loads alert reactors');
assert.match(communityJs, /community-select-share/, 'a selected message can be shared from the header');
assert.match(communityJs, /queueCommunityFocus/, 'a community link can open that post');
assert.match(communityView, /id="community-select-report"/, 'report sits on the community header');
assert.match(communityView, /id="community-select-delete"/, 'delete sits on the community header');
assert.match(communityView, /id="community-select-menu-btn"[^>]*\bhidden\b/, 'the community menu starts hidden');
assert.match(communityJs, /ownMessage/, 'a rider cannot report their own message');
assert.doesNotMatch(communityJs, /item\('community-sheet-report'/, 'report is not a menu row');
assert.doesNotMatch(communityJs, /data-reaction-scrim/, 'the reaction tray does not dim the screen');
assert.match(communityView, /M8\.59 13\.51l6\.83 3\.98/, 'community share uses the Share App icon');
assert.match(readFileSync(new URL('../src/components/AlertsChannel.astro', import.meta.url), 'utf8'), /M8\.59 13\.51l6\.83 3\.98/, 'alerts share uses the Share App icon');
assert.match(readFileSync(new URL('../src/lib/features.js', import.meta.url), 'utf8'), /blockedRegionIds/, 'Community can be blocked for one region');
const gp = { id: 'pta-kempton', region: 'GP' };
const kzn = { id: 'kzn-catoridge', region: 'KZN' };
assert.equal(routeBlockedByCommunity(null, gp), false, 'a missing Community config leaves the room open');
assert.equal(routeBlockedByCommunity({ enabled: false, routeIds: ['pta-kempton'] }, gp), false, 'the old pilot-off config does not block a room');
assert.equal(routeBlockedByCommunity({ killed: true }, gp), true, 'the global switch blocks every room');
assert.equal(routeBlockedByCommunity({ blockedRegionIds: ['KZN'] }, kzn), true, 'a blocked region closes its rooms');
assert.equal(routeBlockedByCommunity({ blockedRegionIds: ['KZN'] }, gp), false, 'a blocked region leaves the other regions open');
assert.equal(routeBlockedByCommunity({ blockedRouteIds: ['pta-kempton'] }, gp), true, 'a blocked route closes that room');
assert.equal(routeBlockedByCommunity({ blockedRouteIds: ['pta-kempton'] }, { id: 'pta-pien', region: 'GP' }), false, 'a blocked route leaves the rest of the region open');

console.log(`Community safety verified: ${cases.length} language cases, client/worker parity, held publishing paths.`);
