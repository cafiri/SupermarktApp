// Erzeugt Beispieldaten für die lokale Entwicklung (MOCK_API=1)
import { writeFileSync } from 'node:fs';
import { normalizeAll, type RawOffer } from '../worker/normalize';
import { priceRecipe } from '../worker/recipes';

const v = { from: '2026-10-11T22:00:00Z', to: '2099-10-17T21:59:00Z' };
const next = { from: '2099-10-18T22:00:00Z', to: '2099-10-24T21:59:00Z' };
let id = 1000;
const o = (chain: string, name: string, brand: string | null, price: number, volume: number, unit: string, cat: [number, string, number], desc = '', extra: Partial<RawOffer> = {}): RawOffer => ({
  id: ++id, description: desc, volume, price, referencePrice: +(price / volume).toFixed(2), validityDates: [v],
  advertisers: [{ id: 'r', name: chain }], product: { name }, unit: { shortName: unit }, brand: { name: brand ?? 'thisisnobrand123' },
  categories: [{ id: cat[0], name: cat[1], parentId: cat[2] }], ...extra,
});
const HACK: [number, string, number] = [311, 'Hackfleisch', 103];
const GEFL: [number, string, number] = [310, 'Geflügel', 103];
const raws: RawOffer[] = [
  o('Netto Marken-Discount', 'Gemischt-Hackfleisch', 'Gut Ponholz', 2.99, 0.4, 'kg', HACK, '400 g 50% weniger Fett'),
  o('PENNY', 'Rinder-Hackfleisch', 'Mühlenhof', 4.99, 0.5, 'kg', HACK, 'HINWEIS: MIT PENNY APP 4.79 € Zum Braten, je 500-g-Packung'),
  o('Netto Marken-Discount', 'Hähnchen-Brustfilet', 'Gut Ponholz', 4.99, 0.6, 'kg', GEFL, 'mager 600 g'),
  o('Lidl', 'Putenschnitzel Metaxa', 'Metzgerfrisch', 4.44, 0.5, 'kg', [313, 'mariniertes Fleisch', 103], 'Mariniert. In einer Backofenschale. Je 500 g'),
  o('REWE', 'Wildlachsfilets', 'ja!', 3.79, 0.25, 'kg', [357, 'Tiefkühlfisch und Meeresfrüchte', 120], '2 tiefgefroren, je 250-g-Pckg.'),
  o('Kaufland', 'Matjesfilet', 'Nordsee', 2.49, 0.247, 'kg', [320, 'Frischfisch', 106], 'nach nordischer Art je 200 - 247-g-Packg.'),
  o('Lidl', 'Bio Speisekürbis Butternut', null, 1.29, 1, 'kg', [437, 'Zucchini & Kürbis', 147], 'BIOLAND Klasse I kg'),
  o('Kaufland', 'Broccoli', null, 0.99, 0.5, 'kg', [433, 'Brokkoli und Kohl', 147], 'HINWEIS: MIT KAUFLAND CARD XTRA Dtsch./span. Broccoli KI. I je 500-g-Packg. Normalpreis = 1.79'),
  o('Kaufland', 'Romatomaten', null, 1.49, 0.5, 'kg', [436, 'Tomaten', 147], 'Span. KI. I je 500-g-Schale'),
  o('REWE', 'Bio-Speisezwiebeln', 'Rewe Bio', 1.11, 0.75, 'kg', [438, 'Zwiebeln und Knoblauch', 147], 'Gelb, Kl. II, je 750-g-Netz'),
  o('REWE', 'Bio Aubergine', 'Rewe Bio', 1.11, 1, 'Stk', [485, 'Sonstiges Gemüse', 147], 'Kl. II, je St.'),
  o('Lidl', 'Pasta', 'Delverde', 0.99, 0.5, 'kg', [118, 'Nudeln', 16], 'Versch. Sorten. Je 500 g', { isMultiProduct: true }),
  o('Kaufland', 'Hülsenfrüchte', 'Krini', 0.99, 0.24, 'kg', [341, 'Gemüsekonserven', 113], 'HINWEIS: MIT KAUFLAND CARD XTRA Kichererbsen, Linsen oder versch. Sorten Bohnen je 400-g-Dose Normalpreis = 2.29'),
  o('Lidl', 'Buko Frischkäse', 'Arla', 1.44, 0.3, 'kg', [163, 'Käse', 107], 'Versch. Sorten. Gekühlt. Je 300 g'),
  o('REWE', 'Buko Frischkäse der Sahnige', 'Arla', 0.99, 0.2, 'kg', [163, 'Käse', 107], 'HINWEIS: MIT APP 0,10 € REWE BONUS je 200-g-Becher'),
  o('PENNY', 'Schlagsahne', 'Milsani', 0.89, 0.2, 'l', [165, 'Sahne, Schmand und Crème fraîche', 107], 'je 200-ml-Becher'),
  o('REWE', 'vegane Fleischalternative', 'Like Meat', 2.49, 0.18, 'kg', [132, 'Veganes', 16], 'versch. Sorten, je 180-g-Pckg.'),
  o('Lidl', 'Zitronen', null, 0.99, 0.5, 'kg', [445, 'Zitrusfrüchte', 149], 'Klasse I Je 500 g'),
  o('Lidl', 'Birnen-Feigen-Haselnuss-Baguette', 'Deluxe', 1.99, 0.4, 'kg', [475, 'Brot', 191], '400 g', { validityDates: [next] }),
  o('REWE', 'Kessel Chips', 'Funny Frisch', 1.49, 0.12, 'kg', [156, 'Chips', 102], 'je 120-g-Btl.'),
  o('Kaufland', 'Saft-Getränk', 'Pfanner', 1.19, 1, 'l', [359, 'Softdrinks', 69], 'versch. Sorten je 1-l-Packg.'),
];
const { offers, chains } = normalizeAll(raws);
writeFileSync('test/fixture-offers.json', JSON.stringify({ plz: '38536', fetchedAt: '', chains, offers }, null, 1));

