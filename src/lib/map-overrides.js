/**
 * Admin-moved stations and y-junctions. Timetable COORDINATES and baked
 * GeoJSON stay in place. These overrides are the pins autolocate and the
 * planner read, and the branch a trip is allowed to draw.
 */
import { DYNAMIC_BASE_URL } from './config.js';
import { normalizeStationName } from './utils.js';

export async function fetchMapStationOverrides() {
    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}config/map_stations.json`, { cache: 'no-store' });
        if (!res.ok) return {};
        const data = await res.json();
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

export async function fetchTrackForks() {
    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}config/track_forks.json`, { cache: 'no-store' });
        if (!res.ok) return {};
        const data = await res.json();
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

export function applyMapStationOverrides(index, overrides) {
    if (!index || !overrides) return index;
    const byNorm = new Map();
    for (const [key, value] of Object.entries(overrides)) {
        const lat = Number(value?.lat);
        const lon = Number(value?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const norm = normalizeStationName(value?.name || key);
        if (norm) byNorm.set(norm, { lat, lon });
    }
    if (!byNorm.size) return index;
    for (const [name, row] of Object.entries(index)) {
        if (!row) continue;
        const hit = byNorm.get(normalizeStationName(name));
        if (!hit) continue;
        row.lat = hit.lat;
        row.lon = hit.lon;
    }
    return index;
}

function stopName(stop) {
    return normalizeStationName(stop?.name || stop?.station || stop?.origName || '');
}

/**
 * Keep the trunk up to the split, plus the one branch that contains this trip.
 * Other branch stops are dropped so the map draws one way through the junction.
 */
export function filterStopsForFork(stops, fork) {
    if (!fork || !Array.isArray(stops) || stops.length < 2) return stops;
    const branches = fork.branches && typeof fork.branches === 'object'
        ? Object.values(fork.branches).filter((b) => b && Array.isArray(b.stops) && b.stops.length)
        : [];
    if (branches.length < 2) return stops;
    const names = stops.map(stopName);
    const at = normalizeStationName(fork.at);
    const atIdx = at ? names.findIndex((n) => n === at) : -1;
    const scored = branches.map((branch) => {
        const set = new Set(branch.stops.map((s) => normalizeStationName(s)).filter(Boolean));
        let hits = 0;
        for (const name of names) if (set.has(name)) hits += 1;
        const dest = names[names.length - 1];
        const origin = names[0];
        return {
            branch,
            set,
            hits,
            hasDest: set.has(dest),
            hasOrigin: set.has(origin),
        };
    });
    scored.sort((a, b) => (b.hasDest - a.hasDest) || (b.hasOrigin - a.hasOrigin) || (b.hits - a.hits));
    const best = scored[0];
    if (!best || best.hits < 1) return stops;
    return stops.filter((stop, i) => {
        const name = names[i];
        if (best.set.has(name)) return true;
        if (atIdx >= 0 && i <= atIdx) return true;
        return false;
    });
}

/** Apply a saved fork per route leg. Stops with no fork stay as they are. */
export function applyForksToStops(stops, forks) {
    if (!Array.isArray(stops) || stops.length < 2 || !forks || typeof forks !== 'object') return stops;
    const out = [];
    let i = 0;
    while (i < stops.length) {
        const routeId = stops[i]?.routeId || '';
        let j = i + 1;
        while (j < stops.length && (stops[j]?.routeId || '') === routeId) j += 1;
        const slice = stops.slice(i, j);
        const fork = routeId ? forks[routeId] : null;
        const filtered = fork ? filterStopsForFork(slice, fork) : slice;
        for (const stop of filtered) {
            const prev = out[out.length - 1];
            if (prev && stopName(prev) && stopName(prev) === stopName(stop)) continue;
            out.push(stop);
        }
        i = j;
    }
    return out.length > 1 ? out : stops;
}

function firebaseKey(raw) {
    return String(raw || 'item').replace(/[.#$[\]/]/g, '_').slice(0, 80);
}

/** Parent-only write. The map iframe posts the body; this PUT uses the operator token. */
export async function putMapOverride(message, authToken) {
    const token = encodeURIComponent(String(authToken || ''));
    if (!token) return false;
    const base = DYNAMIC_BASE_URL;
    if (message?.node === 'config/map_stations' && message.body && typeof message.body === 'object') {
        const entries = Object.entries(message.body);
        if (!entries.length) return false;
        for (const [key, value] of entries) {
            const lat = Number(value?.lat);
            const lon = Number(value?.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
            const res = await fetch(`${base}config/map_stations/${encodeURIComponent(firebaseKey(key))}.json?auth=${token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lat,
                    lon,
                    name: String(value?.name || key).slice(0, 80),
                }),
            });
            if (!res.ok) return false;
        }
        return true;
    }
    if (message?.node === 'config/track_forks' && message.routeId && message.body) {
        const res = await fetch(`${base}config/track_forks/${encodeURIComponent(firebaseKey(message.routeId))}.json?auth=${token}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.body),
        });
        return res.ok;
    }
    return false;
}

export function bindMapOverrideSaveListener() {
    if (typeof window === 'undefined' || window.__ntMapSaveBound) return;
    window.__ntMapSaveBound = true;
    window.addEventListener('message', (ev) => {
        const data = ev?.data;
        if (!data || data.type !== 'nt-map-save') return;
        if (ev.origin && ev.origin !== window.location.origin) return;
        const reply = (ok) => {
            try {
                ev.source?.postMessage({ type: 'nt-map-save-result', id: data.id, ok: !!ok }, ev.origin || '*');
            } catch { /* iframe gone */ }
        };
        (async () => {
            try {
                const { isAdminAuthed } = await import('./admin-chrome.js');
                if (!isAdminAuthed() || !window.Admin?.getAuthKey) {
                    reply(false);
                    return;
                }
                const token = await window.Admin.getAuthKey();
                reply(token ? await putMapOverride(data, token) : false);
            } catch {
                reply(false);
            }
        })();
    });
}
