/**
 * Fetch regional schedule sheets and extract a compact grid preview.
 */

const REGION_NODE = {
  GP: 'schedules/gauteng.json',
  WC: 'schedules/westerncape.json',
  KZN: 'schedules/kzn.json',
  EC: 'schedules/easterncape.json',
};

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

/** westerncape/public_holidays is nested in Firebase — flatten for sheet lookups. */
function flattenPublicHolidays(db) {
  if (!db || typeof db !== 'object' || Array.isArray(db)) return db;
  const nest = db.public_holidays;
  if (!nest || typeof nest !== 'object' || Array.isArray(nest)) return db;
  const { public_holidays: _drop, ...rest } = db;
  return { ...rest, ...nest };
}

/**
 * Full-sheet preview for OG art (all trains × all stations by default).
 * @returns {{ stations: string[], trainIds: string[], cells: string[][], meta: string|null } | null}
 */
export function extractGridPreview(db, route, dir, day, maxTrains = 0, maxStations = 0) {
  if (!db || !route) return null;
  const flat = flattenPublicHolidays(db);
  const key = sheetKeyFor(route, dir, day);
  if (!key) return null;
  const rows = flat[key];
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const dataRows = rows.slice(1).filter((r) => r && r.STATION && !/^Last Updated/i.test(String(r.STATION)));
  if (!dataRows.length) return null;

  const ignore = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);
  let trainIds = Object.keys(dataRows[0]).filter((k) => !ignore.has(k));
  // Soft safety for pathological sheets (Worker CPU / SVG size).
  const trainCap = maxTrains > 0 ? maxTrains : 48;
  const stationCap = maxStations > 0 ? maxStations : 40;
  trainIds = trainIds.slice(0, trainCap);
  if (!trainIds.length) return null;

  const stations = [];
  const cells = [];
  for (const row of dataRows.slice(0, stationCap)) {
    const name = String(row.STATION || '')
      .replace(/\s+STATION$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || name.toUpperCase() === 'STATION') continue;
    stations.push(name);
    cells.push(trainIds.map((id) => compactTime(row[id])));
  }

  if (!stations.length) return null;
  const meta = flat[`${key}_meta`] != null ? String(flat[`${key}_meta`]) : null;
  return { stations, trainIds, cells, meta, sheetKey: key };
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
