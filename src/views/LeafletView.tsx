import { useMemo, useState } from 'react';
import { GROUP_LABELS, type Group, type Leaflet, type Offer } from '../../shared/types';
import { shortChain } from '../format';
import { OfferRow } from './OfferRow';

const ORDER: Group[] = ['fleisch', 'fisch', 'gemuese', 'obst', 'milch', 'wurst', 'vorrat', 'tiefkuehl', 'feinkost', 'brot', 'fruehstueck', 'snacks', 'getraenke'];

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });

/** Ein Markt: Prospekt zum Durchblättern oder alle Angebote als Liste mit Bildern */
export function LeafletView(props: { chain: string; leaflets: Leaflet[]; offers: Offer[]; onBack: () => void; onToggleCart: (o: Offer) => void; inCart: Set<number> }) {
  const [mode, setMode] = useState<'blaettern' | 'liste'>(props.leaflets.length ? 'blaettern' : 'liste');
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState<string | null>(null);
  const leaflet = props.leaflets[active];

  const grouped = useMemo(() => {
    const m = new Map<Group, Offer[]>();
    props.offers.forEach((o) => m.set(o.group, [...(m.get(o.group) ?? []), o]));
    return ORDER.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const);
  }, [props.offers]);

  return (
    <div className="detail leaflet-view">
      <header className="detail-top leaflet-top">
        <button className="back" onClick={props.onBack}>
          ‹ Zurück
        </button>
        <strong className="leaflet-head">{shortChain(props.chain)}</strong>
      </header>

      <div className="mode-row">
        <div className="segmented two" role="tablist" aria-label="Ansicht">
          <button
            role="tab"
            aria-selected={mode === 'blaettern'}
            className={mode === 'blaettern' ? 'on' : ''}
            disabled={!props.leaflets.length}
            onClick={() => setMode('blaettern')}
          >
            Blättern
          </button>
          <button role="tab" aria-selected={mode === 'liste'} className={mode === 'liste' ? 'on' : ''} onClick={() => setMode('liste')}>
            Liste mit Bildern
          </button>
        </div>
      </div>

      {mode === 'blaettern' && leaflet && (
        <>
          {props.leaflets.length > 1 && (
            <div className="group-row">
              {props.leaflets.map((l, i) => (
                <button key={l.id} className={`chip ${i === active ? 'on' : ''}`} onClick={() => setActive(i)}>
                  {Date.parse(l.validFrom) > Date.now() ? 'Nächste Woche' : 'Aktuell'} · ab {fmtDay(l.validFrom)}
                </button>
              ))}
            </div>
          )}
          <p className="muted pad small">
            Gültig {fmtDay(leaflet.validFrom)} bis {fmtDay(leaflet.validTo)} · {leaflet.pages.length} Seiten · Seite antippen zum
            Vergrößern
          </p>
          <ol className="pages">
            {leaflet.pages.map((src, i) => (
              <li key={src}>
                <button className="page" onClick={() => setZoom(leaflet.pagesLarge[i])} aria-label={`Seite ${i + 1} vergrößern`}>
                  <img src={src} alt={`Seite ${i + 1}`} loading={i < 2 ? 'eager' : 'lazy'} />
                </button>
                <span className="page-no">{i + 1}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {mode === 'liste' && (
        <>
          {!props.offers.length && <p className="muted pad">Keine Angebote geladen.</p>}
          {grouped.map(([g, list]) => (
            <section key={g} className="list-group">
              <h2 className="section-title">{GROUP_LABELS[g]}</h2>
              <ul className="offer-list">
                {list.map((o) => (
                  <OfferRow key={o.id} o={o} onToggleCart={props.onToggleCart} inCart={props.inCart.has(o.id)} showChain={false} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {zoom && (
        <div className="zoom" role="dialog" aria-label="Prospektseite" onClick={() => setZoom(null)}>
          <button className="zoom-close" aria-label="Schließen">
            ✕
          </button>
          <div className="zoom-scroll" onClick={(e) => e.stopPropagation()}>
            <img src={zoom} alt="Prospektseite groß" />
          </div>
        </div>
      )}
    </div>
  );
}
