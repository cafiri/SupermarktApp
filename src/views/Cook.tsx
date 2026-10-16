import { useEffect, useRef, useState } from 'react';
import type { DietChoice, Offer, Recipe, RecipeRequest, RecipesResponse } from '../../shared/types';
import { api, LoginError, type Settings } from '../store';
import { DIET_LABEL, DIET_SHORT, euro, shortChain } from '../format';
import { PriceTag } from './PriceTag';

const DIETS: DietChoice[] = ['alles', 'fleisch', 'fisch', 'vegetarisch', 'vegan'];
const TIMES: (number | null)[] = [null, 20, 30, 45];

interface Props {
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  plz: string;
  chains: string[];
  markets: number[];
  focus: Offer | null;
  clearFocus: () => void;
  results: RecipesResponse | null;
  onResults: (r: RecipesResponse) => void;
  onOpen: (r: Recipe) => void;
  autoRun: number;
  ready: boolean;
  goToMarkets: () => void;
}

export function CookView(p: Props) {
  const { settings: s, updateSettings: set } = p;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [wishes, setWishes] = useState('');
  const [loginExpired, setLoginExpired] = useState(false);
  const timer = useRef<number>();

  async function generate() {
    if (!p.ready || loading) return;
    setLoading(true);
    setError(null);
    setElapsed(0);
    const start = Date.now();
    timer.current = window.setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    try {
      const body: RecipeRequest = {
        plz: p.plz,
        chains: p.chains,
        markets: p.markets,
        diet: s.diet,
        persons: s.persons,
        days: s.days,
        maxMinutes: s.maxMinutes,
        focusOfferId: p.focus?.id ?? null,
        wishes,
      };
      const data = await api<RecipesResponse>('/api/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      p.onResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoginExpired(e instanceof LoginError);
    } finally {
      window.clearInterval(timer.current);
      setLoading(false);
    }
  }

  // "Rezepte damit" aus der Angebotsliste startet direkt
  useEffect(() => {
    if (p.autoRun > 0) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.autoRun]);

  if (!p.ready) {
    return (
      <section className="empty">
        <h2>Wo kaufst du ein?</h2>
        <p>Gib deine Postleitzahl ein und wähle deine Märkte. Danach schlage ich dir Rezepte aus deren Angeboten vor.</p>
        <button className="primary" onClick={p.goToMarkets}>
          Märkte wählen
        </button>
      </section>
    );
  }

  const servings = s.persons * s.days;

  return (
    <>
      <section className="filters" aria-label="Was soll es geben?">
        {p.focus && (
          <div className="focus">
            <div>
              <span className="focus-label">Rezepte mit</span>
              <strong>{p.focus.name}</strong>
              <span className="muted">
                {' '}
                {shortChain(p.focus.chain)} · {euro(p.focus.price)}
              </span>
            </div>
            <button className="icon-btn" onClick={p.clearFocus} aria-label="Angebot entfernen">
              ✕
            </button>
          </div>
        )}

        <div className="segmented" role="radiogroup" aria-label="Ernährung">
          {DIETS.map((d) => (
            <button key={d} role="radio" aria-checked={s.diet === d} className={s.diet === d ? 'on' : ''} onClick={() => set({ diet: d })}>
              {d === 'vegetarisch' ? 'Veggie' : DIET_LABEL[d]}
            </button>
          ))}
        </div>

        <div className="filter-grid">
          <Stepper label="Personen" value={s.persons} min={1} max={4} onChange={(v) => set({ persons: v })} />
          <Stepper label="Tage vorkochen" value={s.days} min={1} max={5} onChange={(v) => set({ days: v })} />
        </div>

        <div className="time-row" role="radiogroup" aria-label="Maximale Kochzeit">
          <span className="field-label">Max. Zeit</span>
          {TIMES.map((t) => (
            <button
              key={t ?? 0}
              role="radio"
              aria-checked={s.maxMinutes === t}
              className={`chip ${s.maxMinutes === t ? 'on' : ''}`}
              onClick={() => set({ maxMinutes: t })}
            >
              {t ? `${t} Min` : 'egal'}
            </button>
          ))}
        </div>

        <input
          className="wishes"
          value={wishes}
          onChange={(e) => setWishes(e.target.value)}
          placeholder="Wunsch, z. B. „was Asiatisches“ oder „ohne Pilze“"
          maxLength={200}
        />

        <button className="primary big" onClick={generate} disabled={loading}>
          {loading ? 'Rezepte werden gebaut …' : `Rezepte für ${servings} Portion${servings > 1 ? 'en' : ''} finden`}
        </button>
        {loading && (
          <p className="loading-note" role="status">
            Claude sucht die passenden Angebote und rechnet die Preise aus. Das dauert meist 20–60 Sekunden. ({elapsed} s)
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}{' '}
            {loginExpired && (
              <a className="link" href="/api/login">
                Neu anmelden
              </a>
            )}
          </p>
        )}
      </section>

      {p.results && p.results.recipes.length > 0 && (
        <section className={`results ${loading ? 'stale' : ''}`} aria-label="Rezepte, günstigste zuerst" aria-busy={loading}>
          <h2 className="section-title">Günstigste zuerst</h2>
          <ul className="recipe-list">
            {p.results.recipes.map((r) => (
              <li key={r.id}>
                <button className="recipe-card" onClick={() => p.onOpen(r)}>
                  <div className="recipe-main">
                    <h3>{r.title}</h3>
                    <p className="recipe-desc">{r.description}</p>
                    <p className="recipe-meta">
                      {r.minutes} Min · {DIET_SHORT[r.diet]} · {r.chains.map(shortChain).join(' + ') || 'ohne Angebote'}
                    </p>
                  </div>
                  <div className="recipe-price">
                    <PriceTag amount={r.perPortion} />
                    <span className="per">pro Portion</span>
                    <span className="total">Einkauf {euro(r.totalCost)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Stepper(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span className="field-label">{props.label}</span>
      <div className="stepper-ctrl">
        <button
          onClick={() => props.onChange(Math.max(props.min, props.value - 1))}
          disabled={props.value <= props.min}
          aria-label={`${props.label} weniger`}
        >
          −
        </button>
        <output aria-live="polite">{props.value}</output>
        <button
          onClick={() => props.onChange(Math.min(props.max, props.value + 1))}
          disabled={props.value >= props.max}
          aria-label={`${props.label} mehr`}
        >
          +
        </button>
      </div>
    </div>
  );
}
