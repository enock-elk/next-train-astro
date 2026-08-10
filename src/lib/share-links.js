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

export function buildPlannerShareUrl({ from, to, time, day, region, origin, pathname } = {}) {
    const baseOrigin = origin || (typeof location !== 'undefined' ? location.origin : 'https://nexttrain.co.za');
    const basePath = pathname || (typeof location !== 'undefined' ? location.pathname : '/');
    const params = new URLSearchParams();
    params.set('plan', `${from || ''}~${to || ''}`);
    const t = compactTime(time);
    if (t) params.set('t', t);
    if (day) params.set('d', encodeDay(day));
    if (region) params.set('r', region);
    return `${baseOrigin}${basePath}?${params.toString()}`;
}

export function buildRouteShareUrl({ routeId, view = 'grid', dir = 'A', day = 'weekday', origin, pathname } = {}) {
    const baseOrigin = origin || (typeof location !== 'undefined' ? location.origin : 'https://nexttrain.co.za');
    const basePath = pathname || (typeof location !== 'undefined' ? location.pathname : '/');
    const params = new URLSearchParams();
    params.set('rt', routeId);
    const v = encodeView(view);
    if (v) params.set('v', v);
    if (dir === 'B') params.set('dir', 'B');
    if (day) params.set('d', encodeDay(day));
    return `${baseOrigin}${basePath}?${params.toString()}`;
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

    return {
        kind: 'route',
        routeId,
        view: decodeView(params.get('v') || params.get('view') || ''),
        dir: params.get('dir') === 'B' ? 'B' : 'A',
        day: decodeDay(params.get('d') || params.get('day') || 'weekday'),
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

export function stripShareParamsFromUrl() {
    try {
        const urlObj = new URL(location.href);
        [
            'action', 'route', 'view', 'dir', 'day',
            'from', 'to', 'time', 'region',
            'plan', 'rt', 'v', 't', 'd', 'r',
            'onboard',
        ].forEach((k) => urlObj.searchParams.delete(k));
        const next = urlObj.pathname + (urlObj.search ? urlObj.search : '');
        history.replaceState({}, '', next);
    } catch { /* ignore */ }
}
