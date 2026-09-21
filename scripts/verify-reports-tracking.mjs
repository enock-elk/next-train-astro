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
    isRidePingGpsStale,
    isTrackingInterchange,
    ONBOARD_FAST_PING_MS,
    ONBOARD_MOVING_PING_MS,
    ONBOARD_STATIONARY_PING_MS,
    pingPublicTrainId,
    projectTrainTrackerFix,
    terminusStopShouldFire,
    atTerminusPlatform,
    remainingCorridorTerminusFromStops,
    shouldPromptLeftTrain,
    TRACKING_STATE,
    updateDirectionObservation,
} from '../src/lib/ride-pings.js';
import {
    formatGpsPingAge,
    formatGpsPingClock,
    formatLastSeenWithPingClock,
    gpsPingSuccessAt,
    RIDE_GPS_STALE_MS,
    RIDE_INTERPOLATION_MAX_MS,
} from '../src/lib/gps-freshness.js';
import { refineMotionFix, confirmStationaryWatchTick, reusableGeoFix, locateFixOrLast, GEO_REUSE_MAX_AGE_MS } from '../src/lib/geo-watch.js';
import {
    applyMotionFusionToFix,
    classifyMotion,
    deadReckonFix,
    fusedHeadingFromPing,
    fusedSpeedFromPing,
    imuPredictFromGpsAnchor,
    ingestMotionGpsFix,
    mixHeading,
    peekMotionFusion,
    readPingMotionClass,
    resetMotionFusionForTest,
    startMotionFusion,
    wrap360,
} from '../src/lib/motion-fusion.js';
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
const homeJitter = refineMotionFix(
    { lat: -25, lng: 28.00008, accuracy: 18, heading: null, speedMps: 1.6, t: 11000 },
    { lat: -25, lng: 28, accuracy: 18, heading: null, speedMps: 0, t: 1000 }
);
assert(homeJitter?.speedMps === 0 && homeJitter.stationary, '5 km/h OS jitter inside the accuracy circle is stationary');
const walkFive = refineMotionFix(
    { lat: -25, lng: 28.00014, accuracy: 6, heading: null, speedMps: 1.39, t: 11000 },
    { lat: -25, lng: 28, accuracy: 6, heading: null, speedMps: 0, stationary: true, t: 1000 }
);
assert(walkFive && !walkFive.stationary && walkFive.speedMps >= 1.2 && walkFive.speedMps < 2, 'real 5 km/h walking still reports speed');
assert(refineMotionFix(
    { lat: -25, lng: 28, accuracy: 20, heading: null, speedMps: 1.6, t: 1000 },
    null
)?.speedMps === 0, 'first GPS sample does not show jitter as speed');
assert(refineMotionFix(
    { lat: -25, lng: 28.01, accuracy: 5, heading: 90, speedMps: 10, t: 1000 },
    { lat: -25, lng: 28, accuracy: 5, heading: 90, speedMps: 10, t: 1000 }
) === null, 'non-newer GPS timestamp is ignored');
const heardAgain = confirmStationaryWatchTick(
    { lat: -25.75, lng: 28.19, accuracy: 12, heading: null, speedMps: 0, t: 1000 },
    { lat: -25.75, lng: 28.19, accuracy: 12, heading: 174, speedMps: 0, t: 1000 },
    4000
);
assert(heardAgain?.t === 4000 && heardAgain.stationary, 'a repeated stationary GPS callback still counts as a live ping');
assert(
    confirmStationaryWatchTick(
        { lat: -26, lng: 29, accuracy: 8, t: 1000 },
        { lat: -25.75, lng: 28.19, accuracy: 8, t: 1000 },
        4000
    ) === null,
    'a repeated callback that jumped is not treated as a live ping'
);

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
assert(RIDE_GPS_STALE_MS === 12000 && RIDE_INTERPOLATION_MAX_MS === 12000, 'grey pause and interpolation share a 12 second window');
assert(ONBOARD_FAST_PING_MS === 4000 && ONBOARD_MOVING_PING_MS === 4000 && ONBOARD_STATIONARY_PING_MS === 4000, 'all onboard bands publish every 4 seconds while testing');
assert(adaptiveOnboardPingMs(12) === ONBOARD_FAST_PING_MS, 'fast train broadcasts every 4 seconds');
assert(adaptiveOnboardPingMs(2) === ONBOARD_MOVING_PING_MS, 'slow movement broadcasts every 4 seconds');
assert(adaptiveOnboardPingMs(0) === ONBOARD_STATIONARY_PING_MS, 'stationary share heartbeats every 4 seconds');
assert(!isRidePingGpsStale({ acceptedAt: Date.now() - 11000 }), 'an 11 second GPS ping is still live');
assert(isRidePingGpsStale({ acceptedAt: Date.now() - 13000 }), 'a 13 second GPS ping is stale');
assert(!terminusStopShouldFire({
    atLast: true, lastIndex: 12, minProgressSeen: 12,
}), 'sitting at the last station when sharing starts does not end the share');
assert(terminusStopShouldFire({
    atLast: true, lastIndex: 12, minProgressSeen: 4,
}), 'reaching the last station after travelling the corridor prompts to confirm arrival');
assert(!atTerminusPlatform({
    nearestIsLast: true, progress: 1.5, lastIndex: 2, distanceToLastM: 400,
}), 'between Mears and Pretoria is not the Pretoria platform');
assert(atTerminusPlatform({
    nearestIsLast: true, progress: 1.95, lastIndex: 2, distanceToLastM: 40,
}), 'on the last platform is arrival');
assert(!shouldPromptLeftTrain({
    arrivedAtTerminus: false, distanceToLastM: 400, leftPrompted: false,
}), 'leaving prompt waits until the rider actually arrived');
assert(shouldPromptLeftTrain({
    arrivedAtTerminus: true, distanceToLastM: 180, leftPrompted: false,
}), 'walking off the last platform asks if they left the train');
assert(
    remainingCorridorTerminusFromStops(
        [{ station: 'PRETORIA STATION' }, { station: 'KOEDOESPOORT STATION' }],
        'pta-pien',
    ) === 'PIENAARSPOORT STATION',
    'a Pretoria shuttle that ends at Koedoespoort still has Pienaarspoort ahead',
);
assert(
    remainingCorridorTerminusFromStops(
        [{ station: 'PRETORIA STATION' }, { station: 'PIENAARSPOORT STATION' }],
        'pta-pien',
    ) === null,
    'a through train to Pienaarspoort does not ask to switch',
);

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
    journeyPositionLabel(stops, projected?.progress) === 'approaching TERMINUS',
    'halfway along a hop is approaching the next station'
);
assert(journeyPositionLabel(stops, 1.2) === 'at MIDDLE', 'before midpoint stays at the last passed station');
assert(journeyPositionLabel(stops, 2) === 'at TERMINUS', 'last stop is at the terminus');

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
assert(pausedMarkers[0]?.motionClass === '', 'legacy paused pings without motionClass still compact');

