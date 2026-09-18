/**
 * Next Train — community write bouncer, scheduled alerts + 24h TTL janitor
 *
 * POST /community/post
 *   Authorization: Bearer <Firebase ID token>
 *   Body: { routeId, body, displayName?, photoURL?, deviceId?, category?, replyTo?, postId? }
 *
 * Cron (every 5 minutes): publish due scheduled alerts.
 * Cron (hourly): wipe route_community posts older than POST_TTL_MS (default 24h).
 *
 * Secrets: FIREBASE_PRIVATE_KEY (PEM; \n escaped OK)
 * Vars: FIREBASE_WEB_API_KEY, FIREBASE_DATABASE_URL, FIREBASE_CLIENT_EMAIL, …
 */
import {
    classifyScamContent,
    classifyUnsafeLanguage,
    findDisallowedUrls,
} from '../../src/lib/content-safety-core.js';

const BODY_MAX = 280;
const ADMIN_EMAILS = new Set(['enockelk@gmail.com', 'thandeka05nxumalo@gmail.com']);
const JOHANNESBURG_OFFSET_MS = 2 * 60 * 60 * 1000;
const ALERT_CRON = '*/5 * * * *';
const TTL_CRON = '0 * * * *';
const DEFAULT_CLAIM_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_IMPRESSION_DEDUPE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

function isSafeRtdbKey(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[.#$[\]/]/.test(value);
}

function corsOriginAllowed(origin, env) {
    if (!origin) return true;
    const allowed = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (allowed.includes('*') || allowed.includes(origin)) return true;
    try {
        const host = new URL(origin).hostname.toLowerCase();
        if (host.endsWith('.github.io') || host.endsWith('.pages.dev')) return true;
    } catch { /* ignore */ }
    return false;
}

function corsHeaders(env, request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const ok = corsOriginAllowed(origin, env);
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

/** Keep nexttrain.co.za links; refuse other URLs, scam packs, and profanity at the edge. */
export function sanitizeBody(raw) {
    const text = stripHtml(raw);
    if (findDisallowedUrls(text).length) {
        return { ok: false, verdict: 'block', error: "Couldn't post that." };
    }
    const scam = classifyScamContent(text);
    if (scam.block.length) {
        return { ok: false, verdict: 'block', error: "Couldn't post that." };
    }
    const safety = classifyUnsafeLanguage(text);
    if (safety.block.length) {
        return { ok: false, verdict: 'block', error: 'That language isn’t allowed. Please rewrite without swearing or slurs.' };
    }
    if (safety.review.length || scam.review.length) {
        const clipped = text.length > BODY_MAX ? text.slice(0, BODY_MAX) : text;
        return {
            ok: false,
            verdict: 'review',
            text: clipped.trim(),
            error: 'We’re checking this message. It won’t appear until an admin approves it.',
        };
    }
    const clipped = text.length > BODY_MAX ? text.slice(0, BODY_MAX) : text;
    return { ok: true, verdict: 'allow', text: clipped.trim() };
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

export function isValidImpressionScope(value) {
    const scope = String(value || '').trim();
    if (!isSafeRtdbKey(scope)) return false;
    return scope === 'all'
        || /^all_[A-Z]{2,3}$/.test(scope)
        || /^[a-z][a-z0-9_-]{1,80}$/i.test(scope);
}

export function isValidImpressionNoticeId(value) {
    return isSafeRtdbKey(String(value || '').trim());
}

export function isValidInstallationId(value) {
    return typeof value === 'string'
        && value.length >= 16
        && value.length <= 128
        && /^[A-Za-z0-9_-]+$/.test(value);
}

export async function hashInstallationId(installationId, secret = '') {
    const bytes = new TextEncoder().encode(`${secret}:${installationId}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
        scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/userinfo.email',
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

export function hasFirebaseAdminEnv(env) {
    return !!(
        env?.FIREBASE_CLIENT_EMAIL
        && env?.FIREBASE_PRIVATE_KEY
        && String(env?.FIREBASE_DATABASE_URL || '').trim()
    );
}

async function rtdbWriteWithUserToken(env, path, value, idToken) {
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('FIREBASE_DATABASE_URL missing');
    if (!idToken) throw new Error('Missing auth token');
    const url = `${base}/${String(path || '').replace(/^\//, '')}.json?auth=${encodeURIComponent(idToken)}`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`RTDB write failed (${res.status}): ${t.slice(0, 200)}`);
    }
    return true;
}

async function rtdbWritePreferred(env, path, value, idToken) {
    if (hasFirebaseAdminEnv(env)) return rtdbWrite(env, path, value);
    return rtdbWriteWithUserToken(env, path, value, idToken);
}

/** Google OAuth `access_token` is the RTDB REST admin bypass. Bearer can be scored as a user. */
function rtdbJsonUrl(base, path, accessToken) {
    const cleanBase = String(base || '').replace(/\/$/, '');
    const cleanPath = String(path || '').replace(/^\//, '');
    const url = new URL(`${cleanBase}/${cleanPath}.json`);
    url.searchParams.set('access_token', accessToken);
    return url.toString();
}

async function rtdbWrite(env, path, value) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    if (!email || !key || !base) throw new Error('Firebase Admin env incomplete');
    const token = await getGoogleAccessToken(email, key);
    const res = await fetch(rtdbJsonUrl(base, path, token), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`RTDB write failed (${res.status}): ${t.slice(0, 200)}`);
    }
    return true;
}

async function rtdbUpdate(env, updates) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    if (!email || !key || !base) throw new Error('Firebase Admin env incomplete');
    const token = await getGoogleAccessToken(email, key);
    const res = await fetch(rtdbJsonUrl(base, '', token), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`RTDB update failed (${res.status}): ${t.slice(0, 200)}`);
    }
    return true;
}

async function rtdbGet(env, path) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    if (!email || !key || !base) throw new Error('Firebase Admin env incomplete');
    const token = await getGoogleAccessToken(email, key);
    const res = await fetch(rtdbJsonUrl(base, path, token));
    if (!res.ok) throw new Error(`RTDB read failed (${res.status})`);
    return res.json();
}

async function rtdbDelete(env, path) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    const token = await getGoogleAccessToken(email, key);
    const res = await fetch(rtdbJsonUrl(base, path, token), { method: 'DELETE' });
    if (!res.ok) throw new Error(`RTDB delete failed (${res.status})`);
}

