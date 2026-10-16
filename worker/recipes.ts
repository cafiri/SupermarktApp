// Erzeugt Rezepte aus den aktuellen Angeboten mit der Claude API.
import type { Diet, Offer, Recipe, RecipeIngredient, RecipeRequest, RecipesResponse } from '../shared/types';
import type { Env } from './index';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_OFFERS = 320;

const DIET_TEXT: Record<string, string> = {
  alles: 'egal – Fleisch, Fisch oder vegetarisch, gerne gemischt',
  fleisch: 'mit Fleisch (Fleisch ist die Hauptzutat)',
  fisch: 'mit Fisch oder Meeresfrüchten als Hauptzutat, kein Fleisch',
  vegetarisch: 'vegetarisch (kein Fleisch, kein Fisch)',
  vegan: 'vegan (keine tierischen Produkte, auch keine Milch, Eier, Honig)',
};

function dietAllows(choice: RecipeRequest['diet'], d: Diet): boolean {
  switch (choice) {
    case 'vegan':
      return d === 'vegan';
    case 'vegetarisch':
      return d === 'vegan' || d === 'vegetarisch';
    case 'fisch':
      return d !== 'fleisch';
    default:
      return true;
  }
}

const GROUP_PRIORITY: Record<string, number> = {
  fleisch: 0,
  fisch: 0,
  gemuese: 1,
  milch: 2,
  vorrat: 3,
  tiefkuehl: 4,
  wurst: 5,
  feinkost: 6,
  obst: 7,
  brot: 8,
};

export function selectOffers(req: RecipeRequest, offers: Offer[], now = Date.now()): Offer[] {
  const chains = new Set(req.chains);
  const soon = now + 3 * 86400_000;
  const list = offers.filter(
    (o) =>
      o.cooking &&
      (chains.size === 0 || chains.has(o.chain)) &&
      Date.parse(o.validFrom) <= soon &&
      dietAllows(req.diet, o.diet),
  );
  list.sort((a, b) => (GROUP_PRIORITY[a.group] ?? 9) - (GROUP_PRIORITY[b.group] ?? 9));
  const picked = list.slice(0, MAX_OFFERS);
  if (req.focusOfferId) {
    const f = offers.find((o) => o.id === req.focusOfferId);
    if (f && !picked.includes(f)) picked.unshift(f);
  }
  return picked;
}

const eur = (n: number) => n.toFixed(2);

function offerLine(o: Offer): string {
  const parts = [
    o.id,
    o.chain,
    o.brand ? `${o.name} (${o.brand})` : o.name,
    o.pack ?? '?',
    `${eur(o.price)} €`,
    o.group,
    o.diet,
  ];
  if (o.multi || o.desc) parts.push(o.desc.slice(0, 80));
  return parts.join(' | ');
}

const TOOL = {
  name: 'rezepte_ausgeben',
  description: 'Gibt die fertigen Rezepte strukturiert aus.',
  input_schema: {
    type: 'object',
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string', description: 'Ein Satz, was das Gericht ausmacht' },
            minutes: { type: 'integer', description: 'Gesamtzeit inkl. Vorbereitung' },
            diet: { type: 'string', enum: ['fleisch', 'fisch', 'vegetarisch', 'vegan'] },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  quantity: { type: 'string', description: 'Menge für alle Portionen, z. B. "500 g" oder "2 Stück"' },
                  offerId: {
                    type: ['integer', 'null'],
                    description: 'ID aus der Angebotsliste, wenn die Zutat ein Angebot ist, sonst null',
                  },
                  packs: {
                    type: ['integer', 'null'],
                    description: 'Anzahl Packungen des Angebots, die man kaufen muss',
                  },
                  estimatedPrice: {
                    type: ['number', 'null'],
                    description:
                      'Geschätzter Discounter-Preis in Euro für die nötige Packung, nur wenn kein Angebot und nicht Grundvorrat',
                  },
                  usedFraction: {
                    type: ['number', 'null'],
                    description:
                      'Anteil der gekauften Menge, der im Rezept verbraucht wird (0.1 bis 1). Beispiel: 250 g von einer 500-g-Packung = 0.5',
                  },
                  pantry: {
                    type: 'boolean',
                    description: 'true für Grundvorrat (Salz, Pfeffer, Öl, Zucker, Mehl, gängige Gewürze, Brühe)',
                  },
                },
                required: ['name', 'quantity', 'offerId', 'packs', 'estimatedPrice', 'usedFraction', 'pantry'],
                additionalProperties: false,
              },
            },
            steps: { type: 'array', items: { type: 'string' } },
            storage: {
              type: 'string',
              description: 'Hinweis zu Aufbewahrung/Einfrieren beim Vorkochen, sonst kurzer Resteverwertungs-Hinweis',
            },
            tip: { type: 'string', description: 'Optionaler Tipp, sonst leerer String' },
          },
          required: ['title', 'description', 'minutes', 'diet', 'ingredients', 'steps', 'storage', 'tip'],
          additionalProperties: false,
        },
      },
    },
    required: ['recipes'],
    additionalProperties: false,
  },
} as const;

