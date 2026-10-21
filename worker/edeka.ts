// EDEKA-Märkte (inkl. nah & gut, NP, E center): Angebote gelten pro Markt.
// Viele kleine Märkte haben online nur die bundesweiten Angebote; ihr Wochenprospekt
// liegt als PDF im "Blätterkatalog". Den liest Claude einmal pro Woche aus (siehe extractProspekt).
import type { ChainInfo, Diet, Group, Offer } from '../shared/types';
import { dietFor, guessGroup } from './aldi';
import type { Tracker, Usage } from './costs';

// edeka.de lässt nur Anfragen mit vollständigen Browser-Kopfzeilen durch
const H = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
  referer: 'https://www.edeka.de/',
};
const ID_BASE = 2_000_000_000_000;

export interface EdekaMarket {
  id: number;
  marketNo: string;
  name: string;
  street: string;
  city: string;
  channel: string;
  lat?: number;
  lon?: number;
  /** Entfernung zur gesuchten PLZ in km */
  distanceKm?: number;
}

export async function searchMarkets(plz: string): Promise<EdekaMarket[]> {
  const res = await fetch(`https://www.edeka.de/api/marketsearch/markets?searchstring=${encodeURIComponent(plz)}`, { headers: H });
  if (!res.ok) throw new Error(`EDEKA-Marktsuche antwortet mit ${res.status}`);
  const d = (await res.json()) as { markets?: any[] };
  return parseMarkets(d.markets);
}

/** Wandelt die Antwort der EDEKA-Marktsuche um (auch für Daten, die das Handy selbst geholt hat) */
export function parseMarkets(raw: unknown): EdekaMarket[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return raw
    .slice(0, 50)
    .map((m: any) => ({
      id: Number(m?.id),
      marketNo: str(m?.url, 300).match(/maerkte\/(\d+)/)?.[1] ?? '',
      name: str(m?.name),
      street: str(m?.contact?.address?.street),
      city: str(m?.contact?.address?.city?.name),
      channel: str(m?.distributionChannelName) || 'EDEKA',
      lat: num(m?.coordinates?.lat),
      lon: num(m?.coordinates?.lon),
    }))
    .filter((m) => Number.isSafeInteger(m.id) && m.id > 0 && m.name);
}

export function marketChainInfo(m: EdekaMarket, count = 0, note?: string): ChainInfo {
  const dist = m.distanceKm != null ? ` · ${m.distanceKm.toLocaleString('de-DE')} km` : '';
  return { name: m.name, count, kind: 'markt', marketId: m.id, marketNo: m.marketNo, address: `${m.street}, ${m.city}${dist}`, note };
}

/** Bundesweite Online-Angebote eines Markts (meist nur 10–30 Stück) */
export async function fetchMarketOffers(m: EdekaMarket, now = Date.now()): Promise<Offer[]> {
  const res = await fetch(`https://www.edeka.de/eh/service/eh/offers?marketId=${m.id}&limit=999`, { headers: H });
  if (!res.ok) throw new Error(`EDEKA-Angebote antworten mit ${res.status}`);
  const d = (await res.json()) as { docs?: any[]; gueltig_von?: number; gueltig_bis?: number };
  const from = d.gueltig_von ? new Date(d.gueltig_von).toISOString() : new Date(now).toISOString();
  return (d.docs ?? [])
    .map((o): Offer | null => {
      const until = o.gueltig_bis ?? d.gueltig_bis;
      if (!o.titel || typeof o.preis !== 'number') return null;
      const text = `${o.titel} ${o.beschreibung ?? ''}`;
      const group = guessGroup(text, 'vorrat');
      return {
        id: ID_BASE + (Number(o.angebotid) % 1_000_000_000),
        chain: m.name,
        name: String(o.titel).replace(/\s+/g, ' ').trim(),
        desc: String(o.beschreibung ?? '').replace(/\*.*$/, '').trim(),
        price: o.preis,
        pack: packFromText(o.beschreibung ?? ''),
        refPrice: parseBasic(o.basicPrice)?.value,
        refUnit: parseBasic(o.basicPrice)?.unit,
        group,
        category: '',
        diet: dietFor(group, o.titel, text),
        cooking: COOKING.has(group),
        multi: /versch\.|oder /i.test(text),
        validFrom: from,
        validTo: until ? new Date(until + 22 * 3600_000).toISOString() : new Date(now + 2 * 86400_000).toISOString(),
        image: o.bild_web130 ?? '',
      };
    })
    .filter((o): o is Offer => !!o && Date.parse(o.validTo) >= now);
}

const COOKING = new Set<Group>(['fleisch', 'wurst', 'fisch', 'milch', 'gemuese', 'obst', 'vorrat', 'tiefkuehl', 'feinkost', 'brot']);


