/**
 * METRORAIL NEXT TRAIN - CLOUDFLARE WORKER (V1.11 - Latest-available charts)
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
 */

import { classifyCrmRegion, clipIntradayCutoff, fillYearMonthSeries } from './chart-math.js';

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
            cleverRevenue: '--',
            cleverHits: '--',
            sevenDayTrend: [0, 0, 0, 0, 0, 0, 0],
            chartData: [],
            chartLabels: [],
            regionalBreakdown: {
                GP: 0, WC: 0, KZN: 0, EC: 0, OTHER: 0,
                sessions: { GP: 0, WC: 0, KZN: 0, EC: 0, OTHER: 0 },
                metric: 'users',
            },
            intradayMode: null,
            intradayAsOf: null,
        };

        const cache = caches.default;
        const cacheKey = new Request(`https://nexttrain-internal-cache.local/telemetry${url.search}`);
        let cachedResponse = await cache.match(cacheKey);

        if (cachedResponse) {
            return new Response(cachedResponse.body, {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache-Status': 'HIT' }
            });
        }

        const telemetryTasks = [];

        if (env.GA_PROPERTY_ID && env.GA_CLIENT_EMAIL && env.GA_PRIVATE_KEY) {
            telemetryTasks.push((async () => {
                try {
                    const token = await getGoogleAccessToken(env.GA_CLIENT_EMAIL, env.GA_PRIVATE_KEY);
                    const gaHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

                    const range = url.searchParams.get('range') || 'DAU';
                    let trendDimensions = [{ name: "date" }];
                    let trendOrderBys = [{ dimension: { dimensionName: "date" } }];
                    let trendStartDate = "13daysAgo";
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

                    const responses = await Promise.all([
                        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runRealtimeReport`, {
                            method: 'POST', headers: gaHeaders, body: JSON.stringify({ metrics: [{ name: "activeUsers" }] })
                        }),
                        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runRealtimeReport`, {
                            method: 'POST', headers: gaHeaders, body: JSON.stringify({
                                dimensionFilter: {
                                    filter: {
                                        fieldName: "minutesAgo",
                                        numericFilter: { operation: "LESS_THAN", value: { int64Value: "5" } }
                                    }
                                },
                                metrics: [{ name: "activeUsers" }]
                            })
                        }),
                        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runReport`, {
                            method: 'POST', headers: gaHeaders, body: JSON.stringify({
                                dateRanges: [{ startDate: "today", endDate: "today" }],
                                metrics: [{ name: "activeUsers" }, { name: "sessions" }]
                            })
                        }),
                        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runReport`, {
                            method: 'POST', headers: gaHeaders, body: JSON.stringify({
                                dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }]
                            })
                        }),
                        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runReport`, {
                            method: 'POST', headers: gaHeaders, body: JSON.stringify({
                                dateRanges: [{ startDate: "28daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }]
                            })
                        }),
                        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runReport`, {
                            method: 'POST', headers: gaHeaders, body: JSON.stringify({
                                dateRanges: [{ startDate: "2026-01-01", endDate: "today" }], metrics: [{ name: "activeUsers" }]
                            })
                        }),
                        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runReport`, {
                            method: 'POST', headers: gaHeaders, body: JSON.stringify({
                                dateRanges: [{ startDate: trendStartDate, endDate: trendEndDate }],
                                dimensions: trendDimensions,
                                metrics: [{ name: "activeUsers" }],
                                orderBys: trendOrderBys
                            })
                        }),
                        fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:runReport`, {
                            method: 'POST', headers: gaHeaders, body: JSON.stringify({
                                dateRanges: [{ startDate: "today", endDate: "today" }],
                                dimensions: [{ name: "customUser:crm_region" }],
                                metrics: [{ name: "activeUsers" }, { name: "sessions" }]
                            })
                        })
                    ]);

                    for (let i = 0; i < responses.length; i++) {
                        if (!responses[i].ok) throw new Error(`GA4 API Request [${i}] Failed: ${await responses[i].text()}`);
                    }

                    const [
                        realtime30Data, realtime5Data,
                        dailyData, wauData, mauData, allTimeData,
                        trendData, regionalData
                    ] = await Promise.all(responses.map(r => r.json()));

                    telemetryData.active30m = String(parseInt(realtime30Data?.rows?.[0]?.metricValues?.[0]?.value) || 0);
                    telemetryData.active5m = String(parseInt(realtime5Data?.rows?.[0]?.metricValues?.[0]?.value) || 0);
                    telemetryData.todayUsers = String(parseInt(dailyData?.rows?.[0]?.metricValues?.[0]?.value) || 0);
                    telemetryData.todaySessions = String(parseInt(dailyData?.rows?.[0]?.metricValues?.[1]?.value) || 0);
                    telemetryData.wauUsers = String(parseInt(wauData?.rows?.[0]?.metricValues?.[0]?.value) || 0);
                    telemetryData.mauUsers = String(parseInt(mauData?.rows?.[0]?.metricValues?.[0]?.value) || 0);
                    telemetryData.allTimeUsers = String(parseInt(allTimeData?.rows?.[0]?.metricValues?.[0]?.value) || 0);

                    if (regionalData?.rows) {
                        regionalData.rows.forEach(row => {
                            const bucket = classifyCrmRegion(row.dimensionValues?.[0]?.value);
                            const users = parseInt(row.metricValues?.[0]?.value) || 0;
                            const sessions = parseInt(row.metricValues?.[1]?.value) || 0;
                            const key = (bucket === 'UNSET' || bucket === 'OTHER') ? 'OTHER' : bucket;
                            telemetryData.regionalBreakdown[key] += users;
                            telemetryData.regionalBreakdown.sessions[key] += sessions;
                        });
                    }
                    telemetryData.regionalBreakdown.todayUsers = parseInt(telemetryData.todayUsers, 10) || 0;
                    telemetryData.regionalBreakdown.todaySessions = parseInt(telemetryData.todaySessions, 10) || 0;

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
                        throw new Error(`Sentry API Rejected: ${errText}`);
                    }

                    const sentryData = await sentryRes.json();

                    if (Array.isArray(sentryData) && sentryData.length > 0) {
                        const lastDataPoint = sentryData[sentryData.length - 1];
                        telemetryData.todayErrors = String(parseInt(lastDataPoint?.[1]) || 0);
                    } else {
                        telemetryData.todayErrors = "0";
                    }
                } catch (e) {
                    console.error("Sentry Fetch Error:", e.message);
                    telemetryData.todayErrors = "ERR";
                    telemetryData.sentryErrorDetail = e.message;
                }
            })());
        }

        telemetryTasks.push((async () => {
            try {
                const cleverRes = await fetch("https://c2p.cleverwebserver.com/dashboard/ZmI0MWI3OTc5MjkzODk2MWVlZmE2NGZiY2I=", {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
                    }
                });
                if (cleverRes.ok) {
                    const cleverHtml = await cleverRes.text();
                    const revMatch = cleverHtml.match(/Estimated Reven(?:ue)?[\s\S]{0,200}?([\d.,]+\s*USD)/i);
                    if (revMatch && revMatch[1]) {
                        telemetryData.cleverRevenue = revMatch[1].trim();
                    }
                    const hitsMatch = cleverHtml.match(/Total Hits[\s\S]{0,200}?(\d+)/i);
                    if (hitsMatch && hitsMatch[1]) {
                        telemetryData.cleverHits = hitsMatch[1].trim();
                    }
                }
            } catch (e) {
                console.error("CleverAds Fetch Error:", e.message);
            }
        })());

        await Promise.allSettled(telemetryTasks);

        const finalResponsePayload = JSON.stringify(telemetryData);

        const responseToCache = new Response(finalResponsePayload, {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=30' }
        });
        await cache.put(cacheKey, responseToCache.clone());

        return new Response(finalResponsePayload, {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache-Status': 'MISS' }
        });
    }
};
