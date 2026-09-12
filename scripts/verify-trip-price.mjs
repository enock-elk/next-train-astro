/**
 * Trip-price beta flag + distance-zone + peak/off-peak rules.
 * Run: node scripts/verify-trip-price.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FARE_CONFIG } from '../src/lib/config.js';
import { FEATURE_KEYS, GRANTABLE_FEATURES } from '../src/lib/features.js';
import { suggestZoneFromKm, DEFAULT_ZONE_KM_BANDS } from '../src/lib/zone-distance-audit.js';
import { computeZoneFareForTrip } from '../src/lib/planner-ui.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

assert(FEATURE_KEYS.TRIP_PRICE === 'tripPrice', 'FEATURE_KEYS.TRIP_PRICE is tripPrice');
assert(GRANTABLE_FEATURES.some((row) => row.key === 'tripPrice' && row.label === 'Trip price'), 'GRANTABLE_FEATURES includes Trip price');

const featuresSrc = readFileSync(join(ROOT, 'src/lib/features.js'), 'utf8');
assert((featuresSrc.match(/tripPrice:\s*\{\s*enabled:\s*false/g) || []).length >= 2, 'lab and prod defaults keep tripPrice off');

const chrome = readFileSync(join(ROOT, 'src/lib/admin-chrome.js'), 'utf8');
assert(chrome.includes("surface === 'tripPrice'"), 'admin-chrome unlocks tripPrice for granted devices');
assert(chrome.includes('isAdminAuthed()'), 'admins still unlock all pilot surfaces');

assert(suggestZoneFromKm(15) === 'Z1', '15 km is Z1');
assert(suggestZoneFromKm(15.1) === 'Z2', 'just over 15 km is Z2');
assert(suggestZoneFromKm(40) === 'Z2', '40 km is Z2');
assert(suggestZoneFromKm(40.1) === 'Z3', 'just over 40 km is Z3');
assert(suggestZoneFromKm(135) === 'Z3', '135 km is Z3');
assert(suggestZoneFromKm(135.1) === 'Z4', 'just over 135 km is Z4');
assert(DEFAULT_ZONE_KM_BANDS.Z1 === 15 && DEFAULT_ZONE_KM_BANDS.Z2 === 40 && DEFAULT_ZONE_KM_BANDS.Z3 === 135, 'band constants match FARE_CONFIG');
assert(FARE_CONFIG.offPeakEveryDay === false, 'off-peak is weekday-only');

{
    const sat = computeZoneFareForTrip('Z2', { dayType: 'saturday', depTime: '11:00' });
    assert(sat && sat.isOffPeak === false, `Saturday 11:00 must be peak, got ${JSON.stringify(sat)}`);
    const wk = computeZoneFareForTrip('Z2', { dayType: 'weekday', depTime: '11:00' });
    assert(wk && wk.isOffPeak === true, `weekday 11:00 must be off-peak, got ${JSON.stringify(wk)}`);
    const peak = computeZoneFareForTrip('Z2', { dayType: 'weekday', depTime: '07:30' });
    assert(peak && peak.isOffPeak === false, `weekday 07:30 must be peak, got ${JSON.stringify(peak)}`);
}

const ui = readFileSync(join(ROOT, 'src/lib/planner-ui.js'), 'utf8');
assert(ui.includes('data-nt-trip-fare'), 'planner header has the fare button');
assert(ui.includes('getSmoothTripDistanceKm'), 'fare uses smoothed rail distance');
assert(ui.includes('planner-fare-breakdown-sheet'), 'fare sheet is wired');

const modal = readFileSync(join(ROOT, 'src/components/PlannerModals.astro'), 'utf8');
assert(modal.includes('id="planner-fare-breakdown-sheet"'), 'fare bottom sheet markup exists');

if (failures.length) {
    console.error(`verify-trip-price: ${failures.length} failed`);
    for (const f of failures) console.error(' -', f);
    process.exit(1);
}
console.log('verify-trip-price: ok');
