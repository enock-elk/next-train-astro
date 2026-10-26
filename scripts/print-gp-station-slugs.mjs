/**
 * Print active Gauteng timed-station slugs (for allowlist edits).
 * Run: node scripts/print-gp-station-slugs.mjs
 */
import { listSeoStations } from '../src/lib/seo-stations.js';

const list = listSeoStations({ regions: ['GP'] });
for (const s of list) {
  console.log(s.slug);
}
console.error(`# ${list.length} GP timed stations`);
