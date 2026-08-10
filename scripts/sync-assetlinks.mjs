#!/usr/bin/env node
/**
 * Sync public/.well-known/assetlinks.json + twa/twa-manifest.json fingerprints
 * from twa/upload-cert-sha256.txt (and optional EXTRA_FINGERPRINTS).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_ID = 'za.co.nexttrain.app';
const FP_FILE = join(ROOT, 'twa', 'upload-cert-sha256.txt');
const ASSETLINKS = join(ROOT, 'public', '.well-known', 'assetlinks.json');
const TWA_MANIFEST = join(ROOT, 'twa', 'twa-manifest.json');

function normalizeFp(fp) {
  return String(fp || '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F:]/g, '');
}

function loadFingerprints() {
  if (!existsSync(FP_FILE)) {
    console.error(`Missing ${FP_FILE}. Run scripts/setup-twa-signing.sh first.`);
    process.exit(1);
  }
  const fromFile = readFileSync(FP_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(normalizeFp)
    .filter((fp) => /^[0-9A-F:]+$/.test(fp) && fp.includes(':'));

  const extra = String(process.env.EXTRA_FINGERPRINTS || '')
    .split(',')
    .map(normalizeFp)
    .filter(Boolean);

  const all = [...new Set([...fromFile, ...extra])];
  if (!all.length) {
    console.error('No SHA-256 fingerprints found.');
    process.exit(1);
  }
  return all;
}

const fingerprints = loadFingerprints();

const assetLinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: PACKAGE_ID,
      sha256_cert_fingerprints: fingerprints,
    },
  },
];
writeFileSync(ASSETLINKS, `${JSON.stringify(assetLinks, null, 2)}\n`);
console.log(`Wrote ${ASSETLINKS} (${fingerprints.length} fingerprint(s))`);

if (existsSync(TWA_MANIFEST)) {
  const twa = JSON.parse(readFileSync(TWA_MANIFEST, 'utf8'));
  twa.packageId = PACKAGE_ID;
  twa.fingerprints = fingerprints.map((value, i) => ({
    name: i === 0 ? 'upload' : `extra-${i}`,
    value,
  }));
  writeFileSync(TWA_MANIFEST, `${JSON.stringify(twa, null, 2)}\n`);
  console.log(`Updated fingerprints in ${TWA_MANIFEST}`);
}
