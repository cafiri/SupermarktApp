// ALDI Nord: Die Angebotsseite enthält alle Produkte als JSON (Next.js __NEXT_DATA__).
// Die Angebote gelten bundesweit im ALDI-Nord-Gebiet, nicht pro Filiale.
import type { Diet, Group, Offer } from '../shared/types';
import { detectDiet } from './normalize';

const URL_CURRENT = 'https://www.aldi-nord.de/angebote.html';
export const ALDI_NORD = 'ALDI Nord';
const ID_BASE = 1_000_000_000_000;

interface AldiProduct {
  objectID: string;
  name: string;
  brandName?: string;
  shortDescription?: string;
  salesUnit?: string;
  currentPrice?: {
    priceValue: number;
    strikePrice?: { strikePriceValue: number };
    basePrice?: { basePriceValue: number; basePriceScale: string }[];
  };
  promotionPrices?: { validFromLocalDate?: string; validUntilLocalDate?: string }[];
  assets?: { type: string; url: string }[];
}

interface AldiSection {
  title?: string;
  productIds?: string[];
}

// Abschnitte der Angebotsseite → Gruppe. null = keine Lebensmittel
function sectionGroup(title: string): Group | 'mixed' | null {
  const t = title.toLowerCase();
  if (/obst|gemüse/.test(t)) return 'gemuese';
  if (/fleisch|fisch/.test(t)) return 'mixed';
  if (/snacks|süßes/.test(t)) return 'snacks';
  if (/getränke|tassimo|kaffee/.test(t)) return 'getraenke';
  if (/wochen|gekühlt|tiefgekühlt|haltbar|streetfood|frühstück|grill|aktion/.test(t) && !/halloween|weihnacht|oster/.test(t)) return 'mixed';
  return null; // Pflanzen, Haushalt, Tierfutter, Küche, Wohnen, Elektronik, Deko …
}

const RE_OBST = /(apfel|äpfel|birne|banane|traube|orange|mandarine|clementine|zitrone|limette|mango|ananas|kiwi|beere|melone|pfirsich|nektarine|pflaume|kirsche|avocado|granatapfel|feige|grapefruit)/i;
const RE_FISCH = /(lachs|fisch|garnele|shrimp|hering|forelle|kabeljau|seelachs|matjes|thunfisch|scampi|muschel)/i;
const RE_FLEISCH = /(hack|hähnchen|huhn|pute|schwein|rind|kalb|lamm|steak|schnitzel|gulasch|braten|filet|keule|nacken|kotelett|geschnetzelt|bratwurst|frikadell|chicken|pulled|bacon|würstchen|wurst|schinken|salami)/i;
const RE_MILCH = /(käse|milch|joghurt|quark|sahne|butter|mozzarella|feta|hirtenkäse|frischkäse|skyr|eier\b|schmand|crème fraîche)/i;
const RE_BROT = /(brot|brötchen|baguette|buns|bagel|toast|croissant|brezel)/i;
const RE_SUESS = /(schoko|pudding|mousse|keks|kuchen|muffin|gummi|jelly|bonbon|eis\b|soft-eis|riegel|flips|chips|praline|waffel|donut|pancake|sirup)/i;
const RE_DRINK = /(drink|kaffee|barista|espresso|cappuccino|latte|cola|saft|limo|bier|wein|whisk|wodka|likör|wasser|mocha|tee\b|eiskaffee)/i;
const RE_TK = /(tiefgefroren|tk-|pizza|fritten|pommes|nuggets)/i;

/** Ernährungsform aus Gruppe und Text (ohne marktguru-Kategorien) */
export function dietFor(group: Group, name: string, text: string): Diet {
  if (group === 'gemuese' || group === 'obst') return 'vegan';
  if (group === 'fleisch' || group === 'wurst') return 'fleisch';
  if (group === 'fisch') return 'fisch';
  return detectDiet(name, text, [], []);
}

export function guessGroup(text: string, fallback: Group): Group {
  if (RE_DRINK.test(text)) return 'getraenke';
  if (RE_SUESS.test(text)) return 'snacks';
  if (RE_FISCH.test(text)) return 'fisch';
  if (/(schinken|salami|aufschnitt|wurst(?!chen)|mortadella|leberwurst)/i.test(text)) return 'wurst';
  if (RE_FLEISCH.test(text)) return 'fleisch';
  if (RE_MILCH.test(text)) return 'milch';
  if (RE_BROT.test(text)) return 'brot';
  if (RE_TK.test(text)) return 'tiefkuehl';
  if (RE_OBST.test(text)) return 'obst';
  return fallback;
}

