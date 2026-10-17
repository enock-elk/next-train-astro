/**
 * Next Train — operator suggest-a-reply.
 *
 * POST /suggest   Authorization: Bearer <Firebase ID token>
 *   Body: { deviceId, alias, region, routeId, thread, similar, note, images? }
 *   Returns: { action: "draft", reply } or { action: "halt", reason, questions }
 *
 * POST /edit      same operator token
 *   Body: { text, action }
 *   Returns: { text }  (grammar, summarise, tone, compose). Does not post.
 *
 * GET  /context   shared operator note
 * PUT  /context   { note }  (both allowlisted operators)
 *
 * Secret: GEMINI_API_KEY
 * Var: FIREBASE_WEB_API_KEY
 * KV: REPLY_CONTEXT (optional until the namespace id is set)
 *
 * POST /brief     same operator token
 *   Body: { kind: "report", digest } or { kind: "crash", crash }
 *   Returns: { text }
 *
 * GET  /unfurl?url=  public. Reads a public https page and returns title,
 *   description, and image. No operator token. No Gemini.
 * GET  /unfurl-image?url=  public. Returns the image bytes so a phone can
 *   keep the picture when the other site blocks a direct save. No token.
 * GET  /draft?id=   operator. The last Suggest draft for one commuter message.
 * PUT  /draft       { id, html }  operator. Keeps that draft for the next open.
 *
 * The browser never sees the Gemini key. The worker does not download the feedback tree.
 * It may download photo and PDF URLs from this thread when they are on Firebase Storage.
 * The brief digest is posted by the operator. The worker does not read sys_logs.
 */
import {
    applyDraftGuard,
    buildGeminiRequest,
    geminiText,
    loadSuggestFiles,
    parseSuggestResult,
    sanitizeSuggestPayload,
    SUGGEST_NOTE_MAX,
} from '../../src/lib/reply-suggest.js';
import {
    buildTextAssistRequest,
    parseTextAssistResult,
} from '../../src/lib/text-assist.js';
import {
    buildBriefRequest,
    buildCrashExplainRequest,
    parseBriefText,
} from '../../src/lib/operator-brief.js';
import {
    isPublicPreviewUrl,
    parseLinkPreviewHtml,
} from '../../src/lib/link-preview.js';

const ADMIN_EMAILS = new Set(['enockelk@gmail.com', 'thandeka05nxumalo@gmail.com']);
/** New API keys cannot call 2.5 Flash-Lite. 3.5 Flash-Lite is the current low-cost fit. */
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const NOTE_KEY = 'shared-note';

/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

export function corsOriginAllowed(origin, env) {
    if (!origin) return true;
    const allowed = String(env?.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (allowed.includes('*') || allowed.includes(origin)) return true;
    try {
        const host = new URL(origin).hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1') return true;
        if (host === 'lab.nexttrain.co.za' || host === 'nexttrain.co.za' || host === 'www.nexttrain.co.za') return true;
        if (host.endsWith('.next-train-lab.pages.dev')) return true;
        if (host.endsWith('.github.io')) return true;
    } catch { /* ignore */ }
    return false;
}

function corsHeaders(env, request) {
    const origin = request.headers.get('Origin') || '';
    const headers = {
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
    if (origin && corsOriginAllowed(origin, env)) headers['Access-Control-Allow-Origin'] = origin;
    return headers;
}

function json(env, request, status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(env, request) },
    });
}

function checkRate(key, limit = 20) {
    const now = Date.now();
    const prev = (rateBuckets.get(key) || []).filter((ts) => now - ts < 60_000);
    if (prev.length >= limit) return false;
    prev.push(now);
    rateBuckets.set(key, prev);
    return true;
}

async function verifyIdToken(env, idToken) {
    const key = env.FIREBASE_WEB_API_KEY;
    if (!key) throw new Error('FIREBASE_WEB_API_KEY missing');
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
        }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Invalid token');
    const user = data.users?.[0];
    if (!user?.localId) throw new Error('Invalid token');
    const hasRealProvider = (user.providerUserInfo || []).some((p) =>
        ['password', 'google.com', 'apple.com', 'facebook.com', 'phone'].includes(p.providerId)
    );
    if (!hasRealProvider && !user.email) throw new Error('Sign in required');
    return {
        uid: user.localId,
        email: String(user.email || '').trim().toLowerCase(),
    };
}

