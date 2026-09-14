/**
 * Report freshness, tracking window, nearby ranking.
 * Run: node scripts/verify-reports-tracking.mjs
 */
import {
    TRACKING_WINDOW_SEC,
    compareNearbyTrainLikelihood,
    isGhostTrackable,
    progressAlongStopsDetailed,
    journeyPositionLabel,
    alignBearingToJourney,
} from '../src/lib/train-ghosts.js';
import {
    closestPointOnPath,
    trustedEdgeThresholdM,
    projectToTrustedFeature,
    trackBearingDeg,
    TRACKER_SNAP_MAX_M,
} from '../src/lib/rail-tracks.js';
import {
    adaptiveOnboardPingMs,
    compactPingsForMap,
    consensusProjectedPings,
    isTrackingInterchange,
    ONBOARD_FAST_PING_MS,
    ONBOARD_MOVING_PING_MS,
    ONBOARD_STATIONARY_PING_MS,
    pingPublicTrainId,
    projectTrainTrackerFix,
    terminusStopShouldFire,
    TRACKING_STATE,
    updateDirectionObservation,
} from '../src/lib/ride-pings.js';
import { refineMotionFix, reusableGeoFix, locateFixOrLast, GEO_REUSE_MAX_AGE_MS } from '../src/lib/geo-watch.js';
import { readFileSync } from 'node:fs';
import {
    WEEKDAY_REPORT_MAX_AGE_MS,
    WEEKEND_REPORT_MAX_AGE_MS,
    reportSurfaceWindowMs,
    isReportStillLive,
    isAfterReportCurfew,
    isSameLocalDay,
    expiredReportsFromToday,
    routeHasNoScheduledTrains,
} from '../src/lib/delay-reports.js';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

assert(TRACKING_WINDOW_SEC === 45 * 60, 'tracking window is 45 minutes');
assert(TRACKER_SNAP_MAX_M === 100, 'train fixes never widen beyond 100m');
assert(WEEKDAY_REPORT_MAX_AGE_MS === 60 * 60 * 1000, 'weekday reports last one hour');
assert(WEEKEND_REPORT_MAX_AGE_MS === 3 * 60 * 60 * 1000, 'weekend reports keep a 3-hour window');
assert(reportSurfaceWindowMs('weekday') === WEEKDAY_REPORT_MAX_AGE_MS, 'weekday surface window');
assert(reportSurfaceWindowMs('saturday') === WEEKEND_REPORT_MAX_AGE_MS, 'saturday surface window');
assert(reportSurfaceWindowMs('sunday') === WEEKEND_REPORT_MAX_AGE_MS, 'sunday surface window');

const nowMs = Date.parse('2026-09-10T11:00:00+02:00');
const nowSec = 11 * 3600;
const fresh = {
    timestamp: nowMs - 20 * 60 * 1000,
    scheduledTime: '10:30:00',
    trainStatus: 'late',
    lateBucket: '11-20',
    statusOpen: 'open',
};
assert(isReportStillLive(fresh, { nowMs, nowSec, dayType: 'weekday' }), 'fresh weekday late report stays');

const hourOld = { ...fresh, timestamp: nowMs - 61 * 60 * 1000 };
assert(!isReportStillLive(hourOld, { nowMs, nowSec, dayType: 'weekday' }), 'weekday reports older than an hour hide');
assert(isReportStillLive(hourOld, { nowMs, nowSec, dayType: 'saturday' }), 'weekend reports can stay past one hour');

const wayPast = {
    timestamp: nowMs - 10 * 60 * 1000,
    scheduledTime: '08:00:00',
    trainStatus: 'early',
    statusOpen: 'open',
};
assert(!isReportStillLive(wayPast, { nowMs, nowSec, dayType: 'weekday' }), 'trains well past their time hide');

const finished = {
    finished: true,
    started: true,
    nowSec,
    stops: [{ seconds: nowSec - 2 * 3600 }, { seconds: nowSec - 2 * 3600 }],
};
assert(!isGhostTrackable(finished, nowSec), 'ghost two hours after last stop is not trackable');