function buildPrompt(req: RecipeRequest, offers: Offer[], focus?: Offer): { system: string; user: string } {
  const servings = req.persons * req.days;
  const system = [
    'Du bist ein kreativer, praktischer Hobbykoch-Assistent für eine Spar-Rezepte-App in Deutschland.',
    'Du baust alltagstaugliche Rezepte aus aktuellen Supermarkt-Angeboten. Ziel: lecker und möglichst günstig pro Portion.',
    'Regeln:',
    '- Nutze für die Hauptzutaten Angebote aus der Liste und gib deren ID als offerId an. Erfinde keine IDs.',
    '- packs = wie viele Packungen man kaufen muss, damit die Menge reicht (Packungsgröße beachten).',
    '- Zutaten, die nicht im Angebot sind, mit realistischem Discounter-Preis für die kleinste übliche Packung schätzen (estimatedPrice).',
    '- usedFraction = welcher Anteil der gekauften Menge im Rezept verbraucht wird (für den Preis pro Portion).',
    '- Grundvorrat (Salz, Pfeffer, Öl, Zucker, Mehl, Brühe, gängige Gewürze, Essig, Senf) mit pantry=true, ohne Preis.',
    '- Bevorzuge pro Rezept Angebote aus möglichst einem Markt, damit man nur in einen Laden muss.',
    '- Abwechslung: unterschiedliche Küchen und Hauptzutaten über die Rezepte hinweg.',
    '- Schritte kurz und klar, auf Deutsch, Mengen in den Schritten nennen.',
    '- Mengen in den Zutaten immer für die Gesamtzahl der Portionen.',
  ].join('\n');

  const lines: string[] = [];
  lines.push(`Erstelle 5 Rezepte.`);
  lines.push(`Ernährung: ${DIET_TEXT[req.diet] ?? DIET_TEXT.alles}`);
  lines.push(
    req.days > 1
      ? `Portionen: ${servings} (${req.persons} Person${req.persons > 1 ? 'en' : ''} × ${req.days} Tage). Die Gerichte sollen sich zum Vorkochen eignen und ${req.days} Tage im Kühlschrank halten oder sich einfrieren lassen.`
      : `Portionen: ${servings}.`,
  );
  if (req.maxMinutes) lines.push(`Maximale Gesamtzeit: ${req.maxMinutes} Minuten.`);
  if (focus) {
    lines.push(
      `WICHTIG: Jedes Rezept muss auf diesem Angebot aufbauen: ID ${focus.id} – ${focus.name}${focus.brand ? ` (${focus.brand})` : ''}, ${focus.pack ?? ''}, ${eur(focus.price)} € bei ${focus.chain}.`,
    );
  }
  if (req.wishes?.trim()) lines.push(`Wünsche: ${req.wishes.trim().slice(0, 300)}`);
  lines.push('');
  lines.push('Aktuelle Angebote (ID | Markt | Produkt | Packung | Preis | Gruppe | Ernährung | Hinweis):');
  for (const o of offers) lines.push(offerLine(o));
  return { system, user: lines.join('\n') };
}

