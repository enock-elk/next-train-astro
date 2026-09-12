/**
 * Transit-incident danger-zone matching (interval overlap).
 * Run: node scripts/verify-disruption-zones.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    firstContactInDangerZone,
    stationsInCriticalZone,
    disruptedStationMap,
    disruptionAppliesToDay,
    disruptionAppliesToTime,
    disruptionIsAllDay,
    disruptionShowsCancelledOnMap,
    collectDisruptionContactTimes,
} from '../src/lib/disruption-zones.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

const geom = [
    'PRETORIA', 'FONTEINE', 'KLOOFSIG', 'SPORTPARK', 'CENTURION', 'IRENE',
    'PINEDENE', 'OLIFANTSFONTEIN', 'OAKMOOR', 'LERALLA', 'LIMINDLELA',
    'TEMBISA', 'KAALFONTEIN', 'BIRCHLEIGH', 'VAN RIEBEECKPARK',
    'KEMPTON PARK', 'RHODESFIELD', 'ELANDSFONTEIN',
];
const stops = (...names) => names.map((station) => ({ station }));

{
    const trip = stops(
        'PRETORIA', 'FONTEINE', 'KLOOFSIG', 'SPORTPARK', 'CENTURION', 'IRENE',
        'PINEDENE', 'OLIFANTSFONTEIN', 'OAKMOOR', 'KAALFONTEIN', 'BIRCHLEIGH',
        'VAN RIEBEECKPARK', 'KEMPTON PARK'
    );
    const idx = firstContactInDangerZone(geom, trip, 'OLIFANTSFONTEIN', 'ELANDSFONTEIN');
    assert(idx === 7, `trip ending inside zone first-contact is Olifantsfontein, got ${idx}`);
}

{
    const trip = stops('PRETORIA', 'FONTEINE', 'KLOOFSIG', 'SPORTPARK', 'CENTURION', 'IRENE');
    const idx = firstContactInDangerZone(geom, trip, 'OLIFANTSFONTEIN', 'ELANDSFONTEIN');
    assert(idx === -1, `trip entirely before zone must miss, got ${idx}`);
}

{
    const trip = stops(
        'PRETORIA', 'FONTEINE', 'KLOOFSIG', 'SPORTPARK', 'CENTURION', 'IRENE',
        'PINEDENE', 'OLIFANTSFONTEIN', 'OAKMOOR', 'KAALFONTEIN', 'BIRCHLEIGH',
        'VAN RIEBEECKPARK', 'KEMPTON PARK', 'RHODESFIELD', 'ELANDSFONTEIN'
    );
    const idx = firstContactInDangerZone(geom, trip, 'OLIFANTSFONTEIN', 'ELANDSFONTEIN');
    assert(idx === 7, `trip spanning the zone first-contact is Olifantsfontein, got ${idx}`);
}

{
    const trip = stops(
        'PRETORIA', 'FONTEINE', 'KLOOFSIG', 'SPORTPARK', 'CENTURION', 'IRENE',
        'PINEDENE', 'OLIFANTSFONTEIN'
    );
    const idx = firstContactInDangerZone(geom, trip, 'OLIFANTSFONTEIN', 'ELANDSFONTEIN');
    assert(idx === trip.length - 1, `alighting at zone edge is last stop (${idx} vs ${trip.length - 1})`);
}

{
    const trip = stops(
        'KEMPTON PARK', 'VAN RIEBEECKPARK', 'BIRCHLEIGH', 'KAALFONTEIN',
        'OAKMOOR', 'OLIFANTSFONTEIN', 'PINEDENE', 'IRENE', 'CENTURION', 'PRETORIA'
    );
    const idx = firstContactInDangerZone(geom, trip, 'OLIFANTSFONTEIN', 'ELANDSFONTEIN');
    assert(idx === 0, `reverse trip starting inside zone first-contact is 0, got ${idx}`);
}

{
    const zone = stationsInCriticalZone(geom, {
        tier: 'CRITICAL',
        stations: ['OLIFANTSFONTEIN', 'ELANDSFONTEIN'],
    });
    assert(zone[0] === 'OLIFANTSFONTEIN' && zone[zone.length - 1] === 'ELANDSFONTEIN', 'CRITICAL stretch is inclusive');
    assert(zone.includes('KEMPTON PARK') && zone.includes('OAKMOOR'), 'inclusive stretch covers in-between stations');
}

{
    const map = disruptedStationMap('pta-kempton', geom, {
        'pta-kempton': [{
            id: '1',
            routeId: 'pta-kempton',
            tier: 'CRITICAL',
            stations: ['OLIFANTSFONTEIN', 'ELANDSFONTEIN'],
        }],
    });
    assert(map.get('KEMPTON PARK')?.id === '1', 'Kempton Park row is shaded');
    assert(!map.has('PRETORIA'), 'Pretoria is outside the cut');
}

{
    const morning = {
        applyDays: ['weekday'],
        startTime: '06:00',
        endTime: '09:00',
        showCancelledOnMap: false,
    };
    assert(disruptionAppliesToDay(morning, 'weekday'), 'weekday window applies on weekdays');
    assert(!disruptionAppliesToDay(morning, 'saturday'), 'weekday window skips Saturday');
    assert(disruptionAppliesToTime(morning, '07:30'), '07:30 is inside 06:00-09:00');
    assert(disruptionAppliesToTime(morning, '06:00'), 'window start is inclusive');
    assert(disruptionAppliesToTime(morning, '09:00'), 'window end is inclusive');
    assert(!disruptionAppliesToTime(morning, '15:00'), '15:00 is outside the window');
    assert(!disruptionIsAllDay(morning), 'explicit window is not all-day');
    assert(disruptionIsAllDay({}), 'legacy rows default to all day');
    assert(disruptionAppliesToDay({}, 'saturday'), 'legacy rows apply every day');
    assert(!disruptionShowsCancelledOnMap(morning), 'map cancelled-station default is off');
    assert(disruptionShowsCancelledOnMap({ showCancelledOnMap: true }), 'admin can show cancelled station on map');
}

{
    const satOnly = {
        id: '2',
        routeId: 'pta-kempton',
        tier: 'CRITICAL',
        stations: ['OLIFANTSFONTEIN', 'ELANDSFONTEIN'],
        applyDays: ['saturday'],
    };
    const satMap = disruptedStationMap('pta-kempton', geom, { 'pta-kempton': [satOnly] }, 'saturday');
    const wkMap = disruptedStationMap('pta-kempton', geom, { 'pta-kempton': [satOnly] }, 'weekday');
    assert(satMap.get('KEMPTON PARK')?.id === '2', 'Saturday board shades Saturday-only cut');
    assert(!wkMap.has('KEMPTON PARK'), 'weekday board skips Saturday-only cut');
}

{
    const trip = [
        { station: 'PRETORIA', time: '07:00' },
        { station: 'OLIFANTSFONTEIN', time: '08:10' },
        { station: 'KEMPTON PARK', time: '08:40' },
    ];
    const d = { stations: ['OLIFANTSFONTEIN', 'ELANDSFONTEIN'] };
    const times = collectDisruptionContactTimes(trip, d, geom);
    assert(times.includes('08:10') && times.includes('08:40'), 'contact times are zone stops only');
    assert(!times.includes('07:00'), 'origin outside the zone is ignored');
}

const live = readFileSync(join(ROOT, 'src/lib/live-board.js'), 'utf8');
assert(live.includes('firstContactInDangerZone'), 'getTripDisruptions uses interval-overlap helper');
assert(
    !live.includes('stop1Idx <= minZone && stop2Idx >= maxZone'),
    'old whole-zone hop-span test must be gone'
);

const core = readFileSync(join(ROOT, 'src/lib/planner-core.js'), 'utf8');
assert(core.includes('route-wide') || core.includes('stations.length === 0') || core.includes('!crit.stations'), 'planner-core must keep segment CRITICAL trips');

if (failures.length) {
    console.error(`verify-disruptions: ${failures.length} failed`);
    for (const f of failures) console.error(' -', f);
    process.exit(1);
}
console.log('verify-disruptions: ok');
