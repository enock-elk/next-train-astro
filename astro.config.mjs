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
        // Shell only. Including png/svg pulled every network map and icon into the
        // precache — a 5.2 MB atomic install on first visit, which is punishing on
        // the 3G connections most of these commuters use, and one 404 fails the
        // whole install. metrorail-app's worker excludes heavy images for exactly
        // this reason; the runtime rule below caches them on first view instead.
        globPatterns: ['**/*.{js,css,html,ico,webmanifest}'],
        // navigateFallback is NOT "show when offline" — Workbox serves it for ANY
        // navigation URL missing from the precache (even while online). Pointing it
        // at /offline made refreshes land on the offline page. Use NetworkFirst +
        // precacheFallback so /offline only appears when the network truly fails.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              precacheFallback: {
                fallbackURL: baseWithSlash === '/' ? '/offline' : `${baseWithSlash}offline`,
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
      manifest: {
        name: 'Next Train 2.0',
        short_name: 'Train 2.0',
        description: 'Live Metrorail schedules and route maps for South Africa. (Astro rebuild)',
        theme_color: '#1d4ed8',
        // Splash-screen colour. Must stay '#1d4ed8' to match the live SPA —
        // a white splash is the most visible sign of the rewrite on cold launch.
        background_color: '#1d4ed8',
        display: 'standalone',
        orientation: 'portrait',
        scope: baseWithSlash,
        id: `${baseWithSlash}?pwa=next-train-2`,
        start_url: `${baseWithSlash}?pwa=next-train-2`,
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
