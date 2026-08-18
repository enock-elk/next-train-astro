/**
 * Route-page SEO + OG column-order checks.
 *
 * Library tests (no dist): weekday grids from full-database.json follow
 * MANUAL_GRID_ORDER; first/last trains exist for flagship OD corridors.
 * HTML tests (after astro build): light first-paint, both-direction titles,
 * real <table> times, FAQPage JSON-LD, crawlable home/guide links.
 *
 * Usage: node scripts/verify-route-seo.mjs [distDir]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANUAL_GRID_ORDER, orderGridTrainIds } from '../src/lib/grid-order.js';
import { ROUTES } from '../src/lib/config.js';
import { listFeaturedSeoRoutes, getSeoRouteBySlug } from '../src/lib/seo-routes.js';
import { buildRouteSeoTimetable, bothDirectionTitle, ogTimetableImageUrl } from '../src/lib/seo-timetable.js';
import { extractGridPreview } from '../workers/nexttrain-og/src/schedule.js';

const DIST = process.argv[2] || 'dist';
const failures = [];
const fail = (msg) => failures.push(msg);

const FLAGSHIP = [
  { id: 'jhb-soweto', slug: 'johannesburg-to-naledi' },
  { id: 'pta-mabopane', slug: 'pretoria-to-mabopane' },
  { id: 'pta-pien', slug: 'pretoria-to-pienaarspoort' },
  { id: 'pta-saul', slug: 'pretoria-to-saulsville' },
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
  // Every station row stays in the data (crawler DOM); no truncation.
  if (towardB && towardB.stations.length < 5) fail(`${id} weekday-B unexpectedly short (${towardB.stations.length} stations)`);

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

const title = bothDirectionTitle('Johannesburg', 'Naledi');
if (!title.includes('Johannesburg to Naledi') || !title.includes('Naledi to Johannesburg')) {
  fail(`both-direction title is "${title}"`);
}
const og = ogTimetableImageUrl('jhb-soweto', 'A');
if (!og.includes('/og/timetable.png') || !og.includes('rt=jhb-soweto') || !og.includes('d=wd')) {
  fail(`og timetable url looks wrong: ${og}`);
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
    if (!html.includes('Johannesburg to Naledi') || !html.includes('Naledi to Johannesburg')) {
      fail('Naledi route HTML must mention both directions');
    }
    if (!html.includes('<table')) fail('Naledi route HTML has no <table> timetable');
    if (!html.includes('FAQPage')) fail('Naledi route HTML missing FAQPage JSON-LD');
    if (!html.includes('/og/timetable.png')) fail('Naledi route HTML missing og:image timetable PNG');
    if (!html.includes('summary_large_image')) fail('Naledi route HTML should use summary_large_image');
    if (!html.includes('Weekday first')) fail('Naledi route HTML missing first/last weekday blurb');
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

  const region = join(DIST, 'regions/gauteng.html');
  if (existsSync(region)) {
    const html = readFileSync(region, 'utf8');
    if (/<html[^>]*class="[^"]*\bdark\b/.test(html)) fail('Gauteng region page has html.dark');
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
