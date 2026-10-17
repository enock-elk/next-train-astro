/**
 * Operator brief. Built only when an operator opens it.
 * Counts come from logs the app already keeps. Google Analytics is not in here.
 * The written note is optional and must not invent a date the digest does not have.
 */
import { GRANTABLE_FEATURES } from './features.js';
import { HOLIDAY_NAMES, ROUTES, SATURDAY_PLACEHOLDER_ROUTES, SPECIAL_DATES } from './config.js';
import { CORRIDOR_INSIGHTS, SEO_INSIGHTS, displayRouteName, listSeoCorridors } from './seo-routes.js';

export const BRIEF_DISMISS_KEY = 'nt_operator_brief_hidden_day';
export const BRIEF_LOOKAHEAD_DAYS = 2;
const DIGEST_MAX = 12000;

const FEATURE_LABELS = Object.fromEntries(
    GRANTABLE_FEATURES.map((item) => [item.key, item.label])
);

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function scrubOperatorText(value, max = 500) {
    return String(value || '')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b(?:\+?27|0)\d[\d\s-]{7,}\d\b/g, '[phone]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [token]')
        .replace(/eyJ[A-Za-z0-9_-]{20,}/g, '[token]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

export function johannesburgClock(now = Date.now()) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Johannesburg',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
        fmt.formatToParts(new Date(now)).map((part) => [part.type, part.value])
    );
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    return {
        year,
        month,
        day,
        weekday: parts.weekday,
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        key: `${parts.year}-${parts.month}-${parts.day}`,
        label: new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Africa/Johannesburg',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        }).format(new Date(now)),
    };
}

function clockFromParts(year, month, day, hour = 12) {
    return johannesburgClock(Date.UTC(year, month - 1, day, hour - 2, 0, 0));
}

function addDays(clock, days) {
    return clockFromParts(clock.year, clock.month, clock.day + days, 12);
}

function sameDay(a, b) {
    return a.year === b.year && a.month === b.month && a.day === b.day;
}

function dayPhrase(clock, target) {
    if (sameDay(clock, target)) return 'Today';
    const tomorrow = addDays(clock, 1);
    if (sameDay(tomorrow, target)) return 'Tomorrow';
    return target.label;
}

function firstMonday(year, month) {
    for (let day = 1; day <= 7; day += 1) {
        const clock = clockFromParts(year, month, day, 12);
        if (clock.weekday === 'Mon' && clock.month === month) return clock;
    }
    return clockFromParts(year, month, 1, 12);
}

function monthDayKey(clock) {
    return `${String(clock.month).padStart(2, '0')}-${String(clock.day).padStart(2, '0')}`;
}

export function greetingForHour(hour) {
    const n = Number(hour);
    if (n < 5) return 'Night brief';
    if (n < 12) return 'Morning brief';
    if (n < 17) return 'Afternoon brief';
    if (n < 22) return 'Evening brief';
    return 'Night brief';
}

export function briefDismissed(storage, now = Date.now()) {
    try {
        return storage?.getItem(BRIEF_DISMISS_KEY) === johannesburgClock(now).key;
    } catch {
        return false;
    }
}

export function dismissBrief(storage, now = Date.now()) {
    try { storage?.setItem(BRIEF_DISMISS_KEY, johannesburgClock(now).key); } catch { /* ignore */ }
}

export function restoreBrief(storage) {
    try { storage?.removeItem(BRIEF_DISMISS_KEY); } catch { /* ignore */ }
}

const REGION_NAMES = {
    GP: 'Gauteng',
    WC: 'Western Cape',
    KZN: 'KwaZulu-Natal',
    EC: 'Eastern Cape',
};

