/**
 * Share / cold-start URL helpers.
 * Short modern query params + full legacy `action=` compatibility.
 *
 * Modern planner:  ?plan=FROM~TO&t=6:10&d=sa&r=GP
 * Legacy planner:  ?action=planner&from=…&to=…&time=…&day=…&region=…
 *
 * Modern route:    ?rt=pta-pien&v=g&dir=A&d=sa
 * Legacy route:    ?action=route&route=pta-pien&view=grid&dir=A&day=saturday
 */

function encodeDay(day) {
    const d = String(day || '').toLowerCase();
    if (d === 'saturday' || d === 'weekend' || d === 'sa') return 'sa';
    if (d === 'sunday' || d === 'su') return 'su';
    if (d === 'public_holiday' || d === 'ph' || d === 'holiday') return 'ph';
    return 'wd';
}

function decodeDay(raw) {
    const d = String(raw || '').toLowerCase();
    if (d === 'sa' || d === 'saturday' || d === 'weekend') return 'saturday';
    if (d === 'su' || d === 'sunday') return 'sunday';
    if (d === 'ph' || d === 'public_holiday' || d === 'holiday') return 'public_holiday';
    if (d === 'wd' || d === 'weekday' || d === 'weekdays') return 'weekday';
    return 'weekday';
}

function encodeView(view) {
    const v = String(view || '').toLowerCase();
    if (v === 'g' || v === 'grid') return 'g';
    if (v === 'f' || v === 'fare' || v === 'fares') return 'f';
    return '';
}

function decodeView(raw) {
    const v = String(raw || '').toLowerCase();
    if (v === 'g' || v === 'grid') return 'grid';
    if (v === 'f' || v === 'fare' || v === 'fares') return 'fares';
    return v;
}

/** Compact time for shares (drop trailing :00 seconds). */
export function compactTime(time) {
    const t = String(time || '').trim();
    if (!t) return '';
    const m = t.match(/^(\d{1,2}:\d{2})(?::\d{2})?$/);
    return m ? m[1] : t;
}

/**
 * Public share links use /og/share so WhatsApp/Facebook scrape Worker OG HTML
 * (not the SPA homepage). Humans hitting /og/share are meta-refreshed into /?…
 * `pathname` is accepted for call-site compatibility but ignored.
 */
export function buildPlannerShareUrl({ from, to, time, day, region, origin, pathname: _pathname } = {}) {
    const baseOrigin = origin || (typeof location !== 'undefined' ? location.origin : 'https://nexttrain.co.za');
    const params = new URLSearchParams();
    params.set('plan', `${from || ''}~${to || ''}`);
    const t = compactTime(time);
    if (t) params.set('t', t);
    if (day) params.set('d', encodeDay(day));
    if (region) params.set('r', region);
    return `${baseOrigin}/og/share?${params.toString()}`;
}

export function buildRouteShareUrl({ routeId, view = 'grid', dir = 'A', day = 'weekday', origin, pathname: _pathname } = {}) {
    const baseOrigin = origin || (typeof location !== 'undefined' ? location.origin : 'https://nexttrain.co.za');
    const params = new URLSearchParams();
    params.set('rt', routeId);
    const v = encodeView(view);
    if (v) params.set('v', v);
    if (dir === 'B') params.set('dir', 'B');
    if (day) params.set('d', encodeDay(day));
    return `${baseOrigin}/og/share?${params.toString()}`;
}

