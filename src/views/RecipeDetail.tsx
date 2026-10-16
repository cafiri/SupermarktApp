import { useState } from 'react';
import type { Recipe, RecipeIngredient } from '../../shared/types';
import { DIET_SHORT, euro, shortChain } from '../format';
import { PriceTag } from './PriceTag';
import { OfferThumb } from './OfferRow';
import { expiry, listAsText, mergeRecipes, shareText } from '../shopping';

export function RecipeDetail({
  recipe: r,
  onBack,
  onList,
  onListNow,
}: {
  recipe: Recipe;
  onBack: () => void;
  onList: () => void;
  onListNow: boolean;
}) {
  const ex = expiry(r);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const [shared, setShared] = useState<string | null>(null);

  async function shareList() {
    setShared(await shareText(`Einkaufsliste: ${r.title}`, listAsText(`Einkaufsliste: ${r.title}`, mergeRecipes([r]), shortChain)));
  }

  // Einkaufsliste nach Markt gruppieren
  const byChain = new Map<string, RecipeIngredient[]>();
  const other: RecipeIngredient[] = [];
  const pantry: RecipeIngredient[] = [];
  r.ingredients.forEach((i) => {
    if (i.offer) byChain.set(i.offer.chain, [...(byChain.get(i.offer.chain) ?? []), i]);
    else if (i.pantry) pantry.push(i);
    else other.push(i);
  });

  return (
    <div className="detail">
      <header className="detail-top">
        <button className="back" onClick={onBack}>
          ‹ Zurück
        </button>
      </header>

      <section className="detail-head">
        <h1>{r.title}</h1>
        <p>{r.description}</p>
        <div className="detail-price">
          <PriceTag amount={r.perPortion} size="lg" />
          <div className="detail-price-text">
            <span>pro Portion · {r.servings} Portionen</span>
            <span>
              Einkauf {euro(r.totalCost)}
              {r.estimatedCost > 0 && <> (davon {euro(r.estimatedCost)} geschätzt)</>}
            </span>
            <span>
              {r.minutes} Min · {DIET_SHORT[r.diet]}
            </span>
            {ex.level && <span className={`recipe-expiry ${ex.level}`}>{ex.level === 'abgelaufen' ? `! ${ex.text}` : ex.text}</span>}
          </div>
        </div>
      </section>

      <div className="pad detail-actions">
        <button className={`list-toggle wide ${onListNow ? 'on' : ''}`} onClick={onList} aria-pressed={onListNow}>
          {onListNow ? '✓ Auf der Einkaufsliste' : '+ Auf die Einkaufsliste'}
        </button>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Zutaten</h2>
          <button className="secondary small-btn" onClick={shareList}>
            Teilen
          </button>
        </div>
        {shared && (
          <p className="note" role="status">
            {shared}
          </p>
        )}
        {[...byChain.entries()].map(([chain, items]) => (
          <div key={chain} className="shop-group">
            <h3>{shortChain(chain)} – Angebote</h3>
            <ul>
              {items.map((i) => (
                <ShopItem key={i.name} i={i} checked={checked.has(i.name)} onToggle={() => toggle(i.name)} />
              ))}
            </ul>
          </div>
        ))}
        {other.length > 0 && (
          <div className="shop-group">
            <h3>Dazu kaufen (Preis geschätzt)</h3>
            <ul>
              {other.map((i) => (
                <ShopItem key={i.name} i={i} checked={checked.has(i.name)} onToggle={() => toggle(i.name)} />
              ))}
            </ul>
          </div>
        )}
        {pantry.length > 0 && (
          <div className="shop-group pantry">
            <h3>Aus dem Vorrat</h3>
            <p>{pantry.map((i) => (i.quantity ? `${i.name} (${i.quantity})` : i.name)).join(', ')}</p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Zubereitung</h2>
        <ol className="steps">
          {r.steps.map((s, idx) => (
            <li key={idx}>{s}</li>
          ))}
        </ol>
      </section>

      {(r.storage || r.tip) && (
        <section className="card notes">
          {r.storage && (
            <p>
              <strong>Aufbewahren: </strong>
              {r.storage}
            </p>
          )}
          {r.tip && (
            <p>
              <strong>Tipp: </strong>
              {r.tip}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function ShopItem({ i, checked, onToggle }: { i: RecipeIngredient; checked: boolean; onToggle: () => void }) {
  return (
    <li className={`shop-item ${checked ? 'done' : ''}`}>
      <label>
        <input type="checkbox" checked={checked} onChange={onToggle} />
        {i.offer && <OfferThumb src={i.offer.image} size={44} alt={i.offer.name} />}
        <span className="shop-text">
          <span className="shop-name">
            {i.offer ? (
              <>
                {i.offer.packs > 1 && `${i.offer.packs} × `}
                {i.offer.name}
                {i.offer.brand && <span className="muted"> {i.offer.brand}</span>}
              </>
            ) : (
              i.name
            )}
          </span>
          <span className="shop-sub">
            {i.offer
              ? [i.offer.pack, i.offer.page ? `Prospekt S. ${i.offer.page}` : null, `für ${i.name}: ${i.quantity}`].filter(Boolean).join(' · ')
              : i.quantity}
          </span>
        </span>
        <span className="shop-price">
          {i.offer ? euro(i.cost) : `~ ${euro(i.cost)}`}
        </span>
      </label>
    </li>
  );
}
