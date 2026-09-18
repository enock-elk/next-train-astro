/**
 * Route-page SEO + OG column-order checks.
 *
 * Library tests (no dist): weekday grids from full-database.json follow
 * MANUAL_GRID_ORDER; first/last trains exist for flagship OD corridors.
 * HTML tests (after astro build): light first-paint, destA-first 2026 titles,
 * schedule/PRASA/fare/train-number meta, From X towards Y grids, fare table,
 * real <table> times, FAQPage JSON-LD, crawlable home/guide links.
 *
 * Usage: node scripts/verify-route-seo.mjs [distDir]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANUAL_GRID_ORDER, orderGridTrainIds } from '../src/lib/grid-order.js';
import { ROUTES } from '../src/lib/config.js';
import {
  listFeaturedSeoRoutes,
  listSeoRoutes,
  getSeoRouteBySlug,
  stationLabel,
  slugifyStation,
  gridStationLabel,
  listWcPublicHolidayDays,
  wcRoutesWithHolidaySheets,
  WC_PUBLIC_HOLIDAYS_PATH,
  WC_PUBLIC_HOLIDAYS_SLUG,
} from '../src/lib/seo-routes.js';
import {
  buildRouteSeoTimetable,
  bidirectionalTitle,
  corridorPairLabel,
  directionPhrase,
  directionGridHeading,
  routeDocumentTitle,
  routeMetaDescription,
  buildRouteFareTable,
  resolveRouteZone,
  ogTimetableImageUrl,
  getSheet,
  loadScheduleDump,
  buildRouteGridAppPath,
  buildRouteBoardAppPath,
  corridorStationList,
  seoTrainIdSample,
  SEO_SCHEDULE_YEAR,
} from '../src/lib/seo-timetable.js';
import { listSeoAppPreviews, seoPreviewImageAbsPath } from '../src/lib/seo-app-previews.js';
import { extractGridPreview } from '../workers/nexttrain-og/src/schedule.js';

const DIST = process.argv[2] || 'dist';
const failures = [];
const fail = (msg) => failures.push(msg);

const FLAGSHIP = [
  { id: 'jhb-soweto', slug: 'johannesburg-to-naledi' },
  { id: 'pta-mabopane', slug: 'pretoria-to-mabopane' },
  { id: 'pta-pien', slug: 'pretoria-to-pienaarspoort' },
  { id: 'pta-saul', slug: 'pretoria-to-saulsville' },
  { id: 'pta-kempton', slug: 'pretoria-to-kempton-park' },
];

const GHOST_STATIONS = [
  'Fonteine',
  'Kloofsig',
  'Pinedene',
  'Leralla',
  'Limindlela',
  'Tembisa',
  'Kaalfontein',
  'Birchleigh',
  'Van Riebeeckpark',
  'Isando',
];

for (const { id, slug } of FLAGSHIP) {
  const route = ROUTES[id];
  if (!route) {
    fail(`missing ROUTES['${id}']`);
    continue;
  }
  const entry = getSeoRouteBySlug(slug);
  if (!entry || entry.route.id !== id) fail(`SEO slug ${slug} should map to ${id}`);

  const tt = buildRouteSeoTimetable(route);
  if (!tt.hasWeekday) fail(`${id} has no weekday SSG grid from the dump`);
  const towardB = tt.weekday.b;
  const towardA = tt.weekday.a;
  if (!towardB?.first || !towardB?.last) fail(`${id} weekday to ${tt.dest} missing first/last`);
  if (!towardA?.first || !towardA?.last) fail(`${id} weekday to ${tt.origin} missing first/last`);
  if (!towardB?.cells?.length || towardB.cells.length !== towardB.stations.length) {
    fail(`${id} weekday-B grid rows/stations mismatch`);
  }
  // Ghost / coordinate-only rows are dropped; remaining stop list must still be real.
  if (towardB && towardB.stations.length < 5) fail(`${id} weekday-B unexpectedly short (${towardB.stations.length} stations)`);
  if (towardB?.heading && towardB.heading !== directionGridHeading(tt.origin, tt.dest)) {
    fail(`${id} weekday-B heading should be "${directionGridHeading(tt.origin, tt.dest)}", got "${towardB.heading}"`);
  }
  if (seoTrainIdSample(tt).length < 1) fail(`${id} SEO meta train sample is empty`);

  const sheetB = route.sheetKeys.weekday_to_b;
  const manual = MANUAL_GRID_ORDER[sheetB];
  if (manual && towardB) {
    const orderedPrefix = orderGridTrainIds(sheetB, towardB.trainIds).slice(0, Math.min(8, towardB.trainIds.length));
    const actualPrefix = towardB.trainIds.slice(0, orderedPrefix.length);
    if (JSON.stringify(orderedPrefix) !== JSON.stringify(actualPrefix)) {
      fail(`${id} weekday-B columns are not MANUAL_GRID_ORDER (${sheetB})`);
    }
    const firstManualPresent = manual.find((t) => towardB.trainIds.includes(t));
    if (firstManualPresent && towardB.trainIds[0] !== firstManualPresent) {
      fail(`${id} first column ${towardB.trainIds[0]} != first present manual ${firstManualPresent}`);
    }
  }
}

{
  const pien = buildRouteSeoTimetable(ROUTES['pta-pien']);
  if (pien.weekday.a?.heading !== 'From Pienaarspoort towards Pretoria') {
    fail(`pta-pien weekday-A heading is "${pien.weekday.a?.heading}"`);
  }
  if (pien.weekday.b?.heading !== 'From Pretoria towards Pienaarspoort') {
    fail(`pta-pien weekday-B heading is "${pien.weekday.b?.heading}"`);
  }
}

{
  const previews = listSeoAppPreviews();
  const seoRoutes = listSeoRoutes();
  if (previews.length !== seoRoutes.length) {
    fail(`seo app previews (${previews.length}) must cover every SEO route (${seoRoutes.length})`);
  }
  const pienPreview = previews.find((item) => item.routeId === 'pta-pien');
  if (!pienPreview || !/devenish/i.test(pienPreview.stationRaw || '')) {
    fail('Pienaarspoort preview station must stay Devenish Street');
  }
  for (const preview of previews) {
    if (!preview.stationRaw) fail(`${preview.routeId} preview is missing a station`);
    if (!preview.image.includes(`${preview.routeId}-live-board.webp`)) {
      fail(`${preview.routeId} preview image path must be route-specific`);
    }
    const imagePath = seoPreviewImageAbsPath(preview.routeId);
    if (!existsSync(imagePath)) fail(`missing SEO preview image ${imagePath}`);
  }
}

const featured = listFeaturedSeoRoutes();
if (featured.length < 6) fail(`expected ≥6 featured SEO routes, found ${featured.length}`);
if (!featured.some((e) => e.route.id === 'jhb-soweto')) fail('featured list must include Naledi (jhb-soweto)');

if (stationLabel('JOHANNESBURG STATION') !== 'Johannesburg') {
  fail(`stationLabel JOHANNESBURG STATION is "${stationLabel('JOHANNESBURG STATION')}"`);
}
if (stationLabel('JOHANNESBURG') !== 'Johannesburg') {
  fail(`stationLabel JOHANNESBURG is "${stationLabel('JOHANNESBURG')}"`);
}
if (stationLabel('PRETORIA-N') !== 'Pretoria North') {
  fail(`stationLabel PRETORIA-N is "${stationLabel('PRETORIA-N')}"`);
}
if (stationLabel('PRETORIA WES') !== 'Pretoria West') {
  fail(`stationLabel PRETORIA WES is "${stationLabel('PRETORIA WES')}"`);
}
if (stationLabel('DURBAN YARD') !== 'Durban') {
  fail(`stationLabel DURBAN YARD (terminus) should stay Durban, got "${stationLabel('DURBAN YARD')}"`);
}
if (gridStationLabel('DURBAN YARD') !== 'Durban Yard') {
  fail(`gridStationLabel DURBAN YARD should be Durban Yard, got "${gridStationLabel('DURBAN YARD')}"`);
}
if (gridStationLabel('DURBAN') !== 'Durban') {
  fail(`gridStationLabel DURBAN should be Durban, got "${gridStationLabel('DURBAN')}"`);
}
if (gridStationLabel('WALTOO') !== 'Waltloo') {
  fail(`gridStationLabel WALTOO should be Waltloo, got "${gridStationLabel('WALTOO')}"`);
}
if (slugifyStation('JOHANNESBURG STATION') !== 'johannesburg') {
  fail(`slugifyStation must stay johannesburg, got "${slugifyStation('JOHANNESBURG STATION')}"`);
}
if (slugifyStation('PRETORIA-N') !== 'pretoria-north') {
  fail(`slugifyStation PRETORIA-N must be pretoria-north, got "${slugifyStation('PRETORIA-N')}"`);
}
if (slugifyStation('PRETORIA WES') !== 'pretoria-west') {
  fail(`slugifyStation PRETORIA WES must be pretoria-west, got "${slugifyStation('PRETORIA WES')}"`);
}

const title = bidirectionalTitle('Johannesburg', 'Naledi');
if (title !== `Johannesburg to Naledi ${SEO_SCHEDULE_YEAR} Train Times`) {
  fail(`destA-first title is "${title}"`);
}
if (/to .+ & .+ to /i.test(title)) {
  fail(`title must not stuff both "X to Y & Y to X": "${title}"`);
}
if (corridorPairLabel('Durban', 'Umlazi') !== 'Durban to Umlazi') {
  fail('corridor pair should be Durban to Umlazi');
}
if (directionPhrase('Pretoria', 'Mabopane') !== 'Pretoria to Mabopane') {
  fail('directionPhrase should be "Pretoria to Mabopane"');
}
const docTitle = routeDocumentTitle('Pretoria', 'Mabopane');
if (!docTitle.startsWith(`Pretoria to Mabopane ${SEO_SCHEDULE_YEAR} Train Times |`)) {
  fail(`document title is "${docTitle}"`);
}
if (docTitle.includes('Mabopane to Pretoria')) {
  fail('document title must keep in-app destA-first order');
}
const meta = routeMetaDescription('Pretoria', 'Mabopane', 'Gauteng', {
  trainIds: ['1810', '1818'],
  maxSingle: 'R12.00',
});
if (!meta.includes('Pretoria to Mabopane')) fail(`meta must use in-app route name: "${meta}"`);
if (!/schedule/i.test(meta)) fail(`meta must include schedule: "${meta}"`);
if (!/PRASA/i.test(meta) || !/Metrorail/i.test(meta)) fail(`meta must name PRASA and Metrorail: "${meta}"`);
if (!/Updated/i.test(meta) || !/Current trains/i.test(meta)) fail(`meta must say updated/current: "${meta}"`);
if (!meta.includes('1810') || !meta.includes('1818')) fail(`meta must list train numbers: "${meta}"`);
if (!/ticket prices/i.test(meta) && !/Max adult single/i.test(meta)) {
  fail(`meta must mention ticket prices: "${meta}"`);
}
if (!/next train/i.test(meta) || !/trip planner/i.test(meta)) {
  fail(`meta must mention Next Train features: "${meta}"`);
}
if (/Mabopane to Pretoria/.test(meta)) {
  fail(`meta must not rename the corridor as Mabopane to Pretoria: "${meta}"`);
}
if (meta.includes(' & Mabopane to')) {
  fail('meta description should not use the stuffed & title form');
}
const metaSat = routeMetaDescription('Pretoria', 'Mabopane', 'Gauteng', { hasSaturday: true, trainIds: ['1810'] });
if (!/saturday/i.test(metaSat) || !/sunday/i.test(metaSat)) {
  fail(`Saturday meta should mention Saturday and Sunday: "${metaSat}"`);
}
const capeMeta = routeMetaDescription('Cape Town', 'Bellville', 'Western Cape', { hasSaturday: true });
if (!/Cape Town to Bellville/i.test(capeMeta) || !/train schedule/i.test(capeMeta)) {
  fail(`Cape Town meta should lead with Cape Town to Bellville schedule: "${capeMeta}"`);
}

{
  const indexAstro = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  const faqLine = 'Commuters can send a delay note, and some testers can share a trip location.';
  if (!indexAstro.includes(faqLine)) {
    fail('homepage FAQ JSON-LD must include the delay-note sentence');
  }
  if (!indexAstro.includes('Delay notes, Optional trip sharing')) {
    fail('homepage SoftwareApplication featureList must include Delay notes and Optional trip sharing');
  }
  const guideAstro = readFileSync(new URL('../src/pages/guide.astro', import.meta.url), 'utf8');
  if (!guideAstro.includes(faqLine)) {
    fail('guide.astro must use the same delay-note sentence as the homepage FAQ');
  }
}

{
  const mabZone = resolveRouteZone(ROUTES['pta-mabopane']);
  if (mabZone.code !== 'Z2' || mabZone.inferred) {
    fail(`pta-mabopane zone should be Z2 from dump, got ${JSON.stringify(mabZone)}`);
  }
  const fares = buildRouteFareTable(ROUTES['pta-mabopane']);
  const labels = fares.tickets.map((t) => t.label);
  if (
    !labels.includes('Single') ||
    !labels.includes('Return') ||
    !labels.includes('Weekly Mon–Fri') ||
    !labels.includes('Weekly Mon–Sat') ||
    !labels.includes('Monthly')
  ) {
    fail(`fare table missing a ticket type: ${labels.join(', ')}`);
  }
  if (fares.tickets.length !== 5) fail(`fare table should have 5 tickets, got ${fares.tickets.length}`);
}
const og = ogTimetableImageUrl('jhb-soweto', 'A');
if (!og.includes('/og/timetable.png') || !og.includes('rt=jhb-soweto') || !og.includes('d=wd')) {
  fail(`og timetable url looks wrong: ${og}`);
}

const gridPathB = buildRouteGridAppPath('pta-kempton', 'B', 'weekday');
if (!gridPathB.includes('rt=pta-kempton') || !gridPathB.includes('v=g') || !gridPathB.includes('dir=B') || !gridPathB.includes('d=wd')) {
  fail(`live grid path looks wrong: ${gridPathB}`);
}
if (!gridPathB.includes('r=GP')) fail(`live grid path must include region: ${gridPathB}`);
const boardPath = buildRouteBoardAppPath('herc-koed');
if (!boardPath.includes('rt=herc-koed') || !boardPath.includes('r=GP') || boardPath.includes('v=g')) {
  fail(`live board path must be ?rt=herc-koed&r=GP without grid view: ${boardPath}`);
}
const gridPathSa = buildRouteGridAppPath('pta-kempton', 'A', 'saturday');
if (!gridPathSa.includes('d=sa') || gridPathSa.includes('dir=')) {
  fail(`Saturday dir-A grid path looks wrong: ${gridPathSa}`);
}

{
  const mabStops = corridorStationList(buildRouteSeoTimetable(ROUTES['pta-mabopane']));
  if (!mabStops.some((s) => s === 'Pretoria North')) fail('pta-mabopane station list missing Pretoria North');
  if (!mabStops.some((s) => s === 'Pretoria West')) fail('pta-mabopane station list missing Pretoria West');
  if (mabStops.some((s) => /^PRETORIA-N$/i.test(s) || /^Pretoria-N$/i.test(s))) {
    fail('pta-mabopane still lists dump key Pretoria-N');
  }
}

{
  const guideSrc = readFileSync(new URL('../src/pages/guide.astro', import.meta.url), 'utf8');
  if (!guideSrc.includes('isSeoLanding') || !guideSrc.includes('__ntOpenSeoPage')) {
    fail('guide.html must open SEO landings instead of closing onto the pinned board');
  }
  if (/isAppHome \|\| \/\\\/routes/.test(guideSrc)) {
    fail('guide.html still closes the in-app sheet for /routes/ links');
  }
  const hubSrc = readFileSync(new URL('../src/lib/hub.js', import.meta.url), 'utf8');
  if (!hubSrc.includes('window.__ntOpenSeoPage')) fail('hub must expose __ntOpenSeoPage for guide SEO links');
  const layout = readFileSync(new URL('../src/layouts/ContentLayout.astro', import.meta.url), 'utf8');
  if (!layout.includes("seo_page_view")) fail('ContentLayout must fire seo_page_view');
  if (layout.includes("View_astro_pages")) fail('ContentLayout must not fire View_astro_pages as a second SEO event');
  if (!layout.includes('trackSeo')) fail('ContentLayout can skip SEO events on map/guide');
  if (!layout.includes('za.co.nexttrain.app')) fail('ContentLayout must detect Play Store TWA package');
  const mapSrc = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
  const guideSrcTrack = readFileSync(new URL('../src/pages/guide.astro', import.meta.url), 'utf8');
  if (!mapSrc.includes('trackSeo={false}')) fail('map.astro must set trackSeo={false}');
  if (!guideSrcTrack.includes('trackSeo={false}')) fail('guide.astro must set trackSeo={false}');
}

{
  if (ROUTES['ct-flats']?.name !== 'Cape Town <-> Retreat') {
    fail(`ct-flats name should be Cape Town <-> Retreat, got "${ROUTES['ct-flats']?.name}"`);
  }
  if (/\(Cape Flats\)/.test(String(ROUTES['ct-flats']?.name || ''))) {
    fail('ct-flats route name must not keep the Cape Flats suffix');
  }

  const days = listWcPublicHolidayDays(2026);
  if (days.length < 10) fail(`expected WC holiday calendar rows, got ${days.length}`);
  const xmas = days.find((d) => d.md === '12-25');
  if (!xmas || xmas.runs) fail('Christmas Day must be listed as no Metrorail service');
  const nye = days.find((d) => d.md === '01-01');
  if (!nye || !nye.runs || nye.dayType !== 'public_holiday') {
    fail('New Year\'s Day must use the Western Cape Public Holiday timetable');
  }
  const womens = days.find((d) => d.md === '08-09');
  if (!womens || womens.runs) fail("National Women's Day 2026 must be no service");

  const wcHol = wcRoutesWithHolidaySheets();
  if (wcHol.length < 5) fail(`expected several WC routes with *_pub sheets, got ${wcHol.length}`);
  if (wcHol.some(({ route }) => route.region !== 'WC')) fail('holiday sheets must be WC-only');
  if (wcHol.some(({ route }) => !route.sheetKeys?.pub_to_a || !route.sheetKeys?.pub_to_b)) {
    fail('wcRoutesWithHolidaySheets must require both pub_to_a and pub_to_b');
  }
  if (WC_PUBLIC_HOLIDAYS_PATH !== 'regions/western-cape-public-holidays.html') {
    fail(`WC holiday path is ${WC_PUBLIC_HOLIDAYS_PATH}`);
  }
  if (WC_PUBLIC_HOLIDAYS_SLUG !== 'western-cape-public-holidays') {
    fail(`WC holiday slug is ${WC_PUBLIC_HOLIDAYS_SLUG}`);
  }

  const holidayPage = readFileSync(new URL('../src/pages/regions/western-cape-public-holidays.astro', import.meta.url), 'utf8');
  if (!holidayPage.includes('Western Cape public holiday timetable')) {
    fail('WC holiday landing missing H1 copy');
  }
  if (!holidayPage.includes('seoPageType="region_holidays"')) {
    fail('WC holiday landing must tag seoPageType region_holidays');
  }
  const regionSrc = readFileSync(new URL('../src/pages/regions/[slug].astro', import.meta.url), 'utf8');
  if (!regionSrc.includes('WC_PUBLIC_HOLIDAYS_PATH') || !regionSrc.includes('Public holidays')) {
    fail('WC region hub must link the public holiday timetable');
  }
  const routesIndex = readFileSync(new URL('../src/pages/routes.astro', import.meta.url), 'utf8');
  if (!routesIndex.includes('WC_PUBLIC_HOLIDAYS_PATH')) {
    fail('routes.html must link the WC public holiday timetable');
  }
  const routePage = readFileSync(new URL('../src/pages/routes/[slug].astro', import.meta.url), 'utf8');
  if (!routePage.includes('route.region === \'WC\'') && !routePage.includes('route.region === "WC"')) {
    fail('route landings must only link WC holidays on WC corridors');
  }
  if (!routePage.includes('<SeoAppPreview routeId={route.id} href={liveBoardHref} />')) {
    fail('route landings must select app previews by route id');
  }
  const appPreview = readFileSync(new URL('../src/components/SeoAppPreview.astro', import.meta.url), 'utf8');
  if (!appPreview.includes('getSeoAppPreview') || !appPreview.includes('preview.image')) {
    fail('app preview catalog must map screenshots by route id');
  }
  if (!appPreview.includes('sm:grid-cols-') || !appPreview.includes('max-w-[15rem]')) {
    fail('app preview must adapt from stacked mobile to capped desktop columns');
  }
  if (!appPreview.includes('loading="lazy"') || !appPreview.includes('width="435"') || !appPreview.includes('height="807"')) {
    fail('route screenshot must be lazy-loaded with fixed intrinsic dimensions');
  }
  const cross = readFileSync(new URL('../src/components/SeoCrossLinks.astro', import.meta.url), 'utf8');
  if (!cross.includes('More timetable pages')) fail('SeoCrossLinks missing internal-link nav');
  if (!cross.includes("region === 'WC'")) fail('SeoCrossLinks must keep the holiday link WC-only');
}

{
  const id = 'pta-kempton';
  const route = ROUTES[id];
  const tt = buildRouteSeoTimetable(route);
  const towardA = tt.weekday.a;
  const towardB = tt.weekday.b;
  if (!towardA) fail('pta-kempton weekday-A is null (first-row-only / ghost origin)');
  if (!towardB) fail('pta-kempton weekday-B is null');

  const dump = loadScheduleDump();
  const IGNORE = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);
  const sheetA = getSheet(dump, route.sheetKeys.weekday_to_a) || [];
  const dataA = sheetA.filter((r) => r && r.STATION && !/^Last Updated/i.test(String(r.STATION)) && String(r.STATION).toUpperCase() !== 'STATION');
  const firstRowIds = Object.keys(dataA[0] || {}).filter((k) => !IGNORE.has(k));
  if (!towardA || towardA.trainIds.length <= firstRowIds.length) {
    fail(
      `pta-kempton weekday-A must union train IDs (got ${towardA?.trainIds.length || 0} cols vs first-row ${firstRowIds.length})`
    );
  }
  if (dataA.length && towardA && towardA.stations.length >= dataA.length) {
    fail(`pta-kempton weekday-A should drop ghost rows (${towardA.stations.length} kept of ${dataA.length} dump rows)`);
  }

  const sheetB = getSheet(dump, route.sheetKeys.weekday_to_b) || [];
  const dataB = sheetB.filter((r) => r && r.STATION && !/^Last Updated/i.test(String(r.STATION)) && String(r.STATION).toUpperCase() !== 'STATION');
  if (dataB.length && towardB && towardB.stations.length >= dataB.length) {
    fail(`pta-kempton weekday-B should drop ghost rows (${towardB.stations.length} kept of ${dataB.length} dump rows)`);
  }

  for (const grid of [towardA, towardB]) {
    if (!grid) continue;
    for (const ghost of GHOST_STATIONS) {
      if (grid.stations.some((s) => s.toLowerCase() === ghost.toLowerCase())) {
        fail(`pta-kempton still lists ghost station ${ghost}`);
      }
    }
  }

  const ireneIdx = towardB.stations.findIndex((s) => /irene/i.test(s));
  const kempIdx = towardB.stations.findIndex((s) => /kempton/i.test(s));
  if (ireneIdx < 0) fail('pta-kempton weekday-B missing Irene');
  if (kempIdx < 0) fail('pta-kempton weekday-B missing Kempton Park');
  const hasClock = (row) => (row || []).some((c) => /\d{1,2}:\d{2}/.test(String(c || '')));
  if (ireneIdx >= 0 && !hasClock(towardB.cells[ireneIdx])) {
    fail('pta-kempton weekday-B Irene row has no clock times (columns not unioned / stale sheet)');
  }
  if (kempIdx >= 0 && !hasClock(towardB.cells[kempIdx])) {
    fail('pta-kempton weekday-B Kempton Park row has no clock times');
  }

  const originA = (towardA.originStation || '').toLowerCase();
  if (towardA && !/kempton/.test(originA)) {
    fail(`pta-kempton weekday-A origin should be Kempton Park, got "${towardA.originStation}"`);
  }
}

// OG worker extractGridPreview must use the same column order (cap after sort).
{
  const route = ROUTES['pta-pien'];
  const dump = JSON.parse(readFileSync(new URL('../public/data/full-database.json', import.meta.url), 'utf8'));
  const preview = extractGridPreview(dump, route, 'B', 'weekday');
  const sheet = route.sheetKeys.weekday_to_b;
  const expected = orderGridTrainIds(sheet, preview?.trainIds || []).slice(0, preview?.trainIds?.length || 0);
  if (!preview?.trainIds?.length) fail('OG extractGridPreview returned no trains for pta-pien dir B weekday');
  else if (JSON.stringify(preview.trainIds) !== JSON.stringify(expected)) {
    fail(
      `OG extractGridPreview column order != MANUAL_GRID_ORDER (first actual ${preview.trainIds.slice(0, 5).join(',')} vs ${expected.slice(0, 5).join(',')})`
    );
  }
}

{
  if (!ROUTES['kzn-crossmoor']) fail('ROUTES missing kzn-crossmoor');
  const crossKeys = Object.values(ROUTES['kzn-crossmoor'].sheetKeys || {});
  for (const key of crossKeys) {
    if (!MANUAL_GRID_ORDER[key]) fail(`MANUAL_GRID_ORDER missing Crossmoor sheetKey ${key}`);
  }
  const weekdayB = orderGridTrainIds('durbn_to_cross_weekday', ['9999', '9652']);
  if (weekdayB[0] !== '9652') fail(`Crossmoor weekday-B should lead with 9652, got ${weekdayB[0]}`);
  const hyphenSat = orderGridTrainIds('durbn-to-cross_sat', ['9680', '9612']);
  if (hyphenSat[0] !== '9612') fail('hyphen Config key durbn-to-cross_sat should alias to MANUAL_GRID_ORDER');
  const bridge = ROUTES['kzn-bridgecity'];
  const dump = JSON.parse(readFileSync(new URL('../public/data/full-database.json', import.meta.url), 'utf8'));
  const sheetA = bridge?.sheetKeys?.weekday_to_a;
  if (sheetA && !MANUAL_GRID_ORDER[sheetA]) fail(`${sheetA} should be in MANUAL_GRID_ORDER (underscore alias of Config hyphen key)`);
  const preview = bridge ? extractGridPreview(dump, bridge, 'A', 'weekday') : null;
  if (!preview?.trainIds?.length) fail('kzn-bridgecity weekday-A OG preview is empty');
  else {
    const data = (dump.kzn?.[sheetA] || dump[sheetA] || []).filter(
      (r) => r && r.STATION && !/^Last Updated/i.test(String(r.STATION))
    );
    const IGNORE = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);
    const union = [];
    const seen = new Set();
    for (const row of data) {
      for (const k of Object.keys(row || {})) {
        if (IGNORE.has(k) || seen.has(k)) continue;
        seen.add(k);
        union.push(k);
      }
    }
    const ordered = orderGridTrainIds(sheetA, union, data);
    if (JSON.stringify(preview.trainIds) !== JSON.stringify(ordered.slice(0, preview.trainIds.length))) {
      fail('kzn-bridgecity OG trainIds do not match earliest-time orderGridTrainIds');
    }
  }
}

{
  const id = 'kzn-umlazi';
  const route = ROUTES[id];
  if (!route) fail('ROUTES missing kzn-umlazi');
  else {
    const tt = buildRouteSeoTimetable(route);
    const towardB = tt.weekday.b;
    const towardA = tt.weekday.a;
    const durbanCount = (towardB?.stations || []).filter((s) => s === 'Durban').length;
    if (!towardB?.stations?.includes('Durban Yard')) fail('kzn-umlazi weekday-B missing Durban Yard');
    if (!towardB?.stations?.includes('Durban')) fail('kzn-umlazi weekday-B missing Durban');
    if (durbanCount !== 1) fail(`kzn-umlazi weekday-B should have one Durban row, got ${durbanCount}`);
    if (towardB.last === '11:22') fail('kzn-umlazi first/last still uses Durban Yard origin last 11:22');
    if (towardB.first !== '6:15' || towardB.last !== '21:17') {
      fail(`kzn-umlazi dest-row first/last should be 6:15/21:17, got ${towardB.first}/${towardB.last}`);
    }
    if (towardA?.first !== '5:15' || towardA?.last !== '21:45') {
      fail(`kzn-umlazi weekday-A dest Durban first/last should be 5:15/21:45, got ${towardA?.first}/${towardA?.last}`);
    }
  }
}

{
  const entry = getSeoRouteBySlug('pretoria-to-pienaarspoort');
  if (!entry?.seed?.serves) fail('pta-pien seed missing serves commentary');
  else {
    if (!/Loftus Versfeld/i.test(entry.seed.serves)) fail('pta-pien serves must mention Loftus Versfeld');
    if (!/University of Pretoria/i.test(entry.seed.serves)) fail('pta-pien serves must mention University of Pretoria');
    if (!/Mamelodi/i.test(entry.seed.serves)) fail('pta-pien serves must mention Mamelodi');
    if (!/Denneboom/i.test(entry.seed.serves)) fail('pta-pien serves must mention Denneboom');
    if (!/Eerste Fabrieke/i.test(entry.seed.serves)) fail('pta-pien serves must mention Eerste Fabrieke');
    if (!/Silverton/i.test(entry.seed.serves)) fail('pta-pien serves must mention Silverton');
    if (!/Eersterust/i.test(entry.seed.serves)) fail('pta-pien serves must mention Eersterust area');
    if (!/not in service/i.test(entry.seed.serves)) fail('pta-pien serves must say Eersterust is not in service');
  }
  const umlazi = getSeoRouteBySlug('durban-to-umlazi');
  if (!umlazi?.seed?.serves) fail('kzn-umlazi seed missing serves commentary');
  else if (!/Durban Yard/i.test(umlazi.seed.serves) || !/\bDurban\b/i.test(umlazi.seed.serves)) {
    fail('kzn-umlazi serves must distinguish Durban Yard and Durban');
  }
  const metaPien = routeMetaDescription('Pretoria', 'Pienaarspoort', 'Gauteng', { nearby: entry.seed.nearby });
  if (!/Loftus/i.test(metaPien)) fail(`pta-pien meta should reuse nearby clause: "${metaPien}"`);
}

if (existsSync(DIST)) {
  const naledi = join(DIST, 'routes/johannesburg-to-naledi.html');
  if (!existsSync(naledi)) {
    fail('dist missing routes/johannesburg-to-naledi.html — run the build');
  } else {
    const html = readFileSync(naledi, 'utf8');
    if (/<html[^>]*class="[^"]*\bdark\b/.test(html)) {
      fail('Naledi route page first paint has html.dark (want forceLight)');
    }
    if (!html.includes('forceLight') && !html.includes('Naledi to Johannesburg')) {
      /* forceLight is a build prop; the title is the crawler-visible signal */
    }
    if (!html.includes('Johannesburg to Naledi') && !html.includes('From Naledi towards Johannesburg')) {
      fail('Naledi route HTML must mention Johannesburg as a terminus');
    }
    if (!html.includes('From Johannesburg towards Naledi')) {
      fail('Naledi route HTML must name trains from Johannesburg towards Naledi');
    }
    if (!html.includes(`Johannesburg to Naledi ${SEO_SCHEDULE_YEAR} Train Times`)) {
      fail('Naledi route H1/title should use Johannesburg to Naledi 2026 Train Times');
    }
    if (!html.includes('Metrorail (PRASA)')) {
      fail('Naledi route HTML must name Metrorail (PRASA)');
    }
    if (!html.includes('Current trains')) {
      fail('Naledi route SERP description must list current train numbers');
    }
    if (html.includes('Johannesburg Park Station')) {
      fail('Naledi route HTML must not say Johannesburg Park Station');
    }
    if (/Johannesburg to Naledi &amp; Naledi to Johannesburg/.test(html) || /Johannesburg to Naledi & Naledi to Johannesburg/.test(html)) {
      fail('Naledi route HTML still uses the stuffed both-direction title');
    }
    if (!html.includes('data-seo-fares') || !html.includes('Maximum fares') || !html.includes('Weekly Mon–Fri')) {
      fail('Naledi route HTML missing the max fare table');
    }
    if (!html.includes('Open Next Train · Gauteng')) {
      fail('Naledi route HTML missing header Open Next Train · Gauteng');
    }
    if (html.includes('seo-theme-toggle') || html.includes('SeoThemeToggle')) {
      fail('Naledi route HTML must not include the SEO dark-mode toggle');
    }
    if (/<header[\s\S]{0,1200}<img[\s\S]{0,400}icon-48/.test(html)) {
      fail('SEO header must not use the 40×40 logo mark');
    }
    if (!html.includes('rel="icon"') || !html.includes('icons/icon-48.png')) {
      fail('Naledi route HTML missing 48×48 favicon');
    }
    if (!html.includes('>Corridor<') && !html.includes('>Corridor</')) {
      fail('Naledi route metadata should list Corridor, not exclusive Origin/Destination');
    }
    if (/<dt[^>]*>Origin<\/dt>/.test(html) || />Origin<\/dt>/.test(html)) {
      fail('Naledi route metadata still lists exclusive Origin');
    }
    if (!html.includes('<table')) fail('Naledi route HTML has no <table> timetable');
    {
      const tableIdx = html.indexOf('<table');
      const whenIdx = html.indexOf('When trains run');
      if (tableIdx < 0 || whenIdx < 0 || tableIdx > whenIdx) {
        fail('Naledi weekday <table> must appear before When trains run');
      }
    }
    if (!html.includes('FAQPage')) fail('Naledi route HTML missing FAQPage JSON-LD');
    if (!html.includes('/og/timetable.png')) fail('Naledi route HTML missing og:image timetable PNG');
    if (!html.includes('summary_large_image')) fail('Naledi route HTML should use summary_large_image');
    if (!html.includes('Weekday first')) fail('Naledi route HTML missing first/last weekday blurb');
    if (!html.includes('When trains run')) fail('Naledi route HTML missing When trains run box');
    if (!html.includes('For more info')) fail('Naledi route HTML missing For more info');
    if (/Need holiday rules/.test(html)) fail('Naledi route HTML still says Need holiday rules');
    if (!html.includes('rt=jhb-soweto')) fail('Naledi Open live timetable must deep-link ?rt=jhb-soweto');
    // Times must be in the DOM (not a CTA-only stub).
    if (!/\d{1,2}:\d{2}/.test(html)) fail('Naledi route HTML has no clock times');
  }

  const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
  if (!indexHtml.includes('routes.html')) fail('homepage HTML has no crawlable routes.html link');
  if (!indexHtml.includes('johannesburg-to-naledi')) {
    fail('homepage HTML should link the Naledi landing');
  }
  if (!indexHtml.includes('PRASA Train Times')) {
    fail('homepage title should include PRASA Train Times');
  }
  if (!/Updated 2026 PRASA Metrorail train times and schedules/i.test(indexHtml)) {
    fail('homepage meta should lead with updated PRASA Metrorail train times and schedules');
  }
  if (!indexHtml.includes('Commuters can send a delay note, and some testers can share a trip location.')) {
    fail('homepage FAQ must mention delay notes and optional trip sharing');
  }
  if (!indexHtml.includes('Delay notes') || !indexHtml.includes('Optional trip sharing')) {
    fail('homepage SoftwareApplication featureList must include delay notes and optional trip sharing');
  }

  const guideHtml = readFileSync(join(DIST, 'guide.html'), 'utf8');
  if (!guideHtml.includes('routes.html') || !guideHtml.includes('johannesburg-to-naledi')) {
    fail('guide.html should list featured route timetables');
  }
  if (!guideHtml.includes('Commuters can send a delay note, and some testers can share a trip location.')) {
    fail('guide.html must use the same delay-note FAQ sentence');
  }

  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
  if (!/Disallow:\s*\/index\.html/.test(robots)) {
    fail('robots.txt must Disallow /index.html (homepage duplicate)');
  }

  const mab = join(DIST, 'routes/pretoria-to-mabopane.html');
  if (existsSync(mab)) {
    const html = readFileSync(mab, 'utf8');
    if (/<html[^>]*class="[^"]*\bdark\b/.test(html)) fail('Mabopane route page has html.dark');
    if (!html.includes('<table')) fail('Mabopane route HTML has no <table>');
    if (!html.includes('Pretoria North')) fail('Mabopane route HTML missing Pretoria North');
    if (!html.includes('Pretoria West')) fail('Mabopane route HTML missing Pretoria West');
    if (!html.includes('Stations on this corridor')) fail('Mabopane route HTML missing stations list');
  }

  const kemp = join(DIST, 'routes/pretoria-to-kempton-park.html');
  if (existsSync(kemp)) {
    const html = readFileSync(kemp, 'utf8');
    if (/<html[^>]*class="[^"]*\bdark\b/.test(html)) fail('Kempton route page has html.dark');
    if (!html.includes('<table')) fail('Kempton route HTML has no <table>');
    if (!html.includes('From Pretoria towards Kempton Park')) fail('Kempton route HTML missing destA-first grid heading');
    if (!html.includes('Open live timetable in Next Train')) fail('Kempton route HTML missing live-board CTA');
    if ((html.match(/Open live timetable in Next Train/g) || []).length !== 2) {
      fail('Kempton route HTML should keep exactly two “Open live timetable in Next Train” CTAs');
    }
    if (html.includes('Download and Share are there.')) {
      fail('Kempton route HTML still has per-grid Download and Share lines');
    }
    if (!html.includes('Open this weekday sheet in Next Train')) {
      fail('Kempton route HTML missing the single weekday-sheet app link');
    }
    if (!html.includes('v=g') || !html.includes('rt=pta-kempton')) {
      fail('Kempton route HTML missing in-app grid deep link (?rt=&v=g)');
    }
    if (!/\d{1,2}:\d{2}/.test(html)) fail('Kempton route HTML has no clock times');
    if (/Fonteine|Kloofsig|Pinedene/.test(html)) fail('Kempton route HTML still lists ghost stations');
    if (!/Irene/.test(html)) fail('Kempton route HTML missing Irene');
    if (!/Kempton Park/.test(html)) fail('Kempton route HTML missing Kempton Park');
  }

  const umlaziHtmlPath = join(DIST, 'routes/durban-to-umlazi.html');
  if (existsSync(umlaziHtmlPath)) {
    const html = readFileSync(umlaziHtmlPath, 'utf8');
    if (!html.includes('Durban Yard')) fail('Umlazi route HTML missing Durban Yard');
    if ((html.match(/>Durban</g) || []).length < 1) fail('Umlazi route HTML missing Durban passenger stop');
    if (/last 11:22/.test(html)) fail('Umlazi first/last still shows Yard last 11:22');
    if (!html.includes('21:17')) fail('Umlazi route HTML missing dest last 21:17');
    if (!html.includes('join along the line')) fail('Umlazi first/last copy missing joiner note');
    if (!html.includes('Durban Yard, then the passenger stop at Durban')) {
      fail('Umlazi route HTML missing Durban Yard vs Durban commentary');
    }
  }

  const pienHtmlPath = join(DIST, 'routes/pretoria-to-pienaarspoort.html');
  if (existsSync(pienHtmlPath)) {
    const html = readFileSync(pienHtmlPath, 'utf8');
    if (!html.includes('University of Pretoria')) fail('Pienaarspoort HTML missing University of Pretoria');
    if (!html.includes('Loftus Versfeld')) fail('Pienaarspoort HTML missing Loftus Versfeld');
    if (!html.includes('Mamelodi')) fail('Pienaarspoort HTML missing Mamelodi');
    if (!html.includes('Eersterust')) fail('Pienaarspoort HTML missing Eersterust area');
    if (!html.includes('not in service')) fail('Pienaarspoort HTML missing ghost-station note');
    if (!html.includes('data-seo-app-preview="pta-pien"')) fail('Pienaarspoort HTML missing its route-specific app preview');
    if (!html.includes('pta-pien-live-board.webp')) fail('Pienaarspoort HTML missing its route-specific screenshot');
    if (!/Devenish Street/i.test(html)) fail('Pienaarspoort preview alt must name Devenish Street');
  }
  for (const { seed, route } of listSeoRoutes()) {
    const htmlPath = join(DIST, `routes/${seed.slug}.html`);
    if (!existsSync(htmlPath)) continue;
    const html = readFileSync(htmlPath, 'utf8');
    if (!html.includes(`data-seo-app-preview="${route.id}"`)) {
      fail(`${seed.slug} missing data-seo-app-preview="${route.id}"`);
    }
    if (!html.includes(`${route.id}-live-board.webp`)) {
      fail(`${seed.slug} missing ${route.id}-live-board.webp`);
    }
    if (route.id !== 'pta-pien' && html.includes('pta-pien-live-board.webp')) {
      fail(`${seed.slug} must not reuse the Pienaarspoort screenshot`);
    }
  }

  const region = join(DIST, 'regions/gauteng.html');
  if (existsSync(region)) {
    const html = readFileSync(region, 'utf8');
    if (/<html[^>]*class="[^"]*\bdark\b/.test(html)) fail('Gauteng region page has html.dark');
    if (!html.includes('id="region-seo-map"')) fail('Gauteng region page missing #region-seo-map figure');
    if (/<a[^>]+href="[^"]*map\.html[^"]*"[^>]*>[\s\S]{0,800}network-map/.test(html)) {
      fail('Gauteng network map image must not be wrapped in a map.html link');
    }
    if (!html.includes('Interactive map')) fail('Gauteng region page missing Interactive map control');
    if (!html.includes('Open Next Train · Gauteng')) {
      fail('Gauteng region page missing Open Next Train · Gauteng');
    }
    if (/href="[^"]*western-cape-public-holidays/.test(html)) {
      fail('Gauteng region page must not link a Western Cape public-holiday timetable');
    }
  }

  const wcRegion = join(DIST, 'regions/western-cape.html');
  if (existsSync(wcRegion)) {
    const html = readFileSync(wcRegion, 'utf8');
    if (!html.includes('western-cape-public-holidays')) {
      fail('Western Cape region page must link the public holiday timetable');
    }
  }

  const holidayHtmlPath = join(DIST, 'regions/western-cape-public-holidays.html');
  if (existsSync(holidayHtmlPath)) {
    const html = readFileSync(holidayHtmlPath, 'utf8');
    if (!html.includes('Western Cape public holiday timetable')) {
      fail('WC holiday HTML missing the public holiday heading');
    }
    if (!html.includes('Gauteng, KwaZulu-Natal and Eastern Cape do not have a separate public-holiday timetable')) {
      fail('WC holiday HTML must say other provinces have no dedicated holiday sheet');
    }
    if (!html.includes('cape-town-to-bellville')) {
      fail('WC holiday HTML should list Cape Town to Bellville');
    }
  }

  const mapHtml = join(DIST, 'map.html');
  if (existsSync(mapHtml)) {
    const html = readFileSync(mapHtml, 'utf8');
    if (/gtag\('event', 'View_astro_pages'/.test(html)) {
      fail('map.html must not fire View_astro_pages');
    }
    if (!html.includes('const trackSeo = false')) {
      fail('map.html must compile with trackSeo false');
    }
  }
  const guideBuiltPath = join(DIST, 'guide.html');
  if (existsSync(guideBuiltPath)) {
    const html = readFileSync(guideBuiltPath, 'utf8');
    if (/gtag\('event', 'View_astro_pages'/.test(html)) {
      fail('guide.html must not fire View_astro_pages');
    }
    if (!html.includes('const trackSeo = false')) {
      fail('guide.html must compile with trackSeo false');
    }
    if (!html.includes('western-cape-public-holidays')) {
      fail('guide.html must link the Western Cape public holiday timetable');
    }
  }
} else {
  console.log(`  note: ${DIST}/ not found — skipping built-HTML asserts (library checks still ran)`);
}

if (failures.length) {
  console.error(`\n✗ route SEO check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('✓ route SEO + OG grid order OK');
