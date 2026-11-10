/**
 * Next Train — community write bouncer, scheduled alerts, and room-depth trim
 *
 * POST /community/post
 *   Authorization: Bearer <Firebase ID token>
 *   Body: { routeId, body, displayName?, photoURL?, deviceId?, category?, replyTo?, postId? }
 *
 * Cron (every 5 minutes): publish due scheduled alerts.
 * The phone listens to the newest 80 messages. Community Monitor pages the full log, so the hourly job does not delete messages.
 * POST /community/message  { op:'delete', routeId, postId, replyId?, mode:'tombstone'|'purge', as?:'author'|'admin' }
 *
 * Secrets: FIREBASE_PRIVATE_KEY (PEM; \n escaped OK)
 * Vars: FIREBASE_WEB_API_KEY, FIREBASE_DATABASE_URL, FIREBASE_CLIENT_EMAIL, …
 */
import {
    classifyScamContent,
    classifyUnsafeLanguage,
    findDisallowedUrls,
} from '../../src/lib/content-safety-core.js';
import { sanitizeCommunityPhotoUrl } from '../../src/lib/community-photo.js';
import {
    COMMUNITY_ADMIN_BODY_MAX,
    COMMUNITY_BUCKET_DEPTH,
    communityTombstonePatch,
    sanitizeCommunityAttachments,
    sanitizeCommunityLinkUrl,
} from '../../src/lib/community-policy.js';
import { jpegThumbnail } from './jpeg-thumb.js';

const BODY_MAX = 280;
const ADMIN_EMAILS = new Set(['enockelk@gmail.com', 'thandeka05nxumalo@gmail.com']);
const JOHANNESBURG_OFFSET_MS = 2 * 60 * 60 * 1000;
const ALERT_CRON = '*/5 * * * *';
const DEFAULT_CLAIM_LEASE_MS = 2 * 60 * 1000;

/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

