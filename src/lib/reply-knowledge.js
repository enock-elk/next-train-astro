/**
 * Facts the suggest-a-reply draft may use.
 * Built from the same route config, fare table, and public route pages the app ships.
 * Route keys stay internal. The draft must say station names.
 */
import {
    CORRIDOR_META,
    FARE_CONFIG,
    HERC_KOED_JUNCTIONS,
    REGIONS,
    ROUTES,
    SATURDAY_PLACEHOLDER_ROUTES,
} from './config.js';
import {
    CORRIDOR_INSIGHTS,
    CORRIDOR_PAGE_COPY,
    displayRouteName,
    listSeoRoutes,
    listWcPublicHolidayDays,
} from './seo-routes.js';

function stationPlain(raw) {
    return String(raw || '').replace(/ STATION/gi, '').replace(/\s+/g, ' ').trim();
}

function zar(n) {
    return `R${Number(n).toFixed(2)}`;
}

export function describeRoute(routeId) {
    const route = ROUTES[String(routeId || '').trim()];
    if (!route || !route.isActive || route.id === 'special_event') return '';
    const name = displayRouteName(route);
    const region = REGIONS[route.region]?.name || route.region || 'unknown region';
    const corridor = CORRIDOR_META[route.corridorId]?.label || '';
    const ends = [stationPlain(route.destA), stationPlain(route.destB)].filter(Boolean).join(' and ');
    const bits = [`${route.id} is ${name} in ${region}`];
    if (corridor) bits.push(`on the ${corridor}`);
    if (ends) bits.push(`between ${ends}`);
    const transfer = stationPlain(route.transferStation);
    const relay = stationPlain(route.relayStation);
    if (transfer) bits.push(`change at ${transfer}`);
    if (relay && relay !== transfer) bits.push(`relay at ${relay}`);
    if (SATURDAY_PLACEHOLDER_ROUTES.includes(route.id)) {
        bits.push('this line has no Saturday trains and no public-holiday trains');
    } else if (route.region === 'WC' && route.sheetKeys?.pub_to_a) {
        bits.push('weekday, Saturday, and Western Cape public-holiday sheets');
    } else {
        bits.push('weekday and Saturday sheets');
    }
    return `${bits.join(', ')}.`;
}

function fareText() {
    const bands = FARE_CONFIG.zone_km_max || {};
    const zones = FARE_CONFIG.zones_detailed || {};
    const rows = Object.keys(zones).map((code) => {
        const price = zones[code];
        const km = code === 'Z1'
            ? `1 to ${bands.Z1} km`
            : code === 'Z2'
                ? `${bands.Z1 + 1} to ${bands.Z2} km`
                : code === 'Z3'
                    ? `${bands.Z2 + 1} to ${bands.Z3} km`
                    : `over ${bands.Z3} km`;
        return `${code} (${km}): single ${zar(price.single)}, return ${zar(price.return)}, weekly Mon-Fri ${zar(price.weekly_mon_fri)}, weekly Mon-Sat ${zar(price.weekly_mon_sat)}, monthly ${zar(price.monthly)}.`;
    });
    return [
        'Fares are the adult cash prices in Next Train, effective 1 August 2025. Tickets are bought with cash at the station. The app does not sell tickets.',
        'The price shown for a trip is often the maximum for that line, terminus to terminus. A shorter trip can cost less at the station.',
        ...rows,
        'Off-peak is weekdays only, trains departing from 09:30 to 14:30. It is not 09:00 to 14:00. No off-peak discount on Saturday, Sunday, or a public holiday.',
        'Adults: 40% off single and return in that off-peak window.',
        'Scholars in uniform: 50% off single and return whenever trains run. A scholar weekly or monthly pass is the adult price.',
        'Pensioners, and military veterans who show a Force Number plus an ID or letter: 50% off single and return in the off-peak window. Their weekly and monthly passes stay the adult price.',
        'Weekly and monthly tickets include the return trip each day.',
        'This knowledge base does not say whether a monthly ticket ends on the last calendar day or a fixed number of days after purchase. If they ask why a monthly ticket bought on the 14th ends on the 31st, halt and ask, unless Context for this draft or an attached photo or PDF states the rule.',
        'From 31 May 2026, selected Gauteng ticket offices have opened on the last Sunday of the month, 08:00 to 16:00, for weekly and monthly tickets. South: Naledi, Merafe, Ikwezi, Kwesine, Leralla, Tembisa. North: Mabopane, Kopanong, Saulsville, Pienaarspoort, Mamelodi Gardens. Do not promise that Sunday sale in Western Cape, KwaZulu-Natal, or Eastern Cape. That notice also said not to cover the ticket in plastic, and quoted a R40 fine for riding with no ticket.',
    ].join('\n');
}

