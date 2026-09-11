import { routeSheetKeyForDay } from './utils.js';

const STORAGE_PREFIX = 'nt_schedule_revision_v1:';

function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function sheetRevision(database, sheetKey) {
    if (!sheetKey || !database || database[sheetKey] == null) return null;
    return hashText(JSON.stringify([
        database[`${sheetKey}_meta`] ?? null,
        database[`${sheetKey}_columnOrder`] ?? null,
        database[sheetKey],
    ]));
}

export function getActiveRouteScheduleRevision(database, route, dayType) {
    const sheetKeys = [
        routeSheetKeyForDay(route, dayType, 'a'),
        routeSheetKeyForDay(route, dayType, 'b'),
    ].filter(Boolean);
    if (!sheetKeys.length) return null;

    const revisions = sheetKeys.map((sheetKey) => sheetRevision(database, sheetKey));
    if (revisions.some((revision) => !revision)) return null;
    return {
        family: sheetKeys.join('|'),
        revision: revisions.join('|'),
    };
}

/**
 * Persist the current two-direction route revision. Cached/bundled paints call
 * with `notify: false` to establish a baseline; only a later network payload
 * may report a change.
 */
export function recordRouteScheduleRevision({
    database,
    route,
    routeId,
    dayType,
    storage,
    notify = false,
}) {
    if (!routeId || !storage) return false;
    const active = getActiveRouteScheduleRevision(database, route, dayType);
    if (!active) return false;

    const storageKey = `${STORAGE_PREFIX}${routeId}`;
    let seen = {};
    try {
        seen = JSON.parse(storage.getItem(storageKey) || '{}');
        if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {};
    } catch {
        seen = {};
    }

    const previous = seen[active.family];
    seen[active.family] = active.revision;
    storage.setItem(storageKey, JSON.stringify(seen));
    return notify && typeof previous === 'string' && previous !== active.revision;
}
