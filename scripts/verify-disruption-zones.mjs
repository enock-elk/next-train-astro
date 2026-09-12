/**
 * Transit-incident danger-zone matching (interval overlap).
 * Run: node scripts/verify-disruption-zones.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstContactInDangerZone, stationsInCriticalZone, disruptedStationMap } from '../src/lib/disruption-zones.js';

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
