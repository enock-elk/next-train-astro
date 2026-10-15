/**
 * Suggest-a-reply helpers. Pure: no network, no DOM.
 * The reply worker and the Dev Hub composer both use this module.
 * Drafts never include another person's email. A halt never becomes composer HTML.
 */

export const SUGGEST_SIMILAR_LIMIT = 8;
export const SUGGEST_NOTE_MAX = 4000;
export const SUGGEST_MAX_IMAGES = 3;
export const SUGGEST_MAX_IMAGE_BYTES = 1_500_000;
export const SUGGEST_THREAD_LIMIT = 40;

export const PRASA_SURVEY_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeGSJmZlpg8dq2Dvupm9xyHcFJudGsegZ2uyhS3UEq3O9fGkA/viewform';

/** Gauteng offices from the public guide. Other regions use the survey only. */
export const GAUTENG_OFFICES = [
    { office: 'Johannesburg', phones: ['011 013 0191', '011 013 0192'] },
    { office: 'Pretoria', phones: ['011 013 0306'] },
    { office: 'Germiston', phones: ['011 085 7118'] },
];

const GAUTENG_PHONE_DIGITS = GAUTENG_OFFICES.flatMap((office) => office.phones.map(phoneDigits));

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const STOP_WORDS = new Set([
    'that', 'this', 'with', 'from', 'have', 'your', 'they', 'them', 'were', 'been',
    'will', 'just', 'when', 'what', 'please', 'train', 'trains', 'there', 'their',
    'about', 'would', 'could', 'should', 'because', 'which', 'also', 'into', 'only',
]);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function phoneDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

export function normalizeSuggestRegion(value) {
    const s = String(value || '').trim().toLowerCase();
    if (!s) return '';
    if (s === 'gp' || s.includes('gauteng')) return 'GP';
    if (s === 'wc' || s.includes('western')) return 'WC';
    if (s === 'kzn' || s.includes('kwazulu') || s.includes('natal')) return 'KZN';
    if (s === 'ec' || s.includes('eastern cape')) return 'EC';
    return '';
}

