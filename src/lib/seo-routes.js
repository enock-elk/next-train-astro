/**
 * Crawlable SSG landings — route / region / parent-corridor pages.
 * getStaticPaths() in routes|regions|corridors/[slug].astro consume these lists.
 *
 * Stable slugs: hand-authored overrides keep URLs already in the wild.
 * Everything else is generated from ROUTES destA/destB.
 */
import { ROUTES, REGIONS, CORRIDOR_META, REGION_SEO, HOLIDAY_NAMES, SPECIAL_DATES, getCorridorLabel } from './config.js';

/** @typedef {{ slug: string, routeId: string, blurb: string, operatingNote: string, serves?: string, nearby?: string }} SeoRouteSeed */

/** Sheet / dump names → commuter-facing labels on SEO pages. */
const STATION_DISPLAY_ALIASES = {
    JOHANNESBURG: 'Johannesburg',
    'JOHANNESBURG PARK': 'Johannesburg',
    'PRETORIA-N': 'Pretoria North',
    'PRETORIA N': 'Pretoria North',
    'PRETORIA NORTH': 'Pretoria North',
    'PRETORIA WES': 'Pretoria West',
    'PRETORIA WEST': 'Pretoria West',
    WALTOO: 'Waltloo',
    WALTLOO: 'Waltloo',
};

/**
 * @param {string} raw
 * @param {{ keepYard?: boolean }} [options]
 * Terminus titles strip trailing YARD so Durban Yard stays "Durban" in H1/slug.
 * Grid rows pass keepYard so Durban Yard and Durban stay distinct.
 */
export function stationLabel(raw, options = {}) {
    let cleaned = String(raw || '')
        .replace(/\s+STATION$/i, '');
    if (!options.keepYard) {
        cleaned = cleaned.replace(/\s+YARD$/i, '');
    }
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    const key = cleaned.toUpperCase();
    if (STATION_DISPLAY_ALIASES[key]) return STATION_DISPLAY_ALIASES[key];
    if (cleaned && cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)) {
        return cleaned
            .toLowerCase()
            .replace(/\b([a-z])/g, (m) => m.toUpperCase());
    }
    return cleaned;
}

/** Grid / calling-point labels. Keeps Yard so two Durban stops do not collapse. */
export function gridStationLabel(raw) {
    return stationLabel(raw, { keepYard: true });
}

export function displayRouteName(route) {
    if (!route) return 'Metrorail route';
    const a = stationLabel(route.destA);
    const b = stationLabel(route.destB);
    return `${a} to ${b}`;
}

export function regionName(regionCode) {
    return REGIONS[regionCode]?.name || regionCode || 'South Africa';
}

/** URL slug fragment from a station name. */
export function slugifyStation(raw) {
    const display = stationLabel(raw);
    const slugSource = (display === 'Johannesburg Park Station' || display === 'Johannesburg') ? 'Johannesburg' : display;
    return slugSource
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
        blurb: 'Pretoria to Pienaarspoort Metrorail schedule for weekday and Saturday services.',
        operatingNote:
            'Metrorail generally does not run on Sundays. Public holidays vary: some follow a Saturday/holiday timetable; others have no service.',
    },
    'pta-kempton': {
        slug: 'pretoria-to-kempton-park',
        blurb: 'Pretoria to Kempton Park Metrorail timetable helper. Check the next train and full schedule in the app.',
        operatingNote:
            'Some trains on this corridor run on limited weekdays only. Always confirm the day type in Next Train before you travel.',
    },
    'pta-mabopane': {
        slug: 'pretoria-to-mabopane',
        blurb: 'Pretoria to Mabopane Metrorail schedule, with a one-tap jump into the live Next Train board.',
        operatingNote:
            'Weekday and Saturday sheets are available in the app. Sundays are typically no service across the network.',
    },
    'ct-bellv': {
        slug: 'cape-town-to-bellville',
        blurb: 'Cape Town to Bellville Metrorail times for the Northern Line corridor (Western Cape).',
        operatingNote: 'Western Cape uses a dedicated Public Holiday timetable on most public holidays. Sundays and a few holidays such as Christmas Day have no service.',
    },
    'kzn-umlazi': {
        slug: 'durban-to-umlazi',
        blurb: 'Durban to Umlazi Metrorail schedule landing for KwaZulu-Natal south corridor trips.',
        operatingNote: 'Open the interactive board for upcoming trains, fares, and the full timetable grid.',
    },
    'kzn-crossmoor': {
        slug: 'durban-to-crossmoor',
        blurb: 'Durban to Crossmoor Metrorail timetable for the yellow inland line via Rossburgh, Havenside, Bayview, Westcliff and Chatsglen.',
        operatingNote: 'Open the interactive board for upcoming trains, fares, and the full timetable grid. Saturday sheets currently carry the published Crossmoor times.',
    },
};

