import { useMemo, useState } from 'react';
import { GROUP_LABELS, type Group, type Offer } from '../../shared/types';
import { euro, shortChain, validity } from '../format';

const ORDER: Group[] = ['fleisch', 'fisch', 'gemuese', 'milch', 'vorrat', 'tiefkuehl', 'wurst', 'obst', 'feinkost', 'brot', 'fruehstueck', 'snacks', 'getraenke'];

interface Props {
  offers: Offer[];
  chains: string[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  fetchedAt?: string;
  onCook: (o: Offer) => void;
  hasPlz: boolean;
  goToMarkets: () => void;
}

export function OffersView(p: Props) {
  const [group, setGroup] = useState<Group | 'alle'>('fleisch');
  const [query, setQuery] = useState('');

  const inChains = useMemo(() => p.offers.filter((o) => p.chains.includes(o.chain)), [p.offers, p.chains]);
  const counts = useMemo(() => {
    const m = new Map<Group, number>();
    inChains.forEach((o) => m.set(o.group, (m.get(o.group) ?? 0) + 1));
    return m;
  }, [inChains]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inChains
      .filter((o) => (q ? `${o.name} ${o.brand ?? ''} ${o.category} ${o.desc}`.toLowerCase().includes(q) : group === 'alle' || o.group === group))
      .sort((a, b) => (a.refPrice ?? a.price) - (b.refPrice ?? b.price));
  }, [inChains, group, query]);

  if (!p.hasPlz) {
    return (
      <section className="empty">
        <h2>Noch keine Märkte gewählt</h2>
        <p>Wähle zuerst deine PLZ und Märkte, dann siehst du hier die Angebote der Woche.</p>
        <button className="primary" onClick={p.goToMarkets}>
          Märkte wählen
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Angebote">
      <div className="search-row">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Angebote durchsuchen, z. B. Hack"
          aria-label="Angebote durchsuchen"
        />
      </div>
      {!query && (
        <div className="group-row" role="tablist" aria-label="Kategorie">
          {ORDER.filter((g) => counts.get(g)).map((g) => (
            <button key={g} role="tab" aria-selected={group === g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>
              {GROUP_LABELS[g]} <span className="count">{counts.get(g)}</span>
            </button>
          ))}
          <button role="tab" aria-selected={group === 'alle'} className={`chip ${group === 'alle' ? 'on' : ''}`} onClick={() => setGroup('alle')}>
            Alle <span className="count">{inChains.length}</span>
          </button>
        </div>
      )}

      {p.loading && <p className="muted pad">Angebote werden geladen …</p>}
      {p.error && (
        <div className="error pad" role="alert">
          {p.error}{' '}
          <button className="link" onClick={p.onReload}>
            Nochmal laden
          </button>
        </div>
      )}
      {!p.loading && !p.error && list.length === 0 && (
        <p className="muted pad">{query ? `Kein Angebot passt zu „${query}“.` : 'In dieser Kategorie gibt es gerade keine Angebote.'}</p>
      )}

      <ul className="offer-list">
        {list.map((o) => (
          <li key={o.id} className="offer">
            <img src={o.image} alt="" loading="lazy" width={56} height={56} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            <div className="offer-body">
              <div className="offer-name">{o.name}</div>
              <div className="offer-sub">
                {[o.brand, o.pack, shortChain(o.chain)].filter(Boolean).join(' · ')}
              </div>
              {o.dealNote && <div className="offer-deal">{o.dealNote}</div>}
              <div className="offer-valid">{validity(o.validFrom, o.validTo)}</div>
            </div>
            <div className="offer-side">
              <div className="offer-price">{euro(o.price)}</div>
              {o.oldPrice && <div className="offer-old">{euro(o.oldPrice)}</div>}
              {o.refPrice && o.refUnit && (
                <div className="offer-ref">
                  {euro(o.refPrice)}/{o.refUnit}
                </div>
              )}
              {o.cooking && (
                <button className="cook-btn" onClick={() => p.onCook(o)}>
                  Rezepte damit
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {p.fetchedAt && (
        <p className="muted pad small">
          Stand {new Date(p.fetchedAt).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} ·{' '}
          <button className="link" onClick={p.onReload}>
            Aktualisieren
          </button>
        </p>
      )}
    </section>
  );
}