function createRtdbClient(env) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    if (!email || !key || !base) throw new Error('Firebase Admin env incomplete');
    let tokenPromise;
    const token = () => {
        if (!tokenPromise) tokenPromise = getGoogleAccessToken(email, key);
        return tokenPromise;
    };
    const request = async (path, init = {}) => {
        const authToken = await token();
        return fetch(rtdbJsonUrl(base, path, authToken), init);
    };
    return {
        async get(path, withEtag = false) {
            const res = await request(path, {
                headers: withEtag ? { 'X-Firebase-ETag': 'true' } : {},
            });
            if (!res.ok) throw new Error(`RTDB read failed (${res.status})`);
            return {
                value: await res.json(),
                etag: res.headers.get('ETag'),
            };
        },
        async put(path, value, ifMatch = null) {
            const headers = { 'Content-Type': 'application/json' };
            if (ifMatch) headers['If-Match'] = ifMatch;
            const res = await request(path, {
                method: 'PUT',
                headers,
                body: JSON.stringify(value),
            });
            if (res.status === 412) return { matched: false };
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`RTDB conditional write failed (${res.status}): ${text.slice(0, 200)}`);
            }
            return { matched: true };
        },
        async del(path) {
            const res = await request(path, { method: 'DELETE' });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`RTDB delete failed (${res.status}): ${text.slice(0, 200)}`);
            }
            return { matched: true };
        },
    };
}

async function pruneInvalidPushSubscriptions(rtdb, invalid) {
    const deviceIds = [...new Set(invalid.flatMap((result) => result.entry?.deviceIds || []))]
        .filter((deviceId) => isSafeRtdbKey(deviceId));
    let pruned = 0;
    await Promise.all(deviceIds.map(async (deviceId) => {
        const path = `push_subscriptions/${deviceId}`;
        try {
            if (typeof rtdb.del === 'function') await rtdb.del(path);
            else await rtdb.put(path, null);
            pruned += 1;
        } catch (error) {
            console.log(JSON.stringify({
                event: 'push_subscription_prune_failed',
                deviceId,
                error: String(error?.message || error).slice(0, 200),
            }));
        }
    }));
    return pruned;
}

function isNoticePayload(value) {
    return !!value && typeof value === 'object' && !!(
        value.id || value.message || value.text || value.imageUrl || value.imageUrls
    );
}

async function noticeExists(rtdb, scope, noticeId) {
    const direct = (await rtdb.get(`notices/${scope}/${noticeId}`)).value;
    if (isNoticePayload(direct)) return true;
    const bucket = (await rtdb.get(`notices/${scope}`)).value;
    return isNoticePayload(bucket) && String(bucket.id || '') === noticeId;
}

/**
 * ETag transaction over count + dedupe map. A concurrent duplicate either wins
 * this transaction or observes the winner, so the count changes exactly once.
 */
export async function recordAlertImpression({
    rtdb,
    scope,
    noticeId,
    installationId,
    hashSecret = '',
    now = Date.now(),
    retentionMs = DEFAULT_IMPRESSION_DEDUPE_TTL_MS,
}) {
    if (!isValidImpressionScope(scope)) throw new Error('Invalid scope');
    if (!isValidImpressionNoticeId(noticeId)) throw new Error('Invalid noticeId');
    if (!isValidInstallationId(installationId)) throw new Error('Invalid installationId');
    if (!(await noticeExists(rtdb, scope, noticeId))) return { found: false, counted: false, count: 0 };

    const installationHash = await hashInstallationId(installationId, hashSecret);
    const path = `notice_impressions/${scope}/${noticeId}`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const current = await rtdb.get(path, true);
        const node = current.value && typeof current.value === 'object' ? current.value : {};
        const dedupe = node.dedupe && typeof node.dedupe === 'object' ? node.dedupe : {};
        if (dedupe[installationHash]) {
            return { found: true, counted: false, count: Math.max(0, Number(node.count) || 0) };
        }
        const next = {
            count: Math.max(0, Number(node.count) || 0) + 1,
            updatedAt: now,
            dedupe: {
                ...dedupe,
                [installationHash]: { createdAt: now, expiresAt: now + retentionMs },
            },
        };
        const written = await rtdb.put(path, next, current.etag);
        if (written.matched) return { found: true, counted: true, count: next.count };
    }
    throw new Error('Impression transaction contended');
}