async function requireOperator(env, request) {
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return { error: 'Sign in required', status: 401 };
    let user;
    try {
        user = await verifyIdToken(env, token);
    } catch (err) {
        return { error: err.message || 'Invalid token', status: 401 };
    }
    if (!ADMIN_EMAILS.has(user.email)) return { error: 'Operators only', status: 403 };
    const path = new URL(request.url).pathname;
    if (!checkRate(`${user.email}:${path}`, 30)) {
        return { error: 'Too many requests. Wait a minute.', status: 429 };
    }
    return { user };
}

async function readSharedNote(env) {
    if (!env?.REPLY_CONTEXT) return '';
    const value = await env.REPLY_CONTEXT.get(NOTE_KEY);
    return String(value || '').slice(0, SUGGEST_NOTE_MAX);
}

async function writeSharedNote(env, note) {
    if (!env?.REPLY_CONTEXT) return false;
    const text = String(note || '').trim();
    if (!text) return false;
    await env.REPLY_CONTEXT.put(NOTE_KEY, text.slice(0, SUGGEST_NOTE_MAX));
    return true;
}

export async function handleRequest(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (url.pathname === '/health' && request.method === 'GET') {
        return json(env, request, 200, { ok: true });
    }
    if (url.pathname === '/unfurl' && request.method === 'GET') {
        return unfurlLink(request, env, url);
    }
    if (url.pathname === '/unfurl-image' && request.method === 'GET') {
        return unfurlImage(request, env, url);
    }
    if (url.pathname !== '/suggest' && url.pathname !== '/context' && url.pathname !== '/edit' && url.pathname !== '/brief' && url.pathname !== '/draft') {
        return json(env, request, 404, { error: 'Not found' });
    }

    const auth = await requireOperator(env, request);
    if (auth.error) return json(env, request, auth.status, { error: auth.error });

    if (url.pathname === '/context' && request.method === 'GET') {
        return json(env, request, 200, { note: await readSharedNote(env) });
    }
    if (url.pathname === '/context' && request.method === 'PUT') {
        let body = {};
        try { body = await request.json(); } catch { body = {}; }
        const text = String(body?.note || '').trim();
        if (!text) {
            return json(env, request, 400, { error: 'Type a note before saving. A blank note is not saved.' });
        }
        const saved = await writeSharedNote(env, text);
        if (!saved) {
            return json(env, request, 503, { error: 'Shared note storage is not configured.' });
        }
        return json(env, request, 200, { ok: true });
    }
    if (url.pathname === '/suggest' && request.method === 'POST') {
        return suggestReply(request, env);
    }
    if (url.pathname === '/edit' && request.method === 'POST') {
        return editText(request, env);
    }
    if (url.pathname === '/brief' && request.method === 'POST') {
        return writeBrief(request, env);
    }
    if (url.pathname === '/draft' && request.method === 'GET') {
        return readDraft(env, request, url, auth.user);
    }
    if (url.pathname === '/draft' && request.method === 'PUT') {
        return writeDraft(env, request, auth.user);
    }
    return json(env, request, 405, { error: 'Method not allowed' });
}

function draftIdOk(value) {
    return /^[A-Za-z0-9_.:-]{1,160}$/.test(String(value || ''));
}

async function unfurlCacheKey(target) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(target));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `unfurl:${hex}`;
}

async function readPreviewHtml(start) {
    let current = start;
    for (let hop = 0; hop < 4; hop += 1) {
        if (!isPublicPreviewUrl(current)) return null;
        const res = await fetch(current, {
            redirect: 'manual',
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (compatible; NextTrainPreview/1.0; +https://nexttrain.co.za)',
            },
        });
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('Location');
            if (!loc) return null;
            current = new URL(loc, current).href;
            continue;
        }
        if (!res.ok) return null;
        const type = String(res.headers.get('content-type') || '');
        if (type && !/html|xml/i.test(type)) return null;
        const reader = res.body?.getReader?.();
        if (!reader) {
            const text = await res.text();
            return { html: text.slice(0, 180000), url: current };
        }
        const chunks = [];
        let size = 0;
        while (size < 180000) {
            const step = await reader.read();
            if (step.done) break;
            size += step.value?.byteLength || 0;
            chunks.push(step.value);
        }
        try { await reader.cancel(); } catch { /* ignore */ }
        const merged = new Uint8Array(Math.min(size, 180000));
        let offset = 0;
        for (const chunk of chunks) {
            if (!chunk || offset >= merged.length) break;
            const slice = chunk.subarray(0, merged.length - offset);
            merged.set(slice, offset);
            offset += slice.length;
        }
        const html = new TextDecoder().decode(merged).slice(0, 180000);
        return { html, url: current };
    }
    return null;
}

