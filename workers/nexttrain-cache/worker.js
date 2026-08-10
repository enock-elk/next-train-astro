/**
 * METRORAIL NEXT TRAIN — CLOUDFLARE EDGE CACHE SHIELD (V2)
 * --------------------------------------------------------------------------
 * Reverse proxy for Firebase RTDB schedule JSON with edge caching.
 *
 * V2 (Astro cutover):
 *  - Origin allowlist (matches live hardened worker) so random sites cannot
 *    burn the proxy; includes GitHub Pages preview (enock-elk.github.io) and
 *    local Astro/dev hosts. Reflects ACAO to the request Origin.
 *  - Schedule paths cached 24h; dynamic paths bypass cache.
 *  - /admin/purge remains server-to-server (no browser Origin).
 *
 * Deploy: Cloudflare Worker `nexttrain-cache` → route nexttrain-cache.enock.workers.dev/*
 * Set env PURGE_SECRET. See README.md.
 */

const ALLOWED_ORIGINS = [
  'https://nexttrain.co.za',
  'https://www.nexttrain.co.za',
  // Astro / SPA GitHub Pages preview (Origin has no path)
  'https://enock-elk.github.io',
  // Local Astro / classic dev servers
  'http://localhost:4321',
  'http://127.0.0.1:4321',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function deny(message, status = 403) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Validate browser Origin for GET/OPTIONS. Purge path handles its own rules. */
function requireAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return { ok: false, response: deny('Access Denied: Missing Origin') };
  }
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return { ok: false, response: deny('Access Denied: Unauthorized Domain') };
  }
  return { ok: true, origin };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const FIREBASE_BASE_URL = 'https://metrorail-next-train-default-rtdb.firebaseio.com/';
    const PURGE_SECRET = env.PURGE_SECRET;

    // 1. CORS preflight
    if (request.method === 'OPTIONS') {
      const gate = requireAllowedOrigin(request);
      if (!gate.ok) return gate.response;
      return new Response(null, { headers: corsHeaders(gate.origin) });
    }

    // 2. Admin on-demand cache purge (server-to-server only)
    if (request.method === 'POST' && url.pathname === '/admin/purge') {
      if (request.headers.get('Origin')) {
        return deny('Browser requests forbidden', 403);
      }
      const purgeKey = request.headers.get('X-Admin-Purge-Key');
      if (purgeKey !== PURGE_SECRET) {
        return deny('Unauthorized Purge Attempt', 401);
      }

      const cache = caches.default;
      const pathsToClear = ['/schedules.json', '/full-database.json'];
      try {
        const body = await request.json();
        if (body && Array.isArray(body.paths)) {
          pathsToClear.push(...body.paths);
        } else {
          throw new Error('No paths array');
        }
      } catch {
        const saProvinces = [
          'gauteng', 'westerncape', 'kzn', 'easterncape',
          'freestate', 'mpumalanga', 'limpopo', 'northwest', 'northerncape',
        ];
        saProvinces.forEach((prov) => pathsToClear.push(`/schedules/${prov}.json`));
      }

      for (const path of pathsToClear) {
        const cleanCacheUrl = new URL(path, url.origin);
        await cache.delete(new Request(cleanCacheUrl.toString()));
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Edge Cache Detonated Successfully', clearedPaths: pathsToClear }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // All other browser traffic must come from an allowlisted Origin
    const gate = requireAllowedOrigin(request);
    if (!gate.ok) return gate.response;
    const { origin } = gate;

    const targetUrl = new URL(url.pathname + url.search, FIREBASE_BASE_URL);

    // 3. Dynamic bypass (real-time data — never cache)
    const dynamicKeywords = ['/config', '/exclusions', '/notices', '/feedback', '/telemetry'];
    const isDynamic = dynamicKeywords.some((keyword) => url.pathname.includes(keyword));

    if (isDynamic || request.method !== 'GET') {
      const proxyReq = new Request(targetUrl, request);
      const response = await fetch(proxyReq);
      const newResponse = new Response(response.body, response);
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => newResponse.headers.set(k, v));
      return newResponse;
    }

    // 4. Cache shield for heavy schedules
    const cache = caches.default;
    const cleanUrl = new URL(url.pathname, url.origin);
    const cacheKey = new Request(cleanUrl.toString());

    let response = await cache.match(cacheKey);

    if (!response) {
      const fbResponse = await fetch(targetUrl);
      if (fbResponse.ok) {
        response = new Response(fbResponse.body, fbResponse);
        Object.entries(corsHeaders(origin)).forEach(([k, v]) => response.headers.set(k, v));
        response.headers.set('Cache-Control', 'public, max-age=86400');
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      } else {
        const errorResponse = new Response(fbResponse.body, fbResponse);
        Object.entries(corsHeaders(origin)).forEach(([k, v]) => errorResponse.headers.set(k, v));
        return errorResponse;
      }
    } else {
      response = new Response(response.body, response);
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => response.headers.set(k, v));
    }

    return response;
  },
};
