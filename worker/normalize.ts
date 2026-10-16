// Wandelt rohe marktguru-Angebote in das App-Format um.
// Reine Funktionen ohne Netzwerk, damit sie sich leicht testen lassen.
import type { Diet, Group, Offer, ChainInfo } from '../shared/types';

export interface RawOffer {
  id: number;
  description?: string | null;
  volume?: number | null;
  quantity?: number | null;
  isMultiProduct?: boolean;
  price: number;
  oldPrice?: number | null;
  referencePrice?: number | null;
  validityDates?: { from: string; to: string }[];
  advertisers?: { id: string; name: string; industryId?: number }[];
  product?: { name?: string | null } | null;
  unit?: { shortName?: string | null } | null;
  brand?: { name?: string | null } | null;
  categories?: { id: number; name: string; parentId: number | null }[];
}

// Oberkategorien (parentId bei marktguru) → App-Gruppe
const PARENT_GROUP: Record<number, Group> = {
  103: 'fleisch',
  104: 'wurst',
  106: 'fisch',
  107: 'milch',
  147: 'gemuese',
  101: 'gemuese', // Pilze, Kräuter
  149: 'obst',
  16: 'vorrat', // Nudeln, Internationales, Veganes
  116: 'vorrat', // Reis, Hülsenfrüchte
  113: 'vorrat', // Konserven
  108: 'vorrat', // Öle, Dips, Pesto
  110: 'vorrat', // Backen
  174: 'vorrat', // Gewürze
  112: 'vorrat', // Soßen, Fertiges
  120: 'tiefkuehl',
  115: 'feinkost',
  191: 'brot',
  187: 'fruehstueck',
  473: 'fruehstueck',
  119: 'fruehstueck',
  20: 'snacks',
  102: 'snacks',
  23: 'snacks',
  69: 'getraenke',
  70: 'getraenke',
  193: 'getraenke',
  363: 'getraenke',
  364: 'getraenke',
  454: 'getraenke',
  497: 'getraenke',
};

// Unterkategorien, die zwar Lebensmittel sind, aber keine Kochzutat
const NOT_COOKING = new Set<number>([
  188, // Eis
  355, // TK-Pizza
  356, // TK-Backwaren
  179, // Tortendeko
  181, // Desserts
  336, // Instantgerichte
  338, // Snacks und Imbiss
  246, // Warme Speisen
  244, // Fingerfood
  343, // Dosengerichte
  354, // Tiefkühlgerichte
  121, // Nahrungsergänzung
  52, // Internationale Spezialitäten (oft Süßes/Snacks)
]);
const EXCLUDE = new Set<number>([121]);

const COOKING_GROUPS = new Set<Group>([
  'fleisch',
  'wurst',
  'fisch',
  'milch',
  'gemuese',
  'obst',
  'vorrat',
  'tiefkuehl',
  'feinkost',
  'brot',
]);

const MEAT_CATS = new Set([340, 358, 183]);
const FISH_CATS = new Set([339, 357, 220, 323]);
const VEGAN_CAT = 132;

const RE_VEGAN = /\b(vegan\w*|pflanzlich\w*)\b/i;
const RE_VEGGIE = /\b(veggie|vegetarisch\w*)\b/i;
const RE_MEAT =
  /(hähnchen|haehnchen|huhn|hühner|chicken|pute|puten|truthahn|schwein|rind|kalb|lamm|hack|wurst|würst|schinken|speck|salami|bacon|gulasch|döner|frikadell|leberkäse|mett|schnitzel|nacken|kotelett|bratwurst|wiener|\bente|entenbrust|gans|wildfleisch|hirsch|reh)/i;
const RE_FISH =
  /(lachs|thunfisch|fisch|garnele|shrimp|hering|forelle|kabeljau|seelachs|matjes|scampi|muschel|tintenfisch|calamar|sardine|makrele|krabbe|surimi|scholle|pangasius|dorsch)/i;