export async function cleanupAlertImpressionDedupe(env, options = {}) {
    const now = Number(options.now ?? Date.now());
    const rtdb = options.rtdb || createRtdbClient(env);
    const tree = (await rtdb.get('notice_impressions')).value;
    let deleted = 0;
    for (const [scope, notices] of Object.entries(tree || {})) {
        for (const noticeId of Object.keys(notices || {})) {
            const path = `notice_impressions/${scope}/${noticeId}`;
            for (let attempt = 0; attempt < 4; attempt += 1) {
                const current = await rtdb.get(path, true);
                if (!current.value || typeof current.value !== 'object') break;
                const entries = Object.entries(current.value.dedupe || {});
                const live = Object.fromEntries(entries.filter(([, item]) => Number(item?.expiresAt || 0) > now));
                const removed = entries.length - Object.keys(live).length;
                if (!removed) break;
                const next = { ...current.value, dedupe: live };
                const written = await rtdb.put(path, next, current.etag);
                if (!written.matched) continue;
                deleted += removed;
                break;
            }
        }
    }
    return { deleted };
}

function johannesburgParts(ts) {
    const d = new Date(Number(ts) + JOHANNESBURG_OFFSET_MS);
    return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth(),
        day: d.getUTCDate(),
        weekday: d.getUTCDay(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
    };
}

function johannesburgTimestamp(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
    return Date.UTC(year, month, day, hour, minute, second, ms) - JOHANNESBURG_OFFSET_MS;
}

function parseTimeOfDay(value, fallback = '06:00') {
    const [rawHour, rawMinute] = String(value || fallback).split(':');
    return {
        hour: Math.max(0, Math.min(23, parseInt(rawHour, 10) || 0)),
        minute: Math.max(0, Math.min(59, parseInt(rawMinute, 10) || 0)),
    };
}

function normalizeWeekdays(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort((a, b) => a - b);
}

function endOfJohannesburgDay(ts) {
    const p = johannesburgParts(ts);
    return johannesburgTimestamp(p.year, p.month, p.day, 23, 59, 59, 999);
}

function endOfJohannesburgMonth(ts) {
    const p = johannesburgParts(ts);
    return johannesburgTimestamp(p.year, p.month + 1, 0, 23, 59, 59, 999);
}

