/**
 * METRORAIL NEXT TRAIN - CLOUDFLARE WORKER (V1.12 - Exact regional split)
 * --------------------------------------------------------------------------
 * Path B: Secure Telemetry Bridge
 *
 * V1.9: INTRADAY drops cumulative running totals and returns raw per half-hour
 *       GA4 activeUsers (rush-hour shape). Sets intradayMode: 'perBucket'.
 * V1.10: Regional breakdown reads GA customUser:crm_region = selected app region
 *        (IP /region is only a first-visit guess for the client; defaults to GP).
 * V1.11: INTRADAY plots through the latest GA4 bucket (no 3h hide). ALL-time
 *        fills months from Jan 2026. Regional payload includes sessions + note
 *        that unique users by region are not a partition of TODAY.
 * V1.12: Regional cards come from D1. One reporting device, one selected region
 *        per Johannesburg day. GA stays the site-wide people total. Sentry
 *        status is separate from Firebase app diagnostics.
 * V1.13: The last-5-minutes tile uses a realtime minute range. One rejected
 *        GA4 query no longer blanks the other tiles.
 */

import { clipIntradayCutoff, fillYearMonthSeries } from './chart-math.js';
import { isoTodayUtc, loadCleverRange } from './clever-ads.js';
import { dispatchProductionDeploy, getDeployStatus } from './deploy-github.js';
import { sentryStatusFromResult, safeSentryDetail } from './region-presence.js';
import { handleRegionPresence, readRegionalSplit } from './region-store.js';

async function getGoogleAccessToken(clientEmail, privateKey) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    };

    const toBase64Url = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const dataToSign = `${toBase64Url(header)}.${toBase64Url(payload)}`;

    const cleanKey = privateKey
        .replace(/\\n/g, '')
        .replace(/\\r/g, '')
        .replace(/"/g, '')
        .replace(/-----BEGIN PRIVATE KEY-----/gi, '')
        .replace(/-----END PRIVATE KEY-----/gi, '')
        .replace(/\s/g, '');

    let binaryDerString;
    try {
        binaryDerString = atob(cleanKey);
    } catch (e) {
        throw new Error("Private Key Format Error: Could not decode Base64. Ensure you copied the entire key.");
    }

    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
        binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryDer.buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(dataToSign));
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    const jwt = `${dataToSign}.${encodedSignature}`;

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });

    const data = await response.json();
    if (!response.ok) throw new Error(`Google Auth Failed: ${data.error_description || data.error}`);
    return data.access_token;
}

const ADMIN_EMAILS = ['enockelk@gmail.com', 'thandeka05nxumalo@gmail.com'];

/** Verify Firebase ID token + admin allowlist. Always required for mutating admin routes. */
async function requireAdmin(request, env, { requireConfiguredKey = false } = {}) {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
        return { ok: false, status: 401, error: 'Missing or Invalid Authorization Header' };
    }
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
        return { ok: false, status: 401, error: 'Missing or Invalid Authorization Header' };
    }

    const apiKey = env.FIREBASE_WEB_API_KEY;
    if (!apiKey) {
        if (requireConfiguredKey) {
            return { ok: false, status: 500, error: 'Server misconfigured: FIREBASE_WEB_API_KEY missing' };
        }
        // Legacy telemetry path: skip verification when key unset (pre-existing behaviour).
        return { ok: true, email: null, idToken };
    }

    try {
        const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
            return { ok: false, status: 401, error: 'Unauthorized: Invalid Firebase Token' };
        }
        const user = verifyData.users[0];
        const email = String(user.email || '').toLowerCase();
        if (!email || !ADMIN_EMAILS.includes(email)) {
            return { ok: false, status: 403, error: 'Forbidden: Admin access required.' };
        }
        return { ok: true, email, idToken };
    } catch (err) {
        return { ok: false, status: 500, error: 'Auth Verification Failed', details: err.message };
    }
}