resetMotionFusionForTest();
assert(wrap360(-90) === 270, 'heading wrap stays 0-360');
assert(Math.abs(mixHeading(350, 10, 1) - 10) < 0.01, 'heading mix crosses 0');
assert(classifyMotion({ accelVar: 0.1, speedMps: 0, meanAccel: 0.1 }) === 'still', 'low accel is still');
assert(classifyMotion({ accelVar: 0.2, speedMps: 8 }) === 'ride', 'cruise speed is ride');
assert(classifyMotion({ accelVar: 1.2, speedMps: 1.4 }) === 'walk', 'bouncy low speed is walk');
assert(readPingMotionClass({ motionClass: 'RIDE' }) === 'ride', 'receivers normalise motionClass');
assert(readPingMotionClass({ motionClass: 'nope' }) === '', 'junk motionClass is ignored');
assert(readPingMotionClass({}) === '', 'missing motionClass is legacy GPS');
assert(fusedSpeedFromPing({ motionClass: 'still', speedMps: 12 }) === 0, 'still pins receiver speed at 0');
assert(fusedSpeedFromPing({ motionClass: 'ride' }, 12) === 12, 'ride without speed uses fallback');
assert(!Number.isFinite(fusedSpeedFromPing({ motionClass: 'ride' }, NaN)), 'display speed does not invent a ride cruise');
assert(fusedSpeedFromPing({ speedMps: 7.2 }) === 7.2, 'legacy speed still interpolates');
assert(fusedHeadingFromPing({ heading: 450 }) === 90, 'receiver heading wraps');
const imuAnchor = { lat: -25, lng: 28, t: 1000 };
const imuFusion = { motionClass: 'ride', heading: 0, speedMps: 10 };
const imuOne = imuPredictFromGpsAnchor(imuAnchor, imuFusion, 2000);
const imuTwo = imuPredictFromGpsAnchor(imuAnchor, imuFusion, 3000);
assert(imuOne && imuTwo && imuOne.fromImu && imuTwo.t === 1000, 'IMU predict stays on the GPS clock');
assert(
    Math.abs((imuTwo.lat - imuAnchor.lat) - 2 * (imuOne.lat - imuAnchor.lat)) < 1e-8,
    'repeated IMU ticks from the same GPS rail pose do not compound'
);
assert(imuPredictFromGpsAnchor(imuAnchor, { motionClass: 'walk', heading: 0, speedMps: 1.4 }, 2000) == null, 'walk does not dead-reckon the train');
assert(imuPredictFromGpsAnchor(imuAnchor, { motionClass: 'still', heading: 90, speedMps: 0 }, 2000) == null, 'still does not dead-reckon the train');
startMotionFusion();
ingestMotionGpsFix({ lat: -25, lng: 28, heading: 90, speedMps: 10, t: 1000 }, 1000);
const fusedFix = applyMotionFusionToFix({ lat: -25, lng: 28.001, heading: null, speedMps: 10, t: 2000 }, 2000);
assert(Number.isFinite(fusedFix.heading), 'sender fusion fills an empty GPS heading');
const predicted = deadReckonFix({ lat: -25, lng: 28, t: 1000 }, { heading: 90, speedMps: 10 }, 2000);
assert(predicted && predicted.fromImu && predicted.t === 1000, 'IMU predict keeps the GPS clock');
assert(deadReckonFix({ lat: -25, lng: 28, t: 1000 }, { heading: 90, speedMps: 10 }, 1000 + 6000) == null, 'IMU predict stops after 4.8s');
resetMotionFusionForTest();
assert(peekMotionFusion().running === false, 'fusion resets in tests');

