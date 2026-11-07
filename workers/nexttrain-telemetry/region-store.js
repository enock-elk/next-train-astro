/**
 * D1 store for the daily selected-region assignment.
 * Primary key (day, device_hash) makes a repeat or a region change an update.
 */
import {
    hashDeviceId,
    johannesburgDay,
    parsePresenceBody,
    presenceCorsHeaders,
    presenceOriginAllowed,
    retentionFloorDay,
    tallyRegionCounts,
} from './region-presence.js';

const UPSERT_SQL = `INSERT INTO daily_region (day, device_hash, region, first_seen, last_seen)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(day, device_hash) DO UPDATE SET
  region = excluded.region,
  last_seen = excluded.last_seen`;

const PRUNE_SQL = `DELETE FROM daily_region WHERE day < ?`;
const COUNT_SQL = `SELECT region, COUNT(*) AS n FROM daily_region WHERE day = ? GROUP BY region`;

export async function upsertDailyRegion(db, { day, deviceHash, region, now, retentionFloor }) {
    await db.batch([
        db.prepare(UPSERT_SQL).bind(day, deviceHash, region, now, now),
        db.prepare(PRUNE_SQL).bind(retentionFloor),
    ]);
}

export async function countDailyRegions(db, day) {
    const query = await db.prepare(COUNT_SQL).bind(day).all();
    return tallyRegionCounts(query?.results || []);
}

export async function readRegionalSplit(db, nowMs = Date.now()) {
    const day = johannesburgDay(nowMs);
    if (!db) {
        return {
            GP: 0, WC: 0, KZN: 0, EC: 0,
            reportingDevices: 0,
            day,
            status: 'unconfigured',
            detail: 'REGION_PRESENCE_DB is not bound',
            exact: false,
        };
    }
    const counts = await countDailyRegions(db, day);
    return {
        GP: counts.GP,
        WC: counts.WC,
        KZN: counts.KZN,
        EC: counts.EC,
        reportingDevices: counts.total,
        day,
        status: 'ok',
        detail: null,
        exact: true,
    };
}

export async function recordRegionPresence(db, { deviceHash, region, now = Date.now() }) {
    const day = johannesburgDay(now);
    await upsertDailyRegion(db, {
        day,
        deviceHash,
        region,
        now,
        retentionFloor: retentionFloorDay(now),
    });
    return { day, region };
}

export async function handleRegionPresence(request, env, now = Date.now()) {
    const origin = request.headers.get('Origin') || '';
    const headers = { ...presenceCorsHeaders(origin), 'Content-Type': 'application/json' };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: presenceOriginAllowed(origin) ? 204 : 403,
            headers: presenceCorsHeaders(origin),
        });
    }
    if (request.method !== 'POST') return json(405, { error: 'Method Not Allowed' });
    if (!presenceOriginAllowed(origin)) return json(403, { error: 'Origin not allowed' });
    const raw = await request.text();
    if (raw.length > 1024) return json(413, { error: 'Body too large' });
    const parsed = parsePresenceBody(raw);
    if (!parsed.ok) return json(parsed.status || 400, { error: parsed.error });
    if (!env?.REGION_PRESENCE_DB || !env?.REGION_PRESENCE_PEPPER) {
        return json(503, { error: 'Region presence is not configured' });
    }
    const deviceHash = await hashDeviceId(parsed.deviceId, env.REGION_PRESENCE_PEPPER);
    const saved = await recordRegionPresence(env.REGION_PRESENCE_DB, {
        deviceHash,
        region: parsed.region,
        now,
    });
    return json(200, { ok: true, day: saved.day, region: saved.region });
}
