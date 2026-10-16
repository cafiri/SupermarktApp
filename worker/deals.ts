// Kaufempfehlungen: besonders stark reduziert, besonders günstiger Grundpreis,
// und – sobald ein paar Wochen Preisverlauf gesammelt sind – "selten im Angebot" und "günstiger als sonst".
import type { Deal, DealsResponse, Offer } from '../shared/types';

/** Kompakter Wochenstand: Produkt-Schlüssel → Grundpreis (oder Preis) */
export interface WeekSnapshot {
  week: string;
  items: Record<string, number>;
}

export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[„“"'()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const productKey = (o: Offer) => `${o.chain}|${norm(o.name)}|${norm(o.brand ?? '')}`;
const unitPrice = (o: Offer) => o.refPrice ?? o.price;

export function snapshot(offers: Offer[]): WeekSnapshot {
  const items: Record<string, number> = {};
  for (const o of offers) items[productKey(o)] = Math.round(unitPrice(o) * 100) / 100;
  return { week: isoWeek(new Date()), items };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function computeDealsFrom(offers: Offer[], history: WeekSnapshot[]): DealsResponse {
  const now = Date.now();
  const current = offers.filter((o) => Date.parse(o.validFrom) <= now + 3 * 86400_000);

  // Vergleichsgruppen für den Grundpreis: gleiche Kategorie und gleiche Einheit
  const groups = new Map<string, number[]>();
  for (const o of current) {
    if (!o.refPrice || !o.refUnit || !o.category) continue;
    const k = `${o.category}|${o.refUnit}`;
    groups.set(k, [...(groups.get(k) ?? []), o.refPrice]);
  }

  const enoughHistory = history.length >= 3;
  const deals: Deal[] = [];
  for (const o of current) {
    const reasons: string[] = [];
    let score = 0;

    if (o.oldPrice && o.oldPrice > o.price) {
      const pct = Math.round((1 - o.price / o.oldPrice) * 100);
      if (pct >= 30) {
        reasons.push(`−${pct} % reduziert`);
        score += pct;
      }
    }

    if (o.refPrice && o.refUnit && o.category) {
      const peers = groups.get(`${o.category}|${o.refUnit}`) ?? [];
      if (peers.length >= 3 && o.refPrice <= Math.min(...peers) && o.refPrice < median(peers) * 0.8) {
        reasons.push(`günstigster ${o.category}-Preis diese Woche`);
        score += 25;
      }
    }

    if (enoughHistory) {
      const key = productKey(o);
      const past = history.map((h) => h.items[key]).filter((x): x is number => typeof x === 'number');
      if (past.length <= Math.floor(history.length / 4)) {
        reasons.push(past.length === 0 ? `seit ${history.length} Wochen nicht im Angebot` : 'selten im Angebot');
        score += 20;
      }
      if (past.length >= 2) {
        const typical = median(past);
        if (unitPrice(o) < typical * 0.85) {
          reasons.push(`${Math.round((1 - unitPrice(o) / typical) * 100)} % günstiger als sonst`);
          score += 30;
        }
      }
    }

    if (reasons.length) deals.push({ offerId: o.id, reasons, score: o.cooking ? score + 5 : score });
  }
  deals.sort((a, b) => b.score - a.score);
  return { deals: deals.slice(0, 40), weeksOfHistory: history.length };
}
