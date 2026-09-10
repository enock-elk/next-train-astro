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
