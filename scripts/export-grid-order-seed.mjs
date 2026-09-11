#!/usr/bin/env node
/**
 * Build an importable RTDB seed from the frozen MANUAL_GRID_ORDER fallback.
 * This script performs no network requests and never mutates Firebase.
 */
import { writeFileSync } from 'node:fs';
import { MANUAL_GRID_ORDER, gridOrderLookupKeys } from '../src/lib/grid-order.js';
import { ROUTES } from '../src/lib/config.js';
import scheduleDump from '../public/data/full-database.json' with { type: 'json' };

const REGION_NESTS = {
  GP: 'gauteng',
  WC: 'westerncape',
  KZN: 'kzn',
  EC: 'easterncape',
};

function parseArgs(argv) {
  const args = { out: null, updatedAt: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--updated-at') args.updatedAt = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isFinite(args.updatedAt) || args.updatedAt < 0) {
    throw new Error('--updated-at must be a non-negative number');
  }
  return args;
}

function regionIndex() {
  const index = new Map();
  const add = (key, region) => {
    for (const alias of gridOrderLookupKeys(key)) index.set(alias, region);
  };
  for (const route of Object.values(ROUTES)) {
    if (!REGION_NESTS[route?.region]) continue;
    Object.values(route.sheetKeys || {}).forEach((key) => key && add(key, route.region));
  }
  for (const [region, nest] of Object.entries(REGION_NESTS)) {
    Object.keys(scheduleDump[nest] || {}).forEach((key) => add(key, region));
  }
  // Retained Western Cape aliases no longer present in ROUTES or the current dump.
  ['ctcen_in_weekday', 'ctcen_out_weekday', 'ctcen_in_sat', 'ctcen_out_sat']
    .forEach((key) => add(key, 'WC'));
  return index;
}

export function buildGridOrderSeed(updatedAt = 0) {
  const byRegion = regionIndex();
  const gridOrder = { GP: {}, WC: {}, KZN: {}, EC: {} };
  const unresolved = [];
  for (const [sheetKey, order] of Object.entries(MANUAL_GRID_ORDER)) {
    const region = byRegion.get(sheetKey);
    if (!region) {
      unresolved.push(sheetKey);
      continue;
    }
    gridOrder[region][sheetKey] = {
      order: [...order],
      updatedAt,
      updatedBy: 'seed:MANUAL_GRID_ORDER',
      source: 'manual-fallback-seed',
    };
  }
  if (unresolved.length) {
    throw new Error(`Could not resolve region for ${unresolved.length} sheet key(s): ${unresolved.join(', ')}`);
  }
  return { config: { grid_order: gridOrder } };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const json = `${JSON.stringify(buildGridOrderSeed(args.updatedAt), null, 2)}\n`;
  if (args.out) writeFileSync(args.out, json, 'utf8');
  else process.stdout.write(json);
}