const RE_VEGETARIAN = /(käse|kaese|milch|joghurt|sahne|butter|\beier?\b|quark|mozzarella|feta|honig|schmand|crème|creme|frischkäse|parmesan|gouda|ei-|eier-)/i;

const NO_BRAND = /^thisisnobrand/i;

// Grundnahrungsmittel ohne tierische Bestandteile (Nudeln, Reis, Hülsenfrüchte, Öl, Essig, Mehl, Gemüsekonserven, Gewürze)
const VEGAN_STAPLES = new Set([118, 345, 347, 431, 167, 170, 178, 341, 447]);
const RE_MEAT_EXCEPTION = /(kasseler|lachsschinken|schinken)/i;

/**
 * Ernährungsform eines Angebots schätzen.
 * @param productName nur der Produktname
 * @param text Produktname + Marke + Kategorien + Beschreibung
 */
export function detectDiet(productName: string, text: string, catIds: number[], parentIds: number[]): Diet {
  if (catIds.includes(VEGAN_CAT) || RE_VEGAN.test(productName)) return 'vegan';
  if (RE_VEGGIE.test(productName)) return 'vegetarisch';
  if (RE_FISH.test(productName) && !RE_MEAT_EXCEPTION.test(productName)) return 'fisch';
  const name = text;
  if (parentIds.some((p) => p === 103 || p === 104) || catIds.some((c) => MEAT_CATS.has(c))) return 'fleisch';
  if (parentIds.includes(106) || catIds.some((c) => FISH_CATS.has(c))) return 'fisch';
  if (parentIds.some((p) => p === 147 || p === 149 || p === 101)) return 'vegan'; // Obst & Gemüse
  if (parentIds.includes(107) || catIds.includes(337) || catIds.includes(626)) return 'vegetarisch';
  if (RE_FISH.test(name)) return 'fisch';
  if (RE_MEAT.test(name)) return 'fleisch';
  if (RE_VEGETARIAN.test(name)) return 'vegetarisch';
  if (catIds.some((c) => VEGAN_STAPLES.has(c))) return 'vegan';
  if (parentIds.includes(191)) return 'vegan'; // Brot
  return 'vegetarisch'; // unklar → vorsichtshalber nicht als vegan markieren
}

function formatPack(volume: number | null | undefined, unit: string | null | undefined): string | undefined {
  if (!volume || !unit) return undefined;
  const u = unit.toLowerCase();
  if (u === 'kg' && volume < 1) return `${round(volume * 1000)} g`;
  if (u === 'l' && volume < 1) return `${round(volume * 1000)} ml`;
  if (u === 'kg' || u === 'l') return `${String(round(volume, 3)).replace('.', ',')} ${u}`;
  if (u === 'stück' || u === 'stk' || u === 'st') return `${round(volume)} Stück`;
  return `${String(round(volume, 3)).replace('.', ',')} ${unit}`;
}

function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

const num = (s: string) => parseFloat(s.replace(',', '.'));

export interface DealInfo {
  appPrice?: number;
  /** Kurzer Hinweis, z. B. "Mit Penny App 4,79 €" oder "0,10 € REWE Bonus mit App" */
  note?: string;
  oldPrice?: number;
}

