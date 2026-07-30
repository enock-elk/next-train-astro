import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import AstroPWA from '@vite-pwa/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://nexttrain.co.za',
  trailingSlash: 'never',
  // Integrate Tailwind CSS and our PWA engine
  integrations: [
    tailwind(),
    AstroPWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // Pre-cache all core HTML, JS, CSS, and imagery
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // We will inject our custom Lie-Fi and Network-First overrides here in later phases
        navigateFallback: '/offline',
        runtimeCaching: [
          {
            // Do NOT cache Firebase RTDB, Cloudflare Workers, or Analytics
            urlPattern: /^https:\/\/(.*?firebaseio\.com|.*?workers\.dev|.*?clarity\.ms)\/.*/i,
            handler: 'NetworkOnly',
          }
        ]
      },
      manifest: {
        name: 'Metrorail Next Train',
        short_name: 'Next Train',
        description: 'Live Metrorail schedules and route maps for South Africa.',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
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