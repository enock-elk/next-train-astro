/**
 * Fetch regional schedule sheets and extract a compact grid preview.
 * Column order must match the in-app full grid (orderGridTrainIds / MANUAL_GRID_ORDER).
 */

import { getGridOrderManifest, orderGridTrainIds } from '../../../src/lib/grid-order.js';

const REGION_NODE = {
  GP: 'schedules/gauteng.json',
  WC: 'schedules/westerncape.json',
  KZN: 'schedules/kzn.json',
  EC: 'schedules/easterncape.json',
};

/** Same train-id filter as renderer.js full grid. */
const TRAIN_COL_RE = /^\d{4}[a-zA-Z]*$/;

function compactTime(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2}:\d{2})(?::\d{2})?/);
  return m ? m[1] : s;
}

function sheetKeyFor(route, dir, day) {
  const keys = route?.sheetKeys;
  if (!keys) return null;
  const ab = dir === 'B' ? 'b' : 'a';
  if (day === 'public_holiday') {
    // WC dedicated *_pub sheets; other regions fall back to saturday.
    return keys[`pub_to_${ab}`] || keys[`saturday_to_${ab}`] || null;
  }
  if (day === 'saturday' || day === 'sunday') {
    return keys[`saturday_to_${ab}`] || null;
  }
  return keys[`weekday_to_${ab}`] || null;
}

const IGNORE_KEYS = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);
const REGION_NESTS = ['gauteng', 'westerncape', 'kzn', 'easterncape'];

/** westerncape/public_holidays is nested in Firebase — flatten for sheet lookups. */
function flattenPublicHolidays(db) {
  if (!db || typeof db !== 'object' || Array.isArray(db)) return db;
  const nest = db.public_holidays;
  if (!nest || typeof nest !== 'object' || Array.isArray(nest)) return db;
  const { public_holidays: _drop, ...rest } = db;
  return { ...rest, ...nest };
}

function getSheet(db, key) {
  if (!db || !key) return null;
  for (const nest of REGION_NESTS) {
    const nested = db[nest]?.[key];
    if (Array.isArray(nested) && nested.length) return nested;
    if (Array.isArray(nested?.rows) && nested.rows.length) return nested.rows;
  }
  if (Array.isArray(db[key]) && db[key].length) return db[key];
  if (Array.isArray(db[key]?.rows) && db[key].rows.length) return db[key].rows;
  return null;
}

function manifestForSheet(db, key) {
  const root = getGridOrderManifest(db, key);
  if (root) return root;
  for (const nest of REGION_NESTS) {
    const nested = getGridOrderManifest(db?.[nest], key);
    if (nested) return nested;
  }
  return null;
}

/**
 * Train columns the same way as the in-app grid: every 4-digit id present on the sheet.
 * (Do not invent an alternate earliest-time order — orderGridTrainIds owns sequence.)
 */
function collectTrainIds(dataRows) {
  const ids = new Set();
  for (const row of dataRows) {
    if (!row || typeof row !== 'object') continue;
    for (const k of Object.keys(row)) {
      if (IGNORE_KEYS.has(k)) continue;
      const id = String(k).trim();
      if (TRAIN_COL_RE.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

function rowHasClock(row, trainIds) {
  return trainIds.some((id) => {
    const t = compactTime(row?.[id]);
    return t && t !== '-';
  });
}

/**
 * Full-sheet preview for OG art — all trains × all stations by default,
 * columns in MANUAL_GRID_ORDER (same as #grid).
 * @returns {{ stations: string[], trainIds: string[], cells: string[][], meta: string|null } | null}
 */
export function extractGridPreview(db, route, dir, day, maxTrains = 0, maxStations = 0, options = {}) {
  if (!db || !route) return null;
  const flat = flattenPublicHolidays(db);
  const key = sheetKeyFor(route, dir, day);
  if (!key) return null;
  const rows = getSheet(flat, key);
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const dataRows = rows.filter((r) => r && r.STATION && !/^Last Updated/i.test(String(r.STATION)));
  if (!dataRows.length) return null;

  const orderedIds = orderGridTrainIds(key, collectTrainIds(dataRows), dataRows, {
    ...options,
    region: options.region || route.region,
    manifestOrder: options.manifestOrder || manifestForSheet(db, key),
  });
  const totalTrains = orderedIds.length;
  const clockRows = dataRows.filter((row) => rowHasClock(row, orderedIds));
  const totalStations = clockRows.length;
  // 0 = unlimited (product: dense OG cards may show every train on the sheet).
  const trainIds = maxTrains > 0 ? orderedIds.slice(0, maxTrains) : orderedIds;
  if (!trainIds.length) return null;

  const stationLimit = maxStations > 0 ? maxStations : Number.POSITIVE_INFINITY;
  const stations = [];
  const cells = [];
  for (const row of clockRows) {
    if (stations.length >= stationLimit) break;
    const name = String(row.STATION || '')
      .replace(/\s+STATION$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || name.toUpperCase() === 'STATION') continue;
    stations.push(name);
    cells.push(trainIds.map((id) => compactTime(row[id]) || '-'));
  }

  if (!stations.length) return null;
  const meta = (() => {
    for (const nest of REGION_NESTS) {
      if (flat[nest]?.[`${key}_meta`] != null) return String(flat[nest][`${key}_meta`]);
    }
    return flat[`${key}_meta`] != null ? String(flat[`${key}_meta`]) : null;
  })();
  return {
    stations,
    trainIds,
    cells,
    meta,
    sheetKey: key,
    totalTrains,
    totalStations,
    truncatedTrains: totalTrains > trainIds.length,
    truncatedStations: totalStations > stations.length,
  };
}

export async function loadRegionDb(env, region, ctx) {
  const code = REGION_NODE[region] ? region : 'GP';
  const base = String(env.SCHEDULE_BASE || 'https://metrorail-next-train-default-rtdb.firebaseio.com/').replace(
    /\/?$/,
    '/'
  );
  const url = `${base}${REGION_NODE[code]}`;
  const cache = caches.default;
  const cacheKey = new Request(`https://nexttrain-og-cache.local/sched/${code}`);
  const hit = await cache.match(cacheKey);
  if (hit) {
    try {
      return await hit.json();
    } catch {
      /* refetch */
    }
  }

  const res = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`Schedule fetch ${res.status}`);
  const data = await res.json();
  const body = JSON.stringify(data);
  const toCache = new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=300' },
  });
  if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, toCache.clone()));
  else await cache.put(cacheKey, toCache.clone());
  return data;
}

/** Public RTDB order snapshot; null keeps the shared resolver on its fallback. */
export async function loadRegionGridOrder(env, region, ctx) {
  const code = REGION_NODE[region] ? region : 'GP';
  const base = String(env.SCHEDULE_BASE || 'https://metrorail-next-train-default-rtdb.firebaseio.com/').replace(
    /\/?$/,
    '/'
  );
  const cache = caches.default;
  const cacheKey = new Request(`https://nexttrain-og-cache.local/grid-order/${code}`);
  const hit = await cache.match(cacheKey);
  if (hit) {
    try {
      return await hit.json();
    } catch {
      /* refetch */
    }
  }
  try {
    const res = await fetch(`${base}config/grid_order/${encodeURIComponent(code)}.json`, {
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const toCache = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=300' },
    });
    if (ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, toCache.clone()));
    else await cache.put(cacheKey, toCache.clone());
    return data;
  } catch {
    return null;
  }
}