function holidayText() {
    const days = listWcPublicHolidayDays(2026);
    const lines = days.map((day) => `${day.label} ${day.name}: ${day.runs ? 'Saturday or public-holiday sheet where that region has one' : 'no service'}.`);
    return [
        'There is no Sunday train service.',
        'Public holidays are not always the same as Saturday. In Gauteng, KwaZulu-Natal, and Eastern Cape, a holiday mapped to Saturday follows the Saturday sheet. A holiday mapped to Sunday has no service. Western Cape may use its Public Holiday sheet instead of Saturday. PRASA announces which.',
        '2026 holidays:',
        ...lines,
        'Hercules to Koedoespoort (herc-koed) and East London to Berlin (ec-berlin) have no Saturday trains and no public-holiday trains, even when other lines run.',
        `Hercules and Koedoespoort (${HERC_KOED_JUNCTIONS.join(' and ')}) are junctions. They still have Saturday trains on other routes, so a change via Pretoria can still work. A station that exists only on herc-koed, such as Gezina, has no Saturday service.`,
    ].join('\n');
}

function linkText() {
    return [
        'How lines meet. Do not invent a transfer that is not listed here.',
        'There is no single Pretoria to Johannesburg train. Change twice: a Johannesburg-side train into Germiston, the Germiston to Kempton Park working on the Leralla line, then a Pretoria-line train from Kempton Park.',
        'East of Pretoria and north of Pretoria meet via Koedoespoort and Hercules. The herc-koed line itself has no weekend trains. The stations Hercules and Koedoespoort still connect on other routes.',
        'Johannesburg to Randfontein is a shuttle. Change at Roodepoort.',
        'A direct trip stays on one train. A transfer means alighting at a hub such as Germiston, Koedoespoort, or Kempton Park and boarding another line.',
        'No Svc on a greyed train means that train number is cancelled or suspended for the day.',
        'Line severed means the tracks are blocked. Trains may turn back early.',
        'Extended layover means a transfer wait over about four hours. The trip is still listed.',
        'If the planner says there is no physical connection, it has no transfer inside the province. It cannot plan Pretoria to Cape Town.',
    ].join('\n');
}

function routeMapText() {
    const byCorridor = new Map();
    const routeLines = [];
    for (const { seed, route } of listSeoRoutes()) {
        if (!route?.isActive) continue;
        const brief = describeRoute(route.id);
        const extra = [seed?.serves, seed?.insight].filter(Boolean).join(' ');
        routeLines.push(extra ? `${brief} ${extra}` : brief);
        const key = route.corridorId || 'OTHER';
        if (!byCorridor.has(key)) byCorridor.set(key, []);
        byCorridor.get(key).push(`${route.id} ${displayRouteName(route)}`);
    }
    const corridors = [];
    for (const [id, names] of byCorridor) {
        const meta = CORRIDOR_META[id];
        const label = meta?.label || id;
        const region = REGIONS[meta?.region]?.name || meta?.region || '';
        const copy = CORRIDOR_PAGE_COPY[meta?.slug];
        const insight = CORRIDOR_INSIGHTS[meta?.slug];
        const head = `${label}${region ? ` (${region})` : ''}: ${names.join('; ')}.`;
        corridors.push([head, copy?.lead, insight].filter(Boolean).join(' '));
    }
    return [
        'Route keys used in the app. pta-pien is Pretoria to Pienaarspoort. Never put a route key in the reply.',
        'Region map, routes on each corridor:',
        ...corridors,
        'Each route, its key, its stations, and its notes:',
        ...routeLines,
    ].join('\n');
}

function guideText() {
    return [
        'Next Train is a commuter app at nexttrain.co.za, developed independently. It does not run the trains. When a reply needs that fact, keep it to one short sentence.',
        'Once opened online, schedules stay on the phone, so times can be checked offline or during loadshedding. Station lights and ticket offices can still be affected.',
        'It installs from the website: iPhone uses Safari, Share, Add to Home Screen. Android uses Install App in The Background. Android is also in Google Play testing.',
        'Supported corridors: Gauteng (Pretoria, Johannesburg, Germiston, Kempton Park, Mabopane), Western Cape (Cape Town, Bellville, Simon\'s Town), KwaZulu-Natal (Durban, Umlazi, KwaMashu, Crossmoor), Eastern Cape (East London).',
        'A wrong time is reported with the in-app Feedback button. App support email is admin@nexttrain.co.za. Broken trains, closed ticket offices, and infrastructure go to PRASA, and the commuter should ask for a reference number. Metrorail KZN Customer Service desk: 031 813 0456. PRASA EC East London: 043 700 2030, email ntombikayise.katsio@prasa.com, Facebook PRASA EC (Station building, Station Street, East London, 5200).',
        'Eastern Cape still runs older yellow and grey Metrorail sets, often hauled by Class 35 diesel locomotives from the early 1980s. Gauteng, Western Cape, and KwaZulu-Natal already run the newer blue People\'s Train EMUs on many corridors. PRASA EC has been restoring East London stations after theft and vandalism (about seven refurbished, including Wilsonia), with security on stations and on board. Weekday East London to Berlin still has no Saturday trains.',
        'The True Day Simulator applies the 2026 holiday and route rules. The commuter does not have to guess the day type.',
    ].join('\n');
}

export function replyKnowledgeText() {
    return [
        guideText(),
        fareText(),
        holidayText(),
        linkText(),
        routeMapText(),
    ].join('\n');
}
