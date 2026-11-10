/**
 * Printed timetable sheets, grouped under the route they belong to.
 * Route order follows the board (the ROUTES object). A sheet that names
 * several routes is listed under each of them.
 */

const REGION_LABEL = {
    GP: 'Gauteng',
    WC: 'Western Cape',
    KZN: 'KwaZulu-Natal',
    EC: 'Eastern Cape',
};

const DAY_LABEL = {
    weekday: 'Weekday',
    saturday: 'Saturday',
    sunday: 'Sunday',
    weekend: 'Weekend',
    'public-holiday': 'Public holiday',
};

const DIR_LABEL = {
    inbound: 'inbound',
    outbound: 'outbound',
    combined: 'both ways',
};

const DAY_RANK = { weekday: 0, saturday: 1, sunday: 2, weekend: 3, 'public-holiday': 4 };
const DIR_RANK = { inbound: 0, outbound: 1, combined: 2 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function scheduleRouteTitle(name) {
    return String(name || '')
        .replace(/\bJHB\b/g, 'Johannesburg')
        .replace(/\s*<->\s*/g, ' - ')
        .replace(/\s*↔\s*/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatEffective(value) {
    const text = String(value || '');
    const full = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (full) {
        const month = MONTHS[Number(full[2]) - 1] || '';
        const day = Number(full[3]);
        if (!month || !day) return '';
        return `${day} ${month} ${full[1]}`;
    }
    const monthOnly = text.match(/^(\d{4})-(\d{2})$/);
    if (monthOnly) {
        const month = MONTHS[Number(monthOnly[2]) - 1] || '';
        return month ? `${month} ${monthOnly[1]}` : '';
    }
    return '';
}

function partLabel(part) {
    const raw = String(part || '');
    if (raw === 'grid') return 'grid';
    if (raw === 'departures') return 'departures';
    if (raw === 'early' || raw === 'later') return raw;
    if (/^p\d+$/i.test(raw)) return `page ${raw.slice(1)}`;
    return '';
}

function partRank(part) {
    const raw = String(part || '');
    if (raw === 'grid') return 0;
    if (raw === 'departures') return 1;
    if (raw === 'early') return 2;
    if (raw === 'later') return 3;
    if (/^p\d+$/i.test(raw)) return 10 + Number(raw.slice(1));
    return 5;
}

/** Short row under the route name. The route is already the heading. */
export function scheduleSheetRowLabel(sheet) {
    const day = DAY_LABEL[sheet?.day] || '';
    const dir = DIR_LABEL[sheet?.direction] || '';
    const part = partLabel(sheet?.part);
    const when = formatEffective(sheet?.effective);
    const title = [day, dir, part].filter(Boolean).join(' ');
    if (title && when) return `${title}, ${when}`;
    return title || when || String(sheet?.label || sheet?.id || 'Timetable');
}

function sortSheets(rows) {
    return rows.slice().sort((a, b) => {
        const day = (DAY_RANK[a?.day] ?? 9) - (DAY_RANK[b?.day] ?? 9);
        if (day) return day;
        const dir = (DIR_RANK[a?.direction] ?? 9) - (DIR_RANK[b?.direction] ?? 9);
        if (dir) return dir;
        const part = partRank(a?.part) - partRank(b?.part);
        if (part) return part;
        const eff = String(a?.effective || '').localeCompare(String(b?.effective || ''));
        if (eff) return eff;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
}

export function scheduleSheetPath(sheet) {
    const file = String(sheet?.file || '').replace(/^\/+/, '');
    if (!/^[a-z0-9]+\/[A-Za-z0-9._-]+\.jpe?g$/i.test(file)) return '';
    return `/images/schedules/${file}`;
}

/**
 * @param {Array} sheets manifest sheets
 * @param {Array<{ id: string, name: string, region: string }>} routes board order
 */
export function groupScheduleSheets(sheets, routes) {
    const list = Array.isArray(sheets) ? sheets : [];
    const order = Array.isArray(routes) ? routes : [];
    const byRoute = new Map();
    list.forEach((sheet) => {
        const ids = Array.isArray(sheet?.routeIds) ? sheet.routeIds : [];
        ids.forEach((id) => {
            const key = String(id || '');
            if (!key) return;
            if (!byRoute.has(key)) byRoute.set(key, []);
            byRoute.get(key).push(sheet);
        });
    });
    const used = new Set();
    const regions = [];
    let current = null;
    order.forEach((route) => {
        const rows = byRoute.get(route.id);
        if (!rows?.length) return;
        used.add(route.id);
        const region = String(route.region || '');
        if (!current || current.region !== region) {
            current = { region, label: REGION_LABEL[region] || region || 'Timetables', routes: [] };
            regions.push(current);
        }
        current.routes.push({
            id: route.id,
            name: scheduleRouteTitle(route.name),
            sheets: sortSheets(rows).map((sheet) => ({
                id: String(sheet.id || ''),
                path: scheduleSheetPath(sheet),
                label: scheduleSheetRowLabel(sheet),
            })).filter((sheet) => sheet.path),
        });
    });
    const leftover = list.filter((sheet) => {
        const ids = Array.isArray(sheet?.routeIds) ? sheet.routeIds : [];
        return !ids.some((id) => used.has(String(id)));
    });
    if (leftover.length) {
        regions.push({
            region: '',
            label: 'Other',
            routes: [{
                id: '',
                name: 'Other timetables',
                sheets: sortSheets(leftover).map((sheet) => ({
                    id: String(sheet.id || ''),
                    path: scheduleSheetPath(sheet),
                    label: scheduleSheetRowLabel(sheet),
                })).filter((sheet) => sheet.path),
            }],
        });
    }
    return regions;
}
