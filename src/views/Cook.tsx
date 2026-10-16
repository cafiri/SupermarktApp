import { useEffect, useState } from 'react';
import type { DietChoice, Offer, Recipe, RecipesResponse } from '../../shared/types';
import type { Settings } from '../store';
import { DIET_LABEL, DIET_SHORT, euro, shortChain, validity } from '../format';
import { expiry } from '../shopping';
import { PriceTag } from './PriceTag';
import { OfferThumb } from './OfferRow';

const DIETS: DietChoice[] = ['alles', 'fleisch', 'fisch', 'vegetarisch', 'vegan'];
const TIMES: (number | null)[] = [null, 20, 30, 45];

export interface GenState {
  loading: boolean;
  error: string | null;
  loginExpired: boolean;
  startedAt: number;
}

interface Props {
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  cart: Offer[];
  removeFromCart: (id: number) => void;
  clearCart: () => void;
  cartRemoved: string[];
  dismissCartRemoved: () => void;
  wishes: string;
  setWishes: (w: string) => void;
  gen: GenState;
  onGenerate: () => void;
  results: RecipesResponse | null;
  onOpen: (r: Recipe) => void;
  onList: (r: Recipe) => void;
  isOnList: (r: Recipe) => boolean;
  ready: boolean;
  goToMarkets: () => void;
  goToOffers: () => void;
}

function useElapsed(active: boolean, since: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return Math.max(0, Math.round((now - since) / 1000));
}

export function CookView(p: Props) {
  const { settings: s, updateSettings: set, gen } = p;
  const elapsed = useElapsed(gen.loading, gen.startedAt);

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
  const cartNames = new Map(p.cart.map((o) => [o.id, o.name]));
  const allExpired = !!p.results?.recipes.length && p.results.recipes.every((r) => expiry(r).level === 'abgelaufen');

  return (
    <>
      <section className="cart" aria-label="Einkaufskorb">
        <div className="cart-head">
          <h2>Korb</h2>
          {p.cart.length > 0 && (
            <button className="link" onClick={p.clearCart}>
              Korb leeren
            </button>
          )}
        </div>
        {p.cartRemoved.length > 0 && (
          <p className="note">
            Abgelaufen und aus dem Korb genommen: {p.cartRemoved.join(', ')}{' '}
            <button className="link" onClick={p.dismissCartRemoved}>
              OK
            </button>
          </p>
        )}
        {p.cart.length === 0 ? (
          <p className="muted cart-empty">
            Leg unter{' '}
            <button className="link" onClick={p.goToOffers}>
              Angebote
            </button>{' '}
            mit „+ Korb“ Angebote hinein, aus denen gekocht werden soll – oder lass dir einfach Rezepte aus allen Angeboten vorschlagen.
          </p>
        ) : (
          <>
            <ul className="cart-items">
              {p.cart.map((o) => (
                <li key={o.id} className="cart-item">
                  <OfferThumb src={o.image} size={36} alt={o.name} />
                  <span className="cart-text">
                    <span className="cart-name">{o.name}</span>
                    <span className="muted small">
                      {shortChain(o.chain)} · {euro(o.price)} · {validity(o.validFrom, o.validTo)}
                    </span>
                  </span>
                  <button className="icon-btn" onClick={() => p.removeFromCart(o.id)} aria-label={`${o.name} aus dem Korb nehmen`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            {p.cart.length > 1 && (
              <div className="segmented two" role="radiogroup" aria-label="Wie soll der Korb verwendet werden?">
                <button role="radio" aria-checked={s.cartMode === 'eins'} className={s.cartMode === 'eins' ? 'on' : ''} onClick={() => set({ cartMode: 'eins' })}>
                  Alles in ein Gericht
                </button>
                <button
                  role="radio"
                  aria-checked={s.cartMode === 'verteilen'}
                  className={s.cartMode === 'verteilen' ? 'on' : ''}
                  onClick={() => set({ cartMode: 'verteilen' })}
                >
                  Auf Rezepte verteilen
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="filters" aria-label="Was soll es geben?">
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
          value={p.wishes}
          onChange={(e) => p.setWishes(e.target.value)}
          placeholder="Wunsch, z. B. „was Asiatisches“ oder „ohne Pilze“"
          maxLength={200}
        />

        <button className="primary big" onClick={p.onGenerate} disabled={gen.loading}>
          {gen.loading
            ? 'Rezepte werden gebaut …'
            : `${p.cart.length ? 'Rezepte aus dem Korb' : 'Rezepte'} für ${servings} Portion${servings > 1 ? 'en' : ''} bauen`}
        </button>
        {gen.loading && (
          <p className="loading-note" role="status">
            Claude sucht die passenden Angebote und rechnet die Preise aus. Das dauert meist 30–70 Sekunden. ({elapsed} s)
          </p>
        )}
        {gen.error && (
          <p className="error" role="alert">
            {gen.error}{' '}
            {gen.loginExpired && (
              <a className="link" href="/api/login">
                Neu anmelden
              </a>
            )}
          </p>
        )}
      </section>

      {p.results && p.results.recipes.length > 0 && (
        <section className={`results ${gen.loading ? 'stale' : ''}`} aria-label="Rezepte, günstigste zuerst" aria-busy={gen.loading}>
          <h2 className="section-title">Günstigste zuerst</h2>
          {allExpired && <p className="warn pad">Die Angebote dieser Rezepte sind abgelaufen. Bau neue Rezepte für die aktuellen Angebote.</p>}
          {(p.results.unusedCart?.length ?? 0) > 0 && (
            <p className="note pad">
              Nicht verwendet: {p.results.unusedCart!.map((id) => cartNames.get(id) ?? 'ein Korb-Angebot').join(', ')}
            </p>
          )}
          <ul className="recipe-list">
            {p.results.recipes.map((r) => {
              const ex = expiry(r);
              const onList = p.isOnList(r);
              const uses = (r.usesCart ?? []).map((id) => cartNames.get(id)).filter(Boolean);
              return (
                <li key={r.id} className="recipe-item">
                  <button className="recipe-card" onClick={() => p.onOpen(r)}>
                    <div className="recipe-main">
                      <h3>
                        {ex.level === 'abgelaufen' && (
                          <span className="bang" aria-label="Angebot abgelaufen">
                            !
                          </span>
                        )}
                        {r.title}
                      </h3>
                      <p className="recipe-desc">{r.description}</p>
                      <p className="recipe-meta">
                        {r.minutes} Min · {DIET_SHORT[r.diet]} · {r.chains.map(shortChain).join(' + ') || 'ohne Angebote'}
                      </p>
                      {uses.length > 0 && <p className="recipe-uses">nutzt: {uses.join(', ')}</p>}
                      {ex.level && <p className={`recipe-expiry ${ex.level}`}>{ex.text}</p>}
                    </div>
                    <div className="recipe-price">
                      <PriceTag amount={r.perPortion} />
                      <span className="per">pro Portion</span>
                      <span className="total">Einkauf {euro(r.totalCost)}</span>
                    </div>
                  </button>
                  <button className={`list-toggle ${onList ? 'on' : ''}`} onClick={() => p.onList(r)} aria-pressed={onList}>
                    {onList ? '✓ Auf der Einkaufsliste' : '+ Auf die Einkaufsliste'}
                  </button>
                </li>
              );
            })}
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