const justArrived = {
    finished: true,
    started: true,
    nowSec,
    stops: [{ seconds: nowSec - 600 }, { seconds: nowSec - 600 }],
};
assert(isGhostTrackable(justArrived, nowSec), 'ghost 10 minutes after last stop stays trackable');

const ranked = [
    { trainId: 'far', metres: 4000, plausible: false, ghost: { finished: false } },
    { trainId: 'done', metres: 80, plausible: true, ghost: { finished: true } },
    { trainId: 'near', metres: 120, plausible: true, ghost: { finished: false } },
].sort(compareNearbyTrainLikelihood);
assert(ranked[0].trainId === 'near', 'most likely nearby train is first');
assert(ranked[1].trainId === 'done', 'just-finished trains rank after live ones');
assert(ranked[2].trainId === 'far', 'implausible trains rank last');

const mixedFeature = {
    properties: { chordHops: 1 },
    geometry: {
        type: 'LineString',
        coordinates: [[28, -25], [28.001, -25], [28.002, -25], [28.03, -25]],
    },
};
const trustedThreshold = trustedEdgeThresholdM(mixedFeature);
assert(trustedThreshold >= 250 && trustedThreshold <= 700, 'mixed route derives a bounded trusted-edge threshold');
assert(
    trustedEdgeThresholdM({ ...mixedFeature, properties: { chordHops: 0 } }) > 1000,
    'chord-free OSM route keeps its full geometry'
);
const chordMidpoint = projectToTrustedFeature(mixedFeature, -25, 28.016);
assert(
    chordMidpoint?.distanceM > TRACKER_SNAP_MAX_M,
    'a point on the long synthetic chord is not accepted as trusted rail'
);
const closestRailPoint = closestPointOnPath([[0, 0], [0, 0.01]], 0.001, 0.005);
assert(
    Math.abs(closestRailPoint?.lat || 0) < 0.000001
        && Math.abs((closestRailPoint?.lon || 0) - 0.005) < 0.000001,
    'selected-path distance projects onto the rail segment, not only its vertices'
);
assert(
    closestRailPoint?.distanceM > 110 && closestRailPoint?.distanceM < 112,
    'selected-path distance reports metres to the closest rail point'
);
assert(
    closestRailPoint?.pathFraction > 0.49 && closestRailPoint?.pathFraction < 0.51,
    'selected-path projection records journey progress'
);
assert(
    Number.isFinite(closestRailPoint?.trackBearing)
        && Math.abs((((closestRailPoint.trackBearing % 360) + 360) % 360) - 90) < 1,
    'east-west rail segment reports a local eastward track bearing'
);
assert(Math.abs(trackBearingDeg(0, 0, 0.01, 0)) < 1, 'northbound segment bearing is ~0');
assert(Math.abs(trackBearingDeg(0, 0, 0, 0.01) - 90) < 1, 'eastbound segment bearing is ~90');
assert(alignBearingToJourney(90, 270) === 270, 'undirected east tangent flips to match westbound travel');
assert(alignBearingToJourney(15, 10) === 15, 'track tangent close to travel is kept');
assert(alignBearingToJourney(null, 42) === 42, 'missing track tangent falls back to journey heading');