const NOT_COOKING = /(pizza|lasagne|eintopf|chili con carne|nuggets|donut|fertig|snack|dessert)/i;

function formatPack(unit?: string): string | undefined {
  if (!unit) return undefined;
  const m = unit.match(/^([\d,.x\s]+)\s*-?\s*(kg|g|ml|l)\b/i);
  if (m) return `${m[1].replace(/\s+/g, '')} ${m[2]}`;
  if (/kg-preis/i.test(unit)) return '1 kg';
  if (/stück/i.test(unit)) return '1 Stück';
  return unit.replace(/-(packung|schale|beutel|netz|becher|dose|glas|flasche)/i, ' $1');
}

function extractApiData(html: string): unknown[] {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('ALDI Nord: Seitenformat hat sich geändert (__NEXT_DATA__ fehlt)');
  const nd = JSON.parse(m[1]);
  const api = nd?.props?.pageProps?.apiData;
  return typeof api === 'string' ? JSON.parse(api) : api;
}

export function parseAldiPage(html: string, now = Date.now()): Offer[] {
  const api = extractApiData(html) as [string, { res?: { algoliaDataMap?: Record<string, AldiProduct>; categories?: { content?: AldiSection[] }[] } }][];
  const entry = api.find((e) => e[0] === 'OFFER_GET');
  const res = entry?.[1]?.res;
  if (!res?.algoliaDataMap) throw new Error('ALDI Nord: keine Angebotsdaten gefunden');
  const map = res.algoliaDataMap;

  const offers: Offer[] = [];
  const seen = new Set<string>();
  for (const day of res.categories ?? []) {
    for (const sec of day.content ?? []) {
      const sg = sectionGroup(sec.title ?? '');
      if (!sg) continue;
      for (const pid of sec.productIds ?? []) {
        const p = map[pid];
        if (!p?.currentPrice || seen.has(pid)) continue;
        seen.add(pid);
        const promo = p.promotionPrices?.[0];
        const validFrom = promo?.validFromLocalDate ? `${promo.validFromLocalDate}T00:00:00+02:00` : new Date(now).toISOString();
        const validTo = promo?.validUntilLocalDate ? `${promo.validUntilLocalDate}T23:59:59+02:00` : new Date(now + 6 * 86400_000).toISOString();
        if (Date.parse(validTo) < now) continue;
        const text = `${p.name} ${p.shortDescription ?? ''}`;
        let group: Group = sg === 'mixed' ? guessGroup(text, 'vorrat') : sg;
        if (sg === 'gemuese' && RE_OBST.test(p.name)) group = 'obst';
        const base = p.currentPrice.basePrice?.[0];
        const desc = [p.shortDescription, p.salesUnit].filter(Boolean).join(' · ');
        const cookingGroups: Group[] = ['fleisch', 'wurst', 'fisch', 'milch', 'gemuese', 'obst', 'vorrat', 'tiefkuehl', 'feinkost', 'brot'];
        offers.push({
          id: ID_BASE + (parseInt(pid.replace(/\D/g, ''), 10) % ID_BASE),
          chain: ALDI_NORD,
          name: p.name,
          brand: p.brandName || undefined,
          desc,
          price: p.currentPrice.priceValue,
          oldPrice: p.currentPrice.strikePrice?.strikePriceValue,
          pack: formatPack(p.salesUnit),
          refPrice: base?.basePriceValue,
          refUnit: base?.basePriceScale,
          group,
          category: sec.title ?? '',
          diet: dietFor(group, p.name, text),
          cooking: cookingGroups.includes(group) && !NOT_COOKING.test(text),
          multi: /\//.test(p.name),
          validFrom,
          validTo,
          image: p.assets?.find((a) => a.type === 'primary')?.url ? `${p.assets.find((a) => a.type === 'primary')!.url}?wid=160&hei=160` : '',
        });
      }
    }
  }
  return offers;
}

export async function fetchAldiNord(): Promise<Offer[]> {
  const res = await fetch(URL_CURRENT, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
      'accept-language': 'de-DE,de;q=0.9',
      accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`ALDI Nord antwortet mit ${res.status}`);
  return parseAldiPage(await res.text());
}