function countryInsightCard() {
    const byRegion = { GP: [], WC: [], KZN: [], EC: [] };
    const push = (code, line) => {
        if (code && byRegion[code] && line) byRegion[code].push(line);
    };
    Object.entries(SEO_INSIGHTS).forEach(([routeId, text]) => {
        const route = ROUTES[routeId];
        const name = displayRouteName(route);
        push(route?.region, `${name}. ${String(text || '').trim()}`);
    });
    const corridors = listSeoCorridors();
    Object.entries(CORRIDOR_INSIGHTS).forEach(([slug, text]) => {
        const corridor = corridors.find((row) => row.slug === slug);
        const code = corridor?.region || '';
        const label = corridor?.label || 'Corridor';
        push(code, `${label}. ${String(text || '').trim()}`);
    });
    const details = Object.entries(byRegion).map(([code, rows]) => (
        rows.length
            ? `${REGION_NAMES[code]}: ${rows.join(' ')}`
            : `${REGION_NAMES[code]}: no extra corridor note on the route pages.`
    ));
    return {
        id: 'country',
        kicker: 'Across the country',
        tone: 'calm',
        title: 'Corridor notes from the route pages',
        body: 'Gauteng, Western Cape, KwaZulu-Natal, and Eastern Cape, from the notes already on those pages.',
        details,
        region: '',
    };
}

export function alertDraftFromBriefCard(card) {
    const title = String(card?.title || '').trim();
    const parts = [card?.body, ...(Array.isArray(card?.details) ? card.details : [])]
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .filter((line, index, list) => list.indexOf(line) === index);
    const message = `${title ? `<h3>${esc(title)}</h3>` : ''}${parts.map((line) => `<p>${esc(line)}</p>`).join('')}`;
    const region = ['GP', 'WC', 'KZN', 'EC'].includes(card?.region) ? card.region : '';
    return {
        title,
        message,
        target: region ? `all_${region}` : 'all',
        severity: card?.tone === 'watch' ? 'warning' : 'info',
    };
}

export function upcomingOpsNotes(now = Date.now()) {
    const clock = johannesburgClock(now);
    const notes = [];
    const seen = new Set();
    for (let offset = 0; offset <= 1; offset += 1) {
        const day = addDays(clock, offset);
        const when = dayPhrase(clock, day);
        const monday = firstMonday(day.year, day.month);
        if (sameDay(day, monday)) {
            const id = `cato-${day.key}`;
            if (!seen.has(id)) {
                seen.add(id);
                notes.push({
                    id,
                    kicker: 'Ahead',
                    tone: 'watch',
                    title: `${when}, Cato Ridge has no booked Metrorail`,
                    body: 'Transnet takes the Cato Ridge line on the first Monday of the month. No Metrorail is booked unless PRASA says otherwise.',
                    details: ['KwaZulu-Natal: Cato Ridge has no booked Metrorail unless PRASA says otherwise.'],
                    region: 'KZN',
                });
            }
        }
        if (day.weekday === 'Sat') {
            notes.push({
                id: `sat-${day.key}`,
                kicker: 'Ahead',
                tone: 'watch',
                title: `${when} has no trains on two lines`,
                body: 'Hercules to Koedoespoort and East London to Berlin have no Saturday trains and no public-holiday trains. Hercules and Koedoespoort still have Saturday trains on other routes.',
                details: [
                    'Gauteng: Hercules to Koedoespoort has no Saturday trains. Other routes at those stations still run.',
                    'Eastern Cape: East London to Berlin has no Saturday trains.',
                ],
            });
        }
        if (day.weekday === 'Mon' || day.weekday === 'Fri') {
            notes.push({
                id: `blue-${day.key}`,
                kicker: 'Ahead',
                tone: 'calm',
                title: `${when}, trains 0618 and 0619 do not run`,
                body: 'Those two stay off on Mondays and Fridays so the Blue Train and Rovos Rail can pass. Tuesday to Thursday they run.',
                details: ['Gauteng: trains 0618 and 0619 stay off so the Blue Train and Rovos Rail can pass.'],
                region: 'GP',
            });
        }
        if (day.weekday === 'Wed') {
            notes.push({
                id: `wed-${day.key}`,
                kicker: 'Check the sheet',
                tone: 'calm',
                title: `${when} may hold some KwaZulu-Natal off-peak trains`,
                body: 'Bridge City holds some off-peak trains on selected Wednesdays. Umlazi and Winklespruit hold some off-peak trains on selected days. The pages do not name which day. Check that sheet before you post a notice.',
                details: ['KwaZulu-Natal: the pages do not name which day. Check that sheet before you post a notice.'],
                region: 'KZN',
            });
        }
        const holidayKey = monthDayKey(day);
        const holidayType = SPECIAL_DATES[holidayKey];
        const holidayName = HOLIDAY_NAMES[holidayKey];
        if (holidayType && holidayName) {
            const noService = holidayType === 'sunday';
            notes.push({
                id: `hol-${day.key}`,
                kicker: 'Ahead',
                tone: noService ? 'watch' : 'calm',
                title: `${when} is ${holidayName}`,
                body: noService
                    ? 'That day has no service.'
                    : 'Gauteng, KwaZulu-Natal, and Eastern Cape follow the Saturday sheet. Western Cape may use the public-holiday sheet or the Saturday sheet. Hercules to Koedoespoort and East London to Berlin stay closed.',
                details: noService
                    ? ['No service in Gauteng, Western Cape, KwaZulu-Natal, or Eastern Cape.']
                    : [
                        'Gauteng, KwaZulu-Natal, and Eastern Cape follow the Saturday sheet.',
                        'Western Cape may use the public-holiday sheet or the Saturday sheet.',
                    ],
            });
        }
    }
    notes.push(countryInsightCard());
    return notes;
}

