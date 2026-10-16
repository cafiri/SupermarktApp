import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// MOCK_API=1 npm run dev → App läuft lokal mit Beispieldaten, ohne Backend und ohne API-Key
function mockApi(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const send = (data: unknown, delay = 300) =>
          setTimeout(() => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(data));
          }, delay);
        if (req.url.startsWith('/api/offers')) {
          const fx = JSON.parse(readFileSync('test/fixture-offers.json', 'utf8'));
          return send({ ...fx, fetchedAt: new Date().toISOString() });
        }
        if (req.url.startsWith('/api/recipes')) {
          return send(JSON.parse(readFileSync('test/fixture-recipes.json', 'utf8')), 1500);
        }
        if (req.url.startsWith('/api/health')) return send({ ok: true, hasKey: false, model: 'mock' });
        if (req.url.startsWith('/api/leaflets')) return send({ leaflets: [] });
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    process.env.MOCK_API ? mockApi() : null,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Angebotsküche',
        short_name: 'Angebotsküche',
        description: 'Rezepte aus den aktuellen Supermarkt-Angeboten, sortiert nach Preis',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F3F5EF',
        theme_color: '#2E5E3E',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.marktguru.de' || url.pathname.startsWith('/api/img'),
            handler: 'CacheFirst',
            options: { cacheName: 'prospektseiten', expiration: { maxEntries: 300, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'mg2de.b-cdn.net',
            handler: 'CacheFirst',
            options: { cacheName: 'angebotsbilder', expiration: { maxEntries: 400, maxAgeSeconds: 7 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: process.env.MOCK_API ? undefined : { '/api': 'http://localhost:8787' },
  },
});
