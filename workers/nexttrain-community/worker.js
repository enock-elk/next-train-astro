/**
 * Next Train — community write bouncer + 24h TTL janitor
 *
 * POST /community/post
 *   Authorization: Bearer <Firebase ID token>
 *   Body: { routeId, body, displayName?, photoURL?, deviceId?, category?, replyTo?, postId? }
 *
 * Cron (hourly): wipe route_community posts older than POST_TTL_MS (default 24h).
 *
 * Secrets: FIREBASE_PRIVATE_KEY (PEM; \n escaped OK)
 * Vars: FIREBASE_WEB_API_KEY, FIREBASE_DATABASE_URL, FIREBASE_CLIENT_EMAIL, …
 */

const BODY_MAX = 280;
const ALLOWED_HOST = /(^|\.)nexttrain\.co\.za$/i;

/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

function corsHeaders(env, request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const ok = !origin || allowed.includes(origin) || allowed.includes('*');
    return {
        'Access-Control-Allow-Origin': ok ? (origin || '*') : (allowed[0] || '*'),
        'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
}

function json(env, request, status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...corsHeaders(env, request),
        },
    });
}

function stripHtml(text) {
    return String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

const BLOCK_WORDS = new Set([
    'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit',
    'bitch', 'asshole', 'cunt', 'whore', 'slut', 'dickhead', 'wanker',
    'nigger', 'faggot', 'retard',
    'fok', 'fokken', 'poes', 'doos', 'naai', 'hoer', 'moer',
    'msunu', 'umsunu', 'isifebe',
]);

function foldForSafety(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
        .replace(/4/g, 'a').replace(/5/g, 's').replace(/@/g, 'a');
}

function hasDisallowedUrl(text) {
    const re = /\b((?:https?:\/\/|www\.)[^\s]+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\.[a-z]{2,})(?:\/\S*)?)/gi;
    let m;
    while ((m = re.exec(text))) {
        try {
            const raw = m[1];
            const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
            if (!ALLOWED_HOST.test(host)) return true;
        } catch {
            return true;
        }
    }
    return false;
}

function hasBlockedProfanity(text) {
    const folded = foldForSafety(text);
    const words = folded.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.some((w) => BLOCK_WORDS.has(w))) return true;
    const compact = folded.replace(/[^a-z]+/g, '');
    for (const bad of BLOCK_WORDS) {
        if (bad.length >= 4 && compact.includes(bad)) return true;
    }
    return false;
}

/** Keep nexttrain.co.za links; refuse other URLs / profanity at the edge. */
function sanitizeBody(raw) {
    const text = stripHtml(raw);
    if (hasDisallowedUrl(text)) {
        return { ok: false, error: 'Only nexttrain.co.za links are allowed. Remove other websites and try again.' };
    }
    if (hasBlockedProfanity(text)) {
        return { ok: false, error: 'That language isn’t allowed. Please rewrite without swearing or slurs.' };
    }
    const clipped = text.length > BODY_MAX ? text.slice(0, BODY_MAX) : text;
    return { ok: true, text: clipped.trim() };
}

function checkRate(key, windowMs, max) {
    const now = Date.now();
    const arr = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
        rateBuckets.set(key, arr);
        return false;
    }
    arr.push(now);
    rateBuckets.set(key, arr);
    return true;
}

function toBase64Url(obj) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken(clientEmail, privateKey) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
    };
    const dataToSign = `${toBase64Url(header)}.${toBase64Url(payload)}`;
    const cleanKey = privateKey
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/"/g, '')
        .replace(/-----BEGIN PRIVATE KEY-----/gi, '')
        .replace(/-----END PRIVATE KEY-----/gi, '')
        .replace(/\s+/g, '');
    const binaryDer = Uint8Array.from(atob(cleanKey), (c) => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryDer.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(dataToSign));
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const jwt = `${dataToSign}.${encodedSignature}`;
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || 'Google auth failed');
    return data.access_token;
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
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoUrl || null,
    };
}

async function rtdbWrite(env, path, value) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    if (!email || !key || !base) throw new Error('Firebase Admin env incomplete');
    const token = await getGoogleAccessToken(email, key);
    const url = `${base}/${path.replace(/^\//, '')}.json`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(value),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`RTDB write failed (${res.status}): ${t.slice(0, 200)}`);
    }
    return true;
}

async function rtdbGet(env, path) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    if (!email || !key || !base) throw new Error('Firebase Admin env incomplete');
    const token = await getGoogleAccessToken(email, key);
    const url = `${base}/${path.replace(/^\//, '')}.json`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`RTDB read failed (${res.status})`);
    return res.json();
}