function packFromText(t: string): string | undefined {
  const m = t.match(/(\d+(?:[.,]\d+)?\s?x\s?)?\d+(?:[.,]\d+)?\s?(kg|g|ml|l)\b/i);
  return m ? m[0].replace(/\s+/g, ' ') : /stück/i.test(t) ? '1 Stück' : undefined;
}

function parseBasic(b?: string | null): { value: number; unit: string } | undefined {
  const m = b?.match(/1\s?(kg|l|stück)\s*=\s*€?\s*(\d+[.,]\d+)/i);
  return m ? { value: parseFloat(m[2].replace(',', '.')), unit: m[1].toLowerCase() } : undefined;
}

// ---------- Wochenprospekt (PDF) ----------

export interface Prospekt {
  key: string;
  pdfUrl: string;
  /** Basis-URL des Blätterkatalogs (…/blaetterkatalog) */
  base: string;
  pageCount: number;
  /** Breite/Höhe der Seitenbilder */
  ratio: number;
  validFrom: string;
  validTo: string;
  preview: boolean;
}

/** Findet den aktuellen und (falls schon online) den nächsten Prospekt eines Markts */
export async function findProspekte(m: EdekaMarket): Promise<Prospekt[]> {
  const res = await fetch(`https://www.edeka.de/maerkte/${m.marketNo}/prospekte/`, { headers: H });
  if (!res.ok) throw new Error(`EDEKA-Prospektseite antwortet mit ${res.status}`);
  const html = await res.text();
  const found = [...html.matchAll(/https:\/\/blaetterkatalog\.edeka\.de\/(preview\/)?([A-Z_]+)\/(\d+)\/index\.html/g)];
  const out: Prospekt[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const p = await catalogAt(f[2], f[3], !!f[1]);
    if (p && !seen.has(p.key)) {
      seen.add(p.key);
      out.push(p);
    }
  }
  return out;
}

/** Ein Blätterkatalog unter fester Adresse (z. B. MINDEN/8011165), aktuell oder Vorschau */
async function catalogAt(region: string, id: string, preview: boolean): Promise<Prospekt | null> {
  const base = `https://blaetterkatalog.edeka.de/${preview ? 'preview/' : ''}${region}/${id}/blaetterkatalog`;
  const xml = await fetch(`${base}/xml/catalog.xml`, { headers: H }).then((r) => (r.ok ? r.text() : ''));
  const validFrom = xml.match(/<from>([\d-]+)<\/from>/)?.[1];
  const validTo = xml.match(/<to>([\d-]+)<\/to>/)?.[1];
  if (!validFrom || !validTo) return null;
  return {
    key: `${region}/${id}/${validFrom}`,
    pdfUrl: `${base}/pdf/complete.pdf`,
    base,
    pageCount: Number(xml.match(/pages="(\d+)"/)?.[1] ?? 0),
    ratio: (() => {
      const m = xml.match(/name="large"\s+width="(\d+)"\s+height="(\d+)"/);
      return m ? Number(m[1]) / Number(m[2]) : 1100 / 1633;
    })(),
    validFrom: `${validFrom}T00:00:00+02:00`,
    validTo: `${validTo}T23:59:59+02:00`,
    preview,
  };
}

/**
 * Ohne edeka.de: Die Blätterkatalog-Adresse eines Markts bleibt jede Woche gleich
 * (z. B. MINDEN/8011165). Aktuellen und Vorschau-Katalog direkt abfragen.
 */
export async function probeProspekte(paths: string[], now = Date.now()): Promise<Prospekt[]> {
  const out: Prospekt[] = [];
  for (const path of paths) {
    const [region, id] = path.split('/');
    if (!/^[A-Z_]+$/.test(region ?? '') || !/^\d+$/.test(id ?? '')) continue;
    for (const preview of [false, true]) {
      const p = await catalogAt(region, id, preview).catch(() => null);
      if (p && Date.parse(p.validTo) >= now && !out.some((x) => x.key === p.key)) out.push(p);
    }
  }
  return out;
}

/** "MINDEN/8011165/2026-10-18" → "MINDEN/8011165" */
export const catalogPath = (key: string) => key.split('/').slice(0, 2).join('/');

const GROUPS: Group[] = ['fleisch', 'wurst', 'fisch', 'milch', 'gemuese', 'obst', 'vorrat', 'tiefkuehl', 'feinkost', 'brot', 'fruehstueck', 'snacks', 'getraenke'];