function asList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'object') return Object.values(value).filter(Boolean);
    return [];
}

function topEntries(map, limit = 3) {
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function stationPlain(value) {
    return String(value || '').replace(/ STATION/gi, '').replace(/\s+/g, ' ').trim();
}

export function summarizeTrips(rows, pairs, usersEver = 0) {
    const list = asList(rows);
    const pairIndex = pairs && typeof pairs === 'object' && !Array.isArray(pairs) ? pairs : {};
    const regionCounts = {};
    const dayCounts = {};
    const pairCounts = {};
    let saturday = 0;
    let noSaturdayLine = 0;
    let cato = 0;
    let direct = 0;
    let transfer = 0;
    const users = new Set();
    list.forEach((row) => {
        const origin = stationPlain(row.origin);
        const dest = stationPlain(row.destination || row.dest);
        const region = String(row.region || '').toUpperCase();
        const day = String(row.dayType || 'unknown');
        if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;
        dayCounts[day] = (dayCounts[day] || 0) + 1;
        if (origin && dest) {
            const key = `${origin} to ${dest}`;
            pairCounts[key] = (pairCounts[key] || 0) + 1;
        }
        if (day === 'saturday' || day === 'sat') saturday += 1;
        const routes = Array.isArray(row.routeIds) ? row.routeIds : [];
        if ((day === 'saturday' || day === 'public_holiday') && routes.some((id) => SATURDAY_PLACEHOLDER_ROUTES.includes(id))) {
            noSaturdayLine += 1;
        }
        const blob = `${origin} ${dest}`.toUpperCase();
        if (blob.includes('CATO')) cato += 1;
        const hops = Number(row.transfers || 0);
        if (hops > 0) transfer += 1;
        else direct += 1;
        if (row.userId || row.deviceId) users.add(String(row.userId || row.deviceId));
    });
    const recentPairs = Object.values(pairIndex)
        .filter((pair) => pair && (pair.origin || pair.destination))
        .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0))
        .slice(0, 5)
        .map((pair) => `${stationPlain(pair.origin)} to ${stationPlain(pair.destination)}`);
    const top = topEntries(pairCounts, 3);
    const topRegion = topEntries(regionCounts, 1)[0];
    return {
        sample: list.length,
        usersInSample: users.size,
        usersEver: Number(usersEver) || 0,
        pairsEver: Object.keys(pairIndex).length,
        saturday,
        noSaturdayLine,
        cato,
        direct,
        transfer,
        top,
        topRegion: topRegion ? { code: topRegion[0], count: topRegion[1] } : null,
        recentPairs,
        dayCounts,
    };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function withinWeek(row, now) {
    const at = Number(row?.timestamp || row?.at || row?.exportedAt || 0);
    if (!at) return true;
    return at >= now - WEEK_MS;
}

