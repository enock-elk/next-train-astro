/**
 * Shared language classifier for the browser and Community Worker.
 *
 * Keep generic phrase components (for example "jou", "your", and "ma") out of
 * the word lists. They are only unsafe when a complete listed phrase matches.
 */
const BLOCK_WORDS = [
    // English: severe profanity, slurs, and explicit sexual abuse.
    'fuck', 'fucker', 'fucking', 'motherfucker', 'motherfuckers',
    'shit', 'bullshit', 'horseshit', 'shithead',
    'bitch', 'bitches', 'asshole', 'assholes',
    'cunt', 'cunts', 'whore', 'whores', 'slut', 'sluts',
    'dickhead', 'dickheads', 'cocksucker',
    'wanker', 'wankers', 'bastard', 'bastards',
    'nigger', 'niggers', 'nigga', 'niggas',
    'faggot', 'faggots', 'fag',
    'retard', 'retards', 'retarded',
    'kike', 'spic', 'chink', 'paki',
    // Afrikaans and South African slang.
    'fok', 'fokken', 'fokkit', 'fokof', 'vok', 'vokken',
    'poes', 'poese', 'doos', 'dose', 'kont',
    'naai', 'naaier', 'hoer', 'hoere', 'moffie', 'kaffer', 'kaffir', 'boesman',
    'poephol', 'varkpoes', 'varknaaier', 'hoerkind', 'kontgesig',
    'poesgesig', 'poesneus', 'pielvel', 'mofgat',
    // isiZulu / isiXhosa and Sesotho.
    'msunu', 'umsunu', 'nyo', 'isifebe', 'sefebe', 'unondindwa',
    'letekatse', 'kwerekwere', 'makwerekwere', 'amakwerekwere',
    'dlwengula', 'ukudlwengula',
];

const BLOCK_PHRASES = [
    // Threatening or explicit sexual abuse.
    'kill yourself', 'go kill yourself', 'go die', 'i will kill you', 'ill kill you',
    'i am going to kill you', 'rape you', 'i will rape you', 'ill rape you',
    'suck my dick', 'suck my cock', 'eat my ass',
    // Afrikaans / South African slang. Generic components only match together.
    'jou ma se poes', 'ma se poes', 'jou poes', 'die poes', 'jy is n poes',
    'jou doos', 'dom doos', 'fok jou', 'fok iou', 'gaan fok jouself',
    'gaan kak', 'gaan kak in jou ma se moer', 'loop naai jou ma',
    'jy naai jou ma vir sakgeld', 'jou naai', 'suig my piel', 'eet my poes',
    'naai jou', 'jou kont se kind', 'jou ma se bloed poes',
    'jou fokken poesneus', 'jou fokken pielvel', 'jou simpel kont',
    'jou ma se stink poes', 'jou ma se pink en pers poes',
    'jou ma se voelepte poes', 'jou ma naai vir snoek koppe',
    'ek sal jou doodmaak', 'ek gaan jou doodmaak', 'maak jou dood',
    // isiZulu.
    'hamba uyofa', 'hamba ufe', 'ngizokubulala', 'ngizo kubulala',
    'ngizokubulala wena', 'ngizokudlwengula', 'ngizokushaya',
    // Sesotho.
    'ke tla o bolaya', 'ke tla ho bolaya', 'tsamaya o shwe',
    'ke tla o beta', 'ke tla ho beta',
];

const REVIEW_WORDS = [
    // English: milder or context-dependent insults.
    'pussy', 'dick', 'cock', 'piss', 'crap', 'damn',
    'idiot', 'idiots', 'stupid', 'dumbass',
    'kill', 'kys',
    // Afrikaans and South African slang.
    'kak', 'kaka', 'kakhuis', 'bliksem', 'donder', 'donderse',
    'hol', 'gat', 'moer', 'moerse', 'voetsek', 'voertsek',
    // isiZulu and Sesotho: ambiguous insults or words with benign contexts.
    'inja', 'isilima', 'uyisilima', 'mthakathi',
    'leqai', 'setlaela', 'sephoqo', 'lehlanya', 'iphukuphuku', 'bulala', 'bolaya',
];

