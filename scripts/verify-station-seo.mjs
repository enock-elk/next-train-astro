/**
 * Station SEO landings — catalog, allowlist, Walker Street neighbours, SW denylist.
 * Run: node scripts/verify-station-seo.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildStationCorridorTimetables,
  getSeoStationBySlug,
  listSeoStations,
  neighboursForStationRoute,
  stationHasPublicPage,
} from '../src/lib/seo-stations.js';
import {
  isStationIndexable,
  STATION_INDEX_ALLOWLIST,
} from '../src/lib/seo-station-allowlist.js';

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

const stations = listSeoStations({ regions: ['GP'] });
ok(stations.length >= 80, `expected ≥80 GP timed stations, found ${stations.length}`);
ok(stations.every((s) => s.status === 'active'), 'GP catalog entries are active timed stops');
ok(stations.every((s) => s.region === 'GP'), 'phase-1 SSG list is Gauteng only');

for (const slug of STATION_INDEX_ALLOWLIST) {
  ok(stations.some((s) => s.slug === slug), `allowlist slug ${slug} exists in GP catalog`);
}
ok(
  stations.every((s) => isStationIndexable(s.slug)),
  'every GP SSG station is on the phase-1 allowlist',
);

const walker = getSeoStationBySlug('walker-street');
ok(!!walker, 'Walker Street is in the catalog');
ok(walker?.routeIds?.includes('pta-pien'), 'Walker Street is on Pretoria-Pienaarspoort');
const neigh = neighboursForStationRoute('Walker Street', 'pta-pien');
ok(neigh?.towardA === 'Devenish Street', 'Walker Street neighbour toward Pretoria is Devenish Street');
ok(neigh?.towardB === 'Loftus Versfeld Park', 'Walker Street neighbour toward Pienaarspoort is Loftus');

const cards = buildStationCorridorTimetables(walker);
ok(cards.length === 1, 'Walker Street has one corridor card');
ok(cards[0]?.weekday?.towardA?.title === 'Walker Street → Pretoria', 'Walker Street weekday A title');
ok(cards[0]?.weekday?.towardB?.title === 'Walker Street → Pienaarspoort', 'Walker Street weekday B title');
ok(cards[0]?.weekday?.towardA?.trains?.length > 5, 'Walker Street has weekday trains toward Pretoria');
ok(cards[0]?.weekday?.towardB?.trains?.some((t) => t.badge === 'direct' || t.badge === 'short'), 'Walker Street trains carry Direct/short badges');

const pretoria = getSeoStationBySlug('pretoria');
ok((pretoria?.routeIds?.length || 0) >= 5, 'Pretoria hub lists multiple routes');
const ptaCards = buildStationCorridorTimetables(pretoria);
ok(ptaCards.length >= 5, 'Pretoria hub builds multiple corridor cards');
ok(
  ptaCards.every((c) => c.weekday.towardA.trains.length === 0),
  'Pretoria terminus does not list arrivals as Pretoria → Pretoria departures',
);
ok(
  ptaCards.every((c) => c.weekday.towardB.trains.length > 0),
  'Pretoria hub lists outbound weekday trains on each corridor',
);

ok(stationHasPublicPage('walker-street'), 'Walker Street has a public page');
ok(!stationHasPublicPage('wolseley'), 'Wolseley (out of network) has no public page');

const pageSrc = readFileSync(new URL('../src/pages/stations/[slug].astro', import.meta.url), 'utf8');
ok(pageSrc.includes('robots={indexable ? \'index, follow\' : \'noindex, follow\'}'), 'station page gates robots on allowlist');
ok(pageSrc.includes('SeoStationDepartures'), 'station page renders departure lists');
ok(pageSrc.includes('Neighbouring stations'), 'station page shows neighbours');

const routePage = readFileSync(new URL('../src/pages/routes/[slug].astro', import.meta.url), 'utf8');
ok(routePage.includes('stationHasPublicPage'), 'route SEO pages link to station landings');

const astro = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
ok(astro.includes("'stations/**'"), 'stations HTML is excluded from SW precache');
ok(/\/stations\(\\\.html\|\/\)/.test(astro) || astro.includes('/stations'), 'stations path is on navigateFallbackDenylist');

const sitemapGen = readFileSync(new URL('../scripts/generate-sitemap.mjs', import.meta.url), 'utf8');
ok(sitemapGen.includes('stationUrls'), 'sitemap generator emits station URLs');
ok(sitemapGen.includes('isStationIndexable'), 'sitemap only includes allowlisted stations');

const fetchLive = readFileSync(new URL('../scripts/fetch-live-schedules-for-seo.mjs', import.meta.url), 'utf8');
ok(fetchLive.includes('.seo-build-database.json'), 'live schedule fetch writes the SEO build dump');
ok(fetchLive.includes('schedules/gauteng.json'), 'live schedule fetch pulls Gauteng from RTDB/cache');
const seoTimetable = readFileSync(new URL('../src/lib/seo-timetable.js', import.meta.url), 'utf8');
ok(seoTimetable.includes('.seo-build-database.json'), 'loadScheduleDump prefers the live SEO build dump');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
ok(String(pkg.scripts?.prebuild || '').includes('fetch-live-schedules-for-seo'), 'prebuild fetches live schedules before SSG');

const sitemapPath = new URL('../public/sitemap.xml', import.meta.url);
if (existsSync(sitemapPath)) {
  const xml = readFileSync(sitemapPath, 'utf8');
  ok(xml.includes('/stations/walker-street.html'), 'checked-in sitemap lists Walker Street');
  ok(!xml.includes('/stations/wolseley'), 'sitemap does not list Wolseley');
}

if (failures.length) {
  console.error('verify-station-seo FAILED:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log(`verify-station-seo: ok (${stations.length} GP stations, ${STATION_INDEX_ALLOWLIST.size} allowlisted)`);
