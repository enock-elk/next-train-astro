/**
 * Lab builds must not be indexed and must not ship a sitemap.
 * Cloudflare Pages git builds run `npm run build` without the workflow's
 * de-index step, so this postbuild is the source of truth.
 *
 * No-op unless PUBLIC_LAB_MODE=true or PUBLIC_SITE_URL is the lab host.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const labBuild = process.env.PUBLIC_LAB_MODE === 'true'
  || String(process.env.PUBLIC_SITE_URL || '').includes('lab.nexttrain');

if (!labBuild) process.exit(0);
if (!existsSync(DIST)) {
  console.warn('apply-lab-seo: dist/ missing — skip');
  process.exit(0);
}

writeFileSync(
  join(DIST, 'robots.txt'),
  'User-agent: *\nDisallow: /\n',
  'utf8'
);

const sitemapPath = join(DIST, 'sitemap.xml');
if (existsSync(sitemapPath)) rmSync(sitemapPath);

const headersPath = join(DIST, '_headers');
const robotsHeader = '\n/*\n  X-Robots-Tag: noindex, nofollow\n';
if (existsSync(headersPath)) {
  const current = readFileSync(headersPath, 'utf8');
  if (!current.includes('X-Robots-Tag')) {
    writeFileSync(headersPath, `${current.trimEnd()}\n${robotsHeader}`, 'utf8');
  }
} else {
  writeFileSync(headersPath, robotsHeader.trimStart(), 'utf8');
}

const tag = '<meta name="robots" content="noindex, nofollow">';
const channel = '<meta name="nt-channel" content="lab">';
let htmlCount = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!name.endsWith('.html')) continue;
    let html = readFileSync(p, 'utf8');
    html = html.replace(/<meta name="robots"[^>]*>/g, '');
    if (!html.includes(channel)) {
      html = html.replace('<head>', `<head>${tag}${channel}`);
    } else {
      html = html.replace('<head>', `<head>${tag}`);
    }
    writeFileSync(p, html);
    htmlCount += 1;
  }
}

walk(DIST);
console.log(`apply-lab-seo: noindex ${htmlCount} html files, removed sitemap, robots Disallow`);