function untilTimestamp(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return johannesburgTimestamp(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
    }
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function capRun(ts, untilAt) {
    const next = Number(ts) || 0;
    const cap = untilTimestamp(untilAt);
    return next && (!cap || next <= cap) ? next : 0;
}

function nextWeeklyRun(job, fromTs) {
    const weekdays = normalizeWeekdays(job.weekdays);
    if (!weekdays.length) return 0;
    const { hour, minute } = parseTimeOfDay(job.timeOfDay, '06:00');
    const start = johannesburgParts(fromTs);
    for (let offset = 0; offset < 8; offset += 1) {
        const midnight = johannesburgTimestamp(start.year, start.month, start.day + offset);
        const candidateParts = johannesburgParts(midnight);
        const candidate = johannesburgTimestamp(
            candidateParts.year,
            candidateParts.month,
            candidateParts.day,
            hour,
            minute
        );
        if (weekdays.includes(candidateParts.weekday) && candidate > fromTs) return candidate;
    }
    return 0;
}

function nextMonthlyRun(job, fromTs) {
    const monthDay = Math.max(1, Math.min(31, parseInt(job.monthDay, 10) || 1));
    const { hour, minute } = parseTimeOfDay(job.timeOfDay, '08:00');
    const start = johannesburgParts(fromTs);
    for (let offset = 0; offset < 14; offset += 1) {
        const monthStart = new Date(Date.UTC(start.year, start.month + offset, 1));
        const year = monthStart.getUTCFullYear();
        const month = monthStart.getUTCMonth();
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const candidate = johannesburgTimestamp(year, month, Math.min(monthDay, daysInMonth), hour, minute);
        if (candidate > fromTs) return candidate;
    }
    return 0;
}

export function computeScheduledAlertNextRun(job, fromTs) {
    const frequency = job?.frequency || 'once';
    const from = Number(fromTs) || 0;
    if (!from || frequency === 'once') return 0;
    if (frequency === 'weekly' && normalizeWeekdays(job.weekdays).length) {
        return capRun(nextWeeklyRun(job, from), job.untilAt);
    }
    if (frequency === 'monthly') return capRun(nextMonthlyRun(job, from), job.untilAt);
    if (frequency === 'hourly') return capRun(from + 60 * 60 * 1000, job.untilAt);
    if (frequency === 'daily') {
        const p = johannesburgParts(from);
        return capRun(
            johannesburgTimestamp(p.year, p.month, p.day + 1, p.hour, p.minute),
            job.untilAt
        );
    }
    if (frequency === 'weekdays') {
        let cursor = from;
        for (let i = 0; i < 10; i += 1) {
            const p = johannesburgParts(cursor);
            cursor = johannesburgTimestamp(p.year, p.month, p.day + 1, p.hour, p.minute);
            const nextParts = johannesburgParts(cursor);
            if (nextParts.weekday !== 0 && nextParts.weekday !== 6) return capRun(cursor, job.untilAt);
        }
    }
    if (frequency === 'weekly') return capRun(from + 7 * 24 * 60 * 60 * 1000, job.untilAt);
    return 0;
}

export function scheduledAlertExpiresAt(runAt, job) {
    const notice = job?.notice && typeof job.notice === 'object' ? job.notice : {};
    if (job?.expireMode === 'month_end') return endOfJohannesburgMonth(runAt);
    if (job?.expireMode === 'end_of_day') return endOfJohannesburgDay(runAt);
    if (job?.expireMode === 'absolute') {
        const absolute = Number(notice.expiresAt || job.expiresAt || 0);
        if (absolute) return absolute;
    }
    const duration = Number(notice.expiresInMs != null ? notice.expiresInMs : job?.expiresInMs) || 0;
    return duration > 0 ? runAt + duration : endOfJohannesburgDay(runAt);
}

export function planScheduledAlertRun(job, now) {
    let cursor = Number(job?.nextRunAt || 0);
    if (!cursor || cursor > now) return { due: false, nextRunAt: cursor, staleSkipped: 0 };
    let occurrenceAt = 0;
    let staleSkipped = 0;
    for (let guard = 0; cursor && cursor <= now && guard < 10000; guard += 1) {
        if (scheduledAlertExpiresAt(cursor, job) > now) {
            if (occurrenceAt) staleSkipped += 1;
            occurrenceAt = cursor;
        } else {
            staleSkipped += 1;
        }
        cursor = computeScheduledAlertNextRun(job, cursor);
    }
    return {
        due: true,
        occurrenceAt,
        nextRunAt: cursor,
        staleSkipped,
        finished: !cursor,
    };
}

function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function scheduledNoticeId(scheduleId, occurrenceAt) {
    return `sched_${Number(occurrenceAt).toString(36)}_${stableHash(scheduleId)}`;
}

function scheduledTargets(job) {
    const values = Array.isArray(job?.targets) && job.targets.length ? job.targets : [job?.target];
    return Array.from(new Set(values.map((target) => String(target || '').trim()).filter(isSafeRtdbKey)));
}

function listNotices(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.filter((item) => item && typeof item === 'object');
    const children = Object.entries(node)
        .filter(([key, value]) => key !== 'reactions' && value && typeof value === 'object'
            && (value.message || value.text || value.severity || value.imageUrls || value.imageUrl))
        .map(([key, value]) => ({ ...value, id: value.id || key }));
    if (children.length) return children;
    return (node.message || node.text || node.id || node.imageUrls || node.imageUrl) ? [node] : [];
}

function noticesMeta(notices, now) {
    const live = notices.filter((notice) => !Number(notice.expiresAt) || Number(notice.expiresAt) > now);
    const timestamp = (notice) => Number(notice.postedAt || notice.timestamp || 0);
    const latest = live.slice().sort((a, b) => timestamp(b) - timestamp(a))[0] || null;
    const critical = live.filter((notice) => notice.severity === 'critical')
        .sort((a, b) => timestamp(b) - timestamp(a))[0] || null;
    const rank = { critical: 3, warning: 2, info: 1 };
    const latestSeverity = live.reduce(
        (best, notice) => (rank[notice.severity] || 0) > (rank[best] || 0) ? notice.severity : best,
        'info'
    );
    return {
        latestId: latest?.id || null,
        latestAt: latest ? timestamp(latest) : 0,
        latestCriticalAt: critical ? timestamp(critical) : 0,
        latestSeverity,
        liveCount: live.length,
    };
}

async function publishScheduledNotice(rtdb, target, payload, now) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await rtdb.get(`notices/${target}`, true);
        const listed = listNotices(current.value);
        const legacy = current.value && (current.value.message || current.value.text) && listed.length === 1;
        const nextNode = legacy
            ? { [String(listed[0].id || 'legacy')]: listed[0], [payload.id]: payload }
            : { ...(current.value && typeof current.value === 'object' ? current.value : {}), [payload.id]: payload };
        const written = await rtdb.put(`notices/${target}`, nextNode, current.etag);
        if (!written.matched) continue;
        const nextList = listNotices(nextNode);
        await rtdb.put(`notices_meta/${target}`, noticesMeta(nextList, now));
        return;
    }
    throw new Error(`Could not publish ${target} after concurrent updates`);
}

