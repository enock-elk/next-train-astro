/**
 * Quiet live-board paint helpers (minute tick without remount).
 * Run: node scripts/verify-live-board-paint.mjs
 */
import {
    liveBoardJourneyKey,
    liveBoardJourneyIdentity,
    liveBoardNextAvailKey,
    boardPaintIdentity,
    normalizeCountdownLabel,
    tryPatchLiveBoardCountdown,
} from '../src/lib/live-board-paint.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

{
    const key = liveBoardJourneyKey({
        type: 'direct',
        train: '0618',
        departureTime: '06:18:00',
        isFirstTrain: true,
        isLastTrain: false,
    }, 'PRETORIA');
    assert(key === 'direct|0618|06:18:00|PRETORIA|1|0', `journey key ${key}`);
    assert(liveBoardJourneyIdentity({
        type: 'direct',
        train: '0618',
        departureTime: '06:18:00',
        isFirstTrain: true,
        isLastTrain: false,
    }, 'PRETORIA') === 'direct|0618|06:18:00|PRETORIA', 'identity drops first/last');
    assert(boardPaintIdentity(key) === 'direct|0618|06:18:00|PRETORIA', 'paint identity ignores first/last');
    const next = liveBoardNextAvailKey('KEMPTON PARK', '05:10:00', 1);
    assert(next === 'nextavail|KEMPTON PARK|05:10:00|1', `nextavail key ${next}`);
}

{
    assert(normalizeCountdownLabel('(in 1h 5m)') === '(in 1 hr 5 min)', 'hour label');
    assert(normalizeCountdownLabel('(in 12m)') === '(in 12 min)', 'minute label');
}

{
    const el = {
        attrs: { 'data-nt-board-key': 'direct|0618|06:18:00|PRETORIA|1|0' },
        getAttribute(name) { return this.attrs[name] || null; },
        querySelector() { return this.node; },
        node: { textContent: '(in 4 min)' },
    };
    assert(!tryPatchLiveBoardCountdown(el, el.attrs['data-nt-board-key'], '(in 3 min)'), 'no patch unless quiet flag');
    globalThis.window = { __ntQuietBoardPaint: true };
    assert(tryPatchLiveBoardCountdown(el, el.attrs['data-nt-board-key'], '(in 3 min)'), 'quiet same-key patches');
    assert(el.node.textContent === '(in 3 min)', 'countdown text updated');
    assert(tryPatchLiveBoardCountdown(el, 'direct|0618|06:18:00|PRETORIA|0|1', '(in 2 min)'), 'first/last flip still patches');
    assert(el.node.textContent === '(in 2 min)', 'identity match updates countdown');
    assert(!tryPatchLiveBoardCountdown(el, 'direct|0619|06:19:00|PRETORIA|1|0', '(in 9 min)'), 'different train remounts');
    delete globalThis.window;
}

if (failures.length) {
    console.error('verify-live-board-paint failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-live-board-paint: ok');
