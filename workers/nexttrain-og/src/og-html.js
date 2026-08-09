import { dayLabel, stationLabel } from './parse.js';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH } from './og-size.js';

/** Bump when OG art/meta changes so WhatsApp/Facebook re-fetch the image. */
const OG_IMAGE_CACHE_BUST = 'wa6';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dayCode(day) {
  if (day === 'saturday') return 'sa';
  if (day === 'sunday') return 'su';
  return 'wd';
}

/** App deep-link humans should land on after the OG stub. */
export function buildAppDeepLink(intent, site) {
  const app = new URL('/', site);
  if (intent.kind === 'planner') {
    app.searchParams.set('plan', `${intent.from}~${intent.to}`);
    if (intent.time) app.searchParams.set('t', intent.time);
    if (intent.day) app.searchParams.set('d', dayCode(intent.day));
    if (intent.region) app.searchParams.set('r', intent.region);
    return app.toString();
  }
  app.searchParams.set('rt', intent.routeId);
  app.searchParams.set('v', intent.view === 'fares' ? 'f' : 'g');
  if (intent.dir === 'B') app.searchParams.set('dir', 'B');
  app.searchParams.set('d', dayCode(intent.day));
  return app.toString();
}

/** Canonical share URL for crawlers (must stay on /og/* so SPA canonical cannot steal it). */
export function buildOgShareLink(intent, site) {
  const share = new URL('/og/share', site);
  if (intent.kind === 'planner') {
    share.searchParams.set('plan', `${intent.from}~${intent.to}`);
    if (intent.time) share.searchParams.set('t', intent.time);
    if (intent.day) share.searchParams.set('d', dayCode(intent.day));
    if (intent.region) share.searchParams.set('r', intent.region);
    return share.toString();
  }
  share.searchParams.set('rt', intent.routeId);
  share.searchParams.set('v', intent.view === 'fares' ? 'f' : 'g');
  if (intent.dir === 'B') share.searchParams.set('dir', 'B');
  share.searchParams.set('d', dayCode(intent.day));
  return share.toString();
}

function withImageCacheBust(imgUrl) {
  const img = new URL(imgUrl);
  img.searchParams.set('v', OG_IMAGE_CACHE_BUST);
  return img.toString();
}

export function buildRouteOgMeta(route, intent, site) {
  const origin = stationLabel(intent.dir === 'B' ? route.destB : route.destA);
  const dest = stationLabel(intent.dir === 'B' ? route.destA : route.destB);
  const day = dayLabel(intent.day);
  // Keep title short — WhatsApp truncates aggressively in the compact card.
  const title = `${origin} → ${dest} · ${day}`;
  const description =
    'Live Metrorail boards, full grid & fares in Next Train — free, works offline.';
  const d = dayCode(intent.day);
  const img = new URL('/og/timetable.png', site);
  img.searchParams.set('rt', route.id);
  img.searchParams.set('dir', intent.dir);
  img.searchParams.set('d', d);
  return {
    title,
    description,
    url: buildOgShareLink({ ...intent, routeId: route.id, kind: 'route' }, site),
    appUrl: buildAppDeepLink({ ...intent, routeId: route.id, kind: 'route' }, site),
    image: withImageCacheBust(img.toString()),
    imageAlt: `${origin} to ${dest} ${day} timetable`,
  };
}

export function buildPlannerOgMeta(intent, site) {
  const from = stationLabel(intent.from);
  const to = stationLabel(intent.to);
  const timeBit = intent.time ? ` · ${intent.time}` : '';
  const title = `${from} → ${to}${timeBit}`;
  const description = 'Open this trip in Metrorail Next Train — live times, connections & fares.';
  const img = new URL('/og/plan.png', site);
  img.searchParams.set('from', intent.from);
  img.searchParams.set('to', intent.to);
  if (intent.time) img.searchParams.set('t', intent.time);
  if (intent.day) img.searchParams.set('d', dayCode(intent.day));
  if (intent.region) img.searchParams.set('r', intent.region);
  return {
    title,
    description,
    url: buildOgShareLink(intent, site),
    appUrl: buildAppDeepLink(intent, site),
    image: withImageCacheBust(img.toString()),
    imageAlt: `Trip plan ${from} to ${to}`,
  };
}

export function renderOgHtml({
  title,
  description,
  url,
  image,
  imageAlt,
  appUrl,
  siteName = 'Metrorail Next Train',
}) {
  const openUrl = appUrl || url;
  const alt = imageAlt || title;
  // IMPORTANT: Do NOT use <meta http-equiv="refresh"> — Facebook follows it,
  // then scrapes the SPA homepage and replaces our OG tags with the train icon.
  // Humans get a JS redirect + visible link instead (crawlers rarely run JS).
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(title)} | ${esc(siteName)}</title>
<meta name="description" content="${esc(description)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="${esc(siteName)}"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:url" content="${esc(url)}"/>
<meta property="og:image" content="${esc(image)}"/>
<meta property="og:image:secure_url" content="${esc(image)}"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}"/>
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}"/>
<meta property="og:image:alt" content="${esc(alt)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${esc(image)}"/>
<meta name="twitter:image:alt" content="${esc(alt)}"/>
<link rel="canonical" href="${esc(url)}"/>
</head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.45">
<h1 style="font-size:1.25rem">${esc(title)}</h1>
<p>${esc(description)}</p>
<p><a href="${esc(openUrl)}" style="display:inline-block;background:#1d4ed8;color:#fff;font-weight:700;padding:0.75rem 1.25rem;border-radius:0.75rem;text-decoration:none">Open in Next Train</a></p>
<script>
(function () {
  var bots = /facebookexternalhit|Facebot|FacebookBot|meta-externalagent|meta-externalfetcher|WhatsApp|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot/i;
  if (!bots.test(navigator.userAgent || '')) {
    location.replace(${JSON.stringify(openUrl)});
  }
})();
</script>
</body>
</html>`;
}
