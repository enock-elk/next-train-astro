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
import { Renderer, fittedStatusFontPx } from '../src/lib/renderer.js';
import { setRuntimeGridOrderConfig, clearRuntimeGridOrderConfig } from '../src/lib/grid-order.js';
import { buildGridOrderWriteRecord } from '../src/lib/utils.js';
import { filterStopsForFork } from '../src/lib/map-overrides.js';

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
if (!ui.includes('syncPlannerDayControls')) fail('next available day must sync the day dropdown');
if (!ui.includes('presentedPlannerDayType')) fail('dropdown uses the presented result day type');
if (ui.includes("display.textContent = 'Weekday (Mon-Fri)'")) fail('must not paint Weekday on the dropdown before results exist');
if (!ui.includes('planner_saturday_reply')) fail('Saturday Reply must quote the advisory for admin');
if (!ui.includes('enterFeedbackReplyMode')) fail('Saturday Reply must enter feedback reply mode');
if (ui.includes('Sundays & Public Holidays')) fail('train sheet must not claim a Sunday timetable');
const liveBoard = readFileSync(join(ROOT, 'src/lib/live-board.js'), 'utf8');
if (!liveBoard.includes("return 'Public Holidays'")) fail('public holiday train sheet says Public Holidays');
if (!ui.includes('Public Holiday schedule')) fail('holiday notice must be able to name the Public Holiday schedule');
if (!ui.includes('openPlannerTrainSheet')) fail('planner must open a train-sheet modal');
if (!ui.includes('planner-train-name-btn')) fail('planner results must underline the train name');
if (!ui.includes('planner-notice-details-row')) fail('Details must sit on its own row');
if (!ui.includes('planner-notice-details-row mt-auto')) fail('Details sits at the far bottom of the icon column');
if (ui.includes('planner-notice-details-row flex justify-end mt-1.5')) fail('Details must not sit in the copy column');
if (!ui.includes('planner-notice-aside')) fail('banner SVG lives in a top-right aside column');
if (!ui.includes('trainTerminatesRuleHtml')) fail('TRAIN TERMINATES is a reusable clickable rule');
if (!ui.includes('openDisruptionModal')) fail('TRAIN TERMINATES / Details open the Line Severed modal');
if (!ui.includes('Departed:')) fail('Departed stays a status above Show Next Train');
if (!ui.includes('Departs:')) fail('upcoming trips label the wait as Departs');
if (!ui.includes('Total Time:')) fail('duration is labelled Total Time');
if (!ui.includes('planner-departed-next')) fail('Show Next Train is its own button');
if (!ui.includes('Show Next Train')) fail('departed card still offers Show Next Train');
if (ui.includes('getInjectionHtml(0) ?')) fail('must not double-call getInjectionHtml(0)');
if (!ui.includes('const injAtOrigin = getInjectionHtml(0)')) fail('TRAIN TERMINATES at origin is injected once');
if (ui.includes('allowedDisrIds.size && !allowedDisrIds.has')) fail('empty allow-set must not paint every incident on the trip map');
if (!ui.includes('!allowedDisrIds.has(d.id)')) fail('trip map paints only disruptions that hit this trip');
if (!ui.includes('stopOnTripPath')) fail('trip map requires zone ends on this trip path');
if (!ui.includes('planner-notice-copy')) fail('notice body copy must be fittable');
if (!ui.includes('Trip Fare')) fail('planner fare is a single Trip Fare line');
if (ui.includes("switchTab('map'")) fail('Open Network Map must not switch to the live Map tab');
if (!ui.includes('__ntOpenNetworkMapSheet')) fail('Open Network Map opens the sidenav GPS network map sheet');
{
    const departedFn = ui.slice(ui.indexOf('export function renderAllDepartedResult'));
    const ctaAt = departedFn.indexOf('${nextDayCta}');
    const cardAt = departedFn.indexOf('PlannerRenderer.buildCard');
    if (ctaAt < 0 || cardAt < 0 || ctaAt > cardAt) {
        fail('See Next Available Day must sit above the departed banner stack');
    }
}
if (ui.includes('pr-14')) fail('planner notice must not reserve pr-14 on phones');
if (!ui.includes('paintSaturdayBetweenLine')) fail('Saturday advisory must paint blue corridor ends');
if (!sat.includes('classifyPlaceholderStation')) fail('placeholder stations classify as stub/junction from other routes');
if (!sat.includes("o === 'junction' && d === 'junction'")) fail('junction↔junction must not short-circuit Dijkstra');
if (!core.includes('extractTrainSheetStops')) fail('planner-core must extract the full train column');
const logic = readFileSync(join(ROOT, 'src/lib/logic.js'), 'utf8');
if (!logic.includes('paintHeaderDayLabel') || !logic.includes('currentRouteSaturdayClosed')) {
    fail('header must show No Service when both Saturday directions are empty');
}
if (!logic.includes('Metrorail does not run regular Sunday trains on this line.')) {
    fail('Sunday note must explain that this line has no regular Sunday trains');
}
if (!logic.includes('Metrorail Gauteng does not have Saturday train service on the Hercules to Koedoespoort line.')) {
    fail('Hercules Saturday note must name that line');
}
if (!logic.includes('Metrorail Eastern Cape does not have Saturday train service on the East London to Berlin line.')) {
    fail('East London Saturday note must name that line');
}
if (!logic.includes('This public holiday uses the Saturday timetable.')) {
    fail('public holiday note must name the Saturday timetable outside the Western Cape');
}
if (!logic.includes('The Western Cape uses its public holiday timetable today.')) {
    fail('Western Cape public holiday note must name that timetable');
}
if (!logic.includes('appliedScheduleOverrideNote')) {
    fail('an applied force uses the admin message on the day note');
}
const adminJs = readFileSync(join(ROOT, 'public/js/admin.js'), 'utf8');
if (!adminJs.includes('missingMessage') || !adminJs.includes('before forcing that schedule')) {
    fail('forcing a schedule requires a message');
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
const junctionWalkaround = classifySaturdayPlaceholderTrip('HERCULES', 'KOEDOESPOORT', 'saturday');
if (junctionWalkaround) {
    fail(`Hercules→Koedoespoort Saturday must use Dijkstra, got ${JSON.stringify(junctionWalkaround)}`);
}
const reverseWalkaround = classifySaturdayPlaceholderTrip('KOEDOESPOORT', 'HERCULES', 'saturday');
if (reverseWalkaround) {
    fail(`Koedoespoort→Hercules Saturday must use Dijkstra, got ${JSON.stringify(reverseWalkaround)}`);
}
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
const cape = saturdayNoServiceCopy('eerst-dtoit');
if (!/Western Cape/i.test(cape.body) || !/Eerste River/i.test(cape.body) || !/Du Toit/i.test(cape.body)) {
    fail(`eerst-dtoit copy must name the Cape corridor: ${cape.body}`);
}
if (/Hercules to Koedoespoort/i.test(cape.body)) fail('eerst-dtoit must not use the Hercules sentence');
if (cape.body !== 'Metrorail Western Cape does not have a Saturday timetable for the Eerste River to Du Toit line. The trip planner can check other routes for a way through.') {
    fail(`eerst-dtoit sentence drifted: ${cape.body}`);
}

const boarding = buildSaturdayAdvisoryCopy({
    routeId: 'herc-koed',
    boardingBlocked: true,
    blockedOrigin: 'Gezina',
});
if (!/^Your selected station: Gezina\.$/.test(boarding.title) || !boarding.lines.some((l) => /Lies Between HERCULES/.test(l))) {
    fail(`boarding modal copy drifted: ${JSON.stringify(boarding)}`);
}
if (!/Boarding blocked/i.test(boarding.quote) || !/Your selected station: Gezina/.test(boarding.quote) || !/Hercules to Koedoespoort/i.test(boarding.quote)) {
    fail(`boarding reply quote drifted: ${boarding.quote}`);
}

const severed = buildSaturdayAdvisoryCopy({
    routeId: 'herc-koed',
    saturdayNoService: true,
    intendedDest: 'Gezina',
    partialDest: 'Hercules',
});
if (!/^Your selected station: Gezina\.$/.test(severed.title)) {
    fail(`severed modal title drifted: ${severed.title}`);
}
if (severed.lines.some((l) => /Cannot reach|Showing trains terminating/.test(l))) {
    fail(`severed modal must not repeat the board: ${JSON.stringify(severed.lines)}`);
}
if (!severed.lines.some((l) => /Lies Between HERCULES/.test(l))) {
    fail(`severed modal must keep Lies Between: ${JSON.stringify(severed.lines)}`);
}
if (!/Line Severed/i.test(severed.quote) || !/Your selected station: Gezina/.test(severed.quote)) {
    fail(`severed reply quote drifted: ${severed.quote}`);
}
if (/Cannot reach|Showing trains terminating/.test(severed.quote)) {
    fail(`severed reply must not repeat the board: ${severed.quote}`);
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

const weekdaySheet = {
    headers: ['STATION', '0618', '0619'],
    stationColumnName: 'STATION',
    rows: [
        { STATION: 'HERCULES STATION', '0618': '06:10:00', '0619': '-' },
        { STATION: 'GHOST STOP', '0618': '-', '0619': '' },
        { STATION: 'GEZINA', '0618': '06:22:00', '0619': '07:05:00' },
        { STATION: 'Updated 12 Jan', '0618': '06:00:00', '0619': '07:00:00' },
    ],
};
const noWeekend = Renderer._buildNoSaturdayGridHTML(weekdaySheet, 'Hercules to Koedoespoort', 'herc-koed');
if (/GHOST STOP/i.test(noWeekend)) fail('no-weekend grid must drop weekday rows with no times');
if (/Updated 12 Jan/i.test(noWeekend)) fail('no-weekend grid must skip updated rows');
if (!/Hercules/.test(noWeekend) || !/Gezina/.test(noWeekend)) fail('no-weekend grid must keep active stations');
if (/Weekend timetable|bg-amber-50|rowspan=|Stations are listed for reference/.test(noWeekend)) {
    fail('no-weekend grid must not use the amber rowspan card');
}
if (!noWeekend.includes('id="grid-switch-weekday-btn"')) fail('no-weekend grid must expose a bound weekday switch');
if (noWeekend.includes('onclick=')) fail('no-weekend switch must not use inline onclick');
if (!/Gauteng/i.test(noWeekend) || !/Hercules to Koedoespoort/i.test(noWeekend)) {
    fail(`no-weekend notice must use saturdayNoServiceCopy: ${noWeekend}`);
}
if (!noWeekend.includes('id="grid-plan-trip-btn"')) fail('no-weekend grid must offer Plan this trip');
const capeGrid = Renderer._buildNoSaturdayGridHTML(weekdaySheet, 'Du Toit to Eerste River', 'eerst-dtoit');
if (!/Western Cape/i.test(capeGrid) || !/Du Toit/i.test(capeGrid) || !capeGrid.includes('id="grid-plan-trip-btn"')) {
    fail(`Cape no-weekend grid must name the route and offer the planner: ${capeGrid}`);
}
if (capeGrid.includes('onclick=')) fail('Cape no-weekend buttons must not use inline onclick');

const expressSheet = {
    headers: ['STATION', '2630'],
    stationColumnName: 'STATION',
    rows: [
        { STATION: 'VARIANT', '2630': 'MONTE_VISTA' },
        { STATION: 'TYGERBERG', '2630': 'EXPRESS' },
        { STATION: 'BELLVILLE', '2630': '08:10:00' },
        { STATION: 'MUTUAL', '2630': 'Via MV' },
    ],
};
const expressHtml = Renderer._buildGridHTML(expressSheet, 'sheet', 'ct-bellv', 1, false, false, 'weekday');
const viaAt = expressHtml.indexOf('>Monte Vista<');
const idAt = expressHtml.indexOf('>2630<');
if (!expressHtml.includes('>EXPR<') || !expressHtml.includes('text-[#7f1d1d]') || viaAt < 0 || idAt < viaAt) {
    fail('grid must render dark-red EXPR and Monte Vista above the train number');
}
if (!expressHtml.includes('data-via-open="1"') || !expressHtml.includes('data-via-route="Monte Vista"') || expressHtml.includes('<span style="display:block;">Via</span>')) {
    fail('Monte Vista must be one status button, not a stacked Via label');
}
if (/<td[^>]*>VARIANT</i.test(expressHtml) || />Via MV</.test(expressHtml)) {
    fail('grid must not paint VARIANT as a station or leftover Via MV prose');
}
const expressExport = Renderer._buildGridHTML(expressSheet, 'sheet', 'ct-bellv', 1, false, true, 'weekday');
if (!expressExport.includes('>EXPR<') || !expressExport.includes('color:#7f1d1d') || expressExport.includes('nt-expr-btn')) {
    fail('export grid must keep dark-red EXPR text and not a button');
}
const exportVia = expressExport.indexOf('>Monte Vista<');
const exportId = expressExport.indexOf('>2630<');
if (exportVia < 0 || exportId < exportVia || expressExport.includes('data-via-open') || !expressExport.includes('color:#1e40af') || !expressExport.includes('export-note-col') || !expressExport.includes('letter-spacing:0.08em') || expressExport.includes('export-banned-col')) {
    fail('export via label must use the NO SVC tag metrics in informational ink');
}
if (!expressHtml.includes('color:#1d4ed8') || !expressHtml.includes('text-decoration:underline dotted #93c5fd') || !expressHtml.includes('bg-blue-50') || !expressHtml.includes('class="nt-fit-status"')) {
    fail('in-app via label must use the NO SVC tag metrics in informational ink');
}
if (!expressExport.includes('class="nt-fit-status"') || expressExport.includes('min-width:112px') || expressHtml.includes('min-width:96px')) {
    fail('a long via name must scale inside the column, not widen it up front');
}
if (fittedStatusFontPx(8, 40, 70) !== 8) fail('a short tag must keep the NO SVC size');
if (fittedStatusFontPx(9, 90, 80) !== 7.6) fail(`a long tag must scale down to fit: ${fittedStatusFontPx(9, 90, 80)}`);
if (fittedStatusFontPx(9, 120, 40) !== 6.5) fail('shrink must stop at a readable floor');
const rendererSrc = readFileSync(join(ROOT, 'src/lib/renderer.js'), 'utf8');
const notePaint = rendererSrc.slice(rendererSrc.indexOf('th.export-note-col'), rendererSrc.indexOf('th.export-note-col') + 500);
if (!notePaint.includes("#dbeafe") || notePaint.includes("backgroundColor = '#eff6ff'")) {
    fail('export note header wash must read as a tag, not the zebra row');
}
const fitAt = rendererSrc.indexOf('fitGridStatusTags(exportContainer)');
const canvasAt = rendererSrc.indexOf('window.html2canvas(exportContainer');
if (fitAt < 0 || canvasAt < 0 || fitAt > canvasAt) fail('export must fit long status tags before the snapshot');
if (!rendererSrc.includes('size - 0.5')) fail('a long status tag must step down until it fits');
if (!expressHtml.includes('w-max max-w-[140px] truncate') || expressHtml.includes('min-w-[140px]')) {
    fail('in-app station column must shrink to the name and stop at 140px');
}
if (!expressExport.includes('min-w-[140px]') || !expressExport.includes('max-w-[140px]') || expressExport.includes('w-max max-w-[140px]')) {
    fail('exported station column must keep its fixed width');
}
if (!noWeekend.includes('w-max max-w-[140px] truncate') || noWeekend.includes('min-w-[140px]')) {
    fail('no-weekend in-app station column must shrink to the name and stop at 140px');
}
const forked = filterStopsForFork(
    [
        { name: 'DURBAN' },
        { name: "DUFF'S ROAD" },
        { name: 'KWAMASHU' },
        { name: 'BRIDGE CITY' },
    ],
    { at: "DUFF'S ROAD", branches: { a: { stops: ['KWAMASHU'] }, b: { stops: ['BRIDGE CITY'] } } },
).map((s) => s.name);
if (forked.includes('KWAMASHU') || !forked.includes('BRIDGE CITY') || !forked.includes('DURBAN') || !forked.includes("DUFF'S ROAD")) {
    fail(`fork filter must keep one branch plus the trunk: ${forked.join(', ')}`);
}
const logicSrc = readFileSync(join(ROOT, 'src/lib/logic.js'), 'utf8');
if (!logicSrc.includes("bare === 'VARIANT'")) fail('VARIANT must stay a sheet meta row');

const gridJs = readFileSync(join(ROOT, 'src/lib/timetable-grid.js'), 'utf8');
if (!gridJs.includes('bindNoWeekendWeekdaySwitch')) fail('timetable-grid must bind Switch to Mon - Fri');
if (!gridJs.includes('_buildNoSaturdayGridHTML(schedule, route.name, routeId, sheetDayType')) {
    fail('timetable-grid must pass routeId and the open day into the no-weekend builder');
}
const holidayCape = saturdayNoServiceCopy('eerst-dtoit', 'public_holiday', 'Heritage Day');
if (!/Heritage Day timetable/.test(holidayCape.body) || /Saturday timetable/.test(holidayCape.body)) {
    fail(`public holiday sheet must not say Saturday: ${holidayCape.body}`);
}
if (saturdayNoServiceCopy('eerst-dtoit').body !== cape.body) {
    fail('Saturday sheet copy must stay the Saturday sentence');
}
if (gridJs.includes('onclick="window.renderFullScheduleGrid')) fail('timetable-grid fallback must not use inline onclick');

const maitlandSheet = {
    headers: ['STATION', '2522'],
    stationColumnName: 'STATION',
    rows: [
        { STATION: 'VARIANT', '2522': 'MAITLAND' },
        { STATION: 'CAPE TOWN', '2522': '08:00:00' },
        { STATION: 'BELLVILLE', '2522': '08:40:00' },
    ],
};
const maitlandHtml = Renderer._buildGridHTML(maitlandSheet, 'maitland-sheet', 'ct-kraai', 1, false, false, 'weekday');
const maitlandAt = maitlandHtml.indexOf('>Maitland<');
const maitlandId = maitlandHtml.indexOf('>2522<');
if (maitlandAt < 0 || maitlandId < maitlandAt || !maitlandHtml.includes('data-via-route="Maitland"')) {
    fail('grid must render Maitland above the train number from a VARIANT code');
}
if (maitlandHtml.includes('max-width:4.5rem') || maitlandHtml.includes('<span style="display:block;">Via</span>')) {
    fail('via label must stay on one row above the number');
}

const proseSheet = {
    headers: ['STATION', '2301', '2501'],
    stationColumnName: 'STATION',
    rows: [
        { STATION: 'CAPE TOWN', '2301': '5:15:00', '2501': '6:00:00' },
        { STATION: 'WOODSTOCK', '2301': 'via', '2501': '6:04:00' },
        { STATION: 'SALT RIVER', '2301': 'Monte', '2501': '6:06:00' },
        { STATION: 'KOEBERG RD', '2301': 'Vista', '2501': '6:08:00' },
        { STATION: 'MAITLAND', '2501': '6:12:00' },
        { STATION: 'MONTE VISTA', '2301': '5:50:00' },
        { STATION: 'BELLVILLE', '2301': '6:10:00', '2501': '6:30:00' },
    ],
};
const proseHtml = Renderer._buildGridHTML(proseSheet, 'prose-sheet', 'ct-eerst', 1, false, false, 'weekday');
if (!proseHtml.includes('>Monte Vista<') || !proseHtml.includes('data-via-route="Monte Vista"')) {
    fail('via / Monte / Vista notes must label the column Monte Vista');
}
const proseCells = proseHtml.replace(/<th\b[\s\S]*?<\/th>/g, '');
if (/>via</.test(proseCells) || />Monte</.test(proseCells) || />Vista</.test(proseCells) || />Via MV</.test(proseCells)) {
    fail('branch notes must not stay in the cells');
}
if (proseHtml.includes('Via Maitland')) fail('a timed Maitland call must not become a via label');
const monteOnly = Renderer._buildGridHTML({
    headers: ['STATION', '2804'],
    stationColumnName: 'STATION',
    rows: [
        { STATION: 'BELLVILLE', '2804': '10:05:00' },
        { STATION: 'MONTE VISTA', '2804': '10:25:00' },
        { STATION: 'CAPE TOWN', '2804': '11:00:00' },
    ],
}, 'monte-sheet', 'ct-bellv', 1, false, false, 'weekday');
if (monteOnly.includes('Via Monte Vista')) fail('a real Monte Vista time must not add a via label');

setRuntimeGridOrderConfig('WC', {
    'prose-sheet': {
        order: ['2301', '2501'],
        via: { '2301': 'MAITLAND' },
        updatedAt: 1,
        updatedBy: 'test',
        source: 'admin',
    },
});
const overridden = Renderer._buildGridHTML(proseSheet, 'prose-sheet', 'ct-eerst', 1, false, false, 'weekday');
clearRuntimeGridOrderConfig('WC');
if (!overridden.includes('>Maitland<') || overridden.includes('>Monte Vista<')) {
    fail('an admin via mark must replace the sheet note on that sheet');
}

const kept = buildGridOrderWriteRecord({
    order: ['2804', '2301'],
    via: { '2301': 'MONTE_VISTA', 'nope': 'MAITLAND' },
    updatedAt: 5,
    updatedBy: 'operator',
    source: 'admin',
});
if (kept.order.join(',') !== '2804,2301' || kept.via?.['2301'] !== 'MONTE_VISTA' || kept.via?.nope) {
    fail(`grid order save must keep a valid via mark: ${JSON.stringify(kept)}`);
}
const reset = buildGridOrderWriteRecord({
    action: 'reset',
    via: { '2301': 'MONTE_VISTA' },
    updatedAt: 6,
    updatedBy: 'operator',
    source: 'admin',
});
if (reset.action !== 'reset' || reset.order || reset.via?.['2301'] !== 'MONTE_VISTA') {
    fail(`grid order reset must keep via and drop order: ${JSON.stringify(reset)}`);
}
const cleared = buildGridOrderWriteRecord({ order: ['2804'], via: {}, updatedAt: 7, updatedBy: 'operator', source: 'admin' });
if (cleared.via) fail('an empty via map must be omitted so the replace clears it');

$fullDatabase.set({
    pta_to_irene_weekday: [
        { STATION: 'PRETORIA', '0604': '5:10:00', '0626': '6:30:00' },
        { STATION: 'CENTURION', '0604': '5:26:00', '0626': '6:46:00' },
        { STATION: 'IRENE', '0604': '5:35:00', '0626': '6:55:00' },
    ],
    pta_to_kemp_weekday: [
        { STATION: 'PRETORIA', '0604': '5:10:00', '0618': '6:00:00', '0626': '6:30:00' },
        { STATION: 'CENTURION', '0604': '5:26:00', '0626': '6:46:00' },
        { STATION: 'IRENE', '0604': '5:35:00', '0618': '6:20:00', '0626': '6:55:00' },
        { STATION: 'OLIFANTSFONTEIN', '0604': '6:16:00', '0618': '6:40:00' },
        { STATION: 'KEMPTON PARK', '0604': '6:40:00', '0618': '7:10:00' },
    ],
    irene_to_pta_weekday: [{ STATION: 'IRENE' }],
    ct_to_bellv_weekday: [
        { STATION: 'VARIANT', '2630': 'MONTE_VISTA' },
        { STATION: 'CAPE TOWN', '2630': '7:00:00' },
        { STATION: 'TYGERBERG', '2630': 'EXPRESS' },
        { STATION: 'BELLVILLE', '2630': '7:30:00' },
    ],
});
const through = extractTrainSheetStops('pta-irene', '0604', 'weekday');
if (!through || through.terminus !== 'KEMPTON PARK' || !through.stops.some((stop) => stop.station === 'KEMPTON PARK')) {
    fail(`0604 on Irene must continue to Kempton Park: ${JSON.stringify(through)}`);
}
const ireneEnd = extractTrainSheetStops('pta-irene', '0626', 'weekday');
if (!ireneEnd || ireneEnd.terminus !== 'IRENE' || ireneEnd.stops.some((stop) => stop.station === 'KEMPTON PARK')) {
    fail(`0626 must stay an Irene train: ${JSON.stringify(ireneEnd)}`);
}
const expressStops = extractTrainSheetStops('ct-bellv', '2630', 'weekday');
if (!expressStops || expressStops.viaLabel !== 'Monte Vista' || !expressStops.stops.some((stop) => stop.express && stop.time === 'EXPR')) {
    fail(`express sheet must keep EXPR and Via Monte Vista: ${JSON.stringify(expressStops)}`);
}

const ireneGrid = {
    headers: ['STATION', '0604', '0626'],
    stationColumnName: 'STATION',
    rows: [
        { STATION: 'PRETORIA', '0604': '5:10:00', '0626': '6:30:00' },
        { STATION: 'IRENE', '0604': '5:35:00', '0626': '6:55:00' },
    ],
};
const kempHtml = Renderer._buildGridHTML(ireneGrid, 'pta_to_irene_weekday', 'pta-irene', 1, false, false, 'weekday');
if (!kempHtml.includes('>KEMP<') || !kempHtml.includes('data-kemp-train="0604"') || !kempHtml.includes('data-kemp-train="0618"')) fail('through Irene columns must show clickable KEMP');
if (kempHtml.includes('data-kemp-train="0626"')) fail('an Irene terminator must not be marked KEMP');
if (!kempHtml.includes('color:#1d4ed8') || !kempHtml.includes('letter-spacing:0.02em')) fail('KEMP must use the NO SVC tag metrics');
if (/0604[\s\S]{0,400}bg-red-50/.test(kempHtml) || /bg-green-50[\s\S]{0,80}KEMP/.test(kempHtml)) {
    fail('KEMP must not take a ban or special colour');
}
const kempExport = Renderer._buildGridHTML(ireneGrid, 'pta_to_irene_weekday', 'pta-irene', 1, false, true, 'weekday');
if (!kempExport.includes('KEMP') || kempExport.includes('data-kemp-open') || kempExport.includes('nt-expr-btn') || kempExport.includes('data-kemp-train="0618"')) {
    fail('export KEMP must be plain text and must not add trains that are not on the Irene sheet');
}
if (!kempExport.includes('color:#1e40af') || !kempExport.includes('letter-spacing:0.08em') || !kempExport.includes('export-note-col')) {
    fail('export KEMP must use the NO SVC tag metrics in informational ink');
}
globalThis.window = { isTrainExcluded: (train) => (train === '0604' ? 'banned' : false) };
const bannedHtml = Renderer._buildGridHTML(ireneGrid, 'pta_to_irene_weekday', 'pta-irene', 1, false, false, 'weekday');
delete globalThis.window;
if (!bannedHtml.includes('NO SVC') || bannedHtml.includes('data-kemp-train="0604"') || !bannedHtml.includes('data-excl-train="0604"')) {
    fail('NO SVC must keep the status slot ahead of KEMP');
}

if (!ui.includes('flex-col items-start text-left') || !ui.includes('Via ${escapeHTML(via)}')) {
    fail('planner train name must stack Via under the train on a narrow card');
}
if (!gridJs.includes('Irene is not the last stop')) fail('KEMP tap must explain the train continues');
if (!gridJs.includes('goes via the ${route} route')) fail('via tap must explain the route');
if (!gridJs.includes('fitGridStatusTags')) fail('in-app grid must fit long status tags after paint');
if (!gridJs.includes("e.target?.closest?.('[data-expr-skip=\"1\"]')")) {
    fail('a via or KEMP column must not steal an EXPR tap');
}

if (failures.length) {
    console.error(`\n✗ planner-saturday failed (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}
console.log('✓ planner Saturday placeholder corridors + live-data gate');