function claimId() {
    return crypto.randomUUID();
}

async function processScheduledJob(rtdb, scheduleId, now, leaseMs) {
    const current = await rtdb.get(`notices_scheduled/${scheduleId}`, true);
    const job = current.value;
    if (!job || job.enabled === false || !job.notice) return { state: 'ignored' };
    const plan = planScheduledAlertRun(job, now);
    if (!plan.due) return { state: 'pending' };
    if (!plan.occurrenceAt) {
        const nextJob = plan.finished ? null : {
            ...job,
            nextRunAt: plan.nextRunAt,
            lastSkippedAt: now,
            staleSkipped: Number(job.staleSkipped || 0) + plan.staleSkipped,
        };
        const advanced = await rtdb.put(`notices_scheduled/${scheduleId}`, nextJob, current.etag);
        return { state: advanced.matched ? 'stale' : 'contended', staleSkipped: plan.staleSkipped };
    }
    if (job.processing?.leaseUntil > now) return { state: 'contended' };
    const targets = scheduledTargets(job);
    if (!targets.length) return { state: 'invalid' };
    const token = claimId();
    const noticeId = scheduledNoticeId(scheduleId, plan.occurrenceAt);
    const claimedJob = {
        ...job,
        processing: {
            token,
            occurrenceAt: plan.occurrenceAt,
            noticeId,
            claimedAt: now,
            leaseUntil: now + leaseMs,
        },
    };
    const claimed = await rtdb.put(`notices_scheduled/${scheduleId}`, claimedJob, current.etag);
    if (!claimed.matched) return { state: 'contended' };

    const notice = { ...job.notice };
    delete notice.expiresInMs;
    const payload = {
        ...notice,
        id: noticeId,
        postedAt: plan.occurrenceAt,
        expiresAt: scheduledAlertExpiresAt(plan.occurrenceAt, job),
    };
    const failures = [];
    for (const target of targets) {
        try {
            await publishScheduledNotice(rtdb, target, payload, now);
        } catch (error) {
            failures.push({ target, error: error?.message || 'Publish failed' });
        }
    }
    if (failures.length) return { state: 'failed', noticeId, failures };

    const latest = await rtdb.get(`notices_scheduled/${scheduleId}`, true);
    if (latest.value?.processing?.token !== token) return { state: 'contended', noticeId };
    const completedJob = plan.finished ? null : {
        ...latest.value,
        nextRunAt: plan.nextRunAt,
        lastRunAt: now,
        lastOccurrenceAt: plan.occurrenceAt,
        lastNoticeId: noticeId,
        staleSkipped: Number(job.staleSkipped || 0) + plan.staleSkipped,
    };
    if (completedJob) delete completedJob.processing;
    const completed = await rtdb.put(`notices_scheduled/${scheduleId}`, completedJob, latest.etag);
    return { state: completed.matched ? 'published' : 'contended', noticeId, targets: targets.length };
}

export async function runScheduledAlerts(env, options = {}) {
    const now = Number(options.now ?? Date.now());
    const rtdb = options.rtdb || createRtdbClient(env);
    const leaseMs = Number(env.ALERT_CLAIM_LEASE_MS || DEFAULT_CLAIM_LEASE_MS);
    const tree = (await rtdb.get('notices_scheduled')).value;
    const results = [];
    for (const scheduleId of Object.keys(tree || {}).sort()) {
        try {
            results.push({ scheduleId, ...(await processScheduledJob(rtdb, scheduleId, now, leaseMs)) });
        } catch (error) {
            results.push({ scheduleId, state: 'failed', error: error?.message || 'Unknown failure' });
        }
    }
    const summary = {
        at: now,
        checked: results.length,
        published: results.filter((item) => item.state === 'published').length,
        staleSkipped: results.reduce((sum, item) => sum + Number(item.staleSkipped || 0), 0),
        failed: results.filter((item) => item.state === 'failed').length,
        contended: results.filter((item) => item.state === 'contended').length,
        results,
    };
    try {
        await rtdb.put('notices_scheduler_status', summary);
    } catch (error) {
        console.error('Scheduled alert status write failed', error);
    }
    return summary;
}

async function handleAlertImpression(request, env) {
    let body;
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { ok: false, error: 'Invalid JSON' });
    }
    const scope = String(body.scope || '').trim();
    const noticeId = String(body.noticeId || '').trim();
    const installationId = String(body.installationId || '').trim();
    if (!isValidImpressionScope(scope) || !isValidImpressionNoticeId(noticeId) || !isValidInstallationId(installationId)) {
        return json(env, request, 400, { ok: false, error: 'Invalid impression identity' });
    }
    const windowMs = Number(env.IMPRESSION_RATE_WINDOW_MS || 60_000);
    const max = Number(env.IMPRESSION_RATE_MAX || 30);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRate(`imp-device:${installationId}`, windowMs, max)
        || !checkRate(`imp-ip:${ip}`, windowMs, max * 4)) {
        return json(env, request, 429, { ok: false, error: 'Rate limited', retryAfterMs: windowMs });
    }
    try {
        const result = await recordAlertImpression({
            rtdb: createRtdbClient(env),
            scope,
            noticeId,
            installationId,
            hashSecret: env.IMPRESSION_HASH_SECRET || env.FIREBASE_PRIVATE_KEY || '',
            retentionMs: Number(env.IMPRESSION_DEDUPE_TTL_MS || DEFAULT_IMPRESSION_DEDUPE_TTL_MS),
        });
        if (!result.found) return json(env, request, 404, { ok: false, error: 'Notice not found' });
        return json(env, request, 200, { ok: true, counted: result.counted, count: result.count });
    } catch (error) {
        return json(env, request, 500, { ok: false, error: error?.message || 'Impression write failed' });
    }
}

