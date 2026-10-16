import { useState } from 'react';
import type { ChainInfo } from '../../shared/types';
import { fetchOffers, type Settings, type Trip } from '../store';
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
        hint="Wähle 3–4 Märkte, in denen du meistens einkaufst. Ihre Angebote siehst du immer."
        initialPlz={p.settings.plz}
        selected={p.settings.chains}
        saveLabel="Märkte speichern"
        onSave={(plz, chains) => {
          p.updateSettings({ plz, chains });
          p.setTrip(null);
          p.onDone();
        }}
      />
      <ChainPicker
        title="Unterwegs"
        hint="Woanders einkaufen? Andere PLZ eingeben und Märkte wählen. Deine Märkte zuhause bleiben gespeichert."
        initialPlz={p.trip?.plz ?? ''}
        selected={p.trip?.chains ?? []}
        saveLabel="Unterwegs einkaufen"
        onSave={(plz, chains) => {
          p.setTrip({ plz, chains });
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
        Angebote gelten für die Region der PLZ. Aldi und Edeka sind noch nicht dabei.
      </p>
    </>
  );
}

function ChainPicker(props: {
  title: string;
  hint: string;
  initialPlz: string;
  selected: string[];
  saveLabel: string;
  onSave: (plz: string, chains: string[]) => void;
  extra?: React.ReactNode;
}) {
  const [plz, setPlz] = useState(props.initialPlz);
  const [chains, setChains] = useState<ChainInfo[] | null>(null);
  const [picked, setPicked] = useState<string[]>(props.selected);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{5}$/.test(plz);

  async function load() {
    if (!valid) return;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchOffers(plz);
      setChains(d.chains);
      if (!d.chains.length) setError('Für diese PLZ wurden keine Lebensmittel-Angebote gefunden.');
      setPicked((prev) => prev.filter((c) => d.chains.some((x) => x.name === c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

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
      {chains && chains.length > 0 && (
        <>
          <ul className="chain-list">
            {chains.map((c) => {
              const on = picked.includes(c.name);
              return (
                <li key={c.name}>
                  <label className={`chain-option ${on ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setPicked((s) => (on ? s.filter((x) => x !== c.name) : [...s, c.name]))}
                    />
                    <span className="chain-name">{shortChain(c.name)}</span>
                    <span className="muted">{c.count} Angebote</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button className="primary" disabled={!picked.length} onClick={() => props.onSave(plz, picked)}>
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
