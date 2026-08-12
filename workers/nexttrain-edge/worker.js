/**
 * nexttrain-edge — Cache-Control for hashed Astro assets + icons.
 *
 * GitHub Pages sends max-age=600 (the PSI "efficient cache lifetimes" hit).
 * This Worker sits on nexttrain.co.za/_astro/* and /icons/* only, fetches
 * origin, and sets a long browser TTL. HTML / sw.js / app-version.json are
 * not routed here so deploys and admin NUKE (CF purge + killswitch) still win.
 */
export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fetch(request);
    }

    const url = new URL(request.url);
    const hashed = url.pathname.startsWith('/_astro/');
    const icon = url.pathname.startsWith('/icons/');
    if (!hashed && !icon) return fetch(request);

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
