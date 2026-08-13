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
export const ALLOWED_LINK_HOST = /(^|\.)nexttrain\.co\.za$/i;

/** Clear slurs / sexual / aggressive swearing — refuse. */
const BLOCK_WORDS = [
    // English
    'fuck', 'fucker', 'fucking', 'motherfucker', 'motherfuckers',
    'shit', 'bullshit', 'horseshit', 'shithead',
    'bitch', 'bitches', 'asshole', 'assholes',
    'cunt', 'cunts', 'whore', 'whores', 'slut', 'sluts',
    'dickhead', 'dickheads', 'cock', 'cocksucker',
    'wanker', 'wankers', 'bastard', 'bastards',
    'nigger', 'niggers', 'nigga', 'niggas',
    'faggot', 'faggots', 'fag',
    'retard', 'retards', 'retarded',
    'kike', 'spic', 'chink', 'paki',
    // Afrikaans
    'fok', 'fokken', 'fokkit', 'fokof',
    'poes', 'poese', 'doos', 'dose',
    'naai', 'naaier', 'hoer', 'hoere',
    'moer', 'moerse',
    // Nguni / Sotho (common public insults)
    'msunu', 'umsunu', 'nyo',
    'isifebe', 'sefebe',
    'mthakathi',
];

/** Mild / ambiguous / often used as intensifiers — hold for a human. */
const REVIEW_WORDS = [
    'kak', 'kaka', 'kakhuis',
    'bliksem', 'donder', 'donderse',
    'hol', 'gat',
    'pussy', 'dick', 'piss', 'crap', 'damn',
    'idiot', 'idiots', 'stupid', 'dumbass',
    'kill', 'kys', 'voetsek', 'voertsek',
];

const BLOCK_SET = new Set(BLOCK_WORDS);
const REVIEW_SET = new Set(REVIEW_WORDS);

const LOOKALIKES = {
    а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', і: 'i',
    у: 'y', к: 'k', н: 'h', т: 't', в: 'b', м: 'm',
};

function foldChars(text) {
    let s = String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    s = s.replace(/[аеорсхіукнтвм]/g, (ch) => LOOKALIKES[ch] || ch);
    s = s
        .replace(/0/g, 'o')
        .replace(/1/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/7/g, 't')
        .replace(/@/g, 'a')
        .replace(/\$/g, 's');
    return s;
}

/** Letters-only form used to catch f*ck / f.u.c.k / sh1t. */
function lettersOnly(text) {
    return foldChars(text).replace(/[^a-z]+/g, '');
}

function tokens(text) {
    return foldChars(text)
        .replace(/[^a-z0-9\s']/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

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

function hasSpacedWord(folded, word) {
    if (!word || word.length < 4) return false;
    const re = new RegExp(`(?:^|[^a-z])${word.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z]*')}(?:[^a-z]|$)`, 'i');
    return re.test(folded);
}

function editDistance1(a, b) {
    if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
    if (a === b) return true;
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    let i = 0;
    let j = 0;
    let diff = 0;
    while (i < short.length && j < long.length) {
        if (short[i] === long[j]) { i += 1; j += 1; continue; }
        diff += 1;
        if (diff > 1) return false;
        if (long.length > short.length) j += 1;
        else { i += 1; j += 1; }
    }
    diff += (short.length - i) + (long.length - j);
    return diff === 1;
}

function wordHits(text) {
    const words = tokens(text);
    const folded = foldChars(text);
    const block = [];
    const review = [];
    for (const w of words) {
        if (BLOCK_SET.has(w)) block.push(w);
        else if (REVIEW_SET.has(w)) review.push(w);
    }
    const rawTokens = String(text || '').split(/\s+/).filter(Boolean);
    for (const raw of rawTokens) {
        const letters = lettersOnly(raw);
        const masked = /[a-z0-9][^a-z0-9]+[a-z0-9]/i.test(raw);
        if (!letters || letters.length < 3) continue;
        for (const bad of BLOCK_SET) {
            if (bad.length < 4) continue;
            if (letters === bad || (masked && editDistance1(letters, bad))) {
                if (!block.includes(bad)) block.push(bad);
            }
        }
        if (masked) {
            for (const mild of REVIEW_SET) {
                if (mild.length >= 4 && (letters === mild || editDistance1(letters, mild)) && !review.includes(mild)) {
                    review.push(mild);
                }
            }
        }
    }
    for (const bad of BLOCK_SET) {
        if (hasSpacedWord(folded, bad) && !block.includes(bad)) block.push(bad);
    }
    return { block, review };
}

function looksObfuscated(text) {
    const raw = String(text || '');
    if (/[a-z][*._\-#]{1,3}[a-z]/i.test(raw)) return true;
    if (/(.)\1{7,}/.test(raw)) return true;
    return false;
}

function fuzzyBlockHit(text) {
    const words = tokens(text).filter((w) => w.length >= 3);
    for (const w of words) {
        for (const bad of BLOCK_SET) {
            if (bad.length < 4) continue;
            if (w === bad) continue;
            // Only shorter tokens (fuk/fuck). Longer ones like "shift"/"shit" are normal words.
            if (w.length >= bad.length || bad.length - w.length > 1) continue;
            let diff = 0;
            const a = w.length <= bad.length ? w : bad;
            const b = w.length <= bad.length ? bad : w;
            let i = 0;
            let j = 0;
            while (i < a.length && j < b.length) {
                if (a[i] === b[j]) { i += 1; j += 1; continue; }
                diff += 1;
                if (b.length > a.length) j += 1;
                else if (a.length > b.length) i += 1;
                else { i += 1; j += 1; }
                if (diff > 1) break;
            }
            diff += (a.length - i) + (b.length - j);
            if (diff === 1) return w;
        }
    }
    return '';
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
                message: 'Only nexttrain.co.za links are allowed. Remove other websites and try again.',
            };
        }
    }

    const probe = live ? raw.replace(/\S+$/, (last) => (/\s$/.test(raw) ? last : '')) : raw;
    const hits = wordHits(live ? probe : raw);
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

    const fuzzy = fuzzyBlockHit(raw);
    if (fuzzy) {
        return {
            ok: false,
            verdict: 'review',
            reason: 'fuzzy_profanity',
            message: 'We’re checking this message. It won’t appear until an admin approves it.',
        };
    }
    if (looksObfuscated(raw) && hits.review.length) {
        return {
            ok: false,
            verdict: 'review',
            reason: 'obfuscated',
            message: 'We’re checking this message. It won’t appear until an admin approves it.',
        };
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
