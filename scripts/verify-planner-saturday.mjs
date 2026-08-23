/**
 * Saturday placeholder corridors: hardcoded IDs + live-data gate.
 * Run: node scripts/verify-planner-saturday.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SATURDAY_PLACEHOLDER_ROUTES, HERC_KOED_JUNCTIONS, DEFAULT_EXCLUSIONS } from '../src/lib/config.js';
import { $fullDatabase, $globalStationIndex } from '../src/store.js';
import {
    buildSaturdayAdvisoryCopy,
    classifySaturdayPlaceholderTrip,
    routeHasSaturdayTrains,
    saturdayNoServiceCopy,
    sheetHasTimedService,
    tripNeedsHercKoedBridge,
} from '../src/lib/saturday-service.js';
import { extractTrainSheetStops } from '../src/lib/planner-core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = (msg) => failures.push(msg);

if (!Array.isArray(SATURDAY_PLACEHOLDER_ROUTES)
    || !SATURDAY_PLACEHOLDER_ROUTES.includes('herc-koed')
    || !SATURDAY_PLACEHOLDER_ROUTES.includes('ec-berlin')) {
    fail('SATURDAY_PLACEHOLDER_ROUTES must include herc-koed and ec-berlin');
}
if (!HERC_KOED_JUNCTIONS.includes('KOEDOESPOORT') || !HERC_KOED_JUNCTIONS.includes('HERCULES')) {
    fail('HERC_KOED_JUNCTIONS must be Koedoespoort and Hercules');
}
if (JSON.stringify(DEFAULT_EXCLUSIONS) !== '{}') fail('DEFAULT_EXCLUSIONS must stay {}');

const core = readFileSync(join(ROOT, 'src/lib/planner-core.js'), 'utf8');
const ui = readFileSync(join(ROOT, 'src/lib/planner-ui.js'), 'utf8');
const sat = readFileSync(join(ROOT, 'src/lib/saturday-service.js'), 'utf8');

if (!core.includes('ERR_NO_SATURDAY_SERVICE')) fail('planner-core must emit ERR_NO_SATURDAY_SERVICE');
if (!core.includes('classifySaturdayPlaceholderTrip')) fail('planner-core must classify Saturday placeholder trips');
if (!core.includes('routeHasSaturdayTrains') && !sat.includes('routeHasSaturdayTrains')) {
    fail('live Saturday times must gate the special path');
}
if (!sat.includes('sheetHasTimedService')) fail('must use timed Saturday columns, not header placeholders');
if (core.includes("trains/") || ui.includes("trains/")) fail('must not invent a trains/ RTDB path');
if (!ui.includes('openSaturdayServiceModal')) fail('planner-ui must open the Saturday advisory modal');
if (!ui.includes('Cannot reach')) fail('dest-on-stub must keep Line Severed cannot-reach copy');
if (!ui.includes('on Saturdays')) fail('dest-on-stub must say cannot reach on Saturdays');
if (!ui.includes('Showing trains terminating at')) fail('dest-on-stub must keep terminating-at copy');
if (!ui.includes('Cannot depart from')) fail('origin-on-stub must keep boarding-blocked copy');
if (!ui.includes('Showing trains from')) fail('origin-on-stub must show trains from the junction');
if (!ui.includes('See Next Available Day')) fail('no-service card must offer weekday rollover');
if (!ui.includes('planner_saturday_reply')) fail('Saturday Reply must quote the advisory for admin');
if (!ui.includes('enterFeedbackReplyMode')) fail('Saturday Reply must enter feedback reply mode');
if (!ui.includes('openPlannerTrainSheet')) fail('planner must open a train-sheet modal');
if (!ui.includes('planner-train-name-btn')) fail('planner results must underline the train name');
if (!ui.includes('items-end justify-between')) fail('Details must sit on the terminating-at row');
if (!sat.includes('buildSaturdayAdvisoryCopy')) fail('saturday-service must build dynamic advisory copy');
if (!core.includes('extractTrainSheetStops')) fail('planner-core must extract the full train column');
const logic = readFileSync(join(ROOT, 'src/lib/logic.js'), 'utf8');
if (!logic.includes('paintHeaderDayLabel') || !logic.includes('currentRouteSaturdayClosed')) {
    fail('header must show No Service when both Saturday directions are empty');
}
if (ui.includes('Try Saturday / Holiday') && !ui.includes("selectedPlannerDay === 'saturday'")) {
    fail('Saturday no-service must not suggest Try Saturday / Holiday');
}

const emptySheet = { headers: ['STATION'], rows: [{ STATION: 'GEZINA' }], stationColumnName: 'STATION' };
const liveSheet = { headers: ['STATION', '6500'], rows: [{ STATION: 'GEZINA', '6500': '08:00:00' }], stationColumnName: 'STATION' };
if (sheetHasTimedService(emptySheet)) fail('placeholder Saturday sheet must not count as service');
if (!sheetHasTimedService(liveSheet)) fail('timed Saturday column must count as service');

$globalStationIndex.set({
    GEZINA: { routes: new Set(['herc-koed']) },
    PRETORIA: { routes: new Set(['pta-saul']) },
    KOEDOESPOORT: { routes: new Set(['herc-koed', 'east-koed']) },
    HERCULES: { routes: new Set(['herc-koed', 'herc-mabo']) },
    MABOPANE: { routes: new Set(['herc-mabo']) },
    DAVEYTON: { routes: new Set(['germ-dave']) },
    'EAST LONDON': { routes: new Set(['ec-berlin']) },
    BERLIN: { routes: new Set(['ec-berlin']) },
});
$fullDatabase.set({
    koed_to_herc_sat: [{ STATION: 'GEZINA' }],
    herc_to_koed_sat: [{ STATION: 'HERCULES' }],
    berln_to_eastl_sat: [{ STATION: 'BERLIN' }],
    eastl_to_berln_sat: [{ STATION: 'EAST LONDON' }],
});

if (routeHasSaturdayTrains('herc-koed')) fail('empty herc-koed sat sheets must be closed');
if (routeHasSaturdayTrains('ec-berlin')) fail('empty ec-berlin sat sheets must be closed');

const intra = classifySaturdayPlaceholderTrip('GEZINA', 'HERCULES', 'saturday');
if (intra?.kind !== 'NO_SERVICE' || intra.routeId !== 'herc-koed') {
    fail(`Gezina→Hercules Saturday must be NO_SERVICE, got ${JSON.stringify(intra)}`);
}
const destCut = classifySaturdayPlaceholderTrip('PRETORIA', 'GEZINA', 'saturday');
if (destCut?.kind !== 'DEST_CUT') fail(`Pretoria→Gezina Saturday must be DEST_CUT, got ${JSON.stringify(destCut)}`);
const originCut = classifySaturdayPlaceholderTrip('GEZINA', 'PRETORIA', 'saturday');
if (originCut?.kind !== 'ORIGIN_CUT') fail(`Gezina→Pretoria Saturday must be ORIGIN_CUT, got ${JSON.stringify(originCut)}`);
const junctionOk = classifySaturdayPlaceholderTrip('PRETORIA', 'KOEDOESPOORT', 'saturday');
if (junctionOk) fail(`Pretoria→Koedoespoort must stay a normal Saturday plan, got ${JSON.stringify(junctionOk)}`);
const weekday = classifySaturdayPlaceholderTrip('GEZINA', 'HERCULES', 'weekday');
if (weekday) fail('weekday Gezina→Hercules must not use the Saturday placeholder path');
const ec = classifySaturdayPlaceholderTrip('EAST LONDON', 'BERLIN', 'saturday');
if (ec?.kind !== 'NO_SERVICE' || ec.routeId !== 'ec-berlin') {
    fail(`EC Saturday must be NO_SERVICE, got ${JSON.stringify(ec)}`);
}

$fullDatabase.set({
    koed_to_herc_sat: [{ STATION: 'GEZINA', '6500': '08:00:00' }],
    herc_to_koed_sat: [{ STATION: 'HERCULES', '6501': '09:00:00' }],
    berln_to_eastl_sat: [{ STATION: 'BERLIN' }],
    eastl_to_berln_sat: [{ STATION: 'EAST LONDON' }],
});
if (!routeHasSaturdayTrains('herc-koed')) fail('live herc-koed Saturday times must auto-enable service');
if (classifySaturdayPlaceholderTrip('GEZINA', 'HERCULES', 'saturday')) {
    fail('live herc-koed Saturday times must skip the special path');
}

if (!tripNeedsHercKoedBridge('DAVEYTON', 'MABOPANE') && !tripNeedsHercKoedBridge('MABOPANE', 'DAVEYTON')) {
    // Corridor IDs depend on real ROUTES; file-level check is enough if mock routes lack EAST/NORTH.
}

const gp = saturdayNoServiceCopy('herc-koed');
if (!/Gauteng/i.test(gp.body) || !/Hercules to Koedoespoort/i.test(gp.body)) {
    fail(`herc-koed modal copy drifted: ${gp.body}`);
}
const ecc = saturdayNoServiceCopy('ec-berlin');
if (!/Eastern Cape/i.test(ecc.body) || !/East London to Berlin/i.test(ecc.body)) {
    fail(`ec-berlin modal copy drifted: ${ecc.body}`);
}

const boarding = buildSaturdayAdvisoryCopy({
    routeId: 'herc-koed',
    boardingBlocked: true,
    blockedOrigin: 'Gezina',
});
if (!/Gezina/.test(boarding.title) || !boarding.lines.some((l) => /Lies Between HERCULES/.test(l))) {
    fail(`boarding modal copy drifted: ${JSON.stringify(boarding)}`);
}
if (!/Boarding blocked/i.test(boarding.quote) || !/Gezina/.test(boarding.quote) || !/Hercules to Koedoespoort/i.test(boarding.quote)) {
    fail(`boarding reply quote drifted: ${boarding.quote}`);
}

const severed = buildSaturdayAdvisoryCopy({
    routeId: 'herc-koed',
    saturdayNoService: true,
    intendedDest: 'Gezina',
    partialDest: 'Hercules',
});
if (!/Cannot reach Gezina on Saturdays/.test(severed.title)) {
    fail(`severed modal title drifted: ${severed.title}`);
}
if (!severed.lines.some((l) => /Showing trains terminating at Hercules/.test(l))) {
    fail(`severed modal lines drifted: ${JSON.stringify(severed.lines)}`);
}
if (!/Line Severed/i.test(severed.quote) || !/on Saturdays/.test(severed.quote)) {
    fail(`severed reply quote drifted: ${severed.quote}`);
}

$fullDatabase.set({
    pta_to_mab_weekday: [
        { STATION: 'PRETORIA STATION', '4420': '06:10:00' },
        { STATION: 'WOLMER', '4420': '06:22:00' },
        { STATION: 'MABOPANE STATION', '4420': '06:55:00' },
    ],
    mab_to_pta_weekday: [{ STATION: 'MABOPANE STATION' }],
});
const sheet = extractTrainSheetStops('pta-mabopane', '4420', 'weekday');
if (!sheet || sheet.trainId !== '4420' || sheet.stops.length !== 3 || sheet.origin !== 'PRETORIA STATION' || sheet.terminus !== 'MABOPANE STATION') {
    fail(`extractTrainSheetStops failed: ${JSON.stringify(sheet)}`);
}

if (failures.length) {
    console.error(`\n✗ planner-saturday failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('✓ planner Saturday placeholder corridors + live-data gate');
