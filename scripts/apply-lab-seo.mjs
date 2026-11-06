/**
 * Lab builds must not be indexed and must not ship a sitemap.
 * Cloudflare Pages git builds run `npm run build` without the workflow's
 * de-index step, so this postbuild is the source of truth.
 *
 * No-op unless this is a lab build (see scripts/lab-host.mjs).
 * Throws if a sitemap file remains or any page is still indexable.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLabSeoBuild } from './lab-host.mjs';

const DIST = 'dist';
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const GOOGLEBOT_META = '<meta name="googlebot" content="noindex, nofollow">';
const CHANNEL_META = '<meta name="nt-channel" content="lab">';

export function rewriteLabHeaders(current) {
  let next = String(current || '');
  if (/\/sitemap\.xml\n/.test(next)) {
    next = next.replace(/\/sitemap\.xml\n(?:  .+\n)*/g, [
      '/sitemap.xml',
      '  X-Robots-Tag: noindex, nofollow',
      '  Cache-Control: no-store',
      '',
    ].join('\n'));
  } else {
    next = `${next.trimEnd()}\n\n/sitemap.xml\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n`;
  }
  if (!/\n\/\*\n  X-Robots-Tag: noindex, nofollow\n/.test(`\n${next}`)) {
    next = `${next.trimEnd()}\n\n/*\n  X-Robots-Tag: noindex, nofollow\n`;
  }
  return next.endsWith('\n') ? next : `${next}\n`;
}

function removeSitemaps(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) removeSitemaps(p);
    else if (/sitemap/i.test(name) && name.toLowerCase().endsWith('.xml')) rmSync(p);
  }
}

function findSitemaps(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findSitemaps(p, found);
    else if (/sitemap/i.test(name) && name.toLowerCase().endsWith('.xml')) found.push(p);
  }
  return found;
}

function stampHtml(html) {
  if (!html.includes('<head>')) {
    throw new Error('apply-lab-seo: html file has no <head>');
  }
  let next = html.replace(/<meta[^>]*name=["'](?:robots|googlebot)["'][^>]*>/gi, '');
  next = next.replace(/<link[^>]*rel=["'][^"']*sitemap[^"']*["'][^>]*>/gi, '');
  next = next.replace(/<link[^>]*href=["'][^"']*sitemap\.xml[^"']*["'][^>]*>/gi, '');
  const tags = `${ROBOTS_META}${GOOGLEBOT_META}`;
  const channel = next.includes('name="nt-channel" content="lab"') ? '' : CHANNEL_META;
  next = next.replace('<head>', `<head>${tags}${channel}`);
  if (!next.includes(ROBOTS_META) || !next.includes(GOOGLEBOT_META)) {
    throw new Error('apply-lab-seo: failed to stamp noindex');
  }
  if (/content=["']index,\s*follow["']/i.test(next)) {
    throw new Error('apply-lab-seo: index, follow remained after stamp');
  }
  if (/<link[^>]*sitemap/i.test(next)) {
    throw new Error('apply-lab-seo: sitemap link remained in html');
  }
  return next;
}

/** Stamp dist so lab cannot be indexed and cannot publish a sitemap. */
export function applyLabSeo(dist) {
  writeFileSync(
    join(dist, 'robots.txt'),
    'User-agent: *\nDisallow: /\n\n# Lab is not a public site. No sitemap.\n',
    'utf8'
  );

  removeSitemaps(dist);
  const left = findSitemaps(dist);
  if (left.length) {
    throw new Error(`apply-lab-seo: sitemap still present: ${left.join(', ')}`);
  }

  const headersPath = join(dist, '_headers');
  const currentHeaders = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
  const headers = rewriteLabHeaders(currentHeaders);
  if (!headers.includes('X-Robots-Tag: noindex, nofollow')) {
    throw new Error('apply-lab-seo: X-Robots-Tag missing');
  }
  if (/\/sitemap\.xml\n(?:  .+\n)*  Cache-Control: public/.test(headers)) {
    throw new Error('apply-lab-seo: sitemap is still publicly cached');
  }
  writeFileSync(headersPath, headers, 'utf8');

  let htmlCount = 0;
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith('.html')) continue;
      const stamped = stampHtml(readFileSync(p, 'utf8'));
      writeFileSync(p, stamped);
      htmlCount += 1;
    }
  }
  walk(dist);
  if (htmlCount === 0) throw new Error('apply-lab-seo: no html files to de-index');

  const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');
  if (!robots.includes('Disallow: /') || /^\s*Sitemap:/im.test(robots)) {
    throw new Error('apply-lab-seo: robots.txt still advertises a sitemap or allows the site');
  }
  return htmlCount;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('apply-lab-seo.mjs');
if (invokedDirectly) {
  if (!isLabSeoBuild()) process.exit(0);
  if (!existsSync(DIST)) {
    console.warn('apply-lab-seo: dist/ missing — skip');
    process.exit(0);
  }
  try {
    const htmlCount = applyLabSeo(DIST);
    console.log(`apply-lab-seo: noindex ${htmlCount} html files, removed sitemap, robots Disallow`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