async function unfurlLink(request, env, url) {
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (!checkRate(`unfurl:${ip}`, 30)) {
        return json(env, request, 429, { error: 'Too many preview requests.' });
    }
    const target = String(url.searchParams.get('url') || '').trim();
    if (!isPublicPreviewUrl(target)) {
        return json(env, request, 400, { error: 'That link cannot be previewed.' });
    }
    const key = await unfurlCacheKey(target);
    if (env?.REPLY_CONTEXT) {
        try {
            const cached = await env.REPLY_CONTEXT.get(key);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed?.url) return json(env, request, 200, parsed);
            }
        } catch { /* fetch live */ }
    }
    let page;
    try {
        page = await readPreviewHtml(target);
    } catch {
        page = null;
    }
    const preview = page ? parseLinkPreviewHtml(page.html, page.url) : null;
    if (!preview) return json(env, request, 404, { error: 'This page has no preview.' });
    if (env?.REPLY_CONTEXT) {
        try {
            await env.REPLY_CONTEXT.put(key, JSON.stringify(preview), { expirationTtl: 60 * 60 * 24 * 7 });
        } catch { /* the caller still gets the card */ }
    }
    return json(env, request, 200, preview);
}

const PREVIEW_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
const PREVIEW_IMAGE_MAX = 2_000_000;

async function unfurlImage(request, env, url) {
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    if (!checkRate(`unfurl-img:${ip}`, 40)) {
        return new Response('Too many image requests.', { status: 429, headers: corsHeaders(env, request) });
    }
    let current = String(url.searchParams.get('url') || '').trim();
    if (!isPublicPreviewUrl(current)) {
        return new Response('That image cannot be cached.', { status: 400, headers: corsHeaders(env, request) });
    }
    for (let hop = 0; hop < 3; hop += 1) {
        let res;
        try {
            res = await fetch(current, {
                redirect: 'manual',
                headers: {
                    Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (compatible; NextTrainPreview/1.0; +https://nexttrain.co.za)',
                },
            });
        } catch {
            return new Response('Image missing.', { status: 404, headers: corsHeaders(env, request) });
        }
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('Location');
            if (!loc) break;
            current = new URL(loc, current).href;
            if (!isPublicPreviewUrl(current)) break;
            continue;
        }
        if (!res.ok) return new Response('Image missing.', { status: 404, headers: corsHeaders(env, request) });
        const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!PREVIEW_IMAGE_TYPES.has(type)) {
            return new Response('Not an image.', { status: 415, headers: corsHeaders(env, request) });
        }
        const announced = Number(res.headers.get('content-length') || 0);
        if (announced > PREVIEW_IMAGE_MAX) {
            return new Response('Image too large.', { status: 413, headers: corsHeaders(env, request) });
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength > PREVIEW_IMAGE_MAX) {
            return new Response('Image too large.', { status: 413, headers: corsHeaders(env, request) });
        }
        return new Response(buf, {
            status: 200,
            headers: {
                ...corsHeaders(env, request),
                'Content-Type': type,
                'Cache-Control': 'public, max-age=604800',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    }
    return new Response('Image missing.', { status: 404, headers: corsHeaders(env, request) });
}

async function readDraft(env, request, url, user) {
    if (!checkRate(`${user.email}:draft`, 30)) {
        return json(env, request, 429, { error: 'Too many draft reads.' });
    }
    const id = String(url.searchParams.get('id') || '').trim();
    if (!draftIdOk(id)) return json(env, request, 400, { error: 'Missing message id.' });
    if (!env?.REPLY_CONTEXT) return json(env, request, 200, { html: '', at: 0 });
    try {
        const raw = await env.REPLY_CONTEXT.get(`draft:${id}`);
        const parsed = raw ? JSON.parse(raw) : null;
        return json(env, request, 200, {
            html: String(parsed?.html || '').slice(0, 20000),
            at: Number(parsed?.at) || 0,
        });
    } catch {
        return json(env, request, 200, { html: '', at: 0 });
    }
}

async function writeDraft(env, request, user) {
    if (!checkRate(`${user.email}:draft`, 20)) {
        return json(env, request, 429, { error: 'Too many draft saves.' });
    }
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    const id = String(body?.id || '').trim();
    const html = String(body?.html || '').slice(0, 20000);
    if (!draftIdOk(id)) return json(env, request, 400, { error: 'Missing message id.' });
    if (!html.trim() || html.trim() === '<br>') {
        return json(env, request, 400, { error: 'Empty draft is not saved.' });
    }
    if (!env?.REPLY_CONTEXT) return json(env, request, 200, { ok: true, stored: 'local' });
    const at = Date.now();
    await env.REPLY_CONTEXT.put(`draft:${id}`, JSON.stringify({ html, at }), { expirationTtl: 60 * 60 * 24 * 45 });
    return json(env, request, 200, { ok: true, at });
}

async function callGemini(env, geminiBody) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': env.GEMINI_API_KEY,
            },
            body: JSON.stringify(geminiBody),
        }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = data?.error?.message || `Gemini returned ${res.status}`;
        return { error: String(message).slice(0, 500), status: 502 };
    }
    return { data };
}

