import { parseDeal, cleanDesc, detectDiet } from '../worker/normalize';
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error('FAIL', m, a, b); process.exitCode = 1; } else console.log('ok', m); };
eq(parseDeal('HINWEIS: MIT PENNY APP 4.79 € Zum Braten, je 500-g-Packung', 4.99), { appPrice: 4.79, note: 'Mit Penny App 4,79 €' }, 'penny');
eq(parseDeal('HINWEIS: MIT APP 0,10 € REWE BONUS je 200-g-Becher', 0.99), { note: '0,10 € REWE Bonus mit App' }, 'rewe bonus');
eq(parseDeal('HINWEIS: MIT KAUFLAND CARD XTRA 1.39€ halbfester Schnittkäse', 1.79), { appPrice: 1.39, note: 'Mit Kaufland Card Xtra 1,39 €' }, 'kaufland card');
eq(parseDeal('HINWEIS: MIT KAUFLAND CARD XTRA Kichererbsen je 400-g-Dose Normalpreis = 2.29', 0.99), { note: 'Preis nur mit Kaufland Card Xtra', oldPrice: 2.29 }, 'kaufland plain');
eq(parseDeal('HINWEIS: MIT LIDL PLUS APP 1.99 € Versch. Sorten', 2.19), { appPrice: 1.99, note: 'Mit Lidl Plus App 1,99 €' }, 'lidl plus');
eq(parseDeal('Je 3 Stück. Normalpreis: 1.35', 0.9), { oldPrice: 1.35 }, 'normalpreis');
eq(cleanDesc('HINWEIS: MIT PENNY APP 4.79 € Zum Braten, je 500-g-Packung'), 'Zum Braten, je 500-g-Packung', 'clean penny');
eq(cleanDesc('HINWEIS: MIT APP 0,10 € REWE BONUS je 200-g-Becher'), 'je 200-g-Becher', 'clean rewe');
eq(cleanDesc('HINWEIS: MIT KAUFLAND CARD XTRA 750 g Wonder Zimties Normalpreis = 2.79'), '750 g Wonder Zimties', 'clean kaufland');
eq(detectDiet('Heringsdoppelfilet', 'Heringsdoppelfilet mariniertes Fleisch', [313], [103]), 'fisch', 'hering');
eq(detectDiet('Kasseler Lachs', 'Kasseler Lachs Schinken', [219], [104]), 'fleisch', 'kasseler');
eq(detectDiet('Fertiggericht', 'Fertiggericht Frosta Tiefkühlgerichte Rahm-Geschnetzeltes, Paprika-Sahne- Hähnchen', [354], [120]), 'fleisch', 'frosta');
eq(detectDiet('Hühnereier', 'Hühnereier Eier', [324], [107]), 'vegetarisch', 'eier');
eq(detectDiet('Pasta', 'Pasta Delverde Nudeln', [118], [16]), 'vegan', 'pasta');
eq(detectDiet('Feinschmecker Sauce', 'Feinschmecker Sauce Knorr Soßen', [334], [112]), 'vegetarisch', 'sauce');
eq(detectDiet('Broccoli', 'Broccoli Brokkoli und Kohl', [433], [147]), 'vegan', 'broccoli');

// Preisberechnung: ungültige Angebots-ID wird über den Namen zugeordnet
import { priceRecipe } from '../worker/recipes';
import type { Offer } from '../shared/types';
const offer = { id: 7, chain: 'Lidl', name: 'Bio Rote Linsen', price: 1.29, pack: '500 g' } as Offer;
const rec = priceRecipe(
  { title: 't', description: '', minutes: 10, diet: 'vegan', steps: [], storage: '', ingredients: [
    { name: 'Bio Rote Linsen (Golden Sun)', quantity: '200 g', offerId: 999, packs: 1, estimatedPrice: null, usedFraction: 0.4, pantry: false },
    { name: 'Salz', quantity: '', offerId: null, packs: null, estimatedPrice: null, usedFraction: null, pantry: true },
  ] },
  new Map([[7, offer]]), 2, 0);
eq([rec.totalCost, rec.usedCost, rec.perPortion, rec.chains], [1.29, 0.52, 0.26, ['Lidl']], 'name fallback');

// Gruppen/Ernährung für Märkte ohne Kategorien
import { dietFor, guessGroup } from '../worker/aldi';
eq(dietFor(guessGroup('Hähnchenbrustfilet-Teilstücke XXL Frisch; zum Braten', 'vorrat'), 'Hähnchenbrustfilet-Teilstücke XXL', 'x'), 'fleisch', 'aldi haehnchen');
eq(guessGroup('Superberliner', 'vorrat'), 'vorrat', 'berliner group');
eq(guessGroup('Home Barista Forte', 'vorrat'), 'getraenke', 'barista');
eq(guessGroup('Lachsfiletportionen Frisch; aus Norwegen', 'vorrat'), 'fisch', 'lachs');
eq(guessGroup('Weihenstephan Tafelbutter oder Die Streichzarte versch. Sorten, 250g', 'vorrat'), 'milch', 'butter');

// Kaufempfehlungen
import { computeDealsFrom, productKey, isoWeek } from '../worker/deals';
const mk = (id: number, name: string, price: number, ref: number, extra: Partial<Offer> = {}) =>
  ({ id, chain: 'REWE', name, price, refPrice: ref, refUnit: 'kg', category: 'Hackfleisch', group: 'fleisch', cooking: true, validFrom: '2020-01-01T00:00:00Z', validTo: '2099-01-01T00:00:00Z', desc: '', diet: 'fleisch', multi: false, image: '', ...extra }) as Offer;
const cur = [mk(1, 'Hack A', 2.99, 5.98, { oldPrice: 6.49 }), mk(2, 'Hack B', 4.99, 9.98), mk(3, 'Hack C', 5.49, 10.98), mk(4, 'Hack D', 5.99, 11.98)];
const d0 = computeDealsFrom(cur, []);
eq(d0.deals.map((d) => d.offerId), [1], 'deals ohne verlauf');
eq(d0.deals[0].reasons, ['−54 % reduziert', 'günstigster Hackfleisch-Preis diese Woche'], 'deal gruende');
const hist = [1, 2, 3, 4].map((i) => ({ week: `w${i}`, items: { [productKey(cur[1])]: 12.5 } }));
const d1 = computeDealsFrom(cur, hist);
eq(d1.deals.find((d) => d.offerId === 2)?.reasons, ['20 % günstiger als sonst'], 'guenstiger als sonst');
eq(d1.deals.find((d) => d.offerId === 3)?.reasons, ['seit 4 Wochen nicht im Angebot'], 'selten');
eq(isoWeek(new Date('2026-10-16T12:00:00Z')), '2026-W42', 'kw');
