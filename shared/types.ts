// Gemeinsame Typen für App (src/) und Backend (worker/)

export type Diet = 'fleisch' | 'fisch' | 'vegetarisch' | 'vegan';
export type DietChoice = 'alles' | Diet;

export type Group =
  | 'fleisch'
  | 'wurst'
  | 'fisch'
  | 'milch'
  | 'gemuese'
  | 'obst'
  | 'vorrat'
  | 'tiefkuehl'
  | 'feinkost'
  | 'brot'
  | 'fruehstueck'
  | 'snacks'
  | 'getraenke';

export const GROUP_LABELS: Record<Group, string> = {
  fleisch: 'Fleisch',
  wurst: 'Wurst & Aufschnitt',
  fisch: 'Fisch',
  milch: 'Milch, Käse & Eier',
  gemuese: 'Gemüse',
  obst: 'Obst',
  vorrat: 'Vorrat & Beilagen',
  tiefkuehl: 'Tiefkühl',
  feinkost: 'Feinkost',
  brot: 'Brot',
  fruehstueck: 'Frühstück',
  snacks: 'Süßes & Snacks',
  getraenke: 'Getränke',
};

export interface Offer {
  id: number;
  chain: string;
  name: string;
  brand?: string;
  desc: string;
  price: number;
  oldPrice?: number;
  /** Preis mit Kunden-App (z. B. Penny App), falls in der Beschreibung genannt */
  appPrice?: number;
  /** Hinweis zu App-/Kartenpreis oder Bonus */
  dealNote?: string;
  /** Packungsgröße, z. B. 400 g */
  pack?: string;
  /** Grundpreis, z. B. 7,48 €/kg */
  refPrice?: number;
  refUnit?: string;
  group: Group;
  category: string;
  diet: Diet;
  /** Als Kochzutat für Rezepte geeignet */
  cooking: boolean;
  multi: boolean;
  validFrom: string;
  validTo: string;
  image: string;
}

export interface ChainInfo {
  name: string;
  count: number;
}

export interface OffersResponse {
  plz: string;
  fetchedAt: string;
  chains: ChainInfo[];
  offers: Offer[];
}

export interface RecipeRequest {
  plz: string;
  chains: string[];
  diet: DietChoice;
  persons: number;
  days: number;
  maxMinutes: number | null;
  focusOfferId?: number | null;
  wishes?: string;
}

export interface RecipeIngredient {
  name: string;
  quantity: string;
  pantry: boolean;
  offer?: {
    id: number;
    chain: string;
    name: string;
    brand?: string;
    pack?: string;
    price: number;
    appPrice?: number;
    packs: number;
  };
  estimatedPrice?: number;
  /** Einkaufskosten dieser Zutat (Angebot: Packungen × Preis, sonst Schätzung) */
  cost: number;
  /** Anteilige Kosten für die im Rezept verbrauchte Menge */
  usedCost: number;
}

export interface Recipe {
  id: string;
  title: string;
  description: string;
  minutes: number;
  diet: Diet;
  servings: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  storage: string;
  tip?: string;
  chains: string[];
  offerCost: number;
  estimatedCost: number;
  /** Einkaufskosten (ganze Packungen) */
  totalCost: number;
  /** Kosten der tatsächlich verbrauchten Mengen */
  usedCost: number;
  /** usedCost / Portionen */
  perPortion: number;
}

export interface RecipesResponse {
  recipes: Recipe[];
  model: string;
  offerCount: number;
}