async function rtdbDelete(env, path) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    const token = await getGoogleAccessToken(email, key);
    const url = `${base}/${path.replace(/^\//, '')}.json`;
    const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`RTDB delete failed (${res.status})`);
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function handlePost(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
        return json(env, request, 401, { ok: false, error: 'Missing Authorization' });
    }
    const idToken = authHeader.slice(7).trim();
    let user;
    try {
        user = await verifyIdToken(env, idToken);
    } catch (e) {
        return json(env, request, 401, { ok: false, error: e.message || 'Unauthorized' });
    }

    const windowMs = Number(env.RATE_WINDOW_MS || 60_000);
    const max = Number(env.RATE_MAX || 4);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRate(`uid:${user.uid}`, windowMs, max) || !checkRate(`ip:${ip}`, windowMs, max * 2)) {
        return json(env, request, 429, {
            ok: false,
            error: `Please wait ${Math.ceil(windowMs / 1000)} seconds before you can send another message.`,
            retryAfterMs: windowMs,
            reason: 'cooldown',
        });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { ok: false, error: 'Invalid JSON' });
    }

    const routeId = String(body.routeId || '').trim();
    if (!routeId || routeId.length > 80) {
        return json(env, request, 400, { ok: false, error: 'Invalid routeId' });
    }

    const cleaned = sanitizeBody(body.body || '');
    if (!cleaned.ok) {
        return json(env, request, 400, { ok: false, error: cleaned.error, blocked: true });
    }
    const text = cleaned.text;
    if (text.length < 2) {
        return json(env, request, 400, { ok: false, error: 'Write a short message.' });
    }

    // Shadow-ban check
    try {
        const flags = await rtdbGet(env, `users/${user.uid}/flags`);
        if (flags?.shadowBanned === true) {
            const until = Number(flags.shadowBannedUntil || 0);
            if (!until || until === 0 || until > Date.now()) {
                // Silent success — author thinks it posted; do not write
                return json(env, request, 200, {
                    ok: true,
                    shadowSilenced: true,
                    post: { postId: newId('cp'), routeId, body: text, uid: user.uid, timestamp: Date.now() },
                });
            }
        }
    } catch {
        // Fail open on flags read errors (rules/SA) — still sanitize + rate limit
    }

    const postId = String(body.postId || newId('cp')).slice(0, 80);
    const category = ['general', 'delay', 'safety', 'other', 'system'].includes(body.category)
        ? body.category
        : 'general';
    const payload = {
        postId,
        routeId,
        region: String(body.region || '').slice(0, 8) || null,
        body: text,
        category,
        uid: user.uid,
        displayName: String(body.displayName || user.displayName || 'Passenger').slice(0, 80),
        photoURL: body.photoURL || user.photoURL || null,
        deviceId: String(body.deviceId || 'unknown').slice(0, 120),
        timestamp: Date.now(),
        hidden: false,
        replyCount: 0,
        appVersion: String(body.appVersion || '').slice(0, 40) || null,
        via: 'community_worker',
    };
    if (body.replyTo && typeof body.replyTo === 'object') {
        payload.replyTo = {
            postId: String(body.replyTo.postId || '').slice(0, 80),
            displayName: String(body.replyTo.displayName || '').slice(0, 80),
            body: (sanitizeBody(String(body.replyTo.body || '')).text || '').slice(0, 120),
        };
    }

    try {
        await rtdbWrite(env, `route_community/${routeId}/posts/${postId}`, payload);
        return json(env, request, 200, { ok: true, post: payload });
    } catch (e) {
        return json(env, request, 500, { ok: false, error: e.message || 'Write failed' });
    }
}

async function wipeStalePosts(env) {
    const ttl = Number(env.POST_TTL_MS || 86_400_000);
    const cut = Date.now() - ttl;
    const tree = await rtdbGet(env, 'route_community');
    if (!tree || typeof tree !== 'object') return { deleted: 0 };
    let deleted = 0;
    for (const [routeId, routeNode] of Object.entries(tree)) {
        const posts = routeNode?.posts;
        if (!posts || typeof posts !== 'object') continue;
        for (const [postId, post] of Object.entries(posts)) {
            const ts = Number(post?.timestamp || 0);
            if (ts && ts < cut) {
                try {
                    await rtdbDelete(env, `route_community/${routeId}/posts/${postId}`);
                    deleted += 1;
                } catch {
                    /* continue */
                }
            }
        }
    }
    return { deleted };
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(env, request) });
        }
        const url = new URL(request.url);
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
            return json(env, request, 200, { ok: true, service: 'nexttrain-community' });
        }
        if (request.method === 'POST' && (url.pathname === '/community/post' || url.pathname === '/post')) {
            return handlePost(request, env);
        }
        if (request.method === 'POST' && url.pathname === '/community/ttl-wipe') {
            // Manual ops trigger (protect with shared secret if set)
            const secret = env.TTL_WIPE_SECRET;
            if (secret && request.headers.get('X-TTL-Secret') !== secret) {
                return json(env, request, 401, { ok: false, error: 'Unauthorized' });
            }
            try {
                const result = await wipeStalePosts(env);
                return json(env, request, 200, { ok: true, ...result });
            } catch (e) {
                return json(env, request, 500, { ok: false, error: e.message });
            }
        }
        return json(env, request, 404, { ok: false, error: 'Not found' });
    },

    async scheduled(_event, env, ctx) {
        ctx.waitUntil(
            wipeStalePosts(env).catch((e) => console.error('TTL wipe failed', e))
        );
    },
};
