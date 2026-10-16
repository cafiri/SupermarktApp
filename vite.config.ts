import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Versionskennung: Zeitpunkt des Builds + Git-Commit (bei Cloudflare aus WORKERS_CI_COMMIT_SHA)
function gitSha(): string {
  const ci = process.env.WORKERS_CI_COMMIT_SHA;
  if (ci) return ci.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'lokal';
  }
}
const BUILD = {
  sha: gitSha(),
  builtAt: new Date().toISOString(),
};

// Legt dist/version.json an – die App vergleicht ihre eigene Version damit
function versionFile(): Plugin {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
    },
  };
}

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
          const nearby = [
            { name: 'nah & gut Durasin', count: 0, kind: 'markt', marketId: 10007022, address: 'Schwarzer Weg 2, Meinersen' },
            { name: 'EDEKA Müller', count: 0, kind: 'markt', marketId: 10002209, address: 'Hauptstr. 8, Müden' },
          ];
          return send({ ...fx, nearby, fetchedAt: new Date().toISOString() });
        }
        if (req.url.startsWith('/api/recipes')) {
          return send(JSON.parse(readFileSync('test/fixture-recipes.json', 'utf8')), 1500);
        }
        if (req.url.startsWith('/version.json')) return send(BUILD, 0);
        if (req.url.startsWith('/api/clear')) {
          res.setHeader('clear-site-data', '"cookies", "storage"');
          return send({ ok: true }, 0);
        }
        if (req.url.startsWith('/api/health')) return send({ ok: true, hasKey: false, model: 'mock', monthCostUsd: 0.42, budgetUsd: 8, recipesToday: 2, recipesPerDay: 15 });
        if (req.url.startsWith('/api/deals')) {
          return send({ weeksOfHistory: 0, deals: [{ offerId: 1008, reasons: ['−45 % reduziert'], score: 50 }, { offerId: 1001, reasons: ['günstigster Hackfleisch-Preis diese Woche'], score: 30 }] });
        }
        if (req.url.startsWith('/api/status')) {
          return send({ lastCheck: new Date().toISOString(), monthCostUsd: 0.6, markets: [{ market: 'nah & gut Durasin', watched: true, prospekte: [
            { validFrom: '2026-10-11T00:00:00+02:00', validTo: '2026-10-17T23:59:59+02:00', preview: false, count: 94 },
            { validFrom: '2026-10-18T00:00:00+02:00', validTo: '2026-10-24T23:59:59+02:00', preview: true, count: 98, extractedAt: '2026-10-16T12:15:00+02:00', seconds: 140, costUsd: 0.21 },
          ] }] });
        }
        if (req.url.startsWith('/api/stores')) {
          return send({ stores: [
            { chain: 'REWE', name: 'REWE', address: 'Gifhorner Straße 4, 38536 Meinersen', distanceKm: 1.2 },
            { chain: 'Lidl', name: 'Lidl', address: 'Schapers Kamp 3, 31311 Uetze', distanceKm: 9.8 },
          ] });
        }
        if (req.url.startsWith('/api/leaflets')) {
          const page = (n: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="1086"><rect width="640" height="1086" fill="#fff"/><rect x="20" y="20" width="600" height="160" fill="#e30613"/><text x="40" y="120" font-size="72" fill="#fff" font-family="sans-serif">Seite ${n}</text></svg>`)}`;
          return send({ leaflets: [{ id: 'mg-1', chain: 'Lidl', validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 3 * 864e5).toISOString(), pages: [1, 2, 3].map(page), pagesLarge: [1, 2, 3].map(page) }] });
        }
        next();
      });
    },
  };
}

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(BUILD),
  },
  plugins: [
    react(),
    versionFile(),
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
      injectRegister: false,
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//, /^\/version\.json/],
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
