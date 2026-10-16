// Abruf der Angebote über die (inoffizielle) marktguru-API.
// Die nötigen Schlüssel stehen öffentlich in der Startseite von marktguru.de.
import type { RawOffer } from './normalize';

const API = 'https://api.marktguru.de/api/v1';
const HOME = 'https://www.marktguru.de/';
const INDUSTRIES = [1009, 1023]; // Supermarkt, Discounter
const PAGE = 500;
const UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';

interface Keys {
  apiKey: string;
  clientKey: string;
  at: number;
}

let keyCache: Keys | null = null;

async function getKeys(force = false): Promise<Keys> {
  if (!force && keyCache && Date.now() - keyCache.at < 12 * 3600_000) return keyCache;
  const res = await fetch(HOME, { headers: { 'user-agent': UA, 'accept-language': 'de-DE,de;q=0.9' } });
  if (!res.ok) throw new Error(`marktguru.de antwortet mit ${res.status}`);
  const html = await res.text();
  const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const j = JSON.parse(m[1]);
      if (j?.config?.apiKey && j?.config?.clientKey) {
        keyCache = { apiKey: j.config.apiKey, clientKey: j.config.clientKey, at: Date.now() };
        return keyCache;
      }
    } catch {
      /* anderes JSON-Script */
    }
  }
  throw new Error('Schlüssel auf marktguru.de nicht gefunden – die Seite hat sich vermutlich geändert');
}

async function apiGet(path: string, retry = true): Promise<any> {
  const keys = await getKeys();
  const res = await fetch(`${API}/${path}`, {
    headers: { 'x-apikey': keys.apiKey, 'x-clientkey': keys.clientKey, 'user-agent': UA },
  });
  if ((res.status === 401 || res.status === 403) && retry) {
    await getKeys(true);
    return apiGet(path, false);
  }
  if (!res.ok) throw new Error(`marktguru-API antwortet mit ${res.status} für ${path.split('?')[0]}`);
  return res.json();
}

export async function fetchRawOffers(plz: string): Promise<RawOffer[]> {
  const all: RawOffer[] = [];
  await Promise.all(
    INDUSTRIES.map(async (industry) => {
      let offset = 0;
      let total = Infinity;
      while (offset < total && offset < 5000) {
        const d = await apiGet(
          `offers?as=web&zipCode=${encodeURIComponent(plz)}&industryId=${industry}&limit=${PAGE}&offset=${offset}`,
        );
        total = d.totalResults ?? 0;
        const results: RawOffer[] = d.results ?? [];
        all.push(...results);
        if (!results.length) break;
        offset += results.length;
      }
    }),
  );
  return all;
}

export interface MgLeaflet {
  id: number;
  validFrom: string;
  validTo: string;
  advertiser?: { name: string };
  pageImages?: { count: number };
}

/** Den passenden Prospekt (Seitenbilder) zu einer Prospekt-Ausgabe für die PLZ */
export async function fetchBestLeaflet(flightId: number, plz: string): Promise<MgLeaflet | null> {
  try {
    return (await apiGet(`leafletflights/${flightId}/bestleaflet?as=mobiledetailed&zipCode=${encodeURIComponent(plz)}`)) as MgLeaflet;
  } catch {
    return null;
  }
}

export const leafletPage = (id: number, page: number, size: 'medium' | 'large') =>
  `https://cdn.marktguru.de/api/v1/leaflets/${id}/images/pages/${page}/${size}.webp`;
