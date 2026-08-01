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
    return 'wd';
}

function decodeDay(raw) {
    const d = String(raw || '').toLowerCase();
    if (d === 'sa' || d === 'saturday' || d === 'weekend') return 'saturday';
    if (d === 'su' || d === 'sunday') return 'sunday';
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

export function parsePlannerDeepLink(search = typeof location !== 'undefined' ? location.search : '') {
    const params = new URLSearchParams(search);
    const plan = params.get('plan');
    const legacy = params.get('action') === 'planner';

    let from = params.get('from') || '';
    let to = params.get('to') || '';

    if (plan) {
        const sep = plan.includes('~') ? '~' : (plan.includes('/') ? '/' : null);
        if (sep) {
            const [a, b] = plan.split(sep);
            from = (a || '').trim();
            to = (b || '').trim();
        }
    } else if (!legacy) {
        return null;
    }

    if (!from || !to) return null;

    return {
        kind: 'planner',
        from,
        to,
        time: params.get('t') || params.get('time') || '',
        day: decodeDay(params.get('d') || params.get('day') || ''),
        region: (params.get('r') || params.get('region') || '').toUpperCase() || null,
    };
}

export function parseRouteDeepLinkParams(search = typeof location !== 'undefined' ? location.search : '') {
    const params = new URLSearchParams(search);
    const rt = params.get('rt');
    const legacy = params.get('action') === 'route';
    const routeId = rt || params.get('route');
    if (!routeId) return null;
    if (!rt && !legacy) return null;

    return {
        kind: 'route',
        routeId,
        view: decodeView(params.get('v') || params.get('view') || ''),
        dir: params.get('dir') === 'B' ? 'B' : 'A',
        day: decodeDay(params.get('d') || params.get('day') || 'weekday'),
    };
}

export function stripShareParamsFromUrl() {
    try {
        const urlObj = new URL(location.href);
        [
            'action', 'route', 'view', 'dir', 'day',
            'from', 'to', 'time', 'region',
            'plan', 'rt', 'v', 't', 'd', 'r',
        ].forEach((k) => urlObj.searchParams.delete(k));
        const next = urlObj.pathname + (urlObj.search ? urlObj.search : '');
        history.replaceState({}, '', next);
    } catch { /* ignore */ }
}