const REVIEW_PHRASES = [
    'shut up', 'you are useless', 'youre useless',
    'jou idioot', 'jou domkop', 'domkop', 'trilkop', 'vol kak',
    'diep in die kak', 'jy is vol kak', 'pis my af', 'hamba wena',
];

const BLOCK_SET = new Set(BLOCK_WORDS);
const REVIEW_SET = new Set(REVIEW_WORDS);
const LOOKALIKES = {
    а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', і: 'i',
    у: 'y', к: 'k', н: 'h', т: 't', в: 'b', м: 'm',
};

export function foldSafetyText(text) {
    return String(text || '')
        .toLowerCase()
        // Afrikaans "hoër" means "higher"; it is not the slur "hoer".
        .replace(/(^|[^\p{L}])hoër(?=$|[^\p{L}])/gu, '$1higher')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[‘’‚‛′`´]/g, "'")
        .replace(/[аеорсхіукнтвм]/g, (ch) => LOOKALIKES[ch] || ch)
        .replace(/0/g, 'o')
        .replace(/[1!|]/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4|@/g, 'a')
        .replace(/5|\$/g, 's')
        .replace(/7/g, 't')
        .replace(/8/g, 'b');
}

function canonicalWords(text) {
    return foldSafetyText(text)
        .replace(/['-]+/g, ' ')
        .replace(/[^a-z\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function compactToken(raw) {
    return foldSafetyText(raw).replace(/[^a-z]+/g, '');
}

function phrasePattern(phrase) {
    const words = phrase.split(' ');
    return new RegExp(`(?:^|[^a-z])${words.map((word) =>
        word.split('').join('[^a-z]*')
    ).join('[^a-z]+')}(?:[^a-z]|$)`, 'i');
}

const BLOCK_PHRASE_PATTERNS = BLOCK_PHRASES.map((phrase) => [phrase, phrasePattern(phrase)]);
const REVIEW_PHRASE_PATTERNS = REVIEW_PHRASES.map((phrase) => [phrase, phrasePattern(phrase)]);

function phraseHits(folded, patterns) {
    return patterns.filter(([, pattern]) => pattern.test(folded)).map(([phrase]) => phrase);
}

function obfuscatedWordHits(text, lexicon) {
    const hits = [];
    const chunks = String(text || '').split(/\s+/).filter(Boolean);
    for (const chunk of chunks) {
        const compact = compactToken(chunk);
        if (!compact || compact.length < 3) continue;
        if (lexicon.has(compact) && !hits.includes(compact)) hits.push(compact);
        const depeated = compact.replace(/(.)\1{2,}/g, '$1');
        if (lexicon.has(depeated) && !hits.includes(depeated)) hits.push(depeated);
    }
    const foldedTokens = canonicalWords(text).split(' ').filter(Boolean);
    for (let start = 0; start < foldedTokens.length; start += 1) {
        if (foldedTokens[start].length !== 1) continue;
        let joined = '';
        for (let end = start; end < Math.min(foldedTokens.length, start + 16); end += 1) {
            if (foldedTokens[end].length !== 1) break;
            joined += foldedTokens[end];
            if (joined.length >= 4 && lexicon.has(joined) && !hits.includes(joined)) {
                hits.push(joined);
            }
        }
    }
    return hits;
}

export const ALLOWED_LINK_HOST = /(^|\.)nexttrain\.co\.za$/i;

/**
 * Collapse spaced URL evasions: `www.nexttrain .co.za`, `chat . whatsapp . com`,
 * `http : // example.com`. Does not merge ordinary sentence punctuation.
 */
export function collapseSpacedUrlText(text) {
    let s = String(text || '');
    s = s.replace(/h\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\//gi, (m) => m.replace(/\s+/g, ''));
    s = s.replace(/\bwww\s*\./gi, 'www.');
    for (let i = 0; i < 8; i += 1) {
        const next = s
            .replace(/([a-z0-9-])\s*\.\s*(?=[a-z0-9])/gi, '$1.')
            .replace(/([a-z0-9.-])\s*\/\s*/g, '$1/')
            .replace(/@\s+/g, '@');
        if (next === s) break;
        s = next;
    }
    return s;
}

function extractUrls(text) {
    const raw = collapseSpacedUrlText(text);
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
        if (/^nexttrain\.co\.za$/i.test(host)) return false;
        return true;
    });
}

function scamFold(text) {
    return collapseSpacedUrlText(text)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[‘’‚‛′`´]/g, "'")
        .replace(/%/g, ' percent ')
        .replace(/\$/g, ' dollars ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Selling / scam packs. Phrase-level: a commuter can still say “join me”,
 * “platform 2”, “salary late”, or “trust the process” about a late train.
 */
export function classifyScamContent(text) {
    const folded = scamFold(text);
    const block = [];
    const review = [];
    if (!folded) return { block, review };

    const hit = (label, ok) => {
        if (ok && !block.includes(label)) block.push(label);
    };

    hit('bitcoin', /\b(bitcoin|bit coin|btc)\b/.test(folded));
    hit('forex', /\bforex\b/.test(folded));
    hit('binary', /\bbinary\s*(fx|option|options)\b/.test(folded));
    hit('crypto', /\bcrypto(currency)?\b/.test(folded) && /\b(invest|profit|trading|trade|mining)\b/.test(folded));
    hit('invest-plan', /\binvest\b/.test(folded) && /\b(dollars|usd|get|profit)\b/.test(folded) && /\d{2,}/.test(folded));
    hit('invest-pack', /\binvest\b/.test(folded) && /\b(mining|profit|legit|salary)\b/.test(folded));
    hit('mining', /\bmining\b/.test(folded) && /\b(invest|profit|bitcoin|earn|labour|labor)\b/.test(folded));
    hit('electricity-units', /\b(electricity|prepaid|elec)\b/.test(folded) && /\bunits?\b/.test(folded));
    hit('units-sale', /\bunits?\b/.test(folded) && /\b(for sale|selling|buy)\b/.test(folded));
    hit('drugs', /\b(nyaope|mandrax|cocaine|meth)\b/.test(folded));
    hit('drugs-sale', /\b(dagga|weed)\b/.test(folded) && /\b(sale|selling|buy|sold)\b/.test(folded));
    hit('tik', /\btik\b/.test(folded) && !/\btik\s*tok\b/.test(folded) && !/\btiktok\b/.test(folded));
    hit('legit-scam', /\b100\s*percent\s*legit\b/.test(folded));
    hit('trust-process', /\btrust the process\b/.test(folded) && /\b(invest|money|profit|bitcoin|salary)\b/.test(folded));
    hit('salary-rich', /\bsalary\b/.test(folded) && /\brich\b/.test(folded) && /\b(invest|join|wont|will not|won t)\b/.test(folded));
    hit('wa-invite', /\bwhatsapp\b/.test(folded) && /\b(group|invite)\b/.test(folded) && /\b(invest|bitcoin|forex|profit|trading|crypto)\b/.test(folded));

    if (!block.length && /\binvest\b/.test(folded) && /\b(money|profit)\b/.test(folded)) {
        review.push('invest-thin');
    }
    return { block, review };
}

/**
 * Return severe block hits and milder review hits.
 * Phrase matching tolerates punctuation, apostrophes, hyphens, whitespace,
 * diacritics, common lookalikes, and leetspeak without matching substrings.
 */
export function classifyUnsafeLanguage(text) {
    const folded = foldSafetyText(text);
    const words = canonicalWords(text).split(' ').filter(Boolean);
    const block = words.filter((word, index) => BLOCK_SET.has(word) && words.indexOf(word) === index);
    const review = words.filter((word, index) => REVIEW_SET.has(word) && words.indexOf(word) === index);

    for (const hit of obfuscatedWordHits(text, BLOCK_SET)) {
        if (!block.includes(hit)) block.push(hit);
    }
    for (const hit of obfuscatedWordHits(text, REVIEW_SET)) {
        if (!review.includes(hit)) review.push(hit);
    }
    for (const hit of phraseHits(folded, BLOCK_PHRASE_PATTERNS)) {
        if (!block.includes(hit)) block.push(hit);
    }
    for (const hit of phraseHits(folded, REVIEW_PHRASE_PATTERNS)) {
        if (!review.includes(hit)) review.push(hit);
    }

    return { block, review };
}
