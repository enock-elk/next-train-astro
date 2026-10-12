/**
 * Allowlist for community avatar URLs. Identity-provider CDNs only.
 * javascript:/data:/http: and random hosts never reach <img src>.
 */

const MAX_PHOTO_URL = 2000;

function isAllowedPhotoHost(host) {
    const h = String(host || '').toLowerCase();
    if (!h) return false;
    if (h === 'firebasestorage.googleapis.com' || h === 'storage.googleapis.com') return true;
    if (h.endsWith('.firebasestorage.app')) return true;
    if (h.endsWith('.googleusercontent.com')) return true;
    if (h === 'graph.facebook.com' || h.endsWith('.facebook.com')) return true;
    if (h.endsWith('.fbcdn.net')) return true;
    if (h.endsWith('.cdn-apple.com') || h.endsWith('.mzstatic.com')) return true;
    return false;
}

export function sanitizeCommunityPhotoUrl(url) {
    const s = String(url || '').trim();
    if (!s || s.length > MAX_PHOTO_URL || /[\s<>]/.test(s)) return null;
    try {
        const u = new URL(s);
        if (u.protocol !== 'https:') return null;
        if (u.username || u.password) return null;
        if (!isAllowedPhotoHost(u.hostname)) return null;
        return u.href;
    } catch {
        return null;
    }
}
