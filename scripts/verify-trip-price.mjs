/**
 * Trip-price beta flag + distance-zone + peak/off-peak rules.
 * Run: node scripts/verify-trip-price.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FARE_CONFIG, fareMultiplierForProfile } from '../src/lib/config.js';
import { FEATURE_KEYS, GRANTABLE_FEATURES, isFeatureEnabled } from '../src/lib/features.js';
import { suggestZoneFromKm, DEFAULT_ZONE_KM_BANDS } from '../src/lib/zone-distance-audit.js';
import { computeZoneFareForTrip, getCrowFliesTripKm } from '../src/lib/planner-ui.js';
import {
    cheaperZone,
    capZoneForSingleRoute,
    dumpZoneForRoute,
    lookupRouteFareCap,
    setRouteFaresCache,
    singleRouteIdFromList,
} from '../src/lib/route-fares.js';
import { $userProfile, $fullDatabase } from '../src/store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

assert(FEATURE_KEYS.TRIP_PRICE === 'tripPrice', 'FEATURE_KEYS.TRIP_PRICE is tripPrice');
assert(!GRANTABLE_FEATURES.some((row) => row.key === 'tripPrice'), 'Trip price is not an experimental grant');
assert(isFeatureEnabled(FEATURE_KEYS.TRIP_PRICE) === true, 'trip fare is always on');
assert(isFeatureEnabled(FEATURE_KEYS.TRIP_PRICE, 'pta-pien') === true, 'trip fare is on for every corridor');

const featuresSrc = readFileSync(join(ROOT, 'src/lib/features.js'), 'utf8');
assert(!/tripPrice:\s*\{/.test(featuresSrc.split('export function isFeatureEnabled')[0]), 'tripPrice is not a default / seed flag');
assert(featuresSrc.includes('if (name === FEATURE_KEYS.TRIP_PRICE) return true'), 'isFeatureEnabled ignores leftover RTDB tripPrice');

const chrome = readFileSync(join(ROOT, 'src/lib/admin-chrome.js'), 'utf8');
assert(!chrome.includes("surface === 'tripPrice'"), 'admin-chrome no longer gates tripPrice as a pilot surface');
assert(!chrome.includes('FEATURE_KEYS.TRIP_PRICE'), 'trip price is not a pin-gated pilot surface');
assert(chrome.includes('isAdminAuthed()'), 'admins still unlock remaining pilot surfaces');

assert(suggestZoneFromKm(15) === 'Z1', '15 km is Z1');
assert(suggestZoneFromKm(15.1) === 'Z2', 'just over 15 km is Z2');
assert(suggestZoneFromKm(40) === 'Z2', '40 km is Z2');
assert(suggestZoneFromKm(40.1) === 'Z3', 'just over 40 km is Z3');
assert(suggestZoneFromKm(135) === 'Z3', '135 km is Z3');
assert(suggestZoneFromKm(135.1) === 'Z4', 'just over 135 km is Z4');
assert(DEFAULT_ZONE_KM_BANDS.Z1 === 15 && DEFAULT_ZONE_KM_BANDS.Z2 === 40 && DEFAULT_ZONE_KM_BANDS.Z3 === 135, 'band constants match FARE_CONFIG');
assert(FARE_CONFIG.offPeakEveryDay === false, 'off-peak is weekday-only');
assert(Array.isArray(FARE_CONFIG.confirmedFareRegions) && FARE_CONFIG.confirmedFareRegions.includes('GP'), 'Gauteng dump zones are confirmed');
assert(cheaperZone('Z2', 'Z1') === 'Z1', 'Z1 is cheaper than Z2');
assert(singleRouteIdFromList([{ id: 'pta-saul' }]) === 'pta-saul', 'one route id is a single-route trip');
assert(singleRouteIdFromList([{ id: 'pta-saul' }, { id: 'pta-jhb' }]) === null, 'two route ids are not corridor-capped');

{
    const prevDb = $fullDatabase.get();
    try {
        $fullDatabase.set({
            pta_to_saul_weekday_zone: 'Z1',
            saul_to_pta_weekday_zone: 'Z1',
        });
        setRouteFaresCache({});
        assert(dumpZoneForRoute('pta-saul') === 'Z1', 'Pretoria-Saulsville dump zone is Z1');
        assert(suggestZoneFromKm(16) === 'Z2', '16 km is Z2 before the corridor cap');
        assert(capZoneForSingleRoute('Z2', 'pta-saul') === 'Z1', 'single-route quote cannot exceed dump Z1');
        const capped = computeZoneFareForTrip(capZoneForSingleRoute('Z2', 'pta-saul'), { dayType: 'weekday', depTime: '07:30' });
        assert(capped && capped.price === 10 && capped.zone === 'Z1', `Pretoria-Atteridgeville adult peak is R10, got ${JSON.stringify(capped)}`);
        assert(lookupRouteFareCap('pta-saul')?.source === 'dump', 'GP cap comes from the dump until RTDB says otherwise');
        setRouteFaresCache({ 'pta-saul': { confirmed: false } });
        assert(capZoneForSingleRoute('Z2', 'pta-saul') === 'Z2', 'RTDB confirmed:false lifts the GP dump cap');
        setRouteFaresCache({ 'ct-bellv': { confirmed: true, zone: 'Z1' } });
        assert(capZoneForSingleRoute('Z2', 'ct-bellv') === 'Z1', 'operator-confirmed WC route is capped');
        setRouteFaresCache({});
        assert(capZoneForSingleRoute('Z2', 'ct-bellv') === 'Z2', 'unconfirmed WC stays on km zone');
    } finally {
        setRouteFaresCache({});
        $fullDatabase.set(prevDb);
    }
}

{
    const sat = computeZoneFareForTrip('Z2', { dayType: 'saturday', depTime: '11:00' });
    assert(sat && sat.isOffPeak === false, `Saturday 11:00 must be peak, got ${JSON.stringify(sat)}`);
    const wk = computeZoneFareForTrip('Z2', { dayType: 'weekday', depTime: '11:00' });
    assert(wk && wk.isOffPeak === true, `weekday 11:00 must be off-peak, got ${JSON.stringify(wk)}`);
    assert(wk.price === 7 && wk.priceLabel === '7', `Z2 weekday off-peak floors R7.50 to R7, got ${JSON.stringify(wk)}`);
    assert(wk.rawPrice > wk.price, 'fare sheet can reveal the unrounded calculated price');
    const peak = computeZoneFareForTrip('Z2', { dayType: 'weekday', depTime: '07:30' });
    assert(peak && peak.isOffPeak === false, `weekday 07:30 must be peak, got ${JSON.stringify(peak)}`);
}

assert(FARE_CONFIG.profiles.Scholar.alwaysDiscount === true, 'Scholar is the always-on discount profile');
assert(!FARE_CONFIG.profiles.Adult.alwaysDiscount, 'Adult is not always-on');
assert(!FARE_CONFIG.profiles.Pensioner.alwaysDiscount, 'Pensioner is off-peak only');
assert(fareMultiplierForProfile('Scholar', false) === 0.5, 'Scholar peak is 50%');
assert(fareMultiplierForProfile('Scholar', true) === 0.5, 'Scholar off-peak is still 50%');
assert(fareMultiplierForProfile('Adult', false) === 1, 'Adult peak is full fare');
assert(fareMultiplierForProfile('Adult', true) === 0.6, 'Adult off-peak is 40% off');
assert(fareMultiplierForProfile('Pensioner', false) === 1, 'Pensioner peak is full fare');
assert(fareMultiplierForProfile('Pensioner', true) === 0.5, 'Pensioner off-peak is 50%');

{
    $userProfile.set('Scholar');
    try {
        const scholarPeak = computeZoneFareForTrip('Z2', { dayType: 'weekday', depTime: '07:30' });
        assert(scholarPeak && scholarPeak.alwaysDiscount === true && scholarPeak.price === 6,
            `Scholar weekday 07:30 must be R6 (50% of Z2 12), got ${JSON.stringify(scholarPeak)}`);
        const scholarOff = computeZoneFareForTrip('Z2', { dayType: 'weekday', depTime: '11:00' });
        assert(scholarOff && scholarOff.alwaysDiscount === true && scholarOff.price === 6,
            `Scholar weekday 11:00 must stay R6, got ${JSON.stringify(scholarOff)}`);
        const scholarSat = computeZoneFareForTrip('Z2', { dayType: 'saturday', depTime: '11:00' });
        assert(scholarSat && scholarSat.alwaysDiscount === true && scholarSat.price === 6 && scholarSat.isOffPeak === false,
            `Scholar Saturday 11:00 must stay R6, got ${JSON.stringify(scholarSat)}`);
    } finally {
        $userProfile.set('Adult');
    }
}

const ui = readFileSync(join(ROOT, 'src/lib/planner-ui.js'), 'utf8');
assert(ui.includes('function canShowTripPrice() {\n    return true;\n}'), 'trip fare is not feature-gated');
assert(!ui.includes('isFeatureEnabled(FEATURE_KEYS.TRIP_PRICE)'), 'planner does not read the tripPrice flag');
assert(!ui.includes("canAccessPilotSurface('tripPrice')"), 'planner does not use the tripPrice pilot surface');
assert(ui.includes('Trip fare:'), 'fare label is Trip fare on one line');
assert(!ui.includes('TRIP FARE:'), 'fare label is not all-caps TRIP FARE');
assert(ui.includes('text-xs font-black text-gray-800'), 'Trip fare is 12px gray-800');
assert(ui.includes('plannerMoneySvg') || ui.includes('M3 7.5h13.5'), 'trip fare button has a money SVG');
assert(ui.includes('planner-fare-profile-btn'), 'Adult in the fare sheet is a profile button');
assert(ui.includes('openPassengerTypePicker'), 'Adult opens the passenger profile picker');
assert(ui.includes('roundBoardFare'), 'planner uses the board whole-rand floor');
assert(ui.includes('border-b border-dotted'), 'Trip fare uses a dotted underline');
assert(ui.includes('getSmoothTripDistanceKm'), 'fare uses smoothed rail distance');
assert(ui.includes('getCrowFliesTripKm'), 'fare also computes first-to-last straight-line km');
assert(ui.includes('Straight-line'), 'fare sheet still has the crow-flies line');
assert(ui.includes('data-admin-authed-only') && ui.includes('Straight-line') && ui.includes('Zone'), 'straight-line and zone are admin-only');
assert(ui.includes('applyAdminAuthedChrome(isAdminAuthed())'), 'fare sheet re-applies admin chrome after innerHTML');
assert(ui.includes("peakTitle = fare.alwaysDiscount ? 'Discount'"), 'scholar sheet labels Discount, not Peak / off-peak');
assert(ui.includes('50% all day'), 'scholar sheet says 50% all day');
assert(ui.includes('planner-fare-breakdown-sheet'), 'fare sheet is wired');
assert(ui.includes('applyApprovedPlannerFare'), 'planner results apply approved live prices');
assert(ui.includes('ensurePlannerFareOverrides'), 'planner fetches config/planner_fares before painting the button');
assert(ui.includes('capZoneForSingleRoute') && ui.includes('ensureRouteFares'), 'single-route quotes apply the confirmed corridor cap');
assert(ui.includes('resolvePlannerQuoteZone'), 'planner quote zone is km then corridor cap');
assert(!/saulsville/i.test(ui), 'do not hardcode Saulsville');
{
    const crow = getCrowFliesTripKm({
        stops: [
            { station: 'A', lat: 0, lon: 0 },
            { station: 'B', lat: 0, lon: 1 },
            { station: 'C', lat: 0, lon: 0.1 },
        ],
    });
    const hops = getCrowFliesTripKm({
        stops: [
            { station: 'A', lat: 0, lon: 0 },
            { station: 'C', lat: 0, lon: 0.1 },
        ],
    });
    assert(crow != null && hops != null && crow === hops, `crow-flies ignores intermediate hops, got ${crow} vs ${hops}`);
}

const modal = readFileSync(join(ROOT, 'src/components/PlannerModals.astro'), 'utf8');
assert(modal.includes('id="planner-fare-breakdown-sheet"'), 'fare bottom sheet markup exists');
assert(modal.includes('id="planner-fare-od"'), 'fare sheet shows origin to destination');
assert(modal.includes('The price algorithm is still being developed and tested, so it may not be accurate.'), 'fare sheet warns the algorithm is experimental');
assert(modal.includes('Trip fare') && modal.includes('M3 7.5h13.5'), 'Trip fare title has a money SVG on the left');
assert(ui.includes("ev.target === ev.currentTarget"), 'tapping the blurred fare overlay closes the sheet');
assert(ui.includes('planner-fare-raw-toggle'), 'tapping the fare amount reveals the raw calculated price');

if (failures.length) {
    console.error(`verify-trip-price: ${failures.length} failed`);
    for (const f of failures) console.error(' -', f);
    process.exit(1);
}
console.log('verify-trip-price: ok');