/** Liest App-/Kartenpreise, REWE-Bonus und Normalpreis aus der Beschreibung. */
export function parseDeal(desc: string, price: number): DealInfo {
  const out: DealInfo = {};
  const bonus = desc.match(/mit\s+app\s+(\d+[.,]\d{2})\s*€?\s*rewe\s+bonus/i);
  if (bonus) out.note = `${bonus[1].replace('.', ',')} € REWE Bonus mit App`;
  const app = desc.match(/mit\s+((?:[a-zäöü]+\s+){0,2}(?:app|card(?:\s+xtra)?))\s*(\d+[.,]\d{2})\s*€?(?!\s*rewe\s+bonus)/i);
  if (app && !bonus) {
    const v = num(app[2]);
    if (v < price && v > price * 0.4) {
      out.appPrice = v;
      const who = app[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      out.note = `Mit ${who} ${v.toFixed(2).replace('.', ',')} €`;
    }
  } else if (!bonus) {
    const plain = desc.match(/mit\s+((?:[a-zäöü]+\s+){0,2}(?:app|card(?:\s+xtra)?))\b/i);
    if (plain) out.note = `Preis nur mit ${plain[1].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}`;
  }
  const normal = desc.match(/normalpreis:?\s*=?\s*(\d+[.,]\d{2})/i);
  if (normal) {
    const v = num(normal[1]);
    if (v > price) out.oldPrice = v;
  }
  return out;
}

/** Beschreibung ohne den "HINWEIS: …"-Vorspann */
export function cleanDesc(desc: string): string {
  return desc
    .replace(/hinweis:\s*(mit\s+(?:app\s+\d+[.,]\d{2}\s*€?\s*rewe\s+bonus|(?:[a-zäöü]+\s+){0,2}(?:app|card(?:\s+xtra)?)(?:\s*\d+[.,]\d{2}\s*€?)?)|nur online verfügbar)/i, '')
    .replace(/normalpreis:?\s*=?\s*\d+[.,]\d{2}/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeOffer(raw: RawOffer, now = Date.now()): Offer | null {
  const cats = raw.categories ?? [];
  if (!cats.length || !raw.advertisers?.length) return null;
  const catIds = cats.map((c) => c.id);
  const parentIds = cats.map((c) => c.parentId).filter((p): p is number => p != null);
  if (catIds.some((c) => EXCLUDE.has(c))) return null;

  let group: Group | undefined;
  for (const c of cats) {
    group = (c.parentId != null && PARENT_GROUP[c.parentId]) || PARENT_GROUP[c.id];
    if (group) break;
  }
  if (!group) return null; // Nicht-Lebensmittel (Deko, Kleidung, Technik …)

  const validity = raw.validityDates?.[0];
  if (!validity) return null;
  if (Date.parse(validity.to) < now) return null;

  const name = (raw.product?.name ?? '').trim();
  if (!name) return null;
  const brandName = raw.brand?.name?.trim();
  const rawDesc = (raw.description ?? '').replace(/\s+/g, ' ').trim();
  if (/nur online verfügbar/i.test(rawDesc)) return null;
  const desc = cleanDesc(rawDesc);
  const deal = parseDeal(rawDesc, raw.price);
  const unit = raw.unit?.shortName ?? undefined;
  const diet = detectDiet(name, `${name} ${brandName ?? ''} ${cats.map((c) => c.name).join(' ')} ${desc}`, catIds, parentIds);

  return {
    id: raw.id,
    chain: raw.advertisers[0].name,
    name,
    brand: brandName && !NO_BRAND.test(brandName) ? brandName : undefined,
    desc,
    price: raw.price,
    oldPrice: raw.oldPrice ?? deal.oldPrice,
    appPrice: deal.appPrice,
    dealNote: deal.note,
    pack: formatPack(raw.volume, unit),
    refPrice: raw.referencePrice ?? undefined,
    refUnit: unit ?? undefined,
    group,
    category: cats[0].name,
    diet,
    cooking: COOKING_GROUPS.has(group) && !catIds.some((c) => NOT_COOKING.has(c)),
    multi: !!raw.isMultiProduct,
    validFrom: validity.from,
    validTo: validity.to,
    image: `https://mg2de.b-cdn.net/api/v1/offers/${raw.id}/images/default/0/small.jpg`,
  };
}

export function normalizeAll(raws: RawOffer[], now = Date.now()): { offers: Offer[]; chains: ChainInfo[] } {
  const seen = new Set<number>();
  const offers: Offer[] = [];
  for (const r of raws) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const o = normalizeOffer(r, now);
    if (o) offers.push(o);
  }
  const counts = new Map<string, number>();
  for (const o of offers) counts.set(o.chain, (counts.get(o.chain) ?? 0) + 1);
  const chains = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return { offers, chains };
}
