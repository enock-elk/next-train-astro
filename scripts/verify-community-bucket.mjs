/**
 * Community room depth, deletes, and operator attachments.
 * Run: node scripts/verify-community-bucket.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    COMMUNITY_BUCKET_DEPTH,
    COMMUNITY_ADMIN_IMAGE_MAX,
    DELETED_BY_ADMIN,
    DELETED_MESSAGE,
    communityIdsPastBucket,
    communityTombstonePatch,
    isCommunityTombstone,
    sanitizeCommunityAttachments,
    sanitizeCommunityLinkUrl,
} from '../src/lib/community-policy.js';
import { sanitizeAdminBody, sanitizeBody } from '../workers/nexttrain-community/worker.js';
import { ALERT_POSTER_MAX, collectNoticeImageUrls, layoutAlertPost } from '../src/lib/alerts-feed.js';

assert.equal(COMMUNITY_BUCKET_DEPTH, 80);
assert.equal(ALERT_POSTER_MAX, 10);
assert.equal(COMMUNITY_ADMIN_IMAGE_MAX, 4);

const entries = Array.from({ length: 85 }, (_, i) => ({ id: `m${String(i).padStart(2, '0')}`, timestamp: 1000 + i }));
const evicted = communityIdsPastBucket(entries);
assert.deepEqual(evicted, ['m00', 'm01', 'm02', 'm03', 'm04']);
assert.equal(communityIdsPastBucket(entries.slice(0, 80)).length, 0);

const quote = { postId: 'm00', displayName: 'Katlego L', body: 'trains are running' };
const patch = communityTombstonePatch('author', 5);
assert.equal(patch.body, DELETED_MESSAGE);
assert.equal(patch.deletedBy, 'author');
assert.equal(patch.replyTo, null);
assert.equal(patch.attachments, null);
assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'quotes'));
assert.equal(quote.body, 'trains are running', 'a quote copied earlier is not rewritten by the tombstone patch');

const adminPatch = communityTombstonePatch('admin', 5);
assert.equal(adminPatch.body, DELETED_BY_ADMIN);
assert.equal(isCommunityTombstone({ deleted: true, body: 'old' }), true);
assert.equal(isCommunityTombstone({ body: 'still here' }), false);

assert.deepEqual(
    sanitizeCommunityAttachments(['https://i.imgur.com/abcdEFG.png', 'https://evil.example/x.html'], { admin: true }).length,
    1,
);
assert.equal(sanitizeCommunityAttachments(['https://i.imgur.com/abcdEFG.png'], { admin: false }).length, 0);
assert.equal(sanitizeCommunityAttachments(['/images/alerts/fare.png'], { admin: true })[0], '/images/alerts/fare.png');
assert.equal(sanitizeCommunityLinkUrl('https://nexttrain.co.za/help'), 'https://nexttrain.co.za/help');
assert.equal(sanitizeCommunityLinkUrl('http://nexttrain.co.za/help'), '');

assert.equal(sanitizeBody('https://chat.whatsapp.com/abc').verdict, 'block');
assert.equal(sanitizeAdminBody('See https://www.prasa.com/ today').verdict, 'allow');
assert.ok(sanitizeAdminBody('See https://www.prasa.com/ today').text.includes('https://www.prasa.com/'));
assert.equal(sanitizeAdminBody('fuck').verdict, 'block');

const laid = layoutAlertPost({
    imageUrls: Array.from({ length: 12 }, (_, i) => `/images/alerts/p${i}.png`),
});
assert.equal(laid.imageUrls.length, 10);
assert.equal(collectNoticeImageUrls({ imageUrls: laid.imageUrls }).length, 10);

const community = await readFile(new URL('../src/lib/community.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../workers/nexttrain-community/worker.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
const logic = await readFile(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
const rules = await readFile(new URL('../firebase-database.rules.json', import.meta.url), 'utf8');

assert.match(community, /COMMUNITY_BUCKET_DEPTH/);
assert.doesNotMatch(community, /POST_TTL_MS/);
assert.match(community, /replyTo\.body/);
assert.match(community, /data-delete-as="author"/);
assert.match(community, /data-delete-mode="purge"/);
assert.match(community, /Deleted by an Admin/);
assert.match(community, /community-suggest-btn/);
assert.match(community, /\/community\/message/);
assert.match(worker, /trimRouteBuckets/);
assert.match(worker, /Community Monitor keeps the full log/);
assert.doesNotMatch(worker, /Community bucket trim failed/);
assert.match(worker, /shallow: 'true'/);
assert.doesNotMatch(worker, /wipeStalePosts/);
assert.match(worker, /pathname === '\/community\/message'/);
assert.match(worker, /mode === 'purge'/);
assert.match(admin, /Maximum 10 posters/);
assert.match(admin, /data-mode="tombstone"/);
assert.match(admin, /tombstoneCommunityMessage/);
assert.match(logic, /tab === 'map' \|\| tab === 'options'/);
assert.match(logic, /community-feed-scroll/);
assert.match(logic, /pullRefreshBlocked/);
assert.doesNotMatch(logic, /scroller\.prepend\(hint\)/);
assert.match(rules, /length <= 1000/);
assert.match(rules, /!newData\.hasChild\('attachments'\)/);

console.log('verify-community-bucket: ok');