function isSafeRtdbKey(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[.#$[\]/]/.test(value);
}

export function corsOriginAllowed(origin, env) {
    if (!origin) return true;
    const allowed = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (allowed.includes('*') || allowed.includes(origin)) return true;
    try {
        const host = new URL(origin).hostname.toLowerCase();
        if (host === 'lab.nexttrain.co.za') return true;
        if (host.endsWith('.next-train-lab.pages.dev')) return true;
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
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Cron-Secret',
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

/** Operators may post links. Severe language and scam packs still block. */
export function sanitizeAdminBody(raw) {
    const text = stripHtml(raw);
    const scam = classifyScamContent(text);
    if (scam.block.length) {
        return { ok: false, verdict: 'block', error: "Couldn't post that." };
    }
    const safety = classifyUnsafeLanguage(text);
    if (safety.block.length) {
        return { ok: false, verdict: 'block', error: 'That language isn’t allowed. Please rewrite without swearing or slurs.' };
    }
    const clipped = text.length > COMMUNITY_ADMIN_BODY_MAX ? text.slice(0, COMMUNITY_ADMIN_BODY_MAX) : text;
    return { ok: true, verdict: 'allow', text: clipped.trim() };
}

/** A quote is a snapshot. Keep a link that was already on the message. Drop a forged slur. */
function quoteSnapshot(raw) {
    const text = stripHtml(String(raw || '')).slice(0, 120);
    if (classifyUnsafeLanguage(text).block.length) return '';
    return text.trim();
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
    return rtdbQuery(env, path);
}

async function rtdbQuery(env, path, params = {}) {
    const email = env.FIREBASE_CLIENT_EMAIL;
    const key = env.FIREBASE_PRIVATE_KEY;
    const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    if (!email || !key || !base) throw new Error('Firebase Admin env incomplete');
    const token = await getGoogleAccessToken(email, key);
    const url = new URL(rtdbJsonUrl(base, path, token));
    Object.entries(params || {}).forEach(([name, value]) => {
        if (value != null && value !== '') url.searchParams.set(name, String(value));
    });
    const res = await fetch(url.toString());
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

function noticeLooksLikeRecord(value) {
    const poll = value?.poll;
    return !!(value && typeof value === 'object' && (
        value.message || value.text || value.severity || value.imageUrls || value.imageUrl
        || (poll && typeof poll === 'object' && (poll.active || poll.question || poll.optionA || poll.optionB))
    ));
}

function listNotices(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.filter((item) => item && typeof item === 'object');
    const children = Object.entries(node)
        .filter(([key, value]) => key !== 'reactions' && noticeLooksLikeRecord(value))
        .map(([key, value]) => ({ ...value, id: value.id || key }));
    if (children.length) return children;
    return (node.message || node.text || node.id || node.imageUrls || node.imageUrl || noticeLooksLikeRecord(node)) ? [node] : [];
}

function scheduledPollClosesAt(runAt, job, expiresAt) {
    const poll = job?.notice?.poll;
    if (!poll || poll.active === false) return 0;
    const exp = Number(expiresAt) || 0;
    const closesInMs = Number(poll.closesInMs);
    if (Number.isFinite(closesInMs) && closesInMs > 0) {
        const until = Number(runAt) + closesInMs;
        return exp > 0 && until > exp ? exp : until;
    }
    const explicit = Number(poll.closesAt);
    if (Number.isFinite(explicit) && explicit > 0) {
        return exp > 0 && explicit > exp ? exp : explicit;
    }
    return exp;
}

async function writePollVoteMeta(rtdb, payload) {
    if (!payload?.id || !payload.poll || payload.poll.active === false) return;
    const closesAt = Number(payload.poll.closesAt) || Number(payload.expiresAt) || 0;
    const allowMultiple = !!payload.poll.allowMultiple;
    if (!closesAt && !allowMultiple) return;
    const meta = {};
    if (closesAt) meta.closesAt = closesAt;
    if (allowMultiple) meta.allowMultiple = true;
    await rtdb.put(`polls/${payload.id}/_meta`, meta);
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
    if (notice.poll && typeof notice.poll === 'object') {
        notice.poll = { ...notice.poll };
        delete notice.poll.closesInMs;
    }
    const expiresAt = scheduledAlertExpiresAt(plan.occurrenceAt, job);
    const payload = {
        ...notice,
        id: noticeId,
        postedAt: plan.occurrenceAt,
        expiresAt,
    };
    if (payload.poll && payload.poll.active) {
        const closesAt = scheduledPollClosesAt(plan.occurrenceAt, job, expiresAt);
        if (closesAt) payload.poll.closesAt = closesAt;
    }
    const failures = [];
    for (const target of targets) {
        try {
            await publishScheduledNotice(rtdb, target, payload, now);
        } catch (error) {
            failures.push({ target, error: error?.message || 'Publish failed' });
        }
    }
    if (!failures.length && payload.poll && payload.poll.active) {
        try {
            await writePollVoteMeta(rtdb, payload);
        } catch (error) {
            failures.push({ target: 'polls', error: error?.message || 'Poll meta failed' });
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

function cronSecret(env) {
    return String(env?.ALERT_CRON_SECRET || env?.TTL_WIPE_SECRET || env?.CRON_SECRET || '').trim();
}

function cronSecretOk(request, env) {
    const expected = cronSecret(env);
    if (!expected) return false;
    const header = String(request.headers.get('X-Cron-Secret') || '').trim();
    return header.length > 0 && header === expected;
}

const GITHUB_ACTIONS_OIDC_ISS = 'https://token.actions.githubusercontent.com';
const GITHUB_ACTIONS_OIDC_AUD = 'nexttrain-community';
const GITHUB_ACTIONS_OIDC_REPO = 'enock-elk/next-train-astro';
const GITHUB_ACTIONS_OIDC_WORKFLOW = 'enock-elk/next-train-astro/.github/workflows/scheduled-alerts.yml';

function decodeJwtPart(part) {
    const pad = '='.repeat((4 - (part.length % 4)) % 4);
    const b64 = `${part}${pad}`.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
}

function jwtSignatureBytes(part) {
    const pad = '='.repeat((4 - (part.length % 4)) % 4);
    const b64 = `${part}${pad}`.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export async function verifyGithubActionsOidc(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Invalid OIDC token');
    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    if (header.alg !== 'RS256') throw new Error('OIDC alg must be RS256');
    const now = Math.floor(Date.now() / 1000);
    if (Number(payload.exp || 0) <= now) throw new Error('OIDC token expired');
    if (Number(payload.nbf || 0) > now + 30) throw new Error('OIDC token not yet valid');
    if (payload.iss !== GITHUB_ACTIONS_OIDC_ISS) throw new Error('OIDC issuer mismatch');
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(GITHUB_ACTIONS_OIDC_AUD)) throw new Error('OIDC audience mismatch');
    if (payload.repository !== GITHUB_ACTIONS_OIDC_REPO) throw new Error('OIDC repository mismatch');
    const workflow = String(payload.job_workflow_ref || payload.workflow_ref || '');
    if (!workflow.startsWith(`${GITHUB_ACTIONS_OIDC_WORKFLOW}@`)) throw new Error('OIDC workflow mismatch');
    const jwksRes = await fetch(`${GITHUB_ACTIONS_OIDC_ISS}/.well-known/jwks`);
    if (!jwksRes.ok) throw new Error('OIDC JWKS unavailable');
    const jwks = await jwksRes.json();
    const jwk = (jwks.keys || []).find((key) => key.kid === header.kid);
    if (!jwk) throw new Error('OIDC key not found');
    const cryptoKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
    );
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, jwtSignatureBytes(parts[2]), data);
    if (!ok) throw new Error('OIDC signature mismatch');
    return payload;
}

async function githubActionsOidcOk(request) {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return false;
    try {
        await verifyGithubActionsOidc(auth.slice(7).trim());
        return true;
    } catch (error) {
        console.warn('GitHub Actions OIDC rejected', error?.message || error);
        return false;
    }
}

async function cronAuthorized(request, env) {
    if (cronSecretOk(request, env)) return true;
    return githubActionsOidcOk(request);
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
const PUSH_CATEGORIES = new Set(['incidents', 'delays', 'community', 'nearby', 'feedback']);
const PUSH_ICON_URL = 'https://nexttrain.co.za/icons/notification-icon.png';
const PUSH_BADGE_URL = 'https://nexttrain.co.za/icons/notification-badge.png';
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

function subscriptionIdList(subscription, field) {
    const raw = subscription?.[field];
    if (Array.isArray(raw)) return raw.map(String);
    return Object.values(raw || {}).map(String);
}

export function subscriptionAllowsCategory(subscription, category) {
    const key = PUSH_CATEGORIES.has(category) ? category : 'incidents';
    const cats = subscription?.categories;
    if (!cats || typeof cats !== 'object') return key === 'incidents' || key === 'delays';
    return cats[key] === true;
}

export function normalizePushRequest(raw = {}) {
    const title = pushText(raw.title, 80);
    const body = pushText(raw.body, 180);
    if (!title) throw new Error('Notification title is required');
    if (!body) throw new Error('Notification message is required');
    const audience = ['all', 'region', 'route', 'pinned', 'user'].includes(raw.audience) ? raw.audience : 'all';
    const target = String(raw.target || '').trim();
    if (audience === 'region' && !PUSH_REGIONS.has(target)) throw new Error('Choose a valid region');
    if ((audience === 'route' || audience === 'pinned') && !isSafeRtdbKey(target)) throw new Error('Choose a valid route');
    if (audience === 'user' && !isSafeRtdbKey(target)) throw new Error('Choose a valid user');
    const category = PUSH_CATEGORIES.has(raw.category) ? raw.category : 'incidents';
    const environment = raw.environment === 'lab' ? 'lab' : 'production';
    const ttlSec = Math.min(86_400, Math.max(60, Math.round(Number(raw.ttlSec) || 3600)));
    return {
        title,
        body,
        audience,
        target: audience === 'all' ? 'all' : target,
        category,
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
    if (!subscriptionAllowsCategory(subscription, request.category || 'incidents')) return false;
    if (request.audience === 'all') return true;
    if (request.audience === 'region') return subscription.region === request.target;
    if (request.audience === 'user') {
        const target = String(request.target || '');
        return String(subscription.accountUid || '') === target || String(subscription.uid || '') === target;
    }
    if (request.audience === 'pinned') {
        return subscriptionIdList(subscription, 'pinnedRouteIds').includes(String(request.target || ''));
    }
    return subscriptionIdList(subscription, 'routeIds').includes(String(request.target || ''));
}

export function pushNotificationTag(request) {
    const category = PUSH_CATEGORIES.has(request?.category) ? request.category : 'incidents';
    return `nt-push-${category}`;
}

export function buildFcmMessage(registrationId, request, tag = pushNotificationTag(request), registrationType = 'token') {
    return {
        [registrationType === 'fid' ? 'fid' : 'token']: registrationId,
        notification: {
            title: request.title,
            body: request.body,
        },
        data: {
            audience: request.audience,
            target: request.target,
            category: request.category || 'incidents',
            environment: request.environment,
            link: request.link,
        },
        webpush: {
            headers: {
                TTL: String(request.ttlSec),
                Urgency: request.urgency,
            },
            notification: {
                icon: PUSH_ICON_URL,
                badge: PUSH_BADGE_URL,
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
                    pushNotificationTag(request),
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

const ALERT_IMAGE_MAX = 4 * 1024 * 1024;

function sniffAlertImage(bytes) {
    if (!bytes || bytes.length < 12) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: 'png', type: 'image/png' };
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { ext: 'gif', type: 'image/gif' };
    if (
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
        return { ext: 'webp', type: 'image/webp' };
    }
    return null;
}

async function handleAlertImageUpload(request, env) {
    if (!env.ALERT_IMAGES) {
        return json(env, request, 503, { ok: false, error: 'Alert image storage is not ready yet.' });
    }
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
        return json(env, request, 401, { ok: false, error: 'Missing Authorization' });
    }
    let user;
    try {
        user = await verifyIdToken(env, authHeader.slice(7).trim());
    } catch (e) {
        return json(env, request, 401, { ok: false, error: e.message || 'Unauthorized' });
    }
    if (!ADMIN_EMAILS.has(String(user.email || '').trim().toLowerCase())) {
        return json(env, request, 403, { ok: false, error: 'Operators only.' });
    }
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > ALERT_IMAGE_MAX) {
        return json(env, request, 413, { ok: false, error: 'Photo is too large. Max 4MB.' });
    }
    const buf = new Uint8Array(await request.arrayBuffer());
    if (!buf.length || buf.length > ALERT_IMAGE_MAX) {
        return json(env, request, 413, { ok: false, error: 'Photo is too large. Max 4MB.' });
    }
    const sniff = sniffAlertImage(buf);
    if (!sniff) {
        return json(env, request, 400, { ok: false, error: 'Use a JPEG, PNG, GIF, or WebP photo.' });
    }
    const file = `${newId('img')}.${sniff.ext}`;
    await env.ALERT_IMAGES.put(`alerts/${file}`, buf, {
        httpMetadata: { contentType: sniff.type },
    });
    const origin = new URL(request.url).origin;
    return json(env, request, 200, { ok: true, url: `${origin}/alerts/${file}` });
}

const PREVIEW_SITE_HOSTS = new Set([
    'nexttrain.co.za',
    'www.nexttrain.co.za',
    'lab.nexttrain.co.za',
    'enock-elk.github.io',
    'enockelk.github.io',
]);
const PREVIEW_IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const PREVIEW_SITE_PATH = /^\/images\/(?:alerts\/[A-Za-z0-9._-]+|schedules\/[a-z0-9]+\/[A-Za-z0-9._-]+\.jpe?g)$/i;

function previewHostIsPrivate(host) {
    const name = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!name || name === 'localhost' || name.endsWith('.local') || name.endsWith('.internal')) return true;
    if (name === 'metadata.google.internal' || name === 'metadata.google.com') return true;
    const ip = name.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ip) return false;
    const parts = ip.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

function previewHostKind(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (PREVIEW_SITE_HOSTS.has(host) || host.endsWith('.next-train-lab.pages.dev')) return 'site';
    if (host === 'nexttrain-community.enock.workers.dev' || /^nexttrain-community\.[a-z0-9-]+\.workers\.dev$/.test(host)) return 'r2';
    return 'public';
}

function canonicalPreviewTarget(raw) {
    let url;
    try { url = new URL(String(raw || '')); } catch { return ''; }
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (url.href.length > 2000) return '';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (previewHostIsPrivate(host)) return '';
    const path = url.pathname || '';
    if (path.includes('..') || path.includes('//')) return '';
    const kind = previewHostKind(host);
    if (kind === 'site') {
        if (!PREVIEW_SITE_PATH.test(path)) return '';
        return `${url.origin}${path}`;
    }
    if (kind === 'r2') {
        if (!/^\/alerts\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(path)) return '';
        return `${url.origin}${path}`;
    }
    if (!PREVIEW_IMAGE_EXT.test(path)) return '';
    return url.href.split('#')[0];
}

function previewResponseHeaders(env, request, bytes, contentType) {
    const headers = new Headers(corsHeaders(env, request));
    headers.set('Access-Control-Expose-Headers', 'X-Nt-Bytes');
    headers.set('Cache-Control', 'public, max-age=604800');
    headers.set('X-Nt-Bytes', String(bytes > 0 ? Math.round(bytes) : 0));
    if (contentType) headers.set('Content-Type', contentType);
    return headers;
}

async function bytesForPreview(env, target) {
    const url = new URL(target);
    if (previewHostKind(url.hostname) === 'r2' && env.ALERT_IMAGES) {
        const file = url.pathname.replace(/^\/alerts\//, '');
        const obj = await env.ALERT_IMAGES.get(`alerts/${file}`);
        if (!obj) return null;
        const buf = new Uint8Array(await obj.arrayBuffer());
        if (!buf.length || buf.length > ALERT_IMAGE_MAX) return { error: 'too-large', size: obj.size || buf.length };
        return { bytes: buf, size: obj.size || buf.length, type: obj.httpMetadata?.contentType || '' };
    }
    let fullSize = 0;
    try {
        const head = await fetch(target, { method: 'HEAD', redirect: 'follow' });
        const declared = Number(head.headers.get('content-length') || 0);
        if (head.ok && declared > ALERT_IMAGE_MAX) return { error: 'too-large', size: declared };
        if (head.ok) fullSize = declared;
    } catch { /* the GET still has the picture */ }
    let buf = null;
    let type = '';
    try {
        const resized = await fetch(target, {
            redirect: 'follow',
            cf: { image: { width: 24, quality: 45, format: 'jpeg', fit: 'scale-down' } },
        });
        if (resized.ok) {
            const declared = Number(resized.headers.get('content-length') || 0);
            if (declared > ALERT_IMAGE_MAX) return { error: 'too-large', size: fullSize || declared };
            const got = new Uint8Array(await resized.arrayBuffer());
            type = resized.headers.get('content-type') || '';
            if (got.length && got.length <= 8000 && got[0] === 0xff && got[1] === 0xd8) {
                return { thumb: got, size: fullSize };
            }
            if (got.length && got.length <= ALERT_IMAGE_MAX && sniffAlertImage(got)) {
                buf = got;
                if (!fullSize) fullSize = got.length;
            }
        }
    } catch { /* image resizing is off; read the file itself */ }
    if (!buf) {
        const res = await fetch(target, { redirect: 'follow' });
        if (!res.ok) return null;
        const declared = Number(res.headers.get('content-length') || 0);
        if (declared > ALERT_IMAGE_MAX) return { error: 'too-large', size: declared };
        buf = new Uint8Array(await res.arrayBuffer());
        type = res.headers.get('content-type') || type;
        if (!fullSize) fullSize = declared || buf.length;
    }
    if (!buf.length || buf.length > ALERT_IMAGE_MAX) return { error: 'too-large', size: fullSize || buf.length };
    return { bytes: buf, size: fullSize || buf.length, type };
}

async function rememberPreview(cacheKey, response) {
    try { await caches.default.put(cacheKey, response.clone()); } catch { /* the phone still has this answer */ }
    return response;
}

async function handleMediaPreview(request, env) {
    const target = canonicalPreviewTarget(new URL(request.url).searchParams.get('u') || '');
    if (!target) return json(env, request, 400, { ok: false, error: 'That picture cannot be previewed.' });
    const cacheKey = new Request(`https://nexttrain-community.enock.workers.dev/media/preview?u=${encodeURIComponent(target)}`, { method: 'GET' });
    try {
        const hit = await caches.default.match(cacheKey);
        if (hit) return hit;
    } catch { /* a cache miss still builds the preview */ }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRate(`preview:${ip}`, 60_000, 80)) {
        return json(env, request, 429, { ok: false, error: 'Slow down a moment.' });
    }
    let source;
    try {
        source = await bytesForPreview(env, target);
    } catch {
        return json(env, request, 502, { ok: false, error: 'Preview unavailable.' });
    }
    if (!source) return json(env, request, 404, { ok: false, error: 'Preview unavailable.' });
    const size = Number(source.size) || 0;
    if (source.error) {
        return rememberPreview(cacheKey, new Response(JSON.stringify({ ok: false, bytes: size }), {
            status: 200,
            headers: previewResponseHeaders(env, request, size, 'application/json; charset=utf-8'),
        }));
    }
    const thumb = source.thumb || jpegThumbnail(source.bytes);
    if (!thumb) {
        return rememberPreview(cacheKey, new Response(JSON.stringify({ ok: true, bytes: size }), {
            status: 200,
            headers: previewResponseHeaders(env, request, size, 'application/json; charset=utf-8'),
        }));
    }
    return rememberPreview(cacheKey, new Response(thumb, {
        status: 200,
        headers: previewResponseHeaders(env, request, size, 'image/jpeg'),
    }));
}

async function handleAlertImageGet(request, env, file) {
    if (!env.ALERT_IMAGES) {
        return json(env, request, 503, { ok: false, error: 'Alert image storage is not ready yet.' });
    }
    const obj = await env.ALERT_IMAGES.get(`alerts/${file}`);
    if (!obj) return json(env, request, 404, { ok: false, error: 'Not found' });
    const headers = new Headers(corsHeaders(env, request));
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return new Response(obj.body, { status: 200, headers });
}

function saCommunityDayKey(now = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Johannesburg',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(now));
    const pick = (type) => parts.find((part) => part.type === type)?.value || '';
    const key = `${pick('year')}-${pick('month')}-${pick('day')}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '1970-01-01';
}

function tierForCommunityPoints(points) {
    const n = Number(points) || 0;
    if (n >= 600) return 'platinum';
    if (n >= 250) return 'gold';
    if (n >= 80) return 'silver';
    return 'bronze';
}

/**
 * One public total. First accepted message is 5 + 2. A later message on a new
 * South African day is 2. The same event id does not add twice. A phone that
 * already published a higher total is left alone.
 */
export function communityPublicPointsNext(profile, input = {}) {
    const current = profile && typeof profile === 'object' ? profile : {};
    const eventId = String(input.eventId || '').slice(0, 80);
    const have = Number(current.points);
    const base = Number.isFinite(have) ? have : 0;
    if (eventId && current.lastCommunityPostId === eventId) {
        return { points: base, changed: false, tier: current.tier || tierForCommunityPoints(base) };
    }
    const requested = String(input.dayKey || '');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : saCommunityDayKey(input.now);
    let delta = 0;
    if (current.communityFirst !== true) delta += 5;
    if (current.communityDay !== day) delta += 2;
    const snap = Number(input.snapshotPoints);
    const fromSnap = Number.isFinite(snap) ? snap + delta : base + delta;
    const points = Math.max(0, Math.min(100000, Math.max(base, fromSnap)));
    return {
        points,
        changed: true,
        tier: tierForCommunityPoints(points),
        communityFirst: true,
        communityDay: day,
        lastCommunityPostId: eventId,
    };
}

async function applyCommunityPublicPoints(env, { uid, eventId, snapshotPoints, dayKey }) {
    if (!uid || !isSafeRtdbKey(uid) || !hasFirebaseAdminEnv(env)) return null;
    const profile = await rtdbGet(env, `public_profile/${uid}`);
    const next = communityPublicPointsNext(profile, { eventId, snapshotPoints, dayKey });
    if (!next.changed) return next.points;
    const updates = {
        [`public_profile/${uid}/points`]: next.points,
        [`public_profile/${uid}/tier`]: next.tier,
        [`public_profile/${uid}/updatedAt`]: Date.now(),
        [`public_profile/${uid}/communityFirst`]: true,
        [`public_profile/${uid}/communityDay`]: next.communityDay,
    };
    if (next.lastCommunityPostId) {
        updates[`public_profile/${uid}/lastCommunityPostId`] = next.lastCommunityPostId;
    }
    await rtdbUpdate(env, updates);
    return next.points;
}

async function handleCommunityPoints(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
        return json(env, request, 401, { ok: false, error: 'Missing Authorization' });
    }
    let user;
    try {
        user = await verifyIdToken(env, authHeader.slice(7).trim());
    } catch (e) {
        return json(env, request, 401, { ok: false, error: e.message || 'Unauthorized' });
    }
    let body;
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { ok: false, error: 'Invalid JSON' });
    }
    const eventId = String(body.eventId || '').slice(0, 80);
    if (!isSafeRtdbKey(eventId)) {
        return json(env, request, 400, { ok: false, error: 'Invalid event' });
    }
    try {
        const points = await applyCommunityPublicPoints(env, {
            uid: user.uid,
            eventId,
            snapshotPoints: body.snapshotPoints,
            dayKey: body.dayKey,
        });
        return json(env, request, 200, { ok: true, points });
    } catch (e) {
        return json(env, request, 500, { ok: false, error: e.message || 'Points update failed' });
    }
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

    let windowMs = Number(env.RATE_WINDOW_MS || 60_000);
    let max = Number(env.RATE_MAX || 4);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const isAdminPoster = ADMIN_EMAILS.has(String(user.email || '').trim().toLowerCase());
    if (!isAdminPoster) {
        try {
            const allowance = await rtdbGet(env, `users/${user.uid}/communityAllowance`);
            const raised = Number(allowance?.max);
            if (Number.isFinite(raised) && raised > 8 && raised <= 200) {
                windowMs = 30 * 60 * 1000;
                max = Math.floor(raised);
            }
        } catch {
            /* a missing allowance keeps the short cooldown */
        }
    }
    if (!isAdminPoster && (!checkRate(`uid:${user.uid}`, windowMs, max) || !checkRate(`ip:${ip}`, windowMs, Math.max(max * 2, max)))) {
        const raisedWindow = windowMs > 120000;
        return json(env, request, 429, {
            ok: false,
            error: raisedWindow
                ? 'You have used your messages for now. Try again later.'
                : `Please wait ${Math.ceil(windowMs / 1000)} seconds before you can send another message.`,
            retryAfterMs: windowMs,
            reason: raisedWindow ? 'quota' : 'cooldown',
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

    const attachments = sanitizeCommunityAttachments(body.attachments, { admin: isAdminPoster });
    const linkUrl = isAdminPoster ? sanitizeCommunityLinkUrl(body.linkUrl) : '';
    const cleaned = isAdminPoster ? sanitizeAdminBody(body.body || '') : sanitizeBody(body.body || '');
    if (!cleaned.ok && cleaned.verdict === 'block') {
        return json(env, request, 400, {
            ok: false,
            error: cleaned.error,
            blocked: true,
        });
    }
    const heldForReview = !isAdminPoster && cleaned.verdict === 'review';
    const text = cleaned.text;
    if (text.length < 2 && !attachments.length && !linkUrl) {
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
        photoURL: sanitizeCommunityPhotoUrl(body.photoURL || user.photoURL || '') || null,
        email: String(body.email || user.email || '').slice(0, 120) || null,
        deviceId: String(body.deviceId || 'unknown').slice(0, 120),
        timestamp: Date.now(),
        hidden: false,
        replyCount: 0,
        appVersion: String(body.appVersion || '').slice(0, 40) || null,
        via: 'community_worker',
    };
    if (attachments.length) {
        payload.attachments = attachments.map((url) => ({ kind: 'image', url }));
    }
    if (linkUrl) payload.linkUrl = linkUrl;
    if (body.replyTo && typeof body.replyTo === 'object') {
        const quoteUid = String(body.replyTo.uid || '').slice(0, 80);
        payload.replyTo = {
            postId: String(body.replyTo.postId || '').slice(0, 80),
            displayName: String(body.replyTo.displayName || '').slice(0, 80),
            body: quoteSnapshot(body.replyTo.body),
        };
        if (quoteUid && isSafeRtdbKey(quoteUid)) payload.replyTo.uid = quoteUid;
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
        let publicPoints = null;
        try {
            publicPoints = await applyCommunityPublicPoints(env, {
                uid: user.uid,
                eventId: postId,
                snapshotPoints: body.snapshotPoints,
                dayKey: body.dayKey,
            });
        } catch (pointsError) {
            console.error('Community public points update failed', pointsError);
        }
        return json(env, request, 200, { ok: true, post: payload, publicPoints });
    } catch (e) {
        return json(env, request, 500, { ok: false, error: e.message || 'Write failed' });
    }
}

/**
 * Drop messages past the fixed room depth.
 * Shallow keys, then limitToLast for the kept window, then a short page of
 * older rows. This does not download every room in one response.
 * Quotes already stored on newer messages are separate fields and stay.
 */
async function trimRouteBuckets(env) {
    const shallow = await rtdbQuery(env, 'route_community', { shallow: 'true' });
    if (!shallow || typeof shallow !== 'object') return { deleted: 0 };
    let deleted = 0;
    const depth = COMMUNITY_BUCKET_DEPTH;
    for (const routeId of Object.keys(shallow)) {
        if (!isSafeRtdbKey(routeId)) continue;
        let windowPosts;
        try {
            windowPosts = await rtdbQuery(env, `route_community/${routeId}/posts`, {
                orderBy: '"timestamp"',
                limitToLast: String(depth),
            });
        } catch {
            continue;
        }
        const keptEntries = windowPosts && typeof windowPosts === 'object' ? Object.entries(windowPosts) : [];
        if (keptEntries.length < depth) continue;
        let cutoff = Infinity;
        keptEntries.forEach(([, post]) => {
            const ts = Number(post?.timestamp) || 0;
            if (ts && ts < cutoff) cutoff = ts;
        });
        if (!Number.isFinite(cutoff)) continue;
        const keptIds = new Set(keptEntries.map(([id]) => id));
        for (let page = 0; page < 4; page += 1) {
            let stale;
            try {
                stale = await rtdbQuery(env, `route_community/${routeId}/posts`, {
                    orderBy: '"timestamp"',
                    endAt: String(cutoff),
                    limitToFirst: '20',
                });
            } catch {
                break;
            }
            const rows = stale && typeof stale === 'object'
                ? Object.entries(stale).filter(([id]) => !keptIds.has(id) && isSafeRtdbKey(id))
                : [];
            if (!rows.length) break;
            const updates = {};
            rows.forEach(([postId, post]) => {
                updates[`route_community/${routeId}/posts/${postId}`] = null;
                updates[`route_community/${routeId}/post_reactions/${postId}`] = null;
                updates[`community_activity/${routeId}/${postId}`] = null;
                Object.keys(post?.replies || {}).forEach((replyId) => {
                    if (isSafeRtdbKey(replyId)) updates[`community_activity/${routeId}/${replyId}`] = null;
                });
            });
            await rtdbUpdate(env, updates);
            deleted += rows.length;
            if (rows.length < 20) break;
        }
    }
    return { deleted };
}

async function handleCommunityDelete(request, env) {
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
    let body;
    try {
        body = await request.json();
    } catch {
        return json(env, request, 400, { ok: false, error: 'Invalid JSON' });
    }
    const routeId = String(body.routeId || '').trim();
    const postId = String(body.postId || '').trim();
    const replyId = String(body.replyId || '').trim();
    const mode = body.mode === 'purge' ? 'purge' : 'tombstone';
    if (!isSafeRtdbKey(routeId) || !isSafeRtdbKey(postId) || (replyId && !isSafeRtdbKey(replyId))) {
        return json(env, request, 400, { ok: false, error: 'Invalid message.' });
    }
    const isAdmin = ADMIN_EMAILS.has(String(user.email || '').trim().toLowerCase());
    if (!isAdmin && mode === 'purge') {
        return json(env, request, 403, { ok: false, error: 'You can only delete your own message.' });
    }
    if (!isAdmin && !checkRate(`del:${user.uid}`, 60_000, 12)) {
        return json(env, request, 429, { ok: false, error: 'Please wait a moment before deleting another message.' });
    }
    const path = replyId
        ? `route_community/${routeId}/posts/${postId}/replies/${replyId}`
        : `route_community/${routeId}/posts/${postId}`;
    let current;
    try {
        current = await rtdbGet(env, path);
    } catch (e) {
        return json(env, request, 500, { ok: false, error: e.message || 'Could not read that message.' });
    }
    if (!current || typeof current !== 'object') {
        return json(env, request, 200, { ok: true, missing: true });
    }
    if (!isAdmin && String(current.uid || '') !== user.uid) {
        return json(env, request, 403, { ok: false, error: 'You can only delete your own message.' });
    }
    const actor = !isAdmin || body.as === 'author' ? 'author' : 'admin';
    try {
        if (mode === 'purge') {
            const updates = { [path]: null };
            if (replyId) {
                updates[`community_activity/${routeId}/${replyId}`] = null;
            } else {
                updates[`route_community/${routeId}/post_reactions/${postId}`] = null;
                updates[`community_activity/${routeId}/${postId}`] = null;
                Object.keys(current.replies || {}).forEach((id) => {
                    if (isSafeRtdbKey(id)) updates[`community_activity/${routeId}/${id}`] = null;
                });
            }
            await rtdbUpdate(env, updates);
            return json(env, request, 200, { ok: true, mode: 'purge' });
        }
        const patch = communityTombstonePatch(actor);
        const updates = {};
        Object.entries(patch).forEach(([key, value]) => {
            updates[`${path}/${key}`] = value;
        });
        await rtdbUpdate(env, updates);
        return json(env, request, 200, { ok: true, mode: 'tombstone', deletedBy: actor, body: patch.body });
    } catch (e) {
        return json(env, request, 500, { ok: false, error: e.message || 'Could not delete that message.' });
    }
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
        if (request.method === 'POST' && url.pathname === '/alerts/image') {
            return handleAlertImageUpload(request, env);
        }
        if (request.method === 'GET' && url.pathname === '/media/preview') {
            return handleMediaPreview(request, env);
        }
        if (request.method === 'GET') {
            const alertFile = url.pathname.match(/^\/alerts\/([A-Za-z0-9][A-Za-z0-9._-]{0,80})$/);
            if (alertFile) return handleAlertImageGet(request, env, alertFile[1]);
        }
        if (request.method === 'POST' && (url.pathname === '/community/post' || url.pathname === '/post')) {
            return handlePost(request, env);
        }
        if (request.method === 'POST' && url.pathname === '/community/points') {
            return handleCommunityPoints(request, env);
        }
        if (request.method === 'POST' && url.pathname === '/community/message') {
            return handleCommunityDelete(request, env);
        }
        if (request.method === 'POST' && url.pathname === '/admin/notifications/send') {
            return handlePushNotificationsAdmin(request, env);
        }
        if (
            (request.method === 'GET' || request.method === 'POST')
            && url.pathname === '/cron/scheduled-alerts'
        ) {
            if (!await cronAuthorized(request, env)) {
                return json(env, request, 401, { ok: false, error: 'Unauthorized' });
            }
            try {
                if (!hasFirebaseAdminEnv(env)) {
                    return json(env, request, 500, { ok: false, error: 'Firebase Admin env incomplete' });
                }
                const result = await runScheduledAlerts(env);
                return json(env, request, 200, { ok: true, via: 'http-cron', ...result });
            } catch (e) {
                return json(env, request, 500, { ok: false, error: e.message || 'Scheduled alert run failed' });
            }
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
            return json(env, request, 200, {
                ok: true,
                deleted: 0,
                kept: 'Community Monitor keeps the full log',
            });
        }
        return json(env, request, 404, { ok: false, error: 'Not found' });
    },

    async scheduled(event, env) {
        // Always publish due alerts on every cron tick. Do not require an exact
        // `event.cron === '*/5 * * * *'` match — Cloudflare can normalize the
        // expression, and a no-op here leaves Monday 00:00 jobs sitting in the queue.
        if (!hasFirebaseAdminEnv(env)) {
            console.error('Scheduled alerts skipped: FIREBASE_PRIVATE_KEY / Admin env incomplete');
            return;
        }
        await runScheduledAlerts(env).catch((e) => console.error('Scheduled alert run failed', e));
    },
};
