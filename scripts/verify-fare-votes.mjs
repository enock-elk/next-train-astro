/**
 * Fare-vote payload, rounding, and offline queue of 1.
 * Run: node scripts/verify-fare-votes.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyApprovedPlannerFare,
    buildFareVotePayload,
    buildPlannerFareOverrideRecord,
    enqueueFareVoteOffline,
    getFareVoteQueueLength,
    plannerFareOverrideKey,
    roundFareVoteRand,
    setPlannerFareOverridesCache,
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
    assert(yes.km === 12.4 && yes.smoothKm === 12.4, 'smooth km is stored on km and smoothKm');
    assert(yes.crowKm === 10.1 && yes.abKm === 10.1, 'A-B km is stored on crowKm and abKm');
}

{
    const both = buildFareVotePayload({
        origin: 'PRETORIA',
        destination: 'JOHANNESBURG',
        quotedPrice: 8,
        deviceId: 'dev1',
        at: 1,
        km: 1,
        crowKm: 2,
        smoothKm: 9.1,
        abKm: 3.3,
    });
    assert(both.smoothKm === 9.1 && both.km === 9.1, 'explicit smoothKm wins over km');
    assert(both.abKm === 3.3 && both.crowKm === 3.3, 'explicit abKm wins over crowKm');
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
assert(ui.includes('smoothKm: km') && ui.includes('abKm: crowKm'), 'fare sheet sends smooth and A-B km');
assert(ui.includes('getCrowFliesTripKm') && ui.includes('getSmoothTripDistanceKm'), 'fare sheet can fill both distance types');
assert(!ui.includes('most people paid'), 'do not show a live consensus fare');

const tel = readFileSync(join(ROOT, 'src/lib/planner-telemetry.js'), 'utf8');
assert(tel.includes('sys_logs/fare_votes'), 'client writes sys_logs/fare_votes');
assert(tel.includes('smoothKm'), 'fare vote payload includes smoothKm');
assert(tel.includes('abKm'), 'fare vote payload includes abKm');
assert(tel.includes('FARE_VOTE_QUEUE_KEY'), 'offline fare vote queue exists');
assert(tel.includes('slice(-1)'), 'offline fare vote queue is capped at 1');
assert(tel.includes("config/planner_fares"), 'approved prices live at config/planner_fares');
assert(tel.includes('plannerFareOverrideKey'), 'override keys are OD + profile + peak + day');
assert(tel.includes("peakSlot = always ? 'all'"), 'Scholar overrides apply all day');

const modal = readFileSync(join(ROOT, 'src/components/PlannerModals.astro'), 'utf8');
assert(modal.includes('The price algorithm is still being developed and tested, so it may not be accurate.'), 'algorithm note is unchanged');

const rules = readFileSync(join(ROOT, 'firebase-database.rules.json'), 'utf8');
assert(rules.includes('"fare_votes"'), 'rules include fare_votes');
assert(rules.includes('!data.exists()'), 'fare votes are create-once');
assert(rules.includes('"planner_fares"'), 'rules include planner_fares');
assert(rules.includes('thandeka05nxumalo@gmail.com'), 'Thandeka stays on sys_logs read');
assert(!rules.includes('"trains"'), 'do not add a trains tree');

{
    const adultPeak = plannerFareOverrideKey({
        origin: 'PRETORIA',
        destination: 'PIENAARSPOORT',
        profile: 'Adult',
        isOffPeak: false,
        dayType: 'weekday',
    });
    assert(adultPeak === 'PRETORIA__PIENAARSPOORT__ADULT__peak__weekday', `Adult peak key, got ${adultPeak}`);
    const scholar = plannerFareOverrideKey({
        origin: 'PRETORIA',
        destination: 'PIENAARSPOORT',
        profile: 'Scholar',
        isOffPeak: false,
        dayType: 'weekday',
    });
    assert(scholar === 'PRETORIA__PIENAARSPOORT__SCHOLAR__all__weekday', `Scholar all-day key, got ${scholar}`);
    const record = buildPlannerFareOverrideRecord({
        origin: 'PRETORIA',
        destination: 'PIENAARSPOORT',
        profile: 'Adult',
        isOffPeak: false,
        dayType: 'weekday',
        reportedPrice: 10,
        quotedPrice: 12,
        id: 'vote1',
    }, { approvedBy: 'enockelk@gmail.com', at: 42 });
    assert(record.price === 10 && record.approvedAt === 42 && record.origin === 'PRETORIA', 'override record ships reported rand');
    setPlannerFareOverridesCache({ [adultPeak]: record });
    const applied = applyApprovedPlannerFare(
        { price: 12, priceLabel: '12', rawPriceLabel: '12', profile: 'Adult', isOffPeak: false, dayType: 'weekday' },
        { from: 'PRETORIA', to: 'PIENAARSPOORT' },
    );
    assert(applied.price === 10 && applied.priceLabel === '10' && applied.approved === true, `approved fare replaces quoted, got ${JSON.stringify(applied)}`);
    const miss = applyApprovedPlannerFare(
        { price: 12, priceLabel: '12', profile: 'Adult', isOffPeak: true, dayType: 'weekday' },
        { from: 'PRETORIA', to: 'PIENAARSPOORT' },
    );
    assert(miss.price === 12 && !miss.approved, 'off-peak Adult is a different override key');
}

if (failures.length) {
    console.error(`verify-fare-votes: ${failures.length} failed`);
    for (const f of failures) console.error(' -', f);
    process.exit(1);
}
console.log('verify-fare-votes: ok');
