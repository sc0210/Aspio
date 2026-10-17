import { parseInvestDescription, buildInvestDescription } from '@/utils/investmentUtils';

describe('parseInvestDescription', () => {
  it('parses standard Taiwanese ETF format with comma-separated price', () => {
    const result = parseInvestDescription('Buy 0050 ×100 @ 1,000.00 TWD');
    expect(result).toEqual({ symbol: '0050', qty: '100', price: '1000.00', currency: 'TWD' });
  });

  it('parses US stock format without comma in price', () => {
    const result = parseInvestDescription('Buy AAPL ×10 @ 150.00 USD');
    expect(result).toEqual({ symbol: 'AAPL', qty: '10', price: '150.00', currency: 'USD' });
  });

  it('parses crypto with decimal quantity', () => {
    const result = parseInvestDescription('Buy BTC ×0.5 @ 50,000.00 USD');
    expect(result).toEqual({ symbol: 'BTC', qty: '0.5', price: '50000.00', currency: 'USD' });
  });

  it('parses high-value stock with large comma-separated price', () => {
    const result = parseInvestDescription('Buy TSLA ×5 @ 2,500.00 USD');
    expect(result).toEqual({ symbol: 'TSLA', qty: '5', price: '2500.00', currency: 'USD' });
  });

  it('parses format with lowercase x (alternative separator)', () => {
    const result = parseInvestDescription('Buy ETH x2.5 @ 3,000.00 USD');
    expect(result).toEqual({ symbol: 'ETH', qty: '2.5', price: '3000.00', currency: 'USD' });
  });

  it('forces symbol and currency to uppercase', () => {
    const result = parseInvestDescription('Buy aapl ×10 @ 150.00 usd');
    expect(result).toEqual({ symbol: 'AAPL', qty: '10', price: '150.00', currency: 'USD' });
  });

  it('returns null for an empty string', () => {
    expect(parseInvestDescription('')).toBeNull();
  });

  it('returns null for a plain expense description', () => {
    expect(parseInvestDescription('Lunch at cafe')).toBeNull();
  });

  it('returns null for a partial/malformed investment string', () => {
    expect(parseInvestDescription('Buy 0050 100 1000 TWD')).toBeNull(); // missing × and @
  });

  it('returns null when currency code has wrong length', () => {
    // 4-char "code" should not match [A-Z]{3}
    expect(parseInvestDescription('Buy AAPL ×10 @ 150.00 USDT')).toBeNull();
  });

  it('strips commas from price correctly', () => {
    const result = parseInvestDescription('Buy SPY ×20 @ 4,500.75 USD');
    expect(result?.price).toBe('4500.75');
  });
});

describe('buildInvestDescription', () => {
  it('builds a description for whole-number quantity', () => {
    expect(buildInvestDescription('0050', 100, 1000, 'TWD'))
      .toBe('Buy 0050 ×100 @ 1,000.00 TWD');
  });

  it('builds a description for fractional quantity', () => {
    expect(buildInvestDescription('BTC', 0.5, 50000, 'USD'))
      .toBe('Buy BTC ×0.5000 @ 50,000.00 USD');
  });

  it('forces symbol and currency to uppercase', () => {
    expect(buildInvestDescription('aapl', 10, 150, 'usd'))
      .toBe('Buy AAPL ×10 @ 150.00 USD');
  });

  it('round-trips: parseInvestDescription(buildInvestDescription(…)) returns original values', () => {
    const desc = buildInvestDescription('TSLA', 5, 2500, 'USD');
    const parsed = parseInvestDescription(desc);
    expect(parsed).toEqual({ symbol: 'TSLA', qty: '5', price: '2500.00', currency: 'USD' });
  });

  it('round-trips with decimal quantity', () => {
    const desc = buildInvestDescription('ETH', 1.5, 3000, 'USD');
    const parsed = parseInvestDescription(desc);
    expect(parsed?.qty).toBe('1.5000');
    expect(parsed?.price).toBe('3000.00');
    expect(parsed?.symbol).toBe('ETH');
    expect(parsed?.currency).toBe('USD');
  });

  it('formats price with comma separators for values >= 1000', () => {
    const desc = buildInvestDescription('SPY', 1, 4500.75, 'USD');
    expect(desc).toBe('Buy SPY ×1 @ 4,500.75 USD');
  });
});
