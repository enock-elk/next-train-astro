/**
 * Station / suburb alias landings for queries that name a stop, not the termini.
 * Each page reuses the parent corridor timetable. No invented routes or stops.
 */
import { ROUTES } from './config.js';
import { displayRouteName, listSeoRoutes, regionName, stationLabel } from './seo-routes.js';

/**
 * @typedef {{
 *   slug: string,
 *   place: string,
 *   heading: string,
 *   fromLabel: string,
 *   toLabel: string,
 *   parentRouteId: string,
 *   clockedStations: string[],
 *   blurb: string,
 * }} SeoStationAlias
 */

/** High-impression GSC station/suburb queries that sit on a real sheet. */
export const SEO_STATION_ALIASES = [
    {
        slug: 'mamelodi',
        place: 'Mamelodi',
        heading: 'Mamelodi train times',
        fromLabel: 'Mamelodi',
        toLabel: 'Pretoria',
        parentRouteId: 'pta-pien',
        clockedStations: ['Denneboom', 'Eerste Fabrieke', 'Mamelodi Gardens', 'Pienaarspoort'],
        blurb:
            'Mamelodi is on the Pretoria to Pienaarspoort Metrorail corridor. Published stops in Mamelodi are Denneboom, Eerste Fabrieke, Mamelodi Gardens and Pienaarspoort. Times below are that corridor sheet, not a separate Mamelodi-only timetable.',
    },
    {
        slug: 'mamelodi-gardens',
        place: 'Mamelodi Gardens',
        heading: 'Mamelodi Gardens train station',
        fromLabel: 'Mamelodi Gardens',
        toLabel: 'Pretoria',
        parentRouteId: 'pta-pien',
        clockedStations: ['Mamelodi Gardens'],
        blurb:
            'Mamelodi Gardens is a published stop on the Pretoria to Pienaarspoort corridor, in Mamelodi. Times below are that corridor sheet.',
    },
    {
        slug: 'mabopane',
        place: 'Mabopane',
        heading: 'Mabopane station train times',
        fromLabel: 'Mabopane',
        toLabel: 'Pretoria',
        parentRouteId: 'pta-mabopane',
        clockedStations: ['Mabopane'],
        blurb:
            'Mabopane station is the outer terminus of the Pretoria to Mabopane Metrorail corridor. Times below are that corridor sheet.',
    },
    {
        slug: 'pretoria-north',
        place: 'Pretoria North',
        heading: 'Pretoria North train station',
        fromLabel: 'Pretoria North',
        toLabel: 'Pretoria',
        parentRouteId: 'pta-mabopane',
        clockedStations: ['Pretoria North'],
        blurb:
            'Pretoria North is a published stop on the Pretoria to Mabopane corridor. Times below are that corridor sheet.',
    },
    {
        slug: 'naledi',
        place: 'Naledi',
        heading: 'Naledi train station',
        fromLabel: 'Naledi',
        toLabel: 'Johannesburg',
        parentRouteId: 'jhb-soweto',
        clockedStations: ['Naledi'],
        blurb:
            'Naledi station is the Soweto terminus of the Johannesburg to Naledi Metrorail corridor. Times below are that corridor sheet.',
    },
    {
        slug: 'tembisa',
        place: 'Tembisa',
        heading: 'Tembisa train station',
        fromLabel: 'Tembisa',
        toLabel: 'Germiston',
        parentRouteId: 'germ-leralla',
        clockedStations: ['Tembisa'],
        blurb:
            'Tembisa is a published stop on the Germiston to Leralla corridor. Times below are that corridor sheet, not a separate Tembisa-only timetable.',
    },
    {
        slug: 'irene',
        place: 'Irene',
        heading: 'Irene train station',
        fromLabel: 'Irene',
        toLabel: 'Pretoria',
        parentRouteId: 'pta-irene',
        clockedStations: ['Irene'],
        blurb:
            'Irene station is the outer terminus of the Pretoria to Irene Metrorail corridor. Times below are that corridor sheet.',
    },
    {
        slug: 'saulsville',
        place: 'Saulsville',
        heading: 'Saulsville train station',
        fromLabel: 'Saulsville',
        toLabel: 'Pretoria',
        parentRouteId: 'pta-saul',
        clockedStations: ['Saulsville'],
        blurb:
            'Saulsville station is the outer terminus of the Pretoria to Saulsville Metrorail corridor. Times below are that corridor sheet.',
    },
    {
        slug: 'hercules',
        place: 'Hercules',
        heading: 'Hercules train station',
        fromLabel: 'Hercules',
        toLabel: 'Pretoria',
        parentRouteId: 'pta-mabopane',
        clockedStations: ['Hercules'],
        blurb:
            'Hercules is a published stop on the Pretoria to Mabopane corridor. Times below are that corridor sheet. A shorter Hercules to Koedoespoort sheet also exists.',
    },
    {
        slug: 'kopanong',
        place: 'Kopanong',
        heading: 'Kopanong train station',
        fromLabel: 'Kopanong',
        toLabel: 'Pretoria',
        parentRouteId: 'pta-mabopane',
        clockedStations: ['Kopanong'],
        blurb:
            'Kopanong is a published stop on the Pretoria to Mabopane corridor. Times below are that corridor sheet.',
    },
];

export function listSeoStationAliases() {
    const byId = new Map(listSeoRoutes().map((entry) => [entry.route.id, entry]));
    return SEO_STATION_ALIASES.map((alias) => {
        const parent = byId.get(alias.parentRouteId) || null;
        const route = parent?.route || ROUTES[alias.parentRouteId] || null;
        return {
            alias,
            parent,
            route,
            parentName: route ? displayRouteName(route) : alias.place,
            province: route ? regionName(route.region) : 'South Africa',
            origin: route ? stationLabel(route.destA) : '',
            dest: route ? stationLabel(route.destB) : '',
        };
    }).filter((row) => row.route && row.route.isActive);
}

export function getSeoStationAliasBySlug(slug) {
    return listSeoStationAliases().find((row) => row.alias.slug === slug) || null;
}

export function listSeoStationAliasesForRoute(routeId) {
    return listSeoStationAliases().filter((row) => row.alias.parentRouteId === routeId);
}
