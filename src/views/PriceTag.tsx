/** Preisschild im Stil eines Supermarkt-Etiketts: Euro groß, Cent hochgestellt */
export function PriceTag({ amount, size = 'md' }: { amount: number; size?: 'md' | 'lg' }) {
  const [eur, ct] = amount.toFixed(2).split('.');
  return (
    <span className={`price-tag ${size}`} aria-label={`${eur},${ct} Euro`}>
      <span className="eur">{eur},</span>
      <span className="ct">{ct}</span>
    </span>
  );
}
