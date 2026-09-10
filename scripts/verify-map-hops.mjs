/**
 * Map hop paint: keep successful rail hops, clip baked segments for failed hops.
 * Run: node scripts/verify-map-hops.mjs
 */
import { readFileSync } from 'node:fs';

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

const mapApp = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
assert(!mapApp.includes('railHops !== stops.length - 1'), 'map no longer drops a path when one hop is a chord');
assert(mapApp.includes('clipBakedHop'), 'failed hops try a clipped baked segment before a chord');
assert(mapApp.includes('chordM * 0.65'), 'rail hop stray limit scales with chord length');
assert(mapApp.includes('smoothStopsOnRailGraph(bundle.graph, stops, baked)'), 'smoother receives the baked line');
assert(mapApp.includes('if (out.length < 2 || railHops === 0) return null'), 'smoother returns null only when zero rail/baked hops succeed');

const gp = JSON.parse(readFileSync(new URL('../public/tracks/rail-tracks-GP.geojson', import.meta.url), 'utf8'));
const herc = (gp.features || []).find((f) => f.properties?.routeId === 'herc-koed');
assert(!!herc, 'GP tracks include herc-koed');
const verts = herc?.geometry?.coordinates?.length || 0;
assert(verts > 2, `GP herc-koed GeoJSON has more than 2 vertices (got ${verts})`);
const hercPath = mapApp.match(/'herc-koed': \[([^\]]+)\]/);
assert(!!hercPath, 'herc-koed static path is present');
assert(!hercPath[1].includes('DASPOORT'), 'herc-koed static path does not use DASPOORT');
assert(mapApp.includes("'pta-mabopane':") && mapApp.includes('"DASPOORT"'), 'Mabopane still uses DASPOORT');
const herculesLon = 28.167401;
const west = (herc?.geometry?.coordinates || []).filter((c) => c[0] < herculesLon - 0.0002);
assert(west.length === 0, `herc-koed does not run west of Hercules (got ${west.length} verts)`);

if (failures.length) {
    console.error(failures.map((m) => `FAIL ${m}`).join('\n'));
    process.exit(1);
}
console.log('verify-map-hops: ok');
