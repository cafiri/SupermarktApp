import { useCallback, useEffect, useState } from 'react';
import type { DietChoice, OffersResponse, RecipesResponse } from '../shared/types';

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
  const [trip, setTrip] = useState<Trip | null>(() => {
    const t = readRaw<Trip>('trip');
    return t ? { ...t, markets: t.markets ?? [] } : null;
  });
  useEffect(() => write('trip', trip), [trip]);
  return [trip, setTrip] as const;
}

export function loadLastRecipes(): RecipesResponse | null {
  return readRaw<RecipesResponse>('lastRecipes');
}

const OFFER_MAX_AGE = 3 * 3600_000;

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

export async function fetchOffers(plz: string, markets: number[] = [], force = false): Promise<OffersResponse> {
  const key = `offers:${plz}:${markets.join(',')}`;
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
