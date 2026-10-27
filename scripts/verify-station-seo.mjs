/**
 * Station SEO landings — catalog, allowlist, Walker Street neighbours, SW denylist.
 * Run: node scripts/verify-station-seo.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildStationAbout,
  buildStationCorridorTimetables,
  buildStationMapPath,
  buildStationNeighbourHeadline,
  buildStationQuickFacts,
  getSeoStationBySlug,
  listIndexableSeoStations,
  listSeoStations,
  neighboursForStationRoute,
  stationHasPublicPage,
} from '../src/lib/seo-stations.js';
import {
  isStationIndexable,
  PHASE1_REGIONAL_HUBS,
  STATION_INDEX_ALLOWLIST,
} from '../src/lib/seo-station-allowlist.js';

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

const gpStations = listSeoStations({ regions: ['GP'] });
ok(gpStations.length >= 80, `expected ≥80 GP timed stations, found ${gpStations.length}`);
ok(gpStations.every((s) => s.status === 'active'), 'GP catalog entries are active timed stops');
ok(gpStations.every((s) => s.region === 'GP'), 'GP catalog filter stays Gauteng-only');
ok(
  gpStations.every((s) => isStationIndexable(s.slug)),
  'every GP timed station is on the phase-1 allowlist',
);

const indexable = listIndexableSeoStations();
ok(indexable.length === STATION_INDEX_ALLOWLIST.size, 'SSG list size matches allowlist');
ok(
  indexable.every((s) => isStationIndexable(s.slug)),
  'every SSG station is allowlisted',
);

const catalogBySlug = new Map(listSeoStations().map((s) => [s.slug, s]));
for (const slug of STATION_INDEX_ALLOWLIST) {
  ok(catalogBySlug.has(slug), `allowlist slug ${slug} exists in the multi-region catalog`);
}

ok(PHASE1_REGIONAL_HUBS.length >= 20, 'phase-1 regional hubs cover WC/KZN/EC termini');
ok(PHASE1_REGIONAL_HUBS.includes('cape-town'), 'Cape Town is a phase-1 hub');
ok(PHASE1_REGIONAL_HUBS.includes('bellville'), 'Bellville is a phase-1 hub');
ok(PHASE1_REGIONAL_HUBS.includes('durban'), 'Durban is a phase-1 hub');
ok(PHASE1_REGIONAL_HUBS.includes('east-london'), 'East London is a phase-1 hub');
ok(stationHasPublicPage('cape-town'), 'Cape Town has a public page');
ok(stationHasPublicPage('durban'), 'Durban has a public page');
ok(!stationHasPublicPage('athlone'), 'Athlone (WC mid-corridor) waits for a later phase');

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
ok(pageSrc.includes('SeoStationMap'), 'station page embeds Leaflet GPS map');
ok(pageSrc.includes('About this station'), 'station page has About this station');
ok(pageSrc.includes('Quick facts'), 'station page has Quick facts');
ok(pageSrc.includes('<details'), 'neighbouring stations use an accordion');
ok(!pageSrc.includes('Open live board'), 'station page no longer shows Open live board');

const ptaHeadline = buildStationNeighbourHeadline(pretoria, ptaCards);
ok(ptaHeadline.startsWith('Pretoria - '), 'Pretoria neighbour headline starts with Pretoria -');
ok(/Irene\s*\/\s*Kempton Park|Kempton Park\s*\/\s*Irene/.test(ptaHeadline), 'Irene / Kempton Park share Sportpark so they slash-join');
ok(ptaHeadline.includes(' · '), 'different next-station groups stay separated with a middle dot');
ok(!/^Pretoria - [^·]+$/.test(ptaHeadline) || ptaHeadline.includes('Irene'), 'Pretoria hub is not one flat slash list of every end');
{
  const walker = getSeoStationBySlug('walker-street');
  const walkerCards = buildStationCorridorTimetables(walker);
  const walkerHeadline = buildStationNeighbourHeadline(walker, walkerCards);
  ok(walkerHeadline.includes('Pretoria') && walkerHeadline.includes('Pienaarspoort'), 'Walker Street headline names both corridor ends');
  ok(!/Pretoria\s*\/\s*Pienaarspoort|Pienaarspoort\s*\/\s*Pretoria/.test(walkerHeadline), 'Walker Street does not slash-join ends with different next stations');
}
ok(buildStationAbout(pretoria, ptaCards).includes('active Metrorail station'), 'about is descriptive prose');
ok(buildStationAbout(pretoria, ptaCards).includes('Pretoria'), 'about mentions Pretoria');
ok(buildStationQuickFacts(pretoria, ptaCards).length >= 4, 'Pretoria has several quick facts');
ok(buildStationMapPath(pretoria).includes('station=Pretoria'), 'map path focuses station');
ok(buildStationMapPath(pretoria, { embed: true }).includes('embed=1'), 'preview map uses embed');

const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
ok(mapApp.includes('focusStationFromQuery'), 'map-app focuses ?station= from the URL');
ok(mapApp.includes('nt-map-station-focus'), 'map-app marks station-focus mode');
ok(mapApp.includes('!stationFocusQuery.station'), 'station focus skips embed corridor fitBounds');
ok(mapApp.includes('stationFocusZoom'), 'station focus uses a street-level zoom');
ok(!mapApp.includes("Number(q.get('lat'))"), 'missing lat query is not coerced to 0');
ok(mapApp.includes('Gulf of Guinea'), 'map-app records why absent lat/lon must stay null');

const mapPage = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
ok(mapPage.includes("Loading map"), 'station-focus loader says Loading map');
ok(mapPage.includes('data-map-loading-extra'), 'station-focus loader can hide extra network copy');

const mapComp = readFileSync(new URL('../src/components/SeoStationMap.astro', import.meta.url), 'utf8');
ok(mapComp.includes('seo-station-map-lightbox'), 'station map opens a full-view overlay');
ok(!mapComp.includes('Expand map'), 'station map drops the redundant Expand map control');
ok(mapComp.includes('data-seo-station-map-open'), 'station map still opens from the preview tap');
ok(!mapComp.includes('requestFullscreen'), 'station map must not use browser fullscreen');
ok(!mapComp.includes('seo-station-map-lightbox-title'), 'station map lightbox drops the title header for immersion');
ok(mapComp.includes('data-seo-station-map-close'), 'station map lightbox still has a close control');

const stationPage = readFileSync(new URL('../src/pages/stations/[slug].astro', import.meta.url), 'utf8');
ok(stationPage.includes('seoIntroParagraphs'), 'station SEO intro is split into paragraphs');
ok(stationPage.includes('next live departure & more'), 'station SEO intro mentions departure and more');
ok(stationPage.includes('SeoStationReviews'), 'station page mounts reviews at the bottom');

const gridHandoff = readFileSync(new URL('../src/lib/timetable-grid.js', import.meta.url), 'utf8');
ok(gridHandoff.includes('SEO cold launch seeds a pin only when none exists'), 'SEO handoff soft-pins defaults');
ok(gridHandoff.includes('if (!hasUsableDefault) safeStorage.setItem(defaultKey, link.routeId)'), 'SEO handoff keeps existing route pins');

const routePage = readFileSync(new URL('../src/pages/routes/[slug].astro', import.meta.url), 'utf8');
ok(routePage.includes('stationHasPublicPage'), 'route SEO pages link to station landings');

const astro = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
ok(astro.includes("'stations/**'"), 'stations HTML is excluded from SW precache');
ok(/\/stations\(\\\.html\|\/\)/.test(astro) || astro.includes('/stations'), 'stations path is on navigateFallbackDenylist');

const sitemapGen = readFileSync(new URL('../scripts/generate-sitemap.mjs', import.meta.url), 'utf8');
ok(sitemapGen.includes('stationUrls'), 'sitemap generator emits station URLs');
ok(sitemapGen.includes('listIndexableSeoStations'), 'sitemap uses allowlist-gated station list');
ok(pageSrc.includes('listIndexableSeoStations'), 'station getStaticPaths uses allowlist-gated list');

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
  ok(xml.includes('/stations/cape-town.html'), 'checked-in sitemap lists Cape Town');
  ok(xml.includes('/stations/durban.html'), 'checked-in sitemap lists Durban');
  ok(xml.includes('/stations/east-london.html'), 'checked-in sitemap lists East London');
  ok(!xml.includes('/stations/wolseley'), 'sitemap does not list Wolseley');
  ok(!xml.includes('/stations/athlone.html'), 'sitemap does not list Athlone yet');
}

const allowlistSrc = readFileSync(new URL('../src/lib/seo-station-allowlist.js', import.meta.url), 'utf8');
ok(allowlistSrc.includes('Phased station SEO plan'), 'allowlist documents the phased SEO plan');
ok(allowlistSrc.includes('Phase 2'), 'allowlist names phase 2 (remaining WC)');

if (failures.length) {
  console.error('verify-station-seo FAILED:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}
console.log(
  `verify-station-seo: ok (${gpStations.length} GP, ${PHASE1_REGIONAL_HUBS.length} regional hubs, ${STATION_INDEX_ALLOWLIST.size} allowlisted)`,
);
