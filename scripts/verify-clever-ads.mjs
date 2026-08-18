/**
 * Guardrails for CleverAds: vendor snippet + no layout fight.
 * Ads themselves only fill on nexttrain.co.za — this checks our wiring.
 *
 * Usage: node scripts/verify-clever-ads.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = (msg) => failures.push(msg);

const layout = readFileSync(join(ROOT, 'src/layouts/Layout.astro'), 'utf8');
const ads = readFileSync(join(ROOT, 'src/lib/clever-ads.js'), 'utf8');

if (!layout.includes('id="clever-core"')) fail('Layout missing SCRIPT#clever-core');
if (/<div[^>]*id="clever-core"/.test(layout)) fail('Layout must not host DIV#clever-core (vendor id is a SCRIPT)');
if (!layout.includes('data-cfasync="false"')) fail('clever-core script must have data-cfasync="false"');
if (!layout.includes('CleverCoreLoader103008')) fail('vendor loader id missing from Layout snippet');
if (!layout.includes('scripts.cleverwebserver.com/a399a0d9cfe9817e0ccd10f89b4e320a.js')) {
  fail('vendor loader src missing from Layout snippet');
}
if (!layout.includes('a.parentNode.insertBefore(c, a)')) fail('vendor insertBefore missing — snippet drifted from Clever original');
if (!layout.includes('window.__ntCleverVendorInject')) fail('vendor IIFE must be wrapped for Guardian delay');
if (!layout.includes('id="nt-shell"')) fail('Layout missing #nt-shell so ads cannot sit as body flex siblings');
if (/<body[^>]*flex items-start justify-center/.test(layout)) {
  fail('body must not be the flex centering container (that squeezed the board beside the ad)');
}
if (!layout.includes('html.nt-ads-cloaked')) fail('safe-zone cloak CSS missing (visibility only)');

if (!ads.includes('__ntCleverVendorInject')) fail('clever-ads.js must call the vendor IIFE, not a restyled host DIV');
if (/setProperty\(\s*['"]left['"]/.test(ads) || /setProperty\(\s*['"]top['"]/.test(ads) || /translateX\(-50%\)/.test(ads)) {
  fail('clever-ads.js must not force left/top/transform on vendor overlays');
}
if (ads.includes('127.0.0.1')) fail('clever-ads.js still has leftover debug ingest');
if (ads.includes('forceCenterStickyAds') || ads.includes('data-nt-centered')) {
  fail('clever-ads.js still force-centers vendor overlays');
}
if (ads.includes("setProperty('display', 'none'")) {
  fail('do not cloak vendor nodes with display:none (strips their layout)');
}

if (failures.length) {
  console.error(`\n✗ clever-ads check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('✓ clever-ads vendor snippet + shell isolation OK');
