import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import AstroPWA from '@vite-pwa/astro';

// GitHub project Pages: /next-train-astro/
// Local + custom domain: /
const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';
const rawBase = (process.env.PUBLIC_BASE_PATH || (isGitHubPages ? '/next-train-astro' : '/') || '/').trim();
/** Always trailing-slash except root stays `/` — prevents `next-train-astromanifest` joins */
const baseWithSlash = rawBase === '/' || rawBase === ''
  ? '/'
  : `/${rawBase.replace(/^\/+|\/+$/g, '')}/`;
const site = process.env.PUBLIC_SITE_URL
  || (isGitHubPages ? 'https://enock-elk.github.io' : 'https://nexttrain.co.za');

// https://astro.build/config
export default defineConfig({
  site,
  base: baseWithSlash,
  // Keep trailing slash on `base` itself; page URLs can still omit slash
  trailingSlash: 'ignore',
  build: {
    // 'file' emits dist/guide.html; the default 'directory' emits dist/guide/index.html.
    // metrorail-app serves /guide.html, /map.html and /status.html, and those exact
    // URLs are what Google has indexed (guide.html is priority 0.9 in the live
    // sitemap). Matching them means the cutover needs no redirects and risks no
    // ranking transfer. Switch to 'directory' only as a deliberate, separate change.
    format: 'file',
  },
  integrations: [
    tailwind(),
    AstroPWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Align SW + manifest inject with Astro base (must include trailing slash)
      base: baseWithSlash,
      scope: baseWithSlash,
      // Dev server must not register a SW — it intercepts /@vite and /@fs module
      // URLs and leaves the app stuck on "Loading Route..." (ERR_NAME_NOT_RESOLVED).
      devOptions: {
        enabled: false,
      },
      workbox: {
        // Drop prior Workbox precaches when the revision set changes (Astro SW).
        // Legacy SPA buckets (`metrorail-next-train-*`) are purged client-side in
        // cleanupLegacySpaShell() on first Astro boot.
        cleanupOutdatedCaches: true,
        // Shell only. Including png/svg pulled every network map and icon into the
        // precache — a 5.2 MB atomic install on first visit, which is punishing on
        // the 3G connections most of these commuters use, and one 404 fails the
        // whole install. metrorail-app's worker excludes heavy images for exactly
        // this reason; the runtime rule below caches them on first view instead.
        // No `json`: the plugin adds the manifest itself, and app-version.json is
        // the update probe — precaching it would pin the app to a stale version.
        globPatterns: ['**/*.{js,css,html,ico,webmanifest}'],
        // Private ops/marketing docs are noindex and never needed offline; keeping
        // them out shrinks the atomic install that every 3G user pays for up front.
        // admin.js: lazy unlock only. routes/**: SEO landings are crawlable but
        // must not inflate the atomic offline install for every commuter (NetworkFirst
        // navigate handler still caches them on first visit).
        globIgnores: [
          '**/node_modules/**',
          'marketing.html',
          'status.html',
          '**/admin.js',
          'routes/**',
          'regions/**',
          'corridors/**',
        ],
        // @vite-pwa/astro strips `.html` from page entries, but build.format is
        // 'file' so the emitted files — and every internal link and canonical URL —
        // keep the extension. Left alone, the precache caches `/guide` (never
        // requested) while `/guide.html` falls through to the offline page.
        manifestTransforms: [
          (entries) => {
            const seen = new Set();
            const manifest = [];
            for (const entry of entries) {
              const isRoot = entry.url === '' || entry.url === '/' || entry.url === baseWithSlash;
              const hasExt = /\.[a-z0-9]+$/i.test(entry.url);
              const url = isRoot || hasExt ? entry.url : `${entry.url}.html`;
              if (seen.has(url)) continue;
              seen.add(url);
              manifest.push({ ...entry, url });
            }
            return { manifest, warnings: [] };
          },
        ],
        // navigateFallback is NOT "show when offline" — Workbox serves it for ANY
        // navigation URL missing from the precache (even while online). Use
        // NetworkFirst + precacheFallback so the lifeboat only appears when the
        // network truly fails (or the navigate can't be satisfied from cache).
        // help.html is a self-contained recovery page (reset + contact) in public/.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              precacheFallback: {
                fallbackURL: `${baseWithSlash}help.html`,
              },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
              // Captive portals return HTTP 200 HTML for any URL — never cache that
              // over a real image/map asset (SPA service-worker.js PHASE 4A).
              plugins: [{
                cacheWillUpdate: async ({ response }) => {
                  if (!response || response.status !== 200) return null;
                  const ct = response.headers.get('content-type') || '';
                  if (ct.includes('text/html')) return null;
                  return response;
                },
              }],
            },
          },
          {
            urlPattern: ({ request }) =>
              request.destination === 'script' || request.destination === 'style',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-runtime',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
              plugins: [{
                cacheWillUpdate: async ({ response }) => {
                  if (!response || response.status !== 200) return null;
                  const ct = response.headers.get('content-type') || '';
                  if (ct.includes('text/html')) return null;
                  return response;
                },
              }],
            },
          },
          {
            // cleverwebserver must never be cached or ad impressions get swallowed
            // and stop being billable.
            urlPattern: /^https:\/\/(.*?firebaseio\.com|.*?workers\.dev|.*?clarity\.ms|.*?cleverwebserver\.com)\/.*/i,
            handler: 'NetworkOnly',
          }
        ]
      },
      // The live SPA ships /manifest.json. Keeping the filename means any cached
      // <link rel="manifest"> or bookmark keeps resolving after the cutover.
      manifestFilename: 'manifest.json',
      manifest: {
        // Identity fields below are byte-for-byte the live SPA's. An installed PWA
        // is keyed on `id`, so any drift here registers a *second* app on the home
        // screen instead of upgrading the one already installed.
        name: 'Metrorail Next Train',
        short_name: 'Next Train',
        description: 'Live Metrorail schedules, trip planning and route maps for South Africa.',
        theme_color: '#1d4ed8',
        // Splash-screen colour. Must stay '#1d4ed8' to match the live SPA —
        // a white splash is the most visible sign of the rewrite on cold launch.
        background_color: '#1d4ed8',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'en',
        dir: 'ltr',
        categories: ['travel', 'navigation', 'utilities'],
        scope: baseWithSlash,
        // SPA used "./" relative to a root manifest, which resolves to the origin
        // root — same value baseWithSlash produces here.
        id: baseWithSlash,
        start_url: baseWithSlash,
        // Mirrors metrorail-app/manifest.json exactly. The 512 slot points at
        // loading-logo.png (not icon-512.png) because that is the image already
        // installed on users' home screens, and no `maskable` entry is declared —
        // declaring one lets Android re-crop the icon with adaptive-icon treatment,
        // visibly changing it for every existing install.
        icons: [
          {
            src: `${baseWithSlash}icons/icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: `${baseWithSlash}icons/loading-logo.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          }
        ],
        // Store / PWA Builder packaging screenshots (narrow phone + wide desktop).
        screenshots: [
          {
            src: `${baseWithSlash}screenshots/next-train-narrow.png`,
            sizes: '1080x1920',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Next Train live board on phone',
          },
          {
            src: `${baseWithSlash}screenshots/next-train-wide.png`,
            sizes: '1920x1080',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Next Train on a wide display',
          },
        ],
        // Long-press shortcuts already present on installed SPA home screens.
        // handleShortcutActions() reads ?action= on boot.
        shortcuts: [
          {
            name: 'Trip Planner',
            short_name: 'Plan Trip',
            description: 'Plan a direct or transfer trip',
            url: `${baseWithSlash}?action=planner`,
            icons: [{ src: `${baseWithSlash}icons/icon-192.png`, sizes: '192x192' }]
          },
          {
            name: 'Network Map',
            short_name: 'View Map',
            description: 'View the full rail network map',
            url: `${baseWithSlash}?action=map`,
            icons: [{ src: `${baseWithSlash}icons/icon-192.png`, sizes: '192x192' }]
          }
        ]
      }
    })
  ],
  
  vite: {
    // Do NOT set `vite.base` — Astro already derives it from `base`. Setting it
    // double-prefixes dev module URLs into `//@vite/client`, which the browser
    // parses as a protocol-relative URL (host `vite`) => ERR_NAME_NOT_RESOLVED.
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
        mangle: {
          toplevel: true, 
        },
        format: {
          comments: false,
        }
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('firebase')) return 'firebase-vendor';
              if (id.includes('leaflet')) return 'leaflet-vendor';
              return 'vendor';
            }
          }
        }
      }
    }
  }
});
