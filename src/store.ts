import { useCallback, useEffect, useState } from 'react';
import type { ChainInfo, DietChoice, Offer, OffersResponse, Recipe, RecipesResponse, StoreInfo, StoresResponse } from '../shared/types';

export interface Settings {
  plz: string;
  /** Standard-Märkte zu Hause (Kettennamen bzw. Marktnamen) */
  chains: string[];
  /** IDs der gewählten EDEKA-Märkte */
  markets: number[];
  persons: number;
  days: number;
  diet: DietChoice;
  maxMinutes: number | null;
  cartMode: 'eins' | 'verteilen';
  /** Zutaten, die nie in Rezepten vorkommen sollen */
  dislikes: string[];
  /** Gespeicherte Markt-Kombis, z. B. REWE + ALDI */
  combos: { name: string; chains: string[] }[];
  /** Schneller, günstiger Rezept-Modus */
  fast: boolean;
}

/** Vorübergehende Auswahl unterwegs */
export interface Trip {
  plz: string;
  chains: string[];
  markets: number[];
}

export const DEFAULT_SETTINGS: Settings = {
  plz: '',
  chains: [],
  markets: [],
  persons: 1,
  days: 1,
  diet: 'alles',
  maxMinutes: null,
  cartMode: 'verteilen',
  dislikes: [],
  combos: [],
  fast: false,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function readRaw<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher voll oder gesperrt – egal */
  }
}

export function useSettings() {
  // Doppelte Märkte (alte Fehler) beim Laden und Speichern bereinigen
  const clean = (s: Settings): Settings => ({ ...s, chains: [...new Set(s.chains ?? [])], markets: [...new Set(s.markets ?? [])] });
  const [settings, setSettings] = useState<Settings>(() => clean(read('settings', DEFAULT_SETTINGS)));
  useEffect(() => write('settings', settings), [settings]);
  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => clean({ ...s, ...patch })), []);
  return [settings, update] as const;
}

export function useTrip() {
  const [trip, setTrip] = useState<Trip | null>(() => {
    const t = readRaw<Trip>('trip');
    return t ? { ...t, chains: [...new Set(t.chains ?? [])], markets: [...new Set(t.markets ?? [])] } : null;
  });
  useEffect(() => write('trip', trip), [trip]);
  return [trip, setTrip] as const;
}

export function loadLastRecipes(): RecipesResponse | null {
  return readRaw<RecipesResponse>('lastRecipes');
}

const OFFER_MAX_AGE = 1 * 3600_000;

/** Fehler, wenn die Cloudflare-Anmeldung abgelaufen ist */
export class LoginError extends Error {
  constructor() {
    super('Deine Anmeldung ist abgelaufen. Lade die App neu, um dich wieder anzumelden.');
  }
}

/** fetch für die eigene API: erkennt die Login-Seite von Cloudflare Access */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, redirect: 'manual' });
  } catch {
    throw new Error('Keine Verbindung. Bist du online?');
  }
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) throw new LoginError();
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new LoginError();
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data as T;
}

/**
 * EDEKA-Märkte direkt vom Gerät aus suchen (edeka.de blockt Anfragen aus der Cloud)
 * und beim Server anmelden, damit er Angebote und Prospekt des Markts findet.
 */
export async function edekaNearbyFromDevice(plz: string): Promise<ChainInfo[]> {
  const res = await fetch(`https://www.edeka.de/api/marketsearch/markets?searchstring=${plz}`);
  if (!res.ok) throw new Error(`EDEKA-Marktsuche antwortet mit ${res.status}`);
  const d = (await res.json()) as { markets?: unknown[] };
  const r = await api<{ nearby: ChainInfo[] }>('/api/edeka/markets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plz, markets: d.markets ?? [] }),
  });
  return r.nearby;
}

export async function fetchOffers(plz: string, markets: number[] = [], force = false): Promise<OffersResponse> {
  // Mit Versionskennung, damit nach einem Update frisch geladen wird
  const key = `offers:${__BUILD__.sha}:${plz}:${markets.join(',')}`;
  if (!force) {
    const cached = readRaw<OffersResponse>(key);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < OFFER_MAX_AGE) return cached;
  }
  const data = await api<OffersResponse>(`/api/offers?plz=${plz}&markets=${markets.join(',')}${force ? '&refresh=1' : ''}`);
  // Nur einen Satz Angebote aufheben, damit der Speicher nicht volläuft
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('offers:') && k !== key)
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* egal */
  }
  write(key, data);
  return data;
}

/** Lädt die Angebote für eine PLZ (+ gewählte EDEKA-Märkte) und hält sie im State */
export function useOffers(plz: string | null, markets: number[] = []) {
  const marketKey = markets.join(',');
  const [data, setData] = useState<OffersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (!plz) return;
      setLoading(true);
      setError(null);
      try {
        setData(await fetchOffers(plz, marketKey ? marketKey.split(',').map(Number) : [], force));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [plz, marketKey],
  );

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  return { data, loading, error, reload: () => load(true) };
}