const SCHEMA = {
  type: 'object',
  properties: {
    offers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Produktname ohne Marke, z. B. "Rinder-Hackfleisch"' },
          brand: { type: 'string', description: 'Marke oder leerer String' },
          price: { type: 'number', description: 'Angebotspreis in Euro' },
          oldPrice: { type: ['number', 'null'], description: 'Durchgestrichener/Statt-Preis, sonst null' },
          pack: { type: 'string', description: 'Packungsgröße, z. B. "500 g", "1 kg", "6 x 1,5 l", "1 Stück"; leer wenn unbekannt' },
          description: { type: 'string', description: 'Kurzer Zusatz (Sorte, Herkunft, Hinweise wie "mit App", "nur an der Theke")' },
          group: { type: 'string', enum: GROUPS },
          diet: { type: 'string', enum: ['fleisch', 'fisch', 'vegetarisch', 'vegan'] },
          cooking: { type: 'boolean', description: 'true, wenn als Kochzutat brauchbar (nicht Süßes, Getränke, Fertiggerichte)' },
          page: { type: 'integer', description: 'Seitennummer im Prospekt, beginnend bei 1' },
          box: {
            type: 'object',
            description:
              'Wo das Angebot auf der Seite steht (Produktfoto + Preisschild), als Anteile der Seitenbreite bzw. -höhe von 0 bis 1. x,y = linke obere Ecke.',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
          },
        },
        required: ['name', 'brand', 'price', 'oldPrice', 'pack', 'description', 'group', 'diet', 'cooking', 'page', 'box'],
        additionalProperties: false,
      },
    },
  },
  required: ['offers'],
  additionalProperties: false,
} as const;

interface RawProspektOffer {
  name: string;
  brand: string;
  price: number;
  oldPrice: number | null;
  pack: string;
  description: string;
  group: Group;
  diet: Diet;
  cooking: boolean;
  page: number;
  box: { x: number; y: number; w: number; h: number };
}

