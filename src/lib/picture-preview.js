/**
 * Tiny picture preview and the real download size.
 * The preview is a small JPEG the phone already has, or a small file from
 * the community worker. It is not the photo itself.
 */

const PREVIEW_PREFIX = 'data:image/jpeg;base64,';
const PREVIEW_MAX = 16000;

export function formatDownloadSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) {
        const kb = Math.max(1, Math.round(n / 1024));
        return `${kb} kB`;
    }
    const mb = n / (1024 * 1024);
    if (mb >= 10) return `${Math.round(mb)} MB`;
    return `${mb.toFixed(1).replace('.', ',')} MB`;
}

/** Firebase keys cannot contain . # $ [ ] / */
export function imageMetaKey(url) {
    const text = String(url || '');
    if (!text) return '';
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        h1 = ((h1 << 5) + h1 + code) >>> 0;
        h2 = ((h2 << 5) + h2 + code) >>> 0;
    }
    const tail = (text.split('/').pop() || '').replace(/[^A-Za-z0-9_-]/g, '').slice(-24);
    return `p${h1.toString(16)}${h2.toString(16)}${tail}`;
}

export function sanitizePicturePreview(value) {
    const s = String(value || '');
    if (!s.startsWith(PREVIEW_PREFIX) || s.length > PREVIEW_MAX) return '';
    const body = s.slice(PREVIEW_PREFIX.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return '';
    return s;
}

export function imageMetaForUrl(meta, url) {
    const box = meta && typeof meta === 'object' ? meta : null;
    if (!box) return { bytes: 0, preview: '' };
    const key = imageMetaKey(url);
    const row = (key && box[key]) || box[url] || null;
    if (!row || typeof row !== 'object') return { bytes: 0, preview: '' };
    const bytes = Number(row.bytes);
    return {
        bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
        preview: sanitizePicturePreview(row.preview),
    };
}

export function imageMetaRow(url, { bytes = 0, preview = '' } = {}) {
    const key = imageMetaKey(url);
    if (!key) return null;
    const cleanPreview = sanitizePicturePreview(preview);
    const n = Number(bytes);
    const cleanBytes = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    if (!cleanPreview && !cleanBytes) return null;
    const row = {};
    if (cleanBytes) row.bytes = cleanBytes;
    if (cleanPreview) row.preview = cleanPreview;
    return { key, row };
}

/** Draw a very small JPEG. Callers that already have the file pass it here. */
export async function tinyJpegFromBlob(blob) {
    const size = Number(blob?.size) || 0;
    if (!blob || typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
        return { preview: '', bytes: size };
    }
    let bitmap = null;
    try {
        bitmap = await createImageBitmap(blob);
        const edge = 24;
        const scale = edge / Math.max(bitmap.width || 1, bitmap.height || 1, 1);
        const width = Math.max(1, Math.round((bitmap.width || 1) * Math.min(1, scale)));
        const height = Math.max(1, Math.round((bitmap.height || 1) * Math.min(1, scale)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return { preview: '', bytes: size };
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        return { preview: sanitizePicturePreview(canvas.toDataURL('image/jpeg', 0.5)), bytes: size };
    } catch {
        return { preview: '', bytes: size };
    } finally {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
}
