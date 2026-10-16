import type { Offer } from '../../shared/types';
import { euro, shortChain, validity } from '../format';

export function OfferThumb({ src, size = 56 }: { src?: string; size?: number }) {
  if (!src) return <span className="thumb-empty" style={{ width: size, height: size }} aria-hidden="true" />;
  return (
    <img
      className="thumb"
      src={src}
      alt=""
      loading="lazy"
      width={size}
      height={size}
      onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
    />
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
      <OfferThumb src={o.image} />
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
