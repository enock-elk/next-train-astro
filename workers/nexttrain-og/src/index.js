/**
 * nexttrain-og — WhatsApp / social OG interception + stylized preview images.
 *
 * Bot + ?rt= / ?plan=  → lightweight OG HTML stub
 * /og/timetable.png    → grid-looking PNG
 * /og/plan.png         → planner invite PNG
 * Everyone else        → pass through to Cloudflare DNS origin (GitHub Pages)
 *
 * Do NOT fetch ORIGIN_URL for HTML: github.io/metrorail-app 301s back to
 * nexttrain.co.za (custom domain), which would loop. Same-URL fetch(request)
 * goes to the zone origin and does not re-enter this Worker.
 */
import catalog from './catalog.json';
import { isSocialCrawler, parseShareIntent, dayLabel, stationLabel, decodeDay } from './parse.js';
import { buildRouteOgMeta, buildPlannerOgMeta, renderOgHtml } from './og-html.js';
import { extractGridPreview, loadRegionDb } from './schedule.js';
import { timetablePng, plannerPng, buildTimetableSvg, buildPlannerSvg } from './og-images.js';

function siteBase(env, requestUrl) {
  return String(env.PUBLIC_SITE || `${requestUrl.protocol}//${requestUrl.host}`).replace(/\/$/, '');
}

function pngResponse(bytes, cacheSeconds = 300) {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Response(body, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(body.byteLength),
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function svgResponse(svg, cacheSeconds = 300) {
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/** Pass normal browsers to GitHub Pages via Cloudflare origin (no Worker loop). */
function passToOrigin(request) {
  return fetch(request);
}

async function handleOgTimetable(url, env, ctx) {
  const rt = url.searchParams.get('rt') || url.searchParams.get('route');
  const route = catalog[rt];
  const dir = url.searchParams.get('dir') === 'B' ? 'B' : 'A';
  const day = decodeDay(url.searchParams.get('d') || url.searchParams.get('day') || 'wd');
  const wantSvg = url.searchParams.get('format') === 'svg';

  const origin = route
    ? stationLabel(dir === 'B' ? route.destB : route.destA)
    : 'Metrorail';
  const dest = route
    ? stationLabel(dir === 'B' ? route.destA : route.destB)
    : 'Next Train';

  let grid = null;
  if (route) {
    try {
      const db = await loadRegionDb(env, route.region, ctx);
      // Full sheet (all trains × stations) for a dense WhatsApp preview.
      grid = extractGridPreview(db, route, dir, day);
    } catch (e) {
      console.warn('OG timetable schedule load failed', e.message || e);
    }
  }

  const opts = { origin, dest, day: dayLabel(day), grid };
  if (wantSvg) return svgResponse(buildTimetableSvg(opts));

  try {
    const png = await timetablePng(opts);
    return pngResponse(png);
  } catch (e) {
    console.error('PNG render failed, falling back to SVG', e.message || e);
    return svgResponse(buildTimetableSvg(opts));
  }
}

async function handleOgPlan(url, env) {
  const from = url.searchParams.get('from') || 'Origin';
  const to = url.searchParams.get('to') || 'Destination';
  const time = url.searchParams.get('t') || url.searchParams.get('time') || '';
  const day = decodeDay(url.searchParams.get('d') || url.searchParams.get('day') || '');
  const wantSvg = url.searchParams.get('format') === 'svg';
  const opts = { from, to, time, day: day || null };
  if (wantSvg) return svgResponse(buildPlannerSvg(opts));
  try {
    const png = await plannerPng(opts);
    return pngResponse(png);
  } catch (e) {
    console.error('Planner PNG failed, SVG fallback', e.message || e);
    return svgResponse(buildPlannerSvg(opts));
  }
}

async function handleBotShare(url, env, ctx) {
  const intent = parseShareIntent(url);
  if (!intent) return null;
  const site = siteBase(env, url);

  if (intent.kind === 'planner') {
    const meta = buildPlannerOgMeta(intent, site);
    return new Response(renderOgHtml(meta), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=120, s-maxage=300',
      },
    });
  }

  if (intent.kind === 'route') {
    const route = catalog[intent.routeId] || {
      id: intent.routeId,
      destA: intent.routeId,
      destB: 'Metrorail',
      region: 'GP',
    };
    let grid = null;
    if (catalog[intent.routeId]) {
      try {
        const db = await loadRegionDb(env, route.region, ctx);
        if (db) grid = extractGridPreview(db, route, intent.dir, intent.day);
      } catch (e) {
        console.warn('OG share grid load failed', e.message || e);
      }
    }
    const meta = buildRouteOgMeta(route, intent, site, grid);
    return new Response(renderOgHtml(meta), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=120, s-maxage=300',
      },
    });
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    // Preview images — always available (crawlers + debugger tools)
    if (url.pathname === '/og/timetable.png' || url.pathname === '/og/timetable.svg') {
      if (url.pathname.endsWith('.svg')) url.searchParams.set('format', 'svg');
      return handleOgTimetable(url, env, ctx);
    }
    if (url.pathname === '/og/plan.png' || url.pathname === '/og/plan.svg') {
      if (url.pathname.endsWith('.svg')) url.searchParams.set('format', 'svg');
      return handleOgPlan(url, env);
    }

    // Always-on OG HTML for share links (no UA check). Humans meta-refresh into the app.
    // Stays under /og/* so SPA homepage canonical cannot steal the preview.
    if (url.pathname === '/og/share') {
      const stub = await handleBotShare(url, env, ctx);
      if (stub) {
        stub.headers.set('X-NextTrain-OG', 'share');
        return stub;
      }
      return new Response('Missing rt= or plan= share params', { status: 400 });
    }

    // Social crawlers on legacy deep-link homepage shares (/?rt= / ?plan=)
    const ua = request.headers.get('user-agent') || '';
    if (isSocialCrawler(ua) && (url.pathname === '/' || url.pathname === '')) {
      const stub = await handleBotShare(url, env, ctx);
      if (stub) {
        stub.headers.set('X-NextTrain-OG', 'bot-home');
        return stub;
      }
    }

    // Health / self-test (no secrets)
    if (url.pathname === '/og/health') {
      return Response.json({
        ok: true,
        routes: Object.keys(catalog).length,
        publicSite: env.PUBLIC_SITE || null,
        pagesProject: env.ORIGIN_URL || null,
        passThrough: 'cloudflare-origin',
        sharePath: '/og/share',
      });
    }

    return passToOrigin(request);
  },
};
