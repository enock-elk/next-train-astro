/**
 * Suggest-a-reply helpers. Pure: no network, no DOM.
 * The reply worker and the Dev Hub composer both use this module.
 * Drafts never include another person's email. A halt never becomes composer HTML.
 */

import { classifyAttachmentUrl, sanitizeAttachmentDisplayUrl, sniffAttachmentBytes } from './attachments.js';
import { describeRoute, replyKnowledgeText } from './reply-knowledge.js';
import { noticeQuotePlain, parseFeedbackAlertQuote } from './feedback-quote.js';

export const SUGGEST_SIMILAR_LIMIT = 8;
export const SUGGEST_NOTE_MAX = 4000;
export const SUGGEST_CONTEXT_MAX = 2000;
export const SUGGEST_MAX_IMAGES = 3;
export const SUGGEST_MAX_IMAGE_BYTES = 1_500_000;
export const SUGGEST_MAX_FILES = 4;
export const SUGGEST_MAX_FILE_BYTES = 4_000_000;
export const SUGGEST_THREAD_LIMIT = 40;

export const PRASA_SURVEY_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeGSJmZlpg8dq2Dvupm9xyHcFJudGsegZ2uyhS3UEq3O9fGkA/viewform';

/** Gauteng offices from the public guide. */
export const GAUTENG_OFFICES = [
    { office: 'Johannesburg', phones: ['011 013 0191', '011 013 0192'] },
    { office: 'Pretoria', phones: ['011 013 0306'] },
    { office: 'Germiston', phones: ['011 085 7118'] },
];

/** KZN Metrorail customer desk from PRASA Train Alert posters. */
export const KZN_OFFICES = [
    { office: 'Customer Service desk', phones: ['031 813 0456'] },
];

/** Eastern Cape from the PRASA EC Facebook page (Station Street, East London). */
export const EC_OFFICES = [
    { office: 'PRASA EC East London', phones: ['043 700 2030'] },
];

export const EC_EMAIL = 'ntombikayise.katsio@prasa.com';
export const EC_FACEBOOK = 'PRASA EC';

const GAUTENG_PHONE_DIGITS = GAUTENG_OFFICES.flatMap((office) => office.phones.map(phoneDigits));
const KZN_PHONE_DIGITS = KZN_OFFICES.flatMap((office) => office.phones.map(phoneDigits));
const EC_PHONE_DIGITS = EC_OFFICES.flatMap((office) => office.phones.map(phoneDigits));

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
    const rows = [];
    const sorted = items.slice().sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
    for (const item of sorted) {
        const at = Number(item?.timestamp || 0) || 0;
        const alertPlain = String(item?.alertPlain || '').trim();
        if (alertPlain) {
            rows.push({
                from: 'admin',
                role: 'alert',
                text: clip(redactEmails(alertPlain), 8000),
                at,
            });
        }
        const raw = redactEmails(item?.text || item?.message || '');
        const text = clip(raw, alertPlain || raw.startsWith('Quoted ') ? 8000 : 4000);
        if (!text) continue;
        rows.push({
            from: item?.isFromAdmin ? 'admin' : 'commuter',
            role: alertPlain && !item?.isFromAdmin ? 'reply' : '',
            text,
            at,
        });
    }
    return rows.filter((row) => row.text);
}

/** A commuter line that quotes an alert is their reply, not the alert itself. */
function commuterWordsForModel(text) {
    const raw = String(text || '');
    const parsed = parseFeedbackAlertQuote(raw);
    if (!parsed) return raw;
    const reply = String(parsed.body || '').trim();
    const about = parsed.snippet ? ` Next Train alert: "${parsed.snippet}".` : '';
    return `Reply to a Next Train alert.${about} Their words, not the alert: ${reply || '(none)'}`;
}

/**
 * Replace a short [ALERT:…] chip with the whole quoted notice.
 * `noticesById` values are already plain text. A stored quotedText is used
 * when the live notice can no longer be loaded.
 */
export function withQuotedNoticeText(items, noticesById = {}) {
    const map = noticesById && typeof noticesById === 'object' ? noticesById : {};
    return (Array.isArray(items) ? items : []).map((item) => {
        if (!item || item.isFromAdmin) return item;
        const text = String(item.text || item.message || '');
        const parsed = parseFeedbackAlertQuote(text);
        const id = String(parsed?.alertId || item.quotedAlertId || '').trim();
        const stored = String(item.quotedText || '').trim();
        const looked = id ? String(map[id] || '').trim() : '';
        const full = looked.length >= stored.length ? looked : stored;
        if (!full) return item;
        const commuter = parsed ? String(parsed.body || '').trim() : text;
        const kind = parsed?.kind === 'disruption' || item.quotedAlertKind === 'disruption'
            ? 'incident'
            : 'advisory';
        return {
            ...item,
            text: commuter,
            message: commuter,
            alertPlain: full,
            alertKind: kind,
        };
    });
}

