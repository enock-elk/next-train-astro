/**
 * Print phase-1 WC/KZN/EC terminus/hub slugs derived from active ROUTES ends,
 * and compare to PHASE1_REGIONAL_HUBS in the allowlist.
 * Run: node scripts/print-regional-hub-slugs.mjs
 */
import { ROUTES } from '../src/lib/config.js';
import { slugifyStation, stationLabel } from '../src/lib/seo-routes.js';
import { listSeoStations } from '../src/lib/seo-stations.js';
import { PHASE1_REGIONAL_HUBS } from '../src/lib/seo-station-allowlist.js';

const derived = new Map();
for (const route of Object.values(ROUTES)) {
  if (!route?.isActive) continue;
  if (!['WC', 'KZN', 'EC'].includes(route.region)) continue;
  for (const raw of [route.destA, route.destB]) {
    const name = stationLabel(raw);
    const slug = slugifyStation(name);
    if (!slug) continue;
    if (!derived.has(slug)) derived.set(slug, { slug, name, region: route.region });
  }
}

const catalog = new Map(
  listSeoStations({ regions: ['WC', 'KZN', 'EC'] }).map((s) => [s.slug, s]),
);

console.log('# Derived from ROUTES destA/destB (WC/KZN/EC)');
for (const { slug, name, region } of [...derived.values()].sort((a, b) =>
  a.region.localeCompare(b.region) || a.slug.localeCompare(b.slug),
)) {
  const inCatalog = catalog.has(slug) ? 'catalog' : 'MISSING_CATALOG';
  const inAllow = PHASE1_REGIONAL_HUBS.includes(slug) ? 'allowlist' : 'NOT_ALLOWLISTED';
  console.log(`${region}\t${slug}\t${name}\t${inCatalog}\t${inAllow}`);
}

const missingAllow = [...derived.keys()].filter((s) => !PHASE1_REGIONAL_HUBS.includes(s));
const extraAllow = PHASE1_REGIONAL_HUBS.filter((s) => !derived.has(s));
if (missingAllow.length) {
  console.error(`# Not yet on PHASE1_REGIONAL_HUBS: ${missingAllow.join(', ')}`);
}
if (extraAllow.length) {
  console.error(`# On PHASE1_REGIONAL_HUBS but not a current route end: ${extraAllow.join(', ')}`);
}
console.error(`# ${derived.size} derived termini/hubs; ${PHASE1_REGIONAL_HUBS.length} on phase-1 regional list`);