export function summarizeFails(fails, now = Date.now()) {
    const list = asList(fails).filter((row) => withinWeek(row, now));
    const reasons = {};
    const pairs = {};
    list.forEach((row) => {
        const reason = String(row.reason || 'UNKNOWN');
        reasons[reason] = (reasons[reason] || 0) + 1;
        const origin = stationPlain(row.origin);
        const dest = stationPlain(row.destination || row.dest);
        if (origin && dest) {
            const key = `${origin} to ${dest}`;
            pairs[key] = (pairs[key] || 0) + 1;
        }
    });
    return {
        sample: list.length,
        reasons: topEntries(reasons, 4),
        pairs: topEntries(pairs, 3),
    };
}

export function summarizeFares(votes) {
    const list = asList(votes);
    let agree = 0;
    let disagree = 0;
    let widest = null;
    const types = {};
    list.forEach((row) => {
        if (row.agree) agree += 1;
        else disagree += 1;
        const type = String(row.ticketType || 'single');
        types[type] = (types[type] || 0) + 1;
        const quoted = Number(row.quotedPrice);
        const reported = Number(row.reportedPrice);
        if (!Number.isFinite(quoted) || !Number.isFinite(reported)) return;
        const gap = Math.abs(reported - quoted);
        if (!widest || gap > widest.gap) {
            widest = {
                gap,
                origin: stationPlain(row.origin),
                destination: stationPlain(row.destination || row.dest),
                quoted,
                reported,
                ticketType: type,
            };
        }
    });
    return { sample: list.length, agree, disagree, widest, types };
}

export function summarizeCrashes(crashes, now = Date.now()) {
    const list = asList(crashes)
        .map((row) => ({
            id: String(row.id || ''),
            error: scrubOperatorText(row.error || row.preview || 'Crash report', 180),
            version: String(row.appVersion || ''),
            at: Number(row.timestamp || row.exportedAt || 0),
        }))
        .filter((row) => (row.id || row.error) && withinWeek(row, now))
        .sort((a, b) => b.at - a.at)
        .slice(0, 8);
    const versions = {};
    list.forEach((row) => {
        if (row.version) versions[row.version] = (versions[row.version] || 0) + 1;
    });
    return { sample: list.length, recent: list, versions };
}

export function summarizeFeatures(features) {
    const bag = features && typeof features === 'object' ? features : {};
    return Object.keys(FEATURE_LABELS).map((key) => {
        const entry = bag[key];
        const on = entry === true || entry?.enabled === true;
        const routes = Array.isArray(entry?.routeIds) ? entry.routeIds.map(String) : [];
        const regions = Array.isArray(entry?.regionIds) ? entry.regionIds.map(String) : [];
        let scope = 'off';
        if (on && routes.includes('*')) scope = 'on for every route';
        else if (on) {
            const names = [...regions, ...routes].filter((id) => id && id !== '*').slice(0, 6);
            scope = names.length ? `on for ${names.join(', ')}` : 'on';
        }
        return { key, label: FEATURE_LABELS[key], on, scope };
    });
}

export function summarizeScheduleOverride(config) {
    const regions = config?.regions && typeof config.regions === 'object' ? config.regions : {};
    return ['GP', 'WC', 'KZN', 'EC'].map((code) => {
        const row = regions[code] || {};
        if (!row.active) return `${code} is on its normal sheet`;
        const day = String(row.dayType || 'override').replace(/_/g, ' ');
        const title = scrubOperatorText(row.title || '', 80);
        return title ? `${code} is showing the ${day} sheet: ${title}` : `${code} is showing the ${day} sheet`;
    });
}

function hoursLeft(expiresAt, now) {
    const ms = Number(expiresAt) - now;
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.round(ms / 3600000));
}

export function summarizeExpiring(items, now = Date.now()) {
    const soon = asList(items)
        .map((item) => ({
            type: String(item.type || 'Item'),
            label: scrubOperatorText(item.label || '', 120),
            routeId: String(item.routeId || ''),
            expiresAt: Number(item.expiresAt) || 0,
            hours: item.expiresAt ? hoursLeft(item.expiresAt, now) : null,
        }))
        .filter((item) => item.label)
        .sort((a, b) => {
            if (!a.expiresAt && !b.expiresAt) return 0;
            if (!a.expiresAt) return 1;
            if (!b.expiresAt) return -1;
            return a.expiresAt - b.expiresAt;
        });
    const withinTwoDays = soon.filter((item) => item.hours != null && item.hours <= 48);
    return {
        total: soon.length,
        soon: withinTwoDays.slice(0, 4),
        soonCount: withinTwoDays.length,
        permanent: soon.filter((item) => item.hours == null).length,
    };
}

