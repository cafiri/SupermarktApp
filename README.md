# Angebotsküche

Rezepte aus den aktuellen Supermarkt-Angeboten, sortiert nach Preis pro Portion.

- **App:** React + Vite als PWA (`src/`), später als APK über Capacitor
- **Backend:** Cloudflare Worker (`worker/`) unter `/api/*`
  - `GET /api/offers?plz=38536` – Lebensmittel-Angebote (Quelle: marktguru, inoffiziell)
  - `POST /api/recipes` – Rezepte über die Claude API
  - `GET /api/health` – prüft, ob der API-Key gesetzt ist
- **Gemeinsame Typen:** `shared/types.ts`

## Entwickeln

```bash
npm install
MOCK_API=1 npm run dev     # App mit Beispieldaten, ohne Backend
npm test                   # Tests für die Angebots-Aufbereitung
npm run typecheck
```

Mit echtem Backend lokal: `.dev.vars` mit `ANTHROPIC_API_KEY=...` anlegen, dann `npm run build && npx wrangler dev`.

## Veröffentlichen

Cloudflare Workers Builds ist mit diesem Repo verbunden: jeder Push auf `main` baut (`npm run build`) und veröffentlicht (`npx wrangler deploy`) automatisch.

Secret in Cloudflare: **Workers & Pages → supermarkt-app → Settings → Variables and Secrets → `ANTHROPIC_API_KEY`** (Typ *Secret*).
Das Modell steht in `wrangler.jsonc` unter `vars.MODEL`.
