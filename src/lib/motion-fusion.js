/**
 * Device-motion complement for live train tracking.
 *
 * GPS remains the source of truth for place. Accelerometer, gyro, and
 * compass (DeviceMotion / DeviceOrientation) fill heading when GPS has
 * none, tell still / walk / ride apart, and dead-reckon only for the
 * short gap between 4 s pings. Predicted points are snapped back onto
 * the painted rail by the caller. Do not invent a Firebase tree; extra
 * fields sit on the existing ride_pings node.
 *
 * iOS requires HTTPS plus a user gesture for
 * DeviceMotionEvent.requestPermission / DeviceOrientationEvent.requestPermission.
 */

export const IMU_DEAD_RECKON_MAX_SEC = 4.8;
export const IMU_LOCAL_TICK_MS = 250;
export const MOTION_CLASSES = ['unknown', 'still', 'walk', 'ride'];

const COMPASS_ALPHA = 0.12;
const GPS_HEADING_ALPHA = 0.35;
const GYRO_HOLD_ALPHA = 1;
const ACCEL_WINDOW = 40;
const GPS_HEADING_FRESH_MS = 3000;

let running = false;
let permission = 'unknown';
let heading = NaN;
let gyroHeading = NaN;
let compassHeading = NaN;
let gpsHeading = NaN;
let speedMps = NaN;
let motionClass = 'unknown';
let accelVar = 0;
let meanAccel = 0;
let lastMotionAt = 0;
let lastOrientAt = 0;
let lastGpsAt = 0;
let lastGyroAt = 0;
let orientBeta = 0;
let motionHandler = null;
let orientHandler = null;
let absoluteHandler = null;

const accelMags = [];

export function wrap360(deg) {
    const n = Number(deg);
    if (!Number.isFinite(n)) return NaN;
    return ((n % 360) + 360) % 360;
}

