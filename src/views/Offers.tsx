import { useEffect, useMemo, useState } from 'react';
import { GROUP_LABELS, type Group, type Leaflet, type LeafletsResponse, type Offer } from '../../shared/types';
import { shortChain } from '../format';
import { api, useSyncReload } from '../store';
import { OfferRow } from './OfferRow';
import { DealsView } from './Deals';
import { matchWatch, readWatch, WatchView } from './Watch';

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
  onToggleCart: (o: Offer) => void;
  inCart: Set<number>;
  onOpenLeaflet: (chain: string, leaflets: Leaflet[]) => void;
  hasPlz: boolean;
  goToMarkets: () => void;
}

export function OffersView(p: Props) {
  const [mode, setMode] = useState<'liste' | 'tipps' | 'merkliste' | 'bald' | 'prospekte'>('liste');
  const [terms, setTerms] = useState<string[]>(readWatch);
  useSyncReload(['watch'], () => setTerms(readWatch()));
  const [group, setGroup] = useState<Group | 'alle'>('fleisch');
  const [query, setQuery] = useState('');

  const inChains = useMemo(() => p.offers.filter((o) => p.chains.includes(o.chain)), [p.offers, p.chains]);
  // Gilt heute = Start spätestens heute Abend; alles Spätere kommt unter "Bald"
  const endOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);
  const nowOffers = useMemo(() => inChains.filter((o) => Date.parse(o.validFrom) <= endOfToday), [inChains, endOfToday]);
  const soonOffers = useMemo(() => inChains.filter((o) => Date.parse(o.validFrom) > endOfToday), [inChains, endOfToday]);
  const counts = useMemo(() => {
    const m = new Map<Group, number>();
    nowOffers.forEach((o) => m.set(o.group, (m.get(o.group) ?? 0) + 1));
    return m;
  }, [nowOffers]);

  const watchHits = useMemo(() => terms.filter((t) => matchWatch(t, inChains).length).length, [terms, inChains]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nowOffers
      .filter((o) => (q ? `${o.name} ${o.brand ?? ''} ${o.category} ${o.desc}`.toLowerCase().includes(q) : group === 'alle' || o.group === group))
      .sort((a, b) => (a.refPrice ?? a.price) - (b.refPrice ?? b.price));
  }, [nowOffers, group, query]);

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
        <div className="segmented five" role="tablist" aria-label="Ansicht">
          {(
            [
              ['liste', 'Jetzt'],
              ['tipps', 'Tipps'],
              ['merkliste', watchHits ? `Merkliste ${watchHits}` : 'Merkliste'],
              ['bald', soonOffers.length ? `Bald ${soonOffers.length}` : 'Bald'],
              ['prospekte', 'Prospekte'],
            ] as const
          ).map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'prospekte' ? (
        <LeafletGrid plz={p.plz} markets={p.markets} chains={p.chains} offers={inChains} onOpen={p.onOpenLeaflet} />
      ) : mode === 'tipps' ? (
        <DealsView plz={p.plz} markets={p.markets} offers={p.offers} chains={p.chains} onToggleCart={p.onToggleCart} inCart={p.inCart} />
      ) : mode === 'bald' ? (
        <SoonView offers={soonOffers} onToggleCart={p.onToggleCart} inCart={p.inCart} />
      ) : mode === 'merkliste' ? (
        <WatchView
          terms={terms}
          setTerms={setTerms}
          offers={inChains}
          onToggleCart={p.onToggleCart}
          inCart={p.inCart}
          plz={p.plz}
          markets={p.markets}
          chains={p.chains}
        />
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
                Alle <span className="count">{nowOffers.length}</span>
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
              <OfferRow key={o.id} o={o} onToggleCart={p.onToggleCart} inCart={p.inCart.has(o.id)} />
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

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** Kommende Angebote (z. B. Prospekte der nächsten Woche), nach Markt und Starttag */
function SoonView(p: { offers: Offer[]; onToggleCart: (o: Offer) => void; inCart: Set<number> }) {
  const [chain, setChain] = useState<string>('alle');
  const chains = [...new Set(p.offers.map((o) => o.chain))];
  const list = p.offers
    .filter((o) => chain === 'alle' || o.chain === chain)
    .sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom) || ORDER.indexOf(a.group) - ORDER.indexOf(b.group) || a.price - b.price);
  const byStart = new Map<string, Offer[]>();
  for (const o of list) {
    const d = new Date(o.validFrom);
    const k = `ab ${DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
    byStart.set(k, [...(byStart.get(k) ?? []), o]);
  }
  if (!p.offers.length) return <p className="muted pad">Noch keine Angebote für die kommenden Tage veröffentlicht.</p>;
  return (
    <section aria-label="Kommende Angebote">
      <div className="group-row" role="tablist" aria-label="Markt">
        <button className={`chip ${chain === 'alle' ? 'on' : ''}`} onClick={() => setChain('alle')}>
          Alle <span className="count">{p.offers.length}</span>
        </button>
        {chains.map((c) => (
          <button key={c} className={`chip ${chain === c ? 'on' : ''}`} onClick={() => setChain(c)}>
            {shortChain(c)} <span className="count">{p.offers.filter((o) => o.chain === c).length}</span>
          </button>
        ))}
      </div>
      {[...byStart.entries()].map(([label, offers]) => (
        <section key={label} className="list-group">
          <h2 className="section-title">{label}</h2>
          <ul className="offer-list">
            {offers.map((o) => (
              <OfferRow key={o.id} o={o} onToggleCart={p.onToggleCart} inCart={p.inCart.has(o.id)} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