const stationaryFix = refineMotionFix(
    { lat: -25, lng: 28.00007, accuracy: 10, heading: null, speedMps: 1.1, t: 11000 },
    { lat: -25, lng: 28, accuracy: 10, heading: 90, speedMps: 0, t: 1000 }
);
assert(stationaryFix?.speedMps === 0 && stationaryFix.stationary, 'GPS drift inside accuracy clamps to stationary');
const movingFix = refineMotionFix(
    { lat: -25, lng: 28.001, accuracy: 5, heading: null, speedMps: null, t: 11000 },
    { lat: -25, lng: 28, accuracy: 5, heading: null, speedMps: null, t: 1000 }
);
assert(movingFix?.speedMps > 8 && movingFix?.heading > 80 && movingFix?.heading < 100, 'meaningful movement derives speed and heading');
assert(refineMotionFix(
    { lat: -25, lng: 28.1, accuracy: 5, heading: 90, speedMps: 5, t: 2000 },
    { lat: -25, lng: 28, accuracy: 5, heading: 90, speedMps: 5, t: 1000 }
) === null, 'implausible GPS jump is rejected');
const poorAccuracyFix = refineMotionFix(
    { lat: -25, lng: 28.0006, accuracy: 200, heading: 90, speedMps: 12, t: 6000 },
    { lat: -25, lng: 28, accuracy: 200, heading: null, speedMps: 0, t: 1000 }
);
assert(poorAccuracyFix?.speedMps === 0 && poorAccuracyFix.stationary, 'poor-accuracy displacement cannot impersonate train speed');
assert(refineMotionFix(
    { lat: -25, lng: 28.01, accuracy: 5, heading: 90, speedMps: 10, t: 1000 },
    { lat: -25, lng: 28, accuracy: 5, heading: 90, speedMps: 10, t: 1000 }
) === null, 'non-newer GPS timestamp is ignored');

const mapPin = { lat: -25.75, lng: 28.19, accuracy: 99, heading: null, speedMps: 0, t: 50_000 };
assert(reusableGeoFix(mapPin, 50_000 + 8_000), 'map pin younger than 8s is reusable');
assert(reusableGeoFix(mapPin, 50_000 + 25_000), 'map pin younger than 30s is reusable');
assert(!reusableGeoFix(mapPin, 50_000 + GEO_REUSE_MAX_AGE_MS + 1), 'stale map pin is not reused');
assert(!reusableGeoFix({ lat: -25.75, lng: 28.19, accuracy: 99 }, 50_000), 'untimed fix is not reused');
assert(
    locateFixOrLast(null, mapPin, 50_000 + 5_000)?.lat === mapPin.lat,
    'failed high-accuracy locate keeps the map pin'
);
assert(
    locateFixOrLast(
        { lat: -25.751, lng: 28.191, accuracy: 20 },
        mapPin,
        50_000 + 5_000
    )?.lat === -25.751,
    'trusted high-accuracy locate wins over the map pin'
);
assert(adaptiveOnboardPingMs(12) === ONBOARD_FAST_PING_MS, 'fast train broadcasts every 5 seconds');
assert(adaptiveOnboardPingMs(2) === ONBOARD_MOVING_PING_MS, 'slow movement broadcasts every 10 seconds');
assert(adaptiveOnboardPingMs(0) === ONBOARD_STATIONARY_PING_MS, 'stationary share heartbeats every 25 seconds');
assert(!terminusStopShouldFire({
    atLast: true, lastIndex: 12, minProgressSeen: 12,
}), 'sitting at the last station when sharing starts does not end the share');
assert(terminusStopShouldFire({
    atLast: true, lastIndex: 12, minProgressSeen: 4,
}), 'reaching the last station after travelling the corridor prompts to confirm arrival');

let directionObservation = updateDirectionObservation({}, {
    speedMps: 10, heading: 270, expectedHeading: 90, accuracy: 8, now: 1000,
});
directionObservation = updateDirectionObservation(directionObservation, {
    speedMps: 10, heading: 270, expectedHeading: 90, accuracy: 8, now: 12000,
});
directionObservation = updateDirectionObservation(directionObservation, {
    speedMps: 10, heading: 270, expectedHeading: 90, accuracy: 8, now: 23000,
});
assert(directionObservation.warning, 'sustained reliable opposite travel raises direction warning');
const stationaryObservation = updateDirectionObservation(directionObservation, {
    speedMps: 0, heading: 270, expectedHeading: 90, accuracy: 8, now: 24000,
});
assert(stationaryObservation.warning, 'stationary sample is not evidence that clears direction warning');
const hubObservation = updateDirectionObservation(directionObservation, {
    speedMps: 10, heading: 270, expectedHeading: 90, accuracy: 8, nearInterchange: true, now: 24000,
});
assert(!hubObservation.warning && hubObservation.conflicts === 0, 'interchange proximity suspends direction enforcement');
assert(isTrackingInterchange('KOEDOESPOORT STATION', {}), 'configured Koedoespoort transfer is tracking-lenient');
assert(isTrackingInterchange('SHARED', { SHARED: { routes: new Set(['a', 'b']) } }), 'multi-route station is tracking-lenient');