export function wrapDeltaDeg(from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return NaN;
    let d = wrap360(to) - wrap360(from);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

export function mixHeading(current, sample, alpha) {
    if (!Number.isFinite(sample)) return current;
    if (!Number.isFinite(current)) return wrap360(sample);
    const a = Math.max(0, Math.min(1, Number(alpha) || 0));
    return wrap360(current + wrapDeltaDeg(current, sample) * a);
}

export function classifyMotion({ accelVar: variance = 0, speedMps: speed = NaN, meanAccel: mean = 0 } = {}) {
    const v = Number(variance);
    const s = Number(speed);
    const m = Number(mean);
    const hasSpeed = Number.isFinite(s);
    if (hasSpeed && s >= 3.5) return 'ride';
    if (hasSpeed && s >= 1.5 && v < 0.55) return 'ride';
    if (v >= 0.85 && (!hasSpeed || s < 2.8)) return 'walk';
    if ((!hasSpeed || s < 0.6) && v < 0.22 && m < 0.45) return 'still';
    if (hasSpeed && s >= 1.5) return 'ride';
    if (v >= 0.45) return 'walk';
    return 'still';
}

function userAccelFromEvent(ev) {
    const a = ev && ev.acceleration;
    if (a && (Number.isFinite(a.x) || Number.isFinite(a.y) || Number.isFinite(a.z))) {
        return [Number(a.x) || 0, Number(a.y) || 0, Number(a.z) || 0];
    }
    const g = ev && ev.accelerationIncludingGravity;
    if (!g) return null;
    const gx = Number(g.x) || 0;
    const gy = Number(g.y) || 0;
    const gz = Number(g.z) || 0;
    const mag = Math.hypot(gx, gy, gz) || 9.81;
    const scale = 9.81 / mag;
    return [gx - gx * scale, gy - gy * scale, gz - gz * scale];
}

function pushAccelMag(mag) {
    if (!Number.isFinite(mag)) return;
    accelMags.push(mag);
    if (accelMags.length > ACCEL_WINDOW) accelMags.shift();
    const n = accelMags.length;
    if (!n) {
        accelVar = 0;
        meanAccel = 0;
        return;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) sum += accelMags[i];
    meanAccel = sum / n;
    let q = 0;
    for (let i = 0; i < n; i++) {
        const d = accelMags[i] - meanAccel;
        q += d * d;
    }
    accelVar = q / n;
    motionClass = classifyMotion({ accelVar, speedMps, meanAccel });
}

function pickYawRate(beta, rate) {
    if (!rate) return 0;
    const tilt = Number(beta);
    if (Number.isFinite(tilt) && Math.abs(tilt) > 50) {
        return Number(rate.gamma) || 0;
    }
    return Number(rate.alpha) || 0;
}

function compassFromOrientation(ev) {
    if (!ev) return NaN;
    const webkit = Number(ev.webkitCompassHeading);
    if (Number.isFinite(webkit)) return wrap360(webkit);
    const alpha = Number(ev.alpha);
    if (!Number.isFinite(alpha)) return NaN;
    if (ev.absolute === false) return NaN;
    return wrap360(360 - alpha);
}

function onDeviceMotion(ev) {
    const now = Date.now();
    const acc = userAccelFromEvent(ev);
    if (acc) pushAccelMag(Math.hypot(acc[0], acc[1], acc[2]));
    const rate = ev && ev.rotationRate;
    if (rate && lastGyroAt) {
        const dt = Math.max(0.008, Math.min(0.08, (now - lastGyroAt) / 1000));
        const yaw = pickYawRate(orientBeta, rate);
        if (Number.isFinite(yaw)) {
            if (!Number.isFinite(gyroHeading)) gyroHeading = Number.isFinite(heading) ? heading : 0;
            gyroHeading = wrap360(gyroHeading + yaw * dt * GYRO_HOLD_ALPHA);
            heading = mixHeading(heading, gyroHeading, 0.92);
        }
    }
    lastGyroAt = now;
    lastMotionAt = now;
}

function onDeviceOrientation(ev) {
    const sample = compassFromOrientation(ev);
    const beta = Number(ev && ev.beta);
    if (Number.isFinite(beta)) orientBeta = beta;
    if (Number.isFinite(sample)) {
        compassHeading = sample;
        heading = mixHeading(heading, sample, COMPASS_ALPHA);
        if (!Number.isFinite(gyroHeading)) gyroHeading = sample;
        else gyroHeading = mixHeading(gyroHeading, sample, 0.04);
    }
    lastOrientAt = Date.now();
}

export function ingestMotionGpsFix(fix, now = Date.now()) {
    if (!fix) return peekMotionFusion();
    if (Number.isFinite(fix.speedMps) && fix.speedMps >= 0) {
        speedMps = Number(fix.speedMps);
    }
    if (Number.isFinite(fix.heading) && (!fix.stationary || Number(fix.speedMps) >= 1.5)) {
        gpsHeading = wrap360(fix.heading);
        lastGpsAt = now;
        const gpsFresh = true;
        if (gpsFresh && Number(fix.speedMps) >= 1.5) {
            heading = mixHeading(heading, gpsHeading, GPS_HEADING_ALPHA);
            gyroHeading = mixHeading(gyroHeading, gpsHeading, 0.25);
        }
    } else if (Number.isFinite(fix.t)) {
        lastGpsAt = Number(fix.t) || now;
    }
    motionClass = classifyMotion({ accelVar, speedMps, meanAccel });
    return peekMotionFusion();
}

/** Receiver-safe class. Missing or junk values from older pings are empty. */
export function readPingMotionClass(ping) {
    const c = String(ping && ping.motionClass || '').trim().toLowerCase();
    return c === 'still' || c === 'walk' || c === 'ride' ? c : '';
}

/** Speed listeners should interpolate with. Still pins the hull; ride can fill a gap. */
export function fusedSpeedFromPing(ping, rideFallbackMps = 12) {
    const cls = readPingMotionClass(ping);
    const speed = Number(ping && ping.speedMps);
    if (cls === 'still') return 0;
    if (Number.isFinite(speed) && speed >= 0) return speed;
    if (cls === 'ride' && Number.isFinite(rideFallbackMps)) return rideFallbackMps;
    return Number.isFinite(speed) ? speed : NaN;
}

export function fusedHeadingFromPing(ping) {
    const h = Number(ping && ping.heading);
    return Number.isFinite(h) ? wrap360(h) : NaN;
}

/**
 * Predict from the last GPS rail pose only. Never feed a previous IMU point
 * back in with the original GPS clock — that compounds displacement.
 * Walk / still / unknown stay put; only ride dead-reckons.
 */
export function imuPredictFromGpsAnchor(anchor, fusion, now = Date.now()) {
    if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) return null;
    if (!Number.isFinite(anchor.t)) return null;
    if (readPingMotionClass(fusion) !== 'ride') return null;
    const heading = Number(fusion && fusion.heading);
    const speedMps = Number(fusion && fusion.speedMps);
    if (!Number.isFinite(heading) || !(speedMps >= 1)) return null;
    return deadReckonFix(
        { lat: anchor.lat, lng: anchor.lng, t: anchor.t },
        { heading, speedMps },
        now
    );
}

export function applyMotionFusionToFix(fix, now = Date.now()) {
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return fix;
    if (!running) return { ...fix };
    ingestMotionGpsFix(fix, now);
    const fused = peekMotionFusion();
    if (!fused.running && !Number.isFinite(fused.heading) && fused.motionClass === 'unknown') {
        return { ...fix, motionClass: fused.motionClass };
    }
    let nextHeading = Number.isFinite(fix.heading) ? fix.heading : fused.heading;
    if (!Number.isFinite(fix.heading) && Number.isFinite(fused.heading)) nextHeading = fused.heading;
    let nextSpeed = fix.speedMps;
    if (fix.stationary) {
        nextSpeed = 0;
    } else if (!(Number.isFinite(fix.speedMps) && fix.speedMps >= 1.5)
        && fused.motionClass === 'ride'
        && Number.isFinite(fused.speedMps)
        && fused.speedMps >= 1.5) {
        nextSpeed = fused.speedMps;
    } else if (fused.motionClass === 'still' && !(Number.isFinite(fix.speedMps) && fix.speedMps >= 1.5)) {
        nextSpeed = 0;
    }
    return {
        ...fix,
        heading: Number.isFinite(nextHeading) ? nextHeading : fix.heading,
        speedMps: nextSpeed,
        motionClass: fused.motionClass,
    };
}