function tripCard(summary) {
    if (!summary.sample && !summary.pairsEver) {
        return {
            id: 'trips',
            kicker: 'Trip plans',
            tone: 'quiet',
            title: 'No recent plans in this sample',
            body: 'A phone sends a batch after 5 successful plans. The pair index is empty too, so there is nothing to prepare for yet.',
        };
    }
    const top = summary.top[0];
    const region = summary.topRegion
        ? `${summary.topRegion.code} has ${summary.topRegion.count} of the plans in this sample.`
        : '';
    const headline = top
        ? `${top[0]} is the pair people ask for most in this sample (${top[1]}).`
        : `${summary.sample} plans are in the latest batches.`;
    const extra = [
        summary.usersEver ? `${summary.usersEver} people have planned at least once.` : '',
        summary.saturday ? `${summary.saturday} plans in the sample are for Saturday.` : '',
        summary.noSaturdayLine
            ? `${summary.noSaturdayLine} Saturday or holiday plans use a line that has no trains that day.`
            : '',
        summary.cato ? `${summary.cato} plans name Cato Ridge.` : '',
        summary.transfer ? `${summary.direct} are direct and ${summary.transfer} change trains.` : '',
        region,
    ].filter(Boolean).join(' ');
    return {
        id: 'trips',
        kicker: 'Trip plans',
        tone: summary.noSaturdayLine || summary.cato ? 'watch' : 'calm',
        title: top ? top[0] : 'Plans in the latest batches',
        body: `${headline} ${extra}`.replace(/\s+/g, ' ').trim(),
        details: summary.top.map(([pair, count]) => `${pair} (${count})`).concat(summary.recentPairs || []),
    };
}

function failCard(summary) {
    if (!summary.sample) {
        return {
            id: 'fails',
            kicker: 'Routing',
            tone: 'quiet',
            title: 'No routing failures in this sample',
            body: 'The latest failure cards are empty. A quiet sample still does not mean every search worked on phones that have not reported yet.',
        };
    }
    const reason = summary.reasons[0];
    const pair = summary.pairs[0];
    const reasonText = reason ? `${reason[0]} is the most common reason (${reason[1]}).` : '';
    const pairText = pair ? `The pair that fails most here is ${pair[0]} (${pair[1]}).` : '';
    return {
        id: 'fails',
        kicker: 'Routing',
        tone: 'watch',
        title: `${summary.sample} routing failures in this sample`,
        body: `${reasonText} ${pairText}`.trim(),
        details: summary.reasons.map(([name, count]) => `${name} (${count})`).concat(
            summary.pairs.map(([pair, count]) => pair + ` (${count})`)
        ),
    };
}

function fareCard(summary) {
    if (!summary.sample) {
        return {
            id: 'fares',
            kicker: 'Fares',
            tone: 'quiet',
            title: 'No fare notes in this sample',
            body: 'Commuters have not sent a fare correction in the latest cards.',
        };
    }
    const wide = summary.widest && summary.widest.gap > 0
        ? ` The widest gap is R${summary.widest.gap} on ${summary.widest.origin} to ${summary.widest.destination} (quoted R${summary.widest.quoted}, reported R${summary.widest.reported}, ${summary.widest.ticketType}).`
        : '';
    return {
        id: 'fares',
        kicker: 'Fares',
        tone: summary.disagree ? 'watch' : 'calm',
        title: summary.disagree
            ? `${summary.disagree} fare notes say the quote was wrong`
            : 'Fare notes match the quote',
        body: `${summary.sample} notes in this sample. ${summary.agree} agreed and ${summary.disagree} did not.${wide}`,
        details: wide ? [wide.trim()] : [],
    };
}

