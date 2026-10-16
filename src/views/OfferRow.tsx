import { useState } from 'react';
import type { Crop, Offer } from '../../shared/types';
import { useListActions } from '../actions';
import { euro, shortChain, validity } from '../format';

/** Größere Variante eines Produktbilds (marktguru, ALDI, EDEKA) */
export function largeImage(src: string): string {
  if (src.includes('mg2de.b-cdn.net')) return src.replace(/\/(small|medium)\.jpg$/, '/xxlarge.jpg');
  if (src.includes('scene7.com')) return src.replace(/\?wid=\d+&hei=\d+/, '?wid=900&hei=900');
  return src;
}

/** Ausschnitt aus einer Prospektseite, eingepasst in ein Quadrat */
function CropImage({ crop, size, large = false }: { crop: Crop; size: number; large?: boolean }) {
  const R = crop.ratio;
  const cw = crop.w * R; // Breite des Ausschnitts in "Seitenhöhen"
  const ch = crop.h;
  const k = size / Math.max(cw, ch);
  const src = large ? crop.src : crop.src.replace('large%2Fbk_', 'normal%2Fbk_');
  return (
    <span className="crop" style={{ width: size, height: size }}>
      <img
        src={src}
        alt=""
        loading="lazy"
        style={{
          width: k * R,
          height: k,
          left: -crop.x * R * k + (size - cw * k) / 2,
          top: -crop.y * k + (size - ch * k) / 2,
        }}
      />
    </span>
  );
}

/** Produktbild (oder Prospekt-Ausschnitt); antippen zeigt es groß */
export function OfferThumb({ src, crop, size = 56, alt = '' }: { src?: string; crop?: Crop; size?: number; alt?: string }) {
  const [open, setOpen] = useState(false);
  if (!src && !crop) return <span className="thumb-empty" style={{ width: size, height: size }} aria-hidden="true" />;
  const big = Math.min(typeof window !== 'undefined' ? window.innerWidth - 32 : 400, 520);
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
        {src ? (
          <img
            className="thumb"
            src={src}
            alt=""
            loading="lazy"
            width={size}
            height={size}
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
          />
        ) : (
          <CropImage crop={crop!} size={size} />
        )}
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
          {src ? (
            <img
              src={largeImage(src)}
              alt={alt}
              onError={(e) => {
                const img = e.currentTarget;
                // Falls es die große Variante nicht gibt: erst "large", dann das Original
                if (img.src.includes('/xxlarge.jpg')) img.src = img.src.replace('/xxlarge.jpg', '/large.jpg');
                else if (img.src !== src) img.src = src;
              }}
            />
          ) : (
            <CropImage crop={crop!} size={big} large />
          )}
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
  const list = useListActions();
  const onList = list?.isOnList(o.id) ?? false;
  return (
    <li className="offer">
      <OfferThumb src={o.image} crop={o.crop} alt={o.name} />
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
        <div className="offer-btns">
          {o.cooking && onToggleCart && (
            <button className={`cook-btn ${inCart ? 'on' : ''}`} onClick={() => onToggleCart(o)} aria-pressed={inCart}>
              {inCart ? '✓ Korb' : '+ Korb'}
            </button>
          )}
          {list && (
            <button
              className={`cook-btn ${onList ? 'on' : ''}`}
              onClick={() => list.toggleListOffer(o)}
              aria-pressed={onList}
              aria-label={onList ? `${o.name} von der Einkaufsliste nehmen` : `${o.name} auf die Einkaufsliste`}
            >
              {onList ? '✓ Liste' : '+ Liste'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
