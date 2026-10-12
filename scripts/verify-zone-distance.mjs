/**
 * Zone / SEO distances follow static network maps + painted rails, not the
 * union of every branch printed on a shared WC sheet.
 * Run: node scripts/verify-zone-distance.mjs
 */
import { readFileSync } from 'node:fs';
import { ROUTES } from '../src/lib/config.js';
import {
    extractStationChain,
    extractTimedTrainChains,
    extractSheetUnionChain,
    extractMapStationChain,
    measureStationChain,
    primaryDistanceKm,
    bakedDestToDestKm,
    runZoneDistanceAudit,
    sliceChainBetween,
    corridorNameList,
    mapCorridorsFromFeatures,
    buildMapAdjacency,
    areMapAdjacent,
    resolveStationChain,
} from '../src/lib/zone-distance-audit.js';
import { seoRouteDistanceKm } from '../src/lib/seo-timetable.js';
import { flattenPublicHolidays } from '../src/lib/utils.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

const dump = JSON.parse(readFileSync(new URL('../public/data/full-database.json', import.meta.url), 'utf8'));
const wcTracks = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-WC.geojson', import.meta.url), 'utf8'));
const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
const wc = flattenPublicHolidays(dump.westerncape || {});
const mapCorridors = mapCorridorsFromFeatures(wcTracks.features || []);
const adj = buildMapAdjacency(mapCorridors);

function sheet(key) {
    const rows = wc[key];
    return { rows: Array.isArray(rows) ? rows : [], stationColumnName: 'STATION' };
}

function featureFor(id) {
    return (wcTracks.features || []).find((f) => f.properties?.routeId === id);
}

{
    const union = extractSheetUnionChain(sheet('ct_to_well_weekday'));
    const timed = extractStationChain(sheet('ct_to_well_weekday'), {
        destA: 'CAPE TOWN',
        destB: 'WELLINGTON',
    });
    const unionKm = measureStationChain(union).pathKm;
    const timedKm = measureStationChain(timed).pathKm;
    assert(unionKm > 120, `legacy union Cape Town-Wellington should still be the 144 km trap (got ${unionKm})`);
    assert(timedKm != null && timedKm >= 65 && timedKm <= 78, `timed Cape Town-Wellington should be ~70 km, got ${timedKm}`);
    assert(!timed.some((s) => /STRAND|STELLENBOSCH|DU TOIT|EERSTE RIVER/i.test(s.name)), 'Wellington timed path does not visit Strand/Stellenbosch/Eerste River');
    assert(extractTimedTrainChains(sheet('ct_to_well_weekday')).length >= 2, 'Wellington sheet has per-train columns');
}

{
    const wellNames = corridorNameList(featureFor('ct-well'));
    const chain = extractMapStationChain(mapCorridors, 'CAPE TOWN', 'WELLINGTON', new Map(), wellNames);
    assert(chain && chain.length >= 10, `map Cape Town-Wellington has a Northern Line station list (got ${chain?.length})`);
    assert(!chain.some((s) => /STRAND|STELLENBOSCH|DU TOIT|YSTERPLAAT|CENTURY CITY/i.test(s.name)), 'static-map Wellington path is Mutual/Northern Line, not Century City or Strand');
    assert(chain.some((s) => /MUTUAL/i.test(s.name)), 'static-map Wellington path goes via Mutual');
    assert(chain.some((s) => /PAARL/i.test(s.name)), 'static-map Wellington path goes via Paarl');
}

{
    const dtoit = extractMapStationChain(
        mapCorridors,
        'EERSTE RIVER',
        'DU TOIT',
        new Map(),
        corridorNameList(featureFor('eerst-dtoit')),
    );
    assert(dtoit && dtoit.length >= 2 && dtoit.length <= 8, `map Eerste River-Du Toit is the Stellenbosch spur (got ${dtoit?.length} stops)`);
    assert(dtoit.some((s) => /STELLENBOSCH/i.test(s.name)), 'Stellenbosch spur includes Stellenbosch');
    assert(!dtoit.some((s) => /STRAND|WELLINGTON|STIKLAND/i.test(s.name)), 'Stellenbosch spur does not join Strand or Wellington');
}

{
    assert(!areMapAdjacent(adj, 'DU TOIT', 'STIKLAND'), 'network-map_wc.png has no Du Toit-Stikland hop');
    assert(!areMapAdjacent(adj, 'STRAND', 'STELLENBOSCH'), 'Strand and Stellenbosch are separate forks');
    assert(!areMapAdjacent(adj, 'STRAND', 'WELLINGTON'), 'Strand is not on the Wellington line');
    assert(areMapAdjacent(adj, 'EERSTE RIVER', 'LYNEDOCH'), 'Stellenbosch spur leaves Eerste River toward Lynedoch');
    assert(areMapAdjacent(adj, 'STRAND', 'VAN DER STEL'), 'Strand dead-end is Van Der Stel then Somerset West');
    assert(areMapAdjacent(adj, 'BELLVILLE', 'STIKLAND'), 'Northern Line continues Bellville to Stikland');
    assert(areMapAdjacent(adj, 'YSTERPLAAT', 'KENTEMADE') || areMapAdjacent(adj, 'YSTERPLAAT', 'CENTURY CITY'), 'Century City loop leaves Ysterplaat');
}

