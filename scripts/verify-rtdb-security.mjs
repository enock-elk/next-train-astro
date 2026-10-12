/**
 * RTDB + community worker security gates that must not break commuter writes.
 * Run: node scripts/verify-rtdb-security.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { corsOriginAllowed } from '../workers/nexttrain-community/worker.js';
import { sanitizeCommunityPhotoUrl } from '../src/lib/community-photo.js';

const rulesText = await readFile(new URL('../firebase-database.rules.json', import.meta.url), 'utf8');
const rules = JSON.parse(rulesText).rules;
const worker = await readFile(new URL('../workers/nexttrain-community/worker.js', import.meta.url), 'utf8');
const cache = await readFile(new URL('../workers/nexttrain-cache/worker.js', import.meta.url), 'utf8');
const hub = await readFile(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
const blackbox = await readFile(new URL('../src/lib/blackbox.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
const community = await readFile(new URL('../src/lib/community.js', import.meta.url), 'utf8');

assert.equal(rules['.read'], false);
assert.equal(rules['.write'], false);
assert.match(rules.exclusions['.write'], /thandeka05nxumalo@gmail\.com/);
assert.match(rules.schedules['.write'], /enockelk@gmail\.com/);
assert.match(rules.feedback.$feedbackId['.write'], /auth != null/);
assert.match(rules.feedback.$feedbackId['.validate'], /timestamp/);
assert.match(rules.sys_logs.crashes.$crashId['.write'], /auth != null/);
assert.match(rules.sys_logs.blackbox.$exportId['.write'], /auth != null/);
assert.match(rules.sys_logs.routing_fails.$deadEndId['.write'], /auth != null/);
assert.match(rules.sys_logs.trip_plans.$batchId['.write'], /auth != null/);
assert.match(rules.sys_logs.trip_plan_users.$userId['.write'], /auth != null/);
assert.match(rules.sys_logs.trip_plan_pairs.$pairId['.write'], /auth != null/);
assert.match(rules.sys_logs.fare_votes.$voteId['.write'], /auth != null && !data.exists()/);
assert.match(rules.sys_logs.fare_ticket_photos.$voteId['.write'], /auth != null && !data.exists()/);
assert.match(
    rules.route_community.$routeId.posts.$postId.replyCount['.validate'],
    /newData\.val\(\) === data\.val\(\) \+ 1/,
);
assert.match(rules.delay_reports.$reportId['.validate'], /length <= 280/);
assert.equal(rules.inbox.$deviceId['.read'], true, 'inbox stays readable without a new auth gate so Messages on older shells still load');

const env = {
    ALLOWED_ORIGINS: 'https://lab.nexttrain.co.za,https://nexttrain.co.za,https://enock-elk.github.io',
};
assert.equal(corsOriginAllowed('https://nexttrain.co.za', env), true);
assert.equal(corsOriginAllowed('https://lab.nexttrain.co.za', env), true);
assert.equal(corsOriginAllowed('https://preview.next-train-lab.pages.dev', env), true);
assert.equal(corsOriginAllowed('https://evil.pages.dev', env), false);
assert.equal(corsOriginAllowed('https://attacker.github.io', env), false);
assert.doesNotMatch(worker, /host\.endsWith\('\.pages\.dev'\)/);
assert.doesNotMatch(worker, /host\.endsWith\('\.github\.io'\)/);

assert.equal(
    sanitizeCommunityPhotoUrl('https://lh3.googleusercontent.com/a/photo'),
    'https://lh3.googleusercontent.com/a/photo',
);
assert.equal(sanitizeCommunityPhotoUrl('javascript:alert(1)'), null);
assert.equal(sanitizeCommunityPhotoUrl('https://evil.example/x.png'), null);
assert.equal(sanitizeCommunityPhotoUrl('data:image/svg+xml,<svg>'), null);
assert.match(community, /sanitizeCommunityPhotoUrl/);
assert.match(worker, /sanitizeCommunityPhotoUrl/);

assert.match(hub, /if \(!authToken\) \{\s*throw new Error\('Could not send just now/);
assert.match(blackbox, /rtdbAuthQuery/);
assert.match(ui, /rtdbAuthQuery/);
assert.match(cache, /https:\/\/lab\.nexttrain\.co\.za/);
assert.match(cache, /\.next-train-lab\.pages\.dev/);

console.log('verify-rtdb-security: ok');
