/**
 * Crawlable SSG route landings — one HTML page per active Metrorail corridor.
 * getStaticPaths() in routes/[slug].astro consumes listSeoRoutes().
 *
 * Stable slugs: hand-authored overrides keep URLs already in the wild.
 * Everything else is generated from ROUTES destA/destB.
 */
import { ROUTES, REGIONS } from './config.js';

/** @typedef {{ slug: string, routeId: string, blurb: string, operatingNote: string }} SeoRouteSeed */

export function stationLabel(raw) {
    return String(raw || '')
        .replace(/\s+STATION$/i, '')
        .replace(/\s+YARD$/i, '')
        .trim();
}

export function displayRouteName(route) {
    if (!route) return 'Metrorail route';
    const a = stationLabel(route.destA);
    const b = stationLabel(route.destB);
    return `${a} ↔ ${b}`;
}

export function regionName(regionCode) {
    return REGIONS[regionCode]?.name || regionCode || 'South Africa';
}

/** URL slug fragment from a station name. */
export function slugifyStation(raw) {
    return stationLabel(raw)
        .toLowerCase()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function slugForRoute(route) {
    if (!route) return '';
    return `${slugifyStation(route.destA)}-to-${slugifyStation(route.destB)}`;
}

const DEFAULT_OPERATING_NOTE =
    'Metrorail generally does not run on Sundays. Public holidays vary: some follow a Saturday/holiday timetable; others have no service. Confirm the day type in Next Train before you travel.';

/**
 * Hand-authored SEO copy + slug locks for corridors already indexed / linked.
 * Keys are routeId.
 */
const SEO_OVERRIDES = {
    'pta-pien': {
        slug: 'pretoria-to-pienaarspoort',
        blurb: 'Live Metrorail times between Pretoria and Pienaarspoort for weekday and Saturday services.',
        operatingNote:
            'Metrorail generally does not run on Sundays. Public holidays vary: some follow a Saturday/holiday timetable; others have no service.',
    },
    'pta-kempton': {
        slug: 'pretoria-to-kempton-park',
        blurb: 'Pretoria / Kempton Park Metrorail timetable helper. Check the next train and full schedule in the app.',
        operatingNote:
            'Some trains on this corridor run on limited weekdays only. Always confirm the day type in Next Train before you travel.',
    },
    'pta-mabopane': {
        slug: 'pretoria-to-mabopane',
        blurb: 'Schedules for the Pretoria–Mabopane corridor, with a one-tap jump into the live Next Train board.',
        operatingNote:
            'Weekday and Saturday sheets are available in the app. Sundays are typically no service across the network.',
    },
    'ct-bellv': {
        slug: 'cape-town-to-bellville',
        blurb: 'Cape Town / Bellville Metrorail times for the Northern Line corridor (Western Cape).',
        operatingNote: 'Use Next Train for weekday vs Saturday boards and holiday overrides for 2026.',
    },
    'kzn-umlazi': {
        slug: 'durban-to-umlazi',
        blurb: 'Durban ↔ Umlazi Metrorail schedule landing for KwaZulu-Natal south corridor trips.',
        operatingNote: 'Open the interactive board for upcoming trains, fares, and the full timetable grid.',
    },
};

/**
 * @deprecated Prefer listSeoRoutes() — kept as the override catalogue for tooling.
 * @type {SeoRouteSeed[]}
 */
export const SEO_ROUTE_SEEDS = Object.entries(SEO_OVERRIDES).map(([routeId, o]) => ({
    routeId,
    slug: o.slug,
    blurb: o.blurb,
    operatingNote: o.operatingNote,
}));

function buildSeedForRoute(route) {
    const override = SEO_OVERRIDES[route.id];
    const origin = stationLabel(route.destA);
    const dest = stationLabel(route.destB);
    const province = regionName(route.region);
    return {
        slug: override?.slug || slugForRoute(route),
        routeId: route.id,
        blurb:
            override?.blurb ||
            `Live Metrorail train times for ${origin} ↔ ${dest} (${province}). Open Next Train for the next departure, fares, and full timetable.`,
        operatingNote: override?.operatingNote || DEFAULT_OPERATING_NOTE,
    };
}

/** All active corridors → SSG landings (excludes special_event / inactive). */
export function listSeoRoutes() {
    const usedSlugs = new Set();
    const out = [];

    const routes = Object.values(ROUTES)
        .filter((r) => r && r.isActive && r.id !== 'special_event' && r.destA && r.destB)
        .sort((a, b) => {
            const ra = String(a.region || '');
            const rb = String(b.region || '');
            if (ra !== rb) return ra.localeCompare(rb);
            return displayRouteName(a).localeCompare(displayRouteName(b));
        });

    for (const route of routes) {
        const seed = buildSeedForRoute(route);
        let slug = seed.slug;
        if (usedSlugs.has(slug)) slug = `${slug}-${route.id}`;
        usedSlugs.add(slug);
        out.push({ seed: { ...seed, slug }, route });
    }
    return out;
}

export function getSeoRouteBySlug(slug) {
    return listSeoRoutes().find((entry) => entry.seed.slug === slug) || null;
}
