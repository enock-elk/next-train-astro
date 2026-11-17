/**
 * A pasted Next Train share becomes a short chip.
 * Planner: "Kempton Park → Germiston • 15:26"
 * Grid: the route name. Live: "Train 9115 → Pienaarspoort".
 * The click stays in the app. A live train opens Map even when that tab is off.
 */
import { DYNAMIC_BASE_URL, ROUTES } from './config.js';
import { noticeQuotePlain } from './feedback-quote.js';
import {
    parseAlertSharePath,
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

const ALERT_URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** `/og/a/{source}/{id}` links pasted into a chat. */
export function alertShareRefsInText(text) {
    const refs = [];
    for (const match of String(text || '').matchAll(ALERT_URL_RE)) {
        const href = match[0].replace(/[),.;]+$/, '');
        const parsed = alertShareFromHref(href);
        if (!parsed) continue;
        if (refs.some((row) => row.id === parsed.id && row.source === parsed.source)) continue;
        refs.push(parsed);
    }
    return refs;
}

function alertShareFromHref(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    const host = url.hostname.toLowerCase();
    const ours = HOSTS.test(host)
        || (host === 'enock-elk.github.io' && /\/og\//i.test(url.pathname))
        || host.endsWith('.next-train-lab.pages.dev');
    if (!ours) return null;
    const parsed = parseAlertSharePath(url.pathname);
    if (!parsed) return null;
    return { ...parsed, href: url.href };
}

function alertShareCardHtml(href, parsed) {
    return `<button type="button" class="nt-alert-share-card" data-alert-share-href="${escapeAttr(href)}" data-alert-share-source="${escapeAttr(parsed.source)}" data-alert-share-id="${escapeAttr(parsed.id)}" data-alert-share-photo="${parsed.photo || 0}"><span class="nt-alert-share-copy"><span class="nt-alert-share-kicker">Notice</span><span class="nt-alert-share-title">Loading this notice</span></span></button>`;
}

async function readNoticeJson(path) {
    try {
        const res = await fetch(`${DYNAMIC_BASE_URL}${path}.json`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        return data;
    } catch {
        return null;
    }
}

/** Live notice, then the archive. Expired records stay readable. */
export async function loadSharedNotice(source, id) {
    const noticeId = String(id || '').trim();
    const noticeSource = String(source || '').trim();
    if (!noticeId) return null;
    let notice = noticeSource ? await readNoticeJson(`notices/${encodeURIComponent(noticeSource)}/${encodeURIComponent(noticeId)}`) : null;
    let archived = false;
    if (!notice) {
        notice = await readNoticeJson(`notices_archive/${encodeURIComponent(noticeId)}`);
        archived = !!notice;
    }
    if (!notice) return null;
    const expiresAt = Number(notice.expiresAt || 0);
    const ended = archived || notice.deleted || notice.hidden || (!!expiresAt && expiresAt <= Date.now());
    return {
        notice: { ...notice, id: notice.id || noticeId, _sourceKey: notice._sourceKey || noticeSource },
        ended,
    };
}

function paintAlertShareCard(el, loaded) {
    const titleOf = (notice) => {
        const plain = noticeQuotePlain(notice);
        const line = plain.split('\n').map((row) => row.trim()).filter(Boolean);
        return { title: line[0] || 'Notice', body: line.slice(1, 4).join('\n') };
    };
    if (!loaded?.notice) {
        el.classList.add('is-ended');
        el.innerHTML = `<span class="nt-alert-share-copy"><span class="nt-alert-share-kicker">Notice</span><span class="nt-alert-share-title">This notice is no longer available</span></span>`;
        return;
    }
    const { title, body } = titleOf(loaded.notice);
    const images = Array.isArray(loaded.notice.imageUrls) && loaded.notice.imageUrls.length
        ? loaded.notice.imageUrls
        : (loaded.notice.imageUrl ? [loaded.notice.imageUrl] : []);
    const rawImage = String(images[0] || '');
    const image = /^https:\/\//i.test(rawImage) || rawImage.startsWith('/') ? rawImage : '';
    const ended = !!loaded.ended;
    el.classList.toggle('is-ended', ended);
    el.classList.toggle('is-live', !ended);
    el.dataset.alertShareLive = ended ? '0' : '1';
    const picture = image
        ? `<img alt="" src="${escapeAttr(image)}" referrerpolicy="no-referrer">`
        : '';
    el.innerHTML = `${picture}<span class="nt-alert-share-copy"><span class="nt-alert-share-kicker">${ended ? 'This notice has ended' : 'Notice'}</span><span class="nt-alert-share-title">${escapeAttr(title)}</span>${body ? `<span class="nt-alert-share-body">${escapeAttr(body)}</span>` : ''}</span>`;
}

export function hydrateAlertShareCards(root) {
    root?.querySelectorAll?.('.nt-alert-share-card[data-alert-share-id]').forEach((el) => {
        if (el.dataset.alertShareBound === '1') return;
        el.dataset.alertShareBound = '1';
        loadSharedNotice(el.getAttribute('data-alert-share-source') || '', el.getAttribute('data-alert-share-id') || '')
            .then((loaded) => { if (el.isConnected) paintAlertShareCard(el, loaded); })
            .catch(() => { if (el.isConnected) paintAlertShareCard(el, null); });
    });
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
        const alert = alertShareFromHref(url);
        const chip = alert ? alertShareCardHtml(url, alert) : shareChipHtml(url);
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
    window.ntAlertShareRefs = alertShareRefsInText;
    window.ntLoadSharedNotice = loadSharedNotice;
    document.addEventListener('click', async (event) => {
        const alertCard = event.target?.closest?.('.nt-alert-share-card');
        if (alertCard) {
            event.preventDefault();
            event.stopPropagation();
            if (alertCard.dataset.alertShareLive !== '1') return;
            const { focusSharedAlert } = await import('./alerts-channel.js');
            const state = await focusSharedAlert?.(
                alertCard.getAttribute('data-alert-share-id') || '',
                alertCard.getAttribute('data-alert-share-source') || '',
                Number(alertCard.getAttribute('data-alert-share-photo') || 0),
            );
            if (state !== 'opened') {
                alertCard.dataset.alertShareLive = '0';
                alertCard.classList.add('is-ended');
                alertCard.classList.remove('is-live');
                const kicker = alertCard.querySelector('.nt-alert-share-kicker');
                if (kicker) kicker.textContent = 'This notice has ended';
            }
            return;
        }
        const chip = event.target?.closest?.('.community-share-chip');
        if (!chip) return;
        event.preventDefault();
        event.stopPropagation();
        chip.closest('.community-post-row')?.classList.remove('is-pressing');
        const opened = await openShareUrl(chip.getAttribute('data-share-url') || '');
        if (!opened && chip.getAttribute('data-share-kind') !== 'live' && typeof window.showToast === 'function') {
            window.showToast('Could not open that link.', 'error');
        }
    }, true);
}