const stops = [
    { station: 'ORIGIN' },
    { station: 'MIDDLE' },
    { station: 'TERMINUS' },
];
const stationIndex = {
    ORIGIN: { lat: -25, lon: 28 },
    MIDDLE: { lat: -25, lon: 28.01 },
    TERMINUS: { lat: -25, lon: 28.02 },
};
const projected = progressAlongStopsDetailed(-25, 28.015, stops, stationIndex);
assert(projected?.progress > 1 && projected.progress < 2, 'journey projection stays on ordered stop sequence');
assert(
    journeyPositionLabel(stops, projected?.progress) === 'Between MIDDLE and TERMINUS',
    'projected progress produces a human between-stations label'
);

const acceptedAt = Date.now();
const consensus = consensusProjectedPings([
    { trackingState: TRACKING_STATE.ACTIVE, acceptedAt, projectedProgress: 1.0, projectedLat: -25, projectedLng: 28 },
    { trackingState: TRACKING_STATE.ACTIVE, acceptedAt, projectedProgress: 1.05, projectedLat: -25, projectedLng: 28.001 },
    { trackingState: TRACKING_STATE.ACTIVE, acceptedAt, projectedProgress: 8, projectedLat: -25, projectedLng: 28.2 },
    { trackingState: TRACKING_STATE.PAUSED, acceptedAt, projectedProgress: 1.02, projectedLat: -25, projectedLng: 28.001 },
]);
assert(consensus.length === 2, 'progress consensus rejects paused and along-route outlier pings');

const pausedAt = Date.now();
const pausedMarkers = await compactPingsForMap([{
    deviceId: 'paused-device',
    routeId: 'pta-pien',
    trainId: '1000',
    station: 'MIDDLE',
    coarseLat: -25.1,
    coarseLng: 28.1,
    projectedLat: -25,
    projectedLng: 28.01,
    projectedProgress: 1,
    routeProgressM: 12400,
    acceptedAt: pausedAt - 45000,
    at: pausedAt,
    expiresAt: pausedAt + 600000,
    bearing: 92,
    speedMps: 0,
    accuracy: 18,
    lastSeenLabel: 'At MIDDLE',
    trackingState: TRACKING_STATE.PAUSED,
    pauseReason: 'offline',
}], { mineDeviceId: 'observer', routeId: 'pta-pien' });
assert(pausedMarkers.length === 1, 'paused train remains visible on the map');
assert(pausedMarkers[0]?.trackingState === TRACKING_STATE.PAUSED, 'paused map marker exposes paused status');
assert(
    pausedMarkers[0]?.lat === -25 && pausedMarkers[0]?.lng === 28.01,
    'paused map marker stays at its last accepted projected position'
);
assert(pausedMarkers[0]?.bearing === 92, 'paused map marker preserves accepted bearing');
assert(pausedMarkers[0]?.routeProgressM === 12400, 'paused map marker exposes rail distance');
assert(pausedMarkers[0]?.accuracy === 18, 'paused map marker exposes GPS accuracy');
const staleActiveMarkers = await compactPingsForMap([{
    deviceId: 'stale-active',
    routeId: 'pta-pien',
    trainId: '1000',
    station: 'MIDDLE',
    coarseLat: -25.1,
    coarseLng: 28.1,
    projectedLat: -25,
    projectedLng: 28.01,
    projectedProgress: 1,
    acceptedAt: Date.now() - 120000,
    at: Date.now() - 120000,
    expiresAt: Date.now() + 600000,
    bearing: 92,
    trackingState: TRACKING_STATE.ACTIVE,
}], { routeId: 'pta-pien' });
assert(
    staleActiveMarkers[0]?.trackingState === TRACKING_STATE.PAUSED,
    'a stale active write remains visible as a stationary paused marker'
);

