// Nächste Filialen der Ketten über OpenStreetMap (Nominatim + Overpass)
import type { StoreInfo } from '../shared/types';

const UA = 'Angebotskueche/1.0 (private Einkaufs-App)';

// OSM-Marke → Kettenname in der App
const BRANDS: [RegExp, string][] = [
  [/^aldi nord$/i, 'ALDI Nord'],
  [/^rewe$/i, 'REWE'],
  [/^lidl$/i, 'Lidl'],
  [/^penny$/i, 'PENNY'],
  [/^netto marken-discount$/i, 'Netto Marken-Discount'],
  [/^kaufland$/i, 'Kaufland'],
];

export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Mittelpunkt einer Postleitzahl */
export async function geocode(plz: string): Promise<{ lat: number; lon: number } | null> {
  const geo = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${plz}&country=de&format=json&limit=1`, {
    headers: { 'user-agent': UA, 'accept-language': 'de' },
  });
  if (!geo.ok) throw new Error(`Ortssuche antwortet mit ${geo.status}`);
  const [place] = (await geo.json()) as { lat: string; lon: string }[];
  return place ? { lat: Number(place.lat), lon: Number(place.lon) } : null;
}

export async function nearestStores(plz: string, center?: { lat: number; lon: number } | null): Promise<StoreInfo[]> {
  const c = center ?? (await geocode(plz));
  if (!c) return [];
  const { lat, lon } = c;

  const q = `[out:json][timeout:15];nwr["shop"="supermarket"](around:12000,${lat},${lon});out center tags;`;
  // Mehrere öffentliche Overpass-Server – der Hauptserver blockt manchmal Cloud-Anfragen
  const servers = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  let res: Response | null = null;
  const tried: string[] = [];
  for (const url of servers) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: `data=${encodeURIComponent(q)}`,
      });
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
        res = r;
        break;
      }
      tried.push(`${new URL(url).hostname}: ${r.status}`);
    } catch (e) {
      tried.push(`${new URL(url).hostname}: ${String(e)}`);
    }
  }
  if (!res) throw new Error(`Filialsuche nicht erreichbar (${tried.join(', ')})`);
  const d = (await res.json()) as { elements: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] };

  const best = new Map<string, StoreInfo>();
  for (const e of d.elements) {
    const t = e.tags ?? {};
    const brand = t.brand ?? t.name ?? '';
    const chain = BRANDS.find(([re]) => re.test(brand.trim()))?.[1];
    const eLat = e.lat ?? e.center?.lat;
    const eLon = e.lon ?? e.center?.lon;
    if (!chain || eLat == null || eLon == null) continue;
    const dist = Math.round(km(lat, lon, eLat, eLon) * 10) / 10;
    const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
    const city = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
    const address = [street, city].filter(Boolean).join(', ');
    const prev = best.get(chain);
    // Filialen ohne Adresse nur nehmen, wenn es keine mit Adresse gibt
    if (!prev || (address && !prev.address) || (!!address === !!prev.address && dist < prev.distanceKm)) {
      best.set(chain, { chain, name: t.name ?? chain, address, distanceKm: dist });
    }
  }
  return [...best.values()].sort((a, b) => a.distanceKm - b.distanceKm);
}
