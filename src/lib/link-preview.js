/**
 * WhatsApp-style link cards for alerts.
 * The phone never fetches the other site. A worker reads the page once,
 * and a stored card on the notice is what every commuter paints.
 */

import { linkCardsOn, rememberPicture, shouldHoldPicture } from './data-saver.js';

const memory = new Map();
const failedUrls = new Set();
const STORAGE_PREFIX = 'nt_link_preview:';
const PREVIEW_FALLBACK = 'https://api.microlink.io';

function decodeEntities(value) {
    return String(value || '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (all, n) => {
            const code = Number(n);
            return code > 0 && code < 65536 ? String.fromCharCode(code) : all;
        })
        .replace(/\s+/g, ' ')
        .trim();
}

export function cleanHttpUrl(value) {
    let raw = String(value || '').trim();
    if (!raw) return '';
    raw = raw.replace(/&amp;/gi, '&');
    while (raw.length > 8 && /[),.;!?]$/.test(raw)) raw = raw.slice(0, -1);
    let url;
    try { url = new URL(raw); } catch { return ''; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    if (url.href.length > 2000) return '';
    return url.href;
}

/** https pages a preview worker may open. Blocks local and private hosts. */
export function isPublicPreviewUrl(value) {
    const href = cleanHttpUrl(value);
    if (!href) return false;
    let url;
    try { url = new URL(href); } catch { return false; }
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (host === 'metadata.google.internal' || host === 'metadata.google.com') return false;
    if (host.includes(':')) return false;
    const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ip) {
        const parts = ip.slice(1).map(Number);
        if (parts.some((n) => n > 255)) return false;
        const [a, b] = parts;
        if (a === 0 || a === 10 || a === 127) return false;
        if (a === 169 && b === 254) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
    }
    return true;
}

function siteLabel(href) {
    try {
        return new URL(href).hostname.replace(/^www\./i, '');
    } catch {
        return '';
    }
}

/** Every public https address in the notice, in the order they appear. */
export function listHttpUrls(notice) {
    const html = `${notice?.title || ''} ${notice?.message || notice?.text || notice?.longExplanation || ''}`;
    const hrefs = [];
    const re = /href\s*=\s*["']([^"']+)["']/gi;
    let match = re.exec(html);
    while (match) {
        hrefs.push(match[1]);
        match = re.exec(html);
    }
    const plain = html.replace(/<[^>]+>/g, ' ');
    const bare = plain.match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
    const list = [...hrefs, ...bare, notice?.ctaUrl, notice?.sourceUrl];
    const out = [];
    for (const item of list) {
        const raw = String(item || '').trim();
        const url = cleanHttpUrl(/^www\./i.test(raw) ? `https://${raw}` : raw);
        if (!url || !isPublicPreviewUrl(url) || out.includes(url)) continue;
        out.push(url);
        if (out.length >= 8) break;
    }
    return out;
}

export function firstHttpUrl(notice) {
    return listHttpUrls(notice)[0] || '';
}

/**
 * A watch page the alert paints as a video card. Those stay off the link cards
 * so one address is not crawled twice.
 */
export function externalVideoPageUrl(value) {
    const href = cleanHttpUrl(value);
    if (!href || !isPublicPreviewUrl(href)) return '';
    let url;
    try { url = new URL(href); } catch { return ''; }
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^(www|m)\./, '');
    const path = url.pathname || '';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return href;
    if (host === 'fb.watch') return href;
    if (host === 'facebook.com' || host === 'fb.com') {
        if (/\/(videos|watch|reel|reels)(\/|$)/i.test(path) || url.searchParams.has('v')) return href;
    }
    if (host === 'instagram.com' && /\/(reel|reels|tv)\//i.test(path)) return href;
    if (host === 'dailymotion.com' || host === 'dai.ly') return href;
    if (host === 'streamable.com') return href;
    return '';
}

function isLiftedVideoUrl(value) {
    const href = cleanHttpUrl(value);
    if (!href) return false;
    if (externalVideoPageUrl(href)) return true;
    let url;
    try { url = new URL(href); } catch { return false; }
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^(www|m)\./, '');
    let path = url.pathname || '';
    try { path = decodeURIComponent(path); } catch { /* keep */ }
    if (/\.(mp4|webm|ogg|mov)$/i.test(path)) return true;
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
        return /[A-Za-z0-9_-]{11}/.test(`${path}${url.search}`);
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') return /\/\d{6,12}(?:\/|$)/.test(path);
    return false;
}