const mapAppSource = readFileSync(new URL('../public/js/map-app.js', import.meta.url), 'utf8');
const mapPageSource = readFileSync(new URL('../src/pages/map.astro', import.meta.url), 'utf8');
const mapViewSource = readFileSync(new URL('../src/components/MapView.astro', import.meta.url), 'utf8');
const mapTabSource = readFileSync(new URL('../src/lib/map-tab.js', import.meta.url), 'utf8');
const ridePingsSource = readFileSync(new URL('../src/lib/ride-pings.js', import.meta.url), 'utf8');
const geoWatchSource = readFileSync(new URL('../src/lib/geo-watch.js', import.meta.url), 'utf8');
const boardSource = readFileSync(new URL('../src/lib/renderer.js', import.meta.url), 'utf8');
const liveBoardSource = readFileSync(new URL('../src/components/LiveBoard.astro', import.meta.url), 'utf8');
const timetableSource = readFileSync(new URL('../src/lib/timetable-grid.js', import.meta.url), 'utf8');
assert(mapAppSource.includes('nt-live-train-oval'), 'map marker is two merged rail ovals');
assert(mapAppSource.includes('style="transform:rotate('), 'map marker rotates with accepted bearing');
assert(mapAppSource.includes('function railOvalYawDeg'), 'map marker yaws the long axis onto the rail');
assert(mapAppSource.includes('bearing - 90'), 'horizontal oval yaw is geographic bearing minus 90');
assert(mapAppSource.includes('nt-map-user-location'), 'embed map paints parent watch fixes without recentering');
assert(mapAppSource.includes('nt-map-request-locate'), 'locate button asks the parent to recenter');
assert(mapAppSource.includes('enableHighAccuracy: false'), 'standalone map watch is fused, not GPS-only');
assert(!mapAppSource.includes('enableHighAccuracy: true});'), 'map no longer starts a Leaflet high-accuracy watch');
assert(mapTabSource.includes('acquireGeoWatch'), 'map tab holds the fused geo watch while visible');
assert(mapTabSource.includes('releaseGeoWatch'), 'leaving the map tab drops the map geo-watch holder');
assert(ridePingsSource.includes("acquireGeoWatch('share')"), 'an active share keeps the fused geo watch');
assert(ridePingsSource.includes('alignBearingToJourney'), 'projected pings use rail tangent aligned to travel');
assert(geoWatchSource.includes('watchPosition'), 'geo watch uses a single watchPosition');
assert(geoWatchSource.includes('enableHighAccuracy: false'), 'seek watch is fused / low power');
assert(geoWatchSource.includes('document.hidden'), 'geo watch pauses when the document is hidden');
assert(geoWatchSource.includes("holders.add"), 'geo watch is reference-counted by map and share');
assert(geoWatchSource.includes('reusableGeoFix'), 'locate can keep a fresh fused map pin');
assert(geoWatchSource.includes('locateFixOrLast'), 'failed high-accuracy locate falls back to the map pin');
assert(mapTabSource.includes('knownMapFix'), 'nearby trains reuse the painted map pin');
assert(mapTabSource.includes("acquireGeoWatch('sample')"), 'onboard GPS sampling uses the fused watch, not a second one');
assert(!mapTabSource.includes('enableHighAccuracy: true, maximumAge: 0'), 'onboard sampling no longer starts a GPS-only watch');
assert(ridePingsSource.includes('reusableGeoFix'), 'presence share reuses the fused map pin');
assert(mapPageSource.includes('nt-live-train-oval'), 'map page styles the merged ovals');
assert(mapPageSource.includes('border-radius: 999px'), 'map marker uses a capsule oval');
assert(mapAppSource.includes('interpolateRideMarkerLatLng'), 'remote map marker interpolates bounded received corrections');
assert(mapAppSource.includes('let marker = rideTrainMarkers[trainId]'), 'train markers are retained by train id');
assert(mapAppSource.includes('readableTrainLabelDeg'), 'train number has a dedicated readable angle');
assert(mapAppSource.includes('readable > 90') && mapAppSource.includes('readable < -90'), 'train number is bounded to -90 through 90 degrees');
assert(mapAppSource.includes('nt-live-train-wake'), 'train pill includes a bow wake');
assert(mapAppSource.includes('nt-live-train-wake-ripple'), 'wake is stacked V ripples');
assert(mapPageSource.includes('transform-origin: right center'), 'wake arms hinge at the bow and open aft');
assert(mapPageSource.includes('translate(-26px, -50%)'), 'wake ripples travel backward, not forward');
assert(mapPageSource.includes('prefers-reduced-motion: reduce'), 'train motion respects reduced-motion preference');
assert(mapAppSource.includes('Show tracking details'), 'train popup opens tracking details');
assert(mapAppSource.includes('Rail distance') && mapAppSource.includes('GPS accuracy'), 'train popup exposes tracking metrics');
assert(mapViewSource.includes('id="map-tracking-card"'), 'current contributor has a bottom tracking card');
assert(mapViewSource.includes('id="map-tracking-minimize"'), 'tracking card is minimizable');
assert(mapViewSource.includes('id="map-tracking-dismiss"'), 'tracking card is dismissible');
assert(mapTabSource.includes('Currently tracking'), 'Nearby trains shows the current tracked train status');
assert(mapTabSource.includes('data-current-tracking-details'), 'Nearby current train opens tracking details');
assert(mapTabSource.includes('renderTrackingStatusCard') && mapTabSource.includes('trackingCardMode'), 'tracking metrics keep updating while the card is minimized');
assert(mapTabSource.includes("setInterval(() => {") && mapTabSource.includes('map-tracking-warning'), 'tracking dashboard refreshes its live metrics and warning');
assert(ridePingsSource.includes('subscribeGeoFix') && ridePingsSource.includes('adaptiveOnboardPingMs'), 'train sharing consumes every fix and broadcasts adaptively');
assert(ridePingsSource.includes("title: 'Has this train arrived?'"), 'last station asks if the train has arrived');
assert(ridePingsSource.includes("keepLabel: 'Still on the train'"), 'last-station prompt can keep sharing');
assert(ridePingsSource.includes("stopLabel: 'Yes, we’ve arrived'"), 'last-station prompt can confirm arrival');
assert(ridePingsSource.includes("title: 'Still on this train?'"), 'off-track and direction mismatch ask before stopping');
assert(ridePingsSource.includes('offTrackStayUntil'), 'still-on-it snoozes another off-track drop');
assert(ridePingsSource.includes('sharePromptOpen'), 'overlapping share prompts do not stack');
assert(ridePingsSource.includes("reason === 'direction'"), 'direction mismatch can end the share after the prompt');
assert(ridePingsSource.includes('cacheLocalProjectedFix'), 'owner pill updates locally before Firebase');
assert(ridePingsSource.includes("source: 'onboard_local'"), 'local projected position is distinct from broadcast telemetry');
assert(ridePingsSource.includes('{ silent: true }'), 'open timetable tracker refreshes without repeated haptics');
assert(ridePingsSource.includes('onboardGeneration'), 'stale queued writes are invalidated when sharing stops');
assert(ridePingsSource.includes('await onboardProjectionChain'), 'stop waits behind any in-flight location write');
assert(ridePingsSource.includes('onboardPendingFix = pos') && ridePingsSource.includes('while (generation === onboardGeneration && onboardPendingFix)'), 'slow writes coalesce queued GPS fixes to the latest sample');
assert(ridePingsSource.includes('queueOnboardPause'), 'lifecycle pauses serialize behind location writes');
assert(ridePingsSource.includes('onboardWatchStartedAt'), 'share can become stale before its first GPS callback');
assert(ridePingsSource.includes('Math.min(350'), 'interchange GPS leniency has a bounded radius');
assert(ridePingsSource.includes('firebaseGetIdToken(window.firebaseAuth.currentUser, forceRefresh)'), 'adaptive pings reuse cached auth tokens');
assert(mapTabSource.includes("modal.id = 'nt-share-checks-modal'"), 'train sharing opens the live checks bottom sheet');
assert(mapTabSource.includes('Restart checks'), 'live checks can be restarted');
assert(mapTabSource.includes('Distance to selected rail path'), 'checks measure the selected train path');
assert(!mapTabSource.includes('from Train ${finalId} - sharing as a commuter'), 'share result does not describe distance from a train');
assert(mapTabSource.includes('Share on the map as this train') || mapTabSource.includes('publishAdminManualTrain'), 'admin nearby sheet publishes a test train onto the map');
assert(!mapTabSource.includes('Admin map marker override'), 'admin checks no longer expose Auto/Train/Person radios');
assert(mapTabSource.includes("source: 'admin_manual_train'"), 'admin nearby sheet can publish a weekday train id');
assert(mapTabSource.includes('shareAdminTrainOnMap'), 'admin publish skips rail-path checks and opens the map');
assert(mapTabSource.includes('Share on the map as Train'), 'admin checks sheet has a clear share-anyway button');
assert(ridePingsSource.includes("trustedAdminOverride !== 'train'"), 'admin train override bypasses the empty-day guard');
assert(ridePingsSource.includes('!isRideCheckInEnabled(routeId) && !trustedAdminOverride'), 'admin test share is allowed when ride check-in is off');
assert(ridePingsSource.includes('{ force = false }'), 'map tab can listen for ride pings when the corridor flag is off');
assert(ridePingsSource.includes('!force && !isRideCheckInEnabled(routeId) && !isAdminAuthed()'), 'corridor flag still gates commuter listeners');
assert(!ridePingsSource.includes('scoreTrainForFix'), 'verified live pings are not measured against a timetable ghost');
assert(ridePingsSource.includes('Number(p.railDistanceM)'), 'verified live pings use distance to rail');
assert(pingPublicTrainId({ trainId: '1000', adminOverrideRole: 'train' }) === '1000', 'admin train override paints the train marker');
assert(pingPublicTrainId({ trainId: '1000', adminOverrideRole: 'person' }) === null, 'admin person override does not paint the train marker');
const databaseRules = readFileSync(new URL('../firebase-database.rules.json', import.meta.url), 'utf8');
assert(
    databaseRules.includes("newData.child('adminOverrideRole').val() === 'train'")
        && databaseRules.includes("auth.token.email === 'thandeka05nxumalo@gmail.com'"),
    'database rules restrict marker overrides to the operator allowlist'
);
assert(!boardSource.includes('nt-live-train-pulse'), 'Next Train cards have no sharing pulse');
assert(!liveBoardSource.includes('nt-timetable-live-dot'), 'full timetable control has no sharing dot');
assert(!timetableSource.includes('paintLiveTrainDots'), 'full timetable does not paint sharing dots');

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
        features: [{
            type: 'Feature',
            properties: { routeId: 'pta-pien', chordHops: 0 },
            geometry: { type: 'LineString', coordinates: [[28, -25], [28.01, -25], [28.02, -25]] },
        }],
    }),
});
const trackerSchedule = {
    headers: ['STATION', '1000'],
    rows: [
        { STATION: 'ORIGIN', 1000: '10:00:00' },
        { STATION: 'MIDDLE', 1000: '10:10:00' },
        { STATION: 'TERMINUS', 1000: '10:20:00' },
    ],
};
const acceptedFix = await projectTrainTrackerFix({
    lat: -25.0002,
    lng: 28.005,
    trainId: '1000',
    routeId: 'pta-pien',
    stationIndex,
    schedules: [trackerSchedule],
});
assert(acceptedFix.ok && acceptedFix.distanceM < 100, 'route-specific fix projects within the strict rail limit');
assert(acceptedFix.projectedProgress > 0 && acceptedFix.projectedProgress < 1, 'accepted fix is bounded to journey progress');
const offTrackFix = await projectTrainTrackerFix({
    lat: -25.01,
    lng: 28.005,
    trainId: '1000',
    routeId: 'pta-pien',
    stationIndex,
    schedules: [trackerSchedule],
});
assert(
    !offTrackFix.ok && offTrackFix.reason === 'offTrack' && !offTrackFix.geometryUnavailable,
    'off-track fix is distinct from unavailable geometry'
);
const reverseFix = await projectTrainTrackerFix({
    lat: -25,
    lng: 28.002,
    trainId: '1000',
    routeId: 'pta-pien',
    previousProgress: 1,
    stationIndex,
    schedules: [trackerSchedule],
});
assert(!reverseFix.ok && reverseFix.reason === 'reverseProgress', 'reverse journey progress pauses tracking');
const interchangeReverseFix = await projectTrainTrackerFix({
    lat: -25,
    lng: 28.002,
    trainId: '1000',
    routeId: 'pta-pien',
    previousProgress: 0.4,
    allowReverse: true,
    stationIndex,
    schedules: [trackerSchedule],
});
assert(interchangeReverseFix.ok, 'interchange grace permits temporary reverse projection');
const missingRouteGeometry = await projectTrainTrackerFix({
    lat: -25,
    lng: 28.005,
    trainId: '1000',
    routeId: 'pta-mabopane',
    stationIndex,
    schedules: [trackerSchedule],
});
assert(
    !missingRouteGeometry.ok && missingRouteGeometry.geometryUnavailable,
    'missing route geometry is distinct from an off-track fix'
);
globalThis.fetch = originalFetch;