/** Lässt Claude den PDF-Prospekt lesen und gibt die Lebensmittel-Angebote zurück */
export async function extractProspekt(m: EdekaMarket, p: Prospekt, apiKey: string, model: string, track?: Tracker): Promise<Offer[]> {
  const call = async (source: Record<string, unknown>) =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 32000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source },
              {
                type: 'text',
                text: [
                  `Das ist der Wochenprospekt von „${m.name}“ (${m.street}, ${m.city}).`,
                  'Lies jede Seite und liste ALLE Lebensmittel- und Getränke-Angebote mit Preis auf.',
                  'Nicht aufnehmen: Haushalt, Drogerie, Tierbedarf, Deko, Gutscheine, Rätsel, reine Werbung ohne Preis.',
                  'Preis = der groß gedruckte Aktionspreis in Euro (z. B. "-.99" = 0.99). Pfand nicht einrechnen.',
                  'Bei "versch. Sorten" das Produkt einmal aufnehmen und die Sorten kurz in description nennen.',
                  'Wenn ein Preis nur mit App/Karte gilt, das in description vermerken.',
                  'Gib für jedes Angebot die Seite (page) und möglichst genau den Bereich (box) an, in dem Produktfoto und Preisschild stehen – als Anteile von 0 bis 1 (z. B. x=0.5 heißt Seitenmitte), NICHT in Prozent oder Pixeln.',
                ].join('\n'),
              },
            ],
          },
        ],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      }),
    });

  let res = await call({ type: 'url', url: p.pdfUrl });
  if (!res.ok && res.status === 400) {
    // Falls Anthropic die URL nicht laden kann: PDF selbst holen und mitschicken
    const pdf = await fetch(p.pdfUrl, { headers: H });
    if (!pdf.ok) throw new Error(`Prospekt-PDF antwortet mit ${pdf.status}`);
    const b64 = arrayBufferToBase64(await pdf.arrayBuffer());
    res = await call({ type: 'base64', media_type: 'application/pdf', data: b64 });
  }
  if (!res.ok) throw new Error(`Claude API Fehler ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { stop_reason?: string; usage?: Usage; content: { type: string; text?: string }[] };
  await track?.(model, data.usage);
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';
  const raws = (JSON.parse(text) as { offers: RawProspektOffer[] }).offers ?? [];
  return raws
    .filter((o) => o.name && typeof o.price === 'number' && o.price > 0)
    .map((o, i) => ({
      id: prospektOfferId(m.marketNo, p.validFrom, i),
      chain: m.name,
      name: o.name,
      brand: o.brand || undefined,
      desc: o.description,
      price: o.price,
      oldPrice: o.oldPrice ?? undefined,
      pack: o.pack || undefined,
      group: GROUPS.includes(o.group) ? o.group : 'vorrat',
      category: 'Prospekt',
      diet: o.diet,
      cooking: o.cooking,
      multi: /versch|oder/i.test(o.description),
      validFrom: p.validFrom,
      validTo: p.validTo,
      image: '',
      page: o.page > 0 ? o.page : undefined,
      crop: cropFor(p, o),
    }));
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Bildausschnitt aus der Prospektseite, mit etwas Rand, damit nichts abgeschnitten wird */
function cropFor(p: Prospekt, o: RawProspektOffer): Offer['crop'] {
  let b = o.box;
  if (!o.page || o.page < 1 || o.page > (p.pageCount || 99) || !b) return undefined;
  // Falls die KI Prozent (0–100) oder Pixel statt Anteilen liefert: umrechnen
  const maxV = Math.max(b.x + b.w, b.y + b.h);
  if (maxV > 1.5 && maxV <= 101) b = { x: b.x / 100, y: b.y / 100, w: b.w / 100, h: b.h / 100 };
  else if (maxV > 101) b = { x: b.x / 1100, y: b.y / 1633, w: b.w / 1100, h: b.h / 1633 };
  if (!(b.w > 0.02) || !(b.h > 0.02) || b.x >= 1 || b.y >= 1) return undefined;
  const pad = 0.03;
  const x = clamp(b.x - pad);
  const y = clamp(b.y - pad * p.ratio);
  const w = Math.min(1 - x, b.w + 2 * pad);
  const h = Math.min(1 - y, b.h + 2 * pad * p.ratio);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { src: prospektPage(p, o.page, 'large'), x: r(x), y: r(y), w: r(w), h: r(h), ratio: r(p.ratio) };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Seitenbild des Blätterkatalogs – läuft über /api/img, weil EDEKA fremde Seiten blockiert */
// EDEKA nutzt jede Woche dieselben Adressen (aktuell / preview) für neue Seiten.
// Darum hängt die Prospektwoche (v=…) an jeder Bildadresse – sonst zeigt ein Zwischenspeicher alte Seiten.
export const prospektPage = (p: Pick<Prospekt, 'base' | 'validFrom'>, page: number, size: 'normal' | 'large') =>
  `/api/img?u=${encodeURIComponent(`${p.base}/${size}/bk_${page}.jpg`)}&v=${p.validFrom.slice(0, 10)}`;

/** Wo der Katalog gerade liegt: "MINDEN/8011165/2026-10-18" + Vorschau ja/nein → Basis-URL */
export const baseFor = (key: string, preview: boolean) =>
  `https://blaetterkatalog.edeka.de/${preview ? 'preview/' : ''}${catalogPath(key)}/blaetterkatalog`;

/**
 * Eindeutige Nummer je Markt, Prospektwoche und Position. (Früher hing sie nur an "Vorschau ja/nein" –
 * dann bekamen zwei Prospekte dieselben Nummern und Rezepte zeigten Zutaten aus dem falschen Prospekt.)
 */
export const prospektOfferId = (marketNo: string, validFrom: string, i: number) =>
  ID_BASE + Number(marketNo) * 100_000 + (Math.round(Date.parse(validFrom) / (7 * 86400_000)) % 100) * 1000 + i;

/**
 * Gespeicherte Prospekt-Angebote für die Ausgabe auffrischen: eindeutige Nummern vergeben und
 * Bildausschnitte auf die aktuelle Adresse des Prospekts umschreiben (die Adressen wandern wöchentlich).
 */
export function withCurrentImages(offers: Offer[], p: Pick<Prospekt, 'key' | 'preview' | 'validFrom'>, marketNo: string): Offer[] {
  const at = { base: baseFor(p.key, p.preview), validFrom: p.validFrom };
  return offers.map((raw, i) => {
    const o = { ...raw, id: prospektOfferId(marketNo, p.validFrom, i) };
    if (!o.crop) return o;
    const page = Number(decodeURIComponent(o.crop.src).match(/bk_(\d+)\.jpg/)?.[1] ?? o.page);
    return page ? { ...o, crop: { ...o.crop, src: prospektPage(at, page, 'large') } } : o;
  });
}

/** Lädt ein Bild von EDEKA mit passendem Referer */
export async function proxyImage(u: string): Promise<Response> {
  const url = new URL(u);
  if (!['blaetterkatalog.edeka.de', 'offer-images.api.edeka'].includes(url.hostname)) {
    return new Response('nicht erlaubt', { status: 400 });
  }
  // Kein Zwischenspeicher auf Cloudflare-Seite: unter derselben EDEKA-Adresse liegt jede Woche eine andere Seite
  const res = await fetch(url.toString(), { headers: { ...H, referer: 'https://blaetterkatalog.edeka.de/' }, cache: 'no-store' });
  if (!res.ok) return new Response('nicht gefunden', { status: res.status });
  return new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'public, max-age=604800, immutable' },
  });
}
