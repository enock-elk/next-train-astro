/**
 * Shared client-side rate limits for RTDB / Auth writes.
 * Does not replace Firebase rules — keeps normal use snappy while slowing abuse.
 */
import { checkRateLimit, recordRateHit, rateLimitMessage } from './trust.js';

/** Named buckets used across the app. Keep windows generous for real commuting. */
export const RTDB_RATE = Object.freeze({
  telemetry: { key: 'rtdbTelemetryRateV1', windowMs: 10 * 60 * 1000, max: 40, cooldownMs: 1500 },
  ridePing: { key: 'rtdbRidePingRateV1', windowMs: 5 * 60 * 1000, max: 60, cooldownMs: 800 },
  push: { key: 'rtdbPushSubRateV1', windowMs: 30 * 60 * 1000, max: 12, cooldownMs: 5000 },
  accountOps: { key: 'rtdbAccountOpsRateV1', windowMs: 10 * 60 * 1000, max: 30, cooldownMs: 2000 },
  stationReview: { key: 'rtdbStationReviewRateV1', windowMs: 60 * 60 * 1000, max: 3, cooldownMs: 30 * 1000 },
  signIn: { key: 'authSignInRateV1', windowMs: 15 * 60 * 1000, max: 12, cooldownMs: 2500 },
  signUp: { key: 'authSignUpRateV1', windowMs: 60 * 60 * 1000, max: 6, cooldownMs: 5000 },
});

/**
 * @param {keyof typeof RTDB_RATE | { key: string, windowMs: number, max: number, cooldownMs?: number }} bucket
 */
export function allowRtdbWrite(bucket) {
  const cfg = typeof bucket === 'string' ? RTDB_RATE[bucket] : bucket;
  if (!cfg?.key) return { ok: true, remaining: 99 };
  return checkRateLimit(cfg.key, {
    windowMs: cfg.windowMs,
    max: cfg.max,
    cooldownMs: cfg.cooldownMs || 0,
  });
}

/**
 * @param {keyof typeof RTDB_RATE | { key: string, windowMs: number, max: number, cooldownMs?: number }} bucket
 */
export function recordRtdbWrite(bucket) {
  const cfg = typeof bucket === 'string' ? RTDB_RATE[bucket] : bucket;
  if (!cfg?.key) return;
  recordRateHit(cfg.key, { windowMs: cfg.windowMs });
}

/**
 * Guard a write: returns null when allowed, or a user-facing message when blocked.
 * @param {keyof typeof RTDB_RATE | { key: string, windowMs: number, max: number, cooldownMs?: number }} bucket
 */
export function rtdbWriteGuard(bucket) {
  const limit = allowRtdbWrite(bucket);
  if (limit.ok) {
    recordRtdbWrite(bucket);
    return null;
  }
  return limit.message || rateLimitMessage(limit.reason || 'cooldown', limit.retryAfterMs || 3000);
}
