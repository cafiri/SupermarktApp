// EDEKA-Märkte (inkl. nah & gut, NP, E center): Angebote gelten pro Markt.
// Viele kleine Märkte haben online nur die bundesweiten Angebote; ihr Wochenprospekt
// liegt als PDF im "Blätterkatalog". Den liest Claude einmal pro Woche aus (siehe extractProspekt).
import type { ChainInfo, Diet, Group, Offer } from '../shared/types';
import { dietFor, guessGroup } from './aldi';

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
}

export async function searchMarkets(plz: string): Promise<EdekaMarket[]> {
  const res = await fetch(`https://www.edeka.de/api/marketsearch/markets?searchstring=${encodeURIComponent(plz)}`, { headers: H });
  if (!res.ok) throw new Error(`EDEKA-Marktsuche antwortet mit ${res.status}`);
  const d = (await res.json()) as { markets?: any[] };
  return (d.markets ?? []).map((m) => ({
    id: m.id,
    marketNo: String(m.url ?? '').match(/maerkte\/(\d+)/)?.[1] ?? '',
    name: m.name,
    street: m.contact?.address?.street ?? '',
    city: m.contact?.address?.city?.name ?? '',
    channel: m.distributionChannelName ?? 'EDEKA',
  }));
}

export function marketChainInfo(m: EdekaMarket, count = 0, note?: string): ChainInfo {
  return { name: m.name, count, kind: 'markt', marketId: m.id, marketNo: m.marketNo, address: `${m.street}, ${m.city}`, note };
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
    const base = `https://blaetterkatalog.edeka.de/${f[1] ?? ''}${f[2]}/${f[3]}/blaetterkatalog`;
    if (seen.has(base)) continue;
    seen.add(base);
    const xml = await fetch(`${base}/xml/catalog.xml`, { headers: H }).then((r) => (r.ok ? r.text() : ''));
    const validFrom = xml.match(/<from>([\d-]+)<\/from>/)?.[1];
    const validTo = xml.match(/<to>([\d-]+)<\/to>/)?.[1];
    if (!validFrom || !validTo) continue;
    out.push({
      key: `${f[2]}/${f[3]}/${validFrom}`,
      pdfUrl: `${base}/pdf/complete.pdf`,
      base,
      pageCount: Number(xml.match(/pages="(\d+)"/)?.[1] ?? 0),
      validFrom: `${validFrom}T00:00:00+02:00`,
      validTo: `${validTo}T23:59:59+02:00`,
      preview: !!f[1],
    });
  }
  return out;
}

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
        },
        required: ['name', 'brand', 'price', 'oldPrice', 'pack', 'description', 'group', 'diet', 'cooking', 'page'],
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
}

/** Lässt Claude den PDF-Prospekt lesen und gibt die Lebensmittel-Angebote zurück */
export async function extractProspekt(m: EdekaMarket, p: Prospekt, apiKey: string, model: string): Promise<Offer[]> {
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
  const data = (await res.json()) as { stop_reason?: string; content: { type: string; text?: string }[] };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';
  const raws = (JSON.parse(text) as { offers: RawProspektOffer[] }).offers ?? [];
  return raws
    .filter((o) => o.name && typeof o.price === 'number' && o.price > 0)
    .map((o, i) => ({
      id: ID_BASE + Number(m.marketNo) * 1000 + i + (p.preview ? 500 : 0),
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
    }));
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Seitenbild des Blätterkatalogs – läuft über /api/img, weil EDEKA fremde Seiten blockiert */
export const prospektPage = (p: Pick<Prospekt, 'base'>, page: number, size: 'normal' | 'large') =>
  `/api/img?u=${encodeURIComponent(`${p.base}/${size}/bk_${page}.jpg`)}`;

/** Lädt ein Bild von EDEKA mit passendem Referer */
export async function proxyImage(u: string): Promise<Response> {
  const url = new URL(u);
  if (!['blaetterkatalog.edeka.de', 'offer-images.api.edeka'].includes(url.hostname)) {
    return new Response('nicht erlaubt', { status: 400 });
  }
  const res = await fetch(url.toString(), { headers: { ...H, referer: 'https://blaetterkatalog.edeka.de/' }, cf: { cacheTtl: 604800, cacheEverything: true } } as RequestInit);
  if (!res.ok) return new Response('nicht gefunden', { status: res.status });
  return new Response(res.body, {
    headers: { 'content-type': res.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'public, max-age=604800, immutable' },
  });
}