assert(routeHasNoScheduledTrains('sunday'), 'Sunday has no trains to report');
assert(!routeHasNoScheduledTrains('weekday', 'GP', {
    weekday_to_a: {
        headers: ['STATION', '0600'],
        rows: [{ STATION: 'PRETORIA', '0600': '06:00:00' }],
    },
}), 'weekday sheet with a clock is service');

const curfewMs = new Date(2026, 8, 10, 23, 59, 0).getTime();
assert(isAfterReportCurfew(curfewMs), '23:59 is report curfew');
assert(!isAfterReportCurfew(new Date(2026, 8, 10, 23, 58, 0).getTime()), '23:58 is still before curfew');
assert(!isReportStillLive(fresh, { nowMs: curfewMs, nowSec: 23 * 3600 + 59 * 60, dayType: 'weekday' }), 'live reports hide at 23:59');

const morning = new Date(2026, 8, 10, 11, 0, 0).getTime();
const staleToday = {
    timestamp: new Date(2026, 8, 10, 7, 0, 0).getTime(),
    scheduledTime: '06:30:00',
    trainStatus: 'late',
    lateBucket: '1-5',
    statusOpen: 'open',
};
assert(isSameLocalDay(staleToday.timestamp, morning), 'stale report is still today');
assert(!isReportStillLive(staleToday, { nowMs: morning, nowSec: 11 * 3600, dayType: 'weekday' }), 'hour-plus morning report is not live');
const expired = expiredReportsFromToday([staleToday], { nowMs: morning, nowSec: 11 * 3600, dayType: 'weekday' });
assert(expired.length === 1, 'expired accordion keeps today’s stale reports');
assert(expiredReportsFromToday([fresh], { nowMs, nowSec, dayType: 'weekday' }).length === 0, 'live reports stay out of expired');
assert(expiredReportsFromToday([staleToday], { nowMs: curfewMs }).length === 0, 'expired accordion also hides at 23:59');

if (failures.length) {
    console.error('verify-reports-tracking failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-reports-tracking: ok');