/**
 * Nearby / keyword commentary for route landings.
 * Only dump-clocked calling points, plus map POIs we would defend.
 * Ghosts (no clocks) are not listed as stops. They may be named as an area passed.
 */
const SEO_SERVES = {
    'pta-pien': {
        body: 'This line leaves Pretoria through Mears Street, Devenish Street and Walker Street, then Loftus Versfeld Park, which is close to the University of Pretoria and Loftus Versfeld stadium. After Rissik, Hartbeesspruit and Koedoespoort it calls at Silverton and Waltloo. Mamelodi is covered by Denneboom, Eerste Fabrieke, Mamelodi Gardens and Pienaarspoort. Trains pass the Eersterust area, but Eersterust station is not in service yet.',
        meta: 'Stops include Loftus Versfeld Park near the University of Pretoria, Silverton, Waltloo, and Mamelodi via Denneboom, Eerste Fabrieke, Mamelodi Gardens and Pienaarspoort.',
    },
    'pta-mabopane': {
        body: 'Pretoria to Mabopane calls at Pretoria West, Hercules, Mountain View and Pretoria North, then Wolmerton, Wintersnest, Akasiaboom and Kopanong into Mabopane.',
        meta: 'Stops include Pretoria West, Pretoria North, Wolmerton, Wintersnest and Mabopane.',
    },
    'mab-belle': {
        body: 'Mabopane to Belle Ombre calls at Kopanong, Akasiaboom, Wintersnest, Wolmerton, Pretoria North, Mountain View and Hercules.',
        meta: 'Stops include Kopanong, Pretoria North, Hercules and Belle Ombre.',
    },
    'pta-dewildt': {
        body: 'From Pretoria the published stops include Pretoria West, Hercules, Mountain View, Pretoria North, Wolmerton and Wintersnest, then Rosslyn, Ga-Rankuwa, Taillardshoop and De Wildt.',
        meta: 'Stops include Pretoria North, Rosslyn, Ga-Rankuwa and De Wildt.',
    },
    'herc-koed': {
        body: 'Hercules to Koedoespoort calls at Gezina and Villieria on the published weekday sheet.',
        meta: 'Stops include Hercules, Gezina, Villieria and Koedoespoort.',
    },
    'pta-saul': {
        body: 'Pretoria to Saulsville calls at Pretoria West, Rebecca, Electro, Cor Delfos, Kalafong and Atteridgeville.',
        meta: 'Stops include Pretoria West, Kalafong, Atteridgeville and Saulsville.',
    },
    'germ-leralla': {
        body: 'Germiston toward Leralla calls at Ravensklip, Rhodesfield (near OR Tambo International Airport), Kempton Park, Tembisa and Limindlela.',
        meta: 'Stops include Germiston, Rhodesfield near OR Tambo, Kempton Park, Tembisa and Leralla.',
    },
    'germ-kwesine': {
        body: 'Germiston to Kwesine calls at Elsburg, Katlehong, Lindela and Pilot.',
        meta: 'Stops include Germiston, Elsburg, Katlehong and Kwesine.',
    },
    'pta-irene': {
        body: 'Pretoria to Irene calls at Sportpark and Centurion on the published weekday sheet.',
        meta: 'Stops include Pretoria, Centurion and Irene.',
    },
    'jhb-germiston': {
        body: 'Johannesburg to Germiston calls at Jeppe and Driehoek on the published weekday sheet.',
        meta: 'Stops include Johannesburg, Jeppe and Germiston.',
    },
    'pta-kempton': {
        body: 'Pretoria to Kempton Park calls at Sportpark, Centurion, Irene, Olifantsfontein and Oakmoor.',
        meta: 'Stops include Pretoria, Centurion, Irene, Olifantsfontein and Kempton Park.',
    },
    'jhb-rand': {
        body: 'Johannesburg to Randfontein calls at Braamfontein, Mayfair, Grosvenor, Langlaagte, Bosmont, Unified, Florida, Hamberg, Roodepoort, Princess, Luipaardsvlei and Krugersdorp.',
        meta: 'Stops include Johannesburg, Roodepoort, Krugersdorp and Randfontein.',
    },
    'jhb-soweto': {
        body: 'From Johannesburg the Soweto line calls at Braamfontein, Mayfair, Grosvenor, Langlaagte, Croesus, Longdale and New Canada, then Mzimhlophe, Phomolong, Phefeni, Dube, Ikwezi, Inhlazane, Merafe and Naledi.',
        meta: 'Stops include Johannesburg, New Canada, Dube and Naledi in Soweto.',
    },
    'jhb-midway': {
        body: 'Johannesburg to Lenz calls at Braamfontein, Mayfair, Grosvenor, Langlaagte, Croesus, Longdale, New Canada, Mlamlankunzi, Orlando, Nancefield, Kliptown, Tshiawelo and Midway.',
        meta: 'Stops include Johannesburg, Orlando, Kliptown, Midway and Lenz.',
    },
    'ct-chrishani': {
        body: 'Cape Town station is next to the Castle of Good Hope. This Khayelitsha line calls at Esplanade, Ysterplaat, Mutual, Langa, Bonteheuwel, Netreg, Heideveld, Nyanga, Philippi, Stock Road, Mandalay, Nolungile, Nonkqubela, Khayelitsha and Kuyasa, ending at Chris Hani.',
        meta: 'Cape Town to Chris Hani via Langa, Bonteheuwel, Nyanga, Philippi, Nolungile and Khayelitsha.',
    },
    'ct-kapteinsklip': {
        body: 'Cape Town to Kapteinsklip via Woodstock, Salt River, Koeberg Rd, Maitland, Ndabeni, Pinelands, Langa, Bonteheuwel, Netreg, Heideveld, Nyanga, Philippi, Lentegeur and Mitchell\'s Plain.',
        meta: 'Cape Town to Kapteinsklip via Langa, Nyanga, Lentegeur and Mitchell\'s Plain.',
    },
    'ct-nolu': {
        body: 'Cape Town to Nolungile via Esplanade, Ysterplaat, Mutual, Langa, Bonteheuwel, Netreg, Heideveld, Nyanga, Philippi, Stock Road and Mandalay.',
        meta: 'Cape Town to Nolungile via Langa, Bonteheuwel, Nyanga and Philippi.',
    },
    'bellville-mutual': {
        body: 'Bellville to Mutual calls at Sarepta, Pentech, Unibell, Belhar, Lavistown, Bonteheuwel and Langa.',
        meta: 'Stops include Bellville, Pentech, Unibell, Belhar, Langa and Mutual.',
    },
    'ct-simon': {
        body: 'Cape Town to Simon\'s Town follows the Southern Suburbs Line through Woodstock, Salt River, Observatory (near the Heart of Cape Town Museum), Mowbray, Rosebank, Rondebosch, Newlands (near Newlands Stadium), Claremont, Harfield Road, Kenilworth, Wynberg, Wittebome, Plumstead, Steurhof, Dieprivier, Heathfield, Retreat, Steenberg, Lakeside, False Bay, Muizenberg (Surfer\'s Corner), St James, Kalk Bay, Fish Hoek, Sunny Cove and Glencairn.',
        meta: 'Cape Town to Simon\'s Town via Observatory, Newlands, Wynberg, Muizenberg, Fish Hoek and Simon\'s Town.',
    },
    'ct-flats': {
        body: 'The Cape Flats line from Cape Town calls at Woodstock, Salt River, Koeberg Rd, Maitland, Ndabeni, Pinelands, Hazendal, Athlone, Crawford, Lansdowne, Wetton, Ottery, Southfield, Heathfield and Retreat.',
        meta: 'Cape Town to Retreat via Pinelands, Athlone, Lansdowne, Ottery and Southfield.',
    },
    'ct-bellv': {
        body: 'Cape Town to Bellville on the Northern Line via Esplanade, Ysterplaat, Kentemade, Century City, Akasia Park, Monte Vista, De Grendel, Avondale and Oosterzee.',
        meta: 'Cape Town to Bellville via Century City, Monte Vista and Oosterzee.',
    },
    'ct-kraai': {
        body: 'Cape Town to Kraaifontein via Woodstock, Salt River, Koeberg Rd, Maitland, Woltemade, Mutual, Thornton, Goodwood, Vasco, Elsies River, Parow, Tygerberg, Bellville, Stikland, Brackenfell and Eikenfontein.',
        meta: 'Cape Town to Kraaifontein via Goodwood, Parow, Bellville and Brackenfell.',
    },
    'ct-eerst': {
        body: 'Cape Town to Eerste River via Bellville, Kuils River, Blackheath and Meltonrose.',
        meta: 'Cape Town to Eerste River via Bellville, Kuils River and Blackheath.',
    },
    'ct-strnd': {
        body: 'Cape Town to Strand via Mutual, Goodwood, Vasco, Elsies River, Parow, Tygerberg, Bellville, Kuils River, Blackheath, Meltonrose, Eerste River, Faure, Firgrove, Somerset West and Van Der Stel.',
        meta: 'Cape Town to Strand via Bellville, Eerste River, Somerset West and Strand.',
    },
    'eerst-dtoit': {
        body: 'This Stellenbosch branch calls at Eerste River, Lynedoch, Vlottenburg, Stellenbosch and Du Toit. The published weekday sheet also lists the Cape Town to Eerste River mainline stops including Bellville, Kuils River and Blackheath.',
        meta: 'Eerste River to Du Toit via Lynedoch, Stellenbosch and Du Toit.',
    },
    'ct-well': {
        body: 'Cape Town to Wellington via Mutual, Goodwood, Bellville, Stikland, Brackenfell, Eikenfontein, Kraaifontein, Muldersvlei, Klapmuts, Paarl, Huguenot, Dal Josafat and Mbekweni.',
        meta: 'Cape Town to Wellington via Bellville, Kraaifontein, Paarl and Huguenot.',
    },
    'ct-malm': {
        body: 'Cape Town to Malmesbury via Century City, Monte Vista, Bellville, Stikland, Brackenfell, Eikenfontein, Kraaifontein, Fisantkraal, Mellish, Mikpunt, Klipheuwel, Wintervogel, Kalbaskraal and Abbotsdale.',
        meta: 'Cape Town to Malmesbury via Century City, Bellville, Kraaifontein and Klipheuwel.',
    },
    'kzn-umlazi': {
        body: 'Trains start at Durban Yard, then the passenger stop at Durban, before Berea Road, Dalbridge, Congella, Umbilo, Rossburgh, Clairwood, Montclair, Merebank, Reunion, Zwelethu, kwaMnyandu, Lindokuhle and Umlazi.',
        meta: 'Durban Yard and Durban to Umlazi via Berea Road, Rossburgh, Merebank, Reunion and kwaMnyandu.',
    },
    'kzn-bridgecity': {
        body: 'From Berea Road and Durban this north corridor calls at Moses Mabhida (near Moses Mabhida Stadium), Umgeni, Briardene, Greenwood Park, Red Hill, Avoca, Duff\'s Road, Tembalihle, kwaMashu and Bridge City.',
        meta: 'Durban to Bridge City via Moses Mabhida, Greenwood Park, kwaMashu and Bridge City.',
    },
    'kzn-winklespruit': {
        body: 'Durban to Winklespruit on the South Coast via Berea Road, Rossburgh, Clairwood, Montclair, Merebank, Reunion, Pelgrim, Isipingo, Umbogintwini, Pahla, Amanzimtoti, Doonside and Warner Beach.',
        meta: 'Durban to Winklespruit via Isipingo, Amanzimtoti, Doonside and Warner Beach.',
    },
    'kzn-catoridge': {
        body: 'Durban to Cato Ridge via Durban Yard, Berea Road, Rossburgh, Mount Vernon, Cavendish, Burlington, Shallcross, Klaarwater, Mariannhill, Thornwood, Situndu Hills, Dassenhoek, kwaNdengezi, Delville Wood, Nshongweni, Cliffdale, Hammarsdale, kwaTandaza and Georgedale.',
        meta: 'Durban to Cato Ridge via Mariannhill, Hammarsdale and Cato Ridge.',
    },
    'kzn-pinetown': {
        body: 'Durban to Pinetown via Berea Road, Rossburgh, Sea View, Bellair, Hillary, Malvern, Escombe, Northdene, Moseley and Glen Park.',
        meta: 'Durban to Pinetown via Sea View, Bellair, Hillary, Malvern and Pinetown.',
    },
    'kzn-crossmoor': {
        body: 'Durban to Crossmoor via Berea Road, Rossburgh, Clairwood, Montclair, Merebank, Havenside, Bayview, Westcliff and Chatsglen.',
        meta: 'Durban to Crossmoor via Havenside, Bayview, Westcliff and Chatsglen.',
    },
    'ec-berlin': {
        body: 'East London to Berlin calls at Southernwood, Panmure, Chiselhurst, Vincent, Cambridge, Highgate, Horseshoe, Dawn, Wilsonia, Arnoldton, Mtsotso, Mdantsane, Mount Ruth, Egerton, Fort Jackson and Lonetree.',
        meta: 'East London to Berlin via Cambridge, Mdantsane, Mount Ruth and Fort Jackson.',
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
    serves: SEO_SERVES[routeId]?.body || '',
    nearby: SEO_SERVES[routeId]?.meta || '',
}));