const fusedMarkers = await compactPingsForMap([{
    deviceId: 'fused-device',
    routeId: 'pta-pien',
    trainId: '1000',
    station: 'MIDDLE',
    coarseLat: -25.1,
    coarseLng: 28.1,
    projectedLat: -25,
    projectedLng: 28.01,
    projectedProgress: 1,
    acceptedAt: Date.now(),
    fixAt: Date.now(),
    at: Date.now(),
    expiresAt: Date.now() + 600000,
    heading: 88,
    speedMps: 9.4,
    motionClass: 'ride',
    trackingState: TRACKING_STATE.ACTIVE,
}], { mineDeviceId: 'fused-device', routeId: 'pta-pien' });
assert(fusedMarkers[0]?.motionClass === 'ride', 'receivers keep sender motionClass');
assert(fusedMarkers[0]?.speedMps === 9.4, 'receivers keep fused speed');
assert(fusedMarkers[0]?.heading === 88, 'receivers keep fused heading');
const stillMarkers = await compactPingsForMap([{
    deviceId: 'still-device',
    routeId: 'pta-pien',
    trainId: '1000',
    station: 'MIDDLE',
    coarseLat: -25.1,
    coarseLng: 28.1,
    projectedLat: -25,
    projectedLng: 28.01,
    projectedProgress: 1,
    acceptedAt: Date.now(),
    fixAt: Date.now(),
    at: Date.now(),
    expiresAt: Date.now() + 600000,
    heading: 88,
    speedMps: 11,
    motionClass: 'STILL',
    trackingState: TRACKING_STATE.ACTIVE,
}], { mineDeviceId: 'still-device', routeId: 'pta-pien' });
assert(stillMarkers[0]?.motionClass === 'still', 'receivers normalise sender STILL');
assert(stillMarkers[0]?.speedMps === 0, 'compact still pings pin receiver speed at 0');
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
const nowSwitch = Date.now();
const switchedMarkers = await compactPingsForMap([
    {
        deviceId: 'stale-rider',
        routeId: 'pta-pien',
        trainId: '1000',
        station: 'ORIGIN',
        coarseLat: -25.1,
        coarseLng: 28.1,
        projectedLat: -25.0,
        projectedLng: 28.0,
        projectedProgress: 0.4,
        acceptedAt: nowSwitch - 8000,
        fixAt: nowSwitch - 8000,
        at: nowSwitch - 8000,
        expiresAt: nowSwitch + 600000,
        speedMps: 12,
        railDistanceM: 8,
        trackingState: TRACKING_STATE.ACTIVE,
    },
    {
        deviceId: 'fresh-rider',
        routeId: 'pta-pien',
        trainId: '1000',
        station: 'MIDDLE',
        coarseLat: -25.2,
        coarseLng: 28.2,
        projectedLat: -25.02,
        projectedLng: 28.02,
        projectedProgress: 1.1,
        acceptedAt: nowSwitch - 1000,
        fixAt: nowSwitch - 1000,
        at: nowSwitch - 1000,
        expiresAt: nowSwitch + 600000,
        speedMps: 0,
        railDistanceM: 6,
        trackingState: TRACKING_STATE.ACTIVE,
    },
], { mineDeviceId: 'observer', routeId: 'pta-pien' });
assert(switchedMarkers.length === 1, 'one train marker when two riders share it');
assert(switchedMarkers[0]?.trackingState === TRACKING_STATE.ACTIVE, 'a fresh rider keeps the train live');
assert(
    switchedMarkers[0]?.lat === -25.02 && switchedMarkers[0]?.lng === 28.02,
    'the train switches to the reachable rider’s last GPS'
);
assert(
    pingPublicTrainId({
        trainId: '1000',
        trackingState: TRACKING_STATE.ACTIVE,
        acceptedAt: Date.now(),
        projectedLat: -25,
        projectedLng: 28,
        projectedProgress: 1,
        railDistanceM: 10,
        speedMps: 0,
    }) === '1000',
    'a stationary on-rail GPS ping still counts as an accurate train ping'
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
assert(ridePingsSource.includes("acquireGeoWatch('share')"), 'an active share keeps the geo watch');
assert(ridePingsSource.includes('payload.motionClass'), 'sender writes motionClass on the existing ride_pings node');
assert(ridePingsSource.includes('tickOnboardImu'), 'sender dead-reckons locally between GPS pings');
assert(ridePingsSource.includes('onboardGpsRailAnchor'), 'IMU ticks start from the last GPS rail pose');
assert(ridePingsSource.includes('imuPredictFromGpsAnchor'), 'sender uses the shared IMU predict helper');
assert(ridePingsSource.includes('motionClass: pos.motionClass'), 'onboard writes the fused class from that GPS fix');
assert(ridePingsSource.includes("resolvedMotion === 'still'"), 'sender still pings write speed 0');
assert(ridePingsSource.includes('readPingMotionClass(fusion)'), 'live fusion class wins over a stale GPS tag');
assert(ridePingsSource.includes('startMotionFusion'), 'an active share starts device-motion fusion');
assert(ridePingsSource.includes('motionClass: readPingMotionClass'), 'compacted map pings carry motionClass to receivers');
assert(geoWatchSource.includes('applyMotionFusionToFix'), 'GPS watch applies fusion before listeners see a fix');
assert(mapTabSource.includes('requestMotionPermission'), 'share tap requests iOS motion permission');
assert(mapTabSource.includes('fusedSpeedFromPing(subjectMarker, NaN)'), 'tracking card does not invent a ride cruise');
assert(mapTabSource.includes('readPingMotionClass(p)'), 'map fallback compact sanitises motionClass');
assert(mapAppSource.includes("motionClass === 'still'"), 'map iframe pins a still ping');
assert(mapAppSource.includes("newest.motionClass || '').trim().toLowerCase()"), 'map iframe normalises sender motionClass');
assert(mapAppSource.includes('motionClass: motionClass'), 'map iframe forwards motionClass to the tracking card');
assert(!ridePingsSource.includes("document.hidden) {\n            await queueOnboardPause('staleGps')"), 'hidden documents do not pause an active share');
assert(ridePingsSource.includes('queueOnboardPause(\'staleGps\', onboardLatestFix)'), 'share still pauses when GPS is actually stale');
assert(ridePingsSource.includes('alignBearingToJourney'), 'projected pings use rail tangent aligned to travel');
assert(geoWatchSource.includes('watchPosition'), 'geo watch uses a single watchPosition');
assert(geoWatchSource.includes('enableHighAccuracy: false'), 'seek watch is fused / low power');
assert(geoWatchSource.includes('enableHighAccuracy: true'), 'an active share uses a high-accuracy watch');
assert(geoWatchSource.includes("holders.has('share')"), 'share keeps GPS running while the document is hidden');
assert(geoWatchSource.includes('SHARE_SILENT_RESTART_MS'), 'a silent share watch is restarted');
assert(geoWatchSource.includes('wakeLock.request'), 'sharing requests a screen wake lock to keep GPS live');
assert(geoWatchSource.includes('confirmStationaryWatchTick'), 'repeated stationary GPS callbacks stay live');
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
assert(mapAppSource.includes('interpolateAlongRidePath'), 'train interpolation follows the painted rail, not a Euclidean jump');
assert(mapAppSource.includes('STATION_APPROACH_M'), 'trains slow approaching a station');
assert(mapAppSource.includes('STATION_DWELL_SEC'), 'trains dwell when GPS is at a station');
assert(mapAppSource.includes('RIDE_INTERPOLATION_MAX_MS = 12000'), 'map interpolation caps at 12 seconds');
assert(mapAppSource.includes('A successful GPS ping always cancels'), 'a new GPS ping retargets and cancels the previous glide');
assert(mapAppSource.includes('applyRideTrainStalePause'), 'receivers grey the glyph after 12s without a ping');
assert(mapTabSource.includes('if (mapOn) syncRidePingsToMap()'), 'map tab recompacts pings so a fresh rider can take over');
assert(ridePingsSource.includes('}, ONBOARD_FAST_PING_MS)'), 'onboard loop ticks at the 4 second publish cadence');
assert(ridePingsSource.includes('autoPaused'), 'a successful GPS ping after grey pause broadcasts immediately');
assert(mapAppSource.includes('rideFacingAlongPath'), 'train yaw follows the painted-rail tangent');
assert(mapAppSource.includes('snapTrainToRail'), 'train centre is snapped onto the painted rail');
assert(mapAppSource.includes('found.trackCoords'), 'train snap uses the painted GOLD line, not a station chord');
assert(mapAppSource.includes('paintLiveTrainIcon'), 'pill yaw is reapplied after setIcon');
assert(mapAppSource.includes('applyTrainGlyphYaw'), 'glyph rotates with the rail while interpolating');
assert(mapAppSource.includes('separate along-track'), 'opposing trains stay on the rail instead of offsetting sideways');
assert(mapAppSource.includes('source of truth'), 'animation stays tied to commuter GPS fixes');
assert(mapAppSource.includes("paused || motionClass === 'still', {"), 'own share still glides; only a paused or still ping snaps');
assert(!mapAppSource.includes('mine || paused'), 'own share is no longer snapped instantly');
assert(mapAppSource.includes('let marker = rideTrainMarkers[trainId]'), 'train markers are retained by train id');
assert(mapAppSource.includes('readableTrainLabelDeg'), 'train number has a dedicated readable angle');
assert(mapAppSource.includes('readable > 90') && mapAppSource.includes('readable < -90'), 'train number is bounded to -90 through 90 degrees');
assert(mapAppSource.includes('nt-live-train-nose'), 'train glyph has a forward tip on the rail axis');
assert(!mapAppSource.includes('nt-live-train-wake-ripple'), 'train glyph does not paint >>> wake chevrons');
assert(!mapPageSource.includes('nt-live-train-wake'), 'map CSS does not keep the wake chevrons');
assert(mapPageSource.includes('prefers-reduced-motion: reduce'), 'train motion respects reduced-motion preference');
assert(mapAppSource.includes("type: 'nt-map-show-tracking-details'"), 'train click opens the tracking details card');
assert(mapAppSource.includes("ping: Object.assign({}, newest"), 'train click sends the snapped rail ping, not a thin newest row');
assert(mapTabSource.includes('firstFiniteMetric'), 'tracking card fills speed/accuracy/rail from last GPS instead of Unknown');
assert(mapTabSource.includes('mine ? lastCoords?.accuracy'), 'own-share accuracy can fall back to the map pin');
assert(ridePingsSource.includes("'speedMps', 'accuracy', 'heading'"), 'paused pings keep last speed/accuracy/heading');
assert(ridePingsSource.includes('onboardLatestFix'), 'user Pause passes the last GPS sample');
assert(!mapAppSource.includes('marker.bindPopup'), 'train markers do not use the Leaflet popup tooltip');
assert(mapAppSource.includes("type: 'nt-map-close-tracking'"), 'tapping the map closes tracking details');
assert(mapAppSource.includes('Always sit on the painted corridor'), 'trains snap to the painted rail even when GPS is off the yard');
assert(mapTabSource.includes('paintSharePill'), 'share restore pill turns green while the commuter is sharing');
assert(mapTabSource.includes("restore.classList.toggle('bg-emerald-600', live)"), 'live share pill is emerald');
assert(mapTabSource.includes('viewedTrain'), 'tapping a train fills the tracking card for that train');
assert(mapTabSource.includes('setTrackingOwnerChrome'), 'viewers do not see Stop/Pause/Share on someone else’s train');
assert(mapTabSource.includes('formatLastSeenWithPingClock'), 'tracking card Last seen uses the GPS ping clock');
assert(mapTabSource.includes('formatGpsPingAge'), 'tracking card GPS cell is ping age');
assert(ridePingsSource.includes('payload.fixAt'), 'successful GPS pings store fixAt');
assert(ridePingsSource.includes('gpsFixAt'), 'onboard broadcasts pass the GPS sample time');
assert(mapViewSource.includes('id="map-tracking-card"'), 'current contributor has a bottom tracking card');
assert(mapViewSource.includes('id="map-tracking-minimize"'), 'tracking card is minimizable');
assert(mapViewSource.includes('id="map-tracking-dismiss"'), 'tracking card is dismissible');
assert(mapTabSource.includes('Currently tracking'), 'Nearby trains shows the current tracked train status');
assert(mapTabSource.includes('data-current-tracking-details'), 'Nearby current train opens tracking details');
assert(mapTabSource.includes('renderTrackingStatusCard') && mapTabSource.includes('trackingCardMode'), 'tracking metrics keep updating while the card is minimized');
assert(mapTabSource.includes("setInterval(() => {") && mapTabSource.includes('map-tracking-warning'), 'tracking dashboard refreshes its live metrics and warning');
assert(ridePingsSource.includes('subscribeGeoFix') && ridePingsSource.includes('adaptiveOnboardPingMs'), 'train sharing consumes every fix and broadcasts adaptively');
assert(ridePingsSource.includes("title: 'Has this train arrived?'"), 'last station asks if the train has arrived');
assert(ridePingsSource.includes("title: 'Have you left this train?'"), 'leaving the last station asks if sharing should stop');
assert(ridePingsSource.includes("title: 'Switch trains?'"), 'a shuttle that ends at a hub offers the connecting train');
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
assert(mapTabSource.includes('nt-share-checks-outcome'), 'live checks paint a separate Outcome strip');
assert(mapTabSource.includes("state === 'defer'"), 'deferred checks use an amber tone');
assert(mapTabSource.includes('border-green-200'), 'successful checks paint green');
assert(mapTabSource.includes('border-amber-200'), 'deferred checks paint orange');
assert(mapTabSource.includes('border-red-200'), 'blocking checks paint red');
assert(!mapTabSource.includes("addShareCheck('Decision'"), 'Decision is the outcome, not a check row');
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

{
    const now = Date.UTC(2026, 8, 14, 13, 20, 23);
    assert(gpsPingSuccessAt({ fixAt: 9, acceptedAt: 8, at: 7 }) === 9, 'fixAt is the last GPS success');
    assert(gpsPingSuccessAt({ acceptedAt: 8, at: 7 }) === 8, 'acceptedAt is used when fixAt is missing');
    const clock = formatGpsPingClock(now);
    assert(/^\d{2}:\d{2}:\d{2}$/.test(clock), `GPS clock has seconds: ${clock}`);
    assert(formatGpsPingAge(now - 5000, now) === '5 sec', 'sub-minute GPS age keeps seconds');
    assert(formatGpsPingAge(now - 65000, now) === '1m 5 sec', 'GPS age after a minute still shows seconds');
    assert(formatLastSeenWithPingClock('PRETORIA', now) === `Last seen PRETORIA - ${clock}`, 'Last seen includes the ping clock');
}

if (failures.length) {
    console.error('verify-reports-tracking failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-reports-tracking: ok');
