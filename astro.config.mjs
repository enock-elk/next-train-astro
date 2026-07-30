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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
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
            urlPattern: /^https:\/\/(.*?firebaseio\.com|.*?workers\.dev|.*?clarity\.ms)\/.*/i,
            handler: 'NetworkOnly',
          }
        ]
      },
      manifest: {
        name: 'Next Train 2.0',
        short_name: 'Train 2.0',
        description: 'Live Metrorail schedules and route maps for South Africa. (Astro rebuild)',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: baseWithSlash,
        id: `${baseWithSlash}?pwa=next-train-2`,
        start_url: `${baseWithSlash}?pwa=next-train-2`,
        icons: [
          {
            src: `${baseWithSlash}icons/icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: `${baseWithSlash}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: `${baseWithSlash}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
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