function buildSeedForRoute(route) {
    const override = SEO_OVERRIDES[route.id];
    const serve = SEO_SERVES[route.id];
    const origin = stationLabel(route.destA);
    const dest = stationLabel(route.destB);
    const province = regionName(route.region);
    return {
        slug: override?.slug || slugForRoute(route),
        routeId: route.id,
        blurb:
            override?.blurb ||
            `Live Metrorail train times for ${origin} to ${dest} (${province}). Open Next Train for the next departure, fares, and full timetable.`,
        operatingNote:
            override?.operatingNote ||
            (route.region === 'WC' && route.sheetKeys?.pub_to_a
                ? 'Western Cape uses a dedicated Public Holiday timetable on most public holidays. Sundays and a few holidays such as Christmas Day have no service.'
                : DEFAULT_OPERATING_NOTE),
        serves: serve?.body || '',
        nearby: serve?.meta || '',
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

/** Unique parent corridors that have at least one active route. */
export function listSeoCorridors() {
    const bySlug = new Map();
    for (const [corridorId, meta] of Object.entries(CORRIDOR_META)) {
        if (!bySlug.has(meta.slug)) {
            bySlug.set(meta.slug, {
                slug: meta.slug,
                label: meta.label,
                region: meta.region,
                corridorIds: [corridorId],
            });
        } else {
            bySlug.get(meta.slug).corridorIds.push(corridorId);
        }
    }

    return [...bySlug.values()]
        .map((c) => {
            const routes = listSeoRoutes().filter(
                ({ route }) => route.corridorId && c.corridorIds.includes(route.corridorId)
            );
            return {
                ...c,
                regionLabel: regionName(c.region),
                blurb: `${c.label} Metrorail routes in ${regionName(c.region)}. Open Next Train for live boards and full weekend/weekday grids.`,
                routes,
            };
        })
        .filter((c) => c.routes.length > 0)
        .sort((a, b) => {
            if (a.region !== b.region) return String(a.region).localeCompare(String(b.region));
            return a.label.localeCompare(b.label);
        });
}

export function getSeoCorridorBySlug(slug) {
    return listSeoCorridors().find((c) => c.slug === slug) || null;
}

/** Regional hub pages (Gauteng, Western Cape, …). */
export function listSeoRegions() {
    return Object.entries(REGION_SEO)
        .map(([region, meta]) => {
            const routes = listSeoRoutes().filter(({ route }) => route.region === region);
            const corridors = listSeoCorridors().filter((c) => c.region === region);
            return {
                region,
                slug: meta.slug,
                title: meta.title,
                blurb: meta.blurb,
                regionLabel: regionName(region),
                routes,
                corridors,
            };
        })
        .filter((r) => r.routes.length > 0);
}

export function getSeoRegionBySlug(slug) {
    return listSeoRegions().find((r) => r.slug === slug) || null;
}

/** Western Cape dedicated Public Holiday sheets. Other regions do not have this page. */
export const WC_PUBLIC_HOLIDAYS_SLUG = 'western-cape-public-holidays';
export const WC_PUBLIC_HOLIDAYS_PATH = `regions/${WC_PUBLIC_HOLIDAYS_SLUG}.html`;

/**
 * 2026 Western Cape public-holiday service. Only WC has *_pub sheets.
 * Sunday-mapped holidays have no trains. Do not list GP / KZN / EC holiday grids.
 */
export function listWcPublicHolidayDays(year = 2026) {
    return Object.keys(HOLIDAY_NAMES)
        .sort()
        .map((md) => {
            const name = HOLIDAY_NAMES[md];
            const mapped = SPECIAL_DATES[md];
            const iso = `${year}-${md}`;
            if (mapped === 'sunday') {
                return {
                    md,
                    iso,
                    name,
                    dayType: 'sunday',
                    runs: false,
                    note: 'No Metrorail service',
                };
            }
            return {
                md,
                iso,
                name,
                dayType: 'public_holiday',
                runs: true,
                note: 'Public Holiday timetable',
            };
        });
}

export function wcRoutesWithHolidaySheets() {
    return listSeoRoutes().filter(
        ({ route }) => route.region === 'WC' && route.sheetKeys?.pub_to_a && route.sheetKeys?.pub_to_b
    );
}

/**
 * High-impression origin–destination landings (Search Console long-tail).
 * Used for crawlable internal links from home / guide.
 */
export const FEATURED_SEO_ROUTE_IDS = [
    'jhb-soweto',
    'pta-mabopane',
    'pta-pien',
    'pta-saul',
    'ct-strnd',
    'ct-bellv',
    'ct-simon',
    'kzn-umlazi',
];

export function listFeaturedSeoRoutes() {
    const byId = new Map(listSeoRoutes().map((entry) => [entry.route.id, entry]));
    return FEATURED_SEO_ROUTE_IDS.map((id) => byId.get(id)).filter(Boolean);
}

export { getCorridorLabel };
