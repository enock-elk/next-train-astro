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
import {
    realTrainTerminus,
    sharedDestTag,
    boardDirectionState,
    sheetsReadyForBoard,
    findNextTrains,
    currentScheduleData,
} from '../src/lib/live-board.js';
import { $currentRouteId, $schedules, $userRegion, $fullDatabase, $globalStationIndex } from '../src/store.js';
import { processAndRenderJourney } from '../src/lib/live-board-ui.js';

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
    }, 'PRETORIA', 'CENTURION');
    assert(key === 'direct|0618|06:18:00|PRETORIA|CENTURION|1|0', `journey key ${key}`);
    assert(liveBoardJourneyIdentity({
        type: 'direct',
        train: '0618',
        departureTime: '06:18:00',
        isFirstTrain: true,
        isLastTrain: false,
    }, 'PRETORIA', 'CENTURION') === 'direct|0618|06:18:00|PRETORIA|CENTURION', 'identity keeps the origin station');
    assert(boardPaintIdentity(key) === 'direct|0618|06:18:00|PRETORIA|CENTURION', 'paint identity ignores first/last and keeps origin');
    const otherStop = liveBoardJourneyKey({
        type: 'direct',
        train: '0618',
        departureTime: '06:18:00',
    }, 'PRETORIA', 'SPORTPARK');
    assert(boardPaintIdentity(key) !== boardPaintIdentity(otherStop), 'a different origin is a different train card');
    const next = liveBoardNextAvailKey('KEMPTON PARK', '05:10:00', 1);
    assert(next === 'nextavail|KEMPTON PARK|05:10:00|1', `nextavail key ${next}`);
}

{
    assert(normalizeCountdownLabel('(in 1h 5m)') === '(in 1 hr 5 min)', 'hour label');
    assert(normalizeCountdownLabel('(in 12m)') === '(in 12 min)', 'minute label');
}

{
    const same = 'direct|0618|06:18:00|PRETORIA|CENTURION|1|0';
    const el = {
        attrs: { 'data-nt-board-key': same },
        getAttribute(name) { return this.attrs[name] || null; },
        querySelector() { return this.node; },
        node: { textContent: '(in 4 min)' },
    };
    assert(!tryPatchLiveBoardCountdown(el, el.attrs['data-nt-board-key'], '(in 3 min)'), 'no patch unless quiet flag');
    globalThis.window = { __ntQuietBoardPaint: true };
    assert(tryPatchLiveBoardCountdown(el, el.attrs['data-nt-board-key'], '(in 3 min)'), 'quiet same-key patches');
    assert(el.node.textContent === '(in 3 min)', 'countdown text updated');
    assert(tryPatchLiveBoardCountdown(el, 'direct|0618|06:18:00|PRETORIA|CENTURION|0|1', '(in 2 min)'), 'first/last flip still patches');
    assert(el.node.textContent === '(in 2 min)', 'identity match updates countdown');
    assert(!tryPatchLiveBoardCountdown(el, 'direct|0618|06:18:00|PRETORIA|SPORTPARK|1|0', '(in 2 min)'), 'origin change does not quiet-patch');
    assert(!tryPatchLiveBoardCountdown(el, 'direct|0619|06:19:00|PRETORIA|CENTURION|1|0', '(in 9 min)'), 'different train remounts');
    delete globalThis.window;
}

