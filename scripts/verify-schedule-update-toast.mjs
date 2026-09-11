#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getActiveRouteScheduleRevision,
  recordRouteScheduleRevision,
} from '../src/lib/schedule-revision.js';

const route = {
  region: 'GP',
  sheetKeys: {
    weekday_to_a: 'route_to_a_weekday',
    weekday_to_b: 'route_to_b_weekday',
    saturday_to_a: 'route_to_a_sat',
    saturday_to_b: 'route_to_b_sat',
  },
};
const database = {
  route_to_a_weekday: [{ STATION: 'A', '1001': '05:00' }],
  route_to_b_weekday: [{ STATION: 'B', '1002': '05:10' }],
  route_to_a_sat: [{ STATION: 'A', '2001': '06:00' }],
  route_to_b_sat: [{ STATION: 'B', '2002': '06:10' }],
};
const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
const record = (db, routeId = 'route-one', dayType = 'weekday', notify = true) =>
  recordRouteScheduleRevision({ database: db, route, routeId, dayType, storage, notify });

assert(getActiveRouteScheduleRevision(database, route, 'weekday'), 'two active directions need a revision');
assert.equal(record(database), false, 'first observation establishes a baseline without a toast');
assert.equal(record(database), false, 'repeated fresh paints do not notify');

const changed = structuredClone(database);
changed.route_to_b_weekday[0]['1002'] = '05:12';
assert.equal(record(changed), true, 'a changed direction coalesces into one route notification');
assert.equal(record(changed), false, 'the same changed payload only notifies once');
assert.equal(record(changed, 'route-two'), false, 'an unrelated route gets its own silent baseline');
assert.equal(record(changed, 'route-one', 'saturday'), false, 'switching schedule families is not an update');

const logic = readFileSync(new URL('../src/lib/logic.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/lib/ui.js', import.meta.url), 'utf8');
assert(logic.includes("showToast('Schedule updated', 'success', 3000)"));
assert(logic.includes('rememberRouteRevision(proposedDB, false)'));
assert(logic.includes('rememberRouteRevision(downloadedDB, true)'));
assert(ui.includes('leading-snug truncate'), 'toast copy must remain on one row on narrow screens');

console.log('✓ route-specific schedule update baseline, dedupe, coalescing, and one-row toast OK');
