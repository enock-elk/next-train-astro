/**
 * METRORAIL NEXT TRAIN - CLOUDFLARE WORKER (V1.9 - Per-bucket INTRADAY)
 * --------------------------------------------------------------------------
 * Path B: Secure Telemetry Bridge
 *
 * V1.9: INTRADAY drops cumulative running totals and returns raw per half-hour
 *       GA4 activeUsers (rush-hour shape). Sets intradayMode: 'perBucket'.
 */

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

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);

        if (url.pathname === '/region' && request.method === 'GET') {
            let region = 'GP';
            if (request.cf && request.cf.regionCode) {
                const prov = request.cf.regionCode.toUpperCase();
                if (prov === 'WC') region = 'WC';
                else if (prov === 'KZN' || prov === 'NL') region = 'KZN';
                else if (prov === 'EC') region = 'EC';
            }
            return new Response(JSON.stringify({ region }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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

        const idToken = authHeader.split('Bearer ')[1];

        if (env.FIREBASE_WEB_API_KEY) {
            try {
                const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken: idToken })
                });

                const verifyData = await verifyRes.json();

                if (!verifyRes.ok || !verifyData.users || verifyData.users.length === 0) {
                    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Firebase Token' }), {
                        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const user = verifyData.users[0];
                const adminEmails = ['enockelk@gmail.com', 'thandeka05nxumalo@gmail.com'];
                if (!user.email || !adminEmails.includes(user.email.toLowerCase())) {
                    return new Response(JSON.stringify({ error: 'Forbidden: Admin access required.' }), {
                        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            } catch (err) {
                return new Response(JSON.stringify({ error: 'Auth Verification Failed', details: err.message }), {
                    status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        let telemetryData = {
            active5m: '--',
            active30m: '--',
            todayUsers: '--',
            wauUsers: '--',
            mauUsers: '--',
            allTimeUsers: '--',
            todayErrors: '--',
            cleverRevenue: '--',
            cleverHits: '--',
            sevenDayTrend: [0, 0, 0, 0, 0, 0, 0],
            chartData: [],
            chartLabels: [],
            regionalBreakdown: { GP: 0, WC: 0, KZN: 0, EC: 0, OTHER: 0 },
            intradayMode: null,
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
                                dateRanges: [{ startDate: "today", endDate: "today" }], metrics: [{ name: "activeUsers" }]
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
                                metrics: [{ name: "activeUsers" }]
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
                    telemetryData.wauUsers = String(parseInt(wauData?.rows?.[0]?.metricValues?.[0]?.value) || 0);
                    telemetryData.mauUsers = String(parseInt(mauData?.rows?.[0]?.metricValues?.[0]?.value) || 0);
                    telemetryData.allTimeUsers = String(parseInt(allTimeData?.rows?.[0]?.metricValues?.[0]?.value) || 0);

                    if (regionalData?.rows) {
                        regionalData.rows.forEach(row => {
                            const region = row.dimensionValues?.[0]?.value;
                            const users = parseInt(row.metricValues?.[0]?.value) || 0;
                            if (region === 'GP') telemetryData.regionalBreakdown.GP += users;
                            else if (region === 'WC') telemetryData.regionalBreakdown.WC += users;
                            else if (region === 'KZN') telemetryData.regionalBreakdown.KZN += users;
                            else if (region === 'EC') telemetryData.regionalBreakdown.EC += users;
                            else telemetryData.regionalBreakdown.OTHER += users;
                        });
                    }

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

                        // Clip GA4 processing lag (~3h) so the SVG does not invent a live tip
                        const nowHourSAST = dateTodaySAST.getUTCHours();
                        const lagBuffer = 3;
                        let cutoffHour = nowHourSAST - lagBuffer;

                        let isYesterdayCutoff = false;
                        if (cutoffHour < 0) {
                            cutoffHour = 24 + cutoffHour;
                            isYesterdayCutoff = true;
                        }

                        let cutoffBucket = (cutoffHour * 2);
                        if (!isYesterdayCutoff) {
                            cutoffBucket += 48;
                        }

                        activeCountsArray = activeCountsArray.slice(0, cutoffBucket + 1);
                        labelsArray = labelsArray.slice(0, cutoffBucket + 1);
                        telemetryData.intradayMode = 'perBucket';

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
