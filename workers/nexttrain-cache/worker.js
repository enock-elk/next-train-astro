/**
 * METRORAIL NEXT TRAIN - CLOUDFLARE EDGE CACHE SHIELD
 * ---------------------------------------------------
 * This worker acts as a reverse proxy for the Firebase RTDB.
 * - Heavy JSON schedules are cached at the Edge for 24 hours (Saving bandwidth).
 * - Dynamic paths (Notices, Exclusions, Telemetry) bypass the cache entirely.
 * - Contains a secure Purge endpoint to instantly invalidate the cache on demand.
 *
 * Astro note: allowlist includes https://enock-elk.github.io so GitHub Pages
 * preview (admin diagnostics / Deep Network Scan) can reach the edge cache.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const FIREBASE_BASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/";
    
    // SECURITY: Secret key required to trigger an instant cache wipe from the Admin Portal
    // 🛡️ GUARDIAN PHASE 1: Hardcoded secret securely moved to Cloudflare Environment Variables
    const PURGE_SECRET = env.PURGE_SECRET;

    // ==========================================
    // 0. GUARDIAN FIREWALL: ORIGIN VALIDATION
    // ==========================================
    // Instantly terminate requests from unauthorized domains (copycats/scrapers).
    const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
    
    // Allow server-to-server requests (no Origin header) ONLY for the Purge endpoint
    if (!origin && !(request.method === 'POST' && url.pathname === '/admin/purge')) {
        return new Response(JSON.stringify({ error: "Access Denied: Missing Origin" }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // Whitelist your exact production domain, Astro GH Pages preview, and local dev ports
    if (origin) {
        const allowedOrigins = [
            'https://nexttrain.co.za',
            'https://www.nexttrain.co.za',
            // Astro / SPA GitHub Pages preview (browser Origin is host-only, no path)
            'https://enock-elk.github.io',
            'http://localhost',
            'http://127.0.0.1'
        ];
        
        const isAllowed = allowedOrigins.some(allowed => origin.startsWith(allowed));
        
        if (!isAllowed) {
            console.log(`🛡️ Guardian Firewall: Blocked unauthorized request from Origin: ${origin}`);
            return new Response(JSON.stringify({ error: "Access Denied: Unauthorized Domain" }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
    }

    // ==========================================
    // 1. CORS PREFLIGHT (OPTIONS)
    // ==========================================
    if (request.method === 'OPTIONS') {
      // 🛡️ GUARDIAN FIX: Remove POST and Purge-Key from CORS to block browser preflights
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // ==========================================
    // 2. ADMIN ON-DEMAND CACHE PURGE
    // ==========================================
    if (request.method === 'POST' && url.pathname === '/admin/purge') {
      // 🛡️ GUARDIAN FIX: Block public browser access (Server-to-Server only)
      if (request.headers.get('Origin')) {
        return new Response(JSON.stringify({ error: "Browser requests forbidden" }), { status: 403 });
      }

      const purgeKey = request.headers.get('X-Admin-Purge-Key');
      
      if (purgeKey !== PURGE_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized Purge Attempt" }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const cache = caches.default;
      
      // Target the specific heavy files we cache
      const pathsToClear = [
        '/schedules.json',             // Legacy GP Fallback
        '/full-database.json'          // Root Fallback
      ];

      // 🛡️ GUARDIAN FIX: Dynamically handle all current and future SA provinces via payload
      try {
        const body = await request.json();
        if (body && Array.isArray(body.paths)) {
          pathsToClear.push(...body.paths);
        } else { throw new Error("No paths array"); }
      } catch (e) {
        // Fallback to all 9 South African provinces if no dynamic payload is provided
        const saProvinces = ['gauteng', 'westerncape', 'kzn', 'easterncape', 'freestate', 'mpumalanga', 'limpopo', 'northwest', 'northerncape'];
        saProvinces.forEach(prov => pathsToClear.push(`/schedules/${prov}.json`));
      }

      for (const path of pathsToClear) {
        const cacheUrl = new URL(path, request.url);
        // GUARDIAN FIX: Cloudflare Cache API does not support { ignoreSearch: true }.
        // We must delete using the exact same clean URL strategy.
        const cleanCacheUrl = new URL(cacheUrl.pathname, cacheUrl.origin);
        await cache.delete(new Request(cleanCacheUrl.toString()));
      }

      // 🛡️ GUARDIAN FIX: Removed CORS headers as this is now an internal server-to-server response
      return new Response(JSON.stringify({ success: true, message: "Edge Cache Detonated Successfully", clearedPaths: pathsToClear }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ==========================================
    // 3. DYNAMIC BYPASS (REAL-TIME DATA)
    // ==========================================
    const targetUrl = new URL(url.pathname + url.search, FIREBASE_BASE_URL);
    
    // Any path containing these keywords must never be cached
    const dynamicKeywords = ['/config', '/exclusions', '/notices', '/feedback', '/telemetry'];
    const isDynamic = dynamicKeywords.some(keyword => url.pathname.includes(keyword));

    if (isDynamic || request.method !== 'GET') {
      // Pass-through exactly as requested
      const proxyReq = new Request(targetUrl, request);
      const response = await fetch(proxyReq);
      
      // Inject CORS headers before returning to the app
      const newResponse = new Response(response.body, response);
      // 🛡️ GUARDIAN FIREWALL FIX: Restrict Access-Control-Allow-Origin to the actual requesting origin instead of '*' wildcard
      const returnOrigin = origin ? origin : 'https://nexttrain.co.za'; 
      newResponse.headers.set('Access-Control-Allow-Origin', returnOrigin);
      return newResponse;
    }

    // ==========================================
    // 4. THE CACHE SHIELD (HEAVY SCHEDULES)
    // ==========================================
    const cache = caches.default;
    
    // We ignore search parameters (like ?t=12345) so Firebase timestamp busters 
    // from the legacy code don't accidentally bypass our Cloudflare cache.
    // GUARDIAN FIX: Cloudflare Cache API does not support { ignoreSearch: true }.
    // We manually strip the query string to create a clean Cache Key.
    const cleanUrl = new URL(url.pathname, url.origin);
    const cacheKey = new Request(cleanUrl.toString());
    
    let response = await cache.match(cacheKey);

    if (!response) {
      // CACHE MISS: Fetch from Firebase
      const fbResponse = await fetch(targetUrl);
      
      if (fbResponse.ok) {
        response = new Response(fbResponse.body, fbResponse);
        // 🛡️ GUARDIAN FIREWALL FIX: Restrict Access-Control-Allow-Origin
        const returnOrigin = origin ? origin : 'https://nexttrain.co.za'; 
        response.headers.set('Access-Control-Allow-Origin', returnOrigin);
        
        // Cache aggressively at the Edge for 24 hours (86400 seconds)
        // We rely on the /admin/purge endpoint to clear it early if you update the schedule.
        response.headers.set('Cache-Control', 'public, max-age=86400');
        
        // Save to Cloudflare RAM asynchronously
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      } else {
        // If Firebase fails (e.g., 404, 500), pass the error through without caching it
        const errorResponse = new Response(fbResponse.body, fbResponse);
        const returnOrigin = origin ? origin : 'https://nexttrain.co.za'; 
        errorResponse.headers.set('Access-Control-Allow-Origin', returnOrigin);
        return errorResponse;
      }
    } else {
        // CACHE HIT: Ensure CORS is still present
        response = new Response(response.body, response);
        // 🛡️ GUARDIAN FIREWALL FIX: Restrict Access-Control-Allow-Origin
        const returnOrigin = origin ? origin : 'https://nexttrain.co.za'; 
        response.headers.set('Access-Control-Allow-Origin', returnOrigin);
    }

    return response;
  }
};