function crashCard(summary) {
    if (!summary.recent.length) {
        return {
            id: 'crashes',
            kicker: 'Crashes',
            tone: 'quiet',
            title: 'No crash cards in this sample',
            body: 'You can still send one crash log from System Health when a report arrives.',
        };
    }
    const latest = summary.recent[0];
    return {
        id: 'crashes',
        kicker: 'Crashes',
        tone: 'watch',
        title: `${summary.sample} crash cards, newest first`,
        body: `Latest: ${latest.error}${latest.version ? ` on ${latest.version}` : ''}. Open Explain on a card to send that log for a reading. Emails and phone numbers are removed first.`,
        details: summary.recent.map((row) => `${row.error}${row.version ? ` (${row.version})` : ''}`),
    };
}

function expiryCard(summary) {
    if (!summary.total) {
        return {
            id: 'expiring',
            kicker: 'Expiring',
            tone: 'quiet',
            title: 'Nothing is live in State Monitor',
            body: 'No alert, disruption, grid notice, exclusion, or maintenance banner is active.',
        };
    }
    if (!summary.soonCount) {
        return {
            id: 'expiring',
            kicker: 'Expiring',
            tone: 'calm',
            title: `${summary.total} live items, none due within 48 hours`,
            body: summary.permanent
                ? `${summary.permanent} of them have no expiry.`
                : 'The next expiry is further out than two days.',
        };
    }
    const lines = summary.soon.map((item) => {
        const when = item.hours === 0 ? 'under an hour' : `in ${item.hours}h`;
        return `${item.type}: ${item.label} (${when})`;
    });
    const more = summary.soonCount > summary.soon.length
        ? ` ${summary.soonCount - summary.soon.length} more are also inside 48 hours.`
        : '';
    return {
        id: 'expiring',
        kicker: 'Expiring',
        tone: 'watch',
        title: `${summary.soonCount} items expire within 48 hours`,
        body: `${lines.join(' ')}${more}`,
        details: lines,
    };
}

function settingsCard(features, sheets, appVersion) {
    const on = features.filter((item) => item.on).map((item) => `${item.label} ${item.scope}`);
    const off = features.filter((item) => !item.on).map((item) => item.label);
    const featureLine = on.length ? `On: ${on.join('. ')}.` : 'Every listed switch is off.';
    const offLine = off.length ? ` Off: ${off.join(', ')}.` : '';
    const sheetLine = sheets.length ? ` ${sheets.join('. ')}.` : '';
    return {
        id: 'settings',
        kicker: 'This build',
        tone: 'calm',
        title: appVersion || 'Current build',
        body: `${featureLine}${offLine}${sheetLine}`.replace(/\s+/g, ' ').trim(),
        details: on.concat(off.map((label) => `Off: ${label}`)).concat(sheets),
    };
}

function railCard(issues) {
    const list = Array.isArray(issues) ? issues.filter(Boolean) : [];
    if (!list.length) return null;
    const lines = list.slice(0, 8).map((item) => {
        const region = REGION_NAMES[item.region] || item.region || 'Network';
        const stretch = item.stretch || 'the whole route';
        const name = item.route ? `${item.route}, ` : '';
        const tier = item.tier === 'CRITICAL' ? ' Critical.' : '';
        return `${region}: ${name}${stretch}.${tier}`;
    });
    return {
        id: 'rail',
        kicker: 'Rail',
        tone: 'watch',
        title: list.length === 1 ? '1 live rail issue' : `${list.length} live rail issues`,
        body: lines[0],
        details: lines,
    };
}

