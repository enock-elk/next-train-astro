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
if (!layout.includes('--nt-ad-shift')) fail('Layout must ease the board via --nt-ad-shift');
if (!layout.includes('--nt-ad-flip')) fail('Layout must FLIP in-flow ads via --nt-ad-flip');
if (!layout.includes('html.nt-ads-cloaked #nt-shell')) fail('cloaked shell must not keep an ad shift');
if (!layout.includes('body.modal-active #nt-shell')) fail('open modals must zero #nt-shell ad-shift vars');
if (!layout.includes('#nt-shell.nt-ad-shifted #main-content.app-shell')) {
  fail('ad ease must transform #main-content, not #nt-shell (overlays live inside the shell)');
}
if (/#nt-shell\.nt-ad-shifted\s*,\s*html\.nt-ads-entering #nt-shell\s*\{/.test(layout)) {
  fail('do not transform #nt-shell — it traps map/feedback/about/privacy');
}
if (!/html\.nt-ads-cloaked #main-content\.app-shell[\s\S]*transform:\s*none\s*!important/.test(layout)
  && !/body\.modal-active #main-content\.app-shell[\s\S]*transform:\s*none\s*!important/.test(layout)) {
  fail('cloaked/modal board must set transform:none');
}
if (!layout.includes('height: 100dvh') || !layout.includes('#nt-shell [id$="-modal"].fixed')) {
  fail('fixed overlays inside #nt-shell must be viewport-sized (100dvh)');
}
if (/body\.modal-active\s*\{[^}]*touch-action:\s*none/.test(layout)) {
  fail('body.modal-active must not set touch-action:none (blocks pan inside Dev Hub / nested modals)');
}
if (!layout.includes('#dev-modal') || !layout.includes('touch-action: pan-y')) {
  fail('Dev Hub / fixed modals must allow touch-action: pan-y');
}

if (!ads.includes('__ntCleverVendorInject')) fail('clever-ads.js must call the vendor IIFE, not a restyled host DIV');
if (!ads.includes('--nt-ad-shift')) fail('clever-ads.js must drive --nt-ad-shift on #nt-shell');
if (!ads.includes('beginOverlayEntrance')) fail('overlay fill must hide the unit, ease the shell, then reveal');
if (!ads.includes('nt-ads-entering')) fail('entrance cloak class missing from clever-ads.js');
if (!layout.includes('html.nt-ads-entering')) fail('Layout must hide the unit during shell entrance');
if (!ads.includes('afterPaint')) fail('ad motion must paint the from-state before easing');
if (!ads.includes('userSawEmptyBoard')) fail('do not animate until the commuter has seen the empty board');
if (!ads.includes('const targetShift = inFlowH > 0 ? 0 : overlayH')) {
  fail('in-flow ads must not double-push with a lasting overlay shift');
}
if (!ads.includes('playInFlowFlip(-inFlowDelta)')) fail('in-flow fill/dismiss must invert with FLIP');
if (!ads.includes('ResizeObserver')) fail('must watch overlay size so dismiss eases the board back');
if (ads.includes('setAdPadding(true)')) fail('must not reserve an empty ad gap via padding');
if (!layout.includes('transform: translateY(calc(var(--nt-ad-shift) + var(--nt-ad-flip)))')) {
  fail('Layout must ease #main-content only (shift + flip)');
}
if (!layout.includes('#nt-shell.nt-ad-shifted #main-content.app-shell')) {
  fail('Layout must apply the board transform only while .nt-ad-shifted (or entering)');
}
if (!ads.includes('nt-ad-shifted')) fail('clever-ads.js must toggle .nt-ad-shifted so rest state has transform:none');
if (!ads.includes('syncNtAdShiftedClass')) fail('clever-ads.js must drop .nt-ad-shifted when shift+flip are 0');
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

{
  const targetShift = (overlayH, inFlowH) => (inFlowH > 0 ? 0 : overlayH);
  const flipInvert = (delta) => -delta;
  if (targetShift(96, 0) !== 96) fail('fixed overlay must shift the shell by H');
  if (targetShift(96, 80) !== 0) fail('in-flow ads must not double-push');
  if (flipInvert(80) !== -80) fail('in-flow fill inverts with -delta');
  if (flipInvert(-80) !== 80) fail('in-flow dismiss inverts with +H');
}

if (failures.length) {
  console.error(`\n✗ clever-ads check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('✓ clever-ads vendor snippet + shell isolation OK');
