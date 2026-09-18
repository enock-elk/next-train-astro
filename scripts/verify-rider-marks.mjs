import assert from 'node:assert/strict';
import {
    MARK_POINTS,
    MARK_TIERS,
    badgeProgress,
    listContributionDays,
    mergeMarksStates,
    showMarksInCommunity,
} from '../src/lib/rider-marks.js';

assert.equal(MARK_POINTS.first_share_day, 2);
assert.equal(MARK_POINTS.join_confirm, 1);
assert.equal(MARK_POINTS.delay_report, 2);
assert.equal(MARK_POINTS.delay_confirm, 1);
assert.equal(MARK_POINTS.first_community_post, 5);
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

const twoOfThree = badgeProgress('streak_3day', { shareStreak: 2, awarded: {} });
assert.equal(twoOfThree.current, 2);
assert.equal(twoOfThree.total, 3);
assert.equal(twoOfThree.ratio, 2 / 3);
assert.equal(twoOfThree.unlocked, false);
assert.equal(showMarksInCommunity(), true, 'Community level is on by default');

console.log('Rider marks verified: slower curve, history dedupe, day groups, streak fill.');
