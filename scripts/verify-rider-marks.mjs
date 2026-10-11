import assert from 'node:assert/strict';
import {
    MARK_POINTS,
    MARK_TIERS,
    awardCommunityMarks,
    badgeProgress,
    contributionDetailLines,
    formatContributionDate,
    formatContributionDuration,
    listContributionDays,
    mergeMarksStates,
    showMarksInCommunity,
    marksBubbleLabel,
    medalSvg,
    renderBubbleMarksHtml,
} from '../src/lib/rider-marks.js';

assert.equal(MARK_POINTS.first_share_day, 2);
assert.equal(MARK_POINTS.join_confirm, 1);
assert.equal(MARK_POINTS.delay_report, 2);
assert.equal(MARK_POINTS.delay_confirm, 1);
assert.equal(MARK_POINTS.first_community_post, 5);
assert.equal(MARK_POINTS.community_message, 2);
assert.equal(MARK_POINTS.streak_3day, 5);
assert.equal(MARK_POINTS.streak_5day, 8);
assert.deepEqual(MARK_TIERS.map((t) => t.min), [0, 80, 250, 600]);

const left = {
    points: 10,
    lastShareDay: '2026-09-17',
    shareStreak: 2,
    awarded: { 'share:2026-09-17': true },
    history: [
        { action: 'first_share_day', points: 2, at: 1, key: 'share:2026-09-17' },
        { action: 'first_share_day', points: 2, at: 2, key: 'share:2026-09-17' },
    ],
    updatedAt: 2,
};
const right = {
    points: 12,
    lastShareDay: '2026-09-17',
    shareStreak: 2,
    awarded: { 'share:2026-09-17': true },
    history: [
        { action: 'first_share_day', points: 2, at: 3, key: 'share:2026-09-17' },
        { action: 'delay_report', points: 2, at: 4, key: 'delay_report:2026-09-17' },
    ],
    updatedAt: 4,
};
const merged = mergeMarksStates(left, right);
assert.equal(merged.history.length, 2, 'history compactes duplicate keys');
assert.equal(merged.history.filter((row) => row.key === 'share:2026-09-17').length, 1);
assert.equal(merged.points, 12);

const days = listContributionDays({
    history: [
        { action: 'first_share_day', points: 2, at: Date.parse('2026-09-17T10:00:00'), key: 'share:2026-09-17' },
        { action: 'delay_report', points: 2, at: Date.parse('2026-09-17T11:00:00'), key: 'delay_report:2026-09-17' },
        { action: 'first_share_day', points: 2, at: Date.parse('2026-09-16T10:00:00'), key: 'share:2026-09-16' },
    ],
});
assert.equal(days.length, 2);
assert.equal(days[0].total, 4);
assert.equal(days[0].items.length, 2);
assert.equal(formatContributionDate('2026-10-09'), '09 Oct 2026');
assert.equal(formatContributionDate('2026-09-17'), '17 Sep 2026');
assert.equal(formatContributionDuration({ startedAt: 1_000, endedAt: 1_000 + (34 * 60_000) }), '34 min');
assert.equal(formatContributionDuration({ startedAt: 1_000, endedAt: 1_000 + (72 * 60_000) }), '1 hr 12 min');
assert.equal(formatContributionDuration({ startedAt: 5_000 }), 'Still on this trip');
const shareLines = contributionDetailLines({
    action: 'first_share_day',
    how: 'Share live location on the map while on a train. Points once per service day.',
    detail: {
        trainId: '0618',
        route: 'Germiston - Kempton Park',
        origin: 'Germiston',
        destination: 'Kempton Park',
        startedAt: 1_000,
        endedAt: 1_000 + (34 * 60_000),
    },
});
assert.deepEqual(shareLines, [
    'Train 0618',
    'Route Germiston - Kempton Park',
    '34 min',
    'Germiston - Kempton Park',
]);
assert.equal(shareLines.includes('Share live location'), false, 'trip lines omit the earn blurb');
assert.deepEqual(contributionDetailLines({ action: 'first_share_day', how: 'Share live location' }), []);

const withDetail = mergeMarksStates({
    points: 2,
    awarded: { 'share:2026-10-09': true },
    history: [{
        action: 'first_share_day',
        points: 2,
        at: 1,
        key: 'share:2026-10-09',
        detail: { origin: 'Germiston', trainId: '0618', route: 'Germiston - Kempton Park' },
    }],
    updatedAt: 1,
}, {
    points: 2,
    awarded: { 'share:2026-10-09': true },
    history: [{
        action: 'first_share_day',
        points: 2,
        at: 5,
        key: 'share:2026-10-09',
        detail: { destination: 'Kempton Park', origin: 'Later station', endedAt: 5, startedAt: 1 },
    }],
    updatedAt: 5,
});
const shareRow = withDetail.history.find((row) => row.key === 'share:2026-10-09');
assert.equal(shareRow.detail.origin, 'Germiston', 'later pings keep the first boarding station');
assert.equal(shareRow.detail.destination, 'Kempton Park');
assert.equal(shareRow.detail.trainId, '0618');
assert.equal(shareRow.detail.endedAt, 5);

const awardedDays = listContributionDays({
    history: [
        { action: 'first_share_day', points: 2, at: new Date(2026, 9, 9, 8, 0, 0).getTime(), key: 'share:2026-10-09' },
    ],
    awarded: {
        'share:2026-10-09': true,
        'community:2026-10-09': true,
        'badge:first_community_post': true,
    },
});
const oct9 = awardedDays.find((day) => day.day === '2026-10-09');
assert.ok(oct9, 'share day stays');
assert.equal(oct9.total, 4, 'awarded community points join that day');
assert.equal(oct9.items.length, 2);
assert.ok(oct9.items.some((item) => item.title === 'Community message' && item.points === 2));
assert.ok(oct9.items.some((item) => item.title === 'Share your trip' && item.points === 2));
const badgeDay = awardedDays.find((day) => day.items.some((item) => item.action === 'first_community_post'));
assert.ok(badgeDay, 'a one-time badge still lists when history dropped it');
assert.equal(badgeDay.items[0].points, 5);

const twoOfThree = badgeProgress('streak_3day', { shareStreak: 2, awarded: {} });
assert.equal(twoOfThree.current, 2);
assert.equal(twoOfThree.total, 3);
assert.equal(twoOfThree.ratio, 2 / 3);
assert.equal(twoOfThree.unlocked, false);
assert.equal(showMarksInCommunity(), true, 'Community level is on by default');
assert.equal(marksBubbleLabel({ points: 77 }), '77', 'bubble brag is the point number');
assert(medalSvg('bronze').includes('svg'), 'bronze medal is an SVG');
const bubbleHtml = renderBubbleMarksHtml({ points: 77, tier: 'bronze' });
assert(bubbleHtml.includes('community-bubble-marks'), 'bubble marks wrap the medal and points');
assert(bubbleHtml.indexOf('>77<') < bubbleHtml.indexOf('<svg'), 'points sit before the medal SVG');
assert(!bubbleHtml.includes('Points'), 'bubble marks omit the Points word');
assert(!bubbleHtml.includes('*'), 'bubble marks omit the asterisk');

const firstCommunity = awardCommunityMarks();
assert.equal(firstCommunity.added, 7, 'first community message pays the badge and the daily points');
const sameDay = awardCommunityMarks();
assert.equal(sameDay.added, 0, 'a second community message the same service day does not pay again');

console.log('Rider marks verified: slower curve, history dedupe, day groups, streak fill.');
