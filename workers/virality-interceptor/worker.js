/**
 * METRORAIL NEXT TRAIN — VIRALITY INTERCEPTOR (V2.0)
 * --------------------------------------------------------------------------
 * Apex Cloudflare Worker for social Open Graph stubs on share deep-links.
 *
 * V2.0 fixes:
 *  - Crawler-only gating (WhatsApp in-app browsers with Chrome/Safari chrome
 *    pass through — they used to loop on the white "Redirecting…" stub).
 *  - Bypass query `__nt=1` always passes through (safety valve).
 *  - Supports modern `?rt=` / `?plan=` shares as well as legacy `action=`.
 *  - Never self-redirects to an intercepted URL; accidental humans get a 302
 *    to the same path with `__nt=1`.
 *  - JS redirect URLs are not HTML-escaped (keeps `&` intact).
 *
 * Deploy: see README.md in this folder.
 */

const ROUTE_NAMES = {
  special_event: 'Special Event Route',
  'pta-pien': 'Pretoria ↔ Pienaarspoort',
  'pta-mabopane': 'Pretoria ↔ Mabopane',
  'mab-belle': 'Mabopane ↔ Belle Ombre',
  'pta-dewildt': 'Pretoria ↔ De Wildt',
  'herc-koed': 'Hercules ↔ Koedoespoort',
  'pta-saul': 'Pretoria ↔ Saulsville',
  'germ-leralla': 'Germiston ↔ Leralla',
  'germ-kwesine': 'Germiston ↔ Kwesine',
  'pta-irene': 'Pretoria ↔ Irene',
  'jhb-germiston': 'JHB ↔ Germiston',
  'pta-kempton': 'Pretoria ↔ Kempton Park',
  'jhb-rand': 'JHB ↔ Randfontein',
  'jhb-soweto': 'JHB ↔ Naledi',
  'jhb-midway': 'JHB ↔ Midway',
  'ct-chrishani': 'Cape Town ↔ Chris Hani',
  'ct-kapteinsklip': 'Cape Town ↔ Kapteinsklip',
  'ct-nolu': 'Cape Town ↔ Nolungile',
  'bellville-mutual': 'Bellville ↔ Mutual',
  'ct-simon': "Cape Town ↔ Simon's Town",
  'ct-flats': 'Cape Town ↔ Retreat',
  'ct-bellv': 'Cape Town ↔ Bellville',
  'ct-kraai': 'Cape Town ↔ Kraaifontein',
  'ct-eerst': 'Cape Town ↔ Eerste River',
  'ct-strnd': 'Cape Town ↔ Strand',
  'eerst-dtoit': 'Eerste River ↔ Du Toit',
  'ct-well': 'Cape Town ↔ Wellington',
  'ct-malm': 'Cape Town ↔ Malmesbury',
  'kzn-umlazi': 'Durban ↔ Umlazi',
  'kzn-bridgecity': 'Berea Road ↔ Bridge City',
  'kzn-winklespruit': 'Durban ↔ Winklespruit',
  'kzn-catoridge': 'Durban ↔ Cato Ridge',
  'kzn-pinetown': 'Durban ↔ Pinetown',
  'ec-berlin': 'East London ↔ Berlin',
};

const DAY_LABELS = {
  wd: 'Weekday',
  weekday: 'Weekday',
  weekdays: 'Weekday',
  sa: 'Saturday',
  saturday: 'Saturday',
  weekend: 'Saturday',
  su: 'Sunday',
  sunday: 'Sunday',
};

const toTitleCase = (str) => {
  if (!str) return '';
  return String(str).replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
};

const escHtml = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

/** Escape for embedding inside a double-quoted JS string literal. */
const escJs = (str) => String(str || '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');

function decodeDayLabel(raw) {
  const key = String(raw || '').toLowerCase();
  return DAY_LABELS[key] || (key ? toTitleCase(key) : 'Schedule');
}

/**
 * True for social *crawlers* only.
 * WhatsApp in-app browsers often include "WhatsApp" plus Chrome/Safari — those
 * are humans and must pass through to the SPA.
 */
function isSocialCrawler(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return false;

  // Explicit non-WhatsApp crawlers
  if (/facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|linkedinbot|discordbot|applebot|embedly|quora link preview|pinterest|redditbot|skypeuripreview|vkshare|w3c_validator|whatsapp\//i.test(ua)
    && !/(chrome|chromium|crios|safari|firefox|fxios|edg|opera|opr)\//i.test(ua)) {
    return true;
  }

  // facebookexternalhit etc. without browser chrome
  if (/facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|linkedinbot|discordbot|applebot/i.test(ua)) {
    return true;
  }

  // Pure WhatsApp crawler (preview fetcher) — typically "WhatsApp/2.x" without Chrome/Safari
  if (/whatsapp/i.test(ua) && !/(chrome|chromium|crios|safari\/|firefox|fxios|edg\/)/i.test(ua)) {
    return true;
  }

  return false;
}

