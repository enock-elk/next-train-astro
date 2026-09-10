import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkContentSafety } from '../src/lib/content-safety.js';
import { sanitizeBody } from '../workers/nexttrain-community/worker.js';

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
    community.indexOf("if (safety.verdict === 'review')", community.indexOf('export async function submitCommunityPost')),
    community.indexOf('const postId = newId', community.indexOf('export async function submitCommunityPost'))
);
const heldReplyBranch = community.slice(
    community.indexOf("if (safety.verdict === 'review')", community.indexOf('export async function submitCommunityReply')),
    community.indexOf("const replyId = newId", community.indexOf('export async function submitCommunityReply'))
);
assert.match(heldPostBranch, /queueAutoModeration/);
assert.doesNotMatch(heldPostBranch, /route_community/);
assert.match(heldReplyBranch, /queueAutoModeration/);
assert.doesNotMatch(heldReplyBranch, /route_community/);
const workerHoldBranch = workerSource.slice(
    workerSource.indexOf('if (heldForReview)'),
    workerSource.indexOf('await rtdbWrite(env, `route_community/', workerSource.indexOf('if (heldForReview)'))
);
assert.match(workerHoldBranch, /moderation_queue\/\$\{reportId\}/);
assert.match(workerHoldBranch, /publish:\s*\{\s*kind:\s*'community_post',\s*routeId,\s*payload\s*\}/);
assert.match(workerHoldBranch, /held:\s*true/);

console.log(`Community safety verified: ${cases.length} language cases, client/worker parity, held publishing paths.`);