const byId = new Map(offers.map((x) => [x.id, x]));
const ing = (name: string, quantity: string, offerId: number | null, packs: number | null, estimatedPrice: number | null, pantry = false, usedFraction: number | null = 1) => ({ name, quantity, offerId, packs, estimatedPrice, pantry, usedFraction });
const raw = [
  { title: 'Hack-Kürbis-Pfanne mit Feta', description: 'Herbstliche Pfanne mit Butternut, Hackfleisch und Tomaten – lässt sich gut vorkochen.', minutes: 35, diet: 'fleisch' as const,
    ingredients: [ing('Gemischtes Hackfleisch', '400 g', 1001, 1, null), ing('Butternut-Kürbis', '1 kg', 1007, 1, null), ing('Romatomaten', '500 g', 1009, 1, null), ing('Zwiebeln', '2 Stück', 1010, 1, null, false, 0.3), ing('Feta', '150 g', null, null, 1.29, false, 0.75), ing('Olivenöl', '2 EL', null, null, null, true), ing('Paprikapulver, Salz, Pfeffer', 'nach Geschmack', null, null, null, true)],
    steps: ['Kürbis schälen, entkernen und in 2 cm Würfel schneiden. Zwiebeln würfeln.', 'Hackfleisch in 2 EL Öl krümelig braten, Zwiebeln dazugeben.', 'Kürbis und geviertelte Tomaten zugeben, mit 100 ml Wasser 15 Minuten zugedeckt garen.', 'Würzen und mit zerbröseltem Feta servieren.'],
    storage: 'Hält 3 Tage im Kühlschrank, lässt sich ohne Feta gut einfrieren.' },
  { title: 'Pasta mit Brokkoli-Frischkäse-Sauce', description: 'Schnelle cremige Pasta, fertig in 20 Minuten.', minutes: 20, diet: 'vegetarisch' as const,
    ingredients: [ing('Pasta', '500 g', 1012, 1, null), ing('Brokkoli', '500 g', 1008, 1, null), ing('Frischkäse', '200 g', 1015, 1, null), ing('Zitrone', '1 Stück', 1018, 1, null, false, 0.2), ing('Salz, Pfeffer', '', null, null, null, true)],
    steps: ['Pasta nach Packungsangabe kochen, 4 Minuten vor Ende die Brokkoliröschen mitgaren.', '200 ml Kochwasser abnehmen, abgießen.', 'Frischkäse mit dem Kochwasser und etwas Zitronenabrieb verrühren, alles mischen.'],
    storage: 'Am besten frisch; Reste halten 2 Tage.', tip: 'Mit gerösteten Kernen bestreuen.' },
  { title: 'Ofenlachs mit Kichererbsen', description: 'Lachs auf würzigen Kichererbsen und Tomaten aus dem Ofen.', minutes: 30, diet: 'fisch' as const,
    ingredients: [ing('Wildlachsfilets', '250 g', 1005, 1, null), ing('Kichererbsen', '1 Dose', 1013, 1, null), ing('Tomaten', '250 g', 1009, 1, null, false, 0.5), ing('Zitrone', '1 Stück', 1018, 1, null, false, 0.2), ing('Kreuzkümmel, Öl, Salz', '', null, null, null, true)],
    steps: ['Ofen auf 200 °C vorheizen.', 'Kichererbsen abspülen, mit Tomaten, Öl und Gewürzen aufs Blech geben, 10 Minuten rösten.', 'Lachs dazulegen und 12 Minuten garen. Mit Zitrone beträufeln.'],
    storage: 'Frisch essen; Kichererbsen halten 2 Tage.' },
];
const recipes = raw.map((r, i) => priceRecipe(r, byId, 2, i)).sort((a, b) => a.perPortion - b.perPortion);
writeFileSync('test/fixture-recipes.json', JSON.stringify({ recipes, model: 'mock', offerCount: offers.length }, null, 1));
console.log(offers.length, 'offers', chains, recipes.map((r) => `${r.title} ${r.totalCost} / ${r.perPortion}`));
console.log(offers.filter(x=>x.dealNote||x.oldPrice).map(x=>`${x.name}: ${x.dealNote} old=${x.oldPrice} desc=${x.desc}`));