export function buildOperatorBrief(input = {}) {
    const now = Number(input.now) || Date.now();
    const clock = johannesburgClock(now);
    const trips = summarizeTrips(input.trips, input.pairs, input.usersEver);
    const fails = summarizeFails(input.fails, now);
    const fares = summarizeFares(input.fares);
    const crashes = summarizeCrashes(input.crashes, now);
    const features = summarizeFeatures(input.features);
    const sheets = summarizeScheduleOverride(input.scheduleOverride);
    const expiring = summarizeExpiring(input.expiring, now);
    const ahead = upcomingOpsNotes(now);
    const rail = railCard(input.disruptions);
    const cards = [
        ...ahead,
        ...(rail ? [rail] : []),
        expiryCard(expiring),
        tripCard(trips),
        failCard(fails),
        fareCard(fares),
        crashCard(crashes),
        settingsCard(features, sheets, input.appVersion || ''),
    ];
    const watch = cards.find((card) => card.tone === 'watch');
    const digest = {
        when: clock.label,
        hour: clock.hour,
        appVersion: String(input.appVersion || ''),
        ahead: ahead.map((card) => ({ title: card.title, body: card.body })),
        expiring,
        trips,
        fails,
        fares,
        crashes: {
            sample: crashes.sample,
            recent: crashes.recent.map((row) => ({ error: row.error, version: row.version })),
        },
        features: features.map((item) => ({ label: item.label, scope: item.scope })),
        sheets,
        analytics: 'These counts are first-party logs already stored for operators. Google Analytics and Clarity are not included.',
    };
    return {
        clock,
        greeting: greetingForHour(clock.hour),
        headline: watch?.title || cards[0]?.title || 'Nothing urgent in this sample',
        cards,
        crashes: crashes.recent,
        digest,
    };
}

export function briefLauncherHtml({ hidden = false, clock } = {}) {
    const when = clock || johannesburgClock();
    const greeting = greetingForHour(when.hour);
    if (hidden) {
        return `<button type="button" id="operator-brief-restore" class="w-full rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-900 px-4 py-3 text-left text-sm font-bold text-indigo-700 dark:text-indigo-200 focus:outline-none">Show the brief</button>`;
    }
    return `
        <div class="relative">
            <button type="button" id="operator-brief-open" class="w-full text-left rounded-3xl px-5 py-4 pr-12 shadow-md focus:outline-none" style="background: linear-gradient(145deg, #312e81 0%, #4c1d95 48%, #6d28d9 100%); color: #f8fafc;">
                <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-100">${esc(greeting)}</p>
                <p class="mt-1 text-lg font-semibold leading-tight">See the brief</p>
                <p class="mt-1 text-sm text-indigo-100/90 leading-snug">${esc(when.label)}. Expiring items, plans, failures, and the lines to watch.</p>
            </button>
            <button type="button" id="operator-brief-dismiss" class="absolute top-3 right-3 p-1.5 rounded-full text-indigo-100 hover:bg-white/10 focus:outline-none" aria-label="Dismiss">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>`;
}

function toneClass(tone) {
    if (tone === 'watch') return 'border-amber-200/80 dark:border-amber-700/60';
    if (tone === 'quiet') return 'border-slate-200 dark:border-slate-700';
    return 'border-indigo-100 dark:border-indigo-900/60';
}