async function requireAdmin(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return { error: 'Missing Authorization', status: 401 };
    try {
        const user = await verifyIdToken(env, authHeader.slice(7).trim());
        if (!ADMIN_EMAILS.has(String(user.email || '').trim().toLowerCase())) {
            return { error: 'Forbidden', status: 403 };
        }
        return { user };
    } catch (error) {
        return { error: error?.message || 'Unauthorized', status: 401 };
    }
}

const PUSH_REGIONS = new Set(['GP', 'WC', 'KZN', 'EC']);
const MAX_PUSH_RECIPIENTS = 500;

function pushText(value, max) {
    return stripHtml(value).slice(0, max).trim();
}

function normalizePushLink(raw) {
    const fallback = 'https://nexttrain.co.za/';
    const value = String(raw || fallback).trim();
    let url;
    try {
        url = new URL(value, fallback);
    } catch {
        throw new Error('Invalid notification link');
    }
    const host = url.hostname.toLowerCase();
    const allowed = host === 'nexttrain.co.za'
        || host === 'www.nexttrain.co.za'
        || host === 'lab.nexttrain.co.za'
        || host === 'enock-elk.github.io'
        || host.endsWith('.next-train-lab.pages.dev');
    if (url.protocol !== 'https:' || !allowed) throw new Error('Notification link must open Next Train');
    return url.href;
}

export function normalizePushRequest(raw = {}) {
    const title = pushText(raw.title, 80);
    const body = pushText(raw.body, 180);
    if (!title) throw new Error('Notification title is required');
    if (!body) throw new Error('Notification message is required');
    const audience = ['all', 'region', 'route'].includes(raw.audience) ? raw.audience : 'all';
    const target = String(raw.target || '').trim();
    if (audience === 'region' && !PUSH_REGIONS.has(target)) throw new Error('Choose a valid region');
    if (audience === 'route' && !isSafeRtdbKey(target)) throw new Error('Choose a valid route');
    const environment = raw.environment === 'lab' ? 'lab' : 'production';
    const ttlSec = Math.min(86_400, Math.max(60, Math.round(Number(raw.ttlSec) || 3600)));
    return {
        title,
        body,
        audience,
        target: audience === 'all' ? 'all' : target,
        environment,
        lab: environment === 'lab',
        urgency: raw.urgency === 'high' ? 'high' : 'normal',
        ttlSec,
        link: normalizePushLink(raw.link),
        dryRun: raw.dryRun === true,
    };
}

export function pushSubscriptionMatches(subscription, request) {
    if (!subscription || subscription.enabled === false) return false;
    if (typeof subscription.token !== 'string' || subscription.token.length < 11) return false;
    if ((subscription.lab === true) !== request.lab) return false;
    if (request.audience === 'all') return true;
    if (request.audience === 'region') return subscription.region === request.target;
    const routes = Array.isArray(subscription.routeIds)
        ? subscription.routeIds
        : Object.values(subscription.routeIds || {});
    return routes.map(String).includes(request.target);
}

export function buildFcmMessage(registrationId, request, tag = `nt-push-${Date.now()}`, registrationType = 'token') {
    return {
        [registrationType === 'fid' ? 'fid' : 'token']: registrationId,
        notification: {
            title: request.title,
            body: request.body,
        },
        data: {
            audience: request.audience,
            target: request.target,
            environment: request.environment,
            link: request.link,
        },
        webpush: {
            headers: {
                TTL: String(request.ttlSec),
                Urgency: request.urgency,
            },
            notification: {
                // Color train on transparent canvas (large/expanded icon).
                // Opaque app icons (icon-48/192) become a white square on Android collapsed shade.
                icon: 'https://nexttrain.co.za/icons/notification-icon.png',
                // White silhouette, transparent ground — Android status-bar / collapsed small icon.
                badge: 'https://nexttrain.co.za/icons/notification-badge.png',
                tag,
            },
            fcm_options: {
                link: request.link,
            },
        },
    };
}

function invalidFcmToken(data) {
    const status = String(data?.error?.status || '');
    const details = Array.isArray(data?.error?.details) ? data.error.details : [];
    return status === 'NOT_FOUND'
        || details.some((detail) => ['UNREGISTERED', 'INVALID_ARGUMENT'].includes(detail?.errorCode));
}

