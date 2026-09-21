/**
 * nexttrain-edge — rollback only. Production routes are detached.
 *
 * Cache-Control now comes from Cloudflare Cache Rules + response header
 * transforms in zone-rules.json (zero Worker invocations). GitHub Pages
 * still sends max-age=600; the zone rules override that.
 *
 * Keep this Worker as a one-deploy rollback if the ruleset apply fails:
 * restore wrangler.jsonc routes and `npx wrangler deploy`. HTML must stay
 * off those routes. /app-version.json and /sw.js stay no-store.
 */
export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fetch(request);
    }

    const url = new URL(request.url);
    const hashed = url.pathname.startsWith('/_astro/');
    const icon = url.pathname.startsWith('/icons/');
    const versionProbe = url.pathname === '/app-version.json' || url.pathname === '/sw.js';
    if (!hashed && !icon && !versionProbe) return fetch(request);

    if (versionProbe) {
      const res = await fetch(request, {
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      headers.set('Pragma', 'no-cache');
      headers.delete('Expires');
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }

    const res = await fetch(request, {
      cf: {
        cacheEverything: true,
        cacheTtl: hashed ? 31536000 : 2592000,
      },
    });

    const headers = new Headers(res.headers);
    headers.set(
      'Cache-Control',
      hashed
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=2592000'
    );
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};
