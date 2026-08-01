/**
 * Asserts that a production build reproduces the live SPA's URL surface exactly.
 *
 * The cutover plan is that nexttrain.co.za swaps from metrorail-app (vanilla SPA)
 * to this Astro build without users or Google noticing. That only holds if every
 * indexed URL still resolves to the same address. A single flip of
 * astro.config.mjs build.format silently turns /guide.html into /guide/ and drops
 * ~50k quarterly organic clicks' worth of indexed URLs, so it is checked here
 * rather than remembered.
 *
 * Usage: node scripts/verify-url-parity.mjs [distDir]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] || 'dist';
const ORIGIN = 'https://nexttrain.co.za';

/** Indexable pages, mirroring metrorail-app/sitemap.xml. */
const INDEXABLE = ['index.html', 'guide.html', 'map.html', 'status.html', 'marketing.html'];
/** System pages that must exist but must never be indexed. */
const NOINDEX = ['offline.html', '404.html'];

const failures = [];
const notes = [];

const fail = (msg) => failures.push(msg);

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST}/ not found — run the build first.`);
  process.exit(1);
}

// 1. Every expected page exists at the exact path Google has indexed.
for (const file of [...INDEXABLE, ...NOINDEX]) {
  if (!existsSync(join(DIST, file))) fail(`missing page: /${file}`);
}

// 2. No page was emitted in directory form. This is the regression that breaks
//    the URL contract, and it is invisible unless you list the tree.
const htmlFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.html')) htmlFiles.push(relative(DIST, full).replace(/\\/g, '/'));
  }
};
walk(DIST);

for (const rel of htmlFiles) {
  if (rel.includes('/') && rel.endsWith('/index.html')) {
    const clean = rel.replace(/\/index\.html$/, '');
    fail(`page emitted in directory form: /${rel} (want /${clean}.html) — check build.format`);
  }
}

const unexpected = htmlFiles.filter((f) => ![...INDEXABLE, ...NOINDEX].includes(f));
if (unexpected.length) notes.push(`extra pages not in the live sitemap: ${unexpected.join(', ')}`);

// 3. Canonicals must be self-referencing against the production origin, or Google
//    consolidates onto a URL that is not the one it has indexed.
for (const file of [...INDEXABLE, ...NOINDEX]) {
  const path = join(DIST, file);
  if (!existsSync(path)) continue;
  const html = readFileSync(path, 'utf8');

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  const expected = file === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${file}`;
  if (!canonical) fail(`/${file} has no canonical tag`);
  else if (canonical !== expected) fail(`/${file} canonical is ${canonical}, want ${expected}`);

  const robots = html.match(/<meta name="robots" content="([^"]+)"/)?.[1] || '';
  if (NOINDEX.includes(file) && !robots.includes('noindex')) {
    fail(`/${file} is a system page but is not noindex`);
  }
  if (INDEXABLE.includes(file) && robots.includes('noindex')) {
    fail(`/${file} should be indexable but is marked noindex`);
  }
}

// 4. Manifest fields that change the installed app's appearance. Drift here is
//    what makes an existing install visibly "become a different app".
const manifestPath = join(DIST, 'manifest.webmanifest');
if (!existsSync(manifestPath)) {
  fail('manifest.webmanifest not emitted');
} else {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (m.background_color !== '#1d4ed8') fail(`manifest background_color is ${m.background_color}, want #1d4ed8`);
  if (m.orientation !== 'portrait') fail(`manifest orientation is ${m.orientation}, want portrait`);
  if (m.icons?.some((i) => i.purpose === 'maskable')) {
    fail('manifest declares a maskable icon — Android will re-crop every existing install');
  }
  const has512 = m.icons?.some((i) => i.sizes === '512x512' && i.src.endsWith('loading-logo.png'));
  if (!has512) fail('manifest 512 icon must be icons/loading-logo.png to match existing installs');

  // Identity fields are still deliberately distinct so the PWA can be installed
  // beside the live SPA. Surfaced as a reminder, not a failure.
  if (m.name !== 'Metrorail Next Train' || m.short_name !== 'Next Train') {
    notes.push(`manifest identity still in side-by-side mode (name="${m.name}", short_name="${m.short_name}") — revert before cutover`);
  }
  if (m.start_url !== '/' || m.id !== '/') {
    notes.push(`manifest start_url/id still "${m.start_url}" — the SPA uses "./"; revert before cutover`);
  }
}

if (!existsSync(join(DIST, 'sw.js'))) fail('sw.js not emitted — PWA integration did not run');

for (const note of notes) console.log(`  note: ${note}`);

if (failures.length) {
  console.error(`\n✗ URL parity check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\n✓ URL parity OK — ${INDEXABLE.length} indexable + ${NOINDEX.length} system pages match metrorail-app.`);