export function plainThreadText(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

export function redactEmails(value) {
    return plainThreadText(value).replace(EMAIL_RE, '[email]');
}

function clip(value, max) {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
}

function contentWords(value) {
    const words = redactEmails(value).toLowerCase().match(/[a-z0-9']{4,}/g) || [];
    return words.filter((word) => !STOP_WORDS.has(word));
}

function deviceOf(item) {
    return String(item?.device_id || item?.deviceId || '').trim();
}

function itemRegion(item, routeRegionOf) {
    const direct = normalizeSuggestRegion(item?.region || item?.routeRegion || '');
    if (direct) return direct;
    if (typeof routeRegionOf === 'function') return normalizeSuggestRegion(routeRegionOf(item?.routeId));
    return '';
}

function threadMessages(items) {
    return items
        .slice()
        .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0))
        .slice(-SUGGEST_THREAD_LIMIT)
        .map((item) => ({
            from: item?.isFromAdmin ? 'admin' : 'commuter',
            text: clip(redactEmails(item?.text || item?.message || ''), 1200),
            at: Number(item?.timestamp || 0) || 0,
        }))
        .filter((row) => row.text);
}

/**
 * Up to eight other threads that share words, and the same route or region when known.
 * Each example is one commuter snippet plus one admin reply. No emails.
 */
export function pickSimilarReplies(allItems, threadItems, options = {}) {
    const limit = Math.max(0, Number(options.limit ?? SUGGEST_SIMILAR_LIMIT) || 0);
    const routeRegionOf = options.routeRegionOf;
    const currentId = String(options.deviceId || deviceOf(threadItems?.[0]) || '').trim();
    const currentWords = new Set(contentWords((threadItems || []).filter((item) => !item?.isFromAdmin).map((item) => item?.text || item?.message || '').join(' ')));
    const currentRoute = String(options.routeId || '').trim();
    const currentRegion = normalizeSuggestRegion(options.region || '');
    const groups = new Map();
    for (const item of allItems || []) {
        const did = deviceOf(item);
        if (!did || did === currentId || did === 'Anonymous / Legacy') continue;
        if (!groups.has(did)) groups.set(did, []);
        groups.get(did).push(item);
    }
    const ranked = [];
    for (const [did, items] of groups) {
        const ordered = items.slice().sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
        const admin = [...ordered].reverse().find((item) => item?.isFromAdmin && plainThreadText(item?.text || item?.message || '').length >= 8);
        if (!admin) continue;
        const commuterBits = ordered.filter((item) => !item?.isFromAdmin);
        const commuterText = commuterBits.map((item) => item?.text || item?.message || '').join('\n');
        const words = contentWords(commuterText);
        let shared = 0;
        for (const word of words) {
            if (currentWords.has(word)) shared += 1;
        }
        const routeId = String([...commuterBits].reverse().find((item) => item?.routeId)?.routeId || admin.routeId || '').trim();
        const region = itemRegion(commuterBits[commuterBits.length - 1] || admin, routeRegionOf);
        let score = shared;
        if (currentRoute && routeId && routeId === currentRoute) score += 4;
        if (currentRegion && region && region === currentRegion) score += 2;
        if (shared < 1) continue;
        ranked.push({
            deviceId: did,
            region,
            routeId,
            commuter: clip(redactEmails(commuterText), 500),
            admin: clip(redactEmails(admin.text || admin.message || ''), 700),
            score,
        });
    }
    ranked.sort((a, b) => b.score - a.score || a.deviceId.localeCompare(b.deviceId));
    return ranked.slice(0, limit).map(({ score, ...row }) => row);
}

const ROLE_LOCAL = new Set([
    'info', 'admin', 'support', 'hello', 'mail', 'contact', 'noreply', 'no-reply',
    'user', 'test', 'help', 'office', 'sales', 'feedback', 'nexttrain', 'train',
    'metro', 'metrorail', 'commuter', 'anonymous', 'nobody', 'postmaster', 'webmaster',
]);

const NOT_A_NAME = new Set([
    ...ROLE_LOCAL,
    'good', 'fine', 'here', 'from', 'just', 'well', 'back', 'late', 'sorry',
    'interested', 'looking', 'writing', 'using', 'asking', 'happy', 'sure',
    'okay', 'new', 'the', 'and', 'thanks', 'thank', 'please', 'sunday', 'ticket',
]);

/** First names we will treat as certain when they are the start of an email. */
const FIRST_NAMES = new Set([
    'enock', 'thandeka', 'sipho', 'thabo', 'kudzi', 'nomsa', 'lerato', 'ayanda',
    'nokuthula', 'nandipha', 'nthabiseng', 'mmabatho', 'kagiso', 'tumelo', 'karabo',
    'boitumelo', 'refiloe', 'pule', 'tebogo', 'tshepo', 'thabiso', 'thabang',
    'sello', 'molefe', 'dineo', 'palesa', 'kabelo', 'neo', 'amogelang', 'onthatile',
    'bongani', 'sibusiso', 'nhlanhla', 'mandla', 'sibongile', 'nonhlanhla', 'zanele',
    'nokwanda', 'lindiwe', 'busisiwe', 'thulisile', 'nokukhanya', 'andile', 'luyanda',
    'viwe', 'asanda', 'anathi', 'litha', 'sanele', 'mpho', 'lesego', 'keneilwe',
    'gorata', 'ontlametse', 'johannes', 'pieter', 'andries', 'willem', 'christiaan',
    'jacoba', 'annelie', 'elize', 'marlize',     'john', 'peter', 'david', 'michael',
    'sarah', 'mary', 'james', 'daniel', 'samuel', 'joseph',
]);

const FIRST_NAMES_LONG = [...FIRST_NAMES].filter((name) => name.length >= 5).sort((a, b) => b.length - a.length);

function titleName(value) {
    const word = String(value || '').toLowerCase();
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function honorificName(title, surname) {
    const last = titleName(surname);
    const honor = String(title || 'Mr').replace(/\./g, '');
    const nice = honor.charAt(0).toUpperCase() + honor.slice(1).toLowerCase();
    if (!last || NOT_A_NAME.has(last.toLowerCase())) return '';
    return `Dear ${nice} ${last}`;
}

function firstNameGreeting(value) {
    const name = titleName(value);
    if (!/^[A-Z][a-z'’-]{2,20}$/.test(name)) return '';
    if (NOT_A_NAME.has(name.toLowerCase())) return '';
    return `Dear ${name}`;
}

function greetingFromEmail(email) {
    const raw = String(email || '').split('@')[0].split('+')[0].toLowerCase();
    if (!raw || raw.includes(' ')) return '';
    const parts = raw.split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) {
        const [first, second] = parts;
        if (first.length === 1 && /^[a-z]{3,20}$/.test(second) && !ROLE_LOCAL.has(second) && !NOT_A_NAME.has(second)) {
            return honorificName('Mr', second);
        }
        if (second.length === 1 && /^[a-z]{3,20}$/.test(first) && !FIRST_NAMES.has(first) && !ROLE_LOCAL.has(first) && !NOT_A_NAME.has(first)) {
            return honorificName('Mr', first);
        }
        if (FIRST_NAMES.has(first)) return firstNameGreeting(first);
        if (FIRST_NAMES.has(second)) return firstNameGreeting(second);
        return '';
    }
    const letters = raw.replace(/[^a-z]/g, '');
    if (!letters || ROLE_LOCAL.has(letters) || NOT_A_NAME.has(letters)) return '';
    if (FIRST_NAMES.has(letters)) return firstNameGreeting(letters);
    for (const name of FIRST_NAMES_LONG) {
        if (!letters.startsWith(name)) continue;
        const rest = letters.slice(name.length);
        if (/^[a-z]{2,12}$/.test(rest)) return firstNameGreeting(name);
    }
    return '';
}

function greetingFromText(text) {
    const source = String(text || '');
    const titled = source.match(/\b(Mr|Mrs|Ms|Miss)\.?\s+([A-Za-z]{3,20})\b/i);
    if (titled && !NOT_A_NAME.has(titled[2].toLowerCase())) return honorificName(titled[1], titled[2]);
    const named = source.match(/\bmy name is\s+([A-Za-z]{3,20})(?:\s+([A-Za-z]{3,20}))?/i);
    if (named && !NOT_A_NAME.has(named[1].toLowerCase())) return firstNameGreeting(named[1]);
    const intro = source.match(/\b(?:i am|i'm|this is)\s+([A-Za-z]{3,20})(?:\s+([A-Za-z]{3,20}))?/i);
    if (intro && FIRST_NAMES.has(intro[1].toLowerCase())) return firstNameGreeting(intro[1]);
    const emails = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const email of emails) {
        const greeting = greetingFromEmail(email);
        if (greeting) return greeting;
    }
    return '';
}

function greetingFromAlias(alias) {
    const text = plainThreadText(alias);
    if (!text || text.includes('@') || /^usr_/i.test(text)) return '';
    const titled = text.match(/^(Mr|Mrs|Ms|Miss)\.?\s+([A-Za-z]{3,20})$/i);
    if (titled && !NOT_A_NAME.has(titled[2].toLowerCase())) return honorificName(titled[1], titled[2]);
    const words = text.split(/\s+/);
    if (words.length > 2) return '';
    if (!FIRST_NAMES.has(words[0].toLowerCase())) return '';
    return firstNameGreeting(words[0]);
}

/** A greeting only when the name is clear. Never returns the email address. */
export function certainGreeting({ alias = '', emails = [], texts = [] } = {}) {
    for (const text of texts) {
        const fromText = greetingFromText(text);
        if (fromText) return fromText;
    }
    const fromAlias = greetingFromAlias(alias);
    if (fromAlias) return fromAlias;
    for (const email of emails) {
        const fromEmail = greetingFromEmail(email);
        if (fromEmail) return fromEmail;
    }
    return '';
}

export function buildSuggestPayload(items, options = {}) {
    const deviceId = String(options.deviceId || '').trim();
    const list = (Array.isArray(items) ? items : []).filter((item) => !deviceId || deviceOf(item) === deviceId);
    const routeRegionOf = options.routeRegionOf;
    const routeId = String(
        options.routeId
        || [...list].reverse().find((item) => !item?.isFromAdmin && item?.routeId)?.routeId
        || ''
    ).trim();
    const region = normalizeSuggestRegion(
        options.region
        || [...list].reverse().map((item) => itemRegion(item, routeRegionOf)).find(Boolean)
        || ''
    );
    const greeting = certainGreeting({
        alias: options.alias || '',
        emails: list.map((item) => item?.email).filter(Boolean),
        texts: list.filter((item) => !item?.isFromAdmin).map((item) => item?.text || item?.message || ''),
    });
    const thread = threadMessages(list);
    const similar = pickSimilarReplies(options.allItems || items || [], list, {
        deviceId,
        routeId,
        region,
        routeRegionOf,
        limit: options.limit,
    });
    return sanitizeSuggestPayload({
        deviceId,
        alias: options.alias || '',
        region,
        routeId,
        thread,
        similar,
        note: options.note || '',
        greeting,
    });
}

export function sanitizeSuggestPayload(input) {
    const source = input && typeof input === 'object' ? input : {};
    const thread = Array.isArray(source.thread) ? source.thread : [];
    const similar = Array.isArray(source.similar) ? source.similar : [];
    return {
        deviceId: clip(source.deviceId, 80),
        alias: clip(redactEmails(source.alias), 80),
        region: normalizeSuggestRegion(source.region),
        routeId: clip(source.routeId, 80),
        thread: thread.slice(-SUGGEST_THREAD_LIMIT).map((row) => ({
            from: row?.from === 'admin' ? 'admin' : 'commuter',
            text: clip(redactEmails(row?.text || ''), 1200),
            at: Number(row?.at || row?.timestamp || 0) || 0,
        })).filter((row) => row.text),
        similar: similar.slice(0, SUGGEST_SIMILAR_LIMIT).map((row) => ({
            deviceId: clip(row?.deviceId, 80),
            region: normalizeSuggestRegion(row?.region),
            routeId: clip(row?.routeId, 80),
            commuter: clip(redactEmails(row?.commuter || ''), 500),
            admin: clip(redactEmails(row?.admin || ''), 700),
        })).filter((row) => row.admin),
        note: clip(String(source.note || ''), SUGGEST_NOTE_MAX),
        greeting: sanitizeGreeting(source.greeting),
    };
}

function sanitizeGreeting(value) {
    const text = String(value || '').trim();
    if (/^Dear (?:(?:Mr|Mrs|Ms|Miss) )?[A-Z][a-z'’-]{2,20}$/.test(text)) return text;
    return '';
}

export function contactBlockForRegion(region) {
    const code = normalizeSuggestRegion(region);
    if (code === 'GP') {
        const lines = GAUTENG_OFFICES.map((office) => `${office.office}: ${office.phones.join(' / ')}`);
        return [
            'This thread is Gauteng. If they need PRASA, use only these offices, and only the office that matches the places they named. Remind them to ask for a reference number.',
            ...lines,
            'If you cannot tell which Gauteng office fits, halt and ask. Do not guess.',
            'Gauteng commuter Facebook group: https://www.facebook.com/share/g/1JKTk4Rn6e/ (Metrorail - Gauteng Train Updates)',
        ].join('\n');
    }
    if (code === 'WC' || code === 'KZN' || code === 'EC') {
        return [
            `This thread is ${code}. Do not give a Johannesburg, Pretoria, or Germiston phone number.`,
            `Other regions use the PRASA Customer Experience Survey: ${PRASA_SURVEY_URL}`,
        ].join('\n');
    }
    return [
        'Region is unknown. Do not include any phone number.',
        'If they need PRASA, halt and ask which region they ride in.',
        `The survey, when a region outside Gauteng is confirmed, is ${PRASA_SURVEY_URL}`,
    ].join('\n');
}

export const WHATSAPP_QUOTE_TITLE = '> Metrorail Next Train | Response';
export const EMAIL_SUBJECT = 'Metrorail Next Train | Feedback Response';
export const STALE_REPLY_MS = 7 * 24 * 60 * 60 * 1000;

export function knowledgeBase() {
    return [
        'Knowledge base. If the specific answer is not here, in the thread, in similar replies, or in the operator note, halt. Do not guess.',
        'Centurion to Irene sinkhole, Pretoria line: there is no confirmed reopening date. Acknowledge the frustration, say there is no official update yet, and say an in-app alert will go up when reliable information is available. Do not invent a date.',
        'Vereeniging to Johannesburg is partly running. Operating: JHB Park, Braamfontein, Mayfair, Grosvenor, Langlaagte, Croesus, Longdale, New Canada, Mlamlankunzi, Orlando, Nancefield, Kliptown, Tshiawelo, Midway, Lenasia. Suspended: Lawley, Anglers, Ennerdale, Grasmere, Orange Farm, Residensia, Eatonside, Kwaggastroom, Houthouwel, Kleigrond, Leeuhof, Duncanville, Vereeniging. PRASA targets repairs reaching Houthouwel by June 2027. Weekdays from 04:15. Saturdays and public holidays from 04:50.',
        'Upcoming Gauteng repair priority: Daveyton to Germiston, and Springs to Dunswart.',
        'Cape Town train series: 25xx Kraaifontein to Cape Town, 35xx Wellington to Cape Town, 34xx Du Toit to Eerste Rivier, 32xx Strand to Cape Town, 23xx Eerste Rivier to Cape Town, 26xx Malmesbury to Cape Town, 28xx Bellville to Cape Town via Monte Vista, 01xx Fish Hoek to Cape Town, 02xx Simon\'s Town to Fish Hoek, 99xx Chris Hani to Cape Town, 94xx Nolungile to Cape Town, 93xx Nyanga to Cape Town via Pinelands, 90xx Bellville to Mutual via Belhar, 05xx Retreat to Cape Town. Odd train numbers are one direction. Even numbers are the other direction.',
        'Fares: off-peak is 40% off the standard fare, weekdays only, 09:30 to 14:30. No off-peak discount on weekends or public holidays. The discount depends on the commuter profile. Do not invent a monthly-ticket rule.',
        'There is no Sunday train service in the timetable.',
        'App versions look like V7_05.31 (major, then month and day).',
    ].join('\n');
}

export function liaisonRules(region) {
    return [
        'You are Melmoth, the communications assistant for Metrorail Next Train (nexttrain.co.za), an independent unofficial commuter app built by Enock Kazembe.',
        'You draft replies in Enock\'s voice, as the developer speaking to the commuter. You are not a PRASA or Metrorail employee. You have no control over trains, schedules, infrastructure, or fares.',
        'Return JSON only. action is "draft" or "halt". draft.reply is only the commuter-facing message. The operator will edit it, then send. Do not send it yourself.',
        'Do not put the device id, thread labels, or code fences inside draft.reply.',
        'Do not add a sign-off. The app adds the operator name when the reply is sent.',
        'If the user text gives a Certain greeting, use that exact first line, such as Dear Enock, or Dear Mr Kazembe. If it says none, use Hi there,. Never invent a name, and never turn an email address into a greeting yourself.',
        'After the greeting line, leave two blank lines, then the body.',
        'The first body line acknowledges what they wrote. Do not open cold.',
        'End every draft, including a short thank-you, with this exact final line: Thank you for using Next Train.',
        'One thought per paragraph. A blank line between paragraphs.',
        'If you already replied and the commuter has not written since, action is halt. Say that no reply is needed.',
        'If the latest commuter message is more than 7 days old, say sorry for the late reply in calm everyday language near the start. Do not use the phrase "we apologize for the inconvenience".',
        'Do not invent a route, a transfer, a departure time, a fare, a ticket validity rule, a reopening date, or a hiring fact.',
        'A route or connection question that is not answered by the knowledge base, the thread, or the operator note is a halt. Ask what to tell them.',
        'Operational complaints can be acknowledged. Point to PRASA only through the contact block, as the best way to actually get results. On a phone call, remind them to ask for a reference number.',
        'Do not say these are not your trains. Do not mention a full-time job or building the app alone. Do not promise a feature date unless the knowledge base states it.',
        'Do not use these words: delve, furthermore, please be advised, we apologize for the inconvenience, crucial, ensure.',
        'Do not use em dashes in the reply. No citation markers.',
        'Emoji are rare. One is enough, and only when it fits the thread.',
        'Operator notes and images are extra context. They do not let you invent a fact that is still missing.',
        '',
        knowledgeBase(),
        '',
        contactBlockForRegion(region),
    ].join('\n');
}

export function latestCommuterAt(payload) {
    const rows = (payload?.thread || []).filter((row) => row?.from !== 'admin' && Number(row?.at));
    if (!rows.length) return 0;
    return Math.max(...rows.map((row) => Number(row.at) || 0));
}

export function replyIsStale(payload, now = Date.now()) {
    const at = latestCommuterAt(payload);
    if (!at || !now) return false;
    return (Number(now) - at) > STALE_REPLY_MS;
}

export function buildSuggestUserText(payload, sharedNote, now = Date.now()) {
    const clean = sanitizeSuggestPayload(payload);
    const stale = replyIsStale(clean, now);
    const lines = [
        `Device: ${clean.deviceId || 'unknown'}`,
        `Alias: ${clean.alias || 'None'}`,
        `Region: ${clean.region || 'unknown'}`,
        `Route: ${clean.routeId || 'unknown'}`,
        stale
            ? 'Latest commuter message is more than 7 days old. Apologize calmly for the late reply.'
            : 'Latest commuter message is within 7 days. Do not apologize for a delay.',
        clean.greeting
            ? `Certain greeting: ${clean.greeting}. Use that exact first line.`
            : 'Certain greeting: none. Use Hi there,. Do not invent a name.',
        '',
        'Thread:',
    ];
    if (!clean.thread.length) lines.push('(empty)');
    for (const row of clean.thread) {
        const when = row.at ? new Date(row.at).toISOString() : '';
        lines.push(`[${when}] ${row.from === 'admin' ? 'ADMIN' : 'COMMUTER'}:`);
        lines.push(row.text);
        lines.push('');
    }
    lines.push('Similar past replies:');
    if (!clean.similar.length) lines.push('(none)');
    clean.similar.forEach((row, index) => {
        lines.push(`Example ${index + 1} | ${row.region || 'region unknown'} | ${row.routeId || 'route unknown'}`);
        lines.push(`Commuter: ${row.commuter || '(none)'}`);
        lines.push(`Admin: ${row.admin}`);
        lines.push('');
    });
    lines.push('Shared operator note:');
    lines.push(clip(sharedNote, SUGGEST_NOTE_MAX) || '(none)');
    lines.push('');
    lines.push('Note for this draft:');
    lines.push(clean.note || '(none)');
    return lines.join('\n');
}

export function normalizeSuggestImages(images) {
    const list = Array.isArray(images) ? images : [];
    const kept = [];
    for (const image of list) {
        if (kept.length >= SUGGEST_MAX_IMAGES) break;
        const mimeType = String(image?.mimeType || '').toLowerCase();
        const data = String(image?.data || '').replace(/\s/g, '');
        if (!IMAGE_MIME.has(mimeType) || !data) continue;
        const bytes = Math.floor((data.length * 3) / 4);
        if (bytes > SUGGEST_MAX_IMAGE_BYTES) {
            throw new Error('Each image must be under 1.5 MB.');
        }
        kept.push({ mimeType, data });
    }
    return kept;
}

export function buildGeminiRequest({ payload, sharedNote, images } = {}) {
    const clean = sanitizeSuggestPayload(payload);
    const parts = [{ text: buildSuggestUserText(clean, sharedNote) }];
    for (const image of normalizeSuggestImages(images)) {
        parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
    return {
        systemInstruction: { parts: [{ text: liaisonRules(clean.region) }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
            responseSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['draft', 'halt'] },
                    reply: { type: 'string' },
                    reason: { type: 'string' },
                    questions: { type: 'array', items: { type: 'string' } },
                },
                required: ['action'],
            },
            thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
    };
}

export function parseSuggestResult(raw) {
    let data = raw;
    if (typeof raw === 'string') {
        const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        try {
            data = JSON.parse(trimmed);
        } catch {
            return { action: 'halt', reply: '', reason: 'The model did not return a draft.', questions: [] };
        }
    }
    if (!data || typeof data !== 'object') {
        return { action: 'halt', reply: '', reason: 'The model did not return a draft.', questions: [] };
    }
    const reply = commuterFacingReply(data.reply || '');
    const questions = Array.isArray(data.questions)
        ? data.questions.map((q) => String(q || '').trim()).filter(Boolean).slice(0, 5)
        : [];
    if (data.action === 'draft' && reply) {
        return { action: 'draft', reply, reason: '', questions: [] };
    }
    return {
        action: 'halt',
        reply: '',
        reason: String(data.reason || '').trim() || 'I need a fact from you before drafting.',
        questions,
    };
}

export function guardDraft(reply, region) {
    const code = normalizeSuggestRegion(region);
    const digits = phoneDigits(reply);
    const usedGauteng = GAUTENG_PHONE_DIGITS.some((phone) => phone && digits.includes(phone));
    if (usedGauteng && code !== 'GP') {
        const where = code || 'an unknown region';
        return {
            ok: false,
            reason: `Draft used a Gauteng office number for ${where}.`,
            questions: ['Which contact should this reply give them?'],
        };
    }
    return { ok: true };
}

export function applyDraftGuard(result, region) {
    const base = result && result.action ? result : parseSuggestResult(result);
    if (base.action !== 'draft') return { ...base, reply: '' };
    const reply = commuterFacingReply(base.reply || '');
    if (!reply) {
        return { action: 'halt', reply: '', reason: 'The model returned an empty draft.', questions: [] };
    }
    const guard = guardDraft(reply, region);
    if (!guard.ok) {
        return { action: 'halt', reply: '', reason: guard.reason, questions: guard.questions };
    }
    return { action: 'draft', reply, reason: '', questions: [] };
}

/** Drop admin-only lines so the composer stays the message the commuter will read. */
export function commuterFacingReply(value) {
    let text = String(value || '').trim();
    text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
    text = text.replace(/^\[Device:[^\]]*\]\s*/i, '').trim();
    text = text.replace(/[—–]/g, ', ');
    text = text.replace(/[ \t]{2,}/g, ' ');
    return text.trim();
}

/** Plain draft only. Halt, empty, and unsafe results stay out of the composer. */
export function composerHtmlFromResult(result) {
    if (!result || result.action !== 'draft') return null;
    const reply = String(result.reply || '').trim();
    if (!reply) return null;
    return reply
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

const OUTREACH_BODY_MAX = 3500;

/** Plain text of the in-app reply, including the operator sign-off. */
export function outreachPlainText(value) {
    return plainThreadText(value).replace(/\n[ \t]+/g, '\n').trim();
}

export function whatsappPrefill(body) {
    const text = outreachPlainText(body);
    if (!text) return '';
    if (text.startsWith(WHATSAPP_QUOTE_TITLE)) return text.slice(0, OUTREACH_BODY_MAX);
    const room = OUTREACH_BODY_MAX - WHATSAPP_QUOTE_TITLE.length - 2;
    return `${WHATSAPP_QUOTE_TITLE}\n\n${text.slice(0, Math.max(0, room))}`;
}

export function whatsappReplyUrl(phone, body) {
    const digits = phoneDigits(phone);
    if (!digits) return '';
    const text = whatsappPrefill(body);
    const base = `https://wa.me/${digits}`;
    if (!text) return base;
    return `${base}?text=${encodeURIComponent(text)}`;
}

export function mailtoReplyUrl(email, body) {
    const addr = String(email || '').trim();
    if (!addr.includes('@') || /[\s<>"']/.test(addr)) return '';
    const text = outreachPlainText(body).slice(0, OUTREACH_BODY_MAX);
    if (!text) return `mailto:${addr}`;
    return `mailto:${addr}?subject=${encodeURIComponent(EMAIL_SUBJECT)}&body=${encodeURIComponent(text)}`;
}

export function htmlAttrUrl(url) {
    return String(url || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function haltPanelText(result) {
    if (!result || result.action === 'draft') return '';
    const reason = String(result.reason || 'I need a fact from you before drafting.').trim();
    const questions = Array.isArray(result.questions) ? result.questions : [];
    return [reason, ...questions.map((q) => `• ${String(q || '').trim()}`).filter((line) => line !== '•')].join('\n');
}

export function geminiText(data) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((part) => part?.text || '').join('').trim();
}