function parseShareIntent(url) {
  const action = String(url.searchParams.get('action') || '').toLowerCase();
  const rt = url.searchParams.get('rt');
  const plan = url.searchParams.get('plan');
  const route = url.searchParams.get('route');

  if (action === 'planner' || plan) {
    let from = '';
    let to = '';
    if (plan) {
      const sep = plan.includes('~') ? '~' : (plan.includes('/') ? '/' : null);
      if (sep) {
        const [a, b] = plan.split(sep);
        from = a || '';
        to = b || '';
      }
    } else {
      from = url.searchParams.get('from') || '';
      to = url.searchParams.get('to') || '';
    }
    return {
      kind: 'planner',
      from: toTitleCase(from.replace(/ STATION/gi, '')),
      to: toTitleCase(to.replace(/ STATION/gi, '')),
      time: url.searchParams.get('t') || url.searchParams.get('time') || '',
      day: decodeDayLabel(url.searchParams.get('d') || url.searchParams.get('day') || ''),
    };
  }

  if (action === 'route' || rt || (route && (url.searchParams.get('view') || url.searchParams.get('v')))) {
    const routeId = rt || route;
    return {
      kind: 'route',
      routeId,
      routeName: ROUTE_NAMES[routeId] || 'Train Route',
      day: decodeDayLabel(url.searchParams.get('d') || url.searchParams.get('day') || 'weekday'),
    };
  }

  // Bare modern route share without view still counts
  if (rt) {
    return {
      kind: 'route',
      routeId: rt,
      routeName: ROUTE_NAMES[rt] || 'Train Route',
      day: decodeDayLabel(url.searchParams.get('d') || 'weekday'),
    };
  }

  return null;
}

function buildOgMeta(intent, canonicalUrl) {
  let title = 'Metrorail Next Train';
  let description = 'Stop guessing. Get accurate train times, ticket prices, and live schedule updates.';

  if (intent.kind === 'planner') {
    const from = intent.from || 'Origin';
    const to = intent.to || 'Destination';
    title = `Trip: ${from} to ${to}`;
    const timeBit = intent.time ? intent.time.substring(0, 5) : '';
    description = timeBit
      ? `Departs at ${timeBit} (${intent.day}). Tap to view the full journey timeline, transfers, and live map.`
      : `${intent.day} trip. Tap to view the full journey timeline, transfers, and live map.`;
  } else if (intent.kind === 'route') {
    title = `Schedule: ${intent.routeName}`;
    description = `${intent.day} Timetable. Tap to view all upcoming trains, stops, and live disruptions.`;
  }

  return { title, description, canonicalUrl };
}

function generateHtmlStub(url, intent) {
  const { title, description, canonicalUrl } = buildOgMeta(intent, url.toString());
  // WhatsApp/Facebook drop SVGs — keep PNG logo until a real 1200x630 generator ships.
  const ogImageUrl = 'https://nexttrain.co.za/icons/loading-logo.png';

  // Bypass URL for the rare human who somehow receives this stub.
  const bypass = new URL(url.toString());
  bypass.searchParams.set('__nt', '1');
  const bypassHref = bypass.toString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}">
  <meta name="theme-color" content="#1d4ed8">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escHtml(canonicalUrl)}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(description)}">
  <meta property="og:image" content="${escHtml(ogImageUrl)}">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta property="og:image:type" content="image/png">
  <meta property="og:site_name" content="Metrorail Next Train">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(description)}">
  <meta name="twitter:image" content="${escHtml(ogImageUrl)}">
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; background: #f3f4f6; color: #111827; text-align: center; padding: 1.5rem; }
    a { color: #1d4ed8; font-weight: 700; }
  </style>
</head>
<body>
  <div>
    <h2>Opening Next Train…</h2>
    <p>If nothing happens, <a href="${escHtml(bypassHref)}">tap here</a>.</p>
  </div>
  <script>
    window.location.replace("${escJs(bypassHref)}");
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Safety valve: never intercept pass-through / already-bypassed navigations.
    if (url.searchParams.get('__nt') === '1') {
      return fetch(request);
    }

    const userAgent = request.headers.get('User-Agent') || '';
    const crawler = isSocialCrawler(userAgent);
    const intent = parseShareIntent(url);

    if (crawler && intent) {
      return generateHtmlStub(url, intent);
    }

    // Accidental stub recipients are handled inside generateHtmlStub via __nt=1.
    // Humans (including WhatsApp WebViews with Chrome/Safari) always pass through.
    return fetch(request);
  },
};
