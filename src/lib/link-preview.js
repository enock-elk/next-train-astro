/**
 * WhatsApp-style link cards for alerts.
 * The phone never fetches the other site. A worker reads the page once,
 * and a stored card on the notice is what every commuter paints.
 */

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

/** Two pasted links can each grow a card. A third stays a plain link. */
export const MAX_LINK_CARDS = 2;
/** Page text kept on the card. Long enough for a short post, still bounded. */
export const PREVIEW_DESCRIPTION_MAX = 480;

export function samePreviewUrl(a, b) {
    const left = cleanHttpUrl(a);
    const right = cleanHttpUrl(b);
    if (!left || !right) return false;
    const key = (href) => {
        try {
            const url = new URL(href);
            if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
            url.hash = '';
            return url.href;
        } catch {
            return href;
        }
    };
    return key(left) === key(right);
}

/**
 * Public https links written in the alert, in the order they appear.
 * A source line or a button is not a second card. `limit` 0 keeps them all.
 */
export function messagePreviewUrls(notice, limit = 0) {
    const html = String(notice?.message || notice?.text || notice?.longExplanation || '');
    const found = [];
    const push = (raw) => {
        const url = cleanHttpUrl(raw);
        if (!url || !isPublicPreviewUrl(url)) return;
        if (found.some((item) => samePreviewUrl(item, url))) return;
        found.push(url);
    };
    const re = /href\s*=\s*["']([^"']+)["']/gi;
    let match = re.exec(html);
    while (match) {
        push(match[1]);
        match = re.exec(html);
    }
    const plain = html.replace(/<[^>]+>/g, ' ');
    (plain.match(/https?:\/\/[^\s<>"']+/gi) || []).forEach(push);
    const cap = Number(limit) > 0 ? Number(limit) : found.length;
    return found.slice(0, cap);
}

export function firstHttpUrl(notice) {
    return messagePreviewUrls(notice, 1)[0] || '';
}

function tidyEmptyLinkParents(root) {
    if (!root?.querySelectorAll) return;
    Array.from(root.querySelectorAll('p, div, span')).reverse().forEach((el) => {
        const text = String(el.textContent || '').replace(/\u00a0/g, ' ').trim();
        if (text) return;
        if (el.querySelector('img, a, button, video')) return;
        el.remove();
    });
}

/** Lift a bare pasted URL out of the copy. A named link stays where it was written. */
export function relocateBarePreviewUrls(html, urls) {
    const list = (Array.isArray(urls) ? urls : [])
        .map((item) => cleanHttpUrl(item))
        .filter((url) => url && isPublicPreviewUrl(url));
    const source = String(html || '');
    if (!source || !list.length) return source;
    if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        doc.body.querySelectorAll('a[href]').forEach((anchor) => {
            const href = cleanHttpUrl(anchor.getAttribute('href') || '');
            if (!href || !list.some((url) => samePreviewUrl(url, href))) return;
            const textUrl = cleanHttpUrl(anchor.textContent || '');
            if (!textUrl || !samePreviewUrl(textUrl, href)) return;
            anchor.replaceWith(doc.createTextNode(''));
        });
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        const texts = [];
        let node = walker.nextNode();
        while (node) {
            texts.push(node);
            node = walker.nextNode();
        }
        texts.forEach((textNode) => {
            if (textNode.parentElement?.closest('a')) return;
            let value = textNode.nodeValue || '';
            list.forEach((url) => {
                if (value.includes(url)) value = value.split(url).join('');
            });
            textNode.nodeValue = value.replace(/[ \t]{2,}/g, ' ');
        });
        doc.body.normalize();
        tidyEmptyLinkParents(doc.body);
        return doc.body.innerHTML.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>').trim();
    }
    let out = source;
    list.forEach((url) => {
        [...new Set([url, url.replace(/&/g, '&amp;')])].forEach((variant) => {
            const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            out = out.replace(new RegExp(`<a\\b[^>]*\\bhref\\s*=\\s*["']${escaped}["'][^>]*>\\s*${escaped}\\s*</a>`, 'gi'), '');
        });
    });
    out = out.split(/(<[^>]+>)/g).map((part) => {
        if (part.startsWith('<')) return part;
        let text = part;
        list.forEach((url) => {
            text = text.split(url).join('');
            text = text.split(url.replace(/&/g, '&amp;')).join('');
        });
        return text.replace(/[ \t]{2,}/g, ' ');
    }).join('');
    out = out.replace(/<(p|div)(?:\s[^>]*)?>\s*<\/\1>/gi, '');
    return out.replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>').trim();
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
        PREVIEW_DESCRIPTION_MAX
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
    const description = clip(value.description || '', PREVIEW_DESCRIPTION_MAX);
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

function toneClass(severity) {
    if (severity === 'critical') return 'is-critical';
    if (severity === 'warning') return 'is-warning';
    return 'is-info';
}

function rawLink(url) {
    return `<a class="nt-link-preview-raw" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeText(url)}</a>`;
}

export function previewCardHtml(url, severity, preview) {
    const tone = toneClass(severity);
    const card = normalizeLinkPreview(preview);
    if (!card) {
        const site = siteLabel(url);
        return `<a class="nt-link-preview is-loading ${tone}" data-link-preview-state="loading" data-link-preview-url="${escapeAttr(url)}" data-link-severity="${escapeAttr(toneClass(severity))}" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" aria-busy="true">
        <div class="nt-link-preview-media nt-link-preview-shimmer"></div>
        <div class="nt-link-preview-copy">
            <div class="nt-link-preview-line nt-link-preview-shimmer"></div>
            <div class="nt-link-preview-line nt-link-preview-line-short nt-link-preview-shimmer"></div>
            <div class="nt-link-preview-site">${escapeText(site)}</div>
        </div>
    </a>`;
    }
    const media = card.image
        ? `<img class="nt-link-preview-media" alt="" src="${escapeAttr(card.image)}" referrerpolicy="no-referrer">`
        : '';
    const desc = card.description
        ? `<div class="nt-link-preview-desc">${escapeText(card.description)}</div>`
        : '';
    return `<a class="nt-link-preview ${tone}" data-link-preview-state="ready" data-link-severity="${escapeAttr(tone)}" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">
        ${media}
        <div class="nt-link-preview-copy">
            <div class="nt-link-preview-title">${escapeText(card.title)}</div>
            ${desc}
            <div class="nt-link-preview-site">${escapeText(card.site)}</div>
        </div>
    </a>`;
}

function slotMarkup(url, severity, preview) {
    const card = preview ? normalizeLinkPreview({ ...preview, url }) : null;
    const settled = card && !card.image ? ' is-settled' : '';
    return `<div class="nt-link-preview-slot${settled}" data-link-slot="${escapeAttr(url)}">${previewCardHtml(url, severity, card)}${rawLink(url)}</div>`;
}

function storedPreviews(notice) {
    const many = Array.isArray(notice?.linkPreviews) ? notice.linkPreviews : [];
    const found = [];
    const push = (value) => {
        const card = normalizeLinkPreview(value);
        if (!card) return;
        if (found.some((item) => samePreviewUrl(item.url, card.url))) return;
        found.push(card);
    };
    many.forEach(push);
    push(notice?.linkPreview);
    return found;
}

export function linkPreviewMarkup(notice) {
    const severity = notice?.severity || 'info';
    const urls = messagePreviewUrls(notice);
    const cards = urls.slice(0, MAX_LINK_CARDS);
    if (!urls.length) return '';
    const stored = storedPreviews(notice);
    const slots = cards.map((url) => {
        const known = stored.find((card) => samePreviewUrl(card.url, url)) || peekLinkPreview(url);
        return slotMarkup(url, severity, known && samePreviewUrl(known.url, url) ? known : null);
    }).join('');
    const extra = urls.slice(MAX_LINK_CARDS).map((url) => `<div class="nt-link-preview-extra">${rawLink(url)}</div>`).join('');
    return `<div class="nt-link-preview-stack">${slots}${extra}</div>`;
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

/** Hide the raw URL once the card's picture has drawn. A card with no picture hides it now. */
export function settleLinkPreviewSlots(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('.nt-link-preview-slot').forEach((slot) => {
        if (slot.classList.contains('is-settled')) return;
        if (slot.querySelector('[data-link-preview-state="loading"]')) return;
        const img = slot.querySelector('img.nt-link-preview-media');
        const done = () => slot.classList.add('is-settled');
        if (!img) {
            done();
            return;
        }
        rememberPreviewImage(img);
        if (img.complete && !String(img.src || '').startsWith('blob:')) {
            if (!img.naturalWidth) img.remove();
            done();
            return;
        }
        if (img.complete && img.naturalWidth > 0 && String(img.src || '').startsWith('blob:')) {
            done();
            return;
        }
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', () => {
            img.remove();
            done();
        }, { once: true });
    });
}

/** Repeat opens use the phone cache. The img address stays the original picture. */
function rememberPreviewImage(img) {
    const src = img?.getAttribute?.('src') || '';
    if (!src || src.startsWith('blob:') || img.dataset.ntPreviewCache === '1') return;
    img.dataset.ntPreviewCache = '1';
    import('./alert-image-cache.js').then(({ cacheAlertImages, resolveCachedAlertImage }) => {
        resolveCachedAlertImage(src).then(async (cached) => {
            if (!cached || !img.isConnected) return;
            const blob = await cached.blob();
            const obj = URL.createObjectURL(blob);
            if (!img.isConnected) {
                try { URL.revokeObjectURL(obj); } catch { /* ignore */ }
                return;
            }
            img.src = obj;
        }).catch(() => {});
        const store = () => {
            cacheAlertImages({ linkPreview: { image: src } }, (url) => url).catch(() => {});
        };
        if (img.complete && img.naturalWidth > 0) store();
        else img.addEventListener('load', store, { once: true });
    }).catch(() => {});
}

function noticesById(notices) {
    const map = new Map();
    const list = Array.isArray(notices) ? notices : (notices ? [notices] : []);
    list.forEach((notice) => {
        if (notice?.id != null) map.set(String(notice.id), notice);
    });
    return map;
}

export function hydrateLinkPreviews(root, workerBase, notices) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const byId = noticesById(notices);
    settleLinkPreviewSlots(root);
    root.querySelectorAll('a[data-link-preview-url]').forEach((el) => {
        if (el.getAttribute('data-link-preview-state') === 'ready') return;
        const url = el.getAttribute('data-link-preview-url') || '';
        const tone = el.getAttribute('data-link-severity') || 'is-info';
        const severity = tone === 'is-critical' ? 'critical' : tone === 'is-warning' ? 'warning' : 'info';
        fetchLinkPreview(url, workerBase).then((preview) => {
            if (!el.isConnected) return;
            if (!preview) {
                el.remove();
                return;
            }
            const host = el.closest?.('[data-alert-id]') || null;
            const id = host?.getAttribute?.('data-alert-id') || '';
            const src = host?.getAttribute?.('data-alert-src') || '';
            const notice = byId.get(id) || null;
            el.outerHTML = previewCardHtml(url, severity, preview);
            settleLinkPreviewSlots(host || root);
            const admin = typeof window !== 'undefined' ? window.Admin : null;
            if (!id || !src || !admin?.patchLiveNoticeFields || !admin.isAllowlistedAdmin?.(admin.currentUser)) return;
            const urls = messagePreviewUrls(notice, MAX_LINK_CARDS);
            const cards = storedPreviews(notice).filter((card) => !samePreviewUrl(card.url, preview.url));
            cards.push(preview);
            const fields = {
                linkPreviews: cards.filter((card) => !urls.length || urls.some((item) => samePreviewUrl(item, card.url))).slice(0, MAX_LINK_CARDS),
            };
            if (!urls.length || samePreviewUrl(preview.url, urls[0] || url)) fields.linkPreview = preview;
            admin.getAuthKey?.().then((secret) => {
                if (!secret) return;
                admin.patchLiveNoticeFields(src, id, fields, secret).catch(() => {});
            }).catch(() => {});
        }).catch(() => {
            if (el.isConnected) el.remove();
        });
    });
}
