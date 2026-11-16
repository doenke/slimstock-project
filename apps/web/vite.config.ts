import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const backend = process.env.BACKEND_URL ?? 'http://localhost:43871';
const version = process.env.APP_VERSION || 'dev';

export default defineConfig({
  // x.yy.zzz from CI (scripts/version.mjs), "dev" for local builds.
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
      manifest: {
        id: '/',
        name: 'Slimstock Projektmanagement',
        short_name: 'Projekte',
        description: 'Slimstock-Projekte planen und mit dem Kunden teilen',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f6f8',
        theme_color: '#354157',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      '/api': backend,
      '/healthz': backend,
    },
  },
});