{
    assert(boardDirectionState('', 'IRENE STATION', true) === 'placeholder', 'no station is not an empty timetable');
    assert(boardDirectionState('PRETORIA', 'PRETORIA STATION', true) === 'here', 'standing at Pretoria is not a train to Pretoria');
    assert(boardDirectionState('PRETORIA', 'IRENE STATION', false) === 'await', 'Irene card waits while the sheet is still loading');
    assert(boardDirectionState('SPORTPARK', 'PRETORIA STATION', true) === 'ready', 'an intermediate stop still looks up the train');
    assert(sheetsReadyForBoard({}, 'pta-irene', 'weekday') === false, 'a wiped schedule is not ready');
    assert(sheetsReadyForBoard({
        _routeId: 'pta-kempton',
        weekday_to_a: { rows: [{ STATION: 'PRETORIA' }] },
    }, 'pta-kempton', 'weekday') === true, 'a sliced sheet is ready');
    assert(sheetsReadyForBoard({
        _routeId: 'pta-kempton',
        weekday_to_a: { rows: [] },
    }, 'pta-irene', 'weekday') === false, 'another route\'s sheet is not this board');
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

{
    const calls = [];
    const nodes = {};
    const make = (id) => {
        const node = {
            id,
            value: '',
            dataset: {},
            attrs: {},
            _html: '',
            textContent: '',
            classList: { add() {}, remove() {}, contains() { return false; } },
            options: [{ value: '', textContent: 'Select a station...' }],
            selectedIndex: 0,
            getAttribute(name) { return this.attrs[name] || null; },
            setAttribute(name, value) { this.attrs[name] = String(value); },
            querySelector() { return null; },
            set innerHTML(value) {
                this._html = String(value);
                this.textContent = this._html.replace(/<[^>]+>/g, ' ');
            },
            get innerHTML() { return this._html; },
        };
        nodes[id] = node;
        return node;
    };
    make('station-select');
    make('station-search-input');
    make('pretoria-time');
    make('pienaarspoort-time');
    make('pretoria-header');
    make('pienaarspoort-header');
    globalThis.document = {
        getElementById(id) { return nodes[id] || null; },
        querySelector() { return null; },
    };
    globalThis.window = {
        __ntQuietBoardPaint: true,
        currentDayType: 'weekday',
        currentDayIndex: 5,
        currentTime: '02:03:00',
        Renderer: {
            _applyUIIntercepts(name) { return String(name || '').replace(/ STATION/gi, ''); },
            renderPlaceholder() { calls.push('placeholder'); },
            renderAtDestination(el) { calls.push(`here:${el?.id || ''}`); },
            renderSkeletonLoader(el) { calls.push(`await:${el?.id || ''}`); },
            renderComingSoon() { calls.push('soon'); },
        },
        processAndRenderJourney(journeys, el) {
            const train = journeys[0]?.train || journeys[0]?.train1?.train || 'none';
            calls.push(`journey:${el?.id || ''}:${train}`);
        },
    };
    const select = nodes['station-select'];
    const input = nodes['station-search-input'];
    const setStation = (value) => {
        select.value = value;
        select.options = [
            { value: '', textContent: 'Select a station...' },
            { value, textContent: value },
        ];
        select.selectedIndex = value ? 1 : 0;
        input.value = value;
    };
    const kempSheets = {
        _routeId: 'pta-kempton',
        weekday_to_a: {
            stationColumnName: 'STATION',
            headers: ['STATION', '0603'],
            rows: [
                { STATION: 'SPORTPARK', '0603': '5:15:00' },
                { STATION: 'PRETORIA', '0603': '5:27:00' },
            ],
        },
        weekday_to_b: {
            stationColumnName: 'STATION',
            headers: ['STATION', '0624'],
            rows: [
                { STATION: 'PRETORIA', '0624': '5:10:00' },
                { STATION: 'IRENE', '0624': '5:35:00' },
            ],
        },
    };
    $userRegion.set('GP');
    $fullDatabase.set({});
    $globalStationIndex.set({});
    $currentRouteId.set('pta-kempton');
    $schedules.set(kempSheets);
    setStation('PRETORIA');
    calls.length = 0;
    findNextTrains();
    assert(calls.includes('here:pretoria-time'), `Pretoria card is You're here, got ${calls.join(',')}`);
    assert(!calls.some((c) => c.startsWith('journey:pretoria-time:0603')), '0603 is not the next train to Pretoria from Pretoria');
    assert(currentScheduleData['PRETORIA STATION'] == null, 'standing at Pretoria does not keep a departure toward Pretoria');
    calls.length = 0;
    processAndRenderJourney(
        [{ type: 'direct', train: '0603', departureTime: '5:15:00', arrivalTime: '5:27:00', isShared: true, sourceRoute: 'Pretoria <-> Kempton Park' }],
        nodes['pretoria-time'],
        null,
        'PRETORIA STATION',
    );
    assert(calls.includes('here:pretoria-time'), `a replay of 0603 while at Pretoria says You're here, got ${calls.join(',')}`);
    assert(!calls.some((c) => c.includes('0603')), 'a replay does not paint 0603 toward Pretoria');

    $currentRouteId.set('pta-irene');
    $schedules.set({});
    setStation('');
    calls.length = 0;
    findNextTrains();
    assert(calls.includes('placeholder'), `empty Irene board asks for a station, got ${calls.join(',')}`);
    assert(!calls.some((c) => c.startsWith('journey:')), 'empty station does not paint a train');
    assert(!calls.some((c) => String(c).includes('nosched')), 'empty station is not No scheduled trains');
    calls.length = 0;
    processAndRenderJourney([], nodes['pienaarspoort-time'], null, 'IRENE STATION');
    assert(calls.includes('placeholder'), `replaying an empty Irene list with no station stays on the prompt, got ${calls.join(',')}`);

    setStation('PRETORIA');
    calls.length = 0;
    findNextTrains();
    assert(calls.includes('here:pretoria-time'), 'Pretoria still says you are here while Irene sheets load');
    assert(calls.includes('await:pienaarspoort-time'), 'Irene card waits instead of saying there are no trains');
    assert(!calls.some((c) => c.startsWith('journey:')), 'unloaded Irene sheets do not invent a train');
}

if (failures.length) {
    console.error('verify-live-board-paint failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-live-board-paint: ok');
