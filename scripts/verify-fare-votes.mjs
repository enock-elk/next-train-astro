/**
 * Fare-vote payload, rounding, and offline queue of 1.
 * Run: node scripts/verify-fare-votes.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildFareVotePayload,
    enqueueFareVoteOffline,
    getFareVoteQueueLength,
    roundFareVoteRand,
    submitFareVote,
    FARE_VOTE_QUEUE_KEY,
} from '../src/lib/planner-telemetry.js';
import { safeStorage } from '../src/lib/utils.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

function resetVotes() {
    safeStorage.setItem(FARE_VOTE_QUEUE_KEY, '[]');
    safeStorage.setItem('nt_fare_vote_sent_v1', '[]');
}

assert(roundFareVoteRand(7.5) === 7, 'R7.50 stores as 7');
assert(roundFareVoteRand(8) === 8, 'whole rand stays whole');
assert(roundFareVoteRand(7.01) === 7, 'just over 7 floors after half-rand ceil');

{
    const yes = buildFareVotePayload({
        origin: 'PRETORIA',
        destination: 'JOHANNESBURG',
        routeIds: ['pta-jhb'],
        km: 12.4,
        crowKm: 10.1,
        zone: 'Z1',
        quotedPrice: 8,
        agree: true,
        isOffPeak: false,
        dayType: 'weekday',
        depTime: '07:30',
        profile: 'Adult',
        region: 'GP',
        deviceId: 'dev1',
        authUid: null,
        at: 1,
    });
    assert(yes.agree === true, 'yes vote is agree');
    assert(yes.quotedPrice === 8 && yes.reportedPrice === 8, 'yes ships quoted price as reported');
    assert(yes.origin === 'PRETORIA' && yes.destination === 'JOHANNESBURG', 'OD is stored');
    assert(Array.isArray(yes.routeIds) && yes.routeIds[0] === 'pta-jhb', 'routeIds array is stored');
}

{
    const no = buildFareVotePayload({
        origin: 'BELLVILLE',
        destination: 'CAPE TOWN',
        quotedPrice: 8,
        reportedPrice: 11,
        agree: false,
        dayType: 'weekday',
        isOffPeak: true,
        profile: 'Adult',
        deviceId: 'dev1',
        at: 1,
    });
    assert(no.agree === false, 'correction vote is not agree');
    assert(no.quotedPrice === 8 && no.reportedPrice === 11, 'no ships entered rand as reported');
}

resetVotes();
enqueueFareVoteOffline({ origin: 'A', destination: 'B', quotedPrice: 8, reportedPrice: 8 });
enqueueFareVoteOffline({ origin: 'C', destination: 'D', quotedPrice: 9, reportedPrice: 12 });
assert(getFareVoteQueueLength() === 1, 'offline queue keeps only one vote');

resetVotes();
const origFetch = globalThis.fetch;
const origNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
let sent = null;
globalThis.fetch = async (_url, opts) => {
    sent = JSON.parse(opts.body);
    return { ok: true };
};
try {
    const yesRes = await submitFareVote({
        origin: 'GERMISTON',
        destination: 'PARK',
        quotedPrice: 8,
        agree: true,
        dayType: 'weekday',
        isOffPeak: false,
        profile: 'Adult',
        deviceId: 'dev-yes',
        at: 2,
    });
    assert(yesRes.ok === true, 'yes submit writes immediately');
    assert(sent && sent.agree === true && sent.reportedPrice === 8 && sent.quotedPrice === 8, 'yes PUT body ships quoted price');

    sent = null;
    const noRes = await submitFareVote({
        origin: 'GERMISTON',
        destination: 'JEPPE',
        quotedPrice: 8,
        reportedPrice: 7.5,
        agree: false,
        dayType: 'weekday',
        isOffPeak: true,
        profile: 'Adult',
        deviceId: 'dev-no',
        at: 3,
    });
    assert(noRes.ok === true, 'no submit writes immediately');
    assert(sent && sent.agree === false && sent.reportedPrice === 7 && sent.quotedPrice === 8, 'no PUT body ships entered rand after board floor');

    resetVotes();
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    const queued = await submitFareVote({
        origin: 'DURBAN',
        destination: 'UMHLANGA',
        quotedPrice: 10,
        agree: true,
        dayType: 'weekday',
        profile: 'Adult',
        deviceId: 'dev-off',
        at: 4,
    });
    assert(queued.queued === true, 'offline submit queues');
    assert(getFareVoteQueueLength() === 1, 'offline queue length is 1 after first vote');
    await submitFareVote({
        origin: 'DURBAN',
        destination: 'UMHLANGA',
        quotedPrice: 10,
        agree: true,
        dayType: 'weekday',
        profile: 'Adult',
        deviceId: 'dev-off',
        at: 5,
    });
    assert(getFareVoteQueueLength() === 1, 'same-trip offline retry still queues one vote');
    await submitFareVote({
        origin: 'DURBAN',
        destination: 'KWA MASHU',
        quotedPrice: 12,
        reportedPrice: 15,
        agree: false,
        dayType: 'weekday',
        profile: 'Adult',
        deviceId: 'dev-off',
        at: 6,
    });
    assert(getFareVoteQueueLength() === 1, 'a later offline vote still leaves a queue of 1');
} finally {
    globalThis.fetch = origFetch;
    if (origNav) Object.defineProperty(globalThis, 'navigator', origNav);
    else delete globalThis.navigator;
}

const ui = readFileSync(join(ROOT, 'src/lib/planner-ui.js'), 'utf8');
assert(ui.includes('Is this what you paid?'), 'fare sheet asks Is this what you paid?');
assert(ui.includes('planner-fare-vote-yes') && ui.includes('planner-fare-vote-no'), 'fare sheet has Yes / No');
assert(ui.includes('planner-fare-vote-send'), 'No path has Send');
assert(ui.includes('roundFareVoteRand'), 'correction uses the board whole-rand floor');
assert(ui.includes('submitFareVote'), 'fare sheet writes votes immediately');
assert(!ui.includes('most people paid'), 'do not show a live consensus fare');

const tel = readFileSync(join(ROOT, 'src/lib/planner-telemetry.js'), 'utf8');
assert(tel.includes('sys_logs/fare_votes'), 'client writes sys_logs/fare_votes');
assert(tel.includes('FARE_VOTE_QUEUE_KEY'), 'offline fare vote queue exists');
assert(tel.includes('slice(-1)'), 'offline fare vote queue is capped at 1');

const modal = readFileSync(join(ROOT, 'src/components/PlannerModals.astro'), 'utf8');
assert(modal.includes('The price algorithm is still being developed and tested, so it may not be accurate.'), 'algorithm note is unchanged');

const rules = readFileSync(join(ROOT, 'firebase-database.rules.json'), 'utf8');
assert(rules.includes('"fare_votes"'), 'rules include fare_votes');
assert(rules.includes('!data.exists()'), 'fare votes are create-once');
assert(rules.includes('thandeka05nxumalo@gmail.com'), 'Thandeka stays on sys_logs read');
assert(!rules.includes('"trains"'), 'do not add a trains tree');

if (failures.length) {
    console.error(`verify-fare-votes: ${failures.length} failed`);
    for (const f of failures) console.error(' -', f);
    process.exit(1);
}
console.log('verify-fare-votes: ok');