async function sendOneFcm(env, accessToken, registrationId, request, registrationType = 'token') {
    const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID missing');
    const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: buildFcmMessage(
                    registrationId,
                    request,
                    `nt-push-${crypto.randomUUID()}`,
                    registrationType
                ),
            }),
        }
    );
    let data = null;
    try { data = await response.json(); } catch { /* bounded FCM response may be empty */ }
    return { ok: response.ok, status: response.status, data, invalid: !response.ok && invalidFcmToken(data) };
}

export async function deliverPushNotifications(env, raw, options = {}) {
    const request = normalizePushRequest(raw);
    const rtdb = options.rtdb || createRtdbClient(env);
    const tree = (await rtdb.get('push_subscriptions')).value || {};
    const matched = Object.entries(tree)
        .filter(([, subscription]) => pushSubscriptionMatches(subscription, request));
    const byToken = new Map();
    for (const [deviceId, subscription] of matched) {
        if (!byToken.has(subscription.token)) {
            byToken.set(subscription.token, { deviceIds: [deviceId], subscription });
        } else {
            byToken.get(subscription.token).deviceIds.push(deviceId);
        }
    }
    const recipients = [...byToken.values()];
    const limited = recipients.slice(0, MAX_PUSH_RECIPIENTS);
    if (request.dryRun) {
        return {
            dryRun: true,
            subscribers: Object.keys(tree).length,
            matched: recipients.length,
            attempted: 0,
            sent: 0,
            failed: 0,
            invalid: 0,
            pruned: 0,
            truncated: Math.max(0, recipients.length - limited.length),
        };
    }

    const accessToken = options.sendOne
        ? null
        : await getGoogleAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    const sendOne = options.sendOne
        || ((registrationId, subscription) => (
            sendOneFcm(env, accessToken, registrationId, request, subscription.registrationType)
        ));
    const results = [];
    for (let i = 0; i < limited.length; i += 40) {
        const batch = limited.slice(i, i + 40);
        const settled = await Promise.all(batch.map(async (entry) => {
            try {
                return {
                    entry,
                    ...(await sendOne(entry.subscription.token, entry.subscription, request)),
                };
            } catch (error) {
                return { entry, ok: false, status: 0, error: error?.message || 'FCM send failed' };
            }
        }));
        results.push(...settled);
    }
    const invalid = results.filter((result) => result.invalid);
    const pruned = await pruneInvalidPushSubscriptions(rtdb, invalid);
    const sent = results.filter((result) => result.ok).length;
    const firstFail = results.find((result) => !result.ok);
    const sampleError = firstFail
        ? String(
            firstFail.data?.error?.message
            || firstFail.data?.error?.status
            || firstFail.error
            || (firstFail.status ? `HTTP ${firstFail.status}` : 'FCM send failed')
        ).slice(0, 180)
        : '';
    return {
        dryRun: false,
        subscribers: Object.keys(tree).length,
        matched: recipients.length,
        attempted: results.length,
        sent,
        failed: results.length - sent,
        invalid: invalid.length,
        pruned,
        truncated: Math.max(0, recipients.length - limited.length),
        sampleError,
    };
}

async function handlePushNotificationsAdmin(request, env) {
    const auth = await requireAdmin(request, env);
    if (auth.error) return json(env, request, auth.status, { ok: false, error: auth.error });
    let body;
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { ok: false, error: 'Invalid JSON' });
    }
    try {
        const result = await deliverPushNotifications(env, body);
        console.log(JSON.stringify({
            event: 'admin_push_notification',
            admin: auth.user.email,
            audience: body.audience || 'all',
            target: body.target || 'all',
            ...result,
        }));
        return json(env, request, 200, { ok: true, ...result });
    } catch (error) {
        return json(env, request, 400, { ok: false, error: error?.message || 'Notification send failed' });
    }
}

async function handleAlertImpressionAdmin(request, env) {
    const auth = await requireAdmin(request, env);
    if (auth.error) return json(env, request, auth.status, { ok: false, error: auth.error });
    let body;
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { ok: false, error: 'Invalid JSON' });
    }
    const notices = (Array.isArray(body.notices) ? body.notices.slice(0, 50) : [])
        .filter((item) => isValidImpressionScope(item?.scope) && isValidImpressionNoticeId(item?.noticeId));
    const rtdb = createRtdbClient(env);
    const rows = await Promise.all(notices.map(async (item) => {
        const scope = String(item.scope);
        const noticeId = String(item.noticeId);
        const node = (await rtdb.get(`notice_impressions/${scope}/${noticeId}`)).value;
        return { scope, noticeId, count: Math.max(0, Number(node?.count) || 0) };
    }));
    return json(env, request, 200, { ok: true, notices: rows });
}