export { noticeQuotePlain };

/** Commuter messages with no admin reply after them. The whole thread is kept. */
export function unansweredCommuterMessages(thread) {
    const rows = Array.isArray(thread) ? thread : [];
    let lastAdmin = -1;
    rows.forEach((row, index) => {
        if (row?.from === 'admin' && row?.role !== 'alert') lastAdmin = index;
    });
    return rows.slice(lastAdmin + 1).filter((row) => row?.from !== 'admin' && String(row?.text || '').trim());
}

/** The commuter message this draft belongs to. A later message is a new draft. */
export function suggestDraftMessageId(items) {
    const list = (Array.isArray(items) ? items : [])
        .slice()
        .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
    let lastAdmin = -1;
    list.forEach((item, index) => {
        if (item?.isFromAdmin) lastAdmin = index;
    });
    const pending = list.slice(lastAdmin + 1).filter((item) => item && !item.isFromAdmin);
    const target = pending.length
        ? pending[pending.length - 1]
        : [...list].reverse().find((item) => item && !item.isFromAdmin);
    return String(target?.id || target?.key || target?.feedbackId || '').trim();
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
        const commuterRaw = commuterBits.map((item) => {
            const parsed = parseFeedbackAlertQuote(item?.text || item?.message || '');
            return parsed ? parsed.body : (item?.text || item?.message || '');
        }).join('\n');
        const commuterText = commuterBits.map((item) => commuterWordsForModel(item?.text || item?.message || '')).join('\n');
        const words = contentWords(commuterRaw);
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
    const thread = threadMessages(withQuotedNoticeText(list, options.quotedNotices));
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
        draftContext: options.draftContext || '',
        greeting,
        files: collectThreadFiles(list),
        appVersion: [...list].reverse().map((item) => item?.appVersion).find(Boolean) || '',
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
        thread: thread.map((row) => {
            const role = row?.role === 'alert' ? 'alert' : (row?.role === 'reply' ? 'reply' : '');
            return {
                from: role === 'alert' || row?.from === 'admin' ? 'admin' : 'commuter',
                role,
                text: clip(redactEmails(row?.text || ''), role === 'alert' ? 8000 : 4000),
                at: Number(row?.at || row?.timestamp || 0) || 0,
            };
        }).filter((row) => row.text),
        similar: similar.slice(0, SUGGEST_SIMILAR_LIMIT).map((row) => ({
            deviceId: clip(row?.deviceId, 80),
            region: normalizeSuggestRegion(row?.region),
            routeId: clip(row?.routeId, 80),
            commuter: clip(redactEmails(row?.commuter || ''), 500),
            admin: clip(redactEmails(row?.admin || ''), 700),
        })).filter((row) => row.admin),
        note: clip(String(source.note || ''), SUGGEST_NOTE_MAX),
        draftContext: clip(String(source.draftContext || ''), SUGGEST_CONTEXT_MAX),
        greeting: sanitizeGreeting(source.greeting),
        appVersion: clip(String(source.appVersion || ''), 32),
        files: sanitizeThreadFiles(source.files),
    };
}

function htmlFileUrls(value) {
    const text = String(value || '').replace(/&amp;/gi, '&');
    const found = [];
    const re = /https:\/\/[^\s"'<>\\]+/gi;
    let match = re.exec(text);
    while (match) {
        found.push(match[0].replace(/[),.;]+$/g, ''));
        match = re.exec(text);
    }
    return found;
}

