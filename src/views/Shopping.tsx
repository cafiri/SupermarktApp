import { useEffect, useMemo, useState } from 'react';
import type { Offer, Recipe, StoreInfo } from '../../shared/types';
import { euro, shortChain } from '../format';
import { listAsText, mergeRecipes, shareText } from '../shopping';
import { OfferThumb } from './OfferRow';

interface Props {
  recipes: Recipe[];
  singles: Offer[];
  removeSingle: (o: Offer) => void;
  checked: string[];
  toggleItem: (key: string) => void;
  removeRecipe: (r: Recipe) => void;
  clear: () => void;
  onOpen: (r: Recipe) => void;
  stores: StoreInfo[];
  goToCook: () => void;
}

export function ShoppingView(p: Props) {
  const list = useMemo(() => mergeRecipes(p.recipes, p.singles), [p.recipes, p.singles]);
  const checked = new Set(p.checked);
  const [msg, setMsg] = useState<string | null>(null);
  const store = (chain: string) => p.stores.find((s) => s.chain === chain);
  // Abhaken = gekauft: Ersparnis für den Monat mitzählen
  const toggle = (key: string, saving?: number) => {
    if (saving) addMonthSaving(checked.has(key) ? -saving : saving);
    p.toggleItem(key);
  };

  if (!p.recipes.length && !p.singles.length) {
    return (
      <section className="empty">
        <h2>Einkaufsliste ist leer</h2>
        <p>
          Tippe bei einem Rezept auf „+ Auf die Einkaufsliste“ oder bei einem Angebot auf „+ Liste“. Hier steht dann alles zusammengefasst,
          sortiert nach Markt.
        </p>
        <button className="primary" onClick={p.goToCook}>
          Zu den Rezepten
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>
            {[
              p.recipes.length ? `${p.recipes.length} Rezept${p.recipes.length > 1 ? 'e' : ''}` : '',
              p.singles.length ? `${p.singles.length} Angebot${p.singles.length > 1 ? 'e' : ''}` : '',
            ]
              .filter(Boolean)
              .join(' + ')}
          </h2>
          <button
            className="secondary small-btn"
            onClick={async () => setMsg(await shareText('Einkaufsliste', listAsText('Einkaufsliste', list, shortChain, checked)))}
          >
            Teilen
          </button>
        </div>
        {msg && (
          <p className="note" role="status">
            {msg}
          </p>
        )}
        <ul className="list-recipes">
          {p.recipes.map((r) => (
            <li key={r.id}>
              <button className="link" onClick={() => p.onOpen(r)}>
                {r.title}
              </button>
              <button className="icon-btn" onClick={() => p.removeRecipe(r)} aria-label={`${r.title} von der Liste nehmen`}>
                ✕
              </button>
            </li>
          ))}
          {p.singles.map((o) => (
            <li key={`s${o.id}`}>
              <span>
                {o.name} <span className="muted small">· {shortChain(o.chain)}</span>
              </span>
              <button className="icon-btn" onClick={() => p.removeSingle(o)} aria-label={`${o.name} von der Liste nehmen`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">Ungefähr {euro(list.total)} insgesamt</p>
        {list.saving > 0 && <p className="saving">Du sparst mindestens {euro(list.saving)} gegenüber dem Normalpreis</p>}
        <MonthSaving />
      </section>

      {list.chains.map((c) => {
        const st = store(c.chain);
        return (
          <section key={c.chain} className="card">
            <div className="card-head">
              <h2>{shortChain(c.chain)}</h2>
              <span className="muted">{euro(c.total)}</span>
            </div>
            {st?.address && (
              <p className="muted small store-line">
                {st.address} · {st.distanceKm.toLocaleString('de-DE')} km
              </p>
            )}
            <ul className="shop-list">
              {c.items.map((i) => (
                <Item key={i.key} i={i} done={checked.has(i.key)} onToggle={() => toggle(i.key, i.saving)} />
              ))}
            </ul>
          </section>
        );
      })}

      {list.other.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Außerdem</h2>
            <span className="muted">~ {euro(list.other.reduce((s, x) => s + x.cost, 0))}</span>
          </div>
          <p className="muted small">Nicht im Angebot, Preis geschätzt</p>
          <ul className="shop-list">
            {list.other.map((i) => (
              <Item key={i.key} i={i} done={checked.has(i.key)} onToggle={() => p.toggleItem(i.key)} />
            ))}
          </ul>
        </section>
      )}

      {list.pantry.length > 0 && (
        <section className="card notes">
          <p>
            <strong>Aus dem Vorrat: </strong>
            {list.pantry.join(', ')}
          </p>
        </section>
      )}

      <p className="pad">
        <button className="link" onClick={p.clear}>
          Einkaufsliste leeren
        </button>
      </p>
    </>
  );
}

function Item({ i, done, onToggle }: { i: ReturnType<typeof mergeRecipes>['other'][number]; done: boolean; onToggle: () => void }) {
  return (
    <li className={`shop-item ${done ? 'done' : ''}`}>
      <label>
        <input type="checkbox" checked={done} onChange={onToggle} />
        {!i.estimated && <OfferThumb src={i.image} crop={i.crop} size={44} alt={i.name} />}
        <span className="shop-text">
          <span className="shop-name">{i.name}</span>
          <span className="shop-sub">
            {i.detail}
            {i.saving ? ` · ${euro(i.saving)} gespart` : ''}
            {i.recipes.filter((r) => r !== 'Einzeln').length > 1 ? ` · für ${i.recipes.filter((r) => r !== 'Einzeln').length} Rezepte` : ''}
          </span>
        </span>
        <span className="shop-price">{i.estimated ? `~ ${euro(i.cost)}` : euro(i.cost)}</span>
      </label>
    </li>
  );
}

const monthKey = () => `savings:${new Date().toISOString().slice(0, 7)}`;
function addMonthSaving(n: number) {
  try {
    const v = Number(localStorage.getItem(monthKey()) ?? 0) + n;
    localStorage.setItem(monthKey(), String(Math.max(0, Math.round(v * 100) / 100)));
    window.dispatchEvent(new Event('savings'));
  } catch {
    /* egal */
  }
}
function MonthSaving() {
  const read = () => {
    try {
      return Number(localStorage.getItem(monthKey()) ?? 0);
    } catch {
      return 0;
    }
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const f = () => setV(read());
    window.addEventListener('savings', f);
    return () => window.removeEventListener('savings', f);
  }, []);
  if (!v) return null;
  return <p className="muted small">Diesen Monat beim Einkaufen gespart (abgehakt): {euro(v)}</p>;
}