async function handleScheduledAlertsAdmin(request, env) {
    const auth = await requireAdmin(request, env);
    if (auth.error) return json(env, request, auth.status, { ok: false, error: auth.error });
    const rtdb = createRtdbClient(env);
    if (request.method === 'POST') {
        const result = await runScheduledAlerts(env, { rtdb });
        return json(env, request, 200, { ok: true, ...result });
    }
    const [status, schedules] = await Promise.all([
        rtdb.get('notices_scheduler_status'),
        rtdb.get('notices_scheduled'),
    ]);
    const jobs = Object.values(schedules.value || {});
    const now = Date.now();
    return json(env, request, 200, {
        ok: true,
        status: status.value || null,
        queue: {
            total: jobs.length,
            enabled: jobs.filter((job) => job?.enabled !== false).length,
            due: jobs.filter((job) => job?.enabled !== false && Number(job?.nextRunAt || 0) <= now).length,
            processing: jobs.filter((job) => Number(job?.processing?.leaseUntil || 0) > now).length,
        },
    });
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
    const isAdminPoster = ADMIN_EMAILS.has(String(user.email || '').trim().toLowerCase());
    if (!isAdminPoster && (!checkRate(`uid:${user.uid}`, windowMs, max) || !checkRate(`ip:${ip}`, windowMs, max * 2))) {
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
    if (!isSafeRtdbKey(routeId)) {
        return json(env, request, 400, { ok: false, error: 'Invalid routeId' });
    }

    const cleaned = sanitizeBody(body.body || '');
    if (!cleaned.ok && cleaned.verdict === 'block') {
        return json(env, request, 400, {
            ok: false,
            error: cleaned.error,
            blocked: true,
        });
    }
    const heldForReview = cleaned.verdict === 'review';
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
    if (!isSafeRtdbKey(postId)) {
        return json(env, request, 400, { ok: false, error: 'Invalid postId' });
    }
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
        email: String(body.email || user.email || '').slice(0, 120) || null,
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
        if (heldForReview) {
            const reportId = newId('mr');
            await rtdbWritePreferred(env, `moderation_queue/${reportId}`, {
                reportId,
                type: 'auto_hold',
                source: 'community_post',
                reason: 'mild_or_ambiguous',
                routeId,
                targetUid: user.uid,
                targetPostId: postId,
                deviceId: payload.deviceId,
                contact: payload.email,
                snippet: text,
                body: text,
                publish: { kind: 'community_post', routeId, payload },
                reportedByUid: user.uid,
                reportedByDeviceId: payload.deviceId,
                timestamp: Date.now(),
                status: 'open',
                appVersion: payload.appVersion,
            }, idToken);
            return json(env, request, 200, {
                ok: true,
                held: true,
                message: cleaned.error,
                reportId,
            });
        }
        const activity = {
            kind: 'post',
            postId,
            uid: payload.uid,
            timestamp: payload.timestamp,
        };
        if (hasFirebaseAdminEnv(env)) {
            await rtdbUpdate(env, {
                [`route_community/${routeId}/posts/${postId}`]: payload,
                [`community_activity/${routeId}/${postId}`]: activity,
            });
        } else {
            await rtdbWriteWithUserToken(env, `route_community/${routeId}/posts/${postId}`, payload, idToken);
            try {
                await rtdbWriteWithUserToken(env, `community_activity/${routeId}/${postId}`, activity, idToken);
            } catch { /* index is optional when Admin is unset */ }
        }
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
                    const updates = {
                        [`route_community/${routeId}/posts/${postId}`]: null,
                        [`community_activity/${routeId}/${postId}`]: null,
                    };
                    Object.keys(post?.replies || {}).forEach((replyId) => {
                        updates[`community_activity/${routeId}/${replyId}`] = null;
                    });
                    await rtdbUpdate(env, updates);
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
        if (request.method === 'POST' && url.pathname === '/alerts/impression') {
            return handleAlertImpression(request, env);
        }
        if (request.method === 'POST' && url.pathname === '/admin/alert-impressions') {
            try {
                return await handleAlertImpressionAdmin(request, env);
            } catch (e) {
                return json(env, request, 500, { ok: false, error: e.message || 'Impression lookup failed' });
            }
        }
        if (request.method === 'POST' && url.pathname === '/admin/notifications/send') {
            return handlePushNotificationsAdmin(request, env);
        }
        if (
            (request.method === 'GET' || request.method === 'POST')
            && url.pathname === '/admin/scheduled-alerts'
        ) {
            try {
                return await handleScheduledAlertsAdmin(request, env);
            } catch (e) {
                return json(env, request, 500, { ok: false, error: e.message || 'Scheduled alert run failed' });
            }
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

    async scheduled(event, env, ctx) {
        const cron = String(event.cron || '');
        // Always publish due alerts on every cron tick. Do not require an exact
        // `event.cron === '*/5 * * * *'` match — Cloudflare can normalize the
        // expression, and a no-op here leaves Monday 00:00 jobs sitting in the queue.
        const tasks = [
            runScheduledAlerts(env).catch((e) => console.error('Scheduled alert run failed', e)),
        ];
        const hourly = cron === TTL_CRON || cron === '0 * * * *' || /^0 \* \* \* \*$/.test(cron);
        if (hourly) {
            tasks.push(
                Promise.all([
                    wipeStalePosts(env),
                    cleanupAlertImpressionDedupe(env),
                ]).catch((e) => console.error('TTL wipe failed', e))
            );
        }
        await Promise.all(tasks);
    },
};
