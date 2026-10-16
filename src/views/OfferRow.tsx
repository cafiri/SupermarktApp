import { useState } from 'react';
import type { Offer } from '../../shared/types';
import { euro, shortChain, validity } from '../format';

/** Größere Variante eines Produktbilds (marktguru, ALDI, EDEKA) */
export function largeImage(src: string): string {
  if (src.includes('mg2de.b-cdn.net')) return src.replace(/\/(small|medium)\.jpg$/, '/large.jpg');
  if (src.includes('scene7.com')) return src.replace(/\?wid=\d+&hei=\d+/, '?wid=900&hei=900');
  return src;
}

/** Produktbild; antippen zeigt es groß */
export function OfferThumb({ src, size = 56, alt = '' }: { src?: string; size?: number; alt?: string }) {
  const [open, setOpen] = useState(false);
  if (!src) return <span className="thumb-empty" style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <>
      <button
        type="button"
        className="thumb-btn"
        aria-label={alt ? `Bild von ${alt} vergrößern` : 'Bild vergrößern'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <img
          className="thumb"
          src={src}
          alt=""
          loading="lazy"
          width={size}
          height={size}
          onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
        />
      </button>
      {open && (
        <div
          className="img-zoom"
          role="dialog"
          aria-label={alt || 'Produktbild'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <img src={largeImage(src)} alt={alt} onError={(e) => (e.currentTarget.src = src)} />
          {alt && <p>{alt}</p>}
          <span className="img-zoom-hint">Antippen zum Schließen</span>
        </div>
      )}
    </>
  );
}

export function OfferRow({
  o,
  onToggleCart,
  inCart = false,
  showChain = true,
}: {
  o: Offer;
  onToggleCart?: (o: Offer) => void;
  inCart?: boolean;
  showChain?: boolean;
}) {
  return (
    <li className="offer">
      <OfferThumb src={o.image} alt={o.name} />
      <div className="offer-body">
        <div className="offer-name">{o.name}</div>
        <div className="offer-sub">{[o.brand, o.pack, showChain ? shortChain(o.chain) : null, o.page ? `S. ${o.page}` : null].filter(Boolean).join(' · ')}</div>
        {o.dealNote && <div className="offer-deal">{o.dealNote}</div>}
        <div className="offer-valid">{validity(o.validFrom, o.validTo)}</div>
      </div>
      <div className="offer-side">
        <div className="offer-price">{euro(o.price)}</div>
        {o.oldPrice && <div className="offer-old">{euro(o.oldPrice)}</div>}
        {o.refPrice && o.refUnit && (
          <div className="offer-ref">
            {euro(o.refPrice)}/{o.refUnit}
          </div>
        )}
        {o.cooking && onToggleCart && (
          <button className={`cook-btn ${inCart ? 'on' : ''}`} onClick={() => onToggleCart(o)} aria-pressed={inCart}>
            {inCart ? '✓ Im Korb' : '+ Korb'}
          </button>
        )}
      </div>
    </li>
  );
}
