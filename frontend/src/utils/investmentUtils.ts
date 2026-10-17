/**
 * Parse a backend-generated investment description back into structured fields.
 * Format: "Buy SYMBOL ×QTY @ PRICE CURRENCY"
 * Example: "Buy 0050 ×100 @ 1,000.00 TWD" → { symbol:"0050", qty:"100", price:"1000.00", currency:"TWD" }
 */
export function parseInvestDescription(desc: string): {
  symbol: string;
  qty: string;
  price: string;
  currency: string;
} | null {
  const m = desc.match(/^Buy\s+(\S+)\s+[×x]([0-9.]+)\s+@\s+([0-9,.]+)\s+([A-Z]{3})(?![A-Z])/i);
  if (!m) return null;
  return {
    symbol: m[1].toUpperCase(),
    qty: m[2],
    price: m[3].replace(/,/g, ''),
    currency: m[4].toUpperCase(),
  };
}

/**
 * Build a canonical investment description string that parseInvestDescription can round-trip.
 * qty is rendered without decimals when it is a whole number.
 */
export function buildInvestDescription(
  symbol: string,
  qty: number,
  price: number,
  currency: string,
): string {
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(4);
  const priceStr = price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `Buy ${symbol.toUpperCase()} ×${qtyStr} @ ${priceStr} ${currency.toUpperCase()}`;
}
