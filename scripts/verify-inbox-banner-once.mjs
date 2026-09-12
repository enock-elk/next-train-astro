/**
 * Per-reply inbox banner acknowledgement regression checks.
 * Run: node scripts/verify-inbox-banner-once.mjs
 */
import { readFileSync } from 'node:fs';
import {
    addInboxReplyAcks,
    inboxReplyAckToken,
    inboxReplyIdentity,
    inboxReplyStillVisible,
    parseInboxReplyAcks,
} from '../src/lib/inbox-replies.js';
import { isProtectedVolatileKey } from '../src/lib/utils.js';

const failures = [];
function assert(condition, message) {
    if (!condition) failures.push(message);
}

const now = 1_800_000_000_000;
const first = { message: 'Your train report was received.', timestamp: now - 1000, read: false, from: 'admin' };
const second = { ...first };
const deviceId = 'device-123';
const firstToken = inboxReplyAckToken(deviceId, first, 'reply-a');
const secondToken = inboxReplyAckToken(deviceId, second, 'reply-b');

assert(firstToken !== secondToken, 'Firebase reply keys distinguish identical reply payloads');
assert(inboxReplyStillVisible(first, now), 'a genuinely new unread reply is banner-visible');

const packed = addInboxReplyAcks('', [firstToken]);
const acknowledgements = parseInboxReplyAcks(packed);
assert(
    !inboxReplyStillVisible(first, now, acknowledgements.has(firstToken)),
    'a locally acknowledged reply stays hidden when its Firebase PATCH failed'
);
assert(
    inboxReplyStillVisible(second, now, acknowledgements.has(secondToken)),
    'a distinct new reply remains visible and can retain its unread badge'
);

const legacyA = inboxReplyIdentity(first);
const legacyB = inboxReplyIdentity({ from: 'admin', read: false, timestamp: now - 1000, message: 'Your train report was received.' });
const legacyChanged = inboxReplyIdentity({ ...first, timestamp: now });
assert(legacyA === legacyB, 'legacy replies without IDs receive a stable content identity');
assert(legacyA !== legacyChanged, 'distinct legacy replies receive distinct fallback identities');

const repacked = addInboxReplyAcks(packed, [secondToken, firstToken]);
assert(parseInboxReplyAcks(repacked).size === 2, 'acknowledgements are deduplicated without dropping earlier replies');
assert(parseInboxReplyAcks('{bad json').size === 0, 'corrupt acknowledgement storage fails safely');
assert(isProtectedVolatileKey('ntInboxAcknowledgedV1'), 'app reset preserves per-reply acknowledgements');

const hub = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
const immediateAck = hub.indexOf('rememberAcknowledgedInboxReplies([replyToAcknowledge]');
const threadFetch = hub.indexOf('const list = await fetchInboxThread()', immediateAck);
const remotePatch = hub.indexOf("method: 'PATCH'", threadFetch);
assert(immediateAck >= 0 && immediateAck < threadFetch, 'banner reply is acknowledged locally before thread fetch');
assert(threadFetch >= 0 && threadFetch < remotePatch, 'fetched unread replies are handled before Firebase acknowledgement PATCH');
assert(hub.includes('openMessagesThread(adminReply)'), 'banner passes the exact reply identity into the thread');
assert(hub.includes('openMessagesThread(replyToAcknowledge = latestPendingAdminReply)'), 'Messages acknowledges the latest known reply immediately');
assert(hub.includes('localAcknowledgements.has(inboxReplyAckToken'), 'banner filtering consults per-reply local acknowledgements');

if (failures.length) {
    console.error('verify-inbox-banner-once failed:');
    failures.forEach((failure) => console.error(' -', failure));
    process.exit(1);
}

console.log('verify-inbox-banner-once: ok');