{
    const chain = extractStationChain(sheet('eerst_to_dtoit_weekday'), {
        destA: 'EERSTE RIVER',
        destB: 'DU TOIT',
        mapCorridor: corridorNameList(featureFor('eerst-dtoit')),
        mapCorridors,
        bakedFeature: featureFor('eerst-dtoit'),
        bakedFeatures: wcTracks.features || [],
    });
    const km = measureStationChain(chain).pathKm;
    assert(km != null && km < 80, `Eerste River-Du Toit stop path must not be the 144 km union (got ${km})`);
    assert(chain[0] && /EERSTE/i.test(chain[0].name), `Eerste River-Du Toit starts at Eerste River, got ${chain[0]?.name}`);
    assert(chain[chain.length - 1] && /DU TOIT/i.test(chain[chain.length - 1].name), 'Eerste River-Du Toit ends at Du Toit');
}

{
    const feature = featureFor('ct-well');
    const resolved = resolveStationChain(sheet('ct_to_well_weekday'), {
        destA: ROUTES['ct-well'].destA,
        destB: ROUTES['ct-well'].destB,
        mapCorridor: corridorNameList(feature),
        mapCorridors,
        bakedFeature: feature,
        bakedFeatures: wcTracks.features || [],
    });
    assert(resolved.source === 'map', `Cape Town-Wellington chain comes from the static map (got ${resolved.source})`);
    const ends = resolved.chain.filter((s) => s.lat != null && s.lon != null);
    const railKm = bakedDestToDestKm(feature, ends[0], ends[ends.length - 1]);
    assert(railKm != null && railKm >= 68 && railKm <= 78, `baked Cape Town-Wellington should be ~72 km, got ${railKm}`);
}

{
    const report = runZoneDistanceAudit(wc, 'WC', { bakedFeatures: wcTracks.features || [] });
    const well = report.routes.find((r) => r.routeId === 'ct-well');
    const dtoit = report.routes.find((r) => r.routeId === 'eerst-dtoit');
    const mutual = report.routes.find((r) => r.routeId === 'bellville-mutual');
    const strand = report.routes.find((r) => r.routeId === 'ct-strnd');
    assert(well?.primary?.distanceKm != null && well.primary.distanceKm < 90, `audit Cape Town-Wellington is not 144 km (got ${well?.primary?.distanceKm})`);
    assert(well?.primary?.distanceSource === 'rail', `Cape Town-Wellington uses painted rail (got ${well?.primary?.distanceSource})`);
    assert(well?.primary?.measure?.chainSource === 'map', `Cape Town-Wellington station list is the static map (got ${well?.primary?.measure?.chainSource})`);
    assert(dtoit?.primary?.distanceKm != null && dtoit.primary.distanceKm < 90, `audit Eerste River-Du Toit is not 144 km (got ${dtoit?.primary?.distanceKm})`);
    assert(mutual?.primary?.distanceKm != null && mutual.primary.distanceKm < 30, `audit Bellville-Mutual is a short hop (got ${mutual?.primary?.distanceKm})`);
    assert(strand?.primary?.distanceKm != null && strand.primary.distanceKm < 90, `audit Cape Town-Strand is not the 144 km union (got ${strand?.primary?.distanceKm})`);
}

{
    const wellSeo = seoRouteDistanceKm(ROUTES['ct-well']);
    const pienSeo = seoRouteDistanceKm(ROUTES['pta-pien']);
    assert(wellSeo != null && wellSeo >= 68 && wellSeo <= 78, `SEO Cape Town-Wellington ~72 km, got ${wellSeo}`);
    assert(pienSeo != null && pienSeo >= 20 && pienSeo <= 35, `SEO Pretoria-Pienaarspoort stays ~26 km, got ${pienSeo}`);
}

{
    const sliced = sliceChainBetween(
        extractStationChain(sheet('ct_to_well_weekday')),
        'CAPE TOWN',
        'WELLINGTON',
    );
    assert(sliced && sliced.length > 2, 'slice helper can still clip a unique-row chain');
}

{
    assert(mapApp.includes("'ct-well':"), 'STATIC_ROUTE_PATHS encodes the Wellington Northern Line from network-map_wc.png');
    assert(mapApp.includes("'eerst-dtoit':"), 'STATIC_ROUTE_PATHS encodes the Stellenbosch spur');
    assert(mapApp.includes("'ct-strnd':"), 'STATIC_ROUTE_PATHS encodes the Strand fork');
    assert(mapApp.includes("'ct-simon':"), 'STATIC_ROUTE_PATHS encodes the Southern Line');
    const wellBlock = mapApp.match(/'ct-well': \[([^\]]+)\]/);
    assert(wellBlock && !wellBlock[1].includes('STRAND'), 'STATIC Wellington path does not list Strand');
    assert(wellBlock && wellBlock[1].includes('MUTUAL') && wellBlock[1].includes('PAARL'), 'STATIC Wellington path lists Mutual and Paarl');
}

if (failures.length) {
    console.error('verify-zone-distance failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-zone-distance: ok');
