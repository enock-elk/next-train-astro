import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import AstroPWA from '@vite-pwa/astro';

// GitHub Pages project site: https://enock-elk.github.io/next-train-astro/
// When you attach a custom domain at the site root, set site to that domain and base to '/'.
const SITE = 'https://enock-elk.github.io';
const BASE = '/next-train-astro';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'never',
  // Integrate Tailwind CSS and our PWA engine
  integrations: [
    tailwind(),
    AstroPWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      base: BASE,
      scope: `${BASE}/`,
      workbox: {
        // Pre-cache all core HTML, JS, CSS, and imagery
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // We will inject our custom Lie-Fi and Network-First overrides here in later phases
        navigateFallback: `${BASE}/offline`,
        runtimeCaching: [
          {
            // Do NOT cache Firebase RTDB, Cloudflare Workers, or Analytics
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
        id: `${BASE}/?pwa=next-train-2`,
        start_url: `${BASE}/?pwa=next-train-2`,
        scope: `${BASE}/`,
        icons: [
          {
            src: `${BASE}/icons/icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: `${BASE}/icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: `${BASE}/icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  
  // Enterprise Build Engine Configuration
  vite: {
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          // Ruthlessly drop console.logs and debuggers in production to hide data from copycats
          drop_console: true,
          drop_debugger: true,
        },
        mangle: {
          // Scrambles variable and function names to obfuscate logic
          toplevel: true, 
        },
        format: {
          comments: false, // Strips all JS comments in the final build
        }
      },
      // Break large chunks into smaller files for faster parsing
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