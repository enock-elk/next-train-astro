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

if (process.env.PUBLIC_LAB_MODE === 'true'
  || String(process.env.PUBLIC_SITE_URL || '').includes('lab.nexttrain')) {
  console.log('verify-url-parity: skipped on lab (noindex, no sitemap)');
  process.exit(0);
}

/** Public indexable pages (must match public/sitemap.xml core set). */
const INDEXABLE = ['index.html', 'guide.html', 'map.html', 'routes.html'];
/** Must exist but must never be indexed (private / system). */
const NOINDEX = ['offline.html', 'help.html', '404.html', 'status.html', 'marketing.html'];
/** Legacy corridors that must keep stable slugs after SEO expansion. */
const STABLE_ROUTE_SLUGS = [
  'routes/pretoria-to-pienaarspoort.html',
  'routes/pretoria-to-kempton-park.html',
  'routes/pretoria-to-mabopane.html',
  'routes/cape-town-to-bellville.html',
  'routes/durban-to-umlazi.html',
];

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

const routeLandings = htmlFiles.filter((f) => f.startsWith('routes/') && f !== 'routes.html');
const regionLandings = htmlFiles.filter((f) => f.startsWith('regions/'));
const corridorLandings = htmlFiles.filter((f) => f.startsWith('corridors/'));
if (routeLandings.length < 30) {
  fail(`expected SSG route landings for ~all active corridors (≥30), found ${routeLandings.length}`);
}
if (regionLandings.length < 4) {
  fail(`expected ≥4 regional SEO pages, found ${regionLandings.length}`);
}
if (corridorLandings.length < 8) {
  fail(`expected ≥8 corridor SEO pages (Central/Northern/etc), found ${corridorLandings.length}`);
}
for (const file of STABLE_ROUTE_SLUGS) {
  if (!existsSync(join(DIST, file))) fail(`stable SEO slug missing: /${file}`);
}

const seoLandings = [...routeLandings, ...regionLandings, ...corridorLandings];
const known = new Set([...INDEXABLE, ...NOINDEX, ...seoLandings]);
const unexpected = htmlFiles.filter((f) => !known.has(f));
if (unexpected.length) notes.push(`extra HTML pages not in parity lists: ${unexpected.join(', ')}`);

const isIndexableSeo = (file) =>
  INDEXABLE.includes(file) ||
  file.startsWith('routes/') ||
  file.startsWith('regions/') ||
  file.startsWith('corridors/');

// 3. Canonicals must be self-referencing against the production origin, or Google
//    consolidates onto a URL that is not the one it has indexed.
for (const file of [...INDEXABLE, ...NOINDEX, ...seoLandings]) {
  const path = join(DIST, file);
  if (!existsSync(path)) continue;
  const html = readFileSync(path, 'utf8');

  // Static lifeboat (public/help.html) is intentionally bare — no Astro layout/canonical.
  if (file !== 'help.html') {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    const expected = file === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${file}`;
    if (!canonical) fail(`/${file} has no canonical tag`);
    else if (canonical !== expected) fail(`/${file} canonical is ${canonical}, want ${expected}`);
  }

  const robots = html.match(/<meta name="robots" content="([^"]+)"/)?.[1] || '';
  if (NOINDEX.includes(file) && !robots.includes('noindex')) {
    fail(`/${file} is a private/system page but is not noindex`);
  }
  if (isIndexableSeo(file) && robots.includes('noindex')) {
    fail(`/${file} should be indexable but is marked noindex`);
  }
}

// 4. Sitemap must list public pages + every SEO landing, omit private docs.
const sitemapPath = join(DIST, 'sitemap.xml');
if (!existsSync(sitemapPath)) {
  fail('sitemap.xml not emitted');
} else {
  const sitemap = readFileSync(sitemapPath, 'utf8');
  for (const file of INDEXABLE) {
    const loc = file === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${file}`;
    if (!sitemap.includes(`<loc>${loc}</loc>`)) fail(`sitemap.xml missing ${loc}`);
  }
  for (const file of seoLandings) {
    const loc = `${ORIGIN}/${file}`;
    if (!sitemap.includes(`<loc>${loc}</loc>`)) fail(`sitemap.xml missing SEO landing ${loc}`);
  }
  for (const file of NOINDEX) {
    if (file === '404.html' || file === 'offline.html' || file === 'help.html') continue;
    const loc = `${ORIGIN}/${file}`;
    if (sitemap.includes(loc)) fail(`sitemap.xml must not list private page ${loc}`);
  }
}

