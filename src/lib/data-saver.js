/**
 * Signed-in Data saving. Off until the commuter changes it.
 * A picture already stored on this phone, or already shown here, stays visible.
 */
import { COMMUNITY_WORKER_FALLBACK_URL, COMMUNITY_WORKER_URL } from './config.js';
import { formatDownloadSize, sanitizePicturePreview } from './picture-preview.js';
import { armGifPlayers, isGifUrl } from './gif-play.js';
import { escapeHTML, safeStorage } from './utils.js';

export const DATA_SAVER_KEY = 'ntDataSaver';
const SEEN_KEY = 'ntDataSaverSeen';
const SEEN_MAX = 300;

const seen = new Set();
let seenLoaded = false;

export function normalizeDataSaver(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        pictures: src.pictures === 'tap' ? 'tap' : 'auto',
        linkCards: src.linkCards !== false,
        profilePhotos: src.profilePhotos !== false,
    };
}

export function readDataSaver() {
    try {
        const raw = safeStorage.getItem(DATA_SAVER_KEY);
        return normalizeDataSaver(raw ? JSON.parse(raw) : null);
    } catch {
        return normalizeDataSaver(null);
    }
}

export function dataSaverSummary(prefs = readDataSaver()) {
    if (prefs.pictures === 'tap') return 'Pictures wait for a tap';
    if (prefs.linkCards === false) return 'Link previews off';
    if (prefs.profilePhotos === false) return 'Profile photos off';
    return 'Off';
}

export function picturesWaitForTap(prefs = readDataSaver()) {
    return prefs.pictures === 'tap';
}

export function linkCardsOn(prefs = readDataSaver()) {
    return prefs.linkCards !== false;
}

export function profilePhotosOn(prefs = readDataSaver()) {
    return prefs.profilePhotos !== false;
}

function loadSeen() {
    if (seenLoaded) return;
    seenLoaded = true;
    try {
        const raw = safeStorage.getItem(SEEN_KEY);
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
            list.forEach((url) => {
                if (url) seen.add(String(url));
            });
        }
    } catch { /* ignore */ }
}

export function pictureWasShown(url) {
    loadSeen();
    return !!url && seen.has(String(url));
}

