/**
 * Lab must not publish a sitemap and every page must be noindex.
 * Always runs a fixture. Pass --check <dist> to assert a built lab output.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyLabSeo } from './apply-lab-seo.mjs';
import { isLabSeoBuild } from './lab-host.mjs';

function fail(message) {
  console.error(`verify-lab-seo: ${message}`);
  process.exit(1);
}

function assertLabDist(dist) {
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (/sitemap/i.test(name) && name.toLowerCase().endsWith('.xml')) {
        fail(`sitemap file remained: ${p}`);
      }
      if (!name.endsWith('.html')) continue;
      const html = readFileSync(p, 'utf8');
      if (!html.includes('<meta name="robots" content="noindex, nofollow">')) fail(`${p} missing robots noindex`);
      if (!html.includes('<meta name="googlebot" content="noindex, nofollow">')) fail(`${p} missing googlebot noindex`);
      if (/content=["']index,\s*follow["']/i.test(html)) fail(`${p} is still index, follow`);
      if (/<link[^>]*sitemap/i.test(html)) fail(`${p} still links a sitemap`);
    }
  }
  if (!existsSync(dist)) fail(`missing ${dist}`);
  walk(dist);
  const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');
  if (!robots.includes('Disallow: /') || /^\s*Sitemap:/im.test(robots)) {
    fail('robots.txt allows crawling or names a sitemap');
  }
  const headers = readFileSync(join(dist, '_headers'), 'utf8');
  if (!headers.includes('X-Robots-Tag: noindex, nofollow')) fail('_headers missing X-Robots-Tag');
  if (/\/sitemap\.xml\n(?:  .+\n)*  Cache-Control: public/.test(headers)) {
    fail('sitemap.xml is still publicly cached');
  }
}

function runFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lab-seo-'));
  try {
    mkdirSync(join(dir, 'routes'));
    writeFileSync(join(dir, 'sitemap.xml'), '<urlset><loc>https://lab.nexttrain.co.za/</loc></urlset>');
    writeFileSync(join(dir, 'routes', 'sitemap-index.xml'), '<sitemapindex></sitemapindex>');
    writeFileSync(join(dir, 'index.html'), [
      '<!DOCTYPE html><html><head>',
      '<meta name="robots" content="index, follow">',
      '<link rel="sitemap" href="/sitemap.xml">',
      '</head><body>Lab</body></html>',
    ].join(''));
    writeFileSync(join(dir, 'routes', 'cape-town.html'), '<!DOCTYPE html><html><head><meta name="robots" content="index,follow"></head><body></body></html>');
    writeFileSync(join(dir, '_headers'), [
      '/sitemap.xml',
      '  Content-Type: application/xml; charset=utf-8',
      '  Cache-Control: public, max-age=3600',
      '',
      '/robots.txt',
      '  Cache-Control: public, max-age=3600',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://lab.nexttrain.co.za/sitemap.xml\n');
    const count = applyLabSeo(dir);
    if (count !== 2) fail(`fixture stamped ${count} html files, expected 2`);
    applyLabSeo(dir);
    assertLabDist(dir);
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const robotsTags = html.match(/<meta name="robots"/g) || [];
    if (robotsTags.length !== 1) fail('second pass duplicated the robots meta');
    const headerTags = (readFileSync(join(dir, '_headers'), 'utf8').match(/X-Robots-Tag: noindex, nofollow/g) || []);
    if (headerTags.length !== 2) fail(`expected one site header and one sitemap header, got ${headerTags.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!isLabSeoBuild({ PUBLIC_LAB_MODE: 'true' })) fail('lab mode was not detected');
if (isLabSeoBuild({ PUBLIC_SITE_URL: 'https://nexttrain.co.za' })) fail('production host was treated as lab');
if (!isLabSeoBuild({ CF_PAGES_BRANCH: 'lab' })) fail('Cloudflare Pages lab branch was not detected');
if (!isLabSeoBuild({ GITHUB_REF_NAME: 'lab' })) fail('GitHub lab ref was not detected');

runFixture();

const checkAt = process.argv.indexOf('--check');
if (checkAt !== -1) {
  const dist = process.argv[checkAt + 1];
  if (!dist) fail('--check needs a dist directory');
  assertLabDist(dist);
  console.log(`verify-lab-seo: ${dist} is noindex and has no sitemap`);
}

console.log('verify-lab-seo: ok');