async function purgeCloudflareZoneEverything(env) {
    const zoneId = env.CF_ZONE_ID;
    const token = env.CF_API_TOKEN;
    if (!zoneId || !token) {
        return {
            ok: false,
            status: 500,
            body: {
                error: 'Server misconfigured: set CF_ZONE_ID and CF_API_TOKEN (Zone.Cache Purge) on this Worker',
            },
        };
    }

    const cfRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ purge_everything: true }),
    });
    const cfData = await cfRes.json().catch(() => ({}));
    if (!cfRes.ok || cfData.success === false) {
        return {
            ok: false,
            status: cfRes.status === 401 || cfRes.status === 403 ? 502 : 502,
            body: {
                error: 'Cloudflare purge failed',
                details: cfData.errors || cfData,
            },
        };
    }
    return {
        ok: true,
        status: 200,
        body: {
            success: true,
            message: 'Cloudflare zone cache purge requested (same as dashboard Purge Everything)',
            zoneId,
            result: cfData.result || null,
        },
    };
}

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const json = (status, body) => new Response(JSON.stringify(body), {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

        // First-visit soft guess only — client persists as selected region (GP fallback).
        if (url.pathname === '/region' && request.method === 'GET') {
            // Cloudflare SA province codes → Next Train product regions
            const PROVINCE_TO_PRODUCT = {
                GT: 'GP', GP: 'GP',
                WC: 'WC',
                KZN: 'KZN', NL: 'KZN',
                EC: 'EC',
            };
            let region = 'GP';
            const prov = String(request.cf?.regionCode || '').toUpperCase();
            if (prov && PROVINCE_TO_PRODUCT[prov]) {
                region = PROVINCE_TO_PRODUCT[prov];
            }
            // Non-rail SA provinces + foreign / missing → GP (product default)
            return new Response(JSON.stringify({ region, source: prov ? 'cf' : 'default' }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // Public selected-region beacon. CORS is limited to Next Train origins.
        // The response never echoes the device id. The stored key is a hash.
        if (url.pathname === '/region-presence' && (request.method === 'POST' || request.method === 'OPTIONS')) {
            return handleRegionPresence(request, env);
        }

        // One Johannesburg day of the exact device split. Admin day paging uses this
        // so a previous day does not refetch the whole analytics payload.
        if (request.method === 'GET' && url.pathname === '/admin/region-split') {
            const auth = await requireAdmin(request, env, { requireConfiguredKey: false });
            if (!auth.ok) {
                return json(auth.status, { error: auth.error, details: auth.details || null });
            }
            try {
                const split = await readRegionalSplit(env.REGION_PRESENCE_DB, Date.now(), url.searchParams.get('day') || '');
                return json(200, {
                    ...split,
                    metric: 'reportingDevices',
                    source: 'selected-region',
                });
            } catch (e) {
                return json(200, {
                    GP: 0, WC: 0, KZN: 0, EC: 0,
                    reportingDevices: 0,
                    metric: 'reportingDevices',
                    source: 'selected-region',
                    exact: false,
                    status: 'error',
                    day: url.searchParams.get('day') || null,
                    detail: String(e?.message || e).slice(0, 180),
                });
            }
        }

        // Admin: start production publish (GitHub workflow_dispatch). Token never
        // leaves this Worker. Live host push still uses repo secret METRORAIL_APP_DEPLOY_TOKEN.
        if (request.method === 'POST' && url.pathname === '/admin/deploy-production') {
            const auth = await requireAdmin(request, env, { requireConfiguredKey: true });
            if (!auth.ok) {
                return json(auth.status, { error: auth.error, details: auth.details || null });
            }
            let body = {};
            try { body = await request.json(); } catch { body = {}; }
            if (String(body.confirm || '') !== 'DEPLOY') {
                return json(400, { error: 'Refusing to deploy. Body confirm must be exactly DEPLOY' });
            }
            const result = await dispatchProductionDeploy(env, {
                dryRun: body.dryRun === true || body.dry_run === true || body.dryRun === 'true',
                triggeredBy: auth.email,
            });
            return json(result.status || (result.ok ? 200 : 502), {
                ...result,
                triggeredBy: auth.email,
                at: Date.now(),
            });
        }

        if (request.method === 'GET' && url.pathname === '/admin/deploy-status') {
            const auth = await requireAdmin(request, env, { requireConfiguredKey: true });
            if (!auth.ok) {
                return json(auth.status, { error: auth.error, details: auth.details || null });
            }
            const runId = url.searchParams.get('run_id') || url.searchParams.get('runId');
            const sinceRaw = url.searchParams.get('since');
            const sinceMs = sinceRaw ? Number(sinceRaw) : null;
            const result = await getDeployStatus(env, {
                runId: runId || null,
                sinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
            });
            return json(result.status || (result.ok ? 200 : 502), {
                ...result,
                triggeredBy: auth.email,
                at: Date.now(),
            });
        }

        // Admin: Cloudflare zone "Purge Everything" (dashboard equivalent).
        // Intentionally NOT wired to legacy /admin/purge — those call sites fire on
        // routine notice/alert edits and must not wipe the whole CDN.
        if (request.method === 'POST' && url.pathname === '/admin/purge-cloudflare-cache') {
            const auth = await requireAdmin(request, env, { requireConfiguredKey: true });
            if (!auth.ok) {
                return json(auth.status, { error: auth.error, details: auth.details || null });
            }
            const purged = await purgeCloudflareZoneEverything(env);
            return json(purged.status, {
                ...purged.body,
                triggeredBy: auth.email,
                at: Date.now(),
            });
        }

        // Ad revenue. The Clever script id is CLEVER_SCRIPT_ID on this Worker.
        // A search longer than 3 months is stitched here. The phone never sees the token.
        if (request.method === 'GET' && url.pathname === '/admin/ads') {
            const auth = await requireAdmin(request, env, { requireConfiguredKey: true });
            if (!auth.ok) {
                return json(auth.status, { error: auth.error, details: auth.details || null });
            }
            const scriptId = String(env.CLEVER_SCRIPT_ID || '').trim();
            if (!scriptId) {
                return json(503, { error: 'Ad stats are not configured' });
            }
            const end = url.searchParams.get('end') || isoTodayUtc();
            const start = url.searchParams.get('start') || `${end.slice(0, 8)}01`;
            try {
                const stats = await loadCleverRange(scriptId, start, end);
                return json(200, stats);
            } catch (e) {
                return json(e.status || 502, { error: String(e.message || 'Could not load ad stats').slice(0, 180) });
            }
        }

        // Legacy admin clients POST here after notice/alert edits. Clear this
        // Worker's short-lived telemetry Cache API entry only (no zone purge).
        if (request.method === 'POST' && url.pathname === '/admin/purge') {
            const auth = await requireAdmin(request, env, { requireConfiguredKey: true });
            if (!auth.ok) {
                return json(auth.status, { error: auth.error, details: auth.details || null });
            }
            try {
                const cache = caches.default;
                await cache.delete(new Request('https://nexttrain-internal-cache.local/telemetry'));
            } catch { /* ignore */ }
            return json(200, {
                success: true,
                message: 'Telemetry worker cache cleared (zone CDN untouched)',
                triggeredBy: auth.email,
                at: Date.now(),
            });
        }

        if (request.method !== 'GET') {
            return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
        }

        const authHeader = request.headers.get('Authorization');

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            if (url.pathname.includes('/telemetry')) {
                return new Response(JSON.stringify({ error: 'Missing or Invalid Authorization Header' }), {
                    status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return fetch(request);
            }
        }

        const auth = await requireAdmin(request, env, { requireConfiguredKey: false });
        if (!auth.ok) {
            return json(auth.status, { error: auth.error, details: auth.details || null });
        }

        let telemetryData = {
            active5m: '--',
            active30m: '--',
            todayUsers: '--',
            todaySessions: '--',
            wauUsers: '--',
            mauUsers: '--',
            allTimeUsers: '--',
            todayErrors: '--',
            sentryStatus: 'unconfigured',
            sentryErrorDetail: null,
            cleverRevenue: '--',
            cleverHits: '--',
            sevenDayTrend: [0, 0, 0, 0, 0, 0, 0],
            chartData: [],
            chartLabels: [],
            regionalBreakdown: {
                GP: 0, WC: 0, KZN: 0, EC: 0,
                reportingDevices: 0,
                gaPeopleToday: null,
                metric: 'reportingDevices',
                source: 'selected-region',
                exact: false,
                status: 'error',
                day: null,
                detail: 'Regional split did not finish',
            },
            intradayMode: null,
            intradayAsOf: null,
        };

        const cache = caches.default;
        const cacheKey = new Request(`https://nexttrain-internal-cache.local/telemetry${url.search}`);
        let cachedResponse = await cache.match(cacheKey);

        if (cachedResponse) {
            const cachedText = await cachedResponse.text();
            let cachedGaFailed = false;
            try {
                const cachedJson = JSON.parse(cachedText);
                cachedGaFailed = cachedJson?.todayUsers === 'ERR' || cachedJson?.active30m === 'ERR' || !!cachedJson?.gaErrorDetail;
            } catch { cachedGaFailed = false; }
            if (!cachedGaFailed) {
                return new Response(cachedText, {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache-Status': 'HIT' }
                });
            }
        }

        const telemetryTasks = [];

        telemetryTasks.push((async () => {
            try {
                const split = await readRegionalSplit(env.REGION_PRESENCE_DB);
                telemetryData.regionalBreakdown = {
                    ...telemetryData.regionalBreakdown,
                    ...split,
                    metric: 'reportingDevices',
                    source: 'selected-region',
                };
            } catch (e) {
                telemetryData.regionalBreakdown.status = 'error';
                telemetryData.regionalBreakdown.exact = false;
                telemetryData.regionalBreakdown.detail = String(e?.message || e).slice(0, 180);
            }
        })());

        if (env.GA_PROPERTY_ID && env.GA_CLIENT_EMAIL && env.GA_PRIVATE_KEY) {
            telemetryTasks.push((async () => {
                try {
                    const token = await getGoogleAccessToken(env.GA_CLIENT_EMAIL, env.GA_PRIVATE_KEY);
                    const gaHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

                    const range = url.searchParams.get('range') || 'DAU';
                    let trendDimensions = [{ name: "date" }];
                    let trendOrderBys = [{ dimension: { dimensionName: "date" } }];
                    // 14daysAgo through today is 15 points: 14 finished days plus today.
                    // Stats compare the last 7 finished days with the 7 before them.
                    let trendStartDate = "14daysAgo";
                    let trendEndDate = "today";

                    if (range === 'INTRADAY') {
                        trendDimensions = [{ name: "date" }, { name: "hour" }, { name: "minute" }];
                        trendOrderBys = [
                            { dimension: { dimensionName: "date" } },
                            { dimension: { dimensionName: "hour" } },
                            { dimension: { dimensionName: "minute" } }
                        ];
                        trendStartDate = "yesterday";
                        trendEndDate = "today";
                    } else if (range === 'WAU') {
                        trendDimensions = [{ name: "isoYearIsoWeek" }];
                        trendOrderBys = [{ dimension: { dimensionName: "isoYearIsoWeek" } }];
                        trendStartDate = "97daysAgo";
                    } else if (range === 'MAU') {
                        trendDimensions = [{ name: "yearMonth" }];
                        trendOrderBys = [{ dimension: { dimensionName: "yearMonth" } }];
                        trendStartDate = "426daysAgo";
                    } else if (range === 'ALL') {
                        trendDimensions = [{ name: "yearMonth" }];
                        trendOrderBys = [{ dimension: { dimensionName: "yearMonth" } }];
                        trendStartDate = "2026-01-01";
                    }

                    const gaProperty = `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}`;
                    const gaCalls = [
                        { name: '30m', url: `${gaProperty}:runRealtimeReport`, body: { metrics: [{ name: "activeUsers" }] } },
                        {
                            name: '5m',
                            url: `${gaProperty}:runRealtimeReport`,
                            body: {
                                metrics: [{ name: "activeUsers" }],
                                minuteRanges: [{ startMinutesAgo: 4, endMinutesAgo: 0 }],
                            },
                        },
                        {
                            name: 'today',
                            url: `${gaProperty}:runReport`,
                            body: {
                                dateRanges: [{ startDate: "today", endDate: "today" }],
                                metrics: [{ name: "activeUsers" }, { name: "sessions" }],
                            },
                        },
                        { name: 'wau', url: `${gaProperty}:runReport`, body: { dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] } },
                        { name: 'mau', url: `${gaProperty}:runReport`, body: { dateRanges: [{ startDate: "28daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] } },
                        { name: 'all', url: `${gaProperty}:runReport`, body: { dateRanges: [{ startDate: "2026-01-01", endDate: "today" }], metrics: [{ name: "activeUsers" }] } },
                        {
                            name: 'trend',
                            url: `${gaProperty}:runReport`,
                            body: {
                                dateRanges: [{ startDate: trendStartDate, endDate: trendEndDate }],
                                dimensions: trendDimensions,
                                metrics: [{ name: "activeUsers" }],
                                orderBys: trendOrderBys,
                            },
                        },
                    ];

                    const gaParts = await Promise.all(gaCalls.map(async (call) => {
                        try {
                            const res = await fetch(call.url, {
                                method: 'POST',
                                headers: gaHeaders,
                                body: JSON.stringify(call.body),
                            });
                            const text = await res.text();
                            let json = null;
                            try { json = text ? JSON.parse(text) : null; } catch { json = null; }
                            if (!res.ok) {
                                const msg = json?.error?.message || text.replace(/\s+/g, ' ').slice(0, 180);
                                return { name: call.name, ok: false, error: msg, json: null };
                            }
                            return { name: call.name, ok: true, error: '', json };
                        } catch (err) {
                            return { name: call.name, ok: false, error: String(err?.message || err).slice(0, 180), json: null };
                        }
                    }));

                    const gaByName = Object.fromEntries(gaParts.map((part) => [part.name, part]));
                    const metricAt = (part, index = 0) => {
                        if (!part?.ok) return 'ERR';
                        const n = parseInt(part.json?.rows?.[0]?.metricValues?.[index]?.value, 10);
                        return String(Number.isFinite(n) ? n : 0);
                    };
                    const failures = gaParts.filter((part) => !part.ok).map((part) => `${part.name}: ${part.error}`);

                    telemetryData.active30m = metricAt(gaByName['30m']);
                    telemetryData.active5m = metricAt(gaByName['5m']);
                    telemetryData.todayUsers = metricAt(gaByName.today);
                    telemetryData.todaySessions = gaByName.today?.ok ? metricAt(gaByName.today, 1) : 'ERR';
                    telemetryData.wauUsers = metricAt(gaByName.wau);
                    telemetryData.mauUsers = metricAt(gaByName.mau);
                    telemetryData.allTimeUsers = metricAt(gaByName.all);
                    if (failures.length) telemetryData.gaErrorDetail = failures.join(' | ');

                    const trendData = gaByName.trend?.ok ? gaByName.trend.json : null;

                    let activeCountsArray = [];
                    let labelsArray = [];

                    if (range === 'INTRADAY') {
                        const totalBuckets = 96;
                        activeCountsArray = Array(totalBuckets).fill(0);

                        const nowUTC = Date.now();
                        const offsetSAST = 2 * 60 * 60 * 1000;
                        const dateTodaySAST = new Date(nowUTC + offsetSAST);
                        const dateYestSAST = new Date(nowUTC + offsetSAST - (24 * 60 * 60 * 1000));

                        const pad = (n) => String(n).padStart(2, '0');
                        const todayStr = `${dateTodaySAST.getUTCFullYear()}${pad(dateTodaySAST.getUTCMonth() + 1)}${pad(dateTodaySAST.getUTCDate())}`;
                        const yesterdayStr = `${dateYestSAST.getUTCFullYear()}${pad(dateYestSAST.getUTCMonth() + 1)}${pad(dateYestSAST.getUTCDate())}`;

                        let lastSeenToday = -1;
                        if (trendData?.rows) {
                            trendData.rows.forEach(row => {
                                const dStr = row.dimensionValues?.[0]?.value;
                                const h = parseInt(row.dimensionValues?.[1]?.value, 10);
                                const m = parseInt(row.dimensionValues?.[2]?.value, 10);
                                const users = parseInt(row.metricValues?.[0]?.value, 10) || 0;

                                const mBucket = Math.floor(m / 30);
                                let bucketIndex = (h * 2) + mBucket;

                                if (dStr === todayStr) {
                                    bucketIndex += 48;
                                    lastSeenToday = Math.max(lastSeenToday, bucketIndex);
                                } else if (dStr !== yesterdayStr) {
                                    return;
                                }

                                activeCountsArray[bucketIndex] += users;
                            });
                        }

                        // V1.9: keep per-bucket velocity (no cumulative running totals)

                        for (let i = 0; i < totalBuckets; i++) {
                            if ((i % 48) % 6 === 0) {
                                const h = Math.floor((i % 48) / 2).toString().padStart(2, '0');
                                labelsArray.push(`${h}:00`);
                            } else {
                                labelsArray.push("");
                            }
                        }

                        const nowHourSAST = dateTodaySAST.getUTCHours();
                        const nowMinSAST = dateTodaySAST.getUTCMinutes();
                        const cutoffBucket = clipIntradayCutoff(lastSeenToday, nowHourSAST, nowMinSAST);

                        activeCountsArray = activeCountsArray.slice(0, cutoffBucket + 1);
                        labelsArray = labelsArray.slice(0, cutoffBucket + 1);
                        telemetryData.intradayMode = 'perBucket';
                        const todayIdx = Math.max(0, cutoffBucket - 48);
                        const asH = Math.floor(todayIdx / 2);
                        const asM = (todayIdx % 2) * 30;
                        telemetryData.intradayAsOf = `${pad(asH)}:${pad(asM)}`;

                    } else if (range === 'ALL') {
                        const rowMap = new Map();
                        if (trendData?.rows) {
                            trendData.rows.forEach((row) => {
                                const key = String(row.dimensionValues?.[0]?.value || '');
                                const users = parseInt(row.metricValues?.[0]?.value, 10) || 0;
                                if (key) rowMap.set(key, (rowMap.get(key) || 0) + users);
                            });
                        }
                        const sastNow = new Date(Date.now() + (2 * 60 * 60 * 1000));
                        const endKey = `${sastNow.getUTCFullYear()}${String(sastNow.getUTCMonth() + 1).padStart(2, '0')}`;
                        const filled = fillYearMonthSeries(rowMap, '202601', endKey);
                        activeCountsArray = filled.counts;
                        labelsArray = filled.labels;
                    } else {
                        if (trendData?.rows) {
                            activeCountsArray = trendData.rows.map(row => parseInt(row.metricValues?.[0]?.value) || 0);
                            labelsArray = trendData.rows.map(row => row.dimensionValues?.[0]?.value || "");
                        }
                    }

                    if (range === 'DAU' || !url.searchParams.has('range')) {
                        const recent7 = activeCountsArray.slice(-7);
                        telemetryData.sevenDayTrend = [...Array(7).fill(0), ...recent7].slice(-7);
                    }

                    telemetryData.chartData = activeCountsArray;
                    telemetryData.chartLabels = labelsArray;

                } catch (e) {
                    console.error("GA4 Fetch Error:", e.message);
                    telemetryData.active5m = "ERR";
                    telemetryData.active30m = "ERR";
                    telemetryData.todayUsers = "ERR";
                    telemetryData.wauUsers = "ERR";
                    telemetryData.mauUsers = "ERR";
                    telemetryData.allTimeUsers = "ERR";
                    telemetryData.gaErrorDetail = e.message;
                }
            })());
        }

        if (env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT) {
            telemetryTasks.push((async () => {
                try {
                    const sentryRes = await fetch(`https://sentry.io/api/0/projects/${env.SENTRY_ORG}/${env.SENTRY_PROJECT}/stats/?stat=received&resolution=1d`, {
                        headers: { 'Authorization': `Bearer ${env.SENTRY_AUTH_TOKEN}` }
                    });

                    if (!sentryRes.ok) {
                        const errText = await sentryRes.text();
                        throw new Error(`Sentry API Rejected: ${safeSentryDetail(errText)}`);
                    }

                    const sentryData = await sentryRes.json();
                    const lastDataPoint = Array.isArray(sentryData) && sentryData.length > 0
                        ? sentryData[sentryData.length - 1]
                        : null;
                    const count = parseInt(lastDataPoint?.[1], 10) || 0;
                    Object.assign(telemetryData, sentryStatusFromResult({ configured: true, ok: true, count }));
                } catch (e) {
                    console.error("Sentry Fetch Error:", e.message);
                    Object.assign(telemetryData, sentryStatusFromResult({
                        configured: true,
                        ok: false,
                        detail: e.message,
                    }));
                }
            })());
        } else {
            Object.assign(telemetryData, sentryStatusFromResult({ configured: false }));
        }

        await Promise.allSettled(telemetryTasks);

        const gaPeople = parseInt(telemetryData.todayUsers, 10);
        telemetryData.regionalBreakdown.gaPeopleToday = Number.isFinite(gaPeople) ? gaPeople : null;

        if (telemetryData.gaErrorDetail) {
            telemetryData.gaErrorDetail = String(telemetryData.gaErrorDetail).replace(/\s+/g, ' ').slice(0, 500);
        }
        const gaFailed = telemetryData.todayUsers === 'ERR' || telemetryData.active30m === 'ERR' || !!telemetryData.gaErrorDetail;
        const finalResponsePayload = JSON.stringify(telemetryData);

        if (!gaFailed) {
            const responseToCache = new Response(finalResponsePayload, {
                headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=120' }
            });
            await cache.put(cacheKey, responseToCache.clone());
        }

        return new Response(finalResponsePayload, {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache-Status': gaFailed ? 'BYPASS' : 'MISS' }
        });
    }
};
