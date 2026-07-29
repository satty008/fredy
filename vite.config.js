/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';
// https://vitejs.dev/config/
export default defineConfig({
  // Must be absolute: with a relative base, asset URLs in index.html break on
  // deep links like /listings/listing/:id (the SPA fallback serves index.html,
  // but ./assets/* then resolves below the route path and loads HTML as JS).
  base: '/',
  build: {
    chunkSizeWarningLimit: 9999999,
    outDir: './ui/public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) {
            return 'maplibre-gl';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['maplibre-gl'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precache the app shell only - listings/jobs data is live and changes constantly, so the
      // service worker must never intercept /api/* and serve it stale. Letting Workbox's default
      // generateSW strategy precache just the build output (JS/CSS/HTML) keeps the install/launch
      // fast without turning this into an offline-data feature nobody asked for.
      workbox: {
        // The main bundle (maplibre-gl pulls it past the default 2 MiB Workbox limit) is app
        // shell, not user data - precaching it is exactly the point, so raise the ceiling
        // rather than exclude it.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: 'Fredy - Real Estate Finder',
        short_name: 'Fredy',
        description: 'Find Real Estates Damn Easy',
        theme_color: '#e04a38',
        background_color: '#0d0d0d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: {
          host: '0.0.0.0',
          protocol: 'http:',
          port: 9998,
        },
      },
    },
  },
});
