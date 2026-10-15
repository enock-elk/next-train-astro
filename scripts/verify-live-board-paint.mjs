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
import { realTrainTerminus, sharedDestTag } from '../src/lib/live-board.js';

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

{
    const row = (station, times) => ({ STATION: station, ...times });
    const weekdayIrene = {
        stationColumnName: 'STATION',
        rows: [
            row('PRETORIA', { '0624': '5:10:00', '0626': '6:30:00', '0604': '5:10:00' }),
            row('CENTURION', { '0624': '5:26:00', '0626': '6:46:00', '0604': '5:26:00' }),
            row('IRENE', { '0624': '5:35:00', '0626': '6:55:00', '0604': '5:35:00' }),
        ],
    };
    const weekdayKemp = {
        stationColumnName: 'STATION',
        rows: [
            row('PRETORIA', { '0624': '5:10:00', '0626': '6:30:00', '0604': '5:40:00', '0610': '18:10:00' }),
            row('CENTURION', { '0624': '5:26:00', '0626': '6:46:00', '0604': '5:55:00', '0610': '18:26:00' }),
            row('IRENE', { '0624': '5:35:00', '0626': '6:55:00', '0604': '6:03:00', '0610': '18:35:00' }),
            row('OLIFANTSFONTEIN', { '0604': '6:16:00' }),
            row('KEMPTON PARK', { '0604': '6:40:00' }),
            row('ELANDSFONTEIN', {}),
        ],
    };
    const saturdayKemp = {
        stationColumnName: 'STATION',
        rows: [
            row('PRETORIA', { '0610': '18:10:00' }),
            row('IRENE', { '0610': '18:35:00' }),
            row('KEMPTON PARK', {}),
            row('ELANDSFONTEIN', { '0610': '19:40:00' }),
        ],
    };
    const weekdayToB = [weekdayIrene, weekdayKemp];
    assert(realTrainTerminus('0626', weekdayToB) === 'IRENE', 'weekday 0626 ends at Irene on both sheets');
    assert(realTrainTerminus('0624', weekdayToB) === 'IRENE', 'weekday 0624 ends at Irene');
    assert(realTrainTerminus('0604', weekdayToB) === 'KEMPTON PARK', 'weekday 0604 continues to Kempton Park');
    assert(realTrainTerminus('0626', [weekdayIrene]) === 'IRENE', 'Saturday-style Irene sheet still ends 0626 at Irene');
    assert(realTrainTerminus('0610', [weekdayIrene, saturdayKemp]) === 'ELANDSFONTEIN', 'Saturday 0610 ends at Elandsfontein, not Kempton Park');
    const ireneShort = sharedDestTag('IRENE STATION', 'KEMPTON PARK STATION', 'IRENE');
    assert(ireneShort.isDivergent === false && ireneShort.isShared === false, 'an Irene terminator is not labelled To Kempton Park');
    const through = sharedDestTag('IRENE STATION', 'KEMPTON PARK STATION', 'KEMPTON PARK');
    assert(through.isDivergent === true && through.actualDestName === 'KEMPTON PARK', 'a through train still says To Kempton Park');
    const onKemp = sharedDestTag('KEMPTON PARK STATION', 'IRENE STATION', 'KEMPTON PARK');
    assert(onKemp.isShared === false && onKemp.isDivergent === false, 'a Kempton train is not relabelled To Irene');
    const shortOnKemp = sharedDestTag('KEMPTON PARK STATION', 'IRENE STATION', 'IRENE');
    assert(shortOnKemp.isDivergent === true && shortOnKemp.actualDestName === 'IRENE', '0626 on the Kempton board says To Irene');
    const sameEnd = sharedDestTag('PRETORIA STATION', 'PRETORIA STATION', 'PRETORIA');
    assert(sameEnd.isShared === true && sameEnd.isDivergent === false, 'a shared same-end corridor still says From');
}

if (failures.length) {
    console.error('verify-live-board-paint failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-live-board-paint: ok');
