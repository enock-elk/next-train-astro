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
    };
}

export function contactBlockForRegion(region) {
    const code = normalizeSuggestRegion(region);
    if (code === 'GP') {
        const lines = GAUTENG_OFFICES.map((office) => `${office.office}: ${office.phones.join(' / ')}`);
        return [
            'This thread is Gauteng. If they need PRASA, use only these offices, and only the office that matches the places they named.',
            ...lines,
            'If you cannot tell which Gauteng office fits, halt and ask. Do not guess.',
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

export function liaisonRules(region) {
    return [
        'You draft replies for Next Train operators. Next Train is an independent app. It does not run trains, set fares, or hire for PRASA.',
        'Return JSON only, with action "draft" or "halt".',
        'draft.reply is plain text the operator will edit. Do not add a sign-off. The app adds the operator name when the reply is sent.',
        'Match the greeting already used by admin lines in this thread. Use the alias when the thread already does. Do not use emoji unless an earlier admin line in this same thread already does.',
        'Do not invent a route, a transfer, a departure time, a fare, a ticket validity rule, or a hiring fact.',
        'Use only the thread, the similar replies, the operator notes, and the contact block. If a fact is missing, action is "halt", reply is empty, and questions asks the operator for that fact.',
        'A route or connection question without the route written in the supplied text is a halt. Ask what to tell them.',
        'Operational complaints can be acknowledged. Point to PRASA only through the contact block.',
        'Operator notes and images are extra context for this run. They do not let you invent a fact that is still missing.',
        '',
        contactBlockForRegion(region),
    ].join('\n');
}

export function buildSuggestUserText(payload, sharedNote) {
    const clean = sanitizeSuggestPayload(payload);
    const lines = [
        `Device: ${clean.deviceId || 'unknown'}`,
        `Alias: ${clean.alias || 'None'}`,
        `Region: ${clean.region || 'unknown'}`,
        `Route: ${clean.routeId || 'unknown'}`,
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
            temperature: 0.4,
            maxOutputTokens: 1024,
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
    const reply = String(data.reply || '').trim();
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
    const parsed = result && result.action ? result : parseSuggestResult(result);
    if (parsed.action !== 'draft') return { ...parsed, reply: '' };
    const guard = guardDraft(parsed.reply, region);
    if (!guard.ok) {
        return { action: 'halt', reply: '', reason: guard.reason, questions: guard.questions };
    }
    return parsed;
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

export function whatsappReplyUrl(phone, body) {
    const digits = phoneDigits(phone);
    if (!digits) return '';
    const text = outreachPlainText(body).slice(0, OUTREACH_BODY_MAX);
    const base = `https://wa.me/${digits}`;
    if (!text) return base;
    return `${base}?text=${encodeURIComponent(text)}`;
}

export function mailtoReplyUrl(email, body) {
    const addr = String(email || '').trim();
    if (!addr.includes('@') || /[\s<>"']/.test(addr)) return '';
    const text = outreachPlainText(body).slice(0, OUTREACH_BODY_MAX);
    if (!text) return `mailto:${addr}`;
    return `mailto:${addr}?subject=${encodeURIComponent('Next Train')}&body=${encodeURIComponent(text)}`;
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
