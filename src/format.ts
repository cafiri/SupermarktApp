import type { Diet, DietChoice } from '../shared/types';

const euroFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const euro = (n: number) => euroFmt.format(n);

export const DIET_LABEL: Record<DietChoice, string> = {
  alles: 'Alles',
  fleisch: 'Fleisch',
  fisch: 'Fisch',
  vegetarisch: 'Vegetarisch',
  vegan: 'Vegan',
};

export const DIET_SHORT: Record<Diet, string> = {
  fleisch: 'Fleisch',
  fisch: 'Fisch',
  vegetarisch: 'Veggie',
  vegan: 'Vegan',
};

/** Kurzer Kettenname für enge Stellen */
export const shortChain = (c: string) =>
  c.replace('Netto Marken-Discount', 'Netto').replace('PENNY', 'Penny').replace(/^nah\s*(&|und)\s*gut/i, 'nah & gut');

const DAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** "bis Sa" oder "ab Mo" */
export function validity(from: string, to: string, now = Date.now()): string {
  const f = new Date(from);
  if (f.getTime() > now) return `ab ${DAY[f.getDay()]} ${f.getDate()}.${f.getMonth() + 1}.`;
  const t = new Date(to);
  return `bis ${DAY[t.getDay()]}`;
}
