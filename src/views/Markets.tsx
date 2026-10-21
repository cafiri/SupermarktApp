import { useEffect, useState } from 'react';
import type { ChainInfo, ProspektStatus, StoreInfo } from '../../shared/types';
import { api, edekaNearbyFromDevice, fetchOffers, type Settings, type Trip } from '../store';
import { AppInfo } from './AppInfo';

interface Health {
  monthCostUsd: number;
  budgetUsd: number;
  recipesToday: number;
  recipesPerDay: number;
}

/** Liste der Zutaten, die nie vorkommen sollen – einsehbar und änderbar */
export function Dislikes({ list, toggle }: { list: string[]; toggle: (n: string) => void }) {
  const [input, setInput] = useState('');
  return (
    <section className="card">
      <h2>Mag ich nicht</h2>
      <p className="muted small">Diese Zutaten kommen in keinem Rezept vor.</p>
      <form
        className="watch-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim().length >= 3) toggle(input.trim());
          setInput('');
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="z. B. Kürbis, Pilze" aria-label="Zutat, die du nicht magst" />
        <button type="submit" className="secondary" disabled={input.trim().length < 3}>
          Hinzufügen
        </button>
      </form>
      {list.length === 0 ? (
        <p className="muted small">Noch nichts eingetragen.</p>
      ) : (
        <div className="group-row tight wrap">
          {list.map((d) => (
            <button key={d} className="chip on dislike" onClick={() => toggle(d)} aria-label={`${d} wieder erlauben`}>
              ✕ {d}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });

/** Welche Prospekte die KI eingelesen hat – und wann */
export function ProspektInfo({ markets }: { markets: number[] }) {
  const [s, setS] = useState<ProspektStatus | null>(null);
  useEffect(() => {
    if (!markets.length) return;
    api<ProspektStatus>(`/api/status?markets=${markets.join(',')}`).then(setS).catch(() => setS(null));
  }, [markets.join(',')]);
  if (!markets.length) return null;
  return (
    <section className="card status">
      <h2>Prospekte</h2>
      <p className="muted small">
        Lidl, REWE, Penny, Netto, Kaufland und ALDI Nord kommen fertig als Daten – ohne KI. Nur die Prospekte einzelner EDEKA-Märkte liest
        die KI, und zwar jeden Prospekt genau einmal.
      </p>
      {!s && <p className="muted small">Lädt …</p>}
      {s?.markets.map((m) => (
        <div key={m.market} className="status-market">
          <h3>{m.market}</h3>
          {!m.prospekte.length && <p className="muted small">Noch kein Prospekt eingelesen – passiert innerhalb von 30 Minuten.</p>}
          <ul>
            {m.prospekte.map((p) => (
              <li key={p.validFrom}>
                <strong>
                  {day(p.validFrom)} – {day(p.validTo)}
                </strong>
                {p.preview ? ' (nächste Woche)' : ''}
                <span className="muted small">
                  {' '}
                  · {p.count} Angebote ·{' '}
                  {p.extractedAt ? `von der KI gelesen ${when(p.extractedAt)}` : 'eingelesen (Zeitpunkt nicht erfasst)'}
                  {p.costUsd != null ? ` · ${p.costUsd.toLocaleString('de-DE', { minimumFractionDigits: 2 })} $` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {s?.lastCheck && <p className="muted small">Zuletzt nach neuen Prospekten geschaut: {when(s.lastCheck)}</p>}
    </section>
  );
}

export function CostInfo() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    api<Health>('/api/health').then(setH).catch(() => setH(null));
  }, []);
  if (!h) return null;
  const fmt = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <section className="card cost">
      <h2>KI-Kosten</h2>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={h.budgetUsd} aria-valuenow={h.monthCostUsd}>
        <span style={{ width: `${Math.min(100, (h.monthCostUsd / h.budgetUsd) * 100)}%` }} />
      </div>
      <p className="muted small">
        Diesen Monat {fmt(h.monthCostUsd)} $ von {fmt(h.budgetUsd)} $ · heute {h.recipesToday} von {h.recipesPerDay} Rezeptanfragen
      </p>
    </section>
  );
}
import { shortChain } from '../format';

interface Props {
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  trip: Trip | null;
  setTrip: (t: Trip | null) => void;
  onDone: () => void;
  stores: StoreInfo[];
  onToggleDislike: (name: string) => void;
}

export function MarketsView(p: Props) {
  return (
    <>
      <ChainPicker
        title="Zuhause"
        hint="Wähle die Märkte, in denen du meistens einkaufst. Ihre Angebote siehst du immer."
        initialPlz={p.settings.plz}
        selected={p.settings.chains}
        selectedMarkets={p.settings.markets ?? []}
        stores={p.stores}
        saveLabel="Märkte speichern"
        onSave={(plz, chains, markets) => {
          p.updateSettings({ plz, chains, markets });
          p.setTrip(null);
          p.onDone();
        }}
      />
      <ChainPicker
        title="Unterwegs"
        hint="Woanders einkaufen? Andere PLZ eingeben und Märkte wählen. Deine Märkte zuhause bleiben gespeichert."
        initialPlz={p.trip?.plz ?? ''}
        selected={p.trip?.chains ?? []}
        selectedMarkets={p.trip?.markets ?? []}
        saveLabel="Unterwegs einkaufen"
        onSave={(plz, chains, markets) => {
          p.setTrip({ plz, chains, markets });
          p.onDone();
        }}
        extra={
          p.trip && (
            <button className="secondary" onClick={() => p.setTrip(null)}>
              Zurück zu meinen Märkten
            </button>
          )
        }
      />
      <p className="muted pad small">
        Ketten wie Lidl oder REWE haben in der ganzen Region dieselben Angebote. Bei EDEKA und nah & gut gilt der Prospekt des
        einzelnen Markts – den liest die App einmal pro Woche ein.
      </p>
    </>
  );
}

function ChainPicker(props: {
  title: string;
  hint: string;
  initialPlz: string;
  selected: string[];
  selectedMarkets: number[];
  stores?: StoreInfo[];
  saveLabel: string;
  onSave: (plz: string, chains: string[], markets: number[]) => void;
  extra?: React.ReactNode;
}) {
  const [plz, setPlz] = useState(props.initialPlz);
  const [chains, setChains] = useState<ChainInfo[] | null>(null);
  const [nearby, setNearby] = useState<ChainInfo[]>([]);
  const [picked, setPicked] = useState<string[]>(props.selected);
  const [pickedMarkets, setPickedMarkets] = useState<number[]>(props.selectedMarkets);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{5}$/.test(plz);

  async function load() {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      // Gewählte Märkte mitschicken, damit sie in der Liste bleiben
      const own = plz === props.initialPlz ? props.selectedMarkets : [];
      const d = await fetchOffers(plz, own);
      const ketten = d.chains.filter((c) => c.kind !== 'markt');
      let near = d.nearby ?? [];
      // Server findet keine EDEKA-Märkte (EDEKA blockt die Cloud): direkt vom Handy suchen
      if (!near.some((c) => !own.includes(c.marketId ?? -1))) {
        const found = await edekaNearbyFromDevice(plz).catch(() => [] as ChainInfo[]);
        near = [...found, ...near.filter((c) => !found.some((f) => f.marketId === c.marketId))];
      }
      setChains(ketten);
      setNearby(near);
      if (!ketten.length && !near.length) setError('Für diese PLZ wurden keine Märkte gefunden.');
      const names = new Set([...ketten.map((c) => c.name), ...near.map((c) => c.name)]);
      setPicked((prev) => prev.filter((c) => names.has(c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Nächste Filiale bei Ketten (nur für die Heimat-PLZ bekannt)
  const store = (chain: string) => {
    const st = props.stores?.find((x) => x.chain === chain);
    return st?.address ? `nächste: ${st.address} · ${st.distanceKm.toLocaleString("de-DE")} km` : undefined;
  };

  const toggle = (c: ChainInfo) => {
    const on = picked.includes(c.name);
    setPicked((s) => (on ? s.filter((x) => x !== c.name) : [...s, c.name]));
    if (c.marketId) {
      const id = c.marketId;
      setPickedMarkets((s) => (on ? s.filter((x) => x !== id) : [...s, id]));
    }
  };

  const option = (c: ChainInfo) => {
    const on = picked.includes(c.name);
    return (
      <li key={c.name}>
        <label className={`chain-option ${on ? 'on' : ''}`}>
          <input type="checkbox" checked={on} onChange={() => toggle(c)} />
          <span className="chain-text">
            <span className="chain-name">{shortChain(c.name)}</span>
            {(c.address ?? store(c.name)) && <span className="muted small">{c.address ?? store(c.name)}</span>}
          </span>
          {c.kind !== 'markt' && <span className="muted">{c.count} Angebote</span>}
        </label>
      </li>
    );
  };

  return (
    <section className="card markets">
      <h2>{props.title}</h2>
      <p className="muted">{props.hint}</p>
      <form
        className="plz-row"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          value={plz}
          onChange={(e) => {
            setPlz(e.target.value.replace(/\D/g, ''));
            setChains(null);
          }}
          placeholder="PLZ"
          aria-label={`PLZ ${props.title}`}
        />
        <button type="submit" className="secondary" disabled={!valid || loading}>
          {loading ? 'Lädt …' : 'Märkte suchen'}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {chains && (
        <>
          {chains.length > 0 && (
            <>
              <h3 className="picker-head">Ketten in der Region</h3>
              <ul className="chain-list">{chains.map(option)}</ul>
            </>
          )}
          {nearby.length > 0 && (
            <>
              <h3 className="picker-head">EDEKA-Märkte in der Nähe</h3>
              <ul className="chain-list">{nearby.map(option)}</ul>
            </>
          )}
          <button className="primary" disabled={!picked.length} onClick={() => props.onSave(plz, picked, pickedMarkets)}>
            {props.saveLabel}
          </button>
        </>
      )}
      {!chains && props.selected.length > 0 && (
        <>
          <p className="current">Gewählt · PLZ {props.initialPlz}</p>
          <ul className="chosen">
            {props.selected.map((c) => (
              <li key={c}>
                <strong>{shortChain(c)}</strong>
                {store(c) && <span className="muted small"> {store(c)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {props.extra}
    </section>
  );
}
