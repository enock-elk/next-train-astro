/**
 * GIF loop timing. The player rests after a few loops.
 * Run: node scripts/verify-gif-play.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gifLoopMs, gifRestAfterMs, isGifUrl, GIF_PLAY_LOOPS } from '../src/lib/gif-play.js';

assert.equal(GIF_PLAY_LOOPS, 3);
assert.equal(isGifUrl('https://nexttrain-community.enock.workers.dev/alerts/img_abc.gif'), true);
assert.equal(isGifUrl('https://nexttrain-community.enock.workers.dev/alerts/img_abc.jpg'), false);
assert.equal(isGifUrl('/images/alerts/poster.jpg'), false);
assert.equal(gifLoopMs(new Uint8Array([1, 2, 3])), 0);

const oneFrame = Uint8Array.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x21, 0xf9, 0x04, 0x00, 0x32, 0x00, 0x00, 0x00,
    0x3b,
]);
assert.equal(gifLoopMs(oneFrame), 500, 'a 50cs graphic-control delay is 500ms');
assert.equal(gifRestAfterMs(500), 1800, 'a short loop still stays up long enough to see');
assert.equal(gifRestAfterMs(8000), 20000, 'three long loops stop at the cap');
assert.equal(gifRestAfterMs(0), 7200, 'an unreadable file uses the fallback run');

const alerts = await readFile(new URL('../src/lib/alerts-channel.js', import.meta.url), 'utf8');
const community = await readFile(new URL('../src/lib/community.js', import.meta.url), 'utf8');
const feed = await readFile(new URL('../src/lib/alerts-feed.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
assert.match(alerts, /armGifPlayers\(root\)/, 'alert photos arm GIF playback');
assert.match(community, /armGifPlayers\(listEl\)/, 'community photos arm GIF playback');
assert.match(feed, /data-nt-gif-replay/, 'a replay control does not start a reaction');
assert.match(admin, /window\.armGifPlayers/, 'the alert composer plays a GIF it just added');

console.log('verify-gif-play: ok');