// 5. Manifest must match the live SPA identity so existing installs upgrade in place.
const manifestPath = join(DIST, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('manifest.json not emitted (SPA filename — not .webmanifest)');
} else {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (m.name !== 'Metrorail Next Train') fail(`manifest name is "${m.name}", want "Metrorail Next Train"`);
  if (m.short_name !== 'Next Train') fail(`manifest short_name is "${m.short_name}", want "Next Train"`);
  if (m.id !== '/' && m.id !== './') fail(`manifest id is "${m.id}", want "/" (SPA "./")`);
  if (m.start_url !== '/' && m.start_url !== './') fail(`manifest start_url is "${m.start_url}", want "/"`);
  if (m.background_color !== '#1d4ed8') fail(`manifest background_color is ${m.background_color}, want #1d4ed8`);
  if (m.orientation !== 'portrait') fail(`manifest orientation is ${m.orientation}, want portrait`);
  if (m.icons?.some((i) => i.purpose === 'maskable')) {
    fail('manifest declares a maskable icon — Android will re-crop every existing install');
  }
  const has512 = m.icons?.some((i) => i.sizes === '512x512' && String(i.src).endsWith('loading-logo.png'));
  if (!has512) fail('manifest 512 icon must be icons/loading-logo.png to match existing installs');
  if (!Array.isArray(m.shortcuts) || m.shortcuts.length < 2) {
    fail('manifest missing SPA shortcuts (Trip Planner + Network Map)');
  }
  if (!m.shortcuts.every((s) => s.icons?.every((i) => i.type === 'image/png'))) {
    fail('manifest shortcut icons must declare type image/png');
  }
  const shots = Array.isArray(m.screenshots) ? m.screenshots : [];
  if (shots.length < 2) {
    fail('manifest needs at least 2 screenshots (narrow + wide) for store packaging');
  }
  const hasNarrow = shots.some((s) => s.form_factor === 'narrow');
  const hasWide = shots.some((s) => s.form_factor === 'wide');
  if (!hasNarrow || !hasWide) {
    fail('manifest screenshots must include form_factor narrow and wide');
  }
  for (const s of shots) {
    const rel = String(s.src || '').replace(/^\//, '');
    if (!rel || !existsSync(join(DIST, rel))) {
      fail(`manifest screenshot missing from dist: ${s.src}`);
    }
  }
  if (m.prefer_related_applications !== false) {
    fail('manifest prefer_related_applications must be false until a Play package exists');
  }
  if (!Array.isArray(m.display_override) || !m.display_override.includes('standalone')) {
    fail('manifest display_override must include standalone');
  }
  const launchMode = m.launch_handler?.client_mode;
  const launchOk = launchMode === 'focus-existing'
    || (Array.isArray(launchMode) && launchMode.includes('focus-existing'));
  if (!launchOk) {
    fail('manifest launch_handler.client_mode must be focus-existing');
  }
  const st = m.share_target;
  if (!st || st.method !== 'GET' || !st.params?.text || !st.params?.url) {
    fail('manifest share_target must be GET with text + url params for OS share sheet → planner');
  }
}

// 6. Built HTML must link the same manifest filename we emit.
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!indexHtml.includes('rel="manifest"') || !indexHtml.includes('manifest.json')) {
  fail('index.html must <link rel="manifest" href="…manifest.json">');
}
if (indexHtml.includes('manifest.webmanifest')) {
  fail('index.html still links manifest.webmanifest — breaks install after rename to manifest.json');
}
if (!indexHtml.includes('apple-mobile-web-app-title" content="Next Train"')) {
  fail('iOS home-screen title must be "Next Train" (not Train 2.0)');
}
// PWABuilder HTML-parses for a static register() call; keep it in the shell.
if (!indexHtml.includes('serviceWorker.register')) {
  fail('index.html must contain a static serviceWorker.register(...) for PWABuilder detection');
}

// 7. Precache must use canonical .html URLs (build.format: 'file').
const swPath = join(DIST, 'sw.js');
if (!existsSync(swPath)) {
  fail('sw.js not emitted — PWA integration did not run');
} else {
  const sw = readFileSync(swPath, 'utf8');
  for (const page of ['guide.html', 'map.html', 'offline.html', 'help.html', 'routes.html']) {
    if (!sw.includes(`"${page}"`) && !sw.includes(`'${page}'`)) {
      fail(`sw.js precache missing ${page} — offline cold open will fail`);
    }
  }
  // Extension-less page keys are the old bug (precache /guide, request /guide.html).
  if (/"url":"guide"/.test(sw) || /\{url:"guide"/.test(sw) || /\{url:\\"guide\\"/.test(sw)) {
    fail('sw.js still precaches extension-less "guide" — want guide.html');
  }
  if (sw.includes('marketing.html') || sw.includes('"marketing"')) {
    fail('sw.js must not precache private marketing.html');
  }
  if (sw.includes('status.html') && /precacheAndRoute|precach/.test(sw)) {
    // status may appear in comments; only fail if it's a precache url entry
    if (/\{url:\\?"status(\.html)?\\?"/.test(sw)) {
      fail('sw.js must not precache private status.html');
    }
  }
  // Navigate precacheFallback is the self-contained lifeboat (public/help.html)
  if (!sw.includes('help.html')) {
    fail('sw.js must reference help.html as navigate fallback / lifeboat');
  }
  if (/\{url:\\?"js\/admin\.js\\?"/.test(sw) || sw.includes('url:"js/admin.js"') || sw.includes('url:"/js/admin.js"')) {
    fail('sw.js must not precache js/admin.js — admin is lazy-loaded on unlock only');
  }
}

for (const note of notes) console.log(`  note: ${note}`);

if (failures.length) {
  console.error(`\n✗ URL parity check failed (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `\n✓ URL parity OK — ${INDEXABLE.length} core + ${regionLandings.length} regions + ${corridorLandings.length} corridors + ${routeLandings.length} routes + ${NOINDEX.length} system pages + SPA identity/precache match.`
);