// ---------- Einkaufskorb ----------

const notExpired = (o: { validTo: string }) => Date.parse(o.validTo) >= Date.now();

/** Angebote, aus denen Rezepte gebaut werden sollen. Bleibt gespeichert, bis er geleert wird. */
export function useCart() {
  const [cart, setCart] = useState<Offer[]>(() => readRaw<Offer[]>('cart') ?? []);
  const [removed, setRemoved] = useState<string[]>([]);
  // Abgelaufene Angebote automatisch entfernen
  useEffect(() => {
    const gone = cart.filter((o) => !notExpired(o));
    if (gone.length) {
      setRemoved(gone.map((o) => o.name));
      setCart((c) => c.filter(notExpired));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => write('cart', cart), [cart]);
  const toggle = useCallback(
    (o: Offer) => setCart((c) => (c.some((x) => x.id === o.id) ? c.filter((x) => x.id !== o.id) : [...c, o].slice(-12))),
    [],
  );
  const remove = useCallback((id: number) => setCart((c) => c.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setCart([]), []);
  return { cart, ids: new Set(cart.map((o) => o.id)), toggle, remove, clear, removed, dismissRemoved: () => setRemoved([]) };
}

// ---------- Gemeinsame Einkaufsliste ----------

export interface ShoppingState {
  recipes: Recipe[];
  /** Einzelne Angebote ohne Rezept */
  offers: Offer[];
  checked: string[];
  /** Zutaten, die man schon zu Hause hat – je Rezept-ID */
  have: Record<string, string[]>;
}

export function useShoppingList() {
  const [state, setState] = useState<ShoppingState>(() => ({ recipes: [], offers: [], checked: [], have: {}, ...(readRaw<ShoppingState>('shopping') ?? {}) }));
  useEffect(() => write('shopping', state), [state]);
  const has = (r: Recipe) => state.recipes.some((x) => x.id === r.id);
  const toggleRecipe = useCallback(
    (r: Recipe) =>
      setState((s) => (s.recipes.some((x) => x.id === r.id) ? { ...s, recipes: s.recipes.filter((x) => x.id !== r.id) } : { ...s, recipes: [...s.recipes, r] })),
    [],
  );
  const toggleItem = useCallback(
    (key: string) => setState((s) => ({ ...s, checked: s.checked.includes(key) ? s.checked.filter((k) => k !== key) : [...s.checked, key] })),
    [],
  );
  const toggleOffer = useCallback(
    (o: Offer) =>
      setState((s) => (s.offers.some((x) => x.id === o.id) ? { ...s, offers: s.offers.filter((x) => x.id !== o.id) } : { ...s, offers: [...s.offers, o] })),
    [],
  );
  const hasOffer = (id: number) => state.offers.some((x) => x.id === id);
  const toggleHave = useCallback(
    (recipeId: string, name: string) =>
      setState((s) => {
        const cur = s.have?.[recipeId] ?? [];
        const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
        return { ...s, have: { ...(s.have ?? {}), [recipeId]: next } };
      }),
    [],
  );
  const clear = useCallback(() => setState((s) => ({ recipes: [], offers: [], checked: [], have: s.have ?? {} })), []);
  return { ...state, have: state.have ?? {}, has, toggleRecipe, toggleOffer, hasOffer, toggleItem, toggleHave, clear };
}

// ---------- Nächste Filialen ----------

export function useStores(plz: string | null) {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  useEffect(() => {
    if (!plz) return;
    const key = `stores:${plz}`;
    const cached = readRaw<{ at: number; stores: StoreInfo[] }>(key);
    if (cached && Date.now() - cached.at < 7 * 86400_000) {
      setStores(cached.stores);
      return;
    }
    // Erst über den Server, sonst direkt vom Handy aus (manche Kartenserver blocken Cloud-Anfragen)
    api<StoresResponse>(`/api/stores?plz=${plz}`)
      .then((d) => d.stores)
      .catch(() => import('../worker/stores').then((m) => m.nearestStores(plz)))
      .then((list) => {
        setStores(list);
        if (list.length) write(key, { at: Date.now(), stores: list });
      })
      .catch(() => setStores([]));
  }, [plz]);
  return stores;
}

// ---------- Gespeicherte Rezepte ----------

export function useSavedRecipes() {
  const [saved, setSaved] = useState<Recipe[]>(() => readRaw<Recipe[]>('saved') ?? []);
  useEffect(() => write('saved', saved), [saved]);
  const toggle = useCallback(
    (r: Recipe) => setSaved((s) => (s.some((x) => x.id === r.id) ? s.filter((x) => x.id !== r.id) : [r, ...s].slice(0, 60))),
    [],
  );
  const isSaved = (r: Recipe) => saved.some((x) => x.id === r.id);
  return { saved, toggle, isSaved };
}
