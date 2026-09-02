import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Configuración de Vite para Quiniela Mundialista PWA - Version 1.0.2 (Cache Bust)
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.png', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'Tico Games',
        short_name: 'Tico Games',
        description: 'Predecí resultados de fútbol y competí con tus amigos',
        theme_color: '#0C0C0C',
        background_color: '#0C0C0C',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Cache de imágenes de banderas (flagcdn.com)
            urlPattern: /^https:\/\/flagcdn\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'flag-images',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Cache de hojas de estilo de Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' }
          },
          {
            // Cache de archivos de fuentes de Google Fonts
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          ui: ['lucide-react', 'motion'],
          utils: ['date-fns', 'date-fns-tz']
        }
      }
    }
  },
  test: {
    // Vitest barre por defecto todo lo que termine en .test o .spec, y así se
    // llevaba puestas las pruebas de Playwright de tests/ui, que usan otro
    // runner: fallaba con "Playwright Test did not expect test.beforeEach()".
    // Cada una corre con lo suyo: `npm test` las de lógica, `npm run test:ui`
    // las que abren la app.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/ui/**'],
  },

  server: {
    proxy: {
      '/_backend/api/matches/external-games': {
        target: 'https://worldcup26.ir',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/_backend\/api\/matches\/external-games/, '/get/games')
      }
    }
  }
})
