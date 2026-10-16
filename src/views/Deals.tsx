import { useEffect, useState } from 'react';
import type { DealsResponse, Offer } from '../../shared/types';
import { api } from '../store';
import { OfferRow } from './OfferRow';

/** Kaufempfehlungen: stark reduziert, günstigster Grundpreis, selten oder günstiger als sonst */
export function DealsView(p: { plz: string; markets: number[]; offers: Offer[]; chains: string[]; onToggleCart: (o: Offer) => void; inCart: Set<number> }) {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<DealsResponse>(`/api/deals?plz=${p.plz}&markets=${p.markets.join(',')}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [p.plz, p.markets.join(',')]);

  const byId = new Map(p.offers.map((o) => [o.id, o]));
  const deals = (data?.deals ?? []).filter((d) => {
    const o = byId.get(d.offerId);
    return o && p.chains.includes(o.chain);
  });

  return (
    <section aria-label="Kaufempfehlungen">
      {error && (
        <p className="error pad" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted pad">Empfehlungen werden berechnet …</p>}
      {data && (
        <p className="muted pad small">
          {data.weeksOfHistory >= 3
            ? `Verglichen mit den Preisen der letzten ${data.weeksOfHistory} Wochen.`
            : `Der Preisverlauf wird gerade gesammelt (${data.weeksOfHistory} von 3 Wochen). Bis dahin zählen nur Rabatt und günstigster Grundpreis – „selten im Angebot“ und „günstiger als sonst“ kommen danach dazu.`}
        </p>
      )}
      {data && !deals.length && <p className="muted pad">Diese Woche sticht nichts besonders heraus.</p>}
      <div className="deal-list">
        {deals.map((d) => {
          const o = byId.get(d.offerId)!;
          return (
            <div key={d.offerId} className="deal">
              <div className="deal-reasons">
                {d.reasons.map((r) => (
                  <span key={r} className="deal-reason">
                    {r}
                  </span>
                ))}
              </div>
              <ul className="offer-list">
                <OfferRow o={o} onToggleCart={p.onToggleCart} inCart={p.inCart.has(o.id)} />
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
