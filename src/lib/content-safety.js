/**
 * Refuse unsafe user text at the source.
 *
 * verdict:
 *   allow  — send as usual
 *   block  — do not send; tell the user why
 *   review — hold for admin (moderation tab); do not show publicly
 *
 * nexttrain.co.za links are allowed. Other URLs are blocked.
 * Profanity lists cover English plus common ZA slang (Afrikaans, Nguni, Sotho).
 * Masked / lookalike forms are treated as the same word. Weak matches → review.
 */
import { classifyUnsafeLanguage } from './content-safety-core.js';

export const ALLOWED_LINK_HOST = /(^|\.)nexttrain\.co\.za$/i;

function extractUrls(text) {
    const raw = String(text || '');
    const found = [];
    const re = /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\.[a-z]{2,})(?:\/[^\s<>"']*)?)/gi;
    let m;
    while ((m = re.exec(raw))) found.push(m[1]);
    return found;
}

function hostOf(raw) {
    try {
        const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        return new URL(withScheme).hostname.replace(/^www\./i, '');
    } catch {
        return '';
    }
}

export function findDisallowedUrls(text) {
    return extractUrls(text).filter((u) => {
        const host = hostOf(u);
        if (!host) return /https?:\/\//i.test(u) || /^www\./i.test(u);
        if (ALLOWED_LINK_HOST.test(host)) return false;
        // Bare nexttrain mention without extra TLD noise
        if (/^nexttrain\.co\.za$/i.test(host)) return false;
        return true;
    });
}

/**
 * @param {string} text
 * @param {{ live?: boolean, allowLinks?: boolean }} [opts]
 * @returns {{ ok: boolean, verdict: 'allow'|'block'|'review', reason: string, message: string }}
 */
export function checkContentSafety(text, { live = false, allowLinks = false } = {}) {
    const raw = String(text || '');
    if (!raw.trim()) {
        return { ok: true, verdict: 'allow', reason: '', message: '' };
    }

    if (!allowLinks) {
        const badLinks = findDisallowedUrls(raw);
        if (badLinks.length) {
            return {
                ok: false,
                verdict: 'block',
                reason: 'url',
                message: "Couldn't post that.",
            };
        }
    }

    const probe = live ? raw.replace(/\S+$/, (last) => (/\s$/.test(raw) ? last : '')) : raw;
    const hits = classifyUnsafeLanguage(live ? probe : raw);
    if (hits.block.length) {
        return {
            ok: false,
            verdict: 'block',
            reason: 'profanity',
            message: 'That language isn’t allowed. Please rewrite without swearing or slurs.',
        };
    }

    if (live) {
        return { ok: true, verdict: 'allow', reason: '', message: '' };
    }

    if (hits.review.length) {
        return {
            ok: false,
            verdict: 'review',
            reason: 'mild_or_ambiguous',
            message: 'We’re checking this message. It won’t appear until an admin approves it.',
        };
    }

    // Non-English we don’t list: if the note is mostly non-Latin and very aggressive, hold.
    const letters = raw.replace(/\s+/g, '');
    const nonLatin = (letters.match(/[^\u0000-\u007f]/g) || []).length;
    if (letters.length >= 8 && nonLatin / letters.length > 0.6 && /[!]{2,}|[?]{3,}/.test(raw)) {
        return {
            ok: false,
            verdict: 'review',
            reason: 'non_english_unsure',
            message: 'We’re checking this message. It won’t appear until an admin approves it.',
        };
    }

    return { ok: true, verdict: 'allow', reason: '', message: '' };
}

export function formatWait(ms) {
    const s = Math.max(1, Math.ceil(Math.max(0, ms) / 1000));
    if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (!rem) return `${m} minute${m === 1 ? '' : 's'}`;
    return `${m} min ${rem}s`;
}

export function rateLimitMessage(reason, retryAfterMs) {
    const wait = formatWait(retryAfterMs);
    if (reason === 'quota') {
        return `You’ve sent too many messages. Wait ${wait} before you can send another.`;
    }
    if (reason === 'route') {
        return `You already sent one for this route. Wait ${wait} before you can send another.`;
    }
    return `Please wait ${wait} before you can send another message.`;
}

/**
 * Paint a live countdown on an element. Returns a cancel function.
 * @param {HTMLElement|null} el
 * @param {number} retryAfterMs
 * @param {{ reason?: string, onDone?: () => void }} [opts]
 */
export function startRateLimitCountdown(el, retryAfterMs, { reason = 'cooldown', onDone } = {}) {
    if (!el) return () => {};
    let timer = 0;
    const end = Date.now() + Math.max(0, retryAfterMs);
    const tick = () => {
        const left = end - Date.now();
        if (left <= 0) {
            el.textContent = '';
            onDone?.();
            return;
        }
        el.textContent = rateLimitMessage(reason, left);
        timer = setTimeout(tick, 250);
    };
    tick();
    return () => {
        if (timer) clearTimeout(timer);
    };
}
