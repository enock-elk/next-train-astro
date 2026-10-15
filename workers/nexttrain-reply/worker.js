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
 * The browser never sees the Gemini key. The worker does not download feedback.
 */
import {
    applyDraftGuard,
    buildGeminiRequest,
    geminiText,
    parseSuggestResult,
    sanitizeSuggestPayload,
    SUGGEST_NOTE_MAX,
} from '../../src/lib/reply-suggest.js';
import {
    buildTextAssistRequest,
    parseTextAssistResult,
} from '../../src/lib/text-assist.js';

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
    await env.REPLY_CONTEXT.put(NOTE_KEY, String(note || '').slice(0, SUGGEST_NOTE_MAX));
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
    if (url.pathname !== '/suggest' && url.pathname !== '/context' && url.pathname !== '/edit') {
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
        const saved = await writeSharedNote(env, body?.note);
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
    return json(env, request, 405, { error: 'Method not allowed' });
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
    let geminiBody;
    try {
        geminiBody = buildGeminiRequest({
            payload,
            sharedNote: await readSharedNote(env),
            images: body?.images,
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
