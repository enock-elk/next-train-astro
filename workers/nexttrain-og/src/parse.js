/**
 * Share-link parsing — mirrors src/lib/share-links.js (modern + legacy).
 */

function encodeDay(day) {
  const d = String(day || '').toLowerCase();
  if (d === 'saturday' || d === 'weekend' || d === 'sa') return 'sa';
  if (d === 'sunday' || d === 'su') return 'su';
  return 'wd';
}

function decodeDay(raw) {
  const d = String(raw || '').toLowerCase();
  if (d === 'sa' || d === 'saturday' || d === 'weekend') return 'saturday';
  if (d === 'su' || d === 'sunday') return 'sunday';
  if (d === 'wd' || d === 'weekday' || d === 'weekdays') return 'weekday';
  return 'weekday';
}

function decodeView(raw) {
  const v = String(raw || '').toLowerCase();
  if (v === 'g' || v === 'grid') return 'grid';
  if (v === 'f' || v === 'fare' || v === 'fares') return 'fares';
  return v;
}

function normalizeStationQuery(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  try {
    s = decodeURIComponent(s);
  } catch {
    /* already decoded */
  }
  return s.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function dayLabel(day) {
  if (day === 'saturday') return 'Saturday / Holiday';
  if (day === 'sunday') return 'Sunday';
  return 'Weekday';
}

export function stationLabel(raw) {
  const cleaned = String(raw || '')
    .replace(/\s+STATION$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Title-case ALL CAPS sheet labels for nicer WhatsApp cards
  if (cleaned && cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)) {
    return cleaned
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return cleaned;
}

export function parseShareIntent(url) {
  const params = url.searchParams;
  const plan = params.get('plan');
  const action = String(params.get('action') || '').toLowerCase();

  // Planner
  let from = normalizeStationQuery(params.get('from') || '');
  let to = normalizeStationQuery(params.get('to') || '');
  if (plan) {
    const sep = plan.includes('~') ? '~' : plan.includes('/') ? '/' : null;
    if (sep) {
      const [a, b] = plan.split(sep);
      from = normalizeStationQuery(a);
      to = normalizeStationQuery(b);
    }
  }
  if (from && to && (plan || action === 'planner')) {
    const regionRaw = (params.get('r') || params.get('region') || '').toUpperCase();
    return {
      kind: 'planner',
      from,
      to,
      time: params.get('t') || params.get('time') || '',
      day: decodeDay(params.get('d') || params.get('day') || ''),
      region: ['GP', 'WC', 'KZN', 'EC'].includes(regionRaw) ? regionRaw : null,
    };
  }

  // Route / timetable
  const rt = params.get('rt');
  const routeId = rt || params.get('route');
  if (routeId && (rt || action === 'route' || params.get('route'))) {
    return {
      kind: 'route',
      routeId,
      view: decodeView(params.get('v') || params.get('view') || 'grid') || 'grid',
      dir: params.get('dir') === 'B' ? 'B' : 'A',
      day: decodeDay(params.get('d') || params.get('day') || 'weekday'),
    };
  }

  return null;
}

export function isSocialCrawler(ua) {
  const s = String(ua || '');
  if (!s) return false;
  return /facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|Slackbot|Discordbot|TelegramBot|SkypeUriPreview|vkShare|redditbot|Embedly|Quora Link Preview|Showyoubot|Outbrain|Pinterest|Applebot|Iframely|Snapchat/i.test(
    s
  );
}

export { encodeDay, decodeDay };
