/**
 * Attachment sniffing + URL allowlist for commuter uploads and admin inserts.
 * Never trust File.name / File.type — both are attacker-controlled.
 */
import { escapeHTML } from './utils.js';
import { APP_BASE, withBase } from './config.js';
import { sanitizeAlertImageUrl, sanitizeInlineAlertImageUrl } from './alerts-feed.js';

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES = 4;

const REJECTED_TYPE_MSG = 'Use a JPEG, PNG, GIF, WebP photo or a PDF (max 5MB).';

export function attachmentRejectMessage() {
    return REJECTED_TYPE_MSG;
}

function withoutAppBase(path) {
    const raw = String(path || '');
    const base = String(APP_BASE || '/');
    if (!base || base === '/') return raw;
    const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
    if (raw === prefix) return '/';
    if (raw.startsWith(`${prefix}/`)) return raw.slice(prefix.length);
    return raw;
}

function bytesMatch(bytes, sig, offset = 0) {
    if (!bytes || bytes.length < offset + sig.length) return false;
    for (let i = 0; i < sig.length; i++) {
        if (bytes[offset + i] !== sig[i]) return false;
    }
    return true;
}

function ascii(bytes, start, len) {
    if (!bytes || bytes.length < start + len) return '';
    return String.fromCharCode(...bytes.slice(start, start + len));
}

/** Identify real type from magic bytes. Returns { ext, mime } or null. */
export function sniffAttachmentBytes(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (b.length < 4) return null;
    if (bytesMatch(b, [0xFF, 0xD8, 0xFF])) return { ext: 'jpg', mime: 'image/jpeg' };
    if (bytesMatch(b, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return { ext: 'png', mime: 'image/png' };
    const gif = ascii(b, 0, 6);
    if (gif === 'GIF87a' || gif === 'GIF89a') return { ext: 'gif', mime: 'image/gif' };
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
    if (ascii(b, 0, 4) === '%PDF') return { ext: 'pdf', mime: 'application/pdf' };
    return null;
}

export async function sniffAttachmentFile(file) {
    if (!file || typeof file.size !== 'number') return null;
    if (file.size <= 0 || file.size > ATTACHMENT_MAX_BYTES) return null;
    const headerLen = Math.min(16, file.size);
    if (typeof file.slice !== 'function') return null;
    const blob = file.slice(0, headerLen);
    if (!blob || typeof blob.arrayBuffer !== 'function') return null;
    let buf;
    try {
        buf = await blob.arrayBuffer();
    } catch {
        return null;
    }
    return sniffAttachmentBytes(new Uint8Array(buf));
}

export function randomAttachmentStem(prefix) {
    const p = String(prefix || 'file').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'file';
    return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Catalog posters (with app base) or https Firebase Storage. */
export function sanitizeAttachmentDisplayUrl(url) {
    const s = String(url || '').trim();
    if (!s || /[\s<>]/.test(s)) return null;

    const asPosterSrc = (candidate) => {
        const poster = sanitizeAlertImageUrl(candidate);
        return poster ? withBase(poster.replace(/^\//, '')) : null;
    };

    const direct = asPosterSrc(s);
    if (direct) return direct;

    let path = s;
    try {
        if (/^https?:\/\//i.test(s)) {
            const u = new URL(s);
            if (u.username || u.password) return null;
            path = u.pathname || '';
        }
    } catch {
        path = s;
    }
    const q = path.indexOf('?');
    if (q >= 0) path = path.slice(0, q);
    const hash = path.indexOf('#');
    if (hash >= 0) path = path.slice(0, hash);

    const poster = asPosterSrc(withoutAppBase(path));
    if (poster) return poster;

    return sanitizeInlineAlertImageUrl(s);
}

export function classifyAttachmentUrl(url) {
    const safe = sanitizeAttachmentDisplayUrl(url);
    if (!safe) return null;
    let path = safe;
    try {
        path = decodeURIComponent(new URL(safe, 'https://nexttrain.co.za').pathname || '');
    } catch {
        path = safe;
    }
    const lower = withoutAppBase(path).toLowerCase();
    if (/\.(jpe?g|png|gif|webp)$/.test(lower) || lower.includes('/images/alerts/')) return 'image';
    if (/\.pdf$/.test(lower)) return 'pdf';
    return 'file';
}

export function isSafeLightboxOnclick(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(?:event\.stopPropagation\(\);\s*)?(?:window|Admin)\.openLightbox\((['"])([\s\S]*)\1\)$/);
    if (!m) return false;
    return !!sanitizeAttachmentDisplayUrl(m[2]);
}

export function lightboxOnclickJs(url, fnName = 'window.openLightbox') {
    const safe = sanitizeAttachmentDisplayUrl(url);
    if (!safe) return '';
    const fn = fnName === 'Admin.openLightbox' ? 'Admin.openLightbox' : 'window.openLightbox';
    return `${fn}(${JSON.stringify(safe)})`;
}

export function attachmentPreviewHtml(url, opts = {}) {
    const safe = sanitizeAttachmentDisplayUrl(url);
    if (!safe) return '';
    const kind = classifyAttachmentUrl(safe);
    const attr = escapeHTML(safe);
    const fn = opts.admin ? 'Admin.openLightbox' : 'window.openLightbox';
    const onclick = lightboxOnclickJs(safe, fn);
    if (kind === 'image' && onclick) {
        return `<button type="button" onclick='event.stopPropagation(); ${onclick}' class="${opts.buttonClass || 'block focus:outline-none w-full text-left'}"><img src="${attr}" class="${opts.imgClass || 'w-full h-24 object-cover rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:opacity-90 transition-opacity cursor-zoom-in'}" alt="${escapeHTML(opts.alt || 'Attachment')}"></button>`;
    }
    const label = kind === 'pdf' ? (opts.pdfLabel || 'View attached PDF') : (opts.fileLabel || 'View file');
    return `<a href="${attr}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" class="${opts.linkClass || 'flex items-center justify-center text-blue-600 dark:text-blue-400 underline font-bold'}">${escapeHTML(label)}</a>`;
}

if (typeof window !== 'undefined') {
    window.sniffAttachmentFile = sniffAttachmentFile;
    window.sniffAttachmentBytes = sniffAttachmentBytes;
    window.sanitizeAttachmentDisplayUrl = sanitizeAttachmentDisplayUrl;
    window.classifyAttachmentUrl = classifyAttachmentUrl;
    window.isSafeLightboxOnclick = isSafeLightboxOnclick;
    window.lightboxOnclickJs = lightboxOnclickJs;
    window.attachmentPreviewHtml = attachmentPreviewHtml;
    window.randomAttachmentStem = randomAttachmentStem;
    window.attachmentRejectMessage = attachmentRejectMessage;
    window.ATTACHMENT_MAX_BYTES = ATTACHMENT_MAX_BYTES;
    window.ATTACHMENT_MAX_FILES = ATTACHMENT_MAX_FILES;
}