function normalizeStationQuery(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    try { s = decodeURIComponent(s); } catch { /* already decoded */ }
    // Legacy shares used + as spaces; URLSearchParams usually decodes these already
    return s.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse short (`plan=`) or legacy SPA (`action=planner&from=&to=&time=&day=&region=`) links.
 * Accepts a search string, URLSearchParams, or a pre-captured plain object.
 */
export function parsePlannerDeepLink(search = typeof location !== 'undefined' ? location.search : '') {
    if (search && typeof search === 'object' && !Array.isArray(search) && !(search instanceof URLSearchParams)) {
        if (search.kind === 'planner' && search.from && search.to) return search;
    }

    const params = search instanceof URLSearchParams
        ? search
        : new URLSearchParams(typeof search === 'string' ? search : '');
    const plan = params.get('plan');
    const action = String(params.get('action') || '').toLowerCase();
    const legacy = action === 'planner';

    let from = normalizeStationQuery(params.get('from') || '');
    let to = normalizeStationQuery(params.get('to') || '');

    if (plan) {
        const sep = plan.includes('~') ? '~' : (plan.includes('/') ? '/' : null);
        if (sep) {
            const [a, b] = plan.split(sep);
            from = normalizeStationQuery(a);
            to = normalizeStationQuery(b);
        }
    } else if (!legacy) {
        return null;
    }

    if (!from || !to) return null;

    const regionRaw = (params.get('r') || params.get('region') || '').toUpperCase();
    return {
        kind: 'planner',
        from,
        to,
        time: params.get('t') || params.get('time') || '',
        day: decodeDay(params.get('d') || params.get('day') || ''),
        region: ['GP', 'WC', 'KZN', 'EC'].includes(regionRaw) ? regionRaw : null,
        legacy,
    };
}

export function parseRouteDeepLinkParams(search = typeof location !== 'undefined' ? location.search : '') {
    if (search && typeof search === 'object' && !Array.isArray(search) && !(search instanceof URLSearchParams)) {
        if (search.kind === 'route' && search.routeId) return search;
    }

    const params = search instanceof URLSearchParams
        ? search
        : new URLSearchParams(typeof search === 'string' ? search : '');
    const rt = params.get('rt');
    const action = String(params.get('action') || '').toLowerCase();
    const legacy = action === 'route';
    const routeId = rt || params.get('route');
    if (!routeId) return null;
    // SPA parity: bare `?route=pta-pien&view=grid` (no action=) must still open the timetable
    if (!rt && !legacy && !params.get('route')) return null;

    const regionRaw = (params.get('r') || params.get('region') || '').toUpperCase();
    return {
        kind: 'route',
        routeId,
        view: decodeView(params.get('v') || params.get('view') || ''),
        dir: params.get('dir') === 'B' ? 'B' : 'A',
        day: decodeDay(params.get('d') || params.get('day') || 'weekday'),
        region: ['GP', 'WC', 'KZN', 'EC'].includes(regionRaw) ? regionRaw : null,
        legacy: legacy || (!rt && !!params.get('route')),
    };
}

/** Legacy SPA `?action=map` — opens the static network map modal. */
export function parseMapDeepLink(search = typeof location !== 'undefined' ? location.search : '') {
    if (search && typeof search === 'object' && !Array.isArray(search) && !(search instanceof URLSearchParams)) {
        if (search.kind === 'map') return search;
    }
    const params = search instanceof URLSearchParams
        ? search
        : new URLSearchParams(typeof search === 'string' ? search : '');
    if (String(params.get('action') || '').toLowerCase() !== 'map') return null;
    return { kind: 'map' };
}

/** Home-screen shortcut `?action=planner` with no from/to — just open the planner tab. */
export function parsePlannerShortcutDeepLink(search = typeof location !== 'undefined' ? location.search : '') {
    if (search && typeof search === 'object' && !Array.isArray(search) && !(search instanceof URLSearchParams)) {
        if (search.kind === 'planner-shortcut') return search;
    }
    const params = search instanceof URLSearchParams
        ? search
        : new URLSearchParams(typeof search === 'string' ? search : '');
    if (String(params.get('action') || '').toLowerCase() !== 'planner') return null;
    // Full planner shares are handled by parsePlannerDeepLink (needs from+to / plan=).
    if (params.get('plan') || params.get('from') || params.get('to')) return null;
    return { kind: 'planner-shortcut' };
}

function extractHttpUrl(raw) {
    const s = String(raw || '');
    const m = s.match(/https?:\/\/[^\s<>"']+/i);
    return m ? m[0].replace(/[).,;]+$/, '') : '';
}

function parseLooseTripText(raw) {
    const text = normalizeStationQuery(raw);
    if (!text) return null;
    const m = text.match(/^(.+?)\s+(?:to|→|->|–|—)\s+(.+)$/i)
        || text.match(/^(.+?)\s+-\s+(.+)$/);
    if (!m) return null;
    const from = normalizeStationQuery(m[1]);
    const to = normalizeStationQuery(m[2]);
    if (!from || !to || from.length > 48 || to.length > 48) return null;
    return { from, to };
}

/**
 * Web Share Target API (manifest share_target) — OS share sheet lands on
 * `/?title=&text=&url=`. Prefer resolving into a planner/route deep link when
 * the shared payload contains our URLs or "Station A to Station B" text.
 */
export function parseShareTargetDeepLink(search = typeof location !== 'undefined' ? location.search : '') {
    if (search && typeof search === 'object' && !Array.isArray(search) && !(search instanceof URLSearchParams)) {
        if (search.kind === 'share-target' || search.kind === 'planner' || search.kind === 'route') {
            return search.kind === 'share-target' || search.from || search.routeId ? search : null;
        }
    }

    const params = search instanceof URLSearchParams
        ? search
        : new URLSearchParams(typeof search === 'string' ? search : '');

    // Prefer explicit Next Train deep links over share-target fields.
    if (params.get('plan') || params.get('rt') || params.get('route') || params.get('action')) {
        return null;
    }

    const title = normalizeStationQuery(params.get('title') || '');
    const text = normalizeStationQuery(params.get('text') || '');
    const url = String(params.get('url') || '').trim();
    if (!title && !text && !url) return null;

    const candidates = [url, extractHttpUrl(text), extractHttpUrl(title)].filter(Boolean);
    for (const candidate of candidates) {
        try {
            const u = new URL(candidate, typeof location !== 'undefined' ? location.origin : 'https://nexttrain.co.za');
            const planner = parsePlannerDeepLink(u.search);
            if (planner) return { ...planner, fromShareTarget: true };
            const route = parseRouteDeepLinkParams(u.search);
            if (route) return { ...route, fromShareTarget: true };
        } catch { /* ignore bad URLs */ }
    }

    const loose = parseLooseTripText(text) || parseLooseTripText(title);
    if (loose) {
        return {
            kind: 'planner',
            from: loose.from,
            to: loose.to,
            time: '',
            day: 'weekday',
            region: null,
            legacy: false,
            fromShareTarget: true,
        };
    }

    return {
        kind: 'share-target',
        title,
        text,
        url,
    };
}

export function stripShareParamsFromUrl() {
    try {
        const urlObj = new URL(location.href);
        [
            'action', 'route', 'view', 'dir', 'day',
            'from', 'to', 'time', 'region',
            'plan', 'rt', 'v', 't', 'd', 'r',
            'onboard',
            // Web Share Target GET params
            'title', 'text', 'url',
        ].forEach((k) => urlObj.searchParams.delete(k));
        const next = urlObj.pathname + (urlObj.search ? urlObj.search : '');
        history.replaceState({}, '', next);
    } catch { /* ignore */ }
}
