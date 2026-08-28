/**
 * Route-page SEO + OG column-order checks.
 *
 * Library tests (no dist): weekday grids from full-database.json follow
 * MANUAL_GRID_ORDER; first/last trains exist for flagship OD corridors.
 * HTML tests (after astro build): light first-paint, calm ↔ titles plus
 * both-direction body copy, fare table, real <table> times, FAQPage JSON-LD,
 * crawlable home/guide links.
 *
 * Usage: node scripts/verify-route-seo.mjs [distDir]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANUAL_GRID_ORDER, orderGridTrainIds } from '../src/lib/grid-order.js';
import { ROUTES } from '../src/lib/config.js';
import { listFeaturedSeoRoutes, getSeoRouteBySlug, stationLabel, slugifyStation } from '../src/lib/seo-routes.js';
import {
  buildRouteSeoTimetable,
  bidirectionalTitle,
  corridorPairLabel,
  directionPhrase,
  routeDocumentTitle,
  routeMetaDescription,
  buildRouteFareTable,
  resolveRouteZone,
  ogTimetableImageUrl,
  getSheet,
  loadScheduleDump,
  buildRouteGridAppPath,
  buildRouteBoardAppPath,
} from '../src/lib/seo-timetable.js';
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
  if (towardB?.heading && !/^Showing trains to /.test(towardB.heading)) {
    fail(`${id} weekday-B heading should match in-app ("Showing trains to …"), got "${towardB.heading}"`);
  }

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

const featured = listFeaturedSeoRoutes();
if (featured.length < 6) fail(`expected ≥6 featured SEO routes, found ${featured.length}`);
if (!featured.some((e) => e.route.id === 'jhb-soweto')) fail('featured list must include Naledi (jhb-soweto)');

if (stationLabel('JOHANNESBURG STATION') !== 'Johannesburg Park Station') {
  fail(`stationLabel JOHANNESBURG STATION is "${stationLabel('JOHANNESBURG STATION')}"`);
}
if (stationLabel('JOHANNESBURG') !== 'Johannesburg Park Station') {
  fail(`stationLabel JOHANNESBURG is "${stationLabel('JOHANNESBURG')}"`);
}
if (slugifyStation('JOHANNESBURG STATION') !== 'johannesburg') {
  fail(`slugifyStation must stay johannesburg, got "${slugifyStation('JOHANNESBURG STATION')}"`);
}

const title = bidirectionalTitle('Johannesburg', 'Naledi');
if (title !== 'Johannesburg ↔ Naledi Train Schedule & Times') {
  fail(`calm bidirectional title is "${title}"`);
}
if (/to .+ & .+ to /i.test(title)) {
  fail(`title must not stuff both "X to Y & Y to X": "${title}"`);
}
if (corridorPairLabel('Durban', 'Umlazi') !== 'Durban ↔ Umlazi') {
  fail('corridor pair should be Durban ↔ Umlazi');
}
if (directionPhrase('Pretoria', 'Mabopane') !== 'Pretoria to Mabopane') {
  fail('directionPhrase should be "Pretoria to Mabopane"');
}
const docTitle = routeDocumentTitle('Pretoria', 'Mabopane');
if (!docTitle.startsWith('Pretoria ↔ Mabopane Train Schedule & Times |')) {
  fail(`document title is "${docTitle}"`);
}
const meta = routeMetaDescription('Pretoria', 'Mabopane', 'Gauteng');
if (!meta.includes('Pretoria to Mabopane') || !meta.includes('Mabopane to Pretoria')) {
  fail(`meta description must name both directions: "${meta}"`);
}
if (meta.includes(' & Mabopane to')) {
  fail('meta description should not use the stuffed & title form');
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
  const bridge = ROUTES['kzn-bridgecity'];
  const dump = JSON.parse(readFileSync(new URL('../public/data/full-database.json', import.meta.url), 'utf8'));
  const sheetA = bridge?.sheetKeys?.weekday_to_a;
  if (sheetA && MANUAL_GRID_ORDER[sheetA]) fail(`${sheetA} should have no MANUAL_GRID_ORDER`);
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
    if (!html.includes('Johannesburg Park Station to Naledi') && !html.includes('Showing trains to Johannesburg Park Station')) {
      fail('Naledi route HTML must mention Johannesburg Park Station as a terminus');
    }
    if (!html.includes('Naledi to Johannesburg Park Station') && !html.includes('Showing trains to Naledi')) {
      fail('Naledi route HTML must mention both directions');
    }
    if (!html.includes('Johannesburg Park Station ↔ Naledi Train Schedule & Times')) {
      fail('Naledi route H1/title should use Johannesburg Park Station');
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

  const guideHtml = readFileSync(join(DIST, 'guide.html'), 'utf8');
  if (!guideHtml.includes('routes.html') || !guideHtml.includes('johannesburg-to-naledi')) {
    fail('guide.html should list featured route timetables');
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
  }

  const kemp = join(DIST, 'routes/pretoria-to-kempton-park.html');
  if (existsSync(kemp)) {
    const html = readFileSync(kemp, 'utf8');
    if (/<html[^>]*class="[^"]*\bdark\b/.test(html)) fail('Kempton route page has html.dark');
    if (!html.includes('<table')) fail('Kempton route HTML has no <table>');
    if (!html.includes('Showing trains to')) fail('Kempton route HTML missing in-app direction heading');
    if (!html.includes('Open live timetable in Next Train')) fail('Kempton route HTML missing live-grid CTA');
    if (!html.includes('v=g') || !html.includes('rt=pta-kempton')) {
      fail('Kempton route HTML missing in-app grid deep link (?rt=&v=g)');
    }
    if (!/\d{1,2}:\d{2}/.test(html)) fail('Kempton route HTML has no clock times');
    if (/Fonteine|Kloofsig|Pinedene/.test(html)) fail('Kempton route HTML still lists ghost stations');
    if (!/Irene/.test(html)) fail('Kempton route HTML missing Irene');
    if (!/Kempton Park/.test(html)) fail('Kempton route HTML missing Kempton Park');
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