function clip(value, max) {
    const text = decodeEntities(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trim()}…`;
}

function metaContent(html, key) {
    const name = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
    ];
    for (const pattern of patterns) {
        const found = html.match(pattern);
        if (found && found[1]) return decodeEntities(found[1]);
    }
    return '';
}

export function parseLinkPreviewHtml(html, pageUrl) {
    const page = cleanHttpUrl(pageUrl);
    if (!page) return null;
    const source = String(html || '').slice(0, 200000);
    const title = clip(
        metaContent(source, 'og:title')
        || metaContent(source, 'twitter:title')
        || (source.match(/<title[^>]*>([^<]{1,300})<\/title>/i) || [])[1]
        || '',
        140
    );
    const description = clip(
        metaContent(source, 'og:description') || metaContent(source, 'description') || metaContent(source, 'twitter:description'),
        220
    );
    const imageRaw = metaContent(source, 'og:image') || metaContent(source, 'twitter:image');
    let image = '';
    if (imageRaw) {
        try {
            const abs = new URL(imageRaw, page).href;
            if (isPublicPreviewUrl(abs)) image = abs;
        } catch { /* ignore */ }
    }
    if (!title && !description && !image) return null;
    return {
        url: page,
        title: title || siteLabel(page),
        description,
        image,
        site: siteLabel(page),
    };
}

export function normalizeLinkPreview(value) {
    if (!value || typeof value !== 'object') return null;
    const url = cleanHttpUrl(value.url);
    if (!url || !isPublicPreviewUrl(url)) return null;
    const title = clip(value.title || '', 140);
    const description = clip(value.description || '', 220);
    const image = isPublicPreviewUrl(value.image) ? cleanHttpUrl(value.image) : '';
    if (!title && !description && !image) return null;
    return {
        url,
        title: title || siteLabel(url),
        description,
        image,
        site: clip(value.site || siteLabel(url), 80),
    };
}

function escapeAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function escapeText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function peekLinkPreview(url) {
    const clean = cleanHttpUrl(url);
    if (!clean) return null;
    if (memory.has(clean)) return memory.get(clean);
    if (typeof sessionStorage === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(STORAGE_PREFIX + clean);
        const parsed = normalizeLinkPreview(raw ? JSON.parse(raw) : null);
        if (parsed) memory.set(clean, parsed);
        return parsed;
    } catch {
        return null;
    }
}

function rememberLinkPreview(preview) {
    const clean = normalizeLinkPreview(preview);
    if (!clean) return null;
    memory.set(clean.url, clean);
    if (typeof sessionStorage !== 'undefined') {
        try { sessionStorage.setItem(STORAGE_PREFIX + clean.url, JSON.stringify(clean)); } catch { /* ignore */ }
    }
    return clean;
}

function readyMarkup(preview) {
    const card = normalizeLinkPreview(preview);
    if (!card) return '';
    const showImage = !!(card.image && !shouldHoldPicture(card.image));
    if (showImage) rememberPicture(card.image);
    const media = showImage
        ? `<img class="nt-link-preview-media" alt="" src="${escapeAttr(card.image)}" referrerpolicy="no-referrer">`
        : '';
    const desc = card.description
        ? `<div class="nt-link-preview-desc">${escapeText(card.description)}</div>`
        : '';
    return `<a class="nt-link-preview" data-link-preview-state="ready" href="${escapeAttr(card.url)}" target="_blank" rel="noopener noreferrer">
        ${media}
        <div class="nt-link-preview-copy">
            <div class="nt-link-preview-title">${escapeText(card.title)}</div>
            ${desc}
            <div class="nt-link-preview-site">${escapeText(card.site)}</div>
        </div>
    </a>`;
}

function loadingMarkup(url) {
    const site = siteLabel(url);
    return `<a class="nt-link-preview is-loading" data-link-preview-url="${escapeAttr(url)}" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" aria-busy="true">
        <div class="nt-link-preview-media nt-link-preview-shimmer"></div>
        <div class="nt-link-preview-copy">
            <div class="nt-link-preview-line nt-link-preview-shimmer"></div>
            <div class="nt-link-preview-line nt-link-preview-line-short nt-link-preview-shimmer"></div>
            <div class="nt-link-preview-site">${escapeText(site)}</div>
        </div>
    </a>`;
}

export function linkPreviewMarkup(notice) {
    if (!linkCardsOn()) return '';
    if (notice?.suppressLinkPreview) return '';
    const stored = normalizeLinkPreview(notice?.linkPreview);
    const urls = [];
    if (stored?.url && !isLiftedVideoUrl(stored.url)) urls.push(stored.url);
    listHttpUrls(notice).forEach((url) => {
        if (isLiftedVideoUrl(url) || urls.includes(url)) return;
        urls.push(url);
    });
    if (!urls.length) return '';
    return urls.map((url) => {
        if (stored && stored.url === url) return readyMarkup(stored);
        const peeked = peekLinkPreview(url);
        if (peeked) return readyMarkup(peeked);
        return loadingMarkup(url);
    }).join('');
}

/** Microlink's card, kept on the link the operator pasted. */
export function previewFromMicrolink(payload, requestedUrl) {
    const body = payload && typeof payload === 'object' ? payload : null;
    const data = body?.data && typeof body.data === 'object' ? body.data : body;
    if (!data || body?.status === 'fail' || body?.status === 'error') return null;
    const image = typeof data.image === 'string' ? data.image : data.image?.url;
    return normalizeLinkPreview({
        url: requestedUrl,
        title: data.title,
        description: data.description,
        image,
        site: data.publisher || '',
    });
}

async function readPreviewJson(url, ms) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
        const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
        const data = await res.json().catch(() => null);
        return { ok: res.ok, data };
    } catch {
        return { ok: false, data: null };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function fetchLinkPreview(url, workerBase) {
    const clean = cleanHttpUrl(url);
    if (!clean || !isPublicPreviewUrl(clean)) return null;
    const peeked = peekLinkPreview(clean);
    if (peeked) return peeked;
    if (failedUrls.has(clean)) return null;

    const base = String(workerBase || '').replace(/\/$/, '');
    if (base) {
        const worker = await readPreviewJson(`${base}/unfurl?url=${encodeURIComponent(clean)}`, 8000);
        const stored = worker.ok ? rememberLinkPreview(worker.data) : null;
        if (stored) return stored;
    }
    const micro = await readPreviewJson(`${PREVIEW_FALLBACK}/?url=${encodeURIComponent(clean)}`, 8000);
    const card = micro.ok ? rememberLinkPreview(previewFromMicrolink(micro.data, clean)) : null;
    if (card) return card;
    failedUrls.add(clean);
    return null;
}

export function hydrateLinkPreviews(root, workerBase) {
    if (!linkCardsOn()) {
        root?.querySelectorAll?.('.nt-link-preview, [data-link-preview-url]').forEach((el) => el.remove());
        return;
    }
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('[data-link-preview-url]').forEach((el) => {
        if (el.getAttribute('data-link-preview-state') === 'ready') return;
        const url = el.getAttribute('data-link-preview-url') || '';
        fetchLinkPreview(url, workerBase).then((preview) => {
            if (!linkCardsOn()) {
                if (el.isConnected) el.remove();
                return;
            }
            if (!el.isConnected) return;
            if (!preview) {
                el.remove();
                return;
            }
            const host = el.closest?.('[data-alert-id]') || null;
            const id = host?.getAttribute?.('data-alert-id') || '';
            const src = host?.getAttribute?.('data-alert-src') || '';
            el.outerHTML = readyMarkup(preview);
            const admin = typeof window !== 'undefined' ? window.Admin : null;
            if (!id || !src || !admin?.patchLiveNoticeFields || !admin.isAllowlistedAdmin?.(admin.currentUser)) return;
            admin.getAuthKey?.().then((secret) => {
                if (!secret) return;
                admin.patchLiveNoticeFields(src, id, { linkPreview: preview }, secret).catch(() => {});
            }).catch(() => {});
        }).catch(() => {
            if (el.isConnected) el.remove();
        });
    });
}

if (typeof window !== 'undefined') {
    window.addEventListener('ntdatasaver', () => {
        if (linkCardsOn()) return;
        document.querySelectorAll('.nt-link-preview, [data-link-preview-url]').forEach((el) => el.remove());
    });
}
