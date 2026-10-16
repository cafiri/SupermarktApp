import { useEffect, useMemo, useState } from 'react';
import { GROUP_LABELS, type Group, type Leaflet, type LeafletsResponse, type Offer } from '../../shared/types';
import { shortChain } from '../format';
import { api } from '../store';
import { OfferRow } from './OfferRow';

const ORDER: Group[] = ['fleisch', 'fisch', 'gemuese', 'milch', 'vorrat', 'tiefkuehl', 'wurst', 'obst', 'feinkost', 'brot', 'fruehstueck', 'snacks', 'getraenke'];

interface Props {
  offers: Offer[];
  chains: string[];
  plz: string;
  markets: number[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  fetchedAt?: string;
  notes: string[];
  onCook: (o: Offer) => void;
  onOpenLeaflet: (chain: string, leaflets: Leaflet[]) => void;
  hasPlz: boolean;
  goToMarkets: () => void;
}

export function OffersView(p: Props) {
  const [mode, setMode] = useState<'liste' | 'prospekte'>('liste');
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
      <div className="mode-row">
        <div className="segmented two" role="tablist" aria-label="Ansicht">
          <button role="tab" aria-selected={mode === 'liste'} className={mode === 'liste' ? 'on' : ''} onClick={() => setMode('liste')}>
            Nach Kategorie
          </button>
          <button role="tab" aria-selected={mode === 'prospekte'} className={mode === 'prospekte' ? 'on' : ''} onClick={() => setMode('prospekte')}>
            Prospekte
          </button>
        </div>
      </div>

      {mode === 'prospekte' ? (
        <LeafletGrid plz={p.plz} markets={p.markets} chains={p.chains} offers={inChains} onOpen={p.onOpenLeaflet} />
      ) : (
        <>
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

          {p.notes.map((n) => (
            <p key={n} className="note pad">
              {n}
            </p>
          ))}
          {p.loading && <p className="muted pad">Angebote werden geladen …</p>}
          {p.error && (
            <div className="error pad" role="alert">
              {p.error}{' '}
              {/Anmeldung/.test(p.error) ? (
                <a className="link" href="/api/login">
                  Neu anmelden
                </a>
              ) : (
                <button className="link" onClick={p.onReload}>
                  Nochmal laden
                </button>
              )}
            </div>
          )}
          {!p.loading && !p.error && list.length === 0 && (
            <p className="muted pad">{query ? `Kein Angebot passt zu „${query}“.` : 'In dieser Kategorie gibt es gerade keine Angebote.'}</p>
          )}

          <ul className="offer-list">
            {list.map((o) => (
              <OfferRow key={o.id} o={o} onCook={p.onCook} />
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
        </>
      )}
    </section>
  );
}

function LeafletGrid(props: {
  plz: string;
  markets: number[];
  chains: string[];
  offers: Offer[];
  onOpen: (chain: string, leaflets: Leaflet[]) => void;
}) {
  const [data, setData] = useState<LeafletsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    api<LeafletsResponse>(`/api/leaflets?plz=${props.plz}&markets=${props.markets.join(',')}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [props.plz, props.markets.join(',')]);

  const byChain = new Map<string, Leaflet[]>();
  data?.leaflets.forEach((l) => byChain.set(l.chain, [...(byChain.get(l.chain) ?? []), l]));

  return (
    <>
      {error && (
        <p className="error pad" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="muted pad">Prospekte werden geladen …</p>}
      <ul className="leaflet-grid">
        {props.chains.map((c) => {
          const ls = byChain.get(c) ?? [];
          const count = props.offers.filter((o) => o.chain === c).length;
          const cover = ls[0]?.pages[0];
          return (
            <li key={c}>
              <button className="leaflet-card" onClick={() => props.onOpen(c, ls)}>
                <span className="leaflet-cover">
                  {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="leaflet-nocover">{shortChain(c)}</span>}
                </span>
                <span className="leaflet-title">{shortChain(c)}</span>
                <span className="leaflet-meta">
                  {ls.length ? `${ls.reduce((s, l) => s + l.pages.length, 0)} Seiten · ` : ''}
                  {count} Angebote
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
