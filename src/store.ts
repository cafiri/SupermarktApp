import { useCallback, useEffect, useState } from 'react';
import type { DietChoice, OffersResponse, RecipesResponse } from '../shared/types';

export interface Settings {
  plz: string;
  /** Standard-Märkte (Ketten) zu Hause */
  chains: string[];
  persons: number;
  days: number;
  diet: DietChoice;
  maxMinutes: number | null;
}

/** Vorübergehende Auswahl unterwegs */
export interface Trip {
  plz: string;
  chains: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  plz: '',
  chains: [],
  persons: 1,
  days: 1,
  diet: 'alles',
  maxMinutes: null,
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
  const [settings, setSettings] = useState<Settings>(() => read('settings', DEFAULT_SETTINGS));
  useEffect(() => write('settings', settings), [settings]);
  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  return [settings, update] as const;
}

export function useTrip() {
  const [trip, setTrip] = useState<Trip | null>(() => readRaw<Trip>('trip'));
  useEffect(() => write('trip', trip), [trip]);
  return [trip, setTrip] as const;
}

export function loadLastRecipes(): RecipesResponse | null {
  return readRaw<RecipesResponse>('lastRecipes');
}

const OFFER_MAX_AGE = 6 * 3600_000;

export async function fetchOffers(plz: string, force = false): Promise<OffersResponse> {
  const key = `offers:${plz}`;
  if (!force) {
    const cached = readRaw<OffersResponse>(key);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < OFFER_MAX_AGE) return cached;
  }
  const res = await fetch(`/api/offers?plz=${plz}${force ? '&refresh=1' : ''}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  write(key, data);
  return data as OffersResponse;
}

/** Lädt die Angebote für eine PLZ und hält sie im State */
export function useOffers(plz: string | null) {
  const [data, setData] = useState<OffersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (!plz) return;
      setLoading(true);
      setError(null);
      try {
        setData(await fetchOffers(plz, force));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [plz],
  );

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  return { data, loading, error, reload: () => load(true) };
}
