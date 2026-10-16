import type { Crop, Offer, Recipe } from '../shared/types';

export interface ListItem {
  key: string;
  name: string;
  detail: string;
  cost: number;
  estimated: boolean;
  packs?: number;
  image?: string;
  crop?: Crop;
  /** Ersparnis gegenüber dem Normalpreis (nur wenn bekannt) */
  saving?: number;
  recipes: string[];
}

export interface MergedList {
  chains: { chain: string; items: ListItem[]; total: number }[];
  other: ListItem[];
  pantry: string[];
  total: number;
  /** Summe der bekannten Ersparnisse */
  saving: number;
}

/** Fasst die Einkaufslisten mehrerer Rezepte zusammen (gleiche Angebote werden addiert) */
export function mergeRecipes(recipes: Recipe[], singles: Offer[] = []): MergedList {
  // Einzelne Angebote wie eine Mini-Rezeptzutat behandeln (1 Packung)
  const singleRecipe: Recipe | null = singles.length
    ? ({
        title: 'Einzeln',
        ingredients: singles.map((o) => ({
          name: o.name,
          quantity: '',
          pantry: false,
          cost: o.price,
          usedCost: o.price,
          offer: { id: o.id, chain: o.chain, name: o.name, brand: o.brand, pack: o.pack, price: o.price, packs: 1, image: o.image, page: o.page, crop: o.crop, oldPrice: o.oldPrice },
        })),
      } as unknown as Recipe)
    : null;
  if (singleRecipe) recipes = [...recipes, singleRecipe];
  const byChain = new Map<string, Map<string, ListItem>>();
  const other = new Map<string, ListItem>();
  const pantry = new Set<string>();

  for (const r of recipes) {
    for (const i of r.ingredients) {
      if (i.offer) {
        const o = i.offer;
        const m = byChain.get(o.chain) ?? new Map<string, ListItem>();
        byChain.set(o.chain, m);
        const key = `o:${o.id}`;
        const prev = m.get(key);
        const packs = (prev?.packs ?? 0) + o.packs;
        m.set(key, {
          key,
          name: o.brand ? `${o.name} ${o.brand}` : o.name,
          detail: `${packs}× ${o.pack ?? 'Packung'}`,
          cost: Math.round(packs * o.price * 100) / 100,
          estimated: false,
          packs,
          image: o.image,
          crop: o.crop,
          saving: o.oldPrice && o.oldPrice > o.price ? Math.round(packs * (o.oldPrice - o.price) * 100) / 100 : undefined,
          recipes: [...new Set([...(prev?.recipes ?? []), r.title])],
        });
      } else if (i.pantry) {
        // "Salz, Pfeffer" in einzelne Einträge zerlegen und doppelte zusammenfassen
        i.name.split(/,\s*|\s+und\s+/).forEach((n) => {
          const t = n.trim();
          if (t && ![...pantry].some((x) => x.toLowerCase() === t.toLowerCase())) pantry.add(t);
        });
      } else {
        const key = `n:${i.name.toLowerCase().trim()}`;
        const prev = other.get(key);
        other.set(key, {
          key,
          name: i.name,
          detail: prev ? `${prev.detail} + ${i.quantity}` : i.quantity,
          cost: Math.round(((prev?.cost ?? 0) + i.cost) * 100) / 100,
          estimated: true,
          recipes: [...new Set([...(prev?.recipes ?? []), r.title])],
        });
      }
    }
  }

  const chains = [...byChain.entries()].map(([chain, m]) => {
    const items = [...m.values()];
    return { chain, items, total: Math.round(items.reduce((s, x) => s + x.cost, 0) * 100) / 100 };
  });
  const otherItems = [...other.values()];
  const total = chains.reduce((s, c) => s + c.total, 0) + otherItems.reduce((s, x) => s + x.cost, 0);
  const saving = chains.reduce((s, c) => s + c.items.reduce((t, i) => t + (i.saving ?? 0), 0), 0);
  return { chains, other: otherItems, pantry: [...pantry], total: Math.round(total * 100) / 100, saving: Math.round(saving * 100) / 100 };
}

/** Text zum Teilen (WhatsApp, Notizen, Google Keep …) */
export function listAsText(title: string, list: MergedList, shortChain: (c: string) => string, skip: Set<string> = new Set()): string {
  const lines: string[] = [title, ''];
  for (const c of list.chains) {
    const items = c.items.filter((i) => !skip.has(i.key));
    if (!items.length) continue;
    lines.push(`${shortChain(c.chain)}:`);
    items.forEach((i) => lines.push(`- ${i.name} (${i.detail})`));
    lines.push('');
  }
  const rest = list.other.filter((i) => !skip.has(i.key));
  if (rest.length) {
    lines.push(list.chains.length ? 'Außerdem:' : 'Einkaufen:');
    rest.forEach((i) => lines.push(`- ${i.name}${i.detail ? ` (${i.detail})` : ''}`));
  }
  return lines.join('\n').trim();
}

export async function shareText(title: string, text: string): Promise<string | null> {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return null;
    }
    await navigator.clipboard.writeText(text);
    return 'Einkaufsliste kopiert';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    try {
      await navigator.clipboard.writeText(text);
      return 'Einkaufsliste kopiert';
    } catch {
      return 'Teilen klappt hier nicht';
    }
  }
}

const DAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Hinweis, ob die Angebote eines Rezepts abgelaufen sind oder bald ablaufen */
export function expiry(r: Recipe, now = Date.now()): { level: 'abgelaufen' | 'bald' | 'spaeter' | null; text: string } {
  if (r.validTo && Date.parse(r.validTo) < now) {
    return { level: 'abgelaufen', text: `Angebot seit ${DAY[new Date(r.validTo).getDay()]} abgelaufen` };
  }
  const starts = r.ingredients.flatMap((i) => (i.offer?.validFrom ? [Date.parse(i.offer.validFrom)] : []));
  const latestStart = starts.length ? Math.max(...starts) : 0;
  if (latestStart > now) return { level: 'spaeter', text: `Angebote ab ${DAY[new Date(latestStart).getDay()]}` };
  if (r.validTo && Date.parse(r.validTo) - now < 36 * 3600_000) {
    return { level: 'bald', text: `Angebot nur bis ${DAY[new Date(r.validTo).getDay()]}` };
  }
  return { level: null, text: '' };
}
