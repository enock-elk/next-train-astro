#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MANUAL_GRID_ORDER,
  clearRuntimeGridOrderConfig,
  getGridOrderManifest,
  normalizeGridOrder,
  orderGridTrainIds,
  setRuntimeGridOrderConfig,
} from '../src/lib/grid-order.js';
import { buildGridOrderSeed } from './export-grid-order-seed.mjs';

const rootUrl = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), 'utf8');
const fixture = JSON.parse(read('test/fixtures/grid-order-rtdb-export.json'));

function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/).map((line) => line.split(','));
  return lines.map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] || ''])));
}

const rows = parseCsv(read('test/fixtures/pretoria-pienaarspoort-upload.csv'));
const ids = ['1151', '9990', '1153'];

assert(Object.isFrozen(MANUAL_GRID_ORDER), 'manual table must be frozen');
assert(Object.isFrozen(MANUAL_GRID_ORDER.pta_to_pien_weekday), 'manual arrays must be frozen');

assert.deepEqual(
  orderGridTrainIds('pta_to_pien_weekday', ids, rows),
  ['1151', '9990', '1153'],
  'unknown mid-route train should be inserted by its first valid service time'
);

const runtimeConfig = fixture.config.grid_order.GP;
assert.deepEqual(
  orderGridTrainIds('pta_to_pien_weekday', ids, rows, { region: 'GP', runtimeConfig }),
  ['9990', '1153', '1151'],
  'RTDB order must override MANUAL while preserving configured relative order'
);

setRuntimeGridOrderConfig('GP', runtimeConfig);
assert.deepEqual(
  orderGridTrainIds('pta_to_pien_weekday', ids, rows, { region: 'GP' }),
  ['9990', '1153', '1151'],
  'installed runtime snapshot must be used'
);
clearRuntimeGridOrderConfig();

assert.deepEqual(
  orderGridTrainIds('pta_to_pien_weekday', ids, rows, {
    runtimeOrder: { action: 'reset', updatedAt: 1 },
    manifestOrder: ['1153', '1151'],
  }),
  ['9990', '1153', '1151'],
  'named companion manifest must be supported when RTDB has no explicit order'
);
assert.deepEqual(
  getGridOrderManifest({ _columnOrder: { pta_to_pien_weekday: ['1153', '1151'] } }, 'pta_to_pien_weekday'),
  ['1153', '1151']
);
assert.deepEqual(
  getGridOrderManifest({ pta_to_pien_weekday_columnOrder: ['1151', '9990', '1153'] }, 'pta_to_pien_weekday'),
  ['1151', '9990', '1153'],
  'Apps Script companion order must preserve the Excel header sequence'
);
assert.equal(normalizeGridOrder({ random: { 1151: true, 1153: true } }), null, 'object key order must never become column order');

assert.deepEqual(
  orderGridTrainIds('pta-to-pien_weekday', ['1153', '1151'], rows),
  ['1151', '1153'],
  'hyphen and underscore sheet aliases must share the fallback'
);

const seed = buildGridOrderSeed(123);
const seededRecords = Object.values(seed.config.grid_order).flatMap((region) => Object.values(region));
assert.equal(seededRecords.length, Object.keys(MANUAL_GRID_ORDER).length, 'seed must export every fallback key');
assert(seededRecords.every((record) =>
  record.updatedAt === 123
  && record.updatedBy === 'seed:MANUAL_GRID_ORDER'
  && record.source === 'manual-fallback-seed'
  && Array.isArray(record.order)
), 'seed records must include deterministic metadata');

const rules = JSON.parse(read('firebase-database.rules.json'));
const gridRules = rules.rules.config.grid_order;
assert.equal(gridRules['.read'], true, 'grid order must be public-readable');
assert.match(gridRules['.write'], /enockelk@gmail\.com/);
assert.match(gridRules['.write'], /thandeka05nxumalo@gmail\.com/);

const admin = read('public/js/admin.js');
for (const required of [
  'setupGridOrderManager',
  'data-grid-order-up',
  'data-grid-order-down',
  'draggable="true"',
  'beforeunload',
  'Discard unsaved grid order changes?',
  'config/grid_order/',
]) {
  assert(admin.includes(required), `admin editor missing ${required}`);
}