export function rememberPicture(url) {
    const clean = String(url || '');
    if (!clean) return;
    loadSeen();
    if (seen.has(clean)) return;
    seen.add(clean);
    const list = [...seen];
    const trimmed = list.length > SEEN_MAX ? list.slice(list.length - SEEN_MAX) : list;
    if (trimmed.length !== list.length) {
        seen.clear();
        trimmed.forEach((item) => seen.add(item));
    }
    try { safeStorage.setItem(SEEN_KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
}

/** True only when tap mode is on and this phone has not already shown the file. */
export function shouldHoldPicture(url) {
    if (!url || !picturesWaitForTap()) return false;
    return !pictureWasShown(url);
}

/**
 * show: paint now. hold: wait for a tap, unless a later cache check flips it to show.
 * A cache hit is show even when the commuter has not tapped.
 */
export function posterLoadPlan(url, { cached = false } = {}) {
    if (cached || !shouldHoldPicture(url)) return 'show';
    return 'hold';
}

export function paintDataSaverUi(prefs = readDataSaver()) {
    if (typeof document === 'undefined') return;
    const summary = document.getElementById('account-data-summary');
    if (summary) summary.textContent = dataSaverSummary(prefs);
    const auto = document.getElementById('account-data-pictures-auto');
    const tap = document.getElementById('account-data-pictures-tap');
    if (auto) auto.setAttribute('aria-pressed', prefs.pictures === 'auto' ? 'true' : 'false');
    if (tap) tap.setAttribute('aria-pressed', prefs.pictures === 'tap' ? 'true' : 'false');
    auto?.querySelector('[data-nt-data-check]')?.classList.toggle('hidden', prefs.pictures !== 'auto');
    tap?.querySelector('[data-nt-data-check]')?.classList.toggle('hidden', prefs.pictures !== 'tap');
    const links = document.getElementById('account-data-link-cards');
    const photos = document.getElementById('account-data-profile-photos');
    if (links) links.checked = prefs.linkCards !== false;
    if (photos) photos.checked = prefs.profilePhotos !== false;
}

export function writeDataSaver(partial = {}) {
    const push = partial.push !== false;
    const prev = readDataSaver();
    const next = normalizeDataSaver({ ...prev, ...partial });
    try { safeStorage.setItem(DATA_SAVER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    paintDataSaverUi(next);
    const changed = prev.pictures !== next.pictures || prev.linkCards !== next.linkCards || prev.profilePhotos !== next.profilePhotos;
    if (changed && typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('ntdatasaver', { detail: next })); } catch { /* ignore */ }
        if (push && typeof window.pushSignedInPrefs === 'function') {
            window.pushSignedInPrefs({ dataSaver: next });
        }
    }
    return next;
}

const HOLD_ICON = '<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"></path></svg>';

/** Centre pill. A blurred preview is filled in later, without the full photo. */
export function heldPictureAskInnerHtml() {
    return `<img alt="" class="nt-picture-preview hidden absolute inset-0 h-full w-full object-cover" data-nt-preview-img><span class="nt-picture-preview-shade hidden absolute inset-0"></span><span class="absolute inset-0 flex items-center justify-center"><span class="nt-picture-download relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-white">${HOLD_ICON}<span data-nt-download-label>Photo</span></span></span>`;
}

/** Picture tag, or a hold that stays a spinner until we know it is not already cached. */
export function pictureMarkup(url, { link = false } = {}) {
    const clean = String(url || '');
    if (!clean) return '';
    const src = escapeHTML(clean);
    if (!shouldHoldPicture(clean)) {
        rememberPicture(clean);
        const img = `<img src="${src}" alt="" referrerpolicy="no-referrer">`;
        return link ? `<a href="${src}" target="_blank" rel="noopener noreferrer">${img}</a>` : img;
    }
    const linked = link ? '1' : '';
    return `<button type="button" class="nt-picture-hold relative flex min-h-[7.5rem] w-full items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" data-nt-defer-src="${src}" data-nt-defer-link="${linked}" aria-label="Download photo"><span class="nt-picture-hold-wait absolute inset-0 flex items-center justify-center" aria-hidden="true"><span class="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"></span></span><span class="nt-picture-hold-ask hidden absolute inset-0 overflow-hidden">${heldPictureAskInnerHtml()}</span></button>`;
}

export function paintHeldPicture(node, { preview = '', bytes = 0 } = {}) {
    if (!node?.querySelector) return;
    const safe = sanitizePicturePreview(preview);
    const img = node.querySelector('[data-nt-preview-img]');
    const shade = node.querySelector('.nt-picture-preview-shade');
    if (img && safe && img.getAttribute('src') !== safe) {
        img.src = safe;
        img.classList.remove('hidden');
        shade?.classList.remove('hidden');
    }
    const size = formatDownloadSize(bytes);
    const label = node.querySelector('[data-nt-download-label]');
    if (label && size) label.textContent = size;
}

function absolutePictureUrl(url) {
    const s = String(url || '');
    if (/^https:\/\//i.test(s)) return s;
    if (typeof location !== 'undefined' && s.startsWith('/')) return `${location.origin}${s}`;
    return s;
}

function blobToDataUrl(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
    });
}

const previewJobs = new Map();

/** Small JPEG plus the full file size. Never the photo itself. */
export function loadPicturePreview(url) {
    const clean = String(url || '');
    if (!clean || clean.startsWith('data:')) return Promise.resolve({ preview: '', bytes: 0 });
    if (previewJobs.has(clean)) return previewJobs.get(clean);
    const job = requestPicturePreview(clean).catch(() => ({ preview: '', bytes: 0 }));
    previewJobs.set(clean, job);
    return job;
}

async function requestPicturePreview(url) {
    const absolute = absolutePictureUrl(url);
    if (!absolute.startsWith('https://')) return { preview: '', bytes: 0 };
    const base = String(COMMUNITY_WORKER_URL || (typeof window !== 'undefined' && window.COMMUNITY_WORKER_URL) || COMMUNITY_WORKER_FALLBACK_URL).replace(/\/$/, '');
    const res = await fetch(`${base}/media/preview?u=${encodeURIComponent(absolute)}`, { credentials: 'omit' });
    if (!res.ok) return { preview: '', bytes: 0 };
    const headerBytes = Number(res.headers.get('X-Nt-Bytes')) || 0;
    const type = res.headers.get('content-type') || '';
    if (type.includes('json')) {
        const data = await res.json().catch(() => ({}));
        return { preview: '', bytes: Number(data?.bytes) || headerBytes };
    }
    const blob = await res.blob();
    if (!blob.size || blob.size > 12000) return { preview: '', bytes: headerBytes };
    const preview = sanitizePicturePreview(await blobToDataUrl(blob));
    return { preview, bytes: headerBytes };
}

/** Paint a stored preview immediately, then fill anything still missing. */
export function settleHeldPicture(node, url) {
    if (!node) return;
    const knownPreview = node.getAttribute?.('data-nt-preview') || '';
    const knownBytes = Number(node.getAttribute?.('data-nt-bytes') || 0);
    if (knownPreview || knownBytes > 0) paintHeldPicture(node, { preview: knownPreview, bytes: knownBytes });
    if (sanitizePicturePreview(knownPreview)) return;
    loadPicturePreview(url).then((meta) => {
        if (!node.isConnected) return;
        paintHeldPicture(node, {
            preview: meta?.preview || '',
            bytes: knownBytes > 0 ? knownBytes : meta?.bytes,
        });
    }).catch(() => {});
}

function showDeferredAsk(node) {
    node.querySelector('.nt-picture-hold-wait')?.classList.add('hidden');
    node.querySelector('.nt-picture-hold-ask')?.classList.remove('hidden');
    settleHeldPicture(node, node.getAttribute('data-nt-defer-src') || '');
}

function revealDeferredPicture(node) {
    const url = node.getAttribute('data-nt-defer-src') || '';
    if (!url || !node.isConnected) return;
    rememberPicture(url);
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    if (isGifUrl(url)) img.dataset.ntGifSrc = url;
    if (node.getAttribute('data-nt-defer-link') === '1') {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.appendChild(img);
        node.replaceWith(anchor);
        armGifPlayers(anchor);
        return;
    }
    node.replaceWith(img);
    armGifPlayers(img.parentElement || img);
}

/** If the alert cache already has the file, paint it. Otherwise show the download outline. */
export function settleDeferredPictures(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('[data-nt-defer-src]').forEach((node) => {
        if (node.dataset.ntDeferChecked === '1') return;
        node.dataset.ntDeferChecked = '1';
        const url = node.getAttribute('data-nt-defer-src') || '';
        if (!url) return;
        if (posterLoadPlan(url) === 'show') {
            revealDeferredPicture(node);
            return;
        }
        import('./alert-image-cache.js').then(({ resolveCachedAlertImage }) => resolveCachedAlertImage(url)).then((hit) => {
            if (!node.isConnected) return;
            if (posterLoadPlan(url, { cached: !!hit }) === 'show') {
                revealDeferredPicture(node);
                return;
            }
            showDeferredAsk(node);
        }).catch(() => {
            if (node.isConnected) showDeferredAsk(node);
        });
    });
}

function bindDeferredPictures() {
    if (typeof document === 'undefined' || document.documentElement.dataset.ntDeferPictures === '1') return;
    document.documentElement.dataset.ntDeferPictures = '1';
    document.addEventListener('click', (event) => {
        const node = event.target?.closest?.('[data-nt-defer-src]');
        if (!node) return;
        const ask = node.querySelector('.nt-picture-hold-ask');
        if (!ask || ask.classList.contains('hidden')) return;
        event.preventDefault();
        event.stopPropagation();
        revealDeferredPicture(node);
    });
    window.addEventListener('ntdatasaver', () => {
        if (picturesWaitForTap()) return;
        document.querySelectorAll('[data-nt-defer-src]').forEach((node) => revealDeferredPicture(node));
    });
}

if (typeof window !== 'undefined') bindDeferredPictures();
