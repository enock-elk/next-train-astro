/**
 * Build-time station catalog for SEO landings.
 * Timed stops on active ROUTES sheets only (no out-of-network stubs).
 * Neighbours and departures come from sheet row order — same idea as the
 * upcoming-trains modal, but static full-day lists for crawlers.
 */
import { ROUTES, getCorridorLabel } from './config.js';
import { timeToSeconds } from './utils.js';
import {
  displayRouteName,
  gridStationLabel,
  listSeoRegions,
  listSeoRoutes,
  regionName,
  slugifyStation,
  stationLabel,
} from './seo-routes.js';
import {
  formatClock,
  getSheet,
  loadScheduleDump,
} from './seo-timetable.js';
import { isStationIndexable } from './seo-station-allowlist.js';

const IGNORE_KEYS = new Set(['STATION', 'COORDINATES', 'KM_MARK', 'row_index']);

function isMetaStation(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (/^Last Updated/i.test(s)) return true;
  if (s.toUpperCase() === 'STATION') return true;
  return false;
}

function normalizeKey(name) {
  return String(name || '')
    .replace(/\s+STATION$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function trainIdsFromRow(row) {
  if (!row || typeof row !== 'object') return [];
  return Object.keys(row).filter((k) => !IGNORE_KEYS.has(k));
}

function rowHasClock(row) {
  return trainIdsFromRow(row).some((id) => !!formatClock(row?.[id]));
}

function dataRowsFromSheet(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.filter((r) => r && r.STATION && !isMetaStation(r.STATION));
}

function timedRowsFromSheet(rows) {
  return dataRowsFromSheet(rows).filter(rowHasClock);
}

function stationNameFromRow(row) {
  return gridStationLabel(String(row?.STATION || '').replace(/\s+/g, ' ').trim());
}

function parseCoords(row) {
  const raw = String(row?.COORDINATES || '').trim();
  if (!raw) return null;
  const parts = raw.split(/[,/\s]+/).map((p) => Number(p)).filter((n) => Number.isFinite(n));
  if (parts.length < 2) return null;
  return { lat: parts[0], lon: parts[1] };
}

function activeRoutes(regionFilter) {
  return Object.values(ROUTES).filter((r) => {
    if (!r || !r.isActive || r.id === 'special_event' || !r.destA || !r.destB) return false;
    if (regionFilter?.length && !regionFilter.includes(r.region)) return false;
    return true;
  });
}

function routeSeedSlug(routeId) {
  const hit = listSeoRoutes().find((e) => e.route.id === routeId);
  return hit?.seed?.slug || '';
}

/**
 * Ordered timed stop names on a sheet (boarding order).
 * @returns {{ name: string, row: object }[]}
 */
function orderedTimedStops(db, sheetKey) {
  const rows = timedRowsFromSheet(getSheet(db, sheetKey) || []);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const name = stationNameFromRow(row);
    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, row });
  }
  return out;
}

/**
 * Departures from `stationName` on one sheet, toward the sheet terminus.
 * Badge: Direct when the train's last timed stop matches the sheet end;
 * otherwise To {short working}.
 */
export function departuresOnSheet(db, sheetKey, stationName, boardDestLabel) {
  const stops = orderedTimedStops(db, sheetKey);
  if (!stops.length) return [];
  const want = normalizeKey(stationName);
  const fromIdx = stops.findIndex((s) => normalizeKey(s.name) === want);
  if (fromIdx < 0) return [];

  const sheetEnd = stops[stops.length - 1]?.name || boardDestLabel;
  const boardDestKey = normalizeKey(boardDestLabel || sheetEnd);
  const trains = new Map();

  for (let i = fromIdx; i < stops.length; i++) {
    const { name, row } = stops[i];
    for (const trainId of trainIdsFromRow(row)) {
      const clock = formatClock(row[trainId]);
      if (!clock) continue;
      if (i === fromIdx) {
        trains.set(trainId, {
          trainId,
          departureTime: clock,
          departureSec: timeToSeconds(String(row[trainId]).trim()),
          actualDestination: null,
          continued: false,
        });
      } else if (trains.has(trainId)) {
        const dep = trains.get(trainId);
        dep.actualDestination = name;
        dep.continued = true;
      }
    }
  }

  const out = [];
  for (const dep of trains.values()) {
    // Terminus rows on this sheet are arrivals, not departures.
    if (!dep.continued || !dep.actualDestination) continue;
    const actualKey = normalizeKey(dep.actualDestination);
    const isDirect = actualKey === boardDestKey || actualKey === normalizeKey(sheetEnd);
    /** @type {'direct' | 'short'} */
    const badge = isDirect ? 'direct' : 'short';
    out.push({
      trainId: dep.trainId,
      departureTime: dep.departureTime,
      departureSec: dep.departureSec,
      actualDestination: dep.actualDestination,
      badge,
      badgeLabel: isDirect ? 'Direct' : `To ${dep.actualDestination}`,
    });
  }

  out.sort((a, b) => a.departureSec - b.departureSec || String(a.trainId).localeCompare(String(b.trainId)));
  return out;
}