const renderer = read('src/lib/renderer.js');
const logic = read('src/lib/logic.js');
const seo = read('src/lib/seo-timetable.js');
const og = read('workers/nexttrain-og/src/schedule.js');
const appsScript = read('scripts/google-apps-script-gauteng-sync.gs');
const wcAppsScript = read('scripts/google-apps-script-westerncape-sync.gs');
const kznAppsScript = read('scripts/google-apps-script-kzn-sync.gs');
assert(renderer.includes('manifestOrder: schedule.columnOrder'));
assert(logic.includes('fetchGridOrderConfig($userRegion.get()'));
assert(seo.includes('runtimeConfig: exportedOrders'));
assert(og.includes('loadRegionGridOrder'));
assert(appsScript.includes('cleanKey + "_columnOrder"'));
assert(appsScript.includes('const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/"'));
assert(appsScript.includes('const FIREBASE_SECRET = "ReVFetiSjWyEPDCSsCY8ugtAXsObIXUBEXOYbdbL"'));
assert(wcAppsScript.includes('cleanKey + "_columnOrder"'));
assert(wcAppsScript.includes('schedules/westerncape.json'));
assert(wcAppsScript.includes('CT-to-HANI_Weekday'));
assert(wcAppsScript.includes('CT-to-MALM_Sat'));
assert(!wcAppsScript.includes('schedules.json?auth='), 'Western Cape must not write the legacy monolithic node');
assert(wcAppsScript.includes('const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/"'));
assert(wcAppsScript.includes('const FIREBASE_SECRET = "ReVFetiSjWyEPDCSsCY8ugtAXsObIXUBEXOYbdbL"'));
assert(kznAppsScript.includes('cleanKey + "_columnOrder"'));
assert(kznAppsScript.includes('schedules/kzn.json'));
assert(kznAppsScript.includes('DURBN-to-UMLAZ_Weekday'));
assert(kznAppsScript.includes('CROSS-to-DURBN_Sat'));
assert(!kznAppsScript.includes('schedules.json?auth='), 'KZN must not write the legacy monolithic node');
assert(kznAppsScript.includes('const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/"'));
assert(kznAppsScript.includes('const FIREBASE_SECRET = "ReVFetiSjWyEPDCSsCY8ugtAXsObIXUBEXOYbdbL"'));
const ecAppsScript = read('scripts/google-apps-script-easterncape-sync.gs');
assert(ecAppsScript.includes('cleanKey + "_columnOrder"'));
assert(ecAppsScript.includes('schedules/easterncape.json'));
assert(ecAppsScript.includes('BERLN-to-EASTL_Weekday'));
assert(ecAppsScript.includes('EASTL-to-BERLN_Sat'));
assert(!ecAppsScript.includes('schedules.json?auth='), 'Eastern Cape must not write the legacy monolithic node');
assert(ecAppsScript.includes('const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/"'));
assert(ecAppsScript.includes('const FIREBASE_SECRET = "ReVFetiSjWyEPDCSsCY8ugtAXsObIXUBEXOYbdbL"'));
const wcPubAppsScript = read('scripts/google-apps-script-westerncape-public-holidays-sync.gs');
assert(wcPubAppsScript.includes('cleanKey + "_columnOrder"'));
assert(wcPubAppsScript.includes('schedules/westerncape/public_holidays.json'));
assert(wcPubAppsScript.includes('syncPublicHolidaysToFirebase'));
assert(wcPubAppsScript.includes('/_Pub$/i'));
assert(wcPubAppsScript.includes('CT-to-HANI_Pub'));
assert(wcPubAppsScript.includes('MALM-to-CT_Pub'));
assert(wcPubAppsScript.includes('PropertiesService.getScriptProperties()'));
assert(!wcPubAppsScript.includes('schedules/westerncape.json?auth='), 'WC public holidays must not PUT the weekday/sat root');
assert(!wcPubAppsScript.includes('schedules.json?auth='), 'WC public holidays must not write the legacy monolithic node');

console.log('✓ dynamic grid order resolver, fixtures, rules, admin, and integrations OK');