export function briefReportHtml(model) {
    const cards = (model?.cards || []).map((card, index) => {
        const details = Array.isArray(card.details) ? card.details.filter(Boolean) : [];
        const extra = details.length
            ? `<div data-brief-detail class="hidden mt-2 space-y-1">${details.map((line) => `<p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">${esc(line)}</p>`).join('')}</div>`
            : '';
        return `
        <article data-brief-card data-brief-index="${index}" class="rounded-3xl border ${toneClass(card.tone)} bg-white/95 dark:bg-gray-900/80 px-4 py-3 shadow-sm text-left w-full cursor-pointer">
            <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-500 dark:text-indigo-300">${esc(card.kicker)}</p>
            <h3 class="mt-1 text-base font-semibold text-slate-900 dark:text-white leading-snug">${esc(card.title)}</h3>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">${esc(card.body)}</p>
            ${extra}
            <button type="button" class="operator-brief-alert mt-3 text-[11px] font-bold text-rose-700 dark:text-rose-300 underline focus:outline-none" data-brief-index="${index}">Add to alerts</button>
        </article>`;
    }).join('');
    const crashes = (model?.crashes || []).map((row) => `
        <div class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-gray-900/70 px-3 py-2">
            <p class="text-sm text-slate-800 dark:text-slate-100 leading-snug">${esc(row.error)}</p>
            <p class="mt-1 text-[11px] text-slate-500">${esc(row.version || 'Version not recorded')}</p>
            <button type="button" class="operator-brief-crash mt-2 w-full rounded-xl bg-slate-900 text-white text-xs font-bold py-2 focus:outline-none" data-crash-id="${esc(row.id)}">Explain this crash</button>
            <p class="operator-brief-crash-note mt-2 hidden text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap"></p>
        </div>`).join('');
    return `
        <div class="min-h-full bg-slate-100 dark:bg-gray-950 px-4 pt-6 pb-10">
            <div class="max-w-lg mx-auto">
                <div class="flex items-start justify-between gap-3 rounded-3xl px-4 py-4 text-white" style="background: linear-gradient(145deg, #1e1b4b, #4338ca);">
                    <div>
                        <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-100">${esc(model?.greeting || 'Brief')}</p>
                        <h2 class="mt-1 text-2xl font-semibold leading-tight">${esc(model?.headline || '')}</h2>
                        <p class="mt-1 text-sm text-indigo-100/90">${esc(model?.clock?.label || '')}</p>
                    </div>
                    <button type="button" id="operator-brief-close" class="shrink-0 p-2 rounded-full bg-white/10 focus:outline-none" aria-label="Close">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <section class="mt-5 rounded-3xl px-4 py-4 text-white shadow-lg" style="background: linear-gradient(160deg, #4c1d95, #6d28d9 55%, #7c3aed);">
                    <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-100">What this means</p>
                    <p id="operator-brief-note" class="mt-2 text-sm leading-relaxed whitespace-pre-wrap">Writing a note from this sample.</p>
                </section>
                <div class="mt-4 space-y-3">${cards}</div>
                ${crashes ? `<details class="mt-4"><summary class="cursor-pointer text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 px-1">Crashes this week</summary><div class="mt-2 space-y-2">${crashes}</div></details>` : ''}
                <p class="mt-4 text-[11px] leading-relaxed text-slate-500">Counts are from trip plans, fare notes, routing failures, and crash cards saved for operators. Google Analytics is not in this brief. A plan is a search, not a boarding.</p>
            </div>
        </div>`;
}

function briefRules() {
    return [
        'You write a short brief for the two Next Train operators.',
        'Use only facts in the digest. If a fact is missing, say it is not in this sample.',
        'Do not invent a date, a Wednesday, a train number, a fare, or a reopening.',
        'Do not mention a device id, an email, or a phone number.',
        'Say what the numbers mean for the next day or two, in plain sentences.',
        'South African English. No em dashes. Two short paragraphs.',
        'Return JSON only, with a text field.',
    ].join('\n');
}

export function buildBriefRequest(digest) {
    const text = JSON.stringify(digest || {}).slice(0, DIGEST_MAX);
    if (text.length < 3) throw new Error('There is nothing to summarise.');
    return {
        systemInstruction: { parts: [{ text: briefRules() }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
            },
            thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
    };
}

export function buildCrashExplainRequest(crash) {
    const clean = {
        error: scrubOperatorText(crash?.error || '', 400),
        preview: scrubOperatorText(crash?.preview || '', 1200),
        stack: scrubOperatorText(crash?.stack || '', 1500),
        version: String(crash?.appVersion || '').slice(0, 40),
        routeId: String(crash?.routeId || '').slice(0, 40),
    };
    if (!clean.error && !clean.preview && !clean.stack) {
        throw new Error('That crash log is empty.');
    }
    return {
        systemInstruction: {
            parts: [{
                text: [
                    'You explain one Next Train crash log for an operator.',
                    'Use only this log. Say what failed and what to check.',
                    'If the log is thin, say so.',
                    'Do not invent a file, a line, or a fix that is not written here.',
                    'Do not repeat an email, a phone number, or a token.',
                    'South African English. No em dashes. One short paragraph.',
                    'Return JSON only, with a text field.',
                ].join('\n'),
            }],
        },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(clean) }] }],
        generationConfig: {
            maxOutputTokens: 500,
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
            },
            thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
    };
}

export function parseBriefText(raw) {
    let data = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        try { data = JSON.parse(trimmed); } catch { return ''; }
    }
    return scrubOperatorText(String(data?.text || '').replace(/[\u2014\u2013]/g, ', '), 2000);
}
