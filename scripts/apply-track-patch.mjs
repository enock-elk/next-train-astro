/**
 * Apply a downloaded gold-track patch to public/tracks/rail-tracks-{GP,WC,EC}.geojson.
 *
 * The network map editor (admin, full /map) exports a JSON patch. This script
 * writes that LineString (and optional station order) into the bake. KZN is
 * held (Duff's Road) and is always refused. Does not invent RTDB paths.
 *
 * Usage:
 *   npm run tracks:apply-patch -- path/to/track-patch-WC-ct-kapteinsklip.json
 *   node scripts/apply-track-patch.mjs --dry-run path/to/patch.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRACKS = path.join(ROOT, 'public', 'tracks');
const MAP_APP = path.join(ROOT, 'public', 'js', 'map-app.js');
const HELD_REGIONS = new Set(['KZN']);
const ALLOWED_REGIONS = new Set(['GP', 'WC', 'EC']);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const files = args.filter((a) => a !== '--dry-run');
if (!files.length) {
    console.error('Usage: node scripts/apply-track-patch.mjs [--dry-run] <patch.json> [more.json]');
    process.exit(1);
}

function parseStationPins(src) {
    const block = src.match(/const STATION_COORDINATES = \{([\s\S]*?)\n\s*\};/);
    if (!block) return {};
    const stations = {};
    for (const m of block[1].matchAll(/"([^"]+)":\s*\[([-\d.]+),\s*([-\d.]+)\]/g)) {
        stations[m[1]] = [parseFloat(m[2]), parseFloat(m[3])];
    }
    return stations;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function unwrapPatch(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('patch is not an object');
    if (raw.type === 'Feature' && raw.geometry) {
        const props = raw.properties || {};
        return {
            region: String(props.region || '').toUpperCase(),
            routeId: String(props.routeId || ''),
            stationNames: props.stationNames,
            coordinates: raw.geometry.coordinates,
            coordinateOrder: props.coordinateOrder || 'lon,lat',
        };
    }
    if (raw.kind === 'nexttrain-track-patch' || raw.routeId) {
        return {
            region: String(raw.region || '').toUpperCase(),
            routeId: String(raw.routeId || ''),
            stationNames: raw.stationNames,
            coordinates: raw.coordinates,
            coordinateOrder: raw.coordinateOrder || 'lon,lat',
        };
    }
    throw new Error('unrecognised patch (need kind nexttrain-track-patch or a GeoJSON Feature)');
}

function toLonLat(pair, order) {
    if (!pair) return null;
    if (!Array.isArray(pair) && typeof pair === 'object') {
        const lat = Number(pair.lat);
        const lon = Number(pair.lon ?? pair.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return [lon, lat];
    }
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const a = Number(pair[0]);
    const b = Number(pair[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (order === 'lat,lon') return [b, a];
    // Leaflet [lat,lon] sneaking in: SA latitudes are ~-35..-22, longitudes ~16..33.
    if (order !== 'lon,lat' && a < -20 && a > -40 && b > 15 && b < 34) return [b, a];
    return [a, b];
}

function normaliseLine(coordinates, order) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error('patch needs at least two coordinates');
    }
    const out = [];
    for (const pair of coordinates) {
        const ll = toLonLat(pair, order);
        if (!ll) throw new Error('patch has a non-numeric coordinate');
        const [lon, lat] = ll;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            throw new Error(`coordinate out of range lon=${lon} lat=${lat}`);
        }
        out.push([lon, lat]);
    }
    return out;
}

function normaliseNames(list) {
    if (list == null) return null;
    if (!Array.isArray(list)) throw new Error('stationNames must be an array of strings');
    const names = list
        .map((s) => String(s || '').replace(/ STATION$/i, '').trim().toUpperCase())
        .filter(Boolean);
    if (names.length < 2) throw new Error('stationNames needs at least two stops');
    return names;
}

const STATION_PINS = parseStationPins(fs.readFileSync(MAP_APP, 'utf8'));

let failed = 0;
for (const file of files) {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) {
        console.error(`${file}: not found`);
        failed++;
        continue;
    }
    let patch;
    try {
        patch = unwrapPatch(readJson(abs));
    } catch (err) {
        console.error(`${file}: ${err.message}`);
        failed++;
        continue;
    }
    const region = patch.region;
    const routeId = patch.routeId;
    if (!routeId) {
        console.error(`${file}: missing routeId`);
        failed++;
        continue;
    }
    if (HELD_REGIONS.has(region) || routeId.startsWith('kzn-')) {
        console.error(`${file}: KZN gold tracks are held (Duff's Road). Refusing to write ${routeId}.`);
        failed++;
        continue;
    }
    if (!ALLOWED_REGIONS.has(region)) {
        console.error(`${file}: region must be GP, WC or EC (got ${region || 'empty'})`);
        failed++;
        continue;
    }
    let coords;
    let names;
    try {
        coords = normaliseLine(patch.coordinates, patch.coordinateOrder);
        names = normaliseNames(patch.stationNames);
    } catch (err) {
        console.error(`${file}: ${err.message}`);
        failed++;
        continue;
    }

    const geoPath = path.join(TRACKS, `rail-tracks-${region}.geojson`);
    if (!fs.existsSync(geoPath)) {
        console.error(`${file}: ${geoPath} not found`);
        failed++;
        continue;
    }
    const fc = readJson(geoPath);
    const feature = (fc.features || []).find((f) => f?.properties?.routeId === routeId);
    if (!feature) {
        console.error(`${file}: ${region} bake has no feature ${routeId}`);
        failed++;
        continue;
    }

    const prev = feature.geometry?.coordinates?.length || 0;
    feature.geometry = { type: 'LineString', coordinates: coords };
    feature.properties = feature.properties || {};
    feature.properties.source = 'manual-edit';
    feature.properties.manualEdit = true;
    feature.properties.manualEditAt = new Date().toISOString();
    if (names) {
        feature.properties.stationNames = names;
        feature.properties.stationOrderOverride = true;
        feature.properties.stations = names.length;
        feature.properties.stationCoords = names.map((name) => {
            const pin = STATION_PINS[name];
            return pin ? [+pin[0].toFixed(6), +pin[1].toFixed(6)] : null;
        }).filter(Boolean);
    }

    console.log(
        `${dryRun ? 'dry-run ' : ''}${region} ${routeId}: ${prev} verts → ${coords.length}`
        + (names ? `; station order ${names.join(' > ')}` : '')
    );
    if (dryRun) continue;
    fs.writeFileSync(geoPath, JSON.stringify(fc));
    console.log(`  wrote ${path.relative(ROOT, geoPath)}`);
}

if (failed) process.exit(1);