function neighboursOnSheet(db, sheetKey, stationName) {
  const stops = orderedTimedStops(db, sheetKey).map((s) => s.name);
  const idx = stops.findIndex((n) => normalizeKey(n) === normalizeKey(stationName));
  if (idx < 0) return { towardA: null, towardB: null, order: stops };
  return {
    towardA: idx > 0 ? stops[idx - 1] : null,
    towardB: idx < stops.length - 1 ? stops[idx + 1] : null,
    order: stops,
  };
}

let _catalogCache = null;

/**
 * Full timed-station catalog for the given regions (default: all).
 * Ghost / no-time rows are omitted from public pages.
 */
export function listSeoStationCatalog(options = {}) {
  const regions = options.regions || null;
  const cacheKey = regions ? regions.slice().sort().join(',') : '*';
  if (_catalogCache?.key === cacheKey) return _catalogCache.list;

  const db = loadScheduleDump();
  /** @type {Map<string, object>} */
  const bySlug = new Map();

  for (const route of activeRoutes(regions)) {
    const origin = stationLabel(route.destA);
    const dest = stationLabel(route.destB);
    const keys = route.sheetKeys || {};
    const sheetKeys = [...new Set([
      keys.weekday_to_a,
      keys.weekday_to_b,
      keys.saturday_to_a,
      keys.saturday_to_b,
    ].filter(Boolean))];

    for (const sheetKey of sheetKeys) {
      for (const { name, row } of orderedTimedStops(db, sheetKey)) {
        const slug = slugifyStation(name);
        if (!slug) continue;
        let entry = bySlug.get(slug);
        if (!entry) {
          entry = {
            slug,
            name,
            status: 'active',
            region: route.region,
            regions: new Set([route.region]),
            routeIds: new Set(),
            coords: parseCoords(row),
          };
          bySlug.set(slug, entry);
        }
        entry.routeIds.add(route.id);
        entry.regions.add(route.region);
        if (!entry.coords) entry.coords = parseCoords(row);
        // Prefer GP label region when a stop somehow spans (should not happen).
        if (route.region === 'GP') entry.region = 'GP';
      }
    }

    // Neighbours: prefer weekday_to_b (destA → destB) geographic order.
    const orderKey = keys.weekday_to_b || keys.weekday_to_a || keys.saturday_to_b || keys.saturday_to_a;
    if (!orderKey) continue;
    const stops = orderedTimedStops(db, orderKey).map((s) => s.name);
    for (let i = 0; i < stops.length; i++) {
      const slug = slugifyStation(stops[i]);
      const entry = bySlug.get(slug);
      if (!entry) continue;
      if (!entry.corridorNeighbours) entry.corridorNeighbours = [];
      const towardA = i > 0 ? stops[i - 1] : null;
      const towardB = i < stops.length - 1 ? stops[i + 1] : null;
      const existing = entry.corridorNeighbours.find((c) => c.routeId === route.id);
      const payload = {
        routeId: route.id,
        routeSlug: routeSeedSlug(route.id),
        routeName: displayRouteName(route),
        lineLabel: getCorridorLabel(route) || displayRouteName(route),
        origin,
        dest,
        towardOrigin: towardA,
        towardDest: towardB,
        towardOriginSlug: towardA ? slugifyStation(towardA) : null,
        towardDestSlug: towardB ? slugifyStation(towardB) : null,
      };
      if (existing) Object.assign(existing, payload);
      else entry.corridorNeighbours.push(payload);
    }
  }

  const list = [...bySlug.values()]
    .map((e) => ({
      ...e,
      regions: [...e.regions],
      routeIds: [...e.routeIds].sort(),
      corridorNeighbours: e.corridorNeighbours || [],
      indexable: isStationIndexable(e.slug),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  _catalogCache = { key: cacheKey, list };
  return list;
}

/**
 * Timed-station catalog for the given regions.
 * Defaults to all four Metrorail regions (GP, WC, KZN, EC).
 * Prefer listIndexableSeoStations() for SSG / sitemap (allowlist-gated).
 */
export function listSeoStations(options = {}) {
  const regions = options.regions || ['GP', 'WC', 'KZN', 'EC'];
  return listSeoStationCatalog({ regions });
}

/**
 * Phase-aware public station pages: allowlisted slugs only.
 * Phase 1 = all GP + WC/KZN/EC termini/hubs (see seo-station-allowlist.js).
 */
export function listIndexableSeoStations(options = {}) {
  return listSeoStations(options).filter((s) => isStationIndexable(s.slug));
}

export function getSeoStationBySlug(slug, options = {}) {
  const want = String(slug || '').trim();
  if (!want) return null;
  return listSeoStations(options).find((s) => s.slug === want) || null;
}

/** True when a /stations/{slug}.html page is SSG'd and linkable. */
export function stationHasPublicPage(slug) {
  return isStationIndexable(slug) && !!getSeoStationBySlug(slug);
}

/**
 * Hub-aware corridor cards with weekday (and Saturday) direction lists.
 */
export function buildStationCorridorTimetables(station) {
  if (!station) return [];
  const db = loadScheduleDump();
  const cards = [];

  for (const routeId of station.routeIds) {
    const route = ROUTES[routeId];
    if (!route?.isActive) continue;
    const keys = route.sheetKeys || {};
    const origin = stationLabel(route.destA);
    const dest = stationLabel(route.destB);
    const name = station.name;

    const weekdayTowardA = keys.weekday_to_a
      ? departuresOnSheet(db, keys.weekday_to_a, name, origin)
      : [];
    const weekdayTowardB = keys.weekday_to_b
      ? departuresOnSheet(db, keys.weekday_to_b, name, dest)
      : [];
    const saturdayTowardA = keys.saturday_to_a
      ? departuresOnSheet(db, keys.saturday_to_a, name, origin)
      : [];
    const saturdayTowardB = keys.saturday_to_b
      ? departuresOnSheet(db, keys.saturday_to_b, name, dest)
      : [];

    if (!weekdayTowardA.length && !weekdayTowardB.length
      && !saturdayTowardA.length && !saturdayTowardB.length) {
      continue;
    }

    const neigh = station.corridorNeighbours.find((c) => c.routeId === routeId);
    const orderKey = keys.weekday_to_b || keys.weekday_to_a || keys.saturday_to_b || keys.saturday_to_a;
    const stopOrder = orderKey
      ? orderedTimedStops(db, orderKey).map((s) => s.name)
      : [];

    cards.push({
      routeId,
      routeSlug: routeSeedSlug(routeId),
      routeName: displayRouteName(route),
      lineLabel: getCorridorLabel(route) || displayRouteName(route),
      origin,
      dest,
      stopOrder,
      neighbors: {
        towardOrigin: neigh?.towardOrigin || null,
        towardDest: neigh?.towardDest || null,
        towardOriginSlug: neigh?.towardOriginSlug || null,
        towardDestSlug: neigh?.towardDestSlug || null,
      },
      weekday: {
        towardA: {
          title: `${name} → ${origin}`,
          toward: origin,
          trains: weekdayTowardA,
        },
        towardB: {
          title: `${name} → ${dest}`,
          toward: dest,
          trains: weekdayTowardB,
        },
      },
      saturday: {
        towardA: {
          title: `${name} → ${origin}`,
          toward: origin,
          trains: saturdayTowardA,
        },
        towardB: {
          title: `${name} → ${dest}`,
          toward: dest,
          trains: saturdayTowardB,
        },
      },
      hasSaturday: !!(saturdayTowardA.length || saturdayTowardB.length),
    });
  }

  cards.sort((a, b) => a.routeName.localeCompare(b.routeName));
  return cards;
}

export function buildStationBoardAppPath(station) {
  const routeId = station?.routeIds?.[0] || '';
  const route = ROUTES[routeId];
  const params = new URLSearchParams();
  if (routeId) params.set('rt', routeId);
  if (route?.region) params.set('r', route.region);
  params.set('src', 'seo');
  return `/?${params.toString()}`;
}

/**
 * Far corridor ends grouped by shared next stop.
 * Slash only when the immediate next station is the same
 * (Pretoria → Sportpark → Irene / Kempton Park).
 * Different nexts stay separate with a middle dot.
 */
export function groupStationFarEndsByNext(station, corridors) {
  const place = station?.name || '';
  const placeKey = normalizeKey(place);
  /** @type {Map<string, { ends: Map<string, string> }>} */
  const groups = new Map();

  const add = (nextLabel, farEnd) => {
    if (!farEnd || normalizeKey(farEnd) === placeKey) return;
    const nextKey = nextLabel
      ? `next:${normalizeKey(nextLabel)}`
      : `end:${normalizeKey(farEnd)}`;
    let group = groups.get(nextKey);
    if (!group) {
      group = { ends: new Map() };
      groups.set(nextKey, group);
    }
    const endKey = normalizeKey(farEnd);
    if (!group.ends.has(endKey)) group.ends.set(endKey, farEnd);
  };

  for (const c of corridors || []) {
    // Toward destB: next is neighbors.towardDest
    add(c.neighbors?.towardDest || null, c.dest);
    // Toward destA: next is neighbors.towardOrigin
    add(c.neighbors?.towardOrigin || null, c.origin);
  }

  return [...groups.values()]
    .map((g) => [...g.ends.values()].sort((a, b) => a.localeCompare(b)))
    .filter((ends) => ends.length)
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/**
 * One-line neighbour headline: "Pretoria - Irene / Kempton Park · Pienaarspoort".
 * `/` only joins ends that share the same next station.
 */
export function buildStationNeighbourHeadline(station, corridors) {
  const place = station?.name || '';
  if (!place) return '';
  const groups = groupStationFarEndsByNext(station, corridors);
  if (!groups.length) return '';
  return `${place} - ${groups.map((ends) => ends.join(' / ')).join(' · ')}`;
}

function earliestLatestWeekday(corridors) {
  let earliest = null;
  let latest = null;
  for (const c of corridors || []) {
    for (const dir of [c.weekday?.towardA, c.weekday?.towardB]) {
      for (const t of dir?.trains || []) {
        const sec = Number(t.departureSec);
        if (!Number.isFinite(sec)) continue;
        if (!earliest || sec < earliest.sec) earliest = { sec, clock: t.departureTime };
        if (!latest || sec > latest.sec) latest = { sec, clock: t.departureTime };
      }
    }
  }
  return { earliest, latest };
}

/** Quick facts drawn from the schedule dump and corridor cards. */
export function buildStationQuickFacts(station, corridors) {
  const facts = [];
  const province = regionName(station?.region);
  if (province) facts.push({ label: 'Region', value: province });

  const lineNames = (corridors || []).map((c) => c.routeName).filter(Boolean);
  if (lineNames.length) {
    facts.push({
      label: lineNames.length === 1 ? 'Line' : 'Lines',
      value: lineNames.length === 1 ? lineNames[0] : `${lineNames.length} corridors`,
    });
  }

  const serveGroups = groupStationFarEndsByNext(station, corridors);
  if (serveGroups.length) {
    facts.push({
      label: 'Serves',
      value: serveGroups.map((ends) => ends.join(' / ')).join(' · '),
    });
  }

  const { earliest, latest } = earliestLatestWeekday(corridors);
  if (earliest?.clock) facts.push({ label: 'Weekday first', value: earliest.clock });
  if (latest?.clock) facts.push({ label: 'Weekday last', value: latest.clock });

  const isTerminus = (corridors || []).length > 0 && (corridors || []).every((c) => (
    !c.neighbors?.towardOrigin || !c.neighbors?.towardDest
  ));
  if ((corridors || []).length) {
    facts.push({ label: 'Role', value: isTerminus ? 'Terminus / hub' : 'Through station' });
  }

  if (station?.coords
    && Number.isFinite(station.coords.lat)
    && Number.isFinite(station.coords.lon)) {
    facts.push({
      label: 'GPS',
      value: `${station.coords.lat.toFixed(4)}, ${station.coords.lon.toFixed(4)}`,
    });
  }

  return facts;
}

/** Longer About copy for the station landing. */
export function buildStationAbout(station, corridors) {
  const place = station?.name || 'This station';
  const province = regionName(station?.region) || 'South Africa';
  const lineNames = (corridors || []).map((c) => c.routeName).filter(Boolean);
  const headline = buildStationNeighbourHeadline(station, corridors);
  const { earliest, latest } = earliestLatestWeekday(corridors);

  let about = `${place} is an active Metrorail station in ${province}`;
  if (lineNames.length === 1) {
    about += ` on the ${lineNames[0]} corridor`;
  } else if (lineNames.length > 1) {
    about += `, where ${lineNames.length} published corridors meet`;
  }
  about += '.';

  if (headline) {
    about += ` From here the sheets run ${headline}.`;
  }

  if (earliest?.clock && latest?.clock) {
    about += ` On weekdays the published departures from this stop span about ${earliest.clock} to ${latest.clock}.`;
  }

  about += ' The lists below follow the PRASA weekday and Saturday sheets. Open Next Train for the next live departure on this corridor.';
  return about;
}

/** Leaflet GPS map URL focused on this station (full map UI when embed is false). */
export function buildStationMapPath(station, { embed = false } = {}) {
  const params = new URLSearchParams();
  if (station?.region) params.set('region', station.region);
  if (station?.name) params.set('station', station.name);
  if (station?.coords?.lat != null && station?.coords?.lon != null) {
    params.set('lat', String(station.coords.lat));
    params.set('lon', String(station.coords.lon));
  }
  if (embed) params.set('embed', '1');
  return `map.html?${params.toString()}`;
}

export function stationDocumentTitle(station) {
  const place = station?.name || 'Station';
  const region = regionName(station?.region);
  return `${place} station - Metrorail ${region} | Next Train`;
}

export function stationMetaDescription(station, corridors) {
  const place = station?.name || 'This station';
  const lines = (corridors || []).map((c) => c.routeName).filter(Boolean);
  const lineBit = lines.length
    ? ` Lines: ${lines.slice(0, 3).join(', ')}${lines.length > 3 ? ', and more' : ''}.`
    : '';
  const neigh = corridors?.[0]?.neighbors;
  const neighBit = neigh?.towardOrigin && neigh?.towardDest
    ? ` Between ${neigh.towardOrigin} and ${neigh.towardDest}.`
    : '';
  return `${place} Metrorail station timetable for weekdays and Saturdays.${lineBit}${neighBit} Open Next Train for the next departure.`;
}

export function buildStationJsonLd({ station, corridors, pageUrl, description }) {
  const region = regionName(station.region);
  const regionEntry = listSeoRegions().find((r) => r.region === station.region);
  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Next Train', item: 'https://nexttrain.co.za/' },
      { '@type': 'ListItem', position: 2, name: 'Routes', item: 'https://nexttrain.co.za/routes.html' },
      ...(regionEntry
        ? [{
          '@type': 'ListItem',
          position: 3,
          name: region,
          item: `https://nexttrain.co.za/regions/${regionEntry.slug}.html`,
        }]
        : []),
      {
        '@type': 'ListItem',
        position: regionEntry ? 4 : 3,
        name: `${station.name} station`,
        item: pageUrl,
      },
    ],
  };

  const trainStation = {
    '@type': 'TrainStation',
    name: `${station.name} station`,
    description,
    url: pageUrl,
    ...(station.coords
      ? {
        geo: {
          '@type': 'GeoCoordinates',
          latitude: station.coords.lat,
          longitude: station.coords.lon,
        },
      }
      : {}),
  };

  return {
    '@context': 'https://schema.org',
    '@graph': [trainStation, breadcrumbs],
  };
}

/** Debug helper — neighbours lookup used in verifies. */
export function neighboursForStationRoute(stationName, routeId) {
  const db = loadScheduleDump();
  const route = ROUTES[routeId];
  if (!route) return null;
  const key = route.sheetKeys?.weekday_to_b || route.sheetKeys?.weekday_to_a;
  if (!key) return null;
  return neighboursOnSheet(db, key, stationName);
}
