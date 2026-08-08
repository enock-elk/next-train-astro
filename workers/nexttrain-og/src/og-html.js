import { dayLabel, stationLabel } from './parse.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildRouteOgMeta(route, intent, site) {
  const origin = stationLabel(intent.dir === 'B' ? route.destB : route.destA);
  const dest = stationLabel(intent.dir === 'B' ? route.destA : route.destB);
  const day = dayLabel(intent.day);
  const title = `${origin} → ${dest} · ${day} timetable | Metrorail Next Train`;
  const description =
    'Open live boards, full grid & fares in Next Train — free, works offline.';
  const shareUrl = new URL(site);
  shareUrl.searchParams.set('rt', route.id);
  shareUrl.searchParams.set('v', intent.view === 'fares' ? 'f' : 'g');
  if (intent.dir === 'B') shareUrl.searchParams.set('dir', 'B');
  const d = intent.day === 'saturday' ? 'sa' : intent.day === 'sunday' ? 'su' : 'wd';
  shareUrl.searchParams.set('d', d);
  const img = new URL('/og/timetable.png', site);
  img.searchParams.set('rt', route.id);
  img.searchParams.set('dir', intent.dir);
  img.searchParams.set('d', d);
  return { title, description, url: shareUrl.toString(), image: img.toString() };
}

export function buildPlannerOgMeta(intent, site) {
  const from = stationLabel(intent.from);
  const to = stationLabel(intent.to);
  const timeBit = intent.time ? ` · depart ${intent.time}` : '';
  const title = `Trip: ${from} → ${to}${timeBit} | Metrorail Next Train`;
  const description = 'Open this plan in Metrorail Next Train — live times, connections & fares.';
  const shareUrl = new URL(site);
  shareUrl.searchParams.set('plan', `${intent.from}~${intent.to}`);
  if (intent.time) shareUrl.searchParams.set('t', intent.time);
  if (intent.day) {
    shareUrl.searchParams.set(
      'd',
      intent.day === 'saturday' ? 'sa' : intent.day === 'sunday' ? 'su' : 'wd'
    );
  }
  if (intent.region) shareUrl.searchParams.set('r', intent.region);
  const img = new URL('/og/plan.png', site);
  img.searchParams.set('from', intent.from);
  img.searchParams.set('to', intent.to);
  if (intent.time) img.searchParams.set('t', intent.time);
  if (intent.day) {
    img.searchParams.set(
      'd',
      intent.day === 'saturday' ? 'sa' : intent.day === 'sunday' ? 'su' : 'wd'
    );
  }
  if (intent.region) img.searchParams.set('r', intent.region);
  return { title, description, url: shareUrl.toString(), image: img.toString() };
}

export function renderOgHtml({ title, description, url, image, siteName = 'Metrorail Next Train' }) {
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
<meta http-equiv="refresh" content="0;url=${esc(url)}"/>
</head>
<body>
<p><a href="${esc(url)}">${esc(title)}</a></p>
<p>${esc(description)}</p>
</body>
</html>`;
}
