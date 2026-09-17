/**
 * Community / Account display names.
 * Default: first word + remaining initials. "Enock Leo Kazembe" → "Enock LK".
 * Custom names (Account) are stored as-is, capped at 80 characters.
 */

import { checkContentSafety, findDisallowedUrls } from './content-safety.js';

export const DISPLAY_NAME_MAX = 80;
export const DISPLAY_NAME_REFUSE_MSG = 'Choose a different name.';

const BARE_DOMAIN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\.[a-z]{2,}\b/i;

export function formatAccountDisplayName(fullName) {
    const parts = String(fullName || '')
        .trim()
        .split(/\s+/)
        .map((p) => p.replace(/[^a-zA-Z0-9'\u00C0-\u024F-]/g, ''))
        .filter(Boolean);
    if (!parts.length) return 'Passenger';
    const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    if (parts.length === 1) return first.slice(0, DISPLAY_NAME_MAX);
    const initials = parts.slice(1).map((p) => p.charAt(0).toUpperCase()).join('');
    return `${first} ${initials}`.slice(0, DISPLAY_NAME_MAX);
}

export function clampDisplayName(raw) {
    const s = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    return s.slice(0, DISPLAY_NAME_MAX);
}

export function displayNameLooksLikeUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    if (/:\/\//.test(s) || /\bwww\./i.test(s) || BARE_DOMAIN.test(s)) return true;
    return findDisallowedUrls(s).length > 0;
}

/** Empty names are allowed (caller falls back to Auth/email). */
export function refuseDisplayName(raw) {
    const custom = clampDisplayName(raw);
    if (!custom) return { ok: true, name: '' };
    if (displayNameLooksLikeUrl(custom)) {
        return { ok: false, name: custom, reason: 'url', message: DISPLAY_NAME_REFUSE_MSG };
    }
    const safety = checkContentSafety(custom, { allowLinks: false });
    if (!safety.ok || safety.verdict === 'block' || safety.verdict === 'review') {
        return { ok: false, name: custom, reason: safety.reason || 'blocked', message: DISPLAY_NAME_REFUSE_MSG };
    }
    return { ok: true, name: custom };
}

export function resolveAccountDisplayName(user, profile) {
    const custom = clampDisplayName(profile?.displayName);
    if (profile?.displayNameCustom && custom) return custom;
    const fromAuth = user?.displayName || (user?.email ? String(user.email).split('@')[0] : '');
    if (custom && custom !== String(user?.displayName || '').trim()) return custom;
    return formatAccountDisplayName(fromAuth);
}
