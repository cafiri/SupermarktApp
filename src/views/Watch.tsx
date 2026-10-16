import { useState } from 'react';
import type { Offer } from '../../shared/types';
import { shortChain } from '../format';
import { write } from '../store';
import { OfferRow } from './OfferRow';

const fold = (t: string) =>
  t
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');

export function matchWatch(term: string, offers: Offer[]): Offer[] {
  const t = fold(term.trim());
  if (t.length < 2) return [];
  return offers
    .filter((o) => fold(`${o.name} ${o.brand ?? ''} ${o.category} ${o.desc}`).includes(t))
    .sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom) || a.price - b.price);
}

export function readWatch(): string[] {
  try {
    return JSON.parse(localStorage.getItem('watch') ?? '[]');
  } catch {
    return [];
  }
}

/** Merkliste: Dinge, auf die man wartet. Zeigt, wo sie gerade im Angebot sind. */
export function WatchView(p: {
  terms: string[];
  setTerms: (t: string[]) => void;
  offers: Offer[];
  onToggleCart: (o: Offer) => void;
  inCart: Set<number>;
}) {
  const [input, setInput] = useState('');
  const save = (t: string[]) => {
    p.setTerms(t);
    write('watch', t);
  };
  const add = () => {
    const t = input.trim();
    if (t.length < 2 || p.terms.some((x) => fold(x) === fold(t))) return;
    save([...p.terms, t]);
    setInput('');
  };

  return (
    <section aria-label="Merkliste">
      <form
        className="search-row watch-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Worauf wartest du? z. B. Pizza, Garnelen" aria-label="Neuer Eintrag für die Merkliste" />
        <button type="submit" className="secondary" disabled={input.trim().length < 2}>
          Merken
        </button>
      </form>

      {!p.terms.length && (
        <p className="muted pad">
          Trag Produkte ein, auf die du wartest. Jede Woche siehst du hier, ob und wo sie im Angebot sind – auch schon für nächste Woche.
        </p>
      )}

      {p.terms.map((term) => {
        const hits = matchWatch(term, p.offers);
        const chains = [...new Set(hits.map((o) => shortChain(o.chain)))];
        return (
          <section key={term} className="watch-group">
            <div className="watch-head pad">
              <h3>{term}</h3>
              <button className="icon-btn" onClick={() => save(p.terms.filter((x) => x !== term))} aria-label={`${term} von der Merkliste nehmen`}>
                ✕
              </button>
            </div>
            {hits.length ? (
              <>
                <p className="watch-hit pad">Im Angebot bei {chains.join(', ')}</p>
                <ul className="offer-list">
                  {hits.slice(0, 8).map((o) => (
                    <OfferRow key={o.id} o={o} onToggleCart={p.onToggleCart} inCart={p.inCart.has(o.id)} />
                  ))}
                </ul>
                {hits.length > 8 && <p className="muted pad small">und {hits.length - 8} weitere</p>}
              </>
            ) : (
              <p className="muted pad watch-none">Diese Woche gibt es nichts.</p>
            )}
          </section>
        );
      })}
    </section>
  );
}
