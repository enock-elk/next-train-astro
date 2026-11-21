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
import { isSocialCrawler, parseShareIntent, parseLiveSharePath, parseLiveTrainImagePath, parseAlertSharePath, parseCommunitySharePath, dayLabel, stationLabel, decodeDay } from './parse.js';
import { buildRouteOgMeta, buildPlannerOgMeta, buildLiveTrainOgMeta, buildContentOgMeta, renderOgHtml, buildAppDeepLink } from './og-html.js';
import { extractGridPreview, loadRegionDb, loadRegionGridOrder } from './schedule.js';
import { timetablePng, plannerPng, liveTrainPng, buildTimetableSvg, buildPlannerSvg, buildLiveTrainSvg } from './og-images.js';

function siteBase(env, requestUrl) {
  return String(env.PUBLIC_SITE || `${requestUrl.protocol}//${requestUrl.host}`).replace(/\/$/, '');
}

function isOgSharePath(pathname) {
  if (pathname === '/og/share' || pathname.endsWith('/og/share')) return true;
  if (parseAlertSharePath(pathname) || parseCommunitySharePath(pathname)) return true;
  return !!parseLiveSharePath(pathname);
}

function plainBits(html, max = 180) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function imageTypeForPath(path) {
  if (/\.gif$/i.test(path)) return 'image/gif';
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/jpeg';
}

function safePreviewImage(raw, site) {
  const text = String(raw || '').trim();
  if (text.startsWith('/') && !text.startsWith('//')) {
    const pathOnly = text.split('?')[0];
    if (!/^\/(?:images|icons)\//.test(pathOnly)) return '';
    if (/\.pdf$/i.test(pathOnly) || !/\.(jpe?g|png|gif|webp)$/i.test(pathOnly)) return '';
    const base = String(site || 'https://nexttrain.co.za').replace(/\/$/, '');
    return { href: `${base}${pathOnly}`, imageType: imageTypeForPath(pathOnly) };
  }
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const allowed = host === 'nexttrain.co.za'
      || host.endsWith('.nexttrain.co.za')
      || host === 'nexttrain-community.enock.workers.dev'
      || host === 'firebasestorage.googleapis.com'
      || host === 'storage.googleapis.com'
      || host.endsWith('.firebasestorage.app')
      || host.endsWith('.googleusercontent.com');
    if (!allowed) return '';
    const path = decodeURIComponent(u.pathname || '');
    if (/\.pdf($|\?)/i.test(path)) return '';
    if (!/\.(jpe?g|png|gif|webp)$/i.test(path) && !/google|firebasestorage/.test(host)) return '';
    return { href: u.href, imageType: imageTypeForPath(path) };
  } catch {
    return '';
  }
}

function previewImages(node, site) {
  const list = Array.isArray(node?.imageUrls) ? node.imageUrls : [];
  const candidates = list.slice();
  if (node?.imageUrl) candidates.push(node.imageUrl);
  const attachments = Array.isArray(node?.attachments) ? node.attachments : [];
  attachments.forEach((item) => candidates.push(item?.url || item));
  const html = String(node?.message || node?.text || node?.body || '');
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html))) candidates.push(match[1]);
  const out = [];
  const seen = new Set();
  for (const raw of candidates) {
    const image = safePreviewImage(raw, site);
    if (!image || seen.has(image.href)) continue;
    seen.add(image.href);
    out.push(image);
    if (out.length >= 10) break;
  }
  return out;
}

function pickedImage(node, site, photo) {
  const images = previewImages(node, site);
  const index = Number(photo) || 0;
  if (index >= 1 && images[index - 1]) return images[index - 1];
  return images[0] || null;
}

async function readRtdb(env, path) {
  const base = String(env.SCHEDULE_BASE || 'https://metrorail-next-train-default-rtdb.firebaseio.com/').replace(/\/?$/, '/');
  const res = await fetch(`${base}${path}.json`);
  if (!res.ok) return null;
  return res.json();
}

async function loadContentPreview(env, intent) {
  const site = siteBase(env, new URL(String(env.PUBLIC_SITE || 'https://nexttrain.co.za')));
  if (intent.kind === 'alert') {
    const source = intent.source || 'all';
    const node = await readRtdb(env, `notices/${encodeURIComponent(source)}/${encodeURIComponent(intent.id)}`);
    if (!node || typeof node !== 'object' || node.deleted || node.hidden) {
      return { title: 'Service update', description: 'This update is no longer available.' };
    }
    const exp = Number(node.expiresAt || 0);
    if (exp && exp <= Date.now()) {
      return { title: 'Service update', description: 'This update is no longer available.' };
    }
    const title = plainBits(node.title, 80) || 'Service update';
    const description = plainBits(node.message || node.text, 180) || 'Open this update in Next Train.';
    const image = pickedImage(node, site, intent.photo);
    const photo = Number(intent.photo) || 0;
    const photoNote = photo >= 1 ? `Photo ${photo}` : '';
    return {
      title,
      description: photoNote && description ? `${photoNote}. ${description}` : (photoNote || description),
      image: image?.href || '',
      imageType: image?.imageType || 'image/png',
    };
  }
  const node = await readRtdb(env, `route_community/${encodeURIComponent(intent.routeId)}/posts/${encodeURIComponent(intent.postId)}`);
  if (!node || typeof node !== 'object' || node.deleted || node.hidden || node.removed) {
    return { title: 'Community message', description: 'This message is no longer available.' };
  }
  const description = plainBits(node.body, 180) || 'Open this message in Next Train.';
  const image = pickedImage(node, site, 0);
  const rawName = plainBits(node.displayName || node.fromName || '', 60);
  const name = rawName && !/^(you|passenger)$/i.test(rawName) ? rawName : '';
  return {
    title: name || 'Community message',
    description,
    image: image?.href || '',
    imageType: image?.imageType || 'image/png',
  };
}

function ogHtmlHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    // Crawlers and humans share this URL. Never let CF cache a 302 for WhatsApp
    // or a timetable stub for ?live= (query-key and UA mixing both bit us).
    'Cache-Control': 'private, no-store, no-cache, max-age=0',
    'CDN-Cache-Control': 'no-store',
    Vary: 'User-Agent',
  };
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
    ? stationLabel(dir === 'B' ? route.destA : route.destB)
    : 'Metrorail';
  const dest = route
    ? stationLabel(dir === 'B' ? route.destB : route.destA)
    : 'Next Train';

  let grid = null;
  if (route) {
    try {
      const [db, runtimeConfig] = await Promise.all([
        loadRegionDb(env, route.region, ctx),
        loadRegionGridOrder(env, route.region, ctx),
      ]);
      // Full sheet (all trains × stations) for a dense WhatsApp preview.
      grid = extractGridPreview(db, route, dir, day, 0, 0, { runtimeConfig });
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

async function handleOgLive(url) {
  const pathLive = parseLiveTrainImagePath(url.pathname);
  const trainId = pathLive?.trainId
    || url.searchParams.get('train')
    || url.searchParams.get('live')
    || 'Train';
  const dest = stationLabel(pathLive?.dest || url.searchParams.get('to') || '');
  const wantSvg = url.searchParams.get('format') === 'svg';
  const opts = { trainId, dest };
  if (wantSvg) return svgResponse(buildLiveTrainSvg(opts));
  try {
    const png = await liveTrainPng(opts);
    return pngResponse(png);
  } catch (e) {
    console.error('Live train PNG failed', e.message || e);
    try {
      const png = await liveTrainPng({ trainId: String(trainId || 'Train'), dest: dest || '' });
      return pngResponse(png);
    } catch (retryErr) {
      console.error('Live train PNG retry failed', retryErr.message || retryErr);
      return new Response('Live train preview unavailable', { status: 502 });
    }
  }
}

async function handleBotShare(url, env, ctx) {
  const intent = parseShareIntent(url);
  if (!intent) return null;
  const site = siteBase(env, url);

  if (intent.kind === 'alert' || intent.kind === 'community') {
    let detail = {};
    try { detail = await loadContentPreview(env, intent); } catch (e) {
      console.warn('OG content load failed', e.message || e);
      detail = {
        title: intent.kind === 'community' ? 'Community message' : 'Service update',
        description: 'Open this in Next Train.',
      };
    }
    const meta = buildContentOgMeta(intent, site, detail);
    return new Response(renderOgHtml(meta), { headers: ogHtmlHeaders() });
  }

  if (intent.kind === 'live') {
    const meta = buildLiveTrainOgMeta(intent, site);
    return new Response(renderOgHtml(meta), { headers: ogHtmlHeaders() });
  }

  if (intent.kind === 'planner') {
    const meta = buildPlannerOgMeta(intent, site);
    return new Response(renderOgHtml(meta), { headers: ogHtmlHeaders() });
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
        const [db, runtimeConfig] = await Promise.all([
          loadRegionDb(env, route.region, ctx),
          loadRegionGridOrder(env, route.region, ctx),
        ]);
        if (db) grid = extractGridPreview(db, route, intent.dir, intent.day, 0, 0, { runtimeConfig });
      } catch (e) {
        console.warn('OG share grid load failed', e.message || e);
      }
    }
    const meta = buildRouteOgMeta(route, intent, site, grid);
    return new Response(renderOgHtml(meta), { headers: ogHtmlHeaders() });
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleFetch(request, env, ctx);
    } catch (e) {
      console.error('nexttrain-og crash', e && e.stack || e);
      return new Response('OG worker error', { status: 500 });
    }
  },
};

async function handleFetch(request, env, ctx) {
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
    if (url.pathname === '/og/live.png' || url.pathname === '/og/live.svg' || parseLiveTrainImagePath(url.pathname)) {
      if (url.pathname.endsWith('.svg')) url.searchParams.set('format', 'svg');
      return handleOgLive(url);
    }

    // Share links: crawlers get OG HTML. Humans (Facebook/Instagram IAB included)
    // get one HTTP 302 to /?rt=… — JS location.replace in IAB is often stolen by
    // Android App Links and opens the PWA at start_url with no query.
    if (isOgSharePath(url.pathname)) {
      const intent = parseShareIntent(url);
      if (!intent) {
        return new Response('Missing rt=, plan=, or live= share params', { status: 400 });
      }
      const uaShare = request.headers.get('user-agent') || '';
      if (!isSocialCrawler(uaShare)) {
        const appUrl = buildAppDeepLink(intent, siteBase(env, url));
        return Response.redirect(appUrl, 302);
      }
      const stub = await handleBotShare(url, env, ctx);
      if (stub) {
        stub.headers.set('X-NextTrain-OG', intent.kind === 'live' ? 'live' : 'share');
        return stub;
      }
      return new Response('Missing rt=, plan=, or live= share params', { status: 400 });
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
}
