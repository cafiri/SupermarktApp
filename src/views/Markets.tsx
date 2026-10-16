import { useEffect, useState } from 'react';
import type { ChainInfo } from '../../shared/types';
import { api, fetchOffers, type Settings, type Trip } from '../store';

interface Health {
  monthCostUsd: number;
  budgetUsd: number;
  recipesToday: number;
  recipesPerDay: number;
}

function CostInfo() {
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
      <CostInfo />
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
      const d = await fetchOffers(plz);
      const ketten = d.chains.filter((c) => c.kind !== 'markt');
      setChains(ketten);
      setNearby(d.nearby ?? []);
      if (!ketten.length && !d.nearby?.length) setError('Für diese PLZ wurden keine Märkte gefunden.');
      const names = new Set([...ketten.map((c) => c.name), ...(d.nearby ?? []).map((c) => c.name)]);
      setPicked((prev) => prev.filter((c) => names.has(c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

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
            {c.address && <span className="muted small">{c.address}</span>}
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
        <p className="current">
          Gewählt: {props.selected.map(shortChain).join(', ')} · PLZ {props.initialPlz}
        </p>
      )}
      {props.extra}
    </section>
  );
}