/** Firebase Storage photos and PDFs already on this thread. Other hosts are dropped. */
export function isThreadFileUrl(url) {
    const safe = sanitizeAttachmentDisplayUrl(url);
    if (!safe || !/^https:\/\//i.test(safe)) return false;
    let parsed;
    try {
        parsed = new URL(safe);
    } catch {
        return false;
    }
    if (parsed.username || parsed.password || parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    const hostOk = host === 'firebasestorage.googleapis.com'
        || host === 'storage.googleapis.com'
        || host.endsWith('.firebasestorage.app');
    if (!hostOk) return false;
    let path = parsed.pathname;
    try { path = decodeURIComponent(parsed.pathname); } catch { /* keep raw */ }
    if (!path.includes('feedback_attachments') && !path.includes('admin_attachments')) return false;
    const kind = classifyAttachmentUrl(safe);
    return kind === 'image' || kind === 'pdf';
}

export function collectThreadFiles(items) {
    const ordered = (Array.isArray(items) ? items : [])
        .slice()
        .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
    const seen = new Set();
    const files = [];
    for (const item of ordered) {
        const from = item?.isFromAdmin ? 'admin' : 'commuter';
        const urls = [];
        const push = (value) => {
            const text = String(value || '').trim();
            if (text) urls.push(text);
        };
        push(item?.attachmentUrl);
        const many = item?.attachmentUrls;
        if (Array.isArray(many)) many.forEach(push);
        else if (many && typeof many === 'object') Object.values(many).forEach(push);
        htmlFileUrls(item?.text || item?.message || '').forEach(push);
        for (const url of urls) {
            if (!isThreadFileUrl(url)) continue;
            const safe = sanitizeAttachmentDisplayUrl(url);
            if (!safe || seen.has(safe)) continue;
            seen.add(safe);
            files.push({
                url: safe,
                from,
                kind: classifyAttachmentUrl(safe) === 'pdf' ? 'pdf' : 'image',
            });
        }
    }
    return files.slice(-SUGGEST_MAX_FILES);
}

function sanitizeThreadFiles(files) {
    const list = Array.isArray(files) ? files : [];
    const seen = new Set();
    const kept = [];
    for (const file of list) {
        const url = sanitizeAttachmentDisplayUrl(file?.url || file);
        if (!url || seen.has(url) || !isThreadFileUrl(url)) continue;
        seen.add(url);
        kept.push({
            url,
            from: file?.from === 'admin' ? 'admin' : 'commuter',
            kind: classifyAttachmentUrl(url) === 'pdf' ? 'pdf' : 'image',
        });
        if (kept.length >= SUGGEST_MAX_FILES) break;
    }
    return kept;
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/** Download one allowlisted thread photo or PDF. A bad file is skipped. */
export async function loadSuggestFile(entry, fetchImpl = globalThis.fetch) {
    const url = String(entry?.url || '').trim();
    if (!isThreadFileUrl(url)) return null;
    const res = await fetchImpl(url, { redirect: 'follow' });
    if (!res?.ok) return null;
    const finalUrl = res.url || url;
    if (finalUrl !== url && !isThreadFileUrl(finalUrl)) return null;
    const announced = Number(res.headers?.get?.('content-length') || 0);
    if (announced > SUGGEST_MAX_FILE_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > SUGGEST_MAX_FILE_BYTES) return null;
    const sniffed = sniffAttachmentBytes(buf);
    if (!sniffed) return null;
    if (sniffed.mime !== 'application/pdf' && !String(sniffed.mime).startsWith('image/')) return null;
    return {
        mimeType: sniffed.mime,
        data: bytesToBase64(buf),
        kind: sniffed.mime === 'application/pdf' ? 'pdf' : 'image',
        from: entry?.from === 'admin' ? 'admin' : 'commuter',
    };
}

export async function loadSuggestFiles(files, fetchImpl = globalThis.fetch) {
    const loaded = [];
    let missed = 0;
    for (const file of sanitizeThreadFiles(files)) {
        try {
            const got = await loadSuggestFile(file, fetchImpl);
            if (got) loaded.push(got);
            else missed += 1;
        } catch {
            missed += 1;
        }
    }
    return { files: loaded, missed };
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
    if (code === 'KZN') {
        const lines = KZN_OFFICES.map((office) => `${office.office}: ${office.phones.join(' / ')}`);
        return [
            'This thread is KwaZulu-Natal. If they need PRASA or Metrorail KZN, use only these contacts. Remind them to ask for a reference number.',
            ...lines,
            'Do not give a Johannesburg, Pretoria, Germiston, or Western Cape phone number.',
            `If a desk number is not enough, the PRASA Customer Experience Survey is ${PRASA_SURVEY_URL}`,
        ].join('\n');
    }
    if (code === 'EC') {
        const lines = EC_OFFICES.map((office) => `${office.office}: ${office.phones.join(' / ')}`);
        return [
            'This thread is Eastern Cape. If they need PRASA EC or Metrorail Eastern Cape, use only these contacts. Remind them to ask for a reference number.',
            ...lines,
            `Email: ${EC_EMAIL}`,
            `Facebook: ${EC_FACEBOOK}`,
            'Do not give a Johannesburg, Pretoria, Germiston, Western Cape, or KZN phone number.',
            `If a desk number is not enough, the PRASA Customer Experience Survey is ${PRASA_SURVEY_URL}`,
        ].join('\n');
    }
    if (code === 'WC') {
        return [
            'This thread is WC. Do not give a Johannesburg, Pretoria, Germiston, KZN, or Eastern Cape phone number.',
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
        'Knowledge base. If the specific answer is not here, in the thread, in attached photos or PDFs, in similar replies, in the shared note, or in Context for this draft, halt. Do not guess.',
        'Vereeniging to Johannesburg is partly running. Operating: JHB Park, Braamfontein, Mayfair, Grosvenor, Langlaagte, Croesus, Longdale, New Canada, Mlamlankunzi, Orlando, Nancefield, Kliptown, Tshiawelo, Midway, Lenasia. Suspended: Lawley, Anglers, Ennerdale, Grasmere, Orange Farm, Residensia, Eatonside, Kwaggastroom, Houthouwel, Kleigrond, Leeuhof, Duncanville, Vereeniging. PRASA targets repairs reaching Houthouwel by June 2027. Weekdays from 04:15. Saturdays and public holidays from 04:50.',
        'Upcoming Gauteng repair priority: Daveyton to Germiston, and Springs to Dunswart.',
        'Cape Town train series: 25xx Kraaifontein to Cape Town, 35xx Wellington to Cape Town, 34xx Du Toit to Eerste Rivier, 32xx Strand to Cape Town, 23xx Eerste Rivier to Cape Town, 26xx Malmesbury to Cape Town, 28xx Bellville to Cape Town via Monte Vista, 01xx Fish Hoek to Cape Town, 02xx Simon\'s Town to Fish Hoek, 99xx Chris Hani to Cape Town, 94xx Nolungile to Cape Town, 93xx Nyanga to Cape Town via Pinelands, 90xx Bellville to Mutual via Belhar, 05xx Retreat to Cape Town. Odd train numbers are one direction. Even numbers are the other direction.',
        'App versions look like V7_05.31 (major, then month and day).',
        replyKnowledgeText(),
    ].join('\n');
}

export function liaisonRules(region) {
    return [
        'You are Melmoth, the communications assistant for Metrorail Next Train (nexttrain.co.za). You draft replies in Enock\'s voice, as the person who looks after the app.',
        'Match Enock\'s archived style: warm, direct, short paragraphs, no corporate filler. Prefer "Thanks for letting me know" / "Thank you for pointing out" over stiff phrases.',
        'You are not a PRASA employee. Do not write a long independence speech. Do not write "I want to gently mention". Do not open with a disclaimer.',
        'When they ask Next Train to fix something only PRASA or Metrorail can fix (a broken train, a cancelled service, a closed ticket office, infrastructure, staffing, or other operations), one short calm sentence is enough, then the useful part. Prefer: "Since Next Train is an independent app we developed, we are unfortunately not able to assist with this one." Or: "We are not directly linked to PRASA." Or: "Next Train is an independent app and I do not work for PRASA." Do not stack both. Do not paste the legal Terms wording.',
        'Do not use that independence line for agreement, thanks, a poll reply, a call-for-responses reply, a comment on a notice, an app bug, a schedule question Next Train can answer, or a feature request. Those do not need a speech about the app.',
        'Give a PRASA number only when they want PRASA to change something: a fare, a timetable, a closed office, or a broken train. One calm sentence. The contact block is the only source for that number. Remind them to ask for a reference number.',
        'When a fare on Next Train does not match what the station charged, thank them, ask for a clear photo of the ticket if they have not sent one, and say you will check and update. Do not invent the correct price.',
        'Each thread line is labeled ADMIN or COMMUTER. ADMIN is Next Train. COMMUTER is the person you are replying to. Do not swap those speakers.',
        'Only Next Train can post an alert, an advisory, or an incident notice. A commuter cannot post one. They can only reply to one.',
        'An ADMIN ALERT line is a notice Next Train already posted. The COMMUTER line after it is their reply to that notice. Use the whole alert so you know what they are answering. Thank them for the reply. If the alert is a poll, a call for responses, or a call to action, thank them for taking part or for replying. Do not thank them for sharing, posting, or announcing the alert. Do not write as if they told you the news in the alert.',
        'A short [ALERT:…] chip inside an older example is also a Next Train alert they replied to. The words after "Their words, not the alert" are the only words they wrote.',
        'Return JSON only. action is "draft" or "halt". draft.reply is only the commuter-facing message. The operator will edit it, then send. Do not send it yourself.',
        'Do not put the device id, thread labels, or code fences inside draft.reply.',
        'Do not add a sign-off. The app adds the operator name when the reply is sent.',
        'If the user text gives a Certain greeting, use that exact first line, such as Dear Enock, or Dear Mr Kazembe. If it says none, use Hi there,. Never invent a name, and never turn an email address into a greeting yourself.',
        'After the greeting line, leave two blank lines, then the body.',
        'The first body line acknowledges what they wrote. Do not open cold.',
        'End every draft, including a short thank-you, with this exact final line: Thank you for using Next Train.',
        'One thought per paragraph. A blank line between paragraphs.',
        'If you already replied and the commuter has not written since, action is halt. Say that no reply is needed.',
        'The whole thread is included. If more than one commuter message has no admin reply after it, answer every one of those in this same draft, oldest first, and still answer the latest. Do not reply only to the last line.',
        'If the latest commuter message is more than 7 days old, say sorry for the late reply in calm everyday language near the start. Do not use the phrase "we apologize for the inconvenience".',
        'Do not invent a route, a transfer, a departure time, a fare, a ticket validity rule, a reopening date, or a hiring fact.',
        'Route keys such as pta-pien are for you. The commuter reply uses station names, never the key.',
        'The route key on the message is the board they had open, usually their pinned route. Use the resolved name, termini, and transfer.',
        'A route or connection question that is not answered by the knowledge base, the thread, the attached files, or Context for this draft is a halt. Ask what to tell them.',
        'If they want PRASA to change a fare, a timetable, or a station problem, one sentence can point to the matching office in the contact block, and a phone call can mention a reference number. Do not add that sentence to thanks, agreement, or a comment on a notice.',
        'Do not say these are not your trains. Do not mention a full-time job or building the app alone. Do not promise a feature date unless the knowledge base states it.',
        'Do not use these words: delve, furthermore, please be advised, we apologize for the inconvenience, crucial, ensure.',
        'Do not use em dashes in the reply. No citation markers.',
        'Emoji are rare. One is enough, and only when it fits the thread.',
        'Photos and PDFs already in the thread follow this message. Read them. A ticket photo or a notice PDF can answer a fare or a date.',
        'Operator images or PDFs attached for this draft also follow. Prefer facts from those files when they answer the question.',
        'Context for this draft is a fact the operator has confirmed. Use it. Do not halt again for a question that context answers. Do not add facts past what it says.',
        'The shared operator note does not let you invent a fact that is still missing.',
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

function threadSpeaker(row) {
    if (row?.role === 'alert') {
        return 'ADMIN ALERT. Next Train posted this. Only Next Train can post an alert. The commuter did not write it.';
    }
    if (row?.from === 'admin') return 'ADMIN. Next Train wrote this.';
    if (row?.role === 'reply') return 'COMMUTER. This is their reply to the ADMIN ALERT above. They did not post that alert.';
    return 'COMMUTER. This person wrote this. They are not Next Train.';
}

function unansweredLead(row) {
    if (row?.role === 'reply') return 'Their reply to the ADMIN ALERT above. Answer these words only: ';
    return '';
}

export function buildSuggestUserText(payload, sharedNote, now = Date.now()) {
    const clean = sanitizeSuggestPayload(payload);
    const stale = replyIsStale(clean, now);
    const lines = [
        `Device: ${clean.deviceId || 'unknown'}`,
        `Alias: ${clean.alias || 'None'}`,
        `Region: ${clean.region || 'unknown'}`,
        `Route key: ${clean.routeId || 'unknown'}`,
        clean.routeId && describeRoute(clean.routeId)
            ? `Pinned route on this message: ${describeRoute(clean.routeId)}`
            : 'Pinned route on this message: unknown.',
        clean.appVersion ? `App version on the message: ${clean.appVersion}` : 'App version on the message: unknown.',
        `Thread files: ${(clean.files || []).length}. Read every photo and PDF that follows.`,
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
        lines.push(`[${when}] ${threadSpeaker(row)}`);
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
    const unanswered = unansweredCommuterMessages(clean.thread);
    lines.push('Unanswered commuter messages:');
    if (!unanswered.length) {
        lines.push('None. If the last message is from ADMIN, halt. No reply is needed.');
    } else if (unanswered.length === 1) {
        lines.push('One message still needs a reply. Answer it.');
        lines.push(unansweredLead(unanswered[0]));
        lines.push(unanswered[0].text);
    } else {
        lines.push(`There are ${unanswered.length} commuter messages with no admin reply after them. Answer every one in this same draft, oldest first, and still answer the latest. Do not leave an earlier point out.`);
        unanswered.forEach((row, index) => {
            lines.push(`${index + 1}. ${unansweredLead(row)}${row.text}`);
        });
    }
    lines.push('');
    lines.push('Shared operator note:');
    lines.push(clip(sharedNote, SUGGEST_NOTE_MAX) || '(none)');
    lines.push('');
    lines.push('Note for this draft:');
    lines.push(clean.note || '(none)');
    lines.push('');
    lines.push('Context for this draft (operator confirmed, use it):');
    lines.push(clean.draftContext || '(none)');
    return lines.join('\n');
}

export function normalizeSuggestImages(images) {
    const list = Array.isArray(images) ? images : [];
    const kept = [];
    for (const image of list) {
        if (kept.length >= SUGGEST_MAX_FILES) break;
        const mimeType = String(image?.mimeType || '').toLowerCase();
        const data = String(image?.data || '').replace(/\s/g, '');
        const isPdf = mimeType === 'application/pdf';
        if ((!IMAGE_MIME.has(mimeType) && !isPdf) || !data) continue;
        const bytes = Math.floor((data.length * 3) / 4);
        const maxBytes = isPdf ? SUGGEST_MAX_FILE_BYTES : SUGGEST_MAX_IMAGE_BYTES;
        if (bytes > maxBytes) {
            throw new Error(isPdf ? 'Each PDF must be under 4 MB.' : 'Each image must be under 1.5 MB.');
        }
        kept.push({ mimeType, data });
    }
    return kept;
}

export function buildGeminiRequest({ payload, sharedNote, images, threadFiles, filesMissed = 0 } = {}) {
    const clean = sanitizeSuggestPayload(payload);
    const parts = [{ text: buildSuggestUserText(clean, sharedNote) }];
    const attached = Array.isArray(threadFiles) ? threadFiles : [];
    let fileCount = 0;
    for (const file of attached) {
        if (fileCount >= SUGGEST_MAX_FILES) break;
        const mimeType = String(file?.mimeType || '');
        const data = String(file?.data || '');
        if (!data || (mimeType !== 'application/pdf' && !mimeType.startsWith('image/'))) continue;
        fileCount += 1;
        const who = file.from === 'admin' ? 'admin' : 'commuter';
        const what = mimeType === 'application/pdf' ? 'PDF' : 'photo';
        parts.push({ text: `Thread file ${fileCount}, from the ${who}, ${what}.` });
        parts.push({ inlineData: { mimeType, data } });
    }
    const missed = Number(filesMissed) || 0;
    if (missed > 0) parts.push({ text: `${missed} thread file(s) could not be loaded.` });
    for (const image of normalizeSuggestImages(images)) {
        const what = image.mimeType === 'application/pdf' ? 'PDF' : 'image';
        parts.push({ text: `Operator ${what} for this draft.` });
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
    const usedKzn = KZN_PHONE_DIGITS.some((phone) => phone && digits.includes(phone));
    if (usedKzn && code && code !== 'KZN') {
        return {
            ok: false,
            reason: `Draft used a KZN customer desk number for ${code}.`,
            questions: ['Which contact should this reply give them?'],
        };
    }
    const usedEc = EC_PHONE_DIGITS.some((phone) => phone && digits.includes(phone));
    if (usedEc && code && code !== 'EC') {
        return {
            ok: false,
            reason: `Draft used a PRASA EC number for ${code}.`,
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
const EMAIL_SIGNOFF_RE = /(?:\n[ \t]*)?[-–—]\s*(?:Enock|Thandeka|Admin)\s*$/i;

/** Keep paragraph breaks from the composer. Block tags become lines. */
function htmlToPlainBlocks(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
        .replace(/<li(\s[^>]*)?>/gi, '\n- ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Plain text of the in-app reply, including the operator sign-off. */
export function outreachPlainText(value) {
    return htmlToPlainBlocks(value);
}

/** Email body. Paragraphs stay. The operator sign-off stays off, because the mailbox already signs it. */
export function emailOutreachText(value) {
    return outreachPlainText(value).replace(EMAIL_SIGNOFF_RE, '').replace(/\n{3,}/g, '\n\n').trim();
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
    const text = emailOutreachText(body).replace(/\n/g, '\r\n').slice(0, OUTREACH_BODY_MAX);
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
