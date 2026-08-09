import { dayLabel, stationLabel } from './parse.js';

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

export function buildRouteOgMeta(route, intent, site) {
  const origin = stationLabel(intent.dir === 'B' ? route.destB : route.destA);
  const dest = stationLabel(intent.dir === 'B' ? route.destA : route.destB);
  const day = dayLabel(intent.day);
  const title = `${origin} → ${dest} · ${day} timetable | Metrorail Next Train`;
  const description =
    'Open live boards, full grid & fares in Next Train — free, works offline.';
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
    image: img.toString(),
  };
}

export function buildPlannerOgMeta(intent, site) {
  const from = stationLabel(intent.from);
  const to = stationLabel(intent.to);
  const timeBit = intent.time ? ` · depart ${intent.time}` : '';
  const title = `Trip: ${from} → ${to}${timeBit} | Metrorail Next Train`;
  const description = 'Open this plan in Metrorail Next Train — live times, connections & fares.';
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
    image: img.toString(),
  };
}

export function renderOgHtml({
  title,
  description,
  url,
  image,
  appUrl,
  siteName = 'Metrorail Next Train',
}) {
  const openUrl = appUrl || url;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="${esc(siteName)}"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:url" content="${esc(url)}"/>
<meta property="og:image" content="${esc(image)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${esc(image)}"/>
<link rel="canonical" href="${esc(url)}"/>
<meta http-equiv="refresh" content="0;url=${esc(openUrl)}"/>
</head>
<body>
<p><a href="${esc(openUrl)}">${esc(title)}</a></p>
<p>${esc(description)}</p>
</body>
</html>`;
}
