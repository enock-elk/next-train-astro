/**
 * Indexable station SEO slugs (`/stations/{slug}.html`).
 *
 * Edit this set to pause or promote a station without deleting its page.
 * Non-listed station pages (if emitted) stay noindex and out of the sitemap.
 * SSG only emits allowlisted slugs (see listIndexableSeoStations).
 *
 * ---------------------------------------------------------------------------
 * Phased station SEO plan (for future agents)
 * ---------------------------------------------------------------------------
 *
 * Phase 1 (current):
 *   - All active Gauteng timed stops (full GP catalog).
 *   - WC / KZN / EC: route termini and major hubs only (PHASE1_REGIONAL_HUBS).
 *   - Do not SSG or index the rest of WC/KZN/EC yet.
 *
 * Phase 2:
 *   - Remaining Western Cape timed stops (full WC catalog onto the allowlist).
 *
 * Phase 3:
 *   - Remaining KwaZulu-Natal timed stops.
 *
 * Phase 4:
 *   - Remaining Eastern Cape timed stops.
 *
 * Rules when expanding a phase:
 *   1. Add slugs to STATION_INDEX_ALLOWLIST (keep PHASE1_REGIONAL_HUBS as the
 *      historical phase-1 set, or fold them into a per-region note).
 *   2. Keep getStaticPaths / sitemap on listIndexableSeoStations() — do not
 *      switch back to a GP-only region filter.
 *   3. stationHasPublicPage must stay allowlist-gated so route pages do not
 *      link to stations that are not SSG'd yet.
 *   4. Run npm run verify:station-seo and regenerate the sitemap
 *      (npm run sitemap / prebuild).
 *   5. GP candidates: node scripts/print-gp-station-slugs.mjs
 *      Regional hub candidates: node scripts/print-regional-hub-slugs.mjs
 *
 * Do not invent station slugs. Resolve names through slugifyStation against
 * the live SEO schedule dump / listSeoStationCatalog.
 */

/**
 * Phase-1 non-GP termini and hubs (active route destA / destB ends).
 * Kept as an explicit list so later phases can add mid-corridor stops
 * without re-deriving what shipped in phase 1.
 */
export const PHASE1_REGIONAL_HUBS = Object.freeze([
  // Western Cape — corridor ends / hubs
  'bellville',
  'cape-town',
  'chris-hani',
  'du-toit',
  'eerste-river',
  'kapteinsklip',
  'kraaifontein',
  'malmesbury',
  'mutual',
  'nolungile',
  'retreat',
  'simons-town',
  'strand',
  'wellington',
  // KwaZulu-Natal — corridor ends / hubs
  'berea-road',
  'bridge-city',
  'cato-ridge',
  'crossmoor',
  'durban',
  'pinetown',
  'umlazi',
  'winklespruit',
  // Eastern Cape — corridor ends
  'berlin',
  'east-london',
]);

/**
 * Full GP timed-stop allowlist (phase 1). Regenerate candidates with
 * `node scripts/print-gp-station-slugs.mjs` after schedule changes.
 */
const PHASE1_GP_STATIONS = [
  'akasiaboom',
  'atteridgeville',
  'belle-ombre',
  'bosmont',
  'braamfontein',
  'centurion',
  'cor-delfos',
  'croesus',
  'de-wildt',
  'denneboom',
  'devenish-street',
  'driehoek',
  'dube',
  'eerste-fabrieke',
  'elandsfontein',
  'electro',
  'elsburg',
  'florida',
  'ga-rankuwa',
  'germiston',
  'gezina',
  'grosvenor',
  'hamberg',
  'hartbeesspruit',
  'hercules',
  'ikwezi',
  'inhlazane',
  'irene',
  'jeppe',
  'johannesburg',
  'kalafong',
  'katlehong',
  'kempton-park',
  'kliptown',
  'koedoespoort',
  'kopanong',
  'krugersdorp',
  'kwesine',
  'langlaagte',
  'lenz',
  'leralla',
  'limindlela',
  'lindela',
  'loftus-versfeld-park',
  'longdale',
  'luipaardsvlei',
  'mabopane',
  'mamelodi-gardens',
  'mayfair',
  'mears-street',
  'merafe',
  'midway',
  'mlamlankunzi',
  'mountain-view',
  'mzimhlope',
  'naledi',
  'nancefield',
  'new-canada',
  'oakmoor',
  'olifantsfontein',
  'orlando',
  'phefeni',
  'phomolong',
  'pienaarspoort',
  'pilot',
  'pretoria',
  'pretoria-north',
  'pretoria-west',
  'princess',
  'randfontein',
  'ravensklip',
  'rebecca',
  'rhodesfield',
  'rissik',
  'roodepoort',
  'rosslyn',
  'saulsville',
  'silverton',
  'sportpark',
  'taillardshoop',
  'tembisa',
  'tshiawelo',
  'unified',
  'villieria',
  'walker-street',
  'waltloo',
  'wintersnest',
  'wolmerton',
];

export const STATION_INDEX_ALLOWLIST = new Set([
  ...PHASE1_GP_STATIONS,
  ...PHASE1_REGIONAL_HUBS,
]);

export function isStationIndexable(slug) {
  return STATION_INDEX_ALLOWLIST.has(String(slug || '').trim());
}

/** True when slug is a phase-1 non-GP hub (not a full-region rollout yet). */
export function isPhase1RegionalHub(slug) {
  const want = String(slug || '').trim();
  return PHASE1_REGIONAL_HUBS.includes(want);
}