export function deadReckonFix(from, motion, now = Date.now()) {
    if (!from || !Number.isFinite(from.lat) || !Number.isFinite(from.lng)) return null;
    const t0 = Number(from.t || from.fixAt || 0);
    if (!t0) return null;
    const dt = (now - t0) / 1000;
    if (dt <= 0.15 || dt > IMU_DEAD_RECKON_MAX_SEC) return null;
    const h = Number(motion && motion.heading);
    const s = Number(motion && motion.speedMps);
    if (!Number.isFinite(h) || !(s >= 1)) return null;
    const rad = (h * Math.PI) / 180;
    const metres = s * dt;
    const dLat = (metres * Math.cos(rad)) / 111320;
    const dLng = (metres * Math.sin(rad)) / (111320 * Math.max(0.2, Math.cos((from.lat * Math.PI) / 180)));
    return {
        lat: from.lat + dLat,
        lng: from.lng + dLng,
        heading: wrap360(h),
        speedMps: s,
        t: t0,
        predictedAt: now,
        fromImu: true,
    };
}

export function peekMotionFusion() {
    const now = Date.now();
    return {
        running,
        permission,
        heading: Number.isFinite(heading) ? heading : NaN,
        compassHeading: Number.isFinite(compassHeading) ? compassHeading : NaN,
        gpsHeading: Number.isFinite(gpsHeading) ? gpsHeading : NaN,
        speedMps: Number.isFinite(speedMps) ? speedMps : NaN,
        motionClass,
        accelVar,
        meanAccel,
        ageMs: lastMotionAt || lastOrientAt ? now - Math.max(lastMotionAt, lastOrientAt) : Infinity,
        gpsAgeMs: lastGpsAt ? now - lastGpsAt : Infinity,
        gpsHeadingFresh: lastGpsAt ? now - lastGpsAt <= GPS_HEADING_FRESH_MS : false,
        sensorsLive: !!(lastMotionAt && now - lastMotionAt < 2000) || !!(lastOrientAt && now - lastOrientAt < 2000),
    };
}

function bindWindowListeners() {
    if (typeof window === 'undefined') return;
    if (!motionHandler) {
        motionHandler = onDeviceMotion;
        window.addEventListener('devicemotion', motionHandler, { passive: true });
    }
    if (!orientHandler) {
        orientHandler = onDeviceOrientation;
        window.addEventListener('deviceorientation', orientHandler, { passive: true });
    }
    if (!absoluteHandler && 'ondeviceorientationabsolute' in window) {
        absoluteHandler = onDeviceOrientation;
        window.addEventListener('deviceorientationabsolute', absoluteHandler, { passive: true });
    }
}

function unbindWindowListeners() {
    if (typeof window === 'undefined') return;
    if (motionHandler) window.removeEventListener('devicemotion', motionHandler);
    if (orientHandler) window.removeEventListener('deviceorientation', orientHandler);
    if (absoluteHandler) window.removeEventListener('deviceorientationabsolute', absoluteHandler);
    motionHandler = null;
    orientHandler = null;
    absoluteHandler = null;
}

export function startMotionFusion() {
    if (running) return peekMotionFusion();
    running = true;
    bindWindowListeners();
    return peekMotionFusion();
}

export function stopMotionFusion() {
    running = false;
    unbindWindowListeners();
    return peekMotionFusion();
}

/**
 * Call from a tap. Invokes iOS requestPermission synchronously, then starts
 * the listeners. Safe to call more than once.
 */
export function requestMotionPermission() {
    const tasks = [];
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try { tasks.push(DeviceMotionEvent.requestPermission().catch(() => 'denied')); } catch { /* ignore */ }
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { tasks.push(DeviceOrientationEvent.requestPermission().catch(() => 'denied')); } catch { /* ignore */ }
    }
    startMotionFusion();
    if (!tasks.length) {
        permission = typeof window === 'undefined' ? 'unsupported' : 'granted';
        return Promise.resolve(peekMotionFusion());
    }
    return Promise.all(tasks).then((results) => {
        permission = results.every((r) => r === 'granted') ? 'granted' : 'denied';
        if (permission === 'granted') startMotionFusion();
        return peekMotionFusion();
    }).catch(() => {
        permission = 'denied';
        return peekMotionFusion();
    });
}

/** Test-only: restore idle state. */
export function resetMotionFusionForTest() {
    stopMotionFusion();
    permission = 'unknown';
    heading = NaN;
    gyroHeading = NaN;
    compassHeading = NaN;
    gpsHeading = NaN;
    speedMps = NaN;
    motionClass = 'unknown';
    accelVar = 0;
    meanAccel = 0;
    lastMotionAt = 0;
    lastOrientAt = 0;
    lastGpsAt = 0;
    lastGyroAt = 0;
    orientBeta = 0;
    accelMags.length = 0;
}
