/**
 * A pasted Next Train share becomes a short chip.
 * Planner: "Kempton Park → Germiston • 15:26"
 * Grid: the route name. Live: "Train 9115 → Pienaarspoort".
 * The click stays in the app. A live train opens Map even when that tab is off.
 */
import { ROUTES } from './config.js';
import {
    parsePlannerDeepLink,
    parseRouteDeepLinkParams,
    parseLiveTrainDeepLink,
    parseLiveSharePath,
    liveShareSearchFromUrl,
    compactTime,
} from './share-links.js';

const HOSTS = /^(?:www\.|lab\.)?nexttrain\.co\.za$/i;

function titleStation(raw) {
    return String(raw || '')
        .replace(/\s+STATION$/i, '')
        .toLowerCase()
        .replace(/(^|[\s-])([a-z])/g, (m, lead, ch) => `${lead}${ch.toUpperCase()}`)
        .replace(/\bJhb\b/g, 'JHB');
}

function dayWord(day) {
    if (day === 'saturday') return 'Saturday';
    if (day === 'sunday') return 'Sunday';
    if (day === 'public_holiday') return 'Public holiday';
    return '';
}

function routeTitle(routeId) {
    const name = ROUTES[routeId]?.name || '';
    if (!name) return '';
    const parts = name.split(/\s*<->\s*|\s*↔\s*/);
    if (parts.length < 2) return titleStation(name);
    return parts.map((part) => titleStation(part)).filter(Boolean).join(' ↔ ');
}

function searchFromHref(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    const host = url.hostname.toLowerCase();
    const ours = HOSTS.test(host)
        || (host === 'enock-elk.github.io' && /\/og\//i.test(url.pathname))
        || host.endsWith('.next-train-lab.pages.dev');
    if (!ours) return null;
    const pathLive = parseLiveSharePath(url.pathname);
    if (pathLive) return liveShareSearchFromUrl(url);
    return url.search || '';
}

export function describeShareUrl(href) {
    const search = searchFromHref(href);
    if (search == null) return null;
    const live = parseLiveTrainDeepLink(search);
    if (live?.trainId) {
        const dest = titleStation(live.dest);
        const label = dest ? `Train ${live.trainId} → ${dest}` : `Train ${live.trainId}`;
        return { kind: 'live', label, search, href };
    }
    const planner = parsePlannerDeepLink(search);
    if (planner?.from && planner?.to) {
        const time = compactTime(planner.time);
        let label = `${titleStation(planner.from)} → ${titleStation(planner.to)}`;
        if (time) label += ` • ${time}`;
        const day = dayWord(planner.day);
        if (day && planner.day !== 'weekday') label += ` • ${day}`;
        return { kind: 'planner', label, search, href };
    }
    const route = parseRouteDeepLinkParams(search);
    if (route?.routeId) {
        const title = routeTitle(route.routeId) || titleStation(route.routeId);
        const bits = [title];
        if (route.view === 'fares') bits.push('fares');
        const day = dayWord(route.day);
        if (day) bits.push(day);
        return { kind: 'route', label: bits.join(' • '), search, href };
    }
    return null;
}

function escapeAttr(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

export function shareChipHtml(href) {
    const described = describeShareUrl(href);
    if (!described) return '';
    return `<button type="button" class="community-share-chip" data-share-url="${escapeAttr(described.href)}" data-share-kind="${described.kind}">${escapeAttr(described.label)}</button>`;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** Escape plain text and turn Next Train shares into chips. Other https links stay links. */
export function renderTextWithShareChips(text) {
    const raw = String(text || '');
    let html = '';
    let last = 0;
    for (const match of raw.matchAll(URL_RE)) {
        const full = match[0];
        const url = full.replace(/[),.;]+$/, '');
        const trail = full.slice(url.length);
        html += escapeAttr(raw.slice(last, match.index));
        const chip = shareChipHtml(url);
        if (chip) html += chip;
        else if (/^https:\/\//i.test(url)) {
            html += `<a class="community-msg-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeAttr(url.replace(/^https:\/\//, ''))}</a>`;
        } else {
            html += escapeAttr(url);
        }
        html += escapeAttr(trail);
        last = match.index + full.length;
    }
    html += escapeAttr(raw.slice(last));
    return html;
}

export async function openShareUrl(href) {
    const described = describeShareUrl(href);
    if (!described) return false;
    const { snapshotShareDeeplink } = await import('./deeplink.js');
    snapshotShareDeeplink(described.search, { prefer: true });
    if (described.kind === 'live') {
        const { applyLiveTrainDeepLink } = await import('./deeplink.js');
        return applyLiveTrainDeepLink();
    }
    if (described.kind === 'planner') {
        const { applyPlannerDeepLink } = await import('./planner-ui.js');
        return applyPlannerDeepLink();
    }
    if (described.kind === 'route') {
        const { applyRouteDeepLink } = await import('./timetable-grid.js');
        return applyRouteDeepLink();
    }
    return false;
}

if (typeof window !== 'undefined' && !window.__ntShareChipBound) {
    window.ntShareTextHtml = renderTextWithShareChips;
    window.ntShareChipHtml = shareChipHtml;
    window.ntOpenShareUrl = openShareUrl;
    window.__ntShareChipBound = true;
    document.addEventListener('click', async (event) => {
        const chip = event.target?.closest?.('.community-share-chip');
        if (!chip) return;
        event.preventDefault();
        event.stopPropagation();
        const opened = await openShareUrl(chip.getAttribute('data-share-url') || '');
        if (!opened && chip.getAttribute('data-share-kind') !== 'live' && typeof window.showToast === 'function') {
            window.showToast('Could not open that link.', 'error');
        }
    }, true);
}