interface RawIngredient {
  name: string;
  quantity: string;
  offerId: number | null;
  packs: number | null;
  estimatedPrice: number | null;
  usedFraction?: number | null;
  pantry: boolean;
}
interface RawRecipe {
  title: string;
  description: string;
  minutes: number;
  diet: Diet;
  ingredients: RawIngredient[];
  steps: string[];
  storage: string;
  tip?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function priceRecipe(raw: RawRecipe, byId: Map<number, Offer>, servings: number, idx: number): Recipe {
  const ingredients: RecipeIngredient[] = raw.ingredients.map((i) => {
    const o = i.offerId != null ? byId.get(i.offerId) : undefined;
    const frac = typeof i.usedFraction === 'number' && i.usedFraction > 0 ? Math.min(1, i.usedFraction) : 1;
    if (o) {
      const packs = Math.max(1, Math.round(i.packs ?? 1));
      return {
        name: i.name,
        quantity: i.quantity,
        pantry: false,
        offer: {
          id: o.id,
          chain: o.chain,
          name: o.name,
          brand: o.brand,
          pack: o.pack,
          price: o.price,
          appPrice: o.appPrice,
          packs,
        },
        cost: r2(packs * o.price),
        usedCost: r2(packs * o.price * frac),
      };
    }
    if (i.pantry) return { name: i.name, quantity: i.quantity, pantry: true, cost: 0, usedCost: 0 };
    const est = typeof i.estimatedPrice === 'number' && i.estimatedPrice > 0 ? i.estimatedPrice : 0;
    return { name: i.name, quantity: i.quantity, pantry: false, estimatedPrice: est, cost: r2(est), usedCost: r2(est * frac) };
  });
  const offerCost = r2(ingredients.filter((i) => i.offer).reduce((s, i) => s + i.cost, 0));
  const estimatedCost = r2(ingredients.filter((i) => !i.offer).reduce((s, i) => s + i.cost, 0));
  const totalCost = r2(offerCost + estimatedCost);
  const usedCost = r2(ingredients.reduce((s, i) => s + i.usedCost, 0));
  const chains = [...new Set(ingredients.flatMap((i) => (i.offer ? [i.offer.chain] : [])))];
  return {
    id: `${Date.now().toString(36)}-${idx}`,
    title: raw.title,
    description: raw.description,
    minutes: raw.minutes,
    diet: raw.diet,
    servings,
    ingredients,
    steps: raw.steps,
    storage: raw.storage,
    tip: raw.tip?.trim() || undefined,
    chains,
    offerCost,
    estimatedCost,
    totalCost,
    usedCost,
    perPortion: r2(usedCost / Math.max(1, servings)),
  };
}

export async function generateRecipes(req: RecipeRequest, allOffers: Offer[], env: Env): Promise<RecipesResponse> {
  const persons = Math.min(Math.max(1, Math.round(req.persons || 1)), 6);
  const days = Math.min(Math.max(1, Math.round(req.days || 1)), 7);
  const r: RecipeRequest = { ...req, persons, days };
  const offers = selectOffers(r, allOffers);
  if (!offers.length) throw new Error('Für diese Auswahl gibt es gerade keine passenden Angebote.');
  const focus = r.focusOfferId ? allOffers.find((o) => o.id === r.focusOfferId) : undefined;
  const { system, user } = buildPrompt(r, offers, focus);
  const model = env.MODEL || DEFAULT_MODEL;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema: TOOL.input_schema } },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude API Fehler ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { stop_reason?: string; content: { type: string; text?: string }[] };
  if (data.stop_reason === 'max_tokens') throw new Error('Die Antwort der KI war zu lang und wurde abgeschnitten. Bitte nochmal versuchen.');
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';
  let raws: RawRecipe[] = [];
  try {
    raws = (JSON.parse(text) as { recipes: RawRecipe[] }).recipes ?? [];
  } catch {
    throw new Error('Die Antwort der KI war kein gültiges JSON. Bitte nochmal versuchen.');
  }
  if (!raws.length) throw new Error('Die KI hat keine Rezepte geliefert. Bitte nochmal versuchen.');

  const byId = new Map(allOffers.map((o) => [o.id, o]));
  const servings = persons * days;
  const recipes = raws.map((x, i) => priceRecipe(x, byId, servings, i)).sort((a, b) => a.perPortion - b.perPortion);
  return { recipes, model, offerCount: offers.length };
}
