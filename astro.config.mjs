import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import AstroPWA from '@vite-pwa/astro';

// GitHub project Pages lives at /next-train-astro/; local + custom-domain root stay at /.
// CI sets GITHUB_ACTIONS=true. Override with PUBLIC_BASE_PATH if needed.
const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';
const base = (process.env.PUBLIC_BASE_PATH || (isGitHubPages ? '/next-train-astro' : '/')).replace(/\/$/, '') || '/';
const baseWithSlash = base === '/' ? '/' : `${base}/`;
const site = process.env.PUBLIC_SITE_URL
  || (isGitHubPages ? 'https://enock-elk.github.io' : 'https://nexttrain.co.za');

// https://astro.build/config
export default defineConfig({
  site,
  base: baseWithSlash,
  trailingSlash: 'never',
  integrations: [
    tailwind(),
    AstroPWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Must include the Pages subpath or SW falls back to the wrong URL
        navigateFallback: `${baseWithSlash}offline`.replace(/\/{2,}/g, '/'),
        runtimeCaching: [
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