async function suggestReply(request, env) {
    if (!env?.GEMINI_API_KEY) {
        return json(env, request, 503, { error: 'GEMINI_API_KEY is not set on the reply worker.' });
    }
    let body = {};
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { error: 'Expected JSON.' });
    }
    const payload = sanitizeSuggestPayload(body);
    if (!payload.thread.length) {
        return json(env, request, 200, {
            action: 'halt',
            reply: '',
            reason: 'This thread has no message to answer.',
            questions: [],
        });
    }
    let loaded = { files: [], missed: 0 };
    try {
        loaded = await loadSuggestFiles(payload.files);
    } catch (err) {
        return json(env, request, 400, { error: err.message || 'Could not read a thread file.' });
    }
    let geminiBody;
    try {
        geminiBody = buildGeminiRequest({
            payload,
            sharedNote: await readSharedNote(env),
            images: body?.images,
            threadFiles: loaded.files,
            filesMissed: loaded.missed,
        });
    } catch (err) {
        return json(env, request, 400, { error: err.message || 'Could not read those images.' });
    }
    const gemini = await callGemini(env, geminiBody);
    if (gemini.error) return json(env, request, gemini.status, { error: gemini.error });
    const parsed = applyDraftGuard(parseSuggestResult(geminiText(gemini.data)), payload.region);
    return json(env, request, 200, {
        action: parsed.action,
        reply: parsed.action === 'draft' ? parsed.reply : '',
        reason: parsed.reason || '',
        questions: parsed.questions || [],
    });
}

async function writeBrief(request, env) {
    if (!env?.GEMINI_API_KEY) {
        return json(env, request, 503, { error: 'GEMINI_API_KEY is not set on the reply worker.' });
    }
    let body = {};
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { error: 'Expected JSON.' });
    }
    let geminiBody;
    try {
        geminiBody = body?.kind === 'crash'
            ? buildCrashExplainRequest(body.crash)
            : buildBriefRequest(body.digest);
    } catch (err) {
        return json(env, request, 400, { error: err.message || 'Could not read that brief.' });
    }
    const gemini = await callGemini(env, geminiBody);
    if (gemini.error) return json(env, request, gemini.status, { error: gemini.error });
    const text = parseBriefText(geminiText(gemini.data));
    if (!text) return json(env, request, 502, { error: 'The brief returned nothing.' });
    return json(env, request, 200, { text });
}

async function editText(request, env) {
    if (!env?.GEMINI_API_KEY) {
        return json(env, request, 503, { error: 'GEMINI_API_KEY is not set on the reply worker.' });
    }
    let body = {};
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { error: 'Expected JSON.' });
    }
    let geminiBody;
    try {
        geminiBody = buildTextAssistRequest(body);
    } catch (err) {
        return json(env, request, 400, { error: err.message || 'Could not read that text.' });
    }
    const gemini = await callGemini(env, geminiBody);
    if (gemini.error) return json(env, request, gemini.status, { error: gemini.error });
    const text = parseTextAssistResult(geminiText(gemini.data));
    if (!text) return json(env, request, 502, { error: 'The writer returned nothing.' });
    return json(env, request, 200, { text });
}

export default {
    fetch(request, env) {
        return handleRequest(request, env);
    },
};
