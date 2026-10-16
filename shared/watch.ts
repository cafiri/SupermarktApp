// Merkliste: Begriffe in Angeboten finden (App und Server nutzen dieselbe Logik)
import type { Offer } from './types';

const fold = (t: string) => t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

export function matchWatch(term: string, offers: Offer[]): Offer[] {
  const t = fold(term.trim());
  if (t.length < 2) return [];
  return offers
    .filter((o) => fold(`${o.name} ${o.brand ?? ''} ${o.category} ${o.desc}`).includes(t))
    .sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom) || a.price - b.price);
}
